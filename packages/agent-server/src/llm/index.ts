import type { LLMProvider } from "./provider.js";
import { AnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { config } from "../config.js";

/** Build the configured LLM provider. Defaults to the mock (no key needed). */
export function createProvider(): LLMProvider {
  if (config.llmProvider === "anthropic") {
    return new AnthropicProvider(config.anthropicApiKey, config.anthropicModel);
  }
  return new MockProvider();
}

export type { LLMProvider } from "./provider.js";
