/**
 * AI test designer: user story + OpenAPI spec -> proposed test cases.
 *
 *   1. Ask the AI (Claude or mock) for JSON in the TestDesign shape.
 *   2. Validate it with Zod. If invalid, retry ONCE, telling the AI what was wrong.
 *   3. Run the guardrails (unknown endpoints, unsafe SQL, low confidence...).
 *   4. Log every attempt.
 *
 * The result is only a PROPOSAL. Nothing is written or run until a human approves.
 */
import { AiRefusalError, type AiClient } from "../ai/client";
import { logAiAction, sha256 } from "../ai/log";
import { listEndpoints, type OpenApiSpec } from "../openapi";
import { applyGuardrails, type GuardrailResult } from "./guardrails";
import { DESIGNER_SYSTEM_PROMPT, buildDesignerPrompt } from "./prompt";
import { TestDesignSchema, type TestDesign } from "./schema";

export const MAX_ATTEMPTS = 2;

export interface DesignResult extends GuardrailResult {
  design: TestDesign;
  meta: {
    provider: string;
    model: string;
    attempts: number;
    usage: { inputTokens: number; outputTokens: number };
  };
}

export class DesignError extends Error {}

export async function designTests(
  ai: AiClient,
  input: { storyId: string; story: string; spec: OpenApiSpec },
): Promise<DesignResult> {
  const basePrompt = buildDesignerPrompt(input.storyId, input.story, input.spec);
  const usage = { inputTokens: 0, outputTokens: 0 };
  let feedback = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = basePrompt + feedback;
    const started = Date.now();
    const common = {
      action: "design_tests",
      provider: ai.provider,
      model: ai.model,
      attempt,
      promptSha256: sha256(prompt),
      promptChars: prompt.length,
    };

    let response;
    try {
      response = await ai.generate({
        action: "design_tests",
        system: DESIGNER_SYSTEM_PROMPT,
        prompt,
        schema: TestDesignSchema,
        context: input,
      });
    } catch (err) {
      const status = err instanceof AiRefusalError ? "refusal" : "error";
      logAiAction({ ...common, status, durationMs: Date.now() - started, details: { error: String(err) } });
      throw err;
    }

    if (response.usage) {
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
    }

    const parsed = TestDesignSchema.safeParse(response.output);
    if (!parsed.success) {
      const problem = response.parseError ?? parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      logAiAction({
        ...common,
        model: response.model,
        status: "invalid_output",
        durationMs: Date.now() - started,
        usage: response.usage,
        details: { problem: problem.slice(0, 500) },
      });
      feedback = `\n\nYour previous answer was rejected by validation: ${problem.slice(0, 500)}. Return JSON that matches the required format exactly.`;
      continue;
    }

    const known = new Set(listEndpoints(input.spec).map((e) => e.key));
    const guarded = applyGuardrails(parsed.data, known);
    logAiAction({
      ...common,
      model: response.model,
      status: "ok",
      durationMs: Date.now() - started,
      usage: response.usage,
      details: {
        storyId: input.storyId,
        proposed: parsed.data.testCases.length,
        accepted: guarded.accepted.length,
        rejected: guarded.rejected.map((r) => ({ title: r.testCase.title, reasons: r.reasons })),
        flagged: guarded.accepted.filter((c) => c.flags.length > 0).length,
      },
    });

    return {
      design: parsed.data,
      ...guarded,
      meta: { provider: ai.provider, model: response.model, attempts: attempt, usage },
    };
  }

  throw new DesignError(`The AI did not return a valid test design after ${MAX_ATTEMPTS} attempts`);
}
