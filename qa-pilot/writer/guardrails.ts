/**
 * Guardrails on AI-written test code, checked BEFORE the code is run.
 *
 * The AI only writes test bodies (one `it(...)` per approved case). QA Pilot
 * adds the imports itself. Each block is rejected if it:
 *   - implements a case that wasn't approved, or has the wrong shape
 *   - has no assertion (a test that can't fail is useless)
 *   - uses anything outside the allowed helpers: imports, require, process,
 *     file system, direct DB access (only sqlCheck, which is read-only),
 *     other network calls, eval, .only/.skip, describe blocks
 */
import type { TestBlock } from "./schema";

export const MAX_BLOCK_CHARS = 6000;

const FORBIDDEN: [RegExp, string][] = [
  // Import statements and dynamic import(): not the word "import" in a URL like /feeds/import.
  [/(^|[\n;{])\s*import\s+[\w{*"']|\bimport\s*\(/, "import"],
  [/\brequire\s*\(/, "require()"],
  [/\bprocess\b/, "process"],
  [/\b(child_process|fs|net|http|https|os)\b\s*[.(]/, "system module"],
  [/\beval\s*\(|\bnew\s+Function\b/, "dynamic code"],
  [/\bdb\s*\.\s*\w+/, "direct DB access (use sqlCheck)"],
  [/\b(fetch|XMLHttpRequest)\b|\bglobalThis\b|__dirname|__filename/, "other network/global access"],
  [/\b(it|test|describe)\s*\.\s*(only|skip|todo)\b|\b[xf]it\s*\(/, ".only/.skip"],
  [/\bdescribe\s*\(/, "describe block"],
  [/\brequest\s*\((?!\s*app\.server\s*\))/, "request() to something other than app.server"],
];

export type BlockRejection =
  | { kind: "not_approved" }
  | { kind: "bad_shape" }
  | { kind: "no_assertion" }
  | { kind: "too_long" }
  | { kind: "forbidden"; what: string };

export function checkBlock(block: TestBlock, approvedIds: Set<string>): BlockRejection[] {
  const code = block.code.trim();
  const problems: BlockRejection[] = [];

  if (!approvedIds.has(block.caseId)) problems.push({ kind: "not_approved" });

  // Exactly one test, named after its case: it("TC-05 ...", async () => { ... });
  const startsRight = new RegExp(`^it\\(\\s*(["'\`])${block.caseId}\\b`).test(code);
  const testCount = (code.match(/(^|\n)\s*(it|test)\s*\(/g) ?? []).length;
  if (!startsRight || testCount !== 1) problems.push({ kind: "bad_shape" });

  if (!/\bexpect\s*\(/.test(code)) problems.push({ kind: "no_assertion" });
  if (code.length > MAX_BLOCK_CHARS) problems.push({ kind: "too_long" });

  for (const [pattern, what] of FORBIDDEN) {
    if (pattern.test(code)) problems.push({ kind: "forbidden", what });
  }
  return problems;
}

export function describeRejection(r: BlockRejection): string {
  return r.kind === "forbidden" ? `forbidden: ${r.what}` : r.kind;
}
