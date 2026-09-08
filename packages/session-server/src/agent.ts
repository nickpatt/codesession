import type { ServerControl } from "@codesession/shared";
import { config } from "./config.js";

/**
 * Bridges the collaborative session to the agent-server.
 *
 * When a participant starts an agent task, we POST it to the agent-server and
 * stream back the agent's NDJSON events, fanning each one out to every client in
 * the session so all collaborators watch the agent work in real time. The agent
 * itself edits the shared document directly (it joins the Yjs doc as its own
 * client), so those edits arrive over the normal sync channel — this bridge only
 * carries the agent's *activity events*, not its code edits.
 */
export class AgentBridge {
  /** sessionId -> AbortController for the in-flight task request. */
  private active = new Map<string, AbortController>();

  isRunning(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  /** Start an agent task and fan its events to the session. */
  async start(
    sessionId: string,
    prompt: string,
    broadcast: (msg: ServerControl) => void,
  ): Promise<void> {
    if (this.active.has(sessionId)) return;

    const controller = new AbortController();
    this.active.set(sessionId, controller);

    try {
      const res = await fetch(`${config.agentUrl}/task`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, prompt }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        broadcast({
          type: "agent.failed",
          taskId: "task",
          reason: `agent-server responded ${res.status}`,
        });
        return;
      }

      await this.pump(res.body, broadcast);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        broadcast({
          type: "agent.failed",
          taskId: "task",
          reason: (err as Error).message,
        });
      }
    } finally {
      this.active.delete(sessionId);
    }
  }

  /** Read the NDJSON event stream and forward each event as a broadcast. */
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
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          broadcast(JSON.parse(line) as ServerControl);
        } catch {
          /* ignore malformed lines */
        }
      }
    }
  }

  /** Cancel the active task: abort our stream and tell the agent-server. */
  async cancel(sessionId: string): Promise<void> {
    const controller = this.active.get(sessionId);
    try {
      await fetch(`${config.agentUrl}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      /* agent may have already finished */
    }
    controller?.abort();
  }
}
