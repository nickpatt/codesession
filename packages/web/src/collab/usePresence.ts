import { useEffect, useState } from "react";
import type { WebsocketProvider } from "y-websocket";

/** One participant currently in the session. */
export interface Participant {
  clientId: number;
  name: string;
  color: string;
  /** True for the local user, so the UI can label "(you)". */
  isSelf: boolean;
}

/**
 * Subscribes to Yjs awareness and returns the current list of participants.
 *
 * Awareness is Yjs's ephemeral, presence-only channel: it isn't part of the
 * document, it's automatically cleared when a client disconnects, and it's how
 * we know "who is here right now." We re-read it whenever it changes.
 */
export function usePresence(provider: WebsocketProvider | null): Participant[] {
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    if (!provider) return;
    const { awareness } = provider;

    const read = () => {
      const list: Participant[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const user = (state as { user?: { name: string; color: string } }).user;
        if (!user) return; // ignore clients that haven't set a user yet
        list.push({
          clientId,
          name: user.name,
          color: user.color,
          isSelf: clientId === awareness.clientID,
        });
      });
      // Stable ordering: self first, then by name.
      list.sort((a, b) =>
        a.isSelf === b.isSelf ? a.name.localeCompare(b.name) : a.isSelf ? -1 : 1,
      );
      setParticipants(list);
    };

    read();
    awareness.on("change", read);
    return () => awareness.off("change", read);
  }, [provider]);

  return participants;
}
