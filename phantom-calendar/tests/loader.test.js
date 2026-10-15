// Tests apps-script/loader/Index.html: it must download the full app from GitHub and
// run it against Google (here: the real Code.gs on the fake Calendar), fall back when
// the branch is gone, and work offline from its saved copy.
// Run: node tests/loader.test.js
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadCodeGs } = require('./fake-google');
const { installBridge, passGate } = require('./gas-bridge');

const LOADER = 'file://' + path.join(__dirname, '..', 'apps-script', 'loader', 'Index.html');
const BUNDLE = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Index.html'), 'utf8');
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

  let mode = 'branch';
  const hits = [];
  await ctx.route('https://raw.githubusercontent.com/**', (route) => {
    const url = route.request().url();
    hits.push(url);
    const ok = (mode === 'branch' && url.includes('/claude/epic-thompson-258mz9/')) ||
      (mode === 'pinned' && /\/[0-9a-f]{40}\//.test(url));
    if (mode === 'offline') return route.abort();
    return ok ? route.fulfill({ status: 200, contentType: 'text/plain', body: BUNDLE }) : route.fulfill({ status: 404, body: '404: Not Found' });
  });

  const open = async (label) => {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(LOADER);
    return { page, errs, label };
  };

  console.log('Loader:');
  let { page, errs } = await open('branch');
  check(await passGate(page, 'loader-pass-1') === 'setup', 'asks for a passcode the first time');
  await page.waitForTimeout(500);
  check(/Loader test event/.test(await page.textContent('#view')), 'downloads the app from the branch and shows Google events');
  check(!(await page.isVisible('#demoBanner')), 'runs linked to Google (not demo mode)');
  await page.keyboard.press('c');
  await page.waitForSelector('.editor');
  await page.keyboard.type('Made through the loader');
  await page.click('.editor .jag-btn.primary');
  await page.waitForTimeout(800);
  check(fake.state.events['me@example.com'].some((e) => e.summary === 'Made through the loader'), 'creating an event writes to Google');
  check(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await page.close();

  mode = 'pinned';
  hits.length = 0;
  ({ page, errs } = await open('pinned'));
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  check(hits.length === 3 && /[0-9a-f]{40}/.test(hits[2]), 'if the branch and main are gone, it uses the fixed commit');
  await page.close();

  mode = 'offline';
  ({ page, errs } = await open('offline'));
  await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  check(true, 'offline: opens from the copy saved last time');
  await page.close();

  const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
  await ctx2.route('https://raw.githubusercontent.com/**', (route) => route.abort());
  const p2 = await ctx2.newPage();
  await p2.goto(LOADER);
  await p2.waitForFunction(() => /Couldn/.test(document.getElementById('pclMsg').textContent), null, { timeout: 15000 });
  check(true, 'offline with no saved copy: says to check the connection');

  await browser.close();
  console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
