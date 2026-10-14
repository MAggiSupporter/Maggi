'use strict';
/* =========================================================================
   views.js — drawing the screen: top bar, side panel, and the four views
   (day / week time grid, month, schedule, search) plus drag & drop.
   ========================================================================= */

let renderPending = false;
function requestRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    if (App.drag) { App.renderQueued = true; return; }
    renderAll();
  });
}
function flushRender() {
  if (App.renderQueued) { App.renderQueued = false; renderAll(); }
}
function renderAll() {
  if (!App.ready) return;
  renderHeader();
  renderSidebar();
  renderView();
}

function cssPx(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseFloat(v) || 52;
}

/* ---------------- top bar ---------------- */
let lastTitle = '';
function renderHeader() {
  const now = new Date();
  $('#dwDate').textContent = fmtMD(now);
  $('#dwWd').textContent = WEEKDAYS[now.getDay()].slice(0, 3).toUpperCase();
  $('#dwPhase').textContent = dayPhase(now);
  const wx = Weather.today();
  const wxEl = $('#dwWeather');
  wxEl.hidden = !wx;
  if (wx) { clear(wxEl).append(icon(wx.icon)); wxEl.title = wx.label; }

  $$('#viewTabs .tab').forEach((t) => {
    const on = t.dataset.view === App.view;
    t.classList.toggle('is-on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const title = titleText();
  if (title !== lastTitle) {
    lastTitle = title;
    clear($('#viewTitle')).append(ransom(title, { seed: title }));
  }
  clear($('#soundBtn')).append(icon(App.settings.sound ? 'soundOn' : 'soundOff'));
  $('#soundBtn').setAttribute('aria-pressed', App.settings.sound ? 'true' : 'false');
  updateSyncChip();
}

function titleText() {
  const d = App.date;
  const M3 = (x) => MONTHS[x.getMonth()].slice(0, 3);
  if (App.view === 'search') return 'SEARCH';
  if (App.view === 'day') return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
  if (App.view === 'month' || App.view === 'schedule') return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  const r = viewRange();
  const last = addDays(r.end, -1);
  if (r.start.getMonth() === last.getMonth() && r.start.getFullYear() === last.getFullYear()) return MONTHS[r.start.getMonth()] + ' ' + r.start.getFullYear();
  if (r.start.getFullYear() === last.getFullYear()) return M3(r.start) + ' – ' + M3(last) + ' ' + last.getFullYear();
  return M3(r.start) + ' ' + r.start.getFullYear() + ' – ' + M3(last) + ' ' + last.getFullYear();
}

function updateSyncChip() {
  const chip = $('#syncChip');
  if (!chip) return;
  chip.classList.toggle('is-syncing', App.syncing);
  chip.classList.toggle('is-off', App.offline);
  let text;
  if (App.offline) text = 'OFFLINE';
  else if (!App.lastSync) text = 'SYNCING';
  else if (App.backend && App.backend.kind === 'demo') text = 'DEMO DATA';
  else {
    const s = Math.round((Date.now() - App.lastSync) / 1000);
    text = s < 15 ? 'SYNCED' : 'SYNCED ' + (s < 60 ? s + 'S' : Math.floor(s / 60) + 'M') + ' AGO';
  }
  $('#syncText').textContent = text;
  chip.title = App.offline ? 'Can’t reach Google Calendar right now. Click to retry.' : 'Changes in Google Calendar appear here automatically. Click to check now (R).';
}

/* ---------------- side panel ---------------- */
function renderSidebar() {
  renderMini();
  renderDeadlines();
  renderCalList();
  renderSideFoot();
}

function renderMini() {
  const root = clear($('#miniCal'));
  const m = App.miniMonth || startOfMonth(App.date);
  const ws = App.settings.weekStart;
  const gs = startOfWeek(m, ws);
  const today = sod(new Date());
  const range = App.view === 'day' || App.view === 'week' ? viewRange() : null;
  const busy = new Set();
  for (const ev of visibleEvents(gs, addDays(gs, 42))) {
    const last = ev.allDay ? addDays(ev.end, -1) : ev.end;
    for (let d = maxDate(sod(ev.start), gs), n = 0; d <= last && n < 42; d = addDays(d, 1), n++) busy.add(ymd(d));
  }
  root.append(h('div', { class: 'mc-head' },
    h('div', { class: 'mc-title' }, MONTHS[m.getMonth()].toUpperCase() + ' ', h('em', null, m.getFullYear())),
    h('div', { class: 'mc-nav' },
      h('button', { 'aria-label': 'Previous month', onclick: () => { App.miniMonth = addMonths(m, -1); Sfx.play('move'); renderMini(); } }, icon('prev')),
      h('button', { 'aria-label': 'Next month', onclick: () => { App.miniMonth = addMonths(m, 1); Sfx.play('move'); renderMini(); } }, icon('next'))
    )
  ));
  const grid = h('div', { class: 'mc-grid', role: 'grid' });
  for (let i = 0; i < 7; i++) grid.append(h('div', { class: 'mc-wd', 'aria-hidden': 'true' }, WEEKDAYS[(ws + i) % 7].charAt(0)));
  for (let i = 0; i < 42; i++) {
    const d = addDays(gs, i);
    const cls = ['mc-day'];
    if (d.getMonth() !== m.getMonth()) cls.push('is-other');
    if (sameDay(d, today)) cls.push('is-today');
    else if (sameDay(d, App.date)) cls.push('is-sel');
    if (range && d >= range.start && d < range.end) cls.push('is-range');
    if (busy.has(ymd(d))) cls.push('has-ev');
    grid.append(h('button', { class: cls.join(' '), 'aria-label': fmtDateLong(d), onclick: () => goTo(d) }, d.getDate()));
  }
  root.append(grid);
}

function renderDeadlines() {
  const box = clear($('#deadlines'));
  const now = new Date(), today = sod(now);
  const upcoming = visibleEvents(now, addDays(today, 62));
  const next = upcoming.find((e) => !e.allDay && !e.declined && e.end > now && e.start < addMinutes(now, 12 * 60));
  if (next) {
    const mins = Math.round((next.start - now) / 60000);
    const when = mins <= 0 ? 'HAPPENING NOW' : mins < 60 ? 'IN ' + mins + ' MIN' : 'IN ' + Math.floor(mins / 60) + ' HR ' + (mins % 60 ? (mins % 60) + ' MIN' : '');
    box.append(h('button', { class: 'next-up', onclick: (e) => { goTo(next.start); setTimeout(() => openDetails(next, null), 60); } },
      h('span', { class: 'nu-k' }, 'NEXT'),
      h('span', { class: 'nu-t' }, next.title),
      h('span', { class: 'nu-w' }, when + ' · ' + fmtTime(next.start))
    ));
  }
  const seen = new Set();
  const dls = upcoming.filter((e) => {
    if (!e.deadline || e.end <= now) return false;
    const k = e.seriesId || e.key;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 4);
  if (!dls.length) {
    box.append(h('div', { class: 'dl-empty' }, 'No deadlines. Mark an event as a Palace Deadline (or put "deadline" in its title) to start a countdown.'));
    return;
  }
  for (const e of dls) {
    const days = dayDiff(today, e.start);
    const word = days <= 0 ? 'TODAY' : days === 1 ? '1' : String(days);
    box.append(h('button', { class: 'dl', onclick: () => { goTo(e.start); setTimeout(() => openDetails(e, null), 60); }, title: fmtEventWhen(e) },
      h('span', { class: 'dl-num' + (days <= 0 ? ' is-word' : '') }, word),
      h('span', { class: 'dl-left' }, days <= 0 ? (e.start <= now ? 'IN PROGRESS' : 'IT’S TODAY') : days === 1 ? 'DAY LEFT' : 'DAYS LEFT'),
      h('span', { class: 'dl-title' }, e.title),
      h('span', { class: 'dl-date' }, fmtDateShort(e.start))
    ));
  }
}

function renderCalList() {
  const box = clear($('#calList'));
  const ms = startOfMonth(App.date), me = addMonths(ms, 1);
  const counts = {};
  for (const ev of App.events.values()) if (ev.start < me && ev.end > ms) counts[ev.calId] = (counts[ev.calId] || 0) + 1;
  for (const c of App.calendars) {
    const on = calVisible(c);
    const st = calStyle(c);
    const parts = c.arcana.split(' ');
    const numeral = /^[0IVXL]+$/.test(parts[0]) ? parts[0] : parts[0].charAt(0);
    const arcName = /^[0IVXL]+$/.test(parts[0]) ? parts.slice(1).join(' ') : c.arcana;
    const n = counts[c.id] || 0;
    const rank = on ? Math.max(1, Math.min(10, Math.ceil(n / 3))) : null;
    box.append(h('button', {
      class: 'cal' + (on ? '' : ' is-off'), 'aria-pressed': on ? 'true' : 'false',
      title: (on ? 'Hide ' : 'Show ') + c.name + (n ? ' — ' + n + ' events this month' : ''),
      onclick: () => toggleCalendar(c.id)
    },
    h('span', { class: 'cal-card', style: { '--cal': st.bg, '--cal-ink': st.ink } }, numeral),
    h('span', { style: { minWidth: '0' } },
      h('span', { class: 'cal-name' }, c.name),
      h('span', { class: 'cal-meta' }, arcName + (c.writable ? '' : ' · READ-ONLY'))
    ),
    h('span', { class: 'cal-rank' }, 'RANK ', h('b', null, rank == null ? '—' : rank === 10 ? 'MAX' : rank))
    ));
  }
}

function renderSideFoot() {
  const foot = clear($('#sideFoot'));
  if (App.backend.kind === 'demo') {
    foot.append('Demo mode. ', h('button', { onclick: () => openSettings() }, 'Settings'), ' · ', h('button', { onclick: () => openHelp() }, 'Shortcuts'));
  } else {
    foot.append('Linked to ', h('b', null, App.user || 'your Google account'), '. ', h('button', { onclick: () => openHelp() }, 'Shortcuts'));
  }
}

/* ---------------- the main view ---------------- */
function renderView() {
  const view = $('#view');
  const sv = view.querySelector('.sv');
  if (sv) App.svScroll = { view: App.view, top: sv.scrollTop };
  clear(view);
  let node;
  if (App.view === 'day' || App.view === 'week') node = renderTimeGrid();
  else if (App.view === 'month') node = renderMonth();
  else if (App.view === 'search') node = renderSearch();
  else node = renderSchedule();
  if (App.view !== 'search' && !rangeLoaded(viewRange())) view.append(h('div', { class: 'loading-bar', role: 'progressbar', 'aria-label': 'Loading events' }));
  view.append(node);
  if (node._mount) node._mount();
  if (App.view === 'schedule' && App.svScroll && App.svScroll.view === 'schedule') {
    const s = view.querySelector('.sv');
    if (s) s.scrollTop = App.svScroll.top;
  }
  markSelected();
}

function markSelected() {
  $$('#view [data-key]').forEach((el) => el.classList.toggle('is-sel', el.dataset.key === App.selectedKey));
}

function evClasses(ev, base) {
  const now = new Date();
  const cls = [base];
  if (ev.end < now) cls.push('is-past');
  if (ev.declined) cls.push('is-declined');
  if (ev.free) cls.push('is-free');
  if (ev.pending) cls.push('is-pending');
  if (ev.deadline) cls.push('is-deadline');
  return cls;
}

function barEl(ev, pos, mode, it) {
  const st = evStyle(ev);
  const cls = evClasses(ev, 'bar');
  cls.push(mode === 'fill' ? 'is-fill' : 'is-dot');
  if (it && it.contL) cls.push('is-cont-l');
  if (it && it.contR) cls.push('is-cont-r');
  return h('div', {
    class: cls.join(' '),
    style: Object.assign({ '--ev': st.bg, '--ev-ink': st.ink }, pos),
    dataset: { key: ev.key }, tabindex: '0', role: 'button',
    'aria-label': ev.title + ', ' + fmtEventWhen(ev)
  },
  mode === 'dot' && !ev.allDay ? h('b', null, fmtTime(ev.start, true)) : null,
  h('span', null, ev.title));
}

function emptyState(title, text) {
  return h('div', { class: 'empty' }, ransom(title), h('p', null, text));
}

function tzAbbrev() {
  try {
    const p = new Intl.DateTimeFormat('en', { timeZoneName: 'short' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
    return p ? p.value : '';
  } catch (e) { return ''; }
}

/* ---------- shared gesture helper: tap, drag, or (on touch) hold-then-drag ---------- */
function gesture(e, hnd) {
  const touch = e.pointerType !== 'mouse';
  const x0 = e.clientX, y0 = e.clientY;
  let started = false, done = false, hold = null;
  let last = { x: x0, y: y0 };
  const off = () => {
    done = true;
    clearTimeout(hold);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  };
  const start = () => {
    if (started) return true;
    if (hnd.canStart && !hnd.canStart()) return false;
    started = true;
    App.drag = { active: true };
    if (hnd.onStart) hnd.onStart(last);
    return true;
  };
  const move = (m) => {
    last = { x: m.clientX, y: m.clientY };
    const dist = Math.hypot(m.clientX - x0, m.clientY - y0);
    if (!started) {
      if (touch) { if (dist > 10) { off(); if (hnd.onAbort) hnd.onAbort(); } return; }
      if (dist < 5 || !hnd.onStart || !start()) return;
    }
    m.preventDefault();
    if (hnd.onMove) hnd.onMove(last);
  };
  const up = (u) => {
    off();
    if (!started) {
      if (Math.hypot(u.clientX - x0, u.clientY - y0) < (touch ? 10 : 5)) { if (hnd.onTap) hnd.onTap(); } else if (hnd.onAbort) hnd.onAbort();
      return;
    }
    App.drag = null;
    if (hnd.onEnd) hnd.onEnd(last);
    flushRender();
  };
  const cancel = () => {
    off();
    if (started) { App.drag = null; if (hnd.onCancel) hnd.onCancel(); flushRender(); }
  };
  if (touch && hnd.onStart && hnd.touchHold !== false) {
    hold = setTimeout(() => {
      if (!done && start()) {
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* ignore */ } }
        if (hnd.onMove) hnd.onMove(last);
      }
    }, 380);
  }
  // stops text selection, and on touch stops the follow-up fake mouse-down that
  // would pull focus out of a popover opened by this tap (scrolling still works)
  e.preventDefault();
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

/** Scrolls a container while a drag sits near its top or bottom edge. */
function edgeScroll(scroller, onTick) {
  let y = null, raf = 0;
  const loop = () => {
    if (y != null) {
      const r = scroller.getBoundingClientRect();
      let dy = 0;
      if (y < r.top + 46) dy = -Math.ceil((r.top + 46 - y) / 4);
      else if (y > r.bottom - 36) dy = Math.ceil((y - (r.bottom - 36)) / 4);
      if (dy) { scroller.scrollTop += dy; onTick(); }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return { update(v) { y = v; }, stop() { cancelAnimationFrame(raf); } };
}

function snapDate(d, step) {
  const m = minutesOfDay(d) + d.getSeconds() / 60;
  return atMinutes(sod(d), Math.round(m / step) * step);
}

/* ---------------- time grid (day / week) ---------------- */
function renderTimeGrid() {
  const n = gridDays();
  const { start } = viewRange();
  const days = Array.from({ length: n }, (_, i) => addDays(start, i));
  const end = addDays(start, n);
  const evs = visibleEvents(start, end);
  const isLong = (e) => e.allDay || e.end - e.start >= DAY_MS;
  const allDayEvs = evs.filter(isLong);
  const timedEvs = evs.filter((e) => !isLong(e));
  const hourH = cssPx('--hour-h');
  const ppm = hourH / 60;
  const now = new Date();
  const today = sod(now);

  const root = h('div', { class: 'tg', style: { '--cols': String(n) } });
  const scroller = h('div', { class: 'tg-scroll' });
  const head = h('div', { class: 'tg-row tg-head' }, h('div', { class: 'tg-tz' }, tzAbbrev()),
    days.map((d) => {
      const wx = Weather.on(d);
      return h('button', {
        class: 'tg-dh' + (sameDay(d, today) ? ' is-today' : d < today ? ' is-past' : ''),
        title: 'Open ' + fmtDateLong(d), onclick: () => { if (App.view !== 'day') goTo(d, 'day'); }
      },
      h('span', { class: 'tg-dwd' }, WEEKDAYS[d.getDay()].slice(0, 3).toUpperCase()),
      h('span', { class: 'tg-dnum' }, d.getDate()),
      wx ? h('span', { class: 'tg-wx', title: wx.label }, icon(wx.icon)) : null);
    }));
  const allday = renderAllDayRow(days, allDayEvs);
  const sticky = h('div', { class: 'tg-sticky' }, head, allday.row);

  const hours = h('div', { class: 'tg-hours' });
  for (let i = 1; i < 24; i++) hours.append(h('div', { class: 'tg-hour', style: { top: i * hourH + 'px' } }, fmtHourLabel(i)));
  const body = h('div', { class: 'tg-row tg-body' }, hours);
  const cols = days.map((d, i) => renderDayCol(d, i, timedEvs, ppm, now));
  cols.forEach((c) => body.append(c));
  scroller.append(sticky, body);
  root.append(scroller);

  root._mount = () => {
    if (App.tgScroll == null) {
      const target = days.some((d) => sameDay(d, now)) ? (minutesOfDay(now) - 100) * ppm : 7 * hourH;
      App.tgScroll = Math.max(0, target);
    }
    scroller.scrollTop = App.tgScroll;
    bindTimeGrid(root, scroller, body, cols, days, ppm);
    bindAllDay(allday, days);
  };
  return root;
}

function renderDayCol(day, idx, timedEvs, ppm, now) {
  const ds = sod(day), de = addDays(ds, 1);
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const col = h('div', { class: 'tg-col' + (sameDay(day, now) ? ' is-today' : '') + (weekend ? ' is-weekend' : ''), dataset: { idx: String(idx) } });
  const segs = [];
  for (const e of timedEvs) {
    const zero = e.end.getTime() === e.start.getTime();
    if (!(e.start < de && (e.end > ds || (zero && e.start >= ds)))) continue;
    const sm = e.start < ds ? 0 : minutesOfDay(e.start);
    const em = e.end >= de ? 1440 : minutesOfDay(e.end);
    segs.push({ ev: e, sm, em: Math.max(em, sm), contTop: e.start < ds, contBot: e.end > de });
  }
  layoutSegs(segs);
  for (const seg of segs) col.append(eventBlock(seg, ppm));
  const d = App.draft;
  if (d && !d.allDay && d.start < de && d.end > ds) {
    const sm = d.start < ds ? 0 : minutesOfDay(d.start);
    const em = d.end >= de ? 1440 : minutesOfDay(d.end);
    col.append(h('div', {
      class: 'ev ev-ghost is-new is-draft',
      style: { top: sm * ppm + 'px', height: Math.max((em - sm) * ppm, 18) - 1 + 'px', left: '1px', width: 'calc(100% - 6px)' }
    }, h('div', { class: 'ev-title' }, d.title || '(No title)'), h('div', { class: 'ev-time' }, fmtTime(d.start, true) + ' – ' + fmtTime(d.end, true))));
  }
  if (sameDay(day, now)) {
    col.append(h('div', { class: 'tg-now', style: { top: minutesOfDay(now) * ppm + 'px' } }, h('span', { class: 'tg-now-label' }, fmtTime(now, true))));
  }
  return col;
}

/** Side-by-side columns for overlapping events (like Google's week view). */
function layoutSegs(segs) {
  const MIN = 24;
  segs.sort((a, b) => a.sm - b.sm || (b.em - b.sm) - (a.em - a.sm));
  let cluster = [], colsEnd = [], clusterEnd = -1;
  const flush = () => {
    const n = colsEnd.length;
    for (const s of cluster) {
      let span = 1;
      for (let c = s.col + 1; c < n; c++) {
        if (cluster.some((o) => o.col === c && o.vs < s.ve && o.ve > s.vs)) break;
        span++;
      }
      s.left = s.col / n;
      s.width = span / n;
    }
    cluster = []; colsEnd = []; clusterEnd = -1;
  };
  for (const s of segs) {
    s.vs = s.sm;
    s.ve = Math.max(s.em, s.sm + MIN);
    if (cluster.length && s.vs >= clusterEnd) flush();
    let c = colsEnd.findIndex((end) => end <= s.vs);
    if (c === -1) { c = colsEnd.length; colsEnd.push(s.ve); } else colsEnd[c] = s.ve;
    s.col = c;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.ve);
  }
  if (cluster.length) flush();
  return segs;
}

function eventBlock(seg, ppm) {
  const ev = seg.ev;
  const st = evStyle(ev);
  const top = seg.sm * ppm;
  const hgt = Math.max((seg.em - seg.sm) * ppm, 18);
  const tiny = hgt < 36;
  const cls = evClasses(ev, 'ev');
  if (tiny) cls.push('is-tiny');
  if (seg.contTop) cls.push('is-cont-top');
  if (seg.contBot) cls.push('is-cont-bot');
  const right = seg.left + seg.width >= 0.999;
  const el = h('div', {
    class: cls.join(' '),
    style: {
      top: top + 'px', height: hgt - 1 + 'px',
      left: 'calc(' + (seg.left * 100).toFixed(3) + '% + 1px)',
      width: 'calc(' + (seg.width * 100).toFixed(3) + '% - ' + (right ? 6 : 2) + 'px)',
      '--ev': st.bg, '--ev-ink': st.ink
    },
    dataset: { key: ev.key }, tabindex: '0', role: 'button',
    'aria-label': ev.title + ', ' + fmtEventWhen(ev)
  });
  el.append(h('div', { class: 'ev-title' }, ev.title));
  el.append(h('div', { class: 'ev-time' }, tiny ? fmtTime(ev.start, true) : fmtTime(ev.start, true) + ' – ' + fmtTime(ev.end, true)));
  if (hgt > 64 && ev.raw.location) el.append(h('div', { class: 'ev-loc' }, ev.raw.location));
  if (ev.editable && !seg.contBot && !ev.pending) el.append(h('div', { class: 'ev-resize', 'aria-hidden': 'true' }));
  return el;
}

function bindTimeGrid(root, scroller, body, cols, days, ppm) {
  scroller.addEventListener('scroll', () => { App.tgScroll = scroller.scrollTop; }, { passive: true });
  scroller.addEventListener('touchmove', (e) => { if (App.drag) e.preventDefault(); }, { passive: false });

  const slotAt = (x, y) => {
    let idx = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
    if (idx < 0) idx = x < cols[0].getBoundingClientRect().left ? 0 : cols.length - 1;
    const r = cols[idx].getBoundingClientRect();
    return { idx, min: clamp((y - r.top) / ppm, 0, 1440) };
  };
  const dateAt = (idx, min) => atMinutes(days[idx], Math.round(min));

  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.ev');
    if (!el) return;
    e.preventDefault();
    const ev = App.events.get(el.dataset.key);
    if (ev) openDetails(ev, el);
  });

  body.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const evEl = e.target.closest('.ev');
    if (evEl && evEl.classList.contains('ev-ghost')) return;
    if (evEl) return dragEvent(e, evEl);
    const col = e.target.closest('.tg-col');
    if (col) dragCreate(e, col);
  });

  function dragCreate(e, col) {
    const p0 = slotAt(e.clientX, e.clientY);
    const a = Math.floor(p0.min / 15) * 15;
    let b = a, ghost = null, edge = null;
    const range = () => [Math.min(a, b), Math.max(a, b) + 15];
    const paint = () => {
      const [s, en] = range();
      ghost.style.top = s * ppm + 'px';
      ghost.style.height = (Math.min(en, 1440) - s) * ppm - 1 + 'px';
      clear(ghost).append(h('div', { class: 'ev-time' }, fmtTime(dateAt(p0.idx, s), true) + ' – ' + fmtTime(dateAt(p0.idx, Math.min(en, 1440)), true)));
    };
    const lastY = { v: e.clientY };
    const track = () => {
      const r = col.getBoundingClientRect();
      b = Math.floor(clamp((lastY.v - r.top) / ppm, 0, 1439) / 15) * 15;
      paint();
    };
    closeAllLayers();
    gesture(e, {
      touchHold: false,
      onStart: () => {
        ghost = h('div', { class: 'ev ev-ghost is-new', style: { left: '1px', width: 'calc(100% - 6px)' } });
        col.append(ghost);
        edge = edgeScroll(scroller, track);
        paint();
      },
      onMove: (pt) => { lastY.v = pt.y; edge.update(pt.y); track(); },
      onEnd: () => {
        edge.stop(); ghost.remove();
        const [s, en] = range();
        openQuickCreate({ start: dateAt(p0.idx, s), end: dateAt(p0.idx, Math.min(en, 1440)), allDay: false });
      },
      onCancel: () => { if (edge) edge.stop(); if (ghost) ghost.remove(); },
      onTap: () => {
        const s = Math.floor(p0.min / 30) * 30;
        openQuickCreate({ start: dateAt(p0.idx, s), end: dateAt(p0.idx, Math.min(s + 60, 1440)), allDay: false });
      }
    });
  }

  function dragEvent(e, evEl) {
    const ev = App.events.get(evEl.dataset.key);
    if (!ev) return;
    const resize = e.target.classList.contains('ev-resize');
    const p0 = slotAt(e.clientX, e.clientY);
    const grab = dateAt(p0.idx, p0.min) - ev.start;
    const dur = ev.end - ev.start;
    let newStart = ev.start, newEnd = ev.end, ghost = null, edge = null;
    let last = { x: e.clientX, y: e.clientY };
    const st = evStyle(ev);

    const paint = () => {
      const anchor = resize ? newStart : newStart;
      const di = dayDiff(days[0], anchor);
      if (di < 0 || di >= days.length) { ghost.style.display = 'none'; return; }
      ghost.style.display = '';
      if (ghost.parentNode !== cols[di]) cols[di].append(ghost);
      const sm = minutesOfDay(newStart);
      const dayEnd = addDays(sod(newStart), 1);
      const em = newEnd >= dayEnd ? 1440 : minutesOfDay(newEnd);
      ghost.style.top = sm * ppm + 'px';
      ghost.style.height = Math.max((em - sm) * ppm, 18) - 1 + 'px';
      clear(ghost).append(h('div', { class: 'ev-title' }, ev.title), h('div', { class: 'ev-time' }, fmtTime(newStart, true) + ' – ' + fmtTime(newEnd, true)));
    };
    const compute = () => {
      const p = slotAt(last.x, last.y);
      if (resize) {
        let end = snapDate(dateAt(p.idx, p.min), 15);
        if (end - ev.start < 15 * 60000) end = new Date(ev.start.getTime() + 15 * 60000);
        newStart = ev.start; newEnd = end;
      } else {
        newStart = snapDate(new Date(dateAt(p.idx, p.min).getTime() - grab), 15);
        newEnd = new Date(newStart.getTime() + dur);
      }
      paint();
    };
    gesture(e, {
      canStart: () => ev.editable && !ev.pending,
      onStart: () => {
        closeAllLayers();
        evEl.classList.add('is-dragging');
        ghost = h('div', { class: 'ev ev-ghost', style: { left: '1px', width: 'calc(100% - 6px)', '--ev': st.bg, '--ev-ink': st.ink } });
        edge = edgeScroll(scroller, compute);
        Sfx.play('move');
      },
      onMove: (pt) => { last = pt; edge.update(pt.y); compute(); },
      onEnd: () => {
        edge.stop(); ghost.remove(); evEl.classList.remove('is-dragging');
        moveEvent(ev, newStart, newEnd);
      },
      onCancel: () => { if (edge) edge.stop(); if (ghost) ghost.remove(); evEl.classList.remove('is-dragging'); },
      onTap: () => openDetails(ev, evEl)
    });
  }
}

/* all-day row of the time grid */
function renderAllDayRow(days, evs) {
  const n = days.length, s0 = days[0];
  const items = evs.map((e) => {
    const lastDay = e.allDay ? addDays(e.end, -1) : (minutesOfDay(e.end) === 0 ? addDays(e.end, -1) : e.end);
    const si = Math.max(0, dayDiff(s0, e.start));
    const ei = Math.min(n - 1, dayDiff(s0, lastDay));
    return { ev: e, si, ei: Math.max(si, ei), contL: e.start < s0, contR: dayDiff(s0, lastDay) > n - 1 };
  }).sort((a, b) => a.si - b.si || (b.ei - b.si) - (a.ei - a.si));
  const lanes = [];
  for (const it of items) {
    let l = lanes.findIndex((lastEi) => lastEi < it.si);
    if (l === -1) { l = lanes.length; lanes.push(it.ei); } else lanes[l] = it.ei;
    it.lane = l;
  }
  const d = App.draft;
  let draftItem = null;
  if (d && d.allDay) {
    const si = dayDiff(s0, d.start), ei = dayDiff(s0, addDays(d.end, -1));
    if (ei >= 0 && si < n) draftItem = { si: Math.max(0, si), ei: Math.min(n - 1, ei), lane: lanes.length };
  }
  const laneH = 22;
  const total = lanes.length + (draftItem ? 1 : 0);
  const shown = Math.min(Math.max(total, 1), 4);
  const row = h('div', { class: 'tg-row tg-allday', style: { height: shown * laneH + 6 + 'px' } },
    h('div', { class: 'tg-gut' }, 'ALL DAY'),
    days.map((_, i) => h('div', { class: 'tg-adcell', dataset: { idx: String(i) } })));
  const layer = h('div', { class: 'tg-adlayer', style: { overflowY: total > 4 ? 'auto' : 'visible' } });
  const pos = (si, ei, lane) => ({
    left: 'calc(' + (si / n * 100).toFixed(3) + '% + 3px)',
    width: 'calc(' + ((ei - si + 1) / n * 100).toFixed(3) + '% - 8px)',
    top: 3 + lane * laneH + 'px'
  });
  for (const it of items) layer.append(barEl(it.ev, pos(it.si, it.ei, it.lane), 'fill', it));
  if (draftItem) {
    layer.append(h('div', { class: 'bar is-fill is-draft', style: Object.assign({ '--ev': 'var(--accent)', '--ev-ink': 'var(--accent-ink)' }, pos(draftItem.si, draftItem.ei, draftItem.lane)) },
      h('span', null, d.title || '(No title)')));
  }
  row.append(layer);
  return { row, layer };
}

function bindAllDay(ad, days) {
  const { row, layer } = ad;
  const n = days.length;
  const idxAt = (x) => {
    const r = layer.getBoundingClientRect();
    return clamp(Math.floor((x - r.left) / (r.width / n)), 0, n - 1);
  };
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.bar');
    const ev = el && App.events.get(el.dataset.key);
    if (ev) { e.preventDefault(); openDetails(ev, el); }
  });
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const bar = e.target.closest('.bar');
    if (bar && bar.classList.contains('is-draft')) return;
    if (!bar) {
      if (e.target.closest('.tg-gut')) return;
      const idx = idxAt(e.clientX);
      gesture(e, { onTap: () => openQuickCreate({ start: days[idx], end: addDays(days[idx], 1), allDay: true }) });
      return;
    }
    const ev = App.events.get(bar.dataset.key);
    if (!ev) return;
    const i0 = idxAt(e.clientX);
    let delta = 0, ghost = null;
    gesture(e, {
      canStart: () => ev.editable && !ev.pending,
      onStart: () => {
        closeAllLayers();
        bar.classList.add('is-dragging');
        ghost = bar.cloneNode(true);
        ghost.classList.remove('is-dragging');
        ghost.classList.add('ev-ghost');
        ghost.style.transform = 'rotate(-1.5deg)';
        layer.append(ghost);
        Sfx.play('move');
      },
      onMove: (pt) => {
        delta = idxAt(pt.x) - i0;
        ghost.style.marginLeft = (delta * layer.getBoundingClientRect().width / n) + 'px';
      },
      onEnd: () => {
        ghost.remove(); bar.classList.remove('is-dragging');
        if (delta) moveEvent(ev, addDays(ev.start, delta), addDays(ev.end, delta)); else requestRender();
      },
      onCancel: () => { if (ghost) ghost.remove(); bar.classList.remove('is-dragging'); },
      onTap: () => openDetails(ev, bar)
    });
  });
}

