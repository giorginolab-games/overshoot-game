# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
The version lives in `package.json` (single source of truth) and is shown in the page footer.

## [Unreleased]

## [0.7.8] - 2026-11-04
### Changed
- Lens: the "i" explanations are now popovers anchored under their button (no layout jump); they close on a second click, a click elsewhere, Esc, or opening the other one.

## [0.7.7] - 2026-11-04
### Added
- Version number shown next to the author credit at the top of the page.

## [0.7.6] - 2026-11-04
### Changed
- Lens: one "i" button per explanation (next to the legend for the gate-curve and bucket plots, and next to "Gates and thresholds"), replacing the single header button.

## [0.7.5] - 2026-11-04
### Added
- Author credit (Toni Giorgino, www.giorginolab.it, CNR-IBF) at the top right of the page.
### Changed
- Lens: the two long plot explanations are hidden behind an "i" button in the lens header.

## [0.7.4] - 2026-11-04
### Changed
- Thalamic level: labelled as a ferret model (after Destexhe et al. 1996); its channel links remain the reviewed human UniProt entries and are marked as human references, since UniProt has no reviewed ferret entries.

## [0.7.3] - 2026-11-04
### Added
- Rat pyramidal-neuron level: channel gene names link to the reviewed rat UniProt entries (P04775, O88420, P15387, O88943, O88944) instead of the human ones. Channel JSON accepts a `uniprot` list of `{text, id}` for non-human species.

## [0.7.2] - 2026-11-04
### Changed
- Lens: ion buckets moved under the channels that carry each ion (Na⁺ under Nav, Ca²⁺ under Cav, K⁺ under the K⁺ channels), with a wrapped grid on narrow screens; the vertical gate curves are labelled closed (left) and open (right), inactivated and available for the dashed curve.

## [0.7.1] - 2026-11-04
### Added
- Squid levels: the Nav and sqKv1A channel names link to their UniProt entries (Q05973, Q25376), as the human gene symbols already do.

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
