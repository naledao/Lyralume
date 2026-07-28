package com.lyralume.android.data

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LyricsParserTest {
    @Test
    fun `LRC parser handles offsets fractions and repeated timestamps`() {
        val lines = LrcParser.parse(
            """
                [offset:+120]
                [00:01.20][00:02.345]第一句
                [01:03]第二句
            """.trimIndent(),
        )

        assertEquals(listOf(1_320L, 2_465L, 63_120L), lines.map { it.timestampMs })
        assertEquals(listOf("第一句", "第一句", "第二句"), lines.map { it.text })
    }

    @Test
    fun `ID3 parser reads Kid3 style UTF-16 SYLT lyrics`() {
        val tag = id3v23(
            syltFrame(
                descriptor = "Lyralume / LRCLIB",
                lines = listOf(1_230L to "第一句", 4_560L to "Second line"),
            ),
        )

        val lines = Id3LyricsParser.parse(ByteArrayInputStream(tag))

        assertEquals(listOf(1_230L, 4_560L), lines?.map { it.timestampMs })
        assertEquals(listOf("第一句", "Second line"), lines?.map { it.text })
    }

    @Test
    fun `ID3 parser ignores files without an ID3 tag`() {
        assertNull(Id3LyricsParser.parse(ByteArrayInputStream("not an mp3 tag".toByteArray())))
    }

    private fun syltFrame(descriptor: String, lines: List<Pair<Long, String>>): ByteArray {
        val payload = ByteArrayOutputStream().apply {
            write(1)
            write("eng".toByteArray())
            write(2)
            write(1)
            write(utf16Terminated(descriptor))
            lines.forEach { (timestamp, text) ->
                write(utf16Terminated(text))
                write(ByteBuffer.allocate(4).putInt(timestamp.toInt()).array())
            }
        }.toByteArray()
        return ByteArrayOutputStream().apply {
            write("SYLT".toByteArray())
            write(ByteBuffer.allocate(4).putInt(payload.size).array())
            write(byteArrayOf(0, 0))
            write(payload)
        }.toByteArray()
    }

    private fun id3v23(vararg frames: ByteArray): ByteArray {
        val payload = frames.fold(ByteArray(0)) { result, frame -> result + frame }
        return byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 3, 0, 0) +
            syncSafe(payload.size) + payload
    }

    private fun utf16Terminated(text: String): ByteArray =
        byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + text.toByteArray(Charsets.UTF_16LE) + byteArrayOf(0, 0)

    private fun syncSafe(value: Int): ByteArray = byteArrayOf(
        ((value ushr 21) and 0x7f).toByte(),
        ((value ushr 14) and 0x7f).toByte(),
        ((value ushr 7) and 0x7f).toByte(),
        (value and 0x7f).toByte(),
    )
}
