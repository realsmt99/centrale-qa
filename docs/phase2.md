# Phase 2: QA Pilot core

QA Pilot turns a user story into tests, with a human in control at every key step:

| Step | Who | Status |
|---|---|---|
| 1. User story | Human (GitHub Issue, or a Markdown file in `stories/`) | done |
| 2. Propose test cases | AI, checked by guardrails | **done** |
| 3. Approve, edit or reject each case | Human (checklist on the GitHub Issue) | **done** |
| 4. Write the approved tests as code, run them once, open a PR | AI, checked by guardrails | **done** |

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

## Step 4: the AI test writer

Right after the review is recorded (label `qa-pilot:approved`), the workflow job **"Write the approved tests and open a pull request"** runs:

```bash
npm run qa:issue-write -- 7            # write, run once, open a PR, link it on the issue
npm run qa:issue-write -- 7 --dry-run  # same, but files go to reports/qa-pilot/<story>/generated/
```

### How it works
1. **Input**: the approved cases, read from the review summary on the issue (with the reviewer's edits and notes).
2. **The AI writes test bodies only**: one `it("TC-05 ...", ...)` per case. QA Pilot adds the imports itself, so the AI can't bring in anything else. Claude gets the approved cases, the allowed helpers, one known-good request per endpoint (`qa-pilot/writer/examples.ts`, like saved Postman examples), the spec and the DB schema.
3. **Code guardrails** (`qa-pilot/writer/guardrails.ts`) remove a test that:

   | Problem | Example |
   |---|---|
   | implements a case nobody approved | `TC-09` when only TC-01 and TC-05 were ticked |
   | has the wrong shape, or no `expect(...)` | two tests in one block |
   | uses something outside the allowed helpers | `import`, `require`, `process`, `fs`, `fetch`, `eval`, `db.prepare(...)`, `.only`/`.skip`, calls to another server |

4. **Read-only database**: AI-written tests can read the DB only through `sqlCheck(db, sql)`. It asks **SQLite itself** whether the statement is read-only and refuses anything else (`tests/qa-helpers.ts`).
5. **Run once**: the kept tests run with Jest before anything is committed.
   - The file **can't run at all** (type error, crash): the AI gets the error and **one** retry. After that QA Pilot stops: broken code never reaches a PR.
   - A test **runs and fails**: that's useful. It may have found a bug. It goes to the bug-hunt suite, with the first-run failure as a comment (stack traces removed, so no local paths leak).
6. **Pull request, never `main`**: passing tests go to `tests/generated/<story>.ai.test.ts` (regression, must keep passing), failing ones to `tests/generated/<story>.ai.bughunt.test.ts` (non-blocking). QA Pilot pushes a new `qa-pilot/...` branch from a temporary `git worktree` (your own checkout is never touched), opens the PR, and links it on the issue. A human reviews and merges. QA Pilot never merges its own PRs.

### Results on US-001 (issue #7, mock writer)
The reviewer approved TC-01, TC-05 and TC-09. All three were written and **passed their first run**:
- TC-01: `GET /search` returns 200
- TC-05: import without a token gets 401, and `sqlCheck` confirms nothing was saved
- TC-09: after an import, `sqlCheck` reads the stored rows back and they match what was sent

What-if check: had the reviewer also approved TC-08 ("price = 0 is rejected"), its test would have **failed on its first run** (`Expected: 400, Received: 200`) and gone to the bug-hunt suite: a real bug, found from the story.

### A false positive, found and fixed
On the first dry run, the guardrail that blocks `import` statements also matched the word "import" in the URL `/feeds/import`, and removed 2 valid tests out of 3. The rule now matches only real import statements, and a test locks that in (`tests/qa-pilot/writer.test.ts`). Checking a guardrail's false positives is part of building it.

### Limits to know
- PRs opened from a workflow with the default `GITHUB_TOKEN` **don't trigger other workflows**, so CI won't start on its own on QA Pilot's PR (a GitHub safety rule). Close and reopen the PR, push to it, or use a GitHub App token.
- For the workflow to open PRs at all, enable **Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests"**.
- The mock writer only knows a few case shapes. Anything else is reported as "not covered" rather than guessed. Claude handles free-form cases.
