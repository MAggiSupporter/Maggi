'use strict';
/* =========================================================================
   store.js — app state, the sync loop and every change you make.
   Changes show up instantly (optimistic), go to Google, and roll back with
   a message if Google says no.
   ========================================================================= */

const THEMES = {
  joker: { name: 'JOKER', sub: 'Phantom red on black', accent: '#e5191c', bg: '#0b0b0d', text: '#f4f1ea' },
  skull: { name: 'SKULL', sub: 'Loud yellow', accent: '#ffd21f', bg: '#0b0b0d', text: '#f4f1ea' },
  panther: { name: 'PANTHER', sub: 'Hot pink', accent: '#ff2e7e', bg: '#0b0b0d', text: '#f4f1ea' },
  oracle: { name: 'ORACLE', sub: 'Hacker green', accent: '#1fe07a', bg: '#040a06', text: '#f4f1ea' },
  velvet: { name: 'VELVET ROOM', sub: 'Blue & gold', accent: '#3a6dff', bg: '#040822', text: '#f3ecd8' },
  crow: { name: 'CROW', sub: 'Light mode', accent: '#e5191c', bg: '#e9e5da', text: '#0b0b0d' }
};

const DEFAULT_SETTINGS = {
  theme: 'joker',
  weekStart: 0,
  h24: false,
  sound: true,
  motion: 'full',
  showtime: true,
  syncSec: 30,
  colorMode: 'google',
  weatherCity: '',
  weatherGeo: null,
  calVis: {},
  view: 'week',
  sidebar: true
};

const ARCANA = ['0 FOOL', 'I MAGICIAN', 'II PRIESTESS', 'III EMPRESS', 'IV EMPEROR', 'V HIEROPHANT', 'VI LOVERS', 'VII CHARIOT',
  'VIII JUSTICE', 'IX HERMIT', 'X FORTUNE', 'XI STRENGTH', 'XII HANGED', 'XIII DEATH', 'XIV TEMPERANCE', 'XV DEVIL', 'XVI TOWER',
  'XVII STAR', 'XVIII MOON', 'XIX SUN', 'XX JUDGEMENT', 'XXI WORLD', 'FAITH', 'COUNCILLOR'];

const App = {
  backend: null,
  user: '',
  settings: Object.assign({}, DEFAULT_SETTINGS),
  calendars: [],
  calMap: new Map(),
  events: new Map(),
  win: {},
  view: 'week',
  prevView: 'week',
  date: sod(new Date()),
  scheduleDays: 42,
  search: null,
  draft: null,
  selectedKey: null,
  syncing: false,
  syncQueued: false,
  lastSync: 0,
  lastAttempt: 0,
  calsAt: 0,
  warnedCals: new Set(),
  offline: false,
  syncErrors: null,
  epoch: 0,
  pending: 0,
  drag: null,
  renderQueued: false,
  masters: new Map(),
  miniMonth: null,
  tgScroll: null,
  ready: false
};

/* ---------------- settings ---------------- */
const SETTINGS_KEY = 'phantom-calendar-settings';
function loadSettings() {
  const saved = lsGet(SETTINGS_KEY, null);
  App.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
  if (!saved && reducedMotion()) App.settings.motion = 'lite';
}
const pushSettingsToServer = debounce(() => {
  if (App.backend && App.backend.kind === 'google') App.backend.saveSettings(App.settings).catch(() => {});
}, 1500);
function saveSettings() {
  // forget show/hide choices for calendars that no longer exist
  if (App.calendars.length) {
    const kept = {};
    for (const id of Object.keys(App.settings.calVis || {})) if (App.calMap.has(id)) kept[id] = App.settings.calVis[id];
    App.settings.calVis = kept;
  }
  lsSet(SETTINGS_KEY, App.settings);
  pushSettingsToServer();
}
function setSetting(key, value) {
  App.settings[key] = value;
  saveSettings();
  applySettings();
  requestRender();
}
function applySettings() {
  const b = document.body;
  b.dataset.theme = THEMES[App.settings.theme] ? App.settings.theme : 'joker';
  b.dataset.motion = App.settings.motion;
}

