# Mental Math Drill

A speed drill for pricing combos off a board. You get a full board of **theos and total widths** — the delta-1 (future or stock), and a call and a put at every strike — and underneath it, one combo after another. For each one, type its **theo** and its **width** as fast as you can.

No backend, no build step. Double-click `index.html` to play (or run `python -m http.server` in this folder and open `http://localhost:8000`).

## Settings

- **Delta-1:** future or stock. Rates are zero for both, so put-call parity is exact: `C − P = F − K`.
- **Tick size:** 0.01, 0.02 or 0.05. Every theo is on the tick, and every width is an even number of ticks, so each implied bid and offer (theo ∓ half the width) is on the tick too.
- **Strikes:** 3 to 7.
- **Level:**
  - **Simple:** call and put spreads, straddles, strangles, risk reversals, synthetic futures, P+S and buy-writes.
  - **Advanced:** mostly wide spreads, call/put/iron flies, call/put/iron condors, boxes, conversions, collars and 1x2s, plus the simple ones.
- **Answer as:** *Theo + width* (two boxes: theo and total width), or *Bid / offer*: you're just asked your market, and the right answer is **bid = theo − width / 2, offer = theo + width / 2**, using the same tightest width. Widths are always an even number of ticks, so both sides land on the tick.
- **Dynamic:** every 5 combos the market moves. The delta-1 moves (about a day's move, pulled back toward the middle strike), vol moves a point or two, and a day passes. Everything reprices, and the cells flash green or red.
- **Show legs:** prints the legs under each combo, e.g. `+95P −2×100P +105P`.
- **Session time:** 1 to 15 minutes.

## The answer

- **Theo** is the signed sum of the legs' theos. Any route gives the same number, because parity is exact on the board.
- **Width** is the **tightest** the board can make the combo. A put is a call minus the delta-1 plus K in cash, so any put leg can be traded as a call and the delta-1, and the other way round. The answer is the cheapest of those routes, not just the legs as named.
  - A box or a conversion pays fixed cash. With zero rates that is **0 wide**.
  - A synthetic future is as wide as the delta-1, unless some strike's call + put is tighter.
  - An in-the-money option is often wider than its out-of-the-money partner plus the delta-1, so the tightest route goes through the partner.

1 point for each box: the theo and the width, or the bid and the offer. If you get it wrong, you're shown the right answer and the tightest route. **Explain Last Answer** (on the right edge) pauses the clock and shows the working:

- the board, with the named legs (orange) and the tightest route (green) highlighted;
- a leg-by-leg table for each;
- a sentence on why.

The results screen shows accuracy and speed by combo type, weakest first.

### Conventions

| Combo | Legs |
|---|---|
| K1/K2 call spread | +C1 −C2 |
| K2/K1 put spread | +P2 −P1 (buy the upper strike) |
| K straddle | +C +P |
| K1/K2 strangle | +P1 +C2 |
| K1/K2 risk reversal | call K2 against put K1, quoted positive: "calls over" = +C2 −P1, "puts over" = +P1 −C2 |
| K synthetic future | +C −P, priced as the future it makes: K + C − P |
| P+S / buy-write | +P +F / +F −C |
| Call / put fly | +1 −2 +1 |
| Iron fly | sell the body straddle, buy the wings, priced as the credit: +C2 +P2 −P1 −C3 |
| Call / put condor | +1 −1 −1 +1 |
| Iron condor | sell the inner strangle, buy the wings, priced as the credit: +P2 +C3 −P1 −C4 |
| Box | call spread + put spread = K2 − K1 |
| Conversion | +F +P −C = K |
| Collar | +F +P1 −C2 |
| 1x2 call / put spread | +C1 −2C2 / +P2 −2P1 (can be a credit, so enter it negative) |

## How the board is kept clean

Theos are Black-Scholes values (zero rates) rounded to the tick, and the puts come from the calls by parity. A board is shown, and after a dynamic move re-shown, only if all of these hold:

- the call curve, starting from the point (0, F), is strictly decreasing and strictly convex;
- every call spread and put spread is worth at least a tick;
- every fly is worth at least a tick;
- every option has at least two ticks of time value;
- no bid is below intrinsic or at zero.

Those conditions are what it takes for the theos to come from a real distribution of prices at expiry. So no portfolio of the board's markets can be bought for less than the least it pays: no arbitrage.

Widths follow vega (an out-of-the-money option is quoted a set number of vol points wide). The in-the-money option at a strike is quoted the same width or wider.

## Tests

```
node test/fuzz.test.js
```

The test builds 21,600 boards: every tick, 3–7 strikes, future and stock, with runs of 12 dynamic moves. It checks 259,200 questions (about 7.3 million checks, roughly 3 minutes):

- every board passes validation;
- random portfolios priced at the board's bids and offers never make a riskless profit;
- each combo's theo matches an independent closed form (call fly = put fly, iron fly = wing − fly, box = gap, conversion = K, synthetic = F, …);
- the theo and both sides of the market (theo ∓ width / 2) are on the tick;
- the tightest width matches a brute-force search over every replication, is never wider than the named legs, and its route really replicates the payoff.

| File | What it does |
|---|---|
| `js/board.js` | Black-Scholes, board generation and validation, dynamic moves, tightest-replication solver (exact, in integer cents) |
| `js/combos.js` | The combo families and their legs |
| `js/app.js` | Screens, the question loop, scoring, Explain Last Answer, results |
