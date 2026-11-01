# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
The version lives in `package.json` (single source of truth) and is shown in the page footer.

## [Unreleased]
### Added
- Lens: scrub time in both directions (time slider, drag on any plot, step and reverse-play buttons, keyboard: arrows, `,` `.`, Space, Home/End).
- Lens: time-synced events, with a caption, a clickable event list and ticks on V(t). Channel state changes (opens, closes, inactivates, reopens), voltage and concentration landmarks, and level-defining moments (cardiac phases 0–4, M-current adaptation, T-channel recovery and rebound burst, undershoot). The channel named by the current event is outlined on the membrane.
- Lens: when paused, ions keep flowing at the instantaneous rate (frozen time, live flux).

### Changed
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