/* ---------------- month ---------------- */
function renderMonth() {
  const d = App.date;
  const ws = App.settings.weekStart;
  const weeks = monthWeeks(d);
  const gs = startOfWeek(startOfMonth(d), ws);
  const today = sod(new Date());
  const viewH = $('#view').clientHeight || 640;
  const rowH = (viewH - 30) / weeks;
  const LANE = isMobile() ? 18 : 20, TOP = isMobile() ? 26 : 32;
  const maxRows = Math.max(1, Math.floor((rowH - TOP - 2) / LANE));
  const evs = visibleEvents(gs, addDays(gs, weeks * 7));

  const root = h('div', { class: 'mv' });
  const head = h('div', { class: 'mv-head' });
  for (let i = 0; i < 7; i++) {
    const wd = (ws + i) % 7;
    head.append(h('div', { class: wd === 0 || wd === 6 ? 'is-weekend' : '' }, WEEKDAYS[wd].slice(0, 3).toUpperCase()));
  }
  const grid = h('div', { class: 'mv-grid', style: { '--weeks': String(weeks) } });
  const draft = App.draft;
  for (let w = 0; w < weeks; w++) {
    const w0 = addDays(gs, w * 7);
    const week = h('div', { class: 'mv-week', dataset: { start: ymd(w0) } });
    for (let i = 0; i < 7; i++) {
      const day = addDays(w0, i);
      const cls = ['mv-cell'];
      if (day.getMonth() !== d.getMonth()) cls.push('is-other');
      if (sameDay(day, today)) cls.push('is-today');
      if (day.getDay() === 0 || day.getDay() === 6) cls.push('is-weekend');
      if (draft && sod(draft.start) <= day && (draft.allDay ? addDays(draft.end, -1) : draft.end) >= day) cls.push('is-drop', 'is-draft');
      week.append(h('div', { class: cls.join(' '), dataset: { date: ymd(day) } },
        h('button', { class: 'mv-num', title: 'Open ' + fmtDateLong(day), 'aria-label': fmtDateLong(day), onclick: (ev) => { ev.stopPropagation(); goTo(day, 'day'); } },
          day.getDate() === 1 ? [h('small', null, MONTHS[day.getMonth()].slice(0, 3).toUpperCase()), '1'] : String(day.getDate()))));
    }
    const items = h('div', { class: 'mv-items' });
    layoutMonthWeek(w0, evs, maxRows, LANE, TOP).forEach((node) => items.append(node));
    week.append(items);
    grid.append(week);
  }
  root.append(head, grid);
  root._mount = () => bindMonth(root);
  return root;
}

