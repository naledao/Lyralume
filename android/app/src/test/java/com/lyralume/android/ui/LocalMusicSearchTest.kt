package com.lyralume.android.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalMusicSearchTest {
    @Test
    fun matchesTitleArtistAlbumAndFileNameIgnoringCase() {
        val fields = SearchFields(
            title = "Beautiful World",
            artist = "宇多田ヒカル",
            album = "Kiss & Cry",
            fileName = "Track-09.FLAC",
        )

        assertTrue(fields.matches("beautiful"))
        assertTrue(fields.matches("宇多田"))
        assertTrue(fields.matches("kiss"))
        assertTrue(fields.matches("track-09.flac"))
    }

    @Test
    fun requiresEverySearchTermWhileAllowingTermsFromDifferentFields() {
        val fields = SearchFields(
            title = "All Alone With You",
            artist = "EGOIST",
            album = "Greatest Hits",
            fileName = "all-alone.mp3",
        )

        assertTrue(fields.matches("  alone   egoist "))
        assertFalse(fields.matches("alone aimer"))
    }

    @Test
    fun blankSearchShowsEveryTrack() {
        assertTrue(SearchFields().matches("   "))
    }

    private data class SearchFields(
        val title: String = "",
        val artist: String = "",
        val album: String = "",
        val fileName: String = "",
    ) {
        fun matches(query: String): Boolean = matchesLocalTrackSearch(
            query = query,
            title = title,
            artist = artist,
            album = album,
            fileName = fileName,
        )
    }
}
