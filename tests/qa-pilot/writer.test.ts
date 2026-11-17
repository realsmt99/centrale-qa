/**
 * Tests for QA Pilot's test writer: code guardrails, read-only DB access,
 * first-run parsing, and how tests are split between the regression and
 * bug-hunt suites. The AI and the Jest run are replaced by fakes.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiClient, AiResponse } from "../../qa-pilot/ai/client";
import { loadSpec } from "../../qa-pilot/openapi";
import { checkBlock, describeRejection } from "../../qa-pilot/writer/guardrails";
import { mockWriteTests } from "../../qa-pilot/writer/mock-writer";
import { parseJestJson, type FirstRun } from "../../qa-pilot/writer/runner";
import type { WrittenTests } from "../../qa-pilot/writer/schema";
import { WriteError, testFiles, writeTests, type ApprovedCase } from "../../qa-pilot/writer/write";
import { loadReferenceVersions, openDb } from "../../src/db";
import { sqlCheck } from "../qa-helpers";

beforeEach(() => {
  process.env.QA_PILOT_LOG = join(mkdtempSync(join(tmpdir(), "qa-pilot-")), "log.jsonl");
});

const approved = new Set(["TC-01", "TC-02"]);
const good = `it("TC-01 search works", async () => {
  const { app, db } = await makeTestApp();
  const res = await request(app.server).post("/feeds/import?dealerId=D001").set(authHeader).send({ cars: [] });
  expect(res.status).toBe(200);
  expect(sqlCheck(db, "SELECT COUNT(*) AS n FROM listings")).toEqual([{ n: 0 }]);
  await app.close();
});`;
const reasons = (code: string, caseId = "TC-01") => checkBlock({ caseId, code }, approved).map(describeRejection);

describe("code guardrails", () => {
  it("accept a well-formed test, even with the word 'import' in a URL", () => {
    expect(reasons(good)).toEqual([]);
  });

  it.each([
    ["an import statement", `import fs from "fs";\n${good}`, "forbidden: import"],
    ["a dynamic import", good.replace("expect(res", 'await import("fs"); expect(res'), "forbidden: import"],
    ["require()", good.replace("expect(res", 'require("fs"); expect(res'), "forbidden: require()"],
    ["direct DB writes", good.replace("expect(res", 'db.prepare("DELETE FROM listings").run(); expect(res'), "forbidden: direct DB access (use sqlCheck)"],
    ["process.env", good.replace("expect(res", "process.env.X; expect(res"), "forbidden: process"],
    ["the file system", good.replace("expect(res", 'fs.readFileSync("/etc/passwd"); expect(res'), "forbidden: system module"],
    ["it.only", good.replace("it(", "it.only("), "forbidden: .only/.skip"],
    ["calling another server", good.replace("request(app.server)", 'request("https://example.com")'), "forbidden: request() to something other than app.server"],
    ["fetch()", good.replace("expect(res", 'await fetch("https://example.com"); expect(res'), "forbidden: other network/global access"],
  ])("reject %s", (_label, code, expected) => {
    expect(reasons(code)).toContain(expected);
  });

  it("reject a test without any assertion", () => {
    expect(reasons(`it("TC-01 nothing", async () => { await makeTestApp(); });`)).toContain("no_assertion");
  });

  it("reject a test whose name doesn't start with its case id, or that holds two tests", () => {
    expect(reasons(good.replace("TC-01 search", "search"))).toContain("bad_shape");
    expect(reasons(`${good}\n${good}`)).toContain("bad_shape");
  });

  it("reject a test for a case the human did not approve", () => {
    expect(reasons(good.replace("TC-01", "TC-09"), "TC-09")).toContain("not_approved");
  });
});

describe("sqlCheck (the only door to the DB for AI-written tests)", () => {
  const db = openDb();
  loadReferenceVersions(db);

  it("runs a SELECT", () => {
    expect(sqlCheck(db, "SELECT COUNT(*) AS n FROM versions")).toEqual([{ n: 41 }]);
  });

  it.each(["DELETE FROM versions", "UPDATE versions SET new_price = 0", "INSERT INTO dealers VALUES ('x','y','z')", "PRAGMA journal_mode = wal"])(
    "refuses %s (SQLite itself says it's not read-only)",
    (sql) => {
      expect(() => sqlCheck(db, sql)).toThrow(/only runs read-only/);
    },
  );
});

describe("parseJestJson", () => {
  it("tells 'the file could not run' apart from 'a test failed'", () => {
    const crashed = parseJestJson({
      numRuntimeErrorTestSuites: 1,
      testResults: [{ status: "failed", message: "\u001b[31mTS2304: Cannot find name 'foo'\u001b[0m", assertionResults: [] }],
    });
    const ran = parseJestJson({
      testResults: [
        {
          status: "failed",
          message: "",
          assertionResults: [
            { title: "TC-01 ok", status: "passed", failureMessages: [] },
            {
              title: "TC-02 price",
              status: "failed",
              failureMessages: ["Expected: 400\n\nReceived: 200\n    at Object.<anonymous> (/Users/someone/project/tests/x.test.ts:12:3)"],
            },
          ],
        },
      ],
    });

    expect(crashed.suiteError).toBe("TS2304: Cannot find name 'foo'");
    expect(ran.suiteError).toBeNull();
    expect(ran.results.get("TC-01")).toEqual({ passed: true, message: null });
    expect(ran.results.get("TC-02")).toEqual({ passed: false, message: "Expected: 400\nReceived: 200" });
  });
});

const caseOf = (id: string, overrides: Partial<ApprovedCase> = {}): ApprovedCase => ({
  id,
  title: `case ${id}`,
  kind: "normal",
  endpoint: "GET /search",
  preconditions: [],
  steps: ["Call GET /search"],
  expected: "200",
  sqlCheck: null,
  confidence: "high",
  doubt: null,
  note: null,
  ...overrides,
});

function fakeAi(...outputs: WrittenTests[]): AiClient & { calls: number } {
  return {
    provider: "mock",
    model: "fake",
    calls: 0,
    async generate(): Promise<AiResponse> {
      const output = outputs[Math.min(this.calls++, outputs.length - 1)];
      return { output, provider: "mock", model: "fake", stopReason: "end_turn" };
    },
  };
}
const block = (id: string) => ({ caseId: id, code: good.replace("TC-01", id) });
const fakeRun = (results: Record<string, boolean | string>): (() => FirstRun) => () =>
  typeof results.crash === "string"
    ? { suiteError: results.crash, results: new Map() }
    : {
        suiteError: null,
        results: new Map(Object.entries(results).map(([id, passed]) => [id, { passed: passed === true, message: passed === true ? null : "Expected: 400\nReceived: 200" }])),
      };

describe("writeTests", () => {
  const spec = loadSpec();
  const input = { storyId: "US-001", cases: [caseOf("TC-01"), caseOf("TC-02"), caseOf("TC-03")], spec };

  it("splits tests by their first run, and reports removed and missing cases", async () => {
    const ai = fakeAi({
      tests: [block("TC-01"), block("TC-02"), { caseId: "TC-03", code: 'it("TC-03 x", async () => { require("fs"); expect(1).toBe(1); });' }],
      notCovered: [],
    });

    const r = await writeTests(ai, input, fakeRun({ "TC-01": true, "TC-02": false }));

    expect(r.passing.map((b) => b.caseId)).toEqual(["TC-01"]);
    expect(r.failing.map((b) => b.caseId)).toEqual(["TC-02"]);
    expect(r.rejected).toEqual([{ caseId: "TC-03", reasons: ["forbidden: require()"] }]);
    expect(r.notCovered).toEqual([]);
  });

  it("retries once when the file can't run at all, then gives up (broken code never reaches a PR)", async () => {
    const ai = fakeAi({ tests: [block("TC-01")], notCovered: [] });

    await expect(writeTests(ai, input, fakeRun({ crash: "SyntaxError" }))).rejects.toThrow(WriteError);
    expect(ai.calls).toBe(2);
  });

  it("lists approved cases that got no test as 'not covered'", async () => {
    const ai = fakeAi({ tests: [block("TC-01")], notCovered: [{ caseId: "TC-02", reason: "needs a second dealer feed" }] });

    const r = await writeTests(ai, input, fakeRun({ "TC-01": true }));

    expect(r.notCovered).toEqual([
      { caseId: "TC-02", reason: "needs a second dealer feed" },
      { caseId: "TC-03", reason: "No valid test was produced" },
    ]);
  });
});

describe("testFiles", () => {
  it("puts passing tests in the regression suite and failing ones in the bug-hunt suite", () => {
    const files = testFiles("US-001", 7, {
      passing: [block("TC-01")],
      failing: [{ ...block("TC-02"), message: "Expected: 400\nReceived: 200" }],
      rejected: [],
      notCovered: [],
      meta: { provider: "mock", model: "fake", attempts: 1 },
    });

    expect(files.map((f) => f.path)).toEqual(["tests/generated/US-001.ai.test.ts", "tests/generated/US-001.ai.bughunt.test.ts"]);
    expect(files[0].content).toContain('import { registerPlate, sqlCheck } from "../qa-helpers";');
    expect(files[1].content).toContain("// First run failed:");
    expect(files[1].content).toContain("// Received: 200");
  });
});

describe("rule-based mock writer", () => {
  it("turns 'price = 0 is rejected' into two requests that expect 400 and nothing saved", () => {
    const out = mockWriteTests([
      caseOf("TC-08", {
        kind: "edge",
        endpoint: "POST /feeds/import",
        title: "cars[].price = 0 is rejected",
        steps: ["Call POST /feeds/import with cars[].price = 0", "Repeat with cars[].price = -1"],
        expected: "400 for both, nothing saved",
      }),
    ]);

    const code = out.tests[0].code;
    expect(code).toContain('"price":0');
    expect(code).toContain('"price":-1');
    expect(code.match(/toBe\(400\)/g)).toHaveLength(2);
    expect(code).toContain("SELECT COUNT(*) AS n FROM listings");
    expect(checkBlock(out.tests[0], new Set(["TC-08"]))).toEqual([]);
  });

  it("says 'not covered' instead of guessing when it has no template", () => {
    const out = mockWriteTests([caseOf("TC-04", { endpoint: "DELETE /nope" })]);

    expect(out).toEqual({ tests: [], notCovered: [{ caseId: "TC-04", reason: "No request example for DELETE /nope" }] });
  });
});
