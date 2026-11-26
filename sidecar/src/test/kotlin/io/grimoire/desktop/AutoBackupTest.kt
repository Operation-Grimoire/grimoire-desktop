package io.grimoire.desktop

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files
import java.time.LocalDateTime
import java.util.UUID

class AutoBackupTest {
    @get:Rule
    val temp = TemporaryFolder()

    private fun autoName(minute: Int) = autoBackupFileName(LocalDateTime.of(2026, 1, 1, 10, minute), UUID.randomUUID())

    @Test
    fun nameMatchesAndroidPattern() {
        val name = autoBackupFileName(LocalDateTime.of(2026, 3, 4, 5, 6, 7, 89_000_000), UUID(0, 1))
        assertEquals("grimoire_auto_backup_2026-03-04_050607_089_00000000-0000-0000-0000-000000000001.json.gz", name)
    }

    @Test
    fun keepsNewestSevenOwnedAutomaticBackupsOnly() {
        val folder = temp.newFolder().toPath()
        val names = (0 until 10).map(::autoName)
        names.forEach { Files.writeString(folder.resolve(it), "x") }
        // Not ours: an Android auto backup synced into the folder, and a manual backup.
        val foreign = autoName(30).also { Files.writeString(folder.resolve(it), "x") }
        Files.writeString(folder.resolve("grimoire_backup_2026-01-01_100000.json.gz"), "x")
        val current = folder.resolve(names.last())

        val deleted = autoBackupsToDelete(folder, names.toSet(), current).map { it.fileName.toString() }.toSet()
        assertEquals(names.take(3).toSet(), deleted)
        assertFalse(foreign in deleted)
    }

    @Test
    fun neverPrunesWhenTheNewBackupIsMissing() {
        val folder = temp.newFolder().toPath()
        val names = (0 until 10).map(::autoName)
        names.forEach { Files.writeString(folder.resolve(it), "x") }
        assertTrue(autoBackupsToDelete(folder, names.toSet() + "gone", folder.resolve("gone")).isEmpty())
    }

    @Test
    fun schedule() {
        val settings = AutoBackupSettings(enabled = true, folder = "/b", intervalHours = 24)
        assertNull(nextAutoBackupAt(settings.copy(enabled = false), null))
        assertNull(nextAutoBackupAt(settings.copy(folder = ""), null))
        assertEquals(0L, nextAutoBackupAt(settings, null))
        assertEquals(1_000L + 24 * 3_600_000L, nextAutoBackupAt(settings, AutoBackupStatus(1_000L, true, "ok")))
        // A failure retries within the hour instead of waiting a whole day.
        assertEquals(1_000L + AUTO_BACKUP_RETRY_MS, nextAutoBackupAt(settings, AutoBackupStatus(1_000L, false, "no")))
    }

    @Test
    fun settingsAndStatusPersist() {
        LocalLibrary(temp.newFolder().toPath()).use { lib ->
            assertEquals(AutoBackupSettings(), lib.autoBackupSettings())
            val settings = AutoBackupSettings(enabled = true, folder = "D:\\Backups", intervalHours = 72)
            lib.setAutoBackupSettings(settings)
            assertEquals(settings, lib.autoBackupSettings())
            val status = AutoBackupStatus(5L, false, "Backup folder not found", null)
            lib.setLastAutoBackup(status)
            assertEquals(status, lib.lastAutoBackup())
            lib.setOwnedAutoBackups(listOf("a", "b"))
            assertEquals(setOf("a", "b"), lib.ownedAutoBackups())
        }
        assertEquals(AutoBackupSettings(), AutoBackupSettings.decode("{broken"))
    }
}