function layoutMonthWeek(w0, evs, maxRows, LANE, TOP) {
  const we = addDays(w0, 7);
  const items = [];
  for (const e of evs) {
    const zero = e.end.getTime() === e.start.getTime();
    if (!(e.start < we && (e.end > w0 || (zero && e.start >= w0)))) continue;
    const lastDay = e.allDay ? addDays(e.end, -1) : (minutesOfDay(e.end) === 0 && e.end > e.start ? addDays(e.end, -1) : e.end);
    const si = clamp(dayDiff(w0, e.start), 0, 6);
    const ei = clamp(dayDiff(w0, lastDay), 0, 6);
    const span = e.allDay || dayDiff(e.start, lastDay) >= 1;
    items.push({ ev: e, si, ei: Math.max(si, ei), span, contL: e.start < w0, contR: dayDiff(w0, lastDay) > 6 });
  }
  items.sort((a, b) => (a.span === b.span ? 0 : a.span ? -1 : 1) || a.si - b.si || (b.ei - b.si) - (a.ei - a.si) || a.ev.start - b.ev.start);
  const occ = [];
  for (const it of items) {
    let L = 0;
    for (;; L++) {
      if (!occ[L]) occ[L] = new Array(7).fill(false);
      let free = true;
      for (let x = it.si; x <= it.ei; x++) if (occ[L][x]) { free = false; break; }
      if (free) break;
    }
    for (let x = it.si; x <= it.ei; x++) occ[L][x] = true;
    it.lane = L;
  }
  const dayMax = new Array(7).fill(-1);
  for (const it of items) for (let x = it.si; x <= it.ei; x++) dayMax[x] = Math.max(dayMax[x], it.lane);
  const limit = (x) => (dayMax[x] >= maxRows ? maxRows - 1 : maxRows);
  const hidden = new Array(7).fill(0);
  const nodes = [];
  for (const it of items) {
    let lim = maxRows;
    for (let x = it.si; x <= it.ei; x++) lim = Math.min(lim, limit(x));
    if (it.lane < lim) {
      nodes.push(barEl(it.ev, {
        left: 'calc(' + (it.si / 7 * 100).toFixed(3) + '% + 3px)',
        width: 'calc(' + ((it.ei - it.si + 1) / 7 * 100).toFixed(3) + '% - 8px)',
        top: TOP + it.lane * LANE + 'px'
      }, it.span ? 'fill' : 'dot', it));
    } else {
      for (let x = it.si; x <= it.ei; x++) hidden[x]++;
    }
  }
  for (let x = 0; x < 7; x++) {
    if (!hidden[x]) continue;
    const day = addDays(w0, x);
    nodes.push(h('button', {
      class: 'more',
      style: { left: 'calc(' + (x / 7 * 100).toFixed(3) + '% + 3px)', top: TOP + (maxRows - 1) * LANE + 'px' },
      onclick: (ev) => openDayList(day, ev.currentTarget)
    }, '+' + hidden[x] + ' MORE'));
  }
  return nodes;
}

