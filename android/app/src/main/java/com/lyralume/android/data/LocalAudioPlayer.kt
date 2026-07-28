package com.lyralume.android.data

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.lyralume.android.model.LocalTrack
import com.lyralume.android.model.PlaybackMode
import java.io.File

internal data class AudioPlayerSnapshot(
    val track: LocalTrack? = null,
    val isPreparing: Boolean = false,
    val isPlaying: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val mode: PlaybackMode = PlaybackMode.SEQUENTIAL,
)

/**
 * UI-side controller for [PlaybackService]. Releasing this object only disconnects
 * the UI; the service and its player keep running while playback is active.
 */
@OptIn(UnstableApi::class)
internal class LocalAudioPlayer(
    context: Context,
    private val onStateChanged: (AudioPlayerSnapshot) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val appContext = context.applicationContext
    private val playbackModeStore = PlaybackModeStore(appContext)
    private val pendingActions = ArrayDeque<(MediaController) -> Unit>()
    private var controller: MediaController? = null
    private var released = false
    private var knownTracks: Map<String, LocalTrack> = emptyMap()
    private var lastSnapshot = AudioPlayerSnapshot()

    private val playerListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            publish(player)
        }

        override fun onPlayerError(error: PlaybackException) {
            val cause = generateSequence<Throwable>(error) { it.cause }.last()
            val message = if (cause is SecurityException) {
                "没有权限读取这首歌曲，请重新选择下载目录"
            } else {
                error.localizedMessage?.takeIf(String::isNotBlank) ?: "此音频无法播放"
            }
            onError(message)
        }
    }

    private val controllerListener = object : MediaController.Listener {
        override fun onDisconnected(disconnectedController: MediaController) {
            if (controller === disconnectedController) controller = null
            if (!released) {
                lastSnapshot = lastSnapshot.copy(isPreparing = false, isPlaying = false)
                onStateChanged(lastSnapshot)
            }
        }
    }

    private val controllerFuture: ListenableFuture<MediaController> = MediaController.Builder(
        appContext,
        SessionToken(appContext, ComponentName(appContext, PlaybackService::class.java)),
    )
        .setListener(controllerListener)
        .buildAsync()

    init {
        controllerFuture.addListener(
            {
                if (released) return@addListener
                try {
                    val connected = controllerFuture.get()
                    controller = connected
                    connected.addListener(playerListener)
                    publish(connected)
                    while (pendingActions.isNotEmpty()) {
                        runAction(connected, pendingActions.removeFirst())
                    }
                } catch (error: Throwable) {
                    if (!released) {
                        val cause = error.cause ?: error
                        onError("无法连接后台播放器：${cause.message ?: "未知错误"}")
                    }
                }
            },
            ContextCompat.getMainExecutor(appContext),
        )
    }

    fun play(track: LocalTrack, queue: List<LocalTrack>) {
        val playlist = queue
            .ifEmpty { listOf(track) }
            .let { tracks -> if (tracks.any { it.uri == track.uri }) tracks else tracks + track }
        knownTracks = playlist.associateBy { it.uri.toString() }
        val startIndex = playlist.indexOfFirst { it.uri == track.uri }.coerceAtLeast(0)
        execute { connected ->
            connected.setMediaItems(playlist.map(::toMediaItem), startIndex, 0L)
            connected.prepare()
            connected.play()
        }
    }

    fun toggle() = execute { connected ->
        if (connected.isPlaying) {
            connected.pause()
        } else if (connected.mediaItemCount > 0) {
            if (connected.playbackState == Player.STATE_ENDED) connected.seekToDefaultPosition()
            if (connected.playbackState == Player.STATE_IDLE ||
                connected.playbackState == Player.STATE_ENDED
            ) {
                connected.prepare()
            }
            connected.play()
        }
    }

    fun playPrevious(restartThresholdMs: Long) = execute { connected ->
        if (connected.mediaItemCount == 0) return@execute
        if (connected.currentPosition > restartThresholdMs) {
            connected.seekTo(0L)
        } else {
            val targetIndex = connected.previousMediaItemIndex
                .takeIf { it != C.INDEX_UNSET }
                ?: connected.mediaItemCount - 1
            connected.seekTo(targetIndex, 0L)
        }
        if (connected.playbackState == Player.STATE_IDLE ||
            connected.playbackState == Player.STATE_ENDED
        ) {
            connected.prepare()
        }
        connected.play()
    }

    fun playNext() = execute { connected ->
        if (connected.mediaItemCount == 0) return@execute
        val targetIndex = connected.nextMediaItemIndex
            .takeIf { it != C.INDEX_UNSET }
            ?: 0
        connected.seekTo(targetIndex, 0L)
        if (connected.playbackState == Player.STATE_IDLE ||
            connected.playbackState == Player.STATE_ENDED
        ) {
            connected.prepare()
        }
        connected.play()
    }

    fun setPlaybackMode(mode: PlaybackMode) {
        if (released) return
        playbackModeStore.save(mode)
        execute { connected -> connected.applyPlaybackMode(mode) }
    }

    fun seekTo(positionMs: Long) = execute { connected ->
        val duration = connected.duration.takeIf { it != C.TIME_UNSET && it > 0 }
        connected.seekTo(positionMs.coerceIn(0L, duration ?: Long.MAX_VALUE))
    }

    fun removeTrack(uri: Uri) = execute { connected ->
        val mediaId = uri.toString()
        if (connected.currentMediaItem?.mediaId == mediaId) {
            connected.stop()
            connected.clearMediaItems()
        } else {
            for (index in connected.mediaItemCount - 1 downTo 0) {
                if (connected.getMediaItemAt(index).mediaId == mediaId) {
                    connected.removeMediaItem(index)
                }
            }
        }
        knownTracks = knownTracks - mediaId
    }

    fun snapshot(): AudioPlayerSnapshot = controller?.let(::createSnapshot) ?: lastSnapshot

    /** Used by instrumentation tests to leave no active foreground playback behind. */
    fun stopAndClear() = execute { connected ->
        connected.stop()
        connected.clearMediaItems()
    }

    fun release() {
        if (released) return
        released = true
        pendingActions.clear()
        controller?.removeListener(playerListener)
        controller = null
        MediaController.releaseFuture(controllerFuture)
    }

    private fun execute(action: (MediaController) -> Unit) {
        if (released) return
        val connected = controller
        if (connected == null) pendingActions.addLast(action) else runAction(connected, action)
    }

    private fun runAction(connected: MediaController, action: (MediaController) -> Unit) {
        runCatching {
            action(connected)
            publish(connected)
        }.onFailure { error ->
            onError(error.message?.takeIf(String::isNotBlank) ?: "播放器操作失败")
        }
    }

    private fun publish(player: Player) {
        if (released) return
        lastSnapshot = createSnapshot(player)
        onStateChanged(lastSnapshot)
    }

    private fun createSnapshot(player: Player): AudioPlayerSnapshot {
        val track = player.currentMediaItem?.let(::fromMediaItem)
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it >= 0 }
            ?: track?.durationMs
            ?: 0L
        return AudioPlayerSnapshot(
            track = track,
            isPreparing = player.playbackState == Player.STATE_BUFFERING,
            isPlaying = player.isPlaying,
            positionMs = player.currentPosition.coerceAtLeast(0L),
            durationMs = duration,
            mode = player.playbackMode(),
        )
    }

    private fun toMediaItem(track: LocalTrack): MediaItem {
        val extras = Bundle().apply {
            putString(EXTRA_FILE_NAME, track.fileName)
            putLong(EXTRA_DURATION_MS, track.durationMs)
            putLong(EXTRA_FILE_SIZE, track.fileSize)
            putString(EXTRA_ARTWORK_PATH, track.artworkPath)
            putString(EXTRA_LYRICS_URI, track.lyricsUri?.toString())
        }
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setDurationMs(track.durationMs)
            .setExtras(extras)
            .apply {
                track.artworkPath?.let { setArtworkUri(Uri.fromFile(File(it))) }
            }
            .build()
        return MediaItem.Builder()
            .setMediaId(track.uri.toString())
            .setUri(track.uri)
            .setMediaMetadata(metadata)
            .build()
    }

    private fun fromMediaItem(item: MediaItem): LocalTrack? {
        knownTracks[item.mediaId]?.let { return it }
        val mediaUri = item.mediaId.takeIf(String::isNotBlank)?.let(Uri::parse) ?: return null
        val metadata = item.mediaMetadata
        val extras = metadata.extras
        val fileName = extras?.getString(EXTRA_FILE_NAME)
            ?.takeIf(String::isNotBlank)
            ?: mediaUri.lastPathSegment.orEmpty()
        return LocalTrack(
            uri = mediaUri,
            fileName = fileName,
            title = metadata.title?.toString()?.takeIf(String::isNotBlank)
                ?: fileName.substringBeforeLast('.').ifBlank { "未知歌曲" },
            artist = metadata.artist?.toString()?.takeIf(String::isNotBlank) ?: "未知艺术家",
            album = metadata.albumTitle?.toString()?.takeIf(String::isNotBlank) ?: "未知专辑",
            durationMs = extras?.getLong(EXTRA_DURATION_MS) ?: 0L,
            fileSize = extras?.getLong(EXTRA_FILE_SIZE) ?: 0L,
            artworkPath = extras?.getString(EXTRA_ARTWORK_PATH),
            lyricsUri = extras?.getString(EXTRA_LYRICS_URI)?.let(Uri::parse),
        ).also { knownTracks = knownTracks + (item.mediaId to it) }
    }

    private companion object {
        const val EXTRA_FILE_NAME = "com.lyralume.android.extra.FILE_NAME"
        const val EXTRA_DURATION_MS = "com.lyralume.android.extra.DURATION_MS"
        const val EXTRA_FILE_SIZE = "com.lyralume.android.extra.FILE_SIZE"
        const val EXTRA_ARTWORK_PATH = "com.lyralume.android.extra.ARTWORK_PATH"
        const val EXTRA_LYRICS_URI = "com.lyralume.android.extra.LYRICS_URI"
    }
}
