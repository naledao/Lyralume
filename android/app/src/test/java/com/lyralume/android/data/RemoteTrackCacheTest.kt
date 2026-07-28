package com.lyralume.android.data

import com.lyralume.android.model.MinioConnection
import com.lyralume.android.model.RemoteTrack
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RemoteTrackCacheTest {
    @Test
    fun `persists remote tracks without storing MinIO credentials`() {
        val directory = Files.createTempDirectory("lyralume-remote-cache").toFile()
        try {
            val cache = FileRemoteTrackCache(directory)
            val connection = MinioConnection(
                endpoint = "https://minio.example.test",
                bucket = "music",
                accessKey = "access-key",
                secretKey = "secret-that-must-not-be-cached",
            )
            val tracks = listOf(remoteTrack())

            cache.save(connection, tracks)

            assertEquals(tracks, cache.load(connection))
            val cacheBytes = directory.listFiles().orEmpty().single().readBytes().decodeToString()
            assertFalse(cacheBytes.contains(connection.accessKey))
            assertFalse(cacheBytes.contains(connection.secretKey))
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun `isolates cached tracks by endpoint bucket and access key`() {
        val directory = Files.createTempDirectory("lyralume-remote-cache").toFile()
        try {
            val cache = FileRemoteTrackCache(directory)
            val connection = MinioConnection("https://one.example.test", "music", "alice", "secret")
            cache.save(connection, listOf(remoteTrack()))

            assertEquals(
                emptyList<RemoteTrack>(),
                cache.load(connection.copy(endpoint = "https://two.example.test")),
            )
            assertEquals(
                emptyList<RemoteTrack>(),
                cache.load(connection.copy(bucket = "other")),
            )
            assertEquals(
                emptyList<RemoteTrack>(),
                cache.load(connection.copy(accessKey = "bob")),
            )
        } finally {
            directory.deleteRecursively()
        }
    }

    private fun remoteTrack() = RemoteTrack(
        syncId = "00000000-0000-0000-0000-000000000001",
        objectName = "lyralume/v1/tracks/00000000-0000-0000-0000-000000000001/song.flac",
        fileName = "song.flac",
        title = "Song",
        artist = "Artist",
        album = "Album",
        durationMs = 123_000,
        fileSize = 4_096,
        lastModified = 1_784_583_784_000,
        etag = "etag-1",
        sha256 = "a".repeat(64),
    )
}
