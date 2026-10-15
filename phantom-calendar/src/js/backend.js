'use strict';
/* =========================================================================
   backend.js — where events come from.
   GoogleBackend: running inside Google Apps Script → your real calendar.
   DemoBackend:   anywhere else → fake events saved in this browser.
   Both speak the same "Google Calendar event" format.
   ========================================================================= */

function runningInAppsScript() {
  return typeof google !== 'undefined' && google && google.script && google.script.run;
}

const KEY_STORE = 'phantom-calendar-device-key';

const GoogleBackend = {
  kind: 'google',
  token: null,
  legacy: false, // an older Code.gs without the passcode lock

  /** Calls a server function directly. */
  raw(fn, ...args) {
    return new Promise((resolve, reject) => {
      const run = google.script.run
        .withSuccessHandler((r) => {
          try { resolve(typeof r === 'string' ? JSON.parse(r) : r); } catch (e) { reject(e); }
        })
        .withFailureHandler((err) => reject(err instanceof Error ? err : new Error(String((err && err.message) || err))));
      if (typeof run[fn] !== 'function') { reject(new Error('Script function not found: ' + fn)); return; }
      run[fn](...args);
    });
  },
  /** Calls a calendar function, sending this device's key. */
  call(fn, ...args) {
    const p = this.legacy ? this.raw(fn, ...args) : this.raw(fn, this.token || '', ...args);
    return p.catch((err) => {
      if (isLockedOut(err) && typeof onDeviceLocked === 'function') onDeviceLocked();
      throw err;
    });
  },
  has(fn) {
    try { return typeof google.script.run[fn] === 'function'; } catch (e) { return false; }
  },

  loadKey() {
    try { this.token = localStorage.getItem(KEY_STORE) || this.token; } catch (e) { /* no storage: keep it in memory */ }
  },
  saveKey(token) {
    this.token = token || null;
    try {
      if (token) localStorage.setItem(KEY_STORE, token);
      else localStorage.removeItem(KEY_STORE);
    } catch (e) { /* no storage: memory only */ }
  },
  async authState() {
    if (!this.has('pcAuthState')) {
      this.legacy = true;
      return { legacy: true, hasPasscode: true, service: true, lockedForMs: 0 };
    }
    return this.raw('pcAuthState');
  },
  async setPasscode(passcode) {
    const r = await this.raw('pcSetPasscode', passcode);
    this.saveKey(r.token);
    return r;
  },
  async unlock(passcode) {
    const r = await this.raw('pcUnlock', passcode);
    this.saveKey(r.token);
    return r;
  },
  async changePasscode(passcode) {
    const r = await this.call('pcChangePasscode', passcode);
    this.saveKey(r.token);
    return r;
  },
  /** Signs this device out on the server too, so a copied key stops working. */
  async lockDevice() {
    const token = this.token;
    this.saveKey(null);
    if (!this.legacy && token && this.has('pcLockDevice')) {
      try { await this.raw('pcLockDevice', token); } catch (e) { /* the key is gone from here either way */ }
    }
  },

  bootstrap() { return this.call('pcBootstrap'); },
  calendars() { return this.call('pcCalendars').then((r) => r.calendars); },
  sync(req) { return this.call('pcSync', JSON.stringify(req)); },
  createEvent(calId, resource) { return this.call('pcCreateEvent', calId, JSON.stringify(resource)); },
  updateEvent(calId, eventId, patch, opts) { return this.call('pcUpdateEvent', calId, eventId, JSON.stringify(patch || {}), JSON.stringify(opts || {})); },
  deleteEvent(calId, eventId) { return this.call('pcDeleteEvent', calId, eventId); },
  getEvent(calId, eventId) { return this.call('pcGetEvent', calId, eventId); },
  search(req) { return this.call('pcSearch', JSON.stringify(req)); },
  saveSettings(settings) { return this.call('pcSaveSettings', JSON.stringify(settings)); }
};

