// node test/fuzz.test.js
// Generates thousands of boards (every tick, strike count and delta-1, plus long runs of dynamic moves) and checks:
//  1. every board passes validateBoard
//  2. no arbitrage, checked independently: random portfolios of the board's bids/offers never cost less than
//     the least they can pay at expiry
//  3. every question: the theo matches an independent closed form, the tightest width matches a brute-force
//     search over replications, is never wider than the named legs, and the route really replicates the payoff
const B = require('../js/board.js');
const Q = require('../js/combos.js');

let checks = 0, failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; if (failures < 30) console.log('FAIL:', msg); } }

function payoffAt(b, port, S) { // port: {F, C:[], P:[]}
  let v = port.F * S;
  b.rows.forEach((r, i) => { v += port.C[i] * Math.max(S - r.K, 0) + port.P[i] * Math.max(r.K - S, 0); });
  return v;
}
function noArbRandom(b, rng, trials) {
  const n = b.rows.length;
  for (let t = 0; t < trials; t++) {
    const port = { F: 0, C: new Array(n).fill(0), P: new Array(n).fill(0) };
    const legs = 1 + Math.floor(rng() * 5);
    for (let l = 0; l < legs; l++) {
      const q = Math.floor(rng() * 5) - 2;
      const u = Math.floor(rng() * (2 * n + 1));
      if (u === 2 * n) port.F += q; else if (u < n) port.C[u] += q; else port.P[u - n] += q;
    }
    // cost to put the portfolio on: buy at offers, sell at bids
    const cost = (q, theo, w) => q * theo + Math.abs(q) * (w / 2);
    let c = cost(port.F, b.F, b.wF);
    b.rows.forEach((r, i) => { c += cost(port.C[i], r.C, r.wC) + cost(port.P[i], r.P, r.wP); });
    const slopeHigh = port.F + port.C.reduce((s, x) => s + x, 0);
    if (slopeHigh < 0) continue; // unbounded loss on the upside: never an arb
    let minPay = payoffAt(b, port, 0);
    b.rows.forEach(r => { minPay = Math.min(minPay, payoffAt(b, port, r.K)); });
    ok(minPay - c <= 0, `arb: portfolio ${JSON.stringify(port)} costs ${c}, pays at least ${minPay}`);
  }
}

// independent closed forms of each family's theo (rates zero)
function closedForm(b, q) {
  const r = b.rows, legs = q.legs;
  const Ks = legs.filter(l => l.k !== 'F').map(l => l.i);
  const lo = Math.min(...Ks), hi = Math.max(...Ks);
  switch (q.family) {
    case 'callSpread': case 'callSpreadWide': return r[lo].C - r[hi].C;
    case 'putSpread': case 'putSpreadWide': return r[hi].P - r[lo].P;
    case 'straddle': return r[lo].C + r[lo].P;
    case 'strangle': return r[lo].P + r[hi].C;
    case 'riskReversal': return Math.abs(r[hi].C - r[lo].P);
    case 'synthetic': return b.F;                         // K + C - P = F
    case 'ps': return r[lo].C + r[lo].K;                  // P + F = C + K
    case 'bw': return r[lo].K - r[lo].P;                  // F - C = K - P
    case 'conversion': return r[lo].K;                    // F + P - C = K
    case 'box': return r[hi].K - r[lo].K;
    case 'collar': return r[lo].K + r[lo].C - r[hi].C;    // F + P1 - C2 = K1 + C1 - C2
    case 'callFly': case 'putFly': {                      // call fly = put fly
      const m = legs.find(l => l.q === -2).i;
      return r[lo].C - 2 * r[m].C + r[hi].C;
    }
    case 'ironFly': {                                     // = wing width - fly
      const m = legs.find(l => l.k === 'C' && l.q === 1).i;
      return (r[m].K - r[lo].K) - (r[lo].C - 2 * r[m].C + r[hi].C);
    }
    case 'callCondor': case 'putCondor': case 'ironCondor': {
      const idx = [...new Set(Ks)].sort((a, b2) => a - b2);
      const [a, c, d, e] = idx;
      const callCondor = r[a].C - r[c].C - r[d].C + r[e].C;
      if (q.family === 'ironCondor') return (r[c].K - r[a].K) - callCondor; // = wing - condor
      return callCondor;
    }
    case 'callRatio': return r[lo].C - 2 * r[hi].C;
    case 'putRatio': return r[hi].P - 2 * r[lo].P;
  }
  throw new Error('no closed form for ' + q.family);
}

