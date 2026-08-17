package com.lyralume.android.ui

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.List as ListIcon
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import com.lyralume.android.MainViewModel
import com.lyralume.android.model.AppUiState
import com.lyralume.android.model.BatchDownloadState
import com.lyralume.android.model.DownloadState
import com.lyralume.android.model.LocalTrack
import com.lyralume.android.model.MainTab
import com.lyralume.android.model.PlaybackMode
import com.lyralume.android.model.RemoteTrack
import com.lyralume.android.model.isActive
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private object LyralumeIcons {
    val Pause: ImageVector by lazy {
        vectorIcon("Pause") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(6f, 5f)
                horizontalLineTo(10f)
                verticalLineTo(19f)
                horizontalLineTo(6f)
                close()
                moveTo(14f, 5f)
                horizontalLineTo(18f)
                verticalLineTo(19f)
                horizontalLineTo(14f)
                close()
            }
        }
    }

    val SkipPrevious: ImageVector by lazy {
        vectorIcon("Skip previous") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(5f, 5f)
                horizontalLineTo(8f)
                verticalLineTo(19f)
                horizontalLineTo(5f)
                close()
                moveTo(19f, 5f)
                verticalLineTo(19f)
                lineTo(9f, 12f)
                close()
            }
        }
    }

    val SkipNext: ImageVector by lazy {
        vectorIcon("Skip next") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(16f, 5f)
                horizontalLineTo(19f)
                verticalLineTo(19f)
                horizontalLineTo(16f)
                close()
                moveTo(5f, 5f)
                lineTo(15f, 12f)
                lineTo(5f, 19f)
                close()
            }
        }
    }

    val Download: ImageVector by lazy {
        vectorIcon("Download") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(10f, 3f)
                horizontalLineTo(14f)
                verticalLineTo(11f)
                horizontalLineTo(18f)
                lineTo(12f, 17f)
                lineTo(6f, 11f)
                horizontalLineTo(10f)
                close()
                moveTo(4f, 19f)
                horizontalLineTo(20f)
                verticalLineTo(21f)
                horizontalLineTo(4f)
                close()
            }
        }
    }

    val Cloud: ImageVector by lazy {
        vectorIcon("Cloud") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(18.5f, 18f)
                horizontalLineTo(6f)
                curveTo(3.79f, 18f, 2f, 16.21f, 2f, 14f)
                curveTo(2f, 11.94f, 3.56f, 10.24f, 5.56f, 10.02f)
                curveTo(6.42f, 7.65f, 8.69f, 6f, 11.35f, 6f)
                curveTo(14.55f, 6f, 17.22f, 8.39f, 17.63f, 11.49f)
                curveTo(19.55f, 11.75f, 21f, 13.38f, 21f, 15.35f)
                curveTo(21f, 16.81f, 19.88f, 18f, 18.5f, 18f)
                close()
            }
        }
    }

    val MusicNote: ImageVector by lazy {
        vectorIcon("Music note") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(10f, 4f)
                horizontalLineTo(19f)
                verticalLineTo(14.5f)
                curveTo(18.45f, 14.18f, 17.76f, 14f, 17f, 14f)
                curveTo(15.34f, 14f, 14f, 15.12f, 14f, 16.5f)
                curveTo(14f, 17.88f, 15.34f, 19f, 17f, 19f)
                curveTo(18.66f, 19f, 20f, 17.88f, 20f, 16.5f)
                verticalLineTo(4f)
                horizontalLineTo(10f)
                verticalLineTo(15.5f)
                curveTo(9.45f, 15.18f, 8.76f, 15f, 8f, 15f)
                curveTo(6.34f, 15f, 5f, 16.12f, 5f, 17.5f)
                curveTo(5f, 18.88f, 6.34f, 20f, 8f, 20f)
                curveTo(9.66f, 20f, 11f, 18.88f, 11f, 17.5f)
                verticalLineTo(8f)
                horizontalLineTo(19f)
                verticalLineTo(6f)
                horizontalLineTo(10f)
                close()
            }
        }
    }

    val Lyrics: ImageVector by lazy {
        vectorIcon("Lyrics") {
            path(
                fill = null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.8f,
            ) {
                moveTo(4f, 5f)
                horizontalLineTo(20f)
                verticalLineTo(19f)
                horizontalLineTo(4f)
                close()
                moveTo(7f, 9f)
                horizontalLineTo(17f)
                moveTo(7f, 13f)
                horizontalLineTo(14f)
                moveTo(7f, 16f)
                horizontalLineTo(12f)
            }
        }
    }
}

private fun vectorIcon(
    name: String,
    block: ImageVector.Builder.() -> Unit,
): ImageVector = ImageVector.Builder(
    name = name,
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
    viewportWidth = 24f,
    viewportHeight = 24f,
).apply(block).build()

