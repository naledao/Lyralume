package com.lyralume.android.data

import com.lyralume.android.model.MinioConnection
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.xml.parsers.DocumentBuilderFactory
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.w3c.dom.Element
import org.w3c.dom.Node

internal data class S3Object(
    val name: String,
    val size: Long,
    val lastModified: Long,
    val etag: String,
    val metadata: Map<String, String> = emptyMap(),
)

internal data class S3ObjectPage(
    val objects: List<S3Object>,
    val nextContinuationToken: String?,
)

internal interface S3ObjectClient {
    fun checkBucket(connection: MinioConnection)
    fun listObjects(connection: MinioConnection, prefix: String): List<S3Object>
    fun statObject(connection: MinioConnection, objectName: String): S3Object
    fun <T> withObject(connection: MinioConnection, objectName: String, block: (InputStream) -> T): T
}

/**
 * Small, read-only S3 client for Android. It implements only the operations used by Lyralume:
 * HEAD bucket, ListObjectsV2, HEAD object and GET object.
 */
internal class S3Client(
    private val http: OkHttpClient = defaultHttpClient(),
    private val clock: Clock = Clock.systemUTC(),
) : S3ObjectClient {
    override fun checkBucket(connection: MinioConnection) {
        execute(connection, "HEAD").use { response ->
            when {
                response.isSuccessful -> Unit
                response.code == 404 -> error("Bucket “${connection.bucket}”不存在")
                else -> throw response.toS3Exception()
            }
        }
    }

    override fun listObjects(connection: MinioConnection, prefix: String): List<S3Object> {
        val output = mutableListOf<S3Object>()
        var continuationToken: String? = null
        var pageCount = 0
        do {
            check(++pageCount <= MAX_LIST_PAGES) { "远程对象分页数量超过安全上限" }
            val query = buildMap {
                put("list-type", "2")
                put("max-keys", "1000")
                put("prefix", prefix)
                continuationToken?.let { put("continuation-token", it) }
            }
            val page = execute(connection, "GET", query = query).use { response ->
                if (!response.isSuccessful) throw response.toS3Exception()
                S3Xml.parseObjectPage(response.body.byteStream())
            }
            output += page.objects
            continuationToken = page.nextContinuationToken
        } while (continuationToken != null)
        return output
    }

    override fun statObject(connection: MinioConnection, objectName: String): S3Object {
        return execute(connection, "HEAD", objectName).use { response ->
            if (!response.isSuccessful) throw response.toS3Exception()
            val metadata = response.headers.names()
                .filter { it.startsWith("x-amz-meta-", ignoreCase = true) }
                .associateWith { response.header(it).orEmpty() }
            S3Object(
                name = objectName,
                size = response.header("Content-Length")?.toLongOrNull()?.coerceAtLeast(0) ?: 0,
                lastModified = response.header("Last-Modified")?.let(::parseHttpDate) ?: 0,
                etag = response.header("ETag").orEmpty().trim('"'),
                metadata = metadata,
            )
        }
    }

    override fun <T> withObject(
        connection: MinioConnection,
        objectName: String,
        block: (InputStream) -> T,
    ): T = execute(connection, "GET", objectName).use { response ->
        if (!response.isSuccessful) throw response.toS3Exception()
        response.body.byteStream().use(block)
    }

    private fun execute(
        connection: MinioConnection,
        method: String,
        objectName: String? = null,
        query: Map<String, String> = emptyMap(),
    ): Response {
        val url = buildUrl(connection, objectName, query)
        var region = DEFAULT_REGION
        var response = http.newCall(signedRequest(connection, method, url, region)).execute()
        val serverRegion = response.header("x-amz-bucket-region")
        if (!response.isSuccessful && !serverRegion.isNullOrBlank() && serverRegion != region) {
            response.close()
            region = serverRegion
            response = http.newCall(signedRequest(connection, method, url, region)).execute()
        }
        return response
    }

    private fun signedRequest(
        connection: MinioConnection,
        method: String,
        url: HttpUrl,
        region: String,
    ): Request {
        val unsigned = Request.Builder().url(url).method(method, null).build()
        return AwsV4Signer.sign(
            request = unsigned,
            accessKey = connection.accessKey,
            secretKey = connection.secretKey,
            region = region,
            instant = clock.instant(),
        )
    }

    private fun buildUrl(
        connection: MinioConnection,
        objectName: String?,
        query: Map<String, String>,
    ): HttpUrl {
        val endpoint = connection.endpoint.trim().trimEnd('/').toHttpUrlOrNull()
            ?: error("MinIO API 地址无效")
        require(endpoint.scheme == "http" || endpoint.scheme == "https") { "MinIO API 仅支持 HTTP 或 HTTPS" }
        require(endpoint.username.isEmpty() && endpoint.password.isEmpty()) { "MinIO API 地址不能包含账号信息" }
        require(endpoint.query == null && endpoint.fragment == null) { "MinIO API 地址不能包含查询参数或片段" }
        require(endpoint.encodedPath == "/") { "MinIO API 地址不能包含路径" }
        val builder = endpoint.newBuilder().addEncodedPathSegment(awsEncode(connection.bucket))
        objectName?.split('/')?.forEach { builder.addEncodedPathSegment(awsEncode(it)) }
        query.entries.sortedBy(Map.Entry<String, String>::key).forEach { (name, value) ->
            builder.addEncodedQueryParameter(awsEncode(name), awsEncode(value))
        }
        return builder.build()
    }

    private fun Response.toS3Exception(): S3Exception {
        val payload = body.byteStream().readLimited(MAX_ERROR_BYTES)
        val parsed = S3Xml.parseError(payload)
        val summary = parsed.second?.takeIf(String::isNotBlank)
            ?: message.takeIf(String::isNotBlank)
            ?: "S3 请求失败"
        return S3Exception(code, parsed.first, summary)
    }

    private companion object {
        const val DEFAULT_REGION = "us-east-1"
        const val MAX_LIST_PAGES = 10_000
        const val MAX_ERROR_BYTES = 64 * 1024

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()

        fun parseHttpDate(value: String): Long = runCatching {
            ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
        }.getOrDefault(0)

        fun awsEncode(value: String): String = buildString {
            value.toByteArray(Charsets.UTF_8).forEach { byte ->
                val unsigned = byte.toInt() and 0xff
                val unreserved = unsigned in 'a'.code..'z'.code ||
                    unsigned in 'A'.code..'Z'.code ||
                    unsigned in '0'.code..'9'.code ||
                    unsigned == '-'.code || unsigned == '.'.code ||
                    unsigned == '_'.code || unsigned == '~'.code
                if (unreserved) append(unsigned.toChar())
                else append('%').append(HEX[unsigned ushr 4]).append(HEX[unsigned and 0x0f])
            }
        }

        const val HEX = "0123456789ABCDEF"
    }
}

