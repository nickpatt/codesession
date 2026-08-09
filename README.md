# CodeSession

*A real-time collaborative coding platform with live code execution.*

Share a link, code together with live cursors, hit **Run**, and everyone sees the
output — like a lightweight multiplayer Replit.

> **Status:** Phase 1 (Collaboration) — shippable. Phase 2 (Execution) in progress.

---

## What it does

- **Create a session** — click *New Session*, get a shareable URL.
- **Join a session** — open the link, pick a display name, start editing.
- **Edit together** — multiple people type at once; everyone converges to the same
  text via a CRDT (Yjs). Remote cursors and selections show up live in distinct colors.
- **Reconnect-safe** — refresh or drop wifi and you rejoin without losing edits.
- **Sessions expire** — kept alive while anyone is connected, plus 24h after the
  last person leaves, then cleaned up.

Phase 2 adds a **Run** button that executes Python in a locked-down Docker
sandbox and streams output to everyone.

---

## Architecture

```
                    ┌──────────────────────┐
   browser  ◄─────► │  web (React + TS)    │
   (CodeMirror 6)   │  CodeMirror + Yjs    │
                    └──────────┬───────────┘
                               │ 1 WebSocket / session
                               ▼
                    ┌──────────────────────┐
                    │  session-server      │   Node + TS
                    │  • create/join       │
                    │  • Yjs sync relay    │
                    │  • presence          │
                    │  • persistence+expiry│
                    └──────────┬───────────┘
                               │ (Phase 2) run RPC
                               ▼
                    ┌──────────────────────┐
                    │  execution-service   │   Go (Phase 2)
                    │  • per-run container │
                    │  • CPU/mem/timeout   │
                    │  • no network        │
                    │  • warm pool         │
                    └──────────────────────┘
```

### Why these choices

- **Yjs for sync** — industry-standard CRDT (Notion-style tools work this way).
  Ship correct sync fast; a from-scratch CRDT write-up is a Phase 3 stretch goal.
- **CodeMirror 6** — lighter than Monaco with first-class collaboration bindings.
- **Node for session-server** — Yjs and `y-websocket` are native to the JS
  ecosystem; fighting the sync protocol in another language isn't worth it here.
- **Go for execution-service** — Docker orchestration, streaming, and the warm
  pool are clean in Go; right tool for that job (Phase 2).

---

## Repo layout

```
packages/
  shared/            Shared TypeScript types (protocol, session models)
  session-server/    Node + TS: sessions, Yjs relay, persistence, expiry
  web/               React + Vite + TS: editor UI, presence, cursors
  execution-service/ Go: sandboxed Python runner (Phase 2, scaffold)
docs/                Architecture notes, metrics
```

## Getting started

Requires Node 20+ (developed on Node 26).

```bash
npm install
npm run dev        # starts session-server (:8080) and web (:5173)
```

Open <http://localhost:5173>, click **New Session**, copy the URL into a second
window, and type in both — they converge.

---

## Metrics

Real numbers get filled in as each phase lands (see the spec's measurement plan).

| Metric | Method | Value |
|---|---|---|
| Sync latency (p50/p95) | Timestamp edit leaving one client → arriving at another | _TBD_ |
| Editors per session sustained | N headless clients typing concurrently | _TBD_ |
| Warm vs. cold run latency | Run click → first output byte, pool on/off | _Phase 2_ |
| Sandbox escapes contained | Hostile-snippet test suite | _Phase 2_ |

---

## Roadmap

- [x] **Phase 1 — Collaboration:** create/join, Yjs sync, cursors, presence,
      reconnect, persistence + 24h expiry.
- [ ] **Phase 2 — Execution:** Docker sandbox, streamed output, Stop, warm pool.
- [ ] **Phase 3 — Stretch:** custom CRDT write-up, benchmarks, JS support,
      session replay, per-IP rate limiting.

## License

MIT
