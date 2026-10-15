// Tests apps-script/loader/Index.html: it must run only the exact app build it is
// pinned to (checked by SHA-256), from GitHub or the jsDelivr mirror, against Google
// (here: the real Code.gs on the fake Calendar), refuse anything tampered with, and
// work offline from a checked copy. Run: node tests/loader.test.js
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { loadCodeGs } = require('./fake-google');
const { installBridge, passGate } = require('./gas-bridge');

const LOADER_PATH = path.join(__dirname, '..', 'apps-script', 'loader', 'Index.html');
const LOADER = 'file://' + LOADER_PATH;
const loaderSrc = fs.readFileSync(LOADER_PATH, 'utf8');
const PIN = loaderSrc.match(/var PIN = '([0-9a-f]{40})'/)[1];
const PINNED = execFileSync('git', ['show', PIN + ':phantom-calendar/apps-script/Index.html'], { cwd: path.join(__dirname, '..') });
const TAMPERED = Buffer.from(PINNED.toString('utf8').replace('<body>', '<body><script>window.__evil = true;</script>'));
let failures = 0;
const check = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.log('  FAIL ' + m); } };

(async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const { gas, fake, names } = loadCodeGs();
  const now = new Date();
  fake.add('me@example.com', { summary: 'Loader test event', start: { dateTime: new Date(now.getTime() + 3600e3).toISOString(), timeZone: 'UTC' }, end: { dateTime: new Date(now.getTime() + 7200e3).toISOString(), timeZone: 'UTC' } });
  await installBridge(ctx, gas, names);

  let mode = 'ok';
  const hits = [];
  const serve = (route, body) => route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body });
  const handler = (route) => {
    const url = route.request().url();
    hits.push(url);
    const raw = url.startsWith('https://raw.githubusercontent.com/');
    if (!url.includes(PIN)) return route.fulfill({ status: 404, body: 'not pinned' });
    if (mode === 'offline') return route.abort();
    if (mode === 'ok') return raw ? serve(route, PINNED) : route.fulfill({ status: 500, body: 'unused' });
    if (mode === 'raw-down') return raw ? route.fulfill({ status: 503, body: 'down' }) : serve(route, PINNED);
    if (mode === 'tampered') return serve(route, TAMPERED);
    return route.abort();
  };
  await ctx.route('https://raw.githubusercontent.com/**', handler);
  await ctx.route('https://cdn.jsdelivr.net/**', handler);

  const open = async () => {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(LOADER);
    return { page, errs };
  };

  console.log('Loader (pinned to ' + PIN.slice(0, 7) + '):');
  let { page, errs } = await open();
  check(await passGate(page, 'loader-pass-1') === 'setup', 'downloads the pinned build and asks for a passcode the first time');
  await page.waitForTimeout(500);
  check(/Loader test event/.test(await page.textContent('#view')), 'shows Google events');
  await page.keyboard.press('c');
  await page.waitForSelector('.editor');
  await page.keyboard.type('Made through the loader');
  await page.click('.editor .jag-btn.primary');
  await page.waitForTimeout(800);
  check(fake.state.events['me@example.com'].some((e) => e.summary === 'Made through the loader'), 'creating an event writes to Google');
  check(hits.every((u) => u.includes(PIN)), 'only ever asks for the pinned commit, never a branch');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await page.close();

  mode = 'raw-down';
  ({ page } = await open());
  check(await passGate(page, 'loader-pass-1') !== null && await page.isVisible('#app'), 'if GitHub is down, the jsDelivr mirror of the same commit works');
  await page.close();

  mode = 'tampered';
  ({ page } = await open());
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  check(!(await page.evaluate(() => window.__evil)), 'a tampered download is refused (its code never runs)…');
  check(true, '…and the checked copy saved earlier is used instead');
  await page.close();

  mode = 'offline';
  ({ page } = await open());
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  check(true, 'offline: opens from the checked copy saved last time');
  await page.close();

  // a tampered saved copy is refused too
  ({ page } = await open());
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  await page.evaluate((html) => localStorage.setItem('phantom-calendar-app-checked', html), TAMPERED.toString('utf8'));
  await page.reload();
  await page.waitForFunction(() => /Couldn/.test((document.getElementById('pclMsg') || {}).textContent || ''), null, { timeout: 15000 });
  check(!(await page.evaluate(() => window.__evil)), 'a tampered saved copy is refused');
  await page.close();

  const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
  await ctx2.route('https://raw.githubusercontent.com/**', (r) => r.abort());
  await ctx2.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  const p2 = await ctx2.newPage();
  await p2.goto(LOADER);
  await p2.waitForFunction(() => /Couldn/.test(document.getElementById('pclMsg').textContent), null, { timeout: 15000 });
  check(true, 'offline with no saved copy: says to check the connection');

  await browser.close();
  console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
