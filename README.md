# Centrale QA

A demo QA project in two parts:

1. **Mini La Centrale**: a small fake car-marketplace backend (Node.js, TypeScript, Fastify, SQLite) with bugs hidden on purpose.
2. **QA Pilot**: an AI-assisted QA pipeline that goes from a user story to test cases, tests, CI runs, triage and bug reports.

> Core principle: the AI proposes, explores and analyzes. Pass/fail decisions stay deterministic, and a human validates the key steps.

All data is synthetic (generated from a small catalogue of real French-market car versions). Nothing is scraped.

## Run it

Needs Node.js 22 or newer.

```bash
npm install
npm run seed        # builds data/centrale.db (5,000 listings)
npm run dev         # http://localhost:3000, API docs at /docs
npm test            # regression tests (must pass)
npm run test:scale  # rules checked on thousands of cars (expected to find bugs)
npm run test:bughunt  # known-bug and flaky tests (expected to fail)
npm run qa:design -- stories/US-001-price-update.md   # AI-proposed test cases
```

Write endpoints need `Authorization: Bearer dev-token` (set `API_TOKEN` to change it).

## Status

| Step | Status |
|---|---|
| Foundation (app, DB, auth, health, seed data) | done |
| Module 1: stock import (`POST /feeds/import`, JSON + CSV) | done |
| Module 2: plate lookup (`GET /vehicles/:plate`) | done |
| Module 3: search (`GET /search`, price ratings) + flaky `GET /dealer-sync/status` | done |
| CI (GitHub Actions: regression + bug-hunt jobs) | done |
| **Phase 1 complete** | done |
| Phase 2, step 2: AI test designer (`npm run qa:design`), guardrails, AI action log | done |
| Phase 2, step 3: human approval on a GitHub Issue (labels `qa-pilot:design`, `qa-pilot:approved`) | done |
| Phase 2, step 4: AI test writer (approved cases -> Jest tests, run once -> pull request) | done |
| **Phase 2 complete** | done |
| Phase 3, step 1: price estimate (`GET /pricing`) | done |
| Phase 3, step 2: AI ad writer (`POST /listings/generate`) | done |
| Phase 3, step 3: AI chat about a car (`POST /chat`) | done |
| Phase 3, step 4: testing at scale (data-driven, metamorphic, parallel CI, nightly) | done |
| **Phase 3 complete.** Next: Phase 4, AI triage + reports + measured results | next |

Details: [docs/phase1.md](docs/phase1.md) (the app), [docs/phase2.md](docs/phase2.md) (QA Pilot), [docs/phase3.md](docs/phase3.md) (more features, testing at scale).
