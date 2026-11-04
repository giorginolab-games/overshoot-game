# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
The version lives in `package.json` (single source of truth) and is shown in the page footer.

## [Unreleased]

## [0.7.0] - 2026-11-04
### Added
- Lens: ion buckets. One bucket per species inside the cell (Na⁺, K⁺, Ca²⁺, and the SR store in the myocyte), filled to the present concentration, with a zoom tube that magnifies the change around the starting value. Defined per level in the lens JSON (`buckets`).
- Lens: gate curves drawn vertically under each channel of the membrane view, with V on a shared vertical axis. One horizontal line at the present V crosses every curve at that channel's own threshold; ring and marker show where each gate is heading and where it is.

## [0.6.0] - 2026-11-04
### Added
- Level 2: voltage clamp. Twelve steps of the HH squid axon recorded in low-sodium sea water; match the current family and the early/late I–V curves, and find [Na⁺]o from the shift of the early-current reversal (Nernst). New `hhStep`/`hhClamp` models.
- Levels that already have stars stay unlocked when new levels are inserted before them.
- Lens: scrub time in both directions (time slider, drag on any plot, step and reverse-play buttons, keyboard: arrows, `,` `.`, Space, Home/End).
- Lens: time-synced events, with a caption, a clickable event list and ticks on V(t). Channel state changes (opens, closes, inactivates, reopens), voltage and concentration landmarks, and level-defining moments (cardiac phases 0–4, M-current adaptation, T-channel recovery and rebound burst, undershoot). The channel named by the current event is outlined on the membrane.
- Lens: "Gates and thresholds" panel. Per voltage-gated channel, steady-state activation (solid) and availability (dashed) against V, half-way voltages, the present V, and each gate's actual value versus where it is heading, so the nonlinear (m³, n⁴) and delayed (τ) response is visible; threshold lines on V(t) turn solid when V crosses them. Each plot also has a log-scale τ(V) curve for the activation and inactivation gates, with the present values. Models now record gate traces (`R.G`) and steady-state curves (`R.GC`).
- Lens: when paused, ions keep flowing at the instantaneous rate (frozen time, live flux).

### Changed
- Steady-state gate values of the ten Tusscher model moved into `tnnpInf` (same equations, shared with the lens curves); the τ expressions are in `tnnpTau`, checked against the integrator by a test.
- Cardiac lens runs sample every 0.1 ms (was 1 ms) so the upstroke events resolve.

### Fixed
- Lens could open paused when the first animation frame's timestamp preceded the open time.

## [0.5.0] - 2026-11-01
### Added
- Version shown in the footer, stamped at build time; `CHANGELOG.md`; `npm version` release flow.
- Level 9: the hERG paradox. A multichannel drug (hERG fixed at 40 %, find the Cav1.2 block) shows why hERG block alone does not predict QT prolongation (CiPA).
- Locked tools: shown in the rack but not adjustable.

### Changed
- The ventricular wall model takes global overrides (GNa, GCaL, GK1, Ko, Nao, Cao) on top of a healthy reference wall; new `tnnpWallScaled` for drug block.

## [0.4.0] - 2026-11-01
### Added
- Level 8: the T wave (transmural strand and pseudo-ECG).

## [0.3.0] - 2026-11-01
### Added
- Ion-channel action potential game with Hodgkin–Huxley, Pospischil and ten Tusscher models.
- Lens view with calibrated ion fluxes.
- GitHub Pages deployment, design principles and handoff notes, Apache-2.0 license.

### Changed
- Project renamed to Overshoot.
