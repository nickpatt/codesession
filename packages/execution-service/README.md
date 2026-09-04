# execution-service (Phase 2)

Sandboxed execution of untrusted Python, written in Go.

> **Status:** implemented. Streams output over NDJSON, enforces CPU/mem/pids/
> timeout/no-network/read-only-fs limits, and keeps a warm container pool.
> Hostile-snippet suite passes 4/4.

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

## Layout

```
cmd/server/        entrypoint: wires docker → pool → run manager → HTTP
cmd/bench/         warm-vs-cold latency benchmark
sandbox/           Dockerfile for the locked-down python runner image
internal/config/   env-driven config + sandbox limits
internal/sandbox/  container lifecycle, resource limits, exec + streaming
internal/pool/     warm container pool (one-use, refills in background)
internal/run/      per-session single-run manager + cancellation
internal/httpapi/  POST /run (NDJSON stream), POST /stop, /health
```

## Endpoints

- `POST /run`  — body `{sessionId, code}`; responds with an
  `application/x-ndjson` stream of `{type: stdout|stderr|exit|error, ...}`.
- `POST /stop` — body `{sessionId}`; cancels the active run.
- `GET  /health`

## Try it

```bash
docker build -t codesession-runner:latest ./sandbox
go run ./cmd/server                          # :9090
go test ./internal/sandbox -run Hostile -v   # containment proof (4/4)
go run ./cmd/bench                            # latency numbers
```
