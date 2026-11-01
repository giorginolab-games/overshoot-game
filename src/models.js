// ===== Ionic models =====================================================
// All models: simulate(p) -> { t:Float64Array, V:Float64Array, I:{name:Float64Array}, stim:Float64Array }
// sampled every `out` ms.

// Factory form so the same source can be re-instantiated inside a Web Worker (see app.js).
function MODELS_FACTORY() {
  const exp = Math.exp, sqrt = Math.sqrt, log = Math.log;

  // safe x/(1-exp(-x/k)) style helper: a*(x)/(1-exp(-x/k))
  function vtrap(x, k) { // x / (1 - exp(-x/k))
    return Math.abs(x / k) < 1e-6 ? k * (1 + x / k / 2) : x / (1 - exp(-x / k));
  }

  // ---------------- Hodgkin–Huxley 1952 (squid axon, 6.3 °C) -------------
  function hh(p) {
    const gNa = p.gNa, gK = p.gK, gL = p.gL;
    const ENa = 50, EK = -77, EL = -54.4;
    const dt = 0.005, T = 20, out = 0.025;
    let V = -65, m = 0.0529, h = 0.596, n = 0.3177;
    // relax gates to rest for given V (rest depends a bit on params) – settle 50 ms with no stim
    const N = Math.round(T / out);
    const R = { t: new Float64Array(N), V: new Float64Array(N), stim: new Float64Array(N),
      I: { INa: new Float64Array(N), IK: new Float64Array(N), IL: new Float64Array(N) },
      O: { INa: new Float64Array(N), IK: new Float64Array(N), IL: new Float64Array(N).fill(1) } };
    const total = 50 + T; let k = 0;
    for (let s = 0, ns = Math.round(total / dt); s < ns; s++) {
      const t = s * dt - 50;
      const am = 0.1 * vtrap(V + 40, 10), bm = 4 * exp(-(V + 65) / 18);
      const ah = 0.07 * exp(-(V + 65) / 20), bh = 1 / (1 + exp(-(V + 35) / 10));
      const an = 0.01 * vtrap(V + 55, 10), bn = 0.125 * exp(-(V + 65) / 80);
      const INa = gNa * m * m * m * h * (V - ENa), IK = gK * n * n * n * n * (V - EK), IL = gL * (V - EL);
      const Ist = (t >= 2 && t < 2.5) ? 20 : 0;
      if (t >= 0 && k < N && Math.abs(t - k * out) < dt / 2) {
        R.t[k] = t; R.V[k] = V; R.stim[k] = Ist; R.I.INa[k] = INa; R.I.IK[k] = IK; R.I.IL[k] = IL; R.O.INa[k] = m * m * m * h; R.O.IK[k] = n * n * n * n; k++;
      }
      V += dt * (Ist - INa - IK - IL);
      let tau, inf;
      tau = 1 / (am + bm); inf = am * tau; m = inf + (m - inf) * exp(-dt / tau);
      tau = 1 / (ah + bh); inf = ah * tau; h = inf + (h - inf) * exp(-dt / tau);
      tau = 1 / (an + bn); inf = an * tau; n = inf + (n - inf) * exp(-dt / tau);
    }
    return R;
  }

  // ------------- Pospischil et al. 2008 minimal cortical/thalamic models ----
  // INa, IKd (Traub-Miles), IM (Kv7, slow K), IT (Cav3, low-threshold Ca), leak.
  // Units: mS/cm², µA/cm², mV, ms.
  function cortical(p, protocol) {
    const gNa = p.gNa, gKd = p.gKd, gM = p.gM || 0, gT = p.gT || 0, gL = p.gL;
    const EL = protocol.EL, VT = protocol.VT, ENa = 50, EK = -90, ECa = 120, Vx = protocol.Vx || 0;
    const tauMax = protocol.tauMax || 600;
    const dt = 0.01, out = protocol.out || 0.2, T = protocol.T;
    const pre = 300;
    let V = EL, m = 0, h = 1, n = 0, pM = 0, u = 1;
    const N = Math.round(T / out);
    const R = { t: new Float64Array(N), V: new Float64Array(N), stim: new Float64Array(N), I: {}, O: {} };
    for (const c of protocol.currents) { R.I[c] = new Float64Array(N); R.O[c] = new Float64Array(N); }
    let k = 0;
    for (let s = 0, ns = Math.round((pre + T) / dt); s < ns; s++) {
      const t = s * dt - pre;
      const v1 = V - VT;
      const am = 0.32 * vtrap(v1 - 13, 4), bm = 0.28 * vtrap(-(v1 - 40), 5);
      const ah = 0.128 * exp(-(v1 - 17) / 18), bh = 4 / (1 + exp(-(v1 - 40) / 5));
      const an = 0.032 * vtrap(v1 - 15, 5), bn = 0.5 * exp(-(v1 - 10) / 40);
      const pinf = 1 / (1 + exp(-(V + 35) / 10)), taup = tauMax / (3.3 * exp((V + 35) / 20) + exp(-(V + 35) / 20));
      const sinf = 1 / (1 + exp(-(V + Vx + 57) / 6.2)), uinf = 1 / (1 + exp((V + Vx + 81) / 4));
      const tauu = (30.8 + (211.4 + exp((V + Vx + 113.2) / 5)) / (1 + exp((V + Vx + 84) / 3.2))) / 3.7;
      const INa = gNa * m * m * m * h * (V - ENa), IKd = gKd * n * n * n * n * (V - EK);
      const IM = gM * pM * (V - EK), IT = gT * sinf * sinf * u * (V - ECa), IL = gL * (V - EL);
      const Ist = protocol.stim(t);
      if (t >= 0 && k < N && Math.abs(t - k * out) < dt / 2) {
        R.t[k] = t; R.V[k] = V; R.stim[k] = Ist;
        const all = { INa, IKd, IM, IT, IL };
        const op = { INa: m * m * m * h, IKd: n * n * n * n, IM: pM, IT: sinf * sinf * u, IL: 1 };
        for (const c of protocol.currents) { R.I[c][k] = all[c]; R.O[c][k] = op[c]; }
        k++;
      }
      V += dt * (Ist - INa - IKd - IM - IT - IL);
      let tau, inf;
      tau = 1 / (am + bm); inf = am * tau; m = inf + (m - inf) * exp(-dt / tau);
      tau = 1 / (ah + bh); inf = ah * tau; h = inf + (h - inf) * exp(-dt / tau);
      tau = 1 / (an + bn); inf = an * tau; n = inf + (n - inf) * exp(-dt / tau);
      pM = pinf + (pM - pinf) * exp(-dt / taup);
      u = uinf + (u - uinf) * exp(-dt / tauu);
    }
    return R;
  }

  // ---------------- ten Tusscher–Noble–Noble–Panfilov 2004 (human ventricle) --
  const C = { R: 8314.472, T: 310, F: 96485.3415, Cm: 0.185, Vc: 0.016404, Vsr: 0.001094,
    pKNa: 0.03, GbNa: 0.00029, GbCa: 0.000592, GpCa: 0.825, KpCa: 0.0005, GpK: 0.0146,
    PNaK: 1.362, KmK: 1, KmNa: 40, kNaCa: 1000, KmNai: 87.5, KmCa: 1.38, ksat: 0.1, alpha: 2.5, gamma: 0.35,
    Bufc: 0.15, Kbufc: 0.001, Bufsr: 10, Kbufsr: 0.3, taufca: 2, taug: 2, Vmaxup: 0.000425, Kup: 0.00025,
    arel: 0.016464, brel: 0.25, crel: 0.008232, Vleak: 0.00008 };
  const RTF = C.R * C.T / C.F;

  // One Rush–Larsen/Euler step of a TNNP cell (all state except V). Returns total ionic current (pA/pF).
  // P: { GNa, GCaL, Gto, GKr, GKs, GK1, Ko, Nao, Cao, sqK, epi, clampNaK }. Last currents/gates go to TN.
  const TN = { INa: 0, ICaL: 0, Ito: 0, IKr: 0, IKs: 0, IK1: 0, INaCa: 0, INaK: 0, oK1: 0 };
  function tnnpStep(c, P, dt, Ist) {
    const V = c.V, Cai = c.Cai, Nai = c.Nai, Ki = c.Ki, Ko = P.Ko, Nao = P.Nao, Cao = P.Cao;
    const ENa = RTF * log(Nao / Nai), EK = RTF * log(Ko / Ki);
    const EKs = RTF * log((Ko + C.pKNa * Nao) / (Ki + C.pKNa * Nai)), ECa = 0.5 * RTF * log(Cao / Cai);
    const INa = P.GNa * c.m * c.m * c.m * c.h * c.j * (V - ENa);
    const e2 = exp(2 * V / RTF);
    const ICaL = Math.abs(V) < 1e-4 ? P.GCaL * c.d * c.f * c.fCa * 2 * C.F * (Cai - 0.341 * Cao)
      : P.GCaL * c.d * c.f * c.fCa * 4 * V * C.F / RTF * (Cai * e2 - 0.341 * Cao) / (e2 - 1);
    const Ito = P.Gto * c.r * c.s * (V - EK);
    const IKr = P.GKr * P.sqK * c.xr1 * c.xr2 * (V - EK);
    const IKs = P.GKs * c.xs * c.xs * (V - EKs);
    const aK1 = 0.1 / (1 + exp(0.06 * (V - EK - 200)));
    const bK1 = (3 * exp(0.0002 * (V - EK + 100)) + exp(0.1 * (V - EK - 10))) / (1 + exp(-0.5 * (V - EK)));
    const oK1 = aK1 / (aK1 + bK1);
    const IK1 = P.GK1 * P.sqK * oK1 * (V - EK);
    const eg = exp(C.gamma * V / RTF), eg1 = exp((C.gamma - 1) * V / RTF);
    const INaCa = C.kNaCa * (eg * Nai * Nai * Nai * Cao - eg1 * Nao * Nao * Nao * Cai * C.alpha) /
      ((C.KmNai ** 3 + Nao ** 3) * (C.KmCa + Cao) * (1 + C.ksat * eg1));
    const INaK = C.PNaK * Ko * Nai / ((Ko + C.KmK) * (Nai + C.KmNa) * (1 + 0.1245 * exp(-0.1 * V / RTF) + 0.0353 * exp(-V / RTF)));
    const IpCa = C.GpCa * Cai / (C.KpCa + Cai);
    const IpK = C.GpK * (V - EK) / (1 + exp((25 - V) / 5.98));
    const IbNa = C.GbNa * (V - ENa), IbCa = C.GbCa * (V - ECa);
    TN.INa = INa; TN.ICaL = ICaL; TN.Ito = Ito; TN.IKr = IKr; TN.IKs = IKs; TN.IK1 = IK1; TN.INaCa = INaCa; TN.INaK = INaK; TN.oK1 = oK1;
    const Iion = INa + ICaL + Ito + IKr + IKs + IK1 + INaCa + INaK + IpCa + IpK + IbNa + IbCa;
    // Ca handling
    const Casr = c.Casr;
    const Ileak = C.Vleak * (Casr - Cai);
    const Iup = C.Vmaxup / (1 + C.Kup * C.Kup / (Cai * Cai));
    const Irel = (C.arel * Casr * Casr / (C.brel * C.brel + Casr * Casr) + C.crel) * c.d * c.g;
    const bc = 1 / (1 + C.Bufc * C.Kbufc / ((Cai + C.Kbufc) ** 2));
    const dCai = bc * (Ileak - Iup + Irel - (ICaL + IbCa + IpCa - 2 * INaCa) / (2 * C.Vc * C.F) * C.Cm);
    const bsr = 1 / (1 + C.Bufsr * C.Kbufsr / ((Casr + C.Kbufsr) ** 2));
    const dCasr = bsr * C.Vc / C.Vsr * (Iup - Irel - Ileak);
    if (!P.clampNaK) {
      c.Nai += dt * (-(INa + IbNa + 3 * INaK + 3 * INaCa) * C.Cm / (C.Vc * C.F));
      c.Ki += dt * (-(IK1 + Ito + IKr + IKs - 2 * INaK + IpK + Ist) * C.Cm / (C.Vc * C.F));
    }
    // gates (Rush–Larsen)
    const minf = 1 / ((1 + exp((-56.86 - V) / 9.03)) ** 2);
    const am = 1 / (1 + exp((-60 - V) / 5)), bm = 0.1 / (1 + exp((V + 35) / 5)) + 0.1 / (1 + exp((V - 50) / 200));
    const hinf = 1 / ((1 + exp((V + 71.55) / 7.43)) ** 2);
    let ah, bh, aj, bj;
    if (V < -40) {
      ah = 0.057 * exp(-(V + 80) / 6.8); bh = 2.7 * exp(0.079 * V) + 3.1e5 * exp(0.3485 * V);
      aj = (-2.5428e4 * exp(0.2444 * V) - 6.948e-6 * exp(-0.04391 * V)) * (V + 37.78) / (1 + exp(0.311 * (V + 79.23)));
      bj = 0.02424 * exp(-0.01052 * V) / (1 + exp(-0.1378 * (V + 40.14)));
    } else {
      ah = 0; bh = 0.77 / (0.13 * (1 + exp(-(V + 10.66) / 11.1)));
      aj = 0; bj = 0.6 * exp(0.057 * V) / (1 + exp(-0.1 * (V + 32)));
    }
    c.m = minf + (c.m - minf) * exp(-dt / (am * bm));
    c.h = hinf + (c.h - hinf) * exp(-dt * (ah + bh));
    c.j = hinf + (c.j - hinf) * exp(-dt * (aj + bj));
    const xr1inf = 1 / (1 + exp((-26 - V) / 7));
    const txr1 = 450 / (1 + exp((-45 - V) / 10)) * 6 / (1 + exp((V + 30) / 11.5));
    c.xr1 = xr1inf + (c.xr1 - xr1inf) * exp(-dt / txr1);
    const xr2inf = 1 / (1 + exp((V + 88) / 24));
    const txr2 = 3 / (1 + exp((-60 - V) / 20)) * 1.12 / (1 + exp((V - 60) / 20));
    c.xr2 = xr2inf + (c.xr2 - xr2inf) * exp(-dt / txr2);
    const xsinf = 1 / (1 + exp((-5 - V) / 14));
    const txs = 1100 / sqrt(1 + exp((-10 - V) / 6)) * 1 / (1 + exp((V - 60) / 20));
    c.xs = xsinf + (c.xs - xsinf) * exp(-dt / txs);
    const rinf = 1 / (1 + exp((20 - V) / 6)), tr = 9.5 * exp(-((V + 40) ** 2) / 1800) + 0.8;
    c.r = rinf + (c.r - rinf) * exp(-dt / tr);
    let sinf, ts;
    if (P.epi) { sinf = 1 / (1 + exp((V + 20) / 5)); ts = 85 * exp(-((V + 45) ** 2) / 320) + 5 / (1 + exp((V - 20) / 5)) + 3; }
    else { sinf = 1 / (1 + exp((V + 28) / 5)); ts = 1000 * exp(-((V + 67) ** 2) / 1000) + 8; }
    c.s = sinf + (c.s - sinf) * exp(-dt / ts);
    const dinf = 1 / (1 + exp((-5 - V) / 7.5));
    const td = (1.4 / (1 + exp((-35 - V) / 13)) + 0.25) * (1.4 / (1 + exp((V + 5) / 5))) + 1 / (1 + exp((50 - V) / 20));
    c.d = dinf + (c.d - dinf) * exp(-dt / td);
    const finf = 1 / (1 + exp((V + 20) / 7));
    const tf = 1125 * exp(-((V + 27) ** 2) / 240) + 80 + 165 / (1 + exp((25 - V) / 10));
    c.f = finf + (c.f - finf) * exp(-dt / tf);
    const fCainf = (1 / (1 + (Cai / 0.000325) ** 8) + 0.1 / (1 + exp((Cai - 0.0005) / 0.0001)) +
      0.2 / (1 + exp((Cai - 0.00075) / 0.0008)) + 0.23) / 1.46;
    const fCan = fCainf + (c.fCa - fCainf) * exp(-dt / C.taufca);
    if (!(fCainf > c.fCa && V > -60)) c.fCa = fCan;
    const ginf = Cai <= 0.00035 ? 1 / (1 + (Cai / 0.00035) ** 6) : 1 / (1 + (Cai / 0.00035) ** 16);
    const gn = ginf + (c.g - ginf) * exp(-dt / C.taug);
    if (!(ginf > c.g && V > -60)) c.g = gn;
    c.Cai = Cai + dt * dCai; c.Casr = Casr + dt * dCasr;
    return Iion;
  }
  const TNNP_INIT = { V: -86.2, Cai: 0.0002, Casr: 0.2, Nai: 11.6, Ki: 138.3, m: 0, h: 0.75, j: 0.75,
    xr1: 0, xr2: 1, xs: 0, r: 0, s: 1, d: 0, f: 1, fCa: 1, g: 1 };
  const tnnpParams = (p, cell, clampNaK) => {
    const Ko = p.Ko ?? 5.4;
    return { GNa: p.GNa, GCaL: p.GCaL, Gto: p.Gto, GKr: p.GKr, GKs: p.GKs, GK1: p.GK1, Ko, Nao: p.Nao ?? 140, Cao: p.Cao ?? 2,
      sqK: sqrt(Ko / 5.4), epi: cell !== 'endo', clampNaK: !!clampNaK };
  };

  function tnnp(p, opts = {}) {
    const P = tnnpParams(p, opts.cell, opts.clampNaK);
    const BCL = opts.BCL || 1000, beats = opts.beats || 3, out = opts.out || 1, T = opts.T || 600;
    const c = Object.assign({}, TNNP_INIT, opts.init || {});
    const N = Math.round(T / out);
    const names = ['INa', 'ICaL', 'Ito', 'IKr', 'IKs', 'IK1', 'INaCa', 'INaK'];
    const R = { t: new Float64Array(N), V: new Float64Array(N), stim: new Float64Array(N), I: {}, O: {}, C: {} };
    for (const n of names) R.I[n] = new Float64Array(N);
    for (const n of ['INa', 'ICaL', 'Ito', 'IKr', 'IKs', 'IK1']) R.O[n] = new Float64Array(N);
    for (const n of ['Cai', 'Casr', 'Nai', 'Ki']) R.C[n] = new Float64Array(N);
    let t = 0, k = 0, Vmax = -1e9, dVmax = 0; const tEnd = (beats - 1) * BCL + T, rec0 = (beats - 1) * BCL;
    while (t < tEnd - 1e-9) {
      const tb = t % BCL;
      const dt = (tb < 12 || (opts.fine && tb < 40)) ? 0.01 : 0.05;
      const Ist = (tb < 1) ? -52 : 0;
      const rec = t >= rec0 - 1e-9 && k < N && t - rec0 >= k * out - 1e-9;
      // record the state at the start of the step (gates before update)
      if (rec) {
        R.O.INa[k] = c.m * c.m * c.m * c.h * c.j; R.O.ICaL[k] = c.d * c.f * Math.min(c.fCa, 1); R.O.Ito[k] = c.r * c.s;
        R.O.IKr[k] = c.xr1 * c.xr2; R.O.IKs[k] = c.xs * c.xs;
        R.C.Cai[k] = c.Cai; R.C.Casr[k] = c.Casr; R.C.Nai[k] = c.Nai; R.C.Ki[k] = c.Ki;
      }
      const V = c.V;
      const Iion = tnnpStep(c, P, dt, Ist);
      if (rec) {
        R.t[k] = t - rec0; R.V[k] = V; R.stim[k] = Ist; R.O.IK1[k] = TN.oK1;
        for (const n of names) R.I[n][k] = TN[n];
        k++;
      }
      if (t >= rec0 - 1e-9) { if (V > Vmax) Vmax = V; const dv = -(Iion + Ist); if (dv > dVmax) dVmax = dv; }
      c.V = V - dt * (Iion + Ist);
      t += dt;
    }
    R.Vmax = Vmax; R.dVdtMax = dVmax;
    R.state = Object.assign({}, c);
    return R;
  }

  // ---------------- 1D transmural strand + pseudo-ECG (Gima & Rudy 2002 style) --
  // spec: { D (cm²/ms), L (cm), dx (cm), regions: [{ to: fraction, cell: 'endo'|'epi', p: {...}, init: state }],
  //         electrode: distance beyond the epicardial end (cm), ecgScale }; region.border scales coupling at its right edge
  // Stimulated at the endocardial end. Returns { t, V: ecg, ecg, aps:{endo,M,epi}, map, nx, mapDt, act, rep }.
  function tnnpCable(spec, opts = {}) {
    const dx = spec.dx || 0.02, L = spec.L || 1.2, nx = Math.round(L / dx), D = spec.D;
    const T = opts.T || 560, out = opts.out || 1, mapDt = opts.mapDt || 2;
    const cells = [], Ps = [], reg = new Int8Array(nx);
    for (let i = 0; i < nx; i++) {
      const fr = (i + 0.5) / nx; let r = 0; while (r < spec.regions.length - 1 && fr > spec.regions[r].to) r++;
      reg[i] = r; const R0 = spec.regions[r];
      cells.push(Object.assign({}, TNNP_INIT, R0.init || {}));
      Ps.push(R0._P || (R0._P = tnnpParams(R0.p, R0.cell, true)));
    }
    const mid = r => { let a = -1, b = -1; for (let i = 0; i < nx; i++) if (reg[i] === r) { if (a < 0) a = i; b = i; } return a < 0 ? 0 : Math.round((a + b) / 2); };
    const probe = spec.regions.map((_, r) => mid(r));
    const N = Math.round(T / out), NM = Math.round(T / mapDt);
    const R = { t: new Float64Array(N), ecg: new Float64Array(N), stim: new Float64Array(N), aps: spec.regions.map(() => new Float64Array(N)),
      map: new Float32Array(NM * nx), nx, nm: NM, mapDt, act: new Float64Array(nx).fill(NaN), rep: new Float64Array(nx).fill(NaN), probe, reg: Array.from(reg) };
    // pseudo-ECG weights: φ = -K Σ (V[i+1]-V[i]) (1/r[i+1] - 1/r[i]) / dx
    const xe = L + (spec.electrode || 2), w = new Float64Array(nx - 1);
    for (let i = 0; i < nx - 1; i++) w[i] = (1 / (xe - (i + 1.5) * dx) - 1 / (xe - (i + 0.5) * dx)) / dx;
    const K = spec.ecgScale || 1;
    const Iion = new Float64Array(nx), Vold = new Float64Array(nx);
    // coupling per interface i|i+1; spec.border = factor applied at each region boundary (e.g. reduced Cx43 at M|epi)
    const cf = new Float64Array(nx - 1);
    for (let i = 0; i < nx - 1; i++) { cf[i] = D / (dx * dx); if (reg[i] !== reg[i + 1] && spec.regions[reg[i]].border) cf[i] *= spec.regions[reg[i]].border; }
    let t = 0, k = 0, km = 0;
    while (t < T - 1e-9) {
      const dt = t < 80 ? 0.02 : 0.05;
      const stimOn = t < 2;
      if (t - k * out >= -1e-9 && k < N) {
        let phi = 0; for (let i = 0; i < nx - 1; i++) phi += (cells[i + 1].V - cells[i].V) * w[i];
        R.t[k] = t; R.ecg[k] = -K * phi; R.stim[k] = stimOn ? 1 : 0;
        for (let r = 0; r < probe.length; r++) R.aps[r][k] = cells[probe[r]].V;
        k++;
      }
      if (t - km * mapDt >= -1e-9 && km < NM) { for (let i = 0; i < nx; i++) R.map[km * nx + i] = cells[i].V; km++; }
      for (let i = 0; i < nx; i++) {
        const Ist = (stimOn && i < 3) ? -60 : 0;
        Vold[i] = cells[i].V;
        Iion[i] = tnnpStep(cells[i], Ps[i], dt, Ist) + Ist;
      }
      for (let i = 0; i < nx; i++) {
        const fl = i > 0 ? cf[i - 1] * (Vold[i - 1] - Vold[i]) : 0, fr = i < nx - 1 ? cf[i] * (Vold[i + 1] - Vold[i]) : 0;
        const Vn = Vold[i] + dt * (fl + fr - Iion[i]);
        if (isNaN(R.act[i]) && Vold[i] < -20 && Vn >= -20) R.act[i] = t;
        if (!isNaN(R.act[i]) && isNaN(R.rep[i]) && t > R.act[i] + 20 && Vold[i] >= -70 && Vn < -70) R.rep[i] = t;
        cells[i].V = Vn;
      }
      t += dt;
    }
    R.V = R.ecg;
    return R;
  }

  // ---------------- ventricular wall used by the T-wave level -------------------
  // p: { D (cm²/ms), GKsEndo, GKsM, GKsEpi, GtoEpi, GKr }. Endo 0–25 %, M 25–60 %, epi 60–100 % of a 1.2 cm strand.
  const TNNP_REF = { GNa: 14.838, GCaL: 1.75e-4, Gto: 0.294, GKr: 0.096, GKs: 0.245, GK1: 5.405 };
  const TNNP_SS = { V: -86.2797, Cai: 0.0000686, Casr: 0.486, Nai: 11.3013, Ki: 138.2946, m: 0.00137, h: 0.7725,
    j: 0.7638, xr1: 0.00067, xr2: 0.482, xs: 0.003, r: 2e-8, s: 0.99999, d: 0.0000197, f: 0.98895, fCa: 1.006, g: 0.99994 };
  const ssCache = new Map();
  function paced(p, cell) { // single-cell state at end of diastole after 4 beats at 1 Hz
    const key = cell + JSON.stringify(p);
    if (!ssCache.has(key)) { if (ssCache.size > 200) ssCache.clear(); ssCache.set(key, tnnp(p, { beats: 4, init: TNNP_SS, clampNaK: true, cell, T: 999 }).state); }
    return ssCache.get(key);
  }
  const WALL_ECG_SCALE = 1 / 24.26; // normalises the reference wall's QRS to 1
  // Healthy reference wall; levels override any of these. Ko/Nao/Cao and GNa/GCaL/GK1/GKr apply to every layer.
  const WALL_REF = { D: 0.0007, GKsEndo: 0.245, GKsM: 0.062, GKsEpi: 0.392, GtoEpi: 0.294, GKr: 0.096,
    GNa: 14.838, GCaL: 1.75e-4, GK1: 5.405, Ko: 5.4, Nao: 140, Cao: 2 };
  function wallRegions(p) {
    p = Object.assign({}, WALL_REF, p);
    const base = { GNa: p.GNa, GCaL: p.GCaL, GK1: p.GK1, GKr: p.GKr, Gto: 0.294, Ko: p.Ko, Nao: p.Nao, Cao: p.Cao };
    const defs = [
      { to: 0.25, cell: 'endo', p: Object.assign({}, base, { Gto: 0.073, GKs: p.GKsEndo }) },
      { to: 0.60, cell: 'epi', p: Object.assign({}, base, { GKs: p.GKsM }) },
      { to: 1.00, cell: 'epi', p: Object.assign({}, base, { Gto: p.GtoEpi, GKs: p.GKsEpi }) },
    ];
    for (const d of defs) d.init = paced(d.p, d.cell);
    return defs;
  }
  function tnnpWall(p, opts = {}) {
    return tnnpCable({ D: p.D ?? WALL_REF.D, L: 1.2, dx: 0.02, regions: wallRegions(p), electrode: 2, ecgScale: WALL_ECG_SCALE }, { T: opts.T || 560, out: 1, mapDt: 2 });
  }

  // Drug block on the healthy wall: q holds the remaining fraction of each current (1 = control).
  function tnnpWallScaled(q, opts) {
    const f = k => (q[k] ?? 1), W = WALL_REF;
    return tnnpWall({ GKr: W.GKr * f('Kr'), GCaL: W.GCaL * f('CaL'), GNa: W.GNa * f('Na'), GK1: W.GK1 * f('K1'),
      GKsEndo: W.GKsEndo * f('Ks'), GKsM: W.GKsM * f('Ks'), GKsEpi: W.GKsEpi * f('Ks') }, opts);
  }

  return { hh, cortical, tnnp, tnnpCable, tnnpWall, tnnpWallScaled, wallRegions, WALL_REF };
}
const MODELS = MODELS_FACTORY();

if (typeof module !== 'undefined') { module.exports = MODELS; module.exports.MODELS_FACTORY = MODELS_FACTORY; }
