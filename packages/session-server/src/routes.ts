import { Router } from "express";
import type { Language, CreateSessionResponse } from "@codesession/shared";
import type { SessionStore } from "./sessions.js";

/**
 * REST API for session lifecycle. Deliberately tiny: sessions are anonymous
 * and link-based, so "create" and "look up" are all we need. Joining happens
 * over the WebSocket, not here.
 */
export function createRoutes(store: SessionStore): Router {
  const router = Router();

  /**
   * POST /api/sessions — create a new session.
   * Body: { language?: "python" | "javascript" } (defaults to python).
   * Returns the session metadata; the client builds the shareable URL from id.
   */
  router.post("/sessions", (req, res) => {
    const language = (req.body?.language as Language) ?? "python";
    if (language !== "python" && language !== "javascript") {
      return res.status(400).json({ error: "unsupported language" });
    }
    const session = store.create(language);
    const body: CreateSessionResponse = { session: session.info };
    res.status(201).json(body);
  });

  /**
   * GET /api/sessions/:id — fetch metadata for an existing session so the
   * client can show language/created time and confirm the link is still valid.
   */
  router.get("/sessions/:id", (req, res) => {
    const session = store.get(req.params.id);
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json({ session: session.info });
  });

  return router;
}
