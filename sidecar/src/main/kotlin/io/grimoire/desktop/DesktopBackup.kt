package io.grimoire.desktop

import io.grimoire.api.model.lang.Language
import io.grimoire.api.model.novel.Chapter
import io.grimoire.api.model.novel.Novel
import io.grimoire.api.model.novel.NovelStatus
import io.grimoire.reading.NovelKey
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/**
 * Android's backup file (`BackupFile`, version 2): gzipped JSON. Desktop writes the same shape,
 * so a backup moves between the two apps in either direction.
 */
internal const val BACKUP_VERSION = 2

internal data class BackupNovel(
    val key: NovelKey,
    val novel: Novel,
    /** Only chapters with reading state; the source supplies the rest on the next refresh. */
    val chapters: List<Chapter>,
    val readChapters: Set<String>,
    val favorite: Boolean,
    val categoryName: String?,
    val lastReadAt: Long,
    val lastUpdated: Long,
    val userRating: Int?,
    val readerTextAlign: ReaderTextAlign,
    val chapterSortOrder: ChapterSort,
    val overrides: NovelOverrides,
    val alerts: NewChapterAlerts = NewChapterAlerts(),
)

internal data class BackupCategory(val name: String, val order: Int, val isDefault: Boolean, val isHidden: Boolean)

internal data class BackupRepository(val name: String, val indexUrl: String, val enabled: Boolean)

internal data class BackupContents(
    val version: Int,
    val createdAt: Long,
    val novels: List<BackupNovel>,
    val categories: List<BackupCategory>,
    val repositories: List<BackupRepository>,
)

internal fun readBackup(path: Path): BackupContents {
    val text = BufferedInputStream(Files.newInputStream(path)).use { raw ->
        raw.mark(2)
        val gzip = raw.read() == 0x1f && raw.read() == 0x8b
        raw.reset()
        (if (gzip) GZIPInputStream(raw) else raw).readBytes().toString(Charsets.UTF_8)
    }
    val root = try { JSONObject(text) } catch (failure: Exception) {
        throw IOException("This file is not a Grimoire backup", failure)
    }
    val version = root.optInt("version", 1)
    require(version <= BACKUP_VERSION) {
        "This backup was made by a newer Grimoire (format $version). Update Grimoire Desktop to restore it."
    }
    return BackupContents(
        version = version,
        createdAt = root.optLong("createdAt", 0L),
        novels = root.objects("novels").map(::decodeBackupNovel),
        categories = root.objects("categories").map {
            BackupCategory(it.getString("name"), it.optInt("order"), it.optBoolean("isDefault"), it.optBoolean("isHidden"))
        },
        repositories = root.objects("repos").map {
            BackupRepository(it.optString("name"), it.getString("indexUrl"), it.optBoolean("enabled", true))
        },
    )
}

private fun decodeBackupNovel(n: JSONObject): BackupNovel {
    val key = NovelKey(n.getLong("sourceId"), n.getString("url"))
    val chapters = n.objects("chapters").map { c ->
        Chapter(c.getString("url"), c.optString("name"), c.optLong("uploadDate", 0L),
            c.optDouble("chapterNumber", -1.0).toFloat(), locked = c.optNullableBoolean("locked") ?: false)
    }.distinctBy { it.url }
    val read = n.objects("chapters").filter { it.optBoolean("read") }.mapTo(LinkedHashSet()) { it.getString("url") }
    val novel = Novel(
        url = key.url,
        title = n.optString("title"),
        language = languageOf(n.optNullableString("language")),
        author = n.optNullableString("author"),
        description = n.optNullableString("description"),
        thumbnailUrl = n.optNullableString("thumbnailUrl"),
        genres = splitGenres(n.optString("genres")),
        status = statusOf(n.optInt("status", 0)),
        initialized = true,
    )
    return BackupNovel(
        key = key,
        novel = novel,
        chapters = chapters,
        readChapters = read,
        favorite = n.optBoolean("favorite"),
        categoryName = n.optNullableString("categoryName"),
        lastReadAt = n.optLong("lastReadAt", 0L),
        lastUpdated = n.optLong("lastUpdated", 0L),
        userRating = n.optNullableInt("userRating")?.coerceIn(1, 10),
        alerts = NewChapterAlerts(
            notify = n.optBoolean("notifyOnNewChapters", false),
            notifyLocked = n.optBoolean("notifyOnNewLockedChapters", false),
            autoDownload = n.optBoolean("autoDownloadNewChapters", false),
        ),
        readerTextAlign = ReaderTextAlign.entries.getOrElse(n.optInt("readerTextAlign", 0)) { ReaderTextAlign.AUTO },
        chapterSortOrder = ChapterSort.entries.getOrElse(n.optInt("chapterSortOrder", 0)) { ChapterSort.NUMBER_ASC },
        overrides = NovelOverrides(
            title = n.optNullableString("overrideTitle"),
            author = n.optNullableString("overrideAuthor"),
            description = n.optNullableString("overrideDescription"),
            status = n.optNullableInt("overrideStatus")?.let(::statusOf),
            genres = n.optNullableString("overrideGenres")?.let(::splitGenres),
            customCoverUrl = n.optNullableString("customCoverUrl"),
        ),
    )
}

/**
 * Writes a version-2 backup Android can restore: library novels plus any novel with read
 * chapters, each with only its read chapters, as Android does. Written to a temporary file
 * first so an interrupted save never leaves a truncated backup behind.
 */