/** The device's key was refused (passcode changed on another device, or reset). */
function isLockedOut(err) {
  return /PC_AUTH/.test(String((err && err.message) || err));
}

/* ------------------------------------------------------------------------ */

const DEMO_KEY = 'phantom-calendar-demo-v1';

const DemoBackend = {
  kind: 'demo',
  db: null,

  load() {
    if (this.db) return;
    const saved = lsGet(DEMO_KEY, null);
    this.db = saved && saved.version === 1 ? saved : demoSeed();
    this.save();
  },
  save() { lsSet(DEMO_KEY, this.db); },
  reset() { this.db = demoSeed(); this.save(); },

  async bootstrap() {
    this.load();
    await wait(450);
    return { user: 'joker@phantom.demo', timeZone: LOCAL_TZ, calendars: this.db.calendars, settings: null };
  },

  async calendars() {
    this.load();
    return JSON.parse(JSON.stringify(this.db.calendars));
  },

  async sync(req) {
    this.load();
    await wait(140);
    const out = { windows: {}, errors: [] };
    for (const w of req.windows) {
      const events = this.list(req.calendarIds, new Date(w.timeMin), new Date(w.timeMax));
      const hash = String(hashStr(JSON.stringify(events)));
      out.windows[w.key] = w.hash === hash ? { hash, unchanged: true } : { hash, events };
    }
    return out;
  },

  list(calIds, from, to, q) {
    const out = [];
    const ids = new Set(calIds);
    for (const ev of this.db.events) {
      if (!ids.has(ev.calendarId)) continue;
      if (ev.recurrence && ev.recurrence.length) {
        for (const inst of demoExpand(ev, from, to, this.db.overrides)) out.push(inst);
      } else if (demoOverlaps(ev, from, to)) {
        out.push(ev);
      }
    }
    const res = q ? out.filter((e) => (e.summary + ' ' + e.description + ' ' + e.location).toLowerCase().includes(q.toLowerCase())) : out;
    return res.map((e) => JSON.parse(JSON.stringify(e))).sort((a, b) => demoStart(a) - demoStart(b));
  },

  async createEvent(calId, resource) {
    this.load();
    await wait(260);
    const ev = demoEvent(Object.assign({}, resource, { calendarId: calId, id: 'demo' + uid() }));
    this.db.events.push(ev);
    this.save();
    return JSON.parse(JSON.stringify(ev));
  },

  async updateEvent(calId, eventId, patch, opts) {
    this.load();
    await wait(220);
    opts = opts || {};
    patch = JSON.parse(JSON.stringify(patch || {}));
    const findMaster = (id) => this.db.events.find((e) => e.id === id);

    if (opts.scope === 'series' && opts.seriesId) {
      const master = findMaster(opts.seriesId);
      if (!master) throw new Error('That event no longer exists.');
      if (opts.shiftMs || opts.dayShift || opts.durationMs != null) {
        const t = demoShift(master, opts.shiftMs || 0, opts.durationMs, opts.dayShift || 0);
        patch.start = t.start; patch.end = t.end;
        if (t.recurrence && !patch.recurrence) patch.recurrence = t.recurrence;
      }
      demoApply(master, patch);
      if (opts.moveTo) master.calendarId = opts.moveTo;
      // shifting a series also shifts the occurrences' ids, as on Google
      if (patch.start) this.db.overrides = Object.fromEntries(Object.entries(this.db.overrides).filter(([k]) => !k.startsWith(master.id + '_')));
      this.save();
      return JSON.parse(JSON.stringify(master));
    }

    const single = findMaster(eventId);
    if (single) {
      demoApply(single, patch);
      if (opts.moveTo) single.calendarId = opts.moveTo;
      this.save();
      return JSON.parse(JSON.stringify(single));
    }

    // one occurrence of a repeating event
    const masterId = eventId.split('_')[0];
    const master = findMaster(masterId);
    if (!master) throw new Error('That event no longer exists.');
    const prev = this.db.overrides[eventId] || {};
    const merged = Object.assign({}, prev, patch);
    if (patch.extendedProperties) merged.extendedProperties = { private: Object.assign({}, (prev.extendedProperties || {}).private, patch.extendedProperties.private) };
    this.db.overrides[eventId] = merged;
    this.save();
    const inst = demoInstance(master, eventId, null, this.db.overrides);
    return JSON.parse(JSON.stringify(inst));
  },

  async deleteEvent(calId, eventId) {
    this.load();
    await wait(200);
    const idx = this.db.events.findIndex((e) => e.id === eventId);
    if (idx >= 0) {
      this.db.events.splice(idx, 1);
      this.db.overrides = Object.fromEntries(Object.entries(this.db.overrides).filter(([k]) => !k.startsWith(eventId + '_')));
    } else {
      this.db.overrides[eventId] = { status: 'cancelled' };
    }
    this.save();
    return { ok: true };
  },

  async getEvent(calId, eventId) {
    this.load();
    await wait(120);
    const ev = this.db.events.find((e) => e.id === eventId);
    if (!ev) throw new Error('Not found');
    return JSON.parse(JSON.stringify(ev));
  },

  async search(req) {
    this.load();
    await wait(260);
    return { events: this.list(req.calendarIds, new Date(req.timeMin), new Date(req.timeMax), req.q).slice(0, 300) };
  },

  async saveSettings() { return { ok: true }; }
};

