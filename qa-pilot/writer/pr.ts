/**
 * Puts AI-written tests in a pull request. Never commits to main.
 *
 * Uses a temporary `git worktree` (a second checkout of the repo in a temp
 * folder), so your own working copy and current branch are never touched.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function run(cmd: string, args: string[], cwd?: string, input?: string): string {
  return execFileSync(cmd, args, { cwd, input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] }).trim();
}

export function openTestsPr(opts: {
  storyId: string;
  files: { path: string; content: string }[];
  title: string;
  body: string;
  commitMessage: string;
  base?: string;
}): { url: string; branch: string } {
  const base = opts.base ?? "main";
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const branch = `qa-pilot/${opts.storyId.toLowerCase()}-tests-${stamp}`;
  if (branch === base || branch === "main") throw new Error("Refusing to commit to main");

  run("git", ["fetch", "--quiet", "origin", base]);
  const dir = join(mkdtempSync(join(tmpdir(), "qa-pilot-pr-")), "repo");
  run("git", ["worktree", "add", "--quiet", "-b", branch, dir, `origin/${base}`]);
  try {
    for (const f of opts.files) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    run("git", ["add", ...opts.files.map((f) => f.path)], dir);
    run("git", ["commit", "--quiet", "-F", "-"], dir, opts.commitMessage);
    run("git", ["push", "--quiet", "-u", "origin", branch], dir);
    const url = run("gh", ["pr", "create", "--base", base, "--head", branch, "--title", opts.title, "--body-file", "-"], dir, opts.body);
    return { url, branch };
  } finally {
    run("git", ["worktree", "remove", "--force", dir]);
  }
}