/* ---------------- calendars ---------------- */
function setCalendars(list) {
  const order = (c) => (c.primary ? 0 : c.accessRole === 'owner' ? 1 : c.accessRole === 'writer' ? 2 : 3);
  App.calendars = list.slice().sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  App.calendars.forEach((c, i) => {
    c.arcana = ARCANA[i % ARCANA.length];
    c.display = punch(c.color);
    c.writable = c.accessRole === 'owner' || c.accessRole === 'writer';
    c.index = i;
  });
  App.calMap = new Map(App.calendars.map((c) => [c.id, c]));
}
function calVisible(c) {
  const v = App.settings.calVis[c.id];
  return v == null ? c.selected !== false : v;
}
function toggleCalendar(id) {
  const c = App.calMap.get(id);
  if (!c) return;
  App.settings.calVis = Object.assign({}, App.settings.calVis, { [id]: !calVisible(c) });
  saveSettings();
  Sfx.play(calVisible(c) ? 'select' : 'back');
  requestRender();
  if (calVisible(c)) syncNow();
}
function writableCalendars() { return App.calendars.filter((c) => c.writable); }
/** Where a new event goes: your main calendar, preferring calendars that are shown. */
function defaultCalendarId() {
  const all = writableCalendars();
  const pick = (list) => (list.find((c) => c.primary) || list[0] || {}).id;
  return pick(all.filter(calVisible)) || pick(all);
}

/** Re-reads the calendar list so calendars added, renamed or removed in Google show up. */
async function refreshCalendars() {
  if (!App.backend || !App.backend.calendars) return;
  App.calsAt = Date.now();
  try {
    const list = await App.backend.calendars();
    if (!Array.isArray(list) || !list.length) return;
    const sig = (cals) => cals.map((c) => c.id + '|' + c.name + '|' + c.color + '|' + c.accessRole).join(',');
    const before = sig(App.calendars);
    setCalendars(list);
    if (sig(App.calendars) !== before) {
      rebuildEvents();
      requestRender();
      syncNow();
    }
  } catch (e) { /* try again next time */ }
}

/* ---------------- events ---------------- */
function normEvent(raw) {
  const cal = App.calMap.get(raw.calendarId);
  const allDay = !!(raw.start && raw.start.date);
  const start = allDay ? parseYmd(raw.start.date) : new Date(raw.start.dateTime);
  let end = raw.end ? (allDay ? parseYmd(raw.end.date) : new Date(raw.end.dateTime)) : start;
  if (allDay && !(end > start)) end = addDays(start, 1);
  if (!allDay && end < start) end = start;
  const self = (raw.attendees || []).find((a) => a.self);
  const dl = raw.privateProps && raw.privateProps.pcDeadline;
  return {
    key: raw.calendarId + '|' + raw.id,
    raw,
    id: raw.id,
    calId: raw.calendarId,
    seriesId: raw.recurringEventId || null,
    title: raw.summary || '(No title)',
    start, end, allDay,
    colorId: raw.colorId || null,
    editable: canEdit(raw, cal),
    declined: !!(self && self.status === 'declined'),
    free: raw.transparency === 'transparent',
    deadline: dl === '1' || (dl !== '0' && /\b(deadline|due)\b/i.test(raw.summary || '')),
    pending: false
  };
}
function canEdit(raw, cal) {
  if (!cal || !cal.writable) return false;
  if (raw.locked || raw.privateCopy) return false;
  if (raw.eventType && !['default', 'outOfOffice', 'focusTime'].includes(raw.eventType)) return false;
  const hasGuests = raw.attendees && raw.attendees.length > 0;
  return raw.organizerSelf || raw.creatorSelf || raw.guestsCanModify || !hasGuests;
}

const MONO = [
  { bg: 'var(--accent)', ink: 'var(--accent-ink)' },
  { bg: '#f4f1ea', ink: '#0b0b0d' },
  { bg: '#26262c', ink: '#f4f1ea' },
  { bg: 'var(--accent-deep)', ink: '#ffffff' },
  { bg: '#bdb8ad', ink: '#0b0b0d' }
];
/** Colour of an event block: its own Google colour, else its calendar's. */
function evStyle(ev) {
  const cal = App.calMap.get(ev.calId);
  if (App.settings.colorMode === 'mono') return MONO[(cal ? cal.index : 0) % MONO.length];
  const hex = ev.colorId && EVENT_COLORS[ev.colorId] ? EVENT_COLORS[ev.colorId].hex : (cal ? cal.display : '#e5191c');
  return { bg: hex, ink: inkFor(hex) };
}
function calStyle(cal) {
  if (App.settings.colorMode === 'mono') return MONO[cal.index % MONO.length];
  return { bg: cal.display, ink: inkFor(cal.display) };
}

