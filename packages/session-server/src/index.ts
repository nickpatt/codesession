import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { SessionStore } from "./sessions.js";
import { createRoutes } from "./routes.js";
import { DocManager } from "./collab.js";
import { Persistence } from "./persistence.js";

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

/** Liveness probe used by load balancers and the local dev setup. */
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// REST API for creating / inspecting sessions.
app.use("/api", createRoutes(store));

const server = http.createServer(app);

// A WebSocket server in "noServer" mode: we handle the HTTP upgrade ourselves
// so we can route by URL (/ws/:sessionId) before accepting the socket.
const wss = new WebSocketServer({ noServer: true });

// Clients connect to  ws://host/ws/<sessionId>. We validate the session exists
// before accepting the socket, then hand it to that session's shared document.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/ws\/([^/]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const sessionId = match[1];
  if (!store.has(sessionId)) {
    // Reject unknown sessions so stale/expired links fail fast.
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const doc = docs.getOrCreate(sessionId);
    doc.onChange = () => store.touch(sessionId);
    store.addConnection(sessionId);
    doc.addConnection(ws);

    ws.on("close", () => {
      store.removeConnection(sessionId, config.sessionTtlMs);
    });
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

// Boot: load persisted sessions, then start the server and background loops.
async function main() {
  await persistence.init();
  const loaded = await persistence.loadAll();
  if (loaded > 0) console.log(`[persistence] restored ${loaded} session(s)`);

  const persistTimer = startPersistenceLoop();

  server.listen(config.port, () => {
    console.log(`[session-server] listening on :${config.port}`);
  });

  // On shutdown, flush one last time so nothing in flight is lost.
  const shutdown = async () => {
    clearInterval(persistTimer);
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
