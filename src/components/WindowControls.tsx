import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";

export function WindowControls({ tone }: { tone?: "default" | "light" | "dark" }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const win = getCurrentWindow();
  const baseColor =
    tone === "light"
      ? "text-white/75 hover:text-white hover:bg-white/10"
      : tone === "dark"
        ? "text-black/65 hover:text-black hover:bg-black/8"
        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--row-hover)]";

  return (
    <div className="flex items-center gap-0.5 pl-1" data-tauri-drag-region="false">
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => win.minimize()}
        className={`flex h-7 w-8 items-center justify-center rounded-md transition-colors duration-75 ${baseColor}`}
      >
        <Minus className="h-3.5 w-3.5 stroke-[1.75]" />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => win.toggleMaximize()}
        className={`flex h-7 w-8 items-center justify-center rounded-md transition-colors duration-75 ${baseColor}`}
      >
        {maximized ? (
          <Copy className="h-3 w-3 stroke-[1.75] -scale-x-100" />
        ) : (
          <Square className="h-3 w-3 stroke-[1.75]" />
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={() => win.close()}
        className={`flex h-7 w-8 items-center justify-center rounded-md transition-colors duration-75 ${
          tone === "light"
            ? "text-white/75 hover:bg-red-500/85 hover:text-white"
            : tone === "dark"
              ? "text-black/65 hover:bg-red-500 hover:text-white"
              : "text-[var(--text-secondary)] hover:bg-red-500/85 hover:text-white"
        }`}
      >
        <X className="h-3.5 w-3.5 stroke-[1.75]" />
      </button>
    </div>
  );
}
