'use strict';
/* =========================================================================
   dialogs.js — popovers (Persona dialogue boxes), the event editor,
   choice bubbles, settings ("the Hideout") and the shortcuts list.
   ========================================================================= */

const Layers = [];
let dismissedAt = 0;

function pushLayer(node, opts) {
  opts = opts || {};
  const entry = { node, opts, scrim: null };
  const layer = $('#layer');
  if (opts.modal) {
    entry.scrim = h('div', { class: 'modal-scrim', onclick: () => closeLayer(entry) });
    layer.append(entry.scrim);
  }
  layer.append(node);
  Layers.push(entry);
  return entry;
}
function closeLayer(entry, silent) {
  const i = Layers.indexOf(entry);
  if (i < 0) return;
  Layers.splice(i, 1);
  entry.node.classList.add('is-leaving');
  if (entry.scrim) entry.scrim.classList.add('is-leaving');
  setTimeout(() => { entry.node.remove(); if (entry.scrim) entry.scrim.remove(); }, 190);
  if (entry.opts.onClose) entry.opts.onClose();
  if (!silent) Sfx.play('back');
}
function closeTopLayer() {
  const top = Layers[Layers.length - 1];
  if (!top) return false;
  closeLayer(top);
  return true;
}
function closeAllLayers() { while (Layers.length) closeLayer(Layers[Layers.length - 1], true); }
function justDismissed() { return Date.now() - dismissedAt < 400; }

