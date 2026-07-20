"""Lyralume WhisperX transcription and alignment worker."""

from __future__ import annotations

import contextlib
import gc
import json
import os
import sys
import traceback
import uuid
from pathlib import Path
from typing import Any

from chinese_text import transcript_segments_to_simplified

PROTOCOL_VERSION = 1
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
PROTOCOL_STREAM = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", buffering=1)
# Native libraries and child tools sometimes bypass redirect_stdout. Redirect
# the process fd while retaining a dedicated duplicate for JSON Lines events.
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


def json_value(value: Any) -> Any:
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"cannot serialize {type(value).__name__}")


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, default=json_value)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def release_gpu(torch_module: Any) -> None:
    gc.collect()
    if torch_module.cuda.is_available():
        torch_module.cuda.empty_cache()


def run(request: dict[str, Any]) -> None:
    task_id = request.get("taskId")
    if not isinstance(task_id, str) or not task_id:
        raise ValueError("taskId is required")
    if request.get("version") != PROTOCOL_VERSION or request.get("action") != "transcribe":
        raise ValueError("unsupported worker request")

    source = require_absolute_path(request, "inputPath")
    transcript_path = require_absolute_path(request, "transcriptPath")
    alignment_path = require_absolute_path(request, "alignmentPath")
    model_directory = require_absolute_path(request, "modelDirectory")
    model_name = request.get("modelName")
    device = request.get("device")
    compute_type = request.get("computeType")
    batch_size = request.get("batchSize")
    language = request.get("language")
    if not source.is_file():
        raise FileNotFoundError(f"vocals file does not exist: {source}")
    if not isinstance(model_name, str) or not model_name:
        raise ValueError("modelName is required")
    if device not in ("cuda", "cpu") or compute_type not in ("float16", "int8"):
        raise ValueError("device or computeType is invalid")
    if not isinstance(batch_size, int) or batch_size < 1 or batch_size > 32:
        raise ValueError("batchSize must be between 1 and 32")
    if language is not None and not isinstance(language, str):
        raise ValueError("language must be a string")
    model_directory.mkdir(parents=True, exist_ok=True)

    emit("progress", task_id, "transcription", progress=0.03, message="正在载入 WhisperX")
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        import whisperx

        audio = whisperx.load_audio(str(source))
        model = whisperx.load_model(
            model_name,
            device,
            compute_type=compute_type,
            language=language,
            download_root=str(model_directory),
        )
        emit("progress", task_id, "transcription", progress=0.18, message="正在转写临时人声")
        transcript = model.transcribe(audio, batch_size=batch_size)
        atomic_json(transcript_path, transcript)
        detected_language = transcript.get("language") or language
        if not isinstance(detected_language, str) or not detected_language:
            raise RuntimeError("WhisperX did not detect a language")
        segments_for_alignment = transcript["segments"]
        alignment_message = "原始转写已保存，正在加载对齐模型"
        if detected_language == "zh":
            segments_for_alignment = transcript_segments_to_simplified(segments_for_alignment)
            alignment_message = "原始转写已保存并转换为简体，正在加载对齐模型"

        del model
        release_gpu(torch)
        emit("progress", task_id, "alignment", progress=0.62, message=alignment_message)
        align_model, metadata = whisperx.load_align_model(
            language_code=detected_language,
            device=device,
            model_dir=str(model_directory),
        )
        aligned = whisperx.align(
            segments_for_alignment,
            align_model,
            metadata,
            audio,
            device,
            return_char_alignments=True,
        )
        aligned["language"] = detected_language
        atomic_json(alignment_path, aligned)
        del align_model
        release_gpu(torch)

    emit("progress", task_id, "alignment", progress=1.0, message="词/字级对齐结果已保存")
    emit(
        "result",
        task_id,
        "alignment",
        outputs={
            "transcriptPath": str(transcript_path),
            "alignmentPath": str(alignment_path),
        },
        language=detected_language,
    )


def main() -> int:
    task_id = "unknown"
    stage = "transcription"
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
            stage,
            code=error.__class__.__name__,
            message=str(error) or "WhisperX worker failed",
            retryable=not isinstance(error, (ValueError, FileNotFoundError)),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