@Composable
fun LyralumeApp(viewModel: MainViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    SystemBarsEffect(darkBackground = state.nowPlayingOpen)
    val localListState = rememberLazyListState()
    val remoteListState = rememberLazyListState()
    val tabStateHolder = rememberSaveableStateHolder()
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        // Android 13+ 允许用户隐藏通知；即使拒绝，前台下载任务仍可运行。
        viewModel.downloadMissing()
    }
    val startBackgroundDownloads = {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            viewModel.downloadMissing()
        }
    }
    if (state.settingsOpen) {
        BackHandler { viewModel.closeSettings() }
        SettingsScreen(
            state = state,
            onBack = viewModel::closeSettings,
            onDirectorySelected = viewModel::setDownloadDirectory,
            onSaveMinio = viewModel::saveMinio,
            onTestConnection = viewModel::testConnection,
            onClearMinio = viewModel::clearMinio,
        )
        return
    }
    if (state.nowPlayingOpen) {
        BackHandler { viewModel.closeNowPlaying() }
        NowPlayingScreen(
            state = state,
            onBack = viewModel::closeNowPlaying,
            onToggle = viewModel::togglePlayback,
            onPrevious = viewModel::playPrevious,
            onNext = viewModel::playNext,
            onCyclePlaybackMode = viewModel::cyclePlaybackMode,
            onSeek = viewModel::seekPlayback,
        )
        return
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppHeader(
                state = state,
                onRefresh = {
                    if (state.activeTab == MainTab.LOCAL) viewModel.refreshLocal()
                    else viewModel.refreshRemote()
                },
                onSettings = viewModel::openSettings,
            )
        },
        bottomBar = {
            Column {
                state.playback.currentTrack?.let {
                    MiniPlayer(
                        state = state,
                        onToggle = viewModel::togglePlayback,
                        onPlay = viewModel::playOrToggle,
                        onOpen = viewModel::openNowPlaying,
                    )
                }
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                ) {
                    NavigationBarItem(
                        selected = state.activeTab == MainTab.LOCAL,
                        onClick = { viewModel.selectTab(MainTab.LOCAL) },
                        icon = { Icon(Icons.AutoMirrored.Rounded.ListIcon, contentDescription = null) },
                        label = { Text("本地音乐") },
                    )
                    NavigationBarItem(
                        selected = state.activeTab == MainTab.REMOTE,
                        onClick = { viewModel.selectTab(MainTab.REMOTE) },
                        icon = { Icon(LyralumeIcons.Cloud, contentDescription = null) },
                        label = { Text("远程音乐") },
                    )
                }
            }
        },
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                Feedback(state)
                KeepAliveContent(tabStateHolder, state.activeTab.name) {
                    when (state.activeTab) {
                        MainTab.LOCAL -> LocalMusicScreen(
                            state = state,
                            listState = localListState,
                            onOpenSettings = viewModel::openSettings,
                            onPlayAll = viewModel::playRandomLocalTrack,
                            onPlay = viewModel::playOrToggle,
                            onDelete = viewModel::deleteLocalTrack,
                        )
                        MainTab.REMOTE -> RemoteMusicScreen(
                            state = state,
                            listState = remoteListState,
                            onOpenSettings = viewModel::openSettings,
                            onDownload = viewModel::download,
                            onDownloadAll = startBackgroundDownloads,
                            onCancelDownloads = viewModel::cancelBackgroundDownloads,
                        )
                    }
                }
            }
    }
}

@Composable
private fun SystemBarsEffect(darkBackground: Boolean) {
    val view = LocalView.current
    val activity = LocalContext.current as? Activity
    SideEffect {
        val window = activity?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !darkBackground
            isAppearanceLightNavigationBars = !darkBackground
        }
    }
}

@Composable
private fun AppHeader(state: AppUiState, onRefresh: () -> Unit, onSettings: () -> Unit) {
    val refreshRunning = if (state.activeTab == MainTab.LOCAL) state.localLoading else state.remoteLoading
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.statusBars)
            .padding(start = 20.dp, end = 10.dp, top = 10.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                if (state.activeTab == MainTab.LOCAL) "本地音乐" else "远程音乐",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                if (state.activeTab == MainTab.LOCAL) "设备上的原声音乐" else "Lyralume 云端曲库",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onRefresh, enabled = !refreshRunning) {
            if (refreshRunning) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            } else {
                Icon(Icons.Rounded.Refresh, contentDescription = "刷新")
            }
        }
        IconButton(onClick = onSettings) {
            Icon(Icons.Rounded.Settings, contentDescription = "设置")
        }
    }
}

