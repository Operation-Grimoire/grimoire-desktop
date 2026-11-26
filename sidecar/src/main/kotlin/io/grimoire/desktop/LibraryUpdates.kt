package io.grimoire.desktop

import io.grimoire.api.model.lang.Language
import io.grimoire.api.model.novel.Chapter
import io.grimoire.api.model.novel.Novel
import io.grimoire.api.model.novel.NovelStatus
import io.grimoire.api.source.Source
import io.grimoire.api.source.web.ChapterListSource
import io.grimoire.api.source.web.CursorPaginatedSource
import io.grimoire.reading.ChapterKey
import io.grimoire.reading.NovelKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/** One chapter that a library refresh found, matching Android's `LibraryUpdateEntity`. */
data class DesktopUpdateEntry(
    val id: Long,
    val key: ChapterKey,
    val novelTitle: String,
    val chapterName: String,
    val chapterNumber: Float,
    val foundAt: Long,
    val locked: Boolean,
    /** The chapter existed before but was locked; now it can be read. */
    val unlocked: Boolean,
)

enum class UpdateIssueSeverity { WARNING, ERROR }

/** The latest refresh problem for one novel. A clean refresh clears it. */
data class DesktopUpdateIssue(
    val key: NovelKey,
    val novelTitle: String,
    val severity: UpdateIssueSeverity,
    val message: String,
    val occurredAt: Long,
)

/** The app only runs while open, so "scheduled" means while the window is open. */
data class LibraryUpdateSettings(
    val updateOnLaunch: Boolean = false,
    val autoUpdate: Boolean = false,
    val intervalHours: Int = 12,
    val concurrency: Int = 4,
    val skipCompleted: Boolean = true,
) {
    fun normalized() = copy(
        intervalHours = intervalHours.coerceIn(1, MAX_INTERVAL_HOURS),
        concurrency = concurrency.coerceIn(1, MAX_CONCURRENCY),
    )

    fun encode(): String = JSONObject()
        .put("updateOnLaunch", updateOnLaunch).put("autoUpdate", autoUpdate)
        .put("intervalHours", intervalHours).put("concurrency", concurrency)
        .put("skipCompleted", skipCompleted).toString()

    companion object {
        const val MAX_CONCURRENCY = 8
        const val MAX_INTERVAL_HOURS = 24 * 7

        /** Unknown or broken values fall back to defaults, so a newer build's value never blocks startup. */
        fun decode(text: String?): LibraryUpdateSettings {
            val root = text?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return LibraryUpdateSettings()
            val d = LibraryUpdateSettings()
            return LibraryUpdateSettings(
                updateOnLaunch = root.optBoolean("updateOnLaunch", d.updateOnLaunch),
                autoUpdate = root.optBoolean("autoUpdate", d.autoUpdate),
                intervalHours = root.optInt("intervalHours", d.intervalHours),
                concurrency = root.optInt("concurrency", d.concurrency),
                skipCompleted = root.optBoolean("skipCompleted", d.skipCompleted),
            ).normalized()
        }
    }
}

data class LibraryUpdateSummary(
    val finishedAt: Long,
    val checked: Int,
    val newChapters: Int,
    val warnings: Int,
    val errors: Int,
    val cancelled: Boolean = false,
    /** The run stopped on an unexpected error, as opposed to a user or shutdown cancel. */
    val failed: Boolean = false,
    /** Null for a whole-library run. */
    val categoryId: Long? = null,
) {
    fun encode(): String = JSONObject().put("finishedAt", finishedAt).put("checked", checked)
        .put("newChapters", newChapters).put("warnings", warnings).put("errors", errors)
        .put("cancelled", cancelled).put("failed", failed).put("categoryId", categoryId ?: JSONObject.NULL).toString()

    companion object {
        fun decode(text: String?): LibraryUpdateSummary? = text?.let {
            runCatching {
                val r = JSONObject(it)
                LibraryUpdateSummary(r.getLong("finishedAt"), r.getInt("checked"), r.getInt("newChapters"),
                    r.getInt("warnings"), r.getInt("errors"), r.optBoolean("cancelled", false),
                    r.optBoolean("failed", false), if (r.isNull("categoryId")) null else r.getLong("categoryId"))
            }.getOrNull()
        }
    }
}

