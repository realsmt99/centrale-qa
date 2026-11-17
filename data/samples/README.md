# Sample dealer feeds

Small hand-made feeds used by the tests and for manual checks.

| File | Dealer | Format | Story |
|---|---|---|---|
| `D001-stock-day1.json` | D001 | JSON | First import: 5 cars |
| `D001-stock-day2.json` | D001 | JSON | Next day: REF-1003 sold, REF-1004 price dropped, REF-1006 new |
| `D002-stock.csv` | D002 | CSV | Another dealer's software, lower-case refs |

Try one against a running server:

```bash
curl -X POST "localhost:3000/feeds/import?dealerId=D001" \
  -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  --data @data/samples/D001-stock-day1.json

curl -X POST "localhost:3000/feeds/import?dealerId=D002" \
  -H "Authorization: Bearer dev-token" -H "Content-Type: text/csv" \
  --data-binary @data/samples/D002-stock.csv
```
