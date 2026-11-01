# Handoff

State of the project as of 2026-11-01 (v0.5: T-wave and hERG-paradox levels), written for whoever picks it up next: you, a collaborator, or a new Claude session. Read [DESIGN.md](DESIGN.md) first for the principles. This document covers what exists, why it is the way it is, and what is still open.

## Where things are

| What | Where |
|---|---|
| Source repository | https://github.com/tonigi/overshoot-game (`main`) |
| GitHub Pages (once enabled) | https://tonigi.github.io/overshoot-game/ |
| Claude artifact (private, owner's account) | https://claude.ai/artifact/8PuveLp1usKMiZnpZK5BHJ |
| Deploy workflow | `.github/workflows/pages.yml` |

The artifact is published by hand from the same `src/` files. It is the inlined `shell.html` without the `<!doctype>` wrapper that `build.js` adds, because the artifact host adds its own. GitHub Pages is the canonical public build.

## How to work on it

```bash
npm test        # 38 regression checks, ~40 s
npm run build   # writes dist/overshoot.html (single file, ~110 KiB)
```

There are no dependencies. Node 20 or later is enough. Open `dist/overshoot.html` in a browser to play.

**Versioning.** Semantic versioning, with the version in `package.json` stamped into the page footer at build time. Record changes under `[Unreleased]` in `CHANGELOG.md`. To release, move them under a new version heading, run `npm version <patch|minor|major>` (bumps, rebuilds `dist/`, commits and tags), then `git push --follow-tags`. Don't bump `package.json` by hand.

## Architecture

```
src/models.js  MODELS_FACTORY() → { hh, cortical, tnnp, tnnpCable, tnnpWall }
               cell runs → { t, V, stim, I:{current→array}, O:{current→open prob}, C:{conc→array}, Vmax, dVdtMax, state }
               tnnpStep(cell, P, dt, Ist) is the single TNNP update shared by tnnp() and tnnpCable()
               tnnpWall(p) → { t, V=ecg, aps:[endo,mid,epi], map (depth×time V), act, rep, probe }   (p overrides WALL_REF)
               tnnpWallScaled(q): drug block, q = remaining fraction per current {Kr, CaL, Na, Ks, K1}
src/core.js    CORE.LEVELS[]: tools (sliders), target/start params, sim(), feats(), tol{}, view, texts, lens{}
               CORE.evaluate(level, R, T) → { score, rows[] };  CORE.starsFor(score)
src/app.js     game UI: level strip, rack, scope + current strips (canvas), scorecard, features, notebook, assistant
src/lens.js    LENS_UI.open(level, params): animated membrane, V(t) scrubber, concentration strips
src/shell.html markup + CSS tokens; /*MODELS*/ /*CORE*/ /*LENS*/ /*APP*/ placeholders filled by build.js
```

**Data flow.** Moving a slider changes `p[k]`. On the next animation frame, `simulate(L, p)` runs: synchronously for single cells, or in a Web Worker for levels with `async: 'tnnpWall'`. The worker is built from `MODELS_FACTORY.toString()`, so it needs no separate file. Only one run is in flight at a time; a slider change during a run marks the state dirty, and the latest parameters run next. The run returns `R`. `evaluate(L, R, T)` compares it with the target trace `T`, which is computed once per level from `L.target`. The UI then redraws, stars are awarded, and progress is saved to localStorage.

**Adding a level.** Append an object to `LEVELS` in `src/core.js`. It needs:
- `tools`, with `k`, `min`, `max`, `unit`, `col`, and `lin` for linear sliders;
- `target` and `start` parameter sets;
- `sim`, `feats` and `tol`;
- `view` (axes);
- the texts `brief`, `hint0` and `debrief`;
- optionally `async: '<MODELS function>'` (runs in the worker), `panel: 'wall'`, and `locked: true` on a tool shown but not adjustable;
- an entry in the `LENS` map: `pA` (model-current-to-pA factor), `scope`, `speeds`, `ions()`, `conc()` and `note`.

Then add the level's guarantees to `test/models.test.js`. The generic checks (target scores 100, start below one star) already loop over all levels.

## Decisions and their reasons

| Decision | Why | Alternatives considered |
|---|---|---|
| Sliders set maximal conductance (channel density), not ion concentrations | Answers the question "which channel, how much?" Concentrations get their own level (hyperkalaemia) | Concentrations everywhere: rejected, they don't map onto channel types |
| HH 1952, Pospischil 2008, TNNP 2004 | Classic, compact, well known, fast enough for JS at interactive rates | O'Hara–Rudy 2011: better hERG sensitivity, but ~3× the state variables. Planned as an upgrade |
| Feature-based scoring, Gaussian per feature, mean over features | How modellers fit, robust to spike-timing jitter, explains what is wrong | Pure RMSE: brittle for spike trains |
| Stars at 70/85/95 % | Same meaning across levels. Starting points are tuned to 8–62 % | Per-level thresholds: harder to understand |
| Mystery level is Timothy syndrome (ICaL ×1.8), not drug-induced hERG block | In TNNP 2004, IKr has little effect (GKr ×0.15 adds only ~35 ms to APD90). Lowering IKs fit a hERG-block target better (91 %) than the true answer, so the puzzle was unidentifiable. Timothy raises the plateau, which K⁺ block cannot, and the best single wrong channel reaches 69 % | hERG block (rejected for the reason above), LQT1 (same answer as the M-cell level) |
| M cell is GKs ×0.25 | The original model's M-cell definition. Used to teach degeneracy | — |
| Cardiac play runs clamp Na⁺ᵢ/K⁺ᵢ, start from 1 Hz steady state, and score beat 2 | ~35 ms per run, so sliders feel live. Concentration drift is negligible over two beats | Long pacing to true steady state: seconds per run |
| Lens fluxes are linear and calibrated (ions/s = abs(I)/ze), dots per screen-second scale with the slow-motion factor | Requested: "stay true to the physiological numbers". Dots crossing equal real ion counts at any speed | A log scale (first version) hid the dynamics |
| Ions per dot chosen automatically (~500 dots for the busiest current per run), with ×1, ×5 and ×20 density chips | Keeps the plateau visible without flooding the upstroke. The scale is always shown | Fixed N per level |
| Lens "slow down on fast events" (speed ÷ (1 + 30·abs(dV/dt)/max)) | Otherwise the cardiac upstroke (~1 ms) passes in a single frame | Manual speed only |
| Assistant caps the level at ★★ | Help is always available, and unaided solutions are still rewarded | Hint cost in points: more UI for no extra teaching value |
| Name "Overshoot" (was "Excitable") | Owner's choice. The localStorage key `excitable-progress-v1` is kept so saved progress survives | — |
| Single-file build, no dependencies | Runs as an artifact, on Pages, or offline from disk | Bundler and framework: unnecessary for ~1,300 lines |
| Apache-2.0 license | Owner's choice | — |
| Level 9 is a multichannel drug (hERG 40 % + Cav1.2 70 %), with sliders as % of control current, block only (≤ 100 %), and hERG locked | hERG alone gives QT +26 ms; adding Cav1.2 block restores QT (294 vs 296 ms). With block-only sliders no single wrong channel reaches a star (tested). An earlier draft allowed > 100 %, and "IKs ×1.5" then scored 70.7 % | Free hERG slider: raising hERG back to 100 % mimicked the trial ECG |
| Hyperkalaemia and Brugada ECG levels dropped | Tested on the wall: high Ko widens the QRS (26 → 38 ms at 8.5 mM) but shrinks the T wave instead of peaking it. The epicardial dome never collapsed (Gto up to 2.2, GNa ×0.5, GCaL ×0.6), so no coved ST elevation. Levels must not teach a wrong ECG | A newer model (O'Hara–Rudy) may reproduce both |
| T-wave level: 1D transmural strand (60 cells, dx = 0.2 mm, 1.2 cm), pseudo-ECG with the electrode 2 cm beyond the epicardium | The standard minimal model of the T wave (Gima & Rudy 2002). It answers the project's founding question about ECG shapes | 2D/3D tissue: far too slow in the browser |
| Epicardial GKs 0.392 (TNNP 2006 value) and D = 0.0007 cm²/ms | With uniform 2004 IKs and realistic conduction (~46 cm/s), activation delay exceeds the APD gradient and T inverts. A border coupling reduction (Cx43 at M/epi) was tried and barely mattered | Reduced M/epi border coupling (kept in `tnnpCable` as `region.border`, unused) |
| Tissue runs in a Web Worker built from the model source | ~0.7 s per run would freeze the sliders | Run only on slider release: rejected, it loses the live feel |
| T-wave tolerances looser (tAmp 0.04, QT 8 ms) | T amplitude is very sensitive to epicardial APD. Coupling alone reaches 68.7 %, just below one star, so the gradient must be found | Tighter tolerances: frustrating, non-monotone landscape |

## Validated numbers (all reproduced by the code)

| Quantity | Value |
|---|---|
| HH 1952 overshoot / undershoot | +39.3 mV / −76.2 mV |
| TNNP epicardial resting potential / APD90 / max dV/dt | −86.3 mV / 271 ms / ~377 V/s |
| TNNP M cell (GKs ×0.25) APD90 | 320 ms |
| TNNP hyperkalaemia, Ko = 8 mM | rest −76 mV, peak +23 mV, APD90 252 ms |
| Ca²⁺ entry through ICaL per beat | 1.7×10⁸ ions ≈ 17 µM of cytosol (literature 10–20 µM) |
| Cytosolic Ca²⁺ transient / SR Ca²⁺ | 0.07 → 0.96 µM / 0.35–0.51 mM |
| Na⁺ entry per squid spike (HH) | ~9×10⁴ ions/µm² ≈ 15 pmol/cm². Measured is 3–4 pmol/cm²; the HH model's Na⁺/K⁺ overlap is known to overestimate it |
| Thalamic rebound submembrane Ca²⁺ (1 µm shell) | 0.24 → ~7 µM |
| T-wave wall (target) | QRS 26 ms, T/QRS 0.21 upright, QT 296 ms, Tpeak–Tend 23 ms, APD endo/mid/epi 283/282/253 ms |
| Uniform wall (start) | QRS 15 ms, T/QRS −0.08 (inverted) |
| Wall with hERG 40 % / hERG 40 % + Cav1.2 70 % | QT 322 / 294 ms (control 296 ms) |

## Open items

1. **Enable GitHub Pages.** In Settings → Pages, set Source to **GitHub Actions**, then re-run the failed workflow run (it failed only at `configure-pages`; tests and build passed).
2. **Stale branch** `gh-pages-action` on GitHub. It points at the same commit as the first workflow commit and can be deleted from the Branches page.
3. **Commit identity.** Early commits carry the cloud environment's default git identity. Rewrite them if authorship matters.
4. **Copyright holder** in `NOTICE` is set to the repository owner. Change it to the institution if required.

## Known limitations

- **TNNP 2004 underweights hERG.** This limits drug-safety (CiPA-style) levels until an O'Hara–Rudy model is added.
- **Timothy syndrome is modelled as extra conductance** rather than lost voltage-dependent inactivation.
- **Neuron concentrations are estimates** from integrated currents and a stated geometry. There is no Ca²⁺ or Na⁺ feedback on reversal potentials in the neuron models.
- **The T-wave strand is 1D.** Its QRS is the transmural activation only, with a small stimulus artefact at t ≈ 2 ms. QT is shorter than a clinical QT because the cells are paced at 1 Hz from a 2004 model with a short APD.
- **The lens on the T-wave level shows one uncoupled epicardial cell** with the wall's channel densities, not a cell inside the strand.
- **The lens caps on-screen particles at 2,600.** Very fast playback of the upstroke at the finest dot density drops the oldest dots.
- **Canvas views have `aria-label`s but no text alternative** for the trace data. Keyboard: sliders, buttons, Esc and Space in the lens.
- **Progress is per-browser only.** There are no accounts and no class dashboard.

## Ideas not yet built

- An O'Hara–Rudy 2011 human ventricle (drug block, CiPA), a sinoatrial node pacemaker (I_f), and an atrial cell (Courtemanche).
- More ECG levels: pure drug-induced long QT (dofetilide) works on the current wall (QT 296 → 330 ms at 75 % hERG block). Hyperkalaemia (peaked T) and Brugada (coved ST) need a different cell model (see Decisions).
- Voltage-clamp levels: identify a channel from its I–V curve.
- Stochastic single-channel mode in the lens: discrete open/closed channels at real densities.
- Rate-dependence levels (APD restitution) and multi-protocol fitting to show how degeneracy is resolved.
- A teacher mode: a shareable level link, and class progress via a shared store.
