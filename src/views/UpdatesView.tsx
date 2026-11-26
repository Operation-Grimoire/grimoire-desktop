import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BellDot,
  BookOpen,
  Check,
  CheckCheck,
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { ReaderState, UpdateEntry, UpdateIssue } from "../api/types";
import { coverUrl, rpc } from "../api/client";
import { HeaderBar } from "../components/HeaderBar";
import { EmptyState } from "../components/EmptyState";
import { LibraryUpdateButton } from "../components/LibraryUpdateButton";
import { ConfirmDialog } from "../components/ConfirmDialog";

type Tab = "UPDATES" | "ISSUES";

interface NovelGroup {
  key: string;
  sourceId: number;
  novelUrl: string;
  novelTitle: string;
  thumbnailUrl: string | null;
  entries: UpdateEntry[];
}

function dayLabel(millis: number, today: number, yesterday: number): string {
  const d = new Date(millis);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() === today) return "Today";
  if (d.getTime() === yesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relativeTime(millis: number): string {
  const diff = Date.now() - millis;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(millis).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function UpdatesView({
  state,
  coverBaseUrl,
}: {
  state: ReaderState;
  coverBaseUrl: string | null;
}) {
  const [tab, setTab] = useState<Tab>("UPDATES");
  const [confirmClear, setConfirmClear] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Fall back to the feed once every issue is resolved.
  useEffect(() => {
    if (tab === "ISSUES" && state.updateIssues.length === 0) setTab("UPDATES");
  }, [tab, state.updateIssues.length]);

  const visible = useMemo(
    () => (unreadOnly ? state.updates.filter((u) => !u.read) : state.updates),
    [state.updates, unreadOnly],
  );

  // Day → consecutive runs of the same novel, so a burst of chapters reads as one block.
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const out: { label: string; groups: NovelGroup[] }[] = [];
    for (const entry of visible) {
      const label = dayLabel(entry.foundAt, today.getTime(), yesterday.getTime());
      let day = out[out.length - 1];
      if (!day || day.label !== label) {
        day = { label, groups: [] };
        out.push(day);
      }
      const key = `${entry.sourceId}:${entry.novelUrl}`;
      let group = day.groups.find((g) => g.key === key);
      if (!group) {
        group = {
          key,
          sourceId: entry.sourceId,
          novelUrl: entry.novelUrl,
          novelTitle: entry.novelTitle,
          thumbnailUrl: entry.thumbnailUrl,
          entries: [],
        };
        day.groups.push(group);
      }
      group.entries.push(entry);
    }
    return out;
  }, [visible]);

  const unreadIds = useMemo(
    () => state.updates.filter((u) => !u.read && !u.locked).map((u) => u.id),
    [state.updates],
  );
  const errorCount = state.updateIssues.filter((i) => i.severity === "ERROR").length;
  const last = state.lastLibraryUpdate;

  return (
    <div className="flex h-full flex-col">
      <HeaderBar
        left={
          <div className="flex items-center gap-1" data-tauri-drag-region>
            <TabButton active={tab === "UPDATES"} onClick={() => setTab("UPDATES")}>
              Updates
              {unreadIds.length > 0 && <Count>{unreadIds.length}</Count>}
            </TabButton>
            {state.updateIssues.length > 0 && (
              <TabButton active={tab === "ISSUES"} onClick={() => setTab("ISSUES")}>
                Issues
                <Count tone={errorCount > 0 ? "danger" : "warn"}>{state.updateIssues.length}</Count>
              </TabButton>
            )}
          </div>
        }
        right={
          <div className="flex items-center gap-1.5">
            {tab === "UPDATES" && state.updates.length > 0 && (
              <>
                <IconButton
                  title={unreadOnly ? "Show all updates" : "Show unread only"}
                  active={unreadOnly}
                  onClick={() => setUnreadOnly((v) => !v)}
                >
                  {unreadOnly ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </IconButton>
                <IconButton
                  title="Mark all as read"
                  disabled={unreadIds.length === 0}
                  onClick={() => rpc("markUpdatesRead", { ids: unreadIds, read: true })}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton title="Clear updates" danger onClick={() => setConfirmClear(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </>
            )}
            {tab === "ISSUES" && (
              <IconButton title="Dismiss all issues" danger onClick={() => rpc("clearUpdateIssues")}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            )}
            <LibraryUpdateButton state={state} />
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto animate-view-enter">
        <div className="mx-auto max-w-[820px] px-6 py-5">
          {last && !state.libraryUpdate && (
            <LastRunLine
              summary={last}
              onShowIssues={state.updateIssues.length > 0 ? () => setTab("ISSUES") : undefined}
            />
          )}

          {tab === "UPDATES" ? (
            days.length === 0 ? (
              <EmptyState
                icon={BellDot}
                title={unreadOnly && state.updates.length > 0 ? "All caught up" : "No new chapters yet"}
                subtitle={
                  state.library.length === 0
                    ? "Add novels to your library and new chapters will appear here."
                    : "Update your library to check sources for new chapters."
                }
                actionLabel={
                  state.library.length > 0 && !state.libraryUpdate && !state.offline ? "Update library" : undefined
                }
                onAction={() => rpc("updateLibrary", { categoryId: null })}
              />
            ) : (
              <div className="flex flex-col gap-6">
                {days.map((day) => (
                  <section key={day.label}>
                    <h2 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      {day.label}
                    </h2>
                    <div className="flex flex-col gap-2.5">
                      {day.groups.map((group) => (
                        <NovelBlock
                          key={group.key}
                          group={group}
                          coverBaseUrl={coverBaseUrl}
                          busy={state.busy}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          ) : (
            <IssuesList issues={state.updateIssues} offline={state.offline} />
          )}
        </div>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="Clear updates?"
          message="This empties the list. Chapters, read state and downloads stay as they are."
          confirmLabel="Clear"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            rpc("clearUpdates");
          }}
        />
      )}
    </div>
  );
}

function NovelBlock({
  group,
  coverBaseUrl,
  busy,
}: {
  group: NovelGroup;
  coverBaseUrl: string | null;
  busy: boolean;
}) {
  const img = coverUrl(coverBaseUrl, group.thumbnailUrl);
  const unread = group.entries.filter((e) => !e.read && !e.locked).map((e) => e.id);
  const downloadable = group.entries.filter((e) => !e.downloaded && !e.locked).map((e) => e.id);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45">
      <div className="group/header flex items-center gap-3 px-3.5 pb-1.5 pt-3">
        <button
          type="button"
          onClick={() => rpc("openSaved", { sourceId: group.sourceId, novelUrl: group.novelUrl, origin: "UPDATES" })}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
            {img ? (
              <img src={img} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                <BookOpen className="h-3.5 w-3.5 opacity-45" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold text-[var(--text-primary)] hover:underline">
              {group.novelTitle}
            </div>
            <div className="text-[12px] text-[var(--text-secondary)]">
              {group.entries.length === 1 ? "1 new chapter" : `${group.entries.length} new chapters`}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100">
          {downloadable.length > 1 && (
            <RowAction title="Download all" disabled={busy} onClick={() => rpc("downloadUpdates", { ids: downloadable })}>
              <Download className="h-3.5 w-3.5" />
            </RowAction>
          )}
          {unread.length > 1 && (
            <RowAction title="Mark all read" onClick={() => rpc("markUpdatesRead", { ids: unread, read: true })}>
              <CheckCheck className="h-3.5 w-3.5" />
            </RowAction>
          )}
        </div>
      </div>
      <div className="pb-1.5">
        {group.entries.map((entry) => (
          <ChapterRow key={entry.id} entry={entry} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function ChapterRow({ entry, busy }: { entry: UpdateEntry; busy: boolean }) {
  return (
    <div className="group flex items-center gap-2 px-3.5 py-1 pl-[60px] transition-colors hover:bg-[var(--row-hover)]">
      <button
        type="button"
        disabled={entry.locked}
        onClick={() => rpc("readUpdate", { id: entry.id })}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left disabled:cursor-not-allowed"
      >
        {!entry.read && !entry.locked && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-label="Unread" />
        )}
        <span
          className={`truncate text-[13px] ${
            entry.read || entry.locked ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"
          }`}
        >
          {entry.chapterName}
        </span>
        {entry.locked && <Badge icon={Lock}>Locked</Badge>}
        {entry.unlocked && !entry.locked && <Badge icon={LockOpen}>Unlocked</Badge>}
        {entry.downloaded && <Badge icon={Download}>Saved</Badge>}
      </button>
      <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--text-muted)]">
        {new Date(entry.foundAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
      </span>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {!entry.locked && !entry.downloaded && (
          <RowAction title="Download" disabled={busy} onClick={() => rpc("downloadUpdates", { ids: [entry.id] })}>
            <Download className="h-3.5 w-3.5" />
          </RowAction>
        )}
        {!entry.locked && (
          <RowAction
            title={entry.read ? "Mark unread" : "Mark read"}
            onClick={() => rpc("markUpdatesRead", { ids: [entry.id], read: !entry.read })}
          >
            {entry.read ? <EyeOff className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          </RowAction>
        )}
        <RowAction title="Remove from list" danger onClick={() => rpc("removeUpdates", { ids: [entry.id] })}>
          <X className="h-3.5 w-3.5" />
        </RowAction>
      </div>
    </div>
  );
}

function IssuesList({ issues, offline }: { issues: UpdateIssue[]; offline: boolean }) {
  if (issues.length === 0) {
    return (
      <EmptyState icon={CheckCheck} title="No update issues" subtitle="Every novel refreshed cleanly last time." />
    );
  }
  return (
    <div className="divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/45">
      {issues.map((issue) => {
        const isError = issue.severity === "ERROR";
        const Icon = isError ? CircleAlert : AlertTriangle;
        return (
          <div key={`${issue.sourceId}:${issue.novelUrl}`} className="flex items-start gap-3 px-3.5 py-3">
            <Icon
              className={`mt-0.5 h-4 w-4 shrink-0 ${isError ? "text-[var(--danger)]" : "text-[var(--warn)]"}`}
            />
            <button
              type="button"
              onClick={() => rpc("openSaved", { sourceId: issue.sourceId, novelUrl: issue.novelUrl, origin: "UPDATES" })}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-[13.5px] font-medium text-[var(--text-primary)] hover:underline">
                {issue.novelTitle}
              </div>
              <div className="mt-0.5 break-words text-[12px] leading-relaxed text-[var(--text-secondary)]">
                {issue.message}
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">{relativeTime(issue.occurredAt)}</div>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={issue.retrying || offline}
                onClick={() => rpc("retryUpdateIssue", { sourceId: issue.sourceId, novelUrl: issue.novelUrl })}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-hairline)] px-2.5 text-[11.5px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${issue.retrying ? "animate-spin" : ""}`} />
                {issue.retrying ? "Retrying" : "Retry"}
              </button>
              <RowAction
                title="Dismiss"
                onClick={() => rpc("dismissUpdateIssue", { sourceId: issue.sourceId, novelUrl: issue.novelUrl })}
              >
                <X className="h-3.5 w-3.5" />
              </RowAction>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LastRunLine({
  summary,
  onShowIssues,
}: {
  summary: NonNullable<ReaderState["lastLibraryUpdate"]>;
  onShowIssues?: () => void;
}) {
  const problems = summary.warnings + summary.errors;
  return (
    <div className="mb-5 flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
      <span>
        {summary.failed ? "Update failed" : summary.cancelled ? "Update cancelled" : "Last updated"}{" "}
        {relativeTime(summary.finishedAt)} ·{" "}
        {summary.checked} checked ·{" "}
        {summary.newChapters === 1 ? "1 new chapter" : `${summary.newChapters} new chapters`}
      </span>
      {problems > 0 && onShowIssues && (
        <button
          type="button"
          onClick={onShowIssues}
          className={`underline-offset-2 hover:underline ${
            summary.errors > 0 ? "text-[var(--danger)]" : "text-[var(--warn)]"
          }`}
        >
          · {problems} {problems === 1 ? "issue" : "issues"}
        </button>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13.5px] transition-colors ${
        active
          ? "bg-[var(--row-active)] font-semibold text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "warn" | "danger" }) {
  const color =
    tone === "danger"
      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
      : tone === "warn"
        ? "bg-[var(--warn-soft)] text-[var(--warn)]"
        : "bg-[var(--accent-soft)] text-[var(--accent)]";
  return <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${color}`}>{children}</span>;
}

function Badge({ icon: Icon, children }: { icon: typeof Lock; children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-surface)] px-1.5 py-px text-[10.5px] text-[var(--text-secondary)]">
      <Icon className="h-2.5 w-2.5" />
      {children}
    </span>
  );
}

function IconButton({
  title,
  onClick,
  children,
  active = false,
  danger = false,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]"
          : `border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] ${
              danger ? "hover:text-[var(--danger)]" : "hover:text-[var(--text-primary)]"
            }`
      }`}
    >
      {children}
    </button>
  );
}

function RowAction({
  title,
  onClick,
  children,
  danger = false,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors disabled:opacity-40 ${
        danger
          ? "hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
          : "hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
      }`}
    >
      {children}
    </button>
  );
}