function visibleEvents(start, end) {
  const out = [];
  for (const ev of App.events.values()) {
    const cal = App.calMap.get(ev.calId);
    if (!cal || !calVisible(cal)) continue;
    if (ev.start < end && (ev.end > start || (ev.end.getTime() === ev.start.getTime() && ev.start >= start))) out.push(ev);
  }
  out.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.title.localeCompare(b.title));
  return out;
}

function rebuildEvents() {
  const map = new Map();
  for (const key of Object.keys(App.win)) {
    for (const raw of App.win[key].raw) {
      if (!raw || !raw.start) continue;
      const ev = normEvent(raw);
      map.set(ev.key, ev);
    }
  }
  // keep events that are still being saved
  for (const [k, ev] of App.events) if (ev.pending && k.startsWith('tmp|')) map.set(k, ev);
  App.events = map;
}

/* ---------------- what's on screen ---------------- */
function gridDays() {
  if (App.view === 'day') return 1;
  return isMobile() ? 3 : 7;
}
function viewRange() {
  const d = App.date;
  const ws = App.settings.weekStart;
  switch (App.view) {
    case 'day': return { start: sod(d), end: addDays(sod(d), 1) };
    case 'week': {
      const s = isMobile() ? sod(d) : startOfWeek(d, ws);
      return { start: s, end: addDays(s, gridDays()) };
    }
    case 'month': {
      const s = startOfWeek(startOfMonth(d), ws);
      return { start: s, end: addDays(s, monthWeeks(d) * 7) };
    }
    case 'schedule':
    default:
      return { start: sod(d), end: addDays(sod(d), App.scheduleDays) };
  }
}
function monthWeeks(d) {
  const s = startOfWeek(startOfMonth(d), App.settings.weekStart);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return Math.ceil((dayDiff(s, last) + 1) / 7);
}
function computeWindows() {
  const v = viewRange();
  const padDays = App.view === 'month' ? 0 : 7;
  const vs = addDays(v.start, -padDays), ve = addDays(v.end, padDays);
  const today = sod(new Date());
  const us = addDays(today, -1), ue = addDays(today, 62);
  const s = minDate(vs, us), e = maxDate(ve, ue);
  if ((e - s) / DAY_MS <= 130) return [{ key: 'main', timeMin: s, timeMax: e }];
  return [{ key: 'view', timeMin: vs, timeMax: ve }, { key: 'up', timeMin: us, timeMax: ue }];
}
function rangeLoaded(r) {
  return Object.values(App.win).some((w) => w.timeMin <= r.start && w.timeMax >= r.end);
}

