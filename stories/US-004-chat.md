# US-004: A buyer asks questions about a car

As a buyer, I can ask questions about a car in its ad and get an instant answer, without waiting for the seller.

Acceptance criteria:
- Answers only use the car's real data: price, mileage, year, gearbox and fuel, equipment, location.
- If the answer isn't in the car's data, the assistant says so and suggests contacting the seller. It never invents offers (financing, discounts, warranty).
- For a car that has been sold, the assistant doesn't answer: it says the car is sold (410).
- Only signed-in buyers (with a token) can use the chat.
