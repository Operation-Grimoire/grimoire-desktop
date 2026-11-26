import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BookOpen,
  Download,
  FolderPlus,
  LayoutGrid,
  Library,
  List,
  Pencil,
  Play,
  SearchX,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { ReaderState, SavedBook } from "../api/types";
import { coverUrl, rpc } from "../api/client";
import { HeaderBar } from "../components/HeaderBar";
import { SearchPill } from "../components/SearchPill";
import { CoverCard } from "../components/CoverCard";
import { EmptyState } from "../components/EmptyState";

type LibrarySort = "LAST_READ" | "TITLE" | "UNREAD" | "TOTAL" | "ADDED" | "RATING";

export function LibraryView({
  state,
  coverBaseUrl,
}: {
  state: ReaderState;
  coverBaseUrl: string | null;
}) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<number | "ALL">("ALL");
  const [sortBy, setSortBy] = useState<LibrarySort>("LAST_READ");
  const [sortAsc, setSortAsc] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [viewMode, setViewMode] = useState<"GRID" | "LIST">("GRID");
  const [showFilters, setShowFilters] = useState(false);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    book: SavedBook;
  } | null>(null);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // Reset to ALL if the selected category was deleted.
  useEffect(() => {
    if (activeCategory !== "ALL" && !state.categories.some((c) => c.id === activeCategory)) {
      setActiveCategory("ALL");
    }
  }, [activeCategory, state.categories]);

  const activeFilterCount =
    (unreadOnly ? 1 : 0) + (downloadedOnly ? 1 : 0) + (statusFilter !== "ALL" ? 1 : 0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = state.library.filter((b) => {
      if (activeCategory !== "ALL" && b.categoryId !== activeCategory) return false;
      if (unreadOnly && b.unreadCount <= 0) return false;
      if (downloadedOnly && b.downloadedCount <= 0) return false;
      if (statusFilter !== "ALL" && b.novel.status !== statusFilter) return false;
      if (!q) return true;
      return (
        b.novel.title.toLowerCase().includes(q) ||
        (b.novel.author?.toLowerCase().includes(q) ?? false)
      );
    });

    const dir = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "TITLE":
          return a.novel.title.localeCompare(b.novel.title) * dir;
        case "LAST_READ":
          return ((a.lastReadAt || 0) - (b.lastReadAt || 0)) * dir || a.novel.title.localeCompare(b.novel.title);
        case "UNREAD":
          return (a.unreadCount - b.unreadCount) * dir || a.novel.title.localeCompare(b.novel.title);
        case "TOTAL":
          return (a.totalChapters - b.totalChapters) * dir || a.novel.title.localeCompare(b.novel.title);
        case "ADDED":
          return ((a.addedAt || 0) - (b.addedAt || 0)) * dir || a.novel.title.localeCompare(b.novel.title);
        case "RATING":
          return ((a.userRating ?? 0) - (b.userRating ?? 0)) * dir || a.novel.title.localeCompare(b.novel.title);
      }
    });
  }, [state.library, activeCategory, unreadOnly, downloadedOnly, statusFilter, query, sortBy, sortAsc]);

  const openBook = (book: SavedBook) =>
    rpc("openSaved", { sourceId: book.sourceId, novelUrl: book.novelUrl });

  return (
    <div className="relative flex h-full flex-col">
      <HeaderBar
        left={
          <div className="flex items-baseline gap-2" data-tauri-drag-region>
            <h1 className="text-[15px] font-semibold tracking-[-0.015em]" data-tauri-drag-region>
              Library
            </h1>
            {state.library.length > 0 && (
              <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
                {filtered.length}
                {filtered.length !== state.library.length ? ` / ${state.library.length}` : ""}
              </span>
            )}
          </div>
        }
        right={
          state.library.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <SearchPill
                value={query}
                onChange={setQuery}
                placeholder="Search library…"
                className="w-[210px]"
              />
              <button
                type="button"
                title="Filter & sort"
                onClick={() => setShowFilters((v) => !v)}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
                  showFilters || activeFilterCount > 0
                    ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {activeFilterCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent)] text-[9px] font-bold text-[var(--accent-fg)]">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                title={viewMode === "GRID" ? "Switch to list view" : "Switch to grid view"}
                onClick={() => setViewMode((m) => (m === "GRID" ? "LIST" : "GRID"))}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              >
                {viewMode === "GRID" ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : null
        }
      />

      {/* Category tabs strip */}
      {state.library.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border-hairline)] px-6 py-2">
          <CategoryTab
            label="All"
            count={state.library.length}
            active={activeCategory === "ALL"}
            onClick={() => setActiveCategory("ALL")}
          />
          {state.categories.map((cat) => (
            <CategoryTab
              key={cat.id}
              label={cat.name}
              count={state.library.filter((b) => b.categoryId === cat.id).length}
              active={activeCategory === cat.id}
              onClick={() => setActiveCategory(cat.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => setShowCategoriesModal(true)}
            title="Manage categories"
            className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <FolderPlus className="h-3 w-3" />
            Categories
          </button>
        </div>
      )}

      {/* Filter & Sort Popover */}
      {showFilters && (
        <div className="absolute right-5 top-[58px] z-30 w-[300px] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Sort by
            </span>
            <button
              type="button"
              onClick={() => setSortAsc((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
            >
              {sortAsc ? <ArrowUpNarrowWide className="h-3.5 w-3.5" /> : <ArrowDownWideNarrow className="h-3.5 w-3.5" />}
              {sortAsc ? "Ascending" : "Descending"}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {(
              [
                ["LAST_READ", "Last read"],
                ["TITLE", "Title"],
                ["UNREAD", "Unread"],
                ["TOTAL", "Chapters"],
                ["ADDED", "Date added"],
                ["RATING", "My rating"],
              ] as [LibrarySort, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortBy(key)}
                className={`h-8 rounded-lg border px-2.5 text-left text-[12px] font-medium transition-colors ${
                  sortBy === key
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Filters
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <FilterChip label="Unread" active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} />
            <FilterChip
              label="Downloaded"
              active={downloadedOnly}
              onClick={() => setDownloadedOnly((v) => !v)}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {(["ALL", "ONGOING", "COMPLETED", "ON_HIATUS"] as const).map((st) => (
              <FilterChip
                key={st}
                label={st === "ALL" ? "Any status" : st.toLowerCase().replace("_", " ")}
                active={statusFilter === st}
                onClick={() => setStatusFilter(st)}
              />
            ))}
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setUnreadOnly(false);
                setDownloadedOnly(false);
                setStatusFilter("ALL");
              }}
              className="mt-3 text-[12px] font-medium text-[var(--accent)] hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      {/* Main Content */}
      <div
        className="flex-1 overflow-y-auto px-6 py-5 animate-view-enter"
        onClick={() => showFilters && setShowFilters(false)}
      >
        {state.library.length === 0 ? (
          <EmptyState
            icon={Library}
            title="Your library is empty"
            subtitle="Books you add from Browse or save offline appear here."
            actionLabel="Browse sources"
            onAction={() => rpc("showBrowse")}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No matching books"
            subtitle="Try clearing your search, switching categories, or resetting filters."
            actionLabel="Reset view"
            onAction={() => {
              setQuery("");
              setActiveCategory("ALL");
              setUnreadOnly(false);
              setDownloadedOnly(false);
              setStatusFilter("ALL");
            }}
          />
        ) : viewMode === "GRID" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(146px,1fr))] gap-x-4 gap-y-6">
            {filtered.map((book) => (
              <CoverCard
                key={`${book.sourceId}:${book.novelUrl}`}
                title={book.novel.title}
                imageUrl={coverUrl(coverBaseUrl, book.novel.thumbnailUrl)}
                unreadCount={book.unreadCount}
                downloadedCount={book.downloadedCount}
                totalChapters={book.totalChapters}
                userRating={book.userRating}
                onClick={() => openBook(book)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, book });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-[900px] divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45">
            {filtered.map((book) => {
              const img = coverUrl(coverBaseUrl, book.novel.thumbnailUrl);
              const pct =
                book.totalChapters > 0
                  ? Math.round((book.readCount / Math.max(1, book.totalChapters - book.lockedCount)) * 100)
                  : 0;
              return (
                <div
                  key={`${book.sourceId}:${book.novelUrl}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, book });
                  }}
                  className="flex items-center gap-3.5 px-3.5 py-2.5 transition-colors hover:bg-[var(--row-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => openBook(book)}
                    className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                      {img ? (
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                          <BookOpen className="h-4 w-4 opacity-40" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-[var(--text-primary)]">
                        {book.novel.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                        {book.novel.author && <span className="truncate">{book.novel.author}</span>}
                        <span className="tabular-nums text-[var(--text-muted)]">
                          {book.readCount}/{book.totalChapters} read ({pct}%)
                        </span>
                      </div>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    {book.userRating != null && (
                      <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-400 tabular-nums">
                        <Star className="h-3 w-3 fill-amber-400" />
                        {book.userRating}
                      </span>
                    )}
                    {book.downloadedCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                        <Download className="h-3 w-3 text-[var(--accent)]" />
                        {book.downloadedCount}
                      </span>
                    )}
                    {book.unreadCount > 0 && (
                      <span className="rounded-md bg-[var(--accent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-fg)] tabular-nums">
                        {book.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 220), top: Math.min(contextMenu.y, window.innerHeight - 240) }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-[210px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 text-[12.5px] shadow-2xl"
        >
          <button
            type="button"
            onClick={() => {
              const b = contextMenu.book;
              setContextMenu(null);
              openBook(b);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)]"
          >
            <Play className="h-3.5 w-3.5 text-[var(--accent)]" />
            Open details
          </button>

          {state.categories.length > 0 && (
            <div className="my-1 border-t border-[var(--border-hairline)] pt-1">
              <div className="px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Category
              </div>
              <button
                type="button"
                onClick={() => {
                  const b = contextMenu.book;
                  setContextMenu(null);
                  rpc("setBookCategory", { sourceId: b.sourceId, novelUrl: b.novelUrl, categoryId: null });
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-left hover:bg-[var(--row-hover)] ${
                  contextMenu.book.categoryId == null ? "text-[var(--accent)] font-medium" : ""
                }`}
              >
                None
              </button>
              {state.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    const b = contextMenu.book;
                    setContextMenu(null);
                    rpc("setBookCategory", { sourceId: b.sourceId, novelUrl: b.novelUrl, categoryId: c.id });
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-left hover:bg-[var(--row-hover)] ${
                    contextMenu.book.categoryId === c.id ? "text-[var(--accent)] font-medium" : ""
                  }`}
                >
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-1 border-t border-[var(--border-hairline)] pt-1">
            <button
              type="button"
              onClick={() => {
                const b = contextMenu.book;
                setContextMenu(null);
                rpc("removeFromLibrary", { sourceId: b.sourceId, novelUrl: b.novelUrl });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[var(--danger)] hover:bg-[var(--danger-soft)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove from library
            </button>
          </div>
        </div>
      )}

      {/* Manage Categories modal */}
      {showCategoriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs">
          <div className="w-[420px] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3.5">
              <h3 className="text-[15px] font-semibold">Manage categories</h3>
              <button
                type="button"
                onClick={() => setShowCategoriesModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--row-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newCategoryName.trim();
                  if (!name) return;
                  setNewCategoryName("");
                  rpc("createCategory", { name });
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name…"
                  className="h-9 flex-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-[13px] focus:border-[var(--accent)] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newCategoryName.trim()}
                  className="h-9 rounded-full bg-[var(--accent)] px-4 text-[12.5px] font-medium text-[var(--accent-fg)] disabled:opacity-40"
                >
                  Add
                </button>
              </form>

              {state.categories.length === 0 ? (
                <p className="text-center text-[12.5px] text-[var(--text-secondary)] py-3">
                  No categories yet. Create one to organize your library.
                </p>
              ) : (
                <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/50">
                  {state.categories.map((cat) => (
                    <div key={cat.id} className="flex items-center gap-2 px-3.5 py-2.5">
                      {editingCatId === cat.id ? (
                        <form
                          className="flex flex-1 gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const n = editingCatName.trim();
                            if (n) rpc("renameCategory", { id: cat.id, name: n });
                            setEditingCatId(null);
                          }}
                        >
                          <input
                            autoFocus
                            value={editingCatName}
                            onChange={(e) => setEditingCatName(e.target.value)}
                            className="h-7 flex-1 rounded border border-[var(--accent)] bg-[var(--bg-canvas)] px-2 text-[12.5px] focus:outline-none"
                          />
                          <button type="submit" className="text-[12px] font-medium text-[var(--accent)]">
                            Save
                          </button>
                        </form>
                      ) : (
                        <>
                          <span className="flex-1 truncate text-[13px] font-medium">{cat.name}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCatId(cat.id);
                              setEditingCatName(cat.name);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => rpc("deleteCategory", { id: cat.id })}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      <span>{label}</span>
      <span className="text-[10.5px] opacity-70 tabular-nums">{count}</span>
    </button>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-full border px-2.5 text-[11.5px] font-medium capitalize transition-colors ${
        active
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );
}
