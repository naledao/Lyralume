package com.lyralume.android.data

import com.lyralume.android.model.RemoteTrack
import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadQueuePlannerTest {
    @Test
    fun `keeps remote order and only queues files not already downloaded`() {
        val remote = listOf(
            remoteTrack("one.mp3", 100),
            remoteTrack("two.flac", 200),
            remoteTrack("three.m4a", 300),
        )
        val local = listOf(DownloadedFile("two.flac", 200))

        val missing = DownloadQueuePlanner.missingTracksForFiles(remote, local)

        assertEquals(listOf("one.mp3", "three.m4a"), missing.map(RemoteTrack::fileName))
    }

    @Test
    fun `queues a same-name file when its size changed and removes remote duplicates`() {
        val remote = listOf(
            remoteTrack("song.flac", 101, objectName = "remote/first"),
            remoteTrack("song.flac", 101, objectName = "remote/duplicate"),
        )
        val local = listOf(DownloadedFile("song.flac", 100))

        val missing = DownloadQueuePlanner.missingTracksForFiles(remote, local)

        assertEquals(listOf("remote/first"), missing.map(RemoteTrack::objectName))
    }

    private fun remoteTrack(
        fileName: String,
        fileSize: Long,
        objectName: String = "remote/$fileName",
    ) = RemoteTrack(
        syncId = objectName,
        objectName = objectName,
        fileName = fileName,
        title = fileName.substringBeforeLast('.'),
        artist = "artist",
        album = "album",
        durationMs = 1_000,
        fileSize = fileSize,
        lastModified = 1,
        etag = "etag",
        sha256 = null,
    )

}
