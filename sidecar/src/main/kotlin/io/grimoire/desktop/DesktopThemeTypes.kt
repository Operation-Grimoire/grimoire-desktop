package io.grimoire.desktop

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
