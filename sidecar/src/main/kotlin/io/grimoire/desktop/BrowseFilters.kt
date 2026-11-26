package io.grimoire.desktop

import io.grimoire.api.model.filter.Filter

/**
 * A source's filter list as plain data for the UI. The source's own [Filter] objects stay in the
 * model: the UI edits copies of their states and sends them back, and the model writes them into
 * those objects before searching, so the source still sees its own filter subclasses.
 */
enum class FilterKind { HEADER, SEPARATOR, TEXT, CHECKBOX, TRISTATE, SELECT, GROUP, SORT, UNSUPPORTED }

data class SortValue(val index: Int, val ascending: Boolean)

/**
 * One filter. [state] is a String (TEXT), Boolean (CHECKBOX), Int (TRISTATE, SELECT),
 * [SortValue] or null (SORT), and null otherwise; a GROUP's states live in [children].
 */
data class FilterEntry(
    val kind: FilterKind,
    val name: String,
    val state: Any?,
    val default: Any?,
    val values: List<String> = emptyList(),
    val children: List<FilterEntry> = emptyList(),
)

/** A state sent back by the UI, shaped like [FilterEntry]. */
data class FilterInput(val state: Any?, val children: List<FilterInput> = emptyList())

enum class FilterStatus {
    READY,
    /** The options come from the site; filtering waits until they are loaded. */
    NEEDS_LOAD,
    LOADING,
    LOADED,
    ERROR;

    val canApply: Boolean get() = this == READY || this == LOADED
}

data class BrowseFilterPanel(
    val sourceId: Long,
    val status: FilterStatus,
    val entries: List<FilterEntry>,
    val error: String? = null,
    /** The listing shows filtered search results. */
    val applied: Boolean = false,
    /** The source combines a typed query with filters; otherwise filtering ignores the query. */
    val searchWithFilters: Boolean = false,
)

/** Snapshots [filters]; [defaults] (same shape) supplies each default, or the current states when null. */
internal fun snapshotFilters(filters: List<*>, defaults: List<FilterEntry>?): List<FilterEntry> =
    filters.mapIndexed { i, f -> snapshotFilter(f, defaults?.getOrNull(i)) }

private fun snapshotFilter(f: Any?, default: FilterEntry?): FilterEntry {
    fun entry(kind: FilterKind, name: String, state: Any?, values: List<String> = emptyList()) =
        FilterEntry(kind, name, state, if (default?.kind == kind) default.default else state, values)
    return when (f) {
        is Filter.Header -> entry(FilterKind.HEADER, f.name, null)
        is Filter.Separator -> entry(FilterKind.SEPARATOR, f.name, null)
        is Filter.Text -> entry(FilterKind.TEXT, f.name, f.state)
        is Filter.CheckBox -> entry(FilterKind.CHECKBOX, f.name, f.state)
        is Filter.TriState -> entry(FilterKind.TRISTATE, f.name, f.state)
        is Filter.Select<*> -> entry(FilterKind.SELECT, f.name, f.state, f.values.map { it.toString() })
        is Filter.Sort -> entry(FilterKind.SORT, f.name, f.state?.let { SortValue(it.index, it.ascending) }, f.values.toList())
        is Filter.Group<*> -> FilterEntry(FilterKind.GROUP, f.name, null, null,
            children = snapshotFilters(f.state, default?.takeIf { it.kind == FilterKind.GROUP }?.children))
        is Filter<*> -> entry(FilterKind.UNSUPPORTED, f.name, null)
        else -> FilterEntry(FilterKind.UNSUPPORTED, f.toString(), null, null)
    }
}

/** Writes [inputs] into the source's [filters] by position; invalid values leave a filter unchanged. */
internal fun applyFilterInputs(filters: List<*>, inputs: List<FilterInput>) {
    filters.forEachIndexed { i, f -> inputs.getOrNull(i)?.let { applyFilterInput(f, it) } }
}

private fun applyFilterInput(f: Any?, input: FilterInput) {
    val state = input.state
    when (f) {
        is Filter.Text -> f.state = (state as? String).orEmpty()
        is Filter.CheckBox -> f.state = state as? Boolean ?: false
        is Filter.TriState -> f.state = (state as? Int)?.takeIf { it in 0..2 } ?: Filter.TriState.STATE_IGNORE
        is Filter.Select<*> -> (state as? Int)?.takeIf { it in f.values.indices }?.let { f.state = it }
        is Filter.Sort -> f.state = (state as? SortValue)?.takeIf { it.index in f.values.indices }
            ?.let { Filter.Sort.Selection(it.index, it.ascending) }
        is Filter.Group<*> -> applyFilterInputs(f.state, input.children)
    }
}

/** The inputs that restore every filter to its default. */
internal fun defaultInputs(entries: List<FilterEntry>): List<FilterInput> =
    entries.map { FilterInput(it.default, defaultInputs(it.children)) }

/** How many filters differ from their defaults. */
internal fun activeFilterCount(entries: List<FilterEntry>): Int = entries.sumOf { e ->
    when (e.kind) {
        FilterKind.GROUP -> activeFilterCount(e.children)
        FilterKind.TEXT -> if ((e.state as? String).orEmpty().isNotBlank() && e.state != e.default) 1 else 0
        FilterKind.HEADER, FilterKind.SEPARATOR, FilterKind.UNSUPPORTED -> 0
        else -> if (e.state != e.default) 1 else 0
    }.toInt()
}
