import { useMemo, useState } from "react";
import { Library, SearchX } from "lucide-react";
import type { ReaderState } from "../api/types";
import { coverUrl, rpc } from "../api/client";
import { HeaderBar } from "../components/HeaderBar";
import { SearchPill } from "../components/SearchPill";
import { CoverCard } from "../components/CoverCard";
import { EmptyState } from "../components/EmptyState";

export function LibraryView({
  state,
  coverBaseUrl,
}: {
  state: ReaderState;
  coverBaseUrl: string | null;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.library;
    return state.library.filter(
      (b) =>
        b.novel.title.toLowerCase().includes(q) ||
        (b.novel.author?.toLowerCase().includes(q) ?? false),
    );
  }, [state.library, query]);

  return (
    <div className="flex h-full flex-col">
      <HeaderBar
        left={
          <div className="flex items-baseline gap-2" data-tauri-drag-region>
            <h1 className="text-[15px] font-semibold tracking-[-0.015em]" data-tauri-drag-region>
              Library
            </h1>
            {state.library.length > 0 && (
              <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
                {state.library.length}
              </span>
            )}
          </div>
        }
        right={
          state.library.length > 0 ? (
            <SearchPill
              value={query}
              onChange={setQuery}
              placeholder="Search library…"
              className="w-[230px]"
            />
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5 animate-view-enter">
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
            subtitle={`Nothing in your library matches "${query.trim()}".`}
            actionLabel="Clear search"
            onAction={() => setQuery("")}
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(146px,1fr))] gap-x-4 gap-y-6">
            {filtered.map((book) => (
              <CoverCard
                key={`${book.sourceId}:${book.novelUrl}`}
                title={book.novel.title}
                imageUrl={coverUrl(coverBaseUrl, book.novel.thumbnailUrl)}
                downloadedCount={book.downloadedCount}
                totalChapters={book.totalChapters}
                onClick={() =>
                  rpc("openSaved", { sourceId: book.sourceId, novelUrl: book.novelUrl })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
