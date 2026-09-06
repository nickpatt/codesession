/**
 * Runtime configuration for the agent-server, with defaults tuned for local
 * development. The budget knobs here are the safety rails that stop a runaway
 * agent from looping or spending forever (spec section 12).
 */
export const config = {
  /** HTTP port the agent-server listens on. */
  port: Number(process.env.AGENT_PORT ?? 7070),

  /** Base URL of the session-server, used to connect to session Yjs docs. */
  sessionServerUrl: process.env.SESSION_SERVER_URL ?? "http://localhost:8080",

  /** WebSocket base of the session-server for y-websocket. */
  sessionWsUrl: process.env.SESSION_WS_URL ?? "ws://localhost:8080/ws",

  /** Base URL of the Go execution-service. */
  execUrl: process.env.EXEC_URL ?? "http://localhost:9090",

  // --- LLM provider ---
  /** Which provider to use: "anthropic" or "mock" (deterministic, no cost). */
  llmProvider: (process.env.LLM_PROVIDER ?? "mock") as "anthropic" | "mock",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",

  // --- Agent execution budget (safety rails) ---
  /** Max plan/execute iterations before giving up. */
  maxIterations: Number(process.env.AGENT_MAX_ITERATIONS ?? 5),
  /** Max sandbox executions across a task. */
  maxExecutions: Number(process.env.AGENT_MAX_EXECUTIONS ?? 8),
  /** Overall wall-clock budget for a task (ms). */
  maxRuntimeMs: Number(process.env.AGENT_MAX_RUNTIME_MS ?? 120_000),
  /** Approximate token budget for project context per task. */
  maxContextTokens: Number(process.env.AGENT_MAX_CONTEXT_TOKENS ?? 20_000),
} as const;
