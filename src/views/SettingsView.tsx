import type { ReactNode } from "react";
import { Check, Monitor, Moon, RefreshCw, Sun, WifiOff } from "lucide-react";
import type { ColorTheme, LibraryUpdateSettings, ReaderState, ThemeMode } from "../api/types";
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

const INTERVALS: { hours: number; label: string }[] = [
  { hours: 1, label: "Every hour" },
  { hours: 3, label: "Every 3 hours" },
  { hours: 6, label: "Every 6 hours" },
  { hours: 12, label: "Every 12 hours" },
  { hours: 24, label: "Daily" },
  { hours: 48, label: "Every 2 days" },
  { hours: 168, label: "Weekly" },
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

          {/* Library updates */}
          <LibraryUpdatesSection state={state} />

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

function LibraryUpdatesSection({ state }: { state: ReaderState }) {
  const settings = state.libraryUpdateSettings;
  const save = (change: Partial<LibraryUpdateSettings>) => rpc("setLibraryUpdateSettings", change);
  const intervals = INTERVALS.some((i) => i.hours === settings.intervalHours)
    ? INTERVALS
    : [...INTERVALS, { hours: settings.intervalHours, label: `Every ${settings.intervalHours} hours` }];

  return (
    <section className="border-t border-[var(--border-hairline)] pt-6">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--accent)]">
        Library updates
      </h2>
      <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
        Checks run only while Grimoire is open.
      </p>

      <div className="mt-3 divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/60">
        <SettingRow title="Check on launch" subtitle="Update the library a few seconds after Grimoire starts.">
          <ToggleSwitch checked={settings.updateOnLaunch} onChange={(v) => save({ updateOnLaunch: v })} />
        </SettingRow>
        <SettingRow title="Automatic updates" subtitle="Update the library again on a schedule.">
          <ToggleSwitch checked={settings.autoUpdate} onChange={(v) => save({ autoUpdate: v })} />
        </SettingRow>
        {settings.autoUpdate && (
          <SettingRow title="Frequency" subtitle="Time since the last finished update.">
            <select
              value={settings.intervalHours}
              onChange={(e) => save({ intervalHours: Number(e.target.value) })}
              className="h-8 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-2 text-[12.5px] text-[var(--text-primary)]"
            >
              {intervals.map((i) => (
                <option key={i.hours} value={i.hours}>
                  {i.label}
                </option>
              ))}
            </select>
          </SettingRow>
        )}
        <SettingRow title="Skip completed novels" subtitle="Novels marked completed are not checked.">
          <ToggleSwitch checked={settings.skipCompleted} onChange={(v) => save({ skipCompleted: v })} />
        </SettingRow>
        <SettingRow
          title="Parallel checks"
          subtitle="Novels checked at once. Each source still gets one request at a time."
        >
          <div className="inline-flex items-center gap-1">
            {[1, 2, 4, 6, 8].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => save({ concurrency: n })}
                className={`h-7 w-7 rounded-lg text-[12px] font-medium tabular-nums transition-colors ${
                  settings.concurrency === n
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>

      {state.lastLibraryUpdate && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <RefreshCw className="h-3 w-3" />
          Last update {new Date(state.lastLibraryUpdate.finishedAt).toLocaleString()} ·{" "}
          {state.lastLibraryUpdate.newChapters} new
          {state.lastLibraryUpdate.errors > 0 ? ` · ${state.lastLibraryUpdate.errors} failed` : ""}
          {state.lastLibraryUpdate.failed ? " · failed" : state.lastLibraryUpdate.cancelled ? " · cancelled" : ""}
        </div>
      )}
    </section>
  );
}

function SettingRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-[var(--text-primary)]">{title}</div>
        <div className="text-[12px] text-[var(--text-secondary)]">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}
