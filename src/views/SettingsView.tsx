import { Check, Monitor, Moon, Sun, WifiOff } from "lucide-react";
import type { ColorTheme, ReaderState, ThemeMode } from "../api/types";
import { rpc } from "../api/client";
import { HeaderBar } from "../components/HeaderBar";
import { ToggleSwitch } from "./HistoryView";

const PALETTES: { id: ColorTheme; label: string; dots: [string, string, string] }[] = [
  { id: "DEFAULT", label: "Default", dots: ["#a78bfa", "#c4b5fd", "#f472b6"] },
  { id: "GRIMOIRE", label: "Grimoire", dots: ["#5eead4", "#34d399", "#a7f3d0"] },
  { id: "OCEAN", label: "Ocean", dots: ["#60a5fa", "#38bdf8", "#a5b4fc"] },
  { id: "SUNSET", label: "Sunset", dots: ["#fb923c", "#f59e0b", "#fca5a5"] },
  { id: "FOREST", label: "Forest", dots: ["#4ade80", "#86efac", "#6ee7b7"] },
  { id: "ROSE", label: "Rose", dots: ["#f472b6", "#fda4af", "#fdba74"] },
  { id: "MIDNIGHT", label: "Midnight", dots: ["#818cf8", "#94a3b8", "#c084fc"] },
];

const THEME_MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "SYSTEM", label: "System", icon: Monitor },
  { id: "LIGHT", label: "Light", icon: Sun },
  { id: "DARK", label: "Dark", icon: Moon },
];

export function SettingsView({ state }: { state: ReaderState }) {
  const { appearance } = state;

  return (
    <div className="flex h-full flex-col">
      <HeaderBar
        left={
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]" data-tauri-drag-region>
            Settings
          </h1>
        }
      />

      <div className="flex-1 overflow-y-auto animate-view-enter">
        <div className="mx-auto max-w-[680px] px-6 py-6 flex flex-col gap-8">
          {/* Appearance */}
          <section>
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              Appearance
            </h2>

            <div className="mt-4">
              <div className="text-[13.5px] font-medium text-[var(--text-primary)]">Theme</div>
              <div className="mt-2 inline-flex rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-1">
                {THEME_MODES.map(({ id, label, icon: Icon }) => {
                  const active = appearance.themeMode === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => rpc("setThemeMode", { themeMode: id })}
                      className={`flex h-8 items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-colors duration-75 ${
                        active
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <Icon className={`h-3.5 w-3.5 ${active ? "text-[var(--accent)]" : ""}`} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                Color palette
              </div>
              <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                Pick the accent palette used across the app.
              </p>

              <div className="mt-3 grid grid-cols-4 gap-2.5 sm:grid-cols-7">
                {PALETTES.map((p) => {
                  const active = appearance.colorTheme === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => rpc("setColorTheme", { colorTheme: p.id })}
                      className={`flex flex-col items-center gap-2 rounded-xl border px-2 py-3 transition-all duration-100 ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border-hairline)] bg-[var(--bg-surface)]/60 hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div className="relative flex items-center -space-x-1.5">
                        {p.dots.map((hex, idx) => (
                          <span
                            key={idx}
                            className="h-4 w-4 rounded-full ring-1 ring-black/25"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                        {active && (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <Check className="h-3 w-3 stroke-[3] text-black/80" />
                          </span>
                        )}
                      </div>
                      <span className="text-[11.5px] font-medium text-[var(--text-primary)]">
                        {p.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Network */}
          <section className="border-t border-[var(--border-hairline)] pt-6">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              Network
            </h2>

            <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/60 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <WifiOff className="h-4 w-4 text-[var(--text-secondary)]" />
                <div>
                  <div className="text-[13.5px] font-medium text-[var(--text-primary)]">
                    Offline mode
                  </div>
                  <div className="text-[12px] text-[var(--text-secondary)]">
                    Disable source requests. Saved chapters and cached covers stay available.
                  </div>
                </div>
              </div>
              <ToggleSwitch
                checked={state.offline}
                onChange={(offline) => rpc("offline", { offline })}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
