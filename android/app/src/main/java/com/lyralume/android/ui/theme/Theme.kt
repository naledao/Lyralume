package com.lyralume.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LyralumeColors = lightColorScheme(
    primary = Color(0xFFFF4057),
    onPrimary = Color.White,
    secondary = Color(0xFF6C5CE7),
    onSecondary = Color.White,
    background = Color(0xFFF7F7FA),
    onBackground = Color(0xFF161723),
    surface = Color.White,
    onSurface = Color(0xFF161723),
    surfaceVariant = Color(0xFFEDEEF3),
    onSurfaceVariant = Color(0xFF777985),
    outline = Color(0xFFD9DAE2),
    error = Color(0xFFB3261E),
)

@Composable
fun LyralumeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = LyralumeColors, content = content)
}
