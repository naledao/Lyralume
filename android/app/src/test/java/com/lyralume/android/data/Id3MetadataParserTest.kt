package com.lyralume.android.data

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.io.SequenceInputStream
import java.nio.ByteBuffer
import java.util.Collections
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test

class Id3MetadataParserTest {
    @Test
    fun `reads text after a twenty MiB artwork frame without buffering the artwork`() {
        val artworkBytes = 20 * 1024 * 1024
        val artworkPrefix = byteArrayOf(0) +
            "image/png".toByteArray(Charsets.ISO_8859_1) +
            byteArrayOf(0, 3, 0)
        val title = textFrame("TIT2", "Dehors")
        val artist = textFrame("TPE1", "曾舜晞")
        val album = textFrame("TALB", "Dehors")
        val artworkHeader = frameHeader("APIC", artworkPrefix.size + artworkBytes)
        val tagSize = artworkHeader.size + artworkPrefix.size + artworkBytes +
            title.size + artist.size + album.size
        val streams = listOf(
            ByteArrayInputStream(id3Header(tagSize)),
            ByteArrayInputStream(artworkHeader),
            ByteArrayInputStream(artworkPrefix),
            RepeatedByteInputStream(artworkBytes.toLong()),
            ByteArrayInputStream(title),
            ByteArrayInputStream(artist),
            ByteArrayInputStream(album),
        )

        val metadata = SequenceInputStream(Collections.enumeration(streams)).use(Id3MetadataParser::parse)

        assertNotNull(metadata)
        assertEquals("Dehors", metadata?.title)
        assertEquals("曾舜晞", metadata?.artist)
        assertEquals("Dehors", metadata?.album)
        assertEquals(artworkBytes.toLong(), metadata?.artwork?.length)
        assertEquals((10 + artworkHeader.size + artworkPrefix.size).toLong(), metadata?.artwork?.offset)
        assertEquals("image/png", metadata?.artwork?.mimeType)
        assertEquals(3, metadata?.artwork?.pictureType)
    }

    @Test
    fun `reads metadata from the optional real desktop MP3`() {
        val file = System.getenv("LYRALUME_TEST_AUDIO_FILE")?.let(::File)
        assumeTrue(file?.isFile == true)

        val metadata = file!!.inputStream().use(Id3MetadataParser::parse)

        assertEquals("Dehors", metadata?.title)
        assertEquals("曾舜晞", metadata?.artist)
        assertEquals("Dehors", metadata?.album)
        assertNotNull(metadata?.artwork)
    }

    private fun textFrame(id: String, value: String): ByteArray {
        val payload = byteArrayOf(1, 0xFF.toByte(), 0xFE.toByte()) + value.toByteArray(Charsets.UTF_16LE)
        return frameHeader(id, payload.size) + payload
    }

    private fun frameHeader(id: String, size: Int): ByteArray =
        id.toByteArray(Charsets.US_ASCII) + ByteBuffer.allocate(4).putInt(size).array() + byteArrayOf(0, 0)

    private fun id3Header(size: Int): ByteArray =
        byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 3, 0, 0) + syncSafe(size)

    private fun syncSafe(value: Int): ByteArray = byteArrayOf(
        ((value ushr 21) and 0x7f).toByte(),
        ((value ushr 14) and 0x7f).toByte(),
        ((value ushr 7) and 0x7f).toByte(),
        (value and 0x7f).toByte(),
    )
}

private class RepeatedByteInputStream(byteCount: Long) : InputStream() {
    private var remaining = byteCount

    override fun read(): Int {
        if (remaining <= 0) return -1
        remaining--
        return 0x5A
    }

    override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
        if (remaining <= 0) return -1
        val count = minOf(length.toLong(), remaining).toInt()
        bytes.fill(0x5A.toByte(), offset, offset + count)
        remaining -= count
        return count
    }

    override fun skip(byteCount: Long): Long {
        val count = minOf(byteCount, remaining)
        remaining -= count
        return count
    }
}
