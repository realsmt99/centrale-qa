/**
 * Tests for QA Pilot's test designer. No network: the AI is replaced by
 * fakes that return exactly what each test needs (good, broken, or
 * dangerous output), so we can prove the guardrails work.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiClient, AiResponse } from "../../qa-pilot/ai/client";
import { MockAiClient } from "../../qa-pilot/ai/mock";
import { DesignError, designTests } from "../../qa-pilot/designer/design";
import { applyGuardrails, isReadOnlySql } from "../../qa-pilot/designer/guardrails";
import { renderMarkdown } from "../../qa-pilot/designer/render";
import type { TestCase, TestDesign } from "../../qa-pilot/designer/schema";
import { loadSpec, normalizeEndpoint } from "../../qa-pilot/openapi";

const spec = loadSpec();
const story = readFileSync("stories/US-001-price-update.md", "utf8");
const input = { storyId: "US-001", story, spec };

let logFile: string;
beforeEach(() => {
  logFile = join(mkdtempSync(join(tmpdir(), "qa-pilot-")), "ai-actions.jsonl");
  process.env.QA_PILOT_LOG = logFile;
});
const logLines = () => readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const tc = (overrides: Partial<TestCase> = {}): TestCase => ({
  id: "TC-01",
  title: "Search by brand",
  kind: "normal",
  endpoint: "GET /search",
  preconditions: [],
  steps: ["Call GET /search?brand=Peugeot"],
  expected: "200 with only Peugeot cars",
  sqlCheck: null,
  confidence: "high",
  doubt: null,
  ...overrides,
});
const design = (testCases: TestCase[]): TestDesign => ({
  storyId: "US-001",
  summary: "s",
  assumptions: [],
  openQuestions: [],
  testCases,
});

/** A fake AI that returns the given outputs in order. */
function fakeAi(...outputs: unknown[]): AiClient & { calls: number } {
  return {
    provider: "mock",
    model: "fake",
    calls: 0,
    async generate(): Promise<AiResponse> {
      const output = outputs[Math.min(this.calls, outputs.length - 1)];
      this.calls++;
      return { output, provider: "mock", model: "fake", stopReason: "end_turn" };
    },
  };
}

describe("normalizeEndpoint", () => {
  it.each([
    ["get /search?fuel=diesel", "GET /search"],
    ["GET /vehicles/:plate", "GET /vehicles/{plate}"],
    ["post /feeds/import/", "POST /feeds/import"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeEndpoint(raw)).toBe(expected);
  });
});

describe("guardrails", () => {
  const known = new Set(["GET /search", "POST /feeds/import", "GET /vehicles/{plate}"]);

  it("removes a case that uses an endpoint the API doesn't have (AI invented it)", () => {
    const r = applyGuardrails(design([tc(), tc({ endpoint: "PATCH /listings/{id}", title: "Patch price" })]), known);

    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([expect.objectContaining({ reasons: ["unknown_endpoint"] })]);
  });

  it.each([
    "DELETE FROM listings",
    "UPDATE listings SET price = 0",
    "SELECT 1; DROP TABLE listings",
    "PRAGMA writable_schema = 1",
    "INSERT INTO dealers VALUES ('x','y','z')",
  ])("removes a case whose SQL is not read-only: %s", (sql) => {
    const r = applyGuardrails(design([tc({ sqlCheck: sql })]), known);

    expect(r.rejected[0].reasons).toContain("unsafe_sql");
  });

  it.each([
    "SELECT price FROM listings WHERE external_ref = 'REF-1'",
    "select count(*) from listings;",
    "WITH a AS (SELECT 1) SELECT * FROM a",
  ])("keeps read-only SQL: %s", (sql) => {
    expect(isReadOnlySql(sql)).toBe(true);
  });

  it("removes a case with no steps or no expected result", () => {
    const r = applyGuardrails(design([tc({ steps: [] }), tc({ expected: " " })]), known);

    expect(r.rejected.map((x) => x.reasons)).toEqual([["incomplete"], ["incomplete"]]);
  });

  it("flags low confidence, and a doubt that the AI forgot to explain", () => {
    const r = applyGuardrails(
      design([tc({ confidence: "low", doubt: "spec and story disagree" }), tc({ confidence: "medium", doubt: null })]),
      known,
    );

    expect(r.accepted.map((c) => c.flags)).toEqual([["low_confidence"], ["missing_doubt"]]);
  });

  it("renumbers kept cases TC-01, TC-02... and normalizes endpoints", () => {
    const r = applyGuardrails(
      design([tc({ id: "x" }), tc({ endpoint: "BAD /x" }), tc({ id: "y", endpoint: "get /vehicles/:plate" })]),
      known,
    );

    expect(r.accepted.map((c) => [c.id, c.endpoint])).toEqual([
      ["TC-01", "GET /search"],
      ["TC-02", "GET /vehicles/{plate}"],
    ]);
  });
});

describe("designTests", () => {
  it("retries once when the AI's JSON is invalid, telling it what was wrong", async () => {
    const ai = fakeAi({ storyId: "US-001" }, design([tc()]));

    const result = await designTests(ai, input);

    expect(ai.calls).toBe(2);
    expect(result.meta.attempts).toBe(2);
    expect(logLines().map((l) => l.status)).toEqual(["invalid_output", "ok"]);
  });

  it("gives up after 2 invalid answers (no endless retries)", async () => {
    const ai = fakeAi("not json at all");

    await expect(designTests(ai, input)).rejects.toThrow(DesignError);
    expect(ai.calls).toBe(2);
  });

  it("logs every AI action as one JSON line", async () => {
    await designTests(fakeAi(design([tc(), tc({ endpoint: "GET /nope" })])), input);

    const [entry] = logLines();
    expect(entry).toMatchObject({
      action: "design_tests",
      provider: "mock",
      status: "ok",
      attempt: 1,
      details: { proposed: 2, accepted: 1, rejected: [{ title: "Search by brand", reasons: ["unknown_endpoint"] }] },
    });
    expect(entry.promptSha256).toMatch(/^[0-9a-f]{16}$/);
    expect(entry.ts).toBeDefined();
  });
});

describe("rule-based mock designer on US-001", () => {
  it("is deterministic", async () => {
    const a = await designTests(new MockAiClient(), input);
    const b = await designTests(new MockAiClient(), input);

    expect(a.accepted).toEqual(b.accepted);
  });

  it("finds both endpoints the story touches, and asks how a price is changed", async () => {
    const r = await designTests(new MockAiClient(), input);

    expect(new Set(r.accepted.map((c) => c.endpoint))).toEqual(new Set(["POST /feeds/import", "GET /search"]));
    expect(r.design.openQuestions.join(" ")).toMatch(/no PUT or PATCH/);
    expect(r.rejected).toEqual([]);
  });

  it("proposes 'price = 0 is rejected' and flags it, because the spec has no minimum but the story does", async () => {
    const r = await designTests(new MockAiClient(), input);

    const priceCase = r.accepted.find((c) => c.title.includes("price = 0"));
    expect(priceCase).toMatchObject({ kind: "edge", confidence: "low", flags: ["low_confidence"] });
  });
});

describe("renderMarkdown", () => {
  it("renders an approval checklist, and lists removed cases separately", async () => {
    const r = await designTests(fakeAi(design([tc(), tc({ endpoint: "DELETE /everything", title: "Wipe" })])), input);

    const md = renderMarkdown(r);
    expect(md).toContain("- [ ] **TC-01** `normal` `GET /search`: Search by brand");
    expect(md).toContain("### Removed by guardrails (1)");
    expect(md).toContain("~~Wipe~~");
  });
});
