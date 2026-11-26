import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ArchiveRestore, DatabaseBackup } from "lucide-react";
import type { ReaderState } from "../api/types";
import { rpc } from "../api/client";
import { ConfirmDialog } from "./ConfirmDialog";

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
