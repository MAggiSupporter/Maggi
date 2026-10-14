// End-to-end test of the app in demo mode: create, drag, resize, undo,
// repeating events, month view, search, delete, themes, phone gestures.
// Run: node tests/demo.test.js [time zone]   e.g. America/Los_Angeles
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
let failures = 0;
const assert = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.log('  FAIL ' + m); } };
const PAGE = 'file://' + path.join(__dirname, '..', 'apps-script', 'Index.html');
const TZ = process.argv[2] || 'UTC';
(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy });
  const out = os.tmpdir();
  console.log('Demo mode, time zone ' + TZ + ':');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, timezoneId: TZ });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + ' ' + e.stack));
  await p.goto(PAGE);
  await p.waitForSelector('#app:not([hidden])');
  await p.waitForTimeout(800);
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('phantom-calendar-demo-v1')));
  const count0 = (await db()).events.length;
  const local = (iso) => p.evaluate((x) => { const d = new Date(x); return { h: d.getHours(), m: d.getMinutes(), day: d.getDay() }; }, iso);

  // ---- 1. click an empty slot (Sunday column, 2pm) → quick create
  await p.evaluate(() => { const s = document.querySelector('.tg-scroll'); s.scrollTop = 8 * 52; });
  await p.waitForTimeout(200);
  const col0 = await p.$('.tg-col[data-idx="0"]');
  const box = await col0.boundingBox();
  const yFor = async (min) => { const r = await p.evaluate(() => document.querySelector('.tg-col[data-idx="0"]').getBoundingClientRect().top); return r + min * (52 / 60); };
  await p.mouse.click(box.x + box.width / 2, await yFor(14 * 60 + 10));
  await p.waitForSelector('.pop.qc');
  await p.keyboard.type('Steal the treasure');
  await p.screenshot({ path: path.join(out, 'pc-quick.png') });
  await p.keyboard.press('Enter');
  await p.waitForSelector('.fx-card');
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(out, 'pc-card.png') });
  await p.waitForTimeout(2200);
  let d = await db();
  let made = d.events.find((e) => e.summary === 'Steal the treasure');
  assert(made && d.events.length === count0 + 1, 'quick create saved an event');
  const st = await local(made.start.dateTime);
  assert(st.h === 14 && st.m === 0 && (new Date(made.end.dateTime) - new Date(made.start.dateTime)) === 3600e3, 'click-created at 2:00 for 1 hour (' + made.start.dateTime + ')');
  assert(await p.$('.ev[data-key$="' + made.id + '"]'), 'new event drawn in the grid');

  // ---- 2. drag the new event to Monday 4:30pm
  let el = await p.$('.ev[data-key$="' + made.id + '"]');
  let b = await el.boundingBox();
  const col1 = await (await p.$('.tg-col[data-idx="1"]')).boundingBox();
  await p.mouse.move(b.x + 20, b.y + 10);
  await p.mouse.down();
  await p.mouse.move(b.x + 40, b.y + 30, { steps: 4 });
  const targetY = (await yFor(16 * 60 + 30)) + 10;
  await p.mouse.move(col1.x + 30, targetY, { steps: 8 });
  await p.screenshot({ path: path.join(out, 'pc-dragging.png') });
  await p.mouse.up();
  await p.waitForTimeout(900);
  d = await db();
  made = d.events.find((e) => e.summary === 'Steal the treasure');
  const ms = await local(made.start.dateTime);
  assert(ms.day === 1 && ms.h === 16 && ms.m === 30, 'dragged to Monday 4:30pm (' + made.start.dateTime + ')');
  assert(await p.$('.toast .toast-act'), 'undo toast shown');

  // ---- 3. resize bottom edge to 6:00pm
  el = await p.$('.ev[data-key$="' + made.id + '"]');
  b = await el.boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height - 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2, (await yFor(18 * 60)) + 2, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(900);
  d = await db();
  made = d.events.find((e) => e.summary === 'Steal the treasure');
  let le = await local(made.end.dateTime);
  assert(le.h === 18 && le.m === 0, 'resized to end 6:00pm (' + made.end.dateTime + ')');

  // ---- 4. undo the resize
  const undo = await p.$$('.toast .toast-act');
  await undo[undo.length - 1].click();
  await p.waitForTimeout(900);
  d = await db();
  made = d.events.find((e) => e.summary === 'Steal the treasure');
  le = await local(made.end.dateTime);
  assert(le.h === 17 && le.m === 30, 'undo restored 5:30pm end');

  // ---- 5. edit a repeating event ("Hideout meeting" on this week's Wed) → all events → rename
  const hide = await p.$('.ev:has-text("Hideout meeting")');
  await hide.click();
  await p.waitForSelector('.pop');
  await p.keyboard.press('e');
  await p.waitForSelector('.editor');
  await p.waitForTimeout(500);
  const repLabel = await p.$eval('.editor select[aria-label="Repeat"]', (s) => s.selectedOptions[0].textContent);
  assert(/Weekly on Wednesday/.test(repLabel), 'editor shows the series rule (' + repLabel + ')');
  await p.screenshot({ path: path.join(out, 'pc-editor.png') });
  await p.fill('.editor .f-title-input', 'Hideout meeting (all)');
  await p.click('.editor .jag-btn.primary');
  await p.waitForSelector('.choice-box');
  await p.screenshot({ path: path.join(out, 'pc-scope.png') });
  await p.click('.choice:has-text("All events")');
  await p.waitForTimeout(1500);
  d = await db();
  const master = d.events.find((e) => e.summary === 'Hideout meeting (all)');
  assert(master && master.recurrence, 'series renamed on the master event');

  // ---- 6. move one occurrence only, a day later via drag → "just this event"
  await p.waitForTimeout(500);
  const occ = (await p.$$('.ev:has-text("Hideout meeting (all)")'))[0];
  b = await occ.boundingBox();
  const colW = col1.width;
  await p.mouse.move(b.x + 20, b.y + 10);
  await p.mouse.down();
  await p.mouse.move(b.x + 30 + colW, b.y + 10, { steps: 8 });
  await p.mouse.up();
  await p.waitForSelector('.choice-box');
  await p.click('.choice:has-text("Just this")');
  await p.waitForTimeout(1200);
  d = await db();
  const ovKeys = Object.keys(d.overrides);
  assert(ovKeys.some((k) => k.startsWith(master.id + '_') && d.overrides[k].start), 'single occurrence override saved');

  // ---- 7. month view: drag a single event two days later
  await p.click('.tab[data-view="month"]');
  await p.waitForTimeout(500);
  const bar = await p.$('.bar:has-text("Steal the treasure")');
  b = await bar.boundingBox();
  const cell = await (await p.$('.mv-cell')).boundingBox();
  await p.mouse.move(b.x + 10, b.y + 8);
  await p.mouse.down();
  await p.mouse.move(b.x + 10 + cell.width * 2, b.y + 8, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(900);
  d = await db();
  made = d.events.find((e) => e.summary === 'Steal the treasure');
  const mm = await local(made.start.dateTime);
  assert(mm.day === 3 && mm.h === 16, 'month drag moved to Wednesday, same time');

  // ---- 8. month: click empty cell → all-day quick create
  const cells = await p.$$('.mv-cell');
  const cb = await cells[30].boundingBox();
  await p.mouse.click(cb.x + cb.width / 2, cb.y + cb.height - 10);
  await p.waitForSelector('.pop.qc');
  const allDayOn = await p.$eval('.pop.qc .check input', (i) => i.checked);
  assert(allDayOn, 'month click → all-day draft');
  await p.keyboard.type('Big all-day heist');
  await p.click('.pop.qc .jag-btn.primary');
  await p.waitForTimeout(2600);
  d = await db();
  assert(d.events.some((e) => e.summary === 'Big all-day heist' && e.start.date), 'all-day event saved');

  // ---- 9. search
  await p.keyboard.press('/');
  await p.keyboard.type('treasure');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  const found = await p.$$eval('.sv-ev', (els) => els.map((e) => e.textContent));
  assert(found.some((t) => /Steal the treasure/.test(t)), 'search finds the event');
  await p.screenshot({ path: path.join(out, 'pc-search.png') });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // ---- 10. delete via details
  await p.click('.tab[data-view="schedule"]');
  await p.waitForTimeout(400);
  await p.click('.tab[data-view="week"]');
  await p.waitForTimeout(400);
  await p.click('#nextBtn'); await p.waitForTimeout(300); await p.click('#prevBtn'); await p.waitForTimeout(500);
  const victim = await p.$('.ev:has-text("Steal the treasure")');
  await victim.click();
  await p.waitForSelector('.pop');
  await p.click('.pop [aria-label="Delete"]');
  await p.waitForSelector('.choice-box');
  await p.click('.choice:has-text("Erase it")');
  await p.waitForTimeout(800);
  d = await db();
  assert(!d.events.some((e) => e.summary === 'Steal the treasure'), 'event deleted');

  // ---- 11. settings → themes
  await p.click('#settingsBtn');
  await p.waitForSelector('.hideout');
  await p.screenshot({ path: path.join(out, 'pc-settings.png') });
  await p.click('.theme-card:has-text("VELVET ROOM")');
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, 'pc-velvet.png') });
  await p.click('#settingsBtn');
  await p.click('.theme-card:has-text("CROW")');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, 'pc-crow.png') });
  // showtime test
  await p.click('#settingsBtn');
  await p.click('.set-sec button:has-text("TEST")');
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(out, 'pc-showtime.png') });
  await p.waitForTimeout(2500);
  await p.keyboard.press('Escape');
  await p.click('#settingsBtn');
  await p.click('.theme-card:has-text("JOKER")');
  await p.keyboard.press('Escape');

  // ---- 12. keyboard: C opens the full editor
  await p.keyboard.press('c');
  await p.waitForSelector('.editor');
  await p.keyboard.type('Keyboard caper');
  await p.click('.editor .jag-btn.primary');
  await p.waitForTimeout(800);
  d = await db();
  assert(d.events.some((e) => e.summary === 'Keyboard caper'), 'C → editor → SEND IT creates an event');
  await p.keyboard.press('Escape');

  // ---- 13. hide a calendar (confidant card)
  const schoolBefore = await p.$$('.ev:has-text("Classes")');
  await p.click('.cal:has-text("School")');
  await p.waitForTimeout(300);
  const schoolAfter = await p.$$('.ev:has-text("Classes")');
  assert(schoolBefore.length > 0 && schoolAfter.length === 0, 'clicking a calendar card hides its events');
  await p.click('.cal:has-text("School")');
  await p.waitForTimeout(500);
  assert((await p.$$('.ev:has-text("Classes")')).length === schoolBefore.length, 'and clicking again brings them back');

  // ---- 14. week starts on Monday, 24-hour clock
  await p.click('#settingsBtn');
  await p.click('.seg button:has-text("MONDAY")');
  await p.click('.seg button:has-text("24-HOUR")');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  assert(/MON/.test(await p.textContent('.tg-dh')), 'week can start on Monday');
  assert(/^\d\d:00$/.test((await p.textContent('.tg-hour')).trim()), '24-hour clock labels');

  // ---- 15. click a day header → day view
  await p.click('.tg-dh >> nth=2');
  await p.waitForTimeout(400);
  assert((await p.$$('.tg-col')).length === 1 && (await p.getAttribute('.tab[data-view="day"]', 'aria-selected')) === 'true', 'clicking a day opens day view');

  // ---- 16. today transition
  await p.click('#nextBtn');
  await p.click('#todayBtn');
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(out, 'pc-today-fx.png') });
  await p.waitForTimeout(900);

  assert(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();

  // ---- phone: tap to create, press-and-hold to drag
  console.log('Phone (touch), time zone ' + TZ + ':');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, hasTouch: true, isMobile: true, timezoneId: TZ });
  const m = await mctx.newPage();
  const merr = [];
  m.on('pageerror', (e) => merr.push(e.message));
  await m.goto(PAGE);
  await m.waitForSelector('#app:not([hidden])');
  await m.waitForTimeout(700);
  assert((await m.$$('.tg-col')).length === 3, 'week view shows 3 days on a phone');
  await m.evaluate(() => { document.querySelector('.tg-scroll').scrollTop = 10 * 48; });
  await m.waitForTimeout(150);
  const mcol = await (await m.$('.tg-col[data-idx="1"]')).boundingBox();
  const mtop = await m.evaluate(() => document.querySelector('.tg-col[data-idx="1"]').getBoundingClientRect().top);
  await m.touchscreen.tap(mcol.x + mcol.width / 2, mtop + 15 * 48 + 10);
  await m.waitForSelector('.pop.qc.as-sheet');
  assert(true, 'tap opens quick-create as a bottom sheet');
  await m.keyboard.type('Phone heist');
  await m.keyboard.press('Enter');
  await m.waitForTimeout(2600);
  const mdb = await m.evaluate(() => JSON.parse(localStorage.getItem('phantom-calendar-demo-v1')));
  const ph = mdb.events.find((e) => e.summary === 'Phone heist');
  assert(ph && (await m.evaluate((x) => new Date(x).getHours(), ph.start.dateTime)) === 15, 'tap-created at 3pm');
  // press and hold, then drag down one hour (CDP touch events)
  const evb = await (await m.$('.ev:has-text("Phone heist")')).boundingBox();
  const cdp = await mctx.newCDPSession(m);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const x0 = evb.x + 20, y0 = evb.y + 10;
  await tp('touchStart', x0, y0);
  await m.waitForTimeout(500);
  for (let i = 1; i <= 8; i++) { await tp('touchMove', x0, y0 + i * 6); await m.waitForTimeout(16); }
  await tp('touchEnd');
  await m.waitForTimeout(900);
  const mdb2 = await m.evaluate(() => JSON.parse(localStorage.getItem('phantom-calendar-demo-v1')));
  const ph2 = mdb2.events.find((e) => e.summary === 'Phone heist');
  assert((await m.evaluate((x) => new Date(x).getHours(), ph2.start.dateTime)) === 16, 'press-and-hold drag moves it an hour later (' + ph2.start.dateTime + ')');
  // a quick swipe scrolls instead of dragging
  const sc0 = await m.evaluate(() => document.querySelector('.tg-scroll').scrollTop);
  const evb2 = await (await m.$('.ev:has-text("Phone heist")')).boundingBox();
  await tp('touchStart', evb2.x + 20, evb2.y + 20);
  for (let i = 1; i <= 8; i++) { await tp('touchMove', evb2.x + 20, evb2.y + 20 - i * 15); await m.waitForTimeout(10); }
  await tp('touchEnd');
  await m.waitForTimeout(600);
  const mdb3 = await m.evaluate(() => JSON.parse(localStorage.getItem('phantom-calendar-demo-v1')));
  const sc1 = await m.evaluate(() => document.querySelector('.tg-scroll').scrollTop);
  assert(mdb3.events.find((e) => e.summary === 'Phone heist').start.dateTime === ph2.start.dateTime && sc1 !== sc0, 'a quick swipe scrolls the day instead of moving the event');
  await m.screenshot({ path: path.join(out, 'pc-mobile-after.png') });
  assert(!merr.length, 'no page errors on the phone' + (merr.length ? ': ' + merr.join(' | ') : ''));

  await browser.close();
  console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
