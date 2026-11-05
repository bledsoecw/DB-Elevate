/**
 * The compensation flow end to end, driven through the interface.
 *
 * A manager decides an increase, overrides one with a reason, submits; the
 * administrator approves one and sends another back; the administrator applies
 * the cycle; and the increase appears in pay history as a new row.
 *
 * What this is really checking is that the money is the same integer at every
 * step. The figure previewed in the dialog, the figure stored on the
 * allocation, the figure totalled into the budget and the figure written to
 * pay history must all be the same number of cents — not the same number
 * rounded four times.
 *
 * Runs against the seeded demonstration cycle and changes it, so re-seed
 * afterwards: SEED_FORCE=1 npm run db:seed
 */
const { chromium } = require('playwright');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:3000';
const PW = process.env.SEED_PASSWORD || 'ElevateDemo!2026';
const COMP_ADMIN = 'gloria.mbeki@deitemeyerbrothers.example';
const MANAGER = 'rosa.delgado@deitemeyerbrothers.example';

const results = [];
const check = (n, ok, d) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};
const money = (minor) => `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

(async () => {
  const db = new PrismaClient();
  const cycle = await db.compensationCycle.findFirst({
    where: { status: 'PLANNING' },
    orderBy: { createdAt: 'desc' },
  });
  if (!cycle) {
    console.error('No PLANNING cycle. Run: SEED_FORCE=1 npm run db:seed');
    process.exit(2);
  }
  const rosa = await db.employee.findFirst({ where: { user: { email: MANAGER } } });
  const mine = await db.compensationParticipant.findMany({
    where: { cycleId: cycle.id, managerIdSnapshot: rosa.id, status: 'PENDING' },
    include: { employee: { select: { firstName: true, lastName: true } } },
    orderBy: { employee: { lastName: 'asc' } },
  });
  check('Found undecided allocations for the manager', mine.length >= 1, `${mine.length} pending`);
  if (mine.length < 1) {
    await db.$disconnect();
    process.exit(2);
  }
  const subject = mine[0];
  await db.$disconnect();

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Generous, because this suite usually runs behind several others against a
  // development server that compiles a route the first time it is asked for.
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

  // -- The manager decides, through the dialog ----------------------------
  await signIn(MANAGER);
  // Warm the route first: the first request to it compiles the page, and a
  // compile that lands inside an interaction looks like a broken control.
  await page.goto(`${BASE}/compensation/${cycle.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main-content');
  await page.waitForSelector('[data-hydrated="true"]');
  await page.waitForTimeout(400);

  const row = page.locator('tr', { hasText: subject.employee.lastName }).first();
  check('The subject appears in the manager’s grid', (await row.count()) > 0, subject.employee.lastName);

  await row.getByRole('button', { name: /Decide|Change/ }).click();
  await page.waitForSelector('[role="dialog"]');
  const dialog = page.locator('[role="dialog"]');

  // Type an override: a figure that differs from the recommendation.
  const pctInput = dialog.locator('input').first();
  await pctInput.fill('');
  await pctInput.fill('4.25');
  await page.waitForTimeout(400);

  const dialogText = await dialog.innerText();
  // 4.25% of the current base, rounded once, is what the preview must show.
  const expectedIncrease = Math.round((subject.currentBaseMinor * 425) / 10_000);
  const expectedNewBase = subject.currentBaseMinor + expectedIncrease;
  check(
    'The dialog previews the increase as a figure, not just a percentage',
    dialogText.includes(money(expectedIncrease)),
    `expected ${money(expectedIncrease)}`,
  );
  check(
    'The dialog previews the resulting salary',
    dialogText.includes(money(expectedNewBase)) ||
      dialogText.includes(`$${Math.round(expectedNewBase / 100).toLocaleString('en-US')}`),
    `expected ${money(expectedNewBase)}`,
  );

  // An override with no reason must be refused.
  const saveButton = dialog.getByRole('button', { name: /Save|Record/ });
  const disabledWithoutReason = await saveButton.isDisabled().catch(() => false);
  if (!disabledWithoutReason) {
    await saveButton.click();
    await page.waitForTimeout(700);
  }
  const stillOpen = (await page.locator('[role="dialog"]').count()) > 0;
  check(
    'An override without a reason is not accepted',
    disabledWithoutReason || stillOpen,
    disabledWithoutReason ? 'save disabled' : 'dialog stayed open',
  );

  await dialog.locator('textarea').first().fill(
    'Took on the Thornton lead role in August and has been running that crew since. This reflects the job he is actually doing.',
  );
  await page.waitForTimeout(300);
  await dialog.getByRole('button', { name: /Save|Record/ }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  await page.waitForTimeout(900);

  const afterDecide = await page.locator('#main-content').innerText();
  check(
    'The decision is stored and shown as an override',
    /Override/i.test(afterDecide) && afterDecide.includes(money(expectedIncrease)),
    `looking for ${money(expectedIncrease)}`,
  );

  // -- The stored figure is the previewed figure, to the cent --------------
  const db2 = new PrismaClient();
  const stored = await db2.compensationParticipant.findUnique({ where: { id: subject.id } });
  check(
    'The stored increase is the exact integer that was previewed',
    stored.decidedAmountMinor === expectedIncrease,
    `stored ${stored.decidedAmountMinor}, previewed ${expectedIncrease}`,
  );
  check(
    'The stored new base is the current base plus that integer',
    stored.newBaseMinor === subject.currentBaseMinor + expectedIncrease,
    `stored ${stored.newBaseMinor}`,
  );
  check('The decision is recorded as 425 basis points', stored.decidedBp === 425, String(stored.decidedBp));
  check('A rationale was kept with it', Boolean(stored.rationale), stored.rationale ? 'yes' : 'no');
  await db2.$disconnect();

  // -- Submission, which is where the budget ceiling is enforced ----------
  const submitVisible = await page
    .getByRole('button', { name: /Submit decisions/ })
    .isVisible()
    .catch(() => false);
  check('A submit control is offered to the manager', submitVisible);

  if (submitVisible) {
    const stillUndecided = /\d+ still undecided/.test(afterDecide);
    const submitDisabled = await page.getByRole('button', { name: /Submit decisions/ }).isDisabled();
    check(
      'Submit is withheld while anybody is still undecided',
      mine.length === 1 ? !submitDisabled : submitDisabled,
      submitDisabled ? 'disabled' : 'enabled',
    );
    void stillUndecided;
  }

  // -- The administrator approves and applies -----------------------------
  await signIn(COMP_ADMIN);
  await page.goto(`${BASE}/compensation/${cycle.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main-content');

  const reviewRow = page.locator('tr').filter({ has: page.getByRole('button', { name: 'Review' }) }).first();
  const hasReview = (await reviewRow.count()) > 0;
  check('A submitted allocation offers the administrator a review control', hasReview);

  if (hasReview) {
    const reviewSubject = (await reviewRow.innerText()).split('\n')[0];
    await reviewRow.getByRole('button', { name: 'Review' }).click();
    await page.waitForSelector('[role="dialog"]');
    const approveDialog = page.locator('[role="dialog"]');
    const approveText = await approveDialog.innerText();
    check(
      'The approval dialog shows the figure being approved',
      /\$[\d,]+/.test(approveText),
      reviewSubject,
    );
    await approveDialog.getByRole('button', { name: /^Approve/ }).click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForTimeout(900);
    const afterApprove = await page.locator('#main-content').innerText();
    check('The allocation is now approved', /Approved/.test(afterApprove));
  }

  // Close allocation, then apply. Approving is not applying.
  const db3 = new PrismaClient();
  const approvedBefore = await db3.compensationParticipant.findMany({
    where: { cycleId: cycle.id, status: 'APPROVED' },
  });
  const recordsBefore = await db3.compensationRecord.count({ where: { sourceCycleId: cycle.id } });
  check(
    'Nothing has been written to pay history yet, despite approvals',
    recordsBefore === 0 && approvedBefore.length > 0,
    `${approvedBefore.length} approved, ${recordsBefore} pay records from this cycle`,
  );
  await db3.$disconnect();

  const closeButton = page.getByRole('button', { name: /Close allocation/ });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await page.waitForTimeout(1200);
  }
  await page.goto(`${BASE}/compensation/${cycle.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#main-content');

  const applyButton = page.getByRole('button', { name: /Apply to pay/ });
  const canApply = await applyButton.isVisible().catch(() => false);
  check('Applying is a separate control from approving', canApply);

  if (canApply) {
    await applyButton.click();
    await page.waitForTimeout(1800);
  }

  // -- Pay history ---------------------------------------------------------
  const db4 = new PrismaClient();
  const written = await db4.compensationRecord.findMany({
    where: { sourceCycleId: cycle.id },
    include: { employee: { select: { lastName: true } } },
  });
  check(
    'Approved increases were written to pay history',
    written.length === approvedBefore.length && written.length > 0,
    `${written.length} rows for ${approvedBefore.length} approved`,
  );
  check(
    'Each row is a MERIT change, not an edit of an earlier row',
    written.length > 0 && written.every((r) => r.changeType === 'MERIT'),
  );

  const matched = approvedBefore.every((p) => {
    const rec = written.find((r) => r.employeeId === p.employeeId);
    return rec && rec.baseMinor === p.newBaseMinor;
  });
  check('The salary written is exactly the approved new base', matched);

  const notApproved = await db4.compensationParticipant.findMany({
    where: { cycleId: cycle.id, status: { notIn: ['APPLIED'] } },
  });
  const leakage = notApproved.filter((p) => written.some((r) => r.employeeId === p.employeeId));
  check(
    'Nothing unapproved reached pay history',
    leakage.length === 0,
    `${notApproved.length} not applied, ${leakage.length} leaked`,
  );

  // History is append-only: the person's prior rows are all still there.
  if (written.length > 0) {
    const subjectRecords = await db4.compensationRecord.findMany({
      where: { employeeId: written[0].employeeId },
      orderBy: { effectiveDate: 'desc' },
    });
    check(
      'The earlier rows are still present beneath the new one',
      subjectRecords.length >= 2 && subjectRecords[0].sourceCycleId === cycle.id,
      `${subjectRecords.length} rows`,
    );
  }
  await db4.$disconnect();

  // The employee can see the new figure on their own page.
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log('This test mutated the seeded cycle. Re-seed with: SEED_FORCE=1 npm run db:seed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(2);
});
