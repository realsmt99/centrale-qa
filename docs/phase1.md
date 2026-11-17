# Phase 1: Mini La Centrale

## Step 1: Foundation

### What was built
| File | Role |
|---|---|
| `src/app.ts` | `buildApp()` creates the Fastify app without starting it, so tests can build a fresh app in milliseconds. |
| `src/server.ts` | Starts the real server on port 3000 with the real database file. |
| `src/db.ts` | SQLite schema (versions, plates, dealers, listings) in plain SQL. |
| `src/auth.ts` | Bearer-token check for write endpoints (401 otherwise). |
| `src/routes/health.ts` | `GET /health`: is the service up, and can it read the DB? |
| `data/reference-versions.json` | 41 real French-market versions (208, Clio, Sandero, Golf, Yaris, Model 3…). |
| `data/generate.ts` | Seeded generator: 20 dealers, 5,000 listings, 5,000 plates. |
| `tests/` | 11 Jest tests: health, OpenAPI spec, auth (4 bad cases + 1 good), seed data checks. |

### Why these choices (simple version)
- **Fastify**: every route declares a JSON schema. Fastify uses it to validate input and to generate the OpenAPI spec automatically. QA Pilot reads that spec in Phase 2 to design tests.
- **SQLite + plain SQL**: no server to install, and every query is readable. The QA checks are SQL queries too.
- **Fresh in-memory DB per test**: tests never share state, so a test can't pass or fail because of another test's data. This is the first defence against flaky tests.
- **Seeded random data**: the same seed gives the same 5,000 cars every time, so if a result changes, the code changed, not the data.
- **Constant-time token comparison** (`timingSafeEqual`): a small security detail. A normal `===` can leak how many characters matched through response time.

### How to run
```bash
npm install
npm run seed
npm run dev           # then open http://localhost:3000/docs
npm test
```

### Interview questions
1. **"Why build a fake app instead of testing a public API?"**
   I need to know the truth in order to measure my tool. I planted the bugs myself, so I can say exactly how many the pipeline found and how many it missed (false negatives). With a real API I would never know what was missed.
2. **"How do you keep tests independent?"**
   Each test builds its own app with an in-memory SQLite database. Nothing is shared, so the order of tests doesn't matter and they can run in parallel.
3. **"Why is the data generated with a seed?"**
   Reproducibility. If a test fails today and passed yesterday, I want to know it's because of the code, not because the random data changed. With the same seed, the data is identical on my laptop and in CI.
