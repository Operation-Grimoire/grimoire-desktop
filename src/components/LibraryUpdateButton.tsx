import { Download, RefreshCw, X } from "lucide-react";
import type { ReaderState } from "../api/types";
import { rpc } from "../api/client";

/** Starts a library refresh, or shows its progress with a cancel control while it runs. */
export function LibraryUpdateButton({
  state,
  categoryId = null,
  label = "Update",
}: {
  state: ReaderState;
  categoryId?: number | null;
  label?: string;
}) {
  const progress = state.libraryUpdate;

  if (progress) {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div
        title={
          progress.downloading
            ? `Downloading new chapters${progress.current ? `: ${progress.current}` : ""}`
            : progress.current
              ? `Checking ${progress.current}`
              : "Updating library"
        }
        className="relative inline-flex h-8 items-center gap-2 overflow-hidden rounded-full border border-[var(--accent)]/40 bg-[var(--accent-soft)] pl-3 pr-1 text-[12px] font-medium text-[var(--accent)]"
      >
        <span
          className="absolute inset-y-0 left-0 bg-[var(--accent)]/15 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
        {progress.downloading ? (
          <Download className="relative h-3.5 w-3.5 animate-pulse" />
        ) : (
          <RefreshCw className="relative h-3.5 w-3.5 animate-spin" />
        )}
        <span className="relative tabular-nums">
          {progress.total > 0 ? `${progress.done}/${progress.total}` : "Starting…"}
        </span>
        <button
          type="button"
          aria-label="Cancel library update"
          onClick={() => rpc("cancelLibraryUpdate")}
          className="relative flex h-6 w-6 items-center justify-center rounded-full text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={state.offline}
      title={state.offline ? "Go online to update your library" : "Check sources for new chapters"}
      onClick={() => rpc("updateLibrary", { categoryId })}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshCw className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
