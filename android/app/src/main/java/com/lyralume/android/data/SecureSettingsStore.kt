package com.lyralume.android.data

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.documentfile.provider.DocumentFile
import com.lyralume.android.model.MinioConnection
import com.lyralume.android.model.SettingsSnapshot
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureSettingsStore(private val context: Context) {
    private val preferences = context.getSharedPreferences("lyralume-settings", Context.MODE_PRIVATE)

    fun snapshot(): SettingsSnapshot {
        val treeUri = preferences.getString(KEY_TREE_URI, null)?.let(Uri::parse)
        return SettingsSnapshot(
            endpoint = preferences.getString(KEY_ENDPOINT, "").orEmpty(),
            bucket = preferences.getString(KEY_BUCKET, "").orEmpty(),
            accessKey = preferences.getString(KEY_ACCESS_KEY, "").orEmpty(),
            secretConfigured = preferences.contains(KEY_SECRET_CIPHERTEXT),
            downloadTreeUri = treeUri,
            downloadDirectoryName = treeUri?.let {
                DocumentFile.fromTreeUri(context, it)?.name
            },
        )
    }

    fun saveMinio(
        endpoint: String,
        bucket: String,
        accessKey: String,
        secretKey: String?,
    ): SettingsSnapshot {
        val normalizedEndpoint = normalizeEndpoint(endpoint)
        val normalizedBucket = normalizeBucket(bucket)
        val normalizedAccessKey = accessKey.trim().also {
            require(it.isNotEmpty() && it.length <= 256 && !it.contains('\n') && !it.contains('\r')) {
                "MinIO 用户名格式不正确"
            }
        }
        if (secretKey == null && !preferences.contains(KEY_SECRET_CIPHERTEXT)) {
            error("必须填写 MinIO 密码")
        }
        val editor = preferences.edit()
            .putString(KEY_ENDPOINT, normalizedEndpoint)
            .putString(KEY_BUCKET, normalizedBucket)
            .putString(KEY_ACCESS_KEY, normalizedAccessKey)
        if (secretKey != null) {
            require(secretKey.isNotEmpty() && secretKey.length <= 512 &&
                !secretKey.contains('\n') && !secretKey.contains('\r')) {
                "MinIO 密码格式不正确"
            }
            val encrypted = encrypt(secretKey)
            editor.putString(KEY_SECRET_IV, encrypted.first)
            editor.putString(KEY_SECRET_CIPHERTEXT, encrypted.second)
        }
        check(editor.commit()) { "MinIO 设置保存失败" }
        return snapshot()
    }

    fun clearMinio(): SettingsSnapshot {
        preferences.edit()
            .remove(KEY_ENDPOINT)
            .remove(KEY_BUCKET)
            .remove(KEY_ACCESS_KEY)
            .remove(KEY_SECRET_IV)
            .remove(KEY_SECRET_CIPHERTEXT)
            .apply()
        return snapshot()
    }

    fun saveDownloadTree(uri: Uri): SettingsSnapshot {
        preferences.edit().putString(KEY_TREE_URI, uri.toString()).apply()
        return snapshot()
    }

    fun connection(): MinioConnection? {
        val current = snapshot()
        if (!current.minioConfigured) return null
        val secret = decryptSecret() ?: return null
        return MinioConnection(
            endpoint = current.endpoint,
            bucket = current.bucket,
            accessKey = current.accessKey,
            secretKey = secret,
        )
    }

    private fun normalizeEndpoint(raw: String): String {
        val value = raw.trim().let {
            if (it.contains("://")) it else "http://$it"
        }
        val uri = runCatching { URI(value) }.getOrElse { error("MinIO API 地址格式不正确") }
        require(uri.scheme == "http" || uri.scheme == "https") { "MinIO API 只支持 HTTP 或 HTTPS" }
        require(uri.host != null && uri.userInfo == null &&
            (uri.path.isNullOrEmpty() || uri.path == "/") && uri.query == null && uri.fragment == null) {
            "MinIO API 地址不能包含账号、路径、查询参数或片段"
        }
        val defaultPort = (uri.scheme == "http" && uri.port == 80) ||
            (uri.scheme == "https" && uri.port == 443)
        return "${uri.scheme}://${uri.host}${if (uri.port > 0 && !defaultPort) ":${uri.port}" else ""}"
    }

    private fun normalizeBucket(raw: String): String {
        val value = raw.trim()
        require(value.length in 3..63 &&
            value.matches(Regex("[a-z0-9][a-z0-9.-]*[a-z0-9]")) && !value.contains("..")) {
            "MinIO Bucket 名称格式不正确"
        }
        return value
    }

    private fun encrypt(value: String): Pair<String, String> {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return encode(cipher.iv) to encode(encrypted)
    }

    private fun decryptSecret(): String? = runCatching {
        val iv = decode(preferences.getString(KEY_SECRET_IV, null) ?: return null)
        val encrypted = decode(preferences.getString(KEY_SECRET_CIPHERTEXT, null) ?: return null)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }.getOrElse {
        preferences.edit().remove(KEY_SECRET_IV).remove(KEY_SECRET_CIPHERTEXT).apply()
        null
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encode(value: ByteArray): String = Base64.encodeToString(value, Base64.NO_WRAP)
    private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    private companion object {
        const val KEY_ALIAS = "lyralume-minio-secret-v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_ENDPOINT = "minio_endpoint"
        const val KEY_BUCKET = "minio_bucket"
        const val KEY_ACCESS_KEY = "minio_access_key"
        const val KEY_SECRET_IV = "minio_secret_iv"
        const val KEY_SECRET_CIPHERTEXT = "minio_secret_ciphertext"
        const val KEY_TREE_URI = "download_tree_uri"
    }
}
