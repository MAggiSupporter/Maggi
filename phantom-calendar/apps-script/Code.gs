/**
 * PHANTOM CALENDAR — the Google side.
 *
 * This file runs on Google's servers as YOUR Google account. It is the bridge
 * between the app and your Google Calendar: it reads your events, and writes
 * the changes you make in the app straight back to Google.
 *
 * EASY SETUP (this one file is all you need):
 *   1. script.google.com → New project → delete what's there → paste this file
 *   2. Services (+) → "Google Calendar API" → Add
 *   3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone
 *   4. Open the Web app link and choose a passcode
 * "Anyone" means Google doesn't check which of your Google accounts is signed
 * in (that check is what breaks when a browser has several accounts). Your
 * passcode protects the calendar instead: every function below that touches
 * it refuses to work without it.
 *
 * Forgot the passcode? Pick resetPasscode next to ▷ Run at the top of the
 * editor, click Run, then open the app and choose a new one.
 *
 * The app's screens download from the project's GitHub page each time you open
 * it, so fixes arrive on their own. To keep everything inside your account
 * instead, also add an HTML file named "Index" containing apps-script/Index.html.
 *
 * Nothing here sends your data anywhere except between you and Google.
 */

var PC_SETTINGS_KEY = 'phantomCalendarSettings';
var PC_PASS_KEY = 'phantomCalendarPasscode';
var PC_FAIL_KEY = 'phantomCalendarFailures';
var PC_MAX_TRIES = 8;
var PC_LOCK_MS = 15 * 60 * 1000;
var PC_MAX_PAGES = 10;

/** Serves the app: the "Index" file if you added one, otherwise the built-in loader. */
function doGet() {
  var page;
  try {
    page = HtmlService.createHtmlOutputFromFile('Index');
  } catch (e) {
    page = HtmlService.createHtmlOutput(PC_LOADER_HTML);
  }
  return page
    .setTitle('Phantom Calendar')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ------------------------------------------------------------------------ */
/* Passcode                                                                  */
/* ------------------------------------------------------------------------ */

/** Whether a passcode has been chosen yet, and whether the calendar service is on. */
function pcAuthState() {
  var f = pcFailures_();
  var now = Date.now();
  return JSON.stringify({
    hasPasscode: !!pcPass_(),
    service: typeof Calendar !== 'undefined',
    lockedForMs: f.until > now ? f.until - now : 0
  });
}

/** First time only: choose the passcode. Returns this device's key. */
function pcSetPasscode(passcode) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (pcPass_()) throw new Error('PC_AUTH: A passcode is already set. Enter it instead.');
    pcValidPasscode_(passcode);
    var rec = pcMakePass_(String(passcode));
    pcProps_().setProperty(PC_PASS_KEY, JSON.stringify(rec));
    return JSON.stringify({ token: pcToken_(rec) });
  } finally {
    lock.releaseLock();
  }
}

/** Checks the passcode and returns this device's key. Too many wrong tries pause it for 15 minutes. */
function pcUnlock(passcode) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rec = pcPass_();
    if (!rec) throw new Error('PC_AUTH_SETUP: No passcode has been chosen yet.');
    var f = pcFailures_();
    var now = Date.now();
    if (f.until > now) {
      throw new Error('PC_LOCKED: Too many wrong tries. Wait ' + Math.ceil((f.until - now) / 60000) + ' minutes, then try again.');
    }
    if (pcHashPass_(rec.salt, String(passcode == null ? '' : passcode)) !== rec.hash) {
      f.count = (f.count || 0) + 1;
      if (f.count >= PC_MAX_TRIES) { f.count = 0; f.until = now + PC_LOCK_MS; }
      pcProps_().setProperty(PC_FAIL_KEY, JSON.stringify(f));
      throw new Error(f.until > now ? 'PC_LOCKED: Too many wrong tries. Wait 15 minutes, then try again.' : 'PC_AUTH: That passcode is wrong.');
    }
    pcProps_().deleteProperty(PC_FAIL_KEY);
    return JSON.stringify({ token: pcToken_(rec) });
  } finally {
    lock.releaseLock();
  }
}

/** Changes the passcode. Every other device will ask for the new one. */
function pcChangePasscode(token, newPasscode) {
  pcAuth_(token);
  pcValidPasscode_(newPasscode);
  var rec = pcMakePass_(String(newPasscode));
  pcProps_().setProperty(PC_PASS_KEY, JSON.stringify(rec));
  pcProps_().deleteProperty(PC_FAIL_KEY);
  return JSON.stringify({ token: pcToken_(rec) });
}

