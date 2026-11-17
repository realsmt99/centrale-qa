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
npm run test:bughunt  # known-bug and flaky tests (expected to fail)
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
| **Phase 1 complete.** Next: Phase 2, QA Pilot core (AI test design) | next |

Details for each step are in [docs/phase1.md](docs/phase1.md).
