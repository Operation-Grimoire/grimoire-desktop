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
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files
import java.nio.file.Path
import java.util.zip.GZIPOutputStream

class BackupTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val key = NovelKey(2131674332640181973L, "https://example.com/novel/7")

    private fun chapters(count: Int) = (1..count).map {
        Chapter("/c/$it", "Chapter $it", uploadDate = it * 1000L, chapterNumber = it.toFloat())
    }

    private fun novel(title: String = "Seven Seas") = Novel(
        url = key.url, title = title, language = Language.EN, author = "A. Writer",
        thumbnailUrl = "https://example.com/c.jpg", status = NovelStatus.ONGOING,
        genres = listOf("Fantasy", "Action"), initialized = true,
    )

    /** The shape Android's BackupManager writes (BackupFile version 2), gzipped. */
    private fun androidBackup(dir: Path, version: Int = 2): Path {
        val json = """
        {"version":$version,"createdAt":1700000000000,"appVersionCode":42,"appVersionName":"0.9.0",
         "categories":[{"name":"Default","order":0,"isDefault":true,"isHidden":false},
                       {"name":"Cultivation","order":1,"isDefault":false,"isHidden":false}],
         "repos":[{"name":"Community","indexUrl":"https://repo.example/index.json","enabled":true,"addedAt":1}],
         "preferences":[{"key":"theme","type":"string","value":"dark"}],
         "nuBookmarks":[],
         "novels":[
          {"sourceId":${key.sourceId},"url":"${key.url}","title":"Seven Seas","thumbnailUrl":"https://example.com/c.jpg",
           "author":"天运老猫","description":"Line<br>two","genres":"Fantasy, Action","status":1,"favorite":true,
           "lastUpdated":1690000000000,"chapterSortOrder":1,"categoryName":"Cultivation","lastReadAt":1695000000000,
           "rating":4.5,"ratingCount":10,"userRating":8,"notifyOnNewChapters":true,"language":"English",
           "readerTextAlign":4,"overrideTitle":"My Title","overrideStatus":2,
           "chapters":[
             {"url":"/c/1","name":"Chapter 1","uploadDate":1000,"chapterNumber":1.0,"read":true,"readProgress":1.0},
             {"url":"/c/2","name":"Chapter 2","uploadDate":2000,"chapterNumber":2.0,"read":true,"readProgress":1.0,
              "readAnchorItemIndex":3,"readAnchorItemOffset":10,"firstReadAt":5},
             {"url":"/c/3","name":"Chapter 3","uploadDate":3000,"chapterNumber":3.0,"read":false,"readProgress":0.4}]},
          {"sourceId":0,"url":"local://book.epub","title":"Imported","favorite":true,"chapters":[]}
         ],
         "unknownFutureField":{"x":1}}
        """.trimIndent()
        val file = dir.resolve("android_backup.json.gz")
        GZIPOutputStream(Files.newOutputStream(file)).use { it.write(json.toByteArray(Charsets.UTF_8)) }
        return file
    }

    @Test
    fun readsAndroidBackup() {
        val contents = readBackup(androidBackup(temp.newFolder().toPath()))
        assertEquals(2, contents.version)
        assertEquals(2, contents.novels.size)
        val n = contents.novels.first()
        assertEquals(key, n.key)
        assertEquals("天运老猫", n.novel.author)
        assertEquals(listOf("Fantasy", "Action"), n.novel.genres)
        assertEquals(NovelStatus.entries[1], n.novel.status)
        assertEquals(Language.EN, n.novel.language)
        assertEquals(setOf("/c/1", "/c/2"), n.readChapters)
        assertEquals(3, n.chapters.size)
        assertEquals(ChapterSort.NUMBER_DESC, n.chapterSortOrder)
        assertEquals(ReaderTextAlign.JUSTIFY, n.readerTextAlign)
        assertEquals("My Title", n.overrides.title)
        assertEquals(NovelStatus.entries[2], n.overrides.status)
        assertEquals("Cultivation", n.categoryName)
        assertEquals(listOf("https://repo.example/index.json"), contents.repositories.map { it.indexUrl })
    }

    @Test
    fun refusesNewerBackupFormat() {
        val failure = runCatching { readBackup(androidBackup(temp.newFolder().toPath(), version = 3)) }.exceptionOrNull()
        assertTrue(failure?.message.orEmpty().contains("newer Grimoire"))
    }

    @Test
    fun importMergesWithoutLosingLocalState() {
        val dir = temp.newFolder().toPath()
        val entry = readBackup(androidBackup(dir)).novels.first()
        LocalLibrary(dir.resolve("lib")).use { lib ->
            // This computer already has the novel with a full list, a rating and a custom author.
            lib.remember(key, novel(), chapters(10))
            lib.updateBookMetadata(key) { it.copy(userRating = 3, overrides = NovelOverrides(author = "Mine")) }
            val cat = lib.ensureCategory("Cultivation", hidden = false)
            val stored = lib.importBackupNovel(entry, cat, now = 1L)
            assertTrue(stored.favorite)
            assertEquals(10, stored.chapters.size)
            assertFalse(stored.chaptersIncomplete)
            assertEquals(8, stored.userRating)
            assertEquals("My Title", stored.overrides.title)
            assertEquals("Mine", stored.overrides.author)
            assertEquals(cat, stored.categoryId)
            assertEquals(1695000000000L, stored.lastReadAt)
            assertEquals(cat, lib.ensureCategory("cultivation", hidden = false))
        }
    }

    @Test
    fun newNovelIsIncompleteAndCompletesWithoutFeedEntries() {
        val dir = temp.newFolder().toPath()
        val entry = readBackup(androidBackup(dir)).novels.first()
        LocalLibrary(dir.resolve("lib")).use { lib ->
            val stored = lib.importBackupNovel(entry, null, now = 1L)
            assertTrue(stored.chaptersIncomplete)
            assertEquals(3, stored.chapters.size)
            val outcome = lib.applyRefresh(key, novel(), chapters(400), requireFavorite = true, now = 2L)
            assertEquals(RefreshOutcome.Updated(0), outcome)
            val after = lib.book(key)!!
            assertFalse(after.chaptersIncomplete)
            assertEquals(400, after.chapters.size)
            assertTrue(lib.libraryUpdates().isEmpty())
            // The next refresh reports real news again.
            assertEquals(1, lib.applyRefresh(key, novel(), chapters(401), requireFavorite = true, now = 3L).newChapters)
        }
    }

    @Test
    fun truncatedFirstRefreshKeepsRestoredReadState() = runBlocking {
        val dir = temp.newFolder().toPath()
        LocalLibrary(dir.resolve("lib")).use { lib ->
            // 30 restored read chapters; the throttled source then returns only 5 of them.
            val restored = chapters(30)
            val entry = readBackup(androidBackup(dir)).novels.first().copy(
                chapters = restored, readChapters = restored.mapTo(HashSet()) { it.url })
            lib.importBackupNovel(entry, null, now = 1L)
            val facade = ReadingStateFacade(DesktopReadingStateDao(lib), backfill = null)
            entry.readChapters.forEach { url ->
                facade.prepareExplicit(ReadingCompletionInput.MarkRead(ChapterKey(key, url), 10L))?.let { facade.submit(it) }
            }
            val outcome = lib.applyRefresh(key, novel(), chapters(5), requireFavorite = true, now = 2L)
            assertEquals(RefreshOutcome.Updated(0, ISSUE_CHAPTER_LIST_CHANGED), outcome)
            val after = lib.book(key)!!
            assertEquals(30, after.readChapters.size)
            assertTrue("a later refresh must still complete the list", after.chaptersIncomplete)
        }
    }

    @Test
    fun desktopBackupRoundTripsReadStateAndMetadata() = runBlocking {
        val dir = temp.newFolder().toPath()
        val file = dir.resolve("out/grimoire_backup.json.gz")
        LocalLibrary(dir.resolve("a")).use { lib ->
            lib.remember(key, novel(), chapters(5))
            lib.favorite(key, true)
            val cat = lib.ensureCategory("Reading", hidden = true)
            lib.updateBookMetadata(key) {
                it.copy(categoryId = cat, userRating = 9, chapterSortOrder = ChapterSort.DATE_DESC,
                    overrides = NovelOverrides(title = "Renamed", genres = listOf("Sci-Fi")))
            }
            val facade = ReadingStateFacade(DesktopReadingStateDao(lib), backfill = null)
            listOf("/c/1", "/c/2").forEach { url ->
                facade.prepareExplicit(ReadingCompletionInput.MarkRead(ChapterKey(key, url), 10L))?.let { facade.submit(it) }
            }
            writeBackup(file, lib.allBooks(), lib.categories(), emptyList(), "test", 99L)
        }
        // Android-compatible shape.
        val root = JSONObject(String(java.util.zip.GZIPInputStream(Files.newInputStream(file)).readBytes()))
        assertEquals(2, root.getInt("version"))
        val n = root.getJSONArray("novels").getJSONObject(0)
        assertEquals(key.sourceId, n.getLong("sourceId"))
        assertEquals("Reading", n.getString("categoryName"))
        assertEquals(ChapterSort.DATE_DESC.ordinal, n.getInt("chapterSortOrder"))
        assertEquals(2, n.getJSONArray("chapters").length())

        val contents = readBackup(file)
        LocalLibrary(dir.resolve("b")).use { lib ->
            val cat = lib.ensureCategory("Reading", hidden = true)
            val entry = contents.novels.single()
            lib.importBackupNovel(entry, cat, now = 1L)
            val facade = ReadingStateFacade(DesktopReadingStateDao(lib), backfill = null)
            entry.readChapters.forEach { url ->
                facade.prepareExplicit(ReadingCompletionInput.MarkRead(ChapterKey(key, url), 10L))?.let { facade.submit(it) }
            }
            val restored = lib.book(key)!!
            assertEquals(setOf("/c/1", "/c/2"), restored.readChapters)
            assertEquals("Renamed", restored.effectiveNovel().title)
            assertEquals(listOf("Sci-Fi"), restored.effectiveNovel().genres)
            assertEquals(9, restored.userRating)
            assertEquals(cat, restored.categoryId)
            assertTrue(lib.categories().single().isHidden)
        }
    }

    @Test
    fun languageAcceptsDisplayNameCodeAndName() {
        assertEquals(Language.EN, languageOf("English"))
        assertEquals(Language.EN, languageOf("en"))
        assertEquals(Language.EN, languageOf("EN"))
        assertEquals(Language.UNKNOWN, languageOf(null))
    }
}
