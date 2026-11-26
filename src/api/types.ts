export type ViewName =
  | "LIBRARY"
  | "UPDATES"
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
export type ChapterSort = "NUMBER_ASC" | "NUMBER_DESC" | "DATE_ASC" | "DATE_DESC";
export type MarkAsReadStrategy = "PERCENT" | "PARAGRAPHS_FROM_END" | "AT_END";
export type ExtensionStatus =
  | "INSTALLED"
  | "UPDATE"
  | "AVAILABLE"
  | "INCOMPATIBLE"
  | "CONFLICT"
  | "UNAVAILABLE";

export interface BrowseSource {
  /** 64-bit id; a string because it exceeds JavaScript's exact integer range. */
  sourceId: string;
  name: string;
  lang: string;
}

export interface DesktopCategory {
  id: number;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  isHidden: boolean;
}

export interface NovelOverrides {
  title: string | null;
  author: string | null;
  description: string | null;
  status: string | null;
  genres: string[] | null;
  customCoverUrl: string | null;
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
  uploadDate: number;
  locked: boolean;
  downloaded?: boolean;
  read?: boolean;
}

export interface ReadPosition {
  chapterUrl: string;
  paragraph: number;
  offset: number;
}

export interface SavedBook {
  /** 64-bit id; a string because it exceeds JavaScript's exact integer range. */
  sourceId: string;
  novelUrl: string;
  novel: Novel;
  sourceNovel: Novel;
  overrides: NovelOverrides;
  favorite: boolean;
  categoryId: number | null;
  lastReadAt: number;
  lastUpdated: number;
  addedAt: number;
  userRating: number | null;
  readerTextAlign: ReaderTextAlign;
  chapterSortOrder: ChapterSort;
  totalChapters: number;
  downloadedCount: number;
  readCount: number;
  unreadCount: number;
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
  /** 64-bit id; a string because it exceeds JavaScript's exact integer range. */
  sourceId: string;
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

export interface UpdateEntry {
  id: number;
  /** 64-bit id; a string because it exceeds JavaScript's exact integer range. */
  sourceId: string;
  novelUrl: string;
  chapterUrl: string;
  novelTitle: string;
  thumbnailUrl: string | null;
  chapterName: string;
  chapterNumber: number;
  foundAt: number;
  locked: boolean;
  /** Existed before but was locked; now readable. */
  unlocked: boolean;
  read: boolean;
  downloaded: boolean;
}

export type UpdateIssueSeverity = "WARNING" | "ERROR";

export interface UpdateIssue {
  /** 64-bit id; a string because it exceeds JavaScript's exact integer range. */
  sourceId: string;
  novelUrl: string;
  novelTitle: string;
  severity: UpdateIssueSeverity;
  message: string;
  occurredAt: number;
  retrying: boolean;
}

export interface LibraryUpdateProgress {
  done: number;
  total: number;
  current: string | null;
  categoryId: number | null;
}

export interface LibraryUpdateSummary {
  finishedAt: number;
  checked: number;
  newChapters: number;
  warnings: number;
  errors: number;
  cancelled: boolean;
  failed: boolean;
  /** Null for a whole-library run. */
  categoryId: number | null;
}

export interface LibraryUpdateSettings {
  updateOnLaunch: boolean;
  autoUpdate: boolean;
  intervalHours: number;
  concurrency: number;
  skipCompleted: boolean;
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
  markAsReadStrategy: MarkAsReadStrategy;
  markAsReadThreshold: number;
}

export interface ReaderState {
  view: ViewName;
  bookOrigin: ViewName;
  busy: boolean;
  offline: boolean;
  error: string | null;
  sourceName: string | null;
  historyRecording: boolean;
  browseSource: string | null;
  browseMode: BrowseMode | null;
  browseModes: BrowseMode[];
  browseQuery: string;
  browsePage: number;
  browseHasMore: boolean;
  extensionNotice: string | null;
  localExtension: string | null;
  positionNotice: string | null;
  sources: BrowseSource[];
  categories: DesktopCategory[];
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
  updates: UpdateEntry[];
  updateIssues: UpdateIssue[];
  libraryUpdate: LibraryUpdateProgress | null;
  lastLibraryUpdate: LibraryUpdateSummary | null;
  libraryUpdateSettings: LibraryUpdateSettings;
}

export interface DaemonSnapshot {
  ready: boolean;
  coverBaseUrl: string | null;
  hostApi: string | null;
  state: ReaderState | null;
  startupError: string | null;
}
