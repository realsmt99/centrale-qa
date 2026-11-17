/**
 * Guardrails: plain code that checks every AI-proposed test case BEFORE a
 * human sees it. The AI cannot switch these off.
 *
 *   reject (removed, listed separately with the reason):
 *     unknown_endpoint  - endpoint is not in the OpenAPI spec (AI invented it)
 *     unsafe_sql        - SQL check is not a single read-only SELECT
 *     incomplete        - no steps, or no expected result
 *   flag (kept, but highlighted for the human):
 *     low_confidence    - the AI said it is not sure
 *     missing_doubt     - confidence is not high but the AI gave no reason
 *   fix (applied silently, deterministic):
 *     ids are renumbered TC-01, TC-02, ... and endpoints normalized
 */
import { normalizeEndpoint } from "../openapi";
import type { TestCase, TestDesign } from "./schema";

export const MAX_CASES = 25;

export type RejectRule = "unknown_endpoint" | "unsafe_sql" | "incomplete" | "over_limit";
export type FlagRule = "low_confidence" | "missing_doubt";

export interface ReviewedCase extends TestCase {
  flags: FlagRule[];
}

export interface GuardrailResult {
  accepted: ReviewedCase[];
  rejected: { testCase: TestCase; reasons: RejectRule[] }[];
}

const WRITE_SQL = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i;

/** True if the SQL is ONE statement and only reads data. */
export function isReadOnlySql(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(trimmed)) return false;
  if (trimmed.includes(";")) return false; // more than one statement
  return !WRITE_SQL.test(trimmed);
}

export function applyGuardrails(design: TestDesign, knownEndpoints: Set<string>): GuardrailResult {
  const result: GuardrailResult = { accepted: [], rejected: [] };

  design.testCases.forEach((original, index) => {
    const testCase = { ...original, endpoint: normalizeEndpoint(original.endpoint) };
    const reasons: RejectRule[] = [];

    if (!knownEndpoints.has(testCase.endpoint)) reasons.push("unknown_endpoint");
    if (testCase.sqlCheck && !isReadOnlySql(testCase.sqlCheck)) reasons.push("unsafe_sql");
    if (testCase.steps.length === 0 || testCase.expected.trim() === "") reasons.push("incomplete");
    if (index >= MAX_CASES) reasons.push("over_limit");

    if (reasons.length > 0) {
      result.rejected.push({ testCase, reasons });
      return;
    }

    const flags: FlagRule[] = [];
    if (testCase.confidence === "low") flags.push("low_confidence");
    if (testCase.confidence !== "high" && !testCase.doubt?.trim()) flags.push("missing_doubt");
    result.accepted.push({ ...testCase, flags });
  });

  // Stable, human-friendly ids for the approval checklist.
  result.accepted.forEach((c, i) => (c.id = `TC-${String(i + 1).padStart(2, "0")}`));
  return result;
}
