package com.lyralume.android.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.lifecycle.asFlow
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.lyralume.android.MainActivity
import com.lyralume.android.R
import com.lyralume.android.model.BatchDownloadState
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

internal class BackgroundDownloadManager(context: Context) {
    private val workManager = WorkManager.getInstance(context.applicationContext)
    @Volatile
    private var expectedRunTag: String? = null

    val state: Flow<BatchDownloadState> =
        workManager.getWorkInfosForUniqueWorkLiveData(BatchDownloadWorker.UNIQUE_WORK_NAME)
            .asFlow()
            .map(::toBatchDownloadState)

    fun enqueueMissingDownloads() {
        val runTag = "${BatchDownloadWorker.WORK_RUN_TAG_PREFIX}${System.currentTimeMillis()}-${UUID.randomUUID()}"
        expectedRunTag = runTag
        val request = OneTimeWorkRequestBuilder<BatchDownloadWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .addTag(BatchDownloadWorker.WORK_TAG)
            .addTag(runTag)
            .build()
        workManager.enqueueUniqueWork(
            BatchDownloadWorker.UNIQUE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun cancel() {
        workManager.cancelUniqueWork(BatchDownloadWorker.UNIQUE_WORK_NAME)
    }

    private fun toBatchDownloadState(workInfos: List<WorkInfo>): BatchDownloadState {
        val expected = expectedRunTag
        val expectedWorkInfo = expected?.let { tag ->
            workInfos.firstOrNull { tag in it.tags }
        }
        val activeWorkInfo = workInfos.firstOrNull { !it.state.isFinished }
        val workInfo = when {
            expectedWorkInfo != null -> expectedWorkInfo
            expected != null && activeWorkInfo != null -> {
                expectedRunTag = null
                activeWorkInfo
            }
            expected != null -> return BatchDownloadState.Queued
            else -> null
        }
            ?: activeWorkInfo
            ?: workInfos.maxByOrNull { info ->
                info.tags.firstOrNull { it.startsWith(BatchDownloadWorker.WORK_RUN_TAG_PREFIX) }
                    .orEmpty()
            }
            ?: return BatchDownloadState.Idle
        if (workInfo.state.isFinished && expected != null) expectedRunTag = null
        return when (workInfo.state) {
            WorkInfo.State.ENQUEUED,
            WorkInfo.State.BLOCKED,
            -> BatchDownloadState.Queued
            WorkInfo.State.RUNNING -> workInfo.progress.toRunningState()
            WorkInfo.State.SUCCEEDED -> BatchDownloadState.Completed(
                downloadedCount = workInfo.outputData.getInt(BatchDownloadWorker.KEY_COMPLETED_COUNT, 0),
                skippedCount = workInfo.outputData.getInt(BatchDownloadWorker.KEY_SKIPPED_COUNT, 0),
            )
            WorkInfo.State.FAILED -> BatchDownloadState.Failed(
                message = workInfo.outputData.getString(BatchDownloadWorker.KEY_ERROR_MESSAGE)
                    ?: "后台下载失败",
                completedCount = workInfo.outputData.getInt(BatchDownloadWorker.KEY_COMPLETED_COUNT, 0),
                totalCount = workInfo.outputData.getInt(BatchDownloadWorker.KEY_TOTAL_COUNT, 0),
            )
            WorkInfo.State.CANCELLED -> BatchDownloadState.Cancelled
        }
    }

    private fun Data.toRunningState() = BatchDownloadState.Running(
        completedCount = getInt(BatchDownloadWorker.KEY_COMPLETED_COUNT, 0),
        totalCount = getInt(BatchDownloadWorker.KEY_TOTAL_COUNT, 0),
        currentTitle = getString(BatchDownloadWorker.KEY_CURRENT_TITLE),
        currentObjectName = getString(BatchDownloadWorker.KEY_CURRENT_OBJECT_NAME),
        currentProgress = getFloat(BatchDownloadWorker.KEY_CURRENT_PROGRESS, 0f).coerceIn(0f, 1f),
    )
}

class BatchDownloadWorker(
    appContext: Context,
    workerParameters: WorkerParameters,
) : CoroutineWorker(appContext, workerParameters) {
    private val settingsStore = SecureSettingsStore(appContext)
    private val minio = MinioMusicRepository(appContext)
    private val downloads = DownloadDirectoryRepository(appContext, settingsStore, minio)
    private val notificationManager =
        appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private var lastProgressUpdateAt = 0L

    override suspend fun doWork(): Result {
        createNotificationChannel()
        setForeground(createForegroundInfo(completed = 0, total = 0, currentTitle = null, progress = 0f))

        val connection = settingsStore.connection()
            ?: return failure("MinIO 设置不完整，请打开 Lyralume 重新配置", completed = 0, total = 0)
        if (settingsStore.snapshot().downloadTreeUri == null) {
            return failure("下载目录未设置，请打开 Lyralume 重新选择", completed = 0, total = 0)
        }

        var completedCount = 0
        var totalCount = 0
        return try {
            val remoteTracks = minio.listTracks(connection)
            val localTracks = downloads.scan()
            val pendingTracks = DownloadQueuePlanner.missingTracks(remoteTracks, localTracks)
            totalCount = pendingTracks.size
            val skippedCount = remoteTracks.size - pendingTracks.size
            if (pendingTracks.isEmpty()) {
                setProgress(progressData(completed = 0, total = 0, currentTrack = null, progress = 1f))
                return Result.success(
                    Data.Builder()
                        .putInt(KEY_COMPLETED_COUNT, 0)
                        .putInt(KEY_SKIPPED_COUNT, skippedCount)
                        .build(),
                )
            }

            for (track in pendingTracks) {
                if (isStopped) throw CancellationException("后台下载已停止")
                publishProgress(
                    completed = completedCount,
                    total = pendingTracks.size,
                    currentTrack = track,
                    progress = 0f,
                    force = true,
                )
                downloads.download(connection, track) { progress ->
                    if (isStopped) throw CancellationException("后台下载已停止")
                    publishProgress(
                        completed = completedCount,
                        total = pendingTracks.size,
                        currentTrack = track,
                        progress = progress,
                    )
                }
                completedCount += 1
                publishProgress(
                    completed = completedCount,
                    total = pendingTracks.size,
                    currentTrack = null,
                    progress = 0f,
                    force = true,
                )
            }

            Result.success(
                Data.Builder()
                    .putInt(KEY_COMPLETED_COUNT, completedCount)
                    .putInt(KEY_SKIPPED_COUNT, skippedCount)
                    .build(),
            )
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            val safeMessage = minio.safeError(error, connection)
            if (error.isRetryable() && runAttemptCount < MAX_RETRY_COUNT) {
                Result.retry()
            } else {
                failure(safeMessage, completedCount, totalCount)
            }
        }
    }

    private fun publishProgress(
        completed: Int,
        total: Int,
        currentTrack: com.lyralume.android.model.RemoteTrack?,
        progress: Float,
        force: Boolean = false,
    ) {
        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastProgressUpdateAt < PROGRESS_UPDATE_INTERVAL_MS) return
        lastProgressUpdateAt = now
        val normalizedProgress = progress.coerceIn(0f, 1f)
        val data = progressData(completed, total, currentTrack, normalizedProgress)
        setProgressAsync(data)
        setForegroundAsync(
            createForegroundInfo(
                completed = completed,
                total = total,
                currentTitle = currentTrack?.title,
                progress = normalizedProgress,
            ),
        )
    }

    private fun progressData(
        completed: Int,
        total: Int,
        currentTrack: com.lyralume.android.model.RemoteTrack?,
        progress: Float,
    ): Data = Data.Builder()
        .putInt(KEY_COMPLETED_COUNT, completed)
        .putInt(KEY_TOTAL_COUNT, total)
        .putString(KEY_CURRENT_TITLE, currentTrack?.title)
        .putString(KEY_CURRENT_OBJECT_NAME, currentTrack?.objectName)
        .putFloat(KEY_CURRENT_PROGRESS, progress)
        .build()

    private fun failure(message: String, completed: Int, total: Int): Result = Result.failure(
        Data.Builder()
            .putString(KEY_ERROR_MESSAGE, message)
            .putInt(KEY_COMPLETED_COUNT, completed)
            .putInt(KEY_TOTAL_COUNT, total)
            .build(),
    )

    private fun createForegroundInfo(
        completed: Int,
        total: Int,
        currentTitle: String?,
        progress: Float,
    ): ForegroundInfo {
        val cancelIntent = WorkManager.getInstance(applicationContext).createCancelPendingIntent(id)
        val contentIntent = PendingIntent.getActivity(
            applicationContext,
            0,
            Intent(applicationContext, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val overallProgress = if (total > 0) {
            ((completed + progress) / total.toFloat()).coerceIn(0f, 1f)
        } else 0f
        val status = when {
            total <= 0 -> "正在检查未下载歌曲…"
            currentTitle != null -> "第 ${completed + 1}/$total 首：$currentTitle"
            else -> "已完成 $completed/$total 首"
        }
        val notification = NotificationCompat.Builder(applicationContext, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_download_notification)
            .setContentTitle(applicationContext.getString(R.string.download_notification_title))
            .setContentText(status)
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setProgress(
                NOTIFICATION_PROGRESS_MAX,
                (overallProgress * NOTIFICATION_PROGRESS_MAX).toInt(),
                total <= 0,
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                applicationContext.getString(R.string.download_notification_cancel),
                cancelIntent,
            )
            .build()
        val serviceType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else 0
        return ForegroundInfo(NOTIFICATION_ID, notification, serviceType)
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            applicationContext.getString(R.string.download_notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = applicationContext.getString(R.string.download_notification_channel_description)
        }
        notificationManager.createNotificationChannel(channel)
    }

    private fun Throwable.isRetryable(): Boolean = generateSequence(this) { it.cause }.any { cause ->
        cause is IOException || cause is S3Exception &&
            (cause.statusCode == 408 || cause.statusCode == 429 || cause.statusCode in 500..599)
    }

    internal companion object {
        const val UNIQUE_WORK_NAME = "lyralume-background-music-downloads"
        const val WORK_TAG = "lyralume-music-download"
        const val WORK_RUN_TAG_PREFIX = "lyralume-music-download-run-"
        const val KEY_COMPLETED_COUNT = "completed_count"
        const val KEY_TOTAL_COUNT = "total_count"
        const val KEY_SKIPPED_COUNT = "skipped_count"
        const val KEY_CURRENT_TITLE = "current_title"
        const val KEY_CURRENT_OBJECT_NAME = "current_object_name"
        const val KEY_CURRENT_PROGRESS = "current_progress"
        const val KEY_ERROR_MESSAGE = "error_message"
        const val NOTIFICATION_CHANNEL_ID = "music-downloads"
        const val NOTIFICATION_ID = 4_207
        const val NOTIFICATION_PROGRESS_MAX = 1_000
        const val PROGRESS_UPDATE_INTERVAL_MS = 400L
        const val MAX_RETRY_COUNT = 2
    }
}
