import type { ProjectContext } from "./context.js";
import type { ExecResult } from "../session/execClient.js";

/**
 * Prompt construction for the agent.
 *
 * The system prompt pins the model to a strict output contract: reply with ONE
 * structured JSON action. This keeps responses parseable and safe to apply.
 */
export const SYSTEM_PROMPT = `You are CodeSession Agent, an AI pair programmer editing a shared Python project.

You work in a loop: you are shown the relevant files and the latest test output,
then you reply with exactly ONE action to take next. Repeat until tests pass.

Respond with a single JSON object in a \`\`\`json code block, and nothing else.
Supported actions:

{ "action": "edit_file", "path": "src/x.py", "changes": [ { "startLine": 12, "endLine": 12, "replacement": "    return a + b" } ] }
{ "action": "create_file", "path": "src/y.py", "content": "..." }
{ "action": "run_command" }            // run the project's tests
{ "action": "finish", "summary": "..." } // when the task is complete

Rules:
- Line numbers are 1-indexed and INCLUSIVE, matching the numbered file view.
- Make the smallest change that fixes the problem.
- Prefer edit_file over rewriting whole files.
- After editing, the harness runs the tests automatically; you do not need to
  emit run_command right after an edit.
- When the tests pass, reply with a finish action.`;

/** Render a file with 1-indexed line numbers so the model can target lines. */
function numberLines(content: string): string {
  return content
    .split("\n")
    .map((line, i) => `${i + 1}|${line}`)
    .join("\n");
}

/**
 * Build the user message for one iteration: the task, the selected files (with
 * line numbers), and the most recent execution output if any.
 */
export function buildUserMessage(
  prompt: string,
  context: ProjectContext,
  lastResult: ExecResult | null,
): string {
  const parts: string[] = [];
  parts.push(`TASK: ${prompt}`);
  parts.push("");
  parts.push("PROJECT FILES (relevant subset, line-numbered):");
  for (const f of context.files) {
    parts.push(`=== FILE ${f.path} ===`);
    parts.push(numberLines(f.content));
  }

  if (lastResult) {
    parts.push("");
    parts.push("EXECUTION RESULT (most recent test run):");
    parts.push(`exit code: ${lastResult.exitCode}`);
    if (lastResult.stdout.trim()) {
      parts.push("--- stdout ---");
      parts.push(truncate(lastResult.stdout, 4000));
    }
    if (lastResult.stderr.trim()) {
      parts.push("--- stderr ---");
      parts.push(truncate(lastResult.stderr, 4000));
    }
  }

  parts.push("");
  parts.push("Reply with ONE JSON action.");
  return parts.join("\n");
}

/** Keep long output within a sane size for the prompt. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…(${s.length - max} more chars truncated)`;
}
