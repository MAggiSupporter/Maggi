'use strict';
/* =========================================================================
   app.js — start-up, buttons, keyboard, timers.
   ========================================================================= */

/* ---------------- optional weather (Open-Meteo, no key needed) ---------------- */
const Weather = {
  data: null,
  fetchedAt: 0,
  CODES: [
    [[0, 1], 'sun', 'Clear'], [[2, 3], 'cloud', 'Cloudy'], [[45, 48], 'fog', 'Fog'],
    [[51, 67], 'rain', 'Rain'], [[71, 77], 'snow', 'Snow'], [[80, 82], 'rain', 'Showers'],
    [[85, 86], 'snow', 'Snow showers'], [[95, 99], 'storm', 'Thunderstorm']
  ],
  describe(code) {
    for (const [[a, b], ic, label] of this.CODES) if (code >= a && code <= b) return { icon: ic, label };
    return null;
  },
  today() { return this.on(new Date()); },
  on(day) {
    if (!this.data) return null;
    const k = ymd(day);
    if (sameDay(day, new Date()) && this.data.current != null) return this.describe(this.data.current);
    return this.data.daily[k] != null ? this.describe(this.data.daily[k]) : null;
  },
  async refresh(force) {
    const s = App.settings;
    if (!s.weatherCity) { this.data = null; requestRender(); return; }
    if (!force && this.data && Date.now() - this.fetchedAt < 3600e3) return;
    try {
      let geo = s.weatherGeo;
      if (!geo || geo.q !== s.weatherCity) {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(s.weatherCity)).then((x) => x.json());
        const g = r.results && r.results[0];
        if (!g) { toast('Couldn’t find a city called “' + s.weatherCity + '”.'); return; }
        geo = { q: s.weatherCity, lat: g.latitude, lon: g.longitude };
        App.settings.weatherGeo = geo;
        saveSettings();
      }
      const f = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + geo.lat + '&longitude=' + geo.lon +
        '&current=weather_code&daily=weather_code&timezone=auto&forecast_days=14').then((x) => x.json());
      const daily = {};
      (f.daily && f.daily.time || []).forEach((t, i) => { daily[t] = f.daily.weather_code[i]; });
      this.data = { current: f.current ? f.current.weather_code : null, daily };
      this.fetchedAt = Date.now();
      requestRender();
    } catch (e) {
      this.data = null;
    }
  }
};

/* ---------------- navigation ---------------- */
function goTo(date, view) {
  const before = App.date;
  App.date = sod(date);
  if (view && view !== App.view) {
    if (App.view === 'search') App.search = null;
    App.view = view;
    App.settings.view = view;
    saveSettings();
  } else if (App.view === 'search') {
    App.search = null;
    App.view = App.prevView || 'week';
  }
  Sfx.play('select');
  afterNavigate(App.date > before ? 'next' : App.date < before ? 'prev' : null);
}

function navigate(dir) {
  if (App.view === 'search') { leaveSearch(); return; }
  const d = App.date;
  if (App.view === 'day') App.date = addDays(d, dir);
  else if (App.view === 'week') App.date = addDays(d, dir * gridDays());
  else if (App.view === 'month') App.date = addMonths(startOfMonth(d), dir);
  else App.date = addDays(d, dir * 7);
  Sfx.play('move');
  afterNavigate(dir > 0 ? 'next' : 'prev');
}

function goToday() {
  const now = new Date();
  if (App.view === 'search') { App.search = null; App.view = App.prevView || 'week'; }
  App.date = sod(now);
  App.tgScroll = null;
  FX.transition(fmtMD(now), WEEKDAYS[now.getDay()] + ' · ' + dayPhase(now));
  if (FX.level() !== 'full') Sfx.play('select');
  afterNavigate(null);
}

function setView(v) {
  if (v === App.view) return;
  if (App.view === 'search') { App.search = null; const i = $('#searchInput'); if (i) i.value = ''; }
  App.view = v;
  App.settings.view = v;
  saveSettings();
  Sfx.play('select');
  afterNavigate(null);
}

const backgroundSync = debounce(() => syncNow(), 500);
function afterNavigate(slide) {
  App.miniMonth = startOfMonth(App.date);
  closeAllLayers();
  if (isMobile()) document.querySelector('.app').classList.remove('side-open');
  renderAll();
  if (slide && FX.level() !== 'off') {
    const v = $('#view');
    v.classList.remove('slide-next', 'slide-prev');
    void v.offsetWidth;
    v.classList.add('slide-' + slide);
  }
  if (App.view !== 'search' && !rangeLoaded(viewRange())) syncNow(); else backgroundSync();
}

function openCreate() {
  openEditor(null, null);
}