// a click outside a popover closes it (the click itself then does nothing else)
document.addEventListener('pointerdown', (e) => {
  const top = Layers[Layers.length - 1];
  if (!top || !top.opts.popover) return;
  if (top.node.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.ev, .bar, .sv-ev, .dl, .next-up')) { closeLayer(top, true); return; }
  closeLayer(top, true);
  dismissedAt = Date.now();
}, true);

function placePop(pop, anchor) {
  if (isMobile()) { pop.classList.add('as-sheet'); return; }
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const pw = pop.offsetWidth, ph = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, m = 16;
  let left, top;
  if (!r || (!r.width && !r.height)) {
    left = (vw - pw) / 2; top = (vh - ph) / 2;
  } else {
    left = r.right + m;
    if (left + pw > vw - m) left = r.left - pw - m - 8;
    if (left < m) {
      left = clamp(r.left + r.width / 2 - pw / 2, m, vw - pw - m);
      top = r.bottom + m + 8;
      if (top + ph > vh - m) top = r.top - ph - m;
    } else {
      top = r.top - 6;
    }
  }
  pop.style.left = clamp(left, m, Math.max(m, vw - pw - m)) + 'px';
  pop.style.top = clamp(top, m + 16, Math.max(m + 16, vh - ph - m)) + 'px';
}

function popTools(...btns) {
  return h('div', { class: 'pop-tools' }, btns, h('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => closeTopLayer() }, icon('close')));
}

/* ---------------- repeat rules in words ---------------- */
function describeRule(recurrence) {
  const line = (recurrence || []).find((l) => /^RRULE:/i.test(l));
  if (!line) return 'Repeating event';
  const r = {};
  line.slice(6).split(';').forEach((kv) => { const [k, v] = kv.split('='); r[k.toUpperCase()] = v; });
  const every = +(r.INTERVAL || 1);
  const dayName = (code) => WEEKDAYS[RRULE_DAYS.indexOf(code.replace(/^[+-]?\d+/, ''))] || code;
  let txt;
  if (r.FREQ === 'DAILY') txt = every > 1 ? 'Every ' + every + ' days' : 'Daily';
  else if (r.FREQ === 'WEEKLY') {
    const days = (r.BYDAY || '').split(',').filter(Boolean);
    if (days.join(',') === 'MO,TU,WE,TH,FR') txt = (every > 1 ? 'Every ' + every + ' weeks' : 'Every weekday') + (every > 1 ? ' on weekdays' : '');
    else txt = (every > 1 ? 'Every ' + every + ' weeks' : 'Weekly') + (days.length ? ' on ' + days.map((x) => dayName(x)).join(', ') : '');
  } else if (r.FREQ === 'MONTHLY') {
    txt = every > 1 ? 'Every ' + every + ' months' : 'Monthly';
    if (r.BYMONTHDAY) txt += ' on day ' + r.BYMONTHDAY;
    else if (r.BYDAY) {
      const m = r.BYDAY.match(/^(-?\d)?(\w\w)$/);
      if (m) txt += ' on the ' + (m[1] === '-1' ? 'last' : ['first', 'second', 'third', 'fourth', 'fifth'][(+m[1] || 1) - 1]) + ' ' + dayName(m[2]);
    }
  } else if (r.FREQ === 'YEARLY') txt = every > 1 ? 'Every ' + every + ' years' : 'Annually';
  else txt = 'Repeating event';
  if (r.COUNT) txt += ', ' + r.COUNT + ' times';
  if (r.UNTIL) txt += ', until ' + fmtDateShort(new Date(+r.UNTIL.slice(0, 4), +r.UNTIL.slice(4, 6) - 1, +r.UNTIL.slice(6, 8)));
  return txt;
}

function repeatOptions(start) {
  const wd = RRULE_DAYS[start.getDay()];
  const dn = WEEKDAYS[start.getDay()];
  const nth = Math.ceil(start.getDate() / 7);
  const last = start.getDate() + 7 > daysInMonth(start);
  const opts = [
    { v: '', kind: 'none', label: 'Does not repeat' },
    { v: 'RRULE:FREQ=DAILY', kind: 'daily', label: 'Daily' },
    { v: 'RRULE:FREQ=WEEKLY;BYDAY=' + wd, kind: 'weekly', label: 'Weekly on ' + dn },
    { v: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', kind: 'weekdays', label: 'Every weekday (Mon–Fri)' },
    { v: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=' + start.getDate(), kind: 'monthday', label: 'Monthly on day ' + start.getDate() }
  ];
  if (nth <= 4) opts.push({ v: 'RRULE:FREQ=MONTHLY;BYDAY=' + nth + wd, kind: 'monthnth', label: 'Monthly on the ' + ['first', 'second', 'third', 'fourth'][nth - 1] + ' ' + dn });
  if (last) opts.push({ v: 'RRULE:FREQ=MONTHLY;BYDAY=-1' + wd, kind: 'monthlast', label: 'Monthly on the last ' + dn });
  opts.push({ v: 'RRULE:FREQ=YEARLY', kind: 'yearly', label: 'Annually on ' + MONTHS[start.getMonth()] + ' ' + start.getDate() });
  return opts;
}

function reminderValue(rem) {
  if (!rem || rem.useDefault) return 'default';
  const o = rem.overrides || [];
  if (!o.length) return 'none';
  if (o.length === 1 && ['0', '10', '30', '60', '1440'].includes(String(o[0].minutes))) return String(o[0].minutes);
  return 'custom';
}
function reminderText(rem) {
  if (!rem || rem.useDefault) return 'Default notification';
  const o = rem.overrides || [];
  if (!o.length) return 'No notification';
  return o.map((x) => x.minutes === 0 ? 'At start' : x.minutes % 1440 === 0 ? (x.minutes / 1440) + ' day' + (x.minutes > 1440 ? 's' : '') + ' before' : x.minutes % 60 === 0 ? (x.minutes / 60) + ' hr before' : x.minutes + ' min before').join(', ');
}

function loadMaster(ev) {
  if (!ev.seriesId) return Promise.resolve(null);
  const k = ev.calId + '|' + ev.seriesId;
  if (!App.masters.has(k)) App.masters.set(k, App.backend.getEvent(ev.calId, ev.seriesId).catch((err) => { App.masters.delete(k); throw err; }));
  return App.masters.get(k);
}

/* ---------------- event details ---------------- */
function openDetails(ev, anchor) {
  closeAllLayers();
  App.selectedKey = ev.key;
  markSelected();
  const cal = App.calMap.get(ev.calId);
  const raw = ev.raw;
  const row = (ic, ...content) => h('div', { class: 'pop-row' }, icon(ic), h('div', null, content));
  const body = h('div', { class: 'pop-body' });
  body.append(h('h3', { class: 'pop-title' + (ev.declined ? ' is-declined' : '') }, ev.title));
  body.append(h('div', { class: 'pop-when' }, fmtEventWhen(ev) + (ev.allDay || ev.end - ev.start < 60000 ? '' : ' (' + fmtDuration(ev.end - ev.start) + ')')));
  if (ev.seriesId) {
    const ruleTxt = h('span', null, 'Repeating event');
    body.append(row('repeat', ruleTxt));
    loadMaster(ev).then((m) => { if (m) ruleTxt.textContent = describeRule(m.recurrence); }).catch(() => {});
  }
  if (raw.location) {
    body.append(row('pin', h('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(raw.location), target: '_blank', rel: 'noopener noreferrer' }, raw.location)));
  }
  if (raw.videoLink) {
    body.append(h('div', { class: 'pop-video' }, h('a', { class: 'jag-btn primary', href: raw.videoLink, target: '_blank', rel: 'noopener noreferrer' }, icon('video'), ' JOIN VIDEO CALL')));
  }
  const people = (raw.attendees || []).filter((a) => !a.resource);
  if (people.length) {
    const yes = people.filter((a) => a.status === 'accepted').length;
    body.append(row('people', h('div', { class: 'pop-people' },
      h('div', null, people.length + ' guests · ' + yes + ' yes'),
      people.slice(0, 12).map((a) => h('div', { class: 'pp' },
        h('span', { class: 'pp-st is-' + a.status }, { accepted: 'YES', declined: 'NO', tentative: 'MAYBE', needsAction: '?' }[a.status] || '?'),
        h('span', null, (a.name || a.email) + (a.organizer ? ' (organizer)' : '') + (a.self ? ' (you)' : '')))),
      people.length > 12 ? h('div', null, '+' + (people.length - 12) + ' more') : null)));
  }
  const desc = descriptionText(raw.description);
  if (desc) body.append(row('text', h('div', { class: 'pop-desc' }, linkified(desc))));
  if (raw.reminders && !(raw.reminders.useDefault)) body.append(row('bell', reminderText(raw.reminders)));
  if (cal) {
    const st = calStyle(cal);
    body.append(row('cal', h('span', { class: 'pop-cal', style: { '--cal': st.bg } }, h('i'), cal.name + (ev.free ? ' · shown as free' : ''))));
  }
  if (ev.deadline) {
    const days = dayDiff(sod(new Date()), ev.start);
    body.append(h('div', { class: 'dl-banner' }, icon('flag'), days > 1 ? 'PALACE DEADLINE · ' + days + ' DAYS LEFT' : days === 1 ? 'PALACE DEADLINE · TOMORROW' : days === 0 ? 'PALACE DEADLINE · TODAY' : 'PALACE DEADLINE · PASSED'));
  }
  if (!ev.editable) body.append(h('div', { class: 'stamp' }, 'READ-ONLY'));

  const tools = popTools(
    ev.editable ? h('button', { class: 'icon-btn', title: 'Edit (E)', 'aria-label': 'Edit', onclick: () => { closeAllLayers(); openEditor(ev); } }, icon('edit')) : null,
    ev.editable ? h('button', { class: 'icon-btn', title: 'Delete (Del)', 'aria-label': 'Delete', onclick: () => deleteEvent(ev) }, icon('trash')) : null,
    raw.htmlLink ? h('a', { class: 'icon-btn', href: raw.htmlLink, target: '_blank', rel: 'noopener noreferrer', title: 'Open in Google Calendar', 'aria-label': 'Open in Google Calendar' }, icon('external')) : null
  );
  const pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': ev.title },
    h('div', { class: 'pop-tag' }, cal ? cal.name : 'EVENT'), tools, body);
  const entry = pushLayer(pop, { popover: true, kind: 'details', ev, onClose: () => { App.selectedKey = null; markSelected(); } });
  placePop(pop, anchor || $('#view [data-key="' + CSS.escape(ev.key) + '"]'));
  Sfx.play('select');
  return entry;
}

/* ---------------- quick create ---------------- */
function calendarSelect(value, onChange) {
  const sel = h('select', { class: 'f-select', 'aria-label': 'Calendar', onchange: () => onChange(sel.value) },
    writableCalendars().map((c) => h('option', { value: c.id, selected: c.id === value }, c.name)));
  return sel;
}
function checkbox(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'check' }, input, h('span', { class: 'box' }), label);
}
function defaultStart(day) {
  const now = new Date();
  if (sameDay(day, now)) { const s = sod(now); s.setHours(now.getHours() + 1); return s; }
  return atMinutes(day, 9 * 60);
}

function openQuickCreate(draft, anchor) {
  if (justDismissed()) return;
  if (!writableCalendars().length) { toast('None of your calendars can be written to.', { kind: 'error' }); return; }
  closeAllLayers();
  draft = Object.assign({ calId: defaultCalendarId(), title: '' }, draft);
  App.draft = draft;
  renderView();
  const titleIn = h('input', { class: 'qc-title', placeholder: 'Name your target…', 'aria-label': 'Title', value: draft.title, oninput: () => { draft.title = titleIn.value; } });
  const whenTxt = h('span');
  const paintWhen = () => {
    whenTxt.textContent = draft.allDay
      ? (dayDiff(draft.start, draft.end) > 1 ? fmtDateShort(draft.start) + ' – ' + fmtDateShort(addDays(draft.end, -1)) : fmtDateLong(draft.start))
      : fmtDateShort(draft.start) + ' · ' + fmtTime(draft.start) + ' – ' + fmtTime(draft.end);
  };
  paintWhen();
  const allDay = checkbox('All day', draft.allDay, (on) => {
    if (on) { draft.start = sod(draft.start); draft.end = addDays(draft.start, 1); }
    else { draft.start = defaultStart(draft.start); draft.end = addMinutes(draft.start, 60); }
    draft.allDay = on;
    paintWhen();
    renderView();
  });
  let entry = null;
  const save = () => {
    draft.title = titleIn.value.trim();
    const d = Object.assign({}, draft);
    closeLayer(entry, true);
    createEvent(d);
  };
  const more = () => {
    const d = Object.assign({}, draft, { title: titleIn.value });
    closeLayer(entry, true);
    openEditor(null, d);
  };
  titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const pop = h('div', { class: 'pop qc', role: 'dialog', 'aria-label': 'New event' },
    h('div', { class: 'pop-tag' }, 'NEW TARGET'),
    popTools(),
    h('div', { class: 'pop-body' },
      titleIn,
      h('div', { class: 'qc-when' }, icon('clock'), whenTxt, allDay),
      writableCalendars().length > 1 ? [h('div', { class: 'f-label' }, 'CALENDAR'), calendarSelect(draft.calId, (v) => { draft.calId = v; })] : null),
    h('div', { class: 'pop-actions' },
      h('button', { class: 'jag-btn ghost', onclick: more }, 'MORE OPTIONS'),
      h('button', { class: 'jag-btn primary', onclick: save }, 'SAVE')));
  entry = pushLayer(pop, { popover: true, kind: 'quick', onClose: () => { App.draft = null; requestRender(); } });
  placePop(pop, anchor || $('#view .is-draft'));
  Sfx.play('select');
  titleIn.focus({ preventScroll: true });
}

/* ---------------- the full editor ---------------- */
function openEditor(ev, draft) {
  closeAllLayers();
  if (!ev && !writableCalendars().length) { toast('None of your calendars can be written to.', { kind: 'error' }); return; }
  const isNew = !ev;
  const raw = ev ? ev.raw : {};
  if (isNew && !draft) {
    const s = defaultStart(App.view === 'search' ? new Date() : App.date);
    draft = { start: s, end: addMinutes(s, 60), allDay: false };
  }
  const f = isNew
    ? Object.assign({ calId: defaultCalendarId(), title: '', location: '', description: '', colorId: null, recurrence: '', reminder: 'default', free: false, deadline: false }, draft)
    : {
      calId: ev.calId, title: raw.summary || '', start: ev.start, end: ev.end, allDay: ev.allDay,
      location: raw.location || '', description: descriptionText(raw.description), colorId: raw.colorId || null,
      recurrence: ev.seriesId ? '__keep' : '', reminder: reminderValue(raw.reminders), free: ev.free, deadline: ev.deadline
    };
  const orig = Object.assign({}, f);
  let master = null;

  // ----- controls
  const title = h('input', { class: 'f-input f-title-input', placeholder: 'Name your target…', 'aria-label': 'Title', value: f.title });
  const sDate = h('input', { class: 'f-input', type: 'date', 'aria-label': 'Start date' });
  const sTime = h('input', { class: 'f-input', type: 'time', step: '300', 'aria-label': 'Start time' });
  const eDate = h('input', { class: 'f-input', type: 'date', 'aria-label': 'End date' });
  const eTime = h('input', { class: 'f-input', type: 'time', step: '300', 'aria-label': 'End time' });
  const writeTimes = () => {
    sDate.value = ymd(f.start);
    eDate.value = ymd(f.allDay ? addDays(f.end, -1) : f.end);
    sTime.value = hm(f.start);
    eTime.value = hm(f.end);
    sTime.hidden = eTime.hidden = f.allDay;
    whenGrid.classList.toggle('is-allday', f.allDay);
  };
  const whenGrid = h('div', { class: 'f-when' },
    h('span', { class: 'f-k' }, 'FROM'), sDate, sTime,
    h('span', { class: 'f-k' }, 'TO'), eDate, eTime);
  const combine = (dateStr, timeStr) => {
    if (!dateStr) return null;
    const d = parseYmd(dateStr);
    if (!timeStr) return d;
    const [hh, mm] = timeStr.split(':').map(Number);
    return atMinutes(d, hh * 60 + mm);
  };
  const readStart = () => (f.allDay ? combine(sDate.value) : combine(sDate.value, sTime.value));
  const readEnd = () => (f.allDay ? (eDate.value ? addDays(parseYmd(eDate.value), 1) : null) : combine(eDate.value, eTime.value));
  const onStartChange = () => {
    const s = readStart();
    if (!s) return;
    const dur = f.end - f.start;
    f.start = s;
    f.end = new Date(s.getTime() + dur);
    if (f.allDay) f.end = addDays(s, Math.max(1, Math.round(dur / DAY_MS)));
    writeTimes();
    fillRepeat();
  };
  const onEndChange = () => { const e = readEnd(); if (e) f.end = e; };
  sDate.addEventListener('change', onStartChange);
  sTime.addEventListener('change', onStartChange);
  eDate.addEventListener('change', onEndChange);
  eTime.addEventListener('change', onEndChange);

  const allDay = checkbox('All day', f.allDay, (on) => {
    if (on) { f.start = sod(f.start); f.end = addDays(sod(addMinutes(f.end, -1)), 1); if (f.end <= f.start) f.end = addDays(f.start, 1); }
    else { f.start = defaultStart(f.start); f.end = addMinutes(f.start, 60); }
    f.allDay = on;
    writeTimes();
  });

  let repeatKind = null;
  const repeat = h('select', {
    class: 'f-select', 'aria-label': 'Repeat',
    onchange: () => { f.recurrence = repeat.value; const o = repeat.selectedOptions[0]; repeatKind = o ? o.dataset.kind || null : null; }
  });
  const fillRepeat = () => {
    const opts = repeatOptions(f.start);
    if (f.recurrence === '__keep') {
      const line = master && master.recurrence ? master.recurrence.find((l) => l.startsWith('RRULE:')) || '' : null;
      const match = line != null && opts.find((o) => o.v === line);
      if (match) { f.recurrence = match.v; orig.recurrence = match.v; }
      else opts.push({ v: '__keep', label: master ? 'Custom: ' + describeRule(master.recurrence) : 'Loading repeat rule…' });
    }
    if (f.recurrence && !opts.some((o) => o.v === f.recurrence)) {
      // the start date moved: a new event follows it ("weekly on Tuesday" → "weekly on Thursday");
      // for a series the rule is left alone here and Code.gs moves it along with the dates
      const same = !(ev && ev.seriesId) && repeatKind && opts.find((o) => o.kind === repeatKind);
      if (same) f.recurrence = same.v;
      else opts.push({ v: f.recurrence, label: describeRule([f.recurrence]) });
    }
    clear(repeat);
    opts.forEach((o) => repeat.append(h('option', { value: o.v, selected: o.v === f.recurrence, dataset: o.kind ? { kind: o.kind } : null }, o.label)));
    const sel = opts.find((o) => o.v === f.recurrence);
    repeatKind = sel ? sel.kind || null : null;
  };
  fillRepeat();
  if (ev && ev.seriesId) {
    loadMaster(ev).then((m) => { master = m; fillRepeat(); }).catch(() => { repeat.disabled = true; });
  }

  const location = h('input', { class: 'f-input', placeholder: 'Where? (address or link)', 'aria-label': 'Location', value: f.location });
  const description = h('textarea', { class: 'f-area', placeholder: 'The plan, in detail…', 'aria-label': 'Description' });
  description.value = f.description;
  const calSel = calendarSelect(f.calId, (v) => { f.calId = v; paintSwatches(); });
  const specialType = ev && ev.raw.eventType && ev.raw.eventType !== 'default';
  if (specialType) calSel.disabled = true;
  const richDesc = !!(ev && raw.description && /<[a-z][\s\S]*>/i.test(raw.description));

  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Event colour' });
  const paintSwatches = () => {
    clear(swatches);
    const cal = App.calMap.get(f.calId);
    swatches.append(h('button', {
      class: 'swatch is-default' + (!f.colorId ? ' is-on' : ''), style: { '--sw': cal ? cal.display : '#e5191c' },
      title: 'Calendar colour', 'aria-label': 'Calendar colour', role: 'radio', 'aria-checked': !f.colorId ? 'true' : 'false',
      onclick: () => { f.colorId = null; paintSwatches(); Sfx.play('move'); }
    }));
    for (const id of Object.keys(EVENT_COLORS)) {
      const c = EVENT_COLORS[id];
      swatches.append(h('button', {
        class: 'swatch' + (f.colorId === id ? ' is-on' : ''), style: { '--sw': c.hex }, title: c.name, 'aria-label': c.name,
        role: 'radio', 'aria-checked': f.colorId === id ? 'true' : 'false',
        onclick: () => { f.colorId = id; paintSwatches(); Sfx.play('move'); }
      }));
    }
  };
  paintSwatches();

  const reminder = h('select', { class: 'f-select', 'aria-label': 'Notification', onchange: () => { f.reminder = reminder.value; } },
    [['default', 'Calendar default'], ['none', 'No notification'], ['0', 'At start time'], ['10', '10 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']]
      .concat(f.reminder === 'custom' ? [['custom', reminderText(raw.reminders)]] : [])
      .map(([v, l]) => h('option', { value: v, selected: v === f.reminder }, l)));
  const showAs = h('select', { class: 'f-select', 'aria-label': 'Show as', onchange: () => { f.free = showAs.value === 'free'; } },
    h('option', { value: 'busy', selected: !f.free }, 'Busy'), h('option', { value: 'free', selected: f.free }, 'Free'));
  const deadline = checkbox('Palace Deadline: count down to this in the side panel', f.deadline, (on) => { f.deadline = on; });
  const err = h('div', { class: 'f-err', hidden: true, role: 'alert' });
  writeTimes();

  const L = (t) => h('div', { class: 'f-label' }, t);
  const editor = h('div', { class: 'editor', role: 'dialog', 'aria-label': isNew ? 'New event' : 'Edit event' },
    h('div', { class: 'editor-head' },
      ransom(isNew ? 'CALLING CARD' : 'CHANGE OF PLANS', { seed: isNew ? 'cc' : 'cp' }),
      h('button', { class: 'icon-btn editor-close', 'aria-label': 'Close', onclick: () => closeLayer(entry) }, icon('close'))),
    h('div', { class: 'editor-body' },
      title,
      L('WHEN'),
      whenGrid,
      h('div', { class: 'f-row', style: { marginTop: '10px' } }, allDay),
      L('REPEAT'), repeat,
      ev && ev.seriesId ? h('div', { class: 'f-hint' }, 'This is one event in a repeating series. When you save, you choose: just this one, or all of them.') : null,
      L('WHERE'), location,
      L('DETAILS'), description,
      richDesc ? h('div', { class: 'f-hint' }, 'This was written with formatting in Google. If you change it here, it\u2019s saved as plain text (links are kept).') : null,
      h('div', { class: 'ed-grid' },
        h('div', null, L('CALENDAR'), calSel, specialType ? h('div', { class: 'f-hint' }, 'Google doesn\u2019t let this kind of event change calendars.') : null),
        h('div', null, L('NOTIFICATION'), reminder),
        h('div', null, L('SHOW ME AS'), showAs),
        h('div', { class: 'full' }, L('COLOUR'), swatches)),
      h('div', { style: { marginTop: '18px' } }, deadline)),
    h('div', { class: 'editor-foot' },
      err,
      !isNew && ev.editable ? h('button', { class: 'jag-btn ghost danger', onclick: () => { closeLayer(entry, true); deleteEvent(ev); } }, icon('trash'), ' DELETE') : null,
      h('button', { class: 'jag-btn ghost', onclick: () => closeLayer(entry) }, 'CANCEL'),
      h('button', { class: 'jag-btn primary', onclick: () => save() }, isNew ? 'SEND IT' : 'SAVE')));

  const save = async () => {
    f.title = title.value.trim();
    f.location = location.value.trim();
    f.description = description.value;
    const s = readStart(), e = readEnd();
    if (!s || !e) return showErr('Pick a start and an end.');
    f.start = s; f.end = e;
    if (f.allDay ? f.end <= f.start : f.end < f.start) return showErr('The end has to come after the start.');
    if (isNew) {
      closeLayer(entry, true);
      await createEvent(Object.assign({}, f, { recurrence: f.recurrence === '__keep' ? '' : f.recurrence }));
      return;
    }
    await saveExisting(ev, f, orig, master, () => closeLayer(entry, true));
  };
  const showErr = (msg) => { err.textContent = msg; err.hidden = false; Sfx.play('error'); };
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  const entry = pushLayer(editor, { modal: true, kind: 'editor' });
  Sfx.play('whoosh');
  title.focus({ preventScroll: true });
}

async function saveExisting(ev, f, orig, master, close) {
  const raw = ev.raw;
  const timesChanged = f.start.getTime() !== ev.start.getTime() || f.end.getTime() !== ev.end.getTime() || f.allDay !== ev.allDay;
  const recurChanged = f.recurrence !== '__keep' && f.recurrence !== orig.recurrence;
  const calChanged = f.calId !== ev.calId;
  const patch = {};
  if (f.title !== (raw.summary || '')) patch.summary = f.title;
  if (f.location !== (raw.location || '')) patch.location = f.location;
  if (f.description !== descriptionText(raw.description)) patch.description = f.description;
  if ((f.colorId || null) !== (raw.colorId || null)) patch.colorId = f.colorId || null;
  if (f.reminder !== orig.reminder && f.reminder !== 'custom') patch.reminders = reminderPatch(f.reminder);
  if (f.free !== orig.free) patch.transparency = f.free ? 'transparent' : 'opaque';
  if (f.deadline !== orig.deadline) patch.extendedProperties = { private: { pcDeadline: f.deadline ? '1' : '0' } };
  if (!Object.keys(patch).length && !timesChanged && !recurChanged && !calChanged) { close(); return; }

  let scope = 'single';
  if (ev.seriesId) {
    if (recurChanged || calChanged) {
      const ok = await confirmDialog({
        title: 'CHANGE THE WHOLE SERIES?',
        text: (recurChanged ? 'A new repeat rule' : 'A new calendar') + ' applies to every event in this series.',
        yes: 'Change all of them.', no: 'Go back.'
      });
      if (!ok) return;
      scope = 'series';
    } else {
      scope = await askScope('EDIT A REPEATING EVENT');
      if (!scope) return;
    }
  }
  const opts = {};
  if (scope === 'series') {
    opts.scope = 'series';
    opts.seriesId = ev.seriesId;
    if (timesChanged) {
      if (f.allDay !== ev.allDay && master) {
        const ms = master.start.date ? parseYmd(master.start.date) : new Date(master.start.dateTime);
        const first = addDays(sod(ms), dayDiff(seriesBase(ev), f.start));
        const s = f.allDay ? first : atMinutes(first, minutesOfDay(f.start));
        const e = f.allDay ? addDays(s, Math.max(1, dayDiff(f.start, f.end))) : new Date(s.getTime() + (f.end - f.start));
        Object.assign(patch, timePatch(ev, s, e, f.allDay));
      } else {
        const base = seriesBase(ev);
        opts.shiftMs = f.start - base;
        opts.durationMs = f.end - f.start;
        opts.dayShift = dayDiff(base, f.start);
      }
    }
    if (recurChanged) patch.recurrence = f.recurrence ? [f.recurrence] : [];
  } else {
    if (timesChanged) Object.assign(patch, timePatch(ev, f.start, f.end, f.allDay));
    if (recurChanged && !ev.seriesId) patch.recurrence = f.recurrence ? [f.recurrence] : [];
  }
  if (calChanged) opts.moveTo = f.calId;
  close();
  await updateEvent(ev, patch, opts, {
    title: f.title || '(No title)', start: f.start, end: f.end, allDay: f.allDay,
    colorId: f.colorId || null, deadline: f.deadline, free: f.free
  });
  if (patch.recurrence && !ev.seriesId) scheduleSync(300);
}

/* ---------------- choices ---------------- */
function choiceDialog(title, text, choices, cancelLabel) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let entry = null;
    const btns = choices.map((c) => h('button', { class: 'choice', onclick: () => { Sfx.play('select'); finish(c.v); closeLayer(entry, true); } }, c.label));
    btns.push(h('button', { class: 'choice is-quiet', onclick: () => { finish(null); closeLayer(entry); } }, cancelLabel || 'Never mind.'));
    const box = h('div', { class: 'choice-box', role: 'dialog', 'aria-label': title },
      h('div', { class: 'choice-q' }, ransom(title)),
      text ? h('p', { class: 'choice-text' }, text) : null,
      btns);
    box.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
        btns[n].focus();
        Sfx.play('move');
      }
    });
    entry = pushLayer(box, { modal: true, kind: 'choice', onClose: () => finish(null) });
    Sfx.play('select');
    setTimeout(() => btns[0].focus(), 30);
  });
}
function askScope(title) {
  return choiceDialog(title, null, [{ v: 'single', label: 'Just this event.' }, { v: 'series', label: 'All events in the series.' }], 'Cancel.');
}
function confirmDialog(o) {
  return choiceDialog(o.title, o.text, [{ v: true, label: o.yes }], o.no).then((v) => v === true);
}