/* ---------- demo helpers: a tiny Google Calendar imitation ---------- */

function demoEvent(o) {
  return Object.assign({
    recurringEventId: null, summary: '', description: '', location: '', colorId: null,
    originalStartTime: null, recurrence: null, htmlLink: '', videoLink: '', status: 'confirmed',
    transparency: 'opaque', eventType: 'default', guestsCanModify: false, locked: false, privateCopy: false,
    organizerSelf: true, creatorSelf: true, organizer: null, attendees: [], reminders: { useDefault: true }, privateProps: null
  }, o, {
    privateProps: (o.extendedProperties && o.extendedProperties.private) || o.privateProps || null
  });
}

function demoApply(target, patch) {
  for (const k of Object.keys(patch)) {
    if (k === 'extendedProperties') {
      target.privateProps = Object.assign({}, target.privateProps, (patch.extendedProperties || {}).private);
    } else if (k === 'recurrence') {
      target.recurrence = patch.recurrence && patch.recurrence.length ? patch.recurrence : null;
    } else {
      target[k] = patch[k];
    }
  }
}

function demoStart(e) { return e.start.date ? parseYmd(e.start.date).getTime() : new Date(e.start.dateTime).getTime(); }
function demoEnd(e) { return e.end.date ? parseYmd(e.end.date).getTime() : new Date(e.end.dateTime).getTime(); }
function demoOverlaps(e, from, to) {
  const s = demoStart(e), en = demoEnd(e);
  return s < to.getTime() && (en > from.getTime() || (en === s && s >= from.getTime()));
}

function demoRule(recurrence) {
  const line = (recurrence || []).find((l) => l.startsWith('RRULE:'));
  if (!line) return null;
  const rule = {};
  line.slice(6).split(';').forEach((kv) => { const [k, v] = kv.split('='); rule[k] = v; });
  return rule;
}

