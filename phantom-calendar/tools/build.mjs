// Bundles src/ into ONE file, apps-script/Index.html, the file you paste into
// Google Apps Script. Opened directly in a browser, the same file runs in demo mode.
//
//   node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');

let html = read('index.html');

html = html.replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + read('styles.css') + '</style>');

html = html.replace(/(?:<script src="js\/[\w-]+\.js"><\/script>\n?)+/, (block) => {
  const files = [...block.matchAll(/src="(js\/[\w-]+\.js)"/g)].map((m) => m[1]);
  const js = files.map((f) => '/* ---------- ' + f + ' ---------- */\n' + read(f)).join('\n');
  if (/<\/script/i.test(js)) throw new Error('A script contains "</script" and would break the page.');
  return '<script>\n' + js + '</script>\n';
});

if (/src="js\//.test(html) || html.includes('href="styles.css"')) throw new Error('Something was not inlined.');

const banner = '<!-- PHANTOM CALENDAR — paste this whole file into an Apps Script HTML file named "Index".\n' +
  '     Built from src/ by tools/build.mjs. Opened directly in a browser it runs in demo mode. -->\n';
html = html.replace('<!doctype html>\n', '<!doctype html>\n' + banner);

const out = path.join(root, 'apps-script', 'Index.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + ' KB)');