function bindMonth(root) {
  const grid = $('.mv-grid', root);
  grid.addEventListener('touchmove', (e) => { if (App.drag) e.preventDefault(); }, { passive: false });
  const dateAtPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const week = el && el.closest('.mv-week');
    if (!week) return null;
    const r = week.getBoundingClientRect();
    const i = clamp(Math.floor((x - r.left) / (r.width / 7)), 0, 6);
    return addDays(parseYmd(week.dataset.start), i);
  };
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.bar');
    const ev = el && App.events.get(el.dataset.key);
    if (ev) { e.preventDefault(); openDetails(ev, el); }
  });
  grid.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.more') || e.target.closest('.mv-num')) return;
    const bar = e.target.closest('.bar');
    if (!bar) {
      const cell = e.target.closest('.mv-cell');
      if (!cell) return;
      const day = parseYmd(cell.dataset.date);
      gesture(e, { onTap: () => openQuickCreate({ start: day, end: addDays(day, 1), allDay: true }, cell) });
      return;
    }
    const ev = App.events.get(bar.dataset.key);
    if (!ev) return;
    const d0 = dateAtPoint(e.clientX, e.clientY) || sod(ev.start);
    let target = d0, ghost = null, dropCell = null;
    gesture(e, {
      canStart: () => ev.editable && !ev.pending,
      onStart: () => {
        closeAllLayers();
        bar.classList.add('is-dragging');
        const st = evStyle(ev);
        ghost = h('div', { class: 'bar is-fill bar-ghost', style: { '--ev': st.bg, '--ev-ink': st.ink } }, h('span', null, ev.title));
        document.body.append(ghost);
        Sfx.play('move');
      },
      onMove: (pt) => {
        ghost.style.left = pt.x - 30 + 'px';
        ghost.style.top = pt.y - 12 + 'px';
        const t = dateAtPoint(pt.x, pt.y);
        if (t) target = t;
        const cell = $('.mv-cell[data-date="' + ymd(target) + '"]', grid);
        if (cell !== dropCell) {
          if (dropCell) dropCell.classList.remove('is-drop');
          dropCell = cell;
          if (dropCell) dropCell.classList.add('is-drop');
        }
      },
      onEnd: () => {
        ghost.remove(); bar.classList.remove('is-dragging');
        if (dropCell) dropCell.classList.remove('is-drop');
        const delta = dayDiff(d0, target);
        if (delta) moveEvent(ev, addDays(ev.start, delta), addDays(ev.end, delta)); else requestRender();
      },
      onCancel: () => { if (ghost) ghost.remove(); bar.classList.remove('is-dragging'); if (dropCell) dropCell.classList.remove('is-drop'); },
      onTap: () => openDetails(ev, bar)
    });
  });
}

