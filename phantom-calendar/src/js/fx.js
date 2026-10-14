'use strict';
/* =========================================================================
   fx.js — ransom-note letters, sound effects, toasts and the big moments
   (day-change sweep, calling card, SHOWTIME cut-in)
   ========================================================================= */

const RANSOM_FONTS = [
  ["'Anton'", 400, 'normal'],
  ["'Archivo Black'", 400, 'normal'],
  ["'Abril Fatface'", 400, 'normal'],
  ["'Bangers'", 400, 'normal'],
  ["'Permanent Marker'", 400, 'normal'],
  ["'Rubik Mono One'", 400, 'normal'],
  ["'Special Elite'", 400, 'normal'],
  ["'Shrikhand'", 400, 'normal'],
  ["'Bungee'", 400, 'normal'],
  ["'Playfair Display'", 900, 'italic'],
  ["'Black Ops One'", 400, 'normal'],
  ["'Bebas Neue'", 400, 'normal']
];
const RANSOM_STYLES = ['r-ink', 'r-inv', 'r-red', 'r-paper', 'r-inv', 'r-ink', 'r-red', 'r-out'];

/** Text cut out of magazines, letter by letter. Same seed → same letters. */
function ransom(text, opts) {
  opts = opts || {};
  const r = rng(opts.seed != null ? String(opts.seed) : String(text));
  const wrap = h('span', { class: 'ransom' + (opts.cls ? ' ' + opts.cls : '') });
  wrap.append(h('span', { class: 'sr-only' }, text));
  let i = 0, prevStyle = '', prevFont = -1;
  for (const part of String(text).split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { wrap.append(h('span', { class: 'r-gap', 'aria-hidden': 'true' })); continue; }
    const word = h('span', { class: 'r-word', 'aria-hidden': 'true' });
    for (const ch of part) {
      let fi = Math.floor(r() * RANSOM_FONTS.length);
      if (fi === prevFont) fi = (fi + 1) % RANSOM_FONTS.length;
      let st = (opts.styles || RANSOM_STYLES)[Math.floor(r() * (opts.styles || RANSOM_STYLES).length)];
      if (st === prevStyle) st = st === 'r-ink' ? 'r-inv' : 'r-ink';
      prevFont = fi; prevStyle = st;
      const f = RANSOM_FONTS[fi];
      const lower = /[a-z]/i.test(ch) && r() < 0.16;
      const span = document.createElement('span');
      span.className = 'rl ' + st + (i === 0 ? ' r-first' : '');
      span.textContent = lower ? ch.toLowerCase() : ch.toUpperCase();
      span.style.fontFamily = f[0] + ', Impact, sans-serif';
      span.style.fontWeight = f[1];
      span.style.fontStyle = f[2];
      const rot = (r() * 16 - 8).toFixed(1);
      const dy = (r() * 6 - 3).toFixed(1);
      const sc = (0.9 + r() * 0.26).toFixed(2);
      span.style.transform = 'translateY(' + dy + 'px) rotate(' + rot + 'deg) scale(' + sc + ')';
      word.append(span);
      i++;
    }
    wrap.append(word);
  }
  return wrap;
}

/* ---------- sound: tiny synthesised UI blips, no audio files ---------- */
const Sfx = (() => {
  let ctx = null, out = null;
  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      out = ctx.createGain();
      out.gain.value = 0.16;
      out.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f, t0, dur, type, vol, f2) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noise(t0, dur, vol, freq) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.setValueAtTime(freq || 1200, t0); bp.frequency.exponentialRampToValueAtTime((freq || 1200) * 3, t0 + dur);
    const g = ctx.createGain();
    g.gain.value = vol || 0.2;
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t0);
  }
  const SOUNDS = {
    move: (t) => tone(1500, t, 0.035, 'square', 0.1),
    select: (t) => { tone(880, t, 0.05, 'square', 0.16); tone(1760, t + 0.045, 0.08, 'square', 0.14); },
    back: (t) => tone(760, t, 0.1, 'triangle', 0.22, 280),
    drop: (t) => { tone(260, t, 0.08, 'square', 0.18, 120); noise(t, 0.05, 0.12, 2400); },
    card: (t) => { noise(t, 0.22, 0.28, 700); [523, 659, 784, 1047].forEach((f, i) => tone(f, t + 0.12 + i * 0.05, 0.24, 'sawtooth', 0.07)); },
    showtime: (t) => { noise(t, 0.45, 0.32, 500); [392, 494, 587, 784].forEach((f, i) => tone(f, t + i * 0.07, 0.3, 'square', 0.09)); tone(1568, t + 0.34, 0.55, 'sawtooth', 0.07); },
    error: (t) => { tone(170, t, 0.16, 'sawtooth', 0.2); tone(150, t + 0.19, 0.2, 'sawtooth', 0.2); },
    whoosh: (t) => noise(t, 0.28, 0.2, 900),
    erase: (t) => { noise(t, 0.18, 0.25, 3000); tone(420, t, 0.2, 'sawtooth', 0.1, 90); }
  };
  return {
    play(name) {
      if (typeof App === 'undefined' || !App.settings.sound) return;
      try { const c = ac(); if (c && SOUNDS[name]) SOUNDS[name](c.currentTime + 0.005); } catch (e) { /* no audio: fine */ }
    }
  };
})();

