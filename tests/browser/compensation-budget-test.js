/**
 * Budget ceilings: none, zero, and a figure.
 *
 * These three are genuinely different and the difference is easy to lose:
 *
 *  - **No budget row** — nothing is enforced at submission.
 *  - **A budget row of zero** — a real ceiling of zero. Every increase in that
 *    manager's scope has to be 0%.
 *  - **A figure** — enforced at submission, reported before it.
 *
 * A screen that collapses the first two tells a manager nothing is enforced
 * and then refuses them, so each state is asserted on the screen *and* at the
 * submission boundary.
 *
 * Mutates the seeded cycle's budgets. Re-seed afterwards.
 */
const { chromium } = require('playwright');
const { PrismaClient } = require('@prisma/client');

const BASE = 'http://localhost:3000';
const PW = process.env.SEED_PASSWORD || 'ElevateDemo!2026';
const COMP_ADMIN = 'gloria.mbeki@dreambuilder.example';
const MANAGER = 'rosa.delgado@dreambuilder.example';

const results = [];
const check = (n, ok, d) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

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
    where: { cycleId: cycle.id, managerIdSnapshot: rosa.id },
  });
  check('The test manager has people in the cycle', mine.length > 0, `${mine.length}`);
  await db.$disconnect();

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
        return { status: res.status, body: text.slice(0, 500) };
      },
      [method, path, body ?? null],
    );
  }

  async function managerSees() {
    await signIn(MANAGER);
    await page.goto(`${BASE}/compensation/${cycle.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#main-content');
    await page.waitForTimeout(500);
    return page.locator('#main-content').innerText();
  }

  // The seeded cycle already has some of this manager's allocations submitted,
  // and a submitted allocation correctly refuses to be re-decided. Send those
  // back first, so what this test exercises is the budget ceiling rather than
  // the submission lock.
  await signIn(COMP_ADMIN);
  const reopened = [];
  for (const p of mine) {
    if (p.employeeId === rosa.id) continue;
    if (!['SUBMITTED', 'APPROVED'].includes(p.status)) continue;
    const r = await call('POST', `/api/compensation/approve/${p.id}`, {
      decision: 'REQUEST_CHANGES',
      note: 'Reopened by the budget-ceiling test.',
    });
    reopened.push(r.status);
  }
  check(
    'Already-submitted allocations could be reopened for the test',
    reopened.every((s) => s === 200),
    reopened.length ? JSON.stringify(reopened) : 'none needed',
  );

  // -- Give every one of the manager's people a decision, so submission is
  //    blocked by the budget and nothing else.
  await signIn(MANAGER);
  for (const p of mine) {
    if (p.employeeId === rosa.id) continue;
    const r = await call('POST', `/api/compensation/allocate/${p.id}`, {
      bp: 300,
      rationale: 'Set by the budget-ceiling test.',
    });
    if (r.status !== 200) {
      check(`Could decide for participant ${p.id}`, false, `HTTP ${r.status} ${r.body}`);
    }
  }
  const stillPending = await (async () => {
    const d = new PrismaClient();
    const n = await d.compensationParticipant.count({
      where: { cycleId: cycle.id, managerIdSnapshot: rosa.id, decidedBp: null },
    });
    await d.$disconnect();
    return n;
  })();
  check('Every one of the manager’s people now has a decision', stillPending === 0, `${stillPending} left`);

  // -- 1. No budget row: nothing enforced ---------------------------------
  await signIn(COMP_ADMIN);
  const cleared = await call('DELETE', `/api/compensation/${cycle.id}/budget`, {
    ownerEmployeeId: rosa.id,
  });
  check('An administrator can remove a budget', cleared.status === 200, `HTTP ${cleared.status}`);

  let body = await managerSees();
  check(
    'With no budget the manager is told nothing is enforced',
    /no budget set for you/i.test(body) || /nothing is enforced/i.test(body),
  );

  const submitNoBudget = await call('POST', `/api/compensation/${cycle.id}/submit`);
  check(
    'With no budget, submission is allowed',
    submitNoBudget.status === 200,
    `HTTP ${submitNoBudget.status} ${submitNoBudget.status === 200 ? '' : submitNoBudget.body}`,
  );

  // Send them back so the next two states can be tested on the same people.
  await signIn(COMP_ADMIN);
  const sentBack = [];
  for (const p of mine) {
    if (p.employeeId === rosa.id) continue;
    const r = await call('POST', `/api/compensation/approve/${p.id}`, {
      decision: 'REQUEST_CHANGES',
      note: 'Sent back by the budget-ceiling test.',
    });
    sentBack.push(r.status);
  }
  check(
    'Submitted allocations can be sent back for another look',
    sentBack.every((s) => s === 200),
    JSON.stringify(sentBack),
  );

  // -- 2. A budget of zero: a real ceiling --------------------------------
  const setZero = await call('POST', `/api/compensation/${cycle.id}/budget`, {
    ownerEmployeeId: rosa.id,
    poolMinor: 0,
  });
  check('An administrator can set a budget of zero', setZero.status === 200, `HTTP ${setZero.status}`);

  const adminBody = await page.evaluate(async (id) => {
    const res = await fetch(`/compensation/${id}`, { credentials: 'same-origin' });
    return (await res.text()).includes('Nothing to give');
  }, cycle.id);
  check('A zero budget is labelled as nothing to give, not as no ceiling', adminBody);

  body = await managerSees();
  check(
    'A manager with a zero budget is told every decision has to be 0%',
    /zero/i.test(body) && /0%/.test(body),
  );
  check(
    'A manager with a zero budget is NOT told nothing is enforced',
    !/no budget set for you/i.test(body),
  );

  // Re-decide, since sending back cleared nothing but the status.
  const submitZero = await call('POST', `/api/compensation/${cycle.id}/submit`);
  check(
    'A zero budget refuses a submission with increases in it',
    submitZero.status === 409,
    `HTTP ${submitZero.status}`,
  );
  check(
    'The refusal says the budget is zero rather than quoting an overage',
    /zero/i.test(submitZero.body),
    submitZero.body.slice(0, 160),
  );

  // All 0% must then be accepted.
  for (const p of mine) {
    if (p.employeeId === rosa.id) continue;
    await call('POST', `/api/compensation/allocate/${p.id}`, {
      bp: 0,
      rationale: 'Zero budget for this cycle; nothing to allocate.',
    });
  }
  const submitZeroAll = await call('POST', `/api/compensation/${cycle.id}/submit`);
  check(
    'A zero budget accepts a submission where every decision is 0%',
    submitZeroAll.status === 200,
    `HTTP ${submitZeroAll.status} ${submitZeroAll.status === 200 ? '' : submitZeroAll.body}`,
  );

  // -- 3. A figure: enforced, and the refusal names the overage -----------
  await signIn(COMP_ADMIN);
  for (const p of mine) {
    if (p.employeeId === rosa.id) continue;
    await call('POST', `/api/compensation/approve/${p.id}`, {
      decision: 'REQUEST_CHANGES',
      note: 'Sent back by the budget-ceiling test.',
    });
  }
  const payroll = mine
    .filter((p) => p.employeeId !== rosa.id)
    .reduce((sum, p) => sum + p.currentBaseMinor, 0);
  // A ceiling well under a 3% round, so the refusal is certain.
  const tight = Math.round(payroll * 0.005);
  const setTight = await call('POST', `/api/compensation/${cycle.id}/budget`, {
    ownerEmployeeId: rosa.id,
    poolMinor: tight,
  });
  check('An administrator can set a budget figure', setTight.status === 200, `HTTP ${setTight.status}`);

  await signIn(MANAGER);
  for (const p of mine) {
    if (p.employeeId === rosa.id) continue;
    await call('POST', `/api/compensation/allocate/${p.id}`, {
      bp: 300,
      rationale: 'Set by the budget-ceiling test.',
    });
  }

  body = await managerSees();
  check(
    'Going over budget is reported while allocating, not blocked',
    /over budget/i.test(body) && /the ceiling is checked when you submit/i.test(body),
  );

  const submitTight = await call('POST', `/api/compensation/${cycle.id}/submit`);
  check(
    'Submission is refused when the total is over the budget',
    submitTight.status === 409,
    `HTTP ${submitTight.status}`,
  );
  check(
    'The refusal names the amount it is over by',
    /over your budget of/i.test(submitTight.body) && /\$[\d,]+/.test(submitTight.body),
    submitTight.body.slice(0, 200),
  );

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log('This test mutated the seeded cycle. Re-seed with: SEED_FORCE=1 npm run db:seed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(2);
});
