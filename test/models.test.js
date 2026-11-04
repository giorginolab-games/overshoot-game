// Regression checks on the ionic models and the level design. Run: npm test
const assert = require('assert');
global.MODELS = require('../src/models.js');
const C = require('../src/core.js');
const M = global.MODELS;
let n = 0; const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// Hodgkin–Huxley: overshoot ~+39 mV, undershoot ~-76 mV
{ const R = M.hh({ gNa: 120, gK: 36, gL: 0.3 });
  ok(Math.abs(Math.max(...R.V) - 39.3) < 1, 'HH peak'); ok(Math.abs(Math.min(...R.V) + 76.2) < 1, 'HH undershoot'); }

// ten Tusscher 2004 epicardial cell: rest -86 mV, APD90 ~271 ms at 1 Hz
{ const L = C.LEVELS.find(l => l.id === 'epi'); const f = L.feats(L.sim(L.target));
  ok(Math.abs(f.rest + 86.3) < 0.5, 'TNNP rest'); ok(Math.abs(f.apd90 - 271) < 5, 'TNNP APD90'); }

// Every level: target scores 100, start scores below one star
for (const L of C.LEVELS) {
  const T = L.sim(L.target);
  ok(C.evaluate(L, T, T).score > 99.9, `${L.id}: target self-score`);
  ok(C.evaluate(L, L.sim(L.start), T).score < C.STARS[0], `${L.id}: start below one star`);
}

// Mystery level (Timothy syndrome) is not solvable with a single wrong channel
{ const L = C.LEVELS.find(l => l.id === 'lqt'), T = L.sim(L.target);
  for (const k of ['GKs', 'GKr', 'GK1', 'Gto', 'GNa']) {
    let best = 0; for (let f = 0.05; f < 3; f *= 1.15) best = Math.max(best, C.evaluate(L, L.sim({ ...L.start, [k]: L.start[k] * f }), T).score);
    ok(best < C.STARS[0], `lqt: ${k} alone stays below one star (${best.toFixed(1)})`);
  } }

// Lens: ICaL Ca2+ entry per beat ~10–20 µM of cytosol (Vc = 16.4 pL)
{ const L = C.LEVELS.find(l => l.id === 'epi'), R = L.lens.sim(L.target), dt = (R.t[1] - R.t[0]) / 1000;
  let q = 0; for (const x of R.I.ICaL) q += Math.abs(x) * 185e-12 * dt;
  const uM = q / (2 * 96485.3415) / 16.404e-12 * 1e6;
  ok(uM > 10 && uM < 25, `Ca entry per beat ${uM.toFixed(1)} µM`); }

// T-wave level: physics of the pseudo-ECG
{ const L = C.LEVELS.find(l => l.id === 'twave');
  const fT = L.feats(L.sim(L.target)), fS = L.feats(L.sim(L.start));
  ok(fT.tAmp > 0.15, `wall with transmural gradient: upright T (${fT.tAmp.toFixed(3)})`);
  ok(fS.tAmp < 0, `uniform wall: inverted T (${fS.tAmp.toFixed(3)})`);
  const fLow = L.feats(L.sim({ ...L.target, D: L.target.D / 2 }));
  ok(fLow.qrsDur > fT.qrsDur + 5, `halving gap-junction coupling widens the QRS (${fT.qrsDur} → ${fLow.qrsDur} ms)`);
  ok(Math.abs(fT.qrsAmp - 1) < 0.02, 'reference QRS normalised to 1'); }

// hERG paradox: hERG block alone prolongs QT; adding Cav1.2 block restores it; no other single block can
{ const L = C.LEVELS.find(l => l.id === 'drug'), T = L.sim(L.target);
  const qtH = L.feats(L.sim(L.start)).qt, qtT = L.feats(T).qt, qtHealthy = L.feats(L.sim({})).qt;
  ok(qtH > qtT + 15, `hERG block alone prolongs QT (${qtH} vs ${qtT} ms)`);
  ok(Math.abs(qtT - qtHealthy) < 8, `hERG + Cav1.2 block keeps QT near control (${qtT} vs ${qtHealthy} ms)`);
  for (const k of ['Na', 'Ks', 'K1']) {
    let best = 0; for (const f of [0.1, 0.3, 0.5, 0.7, 0.85]) best = Math.max(best, C.evaluate(L, L.sim({ ...L.start, [k]: f }), T).score);
    ok(best < C.STARS[0], `drug: blocking ${k} alone stays below one star (${best.toFixed(1)})`);
  } }

// Voltage clamp: the early-current reversal follows Nernst; channel density alone cannot fake low sodium
{ const L = C.LEVELS.find(l => l.id === 'clamp'), T = L.sim(L.target);
  const eHi = L.feats(L.sim({ ...L.target, Nao: 440 })).erev, eLo = L.feats(T).erev;
  const nernst = 24.08 * Math.log(132 / 440);
  ok(Math.abs((eLo - eHi) - nernst) < 6, `clamp: reversal shift ${(eLo - eHi).toFixed(1)} mV vs Nernst ${nernst.toFixed(1)} mV`);
  let best = 0; for (let gNa = 20; gNa < 400; gNa *= 1.15) for (let gK = 5; gK < 150; gK *= 1.15) best = Math.max(best, C.evaluate(L, L.sim({ gNa, gK, gL: 0.3, Nao: 440 }), T).score);
  ok(best < C.STARS[0], `clamp: sea-water Na⁺ cannot reach one star (${best.toFixed(1)})`); }

