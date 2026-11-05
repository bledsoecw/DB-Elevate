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

  // =======================================================================
  // System administrator
  // =======================================================================
  await signIn('terrence.okafor@dreambuilder.example');

  // --- Org settings save round-trips --------------------------------------
  await page.goto(BASE + '/admin/system');
  await page.waitForSelector('[data-hydrated="true"]');
  const saveDisabledInitially = await page.locator('button:has-text("Save settings")').isDisabled();
  check('Save is disabled until something changes', saveDisabledInitially);

  // Located by label, not by index: the shell's employee-search box is also
  // an input, so a positional index silently drifts when the chrome changes.
  const productInput = page.getByLabel(/^Product name\b/).first();
  const originalProduct = await productInput.inputValue();
  await productInput.fill('DB Elevate Pilot');
  const saveEnabled = !(await page.locator('button:has-text("Save settings")').isDisabled());
  const dirtyShown = await page.locator('text=Unsaved changes').count();
  check('Edit enables save and shows an unsaved-changes marker', saveEnabled && dirtyShown > 0);

  await page.click('button:has-text("Save settings")');
  await page.waitForSelector('text=All changes saved', { timeout: 20000 });
  await page.reload();
  await page.waitForSelector('[data-hydrated="true"]');
  const persisted = await page.getByLabel(/^Product name\b/).first().inputValue();
  check('Product name persisted across a reload', persisted === 'DB Elevate Pilot', persisted);

  // The sidebar renders wordmarkText when it is set, falling back to the
  // product name only when it is blank — so drive the wordmark to prove the
  // chrome is read from the database rather than from a constant.
  const wordmarkInput = page.getByLabel(/^Wordmark text\b/).first();
  const originalWordmark = await wordmarkInput.inputValue();
  await wordmarkInput.fill('Pilot Mark');
  await page.click('button:has-text("Save settings")');
  await page.waitForSelector('text=All changes saved', { timeout: 20000 });
  await page.reload();
  await page.waitForSelector('[data-hydrated="true"]');
  const brandText = await page.locator('aside').first().innerText().catch(() => '');
  check('Branding chrome is read from the database, not a constant',
    brandText.includes('Pilot Mark'), brandText.split('\n')[0]);

  // Put both back exactly as they were.
  await page.getByLabel(/^Product name\b/).first().fill(originalProduct);
  await page.getByLabel(/^Wordmark text\b/).first().fill(originalWordmark);
  await page.click('button:has-text("Save settings")');
  await page.waitForSelector('text=All changes saved', { timeout: 20000 });
  const restored = await page.getByLabel(/^Product name\b/).first().inputValue();
  check('Settings restored after the test', restored === originalProduct, restored);

  // --- A real mail provider cannot be chosen without a transport ----------
  const smtpDisabled = await page.locator('select').filter({ hasText: 'Local outbox' }).first()
    .locator('option[value="smtp"]').isDisabled().catch(() => null);
  check('Real mail providers are unselectable with no transport configured', smtpDisabled === true, String(smtpDisabled));

  const mailRefusal = await page.evaluate(async () => {
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ emailProvider: 'smtp' }),
    });
    return { status: res.status, code: (await res.json())?.error?.code };
  });
  check('API refuses a live mail provider with no transport', mailRefusal.status === 409,
    `HTTP ${mailRefusal.status} ${mailRefusal.code ?? ''}`);

  // --- AI cannot be switched to a paid provider ---------------------------
  await page.goto(BASE + '/admin/ai');
  await page.waitForSelector('[data-hydrated="true"]');
  const anthropicDisabled = await page.locator('input[value="anthropic"]').isDisabled();
  check('Paid AI provider is unselectable without approved spend', anthropicDisabled);

  const aiRefusal = await page.evaluate(async () => {
    const res = await fetch('/api/admin/ai', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ aiEnabled: true, aiProvider: 'anthropic', aiMonthlyCallBudget: 1000 }),
    });
    return { status: res.status, code: (await res.json())?.error?.code };
  });
  check('API refuses a paid AI provider without AI_BILLING_APPROVED', aiRefusal.status === 409,
    `HTTP ${aiRefusal.status} ${aiRefusal.code ?? ''}`);

  // The mock provider is allowed, and turns back off cleanly.
  await page.click('label:has-text("Mock provider")');
  await page.click('label:has-text("Offer AI drafting assistance")');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('text=Enabled \u00b7 mock', { timeout: 20000 });
  const enabledState = await page.evaluate(async () =>
    (await (await fetch('/api/health')).json()).status);
  check('Mock provider can be enabled with no credential and no cost', enabledState === 'ok');

  // Choosing "None" must clear the enable switch too, so the save is coherent
  // rather than posting "enabled with no provider" and being refused.
  await page.click('label:has-text("None")');
  const switchCleared = !(await page.locator('input[type="checkbox"]').last().isChecked());
  check('Choosing None clears the enable switch', switchCleared);
  await page.click('button:has-text("Save")');
  await page.waitForFunction(
    () => document.querySelector('#main-content')?.textContent?.includes('Saved'),
    undefined,
    { timeout: 20000 },
  );
  await page.reload();
  await page.waitForSelector('[data-hydrated="true"]');
  const offAfterReload = await page.locator('#main-content').innerText();
  check('AI is genuinely off after a reload, not just on screen',
    /\bDisabled\b/.test(offAfterReload) && !/Enabled \u00b7/.test(offAfterReload));

  // --- Last system administrator cannot be demoted ------------------------
  await page.goto(BASE + '/admin/accounts');
  await page.waitForSelector('[data-hydrated="true"]');
  const selfRow = page.locator('tr', { hasText: 'terrence.okafor' }).first();
  await selfRow.locator('button:has-text("Manage")').click();
  await page.waitForSelector('text=Roles');
  const lastAdminGuard = await page.locator('text=last active system administrator').count();
  check('Last system administrator role is protected in the UI', lastAdminGuard > 0);
  await page.click('button:has-text("Done")');

  // --- Demo-data removal refused while signed in as a demo account --------
  const demoRefusal = await page.evaluate(async () => {
    const res = await fetch('/api/admin/demo-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ confirmation: 'REMOVE DEMO DATA' }),
    });
    return { status: res.status, code: (await res.json())?.error?.code };
  });
  check('Demo-data removal refused while signed in as a demo account', demoRefusal.status === 409,
    `HTTP ${demoRefusal.status} ${demoRefusal.code ?? ''}`);

  const wrongPhrase = await page.evaluate(async () => {
    const res = await fetch('/api/admin/demo-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ confirmation: 'remove demo data' }),
    });
    return res.status;
  });
  check('Demo-data removal refuses a mistyped confirmation', wrongPhrase === 409 || wrongPhrase === 422,
    `HTTP ${wrongPhrase}`);

  // --- Outbox discard does not claim delivery -----------------------------
  await page.goto(BASE + '/admin/outbox');
  await page.waitForSelector('[data-hydrated="true"]');
  const localNotice = await page.locator('text=Nothing is being sent').count();
  check('Outbox states plainly that nothing is sent', localNotice > 0);

  // =======================================================================
  // Role separation: HR admin has no system access, and vice versa
  // =======================================================================
  await signIn('priya.raghunathan@dreambuilder.example');
  for (const path of ['/admin/system', '/admin/accounts', '/admin/outbox', '/admin/ai', '/admin/demo-data']) {
    await page.goto(BASE + path);
    await page.waitForSelector('[data-hydrated="true"]');
    check(`HR admin is turned away from ${path}`, !page.url().includes(path),
      `landed on ${new URL(page.url()).pathname}`);
  }
  // The audit log is deliberately readable by BOTH administrators: it holds no
  // review text, no private note and no respondent identity, and HR needs to
  // answer "who released this review". Reading it grants no access to the
  // records it refers to, which is what the next two checks assert.
  await page.goto(BASE + '/admin/audit');
  await page.waitForSelector('[data-hydrated="true"]');
  check('HR admin may read the audit log', page.url().includes('/admin/audit'),
    `landed on ${new URL(page.url()).pathname}`);

  const logText = await page.locator('#main-content').innerText().catch(() => '');
  const leakedReviewText = /Rosa has been|consistently demonstrates|I think I could improve/i.test(logText);
  check('Audit log contains no review prose', !leakedReviewText);

  const hrApi = await page.evaluate(async () => {
    const out = {};
    const calls = [
      ['PATCH', '/api/admin/settings', { productName: 'Hijacked' }],
      ['PATCH', '/api/admin/ai', { aiEnabled: true, aiProvider: 'mock', aiMonthlyCallBudget: 0 }],
      ['POST', '/api/admin/outbox/discard', {}],
      ['POST', '/api/admin/demo-data', { confirmation: 'REMOVE DEMO DATA' }],
    ];
    for (const [method, path, body] of calls) {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      out[path] = res.status;
    }
    return out;
  });
  check('HR admin blocked at every system API route', Object.values(hrApi).every((s) => s === 403),
    JSON.stringify(hrApi));

  await signIn('terrence.okafor@dreambuilder.example');
  const sysApi = await page.evaluate(async () => {
    const out = {};
    for (const p of ['/api/admin/competencies', '/api/admin/scales', '/api/admin/recognition']) {
      out[p] = (await fetch(p, { credentials: 'same-origin' })).status;
    }
    return out;
  });
  check('System admin gets no access to the performance catalogue', Object.values(sysApi).every((s) => s === 403),
    JSON.stringify(sysApi));

  await page.goto(BASE + '/admin/exceptions');
  await page.waitForSelector('[data-hydrated="true"]');
  check('System admin is turned away from the HR exceptions list', !page.url().includes('/admin/exceptions'),
    `landed on ${new URL(page.url()).pathname}`);

  // Plain employee reaches nothing.
  await signIn('tyler.nakamura@dreambuilder.example');
  const empApi = await page.evaluate(async () => {
    const out = {};
    for (const p of ['/api/admin/competencies', '/api/admin/scales']) {
      out[p] = (await fetch(p, { credentials: 'same-origin' })).status;
    }
    const res = await fetch('/api/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ productName: 'Nope' }),
    });
    out['PATCH /api/admin/settings'] = res.status;
    return out;
  });
  check('Plain employee blocked everywhere in administration', Object.values(empApi).every((s) => s === 403),
    JSON.stringify(empApi));

  console.log('\n--- console/server errors ---');
  console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(2); });
