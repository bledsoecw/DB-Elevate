const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const PASSWORD = 'ElevateDemo!2026';
const stamp = Date.now().toString().slice(-6);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
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

  await signIn('priya.raghunathan@dreambuilder.example');

  // --- Competency: create with a behaviour ladder --------------------------
  await page.goto(BASE + '/admin/competencies');
  await page.waitForSelector('[data-hydrated="true"]');
  await page.click('button:has-text("New competency")');
  await page.waitForSelector('text=New competency >> nth=0');
  const compName = `Test competency ${stamp}`;
  await page.fill('input[id]:below(:text("Name"))', compName).catch(async () => {
    await page.locator('label:has-text("Name") + input, input').first().fill(compName);
  });
  // Fill two rungs of the ladder
  await page.fill('textarea[aria-label="Apprentice descriptor"]', 'Follows the safety plan with supervision.');
  await page.fill('textarea[aria-label="Lead descriptor"]', 'Runs the toolbox talk and corrects others on site.');
  await page.click('button:has-text("Add competency")');
  await page.waitForSelector(`text=${compName}`, { timeout: 20000 });
  const ladderShown = await page.locator('text=Runs the toolbox talk').count();
  check('Competency created and ladder persisted', ladderShown > 0, `${ladderShown} descriptor(s) on page`);

  // --- Competency: edit it ------------------------------------------------
  const card = page.locator('.shadow-card', { hasText: compName }).first();
  await card.locator('button:has-text("Edit")').click();
  await page.waitForSelector(`text=Edit ${compName}`);
  await page.fill('textarea[aria-label="Journeyman descriptor"]', 'Works unsupervised to the safety plan.');
  await page.click('button:has-text("Save changes")');
  await page.waitForSelector('text=Works unsupervised to the safety plan.', { timeout: 20000 });
  check('Competency edit persisted', true);

  // --- Rating scale: frozen scale has locked levels ------------------------
  await page.goto(BASE + '/admin/scales');
  await page.waitForSelector('[data-hydrated="true"]');
  const frozenBadges = await page.locator('text=Frozen').count();
  check('A seeded in-use scale is reported as frozen', frozenBadges > 0, `${frozenBadges} frozen scale(s)`);

  if (frozenBadges > 0) {
    const frozenCard = page.locator('.shadow-card', { hasText: 'Frozen' }).first();
    await frozenCard.locator('button:has-text("Edit")').click();
    await page.waitForSelector('text=the levels are locked');
    const valueInput = page.locator('input[aria-label="Value for level 1"]').first();
    const disabled = await valueInput.isDisabled();
    check('Frozen scale level inputs are disabled', disabled);
    // The name is still editable, and saving it must succeed.
    // Scoped to the editor by its label: `page.locator('input').first()` is
    // the shell's employee search box, and typing a scale name into that
    // would save nothing while still leaving a 200 in the log.
    const nameBox = page.getByLabel(/^Name\b/).first();
    const existing = await nameBox.inputValue();
    const renamed = existing.replace(/ \[r\d+\]$/, '') + ` [r${stamp}]`;
    await nameBox.fill(renamed);
    await page.click('button:has-text("Save changes")');
    // The heading on the card, not the input's value: an input value is not a
    // text node, so a `text=` selector can never match one.
    await page.waitForSelector(`h3:has-text("[r${stamp}]"), h2:has-text("[r${stamp}]")`, {
      timeout: 20000,
    });
    check('Frozen scale can still be renamed', true, renamed);
  }

  // --- Rating scale: server refuses a level change on a frozen scale -------
  // Asserted against the API directly, because that is the boundary that matters.
  const frozenId = await page.evaluate(async () => {
    const res = await fetch('/api/admin/scales', { credentials: 'same-origin' });
    const data = await res.json();
    const used = data.scales.find((s) => s._count.questions > 0);
    return used ? used.id : null;
  });
  if (frozenId) {
    const refusal = await page.evaluate(async (id) => {
      const res = await fetch(`/api/admin/scales/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          levels: [
            { value: 1, label: 'Rewritten' },
            { value: 2, label: 'Also rewritten' },
          ],
        }),
      });
      const body = await res.json();
      return { status: res.status, code: body?.error?.code };
    }, frozenId);
    check(
      'API refuses level change on a frozen scale',
      refusal.status === 409,
      `HTTP ${refusal.status} ${refusal.code ?? ''}`,
    );
  } else {
    check('API refuses level change on a frozen scale', false, 'no in-use scale found to test');
  }

  // --- Rating scale: create a new one -------------------------------------
  await page.goto(BASE + '/admin/scales');
  await page.waitForSelector('[data-hydrated="true"]');
  await page.click('button:has-text("New scale")');
  await page.waitForSelector('text=New rating scale');
  const scaleName = `Test scale ${stamp}`;
  await page.getByLabel(/^Name\b/).first().fill(scaleName);
  await page.fill('input[aria-label="Label for level 1"]', 'Not yet');
  await page.fill('input[aria-label="Label for level 2"]', 'Getting there');
  await page.fill('input[aria-label="Label for level 3"]', 'Solid');
  await page.fill('input[aria-label="Label for level 4"]', 'Strong');
  await page.fill('input[aria-label="Label for level 5"]', 'Exceptional');
  await page.click('button:has-text("Add scale")');
  await page.waitForSelector(`text=${scaleName}`, { timeout: 20000 });
  check('Rating scale created', true);

  // --- Duplicate level values are blocked before submit -------------------
  await page.click('button:has-text("New scale")');
  await page.waitForSelector('text=New rating scale');
  await page.getByLabel(/^Name\b/).first().fill(`Dup ${stamp}`);
  await page.fill('input[aria-label="Value for level 2"]', '1');
  const addDisabled = await page.locator('button:has-text("Add scale")').isDisabled();
  const dupMessage = await page.locator('text=Each level needs a different number').count();
  check('Duplicate level values block the save', addDisabled && dupMessage > 0);
  await page.click('button:has-text("Cancel")');

  // --- Recognition value: create -----------------------------------------
  await page.goto(BASE + '/admin/recognition');
  await page.waitForSelector('[data-hydrated="true"]');
  await page.click('button:has-text("New value")');
  await page.waitForSelector('text=New recognition value');
  const valName = `Test value ${stamp}`;
  await page.getByLabel(/^Name\b/).first().fill(valName);
  await page.click('button:has-text("Add value")');
  await page.waitForSelector(`text=${valName}`, { timeout: 20000 });
  check('Recognition value created', true);

  // --- Recognition value: delete the unused one it just made --------------
  const row = page.locator('li', { hasText: valName }).first();
  await row.locator('button:has-text("Edit")').click();
  await page.waitForSelector(`text=Edit ${valName}`);
  const removeLabel = await page.locator('button:has-text("Remove"), button:has-text("Deactivate")').first().textContent();
  check('Unused value offers Remove, not Deactivate', (removeLabel || '').includes('Remove'), removeLabel);
  await page.locator('button:has-text("Remove")').first().click();
  await page.waitForFunction(
    (n) => !document.body.innerText.includes(n),
    valName,
    { timeout: 20000 },
  );
  check('Unused recognition value fully removed', true);

  // --- Library: create, attaching a job title -----------------------------
  await page.goto(BASE + '/admin/competencies?tab=libraries');
  await page.waitForSelector('[data-hydrated="true"]');
  await page.click('button:has-text("New library")');
  await page.waitForSelector('text=New competency library');
  const libName = `Test library ${stamp}`;
  await page.getByLabel(/^Name\b/).first().fill(libName);
  // Select the competency made earlier
  await page.locator('label', { hasText: compName }).first().click();
  await page.click('button:has-text("Add library")');
  await page.waitForSelector(`text=${libName}`, { timeout: 20000 });
  check('Competency library created with a selected competency', true);

  // --- Permission: a plain employee cannot reach any of it ----------------
  await signIn('tyler.nakamura@dreambuilder.example');
  for (const path of ['/admin/competencies', '/admin/scales', '/admin/recognition']) {
    await page.goto(BASE + path);
    await page.waitForSelector('[data-hydrated="true"]');
    const stayed = page.url().includes(path);
    check(`Employee redirected away from ${path}`, !stayed, `landed on ${new URL(page.url()).pathname}`);
  }
  const apiBlocked = await page.evaluate(async () => {
    const out = {};
    for (const p of ['/api/admin/competencies', '/api/admin/scales', '/api/admin/recognition']) {
      const res = await fetch(p, { credentials: 'same-origin' });
      out[p] = res.status;
    }
    return out;
  });
  check(
    'Employee blocked at the API too, not just the page',
    Object.values(apiBlocked).every((s) => s === 403 || s === 404),
    JSON.stringify(apiBlocked),
  );

  console.log('\n--- console/server errors ---');
  console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(2); });
