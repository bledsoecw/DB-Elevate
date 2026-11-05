/**
 * Competency profile visibility.
 *
 * A competency rating is review content, so it follows the review rules rather
 * than the directory rules: seeing that someone exists is not seeing how they
 * were rated. The case worth protecting is the system administrator, who can
 * reset everyone's password and must still not be able to read this.
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const PW = 'ElevateDemo!2026';
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  async function signIn(email) {
    await ctx.clearCookies();
    await page.goto(BASE + '/login', { waitUntil: 'load' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    for (let i = 0; i < 4; i++) {
      await page.click('button[type="submit"]');
      try { await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 15000 }); break; } catch {}
    }
    await page.waitForSelector('[data-hydrated="true"]');
  }
  // Find a person outside Yuki's line: Rosa's report Jamal.
  await signIn('priya.raghunathan@deitemeyerbrothers.example');
  const jamal = await page.evaluate(async () => {
    const res = await fetch('/people?q=Freeman', { credentials: 'same-origin' });
    const html = await res.text();
    const m = html.match(/\/people\/([a-z0-9]{20,})/);
    return m ? m[1] : null;
  });
  check('Found a subject outside the test user line', Boolean(jamal), jamal ?? 'none');

  await signIn('yuki.tanabe@deitemeyerbrothers.example');
  await page.goto(`${BASE}/competencies?employee=${jamal}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const body = await page.locator('body').innerText();
  check('An employee cannot open a colleague’s competency profile',
    !/Freeman/.test(body), body.slice(0, 60).replace(/\n/g, ' '));

  await page.goto(BASE + '/competencies/team', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  check('An employee with no reports is redirected from the team grid',
    !page.url().includes('/competencies/team'), new URL(page.url()).pathname);

  // Own profile works.
  await page.goto(BASE + '/competencies', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main-content');
  const own = await page.locator('h1').first().textContent();
  check('An employee can open their own profile', /Competencies/.test(own || ''), (own || '').trim());

  // Manager can see a direct report, HR can see anyone.
  await signIn('rosa.delgado@deitemeyerbrothers.example');
  await page.goto(`${BASE}/competencies?employee=${jamal}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  check('A manager can open a direct report’s profile',
    /Freeman/.test(await page.locator('body').innerText()));

  await signIn('terrence.okafor@deitemeyerbrothers.example');
  await page.goto(`${BASE}/competencies?employee=${jamal}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  check('A system administrator cannot open it (review content)',
    !/Freeman/.test(await page.locator('body').innerText()));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(2); });