function demoInstanceId(master, start) {
  if (master.start.date) return master.id + '_' + ymd(start).replace(/-/g, '');
  return master.id + '_' + start.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function demoInstance(master, id, start, overrides) {
  const allDay = !!master.start.date;
  const dur = demoEnd(master) - demoStart(master);
  if (!start) {
    const stamp = id.split('_')[1];
    start = allDay
      ? new Date(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8))
      : new Date(stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + 'T' + stamp.slice(9, 11) + ':' + stamp.slice(11, 13) + ':' + stamp.slice(13, 15) + 'Z');
  }
  const end = new Date(start.getTime() + dur);
  const base = Object.assign({}, master, {
    id, recurringEventId: master.id, recurrence: null,
    start: allDay ? { date: ymd(start) } : { dateTime: toRfc3339(start), timeZone: master.start.timeZone },
    end: allDay ? { date: ymd(allDay ? addDays(start, Math.round(dur / DAY_MS)) : end) } : { dateTime: toRfc3339(end), timeZone: master.end.timeZone },
    originalStartTime: allDay ? { date: ymd(start) } : { dateTime: toRfc3339(start) }
  });
  const ov = overrides[id];
  if (ov) {
    if (ov.status === 'cancelled') return null;
    demoApply(base, ov);
  }
  return base;
}

/** Expands a repeating event into its occurrences between from and to. */
function demoExpand(master, from, to, overrides) {
  const rule = demoRule(master.recurrence);
  if (!rule) return [];
  const allDay = !!master.start.date;
  const s0 = allDay ? parseYmd(master.start.date) : new Date(master.start.dateTime);
  const dur = demoEnd(master) - demoStart(master);
  const interval = Math.max(1, +(rule.INTERVAL || 1));
  const count = rule.COUNT ? +rule.COUNT : Infinity;
  let until = null;
  if (rule.UNTIL) {
    const u = rule.UNTIL;
    until = new Date(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8), 23, 59, 59);
  }
  const byday = rule.BYDAY ? rule.BYDAY.split(',') : null;
  const wk0 = startOfWeek(s0, 1);
  const out = [];
  let n = 0;
  const lastDay = until ? minDate(until, to) : to;
  for (let d = sod(s0), guard = 0; d <= lastDay && n < count && guard < 4000; d = addDays(d, 1), guard++) {
    let match = false;
    if (rule.FREQ === 'DAILY') match = dayDiff(s0, d) % interval === 0;
    else if (rule.FREQ === 'WEEKLY') {
      const wk = Math.round(dayDiff(wk0, startOfWeek(d, 1)) / 7);
      match = wk % interval === 0 && (byday ? byday.includes(RRULE_DAYS[d.getDay()]) : d.getDay() === s0.getDay());
    } else if (rule.FREQ === 'MONTHLY') {
      const md = (d.getFullYear() - s0.getFullYear()) * 12 + d.getMonth() - s0.getMonth();
      if (md % interval === 0) {
        if (rule.BYMONTHDAY) match = d.getDate() === +rule.BYMONTHDAY;
        else if (byday) {
          const m = byday[0].match(/^(-?\d)?(SU|MO|TU|WE|TH|FR|SA)$/);
          if (m && RRULE_DAYS[d.getDay()] === m[2]) {
            const nth = m[1] ? +m[1] : 1;
            match = nth > 0 ? Math.ceil(d.getDate() / 7) === nth : d.getDate() + 7 > daysInMonth(d);
          }
        } else match = d.getDate() === s0.getDate();
      }
    } else if (rule.FREQ === 'YEARLY') {
      match = (d.getFullYear() - s0.getFullYear()) % interval === 0 && d.getMonth() === s0.getMonth() && d.getDate() === s0.getDate();
    }
    if (!match) continue;
    n++;
    const start = allDay ? new Date(d) : atMinutes(d, minutesOfDay(s0));
    if (start.getTime() + dur <= from.getTime() && !(dur === 0 && start >= from)) continue;
    if (start >= to) break;
    const inst = demoInstance(master, demoInstanceId(master, start), start, overrides);
    if (inst) out.push(inst);
  }
  return out;
}

