package com.lyralume.android.data

import com.lyralume.android.model.RemoteTrack
import java.util.Base64

private val managedObjectPattern = Regex(
    "^lyralume/v1/tracks/([0-9a-fA-F-]{36})/[^/]+$",
)

object RemoteMetadataParser {
    fun parse(
        objectName: String,
        size: Long,
        lastModified: Long,
        etag: String,
        metadata: Map<String, String>,
    ): RemoteTrack? {
        val normalized = metadata.entries.associate { (key, value) ->
            key.lowercase().removePrefix("x-amz-meta-") to value
        }
        val syncId = normalized["lyralume-sync-id"]
            ?: managedObjectPattern.matchEntire(objectName)?.groupValues?.get(1)
            ?: return null
        val fallbackName = objectName.substringAfterLast('/')
        return RemoteTrack(
            syncId = syncId,
            objectName = objectName,
            fileName = decode(normalized["lyralume-file-name"], fallbackName),
            title = decode(normalized["lyralume-title"], fallbackName),
            artist = decode(normalized["lyralume-artist"], "未知艺术家"),
            album = decode(normalized["lyralume-album"], "未知专辑"),
            durationMs = ((normalized["lyralume-duration"]?.toDoubleOrNull() ?: 0.0) * 1_000)
                .toLong()
                .coerceAtLeast(0),
            fileSize = size.coerceAtLeast(0),
            lastModified = lastModified,
            etag = etag,
            sha256 = normalized["lyralume-sha256"]?.takeIf { it.matches(Regex("[a-fA-F0-9]{64}")) },
        )
    }

    private fun decode(value: String?, fallback: String): String {
        if (value.isNullOrBlank()) return fallback
        return runCatching {
            String(Base64.getUrlDecoder().decode(value), Charsets.UTF_8)
                .ifBlank { fallback }
        }.getOrDefault(fallback)
    }
}
