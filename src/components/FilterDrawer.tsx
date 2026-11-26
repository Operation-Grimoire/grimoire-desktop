import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Loader2,
  Minus,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { BrowseFilters, FilterEntry, FilterState, SortValue } from "../api/types";
import { rpc } from "../api/client";

/** Draft states, shaped like the entries; sent back as-is on Apply. */
interface Draft {
  state: FilterState;
  children: Draft[];
}

const toDraft = (entries: FilterEntry[], pick: "state" | "default"): Draft[] =>
  entries.map((e) => ({ state: e[pick], children: toDraft(e.children, pick) }));

const TRISTATE_LABEL = ["Any", "Include", "Exclude"];
/** Groups longer than this get a search box. */
const SEARCHABLE_GROUP = 12;

function sameState(a: FilterState, b: FilterState): boolean {
  if (a && typeof a === "object" && b && typeof b === "object") {
    return a.index === b.index && a.ascending === b.ascending;
  }
  return a === b;
}

function changedCount(entries: FilterEntry[], drafts: Draft[]): number {
  return entries.reduce((sum, e, i) => {
    const d = drafts[i];
    if (!d) return sum;
    if (e.kind === "GROUP") return sum + changedCount(e.children, d.children);
    if (e.kind === "HEADER" || e.kind === "SEPARATOR" || e.kind === "UNSUPPORTED") return sum;
    if (e.kind === "TEXT") return sum + (typeof d.state === "string" && d.state.trim() && d.state !== e.default ? 1 : 0);
    return sum + (sameState(d.state, e.default) ? 0 : 1);
  }, 0);
}

/** Side panel for a source's own filters; Apply runs a filtered search. */
export function FilterDrawer({
  filters,
  query,
  busy,
  onClose,
}: {
  filters: BrowseFilters;
  query: string;
  busy: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<Draft[]>(() => toDraft(filters.entries, "state"));
  const [text, setText] = useState(query);

  // New options (loaded from the site, or another source) replace the draft. Every state push
  // brings new objects, so compare content, not identity.
  const entriesKey = useMemo(() => JSON.stringify(filters.entries), [filters.entries]);
  const seenKey = useRef(entriesKey);
  useEffect(() => {
    if (seenKey.current === entriesKey) return;
    seenKey.current = entriesKey;
    setDrafts(toDraft(filters.entries, "state"));
  }, [entriesKey, filters.entries]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const canApply = filters.status === "READY" || filters.status === "LOADED";
  const changed = useMemo(() => changedCount(filters.entries, drafts), [filters.entries, drafts]);

  const update = (path: number[], state: FilterState) =>
    setDrafts((current) => {
      const write = (list: Draft[], [head, ...rest]: number[]): Draft[] =>
        list.map((d, i) =>
          i !== head ? d : rest.length === 0 ? { ...d, state } : { ...d, children: write(d.children, rest) },
        );
      return write(current, path);
    });

  const apply = () => {
    rpc("applyFilters", { filters: drafts, query: filters.searchWithFilters ? text : "" });
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input, select, [tabindex='0']",
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex h-full w-[380px] max-w-full flex-col border-l border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl outline-none animate-view-enter"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3.5">
          <h2 id={titleId} className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text-primary)]">
            <SlidersHorizontal className="h-4 w-4 text-[var(--accent)]" />
            Filters
          </h2>
          <button
            type="button"
            aria-label="Close filters"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {filters.status !== "READY" && filters.status !== "LOADED" && (
            <div className="mb-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]/60 px-4 py-3 text-[12.5px] text-[var(--text-secondary)]">
              {filters.status === "ERROR" ? (
                <p className="text-[var(--danger)]">Couldn't load the filter options: {filters.error}</p>
              ) : (
                <p>This source loads its filter options from the site before you can filter.</p>
              )}
              <button
                type="button"
                disabled={filters.status === "LOADING" || busy}
                onClick={() => rpc("loadFilterOptions")}
                className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 text-[12.5px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {filters.status === "LOADING" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {filters.status === "LOADING" ? "Loading options…" : filters.status === "ERROR" ? "Try again" : "Load filter options"}
              </button>
            </div>
          )}

          {filters.searchWithFilters && (
            <label className="mb-4 block">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">Title</span>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Optional"
                className="mt-1 h-9 w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            </label>
          )}

          <fieldset disabled={!canApply} className="space-y-3 disabled:opacity-50">
            {filters.entries.map((entry, i) => (
              <FilterControl key={i} entry={entry} draft={drafts[i]} path={[i]} onChange={update} />
            ))}
          </fieldset>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-hairline)] px-5 py-3">
          <button
            type="button"
            disabled={!canApply || changed === 0}
            onClick={() => setDrafts(toDraft(filters.entries, "default"))}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            type="button"
            disabled={!canApply || busy}
            onClick={apply}
            className="h-9 rounded-full bg-[var(--accent)] px-5 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Apply{changed > 0 ? ` (${changed})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterControl({
  entry,
  draft,
  path,
  onChange,
}: {
  entry: FilterEntry;
  draft: Draft | undefined;
  path: number[];
  onChange: (path: number[], state: FilterState) => void;
}) {
  if (!draft) return null;
  switch (entry.kind) {
    case "HEADER":
      return (
        <h3 className="pt-1 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--accent)]">{entry.name}</h3>
      );
    case "SEPARATOR":
      return <hr className="border-[var(--border-hairline)]" />;
    case "TEXT":
      return (
        <label className="block">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">{entry.name}</span>
          <input
            type="text"
            value={typeof draft.state === "string" ? draft.state : ""}
            onChange={(e) => onChange(path, e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          />
        </label>
      );
    case "CHECKBOX":
      return <CheckRow label={entry.name} checked={draft.state === true} onChange={(v) => onChange(path, v)} />;
    case "TRISTATE":
      return (
        <TriStateRow
          label={entry.name}
          value={typeof draft.state === "number" ? draft.state : 0}
          onChange={(v) => onChange(path, v)}
        />
      );
    case "SELECT":
      return (
        <label className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-[var(--text-primary)]">{entry.name}</span>
          <select
            value={typeof draft.state === "number" ? draft.state : 0}
            onChange={(e) => onChange(path, Number(e.target.value))}
            className="h-8 max-w-[190px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2 text-[12.5px] text-[var(--text-primary)]"
          >
            {entry.values.map((v, i) => (
              <option key={i} value={i}>
                {v}
              </option>
            ))}
          </select>
        </label>
      );
    case "SORT":
      return <SortControl entry={entry} value={draft.state as SortValue | null} onChange={(v) => onChange(path, v)} />;
    case "GROUP":
      return <GroupControl entry={entry} draft={draft} path={path} onChange={onChange} />;
    default:
      return null;
  }
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--row-hover)]"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]" : "border-[var(--border-strong)]"
        }`}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}

/** Click cycles Any → Include → Exclude. */
function TriStateRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <button
      type="button"
      aria-label={`${label}: ${TRISTATE_LABEL[value] ?? "Any"}`}
      onClick={() => onChange((value + 1) % 3)}
      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)]"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          value === 1
            ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
            : value === 2
              ? "border-[var(--danger)] bg-[var(--danger)] text-white"
              : "border-[var(--border-strong)]"
        }`}
      >
        {value === 1 && <Check className="h-3 w-3" strokeWidth={3} />}
        {value === 2 && <Minus className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className={value === 2 ? "text-[var(--text-secondary)] line-through" : "text-[var(--text-primary)]"}>
        {label}
      </span>
    </button>
  );
}

