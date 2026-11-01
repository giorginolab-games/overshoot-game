# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
The version lives in `package.json` (single source of truth) and is shown in the page footer.

## [Unreleased]

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
