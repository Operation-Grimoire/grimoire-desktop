package io.grimoire.desktop

import io.grimoire.api.model.lang.Language
import io.grimoire.api.model.novel.Chapter
import io.grimoire.api.model.novel.Novel
import io.grimoire.api.model.novel.NovelStatus
import io.grimoire.reading.NovelKey
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LibraryUpdateTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val key = NovelKey(7L, "/novel/7")

    private fun novel(title: String = "Seven Seas", cover: String? = "https://example.com/c.jpg") = Novel(
        url = key.url, title = title, language = Language.EN, author = "A. Writer",
        thumbnailUrl = cover, status = NovelStatus.ONGOING, initialized = true,
    )

    private fun chapters(count: Int, lockedFrom: Int = Int.MAX_VALUE) = (1..count).map {
        Chapter("/c/$it", "Chapter $it", uploadDate = it * 1000L, chapterNumber = it.toFloat(), locked = it >= lockedFrom)
    }

    @Test
    fun planDetectsNewAndUnlockedChapters() {
        val plan = planChapterRefresh(chapters(3, lockedFrom = 3), chapters(5))
        val found = (plan as ChapterRefreshPlan.Apply).found
        assertEquals(listOf("/c/3", "/c/4", "/c/5"), found.map { it.chapter.url })
        assertEquals(listOf(true, false, false), found.map { it.unlocked })
    }

    @Test
    fun planKeepsListOnEmptyOrTruncatedFetch() {
        assertEquals(ChapterRefreshPlan.Keep(ISSUE_NO_CHAPTERS), planChapterRefresh(chapters(3), emptyList()))
        assertEquals(ChapterRefreshPlan.Keep(ISSUE_CHAPTER_LIST_CHANGED), planChapterRefresh(chapters(40), chapters(10)))
        // Short lists may legitimately shrink.
        assertTrue(planChapterRefresh(chapters(10), chapters(2)) is ChapterRefreshPlan.Apply)
    }

    @Test
    fun firstChapterListIsNotNews() {
        assertEquals(ChapterRefreshPlan.Apply(emptyList()), planChapterRefresh(emptyList(), chapters(12)))
    }

    @Test
    fun mergeKeepsGoodMetadataWhenSourceReturnsBlanks() {
        val merged = mergeNovelMetadata(novel(), novel(title = " ", cover = null).copy(status = NovelStatus.UNKNOWN))
        assertEquals("Seven Seas", merged.title)
        assertEquals("https://example.com/c.jpg", merged.thumbnailUrl)
        assertEquals(NovelStatus.ONGOING, merged.status)
        assertTrue(metadataRegressed(novel(), novel(cover = null)))
    }

    @Test
    fun refreshLogsFeedEntriesAndPersistsAcrossRestart() {
        val dir = temp.newFolder().toPath()
        LocalLibrary(dir).use { lib ->
            lib.remember(key, novel(), chapters(3, lockedFrom = 3))
            lib.favorite(key, true)
            val outcome = lib.applyRefresh(key, novel(), chapters(4), requireFavorite = true, now = 50_000L)
            assertEquals(RefreshOutcome.Updated(2), outcome)
            assertEquals(50_000L, lib.book(key)!!.lastUpdated)
        }
        LocalLibrary(dir).use { lib ->
            val feed = lib.libraryUpdates()
            assertEquals(listOf("/c/4", "/c/3"), feed.map { it.key.url })
            assertTrue(feed.single { it.key.url == "/c/3" }.unlocked)
            assertTrue(lib.updateIssues().isEmpty())
            assertEquals(4, lib.book(key)!!.chapters.size)
        }
    }

    @Test
    fun truncatedRefreshKeepsChaptersAndRecordsWarning() {
        val dir = temp.newFolder().toPath()
        LocalLibrary(dir).use { lib ->
            lib.remember(key, novel(), chapters(30))
            lib.favorite(key, true)
            val outcome = lib.applyRefresh(key, novel(title = "Renamed"), chapters(5), requireFavorite = true, now = 1L)
            assertEquals(RefreshOutcome.Updated(0, ISSUE_CHAPTER_LIST_CHANGED), outcome)
            val book = lib.book(key)!!
            assertEquals(30, book.chapters.size)
            assertEquals("Renamed", book.novel.title)
            val issue = lib.updateIssues().single()
            assertEquals(UpdateIssueSeverity.WARNING, issue.severity)
            assertEquals(ISSUE_CHAPTER_LIST_CHANGED, issue.message)
            // A clean refresh clears the issue.
            lib.applyRefresh(key, novel(), chapters(31), requireFavorite = true, now = 2L)
            assertTrue(lib.updateIssues().isEmpty())
            assertEquals(listOf("/c/31"), lib.libraryUpdates().map { it.key.url })
        }
    }

    @Test
    fun removedFromLibraryIsSkippedAndBrowsedNovelsDoNotFeed() {
        val dir = temp.newFolder().toPath()
        LocalLibrary(dir).use { lib ->
            lib.remember(key, novel(), chapters(3))
            assertEquals(RefreshOutcome.Skipped, lib.applyRefresh(key, novel(), chapters(4), requireFavorite = true, now = 1L))
            val manual = lib.applyRefresh(key, novel(), chapters(4), requireFavorite = false, now = 1L)
            assertEquals(1, manual.newChapters)
            assertTrue(lib.libraryUpdates().isEmpty())
            // A truncated response for a browsed novel reports back without a library issue.
            val kept = lib.applyRefresh(key, novel(), emptyList(), requireFavorite = false, now = 2L)
            assertEquals(RefreshOutcome.Updated(0, ISSUE_NO_CHAPTERS), kept)
            assertTrue(lib.updateIssues().isEmpty())
            assertEquals(4, lib.book(key)!!.chapters.size)
        }
    }

    @Test
    fun feedEntriesForVanishedChaptersAreDropped() {
        val dir = temp.newFolder().toPath()
        LocalLibrary(dir).use { lib ->
            lib.remember(key, novel(), chapters(3))
            lib.favorite(key, true)
            lib.applyRefresh(key, novel(), chapters(4), requireFavorite = true, now = 1L)
            assertEquals(1, lib.libraryUpdates().size)
            lib.applyRefresh(key, novel(), chapters(3), requireFavorite = true, now = 2L)
            assertTrue(lib.libraryUpdates().isEmpty())
        }
    }

    @Test
    fun failuresAreDescribedInPlainWords() {
        assertEquals("The source took too long to respond", describe(java.net.SocketTimeoutException("timeout")))
        assertEquals("Could not reach the source", describe(java.net.UnknownHostException("x.example")))
        assertTrue(describe(IllegalStateException("HTTP 429 Too Many Requests")).contains("HTTP 429"))
        assertEquals("The source could not be read", describe(IllegalStateException()))
        assertFalse(describe(org.json.JSONException("bad")).contains("JSONException"))
    }

    @Test
    fun settingsAndSummaryRoundTrip() {
        val dir = temp.newFolder().toPath()
        LocalLibrary(dir).use { lib ->
            assertEquals(LibraryUpdateSettings(), lib.libraryUpdateSettings())
            lib.setLibraryUpdateSettings(LibraryUpdateSettings(updateOnLaunch = true, autoUpdate = true, intervalHours = 999, concurrency = 0))
            lib.setLastLibraryUpdate(LibraryUpdateSummary(9L, 3, 2, 1, 0, failed = true, categoryId = 4L))
            assertNull(lib.lastFullLibraryUpdate())
            lib.setLastFullLibraryUpdate(8L)
        }
        LocalLibrary(dir).use { lib ->
            val s = lib.libraryUpdateSettings()
            assertTrue(s.updateOnLaunch && s.autoUpdate)
            assertEquals(LibraryUpdateSettings.MAX_INTERVAL_HOURS, s.intervalHours)
            assertEquals(1, s.concurrency)
            assertEquals(LibraryUpdateSummary(9L, 3, 2, 1, 0, failed = true, categoryId = 4L), lib.lastLibraryUpdate())
            assertEquals(8L, lib.lastFullLibraryUpdate())
        }
        assertEquals(LibraryUpdateSettings(), LibraryUpdateSettings.decode("{not json"))
    }
}
