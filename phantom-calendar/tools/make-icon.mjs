// Draws the Phantom Calendar icon (icons/icon.svg). An original design: a jagged
// red starburst, a tilted black calendar page with a torn corner, and a white
// domino mask. Rendered to PNGs by tests-free script tools/render-icons.js (needs Playwright).
//
//   node tools/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// a starburst with uneven spikes, so it looks cut out by hand
function burst(cx, cy, spikes, outer, inner, seed, rot) {
  let a = seed;
  const rnd = () => { a = (a * 9301 + 49297) % 233280; return a / 233280; };
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const ang = rot + (i / (spikes * 2)) * Math.PI * 2;
    const r = (i % 2 === 0 ? outer * (0.9 + rnd() * 0.1) : inner * (0.92 + rnd() * 0.12));
    pts.push((cx + Math.cos(ang) * r).toFixed(1) + ',' + (cy + Math.sin(ang) * r).toFixed(1));
  }
  return pts.join(' ');
}

const RED = '#e5191c', INK = '#0b0b0d', PAPER = '#f4f1ea';
const star = burst(256, 256, 11, 252, 168, 11, -Math.PI / 2 + 0.2);
const starInner = burst(256, 256, 11, 222, 148, 11, -Math.PI / 2 + 0.2);
// the page: a torn bottom-right corner
const page = '138,154 380,140 376,322 362,332 368,343 352,351 357,363 340,370 326,384 142,378';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Phantom Calendar</title>
  <!-- paper-white shadow, black outline, red burst -->
  <polygon points="${star}" fill="${PAPER}" transform="translate(10 12)"/>
  <polygon points="${star}" fill="${INK}"/>
  <polygon points="${starInner}" fill="${RED}"/>
  <!-- the calendar page, tilted -->
  <g transform="rotate(-11 256 266)">
    <polygon points="${page}" fill="${INK}" transform="translate(15 15)"/>
    <polygon points="${page}" fill="${INK}" stroke="${PAPER}" stroke-width="12" stroke-linejoin="miter" stroke-miterlimit="3"/>
    <!-- header strip -->
    <polygon points="144,160 374,147 373,204 144,212" fill="${PAPER}"/>
    <polygon points="144,206 373,198 373,214 144,222" fill="${RED}"/>
    <!-- binder rings -->
    <rect x="190" y="121" width="22" height="60" rx="11" fill="${INK}" stroke="${PAPER}" stroke-width="8"/>
    <rect x="302" y="115" width="22" height="60" rx="11" fill="${INK}" stroke="${PAPER}" stroke-width="8"/>
    <!-- the mask: sharp wings, sly eyes -->
    <polygon points="160,274 206,260 240,270 259,284 278,270 314,258 360,270 346,308 314,330 284,328 259,309 234,328 202,332 174,310" fill="${PAPER}"/>
    <polygon points="184,284 226,280 242,299 210,309" fill="${INK}"/>
    <polygon points="336,280 292,278 278,298 310,306" fill="${INK}"/>
  </g>
  <!-- shards flying off the torn corner -->
  <g fill="${INK}">
    <polygon points="384,356 408,366 390,382"/>
    <polygon points="360,398 384,402 366,420"/>
    <polygon points="404,318 422,326 408,338"/>
  </g>
  <!-- white glints on the red -->
  <polygon points="80,228 87,250 109,257 87,264 80,286 73,264 51,257 73,250" fill="${PAPER}"/>
  <polygon points="436,196 441,211 456,216 441,221 436,236 431,221 416,216 431,211" fill="${PAPER}"/>
</svg>
`;
fs.writeFileSync(path.join(root, 'icons', 'icon.svg'), svg);
console.log('Wrote icons/icon.svg');
