import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  Bookmark,
  BookOpen,
  Check,
  Lock,
  Play,
  User,
} from "lucide-react";
import type { ReaderState } from "../api/types";
import { coverUrl, rpc } from "../api/client";
import { HeaderBar } from "../components/HeaderBar";

export function BookDetailView({
  state,
  coverBaseUrl,
}: {
  state: ReaderState;
  coverBaseUrl: string | null;
}) {
  const book = state.book;
  const [newestFirst, setNewestFirst] = useState(false);
  const [expandedDesc, setExpandedDesc] = useState(false);

  const chapters = useMemo(() => {
    const list = book?.chapters ?? [];
    return newestFirst ? [...list].reverse() : list;
  }, [book?.chapters, newestFirst]);

  if (!book) return null;

  const sourceName =
    state.sources.find((s) => s.sourceId === book.sourceId)?.name ?? "Source uninstalled";
  const cover = coverUrl(coverBaseUrl, book.novel.thumbnailUrl);
  const resumeChapter = book.chapters?.find((c) => c.url === book.resumeChapterUrl && !c.locked);
  const startChapter = resumeChapter ?? book.chapters?.find((c) => !c.locked);
  const canReadTarget =
    startChapter != null && (!state.offline || Boolean(startChapter.downloaded));

  return (
    <div className="flex h-full flex-col">
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
      />

      <div className="flex-1 overflow-y-auto animate-view-enter">
        <div className="mx-auto max-w-[920px] px-7 py-6">
          {/* Editorial hero */}
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="relative h-[225px] w-[150px] shrink-0 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-md">
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
                </div>

                {book.novel.genres.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {book.novel.genres.slice(0, 10).map((genre) => (
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

              {/* Primary action row */}
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                {startChapter && (
                  <button
                    type="button"
                    disabled={!canReadTarget}
                    onClick={() => rpc("read", { chapterUrl: startChapter.url })}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    {resumeChapter ? "Continue reading" : "Start reading"}
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
              </div>
            </div>
          </div>

          {/* Description */}
          {book.novel.description && (
            <div className="mt-6 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/55 p-4">
              <p
                className={`whitespace-pre-line text-[13.5px] leading-relaxed text-[var(--text-secondary)] ${
                  expandedDesc ? "" : "line-clamp-4"
                }`}
              >
                {book.novel.description}
              </p>
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

          {/* Chapters */}
          <div className="mt-7">
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] pb-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  Chapters
                </h2>
                <span className="text-[12px] tabular-nums text-[var(--text-muted)]">
                  {book.totalChapters}
                  {book.downloadedCount > 0 ? ` · ${book.downloadedCount} saved` : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setNewestFirst((v) => !v)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                {newestFirst ? "Newest first" : "Oldest first"}
              </button>
            </div>

            <div className="divide-y divide-[var(--border-hairline)]">
              {chapters.map((ch) => {
                const readable = !ch.locked && (!state.offline || Boolean(ch.downloaded));
                const isResume = ch.url === book.resumeChapterUrl;
                return (
                  <button
                    key={ch.url}
                    type="button"
                    disabled={!readable}
                    onClick={() => rpc("read", { chapterUrl: ch.url })}
                    className={`flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors ${
                      readable
                        ? "hover:bg-[var(--row-hover)]"
                        : "cursor-not-allowed opacity-45"
                    }`}
                  >
                    <span
                      className={`flex-1 truncate text-[13.5px] ${
                        ch.locked
                          ? "text-[var(--warn)]"
                          : isResume
                            ? "font-medium text-[var(--accent)]"
                            : "text-[var(--text-primary)]"
                      }`}
                    >
                      {ch.name}
                    </span>
                    {ch.locked ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--warn)]" />
                    ) : ch.downloaded ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
