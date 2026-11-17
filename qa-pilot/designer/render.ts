/**
 * Renders a design as Markdown with checkboxes. In the next step this text
 * is posted on the GitHub Issue: the human ticks the cases to keep.
 */
import type { DesignResult } from "./design";
import type { ReviewedCase } from "./guardrails";

const FLAG_TEXT: Record<string, string> = {
  low_confidence: "low confidence",
  missing_doubt: "AI gave no reason for its doubt",
};

function renderCase(c: ReviewedCase): string {
  const lines = [`- [ ] **${c.id}** \`${c.kind}\` \`${c.endpoint}\`: ${c.title}`];
  if (c.flags.length > 0) lines.push(`  - **Needs review** (${c.flags.map((f) => FLAG_TEXT[f]).join(", ")})`);
  if (c.doubt) lines.push(`  - Doubt: ${c.doubt}`);
  if (c.preconditions.length > 0) lines.push(`  - Given: ${c.preconditions.join("; ")}`);
  lines.push(`  - Steps: ${c.steps.map((s, i) => `(${i + 1}) ${s}`).join(" ")}`);
  lines.push(`  - Expected: ${c.expected}`);
  if (c.sqlCheck) lines.push(`  - SQL check: \`${c.sqlCheck.replace(/\s+/g, " ").trim()}\``);
  lines.push(`  - Confidence: ${c.confidence}`);
  return lines.join("\n");
}

export function renderMarkdown(result: DesignResult): string {
  const { design, accepted, rejected, meta } = result;
  const out: string[] = [
    `## QA Pilot: proposed test cases for ${design.storyId}`,
    "",
    `> Proposed by \`${meta.provider}\` (\`${meta.model}\`). These are proposals only: nothing is written or run until a human approves. Tick the cases to keep, edit any text, then approve.`,
    "",
    `**Story as understood:** ${design.summary}`,
    "",
  ];
  if (design.assumptions.length > 0) {
    out.push("**Assumptions**", ...design.assumptions.map((a) => `- ${a}`), "");
  }
  if (design.openQuestions.length > 0) {
    out.push("**Open questions for the team**", ...design.openQuestions.map((q) => `- ${q}`), "");
  }
  const flagged = accepted.filter((c) => c.flags.length > 0).length;
  out.push(`### Proposed cases (${accepted.length}, of which ${flagged} need review)`, "", ...accepted.map(renderCase), "");
  if (rejected.length > 0) {
    out.push(
      `### Removed by guardrails (${rejected.length})`,
      "",
      ...rejected.map((r) => `- ~~${r.testCase.title}~~ (\`${r.testCase.endpoint}\`): ${r.reasons.join(", ")}`),
      "",
    );
  }
  return out.join("\n");
}
