# Phase 3: more features, then testing at scale

| Step | What | Status |
|---|---|---|
| 1 | Price estimate, `GET /pricing` | **done** |
| 2 | AI ad writer, `POST /listings/generate` | next |
| 3 | AI chat about a car, `POST /chat` | planned |
| 4 | Testing at scale: data-driven and metamorphic tests on thousands of cars, parallel CI jobs, nightly run | planned |

Steps 1 to 3 add features to Mini La Centrale (each with its own simple tests). Step 4 adds the big automatic test suites that should find what the simple tests miss.

## Step 1: price estimate

### What it does
A seller gives the car's **exact version** (from the plate lookup), its **year** and its **mileage**, and gets a suggested price with a range.

```bash
curl "localhost:3000/pricing?versionId=9&year=2024&mileageKm=30000"
# Renault Clio E-Tech 2024, 30,000 km -> 18,600 EUR (range 17,100 - 20,100)
```

### How the price is computed
`new price x share kept for its age x mileage factor`, rounded to 100 EUR:

| Part | Rule |
|---|---|
| Share kept by age | A hand-tuned curve: about 15% lost per year (`DEPRECIATION_BY_AGE` in `src/pricing.ts`) |
| Mileage factor | `1 - km / 500,000`, with km capped at 300,000 |
| Range | estimate -8% / +8% |
| Floor | never below 1,500 EUR |

The answer also shows **how** it was computed (`basis`), and the **market**: how many active listings exist for the same version and year, and their average price. Showing the reasoning makes the estimate easy to check, by a person or by a test.

### Errors
| Case | Answer |
|---|---|
| Missing or invalid parameter (e.g. negative mileage) | 400 |
| Unknown version | 404 |
| Year when this version wasn't sold (e.g. a 2015 Peugeot 208 PureTech 100, sold from 2019) | 422 |

### Tests
`tests/pricing.test.ts`: 12 tests, including exact values, the range, the market average, and the errors. The user story is `stories/US-002-price-estimate.md`.

### Design choices (simple version)
- **The year must match the version**: pricing a car that never existed gives a confident but meaningless number, so it's refused (422).
- **The answer explains itself** (`basis`): the share kept, the mileage factor and the market average are all visible, so a strange price can be traced to its cause.
- **Same "today" everywhere** (`src/market.ts`): data and pricing use one reference year, so results don't change when the real calendar moves on.
