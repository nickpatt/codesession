import http from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";

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

/** Liveness probe used by load balancers and the local dev setup. */
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const server = http.createServer(app);

// A WebSocket server in "noServer" mode: we handle the HTTP upgrade ourselves
// so we can route by URL (/ws/:sessionId) before accepting the socket.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // Phase 1a: accept the upgrade and echo. Real Yjs relay is wired in later.
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  ws.on("message", (data) => ws.send(data)); // temporary echo
});

server.listen(config.port, () => {
  console.log(`[session-server] listening on :${config.port}`);
});
