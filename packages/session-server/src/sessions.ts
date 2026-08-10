import { customAlphabet } from "nanoid";
import type { Language, SessionInfo } from "@codesession/shared";

/**
 * URL-safe id generator. We avoid look-alike characters (0/O, 1/l/I) so ids
 * are easy to read aloud and copy. 10 chars from a 32-symbol alphabet gives
 * ~50 bits of entropy — plenty for anonymous, expiring sessions.
 */
const makeId = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 10);

/**
 * A live session: its metadata plus the set of currently connected clients.
 * The collaborative document itself is held by the collab layer (a Yjs doc);
 * this record only tracks membership and timing so we can expire idle sessions.
 */
export interface Session {
  info: SessionInfo;
  /** Number of currently open WebSocket connections. */
  connections: number;
  /**
   * Epoch ms after which an empty session may be reaped. Set when the last
   * connection closes; cleared while anyone is connected.
   */
  expiresAt: number | null;
}

/**
 * In-memory registry of all sessions. Persistence (to disk) is layered on top
 * separately so this class stays focused on bookkeeping.
 */
export class SessionStore {
  private sessions = new Map<string, Session>();

  /** Create a new session and return its metadata. */
  create(language: Language = "python"): Session {
    const now = Date.now();
    const info: SessionInfo = {
      id: makeId(),
      language,
      createdAt: now,
      lastActiveAt: now,
    };
    const session: Session = { info, connections: 0, expiresAt: null };
    this.sessions.set(info.id, session);
    return session;
  }

  /** Look up a session by id, or undefined if it does not exist. */
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Whether a session currently exists. */
  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /**
   * Register a session that was loaded from disk on startup. Loaded sessions
   * start with zero connections and inherit their persisted expiry.
   */
  restore(session: Session): void {
    this.sessions.set(session.info.id, session);
  }

  /** Record a new connection joining a session. */
  addConnection(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.connections += 1;
    s.expiresAt = null; // active again — cancel any pending expiry
    s.info.lastActiveAt = Date.now();
  }

  /**
   * Record a connection leaving. When the last one leaves we start the TTL
   * countdown by stamping expiresAt.
   */
  removeConnection(id: string, ttlMs: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.connections = Math.max(0, s.connections - 1);
    s.info.lastActiveAt = Date.now();
    if (s.connections === 0) {
      s.expiresAt = Date.now() + ttlMs;
    }
  }

  /** Mark activity (e.g. an edit) to keep lastActiveAt fresh. */
  touch(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.info.lastActiveAt = Date.now();
  }

  /** All sessions, for persistence and sweeping. */
  all(): Session[] {
    return [...this.sessions.values()];
  }

  /**
   * Remove sessions that have no connections and whose TTL has elapsed.
   * Returns the ids that were reaped so callers can clean up related state.
   */
  sweepExpired(now = Date.now()): string[] {
    const reaped: string[] = [];
    for (const [id, s] of this.sessions) {
      if (s.connections === 0 && s.expiresAt !== null && s.expiresAt <= now) {
        this.sessions.delete(id);
        reaped.push(id);
      }
    }
    return reaped;
  }

  /** Remove a session outright (e.g. after reaping its document). */
  delete(id: string): void {
    this.sessions.delete(id);
  }
}
