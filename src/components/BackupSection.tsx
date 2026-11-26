import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ArchiveRestore, CircleAlert, DatabaseBackup, FolderOpen, Loader2, ShieldCheck } from "lucide-react";
import type { AutoBackupSettings, ReaderState } from "../api/types";
import { rpc } from "../api/client";
import { ConfirmDialog } from "./ConfirmDialog";
import { SettingRow } from "./SettingRow";
import { ToggleSwitch } from "../views/HistoryView";

const AUTO_INTERVALS: { hours: number; label: string }[] = [
  { hours: 6, label: "Every 6 hours" },
  { hours: 12, label: "Every 12 hours" },
  { hours: 24, label: "Daily" },
  { hours: 72, label: "Every 3 days" },
  { hours: 168, label: "Weekly" },
];

const BACKUP_FILTERS = [{ name: "Grimoire backup", extensions: ["gz", "json"] }];

function defaultName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `grimoire_backup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json.gz`
  );
}

/** Android-compatible backup file: create one, or restore one from either app. */
export function BackupSection({ state }: { state: ReaderState }) {
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);

  const createBackup = async () => {
    const path = await save({ defaultPath: defaultName(), filters: BACKUP_FILTERS });
    if (path) rpc("createBackup", { path });
  };

  const chooseRestore = async () => {
    const path = await open({ multiple: false, directory: false, filters: BACKUP_FILTERS });
    if (typeof path === "string") setPendingRestore(path);
  };

  return (
    <section className="border-t border-[var(--border-hairline)] pt-6">
      <h2 className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--accent)]">
        Backup &amp; restore
      </h2>
      <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
        Library, categories, ratings, overrides and read chapters. Backups work with Grimoire on Android too.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={state.busy}
          onClick={createBackup}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <DatabaseBackup className="h-4 w-4" />
          Create backup…
        </button>
        <button
          type="button"
          disabled={state.busy}
          onClick={chooseRestore}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--row-hover)] disabled:opacity-50"
        >
          <ArchiveRestore className="h-4 w-4" />
          Restore backup…
        </button>
      </div>

      {state.backupNotice && (
        <div
          role="status"
          className="mt-3 whitespace-pre-line rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/60 px-4 py-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]"
        >
          {state.backupNotice}
        </div>
      )}

      <AutomaticBackups state={state} />

      {pendingRestore && (
        <ConfirmDialog
          title="Restore this backup?"
          message="Novels, categories and read chapters from the backup are added to this library. Nothing here is removed or marked unread."
          confirmLabel="Restore"
          tone="accent"
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => {
            const path = pendingRestore;
            setPendingRestore(null);
            rpc("restoreBackup", { path });
          }}
        />
      )}
    </section>
  );
}

/** Backs up into a chosen folder on a schedule while the app is open, keeping the newest seven. */
function AutomaticBackups({ state }: { state: ReaderState }) {
  const settings = state.autoBackup;
  const last = state.lastAutoBackup;
  const save = (change: Partial<Omit<AutoBackupSettings, "nextAt">>) => rpc("setAutoBackupSettings", change);
  const intervals = AUTO_INTERVALS.some((i) => i.hours === settings.intervalHours)
    ? AUTO_INTERVALS
    : [...AUTO_INTERVALS, { hours: settings.intervalHours, label: `Every ${settings.intervalHours} hours` }];

  const chooseFolder = async (): Promise<string | null> => {
    const folder = await open({ directory: true, multiple: false, defaultPath: settings.folder || undefined });
    return typeof folder === "string" ? folder : null;
  };

  const toggle = async (enabled: boolean) => {
    if (enabled && !settings.folder) {
      const folder = await chooseFolder();
      if (folder) save({ enabled: true, folder });
      return;
    }
    save({ enabled });
  };

  return (
    <div className="mt-5">
      <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Automatic backups</h3>
      <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
        Runs while Grimoire is open; a missed backup runs at the next launch. The newest 7 automatic backups are kept.
      </p>
      <div className="mt-3 divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/60">
        <SettingRow title="Back up automatically" subtitle="Write a backup to the folder below on a schedule.">
          <ToggleSwitch label="Back up automatically" checked={settings.enabled} onChange={toggle} />
        </SettingRow>
        <SettingRow
          title="Folder"
          subtitle={
            settings.folder ? (
              <span className="block truncate" title={settings.folder}>
                {settings.folder}
              </span>
            ) : (
              "No folder chosen"
            )
          }
        >
          <button
            type="button"
            onClick={async () => {
              const folder = await chooseFolder();
              if (folder) save({ folder });
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] px-3 text-[12.5px] text-[var(--text-primary)] transition-colors hover:bg-[var(--row-hover)]"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {settings.folder ? "Change…" : "Choose…"}
          </button>
        </SettingRow>
        {settings.enabled && (
          <SettingRow title="Frequency" subtitle="Counted from the last automatic backup. A failed one tries again within the hour.">
            <select
              aria-label="Automatic backup frequency"
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
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-[var(--text-muted)]">
        <button
          type="button"
          disabled={!settings.folder || state.autoBackupRunning}
          onClick={() => rpc("backUpNow")}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-hairline)] px-3 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--row-hover)] disabled:opacity-50"
        >
          {state.autoBackupRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseBackup className="h-3.5 w-3.5" />}
          {state.autoBackupRunning ? "Backing up…" : "Back up now"}
        </button>
        {last && (
          <span
            role="status"
            className={`inline-flex min-w-0 items-center gap-1.5 ${last.success ? "" : "text-[var(--danger)]"}`}
          >
            {last.success ? <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> : <CircleAlert className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate" title={last.fileName ?? undefined}>
              {new Date(last.at).toLocaleString()} · {last.message}
            </span>
          </span>
        )}
        {settings.enabled && settings.nextAt != null && settings.nextAt > Date.now() && (
          <span>Next {new Date(settings.nextAt).toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}
