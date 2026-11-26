import { useEffect, useId, useRef, type KeyboardEvent } from "react";

/**
 * Modal confirmation: focus starts on Cancel, Tab stays inside, Escape cancels,
 * and focus returns to whatever opened it.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons || buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={onKeyDown}
        className="w-[380px] rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 shadow-2xl"
      >
        <h3 id={titleId} className="text-[15px] font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        <p id={messageId} className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-8 rounded-full border border-[var(--border-strong)] px-3.5 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-[var(--row-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-8 rounded-full bg-[var(--danger)] px-4 text-[12.5px] font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--danger)]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