/**
 * Forgot your passcode? Run this from the Apps Script editor: pick
 * resetPasscode next to ▷ Run, click Run. Then open the app and choose a new
 * one. Only works for you (the owner); visitors to the app can't use it.
 */
function resetPasscode() {
  var active = '', owner = '';
  try {
    active = Session.getActiveUser().getEmail();
    owner = Session.getEffectiveUser().getEmail();
  } catch (e) { /* not available */ }
  if (!active || active !== owner) throw new Error('Only the owner can reset the passcode, from the Apps Script editor.');
  pcProps_().deleteProperty(PC_PASS_KEY);
  pcProps_().deleteProperty(PC_FAIL_KEY);
  console.log('Passcode cleared. Open the app and choose a new one.');
  return 'Passcode cleared. Open the app and choose a new one.';
}

/* ------------------------------------------------------------------------ */
/* Called by the app (each needs this device's key)                          */
/* ------------------------------------------------------------------------ */

/** First call the app makes: who you are, your calendars, your saved settings. */
function pcBootstrap(token) {
  pcAuth_(token);
  pcCheck_();
  var calendars = pcListCalendars_();
  var primary = calendars.filter(function (c) { return c.primary; })[0];
  var saved = PropertiesService.getUserProperties().getProperty(PC_SETTINGS_KEY);
  var settings = null;
  try { settings = saved ? JSON.parse(saved) : null; } catch (e) { settings = null; }
  var email = '';
  try { email = Session.getEffectiveUser().getEmail(); } catch (e) { /* not available */ }
  return JSON.stringify({
    user: email || (primary ? primary.id : ''),
    timeZone: primary ? primary.timeZone : Session.getScriptTimeZone(),
    calendars: calendars,
    settings: settings
  });
}

/** Your calendar list again, so calendars added in Google show up without a reload. */
function pcCalendars(token) {
  pcAuth_(token);
  pcCheck_();
  return JSON.stringify({ calendars: pcListCalendars_() });
}

/**
 * Returns the events in one or more time windows.
 * req = { calendarIds: [...], windows: [{ key, timeMin, timeMax, hash }] }
 * If a window's events are unchanged since the hash the app sent, only the
 * hash comes back, which keeps the every-30-seconds check cheap.
 */
function pcSync(token, reqJson) {
  pcAuth_(token);
  pcCheck_();
  var req = JSON.parse(reqJson);
  var out = { windows: {}, errors: [], serverTime: new Date().toISOString() };
  (req.windows || []).forEach(function (w) {
    var all = [];
    (req.calendarIds || []).forEach(function (calId) {
      try {
        pcListEvents_(calId, { timeMin: w.timeMin, timeMax: w.timeMax }).forEach(function (ev) { all.push(ev); });
      } catch (e) {
        out.errors.push({ calendarId: calId, message: pcMsg_(e) });
      }
    });
    var hash = pcHash_(JSON.stringify(all));
    out.windows[w.key] = (w.hash && w.hash === hash) ? { hash: hash, unchanged: true } : { hash: hash, events: all };
  });
  return JSON.stringify(out);
}

/** Creates an event. resource is a Google Calendar event resource. */
function pcCreateEvent(token, calId, resourceJson) {
  pcAuth_(token);
  pcCheck_();
  var ev = Calendar.Events.insert(JSON.parse(resourceJson), calId);
  return JSON.stringify(pcSlim_(ev, calId));
}

/**
 * Changes an event.
 * opts.scope = 'series' changes every event in a repeating series (the
 * change is made to the series' first event, opts.seriesId). For a time
 * change made from one occurrence, opts.shiftMs / opts.durationMs /
 * opts.dayShift say how far that occurrence moved, and the series moves the
 * same amount. opts.moveTo moves the event to another calendar.
 */
