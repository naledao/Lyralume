package com.lyralume.android.data

import android.content.Context
import com.lyralume.android.model.LocalTrack
import com.lyralume.android.model.LyricLine
import java.io.ByteArrayOutputStream
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal data class LyricsDocument(
    val lines: List<LyricLine>,
    val source: String,
)

internal class LyricsRepository(context: Context) {
    private val appContext = context.applicationContext

    suspend fun load(track: LocalTrack): LyricsDocument? = withContext(Dispatchers.IO) {
        if (track.fileName.substringAfterLast('.', "").equals("mp3", ignoreCase = true)) {
            appContext.contentResolver.openInputStream(track.uri)?.use { input ->
                Id3LyricsParser.parse(input)?.let {
                    return@withContext LyricsDocument(it, "音频内嵌同步歌词")
                }
            }
        }
        track.lyricsUri?.let { uri ->
            appContext.contentResolver.openInputStream(uri)?.use { input ->
                val text = decodeText(input.readLimited(MAX_LYRICS_BYTES))
                LrcParser.parse(text).takeIf(List<LyricLine>::isNotEmpty)?.let {
                    return@withContext LyricsDocument(it, "同名 LRC 文件")
                }
            }
        }
        null
    }

    private fun decodeText(bytes: ByteArray): String = when {
        bytes.startsWith(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())) ->
            String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
        bytes.startsWith(byteArrayOf(0xFF.toByte(), 0xFE.toByte())) ->
            String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
        bytes.startsWith(byteArrayOf(0xFE.toByte(), 0xFF.toByte())) ->
            String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
        else -> String(bytes, Charsets.UTF_8)
    }

    private companion object {
        const val MAX_LYRICS_BYTES = 2 * 1024 * 1024
    }
}

internal object LrcParser {
    private val timestamp = Regex("\\[(\\d{1,3}):(\\d{2})(?:[.:](\\d{1,3}))?]")
    private val offset = Regex("(?im)^\\s*\\[offset:([+-]?\\d+)]")

    fun parse(text: String): List<LyricLine> {
        val offsetMs = offset.find(text)?.groupValues?.get(1)?.toLongOrNull() ?: 0
        return buildList {
            text.lineSequence().forEach { rawLine ->
                val matches = timestamp.findAll(rawLine).toList()
                if (matches.isEmpty()) return@forEach
                val lyricText = rawLine.substring(matches.last().range.last + 1).trim().ifBlank { "♪" }
                matches.forEach { match ->
                    val minutes = match.groupValues[1].toLongOrNull() ?: return@forEach
                    val seconds = match.groupValues[2].toLongOrNull() ?: return@forEach
                    if (seconds >= 60) return@forEach
                    val fraction = match.groupValues[3]
                    val fractionMs = when (fraction.length) {
                        1 -> fraction.toLong() * 100
                        2 -> fraction.toLong() * 10
                        3 -> fraction.toLong()
                        else -> 0
                    }
                    add(
                        LyricLine(
                            timestampMs = (minutes * 60_000 + seconds * 1_000 + fractionMs + offsetMs)
                                .coerceAtLeast(0),
                            text = lyricText,
                        ),
                    )
                }
            }
        }.sortedBy(LyricLine::timestampMs)
    }
}

internal object Id3LyricsParser {
    fun parse(input: InputStream): List<LyricLine>? = Id3MetadataParser.parse(input)?.lyrics
}

private fun InputStream.readLimited(maxBytes: Int): ByteArray {
    val output = ByteArrayOutputStream(minOf(maxBytes, DEFAULT_BUFFER_SIZE))
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var total = 0
    while (true) {
        val count = read(buffer)
        if (count < 0) break
        total += count
        require(total <= maxBytes) { "歌词文件超过安全大小限制" }
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

private fun ByteArray.startsWith(prefix: ByteArray): Boolean =
    size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }
