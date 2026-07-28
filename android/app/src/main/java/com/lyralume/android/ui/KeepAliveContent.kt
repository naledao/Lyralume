package com.lyralume.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.SaveableStateHolder

/** Restores each keyed page's rememberSaveable state when it re-enters composition. */
@Composable
internal fun KeepAliveContent(
    stateHolder: SaveableStateHolder,
    key: String,
    content: @Composable () -> Unit,
) {
    stateHolder.SaveableStateProvider(key, content)
}
