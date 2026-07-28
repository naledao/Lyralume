package androidx.documentfile.provider

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.lyralume.android.data.deleteAuthorizedAudioSource
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SourceDeletionInstrumentedTest {
    @Test
    fun deletesOnlyTheExactAudioInsideTheAuthorizedTree() {
        val root = FakeDocument(null, "root", "content://test/root", directory = true)
        val folder = root.child("music", "content://test/music", directory = true)
        val audio = folder.child("song.MP3", "content://test/song")
        val lyrics = folder.child("song.lrc", "content://test/lyrics")

        assertTrue(deleteAuthorizedAudioSource(root, audio.uri))
        assertTrue(audio.wasDeleted)
        assertFalse(lyrics.wasDeleted)
    }

    @Test
    fun refusesFilesOutsideTheAuthorizedTreeAndNonAudioSidecars() {
        val root = FakeDocument(null, "root", "content://test/root", directory = true)
        val lyrics = root.child("song.lrc", "content://test/lyrics")
        val outside = FakeDocument(null, "outside.mp3", "content://test/outside")

        assertFalse(deleteAuthorizedAudioSource(root, outside.uri))
        assertFalse(outside.wasDeleted)
        assertThrows(IllegalStateException::class.java) {
            deleteAuthorizedAudioSource(root, lyrics.uri)
        }
        assertFalse(lyrics.wasDeleted)
    }

    private class FakeDocument(
        parent: DocumentFile?,
        private val displayName: String,
        uri: String,
        private val directory: Boolean = false,
        private val writable: Boolean = true,
    ) : DocumentFile(parent) {
        private val documentUri = Uri.parse(uri)
        private val children = mutableListOf<FakeDocument>()
        private var present = true
        var wasDeleted = false
            private set

        fun child(name: String, uri: String, directory: Boolean = false): FakeDocument =
            FakeDocument(this, name, uri, directory).also(children::add)

        override fun createFile(mimeType: String, displayName: String): DocumentFile? = null
        override fun createDirectory(displayName: String): DocumentFile? = null
        override fun getUri(): Uri = documentUri
        override fun getName(): String = displayName
        override fun getType(): String = if (directory) "vnd.android.document/directory" else "audio/mpeg"
        override fun isDirectory(): Boolean = directory
        override fun isFile(): Boolean = !directory
        override fun isVirtual(): Boolean = false
        override fun lastModified(): Long = 0L
        override fun length(): Long = 0L
        override fun canRead(): Boolean = present
        override fun canWrite(): Boolean = present && writable
        override fun delete(): Boolean {
            if (!writable || !present) return false
            wasDeleted = true
            present = false
            return true
        }
        override fun exists(): Boolean = present
        override fun listFiles(): Array<DocumentFile> = children.map { it as DocumentFile }.toTypedArray()
        override fun renameTo(displayName: String): Boolean = false
    }
}
