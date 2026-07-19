"""Lyralume UVR worker.

Reads exactly one versioned JSON request from stdin and writes JSON Lines events
to stdout. Library logs are redirected to stderr so they cannot corrupt the
Electron protocol.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import sys
import traceback
from pathlib import Path
from typing import Any

from model_cache import (
    atomic_download,
    cleanup_partial_downloads,
    discard_invalid_cached_model,
    is_valid_model_file,
)

PROTOCOL_VERSION = 1
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
PROTOCOL_STREAM = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
# Keep fd 1 exclusively for the saved protocol stream. Any Python or native
# library output that still targets stdout is redirected to Electron's stderr.
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())


def emit(message_type: str, task_id: str, stage: str, **payload: Any) -> None:
    message = {
        "version": PROTOCOL_VERSION,
        "type": message_type,
        "taskId": task_id,
        "stage": stage,
        **payload,
    }
    PROTOCOL_STREAM.write(json.dumps(message, ensure_ascii=False) + "\n")
    PROTOCOL_STREAM.flush()


def require_absolute_path(request: dict[str, Any], field: str) -> Path:
    value = request.get(field)
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError(f"{field} must be a non-empty path")
    result = Path(value)
    if not result.is_absolute():
        raise ValueError(f"{field} must be absolute")
    return result


def find_vocals(output_directory: Path, output_files: Any) -> Path:
    candidates: list[Path] = []
    if isinstance(output_files, (list, tuple)):
        candidates.extend(Path(str(item)) for item in output_files)
    candidates.extend(output_directory.glob("*Vocals*"))
    candidates.extend(output_directory.glob("*vocals*"))
    for candidate in candidates:
        resolved = candidate if candidate.is_absolute() else output_directory / candidate
        if resolved.is_file() and resolved.stat().st_size > 0:
            return resolved
    raise RuntimeError("Audio Separator did not produce a vocals stem")


def run(request: dict[str, Any]) -> None:
    task_id = request.get("taskId")
    if not isinstance(task_id, str) or not task_id:
        raise ValueError("taskId is required")
    if request.get("version") != PROTOCOL_VERSION or request.get("action") != "separate":
        raise ValueError("unsupported worker request")

    source = require_absolute_path(request, "inputPath")
    output = require_absolute_path(request, "outputPath")
    model_directory = require_absolute_path(request, "modelDirectory")
    model_name = request.get("modelName")
    if not isinstance(model_name, str) or not model_name:
        raise ValueError("modelName is required")
    model_source = request.get("modelSource", "managed")
    if model_source not in ("managed", "external"):
        raise ValueError("modelSource must be managed or external")
    if not source.is_file():
        raise FileNotFoundError(f"source audio does not exist: {source}")

    output.parent.mkdir(parents=True, exist_ok=True)
    model_path = model_directory / model_name
    if model_source == "managed":
        model_directory.mkdir(parents=True, exist_ok=True)
        removed_parts = cleanup_partial_downloads(model_directory)
        removed_model = discard_invalid_cached_model(model_directory, model_name)
        if removed_parts > 0:
            emit(
                "log",
                task_id,
                "separation",
                level="warning",
                message=f"已清理 {removed_parts} 个未完成的 UVR 模型下载",
            )
        if removed_model:
            emit(
                "log",
                task_id,
                "separation",
                level="warning",
                message=f"检测到损坏的 UVR 模型缓存，正在重新下载：{model_name}",
            )
    else:
        if not model_path.is_file():
            raise FileNotFoundError(f"自定义 UVR 模型不存在：{model_path}")
        if not is_valid_model_file(model_path, model_name):
            raise ValueError(f"自定义 UVR 模型未通过完整性校验：{model_path}")
        emit(
            "log",
            task_id,
            "separation",
            level="info",
            message=f"使用只读的自定义 UVR 模型：{model_path}",
        )
    source_before = source.stat()
    emit("progress", task_id, "separation", progress=0.03, message="正在载入 Audio Separator")

    with contextlib.redirect_stdout(sys.stderr):
        import requests
        from audio_separator.separator import Separator

        class AtomicDownloadSeparator(Separator):
            def download_file_if_not_exists(self, url: str, output_path: str) -> None:
                destination = Path(output_path)
                if destination.is_file():
                    self.logger.debug(f"File already exists at {destination}, skipping download")
                    return
                if model_source == "external" and destination.resolve() == model_path.resolve():
                    raise FileNotFoundError(f"自定义 UVR 模型不存在：{model_path}")
                last_percent = -1

                def report_progress(downloaded: int, total: int | None) -> None:
                    nonlocal last_percent
                    if not total:
                        return
                    percent = min(100, int(downloaded * 100 / total))
                    if percent == last_percent or (percent != 100 and percent % 2 != 0):
                        return
                    last_percent = percent
                    emit(
                        "progress",
                        task_id,
                        "separation",
                        progress=0.04 + 0.07 * (percent / 100),
                        message=f"正在安全下载 UVR 资源：{destination.name}（{percent}%）",
                    )

                self.logger.info(f"Downloading {destination.name} to a temporary file")
                atomic_download(url, destination, requests.get, report_progress)
                self.logger.info(f"Download verified and committed atomically: {destination.name}")

        separator = AtomicDownloadSeparator(
            log_level=20,
            model_file_dir=str(model_directory),
            output_dir=str(output.parent),
            output_format="WAV",
            output_single_stem="Vocals",
        )
        emit("progress", task_id, "separation", progress=0.12, message="正在载入 UVR 模型")
        separator.load_model(model_filename=model_name)
        emit("progress", task_id, "separation", progress=0.22, message="正在分离临时人声")
        produced = separator.separate(str(source))

    vocals = find_vocals(output.parent, produced)
    if vocals.resolve() != output.resolve():
        if output.exists():
            output.unlink()
        shutil.move(str(vocals), str(output))
    source_after = source.stat()
    if source_before.st_size != source_after.st_size or source_before.st_mtime_ns != source_after.st_mtime_ns:
        raise RuntimeError("source audio changed during separation")
    emit("progress", task_id, "separation", progress=1.0, message="临时人声已生成")
    emit("result", task_id, "separation", outputs={"vocalsPath": str(output)})


def main() -> int:
    task_id = "unknown"
    try:
        raw = sys.stdin.readline()
        if not raw:
            raise ValueError("stdin did not contain a request")
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise ValueError("request must be a JSON object")
        task_id = str(request.get("taskId", task_id))
        run(request)
        return 0
    except Exception as error:  # Worker boundary: report, then terminate cleanly.
        traceback.print_exc(file=sys.stderr)
        emit(
            "error",
            task_id,
            "separation",
            code=error.__class__.__name__,
            message=str(error) or "UVR worker failed",
            retryable=not isinstance(error, (ValueError, FileNotFoundError)),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
