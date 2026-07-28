package com.lyralume.android.data

import com.lyralume.android.model.MinioConnection
import com.lyralume.android.model.RemoteTrack
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MinioMusicRepositoryTest {
    @Test
    fun `refresh only reads metadata for new or changed objects`() = runBlocking {
        val client = FakeS3ObjectClient((1..3).map(::remoteObject))
        val cache = MemoryRemoteTrackCache()
        val repository = MinioMusicRepository(client, cache, metadataConcurrency = 2)

        assertEquals(3, repository.listTracks(CONNECTION).size)
        assertEquals(3, client.statCalls.get())

        assertEquals(3, repository.listTracks(CONNECTION).size)
        assertEquals(3, client.statCalls.get())

        client.objects = client.objects.mapIndexed { index, item ->
            if (index == 1) item.copy(etag = "changed-etag", lastModified = item.lastModified + 1_000) else item
        }
        assertEquals(3, repository.listTracks(CONNECTION).size)
        assertEquals(4, client.statCalls.get())
        assertEquals(3, client.listCalls.get())
    }

    @Test
    fun `cold refresh reads metadata concurrently within configured limit`() = runBlocking {
        val client = FakeS3ObjectClient(
            initialObjects = (1..12).map(::remoteObject),
            parallelBarrierSize = 4,
        )
        val repository = MinioMusicRepository(
            s3 = client,
            cache = MemoryRemoteTrackCache(),
            metadataConcurrency = 4,
        )

        assertEquals(12, repository.listTracks(CONNECTION).size)
        assertEquals(12, client.statCalls.get())
        assertEquals(4, client.maxActiveStatCalls.get())
    }

    private class MemoryRemoteTrackCache : RemoteTrackCacheStore {
        private var tracks = emptyList<RemoteTrack>()

        override fun load(connection: MinioConnection): List<RemoteTrack> = tracks

        override fun save(connection: MinioConnection, tracks: List<RemoteTrack>) {
            this.tracks = tracks
        }

        override fun clear() {
            tracks = emptyList()
        }
    }

    private class FakeS3ObjectClient(
        initialObjects: List<S3Object>,
        parallelBarrierSize: Int? = null,
    ) : S3ObjectClient {
        @Volatile
        var objects: List<S3Object> = initialObjects
        val listCalls = AtomicInteger()
        val statCalls = AtomicInteger()
        val maxActiveStatCalls = AtomicInteger()
        private val activeStatCalls = AtomicInteger()
        private val parallelBarrier = parallelBarrierSize?.let(::CountDownLatch)

        override fun checkBucket(connection: MinioConnection) = Unit

        override fun listObjects(connection: MinioConnection, prefix: String): List<S3Object> {
            listCalls.incrementAndGet()
            return objects
        }

        override fun statObject(connection: MinioConnection, objectName: String): S3Object {
            statCalls.incrementAndGet()
            val active = activeStatCalls.incrementAndGet()
            maxActiveStatCalls.accumulateAndGet(active, ::maxOf)
            try {
                parallelBarrier?.let { barrier ->
                    barrier.countDown()
                    assertTrue("元数据请求没有并发执行", barrier.await(3, TimeUnit.SECONDS))
                    Thread.sleep(20)
                }
                return objects.single { it.name == objectName }
            } finally {
                activeStatCalls.decrementAndGet()
            }
        }

        override fun <T> withObject(
            connection: MinioConnection,
            objectName: String,
            block: (InputStream) -> T,
        ): T = ByteArrayInputStream(ByteArray(0)).use(block)
    }

    private companion object {
        val CONNECTION = MinioConnection("https://minio.example.test", "music", "access", "secret")

        fun remoteObject(index: Int): S3Object {
            val syncId = "00000000-0000-0000-0000-${index.toString().padStart(12, '0')}"
            return S3Object(
                name = "lyralume/v1/tracks/$syncId/song-$index.flac",
                size = 1_000L + index,
                lastModified = 1_784_583_784_000L + index * 1_000L,
                etag = "etag-$index",
            )
        }
    }
}
