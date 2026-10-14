'use strict';
/* =========================================================================
   util.js — DOM helpers, dates, colours, text
   ========================================================================= */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** Tiny element builder: h('div', {class: 'x', onclick: fn}, 'text', child) */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const sk of Object.keys(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]);
          else el.style[sk] = v[sk];
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendKids(el, kids);
  return el;
}

function appendKids(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/* ---------- icons (static, trusted SVG) ---------- */
const ICONS = {
  prev: '<path d="M15 3 5 12l10 9 2-3-7-6 7-6z"/>',
  next: '<path d="M9 3l10 9-10 9-2-3 7-6-7-6z"/>',
  search: '<path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-2.1 2.1-5.4-5.4A8 8 0 1 1 10 2zm0 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/>',
  gear: '<path d="m12 1 2.2 3.1 3.7-1 .4 3.8 3.5 1.6-1.6 3.5 1.6 3.5-3.5 1.6-.4 3.8-3.7-1L12 23l-2.2-3.1-3.7 1-.4-3.8-3.5-1.6L3.8 12 2.2 8.5l3.5-1.6.4-3.8 3.7 1zm0 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>',
  menu: '<path d="M2 4h20l-1 4H1zm1 6h20l-1 4H2zm-1 6h20l-1 4H1z"/>',
  soundOn: '<path d="M3 9h4l6-5v16l-6-5H3zm13.5-1.5a6 6 0 0 1 0 9l-1.6-1.6a3.8 3.8 0 0 0 0-5.8zm2.8-2.8a10 10 0 0 1 0 14.6l-1.5-1.5a7.9 7.9 0 0 0 0-11.6z"/>',
  soundOff: '<path d="M3 9h4l6-5v16l-6-5H3zm12.3.1 1.4-1.4 2.3 2.3 2.3-2.3 1.4 1.4-2.3 2.3 2.3 2.3-1.4 1.4-2.3-2.3-2.3 2.3-1.4-1.4 2.3-2.3z"/>',
  close: '<path d="m5 2 7 7 7-7 3 3-7 7 7 7-3 3-7-7-7 7-3-3 7-7-7-7z"/>',
  edit: '<path d="m16 2 6 6L9 21H3v-6zm0 4.2L6 16.2V18h1.8l10-10z"/>',
  trash: '<path d="M8 2h8l1 2h5v3H2V4h5zM4 8h16l-1.5 14h-13zm5 3v8h2v-8zm4 0v8h2v-8z"/>',
  external: '<path d="M14 2h8v8l-3-3-7 7-2-2 7-7zM3 5h7v3H6v10h10v-4h3v7H3z"/>',
  pin: '<path d="M12 1a8 8 0 0 1 8 8c0 6-8 14-8 14S4 15 4 9a8 8 0 0 1 8-8zm0 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
  video: '<path d="M2 6h13v12H2zm14 4 6-4v12l-6-4z"/>',
  people: '<path d="M8 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm9 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM1 21c0-5 3-8 7-8s7 3 7 8zm15 0c0-3-1-5.5-2.6-7 .8-.3 1.6-.5 2.6-.5 3.5 0 7 2.5 7 7.5z"/>',
  bell: '<path d="M12 2a7 7 0 0 1 7 7v5l3 4H2l3-4V9a7 7 0 0 1 7-7zm-3 18h6a3 3 0 0 1-6 0z"/>',
  text: '<path d="M2 4h20v3H2zm0 6h20v3H2zm0 6h13v3H2z"/>',
  clock: '<path d="M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22zm-1.5 5v7.2l5.7 3.4 1.5-2.5-4.2-2.5V6z"/>',
  repeat: '<path d="M17 1l5 5-5 5V7.5H7a3 3 0 0 0-3 3V12H1v-1.5a6 6 0 0 1 6-6h10zM7 23l-5-5 5-5v3.5h10a3 3 0 0 0 3-3V12h3v1.5a6 6 0 0 1-6 6H7z"/>',
  lock: '<path d="M12 1a6 6 0 0 1 6 6v3h2v13H4V10h2V7a6 6 0 0 1 6-6zm0 3a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3z"/>',
  cal: '<path d="M6 1h3v2h6V1h3v2h4v20H2V3h4zm-1 8v11h14V9z"/>',
  flag: '<path d="M4 1h3v1h14l-3 6 3 6H7v9H4z"/>',
  star: '<path d="m12 0 3.2 7.7 8.3.8-6.3 5.5 1.9 8.2L12 17.9 4.9 22.2l1.9-8.2L.5 8.5l8.3-.8z"/>',
  mask: '<path d="M1 7c4-2 7 0 11 2 4-2 7-4 11-2-1 6-3 10-7 10-2 0-3-2-4-3-1 1-2 3-4 3C4 17 2 13 1 7zm5 2.5c-1.5 0-2 1-2 1.5 1 1 3 1.5 4.5.5-.5-1-1-2-2.5-2zm12 0c-1.5 0-2 1-2.5 2 1.5 1 3.5.5 4.5-.5 0-.5-.5-1.5-2-1.5z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M11 0h2v4h-2zm0 20h2v4h-2zM0 11h4v2H0zm20 0h4v2h-4zM3.5 2.1l2.9 2.9-1.4 1.4L2.1 3.5zm14.1 14.1 2.9 2.9-1.4 1.4-2.9-2.9zM2.1 20.5 5 17.6 6.4 19l-2.9 2.9zM17.6 5l2.9-2.9 1.4 1.4L19 6.4z"/>',
  cloud: '<path d="M7 20a6 6 0 0 1-.9-11.9A7.5 7.5 0 0 1 20.4 10 5 5 0 0 1 18 20z"/>',
  rain: '<path d="M7 15a6 6 0 0 1-.9-11.9A7.5 7.5 0 0 1 20.4 5 5 5 0 0 1 18 15zm0 2h2l-2 6H5zm5 0h2l-2 6h-2zm5 0h2l-2 6h-2z"/>',
  snow: '<path d="M7 14a6 6 0 0 1-.9-11.9A7.5 7.5 0 0 1 20.4 4 5 5 0 0 1 18 14zm-1 3h3v3H6zm5 2h3v3h-3zm5-2h3v3h-3z"/>',
  storm: '<path d="M7 14a6 6 0 0 1-.9-11.9A7.5 7.5 0 0 1 20.4 4 5 5 0 0 1 18 14h-3l2-3h-5l-3 6h3l-2 7 7-9h-3z"/>',
  fog: '<path d="M2 6h20v3H2zm2 5h18v3H4zm-2 5h17v3H2z"/>',
  keyboard: '<path d="M1 5h22v14H1zm3 3v2h2V8zm4 0v2h2V8zm4 0v2h2V8zm4 0v2h2V8zM4 12v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zm4 0v2h2v-2zM7 16v1h10v-1z"/>'
};

function icon(name, cls) {
  const span = document.createElement('span');
  span.className = 'ico' + (cls ? ' ' + cls : '');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor">' + (ICONS[name] || '') + '</svg>';
  return span;
}

/* ---------- dates ---------- */
const DAY_MS = 864e5;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })();

