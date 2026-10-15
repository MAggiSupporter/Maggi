// End-to-end test of the Google path: the real app (apps-script/Index.html)
// talking to the real apps-script/Code.gs, which runs in Node against a fake
// Calendar API (tests/fake-google.js). Run: node tests/google-path.test.js
const path = require('node:path');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { loadCodeGs } = require('./fake-google');
const { installBridge, passGate } = require('./gas-bridge');

const PAGE = 'file://' + path.join(__dirname, '..', 'apps-script', 'Index.html');
let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}

const PASS = 'heist-1234';

async function openApp(browser, gas, log, names) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failures++; console.log('  PAGE ERROR ' + e.message); });
  await installBridge(ctx, gas, names, log);
  await page.goto(PAGE);
  return { ctx, page };
}

function isoAt(day, h, m) { const d = new Date(day); d.setUTCHours(h, m || 0, 0, 0); return d.toISOString(); }

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy });

  /* ---------- 1. missing Calendar service → friendly setup screen ---------- */
  console.log('Missing "Google Calendar API" service:');
  {
    const { gas, names } = loadCodeGs({ noService: true });
    const { ctx, page } = await openApp(browser, gas, null, names);
    await page.waitForSelector('.fatal', { timeout: 10000 });
    const text = await page.textContent('.fatal');
    check(/Google Calendar API/.test(text) && /New version/.test(text), 'shows the "turn on the service" steps');
    await page.click('.fatal button:has-text("DEMO")');
    await page.waitForSelector('#app:not([hidden])');
    check(await page.isVisible('#demoBanner'), 'can fall back to demo mode');
    await ctx.close();
  }

  /* ---------- 2. the real flow ---------- */
  console.log('Linked to a (fake) Google Calendar:');
  const { gas, fake, props, scriptProps, session, names } = loadCodeGs();
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = today.getUTCDay();
  const sunday = new Date(today.getTime() - dow * 864e5);
  const tue = new Date(sunday.getTime() + 2 * 864e5);
  fake.add('me@example.com', { summary: 'Team sync', start: { dateTime: isoAt(tue.getTime() - 7 * 864e5, 10), timeZone: 'UTC' }, end: { dateTime: isoAt(tue.getTime() - 7 * 864e5, 11), timeZone: 'UTC' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'] });
  const client = fake.add('work@group', { summary: 'Client call', start: { dateTime: isoAt(today, 13), timeZone: 'UTC' }, end: { dateTime: isoAt(today, 14), timeZone: 'UTC' } });
  fake.add('holidays@group', { summary: 'Founders Day', start: { date: new Date(sunday.getTime() + 864e5 * 5).toISOString().slice(0, 10) }, end: { date: new Date(sunday.getTime() + 864e5 * 6).toISOString().slice(0, 10) }, organizer: { email: 'holidays', self: false }, creator: { email: 'holidays', self: false } });

  fake.add('old@group', { summary: 'Hidden calendar event', start: { dateTime: isoAt(today, 8), timeZone: 'UTC' }, end: { dateTime: isoAt(today, 8, 30), timeZone: 'UTC' } });
  for (let i = -365; i <= 30; i++) {
    const d = today.getTime() + i * 864e5;
    fake.add('work@group', { summary: 'Standup', start: { dateTime: isoAt(d, 6), timeZone: 'UTC' }, end: { dateTime: isoAt(d, 6, 15), timeZone: 'UTC' } });
  }
  const log = [];
  const { ctx, page } = await openApp(browser, gas, log, names);
  check(await passGate(page, PASS) === 'setup', 'first visit asks you to choose a passcode');
  await page.waitForTimeout(600);
  const html = await page.textContent('#view');
  check(/Team sync/.test(html) && /Client call/.test(html) && /Founders Day/.test(html), 'shows events from all three calendars');
  check(/me@example\.com/.test(await page.textContent('#sideFoot')), 'shows which Google account is linked');
  check(!(await page.isVisible('#demoBanner')), 'no demo banner');

  // scroll so the afternoon is on screen
  await page.evaluate(() => { document.querySelector('.tg-scroll').scrollTop = 9 * 52; });
  await page.waitForTimeout(150);
  const colIdx = dow;
  const yFor = async (min) => (await page.evaluate((i) => document.querySelector('.tg-col[data-idx="' + i + '"]').getBoundingClientRect().top, colIdx)) + min * 52 / 60;
  const colBox = await (await page.$('.tg-col[data-idx="' + colIdx + '"]')).boundingBox();

  // create
  await page.mouse.click(colBox.x + colBox.width / 2, await yFor(17 * 60 + 5));
  await page.waitForSelector('.pop.qc');
  await page.keyboard.type('Gym');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const gym = fake.state.events['me@example.com'].find((e) => e.summary === 'Gym');
  check(gym && gym.start.dateTime && gym.start.timeZone, 'click-to-create writes a timed event with a time zone to Google');
  check(gym && new Date(gym.start.dateTime).getUTCHours() === 17 && new Date(gym.end.dateTime) - new Date(gym.start.dateTime) === 3600e3, 'at the clicked hour, one hour long');
  await page.click('.fx-card').catch(() => {});

  // changes made in Google Calendar show up in the app
  const before = log.filter((l) => l[0] === 'pcSync').length;
  await page.waitForTimeout(1800);
  await page.keyboard.press('r');
  await page.waitForTimeout(600);
  const lastSync = log.filter((l) => l[0] === 'pcSync').slice(-1)[0];
  check(log.filter((l) => l[0] === 'pcSync').length > before, 'R checks Google again');
  check(lastSync && Object.values(JSON.parse(lastSync[1]).windows).every((w) => w.unchanged), 'nothing changed → Google sends only a hash (cheap 30-second checks)');
  fake.find('work@group', client.id).summary = 'Client call (moved by phone)';
  fake.add('me@example.com', { summary: 'Added on my phone', start: { dateTime: isoAt(today, 9), timeZone: 'UTC' }, end: { dateTime: isoAt(today, 10), timeZone: 'UTC' } });
  await page.keyboard.press('r');
  await page.waitForTimeout(700);
  const html2 = await page.textContent('#view');
  check(/Client call \(moved by phone\)/.test(html2) && /Added on my phone/.test(html2), 'edits and new events made in Google Calendar appear in the app');

  // drag in the app → patch in Google
  let el = await page.$('.ev:has-text("Client call")');
  let b = await el.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 30, { steps: 3 });
  await page.mouse.move(b.x + 20, b.y + 8 + 52, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const moved = fake.find('work@group', client.id);
  check(new Date(moved.start.dateTime).getUTCHours() === 14 && new Date(moved.end.dateTime).getUTCHours() === 15, 'dragging an event one hour later updates Google');

  // a whole repeating series, moved a day later from one occurrence
  el = await page.$('.ev:has-text("Team sync")');
  b = await el.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 30, b.y + 8, { steps: 2 });
  await page.mouse.move(b.x + 20 + colBox.width, b.y + 8, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector('.choice-box');
  await page.click('.choice:has-text("All events")');
  await page.waitForTimeout(800);
  const team = fake.state.events['me@example.com'].find((e) => e.summary === 'Team sync');
  check(team.recurrence[0] === 'RRULE:FREQ=WEEKLY;BYDAY=WE', 'series rule follows the move (weekly on Tuesday → Wednesday)');
  check(new Date(team.start.dateTime).getUTCDay() === 3 && new Date(team.start.dateTime).getUTCHours() === 10, 'series start moved by one day, same time');

  // one occurrence only
  await page.waitForTimeout(400);
  el = await page.$('.ev:has-text("Team sync")');
  b = await el.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 30, { steps: 2 });
  await page.mouse.move(b.x + 20, b.y + 8 + 104, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector('.choice-box');
  await page.click('.choice:has-text("Just this")');
  await page.waitForTimeout(800);
  const exIds = Object.keys(fake.state.exceptions).filter((k) => k.startsWith(team.id + '_'));
  check(exIds.length === 1 && new Date(fake.state.exceptions[exIds[0]].start.dateTime).getUTCHours() === 12, 'moving just one occurrence changes only that one');

  // switch an event to all-day in the editor (needs the null-clearing patch)
  el = await page.$('.ev:has-text("Gym")');
  await el.click();
  await page.waitForSelector('.pop');
  await page.keyboard.press('e');
  await page.waitForSelector('.editor');
  await page.click('.editor .check:has-text("All day")');
  await page.click('.editor .jag-btn.primary');
  await page.waitForTimeout(800);
  const gym2 = fake.state.events['me@example.com'].find((e) => e.summary === 'Gym');
  check(gym2.start.date && !gym2.start.dateTime && gym2.end.date, 'timed → all-day saves cleanly');

  // pick a colour, then go back to the calendar's colour
  await page.click('.bar:has-text("Gym")');
  await page.waitForSelector('.pop');
  await page.keyboard.press('e');
  await page.waitForSelector('.editor');
  await page.click('.editor .swatch[aria-label="Banana"]');
  await page.click('.editor .jag-btn.primary');
  await page.waitForTimeout(700);
  check(fake.state.events['me@example.com'].find((e) => e.summary === 'Gym').colorId === '5', 'event colour saved');
  await page.click('.bar:has-text("Gym")');
  await page.waitForSelector('.pop');
  await page.keyboard.press('e');
  await page.waitForSelector('.editor');
  await page.click('.editor .swatch[aria-label="Calendar colour"]');
  await page.click('.editor .jag-btn.primary');
  await page.waitForTimeout(700);
  check(!fake.state.events['me@example.com'].find((e) => e.summary === 'Gym').colorId, 'back to the calendar colour');

  // deadline flag is stored on the Google event
  await page.click('.bar:has-text("Gym")');
  await page.waitForSelector('.pop');
  await page.keyboard.press('e');
  await page.waitForSelector('.editor');
  await page.click('.editor .check:has-text("Palace Deadline")');
  await page.click('.editor .jag-btn.primary');
  await page.waitForTimeout(800);
  const gym3 = fake.state.events['me@example.com'].find((e) => e.summary === 'Gym');
  check(gym3.extendedProperties && gym3.extendedProperties.private.pcDeadline === '1', 'Palace Deadline is saved on the Google event');

  // move to another calendar
  await page.click('.ev:has-text("Client call")');
  await page.waitForSelector('.pop');
  await page.keyboard.press('e');
  await page.waitForSelector('.editor');
  await page.selectOption('.editor select[aria-label="Calendar"]', 'me@example.com');
  await page.click('.editor .jag-btn.primary');
  await page.waitForTimeout(800);
  check(fake.state.events['me@example.com'].some((e) => e.id === client.id) && !fake.state.events['work@group'].some((e) => e.id === client.id), 'changing the calendar moves the event in Google');

  // read-only calendar: no edit button, dragging does nothing
  const patchesBefore = fake.state.calls.filter((c) => c[0] === 'patch').length;
  const hol = await page.$('.bar:has-text("Founders Day")');
  b = await hol.boundingBox();
  await page.mouse.move(b.x + 10, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 10 + colBox.width, b.y + 8, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check(fake.state.calls.filter((c) => c[0] === 'patch').length === patchesBefore, 'read-only events can’t be dragged');
  await page.click('.bar:has-text("Founders Day")');
  await page.waitForSelector('.pop');
  check(!(await page.$('.pop [aria-label="Edit"]')) && /READ-ONLY/.test(await page.textContent('.pop')), 'read-only events show no edit button');
  await page.keyboard.press('Escape');

  // delete
  await page.click('.bar:has-text("Gym")');
  await page.waitForSelector('.pop');
  await page.click('.pop [aria-label="Delete"]');
  await page.click('.choice:has-text("Erase it")');
  await page.waitForTimeout(700);
  check(!fake.state.events['me@example.com'].some((e) => e.summary === 'Gym'), 'deleting removes it from Google');

  // a change Google refuses rolls back with a message
  fake.state.calendars.find((c) => c.id === 'me@example.com').accessRole = 'owner';
  const origPatch = fake.Calendar.Events.patch;
  fake.Calendar.Events.patch = () => { throw new Error('Rate Limit Exceeded'); };
  el = await page.$('.ev:has-text("Added on my phone")');
  b = await el.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 30, { steps: 3 });
  await page.mouse.move(b.x + 20, b.y + 8 + 52, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const toastTxt = await page.textContent('#toasts');
  const top = await page.$eval('.ev:has-text("Added on my phone")', (e) => e.style.top);
  check(/Rate Limit Exceeded/.test(toastTxt), 'Google’s error is shown to you');
  check(parseFloat(top) === 9 * 52, 'and the event snaps back to where it was');
  fake.Calendar.Events.patch = origPatch;

  // settings are remembered on the Google account
  await page.click('#settingsBtn');
  await page.click('.theme-card:has-text("SKULL")');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  check(props.phantomCalendarSettings && JSON.parse(props.phantomCalendarSettings).theme === 'skull', 'settings are saved to your Google account');

  // search goes through Google
  await page.keyboard.press('/');
  await page.keyboard.type('phone');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check(/Added on my phone/.test(await page.textContent('#view')), 'search asks Google and shows matches');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* ---------- fixes found in review ---------- */
  console.log('Edge cases:');
  check(!/Hidden calendar event/.test(await page.textContent('#view')) && await page.$('.cal.is-off:has-text("Old stuff")'), 'a calendar unticked in Google starts hidden here too');

  // search for something that happens every day still shows what's coming up
  check(/Standup/.test(await page.textContent('#view')), 'daily events are on screen before searching');
  await page.keyboard.press('/');
  await page.keyboard.type('Standup');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const futureHits = await page.evaluate(() => (App.search && App.search.results || []).filter((e) => e.start > new Date()).length);
  check(futureHits >= 25, 'searching a daily event shows the upcoming ones (' + futureHits + ' upcoming)');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Google fails to send one calendar: its events stay instead of vanishing
  const realList = fake.Calendar.Events.list;
  fake.Calendar.Events.list = (calId, p) => { if (calId === 'work@group') throw new Error('Rate Limit Exceeded'); return realList(calId, p); };
  const workBefore = await page.$$eval('.ev', (els) => els.filter((e) => /Standup|Client call/.test(e.textContent)).length);
  await page.keyboard.press('r');
  await page.waitForTimeout(800);
  const workAfter = await page.$$eval('.ev', (els) => els.filter((e) => /Standup|Client call/.test(e.textContent)).length);
  check(workBefore > 0 && workAfter === workBefore, 'when Google can\u2019t send a calendar, its events stay on screen (' + workBefore + ' → ' + workAfter + ')');
  check(/last copy/.test(await page.textContent('#toasts')), 'and you\u2019re told it\u2019s showing the last copy');
  fake.Calendar.Events.list = realList;

  // a calendar added in Google appears without reloading
  fake.state.calendars.push({ id: 'new@group', summary: 'Gym club', accessRole: 'owner', backgroundColor: '#0b8043', foregroundColor: '#ffffff', timeZone: 'UTC', selected: true });
  fake.state.events['new@group'] = [];
  fake.add('new@group', { summary: 'Leg day', start: { dateTime: isoAt(today, 7), timeZone: 'UTC' }, end: { dateTime: isoAt(today, 8), timeZone: 'UTC' } });
  await page.evaluate(() => refreshCalendars());
  await page.waitForTimeout(900);
  check(await page.$('.cal:has-text("Gym club")') && /Leg day/.test(await page.textContent('#view')), 'a calendar added in Google shows up with its events');

  // new events go to a calendar you can see
  await page.click('.cal:has-text("me@example.com")');
  await page.waitForTimeout(300);
  const target = await page.evaluate(() => defaultCalendarId());
  check(target !== 'me@example.com', 'with your main calendar hidden, new events go to a calendar that\u2019s shown (' + target + ')');
  await page.click('.cal:has-text("me@example.com")');
  await page.waitForTimeout(300);

  // labelled links in Google descriptions keep their address
  const dtext = await page.evaluate(() => descriptionText('Agenda<br><a href="https://example.com/meet">Join meeting</a>'));
  check(dtext === 'Agenda\nJoin meeting (https://example.com/meet)', 'a labelled link in a description keeps its address');

  // repeat rules move sensibly with a series
  check(gas.pcShiftRule_('RRULE:FREQ=MONTHLY;BYMONTHDAY=15', 1) === 'RRULE:FREQ=MONTHLY;BYMONTHDAY=16', 'monthly on day 15 → day 16');
  check(gas.pcShiftRule_('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 1) === 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '"every weekday" keeps its days');
  check(gas.pcShiftRule_('RRULE:FREQ=WEEKLY;BYDAY=SA', 1) === 'RRULE:FREQ=WEEKLY;BYDAY=SU', 'weekly on Saturday → Sunday');
  check(gas.pcShiftRule_('RRULE:FREQ=MONTHLY;BYMONTHDAY=28', 3) === 'RRULE:FREQ=MONTHLY;BYMONTHDAY=28', 'a day past the 28th is left alone');

  // broken saved settings never lock you out
  props.phantomCalendarSettings = '{"theme":"skull","calVis":{"a';
  const tk = JSON.parse(gas.pcUnlock(PASS)).token;
  const boot = JSON.parse(gas.pcBootstrap(tk));
  check(boot.settings === null && boot.calendars.length > 0, 'damaged saved settings are ignored instead of blocking the app');
  let tooBig = false;
  try { gas.pcSaveSettings(tk, JSON.stringify({ x: 'y'.repeat(9000) })); } catch (e) { tooBig = /too large/.test(e.message); }
  check(tooBig, 'oversized settings are refused rather than saved cut off');

  await ctx.close();

  /* ---------- passcode ---------- */
  console.log('Passcode lock:');
  const token = JSON.parse(gas.pcUnlock(PASS)).token;
  const refused = (fn) => { try { fn(); return false; } catch (e) { return /PC_AUTH/.test(e.message); } };
  check(refused(() => gas.pcSync('', JSON.stringify({ calendarIds: ['me@example.com'], windows: [] }))), 'calendar functions refuse calls with no key');
  check(refused(() => gas.pcBootstrap('made-up-key')) && refused(() => gas.pcCreateEvent('x', 'me@example.com', '{}')) &&
    refused(() => gas.pcDeleteEvent('x', 'me@example.com', 'ev1')) && refused(() => gas.pcUpdateEvent('x', 'me@example.com', 'ev1', '{}', '{}')) &&
    refused(() => gas.pcSearch('x', '{}')) && refused(() => gas.pcGetEvent('x', 'me@example.com', 'ev1')) &&
    refused(() => gas.pcCalendars('x')) && refused(() => gas.pcSaveSettings('x', '{}')) && refused(() => gas.pcChangePasscode('x', 'newpass1')),
  'every calendar function refuses a wrong key');
  check(!refused(() => gas.pcSync(token, JSON.stringify({ calendarIds: ['me@example.com'], windows: [] }))), 'the right key works');
  check(/already set/.test((() => { try { gas.pcSetPasscode('takeover1'); } catch (e) { return e.message; } return ''; })()), 'nobody can set a new passcode once one exists');
  check(JSON.stringify(scriptProps).indexOf(PASS) === -1, 'the passcode itself is never stored, only a salted hash');

  // a second device: wrong passcode, then the right one
  const dev2 = await openApp(browser, gas, null, names);
  await dev2.page.waitForSelector('#gatePass');
  check(!(await dev2.page.$('#gatePass2')), 'a new device asks for the existing passcode');
  await dev2.page.fill('#gatePass', 'not-it-123');
  await dev2.page.click('.gate-form button[type="submit"]');
  await dev2.page.waitForSelector('.gate .f-err:not([hidden])');
  check(/wrong/i.test(await dev2.page.textContent('.gate .f-err')), 'a wrong passcode is refused');
  check(await passGate(dev2.page, PASS) === 'unlock', 'the right passcode unlocks it');
  await dev2.page.reload();
  check(await passGate(dev2.page, PASS) === 'none', 'next time it opens straight away (device remembered)');

  // the passcode changes on another device: this one asks again, then carries on
  const newToken = JSON.parse(gas.pcChangePasscode(token, 'new-heist-99')).token;
  check(refused(() => gas.pcSync(token, JSON.stringify({ calendarIds: [], windows: [] }))) && !refused(() => gas.pcSync(newToken, JSON.stringify({ calendarIds: [], windows: [] }))), 'changing the passcode retires old keys');
  await dev2.page.keyboard.press('r');
  await dev2.page.waitForSelector('#gatePass', { timeout: 10000 });
  await dev2.page.fill('#gatePass', 'new-heist-99');
  await dev2.page.click('.gate-form button[type="submit"]');
  await dev2.page.waitForSelector('.gate', { state: 'detached', timeout: 10000 });
  await dev2.page.waitForTimeout(800);
  check(/Team sync|Client call/.test(await dev2.page.textContent('#view')), 'an open app asks for the new passcode and keeps going');
  await dev2.ctx.close();

  // too many wrong tries pause unlocking
  let msg = '';
  for (let i = 0; i < 8; i++) { try { gas.pcUnlock('guess-' + i); } catch (e) { msg = e.message; } }
  check(/PC_LOCKED/.test(msg), '8 wrong tries lock it for 15 minutes');
  check(/PC_LOCKED/.test((() => { try { gas.pcUnlock('new-heist-99'); } catch (e) { return e.message; } return ''; })()), 'even the right passcode waits out the lock');
  check(JSON.parse(gas.pcAuthState()).lockedForMs > 14 * 60000, 'the app can show how long to wait');

  // forgot it: only the owner, from the editor, can reset
  session.active = '';
  check(/Only the owner/.test((() => { try { gas.resetPasscode(); } catch (e) { return e.message; } return ''; })()), 'visitors can\u2019t reset the passcode');
  session.active = 'someone@else.com';
  check(/Only the owner/.test((() => { try { gas.resetPasscode(); } catch (e) { return e.message; } return ''; })()), 'other Google accounts can\u2019t either');
  session.active = 'me@example.com';
  gas.resetPasscode();
  check(JSON.parse(gas.pcAuthState()).hasPasscode === false && JSON.parse(gas.pcAuthState()).lockedForMs === 0, 'the owner can reset it from the editor');
  check(!(await (async () => { const d = await openApp(browser, gas, null, names); const r = await passGate(d.page, 'fresh-start-1'); await d.ctx.close(); return r !== 'setup'; })()), 'after a reset the app asks to choose a new one');

  // people who still have the older Code.gs keep working
  const oldSource = execFileSync('git', ['show', '1b5eaf7d84a6881126ab6dfdb8f080dca772ebd0:phantom-calendar/apps-script/Code.gs'], { cwd: path.join(__dirname, '..') }).toString();
  const legacy = loadCodeGs({ source: oldSource });
  legacy.fake.add('me@example.com', { summary: 'Old server event', start: { dateTime: isoAt(today, 11), timeZone: 'UTC' }, end: { dateTime: isoAt(today, 12), timeZone: 'UTC' } });
  const old = await openApp(browser, legacy.gas, null, legacy.names);
  check(await passGate(old.page, PASS) === 'none' && /Old server event/.test(await old.page.textContent('#view')), 'with the older Code.gs it still works (no passcode until you update)');
  await old.ctx.close();

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
