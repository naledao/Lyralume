package com.lyralume.android.data

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Optional read-only verification against a real MP3 produced by the desktop workflow. */
class LyricsLiveTest {
    @Test
    fun `reads synchronized lyrics from a real desktop library MP3`() {
        val file = System.getenv("LYRALUME_TEST_AUDIO_FILE")?.let(::File)
        assumeTrue(file?.isFile == true)

        val lines = file!!.inputStream().use(Id3LyricsParser::parse)

        assertTrue("真实 MP3 中没有解析出同步歌词", !lines.isNullOrEmpty())
    }
}
