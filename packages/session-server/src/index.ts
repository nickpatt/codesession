import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { SessionStore } from "./sessions.js";
import { createRoutes } from "./routes.js";
import { DocManager } from "./collab.js";
import { Persistence } from "./persistence.js";
import { ExecutionBridge } from "./execution.js";
import { AgentBridge } from "./agent.js";
import { ControlHub } from "./control.js";
import type { ClientControl } from "@codesession/shared";

/**
 * Entry point for the CodeSession session-server.
 *
 * Phase 1 responsibilities:
 *  - Serve a small REST API for creating and inspecting sessions.
 *  - Accept one WebSocket per session and relay collaborative document
 *    updates between participants using Yjs.
 *  - Persist sessions periodically and expire idle ones.
 *
 * This file wires together the HTTP server, the REST routes, and the WebSocket
 * upgrade path. The collaborative logic lives in ./collab, session bookkeeping
 * in ./sessions, and persistence in ./persistence — kept separate so each
 * concern stays small and testable.
 */
const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

/** Central registry of live sessions. */
const store = new SessionStore();

/** Owns the Yjs document for each session. */
const docs = new DocManager();

/** Disk-backed persistence so restarts don't wipe active sessions. */
const persistence = new Persistence(config.dataDir, store, docs);

/** Tracks control (run/stop/output) sockets per session. */
const control = new ControlHub();

/** Bridges Run/Stop to the execution-service and fans output to all clients. */
const execution = new ExecutionBridge(docs);

/** Bridges agent tasks to the agent-server and fans agent events to clients. */
const agent = new AgentBridge();

/** Liveness probe used by load balancers and the local dev setup. */
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// REST API for creating / inspecting sessions.
app.use("/api", createRoutes(store));

const server = http.createServer(app);

// Two WebSocket servers in "noServer" mode so we can route by URL before
// accepting:  /ws/<id>      -> Yjs sync/awareness (binary protocol)
//             /control/<id> -> run/stop + streamed output (JSON text)
// They are kept separate because the Yjs client library binary-decodes every
// frame it receives, so control messages cannot share that socket.
const wss = new WebSocketServer({ noServer: true });
const controlWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  const sync = url.pathname.match(/^\/ws\/([^/]+)$/);
  const ctrl = url.pathname.match(/^\/control\/([^/]+)$/);
  const sessionId = sync?.[1] ?? ctrl?.[1];

  if (!sessionId) {
    socket.destroy();
    return;
  }
  if (!store.has(sessionId)) {
    // Reject unknown sessions so stale/expired links fail fast.
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (sync) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const doc = docs.getOrCreate(sessionId);
      doc.onChange = () => store.touch(sessionId);
      store.addConnection(sessionId);
      doc.addConnection(ws);
      ws.on("close", () => {
        store.removeConnection(sessionId, config.sessionTtlMs);
      });
    });
    return;
  }

  // Control channel.
  controlWss.handleUpgrade(req, socket, head, (ws) => {
    control.add(sessionId, ws);
    const broadcast = (m: unknown) => control.broadcast(sessionId, m);

    ws.on("message", (data: Buffer) => {
      let msg: ClientControl;
      try {
        msg = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }
      if (msg.type === "run") {
        void execution.run(sessionId, broadcast);
      } else if (msg.type === "stop") {
        void execution.stop(sessionId);
      } else if (msg.type === "agent_task") {
        void agent.start(sessionId, msg.prompt, broadcast);
      } else if (msg.type === "agent_cancel") {
        void agent.cancel(sessionId);
      }
    });

    ws.on("close", () => control.remove(sessionId, ws));
    ws.on("error", () => control.remove(sessionId, ws));
  });
});

/**
 * Periodically snapshot sessions to disk so an unexpected restart loses at most
 * a few seconds of edits.
 */
function startPersistenceLoop(): NodeJS.Timeout {
  return setInterval(() => {
    persistence.flush().catch((err) => console.error("[persistence] flush:", err));
  }, config.persistIntervalMs);
}

/**
 * Periodically reap sessions whose 24h TTL has elapsed with nobody connected.
 * Reaping tears down the in-memory document and deletes its file on disk, which
 * is what keeps a public deployment from accumulating abandoned sessions.
 */
function startSweepLoop(): NodeJS.Timeout {
  return setInterval(() => {
    const reaped = store.sweepExpired();
    for (const id of reaped) {
      docs.remove(id);
      persistence.remove(id).catch(() => {});
      console.log(`[sweep] expired session ${id}`);
    }
  }, config.sweepIntervalMs);
}

// Boot: load persisted sessions, then start the server and background loops.
async function main() {
  await persistence.init();
  const loaded = await persistence.loadAll();
  if (loaded > 0) console.log(`[persistence] restored ${loaded} session(s)`);

  const persistTimer = startPersistenceLoop();
  const sweepTimer = startSweepLoop();

  server.listen(config.port, () => {
    console.log(`[session-server] listening on :${config.port}`);
  });

  // On shutdown, flush one last time so nothing in flight is lost.
  const shutdown = async () => {
    clearInterval(persistTimer);
    clearInterval(sweepTimer);
    await persistence.flush().catch(() => {});
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[session-server] fatal:", err);
  process.exit(1);
});
