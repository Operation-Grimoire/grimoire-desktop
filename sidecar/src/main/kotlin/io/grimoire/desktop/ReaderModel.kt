package io.grimoire.desktop

import io.grimoire.api.model.filter.Filter
import io.grimoire.api.model.novel.Chapter
import io.grimoire.api.model.novel.Novel
import io.grimoire.api.model.novel.NovelPage
import io.grimoire.api.model.novel.NovelStatus
import io.grimoire.api.model.novel.PageContent
import io.grimoire.api.source.Source
import io.grimoire.api.source.feature.FilterSource
import io.grimoire.api.source.feature.SearchSource
import io.grimoire.api.source.web.ChapterListSource
import io.grimoire.api.source.web.CursorPaginatedSource
import io.grimoire.api.source.web.PageListSource
import io.grimoire.api.source.web.getAllChapters
import io.grimoire.reading.ChapterKey
import io.grimoire.reading.NovelKey
import io.grimoire.reading.ChapterLoader
import io.grimoire.reading.ChapterPageAccess
import io.grimoire.reading.ChapterLoadFailure
import io.grimoire.reading.ChapterLoadException
import io.grimoire.reading.storage.*
import io.grimoire.reading.anchor.*
import io.grimoire.reading.state.ReadingCompletionInput
import io.grimoire.reading.state.ReadingStateFacade
import io.grimoire.reading.encodeChapterContent
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

enum class View { LIBRARY, UPDATES, BROWSE, BOOK, READER, HISTORY, EXTENSIONS, SETTINGS }
data class ReaderState(
    val view: View = View.LIBRARY,
    val library: List<SavedBook> = emptyList(),
    val novels: List<Novel> = emptyList(),
    val book: SavedBook? = null,
    val chapter: Chapter? = null,
    val pages: List<NovelPage> = emptyList(),
    val projection: ReadingProjection? = null,
    val observedAnchor: ReadingAnchor? = null,
    val storageObservation: ChapterStorageObservation? = null,
    val checkpointLoad: ReaderCheckpointLoad? = null,
    val positionNotice: String? = null,
    val sourceName: String? = null,
    val busy: Boolean = false,
    val offline: Boolean = false,
    val error: String? = null,
    val historyRecording: Boolean = false,
    val history: List<DesktopHistoryEntry> = emptyList(),
    val bookOrigin: View = View.LIBRARY,
    val sources: List<BrowseSource> = emptyList(),
    val browseSource: Long? = null,
    val browseModes: List<BrowseMode> = emptyList(),
    val browseMode: BrowseMode? = null,
    /** The submitted search; typing alone does not change it. */
    val browseQuery: String = "",
    /** Pages loaded for the current listing; 0 until the first page arrives. */
    val browsePage: Int = 0,
    val browseHasMore: Boolean = false,
    /** The current source's filters; null when it has none. */
    val browseFilters: BrowseFilterPanel? = null,
    val extensionRows: List<ExtensionRow> = emptyList(),
    val repositories: List<RepositoryView> = emptyList(),
    val pendingRepository: PendingRepository? = null,
    val extensionNotice: String? = null,
    val localExtension: String? = null,
    /** Progress or result of the last backup or restore. */
    val backupNotice: String? = null,
    val appearance: DesktopAppearance = DesktopAppearance(),
    val readerSettings: DesktopReaderSettings = DesktopReaderSettings(),
    val categories: List<DesktopCategory> = emptyList(),
    val updates: List<DesktopUpdateEntry> = emptyList(),
    val updateIssues: List<DesktopUpdateIssue> = emptyList(),
    /** Non-null while a library refresh runs; it does not block other actions. */
    val libraryUpdate: LibraryUpdateProgress? = null,
    val lastLibraryUpdate: LibraryUpdateSummary? = null,
    val libraryUpdateSettings: LibraryUpdateSettings = LibraryUpdateSettings(),
    /** Novels whose single-novel retry is running from the issues list. */
    val retryingIssues: Set<NovelKey> = emptySet(),
    val autoBackup: AutoBackupSettings = AutoBackupSettings(),
    val lastAutoBackup: AutoBackupStatus? = null,
    val autoBackupRunning: Boolean = false,
    /** New-chapter notifications for the window to post; it acknowledges each once shown. */
    val chapterAlerts: List<ChapterAlert> = emptyList(),
)

data class BrowseSource(val sourceId: Long, val name: String, val lang: String)

