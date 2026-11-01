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

console.log(`${n} checks passed`);