/* ---------------- schedule ---------------- */
function scheduleRow(e, day) {
  const st = evStyle(e);
  const de = addDays(day, 1);
  let time;
  if (e.allDay || (e.start <= day && e.end >= de)) time = 'ALL DAY';
  else if (e.start < day) time = 'UNTIL ' + fmtTime(e.end, true);
  else if (e.end > de) time = fmtTime(e.start, true) + ' →';
  else if (e.end.getTime() === e.start.getTime()) time = fmtTime(e.start, true);
  else time = fmtTime(e.start, true) + ' – ' + fmtTime(e.end, true);
  const cal = App.calMap.get(e.calId);
  const sub = [e.raw.location, cal && cal.name].filter(Boolean).join(' · ');
  const cls = evClasses(e, 'sv-ev');
  return h('button', { class: cls.join(' '), style: { '--ev': st.bg }, dataset: { key: e.key }, onclick: (x) => openDetails(e, x.currentTarget) },
    h('span', { class: 'sv-time' }, time.toUpperCase()),
    h('span', { class: 'sv-sw' }),
    h('span', { class: 'sv-main' }, h('div', { class: 'sv-title' }, e.title), sub ? h('div', { class: 'sv-sub' }, sub) : null));
}

function scheduleDay(d, list, today) {
  return h('div', { class: 'sv-day' + (sameDay(d, today) ? ' is-today' : '') },
    h('button', { class: 'sv-date', title: 'Open ' + fmtDateLong(d), onclick: () => goTo(d, 'day') },
      h('span', { class: 'sv-n' }, d.getDate()),
      h('span', { class: 'sv-wd' }, WEEKDAYS[d.getDay()].slice(0, 3).toUpperCase() + ' · ' + MONTHS[d.getMonth()].slice(0, 3).toUpperCase() + (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : ''))),
    h('div', { class: 'sv-list' }, list.map((e) => scheduleRow(e, d))));
}

