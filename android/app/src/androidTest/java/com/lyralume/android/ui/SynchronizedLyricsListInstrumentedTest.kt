package com.lyralume.android.ui

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test

class SynchronizedLyricsListInstrumentedTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun keepsTheCurrentAndFollowingLyricsInsideTheViewport() {
        composeRule.setContent {
            val groups = remember {
                listOf(
                    LyricDisplayGroup(0, listOf("intro")),
                    LyricDisplayGroup(1, listOf("opening")),
                    tallGroup(2),
                    tallGroup(3),
                    LyricDisplayGroup(4, listOf("current-original", "current-translation")),
                    LyricDisplayGroup(5, listOf("next-original", "next-translation")),
                    LyricDisplayGroup(6, listOf("later")),
                )
            }
            MaterialTheme {
                SynchronizedLyricsList(
                    lyricGroups = groups,
                    activeGroup = 4,
                    listState = rememberLazyListState(),
                    onSeek = {},
                    modifier = Modifier.width(300.dp).height(320.dp),
                )
            }
        }

        composeRule.waitForIdle()
        composeRule.onNodeWithText("current-original").assertIsDisplayed()
        composeRule.onNodeWithText("next-original").assertIsDisplayed()
    }

    private fun tallGroup(index: Int) = LyricDisplayGroup(
        timestampMs = index.toLong(),
        lines = listOf(
            "long original line $index ".repeat(8),
            "很长的双语歌词第 $index 行".repeat(8),
        ),
    )
}
