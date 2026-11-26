export type ViewName =
  | "LIBRARY"
  | "BROWSE"
  | "BOOK"
  | "READER"
  | "HISTORY"
  | "EXTENSIONS"
  | "SETTINGS";

export type ThemeMode = "SYSTEM" | "LIGHT" | "DARK";
export type ColorTheme =
  | "DEFAULT"
  | "GRIMOIRE"
  | "OCEAN"
  | "SUNSET"
  | "FOREST"
  | "ROSE"
  | "MIDNIGHT";
export type BrowseMode = "POPULAR" | "LATEST" | "SEARCH";
export type ReaderFont = "DEFAULT" | "SERIF" | "MONOSPACE";
export type ReaderColorTheme = "LIGHT" | "SEPIA" | "DARK" | "BLACK";
export type ReaderTextAlign = "AUTO" | "LEFT" | "RIGHT" | "CENTER" | "JUSTIFY";
export type ExtensionStatus =
  | "INSTALLED"
  | "UPDATE"
  | "AVAILABLE"
  | "INCOMPATIBLE"
  | "CONFLICT"
  | "UNAVAILABLE";

export interface BrowseSource {
  sourceId: number;
  name: string;
  lang: string;
}

export interface Novel {
  url: string;
  title: string;
  lang: string;
  thumbnailUrl: string | null;
  author: string | null;
  description: string | null;
  status: string;
  genres: string[];
}

export interface Chapter {
  url: string;
  name: string;
  chapterNumber: number;
  locked: boolean;
  downloaded?: boolean;
}

export interface ReadPosition {
  chapterUrl: string;
  paragraph: number;
  offset: number;
}

export interface SavedBook {
  sourceId: number;
  novelUrl: string;
  novel: Novel;
  favorite: boolean;
  totalChapters: number;
  downloadedCount: number;
  lockedCount: number;
  resumeChapterUrl: string | null;
  position: ReadPosition | null;
  chapters?: Chapter[];
}

export type ReaderPage =
  | { ordinal: number; kind: "text"; text: string; html: string | null }
  | { ordinal: number; kind: "image"; url: string }
  | { ordinal: number; kind: "separator" };

export interface RestoreViewport {
  index: number;
  offset: number;
  end: boolean;
}

export interface HistoryEntry {
  id: number;
  sourceId: number;
  novelUrl: string;
  chapterUrl: string;
  novelTitle: string;
  chapterTitle: string;
  openedAtMillis: number;
}

export interface ExtensionRow {
  pkg: string;
  name: string;
  lang: string;
  installedVersion: string | null;
  availableVersion: string | null;
  repository: string;
  status: ExtensionStatus;
  reason: string | null;
}

export interface RepositoryView {
  id: string;
  indexUrl: string;
  enabled: boolean;
  builtin: boolean;
  refreshed: boolean;
  fingerprint: string;
  extensionCount: number;
  problem: string | null;
}

export interface PendingRepository {
  id: string;
  indexUrl: string;
  fingerprint: string;
  extensionCount: number;
  warning: string | null;
}

export interface DesktopAppearance {
  themeMode: ThemeMode;
  colorTheme: ColorTheme;
}

export interface DesktopReaderSettings {
  fontSize: number;
  lineHeightTimes10: number;
  paragraphSpacing: number;
  font: ReaderFont;
  colorTheme: ReaderColorTheme | null;
  textAlign: ReaderTextAlign;
  showChapterPercent: boolean;
  showBookPercent: boolean;
  grimoireEasterEgg: boolean;
}

export interface ReaderState {
  view: ViewName;
  bookOrigin: ViewName;
  busy: boolean;
  offline: boolean;
  error: string | null;
  sourceName: string | null;
  historyRecording: boolean;
  browseSource: number | null;
  browseMode: BrowseMode | null;
  browseModes: BrowseMode[];
  browseQuery: string;
  browsePage: number;
  browseHasMore: boolean;
  extensionNotice: string | null;
  localExtension: string | null;
  positionNotice: string | null;
  sources: BrowseSource[];
  library: SavedBook[];
  novels: Novel[];
  book: SavedBook | null;
  chapter: Chapter | null;
  pages: ReaderPage[];
  restoreViewport: RestoreViewport | null;
  history: HistoryEntry[];
  extensionRows: ExtensionRow[];
  repositories: RepositoryView[];
  pendingRepository: PendingRepository | null;
  appearance: DesktopAppearance;
  readerSettings: DesktopReaderSettings;
}

export interface DaemonSnapshot {
  ready: boolean;
  coverBaseUrl: string | null;
  hostApi: string | null;
  state: ReaderState | null;
  startupError: string | null;
}
