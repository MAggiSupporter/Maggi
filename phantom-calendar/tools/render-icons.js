// Renders icons/icon.svg to PNGs in several sizes (needs Playwright + Chromium).
//   node tools/render-icons.js
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const SIZES = [512, 192, 180, 64, 32];
(async () => {
  const dir = path.join(__dirname, '..', 'icons');
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const b = await chromium.launch();
  for (const s of SIZES) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent('<html><body style="margin:0;background:transparent">' + svg.replace('width="512" height="512"', 'width="' + s + '" height="' + s + '"') + '</body></html>');
    await p.screenshot({ path: path.join(dir, 'icon-' + s + '.png'), omitBackground: true });
    await p.close();
  }
  // a preview sheet: the icon at real sizes on light and dark backgrounds
  const p = await b.newPage({ viewport: { width: 760, height: 432 } });
  const img = (s) => '<img src="data:image/png;base64,' + fs.readFileSync(path.join(dir, 'icon-' + (s > 192 ? 512 : s >= 180 ? 180 : s > 64 ? 192 : s > 32 ? 64 : 32) + '.png')).toString('base64') + '" width="' + s + '" height="' + s + '">';
  const row = (bg) => '<div style="display:flex;gap:24px;align-items:center;padding:18px;background:' + bg + '">' + [180, 96, 64, 32, 16].map(img).join('') + '</div>';
  await p.setContent('<body style="margin:0">' + row('#f2f2f2') + row('#1d1d22') + '</body>');
  await p.screenshot({ path: process.env.ICON_PREVIEW || path.join(require('node:os').tmpdir(), 'icon-preview.png') });
  await b.close();
  console.log('Rendered ' + SIZES.map((s) => 'icon-' + s + '.png').join(', '));
})();
