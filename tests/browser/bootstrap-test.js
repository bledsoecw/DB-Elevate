/**
 * First run on an empty organization.
 *
 * This is the state a real customer is in for their first hour, and nothing
 * else here covers it — every other suite runs against the seeded
 * demonstration data. Before `scripts/create-admin.ts` existed there was no
 * way to reach this state at all: every account-creating route needs an
 * authorized actor, and on an empty database none can exist, so a real
 * organization was locked out of its own installation.
 *
 *   DATABASE_URL="file:/tmp/blank.db" npx prisma migrate deploy
 *   DATABASE_URL="file:/tmp/blank.db" npm run create-admin -- \
 *     --email you@example.com --name "Ada Lovelace" --org "Your Company"
 *   DATABASE_URL="file:/tmp/blank.db" npx next dev --turbopack -p 3300 &
 *   node tests/browser/bootstrap-test.js http://localhost:3300 you@example.com '<password>'
 */
const { chromium } = require('playwright');
const BASE = process.argv[2];
const EMAIL = process.argv[3];
const PASSWORD = process.argv[4];
const results = [];
function check(n, ok, d) { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(40000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(BASE + '/login', { waitUntil: 'load' });
  const stillSaysEmpty = await page.locator('text=No accounts exist yet').count();
  check('The "no accounts" banner is gone once an admin exists', stillSaysEmpty === 0);

  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  for (let i = 0; i < 4; i++) {
    await page.click('button[type="submit"]');
    try { await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 20000 }); break; } catch {}
  }
  check('The bootstrapped administrator can sign in', !page.url().includes('/login'),
    `landed on ${new URL(page.url()).pathname}`);

  // Every main screen must survive having no data at all — this is the state a
  // real organization is in for its first hour.
  const routes = ['/', '/tasks', '/people', '/reviews', '/goals', '/feedback', '/meetings',
                  '/surveys', '/reports', '/development', '/account', '/admin',
                  '/admin/system', '/admin/accounts', '/admin/competencies', '/admin/scales',
                  '/admin/calibration', '/admin/audit', '/admin/outbox', '/admin/demo-data',
                  '/admin/exceptions', '/admin/templates', '/reviews/cycles', '/people/import'];
  const broken = [];
  for (const r of routes) {
    const res = await page.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#main-content', { timeout: 30000 }).catch(() => {});
    const status = res ? res.status() : 0;
    const landed = new URL(page.url()).pathname;
    if (status >= 400) broken.push(`${r} -> HTTP ${status}`);
    else if (landed !== r && !landed.startsWith(r)) broken.push(`${r} -> redirected to ${landed}`);
  }
  check('Every screen works on an empty organization', broken.length === 0,
    broken.length ? broken.join('; ') : `${routes.length} routes`);

  // The CSV import is the documented way to get real people in, so it has to
  // be reachable and offer a template on day one.
  await page.goto(BASE + '/people/import');
  await page.waitForSelector('#main-content');
  const fileInputs = await page.locator('input[type="file"]').count();
  const templateOffered = await page.getByText(/template/i).count();
  check('CSV import is reachable with no data present', fileInputs > 0 || templateOffered > 0,
    `${fileInputs} file input(s), ${templateOffered} mention(s) of a template`);

  console.log('\nerrors:', errors.length ? [...new Set(errors)].join(' | ') : '(none)');
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(2); });
