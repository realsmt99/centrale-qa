/**
 * npm run qa:issue-write -- <issue-number> [--dry-run]
 *
 * Reads the human review from the issue (the latest QA Pilot review summary),
 * writes Jest tests for the approved cases, runs them once, and opens a pull
 * request with them. Posts the PR link on the issue.
 * --dry-run: writes the files under reports/qa-pilot/<story>/generated/ instead.
 * In CI this runs right after the review is recorded (label qa-pilot:approved).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createAiClient } from "../ai/client";
import { commentOnIssue, issueNumberFromArgs, listComments } from "../github/gh";
import { loadSpec } from "../openapi";
import { readReviewPayload } from "../review/comment";
import { openTestsPr } from "../writer/pr";
import { testFiles, writeTests, type ApprovedCase, type WriteResult } from "../writer/write";

function summaryTable(result: WriteResult, cases: ApprovedCase[]): string {
  const title = (id: string) => cases.find((c) => c.id === id)?.title ?? "";
  const rows = [
    ...result.passing.map((b) => `| ${b.caseId} | ${title(b.caseId)} | passed | regression suite |`),
    ...result.failing.map((b) => `| ${b.caseId} | ${title(b.caseId)} | **failed** | bug-hunt suite: bug or wrong test? |`),
    ...result.rejected.map((r) => `| ${r.caseId} | ${title(r.caseId)} | not run | removed by guardrails: ${r.reasons.join(", ")} |`),
    ...result.notCovered.map((n) => `| ${n.caseId} | ${title(n.caseId)} | not written | ${n.reason} |`),
  ];
  return ["| Case | Title | First run | Goes to |", "|---|---|---|---|", ...rows].join("\n");
}

async function main() {
  const issueNumber = issueNumberFromArgs();
  const dryRun = process.argv.includes("--dry-run");

  const review = listComments(issueNumber)
    .map((c) => readReviewPayload(c.body))
    .filter((r) => r !== null)
    .at(-1);
  if (!review) {
    console.error(`Issue #${issueNumber} has no recorded QA Pilot review. Add the label "qa-pilot:approved" first.`);
    process.exit(1);
  }
  const cases: ApprovedCase[] = review.decisions
    .filter((d) => d.decision === "approved")
    .map((d) => {
      const { flags: _flags, ...testCase } = d.testCase;
      return { ...testCase, note: d.note };
    });
  if (cases.length === 0) {
    console.log("No approved case: nothing to write.");
    return;
  }

  const ai = createAiClient();
  console.log(`Writing tests for ${cases.length} approved case(s) of ${review.storyId} with ${ai.provider} (${ai.model})...`);
  const result = await writeTests(ai, { storyId: review.storyId, cases, spec: loadSpec() });
  const files = testFiles(review.storyId, issueNumber, result);
  console.log(
    `First run: ${result.passing.length} passed, ${result.failing.length} failed, ` +
      `${result.rejected.length} removed by guardrails, ${result.notCovered.length} not covered. Attempts: ${result.meta.attempts}.`,
  );

  if (dryRun || files.length === 0) {
    const outDir = join("reports", "qa-pilot", review.storyId, "generated");
    mkdirSync(outDir, { recursive: true });
    for (const f of files) writeFileSync(join(outDir, basename(f.path)), f.content);
    console.log(`${dryRun ? "--dry-run" : "Nothing to commit"}: files written to ${outDir}, no pull request.`);
    return;
  }

  const table = summaryTable(result, cases);
  const { url } = openTestsPr({
    storyId: review.storyId,
    files,
    title: `QA Pilot: AI-written tests for ${review.storyId}`,
    commitMessage: `Add AI-written tests for ${review.storyId}\n\nFrom the cases approved on issue #${issueNumber}. Written by ${result.meta.provider} (${result.meta.model}) and run once before this commit.`,
    body: [
      `AI-written tests for **${review.storyId}**, from the cases a human approved on #${issueNumber}.`,
      "",
      `Written by \`${result.meta.provider}\` (\`${result.meta.model}\`). Every test passed the code guardrails and was **run once** before this PR was opened.`,
      "",
      table,
      "",
      "- **passed** tests go to `tests/generated/<story>.ai.test.ts` (regression suite: must keep passing).",
      "- **failed** tests go to `tests/generated/<story>.ai.bughunt.test.ts` (non-blocking): a failure is either a real bug or a wrong test. A human decides.",
      "",
      "Please review the code like any other PR before merging. QA Pilot never merges its own PRs.",
    ].join("\n"),
  });
  console.log(`Opened ${url}`);
  commentOnIssue(issueNumber, `## QA Pilot: tests written for ${review.storyId}\n\nPull request: ${url}\n\n${table}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
