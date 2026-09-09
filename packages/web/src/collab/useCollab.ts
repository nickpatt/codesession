import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { colorForClient, getFiles } from "@codesession/shared";

/** Connection status surfaced to the UI. */
export type ConnStatus = "connecting" | "connected" | "disconnected";

/**
 * Everything a component needs to render a collaborative session: the shared
 * document (a multi-file project), the awareness provider (cursors/presence),
 * and the live status. The editor binds to one file within the project's file
 * map at a time.
 */
export interface Collab {
  doc: Y.Doc;
  provider: WebsocketProvider;
  status: ConnStatus;
}

/** Build the WebSocket base URL from the current page origin. */
function wsBase(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}

/**
 * React hook that wires up a Yjs document for a session and keeps it synced
 * with the server over a WebSocket.
 *
 * y-websocket handles the hard parts for us: the initial sync handshake, and
 * — importantly for Phase 1 — automatic reconnection with exponential backoff.
 * When the socket drops, edits are buffered locally and replayed on reconnect,
 * so a refresh or a wifi blip never loses work.
 */
export function useCollab(sessionId: string, name: string): Collab | null {
  const [collab, setCollab] = useState<Collab | null>(null);
  // Keep the provider in a ref so cleanup always tears down the right instance.
  const providerRef = useRef<WebsocketProvider | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();

    // The provider connects to  /ws/<sessionId>  (Vite proxies this in dev).
    // Passing the room name separately keeps the URL matching our server route.
    const provider = new WebsocketProvider(`${wsBase()}/ws`, sessionId, doc, {
      connect: true,
    });
    providerRef.current = provider;

    const userField = { name, color: colorForClient(doc.clientID) };

    // Advertise who we are so others can label our cursor. Color is derived
    // from our awareness clientID so it stays stable for this connection.
    provider.awareness.setLocalStateField("user", userField);

    // On (re)connect, re-assert our presence. y-websocket wipes remote
    // awareness when the socket drops; re-setting our user field on the "sync"
    // event guarantees our cursor reappears for everyone after a reconnect,
    // and that buffered document edits made while offline are flushed.
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      provider.awareness.setLocalStateField("user", userField);
      // Seed a starter project the first time a brand-new session syncs, so the
      // editor (and the agent) always have at least one file to work with.
      seedDefaultProject(doc);
    };
    provider.on("sync", onSync);

    const collabValue: Collab = {
      doc,
      provider,
      status: "connecting",
    };
    setCollab(collabValue);

    // Mirror provider status into React state so the UI can show connected /
    // reconnecting badges.
    const onStatus = ({ status }: { status: string }) => {
      setCollab((prev) =>
        prev ? { ...prev, status: status as ConnStatus } : prev,
      );
    };
    provider.on("status", onStatus);

    return () => {
      provider.off("status", onStatus);
      provider.off("sync", onSync);
      provider.awareness.setLocalState(null);
      provider.destroy();
      doc.destroy();
      providerRef.current = null;
    };
  }, [sessionId, name]);

  return collab;
}

/** Starter project: a tiny calculator plus a matching (failing) test, so the
 * demo of "ask the agent to fix the failing test" works out of the box. Only
 * applied if the project is still empty (first client into a new session). */
function seedDefaultProject(doc: Y.Doc): void {
  const files = getFiles(doc);
  if (files.size > 0) return;
  doc.transact(() => {
    const calc = new Y.Text();
    calc.insert(0, "def add(a, b):\n    return a - b\n");
    files.set("src/calc.py", calc);

    const test = new Y.Text();
    test.insert(
      0,
      "import sys\nsys.path.insert(0, 'src')\nfrom calc import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n",
    );
    files.set("tests/test_calc.py", test);
  });
}
