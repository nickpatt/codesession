/**
 * Shared types used by both the session-server and the web client.
 *
 * Keeping the wire contract in one package means the client and server can
 * never drift apart: if we change a message shape here, both sides fail to
 * compile until they agree again.
 */

/** Language a session's code is written in. Phase 1 ships Python only. */
export type Language = "python" | "javascript";

/** Metadata describing a collaborative session (no document content). */
export interface SessionInfo {
  /** Short, URL-safe identifier that appears in the shareable link. */
  id: string;
  /** Programming language for this session. */
  language: Language;
  /** Epoch ms when the session was created. */
  createdAt: number;
  /** Epoch ms of the most recent activity (edit or connection). */
  lastActiveAt: number;
}

/** One participant's presence info, broadcast to everyone via awareness. */
export interface Presence {
  /** Ephemeral per-connection client id assigned by Yjs awareness. */
  clientId: number;
  /** Display name the user chose when joining. */
  name: string;
  /** Hex color used for this user's cursor and selection. */
  color: string;
}

/** Response body for POST /api/sessions. */
export interface CreateSessionResponse {
  session: SessionInfo;
}

/** Distinct, high-contrast colors assigned round-robin to participants. */
export const USER_COLORS = [
  "#e11d48",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
] as const;

/**
 * Deterministically pick a color for a client id so the same user keeps the
 * same color for the life of their connection.
 */
export function colorForClient(clientId: number): string {
  return USER_COLORS[Math.abs(clientId) % USER_COLORS.length];
}
