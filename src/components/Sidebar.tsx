import {
  BookOpen,
  Compass,
  History,
  Puzzle,
  Settings,
  WifiOff,
  Library,
} from "lucide-react";
import type { ReaderState, ViewName } from "../api/types";

interface SidebarProps {
  state: ReaderState;
  activeSection: ViewName;
  onNavigate: (view: ViewName) => void;
  onGoOnline: () => void;
}

export function Sidebar({ state, activeSection, onNavigate, onGoOnline }: SidebarProps) {
  const installedCount = state.extensionRows.filter(
    (r) => r.status === "INSTALLED" || r.status === "UPDATE",
  ).length;

  return (
    <aside
      className="flex h-full w-[228px] shrink-0 flex-col border-r border-[var(--border-hairline)] bg-[var(--bg-sidebar)] px-3 pb-3"
    >
      {/* Brand header — native window drag region */}
      <div
        data-tauri-drag-region
        className="flex h-[52px] shrink-0 items-center gap-2.5 px-1.5"
      >
        <div
          data-tauri-drag-region
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"
        >
          <BookOpen className="h-4 w-4 stroke-[2]" />
        </div>
        <span
          data-tauri-drag-region
          className="text-[14px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]"
        >
          Grimoire
        </span>
      </div>

      {/* Primary reading sections */}
      <nav className="mt-1 flex flex-col gap-0.5">
        <SidebarItem
          icon={Library}
          label="Library"
          count={state.library.length}
          active={activeSection === "LIBRARY"}
          onClick={() => onNavigate("LIBRARY")}
        />
        <SidebarItem
          icon={Compass}
          label="Browse"
          active={activeSection === "BROWSE"}
          onClick={() => onNavigate("BROWSE")}
        />
        <SidebarItem
          icon={History}
          label="History"
          count={state.history.length}
          active={activeSection === "HISTORY"}
          onClick={() => onNavigate("HISTORY")}
        />
      </nav>

      <div className="flex-1" />

      {/* Offline status pill */}
      {state.offline && (
        <button
          type="button"
          onClick={onGoOnline}
          className="mb-2.5 flex w-full items-center gap-2 rounded-lg border border-[var(--warn)]/25 bg-[var(--warn-soft)] px-2.5 py-2 text-left text-[12px] font-medium text-[var(--warn)] transition-colors hover:brightness-110"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Offline</span>
          <span className="text-[11px] opacity-80">Go online</span>
        </button>
      )}

      {/* Footer sections */}
      <div className="border-t border-[var(--border-hairline)] pt-2.5 flex flex-col gap-0.5">
        <SidebarItem
          icon={Puzzle}
          label="Extensions"
          count={installedCount}
          active={activeSection === "EXTENSIONS"}
          onClick={() => onNavigate("EXTENSIONS")}
        />
        <SidebarItem
          icon={Settings}
          label="Settings"
          active={activeSection === "SETTINGS"}
          onClick={() => onNavigate("SETTINGS")}
        />
      </div>
    </aside>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: typeof Library;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors duration-75 ${
        active
          ? "bg-[var(--row-active)] font-medium text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon
        className={`h-[17px] w-[17px] shrink-0 stroke-[1.75] transition-colors ${
          active ? "text-[var(--accent)]" : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
        }`}
      />
      <span className="flex-1 truncate text-left">{label}</span>
      {typeof count === "number" && count > 0 && (
        <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
          {count}
        </span>
      )}
    </button>
  );
}
