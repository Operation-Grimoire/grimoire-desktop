import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WindowControls } from "./WindowControls";

interface HeaderBarProps {
  left?: ReactNode;
  right?: ReactNode;
  tone?: "default" | "light" | "dark";
  transparent?: boolean;
}

export function HeaderBar({ left, right, tone = "default", transparent = false }: HeaderBarProps) {
  return (
    <header
      data-tauri-drag-region
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, input, select, a")) return;
        getCurrentWindow().toggleMaximize().catch(() => {});
      }}
      className={`sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-3 px-5 ${
        transparent
          ? "bg-transparent"
          : "border-b border-[var(--border-hairline)] bg-[var(--header-glass)] backdrop-blur-xl"
      }`}
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2.5">
        {left}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        <WindowControls tone={tone} />
      </div>
    </header>
  );
}
