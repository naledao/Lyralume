"""Chinese script normalization for the Win11 WhisperX worker."""

from __future__ import annotations

import ctypes
import os
from ctypes import wintypes
from typing import Any

LCMAP_SIMPLIFIED_CHINESE = 0x02000000


def _load_lcmap_string_ex():
    if os.name != "nt":
        return None
    function = ctypes.WinDLL("kernel32", use_last_error=True).LCMapStringEx
    function.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.LPCWSTR,
        ctypes.c_int,
        wintypes.LPWSTR,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.LPARAM,
    ]
    function.restype = ctypes.c_int
    return function


_LCMAP_STRING_EX = _load_lcmap_string_ex()


def to_simplified_chinese(text: str) -> str:
    """Convert Chinese text to simplified script using the Win11 NLS tables."""
    if not isinstance(text, str):
        raise TypeError("Chinese text must be a string")
    if not text:
        return text
    if _LCMAP_STRING_EX is None:
        raise RuntimeError("Simplified Chinese conversion requires Windows")

    required = _LCMAP_STRING_EX(
        "zh-CN",
        LCMAP_SIMPLIFIED_CHINESE,
        text,
        len(text),
        None,
        0,
        None,
        None,
        0,
    )
    if required == 0:
        raise ctypes.WinError(ctypes.get_last_error())

    destination = ctypes.create_unicode_buffer(required)
    written = _LCMAP_STRING_EX(
        "zh-CN",
        LCMAP_SIMPLIFIED_CHINESE,
        text,
        len(text),
        destination,
        required,
        None,
        None,
        0,
    )
    if written == 0:
        raise ctypes.WinError(ctypes.get_last_error())
    return destination[:written].rstrip("\x00")


def transcript_segments_to_simplified(segments: Any) -> list[dict[str, Any]]:
    """Copy Whisper segments while converting only their recognized text."""
    if not isinstance(segments, list):
        raise ValueError("WhisperX transcript segments must be a list")

    converted: list[dict[str, Any]] = []
    for segment in segments:
        if not isinstance(segment, dict) or not isinstance(segment.get("text"), str):
            raise ValueError("WhisperX transcript segment text must be a string")
        converted.append({
            **segment,
            "text": to_simplified_chinese(segment["text"]),
        })
    return converted