function demoShift(master, shiftMs, durationMs, dayShift) {
  let recurrence = null;
  if (dayShift && master.recurrence) {
    // same rules as Code.gs pcShiftRule_
    recurrence = master.recurrence.map((line) => {
      if (!line.startsWith('RRULE:')) return line;
      line = line.replace(/BYDAY=([^;]+)/, (all, list) => {
        const m = !list.includes(',') && list.match(/^([+-]?\d*)(SU|MO|TU|WE|TH|FR|SA)$/);
        return m ? 'BYDAY=' + m[1] + RRULE_DAYS[(RRULE_DAYS.indexOf(m[2]) + (dayShift % 7) + 7) % 7] : all;
      });
      return line.replace(/BYMONTHDAY=(\d+)(?=;|$)/, (all, d) => {
        const n = +d + dayShift;
        return n >= 1 && n <= 28 ? 'BYMONTHDAY=' + n : all;
      });
    });
  }
  if (master.start.date) {
    const s = addDays(parseYmd(master.start.date), dayShift || Math.round(shiftMs / DAY_MS));
    const len = durationMs != null ? Math.max(1, Math.round(durationMs / DAY_MS)) : dayDiff(parseYmd(master.start.date), parseYmd(master.end.date));
    return { start: { date: ymd(s) }, end: { date: ymd(addDays(s, len)) }, recurrence };
  }
  const start = new Date(new Date(master.start.dateTime).getTime() + shiftMs);
  const dur = durationMs != null ? durationMs : demoEnd(master) - demoStart(master);
  return {
    start: { dateTime: toRfc3339(start), timeZone: master.start.timeZone || LOCAL_TZ },
    end: { dateTime: toRfc3339(new Date(start.getTime() + dur)), timeZone: master.end.timeZone || LOCAL_TZ },
    recurrence
  };
}

