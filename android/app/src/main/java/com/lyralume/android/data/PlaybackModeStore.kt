package com.lyralume.android.data

import android.content.Context
import androidx.media3.common.Player
import com.lyralume.android.model.PlaybackMode

internal class PlaybackModeStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun load(): PlaybackMode = preferences.getString(KEY_MODE, null)
        ?.let { stored -> PlaybackMode.entries.firstOrNull { it.name == stored } }
        ?: PlaybackMode.SEQUENTIAL

    fun save(mode: PlaybackMode) {
        preferences.edit().putString(KEY_MODE, mode.name).apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "lyralume_playback"
        const val KEY_MODE = "playback_mode"
    }
}

internal fun Player.applyPlaybackMode(mode: PlaybackMode) {
    when (mode) {
        PlaybackMode.SEQUENTIAL -> {
            shuffleModeEnabled = false
            repeatMode = Player.REPEAT_MODE_ALL
        }
        PlaybackMode.SHUFFLE -> {
            repeatMode = Player.REPEAT_MODE_ALL
            shuffleModeEnabled = true
        }
        PlaybackMode.REPEAT_ONE -> {
            repeatMode = Player.REPEAT_MODE_ONE
            shuffleModeEnabled = false
        }
    }
}

internal fun Player.playbackMode(): PlaybackMode = when {
    repeatMode == Player.REPEAT_MODE_ONE -> PlaybackMode.REPEAT_ONE
    shuffleModeEnabled -> PlaybackMode.SHUFFLE
    else -> PlaybackMode.SEQUENTIAL
}
