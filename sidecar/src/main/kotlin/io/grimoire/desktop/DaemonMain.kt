package io.grimoire.desktop

import com.sun.net.httpserver.HttpServer
import io.grimoire.api.model.novel.Chapter
import io.grimoire.api.model.novel.Novel
import io.grimoire.api.model.novel.NovelStatus
import io.grimoire.api.model.novel.PageContent
import io.grimoire.api.network.SourceNetwork
import io.grimoire.reading.ChapterKey
import io.grimoire.reading.NovelKey
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Headless JVM sidecar daemon for Grimoire Desktop (Tauri v2).
 *
 * Speaks NDJSON over stdin/stdout:
 * - Outbound: `{"type":"ready","coverBaseUrl":"http://127.0.0.1:<port>"}`
 * - Outbound: `{"type":"state","state":{...}}` whenever [ReaderModel.state] changes
 * - Outbound: `{"type":"response","id":<id>,"ok":true|false,"error":"..."}`
 * - Inbound:  `{"id":<id>,"method":"<name>","params":{...}}`
 */
fun main(args: Array<String>) {
    // Reserve stdout exclusively for framed NDJSON; redirect any library/extension println to stderr.
    val rpcOut = System.out
    System.setOut(System.err)

    require(args.size % 2 == 0) { "Use --extension MANIFEST --data DIRECTORY" }
    val options = args.toList().chunked(2).associate { it[0] to it[1] }
    require(options.keys.all { it == "--extension" || it == "--data" }) { "Unknown desktop argument" }

    val data = options["--data"]?.let(Paths::get) ?: Paths.get(
        System.getenv("APPDATA") ?: System.getProperty("user.home"),
        "GrimoireDesktop",
    )
    Files.createDirectories(data)

    val hostApi = HostRuntime.apiVersion
    val networkEnabled = AtomicBoolean(true)
    SourceNetwork.install(DesktopHttpPlatform(networkEnabled))

    val coverProxy = CoverProxyServer(data.resolve("cover-cache"), networkEnabled)
    val coverBaseUrl = coverProxy.start()

    val library = LocalLibrary(data)
    val extensions = ExtensionManager(library, hostApi, HttpArtifactFetcher(networkEnabled), listOf(OFFICIAL_REPOSITORY))
    val model = desktopReaderModel(library, hostApi, networkEnabled, extensions)
    options["--extension"]?.let { model.load(Paths.get(it)) }

    val writeLock = Any()
    fun emit(json: JSONObject) {
        synchronized(writeLock) {
            rpcOut.println(json.toString())
            rpcOut.flush()
        }
    }

    val daemonScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    emit(JSONObject().put("type", "ready").put("coverBaseUrl", coverBaseUrl).put("hostApi", hostApi))

    val stateJob = daemonScope.launch {
        model.state.collectLatest { state ->
            emit(JSONObject().put("type", "state").put("state", state.toJson()))
        }
    }

    val reader = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    try {
        while (true) {
            val line = reader.readLine() ?: break
            if (line.isBlank()) continue
            val req = runCatching { JSONObject(line) }.getOrNull() ?: continue
            val id = if (req.has("id") && !req.isNull("id")) req.get("id") else null
            val method = req.optString("method", "")
            val params = req.optJSONObject("params") ?: JSONObject()

            if (method == "shutdown") {
                runBlocking {
                    runCatching { model.close() }
                }
                if (id != null) emit(JSONObject().put("type", "response").put("id", id).put("ok", true))
                break
            }

            try {
                dispatchMethod(method, params, model, daemonScope)
                if (id != null) emit(JSONObject().put("type", "response").put("id", id).put("ok", true))
            } catch (failure: Exception) {
                if (id != null) {
                    emit(
                        JSONObject()
                            .put("type", "response")
                            .put("id", id)
                            .put("ok", false)
                            .put("error", failure.message ?: failure.javaClass.simpleName),
                    )
                }
            }
        }
    } finally {
        stateJob.cancel()
        runBlocking { runCatching { model.close() } }
        daemonScope.cancel()
        coverProxy.stop()
    }
}