internal fun writeBackup(
    path: Path,
    books: List<SavedBook>,
    categories: List<DesktopCategory>,
    repositories: List<RepositoryView>,
    appVersion: String,
    now: Long,
) {
    val categoryNames = categories.associate { it.id to it.name }
    val root = JSONObject()
        .put("version", BACKUP_VERSION)
        .put("createdAt", now)
        .put("appVersionCode", 0)
        .put("appVersionName", "desktop-$appVersion")
        .put("categories", JSONArray(categories.map {
            JSONObject().put("name", it.name).put("order", it.sortOrder).put("isDefault", false).put("isHidden", it.isHidden)
        }))
        .put("repos", JSONArray(repositories.filterNot { it.builtin }.map {
            JSONObject().put("name", it.id).put("indexUrl", it.indexUrl).put("enabled", it.enabled).put("addedAt", 0)
        }))
        .put("preferences", JSONArray())
        .put("nuBookmarks", JSONArray())
        .put("novels", JSONArray(books.filter { it.favorite || it.readChapters.isNotEmpty() }.map { book ->
            encodeBackupNovel(book, book.categoryId?.let(categoryNames::get))
        }))
    val parent = path.toAbsolutePath().parent
    Files.createDirectories(parent)
    val staging = Files.createTempFile(parent, ".grimoire-backup-", ".tmp")
    try {
        GZIPOutputStream(Files.newOutputStream(staging)).use { it.write(root.toString().toByteArray(Charsets.UTF_8)) }
        try { Files.move(staging, path, ATOMIC_MOVE, REPLACE_EXISTING) }
        catch (_: java.nio.file.AtomicMoveNotSupportedException) { Files.move(staging, path, REPLACE_EXISTING) }
    } finally {
        Files.deleteIfExists(staging)
    }
}

private fun encodeBackupNovel(book: SavedBook, categoryName: String?): JSONObject {
    val n = book.novel
    val o = book.overrides
    val kept = book.chapters.filter { it.url in book.readChapters || it.url == book.resumeChapterUrl }
    return JSONObject()
        .put("sourceId", book.key.sourceId)
        .put("url", book.key.url)
        .put("title", n.title)
        .put("thumbnailUrl", n.thumbnailUrl ?: JSONObject.NULL)
        .put("author", n.author ?: JSONObject.NULL)
        .put("description", n.description ?: JSONObject.NULL)
        .put("genres", n.genres.joinToString(","))
        .put("status", n.status.ordinal)
        .put("favorite", book.favorite)
        .put("lastUpdated", book.lastUpdated)
        .put("chapterSortOrder", book.chapterSortOrder.ordinal)
        .put("categoryName", categoryName ?: JSONObject.NULL)
        .put("lastReadAt", book.lastReadAt)
        .put("userRating", book.userRating ?: JSONObject.NULL)
        .put("notifyOnNewChapters", book.alerts.notify)
        .put("notifyOnNewLockedChapters", book.alerts.notifyLocked)
        .put("autoDownloadNewChapters", book.alerts.autoDownload)
        .put("language", n.language.displayName)
        .put("readerTextAlign", book.readerTextAlign.ordinal)
        .put("customCoverUrl", o.customCoverUrl ?: JSONObject.NULL)
        .put("overrideTitle", o.title ?: JSONObject.NULL)
        .put("overrideAuthor", o.author ?: JSONObject.NULL)
        .put("overrideDescription", o.description ?: JSONObject.NULL)
        .put("overrideStatus", o.status?.ordinal ?: JSONObject.NULL)
        .put("overrideGenres", o.genres?.joinToString(",") ?: JSONObject.NULL)
        .put("chapters", JSONArray(kept.map { c ->
            val read = c.url in book.readChapters
            JSONObject()
                .put("url", c.url)
                .put("name", c.name)
                .put("uploadDate", c.uploadDate)
                .put("chapterNumber", c.chapterNumber.toDouble())
                .put("read", read)
                .put("readProgress", if (read) 1.0 else 0.0)
                .put("locked", c.locked)
        }))
}

/** Android writes the language's display name; codes and enum names are accepted too. */
internal fun languageOf(value: String?): Language {
    val text = value?.trim().orEmpty()
    if (text.isEmpty()) return Language.UNKNOWN
    return Language.entries.firstOrNull { it.displayName.equals(text, true) || it.name.equals(text, true) }
        ?: Language.fromCode(text.substringBefore('-'))
}

private fun statusOf(ordinal: Int) = NovelStatus.entries.getOrElse(ordinal) { NovelStatus.UNKNOWN }

private fun splitGenres(text: String) = text.split(',').map { it.trim() }.filter { it.isNotEmpty() }

internal fun defaultBackupFileName(now: LocalDateTime = LocalDateTime.now()): String =
    "grimoire_backup_${now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HHmmss"))}.json.gz"

private fun JSONObject.objects(name: String): List<JSONObject> =
    optJSONArray(name)?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } }.orEmpty()

private fun JSONObject.optNullableString(name: String): String? =
    if (has(name) && !isNull(name)) getString(name).takeIf { it.isNotBlank() } else null

private fun JSONObject.optNullableInt(name: String): Int? = if (has(name) && !isNull(name)) getInt(name) else null

private fun JSONObject.optNullableBoolean(name: String): Boolean? = if (has(name) && !isNull(name)) getBoolean(name) else null
