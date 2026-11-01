// Export model traces used in the paper figures (run from the repo root: node paper/figures/export.js)
global.MODELS = require('../../src/models.js');
const C = require('../../src/core.js'), M = global.MODELS, fs = require('fs'), path = require('path');
const lv = id => C.LEVELS.find(l => l.id === id);
const arr = a => Array.from(a, x => +x.toFixed(4));
const out = {};
for (const id of ['squid', 'pyramidal', 'thalamus', 'epi']) { const L = lv(id), R = L.sim(L.target); out[id] = { t: arr(R.t), V: arr(R.V), stim: arr(R.stim) }; }
// ventricular currents for the epicardial cell
{ const L = lv('epi'), R = L.sim(L.target); out.epiI = {}; for (const k of ['INa', 'ICaL', 'Ito', 'IKr', 'IKs', 'IK1', 'INaCa', 'INaK']) out.epiI[k] = arr(R.I[k]); }
// wall: uniform vs layered, plus APs at three depths
{ const L = lv('twave');
  const lay = L.sim(L.target), uni = L.sim(L.start);
  out.wall = { t: arr(lay.t), ecgLayered: arr(lay.ecg), ecgUniform: arr(uni.ecg),
    apsLayered: lay.aps.map(arr), apsUniform: uni.aps.map(arr), feats: { layered: L.feats(lay), uniform: L.feats(uni) } }; }
// drug: control, hERG 40 %, hERG 40 % + Cav1.2 70 %
{ const L = lv('drug'); const ctl = L.sim({}), h = L.sim(L.start), hc = L.sim(L.target);
  out.drug = { t: arr(ctl.t), control: arr(ctl.ecg), herg: arr(h.ecg), hergCa: arr(hc.ecg),
    feats: { control: L.feats(ctl), herg: L.feats(h), hergCa: L.feats(hc) } }; }
// starting vs target scores for the level table
out.levels = C.LEVELS.map(L => { const T = L.sim(L.target); return { id: L.id, name: L.name, start: C.evaluate(L, L.sim(L.start), T).score, nTools: L.tools.length, nFeat: Object.keys(L.tol).length }; });
fs.writeFileSync(path.join(__dirname, 'traces.json'), JSON.stringify(out));
console.log('wrote traces.json'); console.log(JSON.stringify(out.wall.feats), JSON.stringify(out.drug.feats)); console.log(out.levels.map(l => `${l.id} ${l.start.toFixed(0)} ${l.nTools} ${l.nFeat}`).join('\n'));
