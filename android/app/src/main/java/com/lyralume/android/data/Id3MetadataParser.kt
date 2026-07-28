package com.lyralume.android.data

import com.lyralume.android.model.LyricLine
import java.io.InputStream
import java.nio.charset.Charset

internal data class Id3Metadata(
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val artwork: Id3ArtworkReference? = null,
    val lyrics: List<LyricLine>? = null,
)

internal data class Id3ArtworkReference(
    val offset: Long,
    val length: Long,
    val mimeType: String?,
    val pictureType: Int,
)

/**
 * Reads the small, useful ID3 frames without buffering the complete tag.
 *
 * Album artwork is deliberately represented by its byte range. Some music files contain
 * 20+ MiB APIC frames; retaining those frames just to discover a title can exhaust an Android
 * process and MediaMetadataRetriever may reject the complete tag.
 */
internal object Id3MetadataParser {
    fun parse(source: InputStream): Id3Metadata? {
        val input = PositionInputStream(source)
        val header = input.readExactly(ID3_HEADER_BYTES) ?: return null
        if (String(header, 0, 3, Charsets.US_ASCII) != "ID3") return null

        val version = header[3].toInt() and 0xff
        if (version !in 2..4) return null
        val tagSize = syncSafeInt(header, 6)
        if (tagSize !in 1..MAX_TAG_BYTES) return null
        val tagEnd = ID3_HEADER_BYTES.toLong() + tagSize
        val headerFlags = header[5].toInt() and 0xff
        val globallyUnsynchronised = headerFlags and TAG_UNSYNCHRONISATION != 0

        if (!skipExtendedHeader(input, version, headerFlags, tagEnd)) return null

        var title: String? = null
        var artist: String? = null
        var album: String? = null
        var artwork: Id3ArtworkReference? = null
        val synchronizedLyrics = mutableListOf<SynchronizedLyrics>()
        val unsynchronizedLyrics = mutableListOf<String>()
        val frameHeaderBytes = if (version == 2) V22_FRAME_HEADER_BYTES else FRAME_HEADER_BYTES

        while (input.position + frameHeaderBytes <= tagEnd) {
            val frameHeader = input.readExactly(frameHeaderBytes) ?: break
            if (frameHeader.all { it == 0.toByte() }) break

            val idLength = if (version == 2) 3 else 4
            val id = String(frameHeader, 0, idLength, Charsets.US_ASCII)
            if (!id.all { it in 'A'..'Z' || it in '0'..'9' }) break
            val frameSize = when (version) {
                2 -> bigEndian24(frameHeader, 3)
                4 -> syncSafeInt(frameHeader, 4)
                else -> bigEndianInt(frameHeader, 4)
            }
            if (frameSize <= 0) break

            val payloadStart = input.position
            val payloadEnd = payloadStart + frameSize
            if (payloadEnd > tagEnd) break

            val formatFlags = if (version == 2) 0 else frameHeader[9].toInt() and 0xff
            val unsupportedFormat = when (version) {
                3 -> formatFlags and 0xE0 != 0 // compression, encryption or grouping
                4 -> formatFlags and 0x4D != 0 // grouping, compression, encryption or data length
                else -> false
            }
            val frameUnsynchronised = version == 4 && formatFlags and 0x02 != 0

            if (!unsupportedFormat) {
                when (id) {
                    "TIT2", "TT2" -> if (title == null) {
                        title = readTextFrame(input, frameSize, globallyUnsynchronised || frameUnsynchronised)
                    }
                    "TPE1", "TP1" -> if (artist == null) {
                        artist = readTextFrame(input, frameSize, globallyUnsynchronised || frameUnsynchronised)
                    }
                    "TALB", "TAL" -> if (album == null) {
                        album = readTextFrame(input, frameSize, globallyUnsynchronised || frameUnsynchronised)
                    }
                    "APIC", "PIC" -> {
                        val candidate = readArtworkReference(
                            input = input,
                            frameId = id,
                            payloadEnd = payloadEnd,
                            canExposeRawBytes = !globallyUnsynchronised && !frameUnsynchronised,
                        )
                        if (candidate != null && (artwork == null || candidate.pictureType == FRONT_COVER_TYPE)) {
                            artwork = candidate
                        }
                    }
                    "SYLT" -> readFramePayload(
                        input,
                        frameSize,
                        globallyUnsynchronised || frameUnsynchronised,
                    )?.let(::parseSynchronizedLyrics)?.let(synchronizedLyrics::add)
                    "USLT" -> readFramePayload(
                        input,
                        frameSize,
                        globallyUnsynchronised || frameUnsynchronised,
                    )?.let(::parseUnsynchronizedLyrics)?.let(unsynchronizedLyrics::add)
                }
            }

            val remaining = payloadEnd - input.position
            if (remaining < 0 || !input.skipExactly(remaining)) break
        }

        return Id3Metadata(
            title = title?.takeIf(String::isNotBlank),
            artist = artist?.takeIf(String::isNotBlank),
            album = album?.takeIf(String::isNotBlank),
            artwork = artwork,
            lyrics = selectLyrics(synchronizedLyrics, unsynchronizedLyrics),
        )
    }

