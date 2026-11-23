// Mental Math Drill: screens, the question loop, scoring, explanations.
(function () {
  'use strict';
  const B = window.MMBoard, Q = window.MMCombos;
  const $ = (id) => document.getElementById(id);
  const fmt = B.fmt, fmtK = B.fmtK;

  // ---------------------------------------------------------------- config
  const DEFAULTS = { delta1: 'future', tick: 5, nStrikes: 5, level: 'simple', dynamic: false, showLegs: true, minutes: 3, answer: 'theo' };
  let cfg = Object.assign({}, DEFAULTS);
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('mmdrill.cfg') || '{}')); } catch (e) { /* no storage */ }
  const saveCfg = () => { try { localStorage.setItem('mmdrill.cfg', JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

  const LEVEL_HINT = {
    simple: 'Call and put spreads, straddles, strangles, risk reversals, synthetic futures, P+S and buy-writes.',
    advanced: 'Mostly: wide spreads, call/put/iron flies, call/put/iron condors, boxes, conversions, collars and 1x2s — plus the simple ones.',
  };

  const ANSWER_HINT = {
    theo: 'Type the theo and the total width (tightest route).',
    market: 'Type your market: bid = theo − width / 2, offer = theo + width / 2 (tightest route).',
  };

  // what the two boxes ask for, and the right answers, in the session's answer mode
  function spec(q, mode) {
    if (mode === 'market') return { n1: 'Bid', n2: 'Offer', v1: q.theo - q.width / 2, v2: q.theo + q.width / 2 };
    return { n1: 'Theo', n2: 'Width', v1: q.theo, v2: q.width };
  }

  function bindConfig() {
    const syncAnswer = () => { $('answerHint').textContent = ANSWER_HINT[cfg.answer]; };
    document.querySelectorAll('input[name="answer"]').forEach(r => {
      r.checked = r.value === cfg.answer;
      r.addEventListener('change', () => { cfg.answer = r.value; saveCfg(); syncAnswer(); });
    });
    syncAnswer();
    document.querySelectorAll('input[name="delta1"]').forEach(r => {
      r.checked = r.value === cfg.delta1;
      r.addEventListener('change', () => { cfg.delta1 = r.value; saveCfg(); });
    });
    document.querySelectorAll('input[name="tick"]').forEach(r => {
      r.checked = +r.value === cfg.tick;
      r.addEventListener('change', () => { cfg.tick = +r.value; saveCfg(); });
    });
    const syncLevel = () => { $('levelHint').textContent = LEVEL_HINT[cfg.level]; };
    document.querySelectorAll('input[name="level"]').forEach(r => {
      r.checked = r.value === cfg.level;
      r.addEventListener('change', () => { cfg.level = r.value; saveCfg(); syncLevel(); });
    });
    syncLevel();
    $('cfgStrikes').value = cfg.nStrikes; $('strikesLabel').textContent = cfg.nStrikes;
    $('cfgStrikes').addEventListener('input', e => { cfg.nStrikes = +e.target.value; $('strikesLabel').textContent = cfg.nStrikes; saveCfg(); });
    $('cfgMinutes').value = cfg.minutes; $('minutesLabel').textContent = cfg.minutes + ' min';
    $('cfgMinutes').addEventListener('input', e => { cfg.minutes = +e.target.value; $('minutesLabel').textContent = cfg.minutes + ' min'; saveCfg(); });
    $('cfgDynamic').checked = cfg.dynamic;
    $('cfgDynamic').addEventListener('change', e => { cfg.dynamic = e.target.checked; saveCfg(); });
    $('cfgShowLegs').checked = cfg.showLegs;
    $('cfgShowLegs').addEventListener('change', e => { cfg.showLegs = e.target.checked; saveCfg(); });
    $('startBtn').addEventListener('click', () => countdown(startDrill));
    $('retryBtn').addEventListener('click', () => countdown(startDrill));
    $('reconfigBtn').addEventListener('click', () => show('config'));
    $('fullscreenBtn').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen();
    });
  }

  function show(screen) {
    $('configScreen').classList.toggle('hidden', screen !== 'config');
    $('drillScreen').classList.toggle('hidden', screen !== 'drill');
    $('resultsScreen').classList.toggle('hidden', screen !== 'results');
    $('explainBtn').classList.toggle('hidden', screen !== 'drill' || !S || !S.last);
  }

  function countdown(then) {
    let n = 3;
    $('countdownOverlay').classList.remove('hidden');
    $('countdownNumber').textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n === 0) { clearInterval(iv); $('countdownOverlay').classList.add('hidden'); then(); }
      else $('countdownNumber').textContent = n;
    }, 650);
  }

  // ---------------------------------------------------------------- board rendering
  // hl: { named: Set of ids, route: Set of ids }, diff: previous board (flash what moved)
  function boardHTML(board, hl, diff) {
    hl = hl || { named: new Set(), route: new Set() };
    const cls = (id, now, before) => {
      let c = 'chip';
      if (hl.named.has(id)) c += ' hl-named';
      if (hl.route.has(id)) c += ' hl-route';
      if (diff && before !== undefined && now !== before) c += now > before ? ' up' : ' down';
      return c;
    };
    const chip = (id, theo, w, before) =>
      `<span class="${cls(id, theo, before)}" data-id="${id}">${fmt(theo)} <span class="w">${fmt(w)}</span></span>`;
    const d1 = board.delta1 === 'stock' ? 'S' : 'F';
    let h = `<div class="bd-delta1"><span class="lbl">${d1} =</span>${chip('F', board.F, board.wF, diff && diff.F)}</div>`;
    h += '<div class="bd-grid"><div class="bd-head">Call</div><div class="bd-head">Strike</div><div class="bd-head">Put</div>';
    board.rows.forEach((r, i) => {
      const pr = diff && diff.rows[i];
      h += `<div class="bd-cell">${chip('C' + i, r.C, r.wC, pr && pr.C)}</div>`;
      h += `<div class="bd-strike">${fmtK(r.K)}</div>`;
      h += `<div class="bd-cell">${chip('P' + i, r.P, r.wP, pr && pr.P)}</div>`;
    });
    h += '</div>';
    h += `<div class="bd-meta">theo &nbsp;<span style="color:#777">w = total width (bid to offer)</span> · rates 0, so C − P = ${d1} − K</div>`;
    return h;
  }
  const legId = (l) => (l.k === 'F' ? 'F' : l.k + l.i);

  // ---------------------------------------------------------------- session state
  let S = null;
  let timerIv = null;

  function startDrill() {
    const sess = B.newSession({ tick: cfg.tick, nStrikes: cfg.nStrikes, delta1: cfg.delta1 });
    S = {
      sess, board: sess.board,
      cfg: Object.assign({}, cfg),
      score: 0, streak: 0, bestStreak: 0,
      n: 0, sinceMove: 0, log: [], last: null,
      endAt: performance.now() + cfg.minutes * 60000, pausedAt: null,
      phase: 'answer', q: null, qStart: 0,
    };
    $('history').innerHTML = '';
    show('drill');
    renderBoard();
    nextQuestion();
    clearInterval(timerIv);
    timerIv = setInterval(tick, 200);
    tick();
  }

  function remainingMs() {
    const now = S.pausedAt !== null ? S.pausedAt : performance.now();
    return Math.max(0, S.endAt - now);
  }
  function tick() {
    if (!S) return;
    const ms = remainingMs();
    const s = Math.ceil(ms / 1000);
    $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (ms <= 0 && S.pausedAt === null) endDrill();
  }
  function pause() { if (S && S.pausedAt === null) S.pausedAt = performance.now(); }
  function resume() {
    if (S && S.pausedAt !== null) {
      const dt = performance.now() - S.pausedAt;
      S.endAt += dt; S.qStart += dt; S.pausedAt = null;
    }
  }

  function renderBoard(prev) {
    $('boardCard').innerHTML = boardHTML(S.board, null, prev);
    if (prev) setTimeout(() => document.querySelectorAll('#boardCard .chip.up, #boardCard .chip.down')
      .forEach(el => el.classList.remove('up', 'down')), 1600);
  }

  function updateTop() {
    $('scoreVal').textContent = S.score;
    $('streakVal').textContent = S.streak >= 3 ? `· streak ${S.streak}` : '';
    const badge = $('moveBadge');
    if (S.cfg.dynamic) {
      badge.classList.remove('hidden');
      const left = 5 - S.sinceMove;
      badge.textContent = left === 1 ? 'Market moves after this one' : `Market moves in ${left}`;
    } else badge.classList.add('hidden');
  }

  function nextQuestion() {
    S.q = Q.nextQuestion(S.board, S.cfg.level, Math.random, S.q && S.q.label);
    S.phase = 'answer';
    S.qStart = performance.now();
    $('qCount').textContent = `Combo ${S.n + 1}`;
    $('qLabel').textContent = S.q.label;
    $('qLegs').textContent = S.cfg.showLegs ? Q.legsText(S.board, S.q.legs, S.q.cash) : '';
    $('qNote').textContent = S.q.note || '';
    const sp = spec(S.q, S.cfg.answer);
    $('lbl1').textContent = sp.n1; $('lbl2').textContent = sp.n2;
    $('inTheo').value = ''; $('inWidth').value = '';
    $('inTheo').disabled = false; $('inWidth').disabled = false;
    $('feedback').innerHTML = '';
    $('inTheo').focus();
    updateTop();
  }

  function parseCents(s) {
    s = String(s).trim().replace(',', '.').replace('−', '-');
    if (s === '' || !/^-?\d*\.?\d*$/.test(s) || s === '-' || s === '.') return null;
    return Math.round(parseFloat(s) * 100);
  }

  function routeText(board, q) {
    return Q.legsText(board, q.route, 0);
  }

  function submit(skipped) {
    if (S.phase !== 'answer') { if (S.phase === 'wrong') advance(); return; }
    const q = S.q, board = S.board, mode = S.cfg.answer;
    const sp = spec(q, mode);
    const a1 = skipped ? null : parseCents($('inTheo').value);
    const a2 = skipped ? null : parseCents($('inWidth').value);
    if (!skipped && (a1 === null || a2 === null)) {
      $('feedback').innerHTML = `<span class="bad">Enter both a ${sp.n1.toLowerCase()} and ${mode === 'market' ? 'an' : 'a'} ${sp.n2.toLowerCase()}.</span>`;
      if (a1 === null) $('inTheo').focus(); else $('inWidth').focus();
      return;
    }
    const secs = (performance.now() - S.qStart) / 1000;
    const ok1 = a1 === sp.v1, ok2 = a2 === sp.v2;
    S.score += (ok1 ? 1 : 0) + (ok2 ? 1 : 0);
    S.n++;
    if (ok1 && ok2) { S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak); } else S.streak = 0;
    const rec = { q, board, mode, a1, a2, ok1, ok2, secs, skipped: !!skipped };
    S.log.push(rec);
    S.last = rec;
    $('explainBtn').classList.remove('hidden');
    addHistory(rec);
    $('inTheo').disabled = true; $('inWidth').disabled = true;

    if (ok1 && ok2) {
      const txt = mode === 'market'
        ? `✓ ${fmt(sp.v1)} / ${fmt(sp.v2)}`
        : `✓ ${fmt(q.theo)} theo, ${fmt(q.width)} wide`;
      $('feedback').innerHTML = `<span class="good">${txt}</span> <span class="muted">(${secs.toFixed(1)}s)</span>`;
      S.phase = 'done';
      updateTop();
      setTimeout(() => { if (S && S.phase === 'done' && S.pausedAt === null) advance(); else if (S) S.phase = 'wrong'; }, 450);
      return;
    }
    const part = (ok, name, v, you) => ok
      ? `<span class="good">${name} ${fmt(v)} ✓</span>`
      : `<span class="bad">${name} ${fmt(v)}</span>${you !== null ? ` <span class="muted">(you: ${fmt(you)})</span>` : ''}`;
    let h = part(ok1, sp.n1, sp.v1, a1) + ' &nbsp;·&nbsp; ' + part(ok2, sp.n2, sp.v2, a2);
    if (mode === 'market') h += `<br>Theo ${fmt(q.theo)}, ${fmt(q.width)} wide → ${fmt(q.theo)} ∓ ${fmt(q.width / 2)}`;
    const widthWrong = mode === 'market' ? !(ok1 && ok2) : !ok2;
    if (widthWrong) {
      if (q.width === 0) h += '<br>Pure cash payoff: nothing to cross, so 0 wide.';
      else if (q.width < q.namedWidth) h += `<br>Tightest route: <span class="eq">${routeText(board, q)}</span> (the legs as named are ${fmt(q.namedWidth)} wide)`;
    }
    h += '<br><span class="cont">Enter to continue · Explain Last Answer for the working</span>';
    $('feedback').innerHTML = h;
    S.phase = 'wrong';
    updateTop();
    $('answerForm').querySelector('.go-btn').focus();
  }

  function advance() {
    if (!S) return;
    S.sinceMove++;
    if (S.cfg.dynamic && S.sinceMove >= 5) {
      S.sinceMove = 0;
      const prev = S.board;
      S.sess = B.moveSession(S.sess);
      S.board = S.sess.board;
      renderBoard(prev);
      const d1 = S.board.delta1 === 'stock' ? 'Stock' : 'Future';
      const dF = S.board.F - prev.F;
      const volTxt = S.board.vol > prev.vol + 0.004 ? ', vol up' : S.board.vol < prev.vol - 0.004 ? ', vol down' : '';
      const msg = `Market moved: ${d1} ${fmt(prev.F)} → ${fmt(S.board.F)} (${dF >= 0 ? '+' : ''}${fmt(dF)})${volTxt}`;
      toast(msg);
      const div = document.createElement('div');
      div.className = 'h-item h-move'; div.textContent = msg;
      $('history').prepend(div);
    }
    nextQuestion();
  }

  function histAnswer(rec, mark) {
    const sp = spec(rec.q, rec.mode);
    if (rec.mode === 'market') return `${mark(rec.ok1)} ${fmt(sp.v1)} / ${mark(rec.ok2)} ${fmt(sp.v2)}`;
    return `${mark(rec.ok1)} ${fmt(sp.v1)} &nbsp; ${mark(rec.ok2)} ${fmt(sp.v2)}w`;
  }

  function addHistory(rec) {
    const div = document.createElement('div');
    div.className = 'h-item';
    const mark = (ok) => ok ? '<span class="h-ok">✓</span>' : '<span class="h-bad">✗</span>';
    div.innerHTML = `<div class="h-l">${rec.q.label}</div>
      <div class="h-a">${histAnswer(rec, mark)} &nbsp; <span class="muted">${rec.skipped ? 'skipped' : rec.secs.toFixed(1) + 's'}</span></div>`;
    $('history').prepend(div);
  }

  let toastT = null;
  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => $('toast').classList.add('hidden'), 2800);
  }

  // ---------------------------------------------------------------- explain
  function openExplain() {
    if (!S || !S.last) return;
    pause();
    const { q, board, a1, a2, ok1, ok2, mode } = S.last;
    const sp = spec(q, mode);
    const named = new Set(q.legs.map(legId));
    const route = new Set(q.route.map(legId));
    const sameRoute = q.width === q.namedWidth;
    const d1 = board.delta1 === 'stock' ? 'stock' : 'future';
    const legName = (l) => l.k === 'F' ? d1 : `${fmtK(board.rows[l.i].K)} ${l.k === 'C' ? 'call' : 'put'}`;
    const legTheo = (l) => l.k === 'F' ? board.F : board.rows[l.i][l.k];

    const table = (legs, cash, title) => {
      let t = `<table><tr><th>${title}</th><th>qty</th><th>theo</th><th>width</th><th>qty × theo</th><th>|qty| × width</th></tr>`;
      let tt = cash || 0, tw = 0;
      legs.forEach(l => {
        const th = legTheo(l), w = B.legWidth(board, l);
        tt += l.q * th; tw += Math.abs(l.q) * w;
        t += `<tr><td>${legName(l)}</td><td>${l.q > 0 ? '+' : ''}${l.q}</td><td>${fmt(th)}</td><td>${fmt(w)}</td><td>${fmt(l.q * th)}</td><td>${fmt(Math.abs(l.q) * w)}</td></tr>`;
      });
      if (cash) t += `<tr><td>cash (strikes)</td><td></td><td></td><td></td><td>${fmt(cash)}</td><td>0.00</td></tr>`;
      t += `<tr class="tot"><td>Total</td><td></td><td></td><td></td><td>${fmt(tt)}</td><td>${fmt(tw)}</td></tr></table>`;
      return t;
    };

    let why = `<p><b>${q.label}</b> &nbsp;<span class="eq">${Q.legsText(board, q.legs, q.cash)}</span></p>`;
    why += `<p>Answer: theo <b>${fmt(q.theo)}</b>, width <b>${fmt(q.width)}</b>`;
    if (mode === 'market') why += ` → market <b>${fmt(sp.v1)} / ${fmt(sp.v2)}</b> (theo ∓ half the width, ${fmt(q.width / 2)})`;
    why += '. ';
    why += S.last.skipped ? '<span class="muted">(skipped)</span>' :
      `You: <span class="${ok1 ? 'good' : 'bad'}">${fmt(a1)}</span> / <span class="${ok2 ? 'good' : 'bad'}">${fmt(a2)}</span>`;
    why += '</p>';
    why += `<p><b>Theo</b> is the legs' theos added up with their signs (any route gives the same number, because parity is exact on the board).</p>`;
    why += table(q.legs, q.cash, 'Legs as named');
    if (q.width === 0) {
      why += `<p><b>Width:</b> put the legs together and the payoff is the same at every price: fixed cash of ${fmt(q.theo)}. With rates at zero cash costs nothing to hold, so there is nothing to cross: <b>0 wide</b>. Crossing every leg (${fmt(q.namedWidth)}) is what you'd pay if you had to leg it, not where the structure is worth quoting.</p>`;
    } else if (sameRoute) {
      why += `<p><b>Width:</b> crossing each leg costs ${fmt(q.namedWidth)} in total, and no other route on the board is tighter, so it's <b>${fmt(q.width)}</b>.</p>`;
    } else {
      why += `<p><b>Width:</b> crossing the legs as named costs ${fmt(q.namedWidth)}, but the same payoff can be built more cheaply. A put is a call minus the ${d1} plus K in cash (C − P = ${d1 === 'future' ? 'F' : 'S'} − K), so any put can be traded as a call and the ${d1}, and any call as a put and the ${d1}:</p>`;
      why += table(q.route, q.theo - B.theoOf(board, q.route, 0), 'Tightest route');
      why += `<p>Same payoff, <b>${fmt(q.width)}</b> wide (the cash line is the strikes you pick up or pay away when you swap a put for a call and the ${d1}; at zero rates cash is free, so the theo comes out the same).</p>`;
    }
    why += `<p class="muted"><span class="key n"></span>legs as named &nbsp; <span class="key r"></span>tightest route</p>`;

    $('explain').innerHTML = `<div class="ex-card">
      <div class="ex-head"><h2>Explain last answer</h2><span class="muted">Timer paused</span><button class="ex-close" id="exClose">Close (Esc)</button></div>
      <div class="ex-body"><div id="exBoard"><div class="boardCard" style="background:linear-gradient(#fbfcfc,#f1f3f3);border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.18);padding:14px 20px">${boardHTML(board, { named, route })}</div></div>
      <div class="ex-why">${why}</div></div></div>`;
    $('explain').classList.remove('hidden');
    $('exClose').addEventListener('click', closeExplain);
  }
  function closeExplain() {
    $('explain').classList.add('hidden');
    resume();
    if (S && S.phase === 'answer') $('inTheo').focus();
    else if (S) $('answerForm').querySelector('.go-btn').focus();
  }

  // ---------------------------------------------------------------- end
  function endDrill() {
    clearInterval(timerIv);
    if (!$('explain').classList.contains('hidden')) $('explain').classList.add('hidden');
    const log = S.log;
    const n = log.length;
    const pct = (k) => n ? Math.round(100 * log.filter(r => r[k]).length / n) + '%' : '–';
    const both = n ? Math.round(100 * log.filter(r => r.ok1 && r.ok2).length / n) + '%' : '–';
    const sp0 = spec({ theo: 0, width: 0 }, S.cfg.answer);
    const n1 = sp0.n1.toLowerCase(), n2 = sp0.n2.toLowerCase();
    const answered = log.filter(r => !r.skipped);
    const avg = answered.length ? (answered.reduce((s, r) => s + r.secs, 0) / answered.length).toFixed(1) + 's' : '–';
    $('finalScore').textContent = `${S.score} points`;
    let h = `<div class="stat-row">
      <div class="stat"><b>${n}</b>combos</div>
      <div class="stat"><b>${pct('ok1')}</b>${n1} right</div>
      <div class="stat"><b>${pct('ok2')}</b>${n2} right</div>
      <div class="stat"><b>${both}</b>both right</div>
      <div class="stat"><b>${avg}</b>avg time</div>
      <div class="stat"><b>${S.bestStreak}</b>best streak</div></div>`;
    const fam = {};
    log.forEach(r => {
      const f = fam[r.q.familyName] || (fam[r.q.familyName] = { n: 0, t: 0, w: 0, secs: 0, timed: 0 });
      f.n++; if (r.ok1) f.t++; if (r.ok2) f.w++;
      if (!r.skipped) { f.secs += r.secs; f.timed++; }
    });
    const rows = Object.entries(fam).sort((a, b) => (a[1].t + a[1].w) / a[1].n - (b[1].t + b[1].w) / b[1].n);
    if (rows.length) {
      h += `<table><tr><th>Combo</th><th>asked</th><th>${n1} right</th><th>${n2} right</th><th>avg time</th></tr>`;
      rows.forEach(([name, f]) => {
        h += `<tr><td>${name}</td><td>${f.n}</td><td>${f.t}/${f.n}</td><td>${f.w}/${f.n}</td><td>${f.timed ? (f.secs / f.timed).toFixed(1) + 's' : '–'}</td></tr>`;
      });
      h += '</table><p class="muted" style="font-size:.85em">Weakest first.</p>';
    }
    $('finalStats').innerHTML = h;
    show('results');
  }

  // ---------------------------------------------------------------- keys
  function bindDrill() {
    $('answerForm').addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
    $('inTheo').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (S.phase === 'answer') $('inWidth').focus(); }
    });
    $('inWidth').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(false); }
    });
    $('skipBtn').addEventListener('click', () => { if (S.phase === 'answer') submit(true); else advance(); });
    $('endBtn').addEventListener('click', () => endDrill());
    $('explainBtn').addEventListener('click', openExplain);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('explain').classList.contains('hidden')) closeExplain();
    });
  }

  window.MMDebug = () => S; // for the browser test
  bindConfig();
  bindDrill();
  show('config');
})();
