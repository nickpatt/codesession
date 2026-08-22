import type { ConnStatus } from "../collab/useCollab.js";

const LABEL: Record<ConnStatus, string> = {
  connecting: "Reconnecting…",
  connected: "Connected",
  disconnected: "Offline",
};

/**
 * Small colored badge showing the live WebSocket status. When it briefly reads
 * "Reconnecting…" after a refresh or wifi blip and then flips back to
 * "Connected" without losing edits, that's the reconnect story working.
 */
export function ConnectionStatus({ status }: { status: ConnStatus }) {
  return <span className={`status ${status}`}>{LABEL[status]}</span>;
}