/** Choosing the selected column flips its direction. */
function SortControl({
  entry,
  value,
  onChange,
}: {
  entry: FilterEntry;
  value: SortValue | null;
  onChange: (v: SortValue | null) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium text-[var(--text-secondary)]">{entry.name}</div>
      <div className="space-y-0.5">
        {entry.values.map((label, i) => {
          const selected = value?.index === i;
          const Arrow = value?.ascending ? ArrowUp : ArrowDown;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={selected}
              aria-label={selected ? `${label}, ${value?.ascending ? "ascending" : "descending"}` : label}
              onClick={() => onChange(selected ? { index: i, ascending: !value!.ascending } : { index: i, ascending: false })}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)] ${
                selected ? "font-medium text-[var(--accent)]" : "text-[var(--text-primary)]"
              }`}
            >
              {label}
              {selected && <Arrow className="h-3.5 w-3.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GroupControl({
  entry,
  draft,
  path,
  onChange,
}: {
  entry: FilterEntry;
  draft: Draft;
  path: number[];
  onChange: (path: number[], state: FilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const active = changedCount(entry.children, draft.children);
  const term = needle.trim().toLowerCase();

  return (
    <div className="rounded-xl border border-[var(--border-hairline)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-[var(--text-primary)]"
      >
        <span className="flex items-center gap-1.5">
          <ChevronRight className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform ${open ? "rotate-90" : ""}`} />
          {entry.name}
        </span>
        {active > 0 && (
          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
            {active}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-[var(--border-hairline)] px-2 py-2">
          {entry.children.length > SEARCHABLE_GROUP && (
            <input
              type="search"
              aria-label={`Find in ${entry.name}`}
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              placeholder={`Find in ${entry.name.toLowerCase()}…`}
              className="mb-1.5 h-8 w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 text-[12.5px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
          )}
          <div className="space-y-0.5">
            {entry.children.map((child, i) =>
              term && !child.name.toLowerCase().includes(term) ? null : (
                <FilterControl key={i} entry={child} draft={draft.children[i]} path={[...path, i]} onChange={onChange} />
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
