import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Check,
  CheckCheck,
  Download,
  Eye,
  EyeOff,
  Folder,
  Lock,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Star,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { Chapter, ChapterSort, ReaderState } from "../api/types";
import { coverUrl, rpc } from "../api/client";
import { renderRichText } from "../utils/safeHtml";
import { HeaderBar } from "../components/HeaderBar";
import { SearchPill } from "../components/SearchPill";

const CHAPTER_SORTS: { id: ChapterSort; label: string }[] = [
  { id: "NUMBER_ASC", label: "Chapter # ↑" },
  { id: "NUMBER_DESC", label: "Chapter # ↓" },
  { id: "DATE_DESC", label: "Upload date ↓" },
  { id: "DATE_ASC", label: "Upload date ↑" },
];

export function BookDetailView({
  state,
  coverBaseUrl,
}: {
  state: ReaderState;
  coverBaseUrl: string | null;
}) {
  const book = state.book;
  const [chapterQuery, setChapterQuery] = useState("");
  const [expandedDesc, setExpandedDesc] = useState(false);
  const [showRatingPicker, setShowRatingPicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [chapterMenu, setChapterMenu] = useState<{
    x: number;
    y: number;
    chapter: Chapter;
    indexInReadingOrder: number;
  } | null>(null);

  // Edit metadata form state
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editGenres, setEditGenres] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCover, setEditCover] = useState("");

  useEffect(() => {
    const close = () => setChapterMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const orderedChapters = useMemo(() => book?.chapters ?? [], [book?.chapters]);
  // Reading-order position by url; a per-row findIndex was quadratic on long novels.
  const readingIndex = useMemo(
    () => new Map(orderedChapters.map((c, i) => [c.url, i] as const)),
    [orderedChapters],
  );

  const displayedChapters = useMemo(() => {
    const sort = book?.chapterSortOrder ?? "NUMBER_ASC";
    let list = [...orderedChapters];
    switch (sort) {
      case "NUMBER_DESC":
        list.reverse();
        break;
      case "DATE_ASC":
        list.sort((a, b) => a.uploadDate - b.uploadDate);
        break;
      case "DATE_DESC":
        list.sort((a, b) => b.uploadDate - a.uploadDate);
        break;
      case "NUMBER_ASC":
      default:
        break;
    }
    const q = chapterQuery.trim().toLowerCase();
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }, [orderedChapters, book?.chapterSortOrder, chapterQuery]);

  // Only the rows on screen are mounted; thousands of chapters stay cheap to open and update.
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listOffset, setListOffset] = useState(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    // Distance from the top of the scroll content, independent of positioned wrappers.
    const offset = Math.round(
      list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
    );
    if (offset !== listOffset) setListOffset(offset);
  });
  const virtualizer = useVirtualizer({
    count: displayedChapters.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CHAPTER_ROW_HEIGHT,
    overscan: 12,
    scrollMargin: listOffset,
    getItemKey: (index) => displayedChapters[index]?.url ?? index,
  });

  if (!book) return null;

  // Sources often repeat genres, sometimes with different casing.
  const genres = uniqueGenres(book.novel.genres);
  const sourceInfo = state.sources.find((s) => s.sourceId === book.sourceId);
  const sourceName = sourceInfo?.name ?? "Source uninstalled";
  const cover = coverUrl(coverBaseUrl, book.novel.thumbnailUrl);
  const resumeChapter = orderedChapters.find((c) => c.url === book.resumeChapterUrl && !c.locked);
  const startChapter =
    resumeChapter ??
    orderedChapters.find((c) => !c.locked && !c.read) ??
    orderedChapters.find((c) => !c.locked);
  const canReadTarget =
    startChapter != null && (!state.offline || Boolean(startChapter.downloaded));
  const categoryName = state.categories.find((c) => c.id === book.categoryId)?.name ?? null;

  const openEditModal = () => {
    setEditTitle(book.overrides.title ?? "");
    setEditAuthor(book.overrides.author ?? "");
    setEditStatus(book.overrides.status ?? "");
    setEditGenres(book.overrides.genres?.join(", ") ?? "");
    setEditDesc(book.overrides.description ?? "");
    setEditCover(book.overrides.customCoverUrl ?? "");
    setShowEditModal(true);
  };

  const saveOverrides = () => {
    const parsedGenres = editGenres.trim()
      ? editGenres
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean)
      : null;
    rpc("setBookOverrides", {
      sourceId: book.sourceId,
      novelUrl: book.novelUrl,
      overrides: {
        title: editTitle.trim() || null,
        author: editAuthor.trim() || null,
        status: editStatus || null,
        genres: parsedGenres,
        description: editDesc.trim() || null,
        customCoverUrl: editCover.trim() || null,
      },
    });
    setShowEditModal(false);
  };

  const resetOverrides = () => {
    rpc("setBookOverrides", {
      sourceId: book.sourceId,
      novelUrl: book.novelUrl,
      overrides: {},
    });
    setShowEditModal(false);
  };

  const unreadReadableUrls = orderedChapters
    .filter((c) => !c.locked && !c.read)
    .map((c) => c.url);
  const undownloadedUnreadUrls = orderedChapters
    .filter((c) => !c.locked && !c.read && !c.downloaded)
    .map((c) => c.url);
  const allReadableUrls = orderedChapters.filter((c) => !c.locked).map((c) => c.url);
  const allDownloadedUrls = orderedChapters.filter((c) => c.downloaded).map((c) => c.url);

  return (
    <div className="relative flex h-full flex-col">
      <HeaderBar
        left={
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              aria-label="Back"
              onClick={() => rpc("back")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span
              data-tauri-drag-region
              className="truncate text-[14px] font-medium text-[var(--text-primary)]"
            >
              {book.novel.title}
            </span>
          </div>
        }
        right={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="Edit metadata & cover"
              onClick={openEditModal}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={
                state.offline
                  ? "Go online to refresh"
                  : !sourceInfo
                    ? "Source uninstalled"
                    : "Refresh chapters from source"
              }
              disabled={state.offline || !sourceInfo || state.busy}
              onClick={() => rpc("refreshBook")}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${state.busy ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto animate-view-enter"
        onClick={() => {
          if (showRatingPicker) setShowRatingPicker(false);
          if (showCategoryPicker) setShowCategoryPicker(false);
          if (showBulkMenu) setShowBulkMenu(false);
        }}
      >
        <div className="mx-auto max-w-[920px] px-7 py-6">
          {/* Editorial hero */}
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="relative h-[228px] w-[152px] shrink-0 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-md">
              {cover ? (
                <img src={cover} alt={book.novel.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                  <BookOpen className="h-8 w-8 opacity-40" />
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
              <div>
                <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)]">
                  {book.novel.title}
                </h1>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  {book.novel.author && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5">
                      <User className="h-3 w-3 text-[var(--text-muted)]" />
                      {book.novel.author}
                    </span>
                  )}
                  <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5 capitalize">
                    {book.novel.status.toLowerCase().replace(/_/g, " ")}
                  </span>
                  <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5">
                    {sourceName}
                  </span>
                  <span className="rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-0.5 tabular-nums">
                    {book.readCount}/{book.totalChapters - book.lockedCount} read
                  </span>
                </div>

                {genres.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {genres.slice(0, 12).map((genre) => (
                      <span
                        key={genre}
                        className="rounded-md bg-[var(--row-hover)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action row matching Android NovelActionRow */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {startChapter && (
                  <button
                    type="button"
                    disabled={!canReadTarget}
                    onClick={() => rpc("read", { chapterUrl: startChapter.url })}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    {book.readCount > 0 || resumeChapter ? "Continue reading" : "Start reading"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => rpc("favorite")}
                  className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors ${
                    book.favorite
                      ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                  }`}
                >
                  <Bookmark className={`h-3.5 w-3.5 ${book.favorite ? "fill-current" : ""}`} />
                  {book.favorite ? "In library" : "Add to library"}
                </button>

                {/* Category pill */}
                {state.categories.length > 0 && (
                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCategoryPicker((v) => !v);
                        setShowRatingPicker(false);
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3.5 text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    >
                      <Folder className="h-3.5 w-3.5" />
                      {categoryName ?? "Category"}
                    </button>
                    {showCategoryPicker && (
                      <div className="absolute left-0 top-11 z-30 w-[190px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 text-[12.5px] shadow-2xl">
                        <button
                          type="button"
                          onClick={() => {
                            setShowCategoryPicker(false);
                            rpc("setBookCategory", {
                              sourceId: book.sourceId,
                              novelUrl: book.novelUrl,
                              categoryId: null,
                            });
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)] ${
                            book.categoryId == null ? "font-medium text-[var(--accent)]" : ""
                          }`}
                        >
                          <span>Uncategorized</span>
                          {book.categoryId == null && <Check className="h-3.5 w-3.5" />}
                        </button>
                        {state.categories.map((cat) => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => {
                              setShowCategoryPicker(false);
                              rpc("setBookCategory", {
                                sourceId: book.sourceId,
                                novelUrl: book.novelUrl,
                                categoryId: cat.id,
                              });
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)] ${
                              book.categoryId === cat.id ? "font-medium text-[var(--accent)]" : ""
                            }`}
                          >
                            <span className="truncate">{cat.name}</span>
                            {book.categoryId === cat.id && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 1-10 User rating picker */}
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRatingPicker((v) => !v);
                      setShowCategoryPicker(false);
                    }}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${
                      book.userRating != null
                        ? "border-amber-400/35 bg-amber-500/12 text-amber-400"
                        : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Star className={`h-3.5 w-3.5 ${book.userRating != null ? "fill-amber-400" : ""}`} />
                    {book.userRating != null ? `${book.userRating}/10` : "Rate"}
                  </button>
                  {showRatingPicker && (
                    <div className="absolute left-0 top-11 z-30 w-[236px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-2xl">
                      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        <span>Your rating</span>
                        {book.userRating != null && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowRatingPicker(false);
                              rpc("setBookRating", {
                                sourceId: book.sourceId,
                                novelUrl: book.novelUrl,
                                rating: null,
                              });
                            }}
                            className="text-[var(--danger)] hover:underline"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-5 gap-1.5">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => {
                              setShowRatingPicker(false);
                              rpc("setBookRating", {
                                sourceId: book.sourceId,
                                novelUrl: book.novelUrl,
                                rating: score,
                              });
                            }}
                            className={`h-8 rounded-lg border text-[12.5px] font-semibold tabular-nums transition-colors ${
                              book.userRating === score
                                ? "border-amber-400 bg-amber-400/20 text-amber-300"
                                : "border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]"
                            }`}
                          >
                            {score}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {book.novel.description && (
            <div className="mt-6 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/55 p-4">
              <div
                className={`whitespace-pre-line text-[13.5px] leading-relaxed text-[var(--text-secondary)] ${
                  expandedDesc ? "" : "line-clamp-4"
                }`}
              >
                {renderRichText(book.novel.description)}
              </div>
              {book.novel.description.length > 260 && (
                <button
                  type="button"
                  onClick={() => setExpandedDesc((v) => !v)}
                  className="mt-2 text-[12px] font-medium text-[var(--accent)] hover:underline"
                >
                  {expandedDesc ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          )}

          {/* Chapters header + search + 4-way sort + bulk actions */}
          <div className="mt-7">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--border-hairline)] pb-3">
              <div className="flex items-baseline gap-2 mr-auto">
                <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  Chapters
                </h2>
                <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
                  {displayedChapters.length}
                  {displayedChapters.length !== book.totalChapters ? ` / ${book.totalChapters}` : ""}
                  {book.downloadedCount > 0 ? ` · ${book.downloadedCount} saved` : ""}
                </span>
              </div>

              <SearchPill
                value={chapterQuery}
                onChange={setChapterQuery}
                placeholder="Filter chapters…"
                className="w-[185px] !h-8"
              />

              <select
                aria-label="Sort chapters"
                value={book.chapterSortOrder}
                onChange={(e) =>
                  rpc("setBookChapterSort", {
                    sourceId: book.sourceId,
                    novelUrl: book.novelUrl,
                    sort: e.target.value,
                  })
                }
                className="h-8 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-[12px] text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
              >
                {CHAPTER_SORTS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[var(--bg-canvas)]">
                    {s.label}
                  </option>
                ))}
              </select>

              {/* Bulk actions menu */}
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  title="Bulk chapter actions"
                  onClick={() => setShowBulkMenu((v) => !v)}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {showBulkMenu && (
                  <div className="absolute right-0 top-10 z-30 w-[210px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 text-[12.5px] shadow-2xl">
                    <button
                      type="button"
                      disabled={state.offline || !sourceInfo || undownloadedUnreadUrls.length === 0 || state.busy}
                      onClick={() => {
                        setShowBulkMenu(false);
                        rpc("downloadChapters", { chapterUrls: undownloadedUnreadUrls.slice(0, 5) });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)] disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5 text-[var(--accent)]" />
                      Download next 5 unread
                    </button>
                    <button
                      type="button"
                      disabled={state.offline || !sourceInfo || undownloadedUnreadUrls.length === 0 || state.busy}
                      onClick={() => {
                        setShowBulkMenu(false);
                        rpc("downloadChapters", { chapterUrls: undownloadedUnreadUrls });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)] disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5 text-[var(--accent)]" />
                      Download all unread ({undownloadedUnreadUrls.length})
                    </button>
                    <div className="my-1 border-t border-[var(--border-hairline)]" />
                    <button
                      type="button"
                      disabled={unreadReadableUrls.length === 0}
                      onClick={() => {
                        setShowBulkMenu(false);
                        rpc("markChaptersRead", { chapterUrls: unreadReadableUrls, read: true });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)] disabled:opacity-40"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Mark all read
                    </button>
                    <button
                      type="button"
                      disabled={book.readCount === 0}
                      onClick={() => {
                        setShowBulkMenu(false);
                        rpc("markChaptersRead", { chapterUrls: allReadableUrls, read: false });
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)] disabled:opacity-40"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      Mark all unread
                    </button>
                    {allDownloadedUrls.length > 0 && (
                      <>
                        <div className="my-1 border-t border-[var(--border-hairline)]" />
                        <button
                          type="button"
                          onClick={() => {
                            setShowBulkMenu(false);
                            rpc("deleteDownloads", { chapterUrls: allDownloadedUrls });
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete all downloads
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const ch = displayedChapters[item.index];
                const readable = !ch.locked && (!state.offline || Boolean(ch.downloaded));
                const isResume = ch.url === book.resumeChapterUrl;
                const readingIdx = readingIndex.get(ch.url) ?? -1;
                const dateStr = ch.uploadDate > 0 ? CHAPTER_DATE.format(ch.uploadDate) : null;

                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                    }}
                    onContextMenu={(e) => {
                      if (ch.locked) return;
                      e.preventDefault();
                      setChapterMenu({
                        x: e.clientX,
                        y: e.clientY,
                        chapter: ch,
                        indexInReadingOrder: readingIdx,
                      });
                    }}
                    className={`group flex items-center gap-2.5 border-b border-[var(--border-hairline)] px-2 py-2 transition-colors ${
                      readable ? "hover:bg-[var(--row-hover)]" : "opacity-45"
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!readable}
                      onClick={() => rpc("read", { chapterUrl: ch.url })}
                      className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                    >
                      <div
                        className={`truncate text-[13.5px] ${
                          ch.locked
                            ? "text-[var(--warn)]"
                            : isResume
                              ? "font-medium text-[var(--accent)]"
                              : ch.read
                                ? "text-[var(--text-muted)]"
                                : "text-[var(--text-primary)]"
                        }`}
                      >
                        {ch.name}
                      </div>
                      {dateStr && (
                        <div className="text-[11px] text-[var(--text-muted)]">{dateStr}</div>
                      )}
                    </button>

                    {/* Quick per-chapter actions */}
                    {ch.locked ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--warn)] mr-1" />
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          title={ch.read ? "Mark unread" : "Mark read"}
                          onClick={() =>
                            rpc("markChaptersRead", { chapterUrls: [ch.url], read: !ch.read })
                          }
                          className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                            ch.read
                              ? "text-[var(--text-muted)] hover:bg-[var(--row-active)] hover:text-[var(--text-primary)]"
                              : "opacity-0 group-hover:opacity-100 text-[var(--text-secondary)] hover:bg-[var(--row-active)] hover:text-[var(--accent)]"
                          }`}
                        >
                          {ch.read ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>

                        {ch.downloaded ? (
                          <button
                            type="button"
                            title="Saved offline (click to delete download)"
                            onClick={() => rpc("deleteDownloads", { chapterUrls: [ch.url] })}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--accent)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Download chapter"
                            disabled={state.offline || !sourceInfo || state.busy}
                            onClick={() => rpc("downloadChapters", { chapterUrls: [ch.url] })}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--row-active)] hover:text-[var(--text-primary)] disabled:opacity-20"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Chapter right-click menu */}
      {chapterMenu && (
        <div
          style={{
            left: Math.min(chapterMenu.x, window.innerWidth - 220),
            top: Math.min(chapterMenu.y, window.innerHeight - 170),
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-[210px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 text-[12.5px] shadow-2xl"
        >
          <button
            type="button"
            onClick={() => {
              const ch = chapterMenu.chapter;
              setChapterMenu(null);
              rpc("markChaptersRead", { chapterUrls: [ch.url], read: !ch.read });
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)]"
          >
            {chapterMenu.chapter.read ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {chapterMenu.chapter.read ? "Mark unread" : "Mark read"}
          </button>

          {chapterMenu.indexInReadingOrder > 0 && (
            <button
              type="button"
              onClick={() => {
                const prevUrls = orderedChapters
                  .slice(0, chapterMenu.indexInReadingOrder + 1)
                  .filter((c) => !c.locked)
                  .map((c) => c.url);
                setChapterMenu(null);
                rpc("markChaptersRead", { chapterUrls: prevUrls, read: true });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)]"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark previous as read
            </button>
          )}

          {chapterMenu.chapter.downloaded ? (
            <button
              type="button"
              onClick={() => {
                const url = chapterMenu.chapter.url;
                setChapterMenu(null);
                rpc("deleteDownloads", { chapterUrls: [url] });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[var(--danger)] hover:bg-[var(--danger-soft)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete download
            </button>
          ) : (
            <button
              type="button"
              disabled={state.offline || !sourceInfo || state.busy}
              onClick={() => {
                const url = chapterMenu.chapter.url;
                setChapterMenu(null);
                rpc("downloadChapters", { chapterUrls: [url] });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)] disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5 text-[var(--accent)]" />
              Download chapter
            </button>
          )}
        </div>
      )}

      {/* Edit Metadata & Cover Override modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs">
          <div className="flex max-h-[85vh] w-[500px] flex-col rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3.5">
              <h3 className="text-[15px] font-semibold">Edit book metadata</h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--row-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3.5 text-[12.5px]">
              <p className="text-[12px] text-[var(--text-secondary)]">
                Leave any field blank to use the source's original value. Custom values survive source refreshes.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-[var(--text-secondary)]">Title</span>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder={book.sourceNovel.title}
                  className="h-9 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[var(--text-secondary)]">Author</span>
                <input
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                  placeholder={book.sourceNovel.author ?? "Unknown"}
                  className="h-9 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[var(--text-secondary)]">Status</span>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="h-9 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 focus:border-[var(--accent)] focus:outline-none"
                >
                  <option value="">Source default ({book.sourceNovel.status})</option>
                  <option value="ONGOING">Ongoing</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="ON_HIATUS">On hiatus</option>
                  <option value="CANCELLED">Cancelled</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[var(--text-secondary)]">Genres (comma-separated)</span>
                <input
                  value={editGenres}
                  onChange={(e) => setEditGenres(e.target.value)}
                  placeholder={book.sourceNovel.genres.join(", ") || "Fantasy, Sci-Fi"}
                  className="h-9 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[var(--text-secondary)]">Custom cover URL</span>
                <input
                  value={editCover}
                  onChange={(e) => setEditCover(e.target.value)}
                  placeholder={book.sourceNovel.thumbnailUrl ?? "https://…"}
                  className="h-9 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[var(--text-secondary)]">Synopsis</span>
                <textarea
                  rows={4}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder={book.sourceNovel.description ?? "Synopsis…"}
                  className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] p-3 focus:border-[var(--accent)] focus:outline-none"
                />
              </label>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-5 py-3.5">
              <button
                type="button"
                onClick={resetOverrides}
                className="text-[12.5px] font-medium text-[var(--danger)] hover:underline"
              >
                Reset all overrides
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="h-8 rounded-full border border-[var(--border-strong)] px-3.5 text-[12.5px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveOverrides}
                  className="h-8 rounded-full bg-[var(--accent)] px-4 text-[12.5px] font-medium text-[var(--accent-fg)]"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function uniqueGenres(genres: string[]): string[] {
  const seen = new Set<string>();
  return genres
    .map((g) => g.trim())
    .filter((g) => {
      const key = g.toLowerCase();
      if (!g || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Estimated chapter row height; rows are measured after mount, so this only seeds the layout. */
const CHAPTER_ROW_HEIGHT = 53;

// One formatter for every row; constructing Intl formatters per row is slow.
const CHAPTER_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
