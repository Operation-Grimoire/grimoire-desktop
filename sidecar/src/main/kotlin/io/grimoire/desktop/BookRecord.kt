package io.grimoire.desktop

import io.grimoire.api.model.lang.Language
import io.grimoire.api.model.novel.*
import io.grimoire.reading.NovelKey
import org.json.JSONArray
import org.json.JSONObject

internal fun encodeBook(book: SavedBook): JSONObject = JSONObject()
    .put("sourceId", book.key.sourceId).put("url", book.key.url).put("title", book.novel.title)
    .put("language", book.novel.language.name).put("author", book.novel.author)
    .put("description", book.novel.description).put("favorite", book.favorite)
    .put("thumbnailUrl", book.novel.thumbnailUrl).put("genres", JSONArray(book.novel.genres)).put("status", book.novel.status.name)
    .put("downloaded", JSONArray(book.downloaded.toList()))
    .put("chapters", JSONArray(book.chapters.map { chapter -> JSONObject()
        .put("url", chapter.url).put("name", chapter.name).put("locked", chapter.locked)
        .put("number", chapter.chapterNumber).put("uploadDate", chapter.uploadDate) }))
    .apply { book.position?.let { put("position", JSONObject().put("chapterUrl", it.chapterUrl)
        .put("paragraph", it.paragraph).put("offset", it.offset)) } }
    .apply { book.resumeChapterUrl?.let { put("resumeChapterUrl", it) } }
    .apply { book.categoryId?.let { put("categoryId", it) } }
    .put("lastReadAt", book.lastReadAt)
    .put("lastUpdated", book.lastUpdated)
    .put("addedAt", book.addedAt)
    .apply { book.userRating?.let { put("userRating", it) } }
    .put("readerTextAlign", book.readerTextAlign.name)
    .put("chapterSortOrder", book.chapterSortOrder.name)
    .apply {
        if (!book.overrides.isEmpty) {
            val ov = JSONObject()
            book.overrides.title?.let { ov.put("title", it) }
            book.overrides.author?.let { ov.put("author", it) }
            book.overrides.description?.let { ov.put("description", it) }
            book.overrides.status?.let { ov.put("status", it.name) }
            book.overrides.genres?.let { ov.put("genres", JSONArray(it)) }
            book.overrides.customCoverUrl?.let { ov.put("customCoverUrl", it) }
            put("overrides", ov)
        }
    }

internal fun decodeBook(root: JSONObject): SavedBook {
    val key = NovelKey(root.getLong("sourceId"), root.getString("url"))
    val novel = Novel(key.url, root.getString("title"), Language.valueOf(root.getString("language")),
        author = root.optString("author").takeIf(String::isNotEmpty),
        description = root.optString("description").takeIf(String::isNotEmpty),
        // Cover, genres and status were added later; older records read without them.
        thumbnailUrl = root.optString("thumbnailUrl").takeIf(String::isNotEmpty),
        genres = root.optJSONArray("genres")?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty(),
        status = NovelStatus.entries.firstOrNull { it.name == root.optString("status") } ?: NovelStatus.UNKNOWN,
        initialized = true)
    val chapters = root.getJSONArray("chapters").let { array -> (0 until array.length()).map { index ->
        val c = array.getJSONObject(index)
        Chapter(c.getString("url"), c.getString("name"), c.getLong("uploadDate"), c.getFloat("number"), locked = c.getBoolean("locked"))
    } }
    val downloaded = root.getJSONArray("downloaded").let { array -> (0 until array.length()).map(array::getString).toSet() }
    val position = root.optJSONObject("position")?.let {
        ReadPosition(it.getString("chapterUrl"), it.getInt("paragraph"), it.getInt("offset")).also { p ->
            require(p.paragraph >= 0 && p.offset >= 0)
        }
    }
    val overrides = root.optJSONObject("overrides")?.let { ov ->
        NovelOverrides(
            title = if (ov.has("title") && !ov.isNull("title")) ov.getString("title") else null,
            author = if (ov.has("author") && !ov.isNull("author")) ov.getString("author") else null,
            description = if (ov.has("description") && !ov.isNull("description")) ov.getString("description") else null,
            status = if (ov.has("status") && !ov.isNull("status")) NovelStatus.entries.firstOrNull { it.name == ov.getString("status") } else null,
            genres = if (ov.has("genres") && !ov.isNull("genres")) ov.getJSONArray("genres").let { arr -> (0 until arr.length()).map(arr::getString) } else null,
            customCoverUrl = if (ov.has("customCoverUrl") && !ov.isNull("customCoverUrl")) ov.getString("customCoverUrl") else null,
        )
    } ?: NovelOverrides()

    return SavedBook(
        key = key,
        novel = novel,
        chapters = chapters,
        favorite = root.getBoolean("favorite"),
        downloaded = downloaded,
        position = position,
        resumeChapterUrl = if (root.isNull("resumeChapterUrl")) null else root.getString("resumeChapterUrl"),
        categoryId = if (root.has("categoryId") && !root.isNull("categoryId")) root.getLong("categoryId") else null,
        lastReadAt = root.optLong("lastReadAt", 0L),
        lastUpdated = root.optLong("lastUpdated", 0L),
        addedAt = root.optLong("addedAt", 0L),
        userRating = if (root.has("userRating") && !root.isNull("userRating")) root.getInt("userRating").coerceIn(1, 10) else null,
        readerTextAlign = ReaderTextAlign.entries.firstOrNull { it.name == root.optString("readerTextAlign") } ?: ReaderTextAlign.AUTO,
        chapterSortOrder = ChapterSort.entries.firstOrNull { it.name == root.optString("chapterSortOrder") } ?: ChapterSort.NUMBER_ASC,
        overrides = overrides,
    )
}
