from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "workers" / "whisperx"))

from chinese_text import (  # noqa: E402
    to_simplified_chinese,
    transcript_segments_to_simplified,
)


@unittest.skipUnless(os.name == "nt", "Win11 NLS conversion is Windows-only")
class ChineseTextTests(unittest.TestCase):
    def test_converts_mixed_traditional_lyrics_to_simplified(self) -> None:
        self.assertEqual(
            to_simplified_chinese("丟掉手錶，電腦煩惱，越跳越瘋，一顆心，一瞬間"),
            "丢掉手表，电脑烦恼，越跳越疯，一颗心，一瞬间",
        )

    def test_keeps_simplified_chinese_and_english_unchanged(self) -> None:
        self.assertEqual(
            to_simplified_chinese("一瞬间烦恼全忘掉 Come on"),
            "一瞬间烦恼全忘掉 Come on",
        )

    def test_copies_segments_without_changing_the_raw_transcript(self) -> None:
        original = [{"start": 1.0, "end": 2.0, "text": " 丟掉手錶"}]

        converted = transcript_segments_to_simplified(original)

        self.assertEqual(converted, [{"start": 1.0, "end": 2.0, "text": " 丢掉手表"}])
        self.assertEqual(original[0]["text"], " 丟掉手錶")


if __name__ == "__main__":
    unittest.main()
