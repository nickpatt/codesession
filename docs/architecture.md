# Architecture

CodeSession is a small monorepo with three services. Phase 1 (shipped) covers
the first two; Phase 2 adds the execution service.

```
 ┌──────────────────────────────┐
 │ web  (React + TypeScript)    │
 │  • CodeMirror 6 editor       │
 │  • Yjs client (y-websocket)  │
 │  • presence + remote cursors │
 └───────────────┬──────────────┘
                 │  one WebSocket per session:  /ws/<sessionId>
                 │  REST for create/lookup:     /api/sessions
                 ▼
 ┌──────────────────────────────┐
 │ session-server (Node + TS)   │
 │  • SessionStore (membership) │
 │  • DocManager (Yjs per room) │
 │  • sync + awareness relay    │
 │  • disk persistence + expiry │
 └───────────────┬──────────────┘
                 │  (Phase 2) run RPC: code + sessionId → streamed output
                 ▼
 ┌──────────────────────────────┐
 │ execution-service (Go)       │   ← Phase 2 (scaffold present)
 │  • per-run Docker container  │
 │  • CPU/mem/timeout caps      │
 │  • no network, ro filesystem │
 │  • warm container pool       │
 └──────────────────────────────┘
```

## How collaborative sync works (Phase 1)

1. Each session has exactly one **Yjs document** on the server (`DocManager`).
   Yjs is a CRDT: concurrent edits merge deterministically, so two people
   typing on the same line always converge to identical text.
2. The client connects one WebSocket to `/ws/<sessionId>`. On connect, the
   server sends **SyncStep1** (its state vector); the client replies with the
   edits the server is missing, and vice versa. After that, every local edit is
   broadcast as an incremental update.
3. A second channel, **awareness**, carries ephemeral presence (each user's
   name, color, cursor, and selection). It is *not* part of the document and is
   cleared automatically when a client disconnects — that's how the presence
   list and remote cursors stay accurate.
4. **Reconnect:** `y-websocket` reconnects with backoff. Edits made while
   offline are buffered locally and replayed on reconnect; we re-assert our
   awareness `user` field on the `sync` event so our cursor reappears.

## Persistence & expiry

- Every few seconds the server snapshots each in-memory Yjs document
  (`Y.encodeStateAsUpdate`, base64) plus session metadata to
  `data/<id>.session.json`. On boot it loads them back, so a restart doesn't
  wipe active sessions.
- A session lives while anyone is connected. When the last person leaves, a
  24h TTL starts; a periodic sweep reaps expired, empty sessions (in-memory doc
  torn down + file deleted).

## Why not `y-websocket`'s bundled server?

We implement the sync/awareness wire protocol by hand in `collab.ts` (~150
lines) so the mechanism is visible and explainable rather than a black box.
It still speaks the exact protocol the standard client expects.