private fun dispatchMethod(method: String, params: JSONObject, model: ReaderModel, scope: CoroutineScope) {
    when (method) {
        "showLibrary" -> model.showLibrary()
        "showBrowse" -> model.showBrowse()
        "showHistory" -> model.showHistory()
        "showExtensions" -> model.showExtensions()
        "showSettings" -> model.showSettings()
        "back" -> model.back()
        "browse" -> model.browse()
        "loadMore" -> model.loadMore()
        "favorite" -> model.favorite()
        "download" -> model.download()
        "readPrevious" -> model.readPrevious()
        "readNext" -> model.readNext()
        "refreshRepositories" -> model.refreshRepositories()
        "confirmRepository" -> model.confirmRepository()
        "cancelRepository" -> model.cancelRepository()
        "clearHistory" -> model.clearHistory()
        "refreshBook" -> model.refreshBook()
        "markCurrentChapterRead" -> model.markCurrentChapterRead()

        "markChaptersRead" -> {
            val arr = params.getJSONArray("chapterUrls")
            val urls = (0 until arr.length()).map(arr::getString)
            model.markChaptersRead(urls, params.getBoolean("read"))
        }

        "downloadChapters" -> {
            val arr = params.getJSONArray("chapterUrls")
            val urls = (0 until arr.length()).map(arr::getString)
            model.downloadChapters(urls)
        }

        "deleteDownloads" -> {
            val arr = params.getJSONArray("chapterUrls")
            val urls = (0 until arr.length()).map(arr::getString)
            model.deleteDownloads(urls)
        }

        "removeFromLibrary" -> model.removeFromLibrary(
            NovelKey(params.getLong("sourceId"), params.getString("novelUrl")),
        )

        "createCategory" -> model.createCategory(params.getString("name"))
        "renameCategory" -> model.renameCategory(params.getLong("id"), params.getString("name"))
        "deleteCategory" -> model.deleteCategory(params.getLong("id"))

        "setBookCategory" -> model.setBookCategory(
            NovelKey(params.getLong("sourceId"), params.getString("novelUrl")),
            if (params.has("categoryId") && !params.isNull("categoryId")) params.getLong("categoryId") else null,
        )

        "setBookRating" -> model.setBookRating(
            NovelKey(params.getLong("sourceId"), params.getString("novelUrl")),
            if (params.has("rating") && !params.isNull("rating")) params.getInt("rating") else null,
        )

        "setBookChapterSort" -> model.setBookChapterSort(
            NovelKey(params.getLong("sourceId"), params.getString("novelUrl")),
            ChapterSort.valueOf(params.getString("sort")),
        )

        "setBookTextAlign" -> model.setBookTextAlign(
            NovelKey(params.getLong("sourceId"), params.getString("novelUrl")),
            ReaderTextAlign.valueOf(params.getString("textAlign")),
        )

        "setBookOverrides" -> {
            val key = NovelKey(params.getLong("sourceId"), params.getString("novelUrl"))
            val ov = params.optJSONObject("overrides") ?: JSONObject()
            fun optStr(k: String): String? =
                if (ov.has(k) && !ov.isNull(k)) ov.getString(k).trim().takeIf { it.isNotEmpty() } else null
            val genres = if (ov.has("genres") && !ov.isNull("genres")) {
                ov.getJSONArray("genres").let { a -> (0 until a.length()).map { a.getString(it).trim() }.filter { it.isNotEmpty() } }
            } else null
            val status = optStr("status")?.let { s -> NovelStatus.entries.firstOrNull { it.name == s } }
            model.setBookOverrides(
                key,
                NovelOverrides(
                    title = optStr("title"),
                    author = optStr("author"),
                    description = optStr("description"),
                    status = status,
                    genres = genres,
                    customCoverUrl = optStr("customCoverUrl"),
                ),
            )
        }

        "selectSource" -> model.selectSource(params.getLong("sourceId"))
        "setBrowseMode" -> model.setBrowseMode(BrowseMode.valueOf(params.getString("mode")))
        "search" -> model.search(params.getString("query"))
        "offline" -> model.offline(params.getBoolean("offline"))
        "setHistoryRecording" -> model.setHistoryRecording(params.getBoolean("enabled"))
        "removeHistory" -> model.removeHistory(params.getLong("id"))
        "setThemeMode" -> model.setThemeMode(ThemeMode.valueOf(params.getString("themeMode")))
        "setColorTheme" -> model.setColorTheme(ColorTheme.valueOf(params.getString("colorTheme")))

        "setReaderSettings" -> {
            val current = model.state.value.readerSettings
            val updated = current.copy(
                fontSize = params.optInt("fontSize", current.fontSize),
                lineHeightTimes10 = params.optInt("lineHeightTimes10", current.lineHeightTimes10),
                paragraphSpacing = params.optInt("paragraphSpacing", current.paragraphSpacing),
                font = params.optString("font", "").takeIf { it.isNotEmpty() }?.let(ReaderFont::valueOf) ?: current.font,
                colorTheme = if (params.has("colorTheme")) {
                    params.optString("colorTheme", "").takeIf { it.isNotEmpty() }?.let(ReaderColorTheme::valueOf)
                } else current.colorTheme,
                textAlign = params.optString("textAlign", "").takeIf { it.isNotEmpty() }?.let(ReaderTextAlign::valueOf) ?: current.textAlign,
                showChapterPercent = if (params.has("showChapterPercent")) params.getBoolean("showChapterPercent") else current.showChapterPercent,
                showBookPercent = if (params.has("showBookPercent")) params.getBoolean("showBookPercent") else current.showBookPercent,
                grimoireEasterEgg = if (params.has("grimoireEasterEgg")) params.getBoolean("grimoireEasterEgg") else current.grimoireEasterEgg,
                markAsReadStrategy = params.optString("markAsReadStrategy", "").takeIf { it.isNotEmpty() }
                    ?.let(MarkAsReadStrategy::valueOf) ?: current.markAsReadStrategy,
                markAsReadThreshold = params.optInt("markAsReadThreshold", current.markAsReadThreshold),
            )
            model.setReaderSettings(updated)
        }

        "details" -> {
            val url = params.getString("novelUrl")
            val novel = model.state.value.novels.firstOrNull { it.url == url }
                ?: error("Novel is no longer in the current catalog")
            model.details(novel)
        }

        "openSaved" -> {
            val key = NovelKey(params.getLong("sourceId"), params.getString("novelUrl"))
            val book = model.state.value.library.firstOrNull { it.key == key }
                ?: error("Book not found in library")
            model.openSaved(book)
        }

        "read" -> {
            val chapterUrl = params.getString("chapterUrl")
            val chapter = model.state.value.book?.chapters?.firstOrNull { it.url == chapterUrl }
                ?: error("Chapter not found")
            model.read(chapter)
        }

        "readHistory" -> {
            val id = params.getLong("id")
            val entry = model.state.value.history.firstOrNull { it.id == id }
                ?: error("History entry not found")
            model.readHistory(entry)
        }

        "position" -> {
            val current = model.state.value
            val book = current.book ?: return
            val chapter = current.chapter ?: return
            val projection = current.projection ?: return
            val paragraph = params.getInt("paragraph")
            val offset = params.optInt("offset", 0)
            val userInitiated = params.optBoolean("userInitiated", true)
            model.position(ChapterKey(book.key, chapter.url), paragraph, offset, projection, userInitiated)
            scope.launch { model.flushPosition() }
        }

        "installExtension" -> {
            val pkg = params.getString("pkg")
            val repo = params.optString("repository", "")
            val row = model.state.value.extensionRows.firstOrNull { it.pkg == pkg && (repo.isEmpty() || it.repository == repo) }
                ?: error("Extension not found")
            model.installExtension(row)
        }

        "removeExtension" -> {
            val pkg = params.getString("pkg")
            val row = model.state.value.extensionRows.firstOrNull { it.pkg == pkg }
                ?: error("Extension not found")
            model.removeExtension(row)
        }

        "checkRepository" -> model.checkRepository(params.getString("indexUrl"), params.getString("publicKey"))
        "setRepositoryEnabled" -> model.setRepositoryEnabled(params.getString("repository"), params.getBoolean("enabled"))
        "removeRepository" -> model.removeRepository(params.getString("repository"))
        "loadLocalExtension" -> model.load(Paths.get(params.getString("manifestPath")))

        else -> error("Unknown method: $method")
    }
}

