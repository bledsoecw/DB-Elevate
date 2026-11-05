/**
 * Compensation access, checked against the API and not only the screen.
 *
 * The rules being tested:
 *
 *  - The compensation administrator role is never implied by any other role.
 *    An HR administrator runs the review programme and must not reach salary;
 *    a system administrator can reset everyone's password and must not either.
 *  - A manager sees current pay only for the people they are allocating, only
 *    while the cycle is open, and only for the reporting line as it stood when
 *    the cycle launched.
 *  - A manager cannot read anybody's pay history, including a report's.
 *    Current pay inside a live cycle is not the same thing as history.
 *  - Nobody allocates their own pay.
 *  - Approving and applying are separate acts, and both need the role.
 *
 * Targets come from the database rather than from scraping the page, because a
 * refusal test that cannot find a target silently passes without testing
 * anything. Assertions are all made through the browser.
 */
const { chromium } = require('playwright');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:3000';
const PW = process.env.SEED_PASSWORD || 'ElevateDemo!2026';

const COMP_ADMIN = 'gloria.mbeki@deitemeyerbrothers.example';
const HR_ADMIN = 'priya.raghunathan@deitemeyerbrothers.example';
const SYS_ADMIN = 'terrence.okafor@deitemeyerbrothers.example';
const MANAGER = 'rosa.delgado@deitemeyerbrothers.example';
const EMPLOYEE = 'yuki.tanabe@deitemeyerbrothers.example';

const results = [];
const check = (n, ok, d) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

