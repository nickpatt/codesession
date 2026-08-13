import * as Y from "yjs";
import { WebSocket } from "ws";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";

/**
 * Server-side collaborative document management.
 *
 * Each session owns exactly one Yjs document (a CRDT). Yjs guarantees that no
 * matter what order concurrent edits arrive in, every participant converges to
 * the same text — that's what makes "two people typing in the same line" work
 * without conflicts.
 *
 * We implement the standard y-websocket wire protocol by hand (rather than
 * pulling in the `y-websocket` server helper) so the sync logic is visible and
 * easy to explain: there are exactly two message channels, sync and awareness.
 */

/** Message type tags, matching the y-websocket protocol clients expect. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/**
 * A shared document plus the awareness state (cursors/presence) for one
 * session, together with the set of connected sockets.
 */
export class SharedDoc {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly conns = new Set<WebSocket>();

  /**
   * Which awareness client ids each socket is responsible for. When a socket
   * closes we use this to remove exactly its cursor(s) — no more, no less.
   */
  private controlledIds = new Map<WebSocket, Set<number>>();

  /** Called whenever the document changes, so the store can persist/touch it. */
  onChange?: () => void;

  constructor(initial?: Uint8Array) {
    this.doc = new Y.Doc();
    if (initial && initial.length > 0) {
      // Rehydrate a persisted document from its binary state vector.
      Y.applyUpdate(this.doc, initial);
    }
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    // Don't count the server itself as a present client.
    this.awareness.setLocalState(null);

    // Broadcast every document update to all other connections.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket);
      this.onChange?.();
    });

    // Broadcast awareness (cursor/presence) changes to everyone.
    this.awareness.on(
      "update",
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.broadcast(encoding.toUint8Array(encoder), origin as WebSocket);
      },
    );
  }

  /** Send a binary message to every connection except the originator. */
  private broadcast(message: Uint8Array, exclude?: WebSocket): void {
    for (const conn of this.conns) {
      if (conn === exclude) continue;
      if (conn.readyState === WebSocket.OPEN) conn.send(message);
    }
  }

  /**
   * Attach a new WebSocket connection: register it, wire up message handling,
   * and kick off the initial sync handshake (SyncStep1 + current awareness).
   */
  addConnection(ws: WebSocket): void {
    this.conns.add(ws);
    this.controlledIds.set(ws, new Set());
    ws.binaryType = "arraybuffer";

    ws.on("message", (data: ArrayBuffer) => {
      this.handleMessage(ws, new Uint8Array(data));
    });

    const cleanup = () => this.removeConnection(ws);
    ws.on("close", cleanup);
    ws.on("error", cleanup);

    // Step 1 of sync: send our state vector so the client can compute a diff.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    ws.send(encoding.toUint8Array(encoder));

    // Send the current awareness state so the newcomer immediately sees who's
    // already here and where their cursors are.
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      );
      ws.send(encoding.toUint8Array(awEncoder));
    }
  }

  /** Route an incoming binary message to the sync or awareness channel. */
  private handleMessage(ws: WebSocket, message: Uint8Array): void {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // readSyncMessage applies the update to our doc and may produce a reply
        // (e.g. SyncStep2). The `ws` origin prevents echoing back to sender.
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        // Record which client ids this socket controls, so we can clean them
        // up precisely on disconnect.
        const controlled = this.controlledIds.get(ws);
        if (controlled) {
          const dec = decoding.createDecoder(update);
          const len = decoding.readVarUint(dec);
          for (let i = 0; i < len; i++) {
            const clientId = decoding.readVarUint(dec);
            decoding.readVarUint(dec); // clock
            decoding.readVarString(dec); // state json
            controlled.add(clientId);
          }
        }
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
        break;
      }
    }
  }

  /** Remove a connection and clear its awareness state so its cursor vanishes. */
  private removeConnection(ws: WebSocket): void {
    if (!this.conns.has(ws)) return;
    this.conns.delete(ws);
    // Drop exactly the awareness entries this socket owned; others' cursors stay.
    const controlled = this.controlledIds.get(ws);
    if (controlled && controlled.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...controlled], ws);
    }
    this.controlledIds.delete(ws);
  }

  /** Current number of open connections. */
  get connectionCount(): number {
    return this.conns.size;
  }

  /** Serialize the document to a binary snapshot for persistence. */
  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  /** Tear down the document and its listeners when a session is reaped. */
  destroy(): void {
    this.awareness.destroy();
    this.doc.destroy();
    this.conns.clear();
  }
}

/**
 * Registry mapping session id -> its SharedDoc. Created lazily the first time
 * someone connects to a session, and destroyed when the session is reaped.
 */
export class DocManager {
  private docs = new Map<string, SharedDoc>();

  /** Get or create the SharedDoc for a session id. */
  getOrCreate(id: string, initial?: Uint8Array): SharedDoc {
    let doc = this.docs.get(id);
    if (!doc) {
      doc = new SharedDoc(initial);
      this.docs.set(id, doc);
    }
    return doc;
  }

  get(id: string): SharedDoc | undefined {
    return this.docs.get(id);
  }

  /** Destroy and forget a document (called when its session expires). */
  remove(id: string): void {
    this.docs.get(id)?.destroy();
    this.docs.delete(id);
  }
}
