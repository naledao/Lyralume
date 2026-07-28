package com.lyralume.android.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureSettingsStoreInstrumentedTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var store: SecureSettingsStore

    @Before
    fun setUp() {
        context.getSharedPreferences("lyralume-settings", Context.MODE_PRIVATE)
            .edit().clear().commit()
        store = SecureSettingsStore(context)
    }

    @After
    fun tearDown() {
        context.getSharedPreferences("lyralume-settings", Context.MODE_PRIVATE)
            .edit().clear().commit()
    }

    @Test
    fun encryptsRestoresAndClearsMinioPassword() {
        val snapshot = store.saveMinio(
            endpoint = "minio.example.test:9000",
            bucket = "lyralume-music",
            accessKey = "android-reader",
            secretKey = " test-secret ",
        )

        assertTrue(snapshot.secretConfigured)
        assertEquals("http://minio.example.test:9000", snapshot.endpoint)
        assertEquals(" test-secret ", store.connection()?.secretKey)
        assertFalse(
            context.getSharedPreferences("lyralume-settings", Context.MODE_PRIVATE)
                .all.values.any { it == " test-secret " },
        )

        assertFalse(store.clearMinio().secretConfigured)
        assertEquals(null, store.connection())
    }
}
