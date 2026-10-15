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
    if (document.hidden || !App.ready) return;
    if (Date.now() - App.lastSync > 4000) syncNow();
    if (Date.now() - App.calsAt > 300000) refreshCalendars();
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
  if (!document.hidden && Date.now() - App.calsAt > 300000) refreshCalendars();
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
    if (App.backend.kind === 'google') await ensureUnlocked();
    const b = await bootstrapWithKey();
    App.user = b.user || '';
    if (b.settings && App.backend.kind === 'google') {
      App.settings = Object.assign({}, DEFAULT_SETTINGS, b.settings);
      lsSet(SETTINGS_KEY, App.settings);
      applySettings();
    }
    setCalendars(b.calendars || []);
    App.calsAt = Date.now();
    App.view = ['day', 'week', 'month', 'schedule'].includes(App.settings.view) ? App.settings.view : 'week';
    App.miniMonth = startOfMonth(App.date);
    bootText('BREAKING IN', 'Reading your calendar…');
    await syncNow();
    reveal();
  } catch (err) {
    showFatal(err);
  }
}

/* ---------------- passcode ---------------- */
async function ensureUnlocked() {
  App.backend.loadKey();
  const st = await App.backend.authState();
  if (st.legacy) return;
  if (!st.service) throw new Error('PC_NO_SERVICE: The "Google Calendar API" service is not turned on for this script.');
  if (!st.hasPasscode) {
    App.backend.saveKey(null);
    await passcodeGate('setup');
  } else if (!App.backend.token) {
    await passcodeGate('unlock', st);
  }
}

async function bootstrapWithKey() {
  try {
    return await App.backend.bootstrap();
  } catch (err) {
    if (App.backend.kind !== 'google' || !isLockedOut(err)) throw err;
    App.backend.saveKey(null);
    await passcodeGate(/PC_AUTH_SETUP/.test(err.message) ? 'setup' : 'unlock');
    return App.backend.bootstrap();
  }
}

let gateOpen = false;
/** The key stopped working while the app was open: ask for the passcode again. */
function onDeviceLocked() {
  if (gateOpen || !App.ready) return;
  gateOpen = true;
  App.backend.saveKey(null);
  closeAllLayers();
  passcodeGate('unlock').then(() => {
    gateOpen = false;
    syncNow();
    refreshCalendars();
  });
}

/** The passcode screen. mode 'setup' chooses one, 'unlock' enters it. Resolves once this device has its key. */
function passcodeGate(mode, info) {
  return new Promise((resolve) => {
    $('#boot').classList.add('is-out');
    const setup = mode === 'setup';
    const pass = h('input', {
      class: 'f-input', type: 'password', id: 'gatePass', 'aria-label': setup ? 'New passcode' : 'Passcode',
      autocomplete: setup ? 'new-password' : 'current-password', placeholder: setup ? 'Choose a passcode' : 'Passcode'
    });
    const again = setup ? h('input', { class: 'f-input', type: 'password', id: 'gatePass2', 'aria-label': 'Passcode again', autocomplete: 'new-password', placeholder: 'Type it again' }) : null;
    const err = h('div', { class: 'f-err', hidden: true, role: 'alert' });
    const label = setup ? 'LOCK IT IN' : 'UNLOCK';
    const btn = h('button', { class: 'jag-btn primary', type: 'submit' }, label);
    const show = (text) => { err.textContent = text; err.hidden = false; Sfx.play('error'); };
    const node = h('div', { class: 'fatal gate', role: 'dialog', 'aria-label': setup ? 'Choose a passcode' : 'Enter your passcode' });
    const done = () => {
      Sfx.play('select');
      node.remove();
      if (!App.ready) { $('#boot').hidden = false; $('#boot').classList.remove('is-out'); bootText('BREAKING IN', 'Reading your calendar…'); }
      resolve();
    };
    const form = h('form', {
      class: 'gate-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const p = pass.value;
        if (setup) {
          if (p.length < 6) return show('Use at least 6 characters.');
          if (p !== again.value) return show('The two passcodes don\u2019t match.');
        } else if (!p) return show('Type your passcode.');
        btn.disabled = true;
        btn.textContent = 'CHECKING…';
        try {
          if (setup) await App.backend.setPasscode(p);
          else await App.backend.unlock(p);
          done();
        } catch (er) {
          const m = String((er && er.message) || er);
          if (/PC_AUTH_SETUP/.test(m)) { node.remove(); passcodeGate('setup').then(resolve); return; }
          if (/already set/.test(m)) { node.remove(); passcodeGate('unlock').then(resolve); return; }
          show(errMsg(er));
          pass.value = '';
          pass.focus();
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
      }
    }, pass, again, err, h('div', { class: 'fatal-actions' }, btn));
    const box = h('div', { class: 'fatal-box' },
      ransom(setup ? 'CHOOSE A PASSCODE' : 'SHOW YOUR CARD', { seed: mode }),
      setup
        ? h('p', null, 'Your app link opens in any browser now, whichever Google account is signed in. A passcode keeps your calendar yours: even someone who gets hold of the link can\u2019t get in without it. Use at least 6 characters. Each device asks once, then remembers.')
        : h('p', null, 'Enter your passcode to unlock this device. It\u2019ll remember, so you only do this once here.'),
      form,
      setup ? null : h('p', { class: 'gate-help' }, 'Forgot it? Open your project at script.google.com, pick ', h('b', null, 'resetPasscode'), ' in the list next to ', h('b', null, '▷ Run'), ', click ', h('b', null, 'Run'), ', then reload this page and choose a new one.'));
    node.append(box);
    document.body.append(node);
    if (info && info.lockedForMs) show('Too many wrong tries. Wait ' + Math.ceil(info.lockedForMs / 60000) + ' minutes, then try again.');
    pass.focus();
  });
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
      h('p', null, permission ? 'Google hasn’t given the app permission to use your calendar. This usually means a box was left unticked on Google’s permission screen.' : 'Couldn’t break into your calendar. Google said:'),
      h('div', { class: 'fatal-msg' }, errMsg(err)),
      permission
        ? h('ol', null,
          li('Go back to your project at script.google.com.'),
          li('In the bar at the top, pick ', h('b', null, 'pcBootstrap'), ' from the list next to ', h('b', null, '▷ Run'), ', then click ', h('b', null, 'Run'), '.'),
          li('Click ', h('b', null, 'Review permissions'), ', choose your account, ', h('b', null, 'tick every box'), ', then ', h('b', null, 'Continue'), ' or ', h('b', null, 'Allow'), '.'),
          li('Come back here and press ', h('b', null, 'TRY AGAIN'), '.'))
        : h('p', null, 'If it keeps happening, see “If something goes wrong” in README.md.'));
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
