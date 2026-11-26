package io.grimoire.desktop

import io.grimoire.api.model.lang.Language
import io.grimoire.api.model.novel.Chapter
import io.grimoire.api.model.novel.Novel
import io.grimoire.api.model.novel.NovelStatus
import io.grimoire.reading.ChapterKey
import io.grimoire.reading.NovelKey
import io.grimoire.reading.state.ReadingCompletionInput
import io.grimoire.reading.state.ReadingStateFacade
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CoreParityTest {
    @get:Rule
    val temp = TemporaryFolder()

    private fun sampleNovel(url: String = "/novel/1") = Novel(
        url = url,
        title = "The Arcane Archive",
        language = Language.EN,
        author = "Mira Vance",
        description = "Original synopsis",
        status = NovelStatus.ONGOING,
        genres = listOf("Fantasy", "Progression"),
        initialized = true,
    )

    private fun sampleChapters() = listOf(
        Chapter("/ch/1", "Chapter 1", uploadDate = 1000L, chapterNumber = 1f),
        Chapter("/ch/2", "Chapter 2", uploadDate = 2000L, chapterNumber = 2f),
        Chapter("/ch/3", "Chapter 3 (Locked)", uploadDate = 3000L, chapterNumber = 3f, locked = true),
    )

    @Test
    fun categoriesCreateRenameDeleteAndDetachBooks() {
        val dir = temp.newFolder().toPath()
        val key = NovelKey(42L, "/novel/1")
        LocalLibrary(dir).use { lib ->
            lib.remember(key, sampleNovel(), sampleChapters())
            lib.favorite(key, true)

            val created = lib.createCategory("Reading Now")
            assertEquals(1, created.size)
            val catId = created.single().id

            lib.updateBookMetadata(key) { it.copy(categoryId = catId, userRating = 9, chapterSortOrder = ChapterSort.DATE_DESC) }
            val loaded = lib.book(key)!!
            assertEquals(catId, loaded.categoryId)
            assertEquals(9, loaded.userRating)
            assertEquals(ChapterSort.DATE_DESC, loaded.chapterSortOrder)

            val renamed = lib.renameCategory(catId, "Active")
            assertEquals("Active", renamed.single().name)

            val afterDelete = lib.deleteCategory(catId)
            assertTrue(afterDelete.isEmpty())
            assertNull(lib.book(key)!!.categoryId)
        }
    }

    @Test
    fun metadataOverridesSurviveSourceRefreshAndRestart() {
        val dir = temp.newFolder().toPath()
        val key = NovelKey(42L, "/novel/1")
        val overrides = NovelOverrides(
            title = "Custom Title",
            author = "Custom Author",
            status = NovelStatus.COMPLETED,
            genres = listOf("Sci-Fi"),
            customCoverUrl = "https://example.com/custom.jpg",
        )
        LocalLibrary(dir).use { lib ->
            lib.remember(key, sampleNovel(), sampleChapters())
            lib.favorite(key, true)
            lib.updateBookMetadata(key) { it.copy(overrides = overrides, readerTextAlign = ReaderTextAlign.JUSTIFY) }
            // Simulate a source refresh with updated source metadata.
            lib.remember(key, sampleNovel().copy(title = "Refreshed Source Title"), sampleChapters())
        }
        LocalLibrary(dir).use { lib ->
            val reloaded = lib.book(key)!!
            assertEquals("Refreshed Source Title", reloaded.novel.title)
            assertEquals("Custom Title", reloaded.effectiveNovel().title)
            assertEquals("Custom Author", reloaded.effectiveNovel().author)
            assertEquals(NovelStatus.COMPLETED, reloaded.effectiveNovel().status)
            assertEquals(listOf("Sci-Fi"), reloaded.effectiveNovel().genres)
            assertEquals("https://example.com/custom.jpg", reloaded.effectiveNovel().thumbnailUrl)
            assertEquals(ReaderTextAlign.JUSTIFY, reloaded.readerTextAlign)
        }
    }

    @Test
    fun readingStatesPersistAcrossReopen() = runBlocking {
        val dir = temp.newFolder().toPath()
        val key = NovelKey(42L, "/novel/1")
        LocalLibrary(dir).use { lib ->
            lib.remember(key, sampleNovel(), sampleChapters())
            val facade = ReadingStateFacade(DesktopReadingStateDao(lib), backfill = null)
            val ch1 = ChapterKey(key, "/ch/1")
            val cmd = facade.prepareExplicit(ReadingCompletionInput.MarkRead(ch1, 5000L))!!
            facade.submit(cmd)
            assertEquals(setOf("/ch/1"), lib.book(key)!!.readChapters)
        }
        LocalLibrary(dir).use { lib ->
            assertEquals(setOf("/ch/1"), lib.book(key)!!.readChapters)
            val facade = ReadingStateFacade(DesktopReadingStateDao(lib), backfill = null)
            val ch1 = ChapterKey(key, "/ch/1")
            val unread = facade.prepareExplicit(ReadingCompletionInput.MarkUnread(ch1))!!
            facade.submit(unread)
            assertTrue(lib.book(key)!!.readChapters.isEmpty())
        }
    }
}