@Composable
private fun Feedback(state: AppUiState) {
    val text = state.error ?: state.message ?: return
    val isError = state.error != null
    Text(
        text = text,
        color = if (isError) MaterialTheme.colorScheme.error else Color(0xFF226A57),
        modifier = Modifier
            .fillMaxWidth()
            .background(if (isError) Color(0xFFFFEDEA) else Color(0xFFE7F7F1))
            .padding(horizontal = 18.dp, vertical = 10.dp),
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun LocalMusicScreen(
    state: AppUiState,
    listState: LazyListState,
    onOpenSettings: () -> Unit,
    onPlayAll: () -> Unit,
    onPlay: (LocalTrack) -> Unit,
    onDelete: (LocalTrack) -> Unit,
) {
    var deleteCandidate by remember { mutableStateOf<LocalTrack?>(null) }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    val visibleTracks = remember(state.localTracks, searchQuery) {
        state.localTracks.filter { track ->
            matchesLocalTrackSearch(
                query = searchQuery,
                title = track.title,
                artist = track.artist,
                album = track.album,
                fileName = track.fileName,
            )
        }
    }
    deleteCandidate?.let { track ->
        AlertDialog(
            onDismissRequest = { deleteCandidate = null },
            title = { Text("删除音频源文件？") },
            text = {
                Text(
                    buildString {
                        append("将从手机存储中永久删除：\n")
                        append(track.fileName)
                        append("\n\n此操作无法撤销；同名 LRC 歌词文件不会被删除。")
                        if (state.playback.currentTrack?.uri == track.uri) {
                            append("\n\n当前歌曲正在播放，删除前会先停止播放。")
                        }
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteCandidate = null
                        onDelete(track)
                    },
                ) {
                    Text("永久删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteCandidate = null }) { Text("取消") }
            },
        )
    }
    when {
        state.settings.downloadTreeUri == null -> EmptyState(
            symbol = "⌁",
            title = "还没有选择下载目录",
            description = "在设置中选择一个文件夹，下载的远程音乐会保存在那里。",
            action = "选择目录",
            onAction = onOpenSettings,
        )
        state.localLoading && state.localTracks.isEmpty() -> LoadingState("正在扫描下载目录…")
        state.localTracks.isEmpty() -> EmptyState(
            symbol = "♫",
            title = "本地目录还没有音乐",
            description = "前往远程音乐下载歌曲，完成后会自动出现在这里。",
        )
        else -> Column(Modifier.fillMaxSize()) {
            PlayAllHeader(
                trackCount = state.localTracks.size,
                onPlayAll = onPlayAll,
            )
            LocalMusicSearchField(
                query = searchQuery,
                onQueryChange = { searchQuery = it },
                onClear = { searchQuery = "" },
            )
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 14.dp),
            ) {
                state.playback.currentTrack?.let { currentTrack ->
                    item(key = "continue-playback") {
                        ContinuePlaybackRow(
                            track = currentTrack,
                            isPlaying = state.playback.isPlaying,
                            onClick = { onPlay(currentTrack) },
                        )
                    }
                }
                item(key = "local-summary") {
                    Text(
                        state.settings.downloadDirectoryName ?: "已授权目录",
                        modifier = Modifier.padding(start = 20.dp, top = 15.dp, bottom = 6.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                if (visibleTracks.isEmpty()) {
                    item(key = "local-search-empty") {
                        Text(
                            "没有找到匹配的本地音乐",
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 28.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                } else {
                    items(visibleTracks, key = { it.uri.toString() }) { track ->
                        val current = state.playback.currentTrack?.uri == track.uri
                        LocalTrackCard(
                            track = track,
                            isCurrent = current,
                            isPlaying = current && state.playback.isPlaying,
                            isDeleting = state.deletingTrackUri == track.uri,
                            onPlay = { onPlay(track) },
                            onDelete = { deleteCandidate = track },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LocalMusicSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    onClear: () -> Unit,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, bottom = 8.dp),
        placeholder = { Text("搜索歌曲、歌手、专辑或文件名") },
        leadingIcon = {
            Icon(Icons.Rounded.Search, contentDescription = null)
        },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = onClear) {
                    Icon(Icons.Rounded.Close, contentDescription = "清除搜索")
                }
            }
        } else {
            null
        },
        singleLine = true,
        shape = RoundedCornerShape(16.dp),
    )
}

internal fun matchesLocalTrackSearch(
    query: String,
    title: String,
    artist: String,
    album: String,
    fileName: String,
): Boolean {
    val terms = query.trim().split(Regex("\\s+")).filter(String::isNotEmpty)
    if (terms.isEmpty()) return true

    val searchableFields = listOf(title, artist, album, fileName)
    return terms.all { term ->
        searchableFields.any { field -> field.contains(term, ignoreCase = true) }
    }
}

@Composable
private fun PlayAllHeader(
    trackCount: Int,
    onPlayAll: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.primary,
            shape = RoundedCornerShape(50),
            modifier = Modifier.size(56.dp).clickable(onClick = onPlayAll),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Rounded.PlayArrow,
                    contentDescription = "播放全部",
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(34.dp),
                )
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "播放全部",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "$trackCount 首",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun ContinuePlaybackRow(
    track: LocalTrack,
    isPlaying: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFFF1F2F6))
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (isPlaying) LyralumeIcons.Pause else Icons.Rounded.PlayArrow,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(
            "继续播放：",
            fontWeight = FontWeight.Medium,
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            "${track.title} · ${track.artist}",
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun RemoteMusicScreen(
    state: AppUiState,
    listState: LazyListState,
    onOpenSettings: () -> Unit,
    onDownload: (RemoteTrack) -> Unit,
    onDownloadAll: () -> Unit,
    onCancelDownloads: () -> Unit,
) {
    when {
        !state.settings.minioConfigured -> EmptyState(
            symbol = "☁",
            title = "尚未配置 MinIO",
            description = "填写 API、Bucket、用户名和密码后即可浏览远程曲库。",
            action = "前往设置",
            onAction = onOpenSettings,
        )
        state.settings.downloadTreeUri == null -> EmptyState(
            symbol = "⇩",
            title = "请先选择下载目录",
            description = "远程列表可以读取，但下载前需要授权一个本地文件夹。",
            action = "选择目录",
            onAction = onOpenSettings,
        )
        state.remoteLoading && state.remoteTracks.isEmpty() -> LoadingState("正在读取 MinIO 音乐…")
        state.remoteTracks.isEmpty() -> EmptyState(
            symbol = "☁",
            title = "远程曲库为空",
            description = "桌面端同步到 MinIO 的歌曲会显示在这里。",
        )
        else -> LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 14.dp),
        ) {
            item {
                val missingCount = state.remoteTracks.count { remote ->
                    state.localTracks.none {
                        it.fileName == remote.fileName && it.fileSize == remote.fileSize
                    }
                }
                SectionSummary(
                    title = when {
                        state.remoteLoading -> "正在刷新 MinIO"
                        state.remoteOnline -> "MinIO 在线"
                        else -> "MinIO 离线"
                    },
                    detail = "${state.remoteTracks.size} 首远程 · $missingCount 首未下载",
                )
                BatchDownloadControl(
                    batchState = state.batchDownload,
                    missingCount = missingCount,
                    singleDownloadRunning = state.downloads.values.any { it is DownloadState.Running },
                    onStart = onDownloadAll,
                    onCancel = onCancelDownloads,
                )
            }
            items(state.remoteTracks, key = RemoteTrack::objectName) { track ->
                val alreadyDownloaded = state.localTracks.any {
                    it.fileName == track.fileName && it.fileSize == track.fileSize
                }
                RemoteTrackCard(
                    track = track,
                    downloadState = (state.batchDownload as? BatchDownloadState.Running)
                        ?.takeIf { it.currentObjectName == track.objectName }
                        ?.let { DownloadState.Running(it.currentProgress) }
                        ?: state.downloads[track.objectName]
                        ?: DownloadState.Idle,
                    alreadyDownloaded = alreadyDownloaded,
                    batchDownloadActive = state.batchDownload.isActive,
                    onDownload = { onDownload(track) },
                )
            }
        }
    }
}

@Composable
private fun BatchDownloadControl(
    batchState: BatchDownloadState,
    missingCount: Int,
    singleDownloadRunning: Boolean,
    onStart: () -> Unit,
    onCancel: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .shadow(8.dp, RoundedCornerShape(18.dp), ambientColor = Color.Black.copy(alpha = 0.06f)),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text("一键下载", fontWeight = FontWeight.SemiBold)
            val running = batchState as? BatchDownloadState.Running
            Text(
                when {
                    batchState is BatchDownloadState.Queued -> "后台任务已排队，正在等待可用网络…"
                    running != null && running.totalCount <= 0 -> "正在检查本地文件和远程曲库…"
                    running != null -> {
                        val ordinal = (running.completedCount + 1).coerceAtMost(running.totalCount)
                        "正在下载 $ordinal/${running.totalCount}：${running.currentTitle ?: "准备下一首"}"
                    }
                    batchState is BatchDownloadState.Failed -> "上次任务中断，可继续下载剩余歌曲。"
                    batchState is BatchDownloadState.Cancelled -> "后台任务已停止，可随时继续。"
                    missingCount == 0 -> "远程曲库中的歌曲均已下载。"
                    else -> "按列表顺序逐首下载未下载歌曲，切到后台后仍会继续。"
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (running != null) {
                val overallProgress = if (running.totalCount > 0) {
                    ((running.completedCount + running.currentProgress) / running.totalCount)
                        .coerceIn(0f, 1f)
                } else 0f
                LinearProgressIndicator(
                    progress = { overallProgress },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (batchState.isActive) {
                OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
                    Text("停止后台下载")
                }
            } else {
                Button(
                    onClick = onStart,
                    enabled = missingCount > 0 && !singleDownloadRunning,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            missingCount == 0 -> "全部已下载"
                            singleDownloadRunning -> "请等待当前下载完成"
                            else -> "一键下载未下载（$missingCount 首）"
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionSummary(title: String, detail: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun LocalTrackCard(
    track: LocalTrack,
    isCurrent: Boolean,
    isPlaying: Boolean,
    isDeleting: Boolean,
    onPlay: () -> Unit,
    onDelete: () -> Unit,
) {
    MusicCard(
        onClick = onPlay.takeUnless { isDeleting },
        onLongClick = onDelete.takeUnless { isDeleting },
        highlighted = isCurrent,
    ) {
        TrackArtwork(track = track, size = 56.dp)
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontWeight = FontWeight.Medium,
                style = MaterialTheme.typography.titleMedium,
                color = if (isCurrent) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurface,
            )
            Text(
                listOf(track.artist, track.album)
                    .filter { it.isNotBlank() && it != "未知专辑" }
                    .joinToString(" · "),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (isDeleting) {
                Text(
                    "正在删除源文件…",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.labelSmall,
                )
            } else if (isCurrent) {
                Text(
                    if (isPlaying) "正在播放" else "已暂停",
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
        IconButton(onClick = onDelete, enabled = !isDeleting) {
            Icon(
                Icons.Rounded.MoreVert,
                contentDescription = "歌曲操作",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RemoteTrackCard(
    track: RemoteTrack,
    downloadState: DownloadState,
    alreadyDownloaded: Boolean,
    batchDownloadActive: Boolean,
    onDownload: () -> Unit,
) {
    MusicCard {
        ArtworkBadge(LyralumeIcons.Cloud, 56.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontWeight = FontWeight.Medium,
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                listOf(track.artist, track.album)
                    .filter { it.isNotBlank() }
                    .joinToString(" · "),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "${formatSize(track.fileSize)} · ${formatDuration(track.durationMs)}",
                color = Color(0xFF9A9CA7),
                style = MaterialTheme.typography.labelSmall,
            )
            when (downloadState) {
                is DownloadState.Running -> LinearProgressIndicator(
                    progress = { downloadState.progress },
                    modifier = Modifier.fillMaxWidth().padding(top = 7.dp),
                )
                is DownloadState.Failed -> Text(
                    downloadState.message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 2,
                )
                else -> Unit
            }
        }
        Spacer(Modifier.width(6.dp))
        val running = downloadState is DownloadState.Running
        val completed = alreadyDownloaded || downloadState is DownloadState.Completed
        IconButton(
            onClick = onDownload,
            enabled = !running && !completed && !batchDownloadActive,
        ) {
            when {
                completed -> Icon(
                    Icons.Rounded.CheckCircle,
                    contentDescription = "已下载",
                    tint = Color(0xFF4F9A7C),
                )
                running -> Text(
                    "${(downloadState.progress * 100).toInt()}%",
                    style = MaterialTheme.typography.labelSmall,
                )
                else -> Icon(
                    LyralumeIcons.Download,
                    contentDescription = if (downloadState is DownloadState.Failed) "重试下载" else "下载",
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MusicCard(
    onClick: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
    highlighted: Boolean = false,
    content: @Composable RowScope.() -> Unit,
) {
    Surface(
        color = if (highlighted) Color(0xFFEDEEF2) else Color.Transparent,
        shape = RoundedCornerShape(0.dp),
        modifier = Modifier
            .fillMaxWidth()
            .then(
                when {
                    onClick != null && onLongClick != null -> Modifier.combinedClickable(
                        onClickLabel = "播放歌曲",
                        onLongClickLabel = "删除源文件",
                        onClick = onClick,
                        onLongClick = onLongClick,
                    )
                    onClick != null -> Modifier.clickable(onClick = onClick)
                    else -> Modifier
                },
            ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            content = content,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MiniPlayer(
    state: AppUiState,
    onToggle: () -> Unit,
    onPlay: (LocalTrack) -> Unit,
    onOpen: () -> Unit,
) {
    val playback = state.playback
    val track = playback.currentTrack ?: return
    val duration = playback.durationMs.takeIf { it > 0 } ?: track.durationMs
    val progress = if (duration > 0) {
        (playback.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    } else 0f
    var queueOpen by rememberSaveable { mutableStateOf(false) }

    if (queueOpen) {
        ModalBottomSheet(
            onDismissRequest = { queueOpen = false },
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Text(
                "当前播放列表",
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "${state.localTracks.size} 首本地音乐",
                modifier = Modifier.padding(horizontal = 20.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    top = 8.dp,
                    bottom = 28.dp,
                ),
            ) {
                items(state.localTracks, key = { it.uri.toString() }) { queuedTrack ->
                    val current = queuedTrack.uri == track.uri
                    MusicCard(
                        highlighted = current,
                        onClick = {
                            queueOpen = false
                            onPlay(queuedTrack)
                        },
                    ) {
                        TrackArtwork(queuedTrack, 46.dp)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                queuedTrack.title,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = if (current) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurface,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                queuedTrack.artist,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        if (current) {
                            Icon(
                                if (playback.isPlaying) LyralumeIcons.Pause else Icons.Rounded.PlayArrow,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
        }
    }

    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(34.dp),
        shadowElevation = 12.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 5.dp),
    ) {
        Column {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(2.dp)
                    .padding(horizontal = 28.dp)
                    .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(progress)
                        .height(2.dp)
                        .background(MaterialTheme.colorScheme.primary),
                )
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 7.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    Modifier.weight(1f).clickable(onClick = onOpen),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TrackArtwork(track = track, size = 54.dp)
                    Spacer(Modifier.width(11.dp))
                    Text(
                        "${track.title}  ·  ${track.artist}",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (playback.isPreparing) {
                    Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(23.dp), strokeWidth = 2.dp)
                    }
                } else {
                    IconButton(onClick = onToggle) {
                        Icon(
                            if (playback.isPlaying) LyralumeIcons.Pause else Icons.Rounded.PlayArrow,
                            contentDescription = if (playback.isPlaying) "暂停" else "播放",
                            modifier = Modifier.size(30.dp),
                        )
                    }
                }
                IconButton(onClick = { queueOpen = true }) {
                    Icon(
                        Icons.AutoMirrored.Rounded.ListIcon,
                        contentDescription = "播放列表",
                        modifier = Modifier.size(28.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun NowPlayingScreen(
    state: AppUiState,
    onBack: () -> Unit,
    onToggle: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onCyclePlaybackMode: () -> Unit,
    onSeek: (Long) -> Unit,
) {
    val playback = state.playback
    val track = playback.currentTrack ?: return
    val duration = playback.durationMs.takeIf { it > 0 } ?: track.durationMs
    val lyrics = state.lyrics.lines
    val lyricGroups = remember(lyrics) {
        lyrics.groupBy { it.timestampMs }.map { (timestamp, lines) ->
            LyricDisplayGroup(timestamp, lines.map { it.text })
        }
    }
    val activeGroup = lyricGroups.indexOfLast { it.timestampMs <= playback.positionMs + 80 }
    val lyricsListState = rememberLazyListState()
    var showLyrics by rememberSaveable(track.uri.toString()) { mutableStateOf(false) }
    var dragging by remember(track.uri) { mutableStateOf(false) }
    var sliderPosition by remember(track.uri) { mutableFloatStateOf(playback.positionMs.toFloat()) }
    LaunchedEffect(playback.positionMs, dragging) {
        if (!dragging) sliderPosition = playback.positionMs.toFloat()
    }

    Box(Modifier.fillMaxSize()) {
        PlayerBackdrop(track)
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.statusBars)
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(
                        Icons.Rounded.KeyboardArrowDown,
                        contentDescription = "收起正在播放",
                        tint = Color.White,
                        modifier = Modifier.size(36.dp),
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        if (showLyrics) track.title else "正在播放",
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        if (showLyrics) track.artist else track.album.takeIf(String::isNotBlank) ?: track.artist,
                        color = Color.White.copy(alpha = 0.62f),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = { showLyrics = !showLyrics }) {
                    Icon(
                        if (showLyrics) LyralumeIcons.MusicNote else LyralumeIcons.Lyrics,
                        contentDescription = if (showLyrics) "显示封面" else "显示歌词",
                        tint = Color.White,
                    )
                }
            }

            if (showLyrics) {
                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    contentAlignment = Alignment.Center,
                ) {
                    when {
                        state.lyrics.isLoading -> {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator(
                                    Modifier.size(30.dp),
                                    color = Color.White,
                                    strokeWidth = 2.dp,
                                )
                                Spacer(Modifier.height(10.dp))
                                Text("正在读取歌词…", color = Color.White.copy(alpha = 0.7f))
                            }
                        }
                        lyrics.isEmpty() -> {
                            Column(
                                Modifier.padding(28.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Icon(
                                    LyralumeIcons.Lyrics,
                                    contentDescription = null,
                                    tint = Color.White.copy(alpha = 0.72f),
                                    modifier = Modifier.size(38.dp),
                                )
                                Spacer(Modifier.height(12.dp))
                                Text(
                                    "暂无同步歌词",
                                    color = Color.White,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    state.lyrics.message ?: "音频中没有同步歌词",
                                    color = Color.White.copy(alpha = 0.55f),
                                    textAlign = TextAlign.Center,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                        else -> {
                            Column(Modifier.fillMaxSize()) {
                                state.lyrics.source?.let { source ->
                                    Surface(
                                        color = Color.White.copy(alpha = 0.12f),
                                        shape = RoundedCornerShape(50),
                                        modifier = Modifier.align(Alignment.CenterHorizontally),
                                    ) {
                                        Text(
                                            source,
                                            color = Color.White.copy(alpha = 0.78f),
                                            style = MaterialTheme.typography.labelSmall,
                                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                        )
                                    }
                                }
                                SynchronizedLyricsList(
                                    lyricGroups = lyricGroups,
                                    activeGroup = activeGroup,
                                    listState = lyricsListState,
                                    onSeek = onSeek,
                                    modifier = Modifier.fillMaxSize(),
                                )
                            }
                        }
                    }
                }
            } else {
                ArtworkPlayerPane(
                    track = track,
                    onShowLyrics = { showLyrics = true },
                    modifier = Modifier.fillMaxWidth().weight(1f),
                )
            }

            ImmersivePlayerControls(
                playback = playback,
                duration = duration,
                sliderPosition = sliderPosition,
                dragging = dragging,
                onSliderPositionChanged = {
                    dragging = true
                    sliderPosition = it
                },
                onSliderFinished = {
                    dragging = false
                    onSeek(sliderPosition.toLong())
                },
                onToggle = onToggle,
                onPrevious = onPrevious,
                onNext = onNext,
                onCyclePlaybackMode = onCyclePlaybackMode,
                onToggleLyrics = { showLyrics = !showLyrics },
                lyricsVisible = showLyrics,
            )
        }
    }
}

@Composable
private fun ArtworkPlayerPane(
    track: LocalTrack,
    onShowLyrics: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val artSize = minOf(maxWidth - 48.dp, (maxHeight * 0.66f).coerceAtLeast(180.dp))
            .coerceAtMost(390.dp)
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.Start,
        ) {
            Box(
                modifier = Modifier.fillMaxWidth().clickable(onClick = onShowLyrics),
                contentAlignment = Alignment.Center,
            ) {
                TrackArtwork(track = track, size = artSize)
            }
            Spacer(Modifier.height(22.dp))
            Text(
                track.title,
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                track.artist,
                color = Color.White.copy(alpha = 0.68f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }
}

@Composable
private fun ImmersivePlayerControls(
    playback: com.lyralume.android.model.PlaybackState,
    duration: Long,
    sliderPosition: Float,
    dragging: Boolean,
    onSliderPositionChanged: (Float) -> Unit,
    onSliderFinished: () -> Unit,
    onToggle: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onCyclePlaybackMode: () -> Unit,
    onToggleLyrics: () -> Unit,
    lyricsVisible: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 4.dp),
    ) {
        Slider(
            value = sliderPosition.coerceIn(0f, duration.coerceAtLeast(1).toFloat()),
            onValueChange = onSliderPositionChanged,
            onValueChangeFinished = onSliderFinished,
            valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
            colors = SliderDefaults.colors(
                thumbColor = Color.White,
                activeTrackColor = Color.White,
                inactiveTrackColor = Color.White.copy(alpha = 0.28f),
            ),
            modifier = Modifier.fillMaxWidth().height(30.dp),
        )
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                formatDuration(if (dragging) sliderPosition.toLong() else playback.positionMs),
                color = Color.White.copy(alpha = 0.56f),
                style = MaterialTheme.typography.labelSmall,
            )
            Text(
                "原文件",
                color = Color.White.copy(alpha = 0.72f),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.weight(1f),
            )
            Text(
                formatDuration(duration),
                color = Color.White.copy(alpha = 0.56f),
                style = MaterialTheme.typography.labelSmall,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onCyclePlaybackMode) {
                Text(
                    playback.mode.shortLabel,
                    color = Color.White.copy(alpha = 0.78f),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            IconButton(onClick = onPrevious, enabled = !playback.isPreparing) {
                Icon(
                    LyralumeIcons.SkipPrevious,
                    contentDescription = "上一首",
                    tint = Color.White,
                    modifier = Modifier.size(42.dp),
                )
            }
            if (playback.isPreparing) {
                Box(Modifier.size(64.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        Modifier.size(34.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                }
            } else {
                IconButton(onClick = onToggle, modifier = Modifier.size(64.dp)) {
                    Icon(
                        if (playback.isPlaying) LyralumeIcons.Pause else Icons.Rounded.PlayArrow,
                        contentDescription = if (playback.isPlaying) "暂停" else "播放",
                        tint = Color.White,
                        modifier = Modifier.size(54.dp),
                    )
                }
            }
            IconButton(onClick = onNext, enabled = !playback.isPreparing) {
                Icon(
                    LyralumeIcons.SkipNext,
                    contentDescription = "下一首",
                    tint = Color.White,
                    modifier = Modifier.size(42.dp),
                )
            }
            IconButton(onClick = onToggleLyrics) {
                Icon(
                    if (lyricsVisible) LyralumeIcons.MusicNote else LyralumeIcons.Lyrics,
                    contentDescription = if (lyricsVisible) "显示封面" else "显示歌词",
                    tint = Color.White.copy(alpha = 0.78f),
                )
            }
        }
    }
}

@Composable
private fun PlayerBackdrop(track: LocalTrack) {
    val targetPixels = with(LocalDensity.current) { 720.dp.roundToPx() }
    val artwork by produceState<androidx.compose.ui.graphics.ImageBitmap?>(
        initialValue = null,
        key1 = track.artworkPath,
        key2 = targetPixels,
    ) {
        value = withContext(Dispatchers.IO) {
            track.artworkPath?.let { decodeSampledBitmap(it, targetPixels)?.asImageBitmap() }
        }
    }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF5B4A42), Color(0xFF28221E), Color(0xFF171412)),
                ),
            ),
    ) {
        artwork?.let { bitmap ->
            Image(
                bitmap = bitmap,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        scaleX = 1.22f
                        scaleY = 1.22f
                        alpha = 0.82f
                    }
                    .blur(48.dp),
            )
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            Color.Black.copy(alpha = 0.20f),
                            Color.Black.copy(alpha = 0.38f),
                            Color.Black.copy(alpha = 0.72f),
                        ),
                    ),
                ),
        )
    }
}

private val PlaybackMode.shortLabel: String
    get() = when (this) {
        PlaybackMode.SEQUENTIAL -> "顺序"
        PlaybackMode.SHUFFLE -> "随机"
        PlaybackMode.REPEAT_ONE -> "单曲"
    }

internal fun lyricFocusOffsetPx(viewportHeightPx: Int): Int =
    viewportHeightPx.coerceAtLeast(0) * 3 / 10

internal data class LyricDisplayGroup(
    val timestampMs: Long,
    val lines: List<String>,
)

@Composable
internal fun SynchronizedLyricsList(
    lyricGroups: List<LyricDisplayGroup>,
    activeGroup: Int,
    listState: LazyListState,
    onSeek: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val viewportHeightPx = with(density) { maxHeight.roundToPx() }
        val focusOffsetPx = lyricFocusOffsetPx(viewportHeightPx)
        val focusPadding = with(density) { focusOffsetPx.toDp() }
        val trailingPadding = with(density) {
            (viewportHeightPx - focusOffsetPx).coerceAtLeast(0).toDp()
        }
        LaunchedEffect(activeGroup, lyricGroups.size, focusOffsetPx) {
            if (activeGroup >= 0 && focusOffsetPx > 0) {
                listState.animateScrollToItem(
                    index = activeGroup,
                    scrollOffset = -focusOffsetPx,
                )
            }
        }
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 18.dp,
                top = focusPadding,
                end = 18.dp,
                bottom = trailingPadding,
            ),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            itemsIndexed(
                items = lyricGroups,
                key = { index, group -> "${group.timestampMs}-$index" },
            ) { index, group ->
                val active = index == activeGroup
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSeek(group.timestampMs) }
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    group.lines.forEachIndexed { lineIndex, text ->
                        Text(
                            text = text,
                            color = when {
                                active && lineIndex == 0 -> Color.White
                                active -> Color.White.copy(alpha = 0.82f)
                                else -> Color.White.copy(alpha = 0.40f)
                            },
                            style = when {
                                active && lineIndex == 0 -> MaterialTheme.typography.headlineSmall
                                active -> MaterialTheme.typography.titleMedium
                                lineIndex == 0 -> MaterialTheme.typography.titleLarge
                                else -> MaterialTheme.typography.bodyLarge
                            },
                            fontWeight = if (active && lineIndex == 0) FontWeight.SemiBold
                            else FontWeight.Normal,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun TrackArtwork(track: LocalTrack, size: androidx.compose.ui.unit.Dp) {
    val targetPixels = with(LocalDensity.current) { size.roundToPx() }
    val artwork by produceState<androidx.compose.ui.graphics.ImageBitmap?>(
        initialValue = null,
        key1 = track.artworkPath,
        key2 = targetPixels,
    ) {
        value = withContext(Dispatchers.IO) {
            track.artworkPath?.let { decodeSampledBitmap(it, targetPixels)?.asImageBitmap() }
        }
    }
    val shape = RoundedCornerShape(if (size >= 100.dp) 24.dp else 12.dp)
    if (artwork != null) {
        Image(
            bitmap = artwork!!,
            contentDescription = "${track.title}的封面",
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(size).clip(shape),
        )
    } else {
        ArtworkBadge(LyralumeIcons.MusicNote, size)
    }
}

private fun decodeSampledBitmap(path: String, targetPixels: Int): android.graphics.Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sampleSize = 1
    while (bounds.outWidth / (sampleSize * 2) >= targetPixels &&
        bounds.outHeight / (sampleSize * 2) >= targetPixels) {
        sampleSize *= 2
    }
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sampleSize })
}

@Composable
private fun ArtworkBadge(symbol: String, size: androidx.compose.ui.unit.Dp = 48.dp) {
    Box(
        modifier = Modifier.size(size).background(
            Color(0xFFFFE8EC),
            RoundedCornerShape(if (size >= 100.dp) 24.dp else 12.dp),
        ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            symbol,
            color = MaterialTheme.colorScheme.primary,
            style = if (size >= 100.dp) MaterialTheme.typography.displayLarge else MaterialTheme.typography.titleLarge,
        )
    }
}

@Composable
private fun ArtworkBadge(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    size: androidx.compose.ui.unit.Dp = 48.dp,
) {
    Box(
        modifier = Modifier.size(size).background(
            Color(0xFFFFE8EC),
            RoundedCornerShape(if (size >= 100.dp) 24.dp else 12.dp),
        ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(size * 0.46f),
        )
    }
}

@Composable
private fun EmptyState(
    symbol: String,
    title: String,
    description: String,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 32.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ArtworkBadge(symbol)
        Spacer(Modifier.height(12.dp))
        Text(title, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(
            description,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center,
        )
        if (action != null && onAction != null) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = onAction) { Text(action) }
        }
    }
}

@Composable
private fun LoadingState(text: String) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(Modifier.size(32.dp))
        Spacer(Modifier.height(12.dp))
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SettingsScreen(
    state: AppUiState,
    onBack: () -> Unit,
    onDirectorySelected: (android.net.Uri) -> Unit,
    onSaveMinio: (String, String, String, String?) -> Unit,
    onTestConnection: () -> Unit,
    onClearMinio: () -> Unit,
) {
    var endpoint by remember(state.settings.endpoint) { mutableStateOf(state.settings.endpoint) }
    var bucket by remember(state.settings.bucket) { mutableStateOf(state.settings.bucket) }
    var username by remember(state.settings.accessKey) { mutableStateOf(state.settings.accessKey) }
    var password by remember { mutableStateOf("") }
    val directoryPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree(),
    ) { uri -> if (uri != null) onDirectorySelected(uri) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.background)
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回")
                }
                Text("设置", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { Feedback(state) }
            item {
                SettingsCard("下载目录", "本地音乐页面只展示这个目录及其子目录中的音频。") {
                    Text(
                        state.settings.downloadDirectoryName ?: "尚未选择",
                        color = MaterialTheme.colorScheme.secondary,
                    )
                    OutlinedButton(onClick = { directoryPicker.launch(state.settings.downloadTreeUri) }) {
                        Text("选择下载目录")
                    }
                }
            }
            item {
                SettingsCard("MinIO 连接", "Android 端只读取并下载远程音乐，不会上传或删除对象。") {
                    OutlinedTextField(
                        value = endpoint,
                        onValueChange = { endpoint = it },
                        label = { Text("API 地址") },
                        placeholder = { Text("https://minio.example.com:9000") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = bucket,
                        onValueChange = { bucket = it },
                        label = { Text("Bucket") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text("用户名（Access Key）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("密码（Secret Key）") },
                        placeholder = {
                            Text(if (state.settings.secretConfigured) "已安全保存；留空表示不修改" else "请输入密码")
                        },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (endpoint.trim().lowercase().startsWith("http://")) {
                        Text(
                            "当前端点使用未加密 HTTP，公网传输可能暴露音频和对象信息。",
                            color = Color(0xFFE0AA70),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                onSaveMinio(endpoint, bucket, username, password.takeIf(String::isNotEmpty))
                                password = ""
                            },
                            enabled = endpoint.isNotBlank() && bucket.isNotBlank() && username.isNotBlank(),
                        ) { Text("保存") }
                        OutlinedButton(
                            onClick = onTestConnection,
                            enabled = state.settings.minioConfigured && !state.remoteLoading,
                        ) { Text("测试连接") }
                        if (state.settings.minioConfigured) {
                            TextButton(onClick = onClearMinio) { Text("清除") }
                        }
                    }
                }
            }
            item {
                Text(
                    "密码使用 Android Keystore 加密保存；应用只拥有你通过系统选择器授权的目录访问权限。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun SettingsCard(title: String, description: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().shadow(
            5.dp,
            RoundedCornerShape(16.dp),
            ambientColor = Color.Black.copy(alpha = 0.05f),
        ),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Text(title, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
            Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f))
            content()
        }
    }
}

private fun formatSize(bytes: Long): String {
    if (bytes < 1_024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var unit = -1
    while (value >= 1_024 && unit < units.lastIndex) {
        value /= 1_024
        unit++
    }
    return String.format(Locale.US, "%.1f %s", value, units[unit])
}

private fun formatDuration(durationMs: Long): String {
    if (durationMs <= 0) return "--:--"
    val seconds = durationMs / 1_000
    return "%d:%02d".format(seconds / 60, seconds % 60)
}

private fun formatDate(timestamp: Long): String = if (timestamp <= 0) "未知时间"
else DateFormat.getDateInstance(DateFormat.SHORT).format(Date(timestamp))
