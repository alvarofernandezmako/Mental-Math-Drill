// Board engine for the Mental Math Drill.
//
// Everything is in integer cents so that every theo, width and answer is exact (no floating-point drift).
// Rates are zero, so put-call parity is exact:  P = C - F + K.
//
// A board is: the delta-1 (future or stock) theo and width, and for every strike a call and a put theo and width.
// Theos are Black-Scholes values rounded to the tick, with the puts taken from the calls by parity. A board is only
// ever shown if it passes validateBoard(): the call curve (including the point (0, F)) is strictly decreasing,
// strictly convex, every spread strictly inside its bounds and every option has time value. Those are the
// necessary and sufficient conditions for the theos to come from a real risk-neutral distribution, so no
// portfolio of the board's markets can be bought for less than it is sure to pay (no arbitrage) -- the markets
// are theo +/- half the width, and widths only ever make buying dearer and selling cheaper.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- maths
  function normPDF(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
  // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7) -- the same approximation as the other tools in the folder
  function normCDF(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
  }
  // Black-76 / zero-rate Black-Scholes. F, K in points, T in years, vol as a decimal.
  function bsCall(F, K, T, vol) {
    const v = vol * Math.sqrt(T);
    const d1 = (Math.log(F / K) + 0.5 * v * v) / v, d2 = d1 - v;
    return F * normCDF(d1) - K * normCDF(d2);
  }
  function bsDelta(F, K, T, vol) {
    const v = vol * Math.sqrt(T);
    return normCDF((Math.log(F / K) + 0.5 * v * v) / v);
  }
  // vega per 1 vol point, in points
  function bsVega(F, K, T, vol) {
    const v = vol * Math.sqrt(T);
    const d1 = (Math.log(F / K) + 0.5 * v * v) / v;
    return F * normPDF(d1) * Math.sqrt(T) / 100;
  }

  // ---------------------------------------------------------------- helpers
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = (rng, lo, hi) => lo + rng() * (hi - lo);
  const rndInt = (rng, lo, hi) => Math.floor(rnd(rng, lo, hi + 1));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function gauss(rng) { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const roundTo = (x, step) => Math.round(x / step) * step;
  const floorTo = (x, step) => Math.floor(x / step + 1e-9) * step;

  function strikeIncrement(F) { // points
    if (F < 30) return 2.5;
    if (F < 150) return 5;
    return 10;
  }

  // cents -> "4.35"
  function fmt(c) {
    const neg = c < 0; c = Math.abs(c);
    const s = Math.floor(c / 100) + '.' + String(c % 100).padStart(2, '0');
    return neg ? '-' + s : s;
  }
  // strike cents -> "47.5" / "100"
  function fmtK(c) {
    if (c % 100 === 0) return String(c / 100);
    if (c % 10 === 0) return (c / 100).toFixed(1);
    return (c / 100).toFixed(2);
  }

  // ---------------------------------------------------------------- pricing a board
  // state: { F (cents), strikes [cents], T (years), vol, tick (cents), delta1, profile }
  // profile (fixed for the session so a moving board keeps its character):
  //   volWidth  -- how many vol points wide an out-of-the-money option is quoted
  //   futW      -- the delta-1's width in cents
  //   itmExtra  -- per strike, extra cents the in-the-money option is quoted wider than its OTM partner
  //   jitter    -- per strike, -1/0/+1 (times two ticks) noise on the OTM width
  function priceBoard(state) {
    const { F, strikes, T, vol, tick, profile } = state;
    const Fp = F / 100;
    const w2 = 2 * tick; // widths are even numbers of ticks, so bid and offer (theo -/+ half) are on the tick
    const rows = strikes.map((K, i) => {
      const Kp = K / 100;
      const C = roundTo(bsCall(Fp, Kp, T, vol) * 100, tick);
      const P = C - F + K; // parity, exact
      const intrC = Math.max(F - K, 0), intrP = Math.max(K - F, 0);
      const tv = C - intrC; // = P - intrP
      const vega = bsVega(Fp, Kp, T, vol) * 100; // cents per vol point
      let otmW = Math.max(w2, roundTo(profile.volWidth * vega, w2) + profile.jitter[i] * w2);
      let itmW = otmW + profile.itmExtra[i];
      const cap = Math.max(w2, floorTo(2 * tv, w2)); // bid never below intrinsic: w/2 <= time value
      otmW = Math.min(otmW, cap);
      itmW = Math.min(itmW, cap);
      const callOTM = K >= F;
      return {
        K, C, P,
        wC: callOTM ? otmW : itmW,
        wP: callOTM ? itmW : otmW,
        tv,
        delta: bsDelta(Fp, Kp, T, vol),
      };
    });
    return {
      F, wF: profile.futW, tick, strikes: strikes.slice(), rows,
      T, vol, delta1: state.delta1,
    };
  }

  // Returns a list of problems; empty means the board is clean (no arbitrage, sensible markets).
  function validateBoard(b) {
    const errs = [];
    const { F, wF, tick, rows } = b;
    const n = rows.length;
    const w2 = 2 * tick;
    if (!(wF >= w2 && wF % w2 === 0)) errs.push('delta-1 width');
    if (F % tick !== 0) errs.push('delta-1 off tick');
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      if (r.C % tick !== 0 || r.P % tick !== 0) errs.push(`off tick @${r.K}`);
      if (r.P !== r.C - F + r.K) errs.push(`parity @${r.K}`);
      const tvC = r.C - Math.max(F - r.K, 0);
      const tvP = r.P - Math.max(r.K - F, 0);
      if (tvC < 2 * tick || tvP < 2 * tick) errs.push(`time value @${r.K}`);
      for (const w of [r.wC, r.wP]) {
        if (!(w >= w2 && w % w2 === 0)) errs.push(`width @${r.K}`);
      }
      if (r.wC / 2 > tvC || r.wP / 2 > tvP) errs.push(`bid below intrinsic @${r.K}`);
      if (r.C - r.wC / 2 <= 0 || r.P - r.wP / 2 <= 0) errs.push(`zero bid @${r.K}`);
      if (i > 0 && !(r.K > rows[i - 1].K)) errs.push('strikes not ascending');
    }
    // call curve through (0, F): strictly decreasing, slope > -1, strictly convex.
    // slope from (0,F) to (K1,C1) is (C1-F)/K1, so the first convexity check is (C1-F)/K1 < (C2-C1)/(K2-K1)
    for (let i = 0; i < n - 1; i++) {
      const a = rows[i], c = rows[i + 1];
      const gap = c.K - a.K;
      const cs = a.C - c.C, ps = c.P - a.P;
      if (cs < tick) errs.push(`call spread <= 0 @${a.K}/${c.K}`);
      if (ps < tick) errs.push(`put spread <= 0 @${a.K}/${c.K}`);
      if (cs + ps !== gap) errs.push(`box @${a.K}/${c.K}`);
    }
    if (n >= 2) {
      const a = rows[0], c = rows[1];
      if (!((a.C - F) * (c.K - a.K) < (c.C - a.C) * a.K)) errs.push('convexity at the first strike');
    }
    for (let i = 0; i < n - 2; i++) {
      const a = rows[i], m = rows[i + 1], c = rows[i + 2];
      // slope(a,m) < slope(m,c)  <=>  (m.C - a.C)*(c.K - m.K) < (c.C - m.C)*(m.K - a.K)
      const lhs = (m.C - a.C) * (c.K - m.K), rhs = (c.C - m.C) * (m.K - a.K);
      if (!(lhs < rhs)) errs.push(`fly <= 0 @${m.K}`);
      // on equally spaced strikes also require the fly to be worth at least a tick
      if (c.K - m.K === m.K - a.K && a.C - 2 * m.C + c.C < tick) errs.push(`fly < tick @${m.K}`);
    }
    return errs;
  }

  // ---------------------------------------------------------------- generating a session
  // cfg: { tick (cents: 1|2|5), nStrikes (3..7), delta1: 'future'|'stock' }
  function newSession(cfg, rng) {
    rng = rng || Math.random;
    const tick = cfg.tick;
    const n = cfg.nStrikes;
    for (let attempt = 0; attempt < 5000; attempt++) {
      const F0 = rnd(rng, 20, 180);
      const incr = strikeIncrement(F0);
      const incrC = Math.round(incr * 100);
      const centre = Math.round(F0 / incr) * incrC; // cents
      const half = Math.floor(n / 2);
      const strikes = [];
      for (let k = 0; k < n; k++) strikes.push(centre + (k - half) * incrC);
      if (strikes[0] <= 0) continue;
      const F = roundTo(centre + rnd(rng, -0.45, 0.45) * incrC, tick);
      const days = rndInt(rng, 14, 120);
      const T = days / 365;
      // pick the one-standard-deviation move so that the wings still have real value
      const sdMoves = rnd(rng, 0.75, 1.6) * Math.max(half, 1) * incr;
      const vol = sdMoves / ((F / 100) * Math.sqrt(T));
      if (vol < 0.10 || vol > 0.9) continue;
      const w2 = 2 * tick;
      const futW = tick === 1 ? pick(rng, [2, 2, 4]) : w2;
      const profile = {
        volWidth: rnd(rng, 0.35, 0.9),
        futW,
        itmExtra: strikes.map(() => pick(rng, [0, 0, w2, w2, 2 * w2])),
        jitter: strikes.map(() => pick(rng, [-1, 0, 0, 0, 1])),
      };
      const state = { F, strikes, T, vol, tick, delta1: cfg.delta1, profile, days, F0: F, vol0: vol, centre, incrC };
      const board = priceBoard(state);
      if (validateBoard(board).length === 0) return { state, board };
    }
    throw new Error('could not build a clean board');
  }

  // The market moves: the delta-1 by a random amount (pulled back towards the middle strike when it wanders),
  // vol by a point or two, a day goes by. Only a clean board is accepted.
  function moveSession(sess, rng) {
    rng = rng || Math.random;
    const s = sess.state;
    for (let attempt = 0; attempt < 400; attempt++) {
      const sd = (s.F / 100) * s.vol * Math.sqrt(1 / 365) * 100; // cents, ~a day's move
      let z = Math.max(-2.2, Math.min(2.2, gauss(rng)));
      const drift = (s.F - s.centre) / s.incrC; // in strikes
      z -= drift * 1.2; // mean-revert towards the middle strike
      let dF = roundTo(z * sd, s.tick);
      if (dF === 0) dF = (rng() < 0.5 ? -1 : 1) * s.tick * rndInt(rng, 1, 4);
      const F = s.F + dF;
      if (Math.abs(F - s.centre) > 0.75 * s.incrC) continue;
      let vol = s.vol + rnd(rng, -0.02, 0.02);
      vol = Math.max(s.vol0 * 0.75, Math.min(s.vol0 * 1.25, vol));
      const days = Math.max(7, s.days - 1);
      const state = Object.assign({}, s, { F, vol, days, T: days / 365 });
      const board = priceBoard(state);
      if (validateBoard(board).length === 0) return { state, board };
    }
    return sess; // nothing clean found -- keep the board as it is
  }

  // ---------------------------------------------------------------- structures
  // A structure is a list of legs [{k:'C'|'P'|'F', i (strike index), q (signed quantity)}] plus a cash amount.
  // theo = sum q * theo(leg) + cash   (exact, in cents)
  function theoOf(board, legs, cash) {
    let t = cash || 0;
    for (const l of legs) {
      if (l.k === 'F') t += l.q * board.F;
      else t += l.q * board.rows[l.i][l.k];
    }
    return t;
  }
  function legWidth(board, l) {
    if (l.k === 'F') return board.wF;
    return l.k === 'C' ? board.rows[l.i].wC : board.rows[l.i].wP;
  }
  // width when you trade the legs exactly as named
  function namedWidth(board, legs) {
    return legs.reduce((s, l) => s + Math.abs(l.q) * legWidth(board, l), 0);
  }

  // Tightest replication. Every payoff the board can make is cash + b*F + sum a_i*call_i (a put is a call less the
  // delta-1 plus K in cash). With rates zero cash is free and exact, so the only choice is, at each strike, how
  // much of a_i to hold as calls and how much as puts (t_i puts, a_i - t_i calls) -- every put you use instead of
  // a call needs one more delta-1 to keep the payoff the same: future quantity = b + sum t_i.
  // The theo is the same for every route (parity is exact); the width is
  //      sum_i ( |a_i - t_i| * wC_i + |t_i| * wP_i ) + |b + sum t_i| * wF
  // and we minimise it. The constraint matrix is totally unimodular, so an integer optimum exists, and a put
  // beyond [min(0,a_i), max(0,a_i)] can only ever pay for itself against the future, so |t| is bounded by R.
  function payoffOf(legs, board) {
    const n = board.rows.length;
    const a = new Array(n).fill(0);
    let b = 0;
    for (const l of legs) {
      if (l.k === 'F') b += l.q;
      else if (l.k === 'C') a[l.i] += l.q;
      else { a[l.i] += l.q; b -= l.q; }
    }
    return { a, b };
  }
  function tightest(board, legs) {
    const { a, b } = payoffOf(legs, board);
    const n = a.length;
    const R = Math.abs(b) + a.reduce((s, x) => s + Math.abs(x), 0);
    // dp: sum of t -> {cost, ts, contracts}
    let dp = new Map([[0, { cost: 0, ts: [], n: 0 }]]);
    for (let i = 0; i < n; i++) {
      const r = board.rows[i];
      const lo = Math.min(0, a[i]) - R, hi = Math.max(0, a[i]) + R;
      const next = new Map();
      for (const [s, st] of dp) {
        for (let t = lo; t <= hi; t++) {
          const c = Math.abs(a[i] - t) * r.wC + Math.abs(t) * r.wP;
          const cnt = Math.abs(a[i] - t) + Math.abs(t);
          const key = s + t;
          const cand = { cost: st.cost + c, ts: st.ts.concat([t]), n: st.n + cnt };
          const cur = next.get(key);
          if (!cur || cand.cost < cur.cost || (cand.cost === cur.cost && cand.n < cur.n)) next.set(key, cand);
        }
      }
      dp = next;
    }
    let best = null;
    for (const [s, st] of dp) {
      const f = b + s;
      const cost = st.cost + Math.abs(f) * board.wF;
      const cnt = st.n + Math.abs(f);
      if (!best || cost < best.width || (cost === best.width && cnt < best.n)) {
        best = { width: cost, ts: st.ts, f, n: cnt };
      }
    }
    // when the legs as named are already the tightest, that is the route to show
    if (namedWidth(board, legs) === best.width) return { width: best.width, route: legs.map(l => Object.assign({}, l)) };
    // the route as legs
    const route = [];
    if (best.f !== 0) route.push({ k: 'F', q: best.f });
    for (let i = 0; i < n; i++) {
      const p = best.ts[i], c = a[i] - p;
      if (c !== 0) route.push({ k: 'C', i, q: c });
      if (p !== 0) route.push({ k: 'P', i, q: p });
    }
    return { width: best.width, route };
  }

  const api = {
    normCDF, normPDF, bsCall, bsVega, bsDelta, mulberry32, gauss, strikeIncrement,
    fmt, fmtK, priceBoard, validateBoard, newSession, moveSession,
    theoOf, namedWidth, legWidth, payoffOf, tightest,
    rnd, rndInt, pick,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MMBoard = api;
})(typeof window !== 'undefined' ? window : globalThis);
