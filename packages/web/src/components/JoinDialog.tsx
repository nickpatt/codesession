import { useState } from "react";

/** A few friendly defaults so users can join in one click if they want. */
const SUGGESTED = ["Otter", "Falcon", "Maple", "Comet", "Willow", "Pixel"];

/**
 * Modal shown when someone opens a session link without a saved display name.
 * Collecting a name up front means every cursor in the editor is labeled,
 * which is what makes "see who's typing where" feel real.
 */
export function JoinDialog({ onJoin }: { onJoin: (name: string) => void }) {
  const [name, setName] = useState(
    () => SUGGESTED[Math.floor(Math.random() * SUGGESTED.length)],
  );

  function submit() {
    const trimmed = name.trim();
    if (trimmed) onJoin(trimmed.slice(0, 24));
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>Join session</h2>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Pick a display name so others can see your cursor.
        </p>
        <input
          autoFocus
          value={name}
          maxLength={24}
          placeholder="Your name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button onClick={submit} disabled={!name.trim()} style={{ width: "100%" }}>
          Start editing
        </button>
      </div>
    </div>
  );
}
