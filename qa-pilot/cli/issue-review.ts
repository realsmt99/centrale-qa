/**
 * npm run qa:issue-review -- <issue-number> [--dry-run]
 *
 * Reads the human's decisions from the latest QA Pilot proposals comment
 * (ticked = approved, edits, notes), saves them to
 * reports/qa-pilot/<story>/review.json, and posts a summary comment.
 * In CI this runs when the label "qa-pilot:approved" is added to the issue.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logAiAction } from "../ai/log";
import { commentOnIssue, issueNumberFromArgs, listComments } from "../github/gh";
import { isProposalComment, parseReview, renderReviewSummary } from "../review/comment";

function main() {
  const issueNumber = issueNumberFromArgs();
  const dryRun = process.argv.includes("--dry-run");

  const proposals = listComments(issueNumber).filter((c) => isProposalComment(c.body));
  const latest = proposals.at(-1);
  if (!latest) {
    console.error(`Issue #${issueNumber} has no QA Pilot proposals comment. Add the label "qa-pilot:design" first.`);
    process.exit(1);
  }

  const review = parseReview(latest.body);
  const outDir = join("reports", "qa-pilot", review.storyId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "review.json"), JSON.stringify(review, null, 2) + "\n");

  // Human decisions about AI output are logged next to the AI actions themselves.
  logAiAction({
    action: "human_review",
    provider: review.provider,
    model: review.model,
    status: "ok",
    details: { storyId: review.storyId, issue: issueNumber, ...review.stats },
  });

  const s = review.stats;
  console.log(
    `${review.storyId}: ${s.proposed} proposed, ${s.approvedAsIs} approved as-is, ${s.approvedEdited} approved after edits, ` +
      `${s.rejected} rejected. Acceptance rate ${Math.round(s.acceptanceRate * 100)}%.`,
  );
  if (dryRun) {
    console.log("--dry-run: no comment posted.");
    return;
  }
  console.log(`Posted summary: ${commentOnIssue(issueNumber, renderReviewSummary(review))}`);
}

main();
