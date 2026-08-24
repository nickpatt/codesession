# Metrics

Numbers turn "I built a thing" into resume bullets. These get filled in with
real measurements as each capability lands.

| Metric | How it's measured | Value |
|---|---|---|
| Sync latency (p50 / p95) | Timestamp an edit leaving one client and arriving at another; aggregate over many edits | _TBD (Phase 1 benchmark)_ |
| Editors per session sustained | Script N headless clients typing concurrently, watch for convergence + latency degradation | _TBD_ |
| Warm vs. cold run latency | Time from Run click to first output byte, warm pool on vs. off | _Phase 2_ |
| Sandbox escape attempts contained | Hostile-snippet suite (infinite loop, memory bomb, network call, fork bomb) — all must be contained | _Phase 2_ |

## Method notes

- **Sync latency:** embed a monotonic timestamp in a tiny Yjs update from
  client A; on client B, on receiving that update, record `now - timestamp`.
  Report p50/p95 over a scripted typing session.
- **Concurrency:** a Node script spins up N `y-websocket` clients against one
  session, each inserting characters on an interval; success = all clients
  converge to the same final text.