function pcUpdateEvent(token, calId, eventId, patchJson, optsJson) {
  pcAuth_(token);
  pcCheck_();
  var patch = JSON.parse(patchJson || '{}');
  var opts = JSON.parse(optsJson || '{}');
  var targetId = eventId;

  if (opts.scope === 'series' && opts.seriesId) {
    targetId = opts.seriesId;
    if (opts.shiftMs || opts.dayShift || opts.durationMs != null) {
      var master = Calendar.Events.get(calId, targetId);
      var times = pcShiftTimes_(master, opts.shiftMs || 0, opts.durationMs, opts.dayShift || 0);
      patch.start = times.start;
      patch.end = times.end;
      if (times.recurrence && !patch.recurrence) patch.recurrence = times.recurrence;
    }
  }

  var ev = null;
  if (pcHasNull_(patch)) {
    // null means "remove this" (an all-day <-> timed switch, or back to the
    // calendar's colour). A patch can't be trusted with that, so read the
    // event, change it, and save it whole.
    var current = Calendar.Events.get(calId, targetId);
    ev = Calendar.Events.update(pcMerge_(current, patch), calId, targetId);
  } else {
    ev = Calendar.Events.patch(patch, calId, targetId);
  }
  if (opts.moveTo && opts.moveTo !== calId) {
    try {
      ev = Calendar.Events.move(calId, targetId, opts.moveTo);
    } catch (e) {
      throw new Error('Your other changes were saved, but Google wouldn\'t move this event to that calendar (' + pcMsg_(e) + ').');
    }
    calId = opts.moveTo;
  }
  return JSON.stringify(pcSlim_(ev, calId));
}

/** Deletes an event (or one occurrence of a repeating event). */
function pcDeleteEvent(token, calId, eventId) {
  pcAuth_(token);
  pcCheck_();
  Calendar.Events.remove(calId, eventId);
  return JSON.stringify({ ok: true });
}

/** Reads one event, e.g. the first event of a series to show its repeat rule. */
function pcGetEvent(token, calId, eventId) {
  pcAuth_(token);
  pcCheck_();
  return JSON.stringify(pcSlim_(Calendar.Events.get(calId, eventId), calId));
}

/**
 * Searches events by text. req = { q, calendarIds, timeMin, timeMax }
 * Upcoming matches come first, then the most recent past ones, so a search for
 * something that repeats every day still shows what's coming up.
 */
function pcSearch(token, reqJson) {
  pcAuth_(token);
  pcCheck_();
  var req = JSON.parse(reqJson);
  var now = new Date();
  var nowIso = now.toISOString();
  var seen = {};
  var future = [], past = [];
  var add = function (list, ev) {
    var k = ev.calendarId + '|' + ev.id;
    if (!seen[k]) { seen[k] = true; list.push(ev); }
  };
  (req.calendarIds || []).forEach(function (calId) {
    try {
      pcListEvents_(calId, { q: req.q, timeMin: nowIso, timeMax: req.timeMax, maxResults: 250 }, 1)
        .forEach(function (ev) { add(future, ev); });
      var before = pcListEvents_(calId, { q: req.q, timeMin: req.timeMin, timeMax: nowIso, maxResults: 250 }, 1);
      if (before.length >= 250) {
        // too many to get them all: look at just the last 60 days instead
        before = pcListEvents_(calId, { q: req.q, timeMin: new Date(now.getTime() - 60 * 864e5).toISOString(), timeMax: nowIso, maxResults: 250 }, 1);
      }
      before.forEach(function (ev) { add(past, ev); });
    } catch (e) { /* skip calendars that can't be searched */ }
  });
  var byStart = function (a, b) { return pcStartMs_(a) - pcStartMs_(b); };
  future.sort(byStart);
  past.sort(byStart);
  var events = past.slice(-100).concat(future.slice(0, 200));
  return JSON.stringify({ events: events });
}

