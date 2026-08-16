import type { CreateSessionResponse, SessionInfo } from "@codesession/shared";

/**
 * Thin wrapper over the session-server REST API. In dev, Vite proxies /api to
 * the server, so we can use same-origin relative URLs everywhere.
 */

/** Create a new session (defaults to Python). */
export async function createSession(): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language: "python" }),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
  return res.json();
}

/** Fetch metadata for an existing session, or null if it no longer exists. */
export async function getSession(id: string): Promise<SessionInfo | null> {
  const res = await fetch(`/api/sessions/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
  const body = (await res.json()) as { session: SessionInfo };
  return body.session;
}
