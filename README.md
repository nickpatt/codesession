# CodeSession

*A real-time collaborative coding platform with live code execution.*

Share a link, code together with live cursors, hit **Run**, and everyone sees the
output — like a lightweight multiplayer Replit.

> **Status:** Phases 1–3 shippable. Real-time collaboration + sandboxed Python
> execution + an **AI coding agent** that edits the shared project as a
> collaborator, runs the tests in the sandbox, and iterates until they pass.

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

See [`docs/metrics.md`](docs/metrics.md) for methods and full results.

| Metric | Method | Value |
|---|---|---|
| Sync latency (p50/p95) | Timestamp edit leaving one client → arriving at another | _TBD_ |
| Editors per session sustained | N headless clients typing concurrently | _TBD_ |
| Warm vs. cold run latency (to first output byte) | `cmd/bench`, 15 runs each | cold p50 130ms → **warm p50 59ms** (~55% faster) |
| Sandbox escapes contained | Hostile-snippet suite | **4 / 4** (loop, mem bomb, network, fork bomb) |

---

## Running code (Phase 2)

The execution-service runs Python in locked-down Docker containers. See
[`docs/architecture.md`](docs/architecture.md) for the full "how the sandbox
works" write-up.

```bash
# 1. build the sandbox runner image
docker build -t codesession-runner:latest packages/execution-service/sandbox

# 2. start the execution-service (needs Docker running)
cd packages/execution-service && go run ./cmd/server   # listens on :9090

# 3. start session-server + web as usual (npm run dev)
```

Prove the sandbox contains hostile code:

```bash
cd packages/execution-service
go test ./internal/sandbox -run Hostile -v   # 4/4 contained
go run ./cmd/bench                           # warm vs cold latency
```

---

## Roadmap

- [x] **Phase 1 — Collaboration:** create/join, Yjs sync, cursors, presence,
      reconnect, persistence + 24h expiry.
- [x] **Phase 2 — Execution:** Docker sandbox (CPU/mem/pids/timeout/no-net/
      read-only fs), streamed output to all clients, Stop, warm pool.
- [x] **Phase 3 — AI coding agent:** multi-file projects; an agent that joins
      the Yjs doc as a collaborator, retrieves context, makes structured edits
      (stale-checked), runs pytest in the sandbox, and iterates within budgets.
      Pluggable LLM (Anthropic + deterministic mock).
- [ ] **Later:** custom CRDT write-up, agent benchmark/eval harness, JS support,
      per-IP rate limiting.

## AI agent (Phase 3)

The agent-server runs the agent loop. It defaults to a deterministic **mock**
provider so the whole flow works with no API key; set `LLM_PROVIDER=anthropic`
and `ANTHROPIC_API_KEY=...` to use a real model.

```bash
# with session-server + execution-service already running:
LLM_PROVIDER=mock npm run dev:agent      # agent-server on :7070
```

In a session, open the **AI Agent** panel, enter a task (a starter project ships
with a deliberately failing test), and click *Run Agent*. Watch it read context,
edit `src/calc.py` through the shared document, run the tests, and finish. See
[`docs/architecture.md`](docs/architecture.md) for the full design.

## License

MIT
