/**
 * AI test writer: approved cases -> Jest tests that have run once.
 *
 *   1. Ask the AI (Claude or mock) for one test block per approved case.
 *   2. Validate the JSON (Zod) and check every block with the code guardrails.
 *   3. Run the kept blocks ONCE. If the file can't run at all, retry once with
 *      the error; after that, stop: broken code never reaches a pull request.
 *   4. Split the tests: passed on first run -> regression suite;
 *      failed on first run -> bug-hunt suite, for a human to triage.
 */
import { AiRefusalError, type AiClient } from "../ai/client";
import { logAiAction, sha256 } from "../ai/log";
import type { ReviewedCase } from "../designer/guardrails";
import type { OpenApiSpec } from "../openapi";
import { checkBlock, describeRejection } from "./guardrails";
import { WRITER_SYSTEM_PROMPT, buildWriterPrompt } from "./prompt";
import { assembleFile, runOnce as realRunOnce, type FirstRun } from "./runner";
import { WrittenTestsSchema, type TestBlock } from "./schema";

export const MAX_WRITE_ATTEMPTS = 2;

export interface ApprovedCase extends Omit<ReviewedCase, "flags"> {
  note: string | null;
}

export interface WriteResult {
  passing: TestBlock[];
  failing: (TestBlock & { message: string })[];
  rejected: { caseId: string; reasons: string[] }[];
  notCovered: { caseId: string; reason: string }[];
  meta: { provider: string; model: string; attempts: number };
}

export class WriteError extends Error {}

export async function writeTests(
  ai: AiClient,
  input: { storyId: string; cases: ApprovedCase[]; spec: OpenApiSpec },
  runOnce: (file: string) => FirstRun = realRunOnce,
): Promise<WriteResult> {
  const approvedIds = new Set(input.cases.map((c) => c.id));
  const basePrompt = buildWriterPrompt(input.storyId, input.cases, input.spec);
  let feedback = "";

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const prompt = basePrompt + feedback;
    const started = Date.now();
    const common = { action: "write_tests", provider: ai.provider, model: ai.model, attempt, promptSha256: sha256(prompt), promptChars: prompt.length };

    let response;
    try {
      response = await ai.generate({ action: "write_tests", system: WRITER_SYSTEM_PROMPT, prompt, schema: WrittenTestsSchema, context: input });
    } catch (err) {
      logAiAction({ ...common, status: err instanceof AiRefusalError ? "refusal" : "error", details: { error: String(err) } });
      throw err;
    }

    const parsed = WrittenTestsSchema.safeParse(response.output);
    if (!parsed.success) {
      const problem = response.parseError ?? parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      logAiAction({ ...common, status: "invalid_output", usage: response.usage, details: { problem: problem.slice(0, 500) } });
      feedback = `\n\nYour previous answer was rejected by validation: ${problem.slice(0, 500)}`;
      continue;
    }

    // Code guardrails, block by block.
    const kept: TestBlock[] = [];
    const rejected: WriteResult["rejected"] = [];
    const seen = new Set<string>();
    for (const block of parsed.data.tests) {
      const reasons = checkBlock(block, approvedIds).map(describeRejection);
      if (seen.has(block.caseId)) reasons.push("duplicate case");
      if (reasons.length > 0) rejected.push({ caseId: block.caseId, reasons });
      else kept.push(block);
      seen.add(block.caseId);
    }

    if (kept.length === 0) {
      logAiAction({ ...common, status: "invalid_output", usage: response.usage, details: { rejected } });
      feedback = `\n\nEvery test you wrote was rejected by the guardrails: ${JSON.stringify(rejected)}. Follow the rules exactly.`;
      continue;
    }

    // Run once.
    const run = runOnce(assembleFile(`First run of AI-written tests for ${input.storyId}`, kept));
    if (run.suiteError) {
      logAiAction({ ...common, status: "invalid_output", usage: response.usage, details: { suiteError: run.suiteError.slice(0, 800) } });
      feedback = `\n\nYour tests could not run at all (this is a problem in the test code, not a failing assertion):\n${run.suiteError.slice(0, 1500)}\nFix the code.`;
      continue;
    }

    const passing: TestBlock[] = [];
    const failing: WriteResult["failing"] = [];
    for (const block of kept) {
      const r = run.results.get(block.caseId);
      if (!r) rejected.push({ caseId: block.caseId, reasons: ["did not run"] });
      else if (r.passed) passing.push(block);
      else failing.push({ ...block, message: r.message ?? "failed" });
    }
    // Cases already explained (written, or removed by guardrails) are not "not covered".
    const written = new Set([...passing, ...failing, ...rejected].map((b) => b.caseId));
    const notCovered = [
      ...parsed.data.notCovered.filter((n) => approvedIds.has(n.caseId) && !written.has(n.caseId)),
      ...input.cases
        .filter((c) => !written.has(c.id) && !parsed.data.notCovered.some((n) => n.caseId === c.id))
        .map((c) => ({ caseId: c.id, reason: "No valid test was produced" })),
    ];

    logAiAction({
      ...common,
      model: response.model,
      status: "ok",
      durationMs: Date.now() - started,
      usage: response.usage,
      details: {
        storyId: input.storyId,
        approved: input.cases.length,
        passedFirstRun: passing.map((b) => b.caseId),
        failedFirstRun: failing.map((b) => b.caseId),
        rejected,
        notCovered,
      },
    });
    return { passing, failing, rejected, notCovered, meta: { provider: ai.provider, model: response.model, attempts: attempt } };
  }

  throw new WriteError(`The AI did not produce runnable tests after ${MAX_WRITE_ATTEMPTS} attempts`);
}

/** The files to commit: passing tests (regression) and failing tests (bug-hunt). */
export function testFiles(storyId: string, issueNumber: number | null, result: WriteResult): { path: string; content: string }[] {
  const source = issueNumber ? `approved cases on issue #${issueNumber}` : "approved cases";
  const by = `${result.meta.provider} (${result.meta.model})`;
  const files: { path: string; content: string }[] = [];
  if (result.passing.length > 0) {
    files.push({
      path: `tests/generated/${storyId}.ai.test.ts`,
      content: assembleFile(
        `AI-written tests for ${storyId}, from ${source}.\nWritten by ${by}. These PASSED on their first run, so they join the regression suite.\nReview them like any other code before merging.`,
        result.passing,
      ),
    });
  }
  if (result.failing.length > 0) {
    files.push({
      path: `tests/generated/${storyId}.ai.bughunt.test.ts`,
      content: assembleFile(
        `AI-written tests for ${storyId}, from ${source}.\nWritten by ${by}. These FAILED on their first run: either the app has a bug, or the test is wrong.\nA human decides. They run in the non-blocking bug-hunt job meanwhile.`,
        result.failing,
        new Map(result.failing.map((f) => [f.caseId, `First run failed:\n${f.message}`])),
      ),
    });
  }
  return files;
}
