import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { colorForClient } from "@codesession/shared";

/** Connection status surfaced to the UI. */
export type ConnStatus = "connecting" | "connected" | "disconnected";

/**
 * Everything a component needs to render a collaborative session: the shared
 * text, the awareness provider (cursors/presence), and the live status.
 */
export interface Collab {
  doc: Y.Doc;
  provider: WebsocketProvider;
  /** The shared code buffer. CodeMirror binds directly to this Y.Text. */
  text: Y.Text;
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
    const text = doc.getText("code");

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
      if (isSynced) provider.awareness.setLocalStateField("user", userField);
    };
    provider.on("sync", onSync);

    const collabValue: Collab = {
      doc,
      provider,
      text,
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