private fun ReaderState.toJson(): JSONObject = JSONObject()
    .put("view", view.name)
    .put("bookOrigin", bookOrigin.name)
    .put("busy", busy)
    .put("offline", offline)
    .put("error", error ?: JSONObject.NULL)
    .put("sourceName", sourceName ?: JSONObject.NULL)
    .put("historyRecording", historyRecording)
    .put("browseSource", browseSource ?: JSONObject.NULL)
    .put("browseMode", browseMode?.name ?: JSONObject.NULL)
    .put("browseModes", JSONArray(browseModes.map { it.name }))
    .put("browseQuery", browseQuery)
    .put("browsePage", browsePage)
    .put("browseHasMore", browseHasMore)
    .put("extensionNotice", extensionNotice ?: JSONObject.NULL)
    .put("localExtension", localExtension ?: JSONObject.NULL)
    .put("positionNotice", positionNotice ?: JSONObject.NULL)
    .put("sources", JSONArray(sources.map { s ->
        JSONObject().put("sourceId", s.sourceId).put("name", s.name).put("lang", s.lang)
    }))
    .put("library", JSONArray(library.map { it.toJson(includeChapters = false) }))
    .put("novels", JSONArray(novels.map { it.toJson() }))
    .put("book", book?.toJson(includeChapters = true) ?: JSONObject.NULL)
    .put("chapter", chapter?.toJson() ?: JSONObject.NULL)
    .put("pages", JSONArray((projection?.body ?: emptyList()).map { mapped ->
        val obj = JSONObject().put("ordinal", mapped.canonicalOrdinal)
        when (val c = mapped.page.content) {
            is PageContent.Text -> obj.put("kind", "text").put("text", c.text).put("html", c.html ?: JSONObject.NULL)
            is PageContent.Image -> obj.put("kind", "image").put("url", c.url)
            is PageContent.Separator -> obj.put("kind", "separator")
        }
    }))
    .put("restoreViewport", checkpointLoad?.restore?.viewport?.let { vp ->
        JSONObject().put("index", vp.index).put("offset", vp.offset).put("end", vp.end)
    } ?: JSONObject.NULL)
    .put("history", JSONArray(history.map { h ->
        JSONObject()
            .put("id", h.id)
            .put("sourceId", h.chapter.key.novel.sourceId)
            .put("novelUrl", h.chapter.key.novel.url)
            .put("chapterUrl", h.chapter.key.url)
            .put("novelTitle", h.chapter.novelTitle)
            .put("chapterTitle", h.chapter.chapterTitle)
            .put("openedAtMillis", h.openedAtMillis)
    }))
    .put("extensionRows", JSONArray(extensionRows.map { r ->
        JSONObject()
            .put("pkg", r.pkg)
            .put("name", r.name)
            .put("lang", r.lang)
            .put("installedVersion", r.installedVersion ?: JSONObject.NULL)
            .put("availableVersion", r.availableVersion ?: JSONObject.NULL)
            .put("repository", r.repository)
            .put("status", r.status.name)
            .put("reason", r.reason ?: JSONObject.NULL)
    }))
    .put("repositories", JSONArray(repositories.map { repo ->
        JSONObject()
            .put("id", repo.id)
            .put("indexUrl", repo.indexUrl)
            .put("enabled", repo.enabled)
            .put("builtin", repo.builtin)
            .put("refreshed", repo.refreshed)
            .put("fingerprint", repo.fingerprint)
            .put("extensionCount", repo.extensionCount)
            .put("problem", repo.problem ?: JSONObject.NULL)
    }))
    .put("pendingRepository", pendingRepository?.let { p ->
        JSONObject()
            .put("id", p.trust.repository)
            .put("indexUrl", p.trust.indexUrl)
            .put("fingerprint", p.fingerprint)
            .put("extensionCount", p.catalog.extensions.size)
            .put("warning", p.warning ?: JSONObject.NULL)
    } ?: JSONObject.NULL)
    .put("categories", JSONArray(categories.map { c ->
        JSONObject()
            .put("id", c.id)
            .put("name", c.name)
            .put("sortOrder", c.sortOrder)
            .put("isDefault", c.isDefault)
            .put("isHidden", c.isHidden)
    }))
    .put("appearance", JSONObject()
        .put("themeMode", appearance.themeMode.name)
        .put("colorTheme", appearance.colorTheme.name))
    .put("readerSettings", JSONObject()
        .put("fontSize", readerSettings.fontSize)
        .put("lineHeightTimes10", readerSettings.lineHeightTimes10)
        .put("paragraphSpacing", readerSettings.paragraphSpacing)
        .put("font", readerSettings.font.name)
        .put("colorTheme", readerSettings.colorTheme?.name ?: JSONObject.NULL)
        .put("textAlign", readerSettings.textAlign.name)
        .put("showChapterPercent", readerSettings.showChapterPercent)
        .put("showBookPercent", readerSettings.showBookPercent)
        .put("grimoireEasterEgg", readerSettings.grimoireEasterEgg)
        .put("markAsReadStrategy", readerSettings.markAsReadStrategy.name)
        .put("markAsReadThreshold", readerSettings.markAsReadThreshold))

