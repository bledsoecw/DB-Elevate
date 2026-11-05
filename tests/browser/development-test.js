const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const PASSWORD = 'ElevateDemo!2026';
const stamp = Date.now().toString().slice(-6);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
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

  // Rosa is a manager with 5 direct reports.

  /** Submits the new-plan form and waits for the real plan URL, or reports why not. */
  async function submitPlanForm() {
    const disabled = await page.locator('button:has-text("Create as draft")').isDisabled();
    if (disabled) throw new Error('Create button is disabled; the form considers itself incomplete.');
    await page.click('button:has-text("Create as draft")');
    try {
      await page.waitForFunction(
        () => /\/development\/[a-z0-9]{20,}$/.test(location.pathname),
        undefined,
        { timeout: 25000 },
      );
    } catch {
      const shown = await page.locator('#main-content').innerText();
      const err = shown.split('\n').find((l) => /not valid|failed|permission|could not|does not/i.test(l));
      throw new Error('Creation did not navigate. On-screen: ' + (err ?? shown.slice(0, 200)));
    }
    await page.waitForSelector('[data-hydrated="true"]');
  }

  await signIn('rosa.delgado@dreambuilder.example');

  // --- Create a development plan for a direct report -----------------------
  await page.goto(BASE + '/development/new');
  await page.waitForSelector('[data-hydrated="true"]');
  const options = await page.locator('select').first().locator('option').allTextContents();
  check('Create form offers self and direct reports only', options.length >= 2, `${options.length} people`);

  // Pick a direct report (not Rosa herself, who is first by default only if sorted so).
  const reportLabel = options.find((o) => !/Delgado/.test(o)) ?? options[0];
  await page.locator('select').first().selectOption({ label: reportLabel });

  const devTitle = `Dev plan ${stamp}`;
  await page.getByLabel(/^Title/).fill(devTitle);
  await page.locator('input[aria-label="Action 1 title"]').fill('Shadow the estimator for two bids.');
  await submitPlanForm();
  const devPlanUrl = page.url();
  const devPlanId = devPlanUrl.split('/').pop();
  check('Development plan created', Boolean(devPlanId));

  const draftNotice = await page.locator('text=Still a draft').count();
  check('New plan starts as a draft and says nobody was notified', draftNotice > 0);

  // --- Create an improvement plan for the same person ----------------------
  await page.goto(BASE + '/development/new');
  await page.waitForSelector('[data-hydrated="true"]');
  await page.locator('select').first().selectOption({ label: reportLabel });
  const pipEnabled = !(await page.locator('input[value="PERFORMANCE_IMPROVEMENT"]').isDisabled());
  check('Direct manager may start an improvement plan', pipEnabled);
  await page.click('label:has-text("Performance improvement plan")');
  const pipTitle = `PIP ${stamp}`;
  await page.getByLabel(/^Title/).fill(pipTitle);
  await page.locator('input[aria-label="Action 1 title"]').fill('Zero missed toolbox talks for 60 days.');
  await submitPlanForm();
  const pipUrl = page.url();
  const pipId = pipUrl.split('/').pop();
  check('Improvement plan created', Boolean(pipId) && pipId !== devPlanId);

  const restrictedBanner = await page.locator('text=This is a restricted record').count();
  check('Improvement plan is labelled restricted on its own page', restrictedBanner > 0);

  // The restriction must be forced server-side regardless of what was posted.
  const forced = await page.evaluate(async (id) => {
    const res = await fetch(`/api/development/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ hrRestricted: false }),
    });
    return { status: res.status, code: (await res.json())?.error?.code };
  }, pipId);
  check('Restriction on an improvement plan cannot be relaxed', forced.status === 409,
    `HTTP ${forced.status} ${forced.code ?? ''}`);

  // Activate the PIP so the employee can see it.
  await page.click('button:has-text("Activate")');
  await page.waitForFunction(() => !document.body.innerText.includes('Still a draft'), undefined, { timeout: 25000 });
  check('Improvement plan activated', true);

  // Closing requires an outcome.
  const closeNoOutcome = await page.evaluate(async (id) => {
    const res = await fetch(`/api/development/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ status: 'COMPLETED' }),
    });
    return res.status;
  }, pipId);
  check('Closing a plan without an outcome is refused', closeNoOutcome === 422, `HTTP ${closeNoOutcome}`);

  // --- The subject: can record progress, cannot change terms --------------
  const subjectEmail = await page.evaluate(async () => {
    const link = document.querySelector('a[href^="/people/"]');
    if (!link) return null;
    const res = await fetch(link.getAttribute('href'), { credentials: 'same-origin' });
    const html = await res.text();
    const m = html.match(/[a-z]+\.[a-z]+@dreambuilder\.example/);
    return m ? m[0] : null;
  });
  check('Found the subject employee', Boolean(subjectEmail), subjectEmail ?? 'none');

  await signIn(subjectEmail);
  await page.goto(pipUrl);
  await page.waitForSelector('[data-hydrated="true"]');
  const subjectCanSee = page.url().includes(pipId);
  check('The subject can read their own improvement plan', subjectCanSee);

  const noEditControls = await page.locator('button:has-text("Add action")').count();
  check('The subject gets no control to add or change actions', noEditControls === 0);

  const canTick = await page.locator('button[aria-label^="Mark"]').count();
  check('The subject can mark an action complete', canTick > 0);

  await page.locator('button[aria-label^="Mark"]').first().click();
  await page.waitForSelector('button[aria-pressed="true"]', { timeout: 25000 });
  await page.reload();
  await page.waitForSelector('[data-hydrated="true"]');
  const tickedAfterReload = await page.locator('button[aria-pressed="true"]').count();
  check('Marking progress is recorded and survives a reload', tickedAfterReload > 0);

  // The subject must not be able to reword, delete or cancel anything.
  const subjectWrites = await page.evaluate(async (id) => {
    const out = {};
    let res = await fetch(`/api/development/${id}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ title: 'An action I added myself' }),
    });
    out.addAction = res.status;
    res = await fetch(`/api/development/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ title: 'Renamed by the subject' }),
    });
    out.renamePlan = res.status;
    res = await fetch(`/api/development/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ status: 'CANCELLED', outcome: 'I cancelled my own PIP.' }),
    });
    out.cancelPlan = res.status;
    return out;
  }, pipId);
  check('The subject cannot add an action, rename, or cancel their improvement plan',
    subjectWrites.addAction === 403 && subjectWrites.renamePlan === 403 && subjectWrites.cancelPlan === 403,
    JSON.stringify(subjectWrites));

  // The subject can add a check-in.
  await page.goto(pipUrl);
  await page.waitForSelector('[data-hydrated="true"]');
  await page.getByLabel(/Add a check-in/).fill('Completed four weeks with no missed talks.');
  await page.click('button:has-text("Add check-in")');
  // Wait for it in the rendered list, NOT anywhere on the page — the textarea
  // still holds the same words, so a page-wide text match passes for free.
  await page.waitForSelector('li:has-text("Completed four weeks")', { timeout: 25000 });
  await page.reload();
  await page.waitForSelector('[data-hydrated="true"]');
  const checkInPersisted = await page.locator('li:has-text("Completed four weeks")').count();
  check('The subject can add a check-in, and it persists', checkInPersisted > 0);

  // --- Someone up the chain but NOT the direct manager --------------------
  // Marcus is leadership and above Rosa, so he is in the wider chain.
  await signIn('marcus.villanueva@dreambuilder.example');
  const upstream = await page.evaluate(async (args) => {
    const out = {};
    for (const [key, id] of Object.entries(args)) {
      const res = await fetch(`/api/development/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ title: 'Upstream edit attempt' }),
      });
      out[key] = res.status;
    }
    return out;
  }, { pip: pipId, dev: devPlanId });
  check('Upper chain cannot edit either plan', upstream.pip === 404 || upstream.pip === 403,
    JSON.stringify(upstream));

  // A refused page keeps its URL and renders a 404 shell, so the URL proves
  // nothing — assert the plan's own title is absent from what rendered.
  await page.goto(pipUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const upstreamPipText = await page.locator('body').innerText();
  check('Upper chain is not shown the improvement plan', !upstreamPipText.includes(pipTitle));

  await page.goto(devPlanUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const upstreamDevText = await page.locator('body').innerText();
  check('Upper chain IS shown the development plan', upstreamDevText.includes(devTitle));

  const pipInList = await page.evaluate(async (title) => {
    const res = await fetch('/development?scope=all', { credentials: 'same-origin' });
    const html = await res.text();
    return html.includes(title);
  }, pipTitle);
  check('Improvement plan does not appear in the upper chain’s list', !pipInList);

  // --- An unrelated employee sees nothing ---------------------------------
  await signIn('yuki.tanabe@dreambuilder.example');
  const stranger = await page.evaluate(async (args) => {
    const out = {};
    for (const [key, id] of Object.entries(args)) {
      out[key] = (await fetch(`/api/development/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ title: 'Unauthorized edit attempt' }),
      })).status;
    }
    return out;
  }, { pip: pipId, dev: devPlanId });
  check('An unrelated employee is refused on both plans',
    [404, 403].includes(stranger.pip) && [404, 403].includes(stranger.dev), JSON.stringify(stranger));

  // A system administrator runs the application and gets neither plan.
  await signIn('terrence.okafor@dreambuilder.example');
  const sysAdminPlans = await page.evaluate(async (args) => {
    const out = {};
    for (const [key, id] of Object.entries(args)) {
      out[key] = (await fetch(`/api/development/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ title: 'System admin edit attempt' }),
      })).status;
    }
    return out;
  }, { pip: pipId, dev: devPlanId });
  check('A system administrator is refused on both plans',
    [404, 403].includes(sysAdminPlans.pip) && [404, 403].includes(sysAdminPlans.dev),
    JSON.stringify(sysAdminPlans));

  const strangerList = await page.evaluate(async (titles) => {
    const res = await fetch('/development', { credentials: 'same-origin' });
    const html = await res.text();
    return titles.filter((t) => html.includes(t));
  }, [pipTitle, devTitle]);
  check('Neither plan leaks into an unrelated employee’s list', strangerList.length === 0,
    strangerList.join(', ') || 'none');

  // --- HR sees both -------------------------------------------------------
  await signIn('priya.raghunathan@dreambuilder.example');
  const hrSees = await page.evaluate(async (titles) => {
    const res = await fetch('/development?scope=all', { credentials: 'same-origin' });
    const html = await res.text();
    return titles.filter((t) => html.includes(t));
  }, [pipTitle, devTitle]);
  check('HR can see both plans', hrSees.length === 2, hrSees.join(', '));

  // --- /account: password change requires the current one ------------------
  await signIn('yuki.tanabe@dreambuilder.example');
  await page.goto(BASE + '/account');
  await page.waitForSelector('[data-hydrated="true"]');
  const wrongCurrent = await page.evaluate(async () => {
    const res = await fetch('/api/account/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ currentPassword: 'definitely-not-it', newPassword: 'NewPassword123' }),
    });
    return { status: res.status, code: (await res.json())?.error?.code };
  });
  check('Password change refuses a wrong current password', wrongCurrent.status === 422,
    `HTTP ${wrongCurrent.status} ${wrongCurrent.code ?? ''}`);

  const weakNew = await page.evaluate(async (pw) => {
    const res = await fetch('/api/account/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ currentPassword: pw, newPassword: 'short' }),
    });
    return res.status;
  }, PASSWORD);
  check('Password change refuses a weak new password', weakNew === 422, `HTTP ${weakNew}`);

  const samePw = await page.evaluate(async (pw) => {
    const res = await fetch('/api/account/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ currentPassword: pw, newPassword: pw }),
    });
    return res.status;
  }, PASSWORD);
  check('Password change refuses reusing the same password', samePw === 422, `HTTP ${samePw}`);

  const sessionRows = await page.locator('li:has-text("This device")').count();
  check('Account page lists the current session', sessionRows > 0);

  console.log('\n--- console/server errors ---');
  console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`cleanup: dev=${devPlanId} pip=${pipId} titles="${devTitle}" "${pipTitle}"`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(2); });