/** Live progress of the running refresh; `null` in state when idle. */
data class LibraryUpdateProgress(
    val done: Int,
    val total: Int,
    val current: String?,
    val categoryId: Long?,
)

internal const val ISSUE_NO_CHAPTERS = "Source returned no chapters — kept the existing list"
internal const val ISSUE_CHAPTER_LIST_CHANGED = "Source's chapter list changed too much — kept the existing list"
internal const val ISSUE_REGRESSION = "Source returned incomplete data — kept the previous title/cover"
internal const val ISSUE_SOURCE_MISSING = "Source not installed — skipped"
internal const val ISSUE_SOURCE_PAUSED = "Source not available"

/** Lists at least this long are protected against a fetch that would delete most of them. */
internal const val SUSPECT_TRUNCATION_MIN_LIST = 20

/** More "new" chapters than this at once is a re-detection after a bad sync, not a release. */
internal const val MAX_LOGGED_NEW_CHAPTERS = 150

/** How a fetched chapter list applies to the stored one. Chapters keep their identity by URL. */
internal sealed interface ChapterRefreshPlan {
    /** The fetched list is not trusted; the stored list stays and the reason is reported. */
    data class Keep(val reason: String) : ChapterRefreshPlan

    /** [found] are new or newly unlocked chapters; empty for a novel that had no list yet. */
    data class Apply(val found: List<FoundChapter>) : ChapterRefreshPlan
}

internal data class FoundChapter(val chapter: Chapter, val unlocked: Boolean)

internal fun planChapterRefresh(existing: List<Chapter>, fetched: List<Chapter>): ChapterRefreshPlan {
    if (fetched.isEmpty()) {
        return if (existing.isEmpty()) ChapterRefreshPlan.Apply(emptyList()) else ChapterRefreshPlan.Keep(ISSUE_NO_CHAPTERS)
    }
    val fetchedUrls = fetched.mapTo(HashSet(fetched.size)) { it.url }
    val deleted = existing.count { it.url !in fetchedUrls }
    // A throttled site can serve a partial list; deleting would drop read state and downloads.
    if (existing.size >= SUSPECT_TRUNCATION_MIN_LIST && deleted * 2 > existing.size) {
        return ChapterRefreshPlan.Keep(ISSUE_CHAPTER_LIST_CHANGED)
    }
    // The first list of a novel is not news.
    if (existing.isEmpty()) return ChapterRefreshPlan.Apply(emptyList())
    val before = existing.associateBy { it.url }
    val found = fetched.mapNotNull { chapter ->
        val prior = before[chapter.url]
        when {
            prior == null -> FoundChapter(chapter, unlocked = false)
            prior.locked && !chapter.locked -> FoundChapter(chapter, unlocked = true)
            else -> null
        }
    }
    return ChapterRefreshPlan.Apply(found)
}

/** Keeps good metadata when a source returns blank fields. */
internal fun mergeNovelMetadata(old: Novel, fetched: Novel): Novel = old.copy(
    title = fetched.title.takeIf { it.isNotBlank() } ?: old.title,
    thumbnailUrl = fetched.thumbnailUrl?.takeIf { it.isNotBlank() } ?: old.thumbnailUrl,
    author = fetched.author?.takeIf { it.isNotBlank() } ?: old.author,
    description = fetched.description?.takeIf { it.isNotBlank() } ?: old.description,
    genres = fetched.genres.filter { it.isNotBlank() }.takeIf { it.isNotEmpty() } ?: old.genres,
    status = if (fetched.status != NovelStatus.UNKNOWN) fetched.status else old.status,
    language = fetched.language.takeIf { it != Language.UNKNOWN && it != Language.MULTI } ?: old.language,
)

