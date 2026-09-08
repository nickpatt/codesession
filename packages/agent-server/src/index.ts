import express from "express";
import { config } from "./config.js";
import { createProvider } from "./llm/index.js";
import { TaskManager } from "./agent/taskManager.js";

/**
 * Entry point for the CodeSession agent-server.
 *
 * Runs the AI coding agent's execution loop. The session-server calls this
 * service to start a task and receives a live NDJSON stream of agent events,
 * which it fans out to every collaborator. The agent edits the project by
 * joining the session's Yjs document directly (see session/projectClient).
 */
const app = express();
app.use(express.json({ limit: "1mb" }));

const provider = createProvider();
const tasks = new TaskManager(provider);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "agent-server", llm: provider.name });
});

/**
 * POST /task { sessionId, prompt }
 * Streams agent events as NDJSON until the task finishes.
 */
app.post("/task", async (req, res) => {
  const { sessionId, prompt } = req.body ?? {};
  if (typeof sessionId !== "string" || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "sessionId and prompt are required" });
  }
  if (tasks.isBusy(sessionId)) {
    return res.status(409).json({ error: "agent already running for this session" });
  }

  res.setHeader("Content-Type", "application/x-ndjson");
  res.flushHeaders?.();

  const emit = (event: unknown) => {
    res.write(JSON.stringify(event) + "\n");
  };

  try {
    await tasks.run(sessionId, prompt, emit);
  } catch (err) {
    emit({ type: "agent.failed", taskId: "task", reason: (err as Error).message });
  } finally {
    res.end();
  }
});

/** POST /cancel { sessionId } — cancel the active task for a session. */
app.post("/cancel", (req, res) => {
  const { sessionId } = req.body ?? {};
  if (typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId required" });
  }
  const cancelled = tasks.cancel(sessionId);
  res.json({ cancelled });
});

app.listen(config.port, () => {
  console.log(
    `[agent-server] listening on :${config.port} (llm=${provider.name})`,
  );
});
