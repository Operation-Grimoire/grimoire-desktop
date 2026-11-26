import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DaemonSnapshot, ReaderState } from "./types";

export async function getInitialState(): Promise<DaemonSnapshot> {
  return invoke<DaemonSnapshot>("get_initial_state");
}

export async function rpc(method: string, params?: Record<string, unknown>): Promise<void> {
  return invoke<void>("rpc_call", { method, params: params ?? {} });
}

export function subscribeDaemon(
  onReady: (info: { coverBaseUrl: string | null; hostApi: string | null }) => void,
  onState: (state: ReaderState) => void,
): Promise<() => void> {
  return Promise.all([
    listen<{ coverBaseUrl: string | null; hostApi: string | null }>("daemon://ready", (e) =>
      onReady(e.payload),
    ),
    listen<ReaderState>("daemon://state", (e) => onState(e.payload)),
  ]).then(([unlistenReady, unlistenState]) => () => {
    unlistenReady();
    unlistenState();
  });
}

export function coverUrl(coverBaseUrl: string | null, rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  if (!coverBaseUrl) return rawUrl;
  return `${coverBaseUrl}/cover?url=${encodeURIComponent(rawUrl)}`;
}
