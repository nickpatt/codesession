import type { WebSocket } from "ws";
import type { ServerControl } from "@codesession/shared";
import { snapshotProject } from "@codesession/shared";
import type { DocManager } from "./collab.js";
import { config } from "./config.js";

/**
 * Bridges the collaborative session world to the execution-service.
 *
 * When any participant clicks Run, we:
 *   1. Read the current shared code straight from the session's Yjs document
 *      (so everyone runs exactly what's on screen).
 *   2. POST it to the execution-service, which streams back NDJSON events.
 *   3. Fan every event out to ALL sockets in the session, so the output panel
 *      is identical for everyone in real time.
 *
 * One run per session is enforced by the executor (409 on a second run); we
 * mirror that here by tracking active runs so we can wire up Stop.
 */
export class ExecutionBridge {
  /** sessionId -> AbortController for the in-flight run request. */
  private active = new Map<string, AbortController>();

  constructor(private readonly docs: DocManager) {}

  /** Whether a run is currently in flight for this session. */
  isRunning(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /**
   * Start a run for a session and stream its output to all connections.
   * `broadcast` sends a control message to every socket in the session.
   */
  async run(
    sessionId: string,
    broadcast: (msg: ServerControl) => void,
  ): Promise<void> {
    if (this.active.has(sessionId)) return; // already running

    const doc = this.docs.get(sessionId);
    if (!doc) {
      broadcast({ type: "run-error", message: "session document not found" });
      return;
    }
    // Snapshot the whole multi-file project and run its tests in the sandbox.
    const files = snapshotProject(doc.doc);
    if (Object.keys(files).length === 0) {
      broadcast({ type: "run-error", message: "project is empty" });
      return;
    }

    const controller = new AbortController();
    this.active.set(sessionId, controller);
    broadcast({ type: "run-started" });

    try {
      const res = await fetch(`${config.execUrl}/run-project`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, files }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        broadcast({
          type: "run-error",
          message: `executor responded ${res.status}`,
        });
        return;
      }

      // Parse the NDJSON stream line by line and fan each event out.
      await this.pump(res.body, broadcast);
    } catch (err) {
      // AbortError is expected when Stop is pressed; don't report it as a fault.
      if ((err as Error).name !== "AbortError") {
        broadcast({ type: "run-error", message: (err as Error).message });
      }
    } finally {
      this.active.delete(sessionId);
    }
  }

  /**
   * Read a ReadableStream of NDJSON, decode complete lines, and translate each
   * executor event into a ServerControl broadcast.
   */
  private async pump(
    body: ReadableStream<Uint8Array>,
    broadcast: (msg: ServerControl) => void,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      // Process each complete line; keep any partial tail in the buffer.
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.emit(line, broadcast);
      }
    }
    if (buffer.trim()) this.emit(buffer.trim(), broadcast);
  }

  /** Translate one executor NDJSON event into a broadcast. */
  private emit(line: string, broadcast: (msg: ServerControl) => void): void {
    let ev: {
      type: string;
      data?: string;
      exitCode?: number;
      reason?: string;
    };
    try {
      ev = JSON.parse(line);
    } catch {
      return; // ignore malformed lines
    }

    switch (ev.type) {
      case "stdout":
        broadcast({ type: "run-output", stream: "stdout", data: ev.data ?? "" });
        break;
      case "stderr":
        broadcast({ type: "run-output", stream: "stderr", data: ev.data ?? "" });
        break;
      case "exit":
        broadcast({
          type: "run-exit",
          exitCode: ev.exitCode ?? 0,
          reason: ev.reason,
        });
        break;
      case "error":
        broadcast({ type: "run-error", message: ev.data ?? "run error" });
        break;
    }
  }

  /**
   * Stop a running session. We abort our streaming request AND tell the executor
   * to kill the container, so the run stops for everyone immediately.
   */
  async stop(sessionId: string): Promise<void> {
    const controller = this.active.get(sessionId);
    // Tell the executor to kill the sandbox (authoritative stop).
    try {
      await fetch(`${config.execUrl}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      /* executor may already have finished; ignore */
    }
    // Abort our local stream read.
    controller?.abort();
  }
}