/** Remembers your app settings (theme, sounds...) on your Google account. */
function pcSaveSettings(token, settingsJson) {
  pcAuth_(token);
  var text = String(settingsJson);
  JSON.parse(text);
  if (text.length > 8500) throw new Error('Settings are too large to save.');
  PropertiesService.getUserProperties().setProperty(PC_SETTINGS_KEY, text);
  return JSON.stringify({ ok: true });
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

function pcProps_() {
  return PropertiesService.getScriptProperties();
}

function pcPass_() {
  var raw = pcProps_().getProperty(PC_PASS_KEY);
  if (!raw) return null;
  try {
    var rec = JSON.parse(raw);
    return rec && rec.salt && rec.hash ? rec : null;
  } catch (e) {
    return null;
  }
}

function pcFailures_() {
  try {
    var f = JSON.parse(pcProps_().getProperty(PC_FAIL_KEY) || '{}');
    return { count: Number(f.count) || 0, until: Number(f.until) || 0 };
  } catch (e) {
    return { count: 0, until: 0 };
  }
}

function pcValidPasscode_(passcode) {
  var p = String(passcode == null ? '' : passcode);
  if (p.length < 6) throw new Error('PC_WEAK: Use at least 6 characters.');
  if (p.length > 200) throw new Error('PC_WEAK: Use at most 200 characters.');
}

function pcSha_(text) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function pcHashPass_(salt, passcode) {
  var h = salt + '|' + passcode;
  for (var i = 0; i < 300; i++) h = pcSha_(salt + '|' + h);
  return h;
}

function pcMakePass_(passcode) {
  var salt = Utilities.getUuid() + Utilities.getUuid();
  return { salt: salt, hash: pcHashPass_(salt, passcode) };
}

/** The key a device keeps after unlocking. It changes when the passcode changes. */
function pcToken_(rec) {
  return pcSha_('device-key|' + rec.salt + '|' + rec.hash);
}

function pcAuth_(token) {
  var rec = pcPass_();
  if (!rec) throw new Error('PC_AUTH_SETUP: Choose a passcode first.');
  if (!token || String(token) !== pcToken_(rec)) throw new Error('PC_AUTH: This device needs your passcode.');
}

function pcCheck_() {
  if (typeof Calendar === 'undefined') {
    throw new Error('PC_NO_SERVICE: The "Google Calendar API" service is not turned on for this script.');
  }
}

function pcListCalendars_() {
  var out = [];
  var token;
  var pages = 0;
  do {
    var res = Calendar.CalendarList.list({ maxResults: 250, pageToken: token });
    (res.items || []).forEach(function (c) {
      out.push({
        id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        color: c.backgroundColor || '#e5191c',
        textColor: c.foregroundColor || '#000000',
        accessRole: c.accessRole,
        primary: !!c.primary,
        selected: c.selected === true || !!c.primary,
        timeZone: c.timeZone || ''
      });
    });
    token = res.nextPageToken;
  } while (token && ++pages < PC_MAX_PAGES);
  return out;
}

function pcListEvents_(calId, query, maxPages) {
  var out = [];
  var token;
  var pages = 0;
  do {
    var params = {
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: query.maxResults || 2500,
      timeMin: query.timeMin,
      timeMax: query.timeMax
    };
    if (query.q) params.q = query.q;
    if (token) params.pageToken = token;
    var res = Calendar.Events.list(calId, params);
    (res.items || []).forEach(function (ev) {
      if (ev.status === 'cancelled' || ev.eventType === 'workingLocation') return;
      out.push(pcSlim_(ev, calId));
    });
    token = res.nextPageToken;
  } while (token && ++pages < (maxPages || PC_MAX_PAGES));
  return out;
}

/** Keeps only what the app uses, so the data sent to the app stays small. */
function pcSlim_(ev, calId) {
  var video = ev.hangoutLink || '';
  if (!video && ev.conferenceData && ev.conferenceData.entryPoints) {
    ev.conferenceData.entryPoints.forEach(function (p) {
      if (!video && p.entryPointType === 'video') video = p.uri;
    });
  }
  return {
    calendarId: calId,
    id: ev.id,
    recurringEventId: ev.recurringEventId || null,
    summary: ev.summary || '',
    description: ev.description || '',
    location: ev.location || '',
    colorId: ev.colorId || null,
    start: pcTime_(ev.start),
    end: pcTime_(ev.end),
    originalStartTime: pcTime_(ev.originalStartTime),
    recurrence: ev.recurrence ? ev.recurrence.map(String) : null,
    htmlLink: ev.htmlLink || '',
    videoLink: video,
    status: ev.status || 'confirmed',
    transparency: ev.transparency || 'opaque',
    eventType: ev.eventType || 'default',
    guestsCanModify: !!ev.guestsCanModify,
    locked: !!ev.locked,
    privateCopy: !!ev.privateCopy,
    organizerSelf: !!(ev.organizer && ev.organizer.self),
    creatorSelf: !!(ev.creator && ev.creator.self),
    organizer: ev.organizer ? { email: ev.organizer.email || '', name: ev.organizer.displayName || '' } : null,
    attendees: (ev.attendees || []).slice(0, 60).map(function (a) {
      return {
        email: a.email || '',
        name: a.displayName || '',
        status: a.responseStatus || 'needsAction',
        self: !!a.self,
        organizer: !!a.organizer,
        resource: !!a.resource
      };
    }),
    reminders: ev.reminders ? {
      useDefault: !!ev.reminders.useDefault,
      overrides: (ev.reminders.overrides || []).map(function (o) { return { method: String(o.method), minutes: Number(o.minutes) }; })
    } : null,
    privateProps: pcStrings_(ev.extendedProperties && ev.extendedProperties['private'])
  };
}

function pcTime_(t) {
  if (!t) return null;
  var out = {};
  if (t.date) out.date = String(t.date);
  if (t.dateTime) out.dateTime = String(t.dateTime);
  if (t.timeZone) out.timeZone = String(t.timeZone);
  return out;
}

function pcStrings_(obj) {
  if (!obj) return null;
  var out = {};
  Object.keys(obj).forEach(function (k) { out[k] = String(obj[k]); });
  return out;
}

/** Moves a series' first event by the same amount one occurrence was moved. */
function pcShiftTimes_(master, shiftMs, durationMs, dayShift) {
  var recurrence = null;
  if (dayShift && master.recurrence) {
    recurrence = master.recurrence.map(function (line) { return pcShiftRule_(line, dayShift); });
  }
  if (master.start.date) {
    var days = dayShift || Math.round(shiftMs / 864e5);
    var len = durationMs != null ? Math.max(1, Math.round(durationMs / 864e5)) : pcDaysBetween_(master.start.date, master.end.date);
    var s = pcAddDays_(master.start.date, days);
    return { start: { date: s }, end: { date: pcAddDays_(s, len) }, recurrence: recurrence };
  }
  var start = new Date(new Date(master.start.dateTime).getTime() + shiftMs);
  var dur = durationMs != null ? durationMs : (new Date(master.end.dateTime) - new Date(master.start.dateTime));
  var end = new Date(start.getTime() + dur);
  var tz = master.start.timeZone || Session.getScriptTimeZone();
  return {
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: master.end.timeZone || tz },
    recurrence: recurrence
  };
}

