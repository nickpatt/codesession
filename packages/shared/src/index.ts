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

/**
 * Control messages sent from a client to the server over the control WebSocket
 * as JSON text frames. Phase 2 added run + stop; Phase 3 adds the AI agent.
 */
export type ClientControl =
  | { type: "run" }
  | { type: "stop" }
  | { type: "agent_task"; prompt: string }
  | { type: "agent_cancel" };

/**
 * Messages the server broadcasts to every client in a session as JSON text
 * frames. Fanned out to everyone, so all participants see the same run output
 * and the same agent activity at once.
 */
export type ServerControl =
  | { type: "run-started"; by?: string }
  | { type: "run-output"; stream: "stdout" | "stderr"; data: string }
  | { type: "run-exit"; exitCode: number; reason?: string }
  | { type: "run-error"; message: string }
  | AgentEvent;

// ---------------------------------------------------------------------------
// AI coding agent (Phase 3)
// ---------------------------------------------------------------------------

/** Lifecycle status of an agent task. */
export type AgentStatus =
  | "queued"
  | "retrieving_context"
  | "generating"
  | "applying_patch"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Structured actions the model must emit (it never touches the filesystem
 * directly). Keeping actions structured makes them easy to validate, apply as
 * Yjs edits, audit, and show in the UI.
 */
export type AgentAction =
  | { action: "read_file"; path: string }
  | { action: "edit_file"; path: string; changes: EditChange[] }
  | { action: "create_file"; path: string; content: string }
  | { action: "run_command"; command?: string[] }
  | { action: "finish"; summary: string };

/**
 * A single edit within a file: replace the inclusive line range
 * [startLine, endLine] (1-indexed) with `replacement`. Line-range edits map
 * cleanly onto Yjs text operations.
 */
export interface EditChange {
  startLine: number;
  endLine: number;
  replacement: string;
}

/**
 * Events the agent emits during a task, streamed to every collaborator so the
 * agent's activity is visible in real time (spec section 13).
 */
export type AgentEvent =
  | { type: "agent.started"; taskId: string; prompt: string }
  | { type: "agent.status"; taskId: string; status: AgentStatus }
  | { type: "agent.context"; taskId: string; files: string[] }
  | { type: "agent.thinking"; taskId: string; iteration: number }
  | { type: "agent.action"; taskId: string; action: AgentAction }
  | { type: "agent.patch_applied"; taskId: string; path: string }
  | {
      type: "agent.execution_output";
      taskId: string;
      stream: "stdout" | "stderr";
      data: string;
    }
  | {
      type: "agent.iteration_finished";
      taskId: string;
      iteration: number;
      exitCode: number;
    }
  | {
      type: "agent.completed";
      taskId: string;
      iterations: number;
      summary: string;
    }
  | { type: "agent.failed"; taskId: string; reason: string };

/** The identity the agent presents as a collaborator in a session. */
export const AGENT_IDENTITY = {
  name: "CodeSession Agent",
  color: "#a855f7",
} as const;

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