    private fun readTextFrame(
        input: PositionInputStream,
        frameSize: Int,
        removeUnsynchronisation: Boolean,
    ): String? {
        if (frameSize !in 2..MAX_TEXT_FRAME_BYTES) return null
        var payload = input.readExactly(frameSize) ?: return null
        if (removeUnsynchronisation) payload = removeUnsynchronisation(payload)
        val encoding = payload[0].toInt() and 0xff
        if (encoding !in 0..3) return null
        val value = decode(payload.copyOfRange(1, payload.size), encoding)
        return value
            .split('\u0000')
            .map(String::trim)
            .filter(String::isNotBlank)
            .joinToString(" / ")
            .takeIf(String::isNotBlank)
    }

    private fun readFramePayload(
        input: PositionInputStream,
        frameSize: Int,
        removeUnsynchronisation: Boolean,
    ): ByteArray? {
        if (frameSize !in 1..MAX_LYRICS_FRAME_BYTES) return null
        val payload = input.readExactly(frameSize) ?: return null
        return if (removeUnsynchronisation) removeUnsynchronisation(payload) else payload
    }

    private fun parseSynchronizedLyrics(frame: ByteArray): SynchronizedLyrics? {
        if (frame.size < 7) return null
        val encoding = frame[0].toInt() and 0xff
        val timestampFormat = frame[4].toInt() and 0xff
        if (encoding !in 0..3 || timestampFormat != 2) return null
        val descriptor = readTerminated(frame, 6, encoding, null)
        var position = descriptor.nextOffset
        val lines = mutableListOf<LyricLine>()
        while (position < frame.size) {
            val decoded = readTerminated(frame, position, encoding, descriptor.utf16Charset)
            position = decoded.nextOffset
            if (position + 4 > frame.size) break
            val timestamp = bigEndianInt(frame, position).toLong() and 0xffffffffL
            position += 4
            decoded.text.trim().ifBlank { "♪" }.let { lines += LyricLine(timestamp, it) }
        }
        return SynchronizedLyrics(descriptor.text.trim(), lines.sortedBy(LyricLine::timestampMs))
    }

    private fun parseUnsynchronizedLyrics(frame: ByteArray): String? {
        if (frame.size < 5) return null
        val encoding = frame[0].toInt() and 0xff
        if (encoding !in 0..3) return null
        val descriptor = readTerminated(frame, 4, encoding, null)
        return decode(frame.copyOfRange(descriptor.nextOffset, frame.size), encoding, descriptor.utf16Charset)
            .trimEnd('\u0000')
            .takeIf(String::isNotBlank)
    }

    private fun selectLyrics(
        synchronized: List<SynchronizedLyrics>,
        unsynchronized: List<String>,
    ): List<LyricLine>? {
        synchronized
            .filter { it.lines.isNotEmpty() }
            .minWithOrNull(
                compareBy<SynchronizedLyrics> {
                    PREFERRED_LYRICS_DESCRIPTORS.indexOf(it.descriptor)
                        .takeIf { index -> index >= 0 } ?: Int.MAX_VALUE
                }.thenByDescending { it.lines.size },
            )
            ?.lines
            ?.let { return it }
        return unsynchronized.asSequence()
            .map(LrcParser::parse)
            .firstOrNull(List<LyricLine>::isNotEmpty)
    }

