/**
 * Human approval on a GitHub Issue: we simulate what a reviewer does to the
 * checklist comment (tick, edit, add a note, delete a case) and check that
 * QA Pilot reads every decision back correctly.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAiClient } from "../../qa-pilot/ai/mock";
import { designTests, type DesignResult } from "../../qa-pilot/designer/design";
import {
  buildProposalComment,
  isProposalComment,
  parseReview,
  readReviewPayload,
  renderReviewSummary,
} from "../../qa-pilot/review/comment";
import { loadSpec } from "../../qa-pilot/openapi";

let result: DesignResult;
let comment: string;

beforeAll(async () => {
  process.env.QA_PILOT_LOG = join(mkdtempSync(join(tmpdir(), "qa-pilot-")), "log.jsonl");
  const story = readFileSync("stories/US-001-price-update.md", "utf8");
  result = await designTests(new MockAiClient(), { storyId: "US-001", story, spec: loadSpec() });
  comment = buildProposalComment(result);
});

const tick = (body: string, id: string) => body.replace(`- [ ] **${id}**`, `- [x] **${id}**`);
const caseLine = (id: string) => comment.split("\n").find((l) => l.includes(`**${id}**`))!;

describe("proposal comment", () => {
  it("is a checklist with every case unticked, plus review instructions", () => {
    expect(comment.match(/^- \[ \] \*\*TC-\d+\*\*/gm)).toHaveLength(result.accepted.length);
    expect(comment).toContain("add the label `qa-pilot:approved`");
    expect(isProposalComment(comment)).toBe(true);
  });

  it("hides the original cases in an HTML comment (invisible on GitHub)", () => {
    expect(comment).toMatch(/<!-- qa-pilot:proposals:v1 [A-Za-z0-9+/=]+ -->$/);
  });
});

describe("parseReview", () => {
  it("treats an untouched checklist as: everything rejected", () => {
    const review = parseReview(comment);

    expect(review.stats).toMatchObject({ proposed: 10, approved: 0, rejected: 10, acceptanceRate: 0 });
  });

  it("ticked = approved, unticked = rejected", () => {
    const body = tick(tick(comment, "TC-01"), "TC-08");

    const review = parseReview(body);

    expect(review.decisions.filter((d) => d.decision === "approved").map((d) => d.id)).toEqual(["TC-01", "TC-08"]);
    expect(review.stats).toMatchObject({ approved: 2, approvedAsIs: 2, rejected: 8, acceptanceRate: 0.2 });
  });

  it("accepts [X] as well as [x]", () => {
    const review = parseReview(comment.replace("- [ ] **TC-02**", "- [X] **TC-02**"));

    expect(review.decisions.find((d) => d.id === "TC-02")!.decision).toBe("approved");
  });

  it("applies the human's edits to the title and Expected line, and counts them", () => {
    const original = result.accepted.find((c) => c.id === "TC-08")!;
    const edited = comment
      .replace(caseLine("TC-08"), caseLine("TC-08").replace(original.title, "Price 0 or negative must be refused"))
      .replace(`  - Expected: ${original.expected}`, "  - Expected: 400 with a message about the price; no row saved");
    const body = tick(edited, "TC-08");

    const decision = parseReview(body).decisions.find((d) => d.id === "TC-08")!;

    expect(decision.editedFields).toEqual(["title", "expected"]);
    expect(decision.testCase.title).toBe("Price 0 or negative must be refused");
    expect(decision.testCase.expected).toBe("400 with a message about the price; no row saved");
    expect(decision.testCase.endpoint).toBe(original.endpoint); // endpoint stays what the guardrails checked
  });

  it("reads edited steps back into a list", () => {
    const body = tick(comment, "TC-01").replace(
      /(\*\*TC-01\*\*[^\n]*\n(?:  [^\n]*\n)*?)  - Steps: [^\n]*/,
      "$1  - Steps: (1) Call GET /search?brand=Peugeot (2) Check every result is a Peugeot",
    );

    const decision = parseReview(body).decisions.find((d) => d.id === "TC-01")!;

    expect(decision.testCase.steps).toEqual(["Call GET /search?brand=Peugeot", "Check every result is a Peugeot"]);
    expect(decision.editedFields).toEqual(["steps"]);
  });

  it("keeps a reviewer's note for the test writer, and counts it as an edit", () => {
    const body = tick(comment.replace(caseLine("TC-05"), `${caseLine("TC-05")}\n  - Note: also try a wrong token`), "TC-05");

    const review = parseReview(body);
    const decision = review.decisions.find((d) => d.id === "TC-05")!;

    expect(decision.note).toBe("also try a wrong token");
    expect(review.stats).toMatchObject({ approved: 1, approvedAsIs: 0, approvedEdited: 1 });
  });

  it("treats a case deleted from the comment as rejected", () => {
    const lines = comment.split("\n");
    const start = lines.findIndex((l) => l.includes("**TC-03**"));
    let end = start + 1;
    while (lines[end].startsWith("  ")) end++;
    const body = [...lines.slice(0, start), ...lines.slice(end)].join("\n");

    const decision = parseReview(body).decisions.find((d) => d.id === "TC-03")!;

    expect(decision).toMatchObject({ decision: "rejected", note: "Removed from the checklist" });
  });

  it("fails clearly on a comment that isn't a QA Pilot proposal", () => {
    expect(() => parseReview("LGTM!")).toThrow(/no QA Pilot proposals payload/);
  });
});

describe("review summary comment", () => {
  it("shows the counts and acceptance rate, and stores the review for the next step", () => {
    const review = parseReview(tick(tick(tick(comment, "TC-01"), "TC-05"), "TC-08"));

    const summary = renderReviewSummary(review);

    expect(summary).toContain("**Acceptance rate: 30%**");
    expect(summary).toContain("| Rejected | 7 |");
    expect(summary).toContain("turns the 3 approved case(s) into Jest tests");
    expect(readReviewPayload(summary)).toEqual(review);
  });
});
