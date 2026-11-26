package io.grimoire.desktop

import io.grimoire.api.model.novel.NovelStatus

/** Persisted by name in SQLite; keep constant names aligned with Grimoire Android. */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** Persisted by name in SQLite; keep constant names aligned with Grimoire Android. */
enum class ColorTheme(val displayName: String) {
    DEFAULT("Default"),
    GRIMOIRE("Grimoire"),
    OCEAN("Ocean"),
    SUNSET("Sunset"),
    FOREST("Forest"),
    ROSE("Rose"),
    MIDNIGHT("Midnight"),
}

/** Persisted by name in SQLite; keep constant names aligned with Grimoire Android. */
enum class ReaderFont { DEFAULT, SERIF, MONOSPACE }

/** Persisted by name in SQLite; keep constant names aligned with Grimoire Android. */
enum class ReaderColorTheme { LIGHT, SEPIA, DARK, BLACK }

/** Persisted by name in SQLite; keep constant names aligned with Grimoire Android. */
enum class ReaderTextAlign { AUTO, LEFT, RIGHT, CENTER, JUSTIFY }

/** Chapter list sort order matching Android's `ChapterSort`. */
enum class ChapterSort { NUMBER_ASC, NUMBER_DESC, DATE_ASC, DATE_DESC }

/** How the reader decides a chapter is read, matching Android's `MarkAsReadStrategy`. */
enum class MarkAsReadStrategy { PERCENT, PARAGRAPHS_FROM_END, AT_END }

/** User-defined library category matching Android's `CategoryEntity`. */
data class DesktopCategory(
    val id: Long,
    val name: String,
    val sortOrder: Int = 0,
    val isDefault: Boolean = false,
    val isHidden: Boolean = false,
)

/** Per-field user metadata overrides that win over source refreshes, matching Android's `NovelEntity`. */
data class NovelOverrides(
    val title: String? = null,
    val author: String? = null,
    val description: String? = null,
    val status: NovelStatus? = null,
    val genres: List<String>? = null,
    val customCoverUrl: String? = null,
) {
    val isEmpty: Boolean
        get() = title == null && author == null && description == null &&
            status == null && genres == null && customCoverUrl == null
}
