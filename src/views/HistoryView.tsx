import { useMemo, useState } from "react";
import { History, Play, Trash2, BookOpen } from "lucide-react";
import type { HistoryEntry, ReaderState } from "../api/types";
import { coverUrl, rpc } from "../api/client";
import { HeaderBar } from "../components/HeaderBar";
import { EmptyState } from "../components/EmptyState";

export function HistoryView({
  state,
  coverBaseUrl,
}: {
  state: ReaderState;
  coverBaseUrl: string | null;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  const coverByNovel = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const b of state.library) {
      map.set(`${b.sourceId}:${b.novelUrl}`, b.novel.thumbnailUrl);
    }
    return map;
  }, [state.library]);

  const groups = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const byLabel = new Map<string, HistoryEntry[]>();
    for (const entry of state.history) {
      const d = new Date(entry.openedAtMillis);
      d.setHours(0, 0, 0, 0);
      let label: string;
      if (d.getTime() === today.getTime()) label = "Today";
      else if (d.getTime() === yesterday.getTime()) label = "Yesterday";
      else label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const list = byLabel.get(label) ?? [];
      list.push(entry);
      byLabel.set(label, list);
    }
    return Array.from(byLabel.entries());
  }, [state.history]);

  return (
    <div className="flex h-full flex-col">
      <HeaderBar
        left={
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]" data-tauri-drag-region>
            Reading history
          </h1>
        }
        right={
          state.history.length > 0 ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--danger)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear all
            </button>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto animate-view-enter">
        <div className="mx-auto max-w-[780px] px-6 py-5">
          {/* Recording toggle card */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/70 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                Record opened chapters
              </div>
              <div className="text-[12px] text-[var(--text-secondary)]">
                Keep a local list of chapters you open.
              </div>
            </div>
            <ToggleSwitch
              checked={state.historyRecording}
              onChange={(checked) => rpc("setHistoryRecording", { enabled: checked })}
            />
          </div>

          {state.history.length === 0 ? (
            <EmptyState
              icon={History}
              title="No reading history yet"
              subtitle={
                state.historyRecording
                  ? "Chapters you open will appear here."
                  : "Turn on recording above to keep track of chapters you open."
              }
            />
          ) : (
            <div className="mt-6 flex flex-col gap-6">
              {groups.map(([day, entries]) => (
                <section key={day}>
                  <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {day}
                  </h2>
                  <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45">
                    {entries.map((entry) => {
                      const rawCover = coverByNovel.get(`${entry.sourceId}:${entry.novelUrl}`) ?? null;
                      const img = coverUrl(coverBaseUrl, rawCover);
                      const time = new Date(entry.openedAtMillis).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      return (
                        <div
                          key={entry.id}
                          className="group flex items-center gap-3.5 px-3.5 py-2.5 transition-colors hover:bg-[var(--row-hover)]"
                        >
                          <div className="h-11 w-8 shrink-0 overflow-hidden rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                            {img ? (
                              <img src={img} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                                <BookOpen className="h-3.5 w-3.5 opacity-45" />
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => rpc("readHistory", { id: entry.id })}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="truncate text-[13.5px] font-medium text-[var(--text-primary)]">
                              {entry.novelTitle}
                            </div>
                            <div className="truncate text-[12px] text-[var(--text-secondary)]">
                              {entry.chapterTitle} · {time}
                            </div>
                          </button>
                          <button
                            type="button"
                            aria-label="Resume chapter"
                            onClick={() => rpc("readHistory", { id: entry.id })}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                          </button>
                          <button
                            type="button"
                            aria-label="Remove history entry"
                            onClick={() => rpc("removeHistory", { id: entry.id })}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs">
          <div className="w-[380px] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 shadow-2xl">
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Clear reading history?
            </h3>
            <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
              This removes your opened-chapter log. Saved library books and reading positions stay intact.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="h-8 rounded-full border border-[var(--border-strong)] px-3.5 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--row-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmClear(false);
                  rpc("clearHistory");
                }}
                className="h-8 rounded-full bg-[var(--danger)] px-4 text-[12.5px] font-medium text-white hover:opacity-90"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-150 ${
        checked ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
