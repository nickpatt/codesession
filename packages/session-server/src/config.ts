/**
 * Centralized runtime configuration, read from environment variables with
 * sensible defaults for local development. Keeping this in one place makes the
 * server easy to reason about and to deploy.
 */
export const config = {
  /** HTTP + WebSocket port. */
  port: Number(process.env.PORT ?? 8080),

  /** Comma-separated list of allowed CORS origins ("*" allows all). */
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  /** Directory where session snapshots are persisted between restarts. */
  dataDir: process.env.DATA_DIR ?? "./data",

  /** How often (ms) to flush active sessions to disk. */
  persistIntervalMs: Number(process.env.PERSIST_INTERVAL_MS ?? 5_000),

  /** How often (ms) to sweep for expired sessions. */
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 60_000),

  /** Grace period (ms) a session survives after the last participant leaves. */
  sessionTtlMs: Number(process.env.SESSION_TTL_MS ?? 24 * 60 * 60 * 1000),

  /** Base URL of the execution-service that runs code (Phase 2). */
  execUrl: process.env.EXEC_URL ?? "http://localhost:9090",
} as const;
