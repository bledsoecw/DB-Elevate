const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const PASSWORD = 'ElevateDemo!2026';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.split('\n')[0]));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  async function signIn(email) {
    await ctx.clearCookies();
    await page.goto(BASE + '/login', { waitUntil: 'load' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    for (let i = 0; i < 4; i++) {
      await page.click('button[type="submit"]');
      try { await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 15000 }); break; } catch {}
    }
    await page.waitForSelector('[data-hydrated="true"]');
  }

  await signIn('priya.raghunathan@deitemeyerbrothers.example');
  await page.goto(BASE + '/admin/calibration');
  await page.waitForSelector('[data-hydrated="true"]');

  const canOpen = !(await page.locator('button:has-text("New session")').isDisabled());
  check('A cycle is available to calibrate', canOpen);
  if (!canOpen) {
    console.log('\nNothing calibratable in the seed; cannot exercise the flow.');
    await browser.close();
    process.exit(1);
  }

  // --- Open a session -----------------------------------------------------
  await page.click('button:has-text("New session")');
  await page.waitForSelector('text=Open a calibration session');
  const sessionName = `Calibration test ${Date.now().toString().slice(-6)}`;
  await page.getByLabel(/Session name/).fill(sessionName);
  await page.click('button:has-text("Open session")');
  await page.waitForFunction(() => /\/admin\/calibration\/[^/]+$/.test(location.pathname), undefined, { timeout: 25000 });
  await page.waitForSelector('[data-hydrated="true"]');
  const sessionUrl = page.url();
  const sessionId = sessionUrl.split('/').pop();
  check('Session opened and landed on its page', Boolean(sessionId));

  const rowCount = await page.locator('tbody.divide-y tr').count();
  check('Session seeded with participants', rowCount > 0, `${rowCount} rows`);

  // Finalise must be blocked while decisions are outstanding.
  const finaliseBlocked = await page.locator('button:has-text("Finalise session")').isDisabled();
  check('Finalise is blocked while decisions are outstanding', finaliseBlocked);

  const apiFinaliseEarly = await page.evaluate(async (id) => {
    const res = await fetch(`/api/admin/calibration/${id}/finalize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({}),
    });
    return { status: res.status, message: (await res.json())?.error?.message ?? '' };
  }, sessionId);
  check('API refuses to finalise with undecided participants', apiFinaliseEarly.status === 409,
    `HTTP ${apiFinaliseEarly.status}`);

  // --- A decision requires a reason ---------------------------------------
  await page.locator('button:has-text("Decide")').first().click();
  await page.waitForSelector('text=Decided score');
  const recordDisabled = await page.locator('button:has-text("Record decision")').isDisabled();
  check('Record is blocked with no reason written', recordDisabled);

  const apiNoReason = await page.evaluate(async (id) => {
    const pid = document.querySelector('a[href^="/reviews/participants/"]')?.getAttribute('href')?.split('/').pop();
    const res = await fetch(`/api/admin/calibration/${id}/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ participantId: pid, finalScore: 95, rationale: 'short' }),
    });
    return { status: res.status, code: (await res.json())?.error?.code };
  }, sessionId);
  check('API refuses a decision with too short a reason', apiNoReason.status === 422,
    `HTTP ${apiNoReason.status} ${apiNoReason.code ?? ''}`);

  // --- Record an adjustment ------------------------------------------------
  const scoreBox = page.getByLabel(/Decided score/);
  const calculated = await scoreBox.inputValue();
  await scoreBox.fill('77.5');
  const warnShown = await page.locator('text=will show both figures').count();
  check('Changing the score warns that both figures are shown', warnShown > 0);
  await page.getByLabel(/^Reason/).fill('Rated harshly relative to the rest of the crew for the same scope of work.');
  await page.getByRole('dialog').getByRole('button', { name: /Record decision/ }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Decided score'), undefined, { timeout: 25000 });
  await page.waitForTimeout(1200);

  const adjustedShown = await page.locator('tbody.divide-y').innerText();
  check('Adjustment is shown with its before value', adjustedShown.includes('77.5') && /was\s/.test(adjustedShown),
    `calculated was ${calculated}`);
  check('Reason is shown in the grid', adjustedShown.includes('Rated harshly relative'));

  // The participant record must carry it, visible on the review itself.
  const participantHref = await page.locator('a[href^="/reviews/participants/"]').first().getAttribute('href');
  const applied = await page.evaluate(async (href) => {
    const res = await fetch(href, { credentials: 'same-origin' });
    const html = await res.text();
    return { ok: res.ok, mentionsAdjustment: /77\.5|calibrat/i.test(html) };
  }, participantHref);
  check('Adjustment reaches the participant record', applied.ok && applied.mentionsAdjustment);

  // --- Record "unchanged" for everyone else --------------------------------
  async function decisionsRecorded() {
    await page.reload();
    await page.waitForSelector('[data-hydrated="true"]');
    const tile = await page.locator('text=Decisions recorded').first().locator('xpath=..').innerText();
    const m = tile.match(/(\d+)\s*of\s*(\d+)/);
    return m ? { done: Number(m[1]), total: Number(m[2]) } : { done: -1, total: -1 };
  }

  let guard = 0;
  let state = await decisionsRecorded();
  check('The page reports decisions against a stated denominator',
    state.total === rowCount, `${state.done} of ${state.total}, ${rowCount} rows`);

  while (state.done < state.total && guard < 40) {
    guard += 1;
    await page.locator('button:has-text("Decide")').first().click();
    await page.waitForSelector('text=Decided score');
    const unchangedNotice = await page.locator('text=reviewed and left alone').count();
    if (guard === 1) {
      check('Leaving the score alone is described as a recorded decision', unchangedNotice > 0);
    }
    await page.getByLabel(/^Reason/).fill('Discussed; consistent with peers at this level, no change.');
    await page.getByRole('dialog').getByRole('button', { name: /Record decision/ }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Decided score'), undefined, { timeout: 25000 });
    state = await decisionsRecorded();
  }
  check('Every participant now has a recorded decision',
    state.done === state.total && state.total === rowCount,
    `${state.done} of ${state.total} after ${guard} rounds`);

  // --- Revert works --------------------------------------------------------
  await page.locator('button:has-text("Recorded")').first().click();
  await page.waitForSelector('text=Decided score');
  await page.getByRole('dialog').getByRole('button', { name: /Clear decision/ }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Decided score'), undefined, { timeout: 25000 });
  const reverted = await decisionsRecorded();
  check('Clearing a decision puts the participant back in the queue',
    reverted.done === rowCount - 1, `${reverted.done} of ${reverted.total}`);

  // Re-record it so the session can be finalised.
  await page.locator('button:has-text("Decide")').first().click();
  await page.waitForSelector('text=Decided score');
  await page.getByLabel(/^Reason/).fill('Re-reviewed after the revert; score stands as calculated.');
  await page.getByRole('dialog').getByRole('button', { name: /Record decision/ }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Decided score'), undefined, { timeout: 25000 });
  await decisionsRecorded();

  // --- Finalise ------------------------------------------------------------
  await page.reload();
  await page.waitForSelector('[data-hydrated="true"]');
  const finaliseNowEnabled = !(await page.locator('button:has-text("Finalise session")').isDisabled());
  check('Finalise is enabled once every decision is recorded', finaliseNowEnabled);
  await page.click('button:has-text("Finalise session")');
  await page.waitForSelector('text=Finalise this session?');
  const noReleaseClaim = await page.locator('text=does not release anything').count();
  check('Finalise dialog states it does not release anything', noReleaseClaim > 0);
  await page.getByRole('dialog').getByRole('button', { name: 'Finalise', exact: true }).click();
  await page.waitForSelector('text=This session is closed', { timeout: 25000 });
  check('Session finalised and marked closed', true);

  const noDecideButtons = await page.locator('button:has-text("Decide")').count();
  check('A finalised session exposes no edit controls', noDecideButtons === 0);

  const apiAfterFinal = await page.evaluate(async (args) => {
    const res = await fetch(`/api/admin/calibration/${args.id}/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ participantId: args.pid, finalScore: 10, rationale: 'Trying to rewrite a closed session.' }),
    });
    return { status: res.status, code: (await res.json())?.error?.code };
  }, { id: sessionId, pid: participantHref.split('/').pop() });
  check('API refuses to change a finalised session', apiAfterFinal.status === 409,
    `HTTP ${apiAfterFinal.status} ${apiAfterFinal.code ?? ''}`);

  // --- Permissions ---------------------------------------------------------
  await signIn('terrence.okafor@deitemeyerbrothers.example');
  await page.goto(BASE + '/admin/calibration');
  await page.waitForSelector('[data-hydrated="true"]');
  check('System admin cannot reach calibration', !page.url().includes('/admin/calibration'),
    `landed on ${new URL(page.url()).pathname}`);

  await signIn('rosa.delgado@deitemeyerbrothers.example');
  const mgrApi = await page.evaluate(async (args) => {
    const res = await fetch(`/api/admin/calibration/${args.id}/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ participantId: args.pid, finalScore: 99, rationale: 'A manager should not be able to do this.' }),
    });
    return res.status;
  }, { id: sessionId, pid: participantHref.split('/').pop() });
  check('A manager cannot record a calibration decision', mgrApi === 403, `HTTP ${mgrApi}`);

  const mgrCreate = await page.evaluate(async () => {
    const res = await fetch('/api/admin/calibration', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ cycleId: 'x', name: 'Manager session' }),
    });
    return res.status;
  });
  check('A manager cannot open a calibration session', mgrCreate === 403, `HTTP ${mgrCreate}`);

  console.log('\n--- console/server errors ---');
  console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`session: ${sessionUrl}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(2); });