internal fun metadataRegressed(old: Novel, fetched: Novel): Boolean =
    (fetched.title.isBlank() && old.title.isNotBlank()) ||
        (!old.thumbnailUrl.isNullOrBlank() && fetched.thumbnailUrl.isNullOrBlank())

/** Outcome of applying one novel's refresh to the store. */
internal sealed interface RefreshOutcome {
    val newChapters: Int get() = 0

    /** [warning] is the issue recorded for a library novel, or what a manual refresh reports. */
    data class Updated(override val newChapters: Int, val warning: String? = null) : RefreshOutcome {
        val warned: Boolean get() = warning != null
    }
    data object Failed : RefreshOutcome
    data object Skipped : RefreshOutcome
}

/** One novel at a time per source; a failing source is paused for the rest of the run. */
internal class SourceSyncGate(private val failureLimit: Int = 3) {
    private val semaphore = Semaphore(1)
    private var consecutiveFailures = 0

    /** Returns null when the source is paused. */
    suspend fun run(block: suspend () -> RefreshOutcome): RefreshOutcome? = semaphore.withPermit {
        if (consecutiveFailures >= failureLimit) return@withPermit null
        val result = block()
        when (result) {
            RefreshOutcome.Failed -> consecutiveFailures++
            RefreshOutcome.Skipped -> Unit
            else -> consecutiveFailures = 0
        }
        result
    }
}

/**
 * Refreshes library novels from their sources. A source failure or a suspicious response
 * never replaces good data; the problem is recorded as an update issue instead.
 */