private fun Novel.toJson(): JSONObject = JSONObject()
    .put("url", url)
    .put("title", title)
    .put("lang", language.code)
    .put("thumbnailUrl", thumbnailUrl ?: JSONObject.NULL)
    .put("author", author ?: JSONObject.NULL)
    .put("description", description ?: JSONObject.NULL)
    .put("status", status.name)
    .put("genres", JSONArray(genres))

private fun Chapter.toJson(): JSONObject = JSONObject()
    .put("url", url)
    .put("name", name)
    .put("chapterNumber", chapterNumber.toDouble())
    .put("uploadDate", uploadDate)
    .put("locked", locked)

private fun SavedBook.toJson(includeChapters: Boolean): JSONObject {
    val chapterUrls = chapters.mapTo(HashSet(chapters.size)) { it.url }
    val downloadedCount = downloaded.count { it in chapterUrls }
    val readCount = readChapters.count { it in chapterUrls }
    val lockedCount = chapters.count { it.locked }
    val readableTotal = (chapters.size - lockedCount).coerceAtLeast(0)
    val unreadCount = (readableTotal - readCount).coerceAtLeast(0)
    val effective = effectiveNovel()
    val ov = JSONObject()
        .put("title", overrides.title ?: JSONObject.NULL)
        .put("author", overrides.author ?: JSONObject.NULL)
        .put("description", overrides.description ?: JSONObject.NULL)
        .put("status", overrides.status?.name ?: JSONObject.NULL)
        .put("genres", overrides.genres?.let { JSONArray(it) } ?: JSONObject.NULL)
        .put("customCoverUrl", overrides.customCoverUrl ?: JSONObject.NULL)
    val obj = JSONObject()
        .put("sourceId", key.sourceId)
        .put("novelUrl", key.url)
        .put("novel", effective.toJson())
        .put("sourceNovel", novel.toJson())
        .put("overrides", ov)
        .put("favorite", favorite)
        .put("categoryId", categoryId ?: JSONObject.NULL)
        .put("lastReadAt", lastReadAt)
        .put("lastUpdated", lastUpdated)
        .put("addedAt", addedAt)
        .put("userRating", userRating ?: JSONObject.NULL)
        .put("readerTextAlign", readerTextAlign.name)
        .put("chapterSortOrder", chapterSortOrder.name)
        .put("totalChapters", chapters.size)
        .put("downloadedCount", downloadedCount)
        .put("readCount", readCount)
        .put("unreadCount", unreadCount)
        .put("lockedCount", lockedCount)
        .put("resumeChapterUrl", resumeChapter()?.url ?: JSONObject.NULL)
        .put("position", position?.let {
            JSONObject().put("chapterUrl", it.chapterUrl).put("paragraph", it.paragraph).put("offset", it.offset)
        } ?: JSONObject.NULL)
    if (includeChapters) {
        val ordered = readingOrder(chapters)
        obj.put("chapters", JSONArray(ordered.map { ch ->
            ch.toJson()
                .put("downloaded", ch.url in downloaded)
                .put("read", ch.url in readChapters)
        }))
    }
    return obj
}

