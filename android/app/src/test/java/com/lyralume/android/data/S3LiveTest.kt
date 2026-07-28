package com.lyralume.android.data

import com.lyralume.android.model.MinioConnection
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Optional read-only integration check. Credentials are accepted only through process environment
 * variables and are never stored in the repository or test reports.
 */
class S3LiveTest {
    @Test
    fun `configured S3 endpoint accepts signed read-only requests`() {
        val endpoint = System.getenv("LYRALUME_TEST_MINIO_ENDPOINT").orEmpty()
        val bucket = System.getenv("LYRALUME_TEST_MINIO_BUCKET").orEmpty()
        val accessKey = System.getenv("LYRALUME_TEST_MINIO_ACCESS_KEY").orEmpty()
        val secretKey = System.getenv("LYRALUME_TEST_MINIO_SECRET_KEY").orEmpty()
        assumeTrue(listOf(endpoint, bucket, accessKey, secretKey).all(String::isNotBlank))
        val connection = MinioConnection(endpoint, bucket, accessKey, secretKey)
        val client = S3Client()

        client.checkBucket(connection)
        client.listObjects(connection, "lyralume/v1/tracks/")
            .firstOrNull { !it.name.endsWith('/') }
            ?.let { client.statObject(connection, it.name) }
    }
}