/* ---------------- sync: Google → app ---------------- */
async function syncNow() {
  if (!App.backend || !App.calendars.length) return;
  if (App.pending > 0) return; // a change is on its way to Google; mutationEnd() syncs right after
  if (App.syncing) { App.syncQueued = true; return; }
  App.syncing = true;
  App.lastAttempt = Date.now();
  updateSyncChip();
  const wins = computeWindows();
  const calIds = App.calendars.filter(calVisible).map((c) => c.id);
  const calSig = calIds.join(',');
  const prepared = wins.map((w) => {
    const sig = w.timeMin.toISOString() + '|' + w.timeMax.toISOString() + '|' + calSig;
    const prev = App.win[w.key];
    return { key: w.key, timeMin: w.timeMin, timeMax: w.timeMax, sig, hash: prev && prev.sig === sig ? prev.hash : null };
  });
  const epoch = App.epoch;
  try {
    const res = await App.backend.sync({
      calendarIds: calIds,
      windows: prepared.map((w) => ({ key: w.key, timeMin: w.timeMin.toISOString(), timeMax: w.timeMax.toISOString(), hash: w.hash }))
    });
    if (epoch !== App.epoch) { if (!App.pending) App.syncQueued = true; return; }
    // a calendar Google couldn't read this time keeps its last known events,
    // so a hiccup never looks like your events were deleted
    const failed = new Set((res.errors || []).map((e) => e.calendarId));
    const next = {};
    let changed = Object.keys(App.win).length !== prepared.length;
    for (const w of prepared) {
      const r = res.windows && res.windows[w.key];
      if (!r) continue;
      const prev = App.win[w.key];
      let raw = r.unchanged && prev ? prev.raw : (r.events || []);
      let hash = r.hash;
      if (failed.size && !r.unchanged) {
        raw = raw.concat(lastKnownEvents(failed, w.timeMin, w.timeMax));
        hash = null;
      }
      if (!r.unchanged) changed = true;
      next[w.key] = { timeMin: w.timeMin, timeMax: w.timeMax, sig: w.sig, hash, raw };
    }
    for (const id of failed) {
      if (App.warnedCals.has(id)) continue;
      App.warnedCals.add(id);
      const c = App.calMap.get(id);
      toast('Google didn\u2019t send \u201c' + (c ? c.name : id) + '\u201d just now, so you\u2019re seeing its last copy. Trying again shortly.');
    }
    for (const id of Array.from(App.warnedCals)) if (!failed.has(id)) App.warnedCals.delete(id);
    App.win = next;
    if (changed) rebuildEvents();
    App.lastSync = Date.now();
    if (App.offline) toast('Back online. Your calendar is synced.');
    App.offline = false;
    App.syncErrors = res.errors && res.errors.length ? res.errors : null;
    if (changed) requestRender();
  } catch (err) {
    if (App.backend.kind === 'google' && isLockedOut(err)) {
      // the passcode screen is showing; syncing resumes once it's entered
    } else {
      if (!App.offline) toast("Couldn't reach Google Calendar. Retrying… (" + errMsg(err) + ')', { kind: 'error' });
      App.offline = true;
    }
  } finally {
    App.syncing = false;
    updateSyncChip();
    if (App.syncQueued) { App.syncQueued = false; setTimeout(syncNow, 250); }
  }
}
function rawRange(raw) {
  const s = raw.start.date ? parseYmd(raw.start.date) : new Date(raw.start.dateTime);
  const e = raw.end ? (raw.end.date ? parseYmd(raw.end.date) : new Date(raw.end.dateTime)) : s;
  return [s, e];
}
function lastKnownEvents(calIds, from, to) {
  const out = new Map();
  for (const w of Object.values(App.win)) {
    for (const raw of w.raw) {
      if (!raw || !raw.start || !calIds.has(raw.calendarId)) continue;
      const [s, e] = rawRange(raw);
      if (s < to && (e > from || (e.getTime() === s.getTime() && s >= from))) out.set(raw.calendarId + '|' + raw.id, raw);
    }
  }
  return Array.from(out.values());
}

let syncTimer = null;
function scheduleSync(ms) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, ms);
}
function errMsg(err) {
  const m = String((err && err.message) || err || 'unknown error');
  return m.replace(/^Exception:\s*/, '').replace(/^PC_\w+:\s*/, '').slice(0, 200);
}

/* ---------------- changes: app → Google ---------------- */
function mutationStart() { App.epoch++; App.pending++; }
function mutationEnd(soonMs) {
  App.pending = Math.max(0, App.pending - 1);
  App.epoch++;
  App.masters.clear();
  for (const k of Object.keys(App.win)) App.win[k].hash = null;
  scheduleSync(soonMs || 1500);
  if (App.view === 'search' && App.search) setTimeout(() => App.search && runSearch(App.search.q), 900);
}

/** start/end for Google. When an existing event (ev) switches between
    all-day and timed, the half it no longer uses is set to null (= remove). */
function timePatch(ev, s, e, allDay) {
  const ad = allDay != null ? allDay : ev.allDay;
  const switching = !!ev && ad !== ev.allDay;
  if (ad) {
    return switching
      ? { start: { date: ymd(s), dateTime: null, timeZone: null }, end: { date: ymd(e), dateTime: null, timeZone: null } }
      : { start: { date: ymd(s) }, end: { date: ymd(e) } };
  }
  const tz = (ev && !switching && ev.raw && ev.raw.start && ev.raw.start.timeZone) || LOCAL_TZ;
  const tzEnd = (ev && !switching && ev.raw && ev.raw.end && ev.raw.end.timeZone) || tz;
  const start = { dateTime: toRfc3339(s), timeZone: tz };
  const end = { dateTime: toRfc3339(e), timeZone: tzEnd };
  if (switching) { start.date = null; end.date = null; }
  return { start, end };
}

