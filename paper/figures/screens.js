// Screenshots of the game for the paper (run from repo root after `npm run build`)
const { chromium } = require('playwright'), path = require('path');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1300, height: 1180 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await pg.goto('file://' + path.resolve(__dirname, '../../dist/overshoot.html')); await pg.waitForTimeout(400);
  await pg.click('#unlockAll'); await pg.click('.lv:nth-child(4)'); await pg.waitForTimeout(300);
  // a partly solved state: Ca and K1 corrected, Ito and hERG still off
  await pg.evaluate(() => { const L = CORE.LEVELS[3]; const set = (k, v) => { const t = L.tools.find(x => x.k === k), el = document.getElementById(`sl-epi-${k}`); el.value = Math.log(v / t.min) / Math.log(t.max / t.min) * 1000; el.dispatchEvent(new Event('input')); };
    set('GCaL', 1.75e-4); set('GK1', 5.405); });
  await pg.waitForTimeout(400);
  await pg.evaluate(() => { document.querySelector('.toast').style.display = 'none'; window.scrollTo(0, 0); });
  await pg.screenshot({ path: path.join(__dirname, 'fig_game.png'), clip: { x: 30, y: 0, width: 1240, height: 1180 } });
  await pg.click('#lensOpen'); await pg.waitForTimeout(4200); await pg.click('#lensPlay'); await pg.waitForTimeout(200);
  const box = await pg.$('.lens-box'); const bb = await box.boundingBox();
  await pg.screenshot({ path: path.join(__dirname, 'fig_lens.png'), clip: { x: bb.x, y: bb.y, width: bb.width, height: Math.min(bb.height, 760) } });
  console.log('screens written'); await b.close();
})();
