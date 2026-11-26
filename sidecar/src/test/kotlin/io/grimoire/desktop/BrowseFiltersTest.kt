package io.grimoire.desktop

import io.grimoire.api.model.filter.Filter
import org.junit.Assert.*
import org.junit.Test

class BrowseFiltersTest {
    private class Genres(genres: List<Filter.TriState>) : Filter.Group<Filter.TriState>("Genres", genres)
    private class Status : Filter.Select<String>("Status", arrayOf("Any", "Ongoing", "Completed"), state = 1)
    private class Order : Filter.Sort("Order by", arrayOf("Name", "Rating"), Selection(1, false))

    private fun filters(): List<Filter<*>> = listOf(
        Filter.Header("Narrow results"),
        Filter.Text("Author"),
        Filter.CheckBox("Translated only"),
        Status(),
        Genres(listOf(Filter.TriState("Action"), Filter.TriState("Romance"))),
        Filter.Separator(),
        Order(),
    )

    @Test
    fun snapshotDescribesEveryKind() {
        val entries = snapshotFilters(filters(), null)
        assertEquals(
            listOf(FilterKind.HEADER, FilterKind.TEXT, FilterKind.CHECKBOX, FilterKind.SELECT, FilterKind.GROUP,
                FilterKind.SEPARATOR, FilterKind.SORT),
            entries.map { it.kind },
        )
        assertEquals(listOf("Any", "Ongoing", "Completed"), entries[3].values)
        assertEquals(1, entries[3].state)
        assertEquals(listOf("Action", "Romance"), entries[4].children.map { it.name })
        assertEquals(SortValue(1, false), entries[6].state)
        assertEquals(0, activeFilterCount(entries))
    }

    @Test
    fun inputsWriteIntoTheSourcesOwnObjects() {
        val list = filters()
        val defaults = snapshotFilters(list, null)
        applyFilterInputs(list, listOf(
            FilterInput(null),
            FilterInput("Er Gen"),
            FilterInput(true),
            FilterInput(2),
            FilterInput(null, listOf(FilterInput(Filter.TriState.STATE_INCLUDE), FilterInput(Filter.TriState.STATE_EXCLUDE))),
            FilterInput(null),
            FilterInput(SortValue(0, true)),
        ))
        assertEquals("Er Gen", (list[1] as Filter.Text).state)
        assertTrue((list[2] as Filter.CheckBox).state)
        assertEquals(2, (list[3] as Status).state)
        val genres = (list[4] as Genres).state
        assertEquals(Filter.TriState.STATE_INCLUDE, genres[0].state)
        assertEquals(Filter.TriState.STATE_EXCLUDE, genres[1].state)
        assertEquals(Filter.Sort.Selection(0, true), (list[6] as Order).state)

        val entries = snapshotFilters(list, defaults)
        assertEquals(1, entries[3].default)
        assertEquals(6, activeFilterCount(entries))

        applyFilterInputs(list, defaultInputs(defaults))
        assertEquals(0, activeFilterCount(snapshotFilters(list, defaults)))
        assertEquals(Filter.Sort.Selection(1, false), (list[6] as Order).state)
    }

    @Test
    fun invalidInputsAreIgnored() {
        val list = filters()
        applyFilterInputs(list, listOf(
            FilterInput(null), FilterInput(7), FilterInput("yes"), FilterInput(9),
            FilterInput(null, listOf(FilterInput(5))), FilterInput(null), FilterInput(SortValue(4, true)),
        ))
        assertEquals("", (list[1] as Filter.Text).state)
        assertFalse((list[2] as Filter.CheckBox).state)
        assertEquals(1, (list[3] as Status).state)
        assertEquals(Filter.TriState.STATE_IGNORE, (list[4] as Genres).state[0].state)
        assertNull((list[6] as Order).state)
    }
}
