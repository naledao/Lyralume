package com.lyralume.android

import kotlin.random.Random

internal fun randomPlaybackIndex(
    trackCount: Int,
    nextIndex: (Int) -> Int = { upperBound -> Random.nextInt(upperBound) },
): Int? {
    if (trackCount <= 0) return null
    return nextIndex(trackCount).also { index ->
        require(index in 0 until trackCount) {
            "Random playback index $index is outside 0 until $trackCount"
        }
    }
}
