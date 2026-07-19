"""Safe cache handling for UVR model downloads."""

from __future__ import annotations

import os
import uuid
import zipfile
from pathlib import Path
from typing import Any, Callable


class ModelCacheError(RuntimeError):
    """Raised when a model download cannot be committed safely."""


def requires_zip_checkpoint(filename: str) -> bool:
    lowered = filename.casefold()
    return lowered.endswith((".ckpt", ".pt", ".pth")) and "roformer" in lowered


def is_valid_model_file(path: Path, intended_filename: str | None = None) -> bool:
    if not path.is_file() or path.stat().st_size <= 0:
        return False
    filename = intended_filename or path.name
    if not requires_zip_checkpoint(filename):
        return True
    try:
        with zipfile.ZipFile(path) as archive:
            return len(archive.infolist()) > 0
    except (OSError, zipfile.BadZipFile):
        return False


def discard_invalid_cached_model(model_directory: Path, model_name: str) -> bool:
    model_path = model_directory / model_name
    if not model_path.exists() or is_valid_model_file(model_path, model_name):
        return False
    model_path.unlink()
    return True


def cleanup_partial_downloads(model_directory: Path) -> int:
    removed = 0
    for partial in model_directory.glob(".*.lyralume.part"):
        if partial.is_file():
            partial.unlink(missing_ok=True)
            removed += 1
    return removed


def atomic_download(
    url: str,
    output_path: str | Path,
    request_get: Callable[..., Any],
    on_progress: Callable[[int, int | None], None] | None = None,
) -> bool:
    """Download to a unique part file, validate it, then atomically publish it."""

    destination = Path(output_path)
    if destination.is_file():
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(
        f".{destination.name}.{os.getpid()}.{uuid.uuid4().hex}.lyralume.part"
    )
    response = None
    try:
        response = request_get(url, stream=True, timeout=(30, 300))
        status_code = int(getattr(response, "status_code", 0))
        if status_code != 200:
            raise ModelCacheError(
                f"Failed to download {destination.name}: HTTP {status_code}"
            )
        raw_length = getattr(response, "headers", {}).get("content-length")
        expected_size = int(raw_length) if raw_length else None
        downloaded = 0
        with temporary.open("xb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                handle.write(chunk)
                downloaded += len(chunk)
                if on_progress is not None:
                    on_progress(downloaded, expected_size)
            handle.flush()
            os.fsync(handle.fileno())

        if downloaded <= 0:
            raise ModelCacheError(f"Downloaded model file is empty: {destination.name}")
        if expected_size is not None and downloaded != expected_size:
            raise ModelCacheError(
                f"Incomplete model download for {destination.name}: "
                f"expected {expected_size} bytes, received {downloaded}"
            )
        if not is_valid_model_file(temporary, destination.name):
            raise ModelCacheError(
                f"Downloaded model failed integrity validation: {destination.name}"
            )
        os.replace(temporary, destination)
        return True
    finally:
        if response is not None:
            response.close()
        temporary.unlink(missing_ok=True)