function bruteWidth(b, legs) {
  const { a, b: bb } = B.payoffOf(legs, b);
  const n = a.length;
  let best = Infinity;
  const t = new Array(n).fill(0);
  const RANGE = 4;
  (function rec(i) {
    if (i === n) {
      let w = Math.abs(bb + t.reduce((s, x) => s + x, 0)) * b.wF;
      for (let j = 0; j < n; j++) w += Math.abs(a[j] - t[j]) * b.rows[j].wC + Math.abs(t[j]) * b.rows[j].wP;
      if (w < best) best = w;
      return;
    }
    for (let x = -RANGE; x <= RANGE; x++) { t[i] = x; rec(i + 1); }
  })(0);
  return best;
}

function checkQuestion(b, q, brute) {
  ok(q.theo === closedForm(b, q), `${q.label}: theo ${q.theo} vs closed form ${closedForm(b, q)}`);
  ok(q.width <= q.namedWidth, `${q.label}: tightest ${q.width} wider than legs ${q.namedWidth}`);
  ok(q.width >= 0 && q.width % (2 * b.tick) === 0, `${q.label}: width ${q.width} not an even number of ticks`);
  // bid / offer mode: theo -/+ half the width must land on the tick
  ok(q.theo % b.tick === 0 && (q.theo - q.width / 2) % b.tick === 0 && (q.theo + q.width / 2) % b.tick === 0, `${q.label}: market off tick`);
  // the route replicates the payoff exactly and has that width
  const p1 = B.payoffOf(q.legs, b), p2 = B.payoffOf(q.route, b);
  ok(JSON.stringify(p1) === JSON.stringify(p2), `${q.label}: route does not replicate`);
  ok(B.namedWidth(b, q.route) === q.width, `${q.label}: route width mismatch`);
  // values that must hold on any arbitrage-free board
  const gapOf = (i, j) => b.rows[j].K - b.rows[i].K;
  if (q.family === 'box' || q.family === 'conversion') ok(q.width === 0, `${q.label}: pure cash should be 0 wide`);
  if (q.family === 'synthetic') {
    const m = Math.min(b.wF, ...b.rows.map(r => r.wC + r.wP));
    ok(q.width === m, `${q.label}: synthetic width ${q.width} vs ${m}`);
  }
  if (/Spread|Fly|Condor/.test(q.family) && !/Ratio/.test(q.family)) ok(q.theo > 0, `${q.label}: theo not positive`);
  if (q.family === 'callSpread' || q.family === 'callSpreadWide') {
    const is = q.legs.map(l => l.i); ok(q.theo < gapOf(Math.min(...is), Math.max(...is)), `${q.label}: spread above gap`);
  }
  if (brute) {
    const bw = bruteWidth(b, q.legs);
    ok(bw === q.width, `${q.label}: brute ${bw} vs dp ${q.width}`);
  }
}

const t0 = Date.now();
let boards = 0, questions = 0;
const famSeen = {};
for (const tick of [1, 2, 5]) {
  for (const nStrikes of [3, 4, 5, 6, 7]) {
    for (const delta1 of ['future', 'stock']) {
      for (let seed = 0; seed < 60; seed++) {
        const rng = B.mulberry32(seed * 1000 + tick * 100 + nStrikes * 7 + (delta1 === 'stock' ? 3 : 0));
        let sess = B.newSession({ tick, nStrikes, delta1 }, rng);
        for (let step = 0; step < 12; step++) {
          const b = sess.board;
          boards++;
          const errs = B.validateBoard(b);
          ok(errs.length === 0, `board errors ${errs.join(', ')}`);
          noArbRandom(b, rng, 400);
          for (const level of ['simple', 'advanced']) {
            for (let k = 0; k < 6; k++) {
              const q = Q.nextQuestion(b, level, rng);
              famSeen[q.family] = (famSeen[q.family] || 0) + 1;
              questions++;
              checkQuestion(b, q, nStrikes <= 5);
            }
          }
          sess = B.moveSession(sess, rng);
        }
      }
    }
  }
}
console.log(`${boards} boards, ${questions} questions, ${checks} checks, ${failures} failures, ${Date.now() - t0} ms`);
console.log('families asked:', Object.keys(famSeen).length, JSON.stringify(famSeen));
process.exit(failures ? 1 : 0);
