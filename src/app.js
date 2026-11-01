// ===== App ===============================================================
(function () {
  const { LEVELS, F, evaluate, starsFor, STARS } = CORE;
  const $ = id => document.getElementById(id);
  const KEY = 'excitable-progress-v1'; // original key kept so saved progress survives the rename
  const blank = () => ({ stars: {}, best: {}, hinted: {}, params: {}, unlockAll: false, last: 0 });
  let S = blank();
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(blank(), JSON.parse(raw)); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  const CUR_COL = { INa: 'c-na', ICaL: 'c-ca', IT: 'c-ca', Ito: 'c-to', IKr: 'c-kr', IKs: 'c-ks', IM: 'c-ks',
    IK1: 'c-k1', IK: 'c-k1', IKd: 'c-k1', IL: 'c-lk', INaCa: 'c-ncx', INaK: 'c-pump' };
  const CUR_NAME = { INa: 'Na⁺', ICaL: 'Ca²⁺ L-type', IT: 'Ca²⁺ T-type', Ito: 'transient out', IKr: 'K⁺ rapid', IKs: 'K⁺ slow',
    IM: 'K⁺ M-type', IK1: 'K⁺ inward rect.', IK: 'K⁺', IKd: 'K⁺ delayed rect.', IL: 'leak', INaCa: 'Na⁺/Ca²⁺ exch.', INaK: 'Na⁺/K⁺ pump' };

  let idx = 0, L, p, T, Tdisp, R, ev, curScale = {}, pending = false;

  const css = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim();
  const fmt = (x, d) => (x === undefined || !isFinite(x)) ? '—' : x.toFixed(d);
  const sig = x => { const a = Math.abs(x); return a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : a >= 1 ? x.toFixed(2) : a >= 0.1 ? x.toFixed(3) : x.toFixed(4); };
  const unlocked = i => S.unlockAll || i === 0 || (S.stars[LEVELS[i - 1].id] || 0) >= 1;

  // ---- slider mapping ----
  const N = 1000;
  const toPos = (t, v) => t.lin ? (v - t.min) / (t.max - t.min) * N : Math.log(v / t.min) / Math.log(t.max / t.min) * N;
  const fromPos = (t, x) => t.lin ? t.min + (t.max - t.min) * x / N : t.min * Math.pow(t.max / t.min, x / N);

  // ---- deterministic "recording" noise for the target ----
  function noisy(V, amp) {
    let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const out = new Float64Array(V.length); let y = 0;
    for (let i = 0; i < V.length; i++) { const g = (rnd() + rnd() + rnd() - 1.5) * 2; y = 0.55 * y + 0.45 * g; out[i] = V[i] + amp * y; }
    return out;
  }

  // ---- level strip ----
  function renderLevels() {
    const el = $('levels'); el.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lv' + (unlocked(i) ? '' : ' locked');
      b.setAttribute('aria-current', i === idx ? 'true' : 'false');
      const st = S.stars[lv.id] || 0;
      b.innerHTML = `<span class="n">${i + 1}</span><span class="t">${lv.name}</span><span class="s">${unlocked(i) ? [0, 1, 2].map(k => `<span class="${k < st ? 'on' : ''}">★</span>`).join('') : 'Earn ★ on level ' + i}</span>`;
      b.onclick = () => { if (unlocked(i)) loadLevel(i); else toast(`Earn a star on level ${i} to open this one`); };
      el.appendChild(b);
      if (i === idx) requestAnimationFrame(() => b.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    });
    const tot = Object.values(S.stars).reduce((a, b) => a + b, 0);
    $('tally').textContent = tot; $('tallyOf').textContent = `/ ${LEVELS.length * 3} stars`;
  }

  // ---- brief ----
  function renderBrief() {
    $('brief').innerHTML = `<div class="eyebrow">Level ${idx + 1} · ${L.who} · ${L.ref}</div>
      <h2>${L.name}</h2><p>${L.brief}</p>
      <div class="proto"><span>Protocol</span><span>${L.protocol}</span></div>
      <details class="notes" id="notes"><summary>Field notes (free hint)</summary><p>${L.hint0}</p></details>`;
    $('curUnit').textContent = `Ionic currents in your cell, ${L.units.cur}. Inward current points down.`;
    $('rackSub').textContent = L.id === 'potassium'
      ? 'The channels are healthy and fixed. Slide to change the patient’s serum ion concentrations.'
      : 'Slide to change how many channels of each type the membrane carries (maximal conductance).';
  }

  // ---- rack ----
  function renderTools() {
    const box = $('tools'); box.innerHTML = '';
    for (const t of L.tools) {
      const row = document.createElement('div'); row.className = 'tool';
      row.style.setProperty('--tc', `var(--${t.col})`);
      const id = `sl-${L.id}-${t.k}`;
      row.innerHTML = `<span class="sw" style="background:var(--${t.col})"></span>
        <label for="${id}"><div class="nm">${t.name}</div><div class="gn">${t.gene}</div></label>
        <div class="val" id="v-${t.k}"></div>
        <input type="range" id="${id}" min="0" max="${N}" step="1" value="${toPos(t, p[t.k])}">`;
      box.appendChild(row);
      const inp = row.querySelector('input');
      inp.addEventListener('input', () => { p[t.k] = fromPos(t, +inp.value); showVal(t); schedule(); });
      showVal(t);
    }
  }
  function showVal(t) {
    const v = p[t.k] * (t.scale || 1);
    $('v-' + t.k).innerHTML = `${sig(v)}<small>${t.unit}</small>`;
  }

  // ---- simulate & score ----
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; run(); }); }
  function run() {
    R = L.sim(p); ev = evaluate(L, R, T);
    S.params[L.id] = Object.assign({}, p);
    const cap = S.hinted[L.id] ? 2 : 3;
    const st = Math.min(starsFor(ev.score), cap);
    const prev = S.stars[L.id] || 0;
    if (ev.score > (S.best[L.id] || 0)) S.best[L.id] = ev.score;
    if (st > prev) {
      S.stars[L.id] = st; renderLevels();
      toast(`<span class="st">${'★'.repeat(st)}</span> ${st === 3 ? 'Perfect match' : st === 2 ? 'Close match' : 'Level cleared'}${idx + 1 < LEVELS.length && prev === 0 ? '. Next level unlocked' : ''}`);
    }
    save();
    drawScope(); drawCurrents(); renderScore(); renderFeats(); renderDebrief();
  }

  function renderScore() {
    const s = ev.score, st = starsFor(s), cap = S.hinted[L.id] ? 2 : 3, got = S.stars[L.id] || 0;
    $('pct').innerHTML = `${Math.floor(s)}<small>%</small>`;
    $('stars').innerHTML = [0, 1, 2].map(k => `<span class="${k < Math.min(st, cap) ? 'on' : ''}">★</span>`).join('') +
      (cap < 3 ? '<span class="cap">Assistant used: capped at ★★</span>' : '');
    $('fill').style.width = Math.max(0, Math.min(100, s)) + '%';
    const m = document.querySelector('.meter');
    m.querySelectorAll('.tick').forEach(e => e.remove());
    STARS.forEach((x, i) => { const d = document.createElement('div'); d.className = 'tick'; d.style.left = x + '%'; d.dataset.l = '★'.repeat(i + 1); m.appendChild(d); });
    $('bestline').textContent = `Best ${Math.floor(S.best[L.id] || 0)}% · earned ${'★'.repeat(got) || 'no stars yet'} · ★ at ${STARS[0]}%, ★★ at ${STARS[1]}%, ★★★ at ${STARS[2]}%`;
    $('capnote').hidden = !!S.hinted[L.id];
  }

  function renderFeats() {
    $('ftb').innerHTML = ev.rows.map(r => {
      const f = F[r.k], c = r.score >= 85 ? 'good' : r.score >= 50 ? 'warn' : 'bad';
      const tg = r.k === 'shape' ? '0' : fmt(r.target, f.d);
      return `<tr><td>${f.label}${f.unit ? ` <span style="color:var(--muted)">(${f.unit})</span>` : ''}</td>
        <td class="num">${fmt(r.you, f.d)}</td><td class="num tg">${tg}</td>
        <td><div class="bar" title="${Math.round(r.score)}%"><i style="width:${r.score}%;background:var(--${c})"></i></div></td></tr>`;
    }).join('');
  }

  function renderDebrief() {
    const el = $('debrief'), got = S.stars[L.id] || 0;
    if (!got) {
      el.innerHTML = `<div class="eyebrow">Lab notebook</div><h3>Notes locked</h3>
        <p class="locked">Reach ${STARS[0]}% match to read what this recording teaches and to compare your channel mix with the original model.</p>`;
      el.dataset.state = 'locked'; return;
    }
    const rows = L.tools.map(t => {
      const sc = t.scale || 1, a = p[t.k] * sc, b = L.target[t.k] * sc, r = p[t.k] / L.target[t.k];
      return `<tr><td>${t.name}</td><td>${sig(b)}</td><td>${sig(a)}</td><td>${r.toFixed(2)}×</td></tr>`;
    }).join('');
    const next = idx + 1 < LEVELS.length ? `<button class="btn primary" id="next" type="button">Next: ${LEVELS[idx + 1].name}</button>` : '<p><b>That was the last level.</b> Try going back for three stars on every level, or look for a second, different channel mix that matches the same recording.</p>';
    const key = L.id + got + next;
    if (el.dataset.state === key) { const tb = el.querySelector('tbody'); if (tb) tb.innerHTML = rows; return; }
    el.dataset.state = key;
    el.innerHTML = `<div class="eyebrow">Lab notebook · ${L.ref}</div><h3>What this recording teaches</h3>
      <p>${L.debrief}</p>
      <div class="tscroll"><table class="cmp"><thead><tr><th>${L.id === 'potassium' ? 'Concentration' : 'Channel'}</th><th>Original model</th><th>Yours</th><th>Ratio</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p><button class="lensbtn" id="lensEnd" type="button">${document.getElementById('lensOpen').innerHTML.replace('Magnifying lens', 'Replay your cell under the magnifying lens')}</button></p>
      ${next}`;
    $('lensEnd').onclick = () => { $('lensUnit').textContent = L.units.cur; LENS_UI.open(L, p); };
    const nb = $('next'); if (nb) nb.onclick = () => { loadLevel(idx + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  }

  // ---- drawing ----
  function setupCanvas(cv, h) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth;
    if (h) cv.style.height = h + 'px';
    const hh = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: hh };
  }
  function drawScope() {
    const cv = $('cv'); const { ctx, w, h } = setupCanvas(cv);
    const v = L.view, ml = 46, mr = 10, mt = 8, mb = 40;
    const X = t => ml + (t - v.x[0]) / (v.x[1] - v.x[0]) * (w - ml - mr);
    const Y = V => mt + (v.y[1] - V) / (v.y[1] - v.y[0]) * (h - mt - mb);
    ctx.clearRect(0, 0, w, h);
    // ECG-paper grid
    ctx.lineWidth = 1;
    for (const [step, col] of [[v.xt / 5, 'grid-minor'], [v.xt, 'grid-major']]) {
      ctx.strokeStyle = css(col); ctx.beginPath();
      for (let t = v.x[0]; t <= v.x[1] + 1e-9; t += step) { const x = Math.round(X(t)) + .5; ctx.moveTo(x, mt); ctx.lineTo(x, h - mb); }
      ctx.stroke();
    }
    for (const [step, col] of [[v.yt / 4, 'grid-minor'], [v.yt, 'grid-major']]) {
      ctx.strokeStyle = css(col); ctx.beginPath();
      for (let V = Math.ceil(v.y[0] / step) * step; V <= v.y[1] + 1e-9; V += step) { const y = Math.round(Y(V)) + .5; ctx.moveTo(ml, y); ctx.lineTo(w - mr, y); }
      ctx.stroke();
    }
    // axes labels
    ctx.fillStyle = css('muted'); ctx.font = `11px ${css('f-mono')}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let V = Math.ceil(v.y[0] / v.yt) * v.yt; V <= v.y[1]; V += v.yt) ctx.fillText(V, ml - 6, Y(V));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lbStep = (w < 480 && (v.x[1] - v.x[0]) / v.xt > 6) ? v.xt * 2 : v.xt;
    for (let t = v.x[0]; t <= v.x[1] + 1e-9; t += lbStep) {
      const last = t + lbStep > v.x[1] + 1e-9;
      ctx.textAlign = last ? 'right' : 'center'; ctx.fillText(last ? t + ' ms' : t, last ? w - mr : X(t), h - mb + 18);
    }
    ctx.textAlign = 'left'; ctx.fillText('mV', 4, mt - 2 < 0 ? 0 : mt - 2);
    // 0 mV line
    ctx.strokeStyle = css('grid-major'); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(ml, Y(0) + .5); ctx.lineTo(w - mr, Y(0) + .5); ctx.stroke(); ctx.setLineDash([]);
    // stimulus strip
    let smax = 0; for (const s of T.stim) smax = Math.max(smax, Math.abs(s));
    const sy = h - mb + 8;
    ctx.strokeStyle = css('accent'); ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < T.t.length; i++) { const x = X(T.t[i]), y = sy - (smax ? T.stim[i] / smax : 0) * 5; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    // traces
    ctx.save(); ctx.beginPath(); ctx.rect(ml, mt, w - ml - mr, h - mt - mb); ctx.clip();
    const line = (t, V, col, wdt, dash) => {
      ctx.strokeStyle = css(col); ctx.lineWidth = wdt; ctx.setLineDash(dash || []); ctx.lineJoin = 'round'; ctx.beginPath();
      for (let i = 0; i < t.length; i++) { const x = X(t[i]), y = Y(V[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    line(T.t, Tdisp, 'target', 2.5, [6, 4]);
    line(R.t, R.V, 'you', 2);
    ctx.restore();
  }
  function drawCurrents() {
    const cv = $('ci'), names = L.currents, sh = 44;
    const { ctx, w, h } = setupCanvas(cv, names.length * sh + 4);
    const v = L.view, ml = 112, mr = 10;
    const X = t => ml + (t - v.x[0]) / (v.x[1] - v.x[0]) * (w - ml - mr);
    ctx.clearRect(0, 0, w, h);
    names.forEach((n, k) => {
      const I = R.I[n]; let mx = 0; for (const x of I) mx = Math.max(mx, Math.abs(x));
      if (!curScale[n] || mx > curScale[n]) curScale[n] = Math.max(mx * 1.15, 1e-3);
      const sc = curScale[n], y0 = k * sh + sh / 2 + 2, half = sh / 2 - 4;
      ctx.strokeStyle = css('line'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ml, Math.round(y0) + .5); ctx.lineTo(w - mr, Math.round(y0) + .5); ctx.stroke();
      // label: I + subscript
      const col = css(CUR_COL[n] || 'muted');
      ctx.fillStyle = col; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.font = `700 14px ${css('f-body')}`; ctx.fillText('I', 4, y0 - 2);
      ctx.font = `700 10px ${css('f-body')}`; ctx.fillText(n.slice(1), 9, y0 + 1);
      ctx.fillStyle = css('muted'); ctx.font = `10px ${css('f-mono')}`; ctx.fillText('±' + sig(sc), 44, y0 - 2);
      ctx.font = `10.5px ${css('f-body')}`; ctx.fillText(CUR_NAME[n] || '', 4, y0 + 13);
      ctx.save(); ctx.beginPath(); ctx.rect(ml, y0 - half - 1, w - ml - mr, 2 * half + 2); ctx.clip();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i < I.length; i++) { const x = X(R.t[i]), y = y0 + I[i] / sc * half; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke(); ctx.restore();
    });
  }

  // ---- assistant ----
  function assist() {
    const btn = $('hint'); btn.disabled = true; btn.textContent = 'Testing channels…';
    setTimeout(() => {
      const base = ev.score; let best = null;
      for (const t of L.tools) for (const f of [1.3, 2, 4, 1 / 1.3, 0.5, 0.25]) {
        let v = p[t.k] * f;
        if (t.lin) { const fr = { 1.3: .06, 2: .15, 4: .3 }[f >= 1 ? f : +(1 / f).toFixed(1)] || .06; v = p[t.k] + (f > 1 ? 1 : -1) * fr * (t.max - t.min); }
        v = Math.min(t.max, Math.max(t.min, v)); if (Math.abs(v - p[t.k]) < 1e-12) continue;
        const q = Object.assign({}, p, { [t.k]: v }); const e = evaluate(L, L.sim(q), T);
        // prefer the gentler step unless a bigger one is clearly better
        if (!best || e.score > best.e.score + 1) best = { t, up: v > p[t.k], e, f: v / p[t.k] };
      }
      S.hinted[L.id] = true; save();
      const box = $('assist'); box.hidden = false;
      if (!best || best.e.score - base < 0.5) {
        box.innerHTML = `No single small change helps right now. You may be in a local optimum: try a larger move on one channel and then re-balance the others. Check which feature bars are still red.`;
      } else {
        let gain = null; best.e.rows.forEach((r, i) => { const d = r.score - ev.rows[i].score; if (!gain || d > gain.d) gain = { d, k: r.k }; });
        box.innerHTML = `<b>${best.up ? 'Raise' : 'Lower'} ${best.t.name}</b> <span style="color:var(--muted)">(${best.t.gene})</span>. ${(() => { const r = best.f >= 1 ? best.f : 1 / best.f; return r > 3 ? 'A big change (about ' + r.toFixed(0) + '×)' : r > 1.6 ? 'Roughly ' + (best.up ? 'doubling' : 'halving') + ' it' : 'A small nudge (about 30%)'; })()} alone takes the match from ${Math.floor(base)}% to ${Math.floor(best.e.score)}%, mostly by improving <i>${F[gain.k].label.toLowerCase()}</i>.`;
      }
      btn.disabled = false; btn.textContent = 'Ask the lab assistant'; renderScore();
    }, 30);
  }

  // ---- level loading ----
  function loadLevel(i) {
    idx = i; L = LEVELS[i]; S.last = i; save();
    p = Object.assign({}, S.params[L.id] || L.start);
    T = L.sim(L.target);
    let span = 0; for (const x of T.V) span = Math.max(span, x); span -= Math.min(...T.V);
    Tdisp = noisy(T.V, span * 0.004 + 0.15);
    curScale = {};
    R = L.sim(L.start); for (const n of L.currents) { let mx = 0; for (const x of R.I[n]) mx = Math.max(mx, Math.abs(x)); curScale[n] = Math.max(mx * 1.15, 1e-3); }
    $('assist').hidden = true; $('debrief').dataset.state = '';
    renderLevels(); renderBrief(); renderTools(); run();
  }

  // ---- misc ----
  let tt;
  function toast(html) { const el = $('toast'); el.innerHTML = html; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2600); }
  $('reset').onclick = () => { p = Object.assign({}, L.start); renderTools(); $('assist').hidden = true; run(); };
  $('hint').onclick = assist;
  LENS_UI.init();
  $('lensOpen').onclick = () => { $('lensUnit').textContent = L.units.cur; LENS_UI.open(L, p); };
  $('unlockAll').onclick = () => { S.unlockAll = true; save(); renderLevels(); toast('All levels unlocked'); };
  $('wipe').onclick = function () {
    if (this.dataset.armed) { S = blank(); save(); this.textContent = 'Reset all progress'; delete this.dataset.armed; loadLevel(0); toast('Progress cleared'); }
    else { this.dataset.armed = '1'; this.textContent = 'Click again to erase all stars'; setTimeout(() => { delete this.dataset.armed; this.textContent = 'Reset all progress'; }, 4000); }
  };
  const redraw = () => { if (R) { drawScope(); drawCurrents(); } };
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(redraw, 80); });
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw); } catch (e) {}
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);

  function start(data) {
    if (data && data.S) S = Object.assign(blank(), data.S);
    let i = (data && typeof data.idx === 'number') ? data.idx : (S.last || 0);
    if (!unlocked(i)) i = 0;
    loadLevel(i);
  }
  window.claude?.hot?.snapshot?.(() => ({ S, idx }));
  window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
})();
