/**
 * Thin wrapper around the GitHub CLI (`gh`). Works locally (your gh login)
 * and in GitHub Actions (GH_TOKEN). Arguments are passed as an array and
 * bodies through stdin, never through a shell, so issue text can't inject
 * commands.
 */
import { execFileSync } from "node:child_process";

function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] });
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
}

export interface IssueComment {
  id: number;
  body: string;
  user: string;
  createdAt: string;
}

export function getIssue(issueNumber: number): Issue {
  return JSON.parse(gh(["issue", "view", String(issueNumber), "--json", "number,title,body,url"]));
}

export function listComments(issueNumber: number): IssueComment[] {
  const out = gh([
    "api",
    `repos/{owner}/{repo}/issues/${issueNumber}/comments`,
    "--paginate",
    "--jq",
    ".[] | {id, body, user: .user.login, createdAt: .created_at}",
  ]);
  return out
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/** Posts a comment and returns its URL. */
export function commentOnIssue(issueNumber: number, body: string): string {
  return gh(["issue", "comment", String(issueNumber), "--body-file", "-"], body).trim();
}

/** Issue number from the first CLI argument or the ISSUE_NUMBER env var (set in GitHub Actions). */
export function issueNumberFromArgs(): number {
  const raw = process.argv[2] ?? process.env.ISSUE_NUMBER;
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n <= 0) {
    console.error("Usage: <command> <issue-number>   (or set ISSUE_NUMBER)");
    process.exit(2);
  }
  return n;
}