function renderSchedule() {
  const { start, end } = viewRange();
  const evs = visibleEvents(start, end);
  const today = sod(new Date());
  const root = h('div', { class: 'sv' });
  root.append(h('div', { class: 'sv-head' }, h('h2', null, 'THE PLAN'), h('span', { class: 'sv-count' }, fmtDateShort(start).toUpperCase() + ' → ' + fmtDateShort(addDays(end, -1)).toUpperCase())));
  let any = false;
  for (let d = sod(start); d < end; d = addDays(d, 1)) {
    const de = addDays(d, 1);
    const list = evs.filter((e) => e.start < de && (e.end > d || (e.end.getTime() === e.start.getTime() && e.start >= d)));
    if (!list.length) continue;
    any = true;
    root.append(scheduleDay(d, list, today));
  }
  if (!any && rangeLoaded(viewRange())) root.append(emptyState('NO TARGETS', 'Nothing planned in the next ' + App.scheduleDays + ' days. Free time. Use it well.'));
  root.append(h('div', { class: 'sv-more' }, h('button', { class: 'jag-btn', onclick: () => { App.scheduleDays += 42; requestRender(); syncNow(); } }, 'LOAD MORE')));
  return root;
}

/* ---------------- search ---------------- */
function renderSearch() {
  const s = App.search || { q: '', results: [], loading: false };
  const root = h('div', { class: 'sv' });
  root.append(h('div', { class: 'sv-head' },
    h('button', { class: 'jag-btn', onclick: leaveSearch }, icon('prev'), ' BACK'),
    h('h2', null, '“' + s.q + '”'),
    h('span', { class: 'sv-count' }, s.loading ? 'HUNTING…' : s.results.length + ' FOUND')));
  if (s.loading) { root.append(h('div', { class: 'loading-bar' })); return root; }
  if (!s.results.length) { root.append(emptyState('NOTHING FOUND', 'No events match “' + s.q + '” in the past year or the next two.')); return root; }
  const today = sod(new Date());
  const groups = new Map();
  for (const e of s.results) {
    const k = ymd(e.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [k, list] of groups) root.append(scheduleDay(parseYmd(k), list, today));
  return root;
}
