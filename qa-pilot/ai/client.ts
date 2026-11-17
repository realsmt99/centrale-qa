/**
 * One small interface for "ask the AI for structured JSON", with two
 * implementations:
 *   - ClaudeClient: the real Claude API (used when ANTHROPIC_API_KEY is set)
 *   - MockAiClient: a rule-based stand-in, so the pipeline runs for free
 *
 * The caller always validates the output again with Zod. The AI's answer is
 * never trusted just because it came back.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { MockAiClient } from "./mock";

export type Provider = "claude" | "mock";

export interface AiRequest<T> {
  /** What this call is for, e.g. "design_tests". Used in logs and by the mock. */
  action: string;
  system: string;
  prompt: string;
  /** Expected shape of the answer. */
  schema: z.ZodType<T>;
  /** Raw inputs, so the mock can work without reading the prompt text. */
  context: Record<string, unknown>;
}

export interface AiResponse {
  /** Parsed JSON, or null if the AI's answer could not be parsed. */
  output: unknown;
  provider: Provider;
  model: string;
  stopReason: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** Set when the answer came back but was not usable JSON. */
  parseError?: string;
}

export interface AiClient {
  readonly provider: Provider;
  readonly model: string;
  generate<T>(request: AiRequest<T>): Promise<AiResponse>;
}

export class AiRefusalError extends Error {}

export class ClaudeClient implements AiClient {
  readonly provider = "claude" as const;
  private readonly client = new Anthropic();

  constructor(
    readonly model = process.env.QA_PILOT_MODEL ?? "claude-opus-5-5",
    private readonly effort: "low" | "medium" | "high" = "medium",
  ) {}

  async generate<T>(request: AiRequest<T>): Promise<AiResponse> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        // If the main model declines, the API retries on a fallback model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: this.effort, format: betaZodOutputFormat(request.schema) },
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
      });

      if (response.stop_reason === "refusal") {
        throw new AiRefusalError(`Claude declined: ${response.stop_details?.explanation ?? "no explanation"}`);
      }
      return {
        output: response.parsed_output,
        provider: this.provider,
        model: response.model,
        stopReason: response.stop_reason ?? "unknown",
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    } catch (err) {
      // API errors (auth, rate limit, outage) and refusals are real failures: let them through.
      if (err instanceof Anthropic.APIError || err instanceof AiRefusalError) throw err;
      // Anything else here means the answer arrived but didn't match the schema.
      return { output: null, provider: this.provider, model: this.model, stopReason: "parse_error", parseError: String(err) };
    }
  }
}

/**
 * QA_PILOT_AI=claude|mock forces a provider. Otherwise: Claude if an API key
 * is set, the mock if not (so CI and contributors without a key still work).
 */
export function createAiClient(): AiClient {
  const choice = process.env.QA_PILOT_AI ?? (process.env.ANTHROPIC_API_KEY ? "claude" : "mock");
  return choice === "claude" ? new ClaudeClient() : new MockAiClient();
}