// Lens events: sorted, inside the trace, and the level-defining ones are present
for (const L of C.LEVELS) {
  const R = L.lens.sim(L.target), E = C.lensEvents(L, R, L.target), tEnd = R.t[R.t.length - 1];
  ok(E.length >= 5 && E.every((e, i) => e.t >= 0 && e.t <= tEnd && (i === 0 || e.t >= E[i - 1].t)), `${L.id}: ${E.length} lens events, sorted and in range`);
  const has = re => E.some(e => re.test(e.label));
  if (L.currents.includes('ICaL')) {
    const ph = ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'].map(x => (E.find(e => e.label.startsWith(x)) || {}).t);
    ok(ph.every((x, i) => isFinite(x) && (i === 0 || x > ph[i - 1])), `${L.id}: cardiac phases 0–4 detected in order`);
  }
  if (L.id === 'squid') ok(has(/^Undershoot/) && has(/Nav inactivates/), 'squid: undershoot and Na inactivation');
  if (L.id === 'pyramidal') ok(E.some(e => /× the first: M-current/.test(e.detail)) && has(/Kv7 opens/), 'pyramidal: adaptation event and M-current opening');
  if (L.id === 'thalamus') ok(has(/^Burst: \d+ spikes/) && has(/Cav3\.1 opens/), 'thalamus: T-channel opening and burst');
}

// The worker re-instantiates the models from MODELS_FACTORY's source text
{ const F2 = new Function(`${global.MODELS.MODELS_FACTORY.toString()}; return MODELS_FACTORY();`)();
  const a = F2.hh({ gNa: 120, gK: 36, gL: 0.3 }), b2 = M.hh({ gNa: 120, gK: 36, gL: 0.3 });
  ok(a.V.every((x, i) => x === b2.V[i]), 'factory source re-instantiates identically'); }

// Lens gate curves: at rest the recorded gates sit on their steady-state curves; thresholds are ordered sensibly
{ const at = (GC, arr, V) => arr[Math.round(V - GC.V[0])];
  const cases = [['squid', null], ['pyramidal', null], ['thalamus', null], ['epi', 'lens']];
  for (const [id, how] of cases) {
    const L = C.LEVELS.find(l => l.id === id), R = how ? L.lens.sim(L.target) : L.sim(L.target);
    ok(R.G && R.GC, `${id}: gate data`);
    for (const c in R.G) {
      const g = R.GC.ch[c], V0 = R.V[0];
      ok(Math.abs(R.G[c].A[0] - at(R.GC, g.A, V0)) < 0.08, `${id}/${c}: resting activation on its curve`);
      if (g.H) ok(Math.abs(R.G[c].H[0] - at(R.GC, g.H, V0)) < 0.08, `${id}/${c}: resting availability on its curve`);
      for (const x of g.A) ok(x >= 0 && x <= 1, `${id}/${c}: A in [0,1]`);
    } }
  // delay: during the squid upstroke the Na⁺ activation gate lags its steady state
  const L = C.LEVELS.find(l => l.id === 'squid'), R = L.sim(L.target); let lag = 0;
  for (let i = 0; i < R.V.length; i++) lag = Math.max(lag, at(R.GC, R.GC.ch.INa.A, R.V[i]) - R.G.INa.A[i]);
  ok(lag > 0.3, `HH Na activation lags its steady state during the spike (${lag.toFixed(2)})`); }

// Lens τ curves agree with the integrator: one tiny step relaxes each gate with exactly the tabulated time constant
{ const P = M.tnnpParams({ GNa: 14.838, GCaL: 1.75e-4, Gto: 0.294, GKr: 0.096, GKs: 0.245, GK1: 5.405 }, 'epi', true);
  for (const V of [-80, -50, -20, 10, 40]) {
    const c = Object.assign({}, M.TNNP_INIT, { V, m: 0.3, h: 0.4, j: 0.5, xr1: 0.3, xr2: 0.4, xs: 0.3, r: 0.3, s: 0.4, d: 0.3, f: 0.4 }), c0 = Object.assign({}, c), dt = 1e-4;
    const inf = M.tnnpInf(V, true, {}), tau = M.tnnpTau(V, true, {}); M.tnnpStep(c, P, dt, 0);
    const eff = (k, x) => -dt / Math.log((c[k] - x) / (c0[k] - x));
    const chk = (k, x, t) => ok(Math.abs(eff(k, x) / t - 1) < 0.01, `τ_${k} at ${V} mV: ${eff(k, x).toFixed(3)} vs ${t.toFixed(3)} ms`);
    chk('m', inf.minf, tau.tm); chk('h', inf.hinf, 1 / tau.kh); chk('j', inf.hinf, 1 / tau.kj); chk('xr1', inf.xr1inf, tau.txr1); chk('xr2', inf.xr2inf, tau.txr2);
    chk('xs', inf.xsinf, tau.txs); chk('r', inf.rinf, tau.tr); chk('s', inf.sinf, tau.ts); chk('d', inf.dinf, tau.td); chk('f', inf.finf, tau.tf);
  } }
// τ curves exist and are positive for every gate that has one
for (const id of ['squid', 'pyramidal', 'thalamus', 'epi']) {
  const L = C.LEVELS.find(l => l.id === id), R = L.lens.sim(L.target);
  for (const c in R.GC.ch) for (const k of ['tA', 'tH']) { const a = R.GC.ch[c][k]; if (a) ok(a.every(x => x > 0 && isFinite(x)), `${id}/${c}: ${k} positive`); }
}

console.log(`${n} checks passed`);
