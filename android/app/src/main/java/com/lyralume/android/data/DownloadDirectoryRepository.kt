package com.lyralume.android.data

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import com.lyralume.android.model.LocalTrack
import com.lyralume.android.model.MinioConnection
import com.lyralume.android.model.RemoteTrack
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class DownloadDirectoryRepository(
    private val context: Context,
    private val settingsStore: SecureSettingsStore,
    private val minio: MinioMusicRepository,
) {
    fun persistDirectoryPermission(uri: Uri) {
        context.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        settingsStore.saveDownloadTree(uri)
    }

    suspend fun scan(): List<LocalTrack> = withContext(Dispatchers.IO) {
        val root = settingsStore.snapshot().downloadTreeUri
            ?.let { DocumentFile.fromTreeUri(context, it) }
            ?.takeIf { it.exists() && it.isDirectory }
            ?: return@withContext emptyList()
        buildList {
            scanDirectory(root, this, depth = 0)
        }.sortedWith(compareBy<LocalTrack> { it.title.lowercase() }.thenBy { it.artist.lowercase() })
    }

    suspend fun download(
        connection: MinioConnection,
        track: RemoteTrack,
        onProgress: (Float) -> Unit,
    ): Uri = DOWNLOAD_MUTEX.withLock {
        withContext(Dispatchers.IO) {
            val root = settingsStore.snapshot().downloadTreeUri
                ?.let { DocumentFile.fromTreeUri(context, it) }
                ?.takeIf { it.exists() && it.isDirectory && it.canWrite() }
                ?: error("请先在设置中选择可写的下载目录")
            val safeName = safeFileName(track.fileName.ifBlank { track.title })
            root.findFile(safeName)?.takeIf { it.isFile && it.length() == track.fileSize }?.let {
                onProgress(1f)
                return@withContext it.uri
            }
            val finalName = uniqueName(root, safeName)
            val temporaryName = ".${finalName}.lyralume-part"
            root.findFile(temporaryName)?.delete()
            val temporary = root.createFile("application/octet-stream", temporaryName)
                ?: error("无法在下载目录中创建文件")
            try {
                val digest = MessageDigest.getInstance("SHA-256")
                minio.withObject(connection, track.objectName) { input ->
                    context.contentResolver.openOutputStream(temporary.uri, "wt")?.use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        var downloaded = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                            digest.update(buffer, 0, count)
                            downloaded += count
                            onProgress(
                                if (track.fileSize > 0) {
                                    (downloaded.toFloat() / track.fileSize).coerceIn(0f, 0.99f)
                                } else 0f,
                            )
                        }
                        output.flush()
                    } ?: error("无法写入下载目录")
                }
                val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
                if (track.sha256 != null && !actualSha256.equals(track.sha256, ignoreCase = true)) {
                    error("下载完成后的 SHA-256 校验失败")
                }
                check(temporary.renameTo(finalName)) { "下载完成，但文件重命名失败" }
                onProgress(1f)
                temporary.uri
            } catch (error: Throwable) {
                temporary.delete()
                throw error
            }
        }
    }

    /** Permanently deletes only the selected audio file inside the authorized tree. */
    suspend fun deleteSource(track: LocalTrack): Boolean = DOWNLOAD_MUTEX.withLock {
        withContext(Dispatchers.IO) {
            val root = settingsStore.snapshot().downloadTreeUri
                ?.let { DocumentFile.fromTreeUri(context, it) }
                ?.takeIf { it.exists() && it.isDirectory && it.canWrite() }
                ?: error("下载目录不可写，请在设置中重新选择")
            val deleted = deleteAuthorizedAudioSource(root, track.uri)
            if (!deleted) return@withContext false
            deleteCachedArtwork(track.artworkPath)
            true
        }
    }

    private fun scanDirectory(
        directory: DocumentFile,
        output: MutableList<LocalTrack>,
        depth: Int,
    ) {
        if (depth > MAX_SCAN_DEPTH || output.size >= MAX_TRACKS) return
        val children = directory.listFiles()
        val sidecarLyrics = children
            .filter { it.isFile && it.name.orEmpty().substringAfterLast('.', "").equals("lrc", true) }
            .associateBy { it.name.orEmpty().substringBeforeLast('.').lowercase() }
        for (child in children) {
            if (output.size >= MAX_TRACKS) return
            if (child.isDirectory) {
                scanDirectory(child, output, depth + 1)
            } else if (child.isFile && isAudioFile(child.name.orEmpty())) {
                val baseName = child.name.orEmpty().substringBeforeLast('.').lowercase()
                output += readMetadata(child, sidecarLyrics[baseName]?.uri)
            }
        }
    }

    private fun readMetadata(file: DocumentFile, lyricsUri: Uri?): LocalTrack {
        var title = file.name?.substringBeforeLast('.') ?: "未知歌曲"
        var artist = "未知艺术家"
        var album = "未知专辑"
        var duration = 0L
        var artworkPath: String? = null
        val isMp3 = file.name.orEmpty().substringAfterLast('.', "").equals("mp3", ignoreCase = true)
        val id3Metadata = if (isMp3) {
            runCatching {
                context.contentResolver.openInputStream(file.uri)?.use(Id3MetadataParser::parse)
            }.getOrNull()
        } else {
            null
        }
        var retrieverArtwork: ByteArray? = null
        runCatching {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(context, file.uri)
                title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
                    ?.takeIf(String::isNotBlank) ?: title
                artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
                    ?.takeIf(String::isNotBlank) ?: artist
                album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
                    ?.takeIf(String::isNotBlank) ?: album
                duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull()?.coerceAtLeast(0) ?: 0
                if (id3Metadata?.artwork == null) retrieverArtwork = retriever.embeddedPicture
            } finally {
                retriever.release()
            }
        }
        id3Metadata?.title?.let { title = it }
        id3Metadata?.artist?.let { artist = it }
        id3Metadata?.album?.let { album = it }
        artworkPath = id3Metadata?.artwork?.let { cacheId3Artwork(file, it) }
            ?: retrieverArtwork
                ?.takeIf { it.isNotEmpty() && it.size <= MAX_ARTWORK_BYTES }
                ?.let { cacheArtwork(file, it) }
        return LocalTrack(
            uri = file.uri,
            fileName = file.name.orEmpty(),
            title = title,
            artist = artist,
            album = album,
            durationMs = duration,
            fileSize = file.length().coerceAtLeast(0),
            artworkPath = artworkPath,
            lyricsUri = lyricsUri,
        )
    }

    private fun deleteCachedArtwork(path: String?) {
        if (path == null) return
        runCatching {
            val artworkDirectory = File(context.cacheDir, "artwork").canonicalFile
            val cachedFile = File(path).canonicalFile
            if (cachedFile.parentFile == artworkDirectory && cachedFile.isFile) cachedFile.delete()
        }
    }

    private fun cacheArtwork(file: DocumentFile, bytes: ByteArray): String? = runCatching {
        val target = artworkCacheTarget(file)
        if (!target.exists() || target.length() != bytes.size.toLong()) {
            val temporary = File(target.parentFile, ".${target.name}-${Thread.currentThread().id}.tmp")
            temporary.outputStream().use { it.write(bytes) }
            if (!temporary.renameTo(target)) {
                target.outputStream().use { it.write(bytes) }
                temporary.delete()
            }
        }
        target.absolutePath
    }.getOrNull()

    internal fun cacheId3Artwork(file: DocumentFile, artwork: Id3ArtworkReference): String? =
        runCatching { cacheId3ArtworkOrThrow(file, artwork) }.getOrNull()

    internal fun cacheId3ArtworkOrThrow(file: DocumentFile, artwork: Id3ArtworkReference): String {
        val target = artworkCacheTarget(file)
        if (target.isFile && target.length() > 0) return target.absolutePath

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val boundsStream = openArtworkRange(file, artwork) ?: error("Unable to open embedded artwork")
        boundsStream.use { BitmapFactory.decodeStream(it, null, bounds) }
        require(
            bounds.outWidth in 1..MAX_ARTWORK_SOURCE_DIMENSION &&
                bounds.outHeight in 1..MAX_ARTWORK_SOURCE_DIMENSION,
        ) { "Embedded artwork dimensions are invalid or unsafe" }

        var sampleSize = 1
        while (
            bounds.outWidth / sampleSize > MAX_CACHED_ARTWORK_DIMENSION ||
            bounds.outHeight / sampleSize > MAX_CACHED_ARTWORK_DIMENSION
        ) {
            sampleSize *= 2
        }
        val bitmap = openArtworkRange(file, artwork)?.use { stream ->
            BitmapFactory.decodeStream(
                stream,
                null,
                BitmapFactory.Options().apply { inSampleSize = sampleSize },
            )
        } ?: error("Unable to decode embedded artwork")
        try {
            writeCachedBitmap(target, bitmap)
        } finally {
            bitmap.recycle()
        }
        return target.absolutePath
    }

    private fun artworkCacheTarget(file: DocumentFile): File {
        val cacheDirectory = File(context.cacheDir, "artwork").apply { mkdirs() }
        val identity = "${file.uri}|${file.length()}|${file.lastModified()}"
        val key = MessageDigest.getInstance("SHA-256")
            .digest(identity.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return File(cacheDirectory, key)
    }

    private fun openArtworkRange(file: DocumentFile, artwork: Id3ArtworkReference): InputStream? {
        val source = context.contentResolver.openInputStream(file.uri) ?: return null
        if (!source.skipExactly(artwork.offset)) {
            source.close()
            return null
        }
        return BoundedInputStream(source, artwork.length)
    }

    private fun writeCachedBitmap(target: File, bitmap: Bitmap) {
        val temporary = File(target.parentFile, ".${target.name}-${Thread.currentThread().id}.tmp")
        try {
            temporary.outputStream().use { output ->
                val format = if (bitmap.hasAlpha()) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
                check(bitmap.compress(format, ARTWORK_JPEG_QUALITY, output)) {
                    "Unable to encode embedded artwork"
                }
            }
            if (!temporary.renameTo(target)) {
                temporary.inputStream().use { input ->
                    target.outputStream().use(input::copyTo)
                }
                temporary.delete()
            }
        } catch (error: Throwable) {
            temporary.delete()
            throw error
        }
    }

    private fun safeFileName(value: String): String {
        val sanitized = value.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[\\u0000-\\u001f<>:\"/\\\\|?*]"), "_")
            .trim().trimEnd('.')
            .take(180)
        return sanitized.ifBlank { "music-${System.currentTimeMillis()}.bin" }
    }

    private fun uniqueName(root: DocumentFile, requested: String): String {
        if (root.findFile(requested) == null) return requested
        val extension = requested.substringAfterLast('.', "").takeIf { requested.contains('.') }
        val base = if (extension == null) requested else requested.dropLast(extension.length + 1)
        for (index in 1..999) {
            val candidate = if (extension == null) "$base ($index)" else "$base ($index).$extension"
            if (root.findFile(candidate) == null) return candidate
        }
        error("下载目录中存在过多同名文件")
    }

    private fun isAudioFile(name: String): Boolean = isSupportedAudioSourceName(name)

    private companion object {
        val DOWNLOAD_MUTEX = Mutex()
        const val MAX_SCAN_DEPTH = 12
        const val MAX_TRACKS = 20_000
        const val MAX_ARTWORK_BYTES = 12 * 1024 * 1024
        const val MAX_ARTWORK_SOURCE_DIMENSION = 16_384
        const val MAX_CACHED_ARTWORK_DIMENSION = 1_024
        const val ARTWORK_JPEG_QUALITY = 90
    }
}

