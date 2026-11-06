/*
 * Job titles and departments.
 *
 * These two lists feed the pickers on every employee record, and until the
 * management screen existed they could only be created by the seed — so a real
 * installation opened the employee form and found two dropdowns with nothing
 * in them. The checks below exercise the whole path: the API, the admin page,
 * and the employee form picker that was the visible symptom.
 *
 * Everything is driven through the API rather than by clicking the dialog,
 * because a dialog that silently fails to save still leaves the test green
 * when the test only reads the page afterwards.
 */
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

  /** Calls the application's own API with the signed-in session. */
  async function call(method, path, body) {
    return page.evaluate(
      async ({ method, path, body }) => {
        const res = await fetch(path, {
          method,
          credentials: 'same-origin',
          headers: body ? { 'content-type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        let json = null;
        try { json = await res.json(); } catch {}
        return { status: res.status, json };
      },
      { method, path, body: body ?? null },
    );
  }

  /** The server's own message, so a 422 from zod cannot pass for a 422 from a business rule. */
  const msg = (r) => r.json?.error?.message ?? '';

  /** The options a `<select>` on the employee form actually offers. */
  async function pickerOptions(labelText) {
    await page.goto(BASE + '/people/new');
    await page.waitForSelector('[data-hydrated="true"]');
    return page.getByLabel(labelText).first().locator('option').allTextContents();
  }

  await signIn('priya.raghunathan@deitemeyerbrothers.example');

  // --- Create a department -------------------------------------------------
  const deptName = `Test Trade ${stamp}`;
  const created = await call('POST', '/api/admin/departments', { name: deptName, code: `TT${stamp}` });
  check('HR admin can create a department', created.status === 200 && Boolean(created.json?.id),
    `HTTP ${created.status} ${JSON.stringify(created.json)}`);
  const deptId = created.json?.id;

  // --- Create a job title in it -------------------------------------------
  const titleName = `Test Role ${stamp}`;
  const titleRes = await call('POST', '/api/admin/job-titles', {
    name: titleName, level: 'Journeyman', departmentId: deptId,
  });
  check('HR admin can create a job title', titleRes.status === 200 && Boolean(titleRes.json?.id),
    `HTTP ${titleRes.status} ${JSON.stringify(titleRes.json)}`);
  const titleId = titleRes.json?.id;

  // --- Both show on the management page ------------------------------------
  await page.goto(BASE + '/admin/job-titles');
  await page.waitForSelector('[data-hydrated="true"]');
  const titleShown = await page.locator(`text=${titleName}`).count();
  const deptShown = await page.locator(`text=${deptName}`).count();
  check('New job title is listed on the admin page', titleShown > 0, `${titleShown} match(es)`);
  check('New department is listed on the admin page', deptShown > 0, `${deptShown} match(es)`);
  const levelShown = await page.locator('text=Journeyman').count();
  check('The job title shows its level and department', levelShown > 0);

  // --- The symptom the user reported: the employee form pickers ------------
  const titleOptions = await pickerOptions(/^Job title/);
  const deptOptions = await pickerOptions(/^Department/);
  check('Job title picker offers the new title',
    titleOptions.some((t) => t.includes(titleName)),
    `${titleOptions.length} option(s)`);
  check('Department picker offers the new department',
    deptOptions.some((t) => t.includes(deptName)),
    `${deptOptions.length} option(s)`);
  check('Both pickers offer more than the "Not set" placeholder',
    titleOptions.length > 1 && deptOptions.length > 1,
    `${titleOptions.length} titles, ${deptOptions.length} departments`);

  // --- The dialog itself works ---------------------------------------------
  // The checks above drive the API, which would still pass if the dialog were
  // wired to nothing. This one clicks it.
  await page.goto(BASE + '/admin/job-titles');
  await page.waitForSelector('[data-hydrated="true"]');
  await page.click('button:has-text("New department")');
  await page.waitForSelector('text=New department >> nth=0');
  const clickedName = `Test Yard ${stamp}`;
  await page.getByLabel(/^Name/).first().fill(clickedName);
  await page.getByLabel(/^Code/).first().fill(`TY${stamp}`);
  await page.click('button:has-text("Add department")');
  await page.waitForSelector(`text=${clickedName}`, { timeout: 20000 });
  check('The New department dialog saves', true, clickedName);

  await page.click('button:has-text("New job title")');
  await page.waitForSelector('text=New job title >> nth=0');
  const clickedTitle = `Test Hand ${stamp}`;
  await page.getByLabel(/^Title/).first().fill(clickedTitle);
  await page.getByLabel(/^Level/).first().fill('Apprentice');
  await page.getByLabel(/^Department/).first().selectOption({ label: clickedName });
  await page.click('button:has-text("Add job title")');
  await page.waitForSelector(`text=${clickedTitle}`, { timeout: 20000 });
  check('The New job title dialog saves, with the department it was given', true, clickedTitle);
  const titleRow = page.locator('li', { hasText: clickedTitle }).last();
  const titleRowText = await titleRow.innerText();
  check('…and the saved job title shows that department',
    titleRowText.includes(clickedName), titleRowText.replace(/\n/g, ' | '));

  const yardRow = page.locator('li', { hasText: clickedName }).last();
  await yardRow.locator('button:has-text("Edit")').click();
  await page.waitForSelector(`text=Edit ${clickedName}`);
  await page.getByLabel(/^Name/).first().fill(`${clickedName} shop`);
  await page.click('button:has-text("Save changes")');
  await page.waitForSelector(`text=${clickedName} shop`, { timeout: 20000 });
  check('The Edit department dialog saves', true);

  // --- A duplicate name is refused ----------------------------------------
  const dupeDept = await call('POST', '/api/admin/departments', { name: deptName });
  check('A duplicate department name is refused, by name',
    dupeDept.status === 422 && msg(dupeDept).includes('already exists'),
    `HTTP ${dupeDept.status} — ${msg(dupeDept)}`);
  const dupeTitle = await call('POST', '/api/admin/job-titles', { name: titleName });
  check('A duplicate job title name is refused, by name',
    dupeTitle.status === 422 && msg(dupeTitle).includes('already exists'),
    `HTTP ${dupeTitle.status} — ${msg(dupeTitle)}`);

  // --- A department cannot be its own parent ------------------------------
  const selfParent = await call('PATCH', `/api/admin/departments/${deptId}`, { parentId: deptId });
  check('A department cannot report to itself',
    selfParent.status === 422 && msg(selfParent).includes('cannot report to itself'),
    `HTTP ${selfParent.status} — ${msg(selfParent)}`);

  // --- Nor inside one of its own sub-departments --------------------------
  const childRes = await call('POST', '/api/admin/departments', {
    name: `Test Crew ${stamp}`, parentId: deptId,
  });
  check('A sub-department can be nested under a department', childRes.status === 200,
    `HTTP ${childRes.status}`);
  const childId = childRes.json?.id;
  const cycle = await call('PATCH', `/api/admin/departments/${deptId}`, { parentId: childId });
  check('A parent cannot be moved under its own child',
    cycle.status === 422 && msg(cycle).includes('own sub-departments'),
    `HTTP ${cycle.status} — ${msg(cycle)}`);

  // --- A nonexistent parent or library is refused, not stored -------------
  const badParent = await call('POST', '/api/admin/departments', {
    name: `Test Orphan ${stamp}`, parentId: 'c0000000000000000000000000',
  });
  check('An unknown parent department is refused',
    badParent.status === 422 && msg(badParent).includes('parent department does not exist'),
    `HTTP ${badParent.status} — ${msg(badParent)}`);
  const orphanListed = (await call('GET', '/api/admin/departments')).json?.departments ?? [];
  check('…and the refused department was not stored',
    !orphanListed.some((d) => d.name === `Test Orphan ${stamp}`),
    `${orphanListed.length} department(s) listed`);
  const badLibrary = await call('POST', '/api/admin/job-titles', {
    name: `Test Role B ${stamp}`, competencyLibraryId: 'c0000000000000000000000000',
  });
  check('An unknown competency library is refused',
    badLibrary.status === 422 && msg(badLibrary).includes('competency library does not exist'),
    `HTTP ${badLibrary.status} — ${msg(badLibrary)}`);

  // --- Archiving something people are still in is refused -----------------
  const allTitles = await call('GET', '/api/admin/job-titles');
  const allDepts = await call('GET', '/api/admin/departments');
  const occupiedTitle = (allTitles.json?.jobTitles ?? []).find((t) => t._count.employees > 0);
  const occupiedDept = (allDepts.json?.departments ?? []).find((d) => d._count.employees > 0);
  check('The seed has an occupied job title and department to test against',
    Boolean(occupiedTitle && occupiedDept),
    `${occupiedTitle?.name ?? 'none'} / ${occupiedDept?.name ?? 'none'}`);

  if (occupiedTitle) {
    const refused = await call('PATCH', `/api/admin/job-titles/${occupiedTitle.id}`, { active: false });
    check('Archiving a job title people still hold is refused, and says who',
      refused.status === 409 && msg(refused).includes('hold') && msg(refused).includes('then archive it'),
      `HTTP ${refused.status} — ${msg(refused)}`);
    const stillActive = await call('GET', '/api/admin/job-titles');
    const row = (stillActive.json?.jobTitles ?? []).find((t) => t.id === occupiedTitle.id);
    check('…and the refusal left the title active', row?.active === true);
  }
  if (occupiedDept) {
    const refused = await call('PATCH', `/api/admin/departments/${occupiedDept.id}`, { active: false });
    check('Archiving a department people are still in is refused, and says who',
      refused.status === 409 && msg(refused).includes('in this department'),
      `HTTP ${refused.status} — ${msg(refused)}`);
  }

  // --- Archiving an empty one works, and drops it from the picker ---------
  const archived = await call('PATCH', `/api/admin/job-titles/${titleId}`, { active: false });
  check('An unheld job title can be archived', archived.status === 200, `HTTP ${archived.status}`);
  const afterArchive = await pickerOptions(/^Job title/);
  check('An archived job title is no longer offered on the employee form',
    !afterArchive.some((t) => t.includes(titleName)),
    `${afterArchive.length} option(s)`);
  await page.goto(BASE + '/admin/job-titles');
  await page.waitForSelector('[data-hydrated="true"]');
  const archivedBadge = await page.locator('text=Archived job titles').count();
  check('Archived job titles are still listed, separately', archivedBadge > 0);

  // --- Renaming works through the API -------------------------------------
  const renamed = await call('PATCH', `/api/admin/departments/${childId}`, {
    name: `Test Crew ${stamp} renamed`,
  });
  check('A department can be renamed', renamed.status === 200, `HTTP ${renamed.status}`);

  // --- The audit log records both -----------------------------------------
  await page.goto(BASE + '/admin/audit');
  await page.waitForSelector('[data-hydrated="true"]');
  const auditText = await page.locator('body').innerText();
  check('Creating a department is recorded in the audit log',
    auditText.includes(deptName), 'looked for the department name');
  check('Creating a job title is recorded in the audit log',
    auditText.includes(titleName), 'looked for the job title name');

  // --- A manager is not an HR administrator -------------------------------
  await signIn('rosa.delgado@deitemeyerbrothers.example');
  await page.goto(BASE + '/admin/job-titles');
  await page.waitForSelector('[data-hydrated="true"]');
  const managerLanded = new URL(page.url()).pathname;
  check('A manager is redirected away from the management page',
    managerLanded !== '/admin/job-titles', `landed on ${managerLanded}`);
  const managerWrite = await call('POST', '/api/admin/job-titles', { name: `Sneaky ${stamp}` });
  check('A manager cannot create a job title through the API',
    managerWrite.status === 403, `HTTP ${managerWrite.status}`);

  // --- A plain employee is blocked on the page and at the API -------------
  await signIn('yuki.tanabe@deitemeyerbrothers.example');
  await page.goto(BASE + '/admin/job-titles');
  await page.waitForSelector('[data-hydrated="true"]');
  const landed = new URL(page.url()).pathname;
  check('An employee is redirected away from the management page',
    landed !== '/admin/job-titles', `landed on ${landed}`);

  const employeeApi = {
    getTitles: (await call('GET', '/api/admin/job-titles')).status,
    getDepts: (await call('GET', '/api/admin/departments')).status,
    postTitle: (await call('POST', '/api/admin/job-titles', { name: `Nope ${stamp}` })).status,
    postDept: (await call('POST', '/api/admin/departments', { name: `Nope ${stamp}` })).status,
    patchDept: (await call('PATCH', `/api/admin/departments/${deptId}`, { name: `Nope ${stamp}` })).status,
  };
  check('An employee is blocked at the API too, not just the page',
    Object.values(employeeApi).every((s) => s === 403 || s === 404),
    JSON.stringify(employeeApi));

  console.log('\n--- console/server errors ---');
  console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(2); });
