import { config } from "../config.js";

/** Result of running the project in the sandbox. */
export interface ExecResult {
  exitCode: number;
  reason?: string;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Calls the Go execution-service to run the project's tests in the sandbox and
 * collects the streamed NDJSON output into a single result. The agent treats
 * this output as the ground truth for whether its edits worked.
 *
 * `onOutput` is invoked for each chunk so the orchestrator can forward live
 * output to collaborators as it streams.
 */
export async function runProject(
  sessionId: string,
  files: Record<string, string>,
  onOutput: (stream: "stdout" | "stderr", data: string) => void,
  signal?: AbortSignal,
): Promise<ExecResult> {
  const start = Date.now();
  const res = await fetch(`${config.execUrl}/run-project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, files }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`execution-service responded ${res.status}`);
  }

  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let reason: string | undefined;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      const ev = JSON.parse(line) as {
        type: string;
        data?: string;
        exitCode?: number;
        reason?: string;
      };
      if (ev.type === "stdout") {
        stdout += ev.data ?? "";
        onOutput("stdout", ev.data ?? "");
      } else if (ev.type === "stderr") {
        stderr += ev.data ?? "";
        onOutput("stderr", ev.data ?? "");
      } else if (ev.type === "exit") {
        exitCode = ev.exitCode ?? 0;
        reason = ev.reason;
      } else if (ev.type === "error") {
        stderr += ev.data ?? "";
        exitCode = 1;
        reason = "executor error";
      }
    }
  }

  return { exitCode, reason, stdout, stderr, durationMs: Date.now() - start };
}
