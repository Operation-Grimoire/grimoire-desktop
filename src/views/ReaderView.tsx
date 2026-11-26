import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Check,
  Type,
  Minus,
  Plus,
} from "lucide-react";
import type {
  ReaderColorTheme,
  ReaderFont,
  ReaderState,
  ReaderTextAlign,
} from "../api/types";
import { coverUrl, rpc } from "../api/client";
import { WindowControls } from "../components/WindowControls";

const READER_THEMES: Record<
  ReaderColorTheme,
  { bg: string; fg: string; muted: string; border: string; barBg: string; controlTone: "light" | "dark" }
> = {
  LIGHT: {
    bg: "#ffffff",
    fg: "#18181b",
    muted: "#71717a",
    border: "rgba(0,0,0,0.08)",
    barBg: "rgba(255,255,255,0.86)",
    controlTone: "dark",
  },
  SEPIA: {
    bg: "#f7eedb",
    fg: "#3d2f22",
    muted: "#826b54",
    border: "rgba(61,47,34,0.12)",
    barBg: "rgba(247,238,219,0.88)",
    controlTone: "dark",
  },
  DARK: {
    bg: "#16161d",
    fg: "#d8dae6",
    muted: "#7e8094",
    border: "rgba(255,255,255,0.08)",
    barBg: "rgba(22,22,29,0.86)",
    controlTone: "light",
  },
  BLACK: {
    bg: "#000000",
    fg: "#cccccc",
    muted: "#707070",
    border: "rgba(255,255,255,0.1)",
    barBg: "rgba(0,0,0,0.88)",
    controlTone: "light",
  },
};

const FONT_FAMILIES: Record<ReaderFont, string> = {
  DEFAULT: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  SERIF: '"Newsreader", "Iowan Old Style", Georgia, "Times New Roman", serif',
  MONOSPACE: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
};

const ALIGN_MAP: Record<ReaderTextAlign, "start" | "left" | "right" | "center" | "justify"> = {
  AUTO: "start",
  LEFT: "left",
  RIGHT: "right",
  CENTER: "center",
  JUSTIFY: "justify",
};

