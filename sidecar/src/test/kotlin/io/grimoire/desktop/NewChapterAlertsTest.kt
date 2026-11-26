package io.grimoire.desktop

import io.grimoire.api.model.lang.Language
import io.grimoire.api.model.novel.Chapter
import io.grimoire.api.model.novel.Novel
import io.grimoire.reading.NovelKey
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.zip.GZIPInputStream
import java.nio.file.Files

class NewChapterAlertsTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val key = NovelKey(42L, "https://example.com/n/1")
    private val novel = Novel(url = key.url, title = "Seven Seas", language = Language.EN, initialized = true)
    private fun chapters(count: Int, lockedFrom: Int = Int.MAX_VALUE) = (1..count).map {
        Chapter("/c/$it", "Chapter $it", chapterNumber = it.toFloat(), locked = it >= lockedFrom)
    }

    @Test
    fun planFollowsEachSetting() {
        val found = chapters(5, lockedFrom = 4)
        assertEquals(NewChapterPlan(0, 0, emptyList()), planNewChapters(NewChapterAlerts(), found))
        assertEquals(NewChapterPlan(3, 0, emptyList()), planNewChapters(NewChapterAlerts(notify = true), found))
        assertEquals(NewChapterPlan(0, 2, emptyList()), planNewChapters(NewChapterAlerts(notifyLocked = true), found))
        // Locked chapters can't be fetched, so they are never queued.
        assertEquals(listOf("/c/1", "/c/2", "/c/3"), planNewChapters(NewChapterAlerts(autoDownload = true), found).download)
    }

    @Test
    fun refreshReportsTheChaptersItFound() {
        LocalLibrary(temp.newFolder().toPath()).use { lib ->
            lib.remember(key, novel, chapters(3))
            lib.favorite(key, true)
            val outcome = lib.applyRefresh(key, novel, chapters(5), requireFavorite = true, now = 1L) as RefreshOutcome.Updated
            assertEquals(listOf("/c/4", "/c/5"), outcome.found.map { it.url })
        }
    }

    @Test
    fun alertsPersistAndSurviveRefresh() {
        LocalLibrary(temp.newFolder().toPath()).use { lib ->
            lib.remember(key, novel, chapters(3))
            lib.updateBookMetadata(key) { it.copy(alerts = NewChapterAlerts(notify = true, autoDownload = true)) }
            lib.applyRefresh(key, novel, chapters(4), requireFavorite = false, now = 1L)
            assertEquals(NewChapterAlerts(notify = true, autoDownload = true), lib.book(key)!!.alerts)
        }
    }

    @Test
    fun backupCarriesAlertsAndRestoreKeepsEitherSide() {
        val dir = temp.newFolder().toPath()
        val file = dir.resolve("b.json.gz")
        LocalLibrary(dir.resolve("a")).use { lib ->
            lib.remember(key, novel, chapters(3))
            lib.favorite(key, true)
            lib.updateBookMetadata(key) { it.copy(alerts = NewChapterAlerts(notify = true)) }
            writeBackup(file, lib.allBooks(), lib.categories(), emptyList(), "test", 1L)
        }
        val n = JSONObject(String(GZIPInputStream(Files.newInputStream(file)).readBytes()))
            .getJSONArray("novels").getJSONObject(0)
        assertTrue(n.getBoolean("notifyOnNewChapters"))
        assertFalse(n.getBoolean("autoDownloadNewChapters"))

        val entry = readBackup(file).novels.single()
        LocalLibrary(dir.resolve("b")).use { lib ->
            lib.remember(key, novel, chapters(3))
            lib.updateBookMetadata(key) { it.copy(alerts = NewChapterAlerts(autoDownload = true)) }
            val restored = lib.importBackupNovel(entry, null, now = 2L)
            assertEquals(NewChapterAlerts(notify = true, autoDownload = true), restored.alerts)
        }
    }
}
