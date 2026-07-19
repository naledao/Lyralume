from __future__ import annotations

import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "workers" / "uvr"))

from model_cache import (  # noqa: E402
    ModelCacheError,
    atomic_download,
    cleanup_partial_downloads,
    discard_invalid_cached_model,
    is_valid_model_file,
)


def checkpoint_bytes() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("model/data.pkl", b"checkpoint")
    return output.getvalue()


class FakeResponse:
    def __init__(self, payload: bytes, declared_size: int | None = None) -> None:
        self.payload = payload
        self.status_code = 200
        self.headers = {
            "content-length": str(declared_size if declared_size is not None else len(payload))
        }
        self.closed = False

    def iter_content(self, chunk_size: int):
        for start in range(0, len(self.payload), chunk_size):
            yield self.payload[start : start + chunk_size]

    def close(self) -> None:
        self.closed = True


class ModelCacheTests(unittest.TestCase):
    def test_discards_a_truncated_roformer_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_name = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
            model_path = Path(directory) / model_name
            model_path.write_bytes(checkpoint_bytes()[:-22])

            self.assertFalse(is_valid_model_file(model_path, model_name))
            self.assertTrue(discard_invalid_cached_model(Path(directory), model_name))
            self.assertFalse(model_path.exists())

    def test_interrupted_download_never_publishes_the_final_filename(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "model_bs_roformer.ckpt"
            response = FakeResponse(checkpoint_bytes()[:20], declared_size=1000)

            with self.assertRaises(ModelCacheError):
                atomic_download("https://example.invalid/model", destination, lambda *args, **kwargs: response)

            self.assertFalse(destination.exists())
            self.assertEqual(list(Path(directory).glob(".*.lyralume.part")), [])
            self.assertTrue(response.closed)

    def test_complete_checkpoint_is_committed_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "model_bs_roformer.ckpt"
            response = FakeResponse(checkpoint_bytes())

            changed = atomic_download(
                "https://example.invalid/model",
                destination,
                lambda *args, **kwargs: response,
            )

            self.assertTrue(changed)
            self.assertTrue(is_valid_model_file(destination, destination.name))
            self.assertEqual(list(Path(directory).glob(".*.lyralume.part")), [])

    def test_cleans_stale_part_files_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            partial = root / ".model.ckpt.1.deadbeef.lyralume.part"
            unrelated = root / "keep.part"
            partial.write_bytes(b"partial")
            unrelated.write_bytes(b"keep")

            self.assertEqual(cleanup_partial_downloads(root), 1)
            self.assertFalse(partial.exists())
            self.assertTrue(unrelated.exists())


if __name__ == "__main__":
    unittest.main()
