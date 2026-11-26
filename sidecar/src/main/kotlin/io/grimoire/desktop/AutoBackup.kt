package io.grimoire.desktop

import org.json.JSONArray
import org.json.JSONObject
import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

/** Android keeps the newest seven automatic backups; desktop does the same. */
internal const val AUTO_BACKUP_RETENTION = 7

/** A failed automatic backup tries again after this long, or after the interval if that is shorter. */
internal const val AUTO_BACKUP_RETRY_MS = 60 * 60 * 1000L

/** Android's automatic backup name, so either app's pruning recognises the other's files. */
private val autoBackupName = Regex(
    "grimoire_auto_backup_\\d{4}-\\d{2}-\\d{2}_\\d{6}_\\d{3}_" +
        "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.json\\.gz",
)

data class AutoBackupSettings(
    val enabled: Boolean = false,
    /** Absolute folder path; blank until the user picks one. */
    val folder: String = "",
    val intervalHours: Int = 24,
) {
    fun normalized() = copy(folder = folder.trim(), intervalHours = intervalHours.coerceIn(1, MAX_INTERVAL_HOURS))

    fun encode(): String = JSONObject()
        .put("enabled", enabled).put("folder", folder).put("intervalHours", intervalHours).toString()

    companion object {
        const val MAX_INTERVAL_HOURS = 24 * 30

        fun decode(text: String?): AutoBackupSettings {
            val root = text?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return AutoBackupSettings()
            val d = AutoBackupSettings()
            return AutoBackupSettings(
                enabled = root.optBoolean("enabled", d.enabled),
                folder = root.optString("folder", d.folder),
                intervalHours = root.optInt("intervalHours", d.intervalHours),
            ).normalized()
        }
    }
}

/** The outcome of the last automatic backup attempt. */
data class AutoBackupStatus(
    val at: Long,
    val success: Boolean,
    val message: String,
    val fileName: String? = null,
) {
    fun encode(): String = JSONObject()
        .put("at", at).put("success", success).put("message", message)
        .put("fileName", fileName ?: JSONObject.NULL).toString()

    companion object {
        fun decode(text: String?): AutoBackupStatus? {
            val root = text?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
            return AutoBackupStatus(
                root.optLong("at", 0L), root.optBoolean("success", false), root.optString("message", ""),
                if (root.isNull("fileName")) null else root.optString("fileName"),
            )
        }
    }
}

/** When the next automatic backup is due, or null when automatic backups are off. */
internal fun nextAutoBackupAt(settings: AutoBackupSettings, last: AutoBackupStatus?): Long? {
    if (!settings.enabled || settings.folder.isBlank()) return null
    if (last == null) return 0L
    val interval = settings.intervalHours * 3_600_000L
    return last.at + if (last.success) interval else minOf(interval, AUTO_BACKUP_RETRY_MS)
}

internal fun autoBackupFileName(now: LocalDateTime = LocalDateTime.now(), id: UUID = UUID.randomUUID()): String =
    "grimoire_auto_backup_${now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HHmmss_SSS"))}_$id.json.gz"

/**
 * Automatic backups in [folder] to delete after [current] was written: only files this app
 * wrote ([owned]) with the automatic name, keeping the newest [AUTO_BACKUP_RETENTION] in all.
 * Manual backups and other apps' files are never touched.
 */
internal fun autoBackupsToDelete(folder: Path, owned: Set<String>, current: Path): List<Path> {
    if (!Files.isRegularFile(current)) return emptyList()
    val ours = Files.list(folder).use { files ->
        files.filter { Files.isRegularFile(it) }.toList()
    }.filter { it.fileName.toString() in owned && autoBackupName.matches(it.fileName.toString()) }
    return ours.filter { it.fileName != current.fileName }
        .sortedByDescending { it.fileName.toString() }
        .drop(AUTO_BACKUP_RETENTION - 1)
}

internal fun encodeOwnedBackups(names: Collection<String>): String = JSONArray(names.toList()).toString()

internal fun decodeOwnedBackups(text: String?): Set<String> {
    val array = text?.let { runCatching { JSONArray(it) }.getOrNull() } ?: return emptySet()
    return (0 until array.length()).mapNotNullTo(LinkedHashSet()) { array.optString(it).takeIf(String::isNotBlank) }
}
