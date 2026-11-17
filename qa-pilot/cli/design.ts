/**
 * npm run qa:design -- stories/US-001-price-update.md
 *
 * Writes reports/qa-pilot/<story>/proposals.json and proposals.md.
 * Uses Claude if ANTHROPIC_API_KEY is set, otherwise the rule-based mock
 * (force one with QA_PILOT_AI=claude or QA_PILOT_AI=mock).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createAiClient } from "../ai/client";
import { logPath } from "../ai/log";
import { designTests } from "../designer/design";
import { renderMarkdown } from "../designer/render";
import { loadSpec } from "../openapi";

async function main() {
  const storyFile = process.argv[2];
  if (!storyFile) {
    console.error("Usage: npm run qa:design -- <story.md>");
    process.exit(2);
  }
  const story = readFileSync(storyFile, "utf8");
  const storyId = basename(storyFile).match(/^[A-Z]+-\d+/)?.[0] ?? basename(storyFile, ".md");
  const ai = createAiClient();
  console.log(`Designing tests for ${storyId} with ${ai.provider} (${ai.model})...`);

  const result = await designTests(ai, { storyId, story, spec: loadSpec() });

  const outDir = join("reports", "qa-pilot", storyId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "proposals.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(outDir, "proposals.md"), renderMarkdown(result));

  const flagged = result.accepted.filter((c) => c.flags.length > 0).length;
  console.log(
    `${result.design.testCases.length} proposed -> ${result.accepted.length} kept (${flagged} need review), ` +
      `${result.rejected.length} removed by guardrails. Attempts: ${result.meta.attempts}.`,
  );
  console.log(`Wrote ${join(outDir, "proposals.md")} and proposals.json. AI log: ${logPath()}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
