package com.lyralume.android.data

import android.graphics.BitmapFactory
import androidx.documentfile.provider.DocumentFile
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MediaMetadataInstrumentedTest {
    @Test
    fun realDesktopMp3ExposesMetadataSampledArtworkAndSynchronizedLyrics() {
        val arguments = InstrumentationRegistry.getArguments()
        val audioPath = arguments.getString("audioPath").orEmpty()
        val file = File(audioPath)
        assumeTrue(file.isFile)

        val metadata = file.inputStream().use(Id3MetadataParser::parse)
        assertEquals("Dehors", metadata?.title)
        assertEquals("曾舜晞", metadata?.artist)
        assertEquals("Dehors", metadata?.album)

        val artwork = metadata?.artwork
        assertTrue("Android 未能定位真实 MP3 的内嵌封面", artwork != null && artwork.length > 0)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        file.inputStream().use { input ->
            assertTrue(input.skipExactlyForTest(artwork!!.offset))
            BitmapFactory.decodeStream(input, null, bounds)
        }
        assertEquals(4096, bounds.outWidth)
        assertEquals(4096, bounds.outHeight)

        var sampleSize = 1
        while (bounds.outWidth / sampleSize > 1024 || bounds.outHeight / sampleSize > 1024) sampleSize *= 2
        val sampled = file.inputStream().use { input ->
            assertTrue(input.skipExactlyForTest(artwork!!.offset))
            BitmapFactory.decodeStream(input, null, BitmapFactory.Options().apply { inSampleSize = sampleSize })
        }
        assertTrue("超大封面没有被安全采样", sampled != null && sampled.width <= 1024 && sampled.height <= 1024)
        sampled?.recycle()

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val repository = DownloadDirectoryRepository(
            context,
            SecureSettingsStore(context),
            MinioMusicRepository(),
        )
        val cachedPath = repository.cacheId3ArtworkOrThrow(DocumentFile.fromFile(file), artwork!!)
        assertTrue("应用封面缓存链路没有生成文件", cachedPath != null && File(cachedPath).isFile)
        val cached = BitmapFactory.decodeFile(cachedPath)
        assertTrue("应用生成的封面缓存无法解码", cached != null && cached.width <= 1024 && cached.height <= 1024)
        cached?.recycle()

        val lyrics = file.inputStream().use(Id3LyricsParser::parse)
        assertFalse("Android 未能解析真实 MP3 的同步歌词", lyrics.isNullOrEmpty())
    }
}

private fun java.io.InputStream.skipExactlyForTest(byteCount: Long): Boolean {
    var remaining = byteCount
    while (remaining > 0) {
        val skipped = skip(remaining)
        if (skipped > 0) remaining -= skipped
        else if (read() >= 0) remaining--
        else return false
    }
    return true
}