export function ReaderView({
  state,
  coverBaseUrl,
  appDark,
}: {
  state: ReaderState;
  coverBaseUrl: string | null;
  appDark: boolean;
}) {
  const book = state.book;
  const chapter = state.chapter;
  const settings = state.readerSettings;
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredFor = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [chapterPercent, setChapterPercent] = useState(0);

  const effectiveTheme: ReaderColorTheme = settings.colorTheme ?? (appDark ? "DARK" : "LIGHT");
  const palette = READER_THEMES[effectiveTheme];

  const ordered = book?.chapters ?? [];
  const currentIdx = chapter ? ordered.findIndex((c) => c.url === chapter.url) : -1;
  const prevChapter = useMemo(() => {
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (!ordered[i].locked) return ordered[i];
    }
    return null;
  }, [ordered, currentIdx]);
  const nextChapter = useMemo(() => {
    for (let i = currentIdx + 1; i < ordered.length; i++) {
      if (!ordered[i].locked) return ordered[i];
    }
    return null;
  }, [ordered, currentIdx]);

  const saved = Boolean(chapter && ordered[currentIdx]?.downloaded);

  // Restore saved viewport once per chapter load.
  useEffect(() => {
    const key = chapter ? `${book?.novelUrl}:${chapter.url}` : null;
    if (!key || restoredFor.current === key) return;
    restoredFor.current = key;
    const container = scrollRef.current;
    if (!container) return;
    const vp = state.restoreViewport;
    requestAnimationFrame(() => {
      if (vp?.end) {
        container.scrollTop = container.scrollHeight;
      } else if (vp && vp.index > 0) {
        const el = container.querySelector<HTMLElement>(`[data-ordinal="${vp.index}"]`);
        if (el) container.scrollTop = Math.max(0, el.offsetTop - 72 + vp.offset);
      } else {
        container.scrollTop = 0;
      }
    });
  }, [book?.novelUrl, chapter, state.restoreViewport]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(1, el.scrollHeight - el.clientHeight);
    const pct = Math.min(100, Math.max(0, Math.round((el.scrollTop / maxScroll) * 100)));
    setChapterPercent(pct);

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const blocks = el.querySelectorAll<HTMLElement>("[data-ordinal]");
      const top = el.scrollTop + 72;
      let visibleOrdinal = 0;
      let offset = 0;
      for (const block of blocks) {
        if (block.offsetTop + block.offsetHeight >= top) {
          visibleOrdinal = Number(block.dataset.ordinal ?? 0);
          offset = Math.max(0, Math.round(top - block.offsetTop));
          break;
        }
      }
      rpc("position", { paragraph: visibleOrdinal, offset, userInitiated: true }).catch(() => {});
    }, 400);
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  if (!book || !chapter) return null;

  const bookPercent =
    ordered.length > 0 && currentIdx >= 0
      ? Math.round(((currentIdx + chapterPercent / 100) / ordered.length) * 100)
      : null;

  const progressLabel = [
    settings.showChapterPercent ? `${chapterPercent}%` : null,
    settings.showBookPercent && bookPercent != null ? `Book ${bookPercent}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const updateSettings = (patch: Record<string, unknown>) => {
    rpc("setReaderSettings", patch).catch(() => {});
  };

  return (
    <div
      className="relative flex h-full flex-col transition-colors duration-150"
      style={{ backgroundColor: palette.bg, color: palette.fg }}
    >
      {/* Floating reader top bar */}
      <header
        data-tauri-drag-region
        className="z-20 flex h-[52px] shrink-0 items-center gap-3 px-4 backdrop-blur-xl"
        style={{
          backgroundColor: palette.barBg,
          borderBottom: `1px solid ${palette.border}`,
        }}
      >
        <button
          type="button"
          aria-label="Back to book"
          onClick={() => rpc("back")}
          className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/10 dark:hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div data-tauri-drag-region className="min-w-0 flex-1">
          <div data-tauri-drag-region className="truncate text-[13.5px] font-medium">
            {chapter.name}
          </div>
          {progressLabel && (
            <div className="text-[11px] tabular-nums" style={{ color: palette.muted }}>
              {progressLabel}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={saved || state.busy}
            onClick={() => rpc("download")}
            title={saved ? "Saved offline" : "Save chapter offline"}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/10 disabled:opacity-55"
          >
            {saved ? <Check className="h-4 w-4 text-[var(--accent)]" /> : <Download className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            title="Reader typography & theme"
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
              showSettings ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "hover:bg-black/10"
            }`}
          >
            <Type className="h-3.5 w-3.5" />
            Aa
          </button>

          <WindowControls tone={palette.controlTone} />
        </div>
      </header>

      {/* Typography & theme popover */}
      {showSettings && (
        <div
          className="absolute right-5 top-[60px] z-30 w-[320px] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-4 text-[var(--text-primary)] shadow-2xl"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Theme
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {(["LIGHT", "SEPIA", "DARK", "BLACK"] as ReaderColorTheme[]).map((t) => {
              const th = READER_THEMES[t];
              const active = effectiveTheme === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => updateSettings({ colorTheme: t })}
                  className={`flex h-9 items-center justify-center rounded-lg border text-[11.5px] font-medium transition-transform active:scale-95 ${
                    active ? "ring-2 ring-[var(--accent)]" : ""
                  }`}
                  style={{ backgroundColor: th.bg, color: th.fg, borderColor: th.border }}
                >
                  {t[0] + t.slice(1).toLowerCase()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Typeface
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {(
              [
                ["DEFAULT", "Sans"],
                ["SERIF", "Serif"],
                ["MONOSPACE", "Mono"],
              ] as [ReaderFont, string][]
            ).map(([f, label]) => (
              <button
                key={f}
                type="button"
                onClick={() => updateSettings({ font: f })}
                className={`h-8 rounded-lg border text-[12px] font-medium transition-colors ${
                  settings.font === f
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <Stepper
              label="Font size"
              value={`${settings.fontSize}px`}
              onDec={() => updateSettings({ fontSize: Math.max(12, settings.fontSize - 1) })}
              onInc={() => updateSettings({ fontSize: Math.min(32, settings.fontSize + 1) })}
            />
            <Stepper
              label="Line height"
              value={(settings.lineHeightTimes10 / 10).toFixed(1)}
              onDec={() =>
                updateSettings({ lineHeightTimes10: Math.max(11, settings.lineHeightTimes10 - 1) })
              }
              onInc={() =>
                updateSettings({ lineHeightTimes10: Math.min(26, settings.lineHeightTimes10 + 1) })
              }
            />
            <Stepper
              label="Paragraph gap"
              value={`${settings.paragraphSpacing}px`}
              onDec={() =>
                updateSettings({ paragraphSpacing: Math.max(4, settings.paragraphSpacing - 2) })
              }
              onInc={() =>
                updateSettings({ paragraphSpacing: Math.min(32, settings.paragraphSpacing + 2) })
              }
            />
          </div>
        </div>
      )}

      {/* Reading surface */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={() => showSettings && setShowSettings(false)}
        className="flex-1 overflow-y-auto px-6 py-10"
      >
        <article
          className="reader-prose mx-auto max-w-[700px]"
          style={{
            fontFamily: FONT_FAMILIES[settings.font],
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeightTimes10 / 10,
            textAlign: ALIGN_MAP[settings.textAlign],
          }}
        >
          <h1 className="mb-8 text-[1.65em] font-semibold leading-tight tracking-[-0.02em]">
            {chapter.name}
          </h1>

          <div className="flex flex-col" style={{ gap: `${settings.paragraphSpacing}px` }}>
            {state.pages.map((page) => {
              if (page.kind === "separator") {
                return (
                  <hr
                    key={page.ordinal}
                    data-ordinal={page.ordinal}
                    className="my-4 border-0 border-t"
                    style={{ borderColor: palette.border }}
                  />
                );
              }
              if (page.kind === "image") {
                const src = coverUrl(coverBaseUrl, page.url);
                return (
                  <div key={page.ordinal} data-ordinal={page.ordinal} className="my-2 flex justify-center">
                    {src && (
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        className="max-h-[70vh] rounded-lg object-contain"
                      />
                    )}
                  </div>
                );
              }
              return (
                <p key={page.ordinal} data-ordinal={page.ordinal} className="whitespace-pre-line">
                  {page.text}
                </p>
              );
            })}
          </div>

          {/* Chapter footer nav */}
          <div
            className="mt-14 flex items-center justify-between gap-4 border-t pt-6 pb-8"
            style={{ borderColor: palette.border }}
          >
            <button
              type="button"
              disabled={!prevChapter || state.busy}
              onClick={() => rpc("readPrevious")}
              className="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-opacity hover:opacity-80 disabled:opacity-30"
              style={{ borderColor: palette.border }}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <button
              type="button"
              disabled={!nextChapter || state.busy}
              onClick={() => rpc("readNext")}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--accent)] px-5 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              Next chapter
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12.5px] text-[var(--text-secondary)]">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDec}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="w-11 text-center text-[12.5px] tabular-nums font-medium">{value}</span>
        <button
          type="button"
          onClick={onInc}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
