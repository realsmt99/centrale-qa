# Phase 3: more features, then testing at scale

| Step | What | Status |
|---|---|---|
| 1 | Price estimate, `GET /pricing` | **done** |
| 2 | AI ad writer, `POST /listings/generate` | **done** |
| 3 | AI chat about a car, `POST /chat` | next |
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

## Step 2: AI ad writer

### What it does
A seller sends their car's details and gets a ready-to-use ad **in French**: a title and a description.

```bash
curl -X POST localhost:3000/listings/generate -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"versionId":9,"year":2024,"mileageKm":30000,"price":18600,"color":"blanc","options":["heated_seats"]}'
# Title: Renault Clio E-Tech full hybrid 145 Esprit Alpine - 2024 - 30 000 km
# Text:  À vendre : Renault Clio E-Tech ... de 2024, 30 000 km, hybride, boîte automatique, 145 ch. Équipements : ...
```

### How it works
1. **Facts first**: the app collects what is true about the car: its catalogue version (brand, model, fuel, gearbox, power, standard equipment), the options the seller selected (only options that exist for that version), and the seller's year, mileage, price and colour.
2. **A writer turns the facts into text**:

   | Writer | When | Cost |
   |---|---|---|
   | Claude (`claude-opus-5-5`) | The server has an API key | Paid per ad |
   | Template (fills in sentences) | No API key, and **always in tests** | Free, same result every time |

3. **The facts come back with the text**, so anyone (a person or a test) can check that the ad only says true things.

`src/listing-writer.ts` also has two small "readers" that find what an ad text claims: `mentionedEquipment()` (e.g. "GPS intégré" means navigation) and `mentionedGearbox()`. They turn a free text into something a test can compare with the facts.

### Errors
| Case | Answer |
|---|---|
| No token | 401 (writing with Claude costs money) |
| Missing or invalid field, or an option this version doesn't offer | 400 (lists the options that exist) |
| Unknown version | 404 |
| Year when this version wasn't sold | 422 |
| The AI writer is down | 502, without leaking the internal error |

### Tests
`tests/listing-writer.test.ts`: 15 tests, including the readers, a full ad checked against its facts, all the errors, and a fake broken writer for the 502. The user story is `stories/US-003-ad-writer.md`.

### Design choices (simple version)
- **Facts are separated from wording**: the risky part of AI text is saying something false. Keeping the facts next to the text makes "is this ad true?" a question code can answer.
- **Tests never call a paid API**: the app uses the template writer unless the server is started with a key, so tests are free and give the same result every time.
- **Errors from the AI provider stay internal**: the user gets a clean 502, the details go to the server log.
