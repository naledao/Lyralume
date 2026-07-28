package com.lyralume.android.model

import android.net.Uri

data class SettingsSnapshot(
    val endpoint: String = "",
    val bucket: String = "",
    val accessKey: String = "",
    val secretConfigured: Boolean = false,
    val downloadTreeUri: Uri? = null,
    val downloadDirectoryName: String? = null,
) {
    val minioConfigured: Boolean
        get() = endpoint.isNotBlank() && bucket.isNotBlank() &&
            accessKey.isNotBlank() && secretConfigured
}

data class MinioConnection(
    val endpoint: String,
    val bucket: String,
    val accessKey: String,
    val secretKey: String,
)

data class RemoteTrack(
    val syncId: String,
    val objectName: String,
    val fileName: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val fileSize: Long,
    val lastModified: Long,
    val etag: String,
    val sha256: String?,
)

data class LocalTrack(
    val uri: Uri,
    val fileName: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val fileSize: Long,
    val artworkPath: String? = null,
    val lyricsUri: Uri? = null,
)

data class LyricLine(
    val timestampMs: Long,
    val text: String,
)

data class LyricsState(
    val trackUri: Uri? = null,
    val isLoading: Boolean = false,
    val lines: List<LyricLine> = emptyList(),
    val source: String? = null,
    val message: String? = null,
)

enum class PlaybackMode {
    SEQUENTIAL,
    SHUFFLE,
    REPEAT_ONE;

    fun next(): PlaybackMode = when (this) {
        SEQUENTIAL -> SHUFFLE
        SHUFFLE -> REPEAT_ONE
        REPEAT_ONE -> SEQUENTIAL
    }
}

data class PlaybackState(
    val currentTrack: LocalTrack? = null,
    val isPreparing: Boolean = false,
    val isPlaying: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val mode: PlaybackMode = PlaybackMode.SEQUENTIAL,
)

sealed interface DownloadState {
    data object Idle : DownloadState
    data class Running(val progress: Float) : DownloadState
    data class Completed(val localUri: Uri) : DownloadState
    data class Failed(val message: String) : DownloadState
}

sealed interface BatchDownloadState {
    data object Idle : BatchDownloadState
    data object Queued : BatchDownloadState
    data class Running(
        val completedCount: Int,
        val totalCount: Int,
        val currentTitle: String?,
        val currentObjectName: String?,
        val currentProgress: Float,
    ) : BatchDownloadState
    data class Completed(
        val downloadedCount: Int,
        val skippedCount: Int,
    ) : BatchDownloadState
    data class Failed(
        val message: String,
        val completedCount: Int,
        val totalCount: Int,
    ) : BatchDownloadState
    data object Cancelled : BatchDownloadState
}

val BatchDownloadState.isActive: Boolean
    get() = this is BatchDownloadState.Queued || this is BatchDownloadState.Running

enum class MainTab { LOCAL, REMOTE }

data class AppUiState(
    val activeTab: MainTab = MainTab.LOCAL,
    val settingsOpen: Boolean = false,
    val nowPlayingOpen: Boolean = false,
    val settings: SettingsSnapshot = SettingsSnapshot(),
    val localTracks: List<LocalTrack> = emptyList(),
    val remoteTracks: List<RemoteTrack> = emptyList(),
    val playback: PlaybackState = PlaybackState(),
    val lyrics: LyricsState = LyricsState(),
    val downloads: Map<String, DownloadState> = emptyMap(),
    val batchDownload: BatchDownloadState = BatchDownloadState.Idle,
    val localLoading: Boolean = false,
    val deletingTrackUri: Uri? = null,
    val remoteLoading: Boolean = false,
    val remoteOnline: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)