/**
 * Moves a repeat rule along with its dates: "weekly on Wednesday" becomes
 * "weekly on Thursday", "monthly on day 15" becomes "monthly on day 16".
 * Rules with several days ("every weekday") keep their days.
 */
function pcShiftRule_(line, dayShift) {
  if (line.indexOf('RRULE:') !== 0) return line;
  var days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  line = line.replace(/BYDAY=([^;]+)/, function (all, list) {
    if (list.indexOf(',') !== -1) return all;
    var m = list.match(/^([+-]?\d*)(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!m) return all;
    return 'BYDAY=' + m[1] + days[(days.indexOf(m[2]) + (dayShift % 7) + 7) % 7];
  });
  return line.replace(/BYMONTHDAY=(\d+)(?=;|$)/, function (all, d) {
    var n = Number(d) + dayShift;
    return n >= 1 && n <= 28 ? 'BYMONTHDAY=' + n : all;
  });
}

function pcHasNull_(patch) {
  return Object.keys(patch).some(function (k) {
    var v = patch[k];
    if (v === null) return true;
    return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some(function (f) { return v[f] === null; });
  });
}

/** Copies patch onto target. Objects merge, arrays replace, null deletes. */
function pcMerge_(target, patch) {
  Object.keys(patch).forEach(function (k) {
    var v = patch[k];
    if (v === null) delete target[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) pcMerge_(target[k], v);
    else target[k] = v;
  });
  return target;
}

function pcAddDays_(ymd, n) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.toISOString().slice(0, 10);
}

function pcDaysBetween_(a, b) {
  var pa = a.split('-'), pb = b.split('-');
  return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 864e5);
}

function pcStartMs_(ev) {
  if (!ev.start) return 0;
  return new Date(ev.start.dateTime || (ev.start.date + 'T00:00:00')).getTime();
}

function pcHash_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function pcMsg_(e) {
  return String((e && e.message) || e);
}

