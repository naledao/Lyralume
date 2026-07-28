package com.lyralume.android.data

import com.lyralume.android.model.LocalTrack
import com.lyralume.android.model.RemoteTrack

internal object DownloadQueuePlanner {
    fun missingTracks(
        remoteTracks: List<RemoteTrack>,
        localTracks: List<LocalTrack>,
    ): List<RemoteTrack> = missingTracksForFiles(
        remoteTracks = remoteTracks,
        localFiles = localTracks.map { DownloadedFile(it.fileName, it.fileSize) },
    )

    fun missingTracksForFiles(
        remoteTracks: List<RemoteTrack>,
        localFiles: List<DownloadedFile>,
    ): List<RemoteTrack> {
        val knownFiles = localFiles
            .mapTo(mutableSetOf()) { TrackFileIdentity(it.fileName, it.fileSize) }
        return remoteTracks.filter { track ->
            knownFiles.add(TrackFileIdentity(track.fileName, track.fileSize))
        }
    }

    private data class TrackFileIdentity(val fileName: String, val fileSize: Long)
}

internal data class DownloadedFile(val fileName: String, val fileSize: Long)
