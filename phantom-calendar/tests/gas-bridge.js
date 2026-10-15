// Puts a stand-in for google.script.run into a test page. Like the real thing,
// it only offers the server's public functions (names not ending in "_"), and
// forwards each call to the Code.gs running in Node (tests/fake-google.js).
async function installBridge(ctx, gas, names, log) {
  await ctx.exposeFunction('__gas', (name, argsJson) => {
    try {
      const value = gas[name](...JSON.parse(argsJson));
      if (log) log.push([name, value]);
      return JSON.stringify({ value });
    } catch (e) {
      return JSON.stringify({ error: String(e.message || e) });
    }
  });
  await ctx.addInitScript((serverNames) => {
    function runner() {
      let ok = () => {}, fail = () => {};
      const r = {
        withSuccessHandler(f) { ok = f; return r; },
        withFailureHandler(f) { fail = f; return r; }
      };
      serverNames.forEach((name) => {
        r[name] = (...args) => {
          window.__gas(name, JSON.stringify(args)).then((res) => {
            const o = JSON.parse(res);
            if ('error' in o) fail(new Error(o.error)); else ok(o.value);
          });
        };
      });
      return r;
    }
    window.google = { script: { get run() { return runner(); } } };
  }, names);
}

/** Gets past the passcode screen if it shows. */
async function passGate(page, passcode) {
  const which = await Promise.race([
    page.waitForSelector('#app:not([hidden])', { timeout: 20000 }).then(() => 'app'),
    page.waitForSelector('#gatePass', { timeout: 20000 }).then(() => 'gate')
  ]);
  if (which === 'app') return 'none';
  const setup = !!(await page.$('#gatePass2'));
  await page.fill('#gatePass', passcode);
  if (setup) await page.fill('#gatePass2', passcode);
  await page.click('.gate-form button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  return setup ? 'setup' : 'unlock';
}

module.exports = { installBridge, passGate };
