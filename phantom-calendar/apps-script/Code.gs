/**
 * PHANTOM CALENDAR — the Google side.
 *
 * This file runs on Google's servers as YOUR Google account. It is the bridge
 * between the app (Index.html) and your Google Calendar: it reads your events,
 * and writes the changes you make in the app straight back to Google.
 *
 * Setup is in README.md. Short version:
 *   1. script.google.com → New project → paste this file into Code.gs
 *   2. Add an HTML file called "Index" and paste Index.html into it
 *   3. Services (+) → "Google Calendar API" → Add
 *   4. Deploy → New deployment → Web app → Execute as: Me, Access: Only myself
 *
 * Nothing here sends your data anywhere except between you and Google.
 */

var PC_SETTINGS_KEY = 'phantomCalendarSettings';
var PC_MAX_PAGES = 10;

/** Serves the app. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Phantom Calendar')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ------------------------------------------------------------------------ */
/* Called by the app                                                         */
/* ------------------------------------------------------------------------ */

/** First call the app makes: who you are, your calendars, your saved settings. */
function pcBootstrap() {
  pcCheck_();
  var calendars = pcListCalendars_();
  var primary = calendars.filter(function (c) { return c.primary; })[0];
  var saved = PropertiesService.getUserProperties().getProperty(PC_SETTINGS_KEY);
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) { /* not available */ }
  return JSON.stringify({
    user: email || (primary ? primary.id : ''),
    timeZone: primary ? primary.timeZone : Session.getScriptTimeZone(),
    calendars: calendars,
    settings: saved ? JSON.parse(saved) : null
  });
}

/**
 * Returns the events in one or more time windows.
 * req = { calendarIds: [...], windows: [{ key, timeMin, timeMax, hash }] }
 * If a window's events are unchanged since the hash the app sent, only the
 * hash comes back, which keeps the every-30-seconds check cheap.
 */
function pcSync(reqJson) {
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
function pcCreateEvent(calId, resourceJson) {
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
function pcUpdateEvent(calId, eventId, patchJson, optsJson) {
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

  var ev;
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
    ev = Calendar.Events.move(calId, targetId, opts.moveTo);
    calId = opts.moveTo;
  }
  return JSON.stringify(pcSlim_(ev, calId));
}

/** Deletes an event (or one occurrence of a repeating event). */
function pcDeleteEvent(calId, eventId) {
  pcCheck_();
  Calendar.Events.remove(calId, eventId);
  return JSON.stringify({ ok: true });
}

/** Reads one event, e.g. the first event of a series to show its repeat rule. */
function pcGetEvent(calId, eventId) {
  pcCheck_();
  return JSON.stringify(pcSlim_(Calendar.Events.get(calId, eventId), calId));
}

/** Searches events by text. req = { q, calendarIds, timeMin, timeMax } */
function pcSearch(reqJson) {
  pcCheck_();
  var req = JSON.parse(reqJson);
  var all = [];
  (req.calendarIds || []).forEach(function (calId) {
    try {
      pcListEvents_(calId, { q: req.q, timeMin: req.timeMin, timeMax: req.timeMax, maxResults: 250 }, 1)
        .forEach(function (ev) { all.push(ev); });
    } catch (e) { /* skip calendars that can't be searched */ }
  });
  all.sort(function (a, b) { return pcStartMs_(a) - pcStartMs_(b); });
  return JSON.stringify({ events: all.slice(0, 300) });
}

/** Remembers your app settings (theme, sounds...) on your Google account. */
function pcSaveSettings(settingsJson) {
  PropertiesService.getUserProperties().setProperty(PC_SETTINGS_KEY, String(settingsJson).slice(0, 8000));
  return JSON.stringify({ ok: true });
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

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
        selected: c.selected !== false,
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
    recurrence = master.recurrence.map(function (line) { return pcShiftByDay_(line, dayShift); });
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

/** "Weekly on Wednesday" becomes "weekly on Thursday" when moved one day later. */
function pcShiftByDay_(line, dayShift) {
  if (line.indexOf('RRULE:') !== 0) return line;
  var days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  return line.replace(/BYDAY=([^;]+)/, function (all, list) {
    return 'BYDAY=' + list.split(',').map(function (tok) {
      var m = tok.match(/^([+-]?\d*)(SU|MO|TU|WE|TH|FR|SA)$/);
      if (!m) return tok;
      var i = (days.indexOf(m[2]) + (dayShift % 7) + 7) % 7;
      return m[1] + days[i];
    }).join(',');
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
