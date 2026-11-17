# Phase 2: QA Pilot core

QA Pilot turns a user story into tests, with a human in control at every key step:

| Step | Who | Status |
|---|---|---|
| 1. User story | Human (GitHub Issue, or a Markdown file in `stories/`) | done |
| 2. Propose test cases | AI, checked by guardrails | **done** |
| 3. Approve, edit or reject each case | Human (checklist on the GitHub Issue) | **done** |
| 4. Write the approved tests as code, run them once, open a PR | AI, checked by guardrails | next |

> Core principle: the AI proposes, explores and analyzes. Pass/fail decisions stay deterministic, and a human validates the key steps.

## Step 2: the AI test designer

```bash
npm run qa:design -- stories/US-001-price-update.md
# -> reports/qa-pilot/US-001/proposals.md   (approval checklist)
# -> reports/qa-pilot/US-001/proposals.json (full result)
# -> reports/qa-pilot/ai-actions.jsonl      (one line per AI action)
```

### How it works
1. **Inputs**: the story (Markdown), `openapi.json` (the API contract) and the database schema.
2. **AI call**: Claude (`claude-opus-5-5`) must answer in a fixed JSON shape (`qa-pilot/designer/schema.ts`). Each case has a kind (`normal`, `negative`, `edge`, `db_check`), an endpoint, steps, an expected result, an optional SQL check, a **confidence** and a **doubt**.
3. **Validation**: the answer is checked again with Zod. If it's invalid, QA Pilot retries **once** and tells the AI what was wrong. After 2 failures it stops with an error (no endless retries, no silent half-results).
4. **Guardrails** (`qa-pilot/designer/guardrails.ts`), plain code the AI can't switch off:

   | Rule | Action |
   |---|---|
   | Endpoint not in `openapi.json` (the AI invented it) | Removed, listed with the reason |
   | SQL check is not a single read-only `SELECT` | Removed |
   | No steps or no expected result | Removed |
   | Confidence `low` | Kept, flagged "needs review" |
   | Confidence not `high` and no explanation | Kept, flagged |
5. **Log**: every attempt is one JSON line: time, provider, model, status, prompt hash and size, tokens, duration, and what the guardrails did.

### Claude or mock?
| | Claude (`ANTHROPIC_API_KEY` set) | Mock (no key) |
|---|---|---|
| What it is | `claude-opus-5-5` via the official SDK, structured JSON output | Rule-based generator over the OpenAPI spec |
| Cost | Paid per call | Free |
| Quality | Understands the story, writes SQL checks, cross-endpoint scenarios | Simple rules: one normal case, 401, 400 per minimum, story-vs-spec bound gaps |
| Used in | Real runs | CI without a key, tests, contributors |

Force one with `QA_PILOT_AI=claude` or `QA_PILOT_AI=mock`. If Claude declines a request, the API retries it on a fallback model in the same call (`fallbacks: "default"`).

### Example: US-001 with the mock
*"As a dealer, I can change the price of one of my listings. The new price must be above 0. The new price appears in search results."*

The mock found both endpoints (`POST /feeds/import`, `GET /search`), asked an open question ("the spec has no PUT or PATCH endpoint: is the change done through the feed import?"), and proposed **"cars[].price = 0 is rejected"** flagged as low confidence, because the story requires a lower bound that the spec doesn't enforce.

### CI
The job **"QA Pilot test design (proposals only)"** runs the designer on every story in `stories/` and uploads the proposals and the AI log as an artifact. It never fails a build because of what the AI proposes.

### Design choices (simple version)
- **Structured output, then validated again**: the format is enforced on the API side and checked again by our code. We never trust "the AI said so".
- **Confidence and doubt are required fields**: the AI must say what it isn't sure about, so the human knows where to look first.
- **Guardrails are code, not prompt text**: telling the AI "only use real endpoints" helps, but checking against `openapi.json` is what guarantees it.
- **A mock with the same interface**: the pipeline is testable and free. Tests use fakes to prove the guardrails catch invented endpoints and dangerous SQL.
- **`openapi.json` is committed and tested**: a test fails if the API changes without regenerating it, so the AI always reads the real contract.

## Step 3: human approval on a GitHub Issue

The user story is a GitHub Issue (for example *"US-001: A dealer changes a listing's price"*). Two labels drive the pipeline (workflow `.github/workflows/qa-pilot.yml`):

| Label added by a human | What happens |
|---|---|
| `qa-pilot:design` | QA Pilot reads the issue, proposes test cases, and posts them as a **checklist comment** |
| `qa-pilot:approved` | QA Pilot reads the checklist back and posts a **review summary** |

### What the reviewer does
1. **Tick** the cases to keep. Unticked cases count as rejected.
2. **Edit** a case's title, `Steps:` or `Expected:` line if it's almost right.
3. **Add guidance** for the test writer under a case: `  - Note: also try a wrong token`.
4. Add the label `qa-pilot:approved`.

### What QA Pilot records
- Per case: approved or rejected, which fields the human edited, and any note.
- Totals: proposed, approved as-is, approved after edits, rejected, and the **acceptance rate** (approved / proposed). This is one of the numbers for the final report.
- The summary comment stores the approved cases, hidden, so the test writer (step 4) can read them straight from the issue. The issue thread is the record of who decided what.

### Run it without the workflow
```bash
npm run qa:issue-design -- 6           # post proposals on issue #6
npm run qa:issue-review -- 6 --dry-run # read the ticks back, print the result, post nothing
npm run qa:issue-review -- 6           # same, and post the summary comment
```
These use your own `gh` login, so comments appear under your GitHub account. From the workflow they appear as `github-actions[bot]`.

### Design choices (simple version)
- **The original proposals are stored inside the comment** (hidden HTML comment with base64 JSON). Comparing them with the edited checklist shows exactly what the human changed, without a database.
- **Labels as the trigger**: only people with triage or write access can add labels, so a stranger opening an issue on a public repo can't start the AI or spend the API budget.
- **Issue text is untrusted input**: the script reads it through the GitHub API and passes data to `gh` as arguments and stdin, never through a shell. The workflow never puts issue text inside a `run:` command.
- **Endpoints can't be edited**: the reviewer can change the wording, steps and expected result, but the endpoint stays the one the guardrails checked against `openapi.json`.