/* ---------- toasts ---------- */
function toast(msg, opts) {
  opts = opts || {};
  const box = $('#toasts');
  if (!box) return;
  let gone = false;
  const dismiss = () => {
    if (gone) return; gone = true;
    t.classList.add('is-leaving');
    setTimeout(() => t.remove(), 220);
  };
  const t = h('div', { class: 'toast' + (opts.kind ? ' t-' + opts.kind : ''), role: opts.kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-msg' }, msg),
    opts.action && h('button', { class: 'toast-act', onclick: () => { dismiss(); opts.action.fn(); } }, opts.action.label),
    h('button', { class: 'toast-x', 'aria-label': 'Dismiss', onclick: dismiss }, icon('close'))
  );
  box.append(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(dismiss, opts.ms || (opts.action ? 7000 : opts.kind === 'error' ? 6500 : 3600));
  if (opts.kind === 'error') Sfx.play('error');
  return dismiss;
}

/* ---------- the big moments ---------- */
const FX = {
  level() {
    if (typeof App === 'undefined') return 'full';
    return App.settings.motion || 'full';
  },

  /** The red-and-black sweep Persona plays when the day changes. */
  transition(big, small) {
    if (this.level() !== 'full' || this._tx) return;
    const node = h('div', { class: 'fx fx-tx', 'aria-hidden': 'true' },
      h('div', { class: 's1' }), h('div', { class: 's2' }),
      h('div', { class: 'txt' }, h('div', { class: 'big' }, big), small ? ransom(small, { seed: small + big }) : null)
    );
    document.body.append(node);
    this._tx = node;
    Sfx.play('whoosh');
    setTimeout(() => { node.remove(); this._tx = null; }, 820);
  },

  /** A calling card for every new event. */
  callingCard(ev) {
    if (this.level() === 'off') { Sfx.play('select'); return; }
    const title = (ev.title || 'NEW TARGET').slice(0, 34);
    const when = ev.allDay ? fmtDateShort(ev.start).toUpperCase() : (fmtDateShort(ev.start) + ' · ' + fmtTime(ev.start)).toUpperCase();
    const node = h('div', { class: 'fx fx-card', role: 'status' },
      h('div', { class: 'slash' }),
      h('div', { class: 'card' },
        h('span', { class: 'card-k' }, 'CALLING CARD'),
        ransom(title, { seed: title }),
        h('div', { class: 'card-msg' }, 'Target locked. We strike on ' + when + '. Nothing will stop us.'),
        h('div', { class: 'card-sig' }, '— THE PHANTOM CALENDAR', icon('mask'))
      )
    );
    // never blocks: any tap or key passes through to the app and sends the card away
    let done = false;
    const leave = () => {
      if (done) return; done = true;
      document.removeEventListener('pointerdown', leave, true);
      document.removeEventListener('keydown', leave, true);
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 340);
    };
    document.addEventListener('pointerdown', leave, true);
    document.addEventListener('keydown', leave, true);
    document.body.append(node);
    Sfx.play('card');
    setTimeout(leave, this.level() === 'lite' ? 1200 : 1900);
  },

  /** SHOWTIME: when an event starts while the app is open. */
  showtime(ev) {
    if (this.level() === 'off') { toast('▶ Starting now: ' + ev.title); Sfx.play('showtime'); return; }
    const node = h('div', { class: 'fx fx-cut', role: 'alert' },
      h('div', { class: 'band' },
        ransom("IT'S SHOWTIME!", { seed: ev.key }),
        h('div', { class: 'sub' }, ev.title + (ev.raw.location ? ' — ' + ev.raw.location : ''))
      )
    );
    document.body.append(node);
    Sfx.play('showtime');
    setTimeout(() => node.remove(), 2700);
  }
};
