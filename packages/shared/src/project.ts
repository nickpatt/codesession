import * as Y from "yjs";

/**
 * Shared representation of a session's project inside a Yjs document.
 *
 * A project is a map of file path -> file text, stored as a Y.Map whose values
 * are Y.Text. Because each file is a Y.Text, humans and the AI agent edit files
 * through the same CRDT machinery and converge without overwriting each other.
 *
 * These helpers are the single source of truth for the doc shape, used by the
 * web client, the session-server, and the agent-server alike.
 */

/** Name of the Y.Map holding the project's files. */
export const FILES_KEY = "files";

/** Default file a fresh session starts with. */
export const DEFAULT_FILE = "main.py";

/** Get (or lazily create) the project's file map. */
export function getFiles(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>(FILES_KEY);
}

/** List the file paths currently in the project, sorted for stable display. */
export function listFiles(doc: Y.Doc): string[] {
  return [...getFiles(doc).keys()].sort();
}

/** Read a file's text, or undefined if it doesn't exist. */
export function readFile(doc: Y.Doc, path: string): string | undefined {
  const t = getFiles(doc).get(path);
  return t ? t.toString() : undefined;
}

/**
 * Get the Y.Text for a path, creating an empty file if needed. Returns the live
 * Y.Text so callers can bind an editor or apply incremental edits to it.
 */
export function getOrCreateFile(doc: Y.Doc, path: string): Y.Text {
  const files = getFiles(doc);
  let t = files.get(path);
  if (!t) {
    t = new Y.Text();
    files.set(path, t);
  }
  return t;
}

/**
 * Snapshot the whole project as a plain object (path -> contents). Used when
 * sending the project to the sandbox for execution.
 */
export function snapshotProject(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  getFiles(doc).forEach((text, path) => {
    out[path] = text.toString();
  });
  return out;
}
