// The structures the drill asks about. Each one is defined only by its legs (and a cash amount), so the theo
// is the signed sum of the legs' theos and the width is worked out by MMBoard.tightest -- nothing is hard-coded.
// Conventions (rates zero):
//   call spread K1/K2  = +C1 -C2            put spread K2/K1 = +P2 -P1  (you buy the upper strike)
//   straddle K         = +C +P              strangle K1/K2  = +P1 +C2
//   risk reversal      = call K2 against put K1, quoted positive: "calls over" = +C2 -P1, "puts over" = +P1 -C2
//   synthetic future K = +C -P (+K cash)    = the price of the future the pair makes
//   P+S                = +P +F              B/W (buy-write)  = +F -C
//   call / put fly     = +1 -2 +1           iron fly         = sell the body straddle, buy the wings (a credit)
//   call / put condor  = +1 -1 -1 +1        iron condor      = sell the inner strangle, buy the outer (a credit)
//   box K1/K2          = call spread + put spread           conversion K = +F +P -C
//   collar K1/K2       = +F +P1 -C2         1x2 call spread  = +C1 -2C2      1x2 put spread = +P2 -2P1
(function (root) {
  'use strict';
  const B = (typeof module !== 'undefined' && module.exports) ? require('./board.js') : root.MMBoard;
  const { fmtK, rndInt, pick } = B;

  const C = (i, q) => ({ k: 'C', i, q });
  const P = (i, q) => ({ k: 'P', i, q });
  const F = (q) => ({ k: 'F', q });

  // each family: { level, minStrikes, make(board, rng) -> {label, legs, cash, note?} | null }
  const FAMILIES = {
    callSpread: {
      name: 'Call spread', level: 'simple', minStrikes: 2,
      make(b, rng) {
        const i = rndInt(rng, 0, b.rows.length - 2);
        return { label: `${k(b, i)}/${k(b, i + 1)} call spread`, legs: [C(i, 1), C(i + 1, -1)] };
      },
    },
    putSpread: {
      name: 'Put spread', level: 'simple', minStrikes: 2,
      make(b, rng) {
        const i = rndInt(rng, 0, b.rows.length - 2);
        return { label: `${k(b, i + 1)}/${k(b, i)} put spread`, legs: [P(i + 1, 1), P(i, -1)] };
      },
    },
    straddle: {
      name: 'Straddle', level: 'simple', minStrikes: 1,
      make(b, rng) {
        const i = rndInt(rng, 0, b.rows.length - 1);
        return { label: `${k(b, i)} straddle`, legs: [C(i, 1), P(i, 1)] };
      },
    },
    strangle: {
      name: 'Strangle', level: 'simple', minStrikes: 2,
      make(b, rng) {
        const [i, j] = pair(b, rng, 1, 2);
        return { label: `${k(b, i)}/${k(b, j)} strangle`, legs: [P(i, 1), C(j, 1)] };
      },
    },
    riskReversal: {
      name: 'Risk reversal', level: 'simple', minStrikes: 2,
      make(b, rng) {
        const [i, j] = pair(b, rng, 1, 2);
        const diff = b.rows[j].C - b.rows[i].P;
        if (diff === 0) return null;
        return diff > 0
          ? { label: `${k(b, i)}/${k(b, j)} risk reversal, calls over`, legs: [C(j, 1), P(i, -1)] }
          : { label: `${k(b, i)}/${k(b, j)} risk reversal, puts over`, legs: [P(i, 1), C(j, -1)] };
      },
    },
    synthetic: {
      name: 'Synthetic future', level: 'simple', minStrikes: 1,
      make(b, rng) {
        const i = rndInt(rng, 0, b.rows.length - 1);
        return {
          label: `${k(b, i)} synthetic ${d1(b)} (buy call, sell put)`,
          legs: [C(i, 1), P(i, -1)], cash: b.rows[i].K,
          note: `price it as the ${d1(b)} it makes: K + C − P`,
        };
      },
    },
    ps: {
      name: 'P+S', level: 'simple', minStrikes: 1,
      make(b, rng) {
        const i = rndInt(rng, 0, b.rows.length - 1);
        return { label: `${k(b, i)} put + ${d1(b)}`, legs: [P(i, 1), F(1)] };
      },
    },
    bw: {
      name: 'Buy-write', level: 'simple', minStrikes: 1,
      make(b, rng) {
        const i = rndInt(rng, 0, b.rows.length - 1);
        return { label: `${k(b, i)} buy-write (buy ${d1(b)}, sell call)`, legs: [F(1), C(i, -1)] };
      },
    },

    // ------------------------------------------------ advanced
    callSpreadWide: {
      name: 'Wide call spread', level: 'advanced', minStrikes: 3,
      make(b, rng) {
        const [i, j] = pair(b, rng, 2, 6);
        return { label: `${k(b, i)}/${k(b, j)} call spread`, legs: [C(i, 1), C(j, -1)] };
      },
    },
    putSpreadWide: {
      name: 'Wide put spread', level: 'advanced', minStrikes: 3,
      make(b, rng) {
        const [i, j] = pair(b, rng, 2, 6);
        return { label: `${k(b, j)}/${k(b, i)} put spread`, legs: [P(j, 1), P(i, -1)] };
      },
    },
    callFly: {
      name: 'Call fly', level: 'advanced', minStrikes: 3,
      make(b, rng) {
        const [i, m, j] = fly(b, rng);
        return { label: `${k(b, i)}/${k(b, m)}/${k(b, j)} call fly`, legs: [C(i, 1), C(m, -2), C(j, 1)] };
      },
    },
    putFly: {
      name: 'Put fly', level: 'advanced', minStrikes: 3,
      make(b, rng) {
        const [i, m, j] = fly(b, rng);
        return { label: `${k(b, i)}/${k(b, m)}/${k(b, j)} put fly`, legs: [P(i, 1), P(m, -2), P(j, 1)] };
      },
    },
    ironFly: {
      name: 'Iron fly', level: 'advanced', minStrikes: 3,
      make(b, rng) {
        const [i, m, j] = fly(b, rng);
        return {
          label: `${k(b, i)}/${k(b, m)}/${k(b, j)} iron fly (sell the straddle, buy the wings)`,
          legs: [C(m, 1), P(m, 1), P(i, -1), C(j, -1)],
          note: 'priced as the credit you take in',
        };
      },
    },
    callCondor: {
      name: 'Call condor', level: 'advanced', minStrikes: 4,
      make(b, rng) {
        const [a, c, d, e] = condor(b, rng);
        return { label: `${k(b, a)}/${k(b, c)}/${k(b, d)}/${k(b, e)} call condor`, legs: [C(a, 1), C(c, -1), C(d, -1), C(e, 1)] };
      },
    },
    putCondor: {
      name: 'Put condor', level: 'advanced', minStrikes: 4,
      make(b, rng) {
        const [a, c, d, e] = condor(b, rng);
        return { label: `${k(b, a)}/${k(b, c)}/${k(b, d)}/${k(b, e)} put condor`, legs: [P(a, 1), P(c, -1), P(d, -1), P(e, 1)] };
      },
    },
    ironCondor: {
      name: 'Iron condor', level: 'advanced', minStrikes: 4,
      make(b, rng) {
        const [a, c, d, e] = condor(b, rng);
        return {
          label: `${k(b, a)}/${k(b, c)}/${k(b, d)}/${k(b, e)} iron condor (sell the ${k(b, c)}/${k(b, d)} strangle, buy the wings)`,
          legs: [P(c, 1), C(d, 1), P(a, -1), C(e, -1)],
          note: 'priced as the credit you take in',
        };
      },
    },
    box: {
      name: 'Box', level: 'advanced', minStrikes: 2,
      make(b, rng) {
        const [i, j] = pair(b, rng, 1, 6);
        return {
          label: `${k(b, i)}/${k(b, j)} box (buy the call spread and the put spread)`,
          legs: [C(i, 1), C(j, -1), P(j, 1), P(i, -1)],
        };
      },
    },
    conversion: {
      name: 'Conversion', level: 'advanced', minStrikes: 1,
      make(b, rng) {
        const i = rndInt(rng, 0, b.rows.length - 1);
        return { label: `${k(b, i)} conversion (buy ${d1(b)}, buy put, sell call)`, legs: [F(1), P(i, 1), C(i, -1)] };
      },
    },
    collar: {
      name: 'Collar', level: 'advanced', minStrikes: 2,
      make(b, rng) {
        const [i, j] = pair(b, rng, 1, 3);
        return { label: `${k(b, i)}/${k(b, j)} collar (buy ${d1(b)}, buy ${k(b, i)} put, sell ${k(b, j)} call)`, legs: [F(1), P(i, 1), C(j, -1)] };
      },
    },
    callRatio: {
      name: '1x2 call spread', level: 'advanced', minStrikes: 2,
      make(b, rng) {
        const [i, j] = pair(b, rng, 1, 2);
        return {
          label: `${k(b, i)}/${k(b, j)} 1x2 call spread (buy one ${k(b, i)}, sell two ${k(b, j)})`,
          legs: [C(i, 1), C(j, -2)], note: 'can be a credit — enter it negative',
        };
      },
    },
    putRatio: {
      name: '1x2 put spread', level: 'advanced', minStrikes: 2,
      make(b, rng) {
        const [i, j] = pair(b, rng, 1, 2);
        return {
          label: `${k(b, j)}/${k(b, i)} 1x2 put spread (buy one ${k(b, j)}, sell two ${k(b, i)})`,
          legs: [P(j, 1), P(i, -2)], note: 'can be a credit — enter it negative',
        };
      },
    },
  };

  function k(b, i) { return fmtK(b.rows[i].K); }
  function d1(b) { return b.delta1 === 'stock' ? 'stock' : 'future'; }
  function pair(b, rng, minGap, maxGap) {
    const n = b.rows.length;
    const gaps = [];
    for (let g = minGap; g <= Math.min(maxGap, n - 1); g++) gaps.push(g);
    const g = pick(rng, gaps);
    const i = rndInt(rng, 0, n - 1 - g);
    return [i, i + g];
  }
  function fly(b, rng) {
    const n = b.rows.length;
    const d = rndInt(rng, 1, Math.max(1, Math.floor((n - 1) / 2)));
    const i = rndInt(rng, 0, n - 1 - 2 * d);
    return [i, i + d, i + 2 * d];
  }
  function condor(b, rng) {
    const n = b.rows.length;
    for (;;) {
      const w = rndInt(rng, 1, 2), g = rndInt(rng, 1, 2);
      if (2 * w + g > n - 1) continue;
      const i = rndInt(rng, 0, n - 1 - 2 * w - g);
      return [i, i + w, i + w + g, i + 2 * w + g];
    }
  }

  // which families a level asks, with weights
  function familiesFor(level, nStrikes) {
    const out = [];
    for (const [key, f] of Object.entries(FAMILIES)) {
      if (f.minStrikes > nStrikes) continue;
      if (level === 'simple' && f.level !== 'simple') continue;
      let w = 1;
      if (level === 'advanced') w = f.level === 'advanced' ? 2.2 : 0.8;
      if (key === 'box' || key === 'conversion') w *= 0.5; // pure cash -- a good trap, but not too often
      out.push({ key, w });
    }
    return out;
  }

  // Builds the next question. `avoid` is the previous question's label (never ask the same thing twice running).
  function nextQuestion(board, level, rng, avoid) {
    rng = rng || Math.random;
    const fams = familiesFor(level, board.rows.length);
    const total = fams.reduce((s, f) => s + f.w, 0);
    for (let tries = 0; tries < 200; tries++) {
      let r = rng() * total, key = fams[0].key;
      for (const f of fams) { r -= f.w; if (r <= 0) { key = f.key; break; } }
      const q = FAMILIES[key].make(board, rng);
      if (!q || q.label === avoid) continue;
      return price(board, Object.assign({ family: key, familyName: FAMILIES[key].name, cash: 0 }, q));
    }
    throw new Error('no question');
  }

  // (re)prices a question on a board: theo, the named-legs width and the tightest width with its route
  function price(board, q) {
    const theo = B.theoOf(board, q.legs, q.cash);
    const named = B.namedWidth(board, q.legs);
    const t = B.tightest(board, q.legs);
    return Object.assign({}, q, { theo, namedWidth: named, width: t.width, route: t.route });
  }

  // "+1 95C  -2 100C  +1 F"
  function legsText(board, legs, cash) {
    const parts = legs.map(l => {
      const q = (l.q > 0 ? '+' : '−') + (Math.abs(l.q) === 1 ? '' : Math.abs(l.q) + '×');
      if (l.k === 'F') return q + (board.delta1 === 'stock' ? 'S' : 'F');
      return q + fmtK(board.rows[l.i].K) + l.k;
    });
    if (cash) parts.push((cash > 0 ? '+' : '−') + B.fmt(Math.abs(cash)) + ' cash');
    return parts.join('  ');
  }

  const api = { FAMILIES, familiesFor, nextQuestion, price, legsText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MMCombos = api;
})(typeof window !== 'undefined' ? window : globalThis);
