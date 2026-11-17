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

## Step 2: Module 1, stock import

### What it does
`POST /feeds/import?dealerId=D001` receives a dealer's **full current stock**, as JSON (`{"cars": [...]}`) or CSV (`text/csv`). It compares the feed with the database:

| Feed vs database | Result |
|---|---|
| Car in the feed, not in the DB | created |
| Car in both, price or mileage changed | updated |
| Car in both, nothing changed | unchanged |
| Active car in the DB, missing from the feed | marked sold |

A car is identified by `(dealer_id, external_ref)`, the ID used by the dealer's own software. The whole import runs in one SQL transaction: either everything is saved or nothing is.

Rejected feeds: 401 (no token), 404 (unknown dealer), 400 (unknown `versionId`, the same car twice, or a field that breaks the schema).

### Files
| File | Role |
|---|---|
| `src/stock.ts` | Import logic, no HTTP (easy to test directly) |
| `src/routes/feeds.ts` | HTTP route: auth, JSON schema, CSV parser |
| `data/samples/` | Small feeds: D001 day 1 / day 2 (JSON), D002 (CSV) |
| `tests/feeds.test.ts` | 15 regression tests, including SQL consistency checks |
| `tests/feeds.bughunt.test.ts` | Tests for business rules (run in the "allowed to fail" CI job) |

### Design choices (simple version)
- **Auth runs first** (`onRequest` hook), before the body is even read. Someone without a token gets 401 and learns nothing about our validation rules.
- **One schema for JSON and CSV**: the CSV is converted to the same `{cars: [...]}` shape, then the same rules apply. Two formats, one set of rules, so they can't drift apart.
- **SQL checks in tests**: the tests don't only check the API response, they also query the database ("is REF-1003 really `sold`?", "no duplicate active cars?"). The API can say "ok" while the data is wrong.
- **Logic separate from HTTP** (`stock.ts` vs `routes/feeds.ts`): the import rules can be tested without a server.

### Try it
See `data/samples/README.md` for ready-to-paste `curl` commands.

## Step 3: Module 2, plate lookup

### What it does
`GET /vehicles/:plate` turns a French plate into the **exact catalogue version**, so a seller's ad can be pre-filled: brand, model, version, fuel, gearbox, power, standard and optional equipment, and new price. Public endpoint (no token).

It works in two steps, like in real life:
1. **Registry**: the `plates` table simulates the national registry (SIV). It holds what the registration card says: brand, model, fuel, power, first registration date. It does not know the exact version.
2. **Catalogue match**: the app finds the one version in `versions` that fits the registration data.

| Input | Result |
|---|---|
| `AB-123-CD`, `ab123cd`, `ab 123 cd` | Normalized to `AB-123-CD` |
| Not a plate (`HELLO`, wrong format, letters I/O/U) | 400 |
| Valid plate, not in the registry | 404 |
| Registered, but no catalogue version fits | 422 |
| Registered and matched | 200 + vehicle |

### Files
| File | Role |
|---|---|
| `src/vehicles.ts` | `normalizePlate`, registry read, catalogue match |
| `src/routes/vehicles.ts` | HTTP route and response schema |
| `tests/vehicles.test.ts` | 18 tests: plate formats, 200/400/404/422, agreement with the registry |

### Design choices (simple version)
- **Normalize input, don't reject it**: users type plates in many ways. Accepting all common forms and returning one canonical form avoids false "not found" errors.
- **Distinct error codes**: 400 (your input is wrong), 404 (we don't know this plate), 422 (we know it but can't identify the version). Each one points to a different fix.
- **The registry is separate from the catalogue**: identifying a version from registration data is a real matching problem, and the place where wrong answers come from. Modelling it honestly makes the tests meaningful.
