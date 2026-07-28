package com.lyralume.android.data

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteMetadataParserTest {
    @Test
    fun `decodes desktop metadata and duration`() {
        val encode = { value: String ->
            Base64.getUrlEncoder().withoutPadding().encodeToString(value.toByteArray())
        }
        val track = RemoteMetadataParser.parse(
            objectName = "lyralume/v1/tracks/7d0a144f-5dd1-4501-a213-2299ce0c07f4/audio.flac",
            size = 42,
            lastModified = 100,
            etag = "etag",
            metadata = mapOf(
                "lyralume-title" to encode("中文歌曲"),
                "lyralume-artist" to encode("歌手"),
                "lyralume-album" to encode("专辑"),
                "lyralume-file-name" to encode("中文歌曲.flac"),
                "lyralume-duration" to "183.25",
                "lyralume-sha256" to "a".repeat(64),
            ),
        )

        requireNotNull(track)
        assertEquals("中文歌曲", track.title)
        assertEquals("歌手", track.artist)
        assertEquals("中文歌曲.flac", track.fileName)
        assertEquals(183_250, track.durationMs)
        assertEquals("a".repeat(64), track.sha256)
    }

    @Test
    fun `ignores objects outside the Lyralume schema`() {
        assertNull(
            RemoteMetadataParser.parse(
                objectName = "unmanaged/song.mp3",
                size = 1,
                lastModified = 1,
                etag = "etag",
                metadata = emptyMap(),
            ),
        )
    }
}
