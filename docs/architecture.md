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

## How code execution works (Phase 2)

Running a program touches all three services:

1. **Browser** — a participant clicks **Run**. The web app sends `{type:"run"}`
   over a dedicated **control WebSocket** (`/control/<id>`), which is separate
   from the Yjs sync socket (the Yjs client binary-decodes every frame, so we
   can't multiplex JSON control messages onto it).
2. **session-server** — reads the current code straight from the session's Yjs
   document (so everyone runs exactly what's on screen), POSTs it to the
   execution-service, and fans the streamed output to **every** control socket
   in the session. That's why all participants see identical output at once.
3. **execution-service (Go)** — pulls a pre-started container from the warm
   pool, writes the code to the container's scratch dir, `docker exec`s
   `python`, and streams stdout/stderr back as NDJSON. One run per session; a
   run is cancellable via `/stop`.

### How the sandbox works (the security controls)

Every run happens in a Docker container created with defense-in-depth limits
(see `internal/sandbox/container.go`). No single control is trusted alone:

| Control | Setting | Stops |
|---|---|---|
| No network | `NetworkMode: none` + `NetworkDisabled` | data exfiltration, remote calls |
| Memory cap | `Memory = 256MB`, `MemorySwap = Memory` (swap off) | memory bombs (OOM-killed) |
| CPU cap | `NanoCPUs = 0.5 core` | CPU starvation of the host |
| Process cap | `PidsLimit = 128` | fork bombs |
| Read-only rootfs | `ReadonlyRootfs: true` | tampering with the image/binaries |
| Writable scratch only | size-capped `tmpfs` at `/scratch` (32MB) | filling the disk |
| Drop privileges | `CapDrop: ALL` + `no-new-privileges` | capability abuse, setuid escalation |
| Non-root user | image runs as uid 10001 `runner` | acting as root inside the container |
| Wall-clock timeout | 30s (configurable) then force-remove | infinite loops / hangs |

The container is **single-use**: a warm container serves exactly one run and is
then destroyed, so no state leaks from one user's run to the next.

### Warm pool

Creating and starting a container on the request path costs ~130ms; execing into
a pre-warmed one costs ~60ms. The pool keeps N containers started and idle,
hands one out per run, and spawns a replacement in the background. See
`docs/metrics.md` for the measured before/after numbers.

## The AI coding agent (Phase 3)

A fourth service, the **agent-server** (Node + TS), runs an AI coding agent that
participates in a session as a first-class collaborator.

### The project model

To support multi-file projects, a session's document holds a Yjs `Y.Map` named
`files` mapping `path -> Y.Text`. Each file is its own collaborative text, so
humans and the agent edit files through the same CRDT and converge — no one
silently overwrites anyone else. The editor binds to one file at a time (file
tabs switch between them). `packages/shared/src/project.ts` is the single source
of truth for this shape, used by the web client, session-server, and agent-server.

### The agent loop

```
user prompt (agent_task over control WS)
   → session-server → agent-server
        connect to the session's Yjs doc as a collaborator
        ┌─────────────────────────────────────────────┐
        │ retrieve context (relevance-ranked files)   │
        │   → LLM → ONE structured action (JSON)      │
        │   → apply edit via Yjs txn (stale-checked)  │
        │   → run project tests in the Go sandbox     │
        │   → tests pass? finish : feed errors back   │
        └──────────────── retry (budgeted) ───────────┘
   ← agent.* events streamed back → fanned to all clients
```

Key properties:

- **Collaborative edits.** The agent joins the doc via `y-websocket` with its
  own client id and shows up in the presence list as *CodeSession Agent*. Its
  edits flow through the normal sync pipeline, so humans see them live.
- **Structured actions.** The model never touches files directly — it emits one
  JSON action (`edit_file`, `create_file`, `run_command`, `finish`) which we
  validate, apply, audit, and render in the UI.
- **Stale-context guard.** Before applying a patch, the agent compares the
  file's version to what it saw when building context. If a human changed that
  file meanwhile, the patch is rejected and the agent re-reads and regenerates —
  it never clobbers newer human work.
- **Untrusted like any code.** The agent's edits are executed through the exact
  same locked-down Go/Docker sandbox as human Run requests.
- **Budgets.** Iterations, executions, wall-clock, and tokens are all capped so
  the agent can't loop or spend without bound.
- **Pluggable LLM.** An `LLMProvider` interface with an Anthropic implementation
  and a deterministic `mock` provider, so the whole loop runs (and is tested)
  with no API key or cost.
