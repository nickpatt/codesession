import type { LLMProvider, LLMRequest, LLMResponse } from "./provider.js";
import { estimateTokens } from "./provider.js";

/**
 * Deterministic mock provider.
 *
 * It lets us exercise the entire agent loop — context → action → Yjs patch →
 * sandbox → retry — with no API key and no cost, which is essential for tests
 * and CI. It is NOT a real model: it uses simple heuristics over the context to
 * emit a valid structured action. It intentionally handles the classic
 * "operator typo" bug (e.g. a `-` that should be `+`) that our demo/test uses.
 *
 * The output format matches what the real provider is instructed to produce: a
 * single fenced ```json block containing one AgentAction.
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const ctx = req.messages.map((m) => m.content).join("\n");
    const action = this.decide(ctx);
    const text = "```json\n" + JSON.stringify(action, null, 2) + "\n```";
    return {
      text,
      tokensUsed: estimateTokens(req.system + ctx + text),
    };
  }

  /**
   * Choose an action from the context. Strategy:
   *  1. If a file block contains an obvious wrong arithmetic operator on a
   *     `return` line, propose flipping it (covers the calculator demo).
   *  2. Otherwise, if tests already look passing, finish.
   *  3. Fallback: finish with a note (keeps the loop bounded).
   */
  private decide(ctx: string): unknown {
    // The context embeds files as:  === path ===\n<numbered lines>\n
    const fileBlocks = [...ctx.matchAll(/=== FILE (.+?) ===\n([\s\S]*?)(?=\n=== |$)/g)];

    for (const [, path, body] of fileBlocks) {
      // Look for a numbered "return a - b" style line to repair.
      const line = body
        .split("\n")
        .find((l) => /^\s*\d+\|\s*return .+[-+*/].+/.test(l));
      if (!line) continue;

      const m = line.match(/^\s*(\d+)\|(\s*)(return .+)$/);
      if (!m) continue;
      const lineNo = Number(m[1]);
      const indent = m[2];
      let expr = m[3];

      // Flip a subtraction that is very likely meant to be addition (the
      // canonical demo bug). Kept deliberately narrow for determinism.
      if (/return\s+\w+\s*-\s*\w+/.test(expr)) {
        expr = expr.replace(/-\s*(\w+)\s*$/, "+ $1");
        return {
          action: "edit_file",
          path: path.trim(),
          changes: [
            {
              startLine: lineNo,
              endLine: lineNo,
              replacement: indent + expr,
            },
          ],
        };
      }
    }

    // Nothing to fix that we recognize: run the tests (first iteration) or
    // finish (later) — decided by whether we've seen output yet.
    if (!ctx.includes("EXECUTION RESULT")) {
      return { action: "run_command" };
    }
    return { action: "finish", summary: "No further changes proposed by mock provider." };
  }
}