/** Owns operations and source lifetime; the Compose screen only projects this state. */
class ReaderModel(
    private val library: LocalLibrary,
    private val hostApi: String,
    private val networkEnabled: AtomicBoolean,
    private val chapterLoader: ChapterLoader,
    private val membership: LibraryRepository,
    private val downloads: DownloadRepository,
    checkpointDao: ReadingCheckpointDao = DesktopReadingCheckpointDao(library),
    operationDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val extensions: ExtensionManager? = null,
    startScheduler: Boolean = false,
) {
    private val scope = CoroutineScope(SupervisorJob() + operationDispatcher)
    private val checkpoints = ReaderCheckpoints(checkpointDao)
    private val readingStates = ReadingStateFacade(DesktopReadingStateDao(library), backfill = null)
    private val closing = AtomicBoolean(false)
    private val storageClosed = AtomicBoolean(false)
    private val closeWrites = Mutex()
    private val operationLock = Any()
    // Installed extensions by package, plus at most one development manifest for this session.
    // Library updates read both from their own worker, so writes must be visible across threads.
    private val installed: MutableMap<String, LocalExtension> = java.util.concurrent.ConcurrentHashMap()
    @Volatile private var sessionExtension: LocalExtension? = null
    private var extensionFailures: Map<String, String> = emptyMap()
    private val mutable = MutableStateFlow(
        ReaderState(
            library = library.saved(),
            historyRecording = library.historyRecording(),
            appearance = library.appearance(),
            readerSettings = library.readerSettings(),
            categories = library.categories(),
            updates = library.libraryUpdates(),
            updateIssues = library.updateIssues(),
            lastLibraryUpdate = library.lastLibraryUpdate(),
            libraryUpdateSettings = library.libraryUpdateSettings(),
            autoBackup = library.autoBackupSettings(),
            lastAutoBackup = library.lastAutoBackup(),
        ),
    )
    // Backups and restores never overlap, so a backup never captures a half-restored library.
    private val backupLock = Mutex()
    // Library refreshes run beside navigation instead of claiming the busy flag.
    private val updaterScope = CoroutineScope(SupervisorJob() + operationDispatcher)
    private val updater = LibraryUpdater(library) { id -> extensionFor(id)?.source }
    private var libraryUpdateJob: Job? = null
    private val publishLock = Any()
    @Volatile private var lastScheduledAttempt = 0L
    /** Outside-library novels already retried after a library update this session. */
    private val leftoverAttempts: MutableSet<NovelKey> = java.util.concurrent.ConcurrentHashMap.newKeySet()
    private val alertIds = AtomicLong(0)
    // The history worker is drained separately from navigation jobs before closing the store.
    private val historyScope = CoroutineScope(SupervisorJob() + operationDispatcher)
    private val historyWrites = OpenedHistoryWrites(historyScope, DesktopOpenedHistoryDao(library)) { failure ->
        System.getLogger("OpenedHistory").log(System.Logger.Level.WARNING, "Reading history action failed (${failure.javaClass.simpleName})")
    }
    private var lastHistoryOpen: Deferred<Result<Unit>>? = null
    // Reader settings save in order without blocking the reader; close drains them.
    @OptIn(ExperimentalCoroutinesApi::class)
    private val settingsScope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    private val themeModeGeneration = AtomicLong(0)
    private val colorThemeGeneration = AtomicLong(0)
    private val historyRecordingGeneration = AtomicLong(0)
    val state = mutable.asStateFlow()

    init {
        // Installed extensions load from the local store before the first frame; no network access.
        extensions?.let { manager ->
            try {
                val (loaded, failures) = manager.loadInstalled()
                installed.putAll(loaded)
                extensionFailures = failures
                publishSources()
                publishExtensions()
            } catch (failure: Exception) {
                // The library stays usable without extensions; the Extensions screen shows why.
                mutable.update { it.copy(extensionNotice = "Could not load installed extensions: ${failure.message}") }
            }
        }
        if (startScheduler) {
            startLibraryUpdateScheduler()
            startAutoBackupScheduler()
        }
    }

    private fun extensionFor(sourceId: Long?): LocalExtension? = sourceId?.let { id ->
        installed.values.firstOrNull { it.sourceId == id } ?: sessionExtension?.takeIf { it.sourceId == id }
    }

    private fun browseSources(): List<BrowseSource> = (installed.values + listOfNotNull(sessionExtension))
        .distinctBy { it.sourceId }
        .map { BrowseSource(it.sourceId, it.source.name, it.source.lang.code) }
        .sortedBy { it.name.lowercase() }

    // The current source's own filter objects; searches pass these, with the UI's states written in.
    private val filterLock = Any()
    @Volatile private var filterSource: Source? = null
    private var filterList: List<Filter<*>> = emptyList()
    private var filterDefaults: List<FilterEntry> = emptyList()

    /** Loads the filter list when the Browse source changes, or its extension was reloaded. */
    private fun syncBrowseFilters() = synchronized(filterLock) {
        val id = state.value.browseSource
        val source = extensionFor(id)?.source
        if (source === filterSource) return
        filterSource = source
        val list = if (source is FilterSource && source is SearchSource) {
            runCatching { source.getFilterList() }.getOrDefault(emptyList())
        } else emptyList()
        filterList = list
        filterDefaults = snapshotFilters(list, null)
        val panel = if (id == null || list.isEmpty()) null else BrowseFilterPanel(
            sourceId = id,
            status = if (runCatching { (source as FilterSource).hasDynamicFilters }.getOrDefault(false)) FilterStatus.NEEDS_LOAD else FilterStatus.READY,
            entries = filterDefaults,
            searchWithFilters = runCatching { (source as SearchSource).supportsSearchWithFilters }.getOrDefault(false),
        )
        mutable.update { st ->
            // Results filtered through the replaced objects can't be paged further; start over.
            if (st.browseFilters?.applied == true && st.browseMode == BrowseMode.SEARCH) {
                st.copy(browseFilters = panel, novels = emptyList(), browsePage = 0, browseHasMore = false)
            } else st.copy(browseFilters = panel)
        }
    }

    /** Puts every filter back to its default; the listing is no longer filtered. */
    private fun clearBrowseFilters() = synchronized(filterLock) {
        applyFilterInputs(filterList, defaultInputs(filterDefaults))
        val entries = snapshotFilters(filterList, filterDefaults)
        mutable.update { st -> st.copy(browseFilters = st.browseFilters?.copy(entries = entries, applied = false)) }
    }

    /** Fetches filter options that come from the site, such as its genre list. */
    fun loadFilterOptions() = navigate {
        val source = synchronized(filterLock) { filterSource } as? FilterSource ?: error("This source has no filters")
        check(!state.value.offline) { "Loading filter options is unavailable offline" }
        fun publish(change: (BrowseFilterPanel) -> BrowseFilterPanel) = mutable.update { st ->
            val panel = st.browseFilters
            if (panel == null || filterSource !== source) st else st.copy(browseFilters = change(panel))
        }
        publish { it.copy(status = FilterStatus.LOADING, error = null) }
        try {
            val list = source.fetchFilterOptions()
            synchronized(filterLock) {
                if (filterSource !== source) return@navigate
                filterList = list
                filterDefaults = snapshotFilters(list, null)
                publish { it.copy(status = if (list.isEmpty()) FilterStatus.ERROR else FilterStatus.LOADED,
                    entries = filterDefaults, applied = false,
                    error = if (list.isEmpty()) "The source returned no filter options" else null) }
            }
        } catch (cancelled: CancellationException) {
            publish { it.copy(status = FilterStatus.NEEDS_LOAD) }
            throw cancelled
        } catch (failure: Throwable) {
            if (failure is VirtualMachineError) throw failure
            publish { it.copy(status = FilterStatus.ERROR, error = failure.message ?: failure.javaClass.simpleName) }
        }
    }

    /** Searches with [inputs] written into the source's filters; [query] counts only where the source allows it. */
    fun applyFilters(inputs: List<FilterInput>, query: String) = navigate {
        check(!state.value.offline) { "Browsing is unavailable offline" }
        check(BrowseMode.SEARCH in state.value.browseModes) { "This source cannot search" }
        val panel = state.value.browseFilters ?: error("This source has no filters")
        check(panel.status.canApply) { "Load the filter options first" }
        val entries = synchronized(filterLock) {
            applyFilterInputs(filterList, inputs)
            snapshotFilters(filterList, filterDefaults)
        }
        val text = if (panel.searchWithFilters) query.trim() else ""
        publishView { it.leaveBook(View.BROWSE).copy(browseMode = BrowseMode.SEARCH, browseQuery = text, browsePage = 0,
            browseHasMore = false, novels = emptyList(), browseFilters = panel.copy(entries = entries, applied = true)) }
        loadCatalog(reset = true)
    }

    /** Back to an unfiltered listing: a typed search runs again without filters, a blank one waits for input. */
    fun clearFilters() = navigate {
        clearBrowseFilters()
        publishView { it.leaveBook(View.BROWSE).copy(browsePage = 0, browseHasMore = false, novels = emptyList()) }
        val st = state.value
        if (!st.offline && (st.listsWithoutQuery || (st.browseMode == BrowseMode.SEARCH && st.browseQuery.isNotBlank()))) {
            loadCatalog(reset = true)
        }
    }

    /** Publishes the source list and keeps the Browse selection only while its source is still loaded. */
    private fun publishSources(select: Long? = null) {
        val sources = browseSources()
        mutable.update { current ->
            val keep = select ?: current.browseSource?.takeIf { id -> sources.any { it.sourceId == id } }
            val chosen = keep ?: sources.firstOrNull()?.sourceId
            val modes = extensionFor(chosen)?.source?.let(::browseModes).orEmpty()
            val named = current.copy(sources = sources, browseSource = chosen, sourceName = sources.firstOrNull { it.sourceId == chosen }?.name)
            // A different source starts on its first listing with nothing loaded.
            if (chosen == current.browseSource && current.browseMode in modes) named.copy(browseModes = modes)
            else named.copy(browseModes = modes, browseMode = modes.firstOrNull(), browseQuery = "", browsePage = 0,
                browseHasMore = false, novels = emptyList())
        }
        syncBrowseFilters()
    }

    private fun publishExtensions(notice: String? = null) {
        val manager = extensions ?: return
        val rows = manager.rows(extensionFailures)
        val repositories = manager.repositoryViews()
        mutable.update { it.copy(extensionRows = rows, repositories = repositories, extensionNotice = notice) }
    }

    fun load(manifest: Path) = navigate {
        val loaded = LocalExtension.open(manifest, hostApi)
        if (loaded.packageName in installed || extensions?.installed()?.any { it.pkg == loaded.packageName } == true) {
            loaded.close()
            error("${loaded.source.name} is installed. Remove it before opening a local copy.")
        }
        try { sessionExtension?.close() }
        catch (failure: Exception) { loaded.close(); throw failure }
        sessionExtension = loaded
        val saved = library.saved()
        publishSources(select = loaded.sourceId)
        publishView { it.copy(localExtension = loaded.source.name, view = if (it.view == View.EXTENSIONS) View.EXTENSIONS else View.LIBRARY,
            novels = emptyList(), browsePage = 0, browseHasMore = false, book = null, chapter = null, pages = emptyList(), library = saved,
            projection = null, observedAnchor = null, storageObservation = null, checkpointLoad = null, positionNotice = null) }
    }

    fun refreshRepositories() = operate { refreshCatalogs() }

    private fun refreshCatalogs() {
        val manager = extensions ?: return
        check(!state.value.offline) { "Go online to refresh extension repositories" }
        val failures = manager.refresh()
        publishExtensions(failures.takeIf { it.isNotEmpty() }?.joinToString("\n"))
    }

    fun installExtension(row: ExtensionRow) = operate {
        val manager = extensions ?: return@operate
        check(!state.value.offline) { "Go online to install extensions" }
        check(sessionExtension?.packageName != row.pkg) { "Close the local copy of ${row.name} first" }
        val loaded = try { manager.install(row.repository, row.pkg) }
        finally { publishExtensions() }
        val replaced = installed.put(row.pkg, loaded)
        extensionFailures = extensionFailures - row.pkg
        runCatching { replaced?.close() }
        publishSources()
        publishExtensions("${loaded.source.name} ${loaded.versionName} is installed")
    }

    fun removeExtension(row: ExtensionRow) = operate {
        val manager = extensions ?: return@operate
        manager.remove(row.pkg)
        extensionFailures = extensionFailures - row.pkg
        installed.remove(row.pkg)?.let { runCatching { it.close() } }
        publishSources()
        publishExtensions("${row.name} is removed. Its library entries and saved chapters are kept.")
    }

    fun checkRepository(indexUrl: String, publicKey: String) = operate {
        val manager = extensions ?: return@operate
        check(!state.value.offline) { "Go online to add a repository" }
        val pending = manager.check(indexUrl, publicKey)
        mutable.update { it.copy(pendingRepository = pending, extensionNotice = null) }
    }

    fun confirmRepository() = operate {
        val manager = extensions ?: return@operate
        val pending = state.value.pendingRepository ?: return@operate
        manager.enroll(pending)
        mutable.update { it.copy(pendingRepository = null) }
        // Packages it owns under this key load now instead of after a restart.
        val (loaded, failures) = manager.loadInstalled { it.repository == pending.trust.repository && it.pkg !in installed }
        installed.putAll(loaded)
        extensionFailures = extensionFailures.filterKeys { it !in loaded } + failures
        publishSources()
        publishExtensions("${pending.trust.repository} is trusted")
    }

    fun cancelRepository() = mutable.update { it.copy(pendingRepository = null) }

    fun setRepositoryEnabled(repository: String, enabled: Boolean) = operate {
        extensions?.setEnabled(repository, enabled) ?: return@operate
        publishExtensions()
    }

    fun removeRepository(repository: String) = operate {
        val manager = extensions ?: return@operate
        manager.removeRepository(repository)
        // Revoked trust stops its extensions now, not only after a restart.
        val revoked = manager.installed().filter { it.repository == repository }.map { it.pkg }
        revoked.forEach { pkg -> installed.remove(pkg)?.let { runCatching { it.close() } } }
        extensionFailures = extensionFailures + revoked.associateWith { "Repository $repository is no longer trusted" }
        publishSources()
        publishExtensions("$repository is removed")
    }

    fun selectSource(sourceId: Long) = navigate {
        check(extensionFor(sourceId) != null) { "This source is no longer installed" }
        publishSources(select = sourceId)
        publishView { it.leaveBook(View.BROWSE) }
        if (state.value.listsWithoutQuery) loadCatalog(reset = true)
    }

    /** Reloads the first page of the current listing. */
    fun browse() = navigate {
        loadCatalog(reset = true)
    }

    fun showBrowse() = navigate {
        showSection(View.BROWSE)
        if (state.value.browsePage == 0 && state.value.listsWithoutQuery) loadCatalog(reset = true)
    }

    fun setBrowseMode(mode: BrowseMode) = navigate {
        check(mode in state.value.browseModes) { "This source does not offer ${mode.label.lowercase()} titles" }
        // Popular and Latest are unfiltered; Search starts from a plain query again.
        if (state.value.browseFilters?.applied == true) clearBrowseFilters()
        publishView { it.leaveBook(View.BROWSE).copy(browseMode = mode, browsePage = 0, browseHasMore = false, novels = emptyList()) }
        if (state.value.listsWithoutQuery) loadCatalog(reset = true)
    }

    fun search(query: String) = navigate {
        val text = query.trim()
        require(text.isNotEmpty()) { "Enter a title to search for" }
        check(BrowseMode.SEARCH in state.value.browseModes) { "This source cannot search" }
        // A plain search is separate from filtering, as on Android.
        if (state.value.browseFilters?.applied == true) clearBrowseFilters()
        publishView { it.leaveBook(View.BROWSE).copy(browseMode = BrowseMode.SEARCH, browseQuery = text, browsePage = 0,
            browseHasMore = false, novels = emptyList()) }
        loadCatalog(reset = true)
    }

    fun loadMore() = navigate {
        check(state.value.view == View.BROWSE && state.value.browseHasMore) { "There are no more titles to load" }
        loadCatalog(reset = false)
    }

    /** Popular and Latest load on arrival; Search waits for a submitted query. */
    private val ReaderState.listsWithoutQuery: Boolean
        get() = !offline && browseSource != null && browseMode != null && browseMode != BrowseMode.SEARCH

    private suspend fun loadCatalog(reset: Boolean) {
        check(!state.value.offline) { "Browsing is unavailable offline" }
        val request = state.value
        val source = extensionFor(request.browseSource)?.source ?: error("Choose a source to browse")
        val mode = request.browseMode ?: error("This source has no catalog to browse")
        val page = if (reset) 1 else request.browsePage + 1
        val filtered = mode == BrowseMode.SEARCH && request.browseFilters?.applied == true
        val filters = if (filtered) synchronized(filterLock) { filterList.takeIf { filterSource === source } }
            ?: error("The filters changed; apply them again") else emptyList()
        val result = catalogPage(source, mode, request.browseQuery, page, filters)
        publishView { current ->
            // A result for another source, listing, query or filter set is dropped.
            if (current.browseSource != request.browseSource || current.browseMode != mode || current.browseQuery != request.browseQuery ||
                current.browseFilters?.applied != request.browseFilters?.applied) current
            else {
                val listing = mergeCatalog(if (reset) emptyList() else current.novels, result)
                current.leaveBook(View.BROWSE).copy(novels = listing.novels, browsePage = page, browseHasMore = listing.hasMore)
            }
        }
    }

    fun details(novel: Novel) = navigate {
        check(state.value.view == View.BROWSE && novel in state.value.novels) { "This catalog selection is no longer current" }
        check(!state.value.offline) { "Novel refresh is unavailable offline" }
        val loaded = extensionFor(state.value.browseSource) ?: error("This source is no longer installed")
        val source = loaded.source
        check(source is ChapterListSource || source is CursorPaginatedSource) { "This source's chapter list is unsupported" }
        val details = source.getNovelDetails(novel)
        val chapters = sourceChapters(source, details)
        check(chapters.isNotEmpty()) { "The source returned no chapters" }
        val book = library.remember(NovelKey(loaded.sourceId, details.url), details, chapters)
        publishView { it.leaveBook(View.BOOK).copy(book = book, bookOrigin = View.BROWSE) }
    }

    fun showLibrary() {
        synchronized(operationLock) {
            if (!state.value.busy && !closing.get() && state.value.view != View.READER) {
                mutable.update { it.leaveBook(View.LIBRARY) }
            }
        }
        navigate { showSection(View.LIBRARY) }
    }

    fun showHistory() {
        synchronized(operationLock) {
            if (!state.value.busy && !closing.get() && state.value.view != View.READER) {
                mutable.update { it.leaveBook(View.HISTORY) }
            }
        }
        navigate { showSection(View.HISTORY) }
    }

    fun showExtensions() {
        synchronized(operationLock) {
            if (!state.value.busy && !closing.get() && state.value.view != View.READER) {
                mutable.update { it.leaveBook(View.EXTENSIONS) }
            }
        }
        navigate {
            showSection(View.EXTENSIONS)
            publishExtensions()
            // First visit online: fetch catalogs never downloaded. Failures stay on this screen.
            val manager = extensions
            if (manager != null && !state.value.offline && manager.repositoryViews().any { it.enabled && !it.refreshed }) {
                try { refreshCatalogs() } catch (failure: Exception) { publishExtensions(failure.message) }
            }
        }
    }

    fun showSettings() {
        synchronized(operationLock) {
            if (state.value.busy || closing.get()) return
            if (state.value.view != View.READER) {
                mutable.update { it.leaveBook(View.SETTINGS).copy(error = null) }
                return
            }
        }
        navigate { showSection(View.SETTINGS) }
    }

    fun back() = navigate {
        val current = state.value
        when (current.view) {
            View.READER -> publishView { it.leaveBook(View.BOOK).copy(book = it.book) }
            View.BOOK -> showSection(current.bookOrigin)
            else -> Unit
        }
    }

    private suspend fun showSection(section: View) {
        when (section) {
            View.LIBRARY -> {
                val saved = library.saved()
                publishView { it.leaveBook(section).copy(library = saved) }
            }
            View.UPDATES -> synchronized(publishLock) {
                val saved = library.saved()
                val feed = library.libraryUpdates()
                val issues = library.updateIssues()
                publishView { it.leaveBook(section).copy(library = saved, updates = feed, updateIssues = issues) }
            }
            View.HISTORY -> {
                lastHistoryOpen?.join()
                val entries = library.openedHistory()
                publishView { it.leaveBook(section).copy(history = entries) }
            }
            else -> publishView { it.leaveBook(section) }
        }
    }

    private fun ReaderState.leaveBook(view: View) = copy(
        view = view, book = null, chapter = null, pages = emptyList(), projection = null,
        observedAnchor = null, storageObservation = null, checkpointLoad = null, positionNotice = null,
    )

    fun setHistoryRecording(enabled: Boolean) {
        synchronized(operationLock) {
            if (closing.get()) return
            val gen = historyRecordingGeneration.incrementAndGet()
            mutable.update { it.copy(historyRecording = enabled, error = null) }
            settingsScope.launch {
                try {
                    library.setHistoryRecording(enabled)
                } catch (failure: Exception) {
                    val stored = runCatching { library.historyRecording() }.getOrElse { !enabled }
                    mutable.update { current ->
                        current.copy(
                            historyRecording = if (historyRecordingGeneration.get() == gen) stored else current.historyRecording,
                            error = "Could not save history setting: ${failure.message ?: failure.javaClass.simpleName}",
                        )
                    }
                }
            }
        }
    }

    fun setAppearance(appearance: DesktopAppearance) = updateAppearance(
        updatesThemeMode = true,
        updatesColorTheme = true,
        optimistic = { appearance },
        write = { library.setAppearance(appearance) },
    )

    fun setThemeMode(themeMode: ThemeMode) = updateAppearance(
        updatesThemeMode = true,
        updatesColorTheme = false,
        optimistic = { it.copy(themeMode = themeMode) },
        write = { library.setThemeMode(themeMode) },
    )

    fun setColorTheme(colorTheme: ColorTheme) = updateAppearance(
        updatesThemeMode = false,
        updatesColorTheme = true,
        optimistic = { it.copy(colorTheme = colorTheme) },
        write = { library.setColorTheme(colorTheme) },
    )

    private fun updateAppearance(
        updatesThemeMode: Boolean,
        updatesColorTheme: Boolean,
        optimistic: (DesktopAppearance) -> DesktopAppearance,
        write: () -> Unit,
    ) {
        synchronized(operationLock) {
            if (closing.get()) return
            val modeGen = if (updatesThemeMode) themeModeGeneration.incrementAndGet() else null
            val colorGen = if (updatesColorTheme) colorThemeGeneration.incrementAndGet() else null
            mutable.update { it.copy(appearance = optimistic(it.appearance), error = null) }
            settingsScope.launch {
                try {
                    write()
                } catch (failure: Exception) {
                    val stored = runCatching { library.appearance() }.getOrNull()
                    mutable.update { current ->
                        val reconciled = if (stored == null) current.appearance else current.appearance.copy(
                            themeMode = if (modeGen != null && themeModeGeneration.get() == modeGen) stored.themeMode else current.appearance.themeMode,
                            colorTheme = if (colorGen != null && colorThemeGeneration.get() == colorGen) stored.colorTheme else current.appearance.colorTheme,
                        )
                        current.copy(
                            appearance = reconciled,
                            error = "Could not save appearance: ${failure.message ?: failure.javaClass.simpleName}",
                        )
                    }
                }
            }
        }
    }

    /** Applies immediately; the save runs in the background and reports a failure as an error. */
    fun setReaderSettings(settings: DesktopReaderSettings) {
        synchronized(operationLock) {
            if (closing.get()) return
            val value = settings.normalized()
            mutable.update { it.copy(readerSettings = value) }
            settingsScope.launch {
                try { library.setReaderSettings(value) }
                catch (failure: Exception) {
                    mutable.update { it.copy(error = "Could not save reader settings: ${failure.message ?: failure.javaClass.simpleName}") }
                }
            }
        }
    }

    fun readPrevious() = readAdjacent(-1)

    fun readNext() = readAdjacent(1)

    private fun readAdjacent(step: Int) = navigate {
        val current = state.value
        check(current.view == View.READER) { "Open a chapter first" }
        val book = current.book ?: error("Open a novel first")
        val chapter = current.chapter ?: error("Open a chapter first")
        val target = adjacentChapter(book.chapters, chapter, step) ?: error(if (step < 0) "This is the first chapter" else "This is the last chapter")
        if (step > 0) {
            val currentKey = ChapterKey(book.key, chapter.url)
            val input = ReadingCompletionInput.Next(
                key = currentKey,
                loadedChapter = currentKey,
                hasSuccessor = true,
                atMillis = System.currentTimeMillis(),
            )
            readingStates.prepareExplicit(input)?.let { readingStates.submit(it) }
        }
        val refreshedBook = library.book(book.key) ?: book
        readChapter(refreshedBook, target, current.bookOrigin)
    }

    /** Marks the active chapter in Reader read (e.g. after scrolling past threshold) without interrupting reading. */
    fun markCurrentChapterRead() {
        val current = state.value
        val book = current.book ?: return
        val chapter = current.chapter ?: return
        if (current.view != View.READER || chapter.url in book.readChapters) return
        val key = ChapterKey(book.key, chapter.url)
        synchronized(operationLock) {
            if (closing.get()) return
            settingsScope.launch {
                runCatching {
                    val input = ReadingCompletionInput.MarkRead(key, System.currentTimeMillis())
                    readingStates.prepareExplicit(input)?.let { readingStates.submit(it) }
                    val updated = library.book(book.key)
                    mutable.update { st ->
                        st.copy(
                            book = if (st.book?.key == book.key && updated != null) updated else st.book,
                            library = library.saved(),
                        )
                    }
                }
            }
        }
    }

    fun markChaptersRead(chapterUrls: List<String>, read: Boolean) = operate {
        val book = state.value.book ?: error("Open a novel first")
        val now = System.currentTimeMillis()
        chapterUrls.distinct().forEach { url ->
            val key = ChapterKey(book.key, url)
            val input = if (read) ReadingCompletionInput.MarkRead(key, now) else ReadingCompletionInput.MarkUnread(key)
            readingStates.prepareExplicit(input)?.let { readingStates.submit(it) }
        }
        val updated = library.book(book.key)
        mutable.update { it.copy(book = updated ?: it.book, library = library.saved()) }
    }

    /** Same guards as a library update: a blank or truncated response never replaces the stored list. */
    fun refreshBook() = operate {
        val current = state.value.book ?: error("Open a novel first")
        check(!state.value.offline) { "Go online to refresh this novel" }
        val loaded = extensionFor(current.key.sourceId) ?: error("This novel's source is not installed")
        val source = loaded.source
        check(source is ChapterListSource || source is CursorPaginatedSource) { "This source's chapter list is unsupported" }
        val details = source.getNovelDetails(current.novel)
        val chapters = sourceChapters(source, mergeNovelMetadata(current.novel, details))
        val outcome = library.applyRefresh(current.key, details, chapters, requireFavorite = false, System.currentTimeMillis())
        publishUpdateResults(current.key)
        (outcome as? RefreshOutcome.Updated)?.warning?.let { error(it) }
    }

    fun downloadChapters(chapterUrls: List<String>) = operate {
        val book = state.value.book ?: error("Open a novel first")
        downloadInto(book, chapterUrls)
    }

    private suspend fun downloadInto(book: SavedBook, chapterUrls: List<String>) {
        check(!state.value.offline) { "Go online to download chapters" }
        val loaded = extensionFor(book.key.sourceId) ?: error("Install this novel's extension to download chapters")
        val source = loaded.source as? PageListSource ?: error("This source cannot provide chapter pages")
        val chaptersByUrl = book.chapters.associateBy { it.url }
        for (url in chapterUrls.distinct()) {
            val chapter = chaptersByUrl[url] ?: continue
            if (chapter.locked || url in book.downloaded) continue
            val key = ChapterKey(book.key, url)
            val attempt = downloads.claim(key) ?: continue
            try {
                val pages = source.getPageList(chapter)
                check(downloads.commit(attempt, pages) is DownloadCommit.Committed) { "Could not save ${chapter.name}" }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                runCatching { downloads.fail(attempt, DownloadFailure.ERROR) }
                throw failure
            }
            mutable.update { st -> st.copy(book = if (st.book?.key == book.key) library.book(book.key) ?: st.book else st.book, library = library.saved()) }
        }
    }

    fun showUpdates() {
        synchronized(operationLock) {
            if (!state.value.busy && !closing.get() && state.value.view != View.READER) {
                mutable.update { it.leaveBook(View.UPDATES) }
            }
        }
        navigate { showSection(View.UPDATES) }
    }

    /** Refreshes the whole library, or one category. Runs beside reading and browsing. */
    fun updateLibrary(categoryId: Long?) {
        synchronized(operationLock) {
            if (closing.get() || libraryUpdateJob?.isActive == true) return
            if (state.value.offline) {
                mutable.update { it.copy(error = "Go online to update your library") }
                return
            }
            mutable.update { it.copy(libraryUpdate = LibraryUpdateProgress(0, 0, null, categoryId), error = null) }
            libraryUpdateJob = updaterScope.launch { runLibraryUpdate(categoryId) }
        }
    }

    /**
     * Refreshes [keys] only, regardless of the skip-completed setting; never moves the schedule.
     * Waits for a running update, whose targets were chosen before these novels existed.
     * Returns false when nothing will run (offline, closing or no keys).
     */
    private fun updateBooks(keys: Set<NovelKey>): Boolean {
        synchronized(operationLock) {
            if (closing.get() || keys.isEmpty() || state.value.offline) return false
            val running = libraryUpdateJob?.takeIf { it.isActive }
            if (running != null) {
                updaterScope.launch { running.join(); updateBooks(keys) }
                return true
            }
            mutable.update { it.copy(libraryUpdate = LibraryUpdateProgress(0, 0, null, null)) }
            libraryUpdateJob = updaterScope.launch { runLibraryUpdate(null, keys) }
            return true
        }
    }

    /** Queues a notification and an automatic download for a library novel, as its settings ask. */
    private fun noteNewChapters(key: NovelKey, found: List<Chapter>, autoDownloads: MutableMap<NovelKey, List<String>>) {
        val book = library.book(key)?.takeIf { it.favorite } ?: return
        val plan = planNewChapters(book.alerts, found)
        if (plan.readable + plan.locked > 0) {
            val alert = ChapterAlert(alertIds.incrementAndGet(), key, book.effectiveNovel().title, plan.readable, plan.locked)
            mutable.update { st -> st.copy(chapterAlerts = (st.chapterAlerts + alert).takeLast(MAX_PENDING_ALERTS)) }
        }
        if (plan.download.isNotEmpty()) autoDownloads.merge(key, plan.download) { a, b -> a + b }
    }

    private suspend fun downloadNewChapters(queue: Map<NovelKey, List<String>>) {
        val total = queue.values.sumOf { it.size }
        var done = 0
        var failedNovels = 0
        for ((key, urls) in queue) {
            val book = library.book(key) ?: continue
            mutable.update { st ->
                st.copy(libraryUpdate = st.libraryUpdate?.copy(done = done, total = total,
                    current = "Downloading ${book.effectiveNovel().title}"))
            }
            try {
                downloadInto(book, urls)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                failedNovels++
            }
            done += urls.size
        }
        if (failedNovels > 0) {
            mutable.update { it.copy(error = "Couldn't download new chapters for ${plural(failedNovels, "novel")}") }
        }
    }

    /** Drops notifications the window has shown. */
    fun acknowledgeChapterAlerts(ids: Collection<Long>) {
        val shown = ids.toSet()
        mutable.update { st -> st.copy(chapterAlerts = st.chapterAlerts.filterNot { it.id in shown }) }
    }

    fun setNewChapterAlerts(key: NovelKey, change: (NewChapterAlerts) -> NewChapterAlerts) = mutateBook(key) {
        it.copy(alerts = change(it.alerts))
    }

    fun cancelLibraryUpdate() {
        libraryUpdateJob?.cancel()
    }

    private suspend fun runLibraryUpdate(categoryId: Long?, only: Set<NovelKey>? = null) {
        val checked = AtomicInteger()
        val found = AtomicInteger()
        val warnings = AtomicInteger()
        val errors = AtomicInteger()
        val lastPublish = AtomicLong(0L)
        var finished = false
        var failed = false
        // Novels that asked for new chapters to be downloaded, drained after the refresh like Android.
        val autoDownloads = java.util.concurrent.ConcurrentHashMap<NovelKey, List<String>>()
        try {
            val settings = state.value.libraryUpdateSettings
            // Chosen novels may be outside the library (restored reading history).
            val targets = if (only != null) library.allBooks().filter { it.key in only }
            else library.saved().filter { book ->
                (categoryId == null || book.categoryId == categoryId) &&
                    !(settings.skipCompleted && book.effectiveNovel().status == NovelStatus.COMPLETED)
            }
            updater.run(
                targets,
                settings.concurrency,
                requireFavorite = only == null,
                onProgress = { done, total, title ->
                    mutable.update { st ->
                        val p = st.libraryUpdate ?: return@update st
                        st.copy(libraryUpdate = p.copy(done = done, total = total, current = title ?: p.current))
                    }
                },
                onNovelDone = { key, outcome ->
                    checked.incrementAndGet()
                    when (outcome) {
                        is RefreshOutcome.Updated -> {
                            found.addAndGet(outcome.newChapters)
                            if (outcome.warned) warnings.incrementAndGet()
                            if (outcome.found.isNotEmpty()) runCatching { noteNewChapters(key, outcome.found, autoDownloads) }
                        }
                        RefreshOutcome.Failed -> errors.incrementAndGet()
                        RefreshOutcome.Skipped -> Unit
                    }
                    // Re-reading the whole library per novel is quadratic; publish at most once a second.
                    val now = System.currentTimeMillis()
                    val previous = lastPublish.get()
                    if ((now - previous >= 1_000L && lastPublish.compareAndSet(previous, now)) ||
                        outcome.newChapters > 0 || state.value.book?.key == key) {
                        runCatching { publishUpdateResults(key) }
                    }
                },
            )
            finished = true
            if (autoDownloads.isNotEmpty() && !state.value.offline) downloadNewChapters(autoDownloads)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            failed = true
            mutable.update { it.copy(error = "Library update failed: ${failure.message ?: failure.javaClass.simpleName}") }
        } finally {
            val summary = LibraryUpdateSummary(System.currentTimeMillis(), checked.get(), found.get(), warnings.get(),
                errors.get(), cancelled = !finished && !failed, failed = failed, categoryId = categoryId,
                targeted = only != null)
            // A targeted run (restored novels) is housekeeping; it keeps the library run's summary.
            if (!closing.get()) withContext(NonCancellable) {
                if (only == null) runCatching { library.setLastLibraryUpdate(summary) }
                // Only a completed whole-library run moves the schedule.
                if (finished && categoryId == null && only == null) runCatching { library.setLastFullLibraryUpdate(summary.finishedAt) }
                runCatching { publishUpdateResults(null) }
            }
            mutable.update { st -> st.copy(libraryUpdate = null, lastLibraryUpdate = if (only == null) summary else st.lastLibraryUpdate) }
            // Restored reading history outside the library is not a library target. After a whole-library
            // run, finish its lists once per session, and only where the source is installed.
            if (finished && categoryId == null && only == null && !closing.get()) {
                val leftover = runCatching {
                    library.allBooks().filter {
                        !it.favorite && it.chaptersIncomplete && it.key !in leftoverAttempts && extensionFor(it.key.sourceId) != null
                    }.mapTo(HashSet()) { it.key }
                }.getOrDefault(emptySet())
                leftoverAttempts += leftover
                if (leftover.isNotEmpty()) updaterScope.launch { updateBooks(leftover) }
            }
        }
    }

    /**
     * Snapshot and publish happen under one lock, so a slower publisher can never put back
     * rows that a newer one (a later novel, a removal, a dismissal) already replaced.
     */
    private fun publishUpdateResults(key: NovelKey?) = synchronized(publishLock) {
        val saved = library.saved()
        val feed = library.libraryUpdates()
        val issues = library.updateIssues()
        val openKey = state.value.book?.key?.takeIf { key == null || it == key }
        val open = openKey?.let { library.book(it) }
        mutable.update { st ->
            st.copy(library = saved, updates = feed, updateIssues = issues,
                book = if (open != null && st.book?.key == open.key) open else st.book)
        }
    }

    /** Checks on launch and then every interval while the app stays open. */
    private fun startLibraryUpdateScheduler() {
        updaterScope.launch {
            delay(LAUNCH_UPDATE_DELAY_MS)
            if (state.value.libraryUpdateSettings.updateOnLaunch) startScheduledUpdate()
            while (isActive) {
                delay(SCHEDULER_TICK_MS)
                val settings = state.value.libraryUpdateSettings
                if (!settings.autoUpdate) continue
                // A cancelled or failed attempt waits a full interval too, instead of restarting every tick.
                val completed = runCatching { library.lastFullLibraryUpdate() }.getOrNull() ?: 0L
                val last = maxOf(completed, lastScheduledAttempt)
                if (System.currentTimeMillis() - last >= settings.intervalHours * 3_600_000L) startScheduledUpdate()
            }
        }
    }

    private fun startScheduledUpdate() {
        if (state.value.offline || state.value.library.isEmpty() || libraryUpdateJob?.isActive == true) return
        lastScheduledAttempt = System.currentTimeMillis()
        updateLibrary(null)
    }

    /**
     * Applies [change] to the latest settings at once, so quick successive toggles each build on
     * the previous one; saves run in order and the last one stores the final value.
     */
    fun changeLibraryUpdateSettings(change: (LibraryUpdateSettings) -> LibraryUpdateSettings) {
        val value = synchronized(operationLock) {
            if (closing.get()) return
            val next = change(state.value.libraryUpdateSettings).normalized()
            mutable.update { it.copy(libraryUpdateSettings = next) }
            next
        }
        background("Could not save library update settings") { library.setLibraryUpdateSettings(value) }
    }

    fun retryUpdateIssue(key: NovelKey) {
        synchronized(operationLock) {
            if (closing.get() || key in state.value.retryingIssues) return
            if (state.value.offline) {
                mutable.update { it.copy(error = "Go online to retry this update") }
                return
            }
            mutable.update { it.copy(retryingIssues = it.retryingIssues + key, error = null) }
            updaterScope.launch {
                try {
                    updater.refreshOne(key)
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    mutable.update { it.copy(error = "Retry failed: ${failure.message ?: failure.javaClass.simpleName}") }
                } finally {
                    mutable.update { it.copy(retryingIssues = it.retryingIssues - key) }
                    if (!closing.get()) runCatching { publishUpdateResults(key) }
                }
            }
        }
    }

    fun dismissUpdateIssue(key: NovelKey) = background("Could not dismiss the issue") {
        library.clearUpdateIssue(key)
        publishUpdateResults(null)
    }

    fun clearUpdateIssues() = background("Could not clear issues") {
        library.clearUpdateIssues()
        publishUpdateResults(null)
    }

    fun removeUpdates(ids: List<Long>) = background("Could not remove updates") {
        library.deleteLibraryUpdates(ids)
        publishUpdateResults(null)
    }

    fun clearUpdates() = background("Could not clear updates") {
        library.clearLibraryUpdates()
        publishUpdateResults(null)
    }

    fun markUpdatesRead(ids: List<Long>, read: Boolean) = background("Could not update read state") {
        val now = System.currentTimeMillis()
        state.value.updates.filter { it.id in ids }.forEach { entry ->
            val input = if (read) ReadingCompletionInput.MarkRead(entry.key, now) else ReadingCompletionInput.MarkUnread(entry.key)
            readingStates.prepareExplicit(input)?.let { readingStates.submit(it) }
        }
        publishUpdateResults(null)
    }

    fun downloadUpdates(ids: List<Long>) = operate {
        val byNovel = state.value.updates.filter { it.id in ids }.groupBy { it.key.novel }
        for ((novel, entries) in byNovel) {
            val book = library.book(novel) ?: continue
            downloadInto(book, entries.map { it.key.url })
        }
        publishUpdateResults(null)
    }

    fun readUpdate(id: Long) = navigate {
        val entry = state.value.updates.firstOrNull { it.id == id } ?: error("This update is no longer listed")
        val book = library.book(entry.key.novel) ?: error("This novel is no longer available")
        val chapter = book.chapters.find { it.url == entry.key.url && !it.locked }
            ?: error("This chapter is locked or unavailable")
        readChapter(book, chapter, View.UPDATES)
    }

    /** Writes an Android-compatible backup of the library and reading state to [path]. */
    fun createBackup(path: Path) = operate {
        mutable.update { it.copy(backupNotice = "Writing ${path.fileName}…") }
        reportBackupFailure("Backup failed") {
            val count = backupLock.withLock { writeLibraryBackup(path) }
            mutable.update { it.copy(backupNotice = "Backed up ${plural(count, "novel")} to ${path.fileName}") }
        }
    }

    /** Writes a backup to [path] and returns how many novels it holds. */
    private fun writeLibraryBackup(path: Path): Int {
        val books = library.allBooks()
        writeBackup(path, books, library.categories(), extensions?.repositoryViews().orEmpty(),
            System.getProperty("grimoire.version") ?: "dev", System.currentTimeMillis())
        return books.count { it.favorite || it.readChapters.isNotEmpty() }
    }

    /** Backs up into the chosen folder now, whether or not one is due. */
    fun backUpNow() {
        synchronized(operationLock) {
            if (closing.get() || state.value.autoBackupRunning) return
            updaterScope.launch { runAutoBackup() }
        }
    }

    /** Like [changeLibraryUpdateSettings]: applied at once, saved in order. */
    fun changeAutoBackupSettings(change: (AutoBackupSettings) -> AutoBackupSettings) {
        val value = synchronized(operationLock) {
            if (closing.get()) return
            val next = change(state.value.autoBackup).normalized()
            mutable.update { it.copy(autoBackup = next) }
            next
        }
        background("Could not save automatic backup settings") { library.setAutoBackupSettings(value) }
    }

    /** Checks once a minute while the app is open; a missed backup runs on the next launch. */
    private fun startAutoBackupScheduler() {
        updaterScope.launch {
            delay(LAUNCH_BACKUP_DELAY_MS)
            while (isActive) {
                val due = nextAutoBackupAt(state.value.autoBackup, state.value.lastAutoBackup)
                if (due != null && System.currentTimeMillis() >= due) runAutoBackup()
                delay(SCHEDULER_TICK_MS)
            }
        }
    }

    private suspend fun runAutoBackup() {
        // A manual backup or restore is running; the next tick tries again.
        if (closing.get() || !backupLock.tryLock()) return
        try {
            mutable.update { it.copy(autoBackupRunning = true) }
            val status = withContext(Dispatchers.IO) { writeAutoBackup(state.value.autoBackup) }
            if (!closing.get()) runCatching { library.setLastAutoBackup(status) }
            mutable.update { it.copy(lastAutoBackup = status) }
        } finally {
            mutable.update { it.copy(autoBackupRunning = false) }
            backupLock.unlock()
        }
    }

    private fun writeAutoBackup(settings: AutoBackupSettings): AutoBackupStatus {
        val now = System.currentTimeMillis()
        return try {
            require(settings.folder.isNotBlank()) { "Choose a backup folder" }
            val folder = Paths.get(settings.folder)
            // A missing folder is usually an unplugged drive; never recreate it somewhere unexpected.
            check(Files.isDirectory(folder)) { "Backup folder not found: ${settings.folder}" }
            val books = library.allBooks()
            // An empty backup would only push older, useful ones out of the rotation.
            if (books.none { it.favorite || it.readChapters.isNotEmpty() }) {
                return AutoBackupStatus(now, true, "Nothing to back up yet", skipped = true)
            }
            val name = autoBackupFileName()
            val path = folder.resolve(name)
            // Owned before the file exists, so even an interrupted write is pruned later.
            val owned = library.ownedAutoBackups().plus(name).toList().takeLast(OWNED_AUTO_BACKUP_LIMIT).toSet()
            library.setOwnedAutoBackups(owned)
            val count = writeLibraryBackup(path)
            val removed = autoBackupsToDelete(folder, owned, path)
                .filter { runCatching { Files.deleteIfExists(it) }.getOrDefault(false) }
                .mapTo(HashSet()) { it.fileName.toString() }
            if (removed.isNotEmpty()) library.setOwnedAutoBackups(owned - removed)
            AutoBackupStatus(now, true, "Backed up ${plural(count, "novel")}", name)
        } catch (failure: java.nio.file.AccessDeniedException) {
            AutoBackupStatus(now, false, "Grimoire can't write to ${settings.folder}")
        } catch (failure: Exception) {
            AutoBackupStatus(now, false, failure.message ?: failure.javaClass.simpleName)
        }
    }

    /**
     * Restores a desktop or Android backup into this library. Nothing is removed; read chapters
     * are marked through the reading-state protocol. Restored novels whose chapter lists are
     * partial are refreshed afterwards when online.
     */
    fun restoreBackup(path: Path) = operate {
        mutable.update { it.copy(backupNotice = "Reading ${path.fileName}…") }
        reportBackupFailure("Restore failed") { backupLock.withLock { restoreLibraryBackup(path) } }
    }

    /** A failure replaces the progress notice, so it never looks like work is still running. */
    private suspend fun reportBackupFailure(prefix: String, action: suspend () -> Unit) {
        try {
            action()
        } catch (cancelled: CancellationException) {
            mutable.update { it.copy(backupNotice = "$prefix: cancelled") }
            throw cancelled
        } catch (failure: Exception) {
            mutable.update { it.copy(backupNotice = "$prefix: ${failure.message ?: failure.javaClass.simpleName}") }
            throw failure
        }
    }

    private suspend fun restoreLibraryBackup(path: Path) {
        val contents = readBackup(path)
        val now = System.currentTimeMillis()
        val defaults = contents.categories.filter { it.isDefault }.mapTo(HashSet()) { it.name }
        val categoryIds = HashMap<String, Long>()
        fun categoryFor(name: String?, hidden: Boolean = false): Long? {
            if (name.isNullOrBlank() || name in defaults) return null
            return categoryIds.getOrPut(name) { library.ensureCategory(name, hidden) }
        }
        contents.categories.sortedBy { it.order }.forEach { categoryFor(it.name, it.isHidden) }

        val existing = library.allBooks().mapTo(HashSet()) { it.key }
        var restored = 0
        var added = 0
        var marked = 0
        var localBooks = 0
        val missingSources = HashSet<Long>()
        for (entry in contents.novels) {
            // Android's imported EPUB/TXT books carry no text in a backup.
            if (entry.key.sourceId == ANDROID_LOCAL_SOURCE_ID) { localBooks++; continue }
            val stored = library.importBackupNovel(entry, categoryFor(entry.categoryName), now)
            if (entry.key !in existing) added++
            if (extensionFor(entry.key.sourceId) == null) missingSources += entry.key.sourceId
            val at = entry.lastReadAt.takeIf { it > 0 } ?: now
            for (url in entry.readChapters) {
                if (url in stored.readChapters) continue
                val input = ReadingCompletionInput.MarkRead(ChapterKey(entry.key, url), at)
                readingStates.prepareExplicit(input)?.let { readingStates.submit(it); marked++ }
            }
            restored++
            if (restored % 10 == 0) mutable.update { it.copy(backupNotice = "Restoring… $restored of ${contents.novels.size}") }
        }
        publishUpdateResults(null)
        mutable.update { it.copy(categories = library.categories()) }

        // Includes restored reading history outside the library.
        val incomplete = library.allBooks().filter { it.chaptersIncomplete }.mapTo(HashSet()) { it.key }
        val notes = buildList {
            add("Restored ${plural(restored, "novel")} ($added new), ${plural(marked, "read chapter")}")
            if (missingSources.isNotEmpty()) add("${plural(missingSources.size, "source")} not installed — install them in Extensions to read and update those novels")
            if (localBooks > 0) add("${plural(localBooks, "imported book")} skipped (book files are not in backups)")
            val repos = contents.repositories.map { it.indexUrl }.toSet() -
                extensions?.repositoryViews().orEmpty().map { it.indexUrl }.toSet()
            if (repos.isNotEmpty()) add("${plural(repos.size, "repository")} not added — desktop needs each repository's signing key: ${repos.joinToString()}")
        }
        val fetching = updateBooks(incomplete)
        val lists = when {
            incomplete.isEmpty() -> null
            fetching -> "Fetching full chapter lists for ${plural(incomplete.size, "novel")}…"
            else -> "Go online and update the library to fetch full chapter lists"
        }
        mutable.update { it.copy(backupNotice = (notes + listOfNotNull(lists)).joinToString(".\n") + ".") }
    }

    /** Short store writes that must not wait behind, or block, a running operation. */
    private fun background(failurePrefix: String, action: suspend () -> Unit) {
        synchronized(operationLock) {
            if (closing.get()) return
            settingsScope.launch {
                try { action() }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) {
                    mutable.update { it.copy(error = "$failurePrefix: ${failure.message ?: failure.javaClass.simpleName}") }
                }
            }
        }
    }

    fun deleteDownloads(chapterUrls: List<String>) = operate {
        val book = state.value.book ?: error("Open a novel first")
        chapterUrls.distinct().forEach { url ->
            library.deleteDownload(ChapterKey(book.key, url))
        }
        mutable.update { it.copy(book = library.book(book.key) ?: it.book, library = library.saved()) }
    }

    fun removeFromLibrary(key: NovelKey) = operate {
        val updated = setMembership(key, false)
        mutable.update { st ->
            st.copy(
                book = if (st.book?.key == key) updated else st.book,
                library = library.saved(),
            )
        }
    }

    fun createCategory(name: String) = operate {
        val cats = library.createCategory(name)
        mutable.update { it.copy(categories = cats) }
    }

    fun renameCategory(id: Long, name: String) = operate {
        val cats = library.renameCategory(id, name)
        mutable.update { it.copy(categories = cats) }
    }

    fun deleteCategory(id: Long) = operate {
        val cats = library.deleteCategory(id)
        val activeBook = state.value.book?.let { library.book(it.key) }
        mutable.update { it.copy(categories = cats, library = library.saved(), book = activeBook ?: it.book) }
    }

    fun setBookCategory(key: NovelKey, categoryId: Long?) = mutateBook(key) { it.copy(categoryId = categoryId) }

    fun setBookRating(key: NovelKey, rating: Int?) = mutateBook(key) {
        it.copy(userRating = rating?.coerceIn(1, 10))
    }

    fun setBookChapterSort(key: NovelKey, sort: ChapterSort) = mutateBook(key) {
        it.copy(chapterSortOrder = sort)
    }

    fun setBookTextAlign(key: NovelKey, align: ReaderTextAlign) = mutateBook(key) {
        it.copy(readerTextAlign = align)
    }

    fun setBookOverrides(key: NovelKey, overrides: NovelOverrides) = mutateBook(key) {
        it.copy(overrides = overrides)
    }

    private fun mutateBook(key: NovelKey, transform: (SavedBook) -> SavedBook) {
        synchronized(operationLock) {
            if (closing.get()) return
            mutable.update { st ->
                st.copy(
                    book = if (st.book?.key == key) transform(st.book) else st.book,
                    library = st.library.map { if (it.key == key) transform(it) else it },
                    error = null,
                )
            }
            settingsScope.launch {
                try {
                    val saved = library.updateBookMetadata(key, transform)
                    mutable.update { st ->
                        st.copy(
                            book = if (st.book?.key == key && saved != null) saved else st.book,
                            library = library.saved(),
                        )
                    }
                } catch (failure: Exception) {
                    mutable.update { it.copy(error = "Could not update book: ${failure.message ?: failure.javaClass.simpleName}") }
                }
            }
        }
    }

    fun removeHistory(id: Long) = changeHistory { historyWrites.delete(listOf(id))!!.await().getOrThrow() }

    fun clearHistory() = changeHistory { historyWrites.clear().await().getOrThrow() }

    private fun changeHistory(change: suspend () -> Unit) = operate {
        if (state.value.view != View.HISTORY) return@operate
        try {
            change()
        } finally {
            val entries = library.openedHistory()
            mutable.update { it.copy(history = entries) }
        }
    }

    fun openSaved(book: SavedBook, origin: View = View.LIBRARY) {
        require(origin == View.LIBRARY || origin == View.UPDATES) { "Unsupported origin" }
        synchronized(operationLock) {
            if (!state.value.busy && !closing.get() && state.value.view != View.READER) {
                mutable.update { it.leaveBook(View.BOOK).copy(book = book, bookOrigin = origin) }
            }
        }
        navigate {
            val stored = library.book(book.key)
            publishView { it.leaveBook(View.BOOK).copy(book = stored, bookOrigin = origin) }
        }
    }

    fun favorite() = operate {
        val current = state.value.book ?: return@operate
        val book = setMembership(current.key, !current.favorite)
        mutable.update { it.copy(book = book, library = library.saved()) }
    }

    fun read(chapter: Chapter) = navigate {
        val book = state.value.book ?: error("Open a novel first")
        require(!chapter.locked && book.chapters.any { it == chapter }) { "This chapter is locked or unavailable" }
        readChapter(book, chapter, state.value.bookOrigin)
    }

    fun readHistory(entry: DesktopHistoryEntry) = navigate {
        require(state.value.view == View.HISTORY && entry in state.value.history) { "This history entry is no longer current" }
        val key = entry.chapter.key
        val book = library.book(key.novel) ?: error("This novel is no longer available")
        val chapter = book.chapters.find { it.url == key.url && !it.locked }
            ?: error("This chapter is locked or unavailable")
        readChapter(book, chapter, View.HISTORY)
    }

    private suspend fun readChapter(book: SavedBook, chapter: Chapter, origin: View) {
        val key = ChapterKey(book.key, chapter.url)
        historyWrites.open(incognito = !state.value.historyRecording, openedAtMillis = System.currentTimeMillis()) {
            DesktopOpenedChapter(key, book.novel.title, chapter.name)
        }?.let { lastHistoryOpen = it }
        // Retire the old view before storage/source suspension can admit stale callbacks.
        publishView { it.leaveBook(View.BOOK).copy(book = book, bookOrigin = origin) }
        val loadedChapter = try {
            chapterLoader.load(key) {
                when {
                    state.value.offline -> ChapterPageAccess.Unavailable(ChapterLoadFailure.OFFLINE)
                    else -> {
                        val loaded = extensionFor(book.key.sourceId)
                        val source = loaded?.source as? PageListSource
                        when {
                            loaded == null -> ChapterPageAccess.Unavailable(ChapterLoadFailure.SOURCE_UNAVAILABLE)
                            source == null -> ChapterPageAccess.Unavailable(ChapterLoadFailure.PAGES_UNSUPPORTED)
                            else -> ChapterPageAccess.Available { source.getPageList(chapter) }
                        }
                    }
                }
            }
        } catch (failure: ChapterLoadException) {
            error(when (failure.reason) {
                ChapterLoadFailure.OFFLINE -> "Download this chapter before reading offline"
                ChapterLoadFailure.SOURCE_UNAVAILABLE -> "Install this novel's extension to read chapters that have not been downloaded"
                ChapterLoadFailure.PAGES_UNSUPPORTED -> "This source cannot provide chapter pages"
            })
        }
        publishChapter(book, chapter, loadedChapter)
    }

    private suspend fun publishChapter(book: SavedBook, chapter: Chapter, loaded: io.grimoire.reading.LoadedChapter) {
        val key = ChapterKey(book.key, chapter.url)
        val pages = loaded.pages
        check(pages.any { (it.content as? PageContent.Text)?.text?.isNotBlank() == true }) { "The chapter has no readable text" }
        val projection = ReadingProjection.create(key, pages, pages.mapIndexed { ordinal, page -> ProjectedPage(ordinal, page) })
        val legacyBook = library.book(book.key)
        val legacy = legacyBook?.position?.takeIf { it.chapterUrl == chapter.url }?.let { LegacyReaderViewport(it.paragraph, it.offset) }
        val checkpoint = checkpoints.open(projection, loaded.storageObservation, legacy)
        val stored = library.selectResumeChapter(key)
        publishView { it.copy(view = View.READER, book = stored, chapter = chapter, pages = projection.originalPages,
            projection = projection, observedAnchor = null, storageObservation = loaded.storageObservation,
            checkpointLoad = checkpoint, positionNotice = checkpoint.restore.notice?.message) }
    }

    fun download() = operate(retireReader = true) {
        val current = state.value
        val book = current.book ?: return@operate
        val chapter = current.chapter ?: return@operate
        val previous = current.checkpointLoad
        val key = ChapterKey(book.key, chapter.url)
        var committed = false
        try {
            // Persist already captured source positions before our save rotates the generation.
            flushStoredPositions()
            val attempt = downloads.claim(key) ?: error("Chapter is unavailable or locked")
            val expected = downloadDigest(encodeChapterContent(current.pages))
            try {
                check(downloads.commit(attempt, current.pages) is DownloadCommit.Committed) { "Download attempt is no longer current" }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                val receipt = try { downloads.currentReceipt(key) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (readFailure: Exception) { failure.addSuppressed(readFailure); throw failure }
                if (receipt?.attemptId != attempt.id || receipt.digest != expected) throw failure
            }
            committed = true
            mutable.update { it.copy(book = library.book(book.key), library = library.saved()) }
            var membershipFailure: Exception? = null
            try {
                val updated = setMembership(book.key, true)
                mutable.update { it.copy(book = updated, library = library.saved()) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                membershipFailure = failure
            }
            try {
                // Fresh saved read/registration, never authority inferred from equal logical text.
                val saved = chapterLoader.load(key) { ChapterPageAccess.Unavailable(ChapterLoadFailure.SOURCE_UNAVAILABLE) }
                publishChapter(book, chapter, saved)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                membershipFailure?.let(failure::addSuppressed)
                throw IllegalStateException("Chapter saved, but could not reload its reading position: ${failure.message}", failure)
            }
            membershipFailure?.let { throw IllegalStateException("Chapter saved, but could not add the novel to your library: ${it.message}", it) }
        } catch (failure: Exception) {
            if (previous != null && state.value.checkpointLoad === previous) {
                if (!committed) checkpoints.resume(previous)
                else { checkpoints.revoke(previous); mutable.update { it.copy(positionNotice = CheckpointNotice.RELOAD.message) } }
            }
            throw failure
        }
    }

    fun offline(value: Boolean) {
        if (state.value.busy || closing.get()) return
        networkEnabled.set(!value)
        mutable.update { it.copy(offline = value, error = null) }
    }

    private suspend fun setMembership(key: NovelKey, inLibrary: Boolean): SavedBook {
        val entry = membership.setMembership(key, inLibrary) ?: error("Novel is no longer stored")
        return library.book(entry.key) ?: error("Novel is no longer stored")
    }

    private fun publishView(change: (ReaderState) -> ReaderState) = synchronized(operationLock) {
        mutable.update(change)
    }

    fun position(key: ChapterKey, paragraph: Int, offset: Int, observed: ReadingProjection, userInitiated: Boolean = true) {
        synchronized(operationLock) {
            if (closing.get() || offset < 0) return
            val current = state.value
            val book = current.book ?: return
            val chapter = current.chapter ?: return
            if (current.view != View.READER || current.projection !== observed ||
                key != ChapterKey(book.key, chapter.url) || paragraph !in 0 until observed.itemCount) return
            val checkpoint = current.checkpointLoad ?: return
            if (!checkpoints.canObserve(checkpoint)) return
            if (userInitiated) checkpoints.userPosition(checkpoint)
            if (!checkpoints.canRecordPosition(checkpoint)) return
            library.position(key, paragraph, offset, checkpoint)
            val captured = checkpoints.capture(checkpoint, paragraph)
            mutable.update { it.copy(observedAnchor = observed.capture(paragraph), positionNotice = if (captured != null) null else it.positionNotice) }
        }
    }

    suspend fun flushPosition() {
        val prefix = "Could not save reading position:"
        try {
            withContext(Dispatchers.IO) { flushStoredPositions() }
            mutable.update { if (it.error?.startsWith(prefix) == true) it.copy(error = null) else it }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            mutable.update { it.copy(error = "$prefix ${failure.message ?: failure.javaClass.simpleName}") }
        }
    }

    suspend fun close() = closeWrites.withLock {
        synchronized(operationLock) { closing.set(true); checkpoints.retire() }
        // Extension network calls may not be cancellable; never let one hold up shutdown for long.
        updaterScope.coroutineContext.job.children.forEach { it.cancel() }
        withTimeoutOrNull(UPDATER_SHUTDOWN_MS) { updaterScope.coroutineContext.job.children.toList().joinAll() }
        var heldBackup = false
        try {
            // Let the claimed operation finish, then save before cancelling the usable scope.
            scope.coroutineContext.job.children.toList().joinAll()
            lastHistoryOpen?.join()
            settingsScope.coroutineContext.job.children.toList().joinAll()
            // A backup file write ignores cancellation; let it finish before the store closes.
            heldBackup = withTimeoutOrNull(BACKUP_SHUTDOWN_MS) { backupLock.lock(); true } == true
            withContext(Dispatchers.IO) {
                if (!storageClosed.get()) {
                    checkpoints.retire(); flushStoredPositions(); library.close(); storageClosed.set(true)
                }
            }
        } catch (failure: Exception) {
            synchronized(operationLock) { closing.set(false); state.value.checkpointLoad?.let(checkpoints::resume) }
            throw failure
        } finally {
            // Closing is set, so no backup starts after this; a repeated close must not wait on it.
            if (heldBackup) backupLock.unlock()
        }
        scope.coroutineContext.job.cancelAndJoin()
        updaterScope.coroutineContext.job.cancel()
        historyScope.coroutineContext.job.cancelAndJoin()
        settingsScope.coroutineContext.job.cancelAndJoin()
        withContext(Dispatchers.IO) {
            (installed.values + listOfNotNull(sessionExtension)).forEach { runCatching { it.close() } }
            installed.clear()
            sessionExtension = null
        }
    }

    fun userPosition(observed: ReadingProjection) = synchronized(operationLock) {
        if (!closing.get() && state.value.projection === observed) state.value.checkpointLoad?.let(checkpoints::userPosition)
    }

    private fun applyRevocations(loads: List<ReaderCheckpointLoad>) {
        loads.forEach { load -> load.projection.document?.key?.let { library.discardPendingPosition(it, load) } }
        val current = state.value.checkpointLoad
        if (current != null && checkpoints.isRevoked(current)) mutable.update {
            if (it.checkpointLoad === current) it.copy(positionNotice = CheckpointNotice.RELOAD.message) else it
        }
    }

    private suspend fun flushStoredPositions() {
        try { applyRevocations(checkpoints.flush()) }
        catch (rejected: ReaderCheckpointRejected) { applyRevocations(rejected.revokedLoads); throw rejected }
        library.flush()
    }

    private fun navigate(action: suspend () -> Unit) = operate(retireReader = true) {
        flushStoredPositions(); action()
    }

    private fun resumeClaimedReader(previous: ReaderCheckpointLoad?) = synchronized(operationLock) {
        if (!closing.get() && previous != null && state.value.checkpointLoad === previous) checkpoints.resume(previous)
    }

    private fun operate(retireReader: Boolean = false, action: suspend () -> Unit) {
        synchronized(operationLock) {
            if (state.value.busy || closing.get()) return
            val previous = if (retireReader) state.value.checkpointLoad else null
            if (retireReader) checkpoints.retire()
            // Claim/retirement/job registration are atomic with callbacks and close.
            mutable.update { it.copy(busy = true, error = null) }
            scope.launch {
                try { action() }
                catch (cancelled: CancellationException) { resumeClaimedReader(previous); throw cancelled }
                catch (fatal: VirtualMachineError) { resumeClaimedReader(previous); throw fatal }
                // Extension code can fail with an Error (initializer, linkage); report it like any failure.
                catch (failure: Throwable) {
                    resumeClaimedReader(previous)
                    mutable.update { it.copy(error = failure.message ?: failure.javaClass.simpleName) }
                }
                finally { mutable.update { it.copy(busy = false) } }
            }
        }
    }

}

private const val LAUNCH_UPDATE_DELAY_MS = 8_000L
private const val LAUNCH_BACKUP_DELAY_MS = 20_000L
/** Notifications waiting for the window; older ones drop off if it never shows them. */
private const val MAX_PENDING_ALERTS = 50
private const val BACKUP_SHUTDOWN_MS = 30_000L
/** Plenty for seven per folder across many folders; the oldest names drop off. */
private const val OWNED_AUTO_BACKUP_LIMIT = 200

/** Android's id for imported EPUB/TXT books. */
private const val ANDROID_LOCAL_SOURCE_ID = 0L

private fun plural(count: Int, noun: String): String {
    val word = if (count == 1) noun else if (noun.endsWith("y")) noun.dropLast(1) + "ies" else noun + "s"
    return "%,d %s".format(count, word)
}
private const val SCHEDULER_TICK_MS = 60_000L
private const val UPDATER_SHUTDOWN_MS = 3_000L

internal suspend fun sourceChapters(source: Source, novel: Novel): List<Chapter> = when (source) {
    is CursorPaginatedSource -> source.getAllChapters(novel)
    is ChapterListSource -> source.getChapterList(novel)
    else -> error("This source's chapter list is unsupported")
}
