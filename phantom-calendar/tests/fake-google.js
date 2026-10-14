// A small stand-in for Google Apps Script + the Calendar API, so the real
// apps-script/Code.gs can run in Node during tests. It copies the Google
// behaviours the app depends on: singleEvents expansion of weekly series,
// patch = recursive merge where null deletes, instance ids like
// "<id>_20261014T160000Z", and events.move.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

function merge(target, patch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v === null) delete target[k];
    else if (typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) merge(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}

function dropNulls(o) {
  for (const k of Object.keys(o)) {
    if (o[k] === null) delete o[k];
    else if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) dropNulls(o[k]);
  }
  return o;
}

function ms(t) { return t.date ? Date.parse(t.date + 'T00:00:00Z') : Date.parse(t.dateTime); }
function stamp(d, allDay) {
  const iso = new Date(d).toISOString();
  return allDay ? iso.slice(0, 10).replace(/-/g, '') : iso.replace(/[-:]/g, '').replace(/\.\d+/, '');
}
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function makeCalendar() {
  const state = {
    calendars: [
      { id: 'me@example.com', summary: 'me@example.com', primary: true, accessRole: 'owner', backgroundColor: '#9fe1e7', foregroundColor: '#000000', timeZone: 'UTC', selected: true },
      { id: 'work@group', summary: 'Work', accessRole: 'owner', backgroundColor: '#16a765', foregroundColor: '#000000', timeZone: 'UTC', selected: true },
      { id: 'holidays@group', summary: 'Holidays', accessRole: 'reader', backgroundColor: '#f83a22', foregroundColor: '#000000', timeZone: 'UTC', selected: true }
    ],
    events: { 'me@example.com': [], 'work@group': [], 'holidays@group': [] },
    exceptions: {},
    calls: [],
    nextId: 1
  };
  const find = (calId, id) => (state.events[calId] || []).find((e) => e.id === id);
  const decorate = (ev, calId) => Object.assign(ev, {
    htmlLink: 'https://calendar.google.com/event?eid=' + ev.id,
    organizer: ev.organizer || { email: calId, self: true },
    creator: ev.creator || { email: calId, self: true },
    status: ev.status || 'confirmed'
  });

  function instances(master, tMin, tMax) {
    const out = [];
    const rule = (master.recurrence || []).find((l) => l.startsWith('RRULE:')) || '';
    const byday = (rule.match(/BYDAY=([^;]+)/) || [])[1];
    const allDay = !!master.start.date;
    const s0 = ms(master.start), dur = ms(master.end) - s0;
    for (let i = 0, t = s0; i < 400 && t < tMax; i++, t += 864e5) {
      const day = DAYS[new Date(t).getUTCDay()];
      if (!/FREQ=WEEKLY/.test(rule)) break;
      if (byday ? !byday.split(',').includes(day) : new Date(t).getUTCDay() !== new Date(s0).getUTCDay()) continue;
      if (t + dur <= tMin) continue;
      const id = master.id + '_' + stamp(t, allDay);
      const ex = state.exceptions[id];
      if (ex && ex.status === 'cancelled') continue;
      const when = (x) => (allDay ? { date: new Date(x).toISOString().slice(0, 10) } : { dateTime: new Date(x).toISOString(), timeZone: master.start.timeZone });
      const inst = Object.assign(clone(master), { id, recurringEventId: master.id, start: when(t), end: when(t + dur), originalStartTime: when(t) });
      delete inst.recurrence;
      out.push(ex ? merge(inst, clone(ex)) : inst);
    }
    return out;
  }

  const Calendar = {
    CalendarList: { list: () => ({ items: clone(state.calendars) }) },
    Events: {
      list(calId, p) {
        state.calls.push(['list', calId]);
        if (!state.events[calId]) throw new Error('Not Found');
        const tMin = Date.parse(p.timeMin), tMax = Date.parse(p.timeMax);
        let items = [];
        for (const ev of state.events[calId]) {
          if (ev.recurrence && p.singleEvents) items.push(...instances(ev, tMin, tMax));
          else if (ms(ev.start) < tMax && ms(ev.end) > tMin) items.push(clone(ev));
        }
        if (p.q) items = items.filter((e) => (e.summary || '').toLowerCase().includes(p.q.toLowerCase()));
        items.sort((a, b) => ms(a.start) - ms(b.start));
        return { items };
      },
      get(calId, id) {
        const ev = find(calId, id);
        if (ev) return clone(ev);
        const master = find(calId, id.split('_')[0]);
        const inst = master && instances(master, -Infinity, Infinity).find((i) => i.id === id);
        if (!inst) throw new Error('Not Found');
        return inst;
      },
      insert(res, calId) {
        state.calls.push(['insert', calId, clone(res)]);
        if (res.recurrence && res.start.dateTime && !res.start.timeZone) throw new Error('Missing time zone definition for start time.');
        const ev = decorate(Object.assign(clone(res), { id: 'ev' + state.nextId++ }), calId);
        state.events[calId].push(ev);
        return clone(ev);
      },
      patch(patch, calId, id) {
        state.calls.push(['patch', calId, id, clone(patch)]);
        patch = dropNulls(clone(patch)); // worst case: assume nulls never reach Google
        const cal = state.calendars.find((c) => c.id === calId);
        if (!cal || !['owner', 'writer'].includes(cal.accessRole)) throw new Error('Forbidden');
        let ev = find(calId, id);
        if (!ev) {
          const masterId = id.split('_')[0];
          const master = find(calId, masterId);
          if (!master) throw new Error('Not Found');
          state.exceptions[id] = merge(state.exceptions[id] || {}, patch);
          const inst = instances(master, -Infinity, Infinity).find((i) => i.id === id) || merge(Object.assign(clone(master), { id }), clone(state.exceptions[id]));
          return inst;
        }
        merge(ev, patch);
        for (const k of ['start', 'end']) if (ev[k] && ev[k].date && ev[k].dateTime) throw new Error('Invalid ' + k + ': both date and dateTime set');
        if (ev.recurrence && !ev.recurrence.length) delete ev.recurrence;
        return clone(ev);
      },
      update(res, calId, id) {
        state.calls.push(['update', calId, id, clone(res)]);
        for (const k of ['start', 'end']) if (res[k] && res[k].date && res[k].dateTime) throw new Error('Invalid ' + k + ': both date and dateTime set');
        const list = state.events[calId];
        const i = list.findIndex((e) => e.id === id);
        if (i < 0) { state.exceptions[id] = clone(res); return clone(res); }
        list[i] = decorate(Object.assign(clone(res), { id }), calId);
        return clone(list[i]);
      },
      remove(calId, id) {
        state.calls.push(['remove', calId, id]);
        const list = state.events[calId];
        const i = list.findIndex((e) => e.id === id);
        if (i >= 0) list.splice(i, 1);
        else state.exceptions[id] = { status: 'cancelled' };
      },
      move(calId, id, dest) {
        state.calls.push(['move', calId, id, dest]);
        const list = state.events[calId];
        const i = list.findIndex((e) => e.id === id);
        if (i < 0) throw new Error('Cannot move an occurrence');
        const [ev] = list.splice(i, 1);
        state.events[dest].push(ev);
        return clone(ev);
      }
    }
  };
  const add = (calId, ev) => { const e = decorate(Object.assign({ id: 'ev' + state.nextId++ }, clone(ev)), calId); state.events[calId].push(e); return e; };
  return { Calendar, state, add, find };
}

function loadCodeGs(opts) {
  opts = opts || {};
  const fake = makeCalendar();
  const props = {};
  const sandbox = {
    Calendar: opts.noService ? undefined : fake.Calendar,
    HtmlService: { createHtmlOutputFromFile() { return this; }, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; }, XFrameOptionsMode: { DEFAULT: 'DEFAULT' } },
    PropertiesService: { getUserProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'me@example.com' }), getScriptTimeZone: () => 'UTC' },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => Array.from(crypto.createHash('md5').update(text, 'utf8').digest()),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64')
    },
    JSON, Math, Date, String, Error, Object, Array
  };
  if (opts.noService) delete sandbox.Calendar;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
  return { gas: sandbox, fake, props };
}

module.exports = { loadCodeGs, merge };
