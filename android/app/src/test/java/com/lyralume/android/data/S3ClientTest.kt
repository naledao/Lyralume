package com.lyralume.android.data

import java.io.ByteArrayInputStream
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import com.lyralume.android.model.MinioConnection
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class S3ClientTest {
    @Test
    fun `signer matches the AWS S3 authorization example`() {
        val request = Request.Builder()
            .url("https://examplebucket.s3.amazonaws.com/test.txt")
            .header("Range", "bytes=0-9")
            .build()

        val signed = AwsV4Signer.sign(
            request = request,
            accessKey = "AKIAIOSFODNN7EXAMPLE",
            secretKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            region = "us-east-1",
            instant = Instant.parse("2013-05-24T00:00:00Z"),
        )

        assertEquals("20130524T000000Z", signed.header("x-amz-date"))
        assertEquals(
            "AWS4-HMAC-SHA256 " +
                "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
                "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
                "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
            signed.header("Authorization"),
        )
        assertFalse(signed.header("Authorization").orEmpty().contains("wJalr"))
    }

    @Test
    fun `parser reads namespaced paged object listings`() {
        val xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
              <IsTruncated>true</IsTruncated>
              <Contents>
                <Key>lyralume/v1/tracks/id/歌曲.flac</Key>
                <LastModified>2026-07-21T02:03:04.000Z</LastModified>
                <ETag>&quot;abc123&quot;</ETag>
                <Size>4096</Size>
              </Contents>
              <NextContinuationToken>next-token</NextContinuationToken>
            </ListBucketResult>
        """.trimIndent()

        val page = S3Xml.parseObjectPage(ByteArrayInputStream(xml.toByteArray()))

        assertEquals(1, page.objects.size)
        assertEquals("lyralume/v1/tracks/id/歌曲.flac", page.objects.single().name)
        assertEquals(4096, page.objects.single().size)
        assertEquals("abc123", page.objects.single().etag)
        assertEquals(Instant.parse("2026-07-21T02:03:04Z").toEpochMilli(), page.objects.single().lastModified)
        assertEquals("next-token", page.nextContinuationToken)
    }

    @Test
    fun `parser rejects XML containing a doctype`() {
        val xml = "<!DOCTYPE foo [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><Error><Message>&xxe;</Message></Error>"

        val error = assertThrows(IllegalArgumentException::class.java) {
            S3Xml.parseObjectPage(ByteArrayInputStream(xml.toByteArray()))
        }

        assertTrue(error.message.orEmpty().contains("DOCTYPE"))
    }

    @Test
    fun `read-only client signs lists stats and downloads Android-compatible responses`() {
        val captured = mutableListOf<Request>()
        val listXml = """
            <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
              <IsTruncated>false</IsTruncated>
              <Contents>
                <Key>lyralume/v1/tracks/id/歌曲.flac</Key>
                <LastModified>2026-07-21T02:03:04Z</LastModified>
                <ETag>&quot;list-etag&quot;</ETag>
                <Size>5</Size>
              </Contents>
            </ListBucketResult>
        """.trimIndent()
        val interceptor = Interceptor { chain ->
            val request = chain.request()
            captured += request
            val builder = Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
            when {
                request.method == "GET" && request.url.queryParameter("list-type") == "2" -> {
                    builder.body(listXml.toResponseBody("application/xml".toMediaType()))
                }
                request.method == "HEAD" && request.url.encodedPath.endsWith("%E6%AD%8C%E6%9B%B2.flac") -> {
                    builder
                        .header("Content-Length", "5")
                        .header("ETag", "\"stat-etag\"")
                        .header("Last-Modified", "Tue, 21 Jul 2026 02:03:04 GMT")
                        .header("x-amz-meta-lyralume-title", "encoded-title")
                        .body(ByteArray(0).toResponseBody())
                }
                request.method == "GET" -> builder.body("audio".toResponseBody())
                else -> builder.body(ByteArray(0).toResponseBody())
            }.build()
        }
        val client = S3Client(
            http = OkHttpClient.Builder().addInterceptor(interceptor).build(),
            clock = Clock.fixed(Instant.parse("2026-07-21T02:03:04Z"), ZoneOffset.UTC),
        )
        val connection = MinioConnection("http://minio.example:8084", "lyralume", "access", "secret")

        client.checkBucket(connection)
        val listed = client.listObjects(connection, "lyralume/v1/tracks/")
        val stat = client.statObject(connection, listed.single().name)
        val downloaded = client.withObject(connection, listed.single().name) { it.readBytes().decodeToString() }

        assertEquals("stat-etag", stat.etag)
        assertEquals("encoded-title", stat.metadata["x-amz-meta-lyralume-title"])
        assertEquals("audio", downloaded)
        assertTrue(captured.any { it.url.encodedQuery?.contains("prefix=lyralume%2Fv1%2Ftracks%2F") == true })
        assertTrue(captured.any { it.url.encodedPath.endsWith("%E6%AD%8C%E6%9B%B2.flac") })
        assertTrue(captured.all { it.header("Authorization").orEmpty().startsWith("AWS4-HMAC-SHA256") })
        assertTrue(captured.none { it.header("Authorization").orEmpty().contains("secret") })
    }
}
