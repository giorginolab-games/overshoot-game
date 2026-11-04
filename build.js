// Inline the sources into a single self-contained page: dist/overshoot.html
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const version = require('./package.json').version;
let html = src('shell.html').replace('/*VERSION*/', version);
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'levels', f), 'utf8'));
const levelsData = { shared: rd('shared.json'), levels: rd('index.json').map(rd) };
for (const [k, f] of [['LEVELSDATA', null], ['MODELS', 'models.js'], ['CORE', 'core.js'], ['LENS', 'lens.js'], ['APP', 'app.js']]) {
  html = html.replace(`/*${k}*/`, () => f ? src(f) : 'const LEVELS_DATA = ' + JSON.stringify(levelsData).replace(/</g, '\\u003c') + ';');
}
// Standalone document wrapper (the Claude artifact host adds this itself)
const page = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head><body>\n${html}\n</body></html>\n`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'overshoot.html'), page);
console.log('wrote dist/overshoot.html v' + version, (page.length / 1024).toFixed(0) + ' KiB');