/* ---------------- day list (month "+N more") ---------------- */
function openDayList(day, anchor) {
  closeAllLayers();
  const evs = visibleEvents(sod(day), addDays(sod(day), 1));
  const pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': fmtDateLong(day) },
    h('div', { class: 'pop-tag' }, fmtDateShort(day).toUpperCase()),
    popTools(h('button', { class: 'icon-btn', title: 'Open this day', 'aria-label': 'Open this day', onclick: () => goTo(day, 'day') }, icon('cal'))),
    h('div', { class: 'pop-body sv-list', style: { marginTop: '6px' } }, evs.map((e) => scheduleRow(e, sod(day)))));
  pushLayer(pop, { popover: true });
  placePop(pop, anchor);
  Sfx.play('select');
}

/* ---------------- settings: the Hideout ---------------- */
function openSettings() {
  closeAllLayers();
  const body = h('div', { class: 'hideout-body' });
  const s = App.settings;
  const seg = (key, options, after) => h('div', { class: 'seg' }, options.map(([v, label]) => h('button', {
    class: s[key] === v ? 'is-on' : '', 'aria-pressed': s[key] === v ? 'true' : 'false',
    onclick: () => { setSetting(key, v); Sfx.play('select'); if (after) after(v); build(); }
  }, label)));
  const sec = (label, ...content) => h('div', { class: 'set-sec' }, h('div', { class: 'f-label' }, label), h('div', null, content));
  const build = () => {
    clear(body);
    body.append(sec('THEME', h('div', { class: 'themes' }, Object.entries(THEMES).map(([id, t]) => h('button', {
      class: 'theme-card' + (s.theme === id ? ' is-on' : ''),
      style: { '--tc-bg': t.bg, '--tc-text': t.text, '--tc-accent': t.accent },
      'aria-pressed': s.theme === id ? 'true' : 'false',
      onclick: () => { setSetting('theme', id); Sfx.play('select'); build(); }
    }, h('b', null, t.name), h('small', null, t.sub))))));
    const grid = h('div', { class: 'set-grid' },
      sec('WEEK STARTS ON', seg('weekStart', [[0, 'SUNDAY'], [1, 'MONDAY'], [6, 'SATURDAY']], () => { App.miniMonth = startOfMonth(App.date); })),
      sec('CLOCK', seg('h24', [[false, '12-HOUR'], [true, '24-HOUR']], () => { lastTitle = ''; })),
      sec('SOUND EFFECTS', seg('sound', [[true, 'ON'], [false, 'OFF']])),
      sec('ANIMATION', seg('motion', [['full', 'FULL'], ['lite', 'LITE'], ['off', 'OFF']])),
      sec('SHOWTIME ALERT WHEN AN EVENT STARTS', seg('showtime', [[true, 'ON'], [false, 'OFF']]),
        h('button', { class: 'jag-btn ghost', style: { marginLeft: '10px' }, onclick: () => FX.showtime({ key: 'test', title: 'This is what it looks like', raw: {} }) }, 'TEST')),
      sec('EVENT COLOURS', seg('colorMode', [['google', 'GOOGLE COLOURS'], ['mono', 'PHANTOM INK']])),
      App.backend.kind === 'google' ? sec('CHECK GOOGLE FOR CHANGES EVERY', seg('syncSec', [[15, '15 SEC'], [30, '30 SEC'], [60, '1 MIN'], [300, '5 MIN']])) : null
    );
    body.append(grid);
    const city = h('input', { class: 'f-input', placeholder: 'City, e.g. Tokyo', value: s.weatherCity || '', 'aria-label': 'Weather city', style: { maxWidth: '260px' } });
    const saveCity = () => { App.settings.weatherCity = city.value.trim(); App.settings.weatherGeo = null; saveSettings(); Weather.refresh(true); toast(city.value.trim() ? 'Weather set to ' + city.value.trim() + '.' : 'Weather off.'); };
    city.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCity(); });
    body.append(sec('WEATHER (OPTIONAL, FROM OPEN-METEO)', h('div', { class: 'f-row' }, city, h('button', { class: 'jag-btn', onclick: saveCity }, 'SET')),
      h('div', { class: 'f-hint' }, 'Shows a weather icon on the date badge and on each day, Persona-style. Leave empty to turn it off.')));
    if (App.backend.kind === 'demo') {
      body.append(sec('DEMO MODE', h('div', { class: 'f-hint', style: { marginBottom: '10px' } }, 'You’re looking at fake events stored in this browser. To use your real Google Calendar, follow README.md (about 5 minutes).'),
        h('button', { class: 'jag-btn', onclick: async () => {
          const ok = await confirmDialog({ title: 'RESET THE DEMO?', text: 'Puts the fake events back the way they started.', yes: 'Reset it.', no: 'Keep my changes.' });
          if (!ok) return;
          DemoBackend.reset();
          App.win = {};
          await syncNow();
          toast('Demo reset.');
        } }, 'RESET DEMO EVENTS')));
    } else {
      body.append(sec('ACCOUNT', h('div', { class: 'f-hint' }, 'Linked to ' + (App.user || 'your Google account') + '. Everything you change here is saved to Google Calendar straight away, and changes made in Google Calendar show up here within ' + s.syncSec + ' seconds.')));
    }
    body.append(sec('KEYBOARD', h('button', { class: 'jag-btn', onclick: () => openHelp() }, icon('keyboard'), ' SHORTCUTS')));
  };
  build();
  let entry = null;
  const box = h('div', { class: 'hideout', role: 'dialog', 'aria-label': 'Settings' },
    h('div', { class: 'hideout-head' }, ransom('THE HIDEOUT', { seed: 'hideout' }), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => closeLayer(entry) }, icon('close'))),
    body);
  entry = pushLayer(box, { modal: true, kind: 'settings' });
  Sfx.play('select');
}