private class BoundedInputStream(
    private val source: InputStream,
    byteCount: Long,
) : InputStream() {
    private var remaining = byteCount

    override fun read(): Int {
        if (remaining <= 0) return -1
        return source.read().also { if (it >= 0) remaining-- }
    }

    override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
        if (remaining <= 0) return -1
        val requested = minOf(length.toLong(), remaining).toInt()
        return source.read(bytes, offset, requested).also { if (it > 0) remaining -= it }
    }

    override fun skip(byteCount: Long): Long {
        if (remaining <= 0) return 0
        return source.skip(minOf(byteCount, remaining)).also { if (it > 0) remaining -= it }
    }

    override fun close() = source.close()
}

private fun InputStream.skipExactly(byteCount: Long): Boolean {
    var remaining = byteCount
    while (remaining > 0) {
        val skipped = skip(remaining)
        if (skipped > 0) {
            remaining -= skipped
        } else if (read() >= 0) {
            remaining--
        } else {
            return false
        }
    }
    return true
}

internal fun deleteAuthorizedAudioSource(
    root: DocumentFile,
    targetUri: Uri,
    depthLimit: Int = 12,
): Boolean {
    val source = findDocument(root, targetUri, depth = 0, depthLimit = depthLimit) ?: return false
    check(source.isFile && isSupportedAudioSourceName(source.name.orEmpty())) {
        "只能删除已授权下载目录中的音频源文件"
    }
    check(source.canWrite()) { "没有权限删除这个音频源文件" }
    check(source.delete() || !source.exists()) { "删除源文件失败" }
    return true
}

internal fun isSupportedAudioSourceName(name: String): Boolean =
    name.substringAfterLast('.', "").lowercase() in SUPPORTED_AUDIO_EXTENSIONS

private fun findDocument(
    directory: DocumentFile,
    targetUri: Uri,
    depth: Int,
    depthLimit: Int,
): DocumentFile? {
    if (depth > depthLimit) return null
    for (child in directory.listFiles()) {
        if (child.uri == targetUri) return child
        if (child.isDirectory) {
            findDocument(child, targetUri, depth + 1, depthLimit)?.let { return it }
        }
    }
    return null
}

private val SUPPORTED_AUDIO_EXTENSIONS = setOf("mp3", "flac", "m4a", "aac", "wav", "ogg", "opus", "wma")