const pad = (n) => String(n).padStart(2, '0');
function sod(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMinutes(d, n) { return new Date(d.getTime() + n * 60000); }
function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function addMonths(d, n) {
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  x.setDate(Math.min(day, daysInMonth(x)));
  return x;
}
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfWeek(d, weekStart) { const x = sod(d); return addDays(x, -((x.getDay() - weekStart + 7) % 7)); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
/** whole days from a to b (b - a), safe across daylight-saving changes */
function dayDiff(a, b) { return Math.round((sod(b) - sod(a)) / DAY_MS); }
function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }
function atMinutes(day, mins) { const x = sod(day); x.setMinutes(mins); return x; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseYmd(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function toRfc3339(d) {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return ymd(d) + 'T' + hm(d) + ':' + pad(d.getSeconds()) + (off >= 0 ? '+' : '-') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / DAY_MS + 1) / 7);
}
const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);

/* ---------- formatting (12h / 24h aware) ---------- */
function use24h() { return typeof App !== 'undefined' && !!(App.settings && App.settings.h24); }

function fmtTime(d, compact) {
  const H = d.getHours(), M = d.getMinutes();
  if (use24h()) return pad(H) + ':' + pad(M);
  const h12 = H % 12 || 12;
  const ap = H < 12 ? (compact ? 'a' : ' AM') : (compact ? 'p' : ' PM');
  if (compact) return h12 + (M ? ':' + pad(M) : '') + ap;
  return h12 + ':' + pad(M) + ap;
}
function fmtHourLabel(h) {
  if (use24h()) return pad(h) + ':00';
  return (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
}
function fmtDateLong(d) { return WEEKDAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate(); }
function fmtDateShort(d) { return WEEKDAYS[d.getDay()].slice(0, 3) + ', ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate(); }
function fmtMD(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

/** "Wednesday, October 14 · 10:00 – 11:00 AM" */
function fmtEventWhen(ev) {
  const s = ev.start, e = ev.end;
  if (ev.allDay) {
    const last = addDays(e, -1);
    if (sameDay(s, last) || last < s) return fmtDateLong(s);
    return fmtDateShort(s) + ' – ' + fmtDateShort(last);
  }
  if (sameDay(s, e) || (minutesOfDay(e) === 0 && dayDiff(s, e) === 1)) {
    return fmtDateLong(s) + ' · ' + fmtTime(s) + ' – ' + fmtTime(e);
  }
  return fmtDateShort(s) + ', ' + fmtTime(s) + ' – ' + fmtDateShort(e) + ', ' + fmtTime(e);
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' min';
  const hrs = Math.floor(m / 60), rest = m % 60;
  return hrs + ' hr' + (hrs > 1 ? 's' : '') + (rest ? ' ' + rest + ' min' : '');
}

/** The Persona time-of-day banner. Weekends get "DAYTIME" — no school. */
function dayPhase(d) {
  const m = minutesOfDay(d);
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  if (m < 300) return 'LATE NIGHT';
  if (m < 480) return 'EARLY MORNING';
  if (weekend && m < 1080) return 'DAYTIME';
  if (m < 690) return 'MORNING';
  if (m < 810) return 'LUNCHTIME';
  if (m < 900) return 'AFTERNOON';
  if (m < 1080) return 'AFTER SCHOOL';
  if (m < 1320) return 'EVENING';
  return 'LATE NIGHT';
}

/* ---------- random & hashing ---------- */
function hashStr(s) {
  let h1 = 2166136261;
  for (let i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619); }
  return h1 >>> 0;
}
function rng(seed) {
  let a = typeof seed === 'number' ? seed : hashStr(String(seed));
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* ---------- colours ---------- */
function hexToRgb(hex) {
  let x = String(hex || '').replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const n = parseInt(x, 16);
  if (isNaN(n)) return [229, 25, 28];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let hh = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh /= 6;
  }
  return [hh, s, l];
}
function hslToRgb(hh, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}
/** Google's pastel calendar colours, made loud enough for a heist. */
function punch(hex) {
  const [r, g, b] = hexToRgb(hex);
  let [hh, s, l] = rgbToHsl(r, g, b);
  if (s < 0.08) return rgbToHex(r, g, b);
  s = Math.max(s, 0.62);
  if (l > 0.58) l = 0.52 + (l - 0.58) * 0.25;
  return rgbToHex(...hslToRgb(hh, s, l));
}
/** black or white text, whichever reads better on this colour */
function inkFor(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.3 ? '#0b0b0d' : '#ffffff';
}

/* Google Calendar's event colours (the modern palette its website shows). */
const EVENT_COLORS = {
  '11': { name: 'Tomato', hex: '#d50000' },
  '4': { name: 'Flamingo', hex: '#e67c73' },
  '6': { name: 'Tangerine', hex: '#f4511e' },
  '5': { name: 'Banana', hex: '#f6bf26' },
  '2': { name: 'Sage', hex: '#33b679' },
  '10': { name: 'Basil', hex: '#0b8043' },
  '7': { name: 'Peacock', hex: '#039be5' },
  '9': { name: 'Blueberry', hex: '#3f51b5' },
  '1': { name: 'Lavender', hex: '#7986cb' },
  '3': { name: 'Grape', hex: '#8e24aa' },
  '8': { name: 'Graphite', hex: '#616161' }
};

/* ---------- text ---------- */
/** Plain text from a Google event description (which may contain simple HTML). */
function descriptionText(desc) {
  if (!desc) return '';
  if (!/<[a-z][\s\S]*>/i.test(desc)) return desc;
  const withBreaks = desc.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Text with clickable links, built as DOM nodes (never innerHTML). */
function linkified(text) {
  const frag = document.createDocumentFragment();
  const re = /(https?:\/\/[^\s<>"']+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    let url = m[1];
    const trail = url.match(/[).,;:!?]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    frag.append(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url));
    last = m.index + url.length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: fine */ }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
