package com.lyralume.android.data

import android.app.Notification
import android.app.NotificationManager
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.lyralume.android.model.LocalTrack
import com.lyralume.android.model.PlaybackMode
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalAudioPlayerInstrumentedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private var player: LocalAudioPlayer? = null
    private var audioFile: File? = null

    @After
    fun tearDown() {
        instrumentation.runOnMainSync {
            player?.setPlaybackMode(PlaybackMode.SEQUENTIAL)
            player?.stopAndClear()
            player?.release()
        }
        PlaybackModeStore(instrumentation.targetContext).save(PlaybackMode.SEQUENTIAL)
        audioFile?.delete()
    }

    @Test
    fun playbackModeChangesAndSurvivesUiControllerReconnect() {
        val context = instrumentation.targetContext
        val shuffleSelected = CountDownLatch(1)
        val restored = CountDownLatch(1)
        val failure = AtomicReference<String?>()

        instrumentation.runOnMainSync {
            player = LocalAudioPlayer(
                context = context,
                onStateChanged = { snapshot ->
                    if (snapshot.mode == PlaybackMode.SHUFFLE) shuffleSelected.countDown()
                },
                onError = failure::set,
            ).also { it.setPlaybackMode(PlaybackMode.SHUFFLE) }
        }

        assertTrue("随机播放模式没有生效", shuffleSelected.await(5, TimeUnit.SECONDS))
        assertEquals(PlaybackMode.SHUFFLE, PlaybackModeStore(context).load())

        instrumentation.runOnMainSync {
            player?.release()
            player = null
        }

        instrumentation.runOnMainSync {
            player = LocalAudioPlayer(
                context = context,
                onStateChanged = { snapshot ->
                    if (snapshot.mode == PlaybackMode.SHUFFLE) restored.countDown()
                },
                onError = failure::set,
            )
        }

        assertTrue("界面重连后没有恢复随机播放模式", restored.await(5, TimeUnit.SECONDS))
        assertNull(failure.get())
    }

    @Test
    fun preparesAndPlaysAuthorizedLocalAudio() {
        val context = instrumentation.targetContext
        val file = File(context.cacheDir, "player-test-${System.nanoTime()}.wav")
        file.writeBytes(createSilentWav(durationMs = 600))
        audioFile = file
        val playing = CountDownLatch(1)
        val failure = AtomicReference<String?>()

        instrumentation.runOnMainSync {
            player = LocalAudioPlayer(
                context = context,
                onStateChanged = { snapshot ->
                    if (snapshot.isPlaying) playing.countDown()
                },
                onError = failure::set,
            ).also {
                it.play(
                    LocalTrack(
                        uri = Uri.fromFile(file),
                        fileName = file.name,
                        title = "播放器测试",
                        artist = "Lyralume",
                        album = "测试",
                        durationMs = 600,
                        fileSize = file.length(),
                    ),
                    queue = emptyList(),
                )
            }
        }

        assertTrue("播放器没有进入播放状态", playing.await(5, TimeUnit.SECONDS))
        assertNull(failure.get())
    }

    @Test
    fun playbackSurvivesUiControllerReleaseAndReconnect() {
        val context = instrumentation.targetContext
        val file = File(context.cacheDir, "background-player-test-${System.nanoTime()}.wav")
        file.writeBytes(createSilentWav(durationMs = 3_000))
        audioFile = file
        val track = LocalTrack(
            uri = Uri.fromFile(file),
            fileName = file.name,
            title = "后台播放测试",
            artist = "Lyralume",
            album = "测试",
            durationMs = 3_000,
            fileSize = file.length(),
        )
        val started = CountDownLatch(1)
        val failure = AtomicReference<String?>()

        instrumentation.runOnMainSync {
            player = LocalAudioPlayer(
                context = context,
                onStateChanged = { if (it.isPlaying) started.countDown() },
                onError = failure::set,
            ).also { it.play(track, listOf(track)) }
        }
        assertTrue("播放器没有进入播放状态", started.await(5, TimeUnit.SECONDS))

        val mediaNotification = awaitMediaNotification(context)
        assertNotNull("后台播放没有发布系统媒体通知", mediaNotification)
        assertEquals(
            "后台播放测试",
            mediaNotification?.extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
        )
        assertTrue(
            "播放通知不是系统 MediaStyle",
            mediaNotification?.extras?.getString(Notification.EXTRA_TEMPLATE)?.contains("MediaStyle") == true,
        )
        assertTrue(
            "系统媒体通知没有 MediaSession token",
            mediaNotification?.extras?.containsKey(Notification.EXTRA_MEDIA_SESSION) == true,
        )

        instrumentation.runOnMainSync {
            player?.release()
            player = null
        }
        Thread.sleep(700)

        val reconnected = CountDownLatch(1)
        val reconnectedPosition = AtomicLong()
        instrumentation.runOnMainSync {
            player = LocalAudioPlayer(
                context = context,
                onStateChanged = { snapshot ->
                    if (snapshot.isPlaying) {
                        reconnectedPosition.set(snapshot.positionMs)
                        reconnected.countDown()
                    }
                },
                onError = failure::set,
            )
        }

        assertTrue("界面断开后后台播放没有保留", reconnected.await(5, TimeUnit.SECONDS))
        assertTrue("重新连接后的播放进度没有继续前进", reconnectedPosition.get() >= 500L)
        assertNull(failure.get())
    }

    @Test
    fun removingTheCurrentTrackStopsPlaybackAndClearsTheMediaSession() {
        val context = instrumentation.targetContext
        val file = File(context.cacheDir, "remove-player-test-${System.nanoTime()}.wav")
        file.writeBytes(createSilentWav(durationMs = 3_000))
        audioFile = file
        val track = LocalTrack(
            uri = Uri.fromFile(file),
            fileName = file.name,
            title = "删除播放项测试",
            artist = "Lyralume",
            album = "测试",
            durationMs = 3_000,
            fileSize = file.length(),
        )
        val started = CountDownLatch(1)
        val cleared = CountDownLatch(1)
        val latestSnapshot = AtomicReference<AudioPlayerSnapshot?>()
        val failure = AtomicReference<String?>()
        var playbackStarted = false

        instrumentation.runOnMainSync {
            player = LocalAudioPlayer(
                context = context,
                onStateChanged = { snapshot ->
                    latestSnapshot.set(snapshot)
                    if (snapshot.isPlaying) {
                        playbackStarted = true
                        started.countDown()
                    } else if (playbackStarted && snapshot.track == null) {
                        cleared.countDown()
                    }
                },
                onError = failure::set,
            ).also { it.play(track, listOf(track)) }
        }
        assertTrue("播放器没有进入播放状态", started.await(5, TimeUnit.SECONDS))

        instrumentation.runOnMainSync { player?.removeTrack(track.uri) }

        assertTrue("删除当前歌曲前没有清空媒体会话", cleared.await(5, TimeUnit.SECONDS))
        assertNull("播放器仍持有当前歌曲", latestSnapshot.get()?.track)
        assertNull(failure.get())
    }

    private fun awaitMediaNotification(context: android.content.Context): Notification? {
        val manager = context.getSystemService(NotificationManager::class.java)
        repeat(50) {
            manager.activeNotifications
                .firstOrNull { it.notification.category == Notification.CATEGORY_TRANSPORT }
                ?.notification
                ?.let { return it }
            Thread.sleep(100)
        }
        return null
    }

    private fun createSilentWav(durationMs: Int): ByteArray {
        val sampleRate = 8_000
        val channels = 1
        val bitsPerSample = 16
        val sampleCount = sampleRate * durationMs / 1_000
        val dataSize = sampleCount * channels * bitsPerSample / 8
        return ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray())
            putInt(36 + dataSize)
            put("WAVE".toByteArray())
            put("fmt ".toByteArray())
            putInt(16)
            putShort(1)
            putShort(channels.toShort())
            putInt(sampleRate)
            putInt(sampleRate * channels * bitsPerSample / 8)
            putShort((channels * bitsPerSample / 8).toShort())
            putShort(bitsPerSample.toShort())
            put("data".toByteArray())
            putInt(dataSize)
            repeat(sampleCount) { putShort(0) }
        }.array()
    }
}