    private fun readTerminated(
        bytes: ByteArray,
        start: Int,
        encoding: Int,
        fallbackUtf16: Charset?,
    ): DecodedString {
        if (start >= bytes.size) return DecodedString("", bytes.size, fallbackUtf16)
        val width = if (encoding == 1 || encoding == 2) 2 else 1
        var end = start
        while (end + width - 1 < bytes.size) {
            val terminated = if (width == 1) bytes[end] == 0.toByte()
            else bytes[end] == 0.toByte() && bytes[end + 1] == 0.toByte()
            if (terminated) break
            end += width
        }
        val content = bytes.copyOfRange(start, end.coerceAtMost(bytes.size))
        val charset = utf16Charset(content, encoding) ?: fallbackUtf16
        return DecodedString(
            text = decode(content, encoding, charset),
            nextOffset = (end + width).coerceAtMost(bytes.size),
            utf16Charset = charset,
        )
    }

    private fun readArtworkReference(
        input: PositionInputStream,
        frameId: String,
        payloadEnd: Long,
        canExposeRawBytes: Boolean,
    ): Id3ArtworkReference? {
        val encoding = input.read()
        if (encoding !in 0..3) return null

        val mimeType = if (frameId == "PIC") {
            val imageFormat = input.readExactly(3) ?: return null
            when (String(imageFormat, Charsets.US_ASCII).uppercase()) {
                "PNG" -> "image/png"
                "JPG", "JPEG" -> "image/jpeg"
                else -> null
            }
        } else {
            input.readTerminatedLatin1(payloadEnd, MAX_MIME_BYTES)
        }
        val pictureType = input.read()
        if (pictureType < 0) return null
        if (!input.skipEncodedTerminator(payloadEnd, encoding, MAX_DESCRIPTION_BYTES)) return null

        val imageLength = payloadEnd - input.position
        if (!canExposeRawBytes || imageLength !in 1..MAX_ARTWORK_SOURCE_BYTES) return null
        return Id3ArtworkReference(
            offset = input.position,
            length = imageLength,
            mimeType = mimeType,
            pictureType = pictureType,
        )
    }

    private fun skipExtendedHeader(
        input: PositionInputStream,
        version: Int,
        flags: Int,
        tagEnd: Long,
    ): Boolean {
        if (version == 2 || flags and TAG_EXTENDED_HEADER == 0) return true
        val sizeBytes = input.readExactly(4) ?: return false
        val declaredSize = if (version == 4) syncSafeInt(sizeBytes, 0) else bigEndianInt(sizeBytes, 0) + 4
        if (declaredSize < 4 || input.position - 4 + declaredSize > tagEnd) return false
        return input.skipExactly((declaredSize - 4).toLong())
    }

    private fun decode(bytes: ByteArray, encoding: Int, fallbackUtf16: Charset? = null): String {
        if (bytes.isEmpty()) return ""
        val charset: Charset = when (encoding) {
            0 -> Charsets.ISO_8859_1
            1 -> when {
                bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte() -> Charsets.UTF_16LE
                bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte() -> Charsets.UTF_16BE
                else -> fallbackUtf16 ?: Charsets.UTF_16BE
            }
            2 -> Charsets.UTF_16BE
            else -> Charsets.UTF_8
        }
        return String(bytes, charset).trimStart('\uFEFF').trimEnd('\u0000')
    }

    private fun utf16Charset(bytes: ByteArray, encoding: Int): Charset? {
        if (encoding != 1 || bytes.size < 2) return if (encoding == 2) Charsets.UTF_16BE else null
        return when {
            bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte() -> Charsets.UTF_16LE
            bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte() -> Charsets.UTF_16BE
            else -> null
        }
    }

    private fun syncSafeInt(bytes: ByteArray, offset: Int): Int {
        if (offset + 4 > bytes.size) return -1
        return ((bytes[offset].toInt() and 0x7f) shl 21) or
            ((bytes[offset + 1].toInt() and 0x7f) shl 14) or
            ((bytes[offset + 2].toInt() and 0x7f) shl 7) or
            (bytes[offset + 3].toInt() and 0x7f)
    }

