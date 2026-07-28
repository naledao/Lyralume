package com.lyralume.android.data

import android.content.Context
import com.lyralume.android.model.MinioConnection
import com.lyralume.android.model.RemoteTrack
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

internal interface RemoteTrackCacheStore {
    fun load(connection: MinioConnection): List<RemoteTrack>
    fun save(connection: MinioConnection, tracks: List<RemoteTrack>)
    fun clear()
}

internal object NoOpRemoteTrackCache : RemoteTrackCacheStore {
    override fun load(connection: MinioConnection): List<RemoteTrack> = emptyList()
    override fun save(connection: MinioConnection, tracks: List<RemoteTrack>) = Unit
    override fun clear() = Unit
}

internal class FileRemoteTrackCache(
    private val directory: File,
) : RemoteTrackCacheStore {
    constructor(context: Context) : this(File(context.filesDir, CACHE_DIRECTORY))

    override fun load(connection: MinioConnection): List<RemoteTrack> = synchronized(CACHE_LOCK) {
        val target = cacheFile(connection)
        if (!target.isFile || target.length() !in 1..MAX_CACHE_BYTES) return@synchronized emptyList()
        runCatching {
            DataInputStream(BufferedInputStream(target.inputStream())).use { input ->
                require(input.readInt() == CACHE_MAGIC) { "远程音乐缓存格式无效" }
                require(input.readInt() == CACHE_VERSION) { "远程音乐缓存版本不兼容" }
                val count = input.readInt()
                require(count in 0..MAX_TRACKS) { "远程音乐缓存数量无效" }
                List(count) { input.readTrack() }
            }
        }.getOrElse {
            target.delete()
            emptyList()
        }
    }

    override fun save(connection: MinioConnection, tracks: List<RemoteTrack>): Unit = synchronized(CACHE_LOCK) {
        require(tracks.size <= MAX_TRACKS) { "远程音乐缓存数量超过上限" }
        check(directory.exists() || directory.mkdirs()) { "无法创建远程音乐缓存目录" }
        val target = cacheFile(connection)
        val temporary = File(directory, ".${target.name}.${Thread.currentThread().id}.tmp")
        try {
            DataOutputStream(BufferedOutputStream(temporary.outputStream())).use { output ->
                output.writeInt(CACHE_MAGIC)
                output.writeInt(CACHE_VERSION)
                output.writeInt(tracks.size)
                tracks.forEach { track -> output.writeTrack(track) }
            }
            try {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        } catch (error: Throwable) {
            temporary.delete()
            throw error
        }
        Unit
    }

    override fun clear(): Unit = synchronized(CACHE_LOCK) {
        directory.listFiles()
            ?.filter { it.isFile && (it.extension == "bin" || it.name.endsWith(".tmp")) }
            ?.forEach(File::delete)
        Unit
    }

    private fun cacheFile(connection: MinioConnection): File {
        val identity = listOf(connection.endpoint, connection.bucket, connection.accessKey)
            .joinToString("\u0000")
        val key = MessageDigest.getInstance("SHA-256")
            .digest(identity.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return File(directory, "$key.bin")
    }

    private fun DataOutputStream.writeTrack(track: RemoteTrack) {
        writeString(track.syncId)
        writeString(track.objectName)
        writeString(track.fileName)
        writeString(track.title)
        writeString(track.artist)
        writeString(track.album)
        writeLong(track.durationMs)
        writeLong(track.fileSize)
        writeLong(track.lastModified)
        writeString(track.etag)
        writeBoolean(track.sha256 != null)
        track.sha256?.let { writeString(it) }
    }

    private fun DataInputStream.readTrack() = RemoteTrack(
        syncId = readString(),
        objectName = readString(),
        fileName = readString(),
        title = readString(),
        artist = readString(),
        album = readString(),
        durationMs = readLong().coerceAtLeast(0),
        fileSize = readLong().coerceAtLeast(0),
        lastModified = readLong().coerceAtLeast(0),
        etag = readString(),
        sha256 = if (readBoolean()) readString() else null,
    )

    private fun DataOutputStream.writeString(value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_STRING_BYTES) { "远程音乐缓存字段过长" }
        writeInt(bytes.size)
        write(bytes)
    }

    private fun DataInputStream.readString(): String {
        val length = readInt()
        require(length in 0..MAX_STRING_BYTES) { "远程音乐缓存字段长度无效" }
        return ByteArray(length).also(::readFully).toString(Charsets.UTF_8)
    }

    private companion object {
        const val CACHE_DIRECTORY = "remote-track-cache-v1"
        const val CACHE_MAGIC = 0x4C595243
        const val CACHE_VERSION = 1
        const val MAX_TRACKS = 20_000
        const val MAX_STRING_BYTES = 256 * 1024
        const val MAX_CACHE_BYTES = 32L * 1024 * 1024
        val CACHE_LOCK = Any()
    }
}
