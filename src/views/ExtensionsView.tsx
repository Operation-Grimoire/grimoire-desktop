import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Database,
  FolderOpen,
  Info,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import type { ExtensionRow, ReaderState } from "../api/types";
import { rpc } from "../api/client";
import { HeaderBar } from "../components/HeaderBar";
import { SearchPill } from "../components/SearchPill";
import { ToggleSwitch } from "./HistoryView";

const INSTALLED_STATUSES = new Set(["INSTALLED", "UPDATE", "UNAVAILABLE"]);

export function ExtensionsView({ state }: { state: ReaderState }) {
  const [query, setQuery] = useState("");
  const [showRepos, setShowRepos] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoKey, setRepoKey] = useState("");

  const installed = useMemo(
    () => state.extensionRows.filter((r) => INSTALLED_STATUSES.has(r.status)),
    [state.extensionRows],
  );
  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.extensionRows
      .filter((r) => !INSTALLED_STATUSES.has(r.status))
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.lang.toLowerCase() === q ||
          r.pkg.toLowerCase().includes(q),
      );
  }, [state.extensionRows, query]);

  const pickLocalExtension = async () => {
    const selected = await open({
      title: "Open local extension manifest",
      multiple: false,
      filters: [{ name: "Extension Manifest", extensions: ["properties"] }],
    });
    if (typeof selected === "string" && selected) {
      rpc("loadLocalExtension", { manifestPath: selected });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <HeaderBar
        left={
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]" data-tauri-drag-region>
            Extensions
          </h1>
        }
        right={
          <div className="flex items-center gap-2">
            <SearchPill
              value={query}
              onChange={setQuery}
              placeholder="Search extensions…"
              className="w-[210px]"
            />
            <button
              type="button"
              title="Refresh repositories"
              disabled={state.offline || state.busy}
              onClick={() => rpc("refreshRepositories")}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${state.busy ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              title="Repositories"
              onClick={() => setShowRepos(true)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <Database className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto animate-view-enter">
        <div className="mx-auto max-w-[820px] px-6 py-5 flex flex-col gap-6">
          {state.extensionNotice && (
            <div className="flex items-center gap-2.5 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-4 py-2.5 text-[13px] text-[var(--text-primary)]">
              <Info className="h-4 w-4 shrink-0 text-[var(--accent)]" />
              <span className="whitespace-pre-line">{state.extensionNotice}</span>
            </div>
          )}

          {state.offline && (
            <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-4 py-2.5 text-[12.5px] text-[var(--text-secondary)]">
              <WifiOff className="h-4 w-4 shrink-0" />
              Go online to refresh repositories and install extensions. Installed extensions still work.
            </div>
          )}

          {/* Installed */}
          <section>
            <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Installed {installed.length > 0 ? `(${installed.length})` : ""}
            </h2>
            {installed.length === 0 ? (
              <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45 px-4 py-5 text-[13px] text-[var(--text-secondary)]">
                No extensions installed yet. Install one from the catalog below.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45">
                {installed.map((row) => (
                  <ExtensionRowCard key={row.pkg} row={row} offline={state.offline} busy={state.busy} />
                ))}
              </div>
            )}
          </section>

          {/* Available */}
          <section>
            <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Available {available.length > 0 ? `(${available.length})` : ""}
            </h2>
            {available.length === 0 ? (
              <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45 px-4 py-5 text-[13px] text-[var(--text-secondary)]">
                {query.trim()
                  ? `No extensions match "${query.trim()}".`
                  : "No other extensions available."}
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45">
                {available.map((row) => (
                  <ExtensionRowCard
                    key={`${row.repository}:${row.pkg}`}
                    row={row}
                    offline={state.offline}
                    busy={state.busy}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Local developer extension */}
          <section>
            <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Local extension
            </h2>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45 px-4 py-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                  <Puzzle className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium text-[var(--text-primary)]">
                    {state.localExtension ?? "No local extension open"}
                  </div>
                  <div className="text-[12px] text-[var(--text-secondary)]">
                    For development: load a trusted local manifest for this session only.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={pickLocalExtension}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3.5 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Open manifest
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Repositories modal */}
      {showRepos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs">
          <div className="flex max-h-[80vh] w-[520px] flex-col rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3.5">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Extension repositories
              </h3>
              <button
                type="button"
                onClick={() => setShowRepos(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              {state.pendingRepository && (
                <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                    <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
                    Confirm repository trust
                  </div>
                  <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                    {state.pendingRepository.id} · {state.pendingRepository.extensionCount} extensions
                  </p>
                  <code className="mt-2 block break-all rounded-lg bg-black/25 px-2.5 py-1.5 text-[11px] text-[var(--text-primary)]">
                    {state.pendingRepository.fingerprint}
                  </code>
                  {state.pendingRepository.warning && (
                    <p className="mt-2 text-[12px] text-[var(--warn)]">
                      {state.pendingRepository.warning}
                    </p>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => rpc("cancelRepository")}
                      className="h-8 rounded-full border border-[var(--border-strong)] px-3.5 text-[12px]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => rpc("confirmRepository")}
                      className="h-8 rounded-full bg-[var(--accent)] px-4 text-[12px] font-medium text-[var(--accent-fg)]"
                    >
                      Trust & add
                    </button>
                  </div>
                </div>
              )}

              <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/50">
                {state.repositories.map((repo) => (
                  <div key={repo.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                          {repo.id}
                        </span>
                        {repo.builtin && (
                          <span className="rounded bg-[var(--row-active)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                            Official
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11.5px] text-[var(--text-muted)]">
                        {repo.indexUrl}
                      </div>
                      {repo.problem && (
                        <div className="mt-1 text-[11.5px] text-[var(--danger)]">{repo.problem}</div>
                      )}
                    </div>
                    <ToggleSwitch
                      label={`Enable repository ${repo.id}`}
                      checked={repo.enabled}
                      onChange={(enabled) =>
                        rpc("setRepositoryEnabled", { repository: repo.id, enabled })
                      }
                    />
                    {!repo.builtin && (
                      <button
                        type="button"
                        aria-label="Remove repository"
                        onClick={() => rpc("removeRepository", { repository: repo.id })}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/40 p-3.5">
                <div className="text-[12.5px] font-medium text-[var(--text-primary)]">
                  Add custom repository
                </div>
                <div className="mt-2.5 flex flex-col gap-2">
                  <input
                    type="url"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://…/index.json"
                    className="h-8 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-[12.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={repoKey}
                    onChange={(e) => setRepoKey(e.target.value)}
                    placeholder="Ed25519 public key (base64)"
                    className="h-8 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-canvas)] px-3 text-[12.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={state.offline || !repoUrl.trim() || !repoKey.trim() || state.busy}
                      onClick={() => {
                        rpc("checkRepository", {
                          indexUrl: repoUrl.trim(),
                          publicKey: repoKey.trim(),
                        });
                      }}
                      className="h-8 rounded-full bg-[var(--accent)] px-4 text-[12px] font-medium text-[var(--accent-fg)] disabled:opacity-40"
                    >
                      Verify repository
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExtensionRowCard({
  row,
  offline,
  busy,
}: {
  row: ExtensionRow;
  offline: boolean;
  busy: boolean;
}) {
  const version =
    row.status === "UPDATE"
      ? `${row.installedVersion} → ${row.availableVersion}`
      : (row.installedVersion ?? row.availableVersion ?? "");

  return (
    <div className="flex items-center gap-3.5 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[11px] font-semibold uppercase text-[var(--text-secondary)]">
        {row.lang}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-[var(--text-primary)]">
          {row.name}
        </div>
        <div className="truncate text-[12px] text-[var(--text-secondary)]">
          {version ? `${version} · ` : ""}
          {row.pkg}
        </div>
        {row.reason && (
          <div className="mt-0.5 text-[11.5px] text-[var(--warn)]">{row.reason}</div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {(row.status === "AVAILABLE" || row.status === "UPDATE") && (
          <button
            type="button"
            disabled={offline || busy}
            onClick={() => rpc("installExtension", { repository: row.repository, pkg: row.pkg })}
            className="h-8 rounded-full bg-[var(--accent)] px-3.5 text-[12px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {row.status === "UPDATE" ? "Update" : "Install"}
          </button>
        )}
        {INSTALLED_STATUSES.has(row.status) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => rpc("removeExtension", { pkg: row.pkg })}
            className="h-8 rounded-full border border-[var(--border-hairline)] px-3.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--danger)]/40 hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
