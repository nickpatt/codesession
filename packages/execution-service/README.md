# execution-service (Phase 2)

Sandboxed execution of untrusted Python, written in Go.

> **Status:** scaffold only. The Run button and sandbox land in Phase 2.

## Why Go here

The session-server is Node because Yjs lives in the JS ecosystem. This service
has a different job — orchestrating Docker containers and streaming their output
— and Go is a clean fit for that: strong concurrency primitives for the warm
pool and output fan-out, and a solid Docker SDK.

## Planned design

- Receive `{ code, sessionId }`, run it, stream stdout/stderr back live.
- Each run executes in its **own Docker container** with:
  - CPU capped (~0.5 core)
  - Memory capped (~256 MB, OOM-kill on breach)
  - Wall-clock timeout (~30s, then killed)
  - **No network** inside the container
  - Read-only filesystem except a small scratch dir
- A **warm pool** of pre-started containers so runs feel instant.
- One run per session at a time; running/queued jobs are cancellable (Stop).

## Hostile test suite (Phase 2 acceptance)

Each of these must be contained, and there'll be a test proving it:

- infinite loop → killed at timeout
- memory bomb → OOM-killed
- outbound network call → fails (no network)
- fork bomb → contained by pids limit

## Layout (planned)

```
cmd/server/        entrypoint (HTTP/RPC + streaming)
internal/sandbox/  container lifecycle + resource limits
internal/pool/     warm container pool
internal/run/      per-session run queue + cancellation
```
