package com.lyralume.android.data

import android.content.Context
import com.lyralume.android.model.MinioConnection
import com.lyralume.android.model.RemoteTrack
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext

class MinioMusicRepository internal constructor(
    private val s3: S3ObjectClient,
    private val cache: RemoteTrackCacheStore = NoOpRemoteTrackCache,
    private val metadataConcurrency: Int = DEFAULT_METADATA_CONCURRENCY,
) {
    constructor() : this(S3Client())
    constructor(context: Context) : this(S3Client(), FileRemoteTrackCache(context))

    init {
        require(metadataConcurrency in 1..MAX_METADATA_CONCURRENCY) {
            "MinIO 元数据并发数必须在 1 到 $MAX_METADATA_CONCURRENCY 之间"
        }
    }

    suspend fun testConnection(connection: MinioConnection): Unit = withContext(Dispatchers.IO) {
        s3.checkBucket(connection)
    }

    suspend fun cachedTracks(connection: MinioConnection): List<RemoteTrack> = withContext(Dispatchers.IO) {
        runCatching { cache.load(connection) }.getOrDefault(emptyList())
    }

    suspend fun clearCachedTracks() = withContext(Dispatchers.IO) {
        runCatching { cache.clear() }
    }

    suspend fun listTracks(connection: MinioConnection): List<RemoteTrack> = REFRESH_MUTEX.withLock {
        coroutineScope {
            val listedObjects = withContext(Dispatchers.IO) {
                s3.listObjects(connection, OBJECT_PREFIX)
            }.filterNot { it.name.endsWith('/') }
            val cachedByObject = withContext(Dispatchers.IO) {
                runCatching { cache.load(connection) }.getOrDefault(emptyList())
            }.associateBy(RemoteTrack::objectName)
            val semaphore = Semaphore(metadataConcurrency)
            val tracks = listedObjects.map { item ->
                async(Dispatchers.IO) {
                    val cached = cachedByObject[item.name]
                    if (cached != null && cached.matches(item)) {
                        cached.copy(
                            fileSize = item.size,
                            lastModified = item.lastModified.takeIf { it > 0 } ?: cached.lastModified,
                            etag = item.etag.ifBlank { cached.etag },
                        )
                    } else {
                        semaphore.withPermit { readTrack(connection, item) }
                    }
                }
            }.awaitAll().filterNotNull()
                .sortedWith(compareBy<RemoteTrack> { it.title.lowercase() }.thenBy { it.artist.lowercase() })
            withContext(Dispatchers.IO) {
                runCatching { cache.save(connection, tracks) }
            }
            tracks
        }
    }

    suspend fun <T> withObject(
        connection: MinioConnection,
        objectName: String,
        block: (InputStream) -> T,
    ): T = withContext(Dispatchers.IO) {
        s3.withObject(connection, objectName, block)
    }

    fun safeError(error: Throwable, connection: MinioConnection?): String {
        var message = error.message ?: "MinIO 请求失败"
        if (connection != null) {
            listOf(connection.endpoint, connection.accessKey, connection.secretKey).forEach { value ->
                if (value.isNotEmpty()) message = message.replace(value, "<redacted>")
            }
        }
        return message.ifBlank { "MinIO 请求失败" }
    }

    private fun readTrack(connection: MinioConnection, item: S3Object): RemoteTrack? {
        val stat = s3.statObject(connection, item.name)
        return RemoteMetadataParser.parse(
            objectName = item.name,
            size = stat.size,
            lastModified = stat.lastModified.takeIf { it > 0 } ?: item.lastModified,
            etag = stat.etag.ifBlank { item.etag },
            metadata = stat.metadata,
        )
    }

    private fun RemoteTrack.matches(item: S3Object): Boolean {
        if (objectName != item.name || fileSize != item.size) return false
        if (etag.isBlank() || item.etag.isBlank() || !etag.equals(item.etag, ignoreCase = true)) return false
        return lastModified <= 0 || item.lastModified <= 0 ||
            lastModified / 1_000 == item.lastModified / 1_000
    }

    private companion object {
        const val OBJECT_PREFIX = "lyralume/v1/tracks/"
        const val DEFAULT_METADATA_CONCURRENCY = 6
        const val MAX_METADATA_CONCURRENCY = 12
        val REFRESH_MUTEX = Mutex()
    }
}