    private fun bigEndianInt(bytes: ByteArray, offset: Int): Int {
        if (offset + 4 > bytes.size) return -1
        return ((bytes[offset].toInt() and 0xff) shl 24) or
            ((bytes[offset + 1].toInt() and 0xff) shl 16) or
            ((bytes[offset + 2].toInt() and 0xff) shl 8) or
            (bytes[offset + 3].toInt() and 0xff)
    }

    private fun bigEndian24(bytes: ByteArray, offset: Int): Int {
        if (offset + 3 > bytes.size) return -1
        return ((bytes[offset].toInt() and 0xff) shl 16) or
            ((bytes[offset + 1].toInt() and 0xff) shl 8) or
            (bytes[offset + 2].toInt() and 0xff)
    }

    private fun removeUnsynchronisation(bytes: ByteArray): ByteArray {
        val output = ByteArray(bytes.size)
        var source = 0
        var target = 0
        while (source < bytes.size) {
            output[target++] = bytes[source]
            if (bytes[source] == 0xFF.toByte() && source + 1 < bytes.size && bytes[source + 1] == 0.toByte()) {
                source++
            }
            source++
        }
        return output.copyOf(target)
    }

    private data class SynchronizedLyrics(val descriptor: String, val lines: List<LyricLine>)
    private data class DecodedString(val text: String, val nextOffset: Int, val utf16Charset: Charset?)

    private const val ID3_HEADER_BYTES = 10
    private const val FRAME_HEADER_BYTES = 10
    private const val V22_FRAME_HEADER_BYTES = 6
    private const val MAX_TAG_BYTES = 64 * 1024 * 1024
    private const val MAX_TEXT_FRAME_BYTES = 1024 * 1024
    private const val MAX_LYRICS_FRAME_BYTES = 2 * 1024 * 1024
    private const val MAX_ARTWORK_SOURCE_BYTES = 48L * 1024 * 1024
    private const val MAX_MIME_BYTES = 256
    private const val MAX_DESCRIPTION_BYTES = 16 * 1024
    private const val TAG_UNSYNCHRONISATION = 0x80
    private const val TAG_EXTENDED_HEADER = 0x40
    private const val FRONT_COVER_TYPE = 3
    private val PREFERRED_LYRICS_DESCRIPTORS = listOf(
        "Lyralume / Simplified zh-CN",
        "Lyralume / Bilingual zh-CN",
        "Lyralume / Time Adjusted",
        "Lyralume / LRCLIB",
        "Lyralume / Imported USLT",
    )
}

private class PositionInputStream(private val source: InputStream) : InputStream() {
    var position: Long = 0
        private set

    override fun read(): Int = source.read().also { if (it >= 0) position++ }

    override fun read(bytes: ByteArray, offset: Int, length: Int): Int =
        source.read(bytes, offset, length).also { if (it > 0) position += it }

    override fun skip(byteCount: Long): Long =
        source.skip(byteCount).also { if (it > 0) position += it }

    fun readExactly(count: Int): ByteArray? {
        if (count < 0) return null
        val output = ByteArray(count)
        var offset = 0
        while (offset < count) {
            val read = read(output, offset, count - offset)
            if (read < 0) return null
            offset += read
        }
        return output
    }

    fun skipExactly(byteCount: Long): Boolean {
        var remaining = byteCount
        while (remaining > 0) {
            val skipped = skip(remaining)
            if (skipped > 0) {
                remaining -= skipped
            } else if (read() >= 0) {
                remaining--
            } else {
                return false
            }
        }
        return true
    }

    fun readTerminatedLatin1(limit: Long, maxBytes: Int): String? {
        val output = ArrayList<Byte>(minOf(maxBytes, 32))
        while (position < limit && output.size <= maxBytes) {
            val value = read()
            if (value < 0) return null
            if (value == 0) return output.toByteArray().toString(Charsets.ISO_8859_1)
            output += value.toByte()
        }
        return null
    }

    fun skipEncodedTerminator(limit: Long, encoding: Int, maxBytes: Int): Boolean {
        val width = if (encoding == 1 || encoding == 2) 2 else 1
        var consumed = 0
        while (position + width <= limit && consumed <= maxBytes) {
            val first = read()
            if (first < 0) return false
            consumed++
            if (width == 1) {
                if (first == 0) return true
            } else {
                val second = read()
                if (second < 0) return false
                consumed++
                if (first == 0 && second == 0) return true
            }
        }
        return false
    }
}
