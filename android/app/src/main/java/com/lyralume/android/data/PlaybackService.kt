package com.lyralume.android.data

import android.app.PendingIntent
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.lyralume.android.MainActivity
import com.lyralume.android.R

/**
 * Owns playback independently from the activity. MediaSessionService publishes a
 * standard MediaStyle notification, which HyperOS 3 promotes to Xiaomi Super Island.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var mediaSession: MediaSession? = null
    private lateinit var playbackModeStore: PlaybackModeStore
    private val playbackModeListener = object : Player.Listener {
        override fun onRepeatModeChanged(repeatMode: Int) {
            persistPlaybackMode()
        }

        override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
            persistPlaybackMode()
        }
    }

    override fun onCreate() {
        super.onCreate()

        val player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .build()
        playbackModeStore = PlaybackModeStore(this)
        player.applyPlaybackMode(playbackModeStore.load())
        player.addListener(playbackModeListener)

        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(openApp)
            .build()

        val notificationProvider = DefaultMediaNotificationProvider.Builder(this)
            .setChannelId(PLAYBACK_CHANNEL_ID)
            .setChannelName(R.string.playback_notification_channel_name)
            .build()
        notificationProvider.setSmallIcon(R.drawable.ic_music_notification)
        setMediaNotificationProvider(notificationProvider)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        mediaSession

    override fun onDestroy() {
        mediaSession?.let { session ->
            session.player.removeListener(playbackModeListener)
            session.player.release()
            session.release()
        }
        mediaSession = null
        super.onDestroy()
    }

    private fun persistPlaybackMode() {
        mediaSession?.player?.let { playbackModeStore.save(it.playbackMode()) }
    }

    private companion object {
        const val PLAYBACK_CHANNEL_ID = "lyralume_music_playback"
    }
}
