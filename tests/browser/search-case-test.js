/**
 * Search is case-insensitive, on whichever database is underneath.
 *
 * This exists because of a difference between SQLite and PostgreSQL that
 * produces no error at all:
 *
 *   SQLite      LIKE is case-insensitive for ASCII  -> "rosa" finds "Rosa"
 *   PostgreSQL  LIKE is case-sensitive              -> "rosa" finds nothing
 *
 * Every search box in the application would have quietly stopped matching
 * anything the user did not capitalise exactly, and only in production. The
 * fix is `mode: 'insensitive'` (see src/server/search.ts); this is the test
 * that would have caught it, and the one that stops it coming back.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const PW = process.env.SEED_PASSWORD || 'ElevateDemo!2026';

const results = [];
const check = (n, ok, d) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);

  async function signIn(email) {
    await ctx.clearCookies();
    await page.goto(BASE + '/login', { waitUntil: 'load' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    for (let i = 0; i < 4; i++) {
      await page.click('button[type="submit"]');
      try {
        await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, {
          timeout: 15000,
        });
        break;
      } catch {}
    }
    await page.waitForSelector('[data-hydrated="true"]');
  }

  async function search(path, q) {
    await page.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}${q}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#main-content');
    await page.waitForTimeout(400);
    return page.locator('#main-content').innerText();
  }

  // --- The employee directory -------------------------------------------
  await signIn('priya.raghunathan@deitemeyerbrothers.example');
  for (const term of ['Delgado', 'delgado', 'DELGADO', 'DeLgAdO']) {
    const text = await search('/people', `q=${term}`);
    check(`Directory finds "Rosa Delgado" searching "${term}"`, /Delgado/.test(text));
  }
  const firstName = await search('/people', 'q=ROSA');
  check('Directory matches a first name regardless of case', /Delgado/.test(firstName));

  const noMatch = await search('/people', 'q=zzzznobodyzzzz');
  check(
    'A term that matches nobody still returns nothing',
    !/Delgado/.test(noMatch),
    'guards against a filter that matches everything',
  );

  // --- Accounts, which search a different set of columns ----------------
  await signIn('terrence.okafor@deitemeyerbrothers.example');
  const accounts = await search('/admin/accounts', 'q=GLORIA');
  check('Accounts search matches a name in the wrong case', /Mbeki/i.test(accounts));
  const byEmail = await search('/admin/accounts', 'q=GLORIA.MBEKI');
  check('Accounts search matches an address in the wrong case', /Mbeki/i.test(byEmail));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS FAILED:', e.message);
  process.exit(2);
});
