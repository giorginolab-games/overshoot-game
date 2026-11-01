# Design principles

Overshoot teaches how ion channels shape electrical activity in excitable cells. You learn by doing: adjust the channel mix until a simulated cell reproduces a recording. The principles below have guided every choice so far. They are meant to decide new cases too.

## 1. The physiology is real; the game sits on top of it

- **Targets come from published models, unmodified.** The models are Hodgkin & Huxley 1952 (squid axon), Pospischil et al. 2008 (cortical and thalamic neurons) and ten Tusscher, Noble, Noble & Panfilov 2004 (human ventricle). The game changes parameters, never the equations, to make a level work.
- **Real units everywhere.** The sliders are maximal conductances in the model's own units (mS/cm², nS/pF, ×10⁻⁴ cm³/µF/s, mM). The features are what an electrophysiologist would measure: APD90 in ms, dV/dt in V/s.
- **A slider is a density.** Maximal conductance stands for the number of channels in the membrane, which answers the question "which channel, how much?" Ion concentrations only become the tools in a level about the extracellular medium (hyperkalaemia).
- **A level is built only if the model reproduces the clinical picture.** Hyperkalaemia and Brugada ECG levels were prototyped and dropped because this model gives the wrong T wave and no coved ST segment. A level that teaches a wrong ECG is worse than no level.
- **Disease is a parameter change you can name.** Each pathology level maps to a specific molecular cause: CACNA1C gain of function, serum K⁺. Where the model can only approximate that cause, the debrief says how (Timothy syndrome as 1.8× ICaL, where the real mutation acts through inactivation).

## 2. Score like a modeller fits

- **Match features, not raw traces.** Scoring compares electrophysiological features, the approach of eFEL and BluePyOpt. Raw RMSE punishes a spike train that is shifted by a few ms and rewards nothing a physiologist cares about.
- **Each feature has a tolerance in physical units.** Its score is `100·exp(−½(Δ/tol)²)`, and the level score is the mean over features. The per-feature bars show which aspect is off, which teaches more than one global number.
- **Waveform RMS is just one more feature,** used only for single-action-potential levels.
- **Star thresholds are fixed at 70 / 85 / 95 %** across levels, so stars mean the same thing everywhere.
- **Any channel mix that matches counts as a solution (degeneracy).** The M-cell debrief turns this into the lesson (Marder & Goaillard 2006). Mystery levels must still be identifiable: no single wrong channel may reach one star, and a test enforces this.

## 3. One idea per level, in a deliberate order

- **Order:** three conductances (squid), then slow currents (adaptation), then de-inactivation (rebound burst), then many currents in sequence (myocyte). After that come the three applications: regional heterogeneity, molecular diagnosis, and electrolytes. The last two levels move from cell to tissue: the ECG as the field of a wall of cells, and then a drug-safety question asked of that ECG.
- **Every level starts clearly wrong but alive.** The starting score is below one star, and the cell still produces something to compare. A test enforces the "below one star" part.
- **Hints come in two tiers.** The free "field notes" point at concepts. The paid "lab assistant" tests every channel numerically and names the most helpful change, but caps the level at ★★. Help is always available, and mastery is still rewarded.
- **The explanation comes after the effort.** The lab-notebook debrief unlocks at ★. It explains the physiology, links it to the clinic or the history, and compares your channel mix with the original model's.

## 4. Show the mechanism, not just the result

- **Every current is visible.** Each ionic current gets its own strip under the voltage trace, so the player sees which channel acts in which phase. Inward current points down, the electrophysiology convention.
- **The magnifying lens shows the molecular scale** in slow motion:
  - Pore aperture follows open probability, which shows gating.
  - Dots crossing the membrane follow flux, which shows permeation.
  - Rotating discs show transporters.
  - +/− marks on each face of the membrane flip at the overshoot.
- **Concentrations are plotted against time on the same time base as V(t),** with a shared playhead you can scrub.
- **Tissue levels show what is inside the signal.** Under the pseudo-ECG are the action potentials at three depths and a depth–time map of membrane potential, so the player can see the activation front (QRS) and the repolarisation order (T wave) that produce it.

## 5. Honest quantities, stated assumptions

- **Fluxes are linear and calibrated.** Ions/s = |I|/(z·e) over a stated membrane area. A transporter moves its full stoichiometry for each net charge it carries.
- **Dot rate is independent of playback speed.** Dots per screen-second = flux × slow-motion factor ÷ ions per dot, so the number of dots that cross equals the real number of ions moved at any playback speed.
- **The scale is always on screen:** ions per dot, the membrane area, and the current slow-down factor. A log scale was tried first and rejected because it hid how fluxes change.
- **Derived quantities are labelled as derived.** Neuron concentration changes are estimated from integrated currents and an explicit geometry. Cardiac concentrations come from the model's own state variables. The panel text says which.
- **Simplifications are disclosed where the player meets them:** the page footer, the lens notes, the debriefs, and the README.

## 6. Responsive enough to feel like an instrument

- **Each simulation must finish within about 40 ms,** so the result updates while the slider is still moving (one run per animation frame).
- **Tissue is the exception.** The T-wave strand takes about 0.7 s per run, so it runs in a Web Worker built from the same model source. The sliders never freeze; while a run is in progress a "Simulating…" pill shows, and only the latest slider position is simulated next.
- **Choices that buy that speed without changing the physiology the player sees:**
  - Rush–Larsen gates with forward Euler.
  - Adaptive dt in the cardiac model: 0.01 ms during the upstroke, 0.05 ms otherwise.
  - Steady-state initial conditions and two paced beats.
  - Intracellular Na⁺/K⁺ clamped during play. The lens run lets them evolve.

## 7. One file, no dependencies, no server

- **The page is a single self-contained HTML file** with no libraries. Google Fonts is the only network request, with system fallbacks.
- **It runs as a Claude artifact, from GitHub Pages, or opened from disk,** unchanged.
- **Progress is stored per browser in localStorage,** wrapped in try/catch so the page still works when storage is blocked. The storage key predates the rename and is kept on purpose.

## 8. A visual language taken from the lab

- **ECG-paper scope:** pink grid on warm white, with major and minor divisions. The target is a dashed grey trace with a little recording noise; your cell is an ink-blue trace.
- **Fixed colour codes, used everywhere a current appears** (rack, current strips, lens):

  | Current(s) | Colour |
  |---|---|
  | Na⁺ | orange |
  | Ca²⁺ | green |
  | Ito | magenta |
  | IKr | violet |
  | IKs and IM | blue |
  | IK1 and the delayed rectifiers | teal |
  | leak | grey |
  | NCX | ochre |
  | pump | taupe |

  Ions have their own colours (Na⁺ orange, K⁺ blue, Ca²⁺ green).
- **Typography:** Bricolage Grotesque for display, Atkinson Hyperlegible for body text (chosen for legibility in teaching), JetBrains Mono for numbers and units.
- **Light and dark themes are designed separately, not inverted.** All colours are CSS tokens.
- **Phones get the same game.** On narrow screens the layout stacks in the order brief → scope → score → rack → features → notebook, and the page never scrolls sideways.

## 9. Tests protect the design, not just the code

`npm test` checks the physiology and the level design together:

- **Physiology:**
  - HH overshoot and undershoot.
  - Ventricular resting potential and APD90.
  - Ca²⁺ entry per beat stays within 10–20 µM.
- **Level design:**
  - Every target scores 100.
  - Every starting point scores below one star.
  - The mystery level cannot be solved with a single wrong channel.

A change that breaks a teaching guarantee fails CI and is not deployed.
