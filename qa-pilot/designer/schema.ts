/**
 * The exact JSON shape the AI test designer must return.
 * It is sent to Claude as the required output format AND re-checked by Zod
 * when the answer comes back.
 */
import { z } from "zod";

export const CASE_KINDS = ["normal", "negative", "edge", "db_check"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;

export const TestCaseSchema = z.object({
  id: z.string().describe('Sequential id: "TC-01", "TC-02", ...'),
  title: z.string().describe("One line, plain language"),
  kind: z.enum(CASE_KINDS),
  endpoint: z.string().describe('HTTP method + path exactly as in the OpenAPI spec, e.g. "GET /search"'),
  preconditions: z.array(z.string()).describe("Data or state needed before the steps"),
  steps: z.array(z.string()).describe("What the test does, in order"),
  expected: z.string().describe("Observable expected result: status code, fields, values"),
  sqlCheck: z
    .string()
    .nullable()
    .describe("Optional read-only SQL (a single SELECT) that checks the database afterwards"),
  confidence: z.enum(CONFIDENCE).describe("How sure you are that this expectation is what the story wants"),
  doubt: z
    .string()
    .nullable()
    .describe("Required unless confidence is high: what you are unsure about, and why"),
});

export const TestDesignSchema = z.object({
  storyId: z.string(),
  summary: z.string().describe("The story in one or two sentences, as you understood it"),
  assumptions: z.array(z.string()).describe("Things you assumed because the story or spec did not say"),
  openQuestions: z.array(z.string()).describe("Questions a human should answer before these tests are trusted"),
  testCases: z.array(TestCaseSchema),
});

export type TestCase = z.infer<typeof TestCaseSchema>;
export type TestDesign = z.infer<typeof TestDesignSchema>;
