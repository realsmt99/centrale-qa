/**
 * npm run qa:design -- stories/US-001-price-update.md
 *
 * Writes reports/qa-pilot/<story>/proposals.json and proposals.md.
 * Uses Claude if ANTHROPIC_API_KEY is set, otherwise the rule-based mock
 * (force one with QA_PILOT_AI=claude or QA_PILOT_AI=mock).
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { logPath } from "../ai/log";
import { runDesign, storyIdFrom } from "../designer/run";

async function main() {
  const storyFile = process.argv[2];
  if (!storyFile) {
    console.error("Usage: npm run qa:design -- <story.md>");
    process.exit(2);
  }
  const story = readFileSync(storyFile, "utf8");
  const storyId = storyIdFrom(basename(storyFile), basename(storyFile, ".md"));
  const { outDir } = await runDesign(storyId, story);
  console.log(`Wrote ${join(outDir, "proposals.md")} and proposals.json. AI log: ${logPath()}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
