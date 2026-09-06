/**
 * LLM provider abstraction.
 *
 * The orchestrator only depends on this small interface, so we can swap between
 * a real hosted model (Anthropic) and a deterministic mock (for tests and for
 * running the whole loop with no API key or cost). This is the seam that keeps
 * the agent logic testable.
 */

/** A single chat message in the conversation with the model. */
export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

/** Parameters for one completion request. */
export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  /** Upper bound on output tokens for this call. */
  maxTokens: number;
}

/** Result of a completion, including a rough token accounting for budgeting. */
export interface LLMResponse {
  text: string;
  /** Approximate tokens consumed (input + output), for budget tracking. */
  tokensUsed: number;
}

/** Anything that can turn a request into a completion. */
export interface LLMProvider {
  readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
}

/** Very rough token estimate (~4 chars/token) — good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
