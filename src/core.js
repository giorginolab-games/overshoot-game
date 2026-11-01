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
    speeds: [2, 15, 60], sim: p => M.tnnp(Object.assign({}, TNNP_REF, p), { beats: 2, init: TNNP_SS, clampNaK: false, T: 600, out: 1 }),
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
  };
  for (const L of LEVELS) { L.lens = LENS[L.id]; if (!L.lens.sim) L.lens = Object.assign({}, L.lens, { sim: L.sim }); }

  // ---------- scoring ----------
  function rms(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s / n); }
  function evaluate(L, R, T) {
    const f = L.feats(R), ft = L.feats(T);
    if ('shape' in L.tol) { f.shape = rms(R.V, T.V); ft.shape = 0; }
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

  return { LEVELS, F, evaluate, starsFor, STARS, TNNP_REF };
})();
if (typeof module !== 'undefined') module.exports = CORE;
