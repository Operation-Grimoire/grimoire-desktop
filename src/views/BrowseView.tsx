import { useEffect, useState } from "react";
import { Compass, Flame, Clock, Search, Puzzle, WifiOff, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import type { BrowseMode, ReaderState } from "../api/types";
import { coverUrl, rpc } from "../api/client";
import { HeaderBar } from "../components/HeaderBar";
import { SearchPill } from "../components/SearchPill";
import { CoverCard } from "../components/CoverCard";
import { EmptyState } from "../components/EmptyState";
import { FilterDrawer } from "../components/FilterDrawer";

const MODE_META: Record<BrowseMode, { label: string; icon: typeof Flame }> = {
  POPULAR: { label: "Popular", icon: Flame },
  LATEST: { label: "Latest", icon: Clock },
  SEARCH: { label: "Search", icon: Search },
};

export function BrowseView({
  state,
  coverBaseUrl,
}: {
  state: ReaderState;
  coverBaseUrl: string | null;
}) {
  const [queryInput, setQueryInput] = useState(state.browseQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filters = state.browseModes.includes("SEARCH") ? state.browseFilters : null;
  const filtered = filters?.applied === true && state.browseMode === "SEARCH";

  // Another source brings its own filters; never show the previous source's panel.
  useEffect(() => {
    setFiltersOpen(false);
  }, [state.browseSource]);

  useEffect(() => {
    setQueryInput(state.browseQuery);
  }, [state.browseQuery, state.browseSource]);

  const submitSearch = () => {
    const trimmed = queryInput.trim();
    if (trimmed) rpc("search", { query: trimmed });
  };

  return (
    <div className="flex h-full flex-col">
      <HeaderBar
        left={
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]" data-tauri-drag-region>
            {state.sourceName ? "Browse" : "Browse sources"}
          </h1>
        }
        right={
          state.sources.length > 0 ? (
            <div className="relative flex items-center">
              <select
                aria-label="Select source"
                value={state.browseSource ?? ""}
                onChange={(e) => rpc("selectSource", { sourceId: e.target.value })}
                className="h-8 appearance-none rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] pl-3.5 pr-8 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:outline-none"
              >
                {state.sources.map((s) => (
                  <option key={s.sourceId} value={s.sourceId} className="bg-[var(--bg-canvas)]">
                    {s.name} ({s.lang.toUpperCase()})
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
            </div>
          ) : null
        }
      />

      {state.sourceName == null ? (
        <div className="flex-1 overflow-y-auto animate-view-enter">
          <EmptyState
            icon={Puzzle}
            title="No sources installed"
            subtitle="Install an extension to browse its catalog."
            actionLabel="Manage extensions"
            onAction={() => rpc("showExtensions")}
          />
        </div>
      ) : state.offline ? (
        <div className="flex-1 overflow-y-auto animate-view-enter">
          <EmptyState
            icon={WifiOff}
            title="Offline mode"
            subtitle="Go online to browse this source."
            actionLabel="Go online"
            onAction={() => rpc("offline", { offline: false })}
          />
        </div>
      ) : state.browseModes.length === 0 ? (
        <div className="flex-1 overflow-y-auto animate-view-enter">
          <EmptyState
            icon={Compass}
            title="No catalog available"
            subtitle={`${state.sourceName} does not expose a browsable catalog.`}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden animate-view-enter">
          {/* Controls strip */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-hairline)] px-6 py-3">
            <div className="inline-flex rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-0.5">
              {state.browseModes.map((mode) => {
                const { label, icon: Icon } = MODE_META[mode];
                const active = state.browseMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => rpc("setBrowseMode", { mode })}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors duration-75 ${
                      active
                        ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${active ? "text-[var(--accent)]" : ""}`} />
                    {label}
                  </button>
                );
              })}
            </div>

            {filters && (
              <div className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  aria-pressed={filtered}
                  className={`flex h-8 items-center gap-1.5 border px-3 text-[12.5px] font-medium transition-colors ${
                    filtered
                      ? "rounded-l-full border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "rounded-full border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filters
                  {filtered && filters.activeCount > 0 && (
                    <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10.5px] font-semibold text-[var(--accent-fg)]">
                      {filters.activeCount}
                    </span>
                  )}
                </button>
                {filtered && (
                  <button
                    type="button"
                    aria-label="Clear filters"
                    disabled={state.busy}
                    onClick={() => rpc("clearFilters")}
                    className="flex h-8 items-center rounded-r-full border border-l-0 border-[var(--accent)] bg-[var(--accent-soft)] px-2 text-[var(--accent)] transition-opacity hover:opacity-80 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {state.browseMode === "SEARCH" && (
              <div className="flex flex-1 items-center gap-2 max-w-[440px]">
                <SearchPill
                  value={queryInput}
                  onChange={setQueryInput}
                  onSubmit={submitSearch}
                  placeholder={`Search ${state.sourceName}…`}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={submitSearch}
                  disabled={!queryInput.trim() || state.busy}
                  className="h-9 rounded-full bg-[var(--accent)] px-4 text-[12.5px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Search
                </button>
              </div>
            )}
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {state.novels.length === 0 && !state.busy ? (
              <EmptyState
                icon={Compass}
                title={
                  state.browseMode === "SEARCH" && !state.browseQuery && !filtered
                    ? `Search ${state.sourceName}`
                    : "No titles found"
                }
                subtitle={
                  state.browseMode === "SEARCH" && !state.browseQuery && !filtered
                    ? filters
                      ? "Enter a title above, or open Filters."
                      : "Enter a title above and press Enter."
                    : filtered
                      ? "Try different filters."
                      : "Try switching listings or adjusting your search query."
                }
                actionLabel={state.browseMode !== "SEARCH" || filtered ? "Retry" : undefined}
                onAction={state.browseMode !== "SEARCH" || filtered ? () => rpc("browse") : undefined}
              />
            ) : (
              <>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(146px,1fr))] gap-x-4 gap-y-6">
                  {state.novels.map((novel) => (
                    <CoverCard
                      key={novel.url}
                      title={novel.title}
                      imageUrl={coverUrl(coverBaseUrl, novel.thumbnailUrl)}
                      onClick={() => rpc("details", { novelUrl: novel.url })}
                    />
                  ))}
                </div>

                {state.browseHasMore && (
                  <div className="mt-8 flex justify-center pb-4">
                    <button
                      type="button"
                      disabled={state.busy}
                      onClick={() => rpc("loadMore")}
                      className="rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-5 py-2 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-45"
                    >
                      {state.busy ? "Loading…" : "Load more"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {filtersOpen && filters && (
        <FilterDrawer
          filters={filters}
          query={state.browseQuery}
          busy={state.busy}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  );
}
