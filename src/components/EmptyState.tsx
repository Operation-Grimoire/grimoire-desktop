import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-muted)]">
        <Icon className="h-5 w-5 stroke-[1.6]" />
      </div>
      <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
        {title}
      </h2>
      <p className="mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-[var(--text-secondary)]">
        {subtitle}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 rounded-full bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
