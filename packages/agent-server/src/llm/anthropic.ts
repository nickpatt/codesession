import type { LLMProvider, LLMRequest, LLMResponse } from "./provider.js";
import { estimateTokens } from "./provider.js";

/**
 * Anthropic-backed provider. Calls the Messages API over plain fetch (no SDK
 * dependency) so the service stays lean. Reads the API key from config; if it's
 * missing, construction throws so we fail fast rather than at task time.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is required for the anthropic provider (or set LLM_PROVIDER=mock)",
      );
    }
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`anthropic ${res.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    // Concatenate all text blocks from the response.
    const text = (body.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("");

    const tokensUsed =
      (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0) ||
      estimateTokens(req.system + req.messages.map((m) => m.content).join("") + text);

    return { text, tokensUsed };
  }
}
