/** The JSON shape the AI test writer must return. */
import { z } from "zod";

export const TestBlockSchema = z.object({
  caseId: z.string().describe('The approved case this test implements, e.g. "TC-05"'),
  code: z
    .string()
    .describe('ONE Jest test: it("TC-05 <title>", async () => { ... }); No imports, no describe.'),
});

export const WrittenTestsSchema = z.object({
  tests: z.array(TestBlockSchema),
  notCovered: z
    .array(z.object({ caseId: z.string(), reason: z.string() }))
    .describe("Approved cases you could not write a reliable test for, and why"),
});

export type TestBlock = z.infer<typeof TestBlockSchema>;
export type WrittenTests = z.infer<typeof WrittenTestsSchema>;