function reminderPatch(value) {
  if (value === 'default') return { useDefault: true };
  if (value === 'none') return { useDefault: false, overrides: [] };
  return { useDefault: false, overrides: [{ method: 'popup', minutes: +value }] };
}

/** draft: { calId, title, start, end, allDay, location, description, colorId, recurrence, reminder, free, deadline } */
function draftToResource(d) {
  const r = Object.assign({ summary: d.title || '' }, timePatch(null, d.start, d.end, d.allDay));
  if (d.location) r.location = d.location;
  if (d.description) r.description = d.description;
  if (d.colorId) r.colorId = d.colorId;
  if (d.recurrence) r.recurrence = [d.recurrence];
  if (d.reminder && d.reminder !== 'default') r.reminders = reminderPatch(d.reminder);
  if (d.free) r.transparency = 'transparent';
  if (d.deadline) r.extendedProperties = { private: { pcDeadline: '1' } };
  return r;
}

async function createEvent(draft) {
  const calId = draft.calId || defaultCalendarId();
  if (!calId) { toast('No calendar you can write to.', { kind: 'error' }); return null; }
  const resource = draftToResource(draft);
  const tmpKey = 'tmp|' + uid();
  const tmp = normEvent(Object.assign({ calendarId: calId, id: tmpKey.slice(4), organizerSelf: true, creatorSelf: true, attendees: [] }, resource,
    { privateProps: draft.deadline ? { pcDeadline: '1' } : null }));
  tmp.key = tmpKey;
  tmp.pending = true;
  App.events.set(tmpKey, tmp);
  requestRender();
  mutationStart();
  try {
    const saved = await App.backend.createEvent(calId, resource);
    App.events.delete(tmpKey);
    const ev = normEvent(saved);
    if (!resource.recurrence) App.events.set(ev.key, ev);
    FX.callingCard(ev);
    const cal = App.calMap.get(calId);
    if (cal && !calVisible(cal)) toast('Saved to \u201c' + cal.name + '\u201d, which is hidden. Click its card under CONFIDANTS to show it.');
    return ev;
  } catch (err) {
    App.events.delete(tmpKey);
    toast("Couldn't create the event: " + errMsg(err), { kind: 'error' });
    return null;
  } finally {
    mutationEnd(resource.recurrence ? 200 : 1500);
    requestRender();
  }
}

/**
 * Sends a change to Google.
 * local: fields to show immediately ({start, end, allDay, title...}).
 * scope: 'single' | 'series'.
 */
async function updateEvent(ev, patch, opts, local, undoLabel) {
  opts = opts || {};
  const before = App.events.get(ev.key) || ev;
  const shown = Object.assign({}, before, local || {}, { pending: true });
  App.events.set(ev.key, shown);
  requestRender();
  mutationStart();
  let ok = false;
  try {
    const saved = await App.backend.updateEvent(ev.calId, ev.id, patch, opts);
    if (opts.scope === 'series') {
      shown.pending = false; // the occurrences reload on the next sync
    } else {
      App.events.delete(ev.key);
      const n = normEvent(saved);
      App.events.set(n.key, n);
    }
    ok = true;
    if (undoLabel) {
      toast(undoLabel, { action: { label: 'UNDO', fn: () => undoTimeChange(ev, shown, opts) } });
    }
  } catch (err) {
    App.events.set(ev.key, before);
    toast("Google refused the change: " + errMsg(err), { kind: 'error' });
  } finally {
    mutationEnd(opts.scope === 'series' ? 200 : 1500);
    requestRender();
  }
  return ok;
}

function undoTimeChange(orig, moved, opts) {
  const cur = App.events.get(orig.key) || moved;
  if (opts.scope === 'series') {
    updateEvent(cur, {}, { scope: 'series', seriesId: orig.seriesId, shiftMs: -opts.shiftMs, durationMs: orig.end - orig.start, dayShift: -opts.dayShift },
      { start: orig.start, end: orig.end });
  } else {
    updateEvent(cur, timePatch(orig, orig.start, orig.end), {}, { start: orig.start, end: orig.end });
  }
}