function openHelp() {
  closeAllLayers();
  const keys = [
    ['C', 'Create an event'], ['T', 'Jump to today'], ['D', 'Day view'], ['W', 'Week view'], ['M', 'Month view'], ['A', 'Schedule view'],
    ['J  →', 'Next'], ['K  ←', 'Previous'], ['/', 'Search'], ['R', 'Check Google now'], ['E', 'Edit the open event'],
    ['Del', 'Delete the open event'], ['S', 'Sound on/off'], ['Esc', 'Close / back'], ['?', 'This list']
  ];
  let entry = null;
  const box = h('div', { class: 'hideout', role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', { class: 'hideout-head' }, ransom('SHORTCUTS', { seed: 'keys' }), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => closeLayer(entry) }, icon('close'))),
    h('div', { class: 'hideout-body' },
      h('div', { class: 'kbd-list' }, keys.map(([k, t]) => h('div', null, k.split('  ').map((x) => h('kbd', null, x)), t))),
      h('div', { class: 'f-hint', style: { marginTop: '18px' } }, 'Mouse: click an empty slot to create, drag across slots for a longer event, drag an event to move it, drag its bottom edge to resize. On a phone: tap to create, press and hold an event to drag it.')));
  entry = pushLayer(box, { modal: true, kind: 'help' });
  Sfx.play('select');
}

function topLayerKind() {
  const top = Layers[Layers.length - 1];
  return top ? top.opts.kind || 'other' : null;
}
function topLayerEvent() {
  const top = Layers[Layers.length - 1];
  return top && top.opts.kind === 'details' ? top.opts.ev : null;
}