/* ---------------- side panel ---------------- */
function toggleSidebar() {
  const app = $('.app');
  if (window.matchMedia('(max-width: 1020px)').matches) {
    const open = !app.classList.contains('side-open');
    app.classList.toggle('side-open', open);
    $('#scrim').hidden = !open;
  } else {
    App.settings.sidebar = !App.settings.sidebar;
    saveSettings();
    app.classList.toggle('side-collapsed', !App.settings.sidebar);
    requestRender();
  }
  Sfx.play('move');
}
function closeDrawer() {
  $('.app').classList.remove('side-open');
  $('#scrim').hidden = true;
}

/* ---------------- wiring ---------------- */
function bindUI() {
  $('#menuBtn').append(icon('menu'));
  $('#prevBtn').append(icon('prev'));
  $('#nextBtn').append(icon('next'));
  $('#searchBtn').append(icon('search'));
  $('#settingsBtn').append(icon('gear'));

  $('#menuBtn').addEventListener('click', toggleSidebar);
  $('#scrim').addEventListener('click', closeDrawer);
  $('#prevBtn').addEventListener('click', () => navigate(-1));
  $('#nextBtn').addEventListener('click', () => navigate(1));
  $('#todayBtn').addEventListener('click', goToday);
  $('#dateWidget').addEventListener('click', goToday);
  $('#createBtn').addEventListener('click', () => { closeDrawer(); openCreate(); });
  $('#fab').addEventListener('click', openCreate);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#soundBtn').addEventListener('click', () => { setSetting('sound', !App.settings.sound); Sfx.play('select'); });
  $('#syncChip').addEventListener('click', () => { Sfx.play('move'); syncNow(); });
  $$('#viewTabs .tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  const form = $('#searchForm'), input = $('#searchInput');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.classList.contains('is-open') && !input.value.trim()) { form.classList.add('is-open'); input.focus(); return; }
    if (input.value.trim()) { Sfx.play('select'); runSearch(input.value); input.blur(); }
  });
  input.addEventListener('focus', () => form.classList.add('is-open'));
  input.addEventListener('blur', () => { if (!input.value.trim()) form.classList.remove('is-open'); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; input.blur(); leaveSearch(); } });

  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', debounce(() => { if (App.ready) renderAll(); }, 150));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && App.ready && Date.now() - App.lastSync > 4000) syncNow();
  });
  window.addEventListener('focus', () => {
    if (App.ready && Date.now() - App.lastSync > 8000) syncNow();
  });
}