/** Where this occurrence would be if nobody had moved it on its own (for moving a whole series). */
function seriesBase(ev) {
  const o = ev.raw && ev.raw.originalStartTime;
  if (!o || (!o.date && !o.dateTime)) return ev.start;
  return o.date ? parseYmd(o.date) : new Date(o.dateTime);
}

/** Drag-and-drop and resize end up here. */
async function moveEvent(ev, newStart, newEnd) {
  if (!ev.editable) { toast('Read-only: this event can’t be changed here.'); requestRender(); return; }
  if (newStart.getTime() === ev.start.getTime() && newEnd.getTime() === ev.end.getTime()) { requestRender(); return; }
  let scope = 'single';
  if (ev.seriesId) {
    scope = await askScope('MOVE A REPEATING EVENT');
    if (!scope) { requestRender(); return; }
  }
  Sfx.play('drop');
  const label = newEnd - newStart !== ev.end - ev.start && newStart.getTime() === ev.start.getTime() ? 'Event resized.' : 'Event moved to ' + (ev.allDay ? fmtDateShort(newStart) : fmtDateShort(newStart) + ', ' + fmtTime(newStart)) + '.';
  if (scope === 'series') {
    const base = seriesBase(ev);
    await updateEvent(ev, {}, { scope: 'series', seriesId: ev.seriesId, shiftMs: newStart - base, durationMs: newEnd - newStart, dayShift: dayDiff(base, newStart) },
      { start: newStart, end: newEnd }, label);
  } else {
    await updateEvent(ev, timePatch(ev, newStart, newEnd), {}, { start: newStart, end: newEnd }, label);
  }
}

async function deleteEvent(ev) {
  if (!ev.editable) { toast('Read-only: this event can’t be deleted here.'); return; }
  let scope = 'single';
  if (ev.seriesId) {
    scope = await askScope('DELETE A REPEATING EVENT');
    if (!scope) return;
  } else {
    const ok = await confirmDialog({ title: 'ERASE THIS TARGET?', text: '“' + ev.title + '” will be deleted from Google Calendar.', yes: 'Erase it.', no: 'Never mind.' });
    if (!ok) return;
  }
  closeAllLayers();
  const targetId = scope === 'series' ? ev.seriesId : ev.id;
  const removed = [];
  for (const [k, e] of App.events) {
    const hit = scope === 'series' ? e.calId === ev.calId && (e.seriesId === ev.seriesId || e.id === ev.seriesId) : k === ev.key;
    if (hit) removed.push([k, e]);
  }
  removed.forEach(([k]) => App.events.delete(k));
  Sfx.play('erase');
  requestRender();
  mutationStart();
  try {
    await App.backend.deleteEvent(ev.calId, targetId);
    toast(scope === 'series' ? 'Every event in the series: erased.' : 'Target erased.');
  } catch (err) {
    removed.forEach(([k, e]) => App.events.set(k, e));
    toast("Couldn't delete: " + errMsg(err), { kind: 'error' });
  } finally {
    mutationEnd();
    requestRender();
  }
}

/* ---------------- search ---------------- */
async function runSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  if (App.view !== 'search') App.prevView = App.view;
  App.view = 'search';
  App.search = { q, loading: true, results: [] };
  requestRender();
  try {
    const now = new Date();
    const res = await App.backend.search({
      q,
      calendarIds: App.calendars.filter(calVisible).map((c) => c.id),
      timeMin: addDays(now, -366).toISOString(),
      timeMax: addDays(now, 731).toISOString()
    });
    if (!App.search || App.search.q !== q) return;
    App.search.results = (res.events || []).map(normEvent);
  } catch (err) {
    toast('Search failed: ' + errMsg(err), { kind: 'error' });
  }
  if (App.search && App.search.q === q) App.search.loading = false;
  requestRender();
}
function leaveSearch() {
  if (App.view !== 'search') return;
  App.view = App.prevView || 'week';
  App.search = null;
  const input = $('#searchInput');
  if (input) { input.value = ''; input.blur(); }
  const form = $('#searchForm');
  if (form) form.classList.remove('is-open');
  requestRender();
}
