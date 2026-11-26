import { useEffect, useState } from "react";
import { AlertCircle, BookOpen, X } from "lucide-react";
import type { ReaderState, ViewName } from "./api/types";
import { getInitialState, rpc, subscribeDaemon } from "./api/client";
import { Sidebar } from "./components/Sidebar";
import { LibraryView } from "./views/LibraryView";
import { BrowseView } from "./views/BrowseView";
import { BookDetailView } from "./views/BookDetailView";
import { ReaderView } from "./views/ReaderView";
import { HistoryView } from "./views/HistoryView";
import { ExtensionsView } from "./views/ExtensionsView";
import { SettingsView } from "./views/SettingsView";

export default function App() {
  const [state, setState] = useState<ReaderState | null>(null);
  const [coverBaseUrl, setCoverBaseUrl] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [showBusyBar, setShowBusyBar] = useState(false);
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  // Track OS dark mode changes.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Connect to the JVM sidecar through Tauri IPC.
  useEffect(() => {
    let active = true;
    const unsubPromise = subscribeDaemon(
      (info) => {
        if (active) setCoverBaseUrl(info.coverBaseUrl);
      },
      (nextState) => {
        if (active) setState(nextState);
      },
    );

    getInitialState()
      .then((snap) => {
        if (!active) return;
        if (snap.coverBaseUrl) setCoverBaseUrl(snap.coverBaseUrl);
        if (snap.state) setState(snap.state);
        if (snap.startupError) setStartupError(snap.startupError);
      })
      .catch((err) => {
        if (active) setStartupError(String(err));
      });

    return () => {
      active = false;
      unsubPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const resolvedDark =
    state?.appearance.themeMode === "DARK"
      ? true
      : state?.appearance.themeMode === "LIGHT"
        ? false
        : systemDark;

  // Apply theme & palette CSS variables immediately.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedDark ? "dark" : "light";
    root.dataset.palette = state?.appearance.colorTheme ?? "DEFAULT";
  }, [resolvedDark, state?.appearance.colorTheme]);

  // Debounce top loading bar so sub-180ms actions never flicker.
  useEffect(() => {
    if (!state?.busy) {
      setShowBusyBar(false);
      return;
    }
    const id = window.setTimeout(() => setShowBusyBar(true), 180);
    return () => window.clearTimeout(id);
  }, [state?.busy]);

  // Desktop keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (typing || !state) return;

      if (e.key === "Escape" && (state.view === "BOOK" || state.view === "READER")) {
        e.preventDefault();
        rpc("back");
      } else if (e.key === "ArrowLeft" && state.view === "READER") {
        e.preventDefault();
        rpc("readPrevious");
      } else if (e.key === "ArrowRight" && state.view === "READER") {
        e.preventDefault();
        rpc("readNext");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state]);

  if (startupError) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--bg-canvas)] p-8 text-center">
        <AlertCircle className="h-8 w-8 text-[var(--danger)]" />
        <h1 className="mt-3 text-[16px] font-semibold">Could not start Grimoire engine</h1>
        <p className="mt-1.5 max-w-[460px] text-[13px] text-[var(--text-secondary)]">
          {startupError}
        </p>
      </div>
    );
  }

  if (!state) {
    return (
      <div
        data-tauri-drag-region
        className="flex h-full flex-col items-center justify-center bg-[var(--bg-canvas)] text-[var(--text-secondary)]"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="mt-3 text-[13px] font-medium">Starting Grimoire…</div>
      </div>
    );
  }

  const navigate = (view: ViewName) => {
    switch (view) {
      case "LIBRARY":
        rpc("showLibrary");
        break;
      case "BROWSE":
        rpc("showBrowse");
        break;
      case "HISTORY":
        rpc("showHistory");
        break;
      case "EXTENSIONS":
        rpc("showExtensions");
        break;
      case "SETTINGS":
        rpc("showSettings");
        break;
    }
  };

  const activeSection: ViewName =
    state.view === "BOOK" || state.view === "READER" ? state.bookOrigin : state.view;

  const activeError = state.error && state.error !== dismissedError ? state.error : null;

  return (
    <div className="relative flex h-full w-full overflow-hidden border border-[var(--border-hairline)] bg-[var(--bg-canvas)]">
      {/* Subtle debounced loading hairline */}
      {showBusyBar && (
        <div className="pointer-events-none fixed left-0 right-0 top-0 z-50 h-[2px] overflow-hidden bg-transparent">
          <div className="h-full w-1/3 animate-pulse bg-[var(--accent)]" />
        </div>
      )}

      {state.view === "READER" ? (
        <main className="h-full w-full">
          <ReaderView state={state} coverBaseUrl={coverBaseUrl} appDark={resolvedDark} />
        </main>
      ) : (
        <>
          <Sidebar
            state={state}
            activeSection={activeSection}
            onNavigate={navigate}
            onGoOnline={() => rpc("offline", { offline: false })}
          />
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
            {state.view === "LIBRARY" && (
              <LibraryView state={state} coverBaseUrl={coverBaseUrl} />
            )}
            {state.view === "BROWSE" && (
              <BrowseView state={state} coverBaseUrl={coverBaseUrl} />
            )}
            {state.view === "BOOK" && (
              <BookDetailView state={state} coverBaseUrl={coverBaseUrl} />
            )}
            {state.view === "HISTORY" && (
              <HistoryView state={state} coverBaseUrl={coverBaseUrl} />
            )}
            {state.view === "EXTENSIONS" && <ExtensionsView state={state} />}
            {state.view === "SETTINGS" && <SettingsView state={state} />}
          </main>
        </>
      )}

      {/* Floating dismissible error toast */}
      {activeError && (
        <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[520px] -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--danger)]/35 bg-[var(--bg-elevated)] px-4 py-2.5 text-[13px] text-[var(--text-primary)] shadow-2xl">
          <AlertCircle className="h-4 w-4 shrink-0 text-[var(--danger)]" />
          <span className="flex-1">{activeError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setDismissedError(activeError)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
