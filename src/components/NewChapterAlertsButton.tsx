import { useEffect, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import type { SavedBook } from "../api/types";
import { rpc } from "../api/client";
import { ToggleSwitch } from "../views/HistoryView";

type AlertKey = "notify" | "notifyLocked" | "autoDownload";

const ROWS: { key: AlertKey; title: string; hint: string }[] = [
  { key: "notify", title: "Notify", hint: "When a library update finds new chapters." },
  { key: "notifyLocked", title: "Notify about locked chapters", hint: "Paid or not yet released chapters." },
  { key: "autoDownload", title: "Download automatically", hint: "Save new chapters after each library update." },
];

/** Android's per-novel "New chapters" settings; library updates act on them. */
export function NewChapterAlertsButton({ book }: { book: SavedBook }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const alerts = book.alerts;
  const on = alerts.notify || alerts.notifyLocked || alerts.autoDownload;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const Icon = on ? BellRing : Bell;
  return (
    <div ref={rootRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${
          on
            ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
        New chapters
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="New chapters"
          className="absolute left-0 top-11 z-30 w-[300px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl"
        >
          {ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--text-primary)]">{row.title}</div>
                <div className="text-[11.5px] text-[var(--text-secondary)]">{row.hint}</div>
              </div>
              <ToggleSwitch
                label={row.title}
                checked={alerts[row.key]}
                onChange={(v) =>
                  rpc("setNewChapterAlerts", { sourceId: book.sourceId, novelUrl: book.novelUrl, [row.key]: v })
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
