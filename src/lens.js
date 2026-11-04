// ===== Magnifying lens: slow-motion membrane view ========================
const LENS_UI = (() => {
  const $ = id => document.getElementById(id);
  // Resolved CSS variables are cached for the duration of one draw(): theme changes always land between frames.
  const cssCache = new Map();
  const css = n => { let v = cssCache.get(n); if (v === undefined) { v = getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim(); cssCache.set(n, v); } return v; };
  const ION = { INa: 'na', ICaL: 'ca', IT: 'ca', IL: 'lk' }; // everything else carries K⁺
  const CH_COL = CORE.CH_COL;
  const E_PER_PA = 6.2415e6, TRAVEL = 1.0, MAXP = 2600, DOTS_TARGET = 500, DENS = [1, 0.2, 0.05];

  let L, p, R, conc, open = false, playing = true, dir = 1, tm = 0, speedIdx = 1, auto = true;
  let events = [], evCur = -2, stepMs = 0.1, tEnd = 1, scrubbing = false;
  const EV_COL = { stim: 'accent', v: 'you', phase: 'ink', conc: 'c-ca', level: 'gold' };
  const evColor = e => e.kind === 'ch' ? (CH_COL[e.ch] || 'muted') : (EV_COL[e.kind] || 'muted');
  // ---- gate thresholds: where each gate's steady-state curve crosses one half ----
  const LV_MR = 60; // right margin of the V(t) plot, room for the threshold labels
  let gated = [];
  function halfV(GC, arr, rising) {
    for (let k = 1; k < arr.length; k++) if (rising ? (arr[k - 1] < .5 && arr[k] >= .5) : (arr[k - 1] > .5 && arr[k] <= .5))
      return GC.V[k - 1] + (GC.V[k] - GC.V[k - 1]) * (.5 - arr[k - 1]) / (arr[k] - arr[k - 1]);
    return NaN;
  }
  function buildGates() {
    gated = R.G && R.GC ? L.currents.filter(c => R.G[c] && R.GC.ch[c]).map(c => {
      const g = R.GC.ch[c]; return { c, vA: halfV(R.GC, g.A, true), vH: g.H ? halfV(R.GC, g.H, false) : NaN };
    }) : [];
    for (const id of ['lgHead', 'lgNote', 'lg', 'lk', 'lkNote']) $(id).hidden = !gated.length;
  }
  // ---- ion buckets: absolute concentration inside the cell, with a zoom tube for the tiny change ----
  let buckets = [];
  function buildBuckets() {
    buckets = (L.lens.buckets ? L.lens.buckets(R) : []).map(b => {
      const f = b.unit === 'µM' ? 1000 : 1, base = b.data[0] * f; let mx = -Infinity, dev = 0;
      for (const x of b.data) { mx = Math.max(mx, x * f); dev = Math.max(dev, Math.abs(x * f - base)); }
      const full = b.ion === 'ca' ? mx * 1.25 : Math.max(base, mx) * 1.5, rad = Math.max(dev * 1.25, full * 1e-9);
      return Object.assign(b, { f, base, full, rad, zoom: full / (2 * rad), dec: Math.max(0, Math.min(6, 2 - Math.floor(Math.log10(Math.max(dev, 1e-12))))) });
    });
    $('lb').hidden = !buckets.length;
  }
  // Each bucket sits under the channel(s) that carry its ion: the mean column of those channels is its anchor, and buckets
  // that would overlap are packed side by side around their anchors. Falls back to a wrapped grid when there is no room.
  // two significant digits; powers of ten for very small numbers
  const sig2 = x => { if (!(x > 0)) return '0'; const e = Math.floor(Math.log10(x)); if (e >= -3) return x.toFixed(Math.max(0, 1 - e));
    return `${(x / 10 ** e).toFixed(1)}×10${String(e).split('').map(ch => SUP[ch]).join('')}`; };
  const BW = 104, BH = 138;
  function placeBuckets(w) {
    const colW = w / L.currents.length, ionOf = c => ION[c] || 'k';
    const items = buckets.map((b, k) => {
      let cs = L.currents.filter(c => !isPump(c) && c !== 'IL' && ionOf(c) === b.ion);
      if (!cs.length) cs = L.currents.filter(c => ionOf(c) === b.ion || isPump(c));
      const xs = cs.map(c => (L.currents.indexOf(c) + .5) * colW);
      return { b, k, a: xs.length ? xs.reduce((p, q) => p + q) / xs.length : w / 2 };
    }).sort((p, q) => p.a - q.a || p.k - q.k);
    if (items.length * BW > w) return null;
    let cl = [];
    for (const it of items) { cl.push({ its: [it], L: it.a });
      while (cl.length > 1) { const a = cl[cl.length - 2], b = cl[cl.length - 1];
        if (a.L + a.its.length * BW <= b.L) break;
        const its = a.its.concat(b.its); cl.splice(cl.length - 2, 2, { its, L: its.reduce((p, q, k) => p + q.a - k * BW, 0) / its.length }); } }
    let edge = BW / 2; for (const c of cl) { c.L = Math.max(c.L, edge); edge = c.L + c.its.length * BW; }
    let over = edge - BW / 2 - w; if (over > 0) for (let n = cl.length - 1; n >= 0; n--) { cl[n].L -= over; if (n) over = Math.max(0, cl[n - 1].L + cl[n - 1].its.length * BW - cl[n].L); else cl[0].L = Math.max(cl[0].L, BW / 2); }
    const pos = []; for (const c of cl) c.its.forEach((it, k) => { pos[it.k] = { x: c.L + k * BW, y: 0 }; });
    return pos;
  }
  function drawBuckets(i) {
    const cv = $('lb'); if (!buckets.length) return;
    const w0 = cv.clientWidth || 600; let pos = placeBuckets(w0), rows = 1;
    if (!pos) { const cols = Math.max(1, Math.min(buckets.length, Math.floor(w0 / BW))); rows = Math.ceil(buckets.length / cols);
      pos = buckets.map((_, n) => ({ x: (n % cols + .5) * (w0 / cols), y: Math.floor(n / cols) * BH })); }
    const { ctx, w, h } = sizeCanvas(cv, rows * BH); ctx.clearRect(0, 0, w, h);
    buckets.forEach((b, n) => {
      const xc = pos[n].x, cy = pos[n].y + 6, col = css('ion-' + b.ion), H = 66, bw = 46, bb = 36, bt = cy + 16, yb = bt + H;
      const cx = xc - bw / 2 - 6;
      const v = b.data[i] * b.f, frac = Math.max(0, Math.min(1, v / b.full)), f0 = Math.max(0, Math.min(1, b.base / b.full)), yl = yb - frac * H;
      const outline = () => { ctx.beginPath(); ctx.moveTo(cx, bt); ctx.lineTo(cx + (bw - bb) / 2, yb); ctx.lineTo(cx + (bw + bb) / 2, yb); ctx.lineTo(cx + bw, bt); };
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = col; ctx.font = `700 11.5px ${css('f-body')}`; ctx.fillText(b.label, xc, cy);
      ctx.save(); outline(); ctx.closePath(); ctx.clip(); ctx.fillStyle = col; ctx.globalAlpha = .5; ctx.fillRect(cx - 2, yl, bw + 4, yb - yl + 2);
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 2, yl); ctx.lineTo(cx + bw + 2, yl); ctx.stroke(); ctx.restore();
      const y0 = yb - f0 * H; ctx.strokeStyle = css('ink'); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(cx - 4, y0); ctx.lineTo(cx + bw + 4, y0); ctx.stroke(); ctx.setLineDash([]);
      outline(); ctx.strokeStyle = css('ink'); ctx.lineWidth = 2; ctx.stroke();
      // zoom tube: centre = starting level, full height = ±rad
      const tx = cx + bw + 8, tw = 8, ym = bt + H / 2, dy = Math.max(-H / 2, Math.min(H / 2, -(v - b.base) / (2 * b.rad) * H));
      ctx.strokeStyle = css('line'); ctx.lineWidth = 1; ctx.strokeRect(tx + .5, bt + .5, tw, H);
      ctx.fillStyle = col; ctx.globalAlpha = .55; ctx.fillRect(tx + 1, Math.min(ym, ym + dy), tw - 1, Math.abs(dy)); ctx.globalAlpha = 1;
      ctx.strokeStyle = css('ink'); ctx.beginPath(); ctx.moveTo(tx - 2, ym + .5); ctx.lineTo(tx + tw + 2, ym + .5); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(tx + tw / 2 + .5, ym + dy, 3.2, 0, 7); ctx.fill();
      // numbers
      const d = v - b.base;
      ctx.textAlign = 'center'; ctx.fillStyle = css('ink'); ctx.font = `700 11.5px ${css('f-mono')}`; ctx.fillText(`${Number(v.toPrecision(4))} ${b.unit}`, xc, yb + 5);
      ctx.fillStyle = css('muted'); ctx.font = `10.5px ${css('f-mono')}`; ctx.fillText(`Δ ${d >= 0 ? '+' : '−'}${sig2(Math.abs(d))}`, xc, yb + 20);
      ctx.font = `9.5px ${css('f-mono')}`; ctx.fillText(b.zoom < 1000 ? `tube ×${Math.round(b.zoom)}` : `tube ${sci(b.zoom, 0)}`, xc, yb + 34);
    });
  }
  let parts = [], acc = {}, phase = {}, raf = 0, last = 0, dvmax = 1, lastFocus = null, NPER = 1, NBASE = 1, densIdx = 1, slow = 1;

  function sizeCanvas(cv, h) {
    const dpr = window.devicePixelRatio || 1; if (h) cv.style.height = h + 'px';
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h: hh };
  }
  const idxAt = t => Math.max(0, Math.min(R.t.length - 1, Math.round(t / (R.t[1] - R.t[0]))));
  // ---- physiological flux bookkeeping ----
  // Channels: ions/s = |I| / (z·e). Pump: 1 net charge per cycle (3 Na⁺ out, 2 K⁺ in). NCX: 1 net charge per cycle (3 Na⁺ ⇄ 1 Ca²⁺).
  const isPump = c => c === 'INaK' || c === 'INaCa';
  const zOf = c => (ION[c] === 'ca') ? 2 : 1;
  const ionsPerS = (c, I) => Math.abs(I) * L.lens.pA * E_PER_PA * (isPump(c) ? (c === 'INaK' ? 5 : 4) : 1 / zOf(c));
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sci = (x, d = 1) => { if (!(x > 0)) return '0'; const e = Math.floor(Math.log10(x)), m = x / 10 ** e;
    if (e < 3) return x.toFixed(0); return `${m.toFixed(d)}×10${String(e).split('').map(ch => SUP[ch]).join('')}`; };
  const nice = x => { const e = Math.floor(Math.log10(x)), m = x / 10 ** e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * 10 ** e; };
  const short = c => CORE.chName(L, c);
  const sig = x => { const a = Math.abs(x); return a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : a >= 1 ? x.toFixed(2) : x.toFixed(3); };

  function openLens(level, params) {
    L = level; p = Object.assign({}, params);
    R = L.lens.sim(p); conc = L.lens.conc(R);
    { // ions represented by one dot: largest per-channel total over the trace → about DOTS_TARGET dots
      const dts = (R.t[1] - R.t[0]) / 1000; let mx = 0;
      for (const c of L.currents) { let tot = 0; for (const x of R.I[c]) tot += ionsPerS(c, x) * dts; mx = Math.max(mx, tot); }
      NBASE = nice(Math.max(1, mx / DOTS_TARGET)); densIdx = 1; NPER = Math.max(1, NBASE * DENS[densIdx]);
    }
    dvmax = 0; for (let i = 1; i < R.V.length; i++) dvmax = Math.max(dvmax, Math.abs(R.V[i] - R.V[i - 1]) / (R.t[i] - R.t[i - 1]));
    buildGates(); buildBuckets();
    tm = 0; parts = []; acc = {}; phase = {}; playing = true; dir = 1; speedIdx = 1;
    tEnd = R.t[R.t.length - 1];
    stepMs = Math.max(R.t[1] - R.t[0], tEnd / 3000);
    events = CORE.lensEvents(L, R, p); evCur = -2;
    const sc = $('lensScrub'); sc.min = 0; sc.max = tEnd; sc.step = R.t[1] - R.t[0]; sc.value = 0;
    $('lensTitle').textContent = L.name;
    $('lensNote').textContent = L.lens.note;
    renderSpeeds(); renderEvents(); updateButtons();
    lastFocus = document.activeElement;
    $('lens').hidden = false; document.body.style.overflow = 'hidden'; open = true;
    $('lensClose').focus();
    last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function closeLens() {
    closePops();
    open = false; cancelAnimationFrame(raf); $('lens').hidden = true; document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function renderSpeeds() {
    const box = $('lensSpeeds'); box.innerHTML = '';
    L.lens.speeds.forEach((s, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', i === speedIdx);
      b.textContent = `${s} ms/s`; b.title = `${s} ms of cell time per second of screen time`;
      b.onclick = () => { speedIdx = i; renderSpeeds(); }; box.appendChild(b);
    });
    const dbox = $('lensDens'); dbox.innerHTML = '';
    DENS.forEach((f, i) => {
      const n = Math.max(1, NBASE * f), b = document.createElement('button'); b.type = 'button'; b.className = 'chip';
      b.setAttribute('aria-pressed', i === densIdx); b.textContent = `1 dot = ${sci(n, 0)}`; b.title = `Each dot stands for ${sci(n, 0)} ions`;
      b.onclick = () => { densIdx = i; NPER = n; acc = {}; renderSpeeds(); }; dbox.appendChild(b);
    });
  }

  // ---- particles ----
  function spawn(x0, dir, ion) { // dir: +1 inward (out→in), −1 outward
    parts.push({ x0, jx1: (Math.random() - .5) * 26, jx2: (Math.random() - .5) * 26, s: 0, dir, ion });
  }
  function frame(now) {
    if (!open) return;
    const dtw = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; // rAF stamps can precede the open time
    const i = idxAt(tm);
    const base = L.lens.speeds[speedIdx]; let sp = base;
    if (playing) {
      const i2 = Math.min(R.V.length - 1, i + 1);
      const dv = Math.abs(R.V[i2] - R.V[i]) / ((R.t[1] - R.t[0]) || 1);
      if (auto) sp = base / (1 + 30 * dv / dvmax);
      tm += dir * sp * dtw;
      if (tm > tEnd) tm = 0;
      if (tm < 0) { tm = 0; playing = false; updateButtons(); }
    }
    // spawn: dots per screen-second = ions/s × (cell seconds per screen second) / ions-per-dot.
    // When paused, time is frozen but ions keep flowing at the instantaneous rate, shown at the selected speed.
    slow = 1000 / sp;
    const k = (sp / 1000) * dtw / NPER;
    for (const c of L.currents) {
      const I = R.I[c][i];
      if (isPump(c)) {
        const cyc = Math.abs(I) * L.lens.pA * E_PER_PA * k; // units of NPER cycles
        phase[c] = (phase[c] || 0) + Math.min(cyc, 400); acc['spin' + c] = (acc['spin' + c] || 0) + Math.min(cyc, 0.25);
        while (phase[c] >= 1) {
          phase[c] -= 1;
          if (c === 'INaK') { for (let n = 0; n < 3; n++) spawn(c, -1, 'na'); for (let n = 0; n < 2; n++) spawn(c, +1, 'k'); }
          else { const fwd = I < 0; for (let n = 0; n < 3; n++) spawn(c, fwd ? 1 : -1, 'na'); spawn(c, fwd ? -1 : 1, 'ca'); }
        }
      } else {
        acc[c] = (acc[c] || 0) + Math.min(ionsPerS(c, I) * k, 1500);
        while (acc[c] >= 1) { acc[c] -= 1; spawn(c, I < 0 ? 1 : -1, ION[c] || 'k'); }
      }
    }
    for (const q of parts) q.s += dtw / TRAVEL;
    let w = 0; for (const q of parts) if (q.s < 1) parts[w++] = q;
    parts.length = w;
    if (w > MAXP) parts.splice(0, w - MAXP);
    if (!scrubbing) $('lensScrub').value = tm;
    updateEvent();
    draw();
    raf = requestAnimationFrame(frame);
  }

  // ---- events: caption, list, navigation ----
  const curEventIdx = () => { let k = -1; for (let j = 0; j < events.length; j++) if (events[j].t <= tm + 1e-6) k = j; return k; };
  function renderEvents() {
    const box = $('lensEvents'); box.innerHTML = '';
    events.forEach((e, j) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'evchip'; b.dataset.j = j;
      b.style.setProperty('--ec', `var(--${evColor(e)})`);
      b.innerHTML = `<span class="et">${fmtT(e.t)}</span>${e.label}`;
      b.title = e.detail || e.label;
      b.onclick = () => jump(e.t, true); box.appendChild(b);
    });
  }
  const fmtT = x => `${x.toFixed(tEnd < 50 ? 2 : x < 20 ? 1 : 0)} ms`;
  function updateEvent() {
    const k = curEventIdx(); if (k === evCur) return; evCur = k;
    const cap = $('lensEvent');
    cap.setAttribute('aria-live', playing ? 'off' : 'polite');
    if (k < 0) { cap.style.setProperty('--ec', 'var(--line)'); cap.innerHTML = '<span class="et">—</span><span class="elines"><span class="eline"><b>Before the first event.</b> Press play, scrub the timeline, or pick an event below.</span></span>'; }
    else {
      // every event at this instant (several can coincide, e.g. upstroke and channel openings)
      const grp = events.map((e, j) => [e, j]).filter(([e]) => Math.abs(e.t - events[k].t) < 1e-6);
      cap.style.setProperty('--ec', `var(--${evColor(grp[grp.length - 1][0])})`);
      cap.innerHTML = `<span class="et">${fmtT(events[k].t)}</span><span class="elines">` + grp.map(([e]) =>
        `<span class="eline"><i style="background:var(--${evColor(e)})"></i><b>${e.label}</b>${e.detail ? ` <span class="ed">${e.detail}</span>` : ''}</span>`).join('') + '</span>';
    }
    const box = $('lensEvents'), tk = k >= 0 ? events[k].t : NaN;
    box.querySelectorAll('.evchip').forEach(b => b.setAttribute('aria-current', Math.abs(events[+b.dataset.j].t - tk) < 1e-6 ? 'true' : 'false'));
    const cur = box.querySelector(`.evchip[data-j="${k}"]`);
    if (cur) { const l = cur.offsetLeft - box.offsetLeft, r = l + cur.offsetWidth; if (l < box.scrollLeft || r > box.scrollLeft + box.clientWidth) box.scrollLeft = l - 24; }
  }
  function jump(t, pause) {
    const big = Math.abs(t - tm) > 0.05 * tEnd;
    tm = Math.max(0, Math.min(tEnd, t)); if (big) parts = [];
    if (pause) { playing = false; updateButtons(); }
    evCur = -2;
  }
  function stepEvent(d) {
    if (d > 0) { const e = events.find(x => x.t > tm + 1e-6); if (e) jump(e.t, true); }
    else { const prev = events.filter(x => x.t < tm - 1e-6); jump(prev.length ? prev[prev.length - 1].t : 0, true); }
  }
  function updateButtons() {
    $('lensPlay').textContent = playing && dir > 0 ? 'Pause' : 'Play ▸';
    $('lensRev').textContent = playing && dir < 0 ? 'Pause' : '◂ Play back';
    $('lensPlay').setAttribute('aria-pressed', playing && dir > 0);
    $('lensRev').setAttribute('aria-pressed', playing && dir < 0);
    evCur = -2;
  }

  // ---- drawing ----
  let lastRead = '', lastScale = '';
  function draw() {
    cssCache.clear();
    const i = idxAt(tm), V = R.V[i];
    const { ctx, w, h } = sizeCanvas($('lm'));
    const n = L.currents.length, colW = w / n;
    const bandT = Math.round(h * 0.42), bandB = bandT + 34, yTop = 42, yBot = h - 72;
    const xs = {}; L.currents.forEach((c, k) => { xs[c] = (k + 0.5) * colW; });
    const xOf = c => xs[c];
    ctx.clearRect(0, 0, w, h);
    // compartments
    ctx.fillStyle = css('paper'); ctx.fillRect(0, 0, w, bandT);
    ctx.fillStyle = css('panel'); ctx.fillRect(0, bandB, w, h - bandB);
    ctx.save(); ctx.globalAlpha = Math.min(0.28, Math.abs(V) / 100 * 0.28);
    ctx.fillStyle = V < 0 ? css('you') : css('accent'); ctx.fillRect(0, bandB, w, h - bandB); ctx.restore();
    // region labels
    const ions = L.lens.ions(p, R, i);
    ctx.fillStyle = css('muted'); ctx.font = `10.5px ${css('f-mono')}`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText('OUTSIDE  ' + ions.out, 8, 6);
    ctx.textBaseline = 'bottom'; ctx.fillText('INSIDE  ' + ions.in, 8, h - 4);
    // bilayer
    const lip = css('line'), head = css('muted');
    ctx.fillStyle = lip; ctx.fillRect(0, bandT, w, bandB - bandT);
    ctx.fillStyle = head; ctx.globalAlpha = .55;
    for (let x = 3; x < w; x += 7) { ctx.beginPath(); ctx.arc(x, bandT + 3, 2.6, 0, 7); ctx.arc(x, bandB - 3, 2.6, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    // membrane charge marks
    const nm = Math.round(Math.min(1, Math.abs(V) / 90) * Math.min(24, w / 30));
    ctx.font = `700 13px ${css('f-mono')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k < nm; k++) {
      const x = (k + 0.5) * w / nm + colW * 0.25;
      ctx.fillStyle = css(V < 0 ? 'accent' : 'you'); ctx.fillText(V < 0 ? '+' : '−', x % w, bandT - 8);
      ctx.fillStyle = css(V < 0 ? 'you' : 'accent'); ctx.fillText(V < 0 ? '−' : '+', x % w, bandB + 8);
    }
    // channels and transporters
    for (const c of L.currents) {
      const x = xOf(c), col = css(CH_COL[c] || 'muted'), I = R.I[c][i];
      ctx.fillStyle = col; ctx.strokeStyle = col;
      if (c === 'INaCa' || c === 'INaK') {
        const r = 14, cy = (bandT + bandB) / 2;
        ctx.beginPath(); ctx.arc(x, cy, r, 0, 7); ctx.fill();
        ctx.save(); ctx.translate(x, cy); ctx.rotate((acc['spin' + c] || 0) * Math.PI * 2 * (c === 'INaK' ? 1 : (I < 0 ? 1 : -1)));
        ctx.strokeStyle = css('panel'); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke();
        ctx.restore();
      } else {
        const Po = R.O && R.O[c] ? Math.max(0, Math.min(1, R.O[c][i])) : 1;
        const gap = 3 + 16 * Math.sqrt(Po), sw = Math.min(14, colW * 0.18);
        const y0 = bandT - 8, hh = bandB - bandT + 16;
        for (const sgn of [-1, 1]) {
          const xx = sgn < 0 ? x - gap / 2 - sw : x + gap / 2;
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(xx, y0, sw, hh, 5) : ctx.rect(xx, y0, sw, hh); ctx.fill();
        }
      }
    }
    // highlight the channel named by the current event
    const ce = evCur >= 0 ? events[evCur] : null;
    if (ce && ce.ch && L.currents.includes(ce.ch)) {
      const x = xOf(ce.ch);
      ctx.strokeStyle = css('accent'); ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - colW * 0.42, bandT - 26, colW * 0.84, bandB - bandT + 52, 10) : ctx.rect(x - colW * 0.42, bandT - 26, colW * 0.84, bandB - bandT + 52); ctx.stroke();
      ctx.setLineDash([]);
    }
    // particles
    for (const q of parts) {
      const x = xOf(q.x0); if (!(x >= 0)) continue;
      const midY = (bandT + bandB) / 2;
      const yA = q.dir > 0 ? yTop : yBot, yB = q.dir > 0 ? yBot : yTop;
      const xA = x + (q.dir > 0 ? q.jx1 : q.jx2), xB = x + (q.dir > 0 ? q.jx2 : q.jx1);
      let px, py;
      if (q.s < 0.5) { const u = q.s / 0.5; px = xA + (x - xA) * u; py = yA + (midY - yA) * u; }
      else { const u = (q.s - 0.5) / 0.5; px = x + (xB - x) * u; py = midY + (yB - midY) * u; }
      ctx.globalAlpha = Math.min(1, Math.min(q.s, 1 - q.s) * 6);
      ctx.fillStyle = css('ion-' + q.ion);
      ctx.beginPath(); ctx.arc(px, py, q.ion === 'ca' ? 3.8 : 3, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // labels on top of the ion streams
    for (const c of L.currents) {
      const x = xOf(c), I = R.I[c][i];
      ctx.fillStyle = css(CH_COL[c] || 'muted'); ctx.font = `700 ${colW < 60 ? 10 : 11.5}px ${css('f-body')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(short(c), x, 22);
      ctx.fillStyle = css('ink'); ctx.font = `${colW < 60 ? 9.5 : 11}px ${css('f-mono')}`;
      ctx.fillText(sci(ionsPerS(c, I)) + '/s', x, h - 64);
      ctx.fillStyle = css('muted');
      ctx.fillText(sig(I), x, h - 51);
      if (R.O && R.O[c]) ctx.fillText('Po ' + R.O[c][i].toFixed(2), x, h - 38);
    }
    // readout
    const read = `t = <b>${tm.toFixed(tm < 100 ? 2 : 1)}</b> ms · V = <b>${V.toFixed(1)}</b> mV`;
    if (read !== lastRead) $('lensRead').innerHTML = lastRead = read;
    const scale = `<b>1 dot = ${sci(NPER, 0)} ions</b> · ${L.lens.scope} · ` +
      (playing ? `time slowed <b>${slow >= 100 ? Math.round(slow).toLocaleString() : slow.toFixed(0)}×</b>${dir < 0 ? ' · playing backwards (ions still move the physical way)' : ''}`
        : `<b>paused</b> · ions keep flowing at the rate of this instant, shown as if slowed ${Math.round(slow).toLocaleString()}×`);
    if (scale !== lastScale) $('lensScale').innerHTML = lastScale = scale;
    drawTrace(i); drawBuckets(i); drawVGates(i); drawGates(i); drawConc(i);
  }

  function drawTrace(i) {
    const cv = $('lv'); const { ctx, w, h } = sizeCanvas(cv);
    const v = (L.lens.view || L.view), ml = 40, mr = LV_MR, mt = 6, mb = 6;
    const X = t => ml + (t - v.x[0]) / (v.x[1] - v.x[0]) * (w - ml - mr);
    const Y = V => mt + (v.y[1] - V) / (v.y[1] - v.y[0]) * (h - mt - mb);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = css('grid-minor'); ctx.lineWidth = 1; ctx.beginPath();
    for (let V = Math.ceil(v.y[0] / 20) * 20; V <= v.y[1]; V += 20) { ctx.moveTo(ml, Math.round(Y(V)) + .5); ctx.lineTo(w - mr, Math.round(Y(V)) + .5); }
    ctx.stroke();
    ctx.fillStyle = css('muted'); ctx.font = `10px ${css('f-mono')}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const V of [v.y[1] - (v.y[1] % 20 || 0), 0, Math.ceil(v.y[0] / 20) * 20]) ctx.fillText(V, ml - 5, Y(V));
    // activation thresholds (half-activation voltage of each gated channel): dashed until V is above, solid after
    { const Vnow = R.V[i], lab = [];
      ctx.font = `700 9.5px ${css('f-body')}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (const g of gated) { if (!(g.vA > v.y[0] && g.vA < v.y[1])) continue;
        const above = Vnow >= g.vA, col = css(CH_COL[g.c] || 'muted'), y = Math.round(Y(g.vA)) + .5;
        ctx.strokeStyle = col; ctx.lineWidth = above ? 1.8 : 1; ctx.globalAlpha = above ? .95 : .6; ctx.setLineDash(above ? [] : [5, 4]);
        ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(w - mr, y); ctx.stroke(); lab.push({ y, col, above, t: short(g.c) }); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      lab.sort((a, b) => a.y - b.y); for (let k = 1; k < lab.length; k++) lab[k].y = Math.max(lab[k].y, lab[k - 1].y + 10);
      for (const l of lab) { ctx.fillStyle = l.col; ctx.fillText((l.above ? '▲ ' : '') + l.t, w - mr + 4, l.y); } }
    ctx.strokeStyle = css('you'); ctx.lineWidth = 1.8; ctx.beginPath();
    for (let k = 0; k < R.t.length; k++) { const x = X(R.t[k]), y = Y(R.V[k]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    events.forEach((e, j) => {
      const ex = Math.round(X(e.t)) + .5, cur = j === evCur;
      ctx.strokeStyle = css(evColor(e)); ctx.lineWidth = cur ? 2.5 : 1.2; ctx.globalAlpha = cur ? 1 : .7;
      ctx.beginPath(); ctx.moveTo(ex, h - mb); ctx.lineTo(ex, h - mb - (cur ? 14 : 7)); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    const x = X(tm);
    ctx.strokeStyle = css('accent'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, h - mb); ctx.stroke();
    ctx.fillStyle = css('accent'); ctx.beginPath(); ctx.arc(x, Y(R.V[i]), 4.5, 0, 7); ctx.fill();
  }

  // ---- gate panel: steady-state curves, current state, and the lag between them ----
  // Per channel: A∞(V) (activation, solid) and H∞(V) (availability, dashed) against V. The vertical line is the present V,
  // the ring is where each gate is heading (steady state at this V), the filled marker is where it is now. The gap between
  // them is the delay; the faint trail is the path (V(t), A(t)) so far, which loops around the curve.
  const curveAt = (arr, v) => { const f = Math.max(0, Math.min(160, v + 100)), k = Math.min(159, Math.floor(f)); return arr[k] + (arr[k + 1] - arr[k]) * (f - k); };
  // Simplified, vertical version under the membrane: same columns as the channels above, V on a shared vertical axis,
  // so the one horizontal line at the present V crosses every activation curve at that channel's own point.
  function drawVGates(i) {
    const cv = $('lk'); if (!gated.length) return;
    const { ctx, w, h } = sizeCanvas(cv, 196), n = L.currents.length, colW = w / n, V = R.V[i], GC = R.GC;
    const top = 16, bot = h - 30, Y = v => top + (60 - v) / 160 * (bot - top);
    ctx.clearRect(0, 0, w, h);
    ctx.font = `9.5px ${css('f-mono')}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (const t of [-80, -40, 0, 40]) { const y = Math.round(Y(t)) + .5;
      ctx.strokeStyle = css(t === 0 ? 'line' : 'grid-minor'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      const lab = String(t).replace('-', '−'), tw = ctx.measureText(lab).width;
      ctx.fillStyle = css('paper'); ctx.globalAlpha = .85; ctx.fillRect(1, y - 14, tw + 4, 11); ctx.globalAlpha = 1;
      ctx.fillStyle = css('muted'); ctx.fillText(lab, 3, y - 6); }
    ctx.fillStyle = css('muted'); ctx.textBaseline = 'top'; ctx.fillText('mV', 3, 2);
    const yv = Y(Math.max(-100, Math.min(60, V)));
    for (const g of gated) {
      const col = css(CH_COL[g.c] || 'muted'), G = R.G[g.c], gc = GC.ch[g.c], cx = (L.currents.indexOf(g.c) + .5) * colW;
      const pw = Math.min(colW * .8, 96), x0 = cx - pw / 2, X = a => x0 + a * pw, above = V >= g.vA;
      ctx.strokeStyle = css('line'); ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, top + .5, pw, bot - top);
      if (isFinite(g.vA)) { ctx.fillStyle = col; ctx.globalAlpha = above ? .16 : .07; ctx.fillRect(x0, top, pw, Y(g.vA) - top); ctx.globalAlpha = 1;
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x0, Math.round(Y(g.vA)) + .5); ctx.lineTo(x0 + pw, Math.round(Y(g.vA)) + .5); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = col; ctx.font = `700 10.5px ${css('f-body')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(short(g.c), cx, 2);
      for (const [arr, dash, lw] of [[gc.A, [], 2.2], [gc.H, [5, 3], 1.5]]) { if (!arr) continue;
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath();
        for (let k = 0; k < arr.length; k++) { const x = X(arr[k]), y = Y(GC.V[k]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      ctx.setLineDash([]);
      const mark = (act, target, sq) => { if (act == null) return; const xa = X(act), xt = X(target);
        if (Math.abs(xa - xt) > 2) { ctx.strokeStyle = css('accent'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xa, yv); ctx.lineTo(xt, yv); ctx.stroke(); }
        ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.fillStyle = css('panel'); ctx.beginPath(); if (sq) ctx.rect(xt - 4, yv - 4, 8, 8); else ctx.arc(xt, yv, 4.5, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); if (sq) ctx.rect(xa - 3, yv - 3, 6, 6); else ctx.arc(xa, yv, 3.5, 0, 7); ctx.fill(); };
      // x axis: 0 = closed (left), 1 = open (right); the dashed curve reads inactivated (left) to available (right)
      ctx.fillStyle = css('muted'); ctx.font = `9.5px ${css('f-mono')}`; ctx.textBaseline = 'top';
      const wide = pw >= 56; // narrow columns (phones) get 0 / 1 instead of words
      ctx.textAlign = 'left'; ctx.fillText(wide ? 'closed' : '0', x0, bot + 3); ctx.textAlign = 'right'; ctx.fillText(wide ? 'open' : '1', x0 + pw, bot + 3);
      if (G.H && pw >= 70) { ctx.textAlign = 'left'; ctx.fillText(pw >= 120 ? 'inactivated' : 'inact.', x0, bot + 15); ctx.textAlign = 'right'; ctx.fillText(pw >= 120 ? 'available' : 'avail.', x0 + pw, bot + 15); }
      ctx.save(); ctx.beginPath(); ctx.rect(x0 - 6, top - 1, pw + 12, bot - top + 2); ctx.clip();
      if (G.H) mark(G.H[i], curveAt(gc.H, V), true); mark(G.A[i], curveAt(gc.A, V), false); ctx.restore();
    }
    // the present membrane potential: one line across every channel
    ctx.strokeStyle = css('accent'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, yv); ctx.lineTo(w, yv); ctx.stroke();
    ctx.fillStyle = css('accent'); ctx.font = `700 10.5px ${css('f-mono')}`; ctx.textAlign = 'right'; ctx.textBaseline = yv < top + 14 ? 'top' : 'bottom';
    ctx.fillText(`V = ${V.toFixed(0)} mV`, w - 4, yv + (yv < top + 14 ? 2 : -2));
  }
  const GCELL = 214, GMIN = 160;
  const gateState = (g, i) => {
    const A = R.G[g.c].A, H = R.G[g.c].H, a = A[i], d = A[Math.min(A.length - 1, i + 2)] - A[Math.max(0, i - 2)];
    if (H && H[i] < 0.2) return ['inactivated', 'muted'];
    if (a < 0.03) return ['closed', 'muted'];
    if (d > 0.002 * Math.max(a, 0.2)) return ['opening', 'accent'];
    if (d < -0.002 * Math.max(a, 0.2)) return ['closing', 'accent'];
    return ['open', 'ink'];
  };
  function drawGates(i) {
    const cv = $('lg'); if (!gated.length) return;
    const w0 = cv.clientWidth || 600, cols = Math.max(1, Math.min(gated.length, Math.floor(w0 / GMIN))), rows = Math.ceil(gated.length / cols);
    const { ctx, w, h } = sizeCanvas(cv, rows * GCELL), cw = w / cols, V = R.V[i], GC = R.GC;
    ctx.clearRect(0, 0, w, h);
    const nlast = Math.min(i, R.V.length - 1), step = Math.max(1, Math.floor(nlast / 500));
    gated.forEach((g, n) => {
      const cx = (n % cols) * cw, cy = Math.floor(n / cols) * GCELL, col = css(CH_COL[g.c] || 'muted');
      const px = cx + 28, pw = cw - 40, py = cy + 22, ph = 62, X = x => px + (x + 100) / 160 * pw, Y = a => py + ph * (1 - a);
      const G = R.G[g.c], at = curveAt;
      const Ai = at(GC.ch[g.c].A, V), Hi = G.H ? at(GC.ch[g.c].H, V) : NaN, above = V >= g.vA;
      // frame, activation zone (to the right of the half-activation voltage), grid
      ctx.strokeStyle = css('line'); ctx.lineWidth = 1; ctx.strokeRect(px + .5, py + .5, pw, ph);
      if (isFinite(g.vA)) { ctx.fillStyle = col; ctx.globalAlpha = above ? .16 : .07; ctx.fillRect(X(g.vA), py, px + pw - X(g.vA), ph); ctx.globalAlpha = 1; }
      ctx.strokeStyle = css('grid-minor'); ctx.beginPath(); ctx.moveTo(px, Y(.5) + .5); ctx.lineTo(px + pw, Y(.5) + .5); ctx.moveTo(X(0) + .5, py); ctx.lineTo(X(0) + .5, py + ph); ctx.stroke();
      // title and state
      const [st, sc] = gateState(g, i);
      ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = col; ctx.font = `700 12px ${css('f-body')}`; ctx.fillText(short(g.c), cx + 4, cy + 3);
      ctx.textAlign = 'right'; ctx.fillStyle = css(sc); ctx.font = `700 10.5px ${css('f-mono')}`; ctx.fillText(st, cx + cw - 10, cy + 5);
      // axes labels
      ctx.fillStyle = css('muted'); ctx.font = `9.5px ${css('f-mono')}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('1', px - 4, py + 2); ctx.fillText('0', px - 4, py + ph - 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; for (const t of [-80, -40, 0, 40]) ctx.fillText(t, X(t), py + ph + 2);
      // trail of (V, A) and (V, H)
      ctx.lineWidth = 1.2; ctx.globalAlpha = .35;
      for (const [arr, dash] of [[G.A, []], [G.H, [3, 3]]]) { if (!arr) continue; ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.beginPath();
        for (let k = 0; k <= nlast; k += step) { const x = X(R.V[k]), y = Y(arr[k]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      // steady-state curves
      for (const [arr, dash, lw] of [[GC.ch[g.c].A, [], 2.2], [GC.ch[g.c].H, [5, 3], 1.6]]) { if (!arr) continue;
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath();
        for (let k = 0; k < arr.length; k++) { const x = X(GC.V[k]), y = Y(arr[k]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      ctx.setLineDash([]);
      // half-activation / half-inactivation marks on the axis
      const tri = (v, filled, dia) => { if (!isFinite(v)) return; const x = X(v), y = py + ph; ctx.beginPath();
        if (dia) { ctx.moveTo(x, y - 3); ctx.lineTo(x + 4, y + 1); ctx.lineTo(x, y + 5); ctx.lineTo(x - 4, y + 1); } else { ctx.moveTo(x, y - 1); ctx.lineTo(x - 4, y + 7); ctx.lineTo(x + 4, y + 7); } ctx.closePath();
        ctx.fillStyle = filled ? col : css('panel'); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke(); };
      tri(g.vA, above, false); tri(g.vH, G.H && isFinite(g.vH) && V >= g.vH, true);
      // present voltage
      const xv = X(Math.max(-100, Math.min(60, V)));
      ctx.strokeStyle = css('accent'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xv, py); ctx.lineTo(xv, py + ph); ctx.stroke();
      // each gate: ring = where it is heading, marker = where it is, link = the lag
      const mark = (arr, target, sq) => { if (!arr) return; const a = arr[i], y = Y(a), yt = Y(target);
        if (Math.abs(y - yt) > 2) { ctx.strokeStyle = css('accent'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xv, y); ctx.lineTo(xv, yt); ctx.stroke(); }
        ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.fillStyle = css('panel'); ctx.beginPath();
        if (sq) ctx.rect(xv - 4, yt - 4, 8, 8); else ctx.arc(xv, yt, 4.5, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); if (sq) ctx.rect(xv - 3, y - 3, 6, 6); else ctx.arc(xv, y, 3.5, 0, 7); ctx.fill(); };
      mark(G.H, Hi, true); mark(G.A, Ai, false);
      // numbers
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = `10.5px ${css('f-mono')}`; ctx.fillStyle = css('ink');
      const f2 = x => x.toFixed(2), vh = v => isFinite(v) ? `${v.toFixed(0)}` : '–';
      ctx.fillText(`act ${f2(G.A[i])} → ${f2(Ai)}   V½ ${vh(g.vA)}`, cx + 4, cy + 99);
      if (G.H) ctx.fillText(`avail ${f2(G.H[i])} → ${f2(Hi)}   V½ ${vh(g.vH)}`, cx + 4, cy + 113);
      // time constants on a log axis: how long each gate takes to follow, at every voltage
      const gc = GC.ch[g.c], tA = gc.tA, tH = gc.tH;
      if (tA || tH) {
        const qy = cy + 146, qh = 40; let lo = Infinity, hi = -Infinity;
        for (const a of [tA, tH]) if (a) for (const x of a) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
        lo = Math.log10(lo) - .15; hi = Math.log10(hi) + .15; if (hi - lo < .6) { const m = (hi + lo) / 2; lo = m - .3; hi = m + .3; }
        const T = x => qy + qh * (1 - (Math.log10(x) - lo) / (hi - lo));
        ctx.strokeStyle = css('line'); ctx.lineWidth = 1; ctx.strokeRect(px + .5, qy + .5, pw, qh);
        ctx.fillStyle = col; ctx.font = `700 10px ${css('f-body')}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('time constant τ (ms, log scale)', cx + 4, qy - 2);
        ctx.fillStyle = css('muted'); ctx.font = `9.5px ${css('f-mono')}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const fT = x => x >= 1 ? x.toFixed(0) : x.toPrecision(1);
        const e0 = Math.ceil(lo + .15), e1 = Math.floor(hi - .15), es = Math.max(1, Math.ceil((e1 - e0 + 1) / 3));
        for (let e = e0; e <= e1; e += es) { const y = Math.round(T(10 ** e)) + .5;
          ctx.strokeStyle = css('grid-minor'); ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke(); ctx.fillText(fT(10 ** e), px - 4, y); }
        ctx.beginPath(); ctx.rect(px, qy, pw, qh); ctx.save(); ctx.clip();
        for (const [arr, dash, lw] of [[tA, [], 2], [tH, [5, 3], 1.5]]) { if (!arr) continue;
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath();
          for (let k = 0; k < arr.length; k++) { const x = X(GC.V[k]), y = T(arr[k]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
        ctx.setLineDash([]); ctx.strokeStyle = css('accent'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xv, qy); ctx.lineTo(xv, qy + qh); ctx.stroke();
        const tnow = [];
        for (const [arr, sq] of [[tH, true], [tA, false]]) { if (!arr) continue; const t = at(arr, V), y = T(t); tnow.push([t, sq]);
          ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.fillStyle = col; ctx.beginPath(); if (sq) ctx.rect(xv - 3, y - 3, 6, 6); else ctx.arc(xv, y, 3.5, 0, 7); ctx.fill(); }
        ctx.restore();
        const ft = t => t >= 100 ? t.toFixed(0) : t >= 10 ? t.toFixed(1) : t.toFixed(2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = `10.5px ${css('f-mono')}`; ctx.fillStyle = css('ink');
        ctx.fillText(`τ act ${tA ? ft(at(tA, V)) : '–'} ms` + (tH ? `   inact ${ft(at(tH, V))} ms` : ''), cx + 4, qy + qh + 4);
      }
    });
  }

  function drawConc(i) {
    const cv = $('lc'), sh = 54; const { ctx, w, h } = sizeCanvas(cv, conc.length * sh);
    const v = (L.lens.view || L.view), ml = 150, mr = 8;
    const X = t => ml + (t - v.x[0]) / (v.x[1] - v.x[0]) * (w - ml - mr);
    ctx.clearRect(0, 0, w, h);
    conc.forEach((c, k) => {
      let lo = Infinity, hi = -Infinity; for (const x of c.data) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (hi - lo < 1e-9) { hi += 1e-3; lo -= 1e-3; }
      const pad = (hi - lo) * 0.12, y0 = k * sh + 6, y1 = (k + 1) * sh - 8;
      const Y = x => y1 - (x - lo + pad) / (hi - lo + 2 * pad) * (y1 - y0);
      ctx.strokeStyle = css('line'); ctx.lineWidth = 1; ctx.strokeRect(ml + .5, y0 + .5, w - ml - mr - 1, y1 - y0);
      const col = css(c.col);
      ctx.fillStyle = col; ctx.font = `700 12.5px ${css('f-body')}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(c.label, 0, y0 + 2);
      ctx.fillStyle = css('ink'); ctx.font = `12px ${css('f-mono')}`;
      ctx.fillText(`${c.data[i].toFixed(c.d)} ${c.unit}`, 0, y0 + 20);
      ctx.fillStyle = css('muted'); ctx.font = `9.5px ${css('f-mono')}`; ctx.textAlign = 'right';
      ctx.fillText(hi.toFixed(c.d), ml - 4, y0); ctx.textBaseline = 'bottom'; ctx.fillText(lo.toFixed(c.d), ml - 4, y1 + 2);
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let j = 0; j < c.data.length; j++) { const x = X(R.t[j]), y = Y(c.data[j]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      const x = X(tm); ctx.strokeStyle = css('accent'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      ctx.fillStyle = css('accent'); ctx.beginPath(); ctx.arc(x, Y(c.data[i]), 3.5, 0, 7); ctx.fill();
    });
  }

  // ---- controls ----
  function scrub(e) {
    const cv = e.currentTarget, r = cv.getBoundingClientRect(), v = (L.lens.view || L.view);
    const ml = cv.id === 'lc' ? 150 : 40, mr = cv.id === 'lc' ? 8 : LV_MR;
    const t = v.x[0] + (e.clientX - r.left - ml) / (r.width - ml - mr) * (v.x[1] - v.x[0]);
    jump(t, true);
  }
  let closePops = () => {};
  function init() {
    $('lensClose').onclick = closeLens;
    closePops = except => document.querySelectorAll('.ibtn').forEach(b => {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false'); $(b.dataset.info).hidden = true;
    });
    document.querySelectorAll('.ibtn').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const n = $(b.dataset.info), on = n.hidden;
        closePops(b);
        n.hidden = !on; b.setAttribute('aria-expanded', on);
      };
    });
    document.addEventListener('click', e => { if (!e.target.closest('.pop')) closePops(); });
    $('lens').addEventListener('click', e => { if (e.target === $('lens')) closeLens(); });
    document.addEventListener('keydown', e => {
      if (!open) return;
      if (e.key === 'Escape') {
        if (document.querySelector('.ibtn[aria-expanded="true"]')) { closePops(); return; }
        closeLens(); return;
      }
      const tag = e.target.tagName, onRange = tag === 'INPUT' && e.target.type === 'range';
      if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'INPUT') { e.preventDefault(); $('lensPlay').click(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !onRange) { e.preventDefault(); jump(tm + (e.key === 'ArrowRight' ? 1 : -1) * stepMs * (e.shiftKey ? 10 : 1), true); }
      else if (e.key === ',' || e.key === '<') { e.preventDefault(); stepEvent(-1); }
      else if (e.key === '.' || e.key === '>') { e.preventDefault(); stepEvent(1); }
      else if (e.key === 'Home') { e.preventDefault(); jump(0, true); }
      else if (e.key === 'End') { e.preventDefault(); jump(tEnd, true); }
    });
    const toggle = d => { if (playing && dir === d) playing = false; else { playing = true; dir = d; if (d > 0 && tm >= tEnd) tm = 0; if (d < 0 && tm <= 0) tm = tEnd; } updateButtons(); };
    $('lensPlay').onclick = () => toggle(1);
    $('lensRev').onclick = () => toggle(-1);
    $('lensBack').onclick = e => jump(tm - stepMs * (e.shiftKey ? 10 : 1), true);
    $('lensFwd').onclick = e => jump(tm + stepMs * (e.shiftKey ? 10 : 1), true);
    $('lensPrev').onclick = () => stepEvent(-1);
    $('lensNext').onclick = () => stepEvent(1);
    $('lensRestart').onclick = () => { tm = 0; parts = []; playing = true; dir = 1; updateButtons(); };
    const sc = $('lensScrub');
    sc.addEventListener('input', () => { scrubbing = true; jump(+sc.value, true); });
    sc.addEventListener('change', () => { scrubbing = false; });
    sc.addEventListener('pointerup', () => { scrubbing = false; });
    $('lensAuto').onchange = e => { auto = e.target.checked; };
    for (const id of ['lv', 'lc']) {
      const cv = $(id); let down = false;
      cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); scrub(e); });
      cv.addEventListener('pointermove', e => { if (down) scrub(e); });
      cv.addEventListener('pointerup', () => { down = false; });
    }
  }
  return { open: openLens, init };
})();
