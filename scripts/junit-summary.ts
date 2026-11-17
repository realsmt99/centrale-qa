/**
 * npm run scale:summary -- reports/scale-1.xml reports/scale-2.xml ...
 *
 * Reads JUnit XML test reports and prints a Markdown table with one row per
 * rule (a `describe` block): how many cases were checked, how many broke it.
 * In GitHub Actions the table is also written to the job summary page.
 */
import { appendFileSync, readFileSync } from "node:fs";

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (attrs: string, name: string) => unescape(new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? "");

export interface RuleRow {
  rule: string;
  checked: number;
  broken: number;
}

export function summarize(xmlFiles: string[]): RuleRow[] {
  const rows = new Map<string, RuleRow>();
  for (const file of xmlFiles) {
    const xml = readFileSync(file, "utf8");
    for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const rule = attr(m[1], "classname") || "(no rule)";
      const row = rows.get(rule) ?? { rule, checked: 0, broken: 0 };
      row.checked++;
      if (m[2]?.includes("<failure")) row.broken++;
      rows.set(rule, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.broken - a.broken || a.rule.localeCompare(b.rule));
}

export function toMarkdown(rows: RuleRow[]): string {
  const total = rows.reduce((t, r) => ({ checked: t.checked + r.checked, broken: t.broken + r.broken }), { checked: 0, broken: 0 });
  const fmt = (n: number) => n.toLocaleString("en-US");
  return [
    `### Scale tests: ${fmt(total.checked)} checks, ${fmt(total.broken)} broken`,
    "",
    "| Rule | Checked | Broken |",
    "|---|---:|---:|",
    ...rows.map((r) => `| ${r.broken > 0 ? "❌" : "✅"} ${r.rule} | ${fmt(r.checked)} | ${fmt(r.broken)} |`),
    "",
  ].join("\n");
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: npm run scale:summary -- <junit.xml> [...]");
    process.exit(2);
  }
  const markdown = toMarkdown(summarize(files));
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}