/** Lightweight localhost disk-cached cover proxy so covers stay available offline. */
private class CoverProxyServer(
    private val cacheDir: Path,
    private val networkEnabled: AtomicBoolean,
) {
    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()
    private var server: HttpServer? = null

    fun start(): String {
        Files.createDirectories(cacheDir)
        val http = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        http.executor = Executors.newCachedThreadPool { r ->
            Thread(r, "cover-proxy").apply { isDaemon = true }
        }
        http.createContext("/cover") { exchange ->
            try {
                val query = exchange.requestURI.rawQuery.orEmpty()
                val encodedUrl = query.split("&").firstOrNull { it.startsWith("url=") }?.removePrefix("url=")
                val targetUrl = encodedUrl?.let { URLDecoder.decode(it, StandardCharsets.UTF_8) }
                if (targetUrl.isNullOrBlank() || (!targetUrl.startsWith("https://") && !targetUrl.startsWith("http://"))) {
                    exchange.sendResponseHeaders(400, -1)
                    return@createContext
                }
                val hash = sha256(targetUrl)
                val bodyFile = cacheDir.resolve("$hash.bin")
                val mimeFile = cacheDir.resolve("$hash.mime")
                val bytes: ByteArray
                val contentType: String
                if (Files.exists(bodyFile)) {
                    bytes = Files.readAllBytes(bodyFile)
                    contentType = runCatching { Files.readString(mimeFile).trim() }.getOrNull()?.takeIf { it.isNotEmpty() } ?: "image/jpeg"
                } else {
                    if (!networkEnabled.get()) {
                        exchange.sendResponseHeaders(503, -1)
                        return@createContext
                    }
                    val req = Request.Builder().url(targetUrl).header("User-Agent", "Grimoire-Desktop/0.1").build()
                    client.newCall(req).execute().use { resp ->
                        if (!resp.isSuccessful) {
                            exchange.sendResponseHeaders(resp.code, -1)
                            return@createContext
                        }
                        bytes = resp.body?.bytes() ?: ByteArray(0)
                        contentType = resp.header("Content-Type") ?: "image/jpeg"
                    }
                    if (bytes.isNotEmpty()) {
                        Files.write(bodyFile, bytes)
                        Files.writeString(mimeFile, contentType)
                    }
                }
                exchange.responseHeaders.add("Content-Type", contentType)
                exchange.responseHeaders.add("Cache-Control", "public, max-age=604800")
                exchange.responseHeaders.add("Access-Control-Allow-Origin", "*")
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            } catch (_: Exception) {
                runCatching { exchange.sendResponseHeaders(502, -1) }
            } finally {
                exchange.close()
            }
        }
        http.start()
        server = http
        return "http://127.0.0.1:${http.address.port}"
    }

    fun stop() {
        server?.stop(0)
        server = null
    }

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}