internal class S3Exception(
    val statusCode: Int,
    val errorCode: String?,
    detail: String,
) : IllegalStateException(
    buildString {
        append("MinIO 请求失败（HTTP ")
        append(statusCode)
        errorCode?.takeIf(String::isNotBlank)?.let { append(" / ").append(it) }
        append("）：").append(detail)
    },
)

internal object AwsV4Signer {
    private const val ALGORITHM = "AWS4-HMAC-SHA256"
    private const val SERVICE = "s3"
    private const val TERMINATOR = "aws4_request"
    private const val EMPTY_PAYLOAD_SHA256 =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    private val timestampFormatter = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'")
        .withZone(java.time.ZoneOffset.UTC)

    fun sign(
        request: Request,
        accessKey: String,
        secretKey: String,
        region: String,
        instant: Instant,
    ): Request {
        val timestamp = timestampFormatter.format(instant)
        val date = timestamp.substring(0, 8)
        val host = request.url.hostHeader()
        val headers = sortedMapOf(
            "host" to host,
            "x-amz-content-sha256" to EMPTY_PAYLOAD_SHA256,
            "x-amz-date" to timestamp,
        )
        request.headers.names()
            .filter { it.equals("range", ignoreCase = true) }
            .forEach { name -> headers[name.lowercase()] = normalizeHeader(request.header(name).orEmpty()) }
        val canonicalHeaders = headers.entries.joinToString("") { (name, value) -> "$name:$value\n" }
        val signedHeaders = headers.keys.joinToString(";")
        val canonicalQuery = request.url.encodedQuery
            ?.split('&')
            ?.sorted()
            ?.joinToString("&")
            .orEmpty()
        val canonicalRequest = listOf(
            request.method,
            request.url.encodedPath.ifEmpty { "/" },
            canonicalQuery,
            canonicalHeaders,
            signedHeaders,
            EMPTY_PAYLOAD_SHA256,
        ).joinToString("\n")
        val scope = "$date/$region/$SERVICE/$TERMINATOR"
        val stringToSign = "$ALGORITHM\n$timestamp\n$scope\n${sha256(canonicalRequest)}"
        val dateKey = hmac("AWS4$secretKey".toByteArray(Charsets.UTF_8), date)
        val regionKey = hmac(dateKey, region)
        val serviceKey = hmac(regionKey, SERVICE)
        val signingKey = hmac(serviceKey, TERMINATOR)
        val signature = hmac(signingKey, stringToSign).toHex()
        return request.newBuilder()
            .header("Host", host)
            .header("x-amz-content-sha256", EMPTY_PAYLOAD_SHA256)
            .header("x-amz-date", timestamp)
            .header(
                "Authorization",
                "$ALGORITHM Credential=$accessKey/$scope, SignedHeaders=$signedHeaders, Signature=$signature",
            )
            .build()
    }

