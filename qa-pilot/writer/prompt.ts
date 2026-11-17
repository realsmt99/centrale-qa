/** Prompt for the AI test writer. */
import { SCHEMA_SQL } from "../../src/db";
import type { OpenApiSpec } from "../openapi";
import { HELPERS_DOC, REQUEST_EXAMPLES } from "./examples";
import type { ApprovedCase } from "./write";

export const WRITER_SYSTEM_PROMPT = `You are a QA engineer writing automated API tests in TypeScript with Jest and supertest, for a car marketplace backend.

You receive test cases that a human QA engineer has already approved. Write ONE Jest test per case, faithful to the approved steps and expected result. Follow the reviewer's note when there is one.

Rules:
- Each test is a single block: it("<caseId> <short title>", async () => { ... }); The name MUST start with the case id.
- Start every test with: const { app, db } = await makeTestApp();  and end it with: await app.close();
- Every test needs at least one expect(...). Assert the expected status code, and the fields or database rows the case talks about.
- Assert what the case says SHOULD happen, even if you suspect the API does something else. A failing test can be a real bug: never weaken an assertion to make it pass.
- Build requests from the examples below, changing only what the case needs. Use only data that exists (version ids from the catalogue, dealers D001-D003).
- Read the database only through sqlCheck(db, "SELECT ...", ...params). Never write to it, except through the provided test-data helpers.
- If you can't write a reliable test for a case, put it in notCovered with the reason instead of guessing.

${HELPERS_DOC}

Database schema (SQLite):
${SCHEMA_SQL}`;

export function buildWriterPrompt(storyId: string, cases: ApprovedCase[], spec: OpenApiSpec): string {
  return `Story ${storyId}. Approved test cases (JSON):
<cases>
${JSON.stringify(cases, null, 2)}
</cases>

Known-good request examples, one per endpoint (JSON):
<examples>
${JSON.stringify(REQUEST_EXAMPLES, null, 2)}
</examples>

OpenAPI spec:
<openapi>
${JSON.stringify(spec)}
</openapi>

Write the tests.`;
}
