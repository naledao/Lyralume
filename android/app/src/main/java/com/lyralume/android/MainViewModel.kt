package com.lyralume.android

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.lyralume.android.data.AudioPlayerSnapshot
import com.lyralume.android.data.BackgroundDownloadManager
import com.lyralume.android.data.DownloadDirectoryRepository
import com.lyralume.android.data.LocalAudioPlayer
import com.lyralume.android.data.LyricsRepository
import com.lyralume.android.data.MinioMusicRepository
import com.lyralume.android.data.SecureSettingsStore
import com.lyralume.android.model.AppUiState
import com.lyralume.android.model.BatchDownloadState
import com.lyralume.android.model.DownloadState
import com.lyralume.android.model.LocalTrack
import com.lyralume.android.model.LyricsState
import com.lyralume.android.model.MainTab
import com.lyralume.android.model.PlaybackState
import com.lyralume.android.model.RemoteTrack
import com.lyralume.android.model.isActive
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withContext

class MainViewModel(
    context: Context,
    private val settingsStore: SecureSettingsStore,
    private val minio: MinioMusicRepository,
    private val downloads: DownloadDirectoryRepository,
) : ViewModel() {
    private val mutableState = MutableStateFlow(AppUiState(settings = settingsStore.snapshot()))
    val state: StateFlow<AppUiState> = mutableState.asStateFlow()
    private var progressJob: Job? = null
    private var lyricsJob: Job? = null
    private var remoteRefreshJob: Job? = null
    private val backgroundDownloads = BackgroundDownloadManager(context.applicationContext)
    private val lyricsRepository = LyricsRepository(context.applicationContext)
    private val audioPlayer = LocalAudioPlayer(
        context = context.applicationContext,
        onStateChanged = ::onPlayerStateChanged,
        onError = { message -> mutableState.update { it.copy(error = message) } },
    )

    init {
        observeBackgroundDownloads()
        refreshLocal()
        if (mutableState.value.settings.minioConfigured) refreshRemote()
    }

    fun selectTab(tab: MainTab) {
        if (mutableState.value.activeTab == tab) return
        mutableState.update { it.copy(activeTab = tab) }
    }

    fun openSettings() = mutableState.update { it.copy(settingsOpen = true, error = null, message = null) }
    fun closeSettings() = mutableState.update { it.copy(settingsOpen = false, error = null, message = null) }
    fun openNowPlaying() {
        if (mutableState.value.playback.currentTrack != null) {
            mutableState.update { it.copy(nowPlayingOpen = true, error = null, message = null) }
        }
    }
    fun closeNowPlaying() = mutableState.update { it.copy(nowPlayingOpen = false) }
    fun clearFeedback() = mutableState.update { it.copy(error = null, message = null) }

    fun setDownloadDirectory(uri: Uri) {
        if (mutableState.value.batchDownload.isActive) backgroundDownloads.cancel()
        runAction {
            withContext(Dispatchers.IO) { downloads.persistDirectoryPermission(uri) }
            mutableState.update {
                it.copy(settings = settingsStore.snapshot(), message = "下载目录已更新")
            }
            refreshLocal()
        }
    }

    fun saveMinio(endpoint: String, bucket: String, accessKey: String, secretKey: String?) {
        if (mutableState.value.batchDownload.isActive) backgroundDownloads.cancel()
        runAction {
            remoteRefreshJob?.cancelAndJoin()
            remoteRefreshJob = null
            val snapshot = withContext(Dispatchers.IO) {
                settingsStore.saveMinio(endpoint, bucket, accessKey, secretKey)
            }
            mutableState.update {
                it.copy(
                    settings = snapshot,
                    remoteTracks = emptyList(),
                    remoteLoading = false,
                    remoteOnline = false,
                    message = "MinIO 设置已保存",
                )
            }
            refreshRemote()
        }
    }

    fun clearMinio() {
        if (mutableState.value.batchDownload.isActive) backgroundDownloads.cancel()
        remoteRefreshJob?.cancel()
        remoteRefreshJob = null
        viewModelScope.launch { minio.clearCachedTracks() }
        mutableState.update {
            it.copy(
                settings = settingsStore.clearMinio(),
                remoteTracks = emptyList(),
                remoteLoading = false,
                remoteOnline = false,
                message = "MinIO 设置已清除",
                error = null,
            )
        }
    }

    fun testConnection() {
        if (mutableState.value.remoteLoading) return
        val connection = settingsStore.connection()
        if (connection == null) {
            mutableState.update { it.copy(error = "请先保存完整的 MinIO 账号设置") }
            return
        }
        runAction(connection) {
            mutableState.update { it.copy(remoteLoading = true) }
            try {
                minio.testConnection(connection)
                mutableState.update { it.copy(remoteOnline = true, message = "MinIO 连接成功") }
            } finally {
                mutableState.update { it.copy(remoteLoading = false) }
            }
        }
    }

    fun refreshLocal() {
        viewModelScope.launch {
            mutableState.update { it.copy(localLoading = true) }
            runCatching { downloads.scan() }
                .onSuccess { tracks -> mutableState.update { it.copy(localTracks = tracks) } }
                .onFailure { error -> mutableState.update { it.copy(error = error.message ?: "本地音乐扫描失败") } }
            mutableState.update { it.copy(localLoading = false) }
        }
    }

    fun refreshRemote() {
        if (remoteRefreshJob?.isActive == true || mutableState.value.remoteLoading) return
        val connection = settingsStore.connection()
        if (connection == null) {
            mutableState.update {
                it.copy(remoteTracks = emptyList(), remoteLoading = false, remoteOnline = false)
            }
            return
        }
        mutableState.update { it.copy(remoteLoading = true, error = null, message = null) }
        remoteRefreshJob = viewModelScope.launch {
            try {
                if (mutableState.value.remoteTracks.isEmpty()) {
                    val cached = minio.cachedTracks(connection)
                    if (cached.isNotEmpty() && settingsStore.connection() == connection) {
                        mutableState.update { state ->
                            if (state.remoteTracks.isEmpty()) state.copy(remoteTracks = cached) else state
                        }
                    }
                }
                val tracks = minio.listTracks(connection)
                if (settingsStore.connection() == connection) {
                    mutableState.update {
                        it.copy(remoteTracks = tracks, remoteOnline = true, error = null)
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                if (settingsStore.connection() == connection) {
                    mutableState.update {
                        it.copy(remoteOnline = false, error = minio.safeError(error, connection))
                    }
                }
            } finally {
                mutableState.update { it.copy(remoteLoading = false) }
                remoteRefreshJob = null
            }
        }
    }

    fun playOrToggle(track: LocalTrack) {
        mutableState.update { it.copy(error = null, message = null) }
        if (mutableState.value.playback.currentTrack?.uri == track.uri) audioPlayer.toggle()
        else audioPlayer.play(track, mutableState.value.localTracks)
    }

    fun playRandomLocalTrack() {
        val tracks = mutableState.value.localTracks
        val startIndex = randomPlaybackIndex(tracks.size) ?: return
        mutableState.update { it.copy(error = null, message = null) }
        audioPlayer.play(tracks[startIndex], tracks)
    }

    fun togglePlayback() = audioPlayer.toggle()

    fun playPrevious() {
        audioPlayer.playPrevious(RESTART_THRESHOLD_MS)
    }

    fun playNext() = audioPlayer.playNext()

    fun cyclePlaybackMode() {
        audioPlayer.setPlaybackMode(mutableState.value.playback.mode.next())
    }

    fun seekPlayback(positionMs: Long) = audioPlayer.seekTo(positionMs)

    fun deleteLocalTrack(track: LocalTrack) {
        if (mutableState.value.deletingTrackUri != null) return
        if (mutableState.value.localTracks.none { it.uri == track.uri }) {
            mutableState.update { it.copy(error = "这首歌曲已经不在本地列表中") }
            return
        }
        viewModelScope.launch {
            mutableState.update {
                it.copy(deletingTrackUri = track.uri, error = null, message = null)
            }
            try {
                val deletingCurrentTrack = mutableState.value.playback.currentTrack?.uri == track.uri
                audioPlayer.removeTrack(track.uri)
                if (deletingCurrentTrack) {
                    withTimeoutOrNull(PLAYER_RELEASE_TIMEOUT_MS) {
                        state.first { it.playback.currentTrack?.uri != track.uri }
                    }
                }
                val deleted = downloads.deleteSource(track)
                mutableState.update {
                    it.copy(
                        localTracks = it.localTracks.filterNot { local -> local.uri == track.uri },
                        message = if (deleted) {
                            "已永久删除《${track.title}》的音频源文件"
                        } else {
                            "《${track.title}》的源文件已不存在"
                        },
                    )
                }
                refreshLocal()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                mutableState.update {
                    it.copy(error = error.message?.takeIf(String::isNotBlank) ?: "删除源文件失败")
                }
            } finally {
                mutableState.update { it.copy(deletingTrackUri = null) }
            }
        }
    }

    fun download(track: RemoteTrack) {
        val connection = settingsStore.connection()
        if (connection == null) {
            mutableState.update { it.copy(error = "请先配置 MinIO") }
            return
        }
        if (mutableState.value.settings.downloadTreeUri == null) {
            mutableState.update { it.copy(error = "请先在设置中选择下载目录") }
            return
        }
        if (mutableState.value.batchDownload.isActive) {
            mutableState.update { it.copy(message = "一键下载正在后台运行，请等待队列完成") }
            return
        }
        if (mutableState.value.downloads[track.objectName] is DownloadState.Running) return
        mutableState.update {
            it.copy(downloads = it.downloads + (track.objectName to DownloadState.Running(0f)))
        }
        viewModelScope.launch {
            try {
                val uri = downloads.download(connection, track) { progress ->
                    mutableState.update {
                        it.copy(downloads = it.downloads +
                            (track.objectName to DownloadState.Running(progress)))
                    }
                }
                mutableState.update {
                    it.copy(
                        downloads = it.downloads +
                            (track.objectName to DownloadState.Completed(uri)),
                        message = "《${track.title}》下载完成",
                    )
                }
                refreshLocal()
            } catch (error: Throwable) {
                val message = minio.safeError(error, connection)
                mutableState.update {
                    it.copy(
                        downloads = it.downloads +
                            (track.objectName to DownloadState.Failed(message)),
                        error = message,
                    )
                }
            }
        }
    }

    fun downloadMissing() {
        if (!mutableState.value.settings.minioConfigured || settingsStore.connection() == null) {
            mutableState.update { it.copy(error = "请先配置 MinIO") }
            return
        }
        if (mutableState.value.settings.downloadTreeUri == null) {
            mutableState.update { it.copy(error = "请先在设置中选择下载目录") }
            return
        }
        if (mutableState.value.downloads.values.any { it is DownloadState.Running }) {
            mutableState.update { it.copy(message = "请等待当前单曲下载完成后再启动一键下载") }
            return
        }
        if (mutableState.value.batchDownload.isActive) return
        backgroundDownloads.enqueueMissingDownloads()
        mutableState.update {
            it.copy(
                batchDownload = BatchDownloadState.Queued,
                error = null,
                message = "后台下载任务已加入队列",
            )
        }
    }

    fun cancelBackgroundDownloads() {
        if (!mutableState.value.batchDownload.isActive) return
        backgroundDownloads.cancel()
        mutableState.update { it.copy(message = "正在停止后台下载…", error = null) }
    }

    private fun observeBackgroundDownloads() {
        viewModelScope.launch {
            backgroundDownloads.state.collect { nextState ->
                val previousState = mutableState.value.batchDownload
                mutableState.update { it.copy(batchDownload = nextState) }
                if (previousState.isActive && !nextState.isActive) {
                    when (nextState) {
                        is BatchDownloadState.Completed -> mutableState.update {
                            it.copy(
                                message = if (nextState.downloadedCount > 0) {
                                    "后台下载完成：新增 ${nextState.downloadedCount} 首音乐"
                                } else {
                                    "没有需要下载的歌曲"
                                },
                                error = null,
                            )
                        }
                        is BatchDownloadState.Failed -> mutableState.update {
                            it.copy(error = nextState.message, message = null)
                        }
                        BatchDownloadState.Cancelled -> mutableState.update {
                            it.copy(message = "后台下载已停止", error = null)
                        }
                        else -> Unit
                    }
                    refreshLocal()
                }
            }
        }
    }

    private fun runAction(connection: com.lyralume.android.model.MinioConnection? = null, block: suspend () -> Unit) {
        viewModelScope.launch {
            mutableState.update { it.copy(error = null, message = null) }
            try {
                block()
            } catch (error: Throwable) {
                mutableState.update { it.copy(error = minio.safeError(error, connection)) }
            }
        }
    }

    private fun onPlayerStateChanged(snapshot: AudioPlayerSnapshot) {
        val previousTrackUri = mutableState.value.playback.currentTrack?.uri
        mutableState.update {
            it.copy(
                playback = PlaybackState(
                    currentTrack = snapshot.track,
                    isPreparing = snapshot.isPreparing,
                    isPlaying = snapshot.isPlaying,
                    positionMs = snapshot.positionMs,
                    durationMs = snapshot.durationMs,
                    mode = snapshot.mode,
                ),
                nowPlayingOpen = it.nowPlayingOpen && snapshot.track != null,
            )
        }
        if (snapshot.track?.uri != previousTrackUri) loadLyrics(snapshot.track)
        if (snapshot.isPlaying) startProgressUpdates() else stopProgressUpdates()
    }

    private fun loadLyrics(track: LocalTrack?) {
        lyricsJob?.cancel()
        if (track == null) {
            mutableState.update { it.copy(lyrics = LyricsState()) }
            return
        }
        mutableState.update {
            it.copy(lyrics = LyricsState(trackUri = track.uri, isLoading = true))
        }
        lyricsJob = viewModelScope.launch {
            runCatching { lyricsRepository.load(track) }
                .onSuccess { document ->
                    if (mutableState.value.playback.currentTrack?.uri != track.uri) return@onSuccess
                    mutableState.update {
                        it.copy(
                            lyrics = LyricsState(
                                trackUri = track.uri,
                                lines = document?.lines.orEmpty(),
                                source = document?.source,
                                message = if (document == null) {
                                    "未在音频标签或同名 LRC 文件中找到同步歌词"
                                } else null,
                            ),
                        )
                    }
                }
                .onFailure { error ->
                    if (mutableState.value.playback.currentTrack?.uri != track.uri) return@onFailure
                    mutableState.update {
                        it.copy(
                            lyrics = LyricsState(
                                trackUri = track.uri,
                                message = "歌词读取失败：${error.message ?: "未知错误"}",
                            ),
                        )
                    }
                }
        }
    }

    private fun startProgressUpdates() {
        if (progressJob?.isActive == true) return
        progressJob = viewModelScope.launch {
            while (true) {
                delay(PROGRESS_UPDATE_MS)
                val snapshot = audioPlayer.snapshot()
                mutableState.update {
                    it.copy(
                        playback = it.playback.copy(
                            isPlaying = snapshot.isPlaying,
                            positionMs = snapshot.positionMs,
                            durationMs = snapshot.durationMs,
                        ),
                    )
                }
                if (!snapshot.isPlaying) break
            }
        }
    }

    private fun stopProgressUpdates() {
        progressJob?.cancel()
        progressJob = null
    }

    override fun onCleared() {
        stopProgressUpdates()
        lyricsJob?.cancel()
        audioPlayer.release()
        super.onCleared()
    }

    class Factory(private val context: Context) : ViewModelProvider.Factory {
        private val settings = SecureSettingsStore(context.applicationContext)
        private val minio = MinioMusicRepository(context.applicationContext)
        private val downloads = DownloadDirectoryRepository(context.applicationContext, settings, minio)

        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            check(modelClass.isAssignableFrom(MainViewModel::class.java))
            return MainViewModel(context.applicationContext, settings, minio, downloads) as T
        }
    }

    private companion object {
        const val PROGRESS_UPDATE_MS = 250L
        const val RESTART_THRESHOLD_MS = 3_000L
        const val PLAYER_RELEASE_TIMEOUT_MS = 2_000L
    }
}
