import { promises as fs } from "node:fs";
import path from "node:path";
import type { Session, SessionStore } from "./sessions.js";
import type { DocManager } from "./collab.js";

/**
 * Disk persistence for sessions.
 *
 * Goal: a server restart must not wipe active sessions. We periodically write
 * each session's metadata plus its Yjs document (as a binary snapshot) to a
 * JSON file, and load them all back on boot. This is deliberately simple —
 * one file per session — which is plenty for hobby/demo scale. A production
 * build would swap this for Redis or a database behind the same interface.
 */

/** On-disk shape of a persisted session. */
interface PersistedSession {
  info: Session["info"];
  expiresAt: number | null;
  /** Base64-encoded Yjs document snapshot (Y.encodeStateAsUpdate). */
  docState: string;
}

export class Persistence {
  constructor(
    private readonly dir: string,
    private readonly store: SessionStore,
    private readonly docs: DocManager,
  ) {}

  /** Ensure the data directory exists. */
  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.session.json`);
  }

  /**
   * Write every current session to disk. Called on an interval and on shutdown.
   * We only snapshot the document if it has been loaded into memory; otherwise
   * we preserve whatever is already on disk.
   */
  async flush(): Promise<void> {
    for (const session of this.store.all()) {
      const doc = this.docs.get(session.info.id);
      // If the doc isn't in memory (nobody has connected since load), skip —
      // its file on disk is still the source of truth.
      if (!doc) continue;

      const payload: PersistedSession = {
        info: session.info,
        expiresAt: session.expiresAt,
        docState: Buffer.from(doc.encodeState()).toString("base64"),
      };
      await fs.writeFile(this.filePath(session.info.id), JSON.stringify(payload));
    }
  }

  /**
   * Load all persisted sessions on startup. Each session's document snapshot
   * is decoded and handed to the DocManager so clients resume exactly where
   * they left off before the restart.
   */
  async loadAll(): Promise<number> {
    let loaded = 0;
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return 0; // no data dir yet
    }

    for (const entry of entries) {
      if (!entry.endsWith(".session.json")) continue;
      try {
        const raw = await fs.readFile(path.join(this.dir, entry), "utf8");
        const p = JSON.parse(raw) as PersistedSession;

        // Restore metadata (starts with 0 connections).
        this.store.restore({
          info: p.info,
          connections: 0,
          expiresAt: p.expiresAt,
        });

        // Rehydrate the CRDT document from its snapshot.
        const state = Buffer.from(p.docState, "base64");
        this.docs.getOrCreate(p.info.id, new Uint8Array(state));
        loaded++;
      } catch (err) {
        console.warn(`[persistence] skipping corrupt file ${entry}:`, err);
      }
    }
    return loaded;
  }

  /** Delete a session's file from disk (called when it expires). */
  async remove(id: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(id));
    } catch {
      /* already gone */
    }
  }
}
