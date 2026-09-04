# Metrics

Numbers turn "I built a thing" into resume bullets. These get filled in with
real measurements as each capability lands.

| Metric | How it's measured | Value |
|---|---|---|
| Sync latency (p50 / p95) | Timestamp an edit leaving one client and arriving at another; aggregate over many edits | _TBD (Phase 1 benchmark)_ |
| Editors per session sustained | Script N headless clients typing concurrently, watch for convergence + latency degradation | _TBD_ |
| Warm vs. cold run latency (time to first output byte) | `cmd/bench`, 15 runs each, warm pool vs. cold `docker create` | **cold p50 130ms / p95 139ms → warm p50 59ms / p95 76ms** (~55% faster) |
| Sandbox escape attempts contained | Hostile-snippet suite (infinite loop, memory bomb, network call, fork bomb) | **4 / 4 contained** ✅ |

## Warm vs. cold run latency

Measured with `go run ./cmd/bench` against the local Docker daemon (Apple
Silicon, Docker Desktop), 15 iterations per mode, measuring the time from
"start a run" to the first output byte:

```
COLD: p50=130ms p95=139ms min=123ms max=166ms (n=15)
WARM: p50=59ms  p95=76ms  min=56ms  max=78ms  (n=15)
```

"Cold" creates and starts a fresh container on the request path; "warm" pulls a
pre-started container from the pool and refills it in the background. The pool
roughly halves time-to-first-output.

> Note: these numbers are lower than the spec's ~1s estimate because we reuse an
> already-running container via `docker exec` rather than `docker run` per call,
> and the image is pre-pulled. The *relative* win from the pool is the headline.

## Sandbox containment (hostile suite)

`go test ./internal/sandbox -run Hostile -v` — each malicious snippet is proven
to be contained:

| Attack | Control that stops it | Observed result |
|---|---|---|
| Infinite loop (`while True`) | Wall-clock timeout → force-remove | killed at ~3s, `reason=timeout` |
| Memory bomb (alloc 1 GB vs 256 MB cap) | `--memory` + swap disabled → OOM | exit 137, `reason=out of memory` |
| Network call (`connect 1.1.1.1:53`) | `--network=none` | `OSError`, connection blocked |
| Fork bomb (`os.fork()` loop) | `--pids-limit=128` | `BlockingIOError` after ~126 procs |

## Method notes

- **Sync latency:** embed a monotonic timestamp in a tiny Yjs update from
  client A; on client B, on receiving that update, record `now - timestamp`.
  Report p50/p95 over a scripted typing session.
- **Concurrency:** a Node script spins up N `y-websocket` clients against one
  session, each inserting characters on an interval; success = all clients
  converge to the same final text.
