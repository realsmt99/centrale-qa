/**
 * Rule-based test writer: the free stand-in for Claude.
 *
 * It turns an approved case into a Jest test using templates and the request
 * examples. It only writes tests for case shapes it understands:
 *   - "... succeeds"                 -> valid example request, expect the status in Expected
 *   - "... without a token ..."      -> same request without auth, expect 401, nothing saved
 *   - steps like "with X = V"        -> change X in the example, expect the status in Expected
 *   - db_check on a write endpoint   -> send the example, read rows back with sqlCheck
 *   - "... is visible in GET /search"-> import, then search for the new price
 * Anything else is reported as "not covered" instead of guessed.
 */
import type { ApprovedCase } from "./write";
import { REQUEST_EXAMPLES, type RequestExample } from "./examples";
import type { TestBlock, WrittenTests } from "./schema";

/** Which table a write endpoint changes (to check "nothing was saved"). */
const WRITE_TABLES: Record<string, string> = { "POST /feeds/import": "listings" };

function expectedStatus(expected: string, fallback: number): number {
  const m = /\b([1-5]\d\d)\b/.exec(expected);
  return m ? Number(m[1]) : fallback;
}

function callCode(ex: RequestExample, opts: { auth?: boolean; url?: string; body?: unknown } = {}): string {
  let code = `request(app.server).${ex.method.toLowerCase()}(${JSON.stringify(opts.url ?? ex.url)})`;
  if (opts.auth ?? ex.auth) code += ".set(authHeader)";
  if (ex.method === "POST") code += `.send(${JSON.stringify(opts.body ?? ex.body)})`;
  return code;
}

/** "cars[].price" = -1 -> body.cars[0].price = -1 ; "priceMin" = -1 -> url ?priceMin=-1 */
function withValue(ex: RequestExample, field: string, value: number): { url: string; body: unknown } {
  const body = structuredClone(ex.body ?? {}) as Record<string, unknown>;
  const [head, leaf] = field.split("[].");
  if (leaf && Array.isArray(body[head])) {
    (body[head] as Record<string, unknown>[])[0][leaf] = value;
    return { url: ex.url, body };
  }
  if (ex.method === "POST" && field in body) {
    body[field] = value;
    return { url: ex.url, body };
  }
  const sep = ex.url.includes("?") ? "&" : "?";
  return { url: `${ex.url}${sep}${encodeURIComponent(field)}=${value}`, body };
}

function block(c: ApprovedCase, ex: RequestExample, lines: string[]): TestBlock {
  const body = [
    "const { app, db } = await makeTestApp();",
    ...(c.note ? [`// Reviewer note: ${c.note}`] : []),
    ...(ex.setup ? [ex.setup] : []),
    ...lines,
    "await app.close();",
  ];
  return {
    caseId: c.id,
    code: `it(${JSON.stringify(`${c.id} ${c.title}`)}, async () => {\n${body.map((l) => `  ${l}`).join("\n")}\n});`,
  };
}

function nothingSaved(endpoint: string): string[] {
  const table = WRITE_TABLES[endpoint];
  return table ? [`expect(sqlCheck<{ n: number }>(db, "SELECT COUNT(*) AS n FROM ${table}")[0].n).toBe(0);`] : [];
}

function writeOne(c: ApprovedCase): TestBlock | { reason: string } {
  const ex = REQUEST_EXAMPLES[c.endpoint];
  if (!ex) return { reason: `No request example for ${c.endpoint}` };
  const text = `${c.title} ${c.steps.join(" ")}`;

  if (/without a token|no authorization/i.test(text)) {
    return block(c, ex, [
      `const res = await ${callCode(ex, { auth: false })};`,
      `expect(res.status).toBe(${expectedStatus(c.expected, 401)});`,
      ...nothingSaved(c.endpoint),
    ]);
  }

  const assignments = [...c.steps.join(" ").matchAll(/with ([\w[\].]+) = (-?\d+)/g)];
  if (assignments.length > 0 && (c.kind === "negative" || c.kind === "edge")) {
    const status = expectedStatus(c.expected, 400);
    const lines: string[] = [];
    for (const [, field, value] of assignments) {
      const { url, body } = withValue(ex, field, Number(value));
      lines.push(`expect((await ${callCode(ex, { url, body })}).status).toBe(${status}); // ${field} = ${value}`);
    }
    return block(c, ex, [...lines, ...(status >= 400 ? nothingSaved(c.endpoint) : [])]);
  }

  if (c.kind === "db_check" && ex.method === "POST" && WRITE_TABLES[c.endpoint] === "listings") {
    const cars = (ex.body as { cars: Record<string, unknown>[] }).cars;
    return block(c, ex, [
      `expect((await ${callCode(ex)}).status).toBe(200);`,
      ...cars.map(
        (car) =>
          `expect(sqlCheck(db, "SELECT version_id, year, mileage_km, price FROM listings WHERE dealer_id = 'D001' AND external_ref = ? AND status = 'active'", ${JSON.stringify(car.externalRef)})).toEqual([{ version_id: ${car.versionId}, year: ${car.year}, mileage_km: ${car.mileageKm}, price: ${car.price} }]);`,
      ),
    ]);
  }

  if (/visible in GET \/search/i.test(c.title)) {
    const importEx = REQUEST_EXAMPLES["POST /feeds/import"];
    const price = (importEx.body as { cars: { price: number }[] }).cars[0].price;
    return block(c, { ...ex, setup: undefined }, [
      `expect((await ${callCode(importEx)}).status).toBe(200);`,
      `const res = await request(app.server).get("/search?pageSize=100");`,
      `expect(res.body.results.map((r: { price: number }) => r.price)).toContain(${price});`,
    ]);
  }

  if (/succeeds/i.test(c.title) || c.kind === "normal") {
    return block(c, ex, [`const res = await ${callCode(ex)};`, `expect(res.status).toBe(${expectedStatus(c.expected, 200)});`]);
  }

  return { reason: "The rule-based writer has no template for this kind of case" };
}

export function mockWriteTests(cases: ApprovedCase[]): WrittenTests {
  const out: WrittenTests = { tests: [], notCovered: [] };
  for (const c of cases) {
    const written = writeOne(c);
    if ("reason" in written) out.notCovered.push({ caseId: c.id, reason: written.reason });
    else out.tests.push(written);
  }
  return out;
}
