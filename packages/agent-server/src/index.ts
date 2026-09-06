import express from "express";
import { config } from "./config.js";
import { createProvider } from "./llm/index.js";

/**
 * Entry point for the CodeSession agent-server.
 *
 * This service runs the AI coding agent's execution loop: it connects to a
 * session's collaborative document (as its own Yjs client), retrieves relevant
 * context, calls an LLM to produce structured edits, applies them through Yjs
 * so humans and the agent stay in sync, runs the project in the sandbox, and
 * iterates until the task succeeds or a budget is exhausted.
 *
 * This commit wires up the process, config, and the pluggable LLM provider; the
 * orchestrator + Yjs client are added next.
 */
const app = express();
app.use(express.json({ limit: "1mb" }));

const provider = createProvider();

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "agent-server", llm: provider.name });
});

app.listen(config.port, () => {
  console.log(
    `[agent-server] listening on :${config.port} (llm=${provider.name})`,
  );
});