/* ------------------------------------------------------------------------ */
/* Built-in loader page (a copy of apps-script/loader/Index.html, written    */
/* here by tools/build.mjs; edit that file, not this block)                  */
/* ------------------------------------------------------------------------ */
// BEGIN LOADER
var PC_LOADER_HTML = [
  "<!doctype html>",
  "<!-- PHANTOM CALENDAR loader. A small stand-in for Index.html: it downloads the full app",
  "     (apps-script/Index.html) from this GitHub repo each time it opens, so it picks up",
  "     fixes on its own. If the branch is gone it tries main, then a fixed commit, then the",
  "     copy saved in this browser from last time. Use either this file or the full",
  "     Index.html as the \"Index\" file in Apps Script, not both. -->",
  "<html lang=\"en\">",
  "<head>",
  "<meta charset=\"utf-8\">",
  "<title>Phantom Calendar</title>",
  "<style>",
  "  html, body { margin: 0; height: 100%; background: #0b0b0d; color: #f4f1ea; font: 600 16px/1.4 system-ui, sans-serif; }",
  "  #pcl { position: fixed; inset: 0; display: grid; place-content: center; justify-items: center; gap: 18px; padding: 24px; text-align: center; }",
  "  #pcl .star { width: 72px; height: 72px; background: #e5191c; clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); animation: pcl-spin 1.1s linear infinite; }",
  "  #pcl b { font: 900 42px/1 Impact, 'Arial Narrow Bold', sans-serif; letter-spacing: 1px; transform: rotate(-4deg); }",
  "  #pcl span { max-width: 420px; color: #8f8c95; letter-spacing: 1px; }",
  "  @keyframes pcl-spin { to { transform: rotate(360deg); } }",
  "</style>",
  "</head>",
  "<body>",
  "<div id=\"pcl\" role=\"status\"><div class=\"star\"></div><b>TAKE YOUR TIME</b><span id=\"pclMsg\">Loading Phantom Calendar…</span></div>",
  "<script>",
  "(function () {",
  "  var BASE = 'https://raw.githubusercontent.com/MAggiSupporter/Maggi/';",
  "  var PATH = '/phantom-calendar/apps-script/Index.html';",
  "  var SOURCES = [",
  "    BASE + 'claude/epic-thompson-258mz9' + PATH,",
  "    BASE + 'main' + PATH,",
  "    BASE + '27033804290bf56052b42d0d6a27d2eb8fd1b0a0' + PATH",
  "  ];",
  "  var CACHE_KEY = 'phantom-calendar-app-copy';",
  "",
  "  function say(text) { var el = document.getElementById('pclMsg'); if (el) el.textContent = text; }",
  "  function looksRight(html) {",
  "    return typeof html === 'string' && html.indexOf('PHANTOM CALENDAR') !== -1 && html.indexOf('pcBootstrap') !== -1;",
  "  }",
  "  function savedCopy() {",
  "    try { return localStorage.getItem(CACHE_KEY); } catch (e) { return null; }",
  "  }",
  "",
  "  function tryNext(i) {",
  "    if (i >= SOURCES.length) {",
  "      var copy = savedCopy();",
  "      if (looksRight(copy)) { mount(copy); return; }",
  "      say('Couldn’t download the app. Check that you’re online, then reload this page.');",
  "      return;",
  "    }",
  "    fetch(SOURCES[i], { cache: 'no-cache' })",
  "      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })",
  "      .then(function (html) {",
  "        if (!looksRight(html)) throw new Error('unexpected file');",
  "        try { localStorage.setItem(CACHE_KEY, html); } catch (e) { /* no storage: fine */ }",
  "        mount(html);",
  "      })",
  "      .catch(function () { tryNext(i + 1); });",
  "  }",
  "",
  "  function mount(html) {",
  "    var doc = new DOMParser().parseFromString(html, 'text/html');",
  "    var heads = doc.head.querySelectorAll('link[rel=\"stylesheet\"], link[rel=\"preconnect\"], style');",
  "    for (var i = 0; i < heads.length; i++) document.head.appendChild(document.importNode(heads[i], true));",
  "    var scripts = Array.prototype.slice.call(doc.body.querySelectorAll('script'));",
  "    scripts.forEach(function (s) { s.parentNode.removeChild(s); });",
  "    var loading = document.getElementById('pcl');",
  "    if (loading) loading.parentNode.removeChild(loading);",
  "    Array.prototype.slice.call(doc.body.childNodes).forEach(function (n) { document.body.appendChild(document.importNode(n, true)); });",
  "    scripts.forEach(function (s) {",
  "      var el = document.createElement('script');",
  "      el.textContent = s.textContent;",
  "      document.body.appendChild(el);",
  "    });",
  "  }",
  "",
  "  tryNext(0);",
  "})();",
  "</script>",
  "</body>",
  "</html>"
].join('\n');
// END LOADER