    private fun HttpUrl.hostHeader(): String {
        val formattedHost = if (host.contains(':')) "[$host]" else host
        val defaultPort = if (scheme == "https") 443 else 80
        return if (port == defaultPort) formattedHost else "$formattedHost:$port"
    }

    private fun normalizeHeader(value: String): String = value.trim().replace(Regex("\\s+"), " ")

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .toHex()

    private fun hmac(key: ByteArray, value: String): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(value.toByteArray(Charsets.UTF_8))
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}

internal object S3Xml {
    fun parseObjectPage(input: InputStream): S3ObjectPage {
        val root = parse(input.readLimited(MAX_LIST_BYTES))
        val objects = root.childElements("Contents").mapNotNull { node ->
            val key = node.childText("Key") ?: return@mapNotNull null
            S3Object(
                name = key,
                size = node.childText("Size")?.toLongOrNull()?.coerceAtLeast(0) ?: 0,
                lastModified = node.childText("LastModified")?.let(::parseIsoDate) ?: 0,
                etag = node.childText("ETag").orEmpty().trim('"'),
            )
        }
        val truncated = root.childText("IsTruncated").toBoolean()
        val nextToken = root.childText("NextContinuationToken")?.takeIf(String::isNotBlank)
        check(!truncated || nextToken != null) { "MinIO 返回了不完整的分页信息" }
        return S3ObjectPage(objects, if (truncated) nextToken else null)
    }

    fun parseError(payload: ByteArray): Pair<String?, String?> {
        if (payload.isEmpty()) return null to null
        return runCatching {
            val root = parse(payload)
            root.childText("Code") to root.childText("Message")
        }.getOrDefault(null to null)
    }

    private fun parse(payload: ByteArray): Element {
        val prefix = payload.toString(Charsets.ISO_8859_1)
        require(!prefix.contains("<!DOCTYPE", ignoreCase = true)) { "拒绝包含 DOCTYPE 的 XML 响应" }
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            isExpandEntityReferences = false
            runCatching { isXIncludeAware = false }
            runCatching { setFeature("http://xml.org/sax/features/external-general-entities", false) }
            runCatching { setFeature("http://xml.org/sax/features/external-parameter-entities", false) }
            runCatching { setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
        }
        return factory.newDocumentBuilder().parse(ByteArrayInputStream(payload)).documentElement
    }

    private fun Element.childElements(name: String): List<Element> = buildList {
        val children = childNodes
        for (index in 0 until children.length) {
            val child = children.item(index)
            if (child.nodeType == Node.ELEMENT_NODE && child.nodeNameWithoutPrefix() == name) {
                add(child as Element)
            }
        }
    }

    private fun Element.childText(name: String): String? = childElements(name)
        .firstOrNull()
        ?.textContent

    private fun Node.nodeNameWithoutPrefix(): String = localName ?: nodeName.substringAfter(':')

    private fun parseIsoDate(value: String): Long = runCatching {
        Instant.parse(value).toEpochMilli()
    }.getOrDefault(0)

    private const val MAX_LIST_BYTES = 16 * 1024 * 1024
}

private fun InputStream.readLimited(maxBytes: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(minOf(maxBytes, 32 * 1024))
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var total = 0
    while (true) {
        val count = read(buffer)
        if (count < 0) break
        total += count
        require(total <= maxBytes) { "MinIO 响应超过安全大小限制" }
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}
