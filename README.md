# Overshoot

A browser game for learning how ion channels shape action potentials. Each level shows a target recording; you tune the density (maximal conductance) of each channel type until your simulated cell reproduces it. A "magnifying lens" replays your cell in slow motion, with ions crossing the membrane at their physiological rate.

Everything runs client-side in a single HTML file with no dependencies.

**Play it:** https://tonigi.github.io/overshoot-game/

## Levels

| # | Level | Model | Tools |
|---|---|---|---|
| 1 | Squid giant axon | Hodgkin & Huxley 1952 | Na⁺, K⁺, leak |
| 2 | Cortical pyramidal cell (regular spiking) | Pospischil et al. 2008 | Nav, Kv2, Kv7 (M-current), leak |
| 3 | Thalamic neuron (rebound burst) | Pospischil et al. 2008 | Nav, Kv2, Cav3.1 (T-type), leak |
| 4 | Human ventricular myocyte, epicardium | ten Tusscher, Noble, Noble & Panfilov 2004 | Nav1.5, Cav1.2, Kv4.3, hERG, KCNQ1, Kir2.1 |
| 5 | Mid-myocardial M cell | same | same (lesson: parameter degeneracy) |
| 6 | Mystery patient: long QT | same | same (Timothy syndrome, Cav1.2 gain of function) |
| 7 | Electrolyte emergency | same | extracellular K⁺, Na⁺, Ca²⁺ (hyperkalaemia) |
| 8 | The T wave | 60 TNNP cells in a 1.2 cm transmural strand + pseudo-ECG (Gima & Rudy 2002) | Cx43 coupling, IKs per layer (endo/mid/epi), epicardial Ito, hERG |
| 9 | The hERG paradox | same wall, drug block | remaining Cav1.2, Nav1.5, KCNQ1, Kir2.1 current (hERG fixed at 40 %): verapamil-like multichannel block, the CiPA lesson |

Scoring compares electrophysiological features (resting potential, overshoot, max dV/dt, notch depth, APD50/90, spike count, adaptation, burst latency; QRS width, T amplitude, QT and Tpeak–Tend for the ECG level) plus waveform RMS error. Stars at 70 / 85 / 95 %.

## Magnifying lens

- Channels drawn in a bilayer; pore aperture follows open probability.
- Ion dots are calibrated: ions/s = |I| / (z·e) over a stated membrane area (100 µm² squid patch, 20 µm soma, or the whole 185 pF myocyte); transporters move 3 Na⁺/2 K⁺ (pump) or 3 Na⁺/1 Ca²⁺ (NCX) per net charge. Dots per screen-second = real flux × slow-motion factor ÷ ions per dot, so the dots crossing equal the true ion count.
- Time control: play forwards or backwards, step, jump between events, or scrub on any plot or the time slider. When paused, time is frozen but ions keep flowing at that instant's rate.
- Time-synced events: channel state changes (opens, closes, inactivates, reopens), voltage and concentration landmarks, and each level's defining moments (cardiac phases 0–4, adaptation, rebound burst), shown as a caption, a clickable list and ticks on V(t).
- Concentration traces: model state variables for the myocyte ([Ca²⁺]ᵢ, [Ca²⁺]SR, Δ[Na⁺]ᵢ, Δ[K⁺]ᵢ); for neurons, estimates from integrated currents and the stated geometry (Destexhe-style 1 µm Ca²⁺ shell for the thalamic cell).

## Layout

```
src/models.js   ionic models (HH 1952, Pospischil 2008, TNNP 2004), 1D cable + pseudo-ECG; Rush–Larsen + forward Euler
src/core.js     levels, feature extraction, scoring, lens metadata
src/lens.js     slow-motion membrane view
src/app.js      game UI
src/shell.html  markup and styles (placeholders are filled by build.js)
build.js        inlines everything into dist/overshoot.html
test/           regression checks on model outputs and level design
```

## Build and test

```bash
npm run build   # writes dist/overshoot.html
npm test        # model and level regression checks
```

Open `dist/overshoot.html` in any modern browser.

Every push to `main` runs the tests, builds the page and deploys it to GitHub Pages (`.github/workflows/pages.yml`). One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

## Documentation

- [docs/DESIGN.md](docs/DESIGN.md): design principles
- [docs/HANDOFF.md](docs/HANDOFF.md): current state, decisions and their reasons, open items

## Modelling notes

- Cardiac levels hold intracellular Na⁺ and K⁺ at their 1 Hz steady state and score the second paced beat, which keeps each simulation at ~35 ms so the sliders stay interactive. The lens run lets Na⁺/K⁺ evolve over that beat.
- Timothy syndrome is approximated as 1.8× L-type conductance; the real G406R mutation mainly removes voltage-dependent inactivation.
- Targets are model simulations with added noise, not experimental recordings.
- The T-wave level uses epicardial GKs = 0.392 nS/pF (the ten Tusscher & Panfilov 2006 value) and D = 0.0007 cm²/ms (about 46 cm/s transmural conduction). With the 2004 model's uniform IKs, realistic conduction gives an inverted T wave. Tissue runs take about 0.7 s and happen in a Web Worker.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Versioning

Semantic Versioning. The version in `package.json` is shown in the page footer; see `CHANGELOG.md`.
To release: update `CHANGELOG.md`, run `npm version <patch|minor|major>` (bumps `package.json`, rebuilds `dist/`, commits, tags `vX.Y.Z`), then push with `--follow-tags`.
