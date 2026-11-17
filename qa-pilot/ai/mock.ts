/**
 * MockAiClient: a rule-based, deterministic stand-in for Claude.
 *
 * It lets the whole pipeline run without an API key (in CI, for anyone who
 * clones the repo). It reads the same inputs as Claude and returns JSON in the
 * same shape, but its "thinking" is simple rules over the OpenAPI spec:
 *   - pick the endpoints whose words overlap with the story
 *   - one normal case, one 401 case (if the endpoint needs a token),
 *     one 400 case per field that has a minimum in the spec
 *   - an edge case for numbers the story constrains but the spec doesn't
 *     ("must be above 0" vs no minimum in the spec), flagged low confidence
 *
 * It is a baseline, not a replacement: Claude is expected to do better
 * (cross-endpoint scenarios, real SQL checks, better wording).
 */
import { fieldsOf, listEndpoints, type Endpoint, type OpenApiSpec } from "../openapi";
import type { TestCase, TestDesign } from "../designer/schema";
import type { AiClient, AiRequest, AiResponse } from "./client";
import { mockWriteTests } from "../writer/mock-writer";
import type { ApprovedCase } from "../writer/write";

const STOPWORDS = new Set(
  "a an and the of to in on for is are be can i my me as it its with must should will by or at this that from one new".split(" "),
);

/** Lower-case words, camelCase split, plural "s" removed. */
function words(text: string): Set<string> {
  const spaced = text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return new Set(
    spaced
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => (w.endsWith("s") && w.length > 4 ? w.slice(0, -1) : w)),
  );
}

function endpointWords(e: Endpoint): Set<string> {
  const text = [e.path, e.op.summary, e.op.description, ...(e.op.tags ?? []), ...fieldsOf(e.op).map((f) => f.name)].join(" ");
  return words(text);
}

/** "must be above 0" / "greater than 0" / "at least 1" -> the number. */
function lowerBoundFromStory(story: string): { value: number; inclusive: boolean } | null {
  const m = /(above|greater than|more than|at least)\s+(-?\d+)/i.exec(story);
  if (!m) return null;
  return { value: Number(m[2]), inclusive: m[1].toLowerCase() === "at least" };
}

