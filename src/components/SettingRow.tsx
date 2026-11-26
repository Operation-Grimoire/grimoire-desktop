import type { ReactNode } from "react";

/** A titled settings row with its control on the right. */
export function SettingRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
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
