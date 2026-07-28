package com.lyralume.android.model

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackModeTest {
    @Test
    fun cyclesThroughEveryPlaybackModeInUiOrder() {
        assertEquals(PlaybackMode.SHUFFLE, PlaybackMode.SEQUENTIAL.next())
        assertEquals(PlaybackMode.REPEAT_ONE, PlaybackMode.SHUFFLE.next())
        assertEquals(PlaybackMode.SEQUENTIAL, PlaybackMode.REPEAT_ONE.next())
    }
}
