import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import WebSocket from "ws";
import {
  AGENT_IDENTITY,
  getOrCreateFile,
  listFiles,
  readFile,
  snapshotProject,
} from "@codesession/shared";
import { config } from "../config.js";

/**
 * Connects the agent to a session's collaborative document as its own Yjs
 * client, exactly like a human editor. This is what makes the agent a real
 * collaborator: its edits flow through the same CRDT + WebSocket pipeline, so
 * humans see them live and concurrent edits merge instead of clobbering.
 */
export class ProjectClient {
  readonly doc: Y.Doc;
  private readonly provider: WebsocketProvider;

  private constructor(doc: Y.Doc, provider: WebsocketProvider) {
    this.doc = doc;
    this.provider = provider;
  }

  /** Connect to a session and wait for the initial sync to complete. */
  static async connect(sessionId: string): Promise<ProjectClient> {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(config.sessionWsUrl, sessionId, doc, {
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      connect: true,
    });

    // Present ourselves as a distinct collaborator in the presence list.
    provider.awareness.setLocalStateField("user", {
      name: AGENT_IDENTITY.name,
      color: AGENT_IDENTITY.color,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out connecting to session doc")),
        10_000,
      );
      provider.once("sync", (isSynced: boolean) => {
        if (isSynced) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    return new ProjectClient(doc, provider);
  }

  /** Current file paths in the project. */
  files(): string[] {
    return listFiles(this.doc);
  }

  /** Read one file's contents. */
  read(path: string): string | undefined {
    return readFile(this.doc, path);
  }

  /** Snapshot the whole project (path -> contents) for sandbox execution. */
  snapshot(): Record<string, string> {
    return snapshotProject(this.doc);
  }

  /**
   * A cheap version stamp of a file, used to detect whether a human changed it
   * between when the agent read context and when it tries to apply a patch.
   * We use the current text length + a hash-free content compare at apply time.
   */
  fileVersion(path: string): string {
    const text = this.read(path) ?? "";
    return `${text.length}:${simpleHash(text)}`;
  }

  /**
   * Replace an inclusive 1-indexed line range in a file with new text, as a
   * single Yjs transaction tagged with the agent's origin. Returns false if the
   * file no longer exists.
   */
  applyLineEdit(
    path: string,
    startLine: number,
    endLine: number,
    replacement: string,
  ): boolean {
    const text = getOrCreateFile(this.doc, path);
    const current = text.toString();
    const lines = current.split("\n");

    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      return false;
    }

    // Compute the character offset of the start of `startLine` and the end of
    // `endLine`, so we can splice precisely within the shared Y.Text.
    const startOffset = offsetOfLine(lines, startLine);
    const endOffset =
      offsetOfLine(lines, endLine) + lines[endLine - 1].length;

    this.doc.transact(() => {
      text.delete(startOffset, endOffset - startOffset);
      text.insert(startOffset, replacement);
    }, "agent"); // origin tag identifies edits as the agent's

    return true;
  }

  /** Create (or overwrite) a file with the given contents in one transaction. */
  writeFile(path: string, content: string): void {
    const text = getOrCreateFile(this.doc, path);
    this.doc.transact(() => {
      if (text.length > 0) text.delete(0, text.length);
      text.insert(0, content);
    }, "agent");
  }

  /** Disconnect from the session. */
  destroy(): void {
    this.provider.awareness.setLocalState(null);
    this.provider.destroy();
    this.doc.destroy();
  }
}

/** Character offset of the start of a 1-indexed line within split lines. */
function offsetOfLine(lines: string[], lineNo: number): number {
  let offset = 0;
  for (let i = 0; i < lineNo - 1; i++) {
    offset += lines[i].length + 1; // +1 for the newline
  }
  return offset;
}

/** Tiny non-cryptographic hash for change detection (djb2). */
function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
