# agent-server (Phase 3)

The CodeSession AI coding agent. Given a task like *"fix the failing tests,"* it
retrieves relevant context, asks an LLM for a structured edit, applies it to the
shared project through Yjs (as a real collaborator), runs the tests in the Go
sandbox, and iterates until they pass or a budget is hit.

## Why a separate service

Keeps the agent loop (LLM calls, retries, budgets) isolated from the collab
server. It talks to a session's document exactly like a browser does — over
`y-websocket` — which is what makes agent edits merge with human edits instead
of clobbering them.

## Flow

```
POST /task {sessionId, prompt}  → NDJSON stream of agent.* events
  connect to session Yjs doc (own client id, shows as "CodeSession Agent")
  loop (budgeted):
    retrieve context → LLM → structured action
    → apply edit via Yjs txn (stale-checked) → run pytest in sandbox
    → pass? finish : feed errors back and retry
POST /cancel {sessionId}        → stop the active task
```

## Structured actions

The model must reply with ONE JSON action, which we validate before applying:

```
edit_file | create_file | run_command | read_file | finish
```

## LLM provider

`LLM_PROVIDER=mock` (default) uses a deterministic, no-cost provider so the loop
runs in tests/CI. `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` uses a real
model.

## Budgets (safety rails)

`AGENT_MAX_ITERATIONS` (5), `AGENT_MAX_EXECUTIONS` (8), `AGENT_MAX_RUNTIME_MS`
(120s), `AGENT_MAX_CONTEXT_TOKENS` (20k). See `src/config.ts`.

## Layout

```
src/
  llm/          provider interface + Anthropic + mock
  session/      Yjs project client (agent-as-collaborator) + exec client
  agent/        context retrieval, prompt, structured actions, patcher,
                orchestrator (the loop), task manager
  index.ts      HTTP: POST /task (stream), POST /cancel, /health
```