(async () => {
  const db = new PrismaClient();

  // -- Targets, from the database ------------------------------------------
  const cycle = await db.compensationCycle.findFirst({
    where: { status: 'PLANNING' },
    orderBy: { createdAt: 'desc' },
  });
  if (!cycle) {
    console.error("No PLANNING compensation cycle. This suite needs a freshly seeded demonstration cycle: SEED_FORCE=1 npm run db:seed");
    process.exit(2);
  }

  const participants = await db.compensationParticipant.findMany({
    where: { cycleId: cycle.id },
    include: {
      employee: { select: { firstName: true, lastName: true, user: { select: { email: true } } } },
    },
  });

  const emailToEmployeeId = new Map();
  for (const p of participants) {
    if (p.employee.user?.email) emailToEmployeeId.set(p.employee.user.email, p.employeeId);
  }

  const rosaEmployeeId = emailToEmployeeId.get(MANAGER);
  const mine = participants.filter((p) => p.managerIdSnapshot === rosaEmployeeId);
  const notMine = participants.filter(
    (p) => p.managerIdSnapshot !== rosaEmployeeId && p.employeeId !== rosaEmployeeId,
  );
  const rosaOwnLine = participants.find((p) => p.employeeId === rosaEmployeeId);
  const submitted = participants.find((p) => p.status === 'SUBMITTED');

  check('Found a PLANNING cycle with participants', participants.length > 0, `${participants.length} participants`);
  check('The test manager has people to allocate for', mine.length > 0, `${mine.length} in line`);
  check('There is somebody outside the test manager’s line', notMine.length > 0, `${notMine.length} outside`);
  check('The test manager is themselves in the cycle', Boolean(rosaOwnLine), rosaOwnLine ? 'yes' : 'no');
  check('There is a submitted allocation to try approving', Boolean(submitted), submitted ? 'yes' : 'no');

  const outsiderSurname = notMine[0]?.employee.lastName ?? null;
  const foreignParticipantId = notMine[0]?.id ?? null;

  await db.$disconnect();

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
      try {
        await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, {
          timeout: 15000,
        });
        break;
      } catch {}
    }
    await page.waitForSelector('[data-hydrated="true"]');
  }

  /** Raw status for an API call made as the signed-in user. */
  async function call(method, path, body) {
    return page.evaluate(
      async ([m, p, b]) => {
        const res = await fetch(p, {
          method: m,
          credentials: 'same-origin',
          headers: b ? { 'content-type': 'application/json' } : {},
          body: b ? JSON.stringify(b) : undefined,
        });
        let text = '';
        try {
          text = await res.text();
        } catch {}
        return { status: res.status, body: text.slice(0, 300) };
      },
      [method, path, body ?? null],
    );
  }

  /**
   * The page's main region only. The shell's navigation names every section
   * the actor can reach, and matching against it would mistake a nav label
   * for page content.
   */
  async function main(path) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const el = page.locator('#main-content');
    if ((await el.count()) === 0) return await page.locator('body').innerText();
    return await el.innerText();
  }

  const refused = (r) => r.status === 403 || r.status === 404;

  // -- The compensation administrator --------------------------------------
  await signIn(COMP_ADMIN);
  const adminCycle = await main(`/compensation/${cycle.id}`);
  check('The compensation administrator sees the cycle', /Merit Increase/.test(adminCycle));
  check(
    'The administrator is shown each manager’s budget',
    /Manager budgets/.test(adminCycle) && /Payroll in scope/i.test(adminCycle),
  );
  check(
    'The administrator sees the whole pool and what is allocated',
    /total pool/i.test(adminCycle) && /allocated/i.test(adminCycle),
  );
  check(
    'The administrator sees somebody outside any one manager’s line',
    outsiderSurname !== null && new RegExp(outsiderSurname).test(adminCycle),
    outsiderSurname ?? 'none',
  );
  const bands = await main('/compensation/bands');
  check('The administrator can open salary bands', /salary bands/i.test(bands));
  check('Titles with no band are shown as such, not omitted', /No band set/.test(bands));

  // -- HR must not reach salary -------------------------------------------
  // Priya is also a manager, so she legitimately sees her own reporting line
  // in the cycle. What she must not have is the administrator's view or any
  // administrative endpoint.
  await signIn(HR_ADMIN);
  const hrCycle = await main(`/compensation/${cycle.id}`);
  check(
    'An HR administrator does not get the administrator view of a cycle',
    !/total pool/i.test(hrCycle),
  );
  check(
    'An HR administrator does not see people outside their own line',
    outsiderSurname !== null && !new RegExp(outsiderSurname).test(hrCycle),
    outsiderSurname ?? 'none',
  );
  const hrCreate = await call('POST', '/api/compensation', {
    name: 'Injected by HR',
    effectiveDate: '2027-01-01',
    totalPoolMinor: 100,
  });
  check('An HR administrator cannot create a cycle', hrCreate.status === 403, `HTTP ${hrCreate.status}`);
  const hrApply = await call('POST', `/api/compensation/${cycle.id}/apply`);
  check('An HR administrator cannot apply a cycle to pay', hrApply.status === 403, `HTTP ${hrApply.status}`);
  const hrBand = await call('PUT', '/api/compensation/bands/any', { minMinor: 1, maxMinor: 2 });
  check('An HR administrator cannot set a salary band', hrBand.status === 403, `HTTP ${hrBand.status}`);
  const hrBudget = await call('POST', `/api/compensation/${cycle.id}/budget`, {
    ownerEmployeeId: rosaEmployeeId,
    poolMinor: 1,
  });
  check(
    'An HR administrator cannot set a manager budget',
    hrBudget.status === 403,
    `HTTP ${hrBudget.status}`,
  );
  const hrSplit = await call('POST', `/api/compensation/${cycle.id}/budget/split`);
  check(
    'An HR administrator cannot divide the pool',
    hrSplit.status === 403,
    `HTTP ${hrSplit.status}`,
  );
  check(
    'An HR administrator is not shown the manager budgets panel',
    !/Manager budgets/.test(hrCycle),
  );
  const hrApprove = submitted
    ? await call('POST', `/api/compensation/approve/${submitted.id}`, { decision: 'APPROVE' })
    : null;
  check(
    'An HR administrator cannot approve an allocation',
    hrApprove !== null && refused(hrApprove),
    hrApprove ? `HTTP ${hrApprove.status}` : 'no submitted participant',
  );
  const hrHistory = await main(`/compensation/me?employee=${notMine[0]?.employeeId ?? 'x'}`);
  check(
    'An HR administrator cannot read somebody else’s pay history',
    !/compensation administrator/i.test(hrHistory) && !new RegExp(outsiderSurname ?? 'zzz').test(hrHistory),
  );

  // -- The system administrator -------------------------------------------
  await signIn(SYS_ADMIN);
  const sysCreate = await call('POST', '/api/compensation', {
    name: 'Injected by sysadmin',
    effectiveDate: '2027-01-01',
    totalPoolMinor: 100,
  });
  check('A system administrator cannot create a cycle', sysCreate.status === 403, `HTTP ${sysCreate.status}`);
  const sysCycle = await main(`/compensation/${cycle.id}`);
  check('A system administrator cannot open the cycle', !/total pool/i.test(sysCycle));
  const sysHistory = await main(`/compensation/me?employee=${notMine[0]?.employeeId ?? 'x'}`);
  check(
    'A system administrator cannot read somebody else’s pay history',
    !new RegExp(outsiderSurname ?? 'zzz').test(sysHistory),
  );

  // -- A manager sees their own line only ----------------------------------
  await signIn(MANAGER);
  const mgrCycle = await main(`/compensation/${cycle.id}`);
  check('A manager with people in the cycle can open it', /Merit Increase/.test(mgrCycle));
  check(
    'A manager is shown their budget, not the whole pool',
    /your budget/i.test(mgrCycle) && !/total pool/i.test(mgrCycle),
  );
  check(
    'A manager does not see a person outside their reporting line',
    outsiderSurname !== null && !new RegExp(outsiderSurname).test(mgrCycle),
    outsiderSurname ?? 'none',
  );
  check(
    'A manager does see the current pay of a person they are allocating for',
    mine.length > 0 && new RegExp(mine[0].employee.lastName).test(mgrCycle),
    mine[0]?.employee.lastName ?? 'none',
  );

  const stolen = await call('POST', `/api/compensation/allocate/${foreignParticipantId}`, {
    bp: 900,
    rationale: 'Attempted from outside the reporting line.',
  });
  check(
    'A manager cannot allocate for somebody outside their line',
    refused(stolen),
    `HTTP ${stolen.status}`,
  );

  const selfAllocate = rosaOwnLine
    ? await call('POST', `/api/compensation/allocate/${rosaOwnLine.id}`, {
        bp: 100,
        rationale: 'Attempted on my own pay.',
      })
    : null;
  check(
    'Nobody allocates their own pay, even through the API',
    selfAllocate !== null && refused(selfAllocate),
    selfAllocate ? `HTTP ${selfAllocate.status}` : 'manager not in cycle',
  );

  const mgrApprove = submitted
    ? await call('POST', `/api/compensation/approve/${submitted.id}`, { decision: 'APPROVE' })
    : null;
  check(
    'A manager cannot approve, including their own submission',
    mgrApprove !== null && refused(mgrApprove),
    mgrApprove ? `HTTP ${mgrApprove.status}` : 'no submitted participant',
  );

  const mgrApply = await call('POST', `/api/compensation/${cycle.id}/apply`);
  check('A manager cannot apply a cycle to pay', mgrApply.status === 403, `HTTP ${mgrApply.status}`);

  check(
    'A manager is not shown the manager budgets panel',
    !/Manager budgets/.test(mgrCycle),
  );
  const mgrBudget = await call('POST', `/api/compensation/${cycle.id}/budget`, {
    ownerEmployeeId: rosaEmployeeId,
    poolMinor: 100_000_000,
  });
  check(
    'A manager cannot raise their own budget',
    mgrBudget.status === 403,
    `HTTP ${mgrBudget.status}`,
  );
  const mgrSplit = await call('POST', `/api/compensation/${cycle.id}/budget/split`);
  check('A manager cannot divide the pool', mgrSplit.status === 403, `HTTP ${mgrSplit.status}`);

  const mgrBands = await main('/compensation/bands');
  check(
    'A manager is redirected away from salary bands',
    !/Titles with a band/.test(mgrBands),
    new URL(page.url()).pathname,
  );

  const reportHistory = await main(`/compensation/me?employee=${mine[0]?.employeeId ?? 'x'}`);
  check(
    'A manager cannot read a report’s pay history',
    mine.length > 0 && !new RegExp(mine[0].employee.lastName).test(reportHistory),
    mine[0]?.employee.lastName ?? 'none',
  );

  // -- An employee --------------------------------------------------------
  await signIn(EMPLOYEE);
  const ownPay = await main('/compensation/me');
  check('An employee can see their own pay', /My pay/.test(ownPay));
  check('Their own history is shown', /History/.test(ownPay) && /Annual base salary/.test(ownPay));
  check('The page states who can see it', /Who can see this/.test(ownPay) && /Not HR/.test(ownPay));

  const empCycle = await main(`/compensation/${cycle.id}`);
  check(
    'An employee cannot open a compensation cycle',
    !/total pool/i.test(empCycle) && !/your budget/i.test(empCycle),
  );

  const empOther = await main(`/compensation/me?employee=${notMine[0]?.employeeId ?? 'x'}`);
  check(
    'An employee cannot read a colleague’s pay by employee id',
    outsiderSurname !== null && !new RegExp(outsiderSurname).test(empOther),
  );

  const empAllocate = await call('POST', `/api/compensation/allocate/${foreignParticipantId}`, {
    bp: 500,
    rationale: 'Attempted by an employee.',
  });
  check('An employee cannot allocate', refused(empAllocate), `HTTP ${empAllocate.status}`);

  const empLaunch = await call('POST', `/api/compensation/${cycle.id}/launch`);
  check('An employee cannot launch a cycle', empLaunch.status === 403, `HTTP ${empLaunch.status}`);

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(2);
});
