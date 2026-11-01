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
  const CARD_TOOLS = [
    { k: 'GNa', name: 'Fast Na⁺', gene: 'Nav1.5 · SCN5A', cur: 'INa', unit: 'nS/pF', min: 2, max: 60, col: 'c-na' },
    { k: 'GCaL', name: 'L-type Ca²⁺', gene: 'Cav1.2 · CACNA1C', cur: 'ICaL', unit: '×10⁻⁴ cm³/µF/s', scale: 1e4, min: 0.3e-4, max: 6e-4, col: 'c-ca' },
    { k: 'Gto', name: 'Transient outward K⁺', gene: 'Kv4.3 · KCND3', cur: 'Ito', unit: 'nS/pF', min: 0.01, max: 1.2, col: 'c-to' },
    { k: 'GKr', name: 'Rapid delayed rectifier', gene: 'hERG · KCNH2', cur: 'IKr', unit: 'nS/pF', min: 0.005, max: 0.4, col: 'c-kr' },
    { k: 'GKs', name: 'Slow delayed rectifier', gene: 'KvLQT1 · KCNQ1', cur: 'IKs', unit: 'nS/pF', min: 0.01, max: 1.0, col: 'c-ks' },
    { k: 'GK1', name: 'Inward rectifier K⁺', gene: 'Kir2.1 · KCNJ2', cur: 'IK1', unit: 'nS/pF', min: 0.5, max: 20, col: 'c-k1' },
  ];
  const CARD_CURRENTS = ['INa', 'ICaL', 'Ito', 'IKr', 'IKs', 'IK1', 'INaCa', 'INaK'];
  const CARD_FEATS = { rest: 1.5, peak: 3, dvdt: 40, notch: 3, plateau: 3, apd50: 6, apd90: 6, shape: 3 };
  const cardSim = p => M.tnnp(Object.assign({}, TNNP_REF, p), { beats: 2, init: TNNP_SS, clampNaK: true, T: 600, out: 1 });

  const LEVELS = [
    {
      id: 'squid', name: 'Squid giant axon', who: 'Loligo · 6.3 °C', ref: 'Hodgkin & Huxley 1952',
      brief: 'The founding recording of membrane biophysics: one action potential in a squid giant axon after a 0.5 ms shock. Three conductances are all it takes.',
      protocol: '0.5 ms pulse, 20 µA/cm², at t = 2 ms', units: { cur: 'µA/cm²' },
      tools: [
        { k: 'gNa', name: 'Voltage-gated Na⁺', gene: 'squid Nav', cur: 'INa', unit: 'mS/cm²', min: 10, max: 400, col: 'c-na' },
        { k: 'gK', name: 'Delayed-rectifier K⁺', gene: 'squid Kv1 (sqKv1A)', cur: 'IK', unit: 'mS/cm²', min: 3, max: 150, col: 'c-k1' },
        { k: 'gL', name: 'Leak', gene: 'mostly Cl⁻ and K⁺', cur: 'IL', unit: 'mS/cm²', min: 0.03, max: 3, col: 'c-lk' },
      ],
      currents: ['INa', 'IK', 'IL'],
      target: { gNa: 120, gK: 36, gL: 0.3 }, start: { gNa: 60, gK: 12, gL: 1.2 },
      sim: p => M.hh(p), feats: hhFeatures, tol: { rest: 1, peak: 3, under: 2, width: 0.12, ttp: 0.2, shape: 3 },
      view: { x: [0, 20], y: [-90, 60], xt: 2, yt: 20 },
      hint0: 'Na⁺ channels make the upstroke; K⁺ channels end the spike and cause the undershoot. Leak sets how hard the cell is to excite.',
      debrief: 'Hodgkin and Huxley fitted these three conductances to voltage-clamp data and then predicted this waveform, including its shape, its conduction velocity and its refractory period. Na⁺ activation (m³) is fast and self-reinforcing; inactivation (h) and the slower K⁺ activation (n⁴) end the spike. The undershoot is the K⁺ conductance relaxing slowly back toward rest while V sits close to E_K = −77 mV. Single-channel conductance of squid Nav is about 15 pS, so 120 mS/cm² means roughly 80 open-able channels per µm².',
    },
    {
      id: 'clamp', name: 'Voltage clamp', who: 'Loligo · 6.3 °C · voltage clamp', ref: 'Hodgkin & Huxley 1952',
      brief: 'Before they could build their model, Hodgkin and Huxley had to see the currents. A voltage clamp holds the membrane at a chosen potential and measures the current needed to keep it there. The target shows twelve voltage steps, recorded after part of the sodium in the sea water was replaced by choline. Match the currents and work out how much sodium was left.',
      protocol: 'Hold −65 mV; 8 ms steps to −55 … +55 mV in 10 mV increments; currents in mA/cm², inward negative', units: { cur: 'µA/cm²' },
      tools: [
        { k: 'gNa', name: 'Voltage-gated Na⁺', gene: 'squid Nav', cur: 'INa', unit: 'mS/cm²', min: 10, max: 400, col: 'c-na' },
        { k: 'gK', name: 'Delayed-rectifier K⁺', gene: 'squid Kv1 (sqKv1A)', cur: 'IK', unit: 'mS/cm²', min: 3, max: 150, col: 'c-k1' },
        { k: 'Nao', name: 'External Na⁺', gene: 'sea water [Na⁺] (rest: choline)', cur: 'INa', unit: 'mM', min: 20, max: 460, lin: true, col: 'ion-na' },
      ],
      currents: ['INa', 'IK', 'IL'], panel: 'clamp',
      target: { gNa: 120, gK: 36, gL: 0.3, Nao: 132 }, start: { gNa: 60, gK: 50, gL: 0.3, Nao: 440 },
      sim: p => M.hhClamp(p), feats: clampFeatures, tol: { peakIn: 0.08, erev: 3, late55: 0.35, lateM15: 0.12, shapeI: 0.12 },
      view: { x: [0, 9], y: [-1.6, 4.8], xt: 1, yt: 1, yUnit: 'mA/cm²' },
      hint0: 'The early inward current is carried by Na⁺. It reverses where the voltage cancels the Na⁺ gradient, which channel density cannot change. The late outward current is K⁺ and does not depend on sodium at all.',
      debrief: 'In 1952 Hodgkin and Huxley separated the two currents by replacing external sodium with choline. The early current shrank and reversed at a less positive voltage, while the late current stayed the same, so the early current had to be Na⁺ and the late one K⁺. Here 30 % sodium (132 mM) moves E_Na from +50 to +21 mV (Nernst at 6.3 °C: 24.1 mV × ln 0.3 = −29 mV). The early current reverses a few mV below E_Na because some K⁺ and leak current already flow when the Na⁺ conductance peaks. Channel density scales the early current but cannot move its reversal, and that is how an experiment tells a change in channel number from a change in driving force. From separated currents like these, Hodgkin and Huxley fitted the m³h and n⁴ kinetics you used in level 1.',
    },
    {
      id: 'pyramidal', name: 'Cortical pyramidal cell', who: 'Rat neocortex · regular spiking', ref: 'Pospischil et al. 2008',
      brief: 'Inject a 500 ms current step into a pyramidal neuron and it fires a train that slows down over time. That slowing (spike-frequency adaptation) comes from a slow K⁺ current.',
      protocol: '2.5 µA/cm² step, 100–600 ms', units: { cur: 'µA/cm²' },
      tools: [
        { k: 'gNa', name: 'Voltage-gated Na⁺', gene: 'Nav1.2 / Nav1.6', cur: 'INa', unit: 'mS/cm²', min: 5, max: 200, col: 'c-na' },
        { k: 'gKd', name: 'Delayed-rectifier K⁺', gene: 'Kv2.1 · KCNB1', cur: 'IKd', unit: 'mS/cm²', min: 0.5, max: 40, col: 'c-k1' },
        { k: 'gM', name: 'M-current (slow K⁺)', gene: 'Kv7.2/7.3 · KCNQ2/3', cur: 'IM', unit: 'mS/cm²', min: 0.003, max: 0.6, col: 'c-ks' },
        { k: 'gL', name: 'Leak', gene: 'K2P and others', cur: 'IL', unit: 'mS/cm²', min: 0.01, max: 1, col: 'c-lk' },
      ],
      currents: ['INa', 'IKd', 'IM', 'IL'],
      target: { gNa: 50, gKd: 5, gM: 0.07, gL: 0.1 }, start: { gNa: 50, gKd: 14, gM: 0.008, gL: 0.06 },
      sim: p => M.cortical(p, { EL: -70, VT: -56.2, tauMax: 1000, T: 800, out: 0.2, currents: ['INa', 'IKd', 'IM', 'IL'], stim: t => (t >= 100 && t < 600) ? 2.5 : 0 }),
      feats: rsFeatures, tol: { rest: 1.5, count: 0.8, latency: 3, adapt: 0.35, peak: 3, trough: 2 },
      view: { x: [0, 800], y: [-90, 60], xt: 100, yt: 20 },
      hint0: 'Spike count and adaptation are mostly about the slow K⁺ current. Leak sets rest and how long it takes to reach the first spike.',
      debrief: 'Kv7 (KCNQ2/3) channels open slowly (time constant of hundreds of ms) at subthreshold voltages and do not inactivate. Each spike adds a little more open M-current, so the interspike intervals grow. Muscarinic agonists close these channels, which is where the name "M" comes from, and that turns adaptation off. KCNQ2 mutations cause neonatal epilepsy, and the anticonvulsant retigabine works by opening these channels.',
    },
    {
      id: 'thalamus', name: 'Thalamic neuron', who: 'Thalamocortical / LTS cell', ref: 'Pospischil et al. 2008; Destexhe 1996',
      brief: 'Hyperpolarise this neuron for 300 ms and let go. It answers with a rebound burst of spikes riding on a slow calcium spike. This is the mechanism behind sleep spindles and absence seizures.',
      protocol: '−0.5 µA/cm² step, 100–400 ms, then release', units: { cur: 'µA/cm²' },
      tools: [
        { k: 'gNa', name: 'Voltage-gated Na⁺', gene: 'Nav1.1 / Nav1.6', cur: 'INa', unit: 'mS/cm²', min: 5, max: 200, col: 'c-na' },
        { k: 'gKd', name: 'Delayed-rectifier K⁺', gene: 'Kv2 / Kv3', cur: 'IKd', unit: 'mS/cm²', min: 0.5, max: 40, col: 'c-k1' },
        { k: 'gT', name: 'T-type Ca²⁺', gene: 'Cav3.1 · CACNA1G', cur: 'IT', unit: 'mS/cm²', min: 0.02, max: 5, col: 'c-ca' },
        { k: 'gL', name: 'Leak', gene: 'K2P (TASK) and others', cur: 'IL', unit: 'mS/cm²', min: 0.005, max: 0.5, col: 'c-lk' },
      ],
      currents: ['INa', 'IKd', 'IT', 'IL'],
      target: { gNa: 50, gKd: 4, gT: 1, gL: 0.04 }, start: { gNa: 50, gKd: 4, gT: 0.15, gL: 0.1 },
      sim: p => M.cortical(p, { EL: -75, VT: -50, Vx: 2, T: 700, out: 0.2, currents: ['INa', 'IKd', 'IT', 'IL'], stim: t => (t >= 100 && t < 400) ? -0.5 : 0 }),
      feats: ltsFeatures, tol: { rest: 1.5, hyp: 2, early: 0.5, count: 0.8, latency: 4, dur: 5 },
      view: { x: [0, 700], y: [-100, 60], xt: 100, yt: 20 },
      hint0: 'The burst needs T-type Ca²⁺ channels, which are inactivated at rest and only recover when the cell is hyperpolarised. Leak decides how far the step pushes the voltage down.',
      debrief: 'Cav3.1 channels are inactivated at rest. A long hyperpolarisation removes the inactivation (the h-like gate u has τ of about 30–100 ms), so on release they open together and produce a low-threshold Ca²⁺ spike that triggers a burst of Na⁺ spikes. Leak conductance matters twice: it sets how far the step can hyperpolarise the cell, and it shunts the Ca²⁺ spike. Ethosuximide, a first-line drug for absence epilepsy, blocks T-type channels.',
    },
    {
      id: 'epi', name: 'Ventricular myocyte', who: 'Human · epicardium · 1 Hz', ref: 'ten Tusscher, Noble, Noble & Panfilov 2004',
      brief: 'A human ventricular action potential lasts about 300 ms, a hundred times longer than a nerve spike. It has a sharp upstroke, an epicardial notch, a long Ca²⁺-supported plateau and a K⁺-driven repolarisation. Six channel types shape it.',
      protocol: '1 ms stimulus at 1 Hz, steady state (2nd beat shown)', units: { cur: 'pA/pF' },
      tools: CARD_TOOLS, currents: CARD_CURRENTS,
      target: {}, start: { GCaL: 0.9e-4, Gto: 0.05, GKr: 0.2, GK1: 2.0 },
      sim: cardSim, feats: cardFeatures, tol: CARD_FEATS,
      view: { x: [0, 600], y: [-100, 60], xt: 100, yt: 20 },
      hint0: 'Work phase by phase. Upstroke: Na⁺. Notch: Ito. Plateau height and length: Ca²⁺ against the two delayed rectifiers. Final repolarisation and rest: IK1.',
      debrief: 'Each phase has an owner. Phase 0 is Nav1.5, phase 1 the Kv4.3 notch (large in epicardium, small in endocardium), phase 2 a balance between Cav1.2 and hERG/KCNQ1, phase 3 the delayed rectifiers handing over to Kir2.1, and phase 4 Kir2.1 clamping the cell near E_K. The Na⁺/Ca²⁺ exchanger and the Na⁺/K⁺ pump are shown in the current traces but are not adjustable here. They matter too: NCX carries inward current late in the plateau.',
    },
    {
      id: 'mcell', name: 'Mid-myocardial M cell', who: 'Human · midwall · 1 Hz', ref: 'ten Tusscher et al. 2004; Antzelevitch',
      brief: 'Cells from the middle of the ventricular wall have the longest action potentials in the heart. You start from the epicardial cell. Make it an M cell.',
      protocol: '1 ms stimulus at 1 Hz, steady state (2nd beat shown)', units: { cur: 'pA/pF' },
      tools: CARD_TOOLS, currents: CARD_CURRENTS,
      target: { GKs: 0.062 }, start: {},
      sim: cardSim, feats: cardFeatures, tol: CARD_FEATS,
      view: { x: [0, 600], y: [-100, 60], xt: 100, yt: 20 },
      hint0: 'The upstroke and the notch already match. Only repolarisation is late. Which outward currents run during the plateau?',
      debrief: 'In the original model the M cell differs from epicardium in one parameter: IKs is cut to a quarter (0.245 → 0.062 nS/pF). If you reached a good score another way, for example by lowering hERG or raising Cav1.2, you have found degeneracy: different channel mixes can produce nearly the same waveform (Marder & Goaillard 2006). This is why fitting a voltage trace alone cannot tell you a cell\'s channel densities, and why modellers add voltage-clamp, drug-block and pacing-rate protocols. The transmural APD gradient between epi, M and endo cells is what produces the upright T wave on the ECG.',
    },
    {
      id: 'lqt', name: 'Mystery patient: long QT', who: 'Human · epicardium · 1 Hz', ref: 'Clinical case (model)',
      brief: 'An infant has fainting spells, a very long QT interval, and webbed fingers and toes. Genetic testing found a single gain-of-function mutation in one ion channel. Find which one, and reproduce the patient\'s action potential.',
      protocol: '1 ms stimulus at 1 Hz, steady state (2nd beat shown)', units: { cur: 'pA/pF' },
      tools: CARD_TOOLS, currents: CARD_CURRENTS,
      target: { GCaL: 3.15e-4 }, start: {},
      sim: cardSim, feats: cardFeatures, tol: CARD_FEATS,
      view: { x: [0, 600], y: [-100, 60], xt: 100, yt: 20 },
      hint0: 'Gain of function means more current, not less. Look at the plateau: it is higher as well as longer. Which inward current holds the plateau up?',
      debrief: 'Timothy syndrome (LQT8), caused by the CACNA1C G406R mutation in Cav1.2. The real mutation mostly removes voltage-dependent inactivation, so L-type Ca²⁺ current keeps flowing through the plateau. Here it is approximated as 1.8× the ICaL conductance. Notice that cutting a K⁺ current (IKs, IKr) also lengthens the AP but cannot raise the plateau, so those fits score lower. Shape features beyond APD are what discriminate between mechanisms. The same channel is expressed in many tissues, which explains the syndactyly and the autism-spectrum features. By contrast, drug-induced long QT almost always comes from hERG (IKr) block. In this 2004 model hERG has a surprisingly small effect, because the model carries a large IKs reserve. Later models such as O\'Hara–Rudy 2011 are much more hERG-sensitive, and that is one reason they are used in the FDA CiPA drug-safety initiative.',
    },
    {
      id: 'potassium', name: 'Electrolyte emergency', who: 'Human · epicardium · 1 Hz', ref: 'ten Tusscher et al. 2004',
      brief: 'Same healthy channels, different blood. The tools are now the extracellular ion concentrations. A dialysis patient missed two sessions. Match their myocyte\'s action potential.',
      protocol: '1 ms stimulus at 1 Hz, steady state (2nd beat shown)', units: { cur: 'pA/pF' },
      tools: [
        { k: 'Ko', name: 'Extracellular K⁺', gene: 'serum [K⁺]', cur: 'IK1', unit: 'mM', min: 2, max: 12, lin: true, col: 'c-k1' },
        { k: 'Nao', name: 'Extracellular Na⁺', gene: 'serum [Na⁺]', cur: 'INa', unit: 'mM', min: 110, max: 165, lin: true, col: 'c-na' },
        { k: 'Cao', name: 'Extracellular Ca²⁺', gene: 'serum [Ca²⁺] (ionised)', cur: 'ICaL', unit: 'mM', min: 0.6, max: 4, lin: true, col: 'c-ca' },
      ],
      currents: CARD_CURRENTS,
      target: { Ko: 8, Nao: 140, Cao: 2 }, start: { Ko: 4, Nao: 132, Cao: 2.8 },
      sim: cardSim, feats: cardFeatures, tol: CARD_FEATS,
      view: { x: [0, 600], y: [-100, 60], xt: 100, yt: 20 },
      hint0: 'Look at the resting potential first. Which ion\'s Nernst potential sets it? The kidneys excrete that ion.',
      debrief: 'Hyperkalaemia, [K⁺]o = 8 mM. Raising extracellular K⁺ shifts E_K positive (Nernst: 26.7 mV × ln(Ko/Ki)), so the resting potential depolarises by about 10 mV. That partially inactivates Nav1.5, so the upstroke is slower and the overshoot smaller, which widens the QRS. At the same time IK1 and IKr conductances increase with √Ko, so repolarisation is faster, which peaks the T wave. On the ECG: peaked T waves, then a wide QRS, then a sine-wave pattern and arrest. Intravenous calcium is given first because it stabilises the membrane, before insulin and glucose shift K⁺ back into cells.',
    },
    {
      id: 'twave', name: 'The T wave', who: 'Human LV wall · 1.2 cm transmural strand · 1 Hz', ref: 'Gima & Rudy 2002; ten Tusscher et al. 2004/2006',
      brief: 'The ECG is not the voltage of any one cell. It is the electric field of a whole wall of cells, activating and recovering at slightly different times. This is a 1.2 cm strip of left-ventricular wall, stimulated on the endocardial side and recorded by an electrode 2 cm beyond the epicardium. Right now every layer is the same, so the QRS is too narrow and the T wave points the wrong way. Give the wall its real layers.',
      protocol: 'Endocardial stimulus at t = 0; single cells pre-paced at 1 Hz; pseudo-ECG scaled so the reference QRS = 1', units: { cur: 'pA/pF' },
      tools: [
        { k: 'D', name: 'Gap junctions', gene: 'Cx43 · GJA1 (coupling D)', cur: 'INa', unit: 'cm²/s', scale: 1000, min: 0.0002, max: 0.003, col: 'c-gj' },
        { k: 'GKsEndo', name: 'Endocardium: slow K⁺', gene: 'KCNQ1 · inner 25 %', cur: 'IKs', unit: 'nS/pF', min: 0.02, max: 1, col: 'l-endo' },
        { k: 'GKsM', name: 'Midwall: slow K⁺', gene: 'KCNQ1 · middle 35 %', cur: 'IKs', unit: 'nS/pF', min: 0.02, max: 1, col: 'l-mid' },
        { k: 'GKsEpi', name: 'Epicardium: slow K⁺', gene: 'KCNQ1 · outer 40 %', cur: 'IKs', unit: 'nS/pF', min: 0.02, max: 1, col: 'l-epi' },
        { k: 'GtoEpi', name: 'Epicardium: transient out', gene: 'Kv4.3 · KCND3', cur: 'Ito', unit: 'nS/pF', min: 0.01, max: 1.2, col: 'c-to' },
        { k: 'GKr', name: 'Whole wall: hERG', gene: 'Kv11.1 · KCNH2', cur: 'IKr', unit: 'nS/pF', min: 0.01, max: 0.4, col: 'c-kr' },
      ],
      currents: CARD_CURRENTS, panel: 'wall', async: 'tnnpWall', noise: 0.004,
      target: { D: 0.0007, GKsEndo: 0.245, GKsM: 0.062, GKsEpi: 0.392, GtoEpi: 0.294, GKr: 0.096 },
      start: { D: 0.0016, GKsEndo: 0.245, GKsM: 0.245, GKsEpi: 0.245, GtoEpi: 0.294, GKr: 0.096 },
      sim: p => M.tnnpWall(p), feats: ecgFeatures,
      tol: { qrsAmp: 0.06, qrsDur: 3, tAmp: 0.04, tPeak: 8, qt: 8, tpte: 5, shapeE: 0.04 },
      view: { x: [0, 560], y: [-0.4, 1.2], xt: 100, yt: 0.2, yUnit: 'norm.' },
      hint0: 'QRS width is set by how fast the wavefront crosses the wall. The T wave is upright when the layer activated last (the epicardium) finishes repolarising first, so the epicardium needs the shortest action potential. M cells, in the midwall, have the longest.',
      debrief: 'The pseudo-ECG is φ ∝ ∫ (−∂V/∂x) · ∂(1/r)/∂x dx: only voltage <i>gradients</i> along the wall make a signal. During the QRS the gradient is the activation front, so its width is the transmural conduction time, set by gap-junction coupling (Cx43). During the T wave the gradient comes from cells repolarising at different times. In a uniform wall the cells that activate last also repolarise last, and the T wave is inverted, opposite to the QRS. Real hearts invert this order with a transmural gradient of K⁺ channels: dense IKs in the epicardium (0.392 nS/pF, the value used in ten Tusscher & Panfilov 2006) and sparse IKs in midwall M cells. The interval from T peak to T end reflects transmural dispersion of repolarisation, which is a clinical marker of arrhythmia risk. This 1D strand explains the T wave. The real QRS also depends on the 3D activation sequence laid down by the Purkinje network, on the heart\'s geometry and on the torso, which needs whole-heart models.',
    },
    {
      id: 'drug', name: 'The hERG paradox', who: 'Human LV wall · first-in-human trial · 1 Hz', ref: 'Redfern et al. 2003; CiPA (Colatsky et al. 2016)',
      brief: 'At its clinical concentration, compound X blocks 60 % of hERG current. On that result alone it would be dropped, because hERG block is the classic cause of drug-induced long QT and torsade de pointes. Yet in the first-in-human trial the QT interval barely moved. The ECG below was recorded at peak plasma concentration. Find what else the compound blocks.',
      protocol: 'hERG fixed at 40 % of control (from the patch-clamp screen); the other sliders set the current remaining through each channel', units: { cur: 'pA/pF' },
      tools: [
        { k: 'Kr', name: 'hERG (IKr)', gene: 'Kv11.1 · fixed by the hERG assay', cur: 'IKr', unit: '% of control', scale: 100, min: 0.05, max: 1, lin: true, col: 'c-kr', locked: true },
        { k: 'CaL', name: 'L-type Ca²⁺ (ICaL)', gene: 'Cav1.2 · CACNA1C', cur: 'ICaL', unit: '% of control', scale: 100, min: 0.05, max: 1, lin: true, col: 'c-ca' },
        { k: 'Na', name: 'Fast Na⁺ (INa)', gene: 'Nav1.5 · SCN5A', cur: 'INa', unit: '% of control', scale: 100, min: 0.05, max: 1, lin: true, col: 'c-na' },
        { k: 'Ks', name: 'Slow delayed rectifier (IKs)', gene: 'KCNQ1 · all layers', cur: 'IKs', unit: '% of control', scale: 100, min: 0.05, max: 1, lin: true, col: 'c-ks' },
        { k: 'K1', name: 'Inward rectifier (IK1)', gene: 'Kir2.1 · KCNJ2', cur: 'IK1', unit: '% of control', scale: 100, min: 0.05, max: 1, lin: true, col: 'c-k1' },
      ],
      currents: CARD_CURRENTS, panel: 'wall', async: 'tnnpWallScaled', noise: 0.004,
      target: { Kr: 0.4, CaL: 0.7, Na: 1, Ks: 1, K1: 1 }, start: { Kr: 0.4, CaL: 1, Na: 1, Ks: 1, K1: 1 },
      sim: q => M.tnnpWallScaled(q), feats: ecgFeatures,
      tol: { qrsAmp: 0.04, qrsDur: 3, tAmp: 0.03, tPeak: 8, qt: 8, tpte: 5, shapeE: 0.03 },
      view: { x: [0, 560], y: [-0.4, 1.2], xt: 100, yt: 0.2, yUnit: 'norm.' },
      hint0: 'Blocking hERG removes outward current during the plateau, so repolarisation comes late. To bring it back on time without restoring hERG, the drug must also remove some inward current from the plateau. Which inward current holds the plateau up?',
      debrief: 'Compound X behaves like verapamil, which blocks hERG and Cav1.2 at similar concentrations. Less inward Ca²⁺ current during the plateau balances the lost outward K⁺ current, so the action potential, and the QT interval, barely change. Verapamil is not associated with torsade de pointes. Ranolazine is another hERG blocker with low risk; it also blocks late Na⁺ current, which this model does not include. Cases like these are why a hERG assay alone gives false alarms. The FDA-backed CiPA initiative now combines patch-clamp data on several channels with a human ventricular model (O\'Hara–Rudy) to predict risk. Note the T wave: it is still flatter and earlier than in a healthy wall, because the balance is not exact. That residual shape is how the trial ECG gives the second block away. In this 2004 model hERG effects are smaller than in later human models, so the sizes here are illustrative.',
    },
  ];
  for (const L of LEVELS) {
    if (L.model === undefined && L.tools === CARD_TOOLS) {
      L.target = Object.assign({}, TNNP_REF, L.target);
      L.start = Object.assign({}, TNNP_REF, L.start);
    }
  }

  // ---------- lens (slow-motion membrane view) ----------
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
  const NEURON_IONS = { out: 'Na⁺ 145 · K⁺ 4 · Ca²⁺ 2 mM', in: 'Na⁺ 12 · K⁺ 140 mM · Ca²⁺ 0.1 µM' };
  const CARD_LENS = {
    pA: 185, scope: 'whole cell (185 pF of membrane)',
    speeds: [2, 15, 60], sim: p => M.tnnp(Object.assign({}, TNNP_REF, p), { beats: 2, init: TNNP_SS, clampNaK: false, T: 600, out: 0.1 }),
    ions: (p, R, i) => ({ out: `Na⁺ ${(p.Nao ?? 140).toFixed(0)} · K⁺ ${(p.Ko ?? 5.4).toFixed(1)} · Ca²⁺ ${(p.Cao ?? 2).toFixed(1)} mM`,
      in: `Na⁺ ${R.C.Nai[i].toFixed(3)} · K⁺ ${R.C.Ki[i].toFixed(2)} mM · Ca²⁺ ${(R.C.Cai[i] * 1000).toFixed(2)} µM` }),
    conc: R => [
      { label: '[Ca²⁺] cytosol', unit: 'µM', data: mul(R.C.Cai, 1000), d: 3, col: 'ion-ca' },
      { label: '[Ca²⁺] SR store', unit: 'mM', data: R.C.Casr, d: 3, col: 'c-ca' },
      { label: 'Δ[Na⁺] cytosol', unit: 'µM', data: mul(R.C.Nai, 1000, R.C.Nai[0]), d: 2, col: 'ion-na' },
      { label: 'Δ[K⁺] cytosol', unit: 'µM', data: mul(R.C.Ki, 1000, R.C.Ki[0]), d: 2, col: 'ion-k' },
    ],
    note: 'Concentrations come straight from the model. The Ca²⁺ transient is released from the sarcoplasmic reticulum (SR) by the trigger Ca²⁺ entering through Cav1.2, and it is what makes the cell contract. One beat shifts cytosolic Na⁺ and K⁺ by only tens of µM out of about 11 and 138 mM. Watch Na⁺ jump at the upstroke, then fall as the Na⁺/K⁺ pump works through the beat. Over minutes of pacing the two balance.',
  };
  const LENS = {
    squid: { pA: 1, scope: '100 µm² patch of axon (≈ 8,000 Na⁺ channels at 120 mS/cm²)', speeds: [0.15, 0.8, 3], sim: p => M.hh(p), ions: () => ({ out: 'Na⁺ 440 · K⁺ 20 mM (sea water)', in: 'Na⁺ 50 · K⁺ 400 mM (axoplasm)' }),
      conc: R => [
        { label: 'Δ[Na⁺] inside', unit: 'µM', data: dconc(R, ['INa'], 80, 1), d: 3, col: 'ion-na' },
        { label: 'Δ[K⁺] inside', unit: 'µM', data: dconc(R, ['IK'], 80, 1), d: 3, col: 'ion-k' }],
      note: 'Estimated from the currents for a 500 µm squid axon (surface-to-volume ratio 80 cm⁻¹). One spike raises internal Na⁺ by well under a micromolar, against about 50 mM already there. That is why an axon with its pumps poisoned can still fire many thousands of spikes: an action potential needs only a tiny charge transfer, not a change in concentration.' },
    clamp: { pA: 1, scope: '100 µm² patch of axon, clamped at 0 mV', speeds: [0.15, 0.8, 3],
      sim: p => M.hhStep(0, p, { pre: 1, T: 8, out: 0.025 }), view: { x: [0, 9], y: [-100, 60], xt: 1, yt: 20 },
      ions: p => ({ out: `Na⁺ ${(p.Nao ?? 440).toFixed(0)} mM (rest choline) · K⁺ 20 mM`, in: 'Na⁺ 50 · K⁺ 400 mM (axoplasm)' }),
      conc: R => [
        { label: 'Δ[Na⁺] inside', unit: 'µM', data: dconc(R, ['INa'], 80, 1), d: 3, col: 'ion-na' },
        { label: 'Δ[K⁺] inside', unit: 'µM', data: dconc(R, ['IK'], 80, 1), d: 3, col: 'ion-k' }],
      note: 'One voltage step, from −65 to 0 mV, of a 500 µm axon (surface-to-volume ratio 80 cm⁻¹). The voltage does not move after the step, so every change in current here comes from the gates: Na⁺ channels open then inactivate, K⁺ channels open slowly and stay open. Compare the timing with the early and late currents in the main view.' },
    pyramidal: { pA: 12.57, scope: 'whole 20 µm soma (1,257 µm², 12.6 pF)', speeds: [1, 10, 40], sim: null, ions: () => NEURON_IONS,
      conc: R => [
        { label: 'Δ[Na⁺] inside', unit: 'µM', data: dconc(R, ['INa'], 3000, 1), d: 1, col: 'ion-na' },
        { label: 'Δ[K⁺] inside', unit: 'µM', data: dconc(R, ['IKd', 'IM'], 3000, 1), d: 1, col: 'ion-k' }],
      note: 'Estimated from the currents for a 20 µm spherical soma (surface-to-volume ratio 3000 cm⁻¹). Each spike adds a step of Na⁺ and removes a step of K⁺. In a thin dendrite or axon (much larger surface-to-volume ratio) the same train changes concentrations far more, which is why small neurites depend on the Na⁺/K⁺ pump.' },
    thalamus: { pA: 12.57, scope: 'whole 20 µm soma (1,257 µm², 12.6 pF)', speeds: [1, 10, 40], sim: null, ions: () => NEURON_IONS,
      conc: R => [
        { label: '[Ca²⁺] under membrane', unit: 'µM', data: caShell(R, 1, 5, 2.4e-4), d: 3, col: 'ion-ca' },
        { label: 'Δ[Na⁺] inside', unit: 'µM', data: dconc(R, ['INa'], 3000, 1), d: 1, col: 'ion-na' }],
      note: 'Submembrane Ca²⁺ is estimated from the T-type current with the shell model of Destexhe et al. (1 µm shell, τ = 5 ms). The Ca²⁺ spike after release raises it several-fold, which is how a rebound burst can switch on Ca²⁺-activated K⁺ channels and gene expression. Δ[Na⁺] assumes a 20 µm soma.' },
    epi: CARD_LENS, mcell: CARD_LENS, lqt: CARD_LENS, potassium: CARD_LENS,
    drug: Object.assign({}, CARD_LENS, {
      sim: q => M.tnnp(Object.assign({}, TNNP_REF, { GKr: TNNP_REF.GKr * q.Kr, GCaL: TNNP_REF.GCaL * q.CaL, GNa: TNNP_REF.GNa * q.Na, GKs: 0.392 * q.Ks, GK1: TNNP_REF.GK1 * q.K1 }),
        { beats: 2, init: TNNP_SS, clampNaK: false, T: 600, out: 0.1 }),
      view: { x: [0, 600], y: [-100, 60], xt: 100, yt: 20 },
      note: 'One epicardial cell with your drug\'s block applied, uncoupled from the wall. Compare the Cav1.2 and hERG currents during the plateau with the untreated cell. ' + CARD_LENS.note,
    }),
    twave: Object.assign({}, CARD_LENS, {
      sim: p => M.tnnp(Object.assign({}, TNNP_REF, { GKr: p.GKr, Gto: p.GtoEpi, GKs: p.GKsEpi }), { beats: 2, init: TNNP_SS, clampNaK: false, T: 600, out: 0.1 }),
      view: { x: [0, 600], y: [-100, 60], xt: 100, yt: 20 },
      note: 'This is one epicardial cell with your wall\'s channel densities, uncoupled from its neighbours, so you can watch the K⁺ currents that end its action potential early. In the wall, coupling to the longer-lasting midwall cells pulls its repolarisation a little later. ' + CARD_LENS.note,
    }),
  };
  for (const L of LEVELS) { L.lens = LENS[L.id]; if (!L.lens.sim) L.lens = Object.assign({}, L.lens, { sim: L.sim }); }

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
