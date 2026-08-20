import type { Participant } from "../collab/usePresence.js";

/**
 * Renders the "N people here" indicator plus a colored pill per participant,
 * matching each person's cursor color so the editor and the roster line up.
 */
export function PresenceList({ participants }: { participants: Participant[] }) {
  const count = participants.length;
  return (
    <div className="presence" title={`${count} connected`}>
      <span className="status">
        {count} {count === 1 ? "person" : "people"} here
      </span>
      {participants.map((p) => (
        <span className="pill" key={p.clientId}>
          <span className="dot" style={{ background: p.color }} />
          {p.name}
          {p.isSelf ? " (you)" : ""}
        </span>
      ))}
    </div>
  );
}