function onKey(e) {
  if (!App.ready) return;
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (e.key === 'Escape') {
    if (closeTopLayer()) { e.preventDefault(); return; }
    if ($('.app').classList.contains('side-open')) { closeDrawer(); return; }
    if (App.view === 'search') { leaveSearch(); return; }
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const kind = topLayerKind();
  const open = topLayerEvent();
  if (open && (e.key === 'e' || e.key === 'E') && open.editable) { e.preventDefault(); closeAllLayers(); openEditor(open); return; }
  if (open && (e.key === 'Delete' || e.key === 'Backspace') && open.editable) { e.preventDefault(); deleteEvent(open); return; }
  if (kind && kind !== 'details') return;
  const k = e.key;
  const map = {
    t: goToday, T: goToday,
    d: () => setView('day'), w: () => setView('week'), m: () => setView('month'), a: () => setView('schedule'),
    j: () => navigate(1), n: () => navigate(1), ArrowRight: () => navigate(1),
    k: () => navigate(-1), p: () => navigate(-1), ArrowLeft: () => navigate(-1),
    c: openCreate,
    r: () => { Sfx.play('move'); syncNow(); },
    s: () => { setSetting('sound', !App.settings.sound); Sfx.play('select'); toast('Sound ' + (App.settings.sound ? 'on.' : 'off.')); },
    '/': () => { const f = $('#searchForm'); f.classList.add('is-open'); $('#searchInput').focus(); },
    '?': openHelp
  };
  const fn = map[k];
  if (fn) { e.preventDefault(); if (kind === 'details') closeAllLayers(); fn(); }
}

/* ---------------- timers ---------------- */
let lastShowCheck = Date.now();
let todayKey = ymd(new Date());
function tick() {
  if (!App.ready) return;
  const now = new Date();
  // a new day began while the app was open
  if (ymd(now) !== todayKey) {
    const wasToday = ymd(App.date) === todayKey;
    todayKey = ymd(now);
    if (wasToday) App.date = sod(now);
    FX.transition(fmtMD(now), 'A NEW DAY BEGINS');
    renderAll();
    syncNow();
  }
  $('#dwPhase').textContent = dayPhase(now);
  const ppm = cssPx('--hour-h') / 60;
  $$('.tg-now').forEach((el) => {
    el.style.top = minutesOfDay(now) * ppm + 'px';
    const lab = el.querySelector('.tg-now-label');
    if (lab) lab.textContent = fmtTime(now, true);
  });
  updateSyncChip();
  // SHOWTIME: an event just started
  const t = now.getTime();
  if (App.settings.showtime) {
    for (const ev of App.events.values()) {
      if (ev.allDay || ev.declined || ev.pending) continue;
      const cal = App.calMap.get(ev.calId);
      if (!cal || !calVisible(cal)) continue;
      const s = ev.start.getTime();
      if (s > lastShowCheck && s <= t && t - s < 120000) { FX.showtime(ev); break; }
    }
  }
  lastShowCheck = t;
}
let lastSideRender = 0;
function slowTick() {
  if (!App.ready) return;
  // keep the "next up" countdown fresh without redrawing the whole page
  if (Date.now() - lastSideRender > 55000 && !App.drag) { lastSideRender = Date.now(); renderDeadlines(); }
  const due = App.settings.syncSec * 1000;
  if (!document.hidden && !App.drag && Date.now() - Math.max(App.lastSync, App.lastAttempt) >= due - 500) syncNow();
}

/* ---------------- start-up ---------------- */
function bootText(title, sub) {
  const t = $('#bootTitle');
  clear(t).append(ransom(title, { seed: title }));
  if (sub != null) $('#bootSub').textContent = sub;
}

async function boot() {
  loadSettings();
  applySettings();
  bootText('TAKE YOUR TIME');
  App.backend = pickBackend();
  try {
    const b = await App.backend.bootstrap();
    App.user = b.user || '';
    if (b.settings && App.backend.kind === 'google') {
      App.settings = Object.assign({}, DEFAULT_SETTINGS, b.settings);
      lsSet(SETTINGS_KEY, App.settings);
      applySettings();
    }
    setCalendars(b.calendars || []);
    App.view = ['day', 'week', 'month', 'schedule'].includes(App.settings.view) ? App.settings.view : 'week';
    App.miniMonth = startOfMonth(App.date);
    bootText('BREAKING IN', 'Reading your calendar…');
    await syncNow();
    reveal();
  } catch (err) {
    showFatal(err);
  }
}

let started = false;
function reveal() {
  App.ready = true;
  $('#app').hidden = false;
  $('.app').classList.toggle('side-collapsed', !App.settings.sidebar);
  $('#demoBanner').hidden = App.backend.kind !== 'demo';
  renderAll();
  const b = $('#boot');
  b.classList.add('is-out');
  setTimeout(() => { b.hidden = true; }, 600);
  if (!started) {
    started = true;
    setInterval(tick, 10000);
    setInterval(slowTick, 5000);
    Weather.refresh();
    setInterval(() => Weather.refresh(), 3600e3);
  }
}

function showFatal(err) {
  const raw = String((err && err.message) || err);
  const noService = /PC_NO_SERVICE|Calendar is not defined/i.test(raw);
  const permission = /permission|authoriz|not have access|insufficient/i.test(raw);
  const node = h('div', { class: 'fatal', role: 'alert' });
  const li = (...c) => h('li', null, c);
  const box = h('div', { class: 'fatal-box' }, ransom(noService ? 'ONE MORE STEP' : 'SECURITY ALERT'));
  if (noService) {
    box.append(
      h('p', null, 'The app is installed, but Google hasn’t let it see your calendar yet. Turn on the calendar service:'),
      h('ol', null,
        li('Go back to the Apps Script editor (script.google.com).'),
        li('On the left, click the ', h('b', null, '+'), ' next to ', h('b', null, 'Services'), '.'),
        li('Choose ', h('b', null, 'Google Calendar API'), ' and click ', h('b', null, 'Add'), '.'),
        li('Click ', h('b', null, 'Deploy → Manage deployments'), ', the ✏️ pencil, set ', h('b', null, 'Version'), ' to ', h('b', null, 'New version'), ', then ', h('b', null, 'Deploy'), '.'),
        li('Come back here and press ', h('b', null, 'TRY AGAIN'), '.')));
  } else {
    box.append(
      h('p', null, permission ? 'Google said this app isn’t allowed to see your calendar. Open the Web app link again and approve access when Google asks.' : 'Couldn’t break into your calendar. Google said:'),
      h('div', { class: 'fatal-msg' }, errMsg(err)),
      h('p', null, 'If it keeps happening, see “If something goes wrong” in README.md.'));
  }
  box.append(h('div', { class: 'fatal-actions' },
    h('button', { class: 'jag-btn primary', onclick: () => { node.remove(); $('#boot').hidden = false; $('#boot').classList.remove('is-out'); boot(); } }, 'TRY AGAIN'),
    h('button', { class: 'jag-btn', onclick: () => { node.remove(); App.backend = DemoBackend; startDemoAfterFailure(); } }, 'LOOK AROUND IN DEMO MODE')));
  node.append(box);
  document.body.append(node);
  $('#boot').classList.add('is-out');
}

async function startDemoAfterFailure() {
  const b = await DemoBackend.bootstrap();
  App.user = b.user;
  setCalendars(b.calendars);
  App.view = 'week';
  App.miniMonth = startOfMonth(App.date);
  await syncNow();
  reveal();
}

bindUI();
boot();
