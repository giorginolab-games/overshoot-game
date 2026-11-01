# Paper: Overshoot (draft for European Journal of Physics)

`overshoot.tex` is a 10-page manuscript draft describing the game. It uses the standard
article class with IOP's `iopart-num` bibliography style; move it to the IOP `iopart`
template (author kit from the journal) before submission.

## Rebuild figures and PDF

From the repository root:

```bash
npm run build                      # dist/overshoot.html, used for the screenshots
node paper/figures/export.js       # model traces -> paper/figures/traces.json
python3 paper/figures/plot.py      # fig_targets.pdf, fig_currents.pdf, fig_ecg.pdf (needs matplotlib)
node paper/figures/screens.js      # fig_game.png, fig_lens.png (needs Playwright + Chromium)
cd paper && pdflatex overshoot && bibtex overshoot && pdflatex overshoot && pdflatex overshoot
```

Every number in the text and tables comes from these scripts or from `npm test`.

## Before submission

- Check the affiliation and the AI-assistance statement in the acknowledgements.
- Verify each reference against the original (they were entered by hand).
- The classroom-evaluation gap is stated as a limitation; add data if available.