internal class LibraryUpdater(
    private val library: LocalLibrary,
    private val sourceFor: (Long) -> Source?,
) {
    private val runLock = Mutex()

    suspend fun run(
        targets: List<SavedBook>,
        concurrency: Int,
        onProgress: (done: Int, total: Int, title: String?) -> Unit,
        onNovelDone: (NovelKey, RefreshOutcome) -> Unit,
    ): LibraryUpdateSummary = runLock.withLock {
        val total = targets.size
        val queue = ArrayDeque(targets)
        val queueLock = Mutex()
        val gates = targets.map { it.key.sourceId }.distinct().associateWith { SourceSyncGate() }
        val done = AtomicInteger()
        val found = AtomicInteger()
        val warnings = AtomicInteger()
        val errors = AtomicInteger()
        onProgress(0, total, null)
        coroutineScope {
            repeat(concurrency.coerceIn(1, LibraryUpdateSettings.MAX_CONCURRENCY).coerceAtMost(total.coerceAtLeast(1))) {
                launch {
                    while (true) {
                        val book = queueLock.withLock { queue.removeFirstOrNull() } ?: break
                        val outcome = try {
                            onProgress(done.get(), total, book.effectiveNovel().title)
                            gates.getValue(book.key.sourceId).run { refresh(book, requireFavorite = true) }
                                ?: pausedOutcome(book)
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (failure: Exception) {
                            // A failed store write must not stop the whole library.
                            runCatching { library.setUpdateIssue(book.key, book.effectiveNovel().title, UpdateIssueSeverity.ERROR, describe(failure)) }
                            RefreshOutcome.Failed
                        }
                        when (outcome) {
                            is RefreshOutcome.Updated -> {
                                found.addAndGet(outcome.newChapters)
                                if (outcome.warned) warnings.incrementAndGet()
                            }
                            RefreshOutcome.Failed -> errors.incrementAndGet()
                            RefreshOutcome.Skipped -> Unit
                        }
                        onProgress(done.incrementAndGet(), total, null)
                        onNovelDone(book.key, outcome)
                    }
                }
            }
        }
        LibraryUpdateSummary(System.currentTimeMillis(), total, found.get(), warnings.get(), errors.get())
    }

    /** The retry action on the issues list: one novel, whether or not it is in the library. */
    suspend fun refreshOne(key: NovelKey): RefreshOutcome = runLock.withLock {
        val book = library.book(key) ?: return@withLock RefreshOutcome.Skipped
        refresh(book, requireFavorite = false)
    }

    private fun pausedOutcome(book: SavedBook): RefreshOutcome {
        val latest = library.book(book.key) ?: return RefreshOutcome.Skipped
        if (!latest.favorite) return RefreshOutcome.Skipped
        library.setUpdateIssue(book.key, latest.effectiveNovel().title, UpdateIssueSeverity.ERROR, ISSUE_SOURCE_PAUSED)
        return RefreshOutcome.Failed
    }

    private suspend fun refresh(book: SavedBook, requireFavorite: Boolean): RefreshOutcome {
        val title = book.effectiveNovel().title
        val source = sourceFor(book.key.sourceId)
        if (source == null) {
            library.setUpdateIssue(book.key, title, UpdateIssueSeverity.WARNING, ISSUE_SOURCE_MISSING)
            return RefreshOutcome.Updated(0, ISSUE_SOURCE_MISSING)
        }
        // Self-contained sources (EPUB-style) have no chapter list to refresh.
        if (source !is ChapterListSource && source !is CursorPaginatedSource) {
            library.clearUpdateIssue(book.key)
            return RefreshOutcome.Skipped
        }
        val fetched = try {
            retrySourceCall { source.getNovelDetails(book.novel) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Throwable) {
            if (failure is VirtualMachineError) throw failure
            library.setUpdateIssue(book.key, title, UpdateIssueSeverity.ERROR, describe(failure))
            return RefreshOutcome.Failed
        }
        val chapters = try {
            retrySourceCall { sourceChapters(source, mergeNovelMetadata(book.novel, fetched)) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Throwable) {
            if (failure is VirtualMachineError) throw failure
            library.setUpdateIssue(book.key, title, UpdateIssueSeverity.ERROR, describe(failure))
            return RefreshOutcome.Failed
        }
        return library.applyRefresh(book.key, fetched, chapters, requireFavorite, System.currentTimeMillis())
    }
}

/** Retries transient failures once more after a short pause; extension code may throw any error. */
internal suspend fun <T> retrySourceCall(attempts: Int = 2, block: suspend () -> T): T {
    var last: Throwable? = null
    repeat(attempts) { attempt ->
        try {
            return block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Throwable) {
            if (failure is VirtualMachineError) throw failure
            last = failure
            if (attempt < attempts - 1) kotlinx.coroutines.delay(750L * (attempt + 1))
        }
    }
    throw last!!
}

/** A 4xx/5xx status named in a source error, e.g. "HTTP 429" or "status code: 503". */
private val HTTP_STATUS = Regex("""(?i)\b(?:http|status|code)\D{0,3}([45]\d\d)\b""")

/** Readable text for the issues list; the raw exception goes to the log. */
internal fun describe(failure: Throwable): String {
    System.getLogger("LibraryUpdate").log(System.Logger.Level.WARNING, "Refresh failed", failure)
    val detail = failure.message?.trim()?.takeIf { it.isNotEmpty() && it.length <= 160 }
    val http = detail?.let { HTTP_STATUS.find(it)?.groupValues?.get(1)?.toIntOrNull() }
    return when {
        failure is java.net.SocketTimeoutException || failure is java.io.InterruptedIOException -> "The source took too long to respond"
        failure is java.net.UnknownHostException || failure is java.net.ConnectException -> "Could not reach the source"
        failure is javax.net.ssl.SSLException -> "Secure connection to the source failed"
        http == 403 || http == 429 -> "The source refused the request (HTTP $http) — it may be rate limiting or need a login"
        http == 404 -> "The source no longer has this novel (HTTP 404)"
        http != null && http >= 500 -> "The source is having problems (HTTP $http)"
        failure is java.io.IOException -> "Network error" + (detail?.let { ": $it" } ?: "")
        else -> "The source could not be read" + (detail?.let { ": $it" } ?: "")
    }
}
