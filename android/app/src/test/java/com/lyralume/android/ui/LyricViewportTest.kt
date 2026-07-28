package com.lyralume.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class LyricViewportTest {
    @Test
    fun placesCurrentLyricAtThirtyPercentOfViewport() {
        assertEquals(300, lyricFocusOffsetPx(1_000))
        assertEquals(216, lyricFocusOffsetPx(720))
    }

    @Test
    fun handlesAnUnmeasuredViewport() {
        assertEquals(0, lyricFocusOffsetPx(0))
        assertEquals(0, lyricFocusOffsetPx(-1))
    }
}
