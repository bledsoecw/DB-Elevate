/**
 * The demonstration sign-in panel.
 *
 * This suite exists because the panel shipped broken and nothing caught it.
 * It renders only when ENABLE_DEV_LOGIN=true, and the development .env used
 * while building happened not to set that variable — so the first screen a new
 * reader of the README sees had never once been rendered. It threw "Element
 * type is invalid": DemoButton was attached to LoginForm as a static property,
 * and a server component importing from a 'use client' module gets a client
 * reference proxy rather than the function object, so the property was
 * undefined. TypeScript could not see it because the assignment made the
 * property look real.
 *
 * Run it against a server started with the flag on, since that is the whole
 * point:
 *
 *   ENABLE_DEV_LOGIN=true npx next dev --turbopack -p 3100
 *   node tests/browser/devlogin-test.js http://localhost:3100
 */
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:3100';
const results = [];
function check(n, ok, d) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(BASE + '/login', { waitUntil: 'load' });
  check('Login page renders with the demo panel enabled', (await page.locator('text=Demonstration accounts').count()) > 0);

  const buttons = await page.locator('button:has-text("Raghunathan"), button:has-text("Okafor"), button:has-text("Delgado")').count();
  check('Demo account buttons are present', buttons >= 3, `${buttons} of the expected accounts`);

  const panelText = await page.locator('text=does not bypass authentication').count();
  check('Panel states it does not bypass authentication', panelText > 0);

  // The button must perform a real sign-in.
  const posted = [];
  page.on('request', (r) => { if (r.url().includes('/api/auth/login')) posted.push(r.postData() || ''); });

  await page.locator('button:has-text("Raghunathan")').first().click();
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 25000 });
  await page.waitForSelector('[data-hydrated="true"]');
  check('Clicking a demo account signs in', !page.url().includes('/login'), `landed on ${new URL(page.url()).pathname}`);

  check('It posted a real password to the real endpoint', posted.length === 1 && /password/.test(posted[0]),
    posted[0] ? posted[0].replace(/"password":"[^"]*"/, '"password":"<redacted>"') : 'no request seen');

  const who = await page.locator('h1').first().textContent();
  check('Signed in as the chosen person', /Priya/i.test(who || ''), (who || '').trim());

  // A second account, to prove the list is not just one working button.
  await ctx.clearCookies();
  await page.goto(BASE + '/login', { waitUntil: 'load' });
  await page.locator('button:has-text("Okafor")').first().click();
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 25000 });
  await page.waitForSelector('[data-hydrated="true"]');
  const who2 = await page.locator('h1').first().textContent();
  check('A second demo account also signs in', /Terrence/i.test(who2 || ''), (who2 || '').trim());

  console.log('\nerrors:', errors.length ? [...new Set(errors)].join(' | ') : '(none)');
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(2); });
