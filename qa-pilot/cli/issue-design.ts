/**
 * npm run qa:issue-design -- <issue-number>
 *
 * Reads the user story from a GitHub Issue, proposes test cases, and posts
 * them on the issue as a checklist for a human to review.
 * In CI this runs when the label "qa-pilot:design" is added to an issue.
 */
import { runDesign, storyIdFrom } from "../designer/run";
import { commentOnIssue, getIssue, issueNumberFromArgs } from "../github/gh";
import { buildProposalComment } from "../review/comment";

async function main() {
  const issueNumber = issueNumberFromArgs();
  const issue = getIssue(issueNumber);
  const storyId = storyIdFrom(issue.title, `ISSUE-${issue.number}`);
  const story = `# ${issue.title}\n\n${issue.body}`;

  const { result } = await runDesign(storyId, story);
  if (result.accepted.length === 0) {
    commentOnIssue(issueNumber, `QA Pilot could not propose any valid test case for ${storyId}. See the workflow logs.`);
    process.exit(1);
  }
  const url = commentOnIssue(issueNumber, buildProposalComment(result));
  console.log(`Posted ${result.accepted.length} proposals: ${url}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
