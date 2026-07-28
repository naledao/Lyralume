package com.lyralume.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class RandomPlaybackTest {
    @Test
    fun selectsFromTheEntireLocalTrackList() {
        var requestedBound = -1

        val selectedIndex = randomPlaybackIndex(trackCount = 126) { upperBound ->
            requestedBound = upperBound
            87
        }

        assertEquals(126, requestedBound)
        assertEquals(87, selectedIndex)
    }

    @Test
    fun returnsNullWithoutCallingRandomizerWhenLibraryIsEmpty() {
        var randomizerCalled = false

        val selectedIndex = randomPlaybackIndex(trackCount = 0) {
            randomizerCalled = true
            0
        }

        assertNull(selectedIndex)
        assertFalse(randomizerCalled)
    }
}
