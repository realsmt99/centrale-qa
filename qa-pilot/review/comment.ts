/**
 * Human approval on a GitHub Issue.
 *
 * 1. QA Pilot posts the proposals as a checklist comment. The original cases
 *    are also stored, hidden, inside the comment (an HTML comment holding
 *    base64 JSON), so we can later see exactly what the human changed.
 * 2. The human ticks the cases to keep, may edit a case's title, Steps or
 *    Expected line, and may add "  - Note: ..." lines.
 * 3. parseReview() reads the edited comment back: approved / rejected /
 *    edited, per case. Those numbers are QA Pilot's acceptance metrics.
 */
import type { DesignResult } from "../designer/design";
import type { ReviewedCase } from "../designer/guardrails";
import { renderMarkdown } from "../designer/render";

const PROPOSALS_MARKER = "qa-pilot:proposals:v1";
const REVIEW_MARKER = "qa-pilot:review:v1";
export const APPROVED_LABEL = "qa-pilot:approved";

export interface ProposalPayload {
  storyId: string;
  provider: string;
  model: string;
  cases: ReviewedCase[];
}

export type EditableField = "title" | "steps" | "expected";

export interface CaseDecision {
  id: string;
  decision: "approved" | "rejected";
  editedFields: EditableField[];
  note: string | null;
  /** The case with the human's edits applied. */
  testCase: ReviewedCase;
}

export interface Review {
  storyId: string;
  provider: string;
  model: string;
  decisions: CaseDecision[];
  stats: {
    proposed: number;
    approved: number;
    approvedAsIs: number;
    approvedEdited: number;
    rejected: number;
    /** approved / proposed, 0..1 */
    acceptanceRate: number;
  };
}

const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString("base64");
const decode = <T>(b64: string): T => JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

function readHidden<T>(body: string, marker: string): T | null {
  const m = new RegExp(`<!-- ${marker} ([A-Za-z0-9+/=]+) -->`).exec(body);
  return m ? decode<T>(m[1]) : null;
}

export function isProposalComment(body: string): boolean {
  return body.includes(`<!-- ${PROPOSALS_MARKER} `);
}

export function readReviewPayload(body: string): Review | null {
  return readHidden<Review>(body, REVIEW_MARKER);
}

export function buildProposalComment(result: DesignResult): string {
  const payload: ProposalPayload = {
    storyId: result.design.storyId,
    provider: result.meta.provider,
    model: result.meta.model,
    cases: result.accepted,
  };
  return [
    renderMarkdown(result),
    "### How to review",
    "1. **Tick** the cases to keep. Unticked cases are rejected.",
    "2. **Edit** a case's title, `Steps:` or `Expected:` line if it's almost right.",
    "3. **Add guidance** for the test writer with a line `  - Note: ...` under a case.",
    `4. When you're done, add the label \`${APPROVED_LABEL}\` to this issue.`,
    "",
    `<!-- ${PROPOSALS_MARKER} ${encode(payload)} -->`,
  ].join("\n");
}

const CASE_LINE = /^- \[( |x|X)\] \*\*(TC-\d+)\*\* `[^`]*` `[^`]*`: (.*)$/;
const SUB_LINE = /^\s+- (Steps|Expected|Note): (.*)$/;

/** "(1) Call X (2) Check Y" -> ["Call X", "Check Y"] */
function splitSteps(text: string): string[] {
  return text
    .split(/\(\d+\)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface ParsedBlock {
  checked: boolean;
  title: string;
  steps?: string[];
  expected?: string;
  notes: string[];
}

function parseBlocks(body: string): Map<string, ParsedBlock> {
  const blocks = new Map<string, ParsedBlock>();
  let current: ParsedBlock | null = null;
  for (const line of body.split(/\r?\n/)) {
    const head = CASE_LINE.exec(line);
    if (head) {
      current = { checked: head[1] !== " ", title: head[3].trim(), notes: [] };
      blocks.set(head[2], current);
      continue;
    }
    const sub = current && SUB_LINE.exec(line);
    if (current && sub) {
      if (sub[1] === "Steps") current.steps = splitSteps(sub[2]);
      if (sub[1] === "Expected") current.expected = sub[2].trim();
      if (sub[1] === "Note") current.notes.push(sub[2].trim());
    } else if (!line.startsWith("  ")) {
      current = null; // a non-indented line ends the case block
    }
  }
  return blocks;
}

export function parseReview(commentBody: string): Review {
  const payload = readHidden<ProposalPayload>(commentBody, PROPOSALS_MARKER);
  if (!payload) throw new Error("This comment has no QA Pilot proposals payload");
  const blocks = parseBlocks(commentBody);

  const decisions: CaseDecision[] = payload.cases.map((original) => {
    const block = blocks.get(original.id);
    if (!block) {
      return { id: original.id, decision: "rejected", editedFields: [], note: "Removed from the checklist", testCase: original };
    }
    const edited: ReviewedCase = { ...original };
    const editedFields: EditableField[] = [];
    if (block.title !== original.title) {
      edited.title = block.title;
      editedFields.push("title");
    }
    if (block.steps && JSON.stringify(block.steps) !== JSON.stringify(original.steps)) {
      edited.steps = block.steps;
      editedFields.push("steps");
    }
    if (block.expected !== undefined && block.expected !== original.expected) {
      edited.expected = block.expected;
      editedFields.push("expected");
    }
    return {
      id: original.id,
      decision: block.checked ? "approved" : "rejected",
      editedFields,
      note: block.notes.length > 0 ? block.notes.join(" ") : null,
      testCase: edited,
    };
  });

  const approved = decisions.filter((d) => d.decision === "approved");
  const approvedEdited = approved.filter((d) => d.editedFields.length > 0 || d.note).length;
  return {
    storyId: payload.storyId,
    provider: payload.provider,
    model: payload.model,
    decisions,
    stats: {
      proposed: decisions.length,
      approved: approved.length,
      approvedAsIs: approved.length - approvedEdited,
      approvedEdited,
      rejected: decisions.length - approved.length,
      acceptanceRate: decisions.length === 0 ? 0 : approved.length / decisions.length,
    },
  };
}

export function renderReviewSummary(review: Review): string {
  const { stats } = review;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const approved = review.decisions.filter((d) => d.decision === "approved");
  const rejected = review.decisions.filter((d) => d.decision === "rejected");
  const describe = (d: CaseDecision) => {
    const changes = [...d.editedFields, ...(d.note ? ["note"] : [])];
    return `- **${d.id}** ${d.testCase.title}${changes.length > 0 ? ` _(edited: ${changes.join(", ")})_` : ""}`;
  };
  return [
    `## QA Pilot: review recorded for ${review.storyId}`,
    "",
    "| | Cases |",
    "|---|---|",
    `| Proposed by AI (\`${review.model}\`) | ${stats.proposed} |`,
    `| Approved as proposed | ${stats.approvedAsIs} |`,
    `| Approved after human edits | ${stats.approvedEdited} |`,
    `| Rejected | ${stats.rejected} |`,
    "",
    `**Acceptance rate: ${pct(stats.acceptanceRate)}** (approved / proposed)`,
    "",
    ...(approved.length > 0 ? ["**Approved**", ...approved.map(describe), ""] : []),
    ...(rejected.length > 0 ? ["**Rejected**", ...rejected.map(describe), ""] : []),
    approved.length > 0
      ? `Next: the test writer turns the ${approved.length} approved case(s) into Jest tests and opens a pull request.`
      : "No case was approved, so no tests will be written.",
    "",
    `<!-- ${REVIEW_MARKER} ${encode(review)} -->`,
  ].join("\n");
}
