/**
 * Every AI action is logged, one JSON object per line (JSONL), so we can
 * later answer: what did the AI do, with which model, how often did its
 * output fail validation, and what did it cost?
 *
 * We log a hash of the prompt, not the prompt itself (it can be large).
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AiActionLog {
  action: string;
  provider: string;
  model: string;
  status: "ok" | "invalid_output" | "error" | "refusal";
  attempt?: number;
  durationMs?: number;
  promptSha256?: string;
  promptChars?: number;
  usage?: { inputTokens: number; outputTokens: number };
  details?: Record<string, unknown>;
}

export function logPath(): string {
  return process.env.QA_PILOT_LOG ?? "reports/qa-pilot/ai-actions.jsonl";
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function logAiAction(entry: AiActionLog): void {
  const path = logPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}