export function mockDesign(storyId: string, story: string, spec: OpenApiSpec): TestDesign {
  const storyWords = words(story);
  const scored = listEndpoints(spec)
    .map((e) => {
      const overlap = [...endpointWords(e)].filter((w) => storyWords.has(w));
      return { e, overlap };
    })
    .filter((s) => s.overlap.length >= 2)
    .sort((a, b) => b.overlap.length - a.overlap.length);

  const cases: Omit<TestCase, "id">[] = [];
  const bound = lowerBoundFromStory(story);

  for (const { e } of scored) {
    const fields = fieldsOf(e.op);

    cases.push({
      title: `Valid request to ${e.key} succeeds`,
      kind: "normal",
      endpoint: e.key,
      preconditions: e.op.security ? ["A valid API token"] : [],
      steps: [`Call ${e.key} with valid values for all required fields`],
      expected: "200, and the response body matches the spec",
      sqlCheck: null,
      confidence: "high",
      doubt: null,
    });

    if (e.op.security) {
      cases.push({
        title: `${e.key} without a token is rejected`,
        kind: "negative",
        endpoint: e.key,
        preconditions: [],
        steps: [`Call ${e.key} with no Authorization header`],
        expected: "401, and nothing is changed in the database",
        sqlCheck: null,
        confidence: "high",
        doubt: null,
      });
    }

    for (const f of fields.filter((f) => typeof f.schema.minimum === "number").slice(0, 2)) {
      cases.push({
        title: `${f.name} below its minimum (${f.schema.minimum}) is rejected`,
        kind: "negative",
        endpoint: e.key,
        preconditions: [],
        steps: [`Call ${e.key} with ${f.name} = ${(f.schema.minimum as number) - 1}`],
        expected: "400",
        sqlCheck: null,
        confidence: "high",
        doubt: null,
      });
    }

    // The story constrains a number the spec leaves open: classic gap between requirement and code.
    if (bound) {
      for (const f of fields.filter((f) => f.schema.type === "integer" && f.schema.minimum === undefined)) {
        const leaf = f.name.split(".").pop()!.toLowerCase();
        if (!storyWords.has(leaf)) continue;
        const bad = bound.inclusive ? bound.value - 1 : bound.value;
        cases.push({
          title: `${f.name} = ${bad} is rejected (story sets a lower bound)`,
          kind: "edge",
          endpoint: e.key,
          preconditions: e.op.security ? ["A valid API token"] : [],
          steps: [`Call ${e.key} with ${f.name} = ${bad}`, `Repeat with ${f.name} = -1`],
          expected: "400 for both, nothing saved",
          sqlCheck: null,
          confidence: "low",
          doubt: `The spec sets no minimum for ${f.name}, but the story requires a lower bound. Expected result follows the story.`,
        });
      }
    }

    if (e.method !== "GET") {
      cases.push({
        title: `Data stored by ${e.key} matches what was sent`,
        kind: "db_check",
        endpoint: e.key,
        preconditions: e.op.security ? ["A valid API token"] : [],
        steps: [`Call ${e.key} with known values`, "Read the stored rows back from the database"],
        expected: "Stored values equal the values sent",
        sqlCheck: null,
        confidence: "medium",
        doubt: "The rule-based designer cannot map endpoints to tables, so no SQL is proposed. A human should write it.",
      });
    }
  }

  // Story says something should "appear" in search after a change made elsewhere.
  const search = scored.find((s) => s.e.path === "/search");
  const writer = scored.find((s) => s.e.method !== "GET");
  if (search && writer && /appear|visible|show/i.test(story)) {
    cases.push({
      title: `A change made through ${writer.e.key} is visible in ${search.e.key}`,
      kind: "normal",
      endpoint: search.e.key,
      preconditions: [`A listing was changed through ${writer.e.key}`],
      steps: [`Search for that listing with ${search.e.key}`],
      expected: "The listing appears with the new values",
      sqlCheck: null,
      confidence: "medium",
      doubt: "Assumes search shows changes immediately (the story doesn't mention delays or caching).",
    });
  }

  const openQuestions: string[] = [];
  const hasUpdateEndpoint = listEndpoints(spec).some((e) => e.method === "PUT" || e.method === "PATCH");
  if (/\b(change|update|edit|modify)\b/i.test(story) && !hasUpdateEndpoint) {
    openQuestions.push(
      `The spec has no PUT or PATCH endpoint. Is this change done by re-sending data through ${writer?.e.key ?? "an existing endpoint"}?`,
    );
  }

  return {
    storyId,
    summary: story.split(/(?<=\.)\s/)[0].replace(/^#.*\n/, "").trim(),
    assumptions: scored.map((s) => `${s.e.key} is relevant (shared words: ${s.overlap.join(", ")})`),
    openQuestions,
    testCases: cases.map((c, i) => ({ id: `TC-${String(i + 1).padStart(2, "0")}`, ...c })),
  };
}

export class MockAiClient implements AiClient {
  readonly provider = "mock" as const;
  readonly model = "rule-based-v1";

  async generate<T>(request: AiRequest<T>): Promise<AiResponse> {
    let output: unknown;
    if (request.action === "design_tests") {
      const { storyId, story, spec } = request.context as { storyId: string; story: string; spec: OpenApiSpec };
      output = mockDesign(storyId, story, spec);
    } else if (request.action === "write_tests") {
      output = mockWriteTests((request.context as { cases: ApprovedCase[] }).cases);
    } else {
      throw new Error(`MockAiClient does not support action "${request.action}"`);
    }
    return { output, provider: this.provider, model: this.model, stopReason: "end_turn" };
  }
}
