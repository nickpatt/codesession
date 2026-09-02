import type { WebSocket } from "ws";

/**
 * Tracks the "control" WebSockets for each session.
 *
 * Control sockets are separate from the Yjs sync sockets on purpose: the Yjs
 * client library ("y-websocket") tries to binary-decode every frame it receives,
 * so we cannot safely multiplex our JSON control messages onto that socket.
 * A dedicated control channel keeps the two concerns cleanly independent.
 *
 * This hub lets us fan a message (run status, streamed output) out to every
 * participant in a session at once.
 */
export class ControlHub {
  /** sessionId -> set of open control sockets. */
  private rooms = new Map<string, Set<WebSocket>>();

  /** Register a control socket for a session. */
  add(sessionId: string, ws: WebSocket): void {
    let room = this.rooms.get(sessionId);
    if (!room) {
      room = new Set();
      this.rooms.set(sessionId, room);
    }
    room.add(ws);
  }

  /** Remove a control socket (on disconnect). */
  remove(sessionId: string, ws: WebSocket): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    room.delete(ws);
    if (room.size === 0) this.rooms.delete(sessionId);
  }

  /** Broadcast a JSON message to every control socket in a session. */
  broadcast(sessionId: string, message: unknown): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const text = JSON.stringify(message);
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }
}
