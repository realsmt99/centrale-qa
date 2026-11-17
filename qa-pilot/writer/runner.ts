/**
 * Builds a test file from approved blocks and runs it ONCE with Jest.
 *
 * Two different outcomes matter:
 *   - the file doesn't run at all (type error, syntax error, crash in setup)
 *     -> the AI's code is broken: it never reaches a pull request
 *   - the file runs, and some tests fail
 *     -> fine: a failing test may have found a bug. It's reported, and a
 *        human decides (bug in the app, or wrong test?)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_HEADER } from "./examples";
import type { TestBlock } from "./schema";

export const GENERATED_DIR = join("tests", "generated");

export interface FirstRun {
  /** Set when the file could not run at all. */
  suiteError: string | null;
  results: Map<string, { passed: boolean; message: string | null }>;
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

export function assembleFile(comment: string, blocks: TestBlock[], extra: Map<string, string> = new Map()): string {
  const body = blocks
    .map((b) => {
      const note = extra.get(b.caseId);
      const indented = b.code.trim().split("\n").map((l) => `  ${l}`).join("\n");
      return note ? `${note.split("\n").map((l) => `  // ${l}`).join("\n")}\n${indented}` : indented;
    })
    .join("\n\n");
  return `/**\n${comment.split("\n").map((l) => ` * ${l}`.trimEnd()).join("\n")}\n */\n${GENERATED_HEADER}\n\ndescribe("AI-written tests", () => {\n${body}\n});\n`;
}

export function parseJestJson(json: {
  numRuntimeErrorTestSuites?: number;
  testResults: { status: string; message: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[];
}): FirstRun {
  const suite = json.testResults[0];
  if (!suite || (json.numRuntimeErrorTestSuites ?? 0) > 0 || (suite.status === "failed" && suite.assertionResults.length === 0)) {
    return { suiteError: stripAnsi(suite?.message ?? "The test file did not run").slice(0, 2000), results: new Map() };
  }
  const results = new Map<string, { passed: boolean; message: string | null }>();
  for (const a of suite.assertionResults) {
    const caseId = /^(TC-\d+)/.exec(a.title)?.[1];
    if (!caseId) continue;
    // Keep the assertion, drop the stack trace: it holds local file paths that must not end up in a PR.
    const message =
      a.failureMessages.length > 0
        ? stripAnsi(a.failureMessages[0])
            .split("\n")
            .filter((line) => !/^\s+at\s/.test(line) && line.trim() !== "")
            .slice(0, 4)
            .join("\n")
        : null;
    results.set(caseId, { passed: a.status === "passed", message });
  }
  return { suiteError: null, results };
}

export function runOnce(fileContent: string): FirstRun {
  mkdirSync(GENERATED_DIR, { recursive: true });
  const id = `${process.pid}-${Date.now()}`;
  const testFile = join(GENERATED_DIR, `.qa-pilot-run-${id}.test.ts`);
  const outFile = join(GENERATED_DIR, `.qa-pilot-run-${id}.json`);
  writeFileSync(testFile, fileContent);
  try {
    try {
      execFileSync("npx", ["jest", testFile, "--json", "--outputFile", outFile, "--ci"], { stdio: "pipe" });
    } catch {
      // Jest exits with 1 when a test fails: that's expected, the JSON tells us what happened.
    }
    let json;
    try {
      json = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      return { suiteError: "Jest produced no result (the file probably failed to compile)", results: new Map() };
    }
    return parseJestJson(json);
  } finally {
    rmSync(testFile, { force: true });
    rmSync(outFile, { force: true });
  }
}
