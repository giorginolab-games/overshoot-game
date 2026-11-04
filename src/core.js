// ===== Levels, features, scoring =========================================
const CORE = (() => {
  const M = (typeof MODELS !== 'undefined') ? MODELS : require('./models.js');

  // steady-state initial conditions for the human ventricular model (30 beats at 1 Hz, reference params)
  const TNNP_SS = { V: -86.2797, Cai: 0.0000686316, Casr: 0.486161, Nai: 11.3013, Ki: 138.2946, m: 0.00137201,
    h: 0.772508, j: 0.763843, xr1: 0.000673665, xr2: 0.482087, xs: 0.00300141, r: 2.029e-8, s: 0.999998,
    d: 0.0000196526, f: 0.988952, fCa: 1.006066, g: 0.999943 };
  const TNNP_REF = { GNa: 14.838, GCaL: 1.75e-4, Gto: 0.294, GKr: 0.096, GKs: 0.245, GK1: 5.405 };

  function crossings(R, thr = 0, from = -Infinity, to = Infinity) {
    const s = [], V = R.V, t = R.t;
    for (let i = 1; i < V.length; i++) if (V[i - 1] < thr && V[i] >= thr && t[i] >= from && t[i] < to) s.push(t[i]);
    return s;
  }
  const at = (R, time) => { const i = Math.min(R.V.length - 1, Math.max(0, Math.round(time / (R.t[1] - R.t[0])))); return R.V[i]; };

  // ---------- feature extractors ----------
  function hhFeatures(R) {
    const V = R.V, t = R.t; let pk = -1e9, ip = 0;
    for (let i = 0; i < V.length; i++) if (V[i] > pk) { pk = V[i]; ip = i; }
    const rest = V[0]; let um = 1e9;
    for (let i = ip; i < V.length; i++) if (V[i] < um) um = V[i];
    const half = (pk + rest) / 2; let w = 0;
    for (let i = 0; i < V.length; i++) if (V[i] > half) w += t[1] - t[0];
    const spiked = pk > 0;
    return { rest, peak: pk, under: spiked ? um : rest, width: spiked ? w : 0, ttp: spiked ? t[ip] - 2 : 0 };
  }
  function rsFeatures(R) {
    const s = crossings(R, 0, 100, 600);
    const isi = s.slice(1).map((x, i) => x - s[i]);
    const adapt = isi.length >= 2 ? isi[isi.length - 1] / isi[0] : 1;
    // spike peaks and troughs
    let peaks = [], troughs = [];
    for (let k = 0; k < s.length; k++) {
      const a = s[k], b = k + 1 < s.length ? s[k + 1] : Math.min(a + 80, 600);
      let pk = -1e9, tr = 1e9;
      for (let i = 0; i < R.t.length; i++) { const tt = R.t[i]; if (tt >= a && tt < a + 3) pk = Math.max(pk, R.V[i]); if (tt > a + 2 && tt < b) tr = Math.min(tr, R.V[i]); }
      peaks.push(pk); if (tr < 1e8) troughs.push(tr);
    }
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
    return { rest: at(R, 90), count: s.length, latency: s.length ? s[0] - 100 : 500,
      adapt, peak: s.length ? mean(peaks) : Math.max(...R.V), trough: troughs.length ? mean(troughs) : at(R, 590) };
  }
  function ltsFeatures(R) {
    const pre = crossings(R, 0, 0, 400), post = crossings(R, 0, 400, 700);
    return { rest: at(R, 90), hyp: at(R, 395), early: pre.length, count: post.length,
      latency: post.length ? post[0] - 400 : 300, dur: post.length > 1 ? post[post.length - 1] - post[0] : 0 };
  }
  function cardFeatures(R) {
    const V = R.V, t = R.t, rest = V[0], pk = R.Vmax;
    let ip = 0; for (let i = 0; i < V.length; i++) if (V[i] > V[ip]) ip = i;
    let mn = 1e9; for (let i = ip; i < V.length && t[i] < t[ip] + 40; i++) mn = Math.min(mn, V[i]);
    let dome = -1e9; for (let i = ip; i < V.length && t[i] < 150; i++) dome = Math.max(dome, V[i]);
    const apd = frac => { const th = pk - (pk - rest) * frac; for (let i = ip; i < V.length; i++) if (V[i] < th) return t[i]; return 600; };
    const spiked = pk > -20;
    return { rest, peak: pk, dvdt: R.dVdtMax, notch: spiked ? Math.max(0, pk - mn) : 0, plateau: at(R, 100),
      apd50: spiked ? apd(0.5) : 0, apd90: spiked ? apd(0.9) : 0 };
  }

  function clampFeatures(R) {
    const { V, early, late } = R.iv; let pk = 0; for (let i = 0; i < early.length; i++) if (early[i] < early[pk]) pk = i;
    let erev = NaN; for (let i = pk; i < early.length - 1; i++) if (early[i] < 0 && early[i + 1] >= 0) { erev = V[i] + (V[i + 1] - V[i]) * (-early[i]) / (early[i + 1] - early[i]); break; }
    if (!isFinite(erev)) erev = early[early.length - 1] < 0 ? 70 : V[0];
    return { peakIn: early[pk], erev, late55: late[V.indexOf(55)], lateM15: late[V.indexOf(-15)] };
  }
  function ecgFeatures(R) {
    const e = R.ecg, t = R.t, n = e.length;
    let qi = 0; for (let i = 0; i < n && t[i] < 80; i++) if (Math.abs(e[i]) > Math.abs(e[qi])) qi = i;
    const qa = e[qi]; let q0 = -1, q1 = -1;
    for (let i = 0; i < n && t[i] < 150; i++) if (Math.abs(e[i]) > 0.1 * Math.abs(qa)) { if (q0 < 0) q0 = i; q1 = i; }
    let ti = -1; for (let i = 0; i < n; i++) if (t[i] > t[q1] + 60 && (ti < 0 || Math.abs(e[i]) > Math.abs(e[ti]))) ti = i;
    let te = ti; for (let i = ti; i < n; i++) if (Math.abs(e[i]) > 0.1 * Math.abs(e[ti])) te = i;
    return { qrsAmp: qa, qrsDur: t[q1] - t[q0], tAmp: e[ti], tPeak: t[ti] - t[q0], qt: t[te] - t[q0], tpte: t[te] - t[ti] };
  }

  // ---------- feature metadata ----------
  const F = {
    rest: { label: 'Resting potential', unit: 'mV', d: 1 },
    peak: { label: 'Peak (overshoot)', unit: 'mV', d: 1 },
    under: { label: 'Undershoot (AHP)', unit: 'mV', d: 1 },
    width: { label: 'Half-width', unit: 'ms', d: 2 },
    ttp: { label: 'Time to peak', unit: 'ms', d: 2 },
    count: { label: 'Spikes in step', unit: '', d: 0 },
    latency: { label: 'First-spike latency', unit: 'ms', d: 1 },
    adapt: { label: 'Adaptation (last/first ISI)', unit: '×', d: 2 },
    trough: { label: 'Interspike trough', unit: 'mV', d: 1 },
    hyp: { label: 'Hyperpolarised level', unit: 'mV', d: 1 },
    early: { label: 'Spikes before release', unit: '', d: 0 },
    dur: { label: 'Burst duration', unit: 'ms', d: 1 },
    dvdt: { label: 'Max upstroke dV/dt', unit: 'V/s', d: 0 },
    notch: { label: 'Phase-1 notch depth', unit: 'mV', d: 1 },
    plateau: { label: 'Plateau at 100 ms', unit: 'mV', d: 1 },
    apd50: { label: 'APD50', unit: 'ms', d: 0 },
    apd90: { label: 'APD90', unit: 'ms', d: 0 },
    shape: { label: 'Waveform RMS error', unit: 'mV', d: 1 },
    qrsAmp: { label: 'QRS amplitude', unit: 'norm.', d: 2 },
    qrsDur: { label: 'QRS duration', unit: 'ms', d: 0 },
    tAmp: { label: 'T-wave amplitude', unit: 'norm.', d: 3 },
    tPeak: { label: 'QRS onset to T peak', unit: 'ms', d: 0 },
    qt: { label: 'QT interval', unit: 'ms', d: 0 },
    tpte: { label: 'T peak to T end', unit: 'ms', d: 0 },
    shapeE: { label: 'ECG RMS error', unit: 'norm.', d: 3 },
    peakIn: { label: 'Peak early inward current', unit: 'mA/cm²', d: 2 },
    erev: { label: 'Early-current reversal', unit: 'mV', d: 1 },
    late55: { label: 'Late current at +55 mV', unit: 'mA/cm²', d: 2 },
    lateM15: { label: 'Late current at −15 mV', unit: 'mA/cm²', d: 2 },
    shapeI: { label: 'Current RMS error', unit: 'mA/cm²', d: 3 },
  };

  // ---------- levels ----------
  // Level definitions live in src/levels/*.json (order: index.json). build.js inlines them as LEVELS_DATA;
  // under Node they are read from disk. JSON holds data only: a level names its simulator ("sim") and
  // feature extractor ("feats") and those are looked up here. "@card" refers to shared.json.
  const cardSim = p => M.tnnp(Object.assign({}, TNNP_REF, p), { beats: 2, init: TNNP_SS, clampNaK: true, T: 600, out: 1 });
  const SIMS = {
    hh: p => M.hh(p),
    hhClamp: p => M.hhClamp(p),
    pyramidal: p => M.cortical(p, { EL: -70, VT: -56.2, tauMax: 1000, T: 800, out: 0.2, currents: ['INa', 'IKd', 'IM', 'IL'], stim: t => (t >= 100 && t < 600) ? 2.5 : 0 }),
    thalamus: p => M.cortical(p, { EL: -75, VT: -50, Vx: 2, T: 700, out: 0.2, currents: ['INa', 'IKd', 'IT', 'IL'], stim: t => (t >= 100 && t < 400) ? -0.5 : 0 }),
    tnnp: cardSim,
    tnnpWall: p => M.tnnpWall(p),
    tnnpWallScaled: q => M.tnnpWallScaled(q),
  };
  const FEATS = { hh: hhFeatures, clamp: clampFeatures, rs: rsFeatures, lts: ltsFeatures, card: cardFeatures, ecg: ecgFeatures };
  const DATA = (typeof LEVELS_DATA !== 'undefined') ? LEVELS_DATA : (() => {
    const fs = require('fs'), path = require('path'), dir = path.join(__dirname, 'levels');
    const rd = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { shared: rd('shared.json'), levels: rd('index.json').map(rd) };
  })();
  const LEVELS = DATA.levels.map(d => {
    const L = Object.assign({}, d), card = DATA.shared.card;
    for (const k of ['tools', 'currents', 'tol']) if (L[k] === '@card') L[k] = card[k];
    if (d.tools === '@card') { // card levels override the reference TNNP parameters
      L.target = Object.assign({}, TNNP_REF, d.target);
      L.start = Object.assign({}, TNNP_REF, d.start);
    }
    L.sim = SIMS[d.sim]; L.feats = FEATS[d.feats];
    if (!L.sim || !L.feats) throw new Error(`level ${d.id}: unknown sim "${d.sim}" or feats "${d.feats}"`);
    return L;
  });

  // ---------- lens (slow-motion membrane view) ----------
  // Lens data is declarative JSON (level.lens, or "@card" / "extends": "@card" -> shared.json lens.card).
  // Δc(t) in µM from cumulative charge: -∫ΣI dt · (S/V) / (zF); I in µA/cm², t in ms, S/V in cm⁻¹
  function dconc(R, names, SV, z) {
    const n = R.t.length, dt = R.t[1] - R.t[0], out = new Float64Array(n); let q = 0;
    for (let i = 0; i < n; i++) { out[i] = -q * SV / (z * 96485.3415) * 1e0; for (const c of names) q += R.I[c][i] * dt; }
    return out; // (µA/cm²·ms = 1e-9 C/cm²) × cm⁻¹ / (C/mol) × 1e9 µM per mol/cm³ → factors cancel
  }
  function caShell(R, depthUm, tau, cainf) { // Destexhe-style submembrane Ca²⁺ (mM)
    const n = R.t.length, dt = R.t[1] - R.t[0], out = new Float64Array(n); let ca = cainf;
    const k = 1e-6 / (2 * 96485.3415 * depthUm * 1e-4) * 1e3; // mM/ms per µA/cm²
    for (let i = 0; i < n; i++) { out[i] = ca * 1000; const drive = Math.max(0, -k * R.I.IT[i]); ca += dt * (drive + (cainf - ca) / tau); }
    return out; // µM
  }
  const mul = (a, f, off = 0) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) o[i] = (a[i] - off) * f; return o; };
  const tnnpFree = p => M.tnnp(Object.assign({}, TNNP_REF, p), { beats: 2, init: TNNP_SS, clampNaK: false, T: 600, out: 0.1, gates: true });
  const LENS_SIMS = {
    cardFree: tnnpFree,
    hhStep: p => M.hhStep(0, p, { pre: 1, T: 8, out: 0.025 }),
    drugFree: q => tnnpFree({ GKr: TNNP_REF.GKr * q.Kr, GCaL: TNNP_REF.GCaL * q.CaL, GNa: TNNP_REF.GNa * q.Na, GKs: 0.392 * q.Ks, GK1: TNNP_REF.GK1 * q.K1 }),
    waveFree: p => tnnpFree({ GKr: p.GKr, Gto: p.GtoEpi, GKs: p.GKsEpi }),
  };
  const CONC_KINDS = {
    dconc: (s, R) => dconc(R, s.names, s.SV, s.z),
    caShell: (s, R) => caShell(R, s.depth, s.tau, s.cainf),
    series: (s, R) => mul(R.C[s.from], s.scale || 1, s.delta ? R.C[s.from][0] : 0),
  };
  // "{p.Nao:0=440}" -> parameter Nao to 0 decimals (default 440); "{C.Cai:2*1000}" -> model concentration trace at frame i
  const fillIons = (tpl, p, R, i) => tpl.replace(/\{(p|C)\.(\w+)(?::(\d+))?(?:=([\d.]+))?(?:\*(\d+))?\}/g, (_, src, k, d, def, mulf) => {
    const v = src === 'p' ? (p[k] ?? Number(def)) : R.C[k][i] * (mulf ? Number(mulf) : 1);
    return v.toFixed(d ? Number(d) : 0);
  });
  function buildLens(L, shared) {
    const base = shared.lens.card;
    let d = L.lens;
    if (d === '@card') d = { extends: '@card' };
    if (d.extends === '@card') d = Object.assign({}, base, d);
    const ions = d.ions === '@neuron' ? shared.neuronIons : d.ions;
    const note = d.note.replace('{@note}', base.note);
    return Object.assign({}, d, {
      note, sim: d.sim ? LENS_SIMS[d.sim] : L.sim,
      conc: R => d.conc.map(s => ({ label: s.label, unit: s.unit, data: CONC_KINDS[s.kind || 'dconc'](s, R), d: s.d, col: s.col })),
      ions: (p, R, i) => ({ out: fillIons(ions.out, p, R, i), in: fillIons(ions.in, p, R, i) }),
    });
  }
  for (const L of LEVELS) L.lens = buildLens(L, DATA.shared);

  // ---------- lens events: channel state changes and level-defining moments, in cell time ----------
  const CH_SHORT = { INa: 'Nav', ICaL: 'Cav1.2', IT: 'Cav3.1', Ito: 'Kv4.3', IKr: 'hERG', IKs: 'KCNQ1', IM: 'Kv7',
    IK1: 'Kir2.1', IK: 'Kv', IKd: 'Kv2', IL: 'leak', INaCa: 'NCX1', INaK: 'Na/K pump' };
  const chName = (L, c) => (c === 'INa' && L.currents.includes('ICaL')) ? 'Nav1.5' : CH_SHORT[c];
  const INACT = { INa: 1, Ito: 1, ICaL: 1, IT: 1 }; // channels whose Po falls mainly by inactivation
  const CH_DETAIL = {
    INa: ['activation gates (m) snap open; Na⁺ rushes in', 'inactivation gate (h) closes the pore despite the depolarisation'],
    ICaL: ['L-type Ca²⁺ channels open; Ca²⁺ entry triggers release from the SR', 'voltage- and Ca²⁺-dependent inactivation shuts the pore'],
    IT: ['T-type channels, freed from inactivation, open near rest', 'they inactivate again within tens of ms'],
    Ito: ['fast K⁺ outflow pulls V down: the phase-1 notch', 'inactivation ends the transient outward current'],
    IKr: ['hERG recovers from inactivation as V falls, so its current peaks during repolarisation', 'deactivates as V returns to rest'],
    IKs: ['slow activation over hundreds of ms', 'deactivates slowly at rest'],
    IM: ['slow K⁺ current builds up spike after spike', 'deactivates slowly after the step'],
    IK1: ['reopens as V falls below about −20 mV, finishing repolarisation', 'inward rectification: the pore is plugged by Mg²⁺ and polyamines when depolarised'],
    IK: ['delayed rectifier opens and repolarises the membrane', 'closes slowly; the lag causes the undershoot'],
    IKd: ['delayed rectifier opens and repolarises the spike', 'closes after the spike'],
  };
  const CH_DETAIL_CLAMP = {
    INa: ['m gates open within a millisecond: the early current', 'h gates close even though the voltage is held: inactivation'],
    IK: ['n gates open with a delay (n⁴ makes it sigmoidal): the late current', 'closes again'],
  };
  function lensEvents(L, R, p) {
    const ev = [], t = R.t, V = R.V, n = t.length, dt = t[1] - t[0];
    const add = (time, label, detail, kind, ch) => { if (isFinite(time)) ev.push({ t: time, label, detail: detail || '', kind, ch }); };
    // stimulus
    const st = R.stim; let on = -1;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(st[i]) > 0, b = i > 0 && Math.abs(st[i - 1]) > 0;
      if (a && !b) on = i;
      if ((!a && b) || (a && i === n - 1)) {
        const dur = t[i] - t[on];
        if (dur < 3) add(t[on], 'Stimulus pulse', `${(st[on] > 0 ? 'depolarising' : 'inward')} current for ${dur.toFixed(1)} ms`, 'stim');
        else { add(t[on], st[on] > 0 ? 'Current step on' : 'Hyperpolarising step on', '', 'stim'); add(t[i], 'Step off', '', 'stim'); }
      }
    }
    // voltage landmarks (first spike only; none under voltage clamp)
    let up = -1; if (L.panel !== 'clamp') for (let i = 1; i < n; i++) if (V[i - 1] < 0 && V[i] >= 0) { up = i; break; }
    if (up > 0) {
      let pk = up; while (pk + 1 < n && V[pk + 1] >= V[pk]) pk++;
      add(t[up], 'Overshoot', 'the inside of the membrane turns positive', 'v');
      add(t[pk], `Peak ${V[pk] > 0 ? '+' : ''}${V[pk].toFixed(0)} mV`, 'dV/dt = 0: inward and outward currents balance', 'v');
      for (let i = pk; i < n - 1; i++) if (V[i] >= 0 && V[i + 1] < 0) { add(t[i + 1], 'Back below 0 mV', '', 'v'); break; }
    }
    // channel state changes: first two crossings of the half-way open probability
    for (const c of L.currents) {
      const O = R.O && R.O[c]; if (!O) continue;
      let lo = Infinity, hi = -Infinity; for (const x of O) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (hi - lo < 0.01) continue;
      const th = lo + 0.5 * (hi - lo), startOpen = O[0] > th; let k = 0;
      for (let i = 1; i < n && k < 2; i++) {
        const rose = O[i - 1] < th && O[i] >= th, fell = O[i - 1] >= th && O[i] < th;
        if (!rose && !fell) continue;
        const nm = chName(L, c), d = (L.panel === 'clamp' && CH_DETAIL_CLAMP[c]) || CH_DETAIL[c] || ['', ''];
        if (rose) add(t[i], `${nm} ${startOpen ? 'reopens' : 'opens'}`, d[0], 'ch', c);
        else add(t[i], `${nm} ${!startOpen && INACT[c] ? 'inactivates' : 'closes'}`, d[1], 'ch', c);
        k++;
      }
    }
    // concentration peaks
    if (L.lens.conc) for (const cs of L.lens.conc(R)) {
      let bi = 0; for (let i = 0; i < cs.data.length; i++) if (Math.abs(cs.data[i] - cs.data[0]) > Math.abs(cs.data[bi] - cs.data[0])) bi = i;
      if (bi > 0 && bi < 0.98 * cs.data.length) add(t[bi], cs.label.startsWith('Δ') ? `${cs.label}: largest change` : `${cs.label} peaks`, `${cs.data[bi].toFixed(cs.d)} ${cs.unit}`, 'conc');
    }
    // level-defining moments
    const spikes = []; for (let i = 1; i < n; i++) if (V[i - 1] < 0 && V[i] >= 0) spikes.push(t[i]);
    const cardiac = L.currents.includes('ICaL');
    if (L.id === 'clamp') {
      let si = 0; while (si < n && V[si] === V[0]) si++;
      add(t[si], `Command step to ${V[si].toFixed(0)} mV`, 'the clamp jumps the voltage and holds it; from now on only the gates change', 'level');
      if (R.ENa !== undefined) add(t[n - 1] * 0.98, `E_Na = ${R.ENa > 0 ? '+' : ''}${R.ENa.toFixed(1)} mV`, `set by [Na⁺]o = ${(p.Nao ?? 440).toFixed(0)} mM; the step to 0 mV ${V[si] < R.ENa ? 'is below it, so Na⁺ flows in' : 'is above it, so Na⁺ flows out'}`, 'level');
    } else if (L.id === 'squid') {
      let mi = 0; for (let i = 0; i < n; i++) if (V[i] < V[mi]) mi = i;
      if (spikes.length) add(t[mi], 'Undershoot', `V reaches ${V[mi].toFixed(1)} mV, close to E_K = −77 mV, because K⁺ channels are still open`, 'level');
    } else if (L.id === 'pyramidal' && spikes.length) {
      add(spikes[0], 'Spike 1', 'the first interval is the shortest', 'level');
      if (spikes.length > 2) {
        const isi1 = spikes[1] - spikes[0], isiN = spikes[spikes.length - 1] - spikes[spikes.length - 2];
        add(spikes[spikes.length - 1], `Spike ${spikes.length}`, `the interval is now ${(isiN / isi1).toFixed(1)}× the first: M-current has built up`, 'level');
      }
    } else if (L.id === 'thalamus') {
      const post = spikes.filter(x => x > 400);
      if (R.I.IT) { let bi = 0; for (let i = 0; i < n; i++) if (R.I.IT[i] < R.I.IT[bi]) bi = i; add(t[bi], 'Low-threshold Ca²⁺ spike', 'the T-type current peaks and carries the membrane to Na⁺ threshold', 'level'); }
      if (post.length) add(post[0], `Burst: ${post.length} spike${post.length > 1 ? 's' : ''}`, `in ${(post[post.length - 1] - post[0]).toFixed(0)} ms, riding on the Ca²⁺ spike`, 'level');
      add(250, 'T-channels recovering', 'hyperpolarisation removes inactivation (gate u relaxes towards 1)', 'level');
    } else if (cardiac && up > 0) {
      let i0 = 1; for (let i = 1; i < Math.min(n, Math.round(20 / dt)); i++) if (V[i] - V[i - 1] > V[i0] - V[i0 - 1]) i0 = i;
      let pk = 0; for (let i = 0; i < n; i++) if (V[i] > V[pk]) pk = i;
      let nt = pk; for (let i = pk; i < n && t[i] < t[pk] + 40; i++) if (V[i] < V[nt]) nt = i;
      let dome = nt; for (let i = nt; i < n && t[i] < 200; i++) if (V[i] > V[dome]) dome = i;
      const rest = V[0], amp = V[pk] - rest, apd = f => { for (let i = pk; i < n; i++) if (V[i] < V[pk] - f * amp) return t[i]; return NaN; };
      add(t[i0], 'Phase 0 · upstroke', 'Nav1.5 opens: hundreds of pA/pF flow in for about a millisecond', 'phase', 'INa');
      if (V[pk] - V[nt] > 2) add(t[nt], 'Phase 1 · notch', 'Kv4.3 (Ito) pulls V down before the plateau', 'phase', 'Ito');
      add(t[Math.max(dome, nt + 1)], 'Phase 2 · plateau', 'inward Cav1.2 and NCX nearly balance outward hERG and KCNQ1', 'phase', 'ICaL');
      add(apd(0.5), 'Phase 3 · repolarisation', 'hERG and KCNQ1 win; Kir2.1 reopens and accelerates the fall', 'phase', 'IKr');
      add(apd(0.9), 'APD90', '90 % repolarised', 'phase');
      add(apd(0.9) + 40, 'Phase 4 · rest', `Kir2.1 holds V near E_K (rest ${rest.toFixed(1)} mV)`, 'phase', 'IK1');
      if (L.id === 'potassium') {
        const EK = 26.71 * Math.log((p.Ko ?? 5.4) / 138.3);
        add(0, `Rest at ${rest.toFixed(1)} mV`, `[K⁺]o = ${(p.Ko ?? 5.4).toFixed(1)} mM puts E_K at ${EK.toFixed(1)} mV`, 'level');
      }
    }
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  // ---------- scoring ----------
  function rms(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s / n); }
  function evaluate(L, R, T) {
    const f = L.feats(R), ft = L.feats(T);
    for (const sk of ['shape', 'shapeE', 'shapeI']) if (sk in L.tol) { f[sk] = rms(R.V, T.V); ft[sk] = 0; }
    const rows = []; let tot = 0, n = 0;
    for (const k of Object.keys(L.tol)) {
      const d = (f[k] - ft[k]) / L.tol[k];
      const sc = isFinite(d) ? 100 * Math.exp(-0.5 * d * d) : 0;
      rows.push({ k, you: f[k], target: ft[k], score: sc }); tot += sc; n++;
    }
    return { score: tot / n, rows };
  }
  const STARS = [70, 85, 95];
  const starsFor = s => STARS.filter(x => s >= x).length;

  return { LEVELS, F, evaluate, starsFor, STARS, TNNP_REF, lensEvents, CH_SHORT };
})();
if (typeof module !== 'undefined') module.exports = CORE;
