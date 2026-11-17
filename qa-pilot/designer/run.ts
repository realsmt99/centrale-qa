/** Shared by the CLIs: run the designer and save the results under reports/qa-pilot/<storyId>/. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAiClient } from "../ai/client";
import { loadSpec } from "../openapi";
import { designTests, type DesignResult } from "./design";
import { renderMarkdown } from "./render";

export function storyIdFrom(text: string, fallback: string): string {
  return text.match(/\b(US-\d+)\b/)?.[1] ?? fallback;
}

export async function runDesign(storyId: string, story: string): Promise<{ result: DesignResult; outDir: string }> {
  const ai = createAiClient();
  console.log(`Designing tests for ${storyId} with ${ai.provider} (${ai.model})...`);
  const result = await designTests(ai, { storyId, story, spec: loadSpec() });

  const outDir = join("reports", "qa-pilot", storyId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "story.md"), story);
  writeFileSync(join(outDir, "proposals.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(outDir, "proposals.md"), renderMarkdown(result));

  const flagged = result.accepted.filter((c) => c.flags.length > 0).length;
  console.log(
    `${result.design.testCases.length} proposed -> ${result.accepted.length} kept (${flagged} need review), ` +
      `${result.rejected.length} removed by guardrails. Attempts: ${result.meta.attempts}.`,
  );
  return { result, outDir };
}
