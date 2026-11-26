import { useEffect, useRef } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { ChapterAlert } from "./types";
import { rpc } from "./client";

/** More novels than this in one update become a single summary notification. */
const MAX_SEPARATE = 3;

function countText(a: ChapterAlert): string {
  const parts: string[] = [];
  if (a.readable > 0) parts.push(`${a.readable} new chapter${a.readable === 1 ? "" : "s"}`);
  if (a.locked > 0) parts.push(`${a.locked} locked`);
  return parts.join(" · ");
}

let permission: Promise<boolean> | null = null;

/** Asks once per session; a refusal is remembered by the OS. */
function allowed(): Promise<boolean> {
  permission ??= (async () => {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  })().catch(() => false);
  return permission;
}

/**
 * Posts the sidecar's new-chapter alerts as system notifications and acknowledges them.
 * Each alert is shown once even if state pushes repeat it before the acknowledgement lands.
 */
export function useChapterAlerts(alerts: ChapterAlert[] | undefined) {
  const shown = useRef(new Set<number>());

  useEffect(() => {
    const fresh = (alerts ?? []).filter((a) => !shown.current.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach((a) => shown.current.add(a.id));
    void (async () => {
      if (await allowed()) {
        try {
          if (fresh.length <= MAX_SEPARATE) {
            fresh.forEach((a) => sendNotification({ title: a.title, body: countText(a) }));
          } else {
            const names = fresh.slice(0, 3).map((a) => a.title).join(", ");
            const more = fresh.length > 3 ? ` and ${fresh.length - 3} more` : "";
            sendNotification({ title: `${fresh.length} novels have new chapters`, body: `${names}${more}` });
          }
        } catch {
          // The Updates screen still lists every chapter.
        }
      }
      void rpc("ackChapterAlerts", { ids: fresh.map((a) => a.id) });
    })();
  }, [alerts]);
}
