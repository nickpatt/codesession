import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSession } from "../api.js";

/**
 * Landing page. One button: create a new session, then navigate straight into
 * its editor. The shareable URL is whatever the browser lands on (/s/:id).
 */
export function HomePage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleNew() {
    setCreating(true);
    setError(null);
    try {
      const { session } = await createSession();
      navigate(`/s/${session.id}`);
    } catch {
      setError("Couldn't create a session. Is the server running?");
      setCreating(false);
    }
  }

  return (
    <div className="home">
      <h1>CodeSession</h1>
      <p>Share a link, code together in real time, run it live.</p>
      <p style={{ marginTop: "2rem" }}>
        <button onClick={handleNew} disabled={creating}>
          {creating ? "Creating…" : "New Session"}
        </button>
      </p>
      {error && <p style={{ color: "#e11d48" }}>{error}</p>}
    </div>
  );
}