/** Fake but plausible life of a Phantom Thief, placed around today. */
function demoSeed() {
  const calendars = [
    { id: 'joker@phantom.demo', name: 'Phantom Thieves', color: '#d50000', textColor: '#fff', accessRole: 'owner', primary: true, selected: true },
    { id: 'school@demo', name: 'School', color: '#3f51b5', textColor: '#fff', accessRole: 'owner', primary: false, selected: true },
    { id: 'work@demo', name: 'Part-time job', color: '#0b8043', textColor: '#fff', accessRole: 'owner', primary: false, selected: true },
    { id: 'friends@demo', name: 'Confidants', color: '#8e24aa', textColor: '#fff', accessRole: 'owner', primary: false, selected: true },
    { id: 'holidays@demo', name: 'Holidays', color: '#f6bf26', textColor: '#000', accessRole: 'reader', primary: false, selected: true }
  ];
  const today = sod(new Date());
  const mon = startOfWeek(today, 1);
  const T = (dayOffset, hh, mm) => toRfc3339(atMinutes(addDays(mon, dayOffset), hh * 60 + (mm || 0)));
  const D = (dayOffset) => ymd(addDays(mon, dayOffset));
  const tz = LOCAL_TZ;
  const timed = (cal, title, d, sh, sm, eh, em, extra) => demoEvent(Object.assign({
    calendarId: cal, id: 'demo' + uid(), summary: title,
    start: { dateTime: T(d, sh, sm), timeZone: tz }, end: { dateTime: T(d, eh, em), timeZone: tz }
  }, extra || {}));
  const allday = (cal, title, d, days, extra) => demoEvent(Object.assign({
    calendarId: cal, id: 'demo' + uid(), summary: title,
    start: { date: D(d) }, end: { date: D(d + days) }
  }, extra || {}));

  const P = 'joker@phantom.demo', S = 'school@demo', W = 'work@demo', F = 'friends@demo';
  const events = [
    timed(S, 'Classes', -14, 8, 30, 14, 45, { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'], location: 'Shujin Academy, class 2-D', transparency: 'opaque' }),
    timed(P, 'Hideout meeting', -14 + 2, 16, 0, 17, 30, { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'], location: 'School rooftop', description: 'Plan the next heist.\nBring snacks. Bring the map.', colorId: null }),
    timed(F, 'Shogi practice', -14, 18, 30, 19, 30, { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'], location: 'Church in Kanda' }),
    timed(W, 'Café shift', 3, 17, 0, 21, 0, { location: 'Café Leblanc, Yongen-Jaya', description: 'Wash the cups. Learn the curry recipe.' }),
    timed(W, 'Café shift', 5, 10, 0, 15, 0, { location: 'Café Leblanc, Yongen-Jaya' }),
    timed(P, 'Infiltration: the Palace', 4, 18, 0, 21, 30, { colorId: '11', description: 'Secure the route to the treasure.\nhttps://example.com/route-map', videoLink: 'https://meet.google.com/' }),
    timed(F, 'Batting cages', 6, 14, 0, 15, 30, { location: 'Ichigaya batting center' }),
    timed(F, 'Movie night', 5, 19, 0, 21, 30, { location: 'Shibuya', colorId: '5' }),
    timed(S, 'Study group', 1, 15, 30, 17, 0, { location: 'Library' }),
    timed(P, 'Gym', 1, 16, 0, 17, 0, { colorId: '6' }),
    timed(P, 'Rooftop lunch', 1, 12, 0, 12, 45, { colorId: '2' }),
    timed(F, 'Bathhouse', 2, 21, 0, 22, 0, { transparency: 'transparent' }),
    timed(P, 'Late-night crossword', 3, 23, 0, 24, 30, {}),
    timed(F, 'Video call with the team', 7 + 1, 20, 0, 21, 0, { videoLink: 'https://meet.google.com/', attendees: [
      { email: 'joker@phantom.demo', name: 'You', status: 'accepted', self: true, organizer: true },
      { email: 'skull@phantom.demo', name: 'Skull', status: 'accepted' },
      { email: 'panther@phantom.demo', name: 'Panther', status: 'tentative' },
      { email: 'oracle@phantom.demo', name: 'Oracle', status: 'needsAction' }
    ] }),
    timed(W, 'Flower shop shift', 7 + 3, 16, 0, 20, 0, { location: 'Shibuya underground mall' }),
    timed(S, 'Volleyball tournament', 7 + 4, 9, 0, 13, 0, {}),
    allday(P, 'Deadline: send the calling card', 9, 1, { extendedProperties: { private: { pcDeadline: '1' } } }),
    allday(S, 'Midterm exams', 15, 3, { extendedProperties: { private: { pcDeadline: '1' } } }),
    allday(P, 'Hawaii school trip', 22, 4, { colorId: '7' }),
    allday(F, "Sojiro's birthday", 12, 1, { recurrence: ['RRULE:FREQ=YEARLY'], colorId: '4' }),
    timed(P, 'Mementos run', -7 + 4, 18, 0, 20, 0, { colorId: '11' }),
    timed(W, 'Café shift', -7 + 3, 17, 0, 21, 0, {})
  ];
  const y = today.getFullYear();
  const H = 'holidays@demo';
  [[0, 1, "New Year's Day"], [1, 11, 'National Foundation Day'], [3, 29, 'Showa Day'], [4, 3, 'Constitution Day'], [4, 5, "Children's Day"], [7, 11, 'Mountain Day'], [10, 3, 'Culture Day'], [10, 23, 'Labor Thanksgiving Day'], [11, 25, 'Christmas Day'], [11, 31, "New Year's Eve"]].forEach(([m, d, name]) => {
    [y - 1, y, y + 1].forEach((yy) => {
      const s = new Date(yy, m, d);
      events.push(demoEvent({ calendarId: H, id: 'demo' + uid(), summary: name, start: { date: ymd(s) }, end: { date: ymd(addDays(s, 1)) }, organizerSelf: false, creatorSelf: false }));
    });
  });
  return { version: 1, calendars, events, overrides: {} };
}

function pickBackend() {
  return runningInAppsScript() ? GoogleBackend : DemoBackend;
}
