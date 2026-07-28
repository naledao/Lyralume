package com.lyralume.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test

class KeepAliveContentInstrumentedTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun restoresEachTabsIndependentSaveableState() {
        compose.setContent {
            var activeTab by remember { mutableStateOf("local") }
            val stateHolder = rememberSaveableStateHolder()
            MaterialTheme {
                Column {
                    Button(
                        onClick = { activeTab = "local" },
                        modifier = Modifier.testTag("local-tab"),
                    ) { Text("本地") }
                    Button(
                        onClick = { activeTab = "remote" },
                        modifier = Modifier.testTag("remote-tab"),
                    ) { Text("远程") }
                    KeepAliveContent(stateHolder, activeTab) {
                        var counter by rememberSaveable { mutableIntStateOf(0) }
                        Button(
                            onClick = { counter++ },
                            modifier = Modifier.testTag("counter"),
                        ) { Text("$activeTab:$counter") }
                    }
                }
            }
        }

        compose.onNodeWithTag("counter").assertTextEquals("local:0").performClick()
        compose.onNodeWithTag("counter").assertTextEquals("local:1")
        compose.onNodeWithTag("remote-tab").performClick()
        compose.onNodeWithTag("counter").assertTextEquals("remote:0").performClick().performClick()
        compose.onNodeWithTag("counter").assertTextEquals("remote:2")
        compose.onNodeWithTag("local-tab").performClick()
        compose.onNodeWithTag("counter").assertTextEquals("local:1")
        compose.onNodeWithTag("remote-tab").performClick()
        compose.onNodeWithTag("counter").assertTextEquals("remote:2")
    }
}
