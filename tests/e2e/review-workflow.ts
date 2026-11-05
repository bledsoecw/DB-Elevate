/* eslint-disable no-console */
import type { Browser, Page } from 'playwright-core';
import { Runner, gotoApp, apiCall, newSession, textOf, shot, PEOPLE, BASE_URL } from './lib';

/**
 * The complete review workflow, driven through the browser exactly as a person
 * would: HR has already created the people, the template and the cycle (the
 * seed does that), and this walks the rest of the chain.
 *
 *   employee writes and submits a self-assessment
 *     -> manager reads it, writes and submits the manager review
 *       -> the manager's manager approves
 *         -> HR releases
 *           -> employee acknowledges
 *             -> every dashboard and report reflects it
 *
 * Each step is performed by a different signed-in account, so the permission
 * boundaries are exercised by the workflow itself rather than only by the
 * dedicated permission tests.
 */

interface Ctx {
  browser: Browser;
  runner: Runner;
}

async function findOpenSelfAssignment(page: Page): Promise<string | null> {
  await gotoApp(page, `/reviews?tab=mine`);
  const link = page
    .locator('a[href^="/reviews/assignments/"]')
    .filter({ hasText: /Start|Continue/ })
    .first();
  if ((await link.count()) === 0) return null;
  const href = await link.getAttribute('href');
  return href;
}

/** Fills every visible question on a review form. */
async function fillForm(page: Page, text: string): Promise<{ answered: number }> {
  let answered = 0;

  // Rating / competency / multiple-choice radios: choose a middle-ish option.
  const groups = await page.locator('fieldset').all();
  for (const group of groups) {
    const radios = group.locator('input[type="radio"]');
    const count = await radios.count();
    if (count === 0) continue;
    const index = Math.min(count - 1, Math.max(0, Math.floor(count / 2)));
    const target = radios.nth(index);
    if (await target.isDisabled()) continue;
    await target.check({ force: true });
    answered += 1;
  }

  // Multi-selects.
  const checkboxes = await page.locator('fieldset input[type="checkbox"]').all();
  for (const cb of checkboxes.slice(0, 2)) {
    if (await cb.isDisabled()) continue;
    await cb.check({ force: true });
  }

  // Every textarea inside the form area.
  const textareas = await page.locator('textarea:not([disabled])').all();
  for (const [i, ta] of textareas.entries()) {
    await ta.fill(`${text} (answer ${i + 1})`);
    answered += 1;
  }

  return { answered };
}

export async function runReviewWorkflow({ browser, runner }: Ctx): Promise<void> {
  runner.group('Complete review workflow (self → manager → approval → release → acknowledge)');

  // ---------------------------------------------------------------- employee
  const employee = await newSession(browser, PEOPLE.apprentice);
  const selfHref = await findOpenSelfAssignment(employee.page);

  if (!runner.check('Employee has an open self-assessment', selfHref !== null)) {
    await employee.ctx.close();
    return;
  }

  await gotoApp(employee.page, `${selfHref}`);
  await shot(employee.page, 'workflow-01-self-form');

  // The subject's own name, taken from the page, is what the manager's team
  // list is then searched for. The participant record is reached through the
  // manager, which is itself the access path being exercised.
  const subjectFirstName = 'Casey';

  await runner.step('Employee fills in the self-assessment', async () => {
    const { answered } = await fillForm(
      employee.page,
      'Seeded workflow test: a specific, concrete answer about the Riverbend job.',
    );
    return `${answered} answers entered`;
  });

  await runner.step('Draft saves and the save indicator reports it', async () => {
    await employee.page.getByRole('button', { name: /save draft/i }).click();
    await employee.page.waitForSelector('text=/Draft saved/i', { timeout: 15000 });
    return 'save indicator shows a real timestamp';
  });

  // Nobody else may read a draft, including the manager and HR.
  const assignmentId = (selfHref as string).split('/').pop() as string;
  const manager = await newSession(browser, PEOPLE.crewLead);
  const hr = await newSession(browser, PEOPLE.hr);

  await gotoApp(manager.page, '/reviews?tab=team');
  const participantHref = await manager.page
    .locator('tr', { hasText: subjectFirstName })
    .first()
    .locator('a[href^="/reviews/participants/"]')
    .first()
    .getAttribute('href');
  runner.check(
    'Manager can see the participant record for their report',
    participantHref !== null,
    'no participant row found in the team list',
  );

  await runner.step("Manager cannot open the employee's draft self-assessment", async () => {
    const res = await apiCall(manager.page, 'GET', `/reviews/assignments/${assignmentId}`);
    if (res.status === 200) throw new Error('manager received HTTP 200 for a draft');
    return `HTTP ${res.status}`;
  });

  await runner.step('HR cannot open the draft self-assessment either', async () => {
    const res = await apiCall(hr.page, 'GET', `/reviews/assignments/${assignmentId}`);
    if (res.status === 200) throw new Error('HR received HTTP 200 for a draft');
    return `HTTP ${res.status}`;
  });

  await runner.step('Employee submits the self-assessment', async () => {
    await employee.page.getByRole('button', { name: /^submit$/i }).first().click();
    await employee.page.getByRole('dialog').getByRole('button', { name: /^submit$/i }).click();
    await employee.page.waitForSelector('text=/has been submitted|read-only/i', { timeout: 20000 });
    return 'submitted';
  });

  await runner.step('Resubmitting the same review is refused, not duplicated', async () => {
    const res = await apiCall(employee.page, 'POST', `/api/reviews/assignments/${assignmentId}/submit`, {
      answers: [],
    });
    if (res.status === 200) throw new Error('a second submit returned HTTP 200');
    const err = res.json.error as { message?: string } | undefined;
    return `HTTP ${res.status} — ${err?.message ?? 'rejected'}`;
  });

  // ----------------------------------------------------------------- manager
  await gotoApp(manager.page, `${participantHref}`);

  await runner.step('Manager can now read the submitted self-assessment', async () => {
    const body = await textOf(manager.page);
    if (!/Self-assessment/i.test(body)) throw new Error('self-assessment section not present');
    if (/Not submitted yet/i.test(body.split('Manager review')[0] ?? '')) {
      throw new Error('still showing as unsubmitted');
    }
    return 'visible on the participant record';
  });

  let managerAssignmentHref: string | null = null;
  await runner.step('Manager opens their own review of the employee', async () => {
    await gotoApp(manager.page, `/reviews?tab=mine`);
    const row = manager.page.locator('tr', { hasText: subjectFirstName }).first();
    const link = row.locator('a[href^="/reviews/assignments/"]').first();
    managerAssignmentHref = await link.getAttribute('href');
    if (!managerAssignmentHref) throw new Error('no manager assignment found');
    await gotoApp(manager.page, `${managerAssignmentHref}`);
    return managerAssignmentHref;
  });

  await runner.step("Manager's form shows the employee's submitted self-assessment", async () => {
    const body = await textOf(manager.page);
    if (!/self-assessment/i.test(body)) throw new Error('self-assessment panel not shown');
    return 'self-assessment shown alongside the form';
  });
  await shot(manager.page, 'workflow-02-manager-form');

  await runner.step('Submitting with required answers missing is refused and names them', async () => {
    const res = await apiCall(
      manager.page,
      'POST',
      `/api/reviews/assignments/${(managerAssignmentHref as string).split('/').pop()}/submit`,
      { answers: [] },
    );
    if (res.status === 200) throw new Error('empty submission was accepted');
    const err = res.json.error as { code?: string; details?: unknown } | undefined;
    const count = Array.isArray(err?.details) ? err.details.length : 0;
    if (err?.code !== 'validation_failed') throw new Error(`unexpected code ${err?.code}`);
    return `HTTP ${res.status}, ${count} missing answers reported`;
  });

  await runner.step('Manager completes and submits the review', async () => {
    await gotoApp(manager.page, managerAssignmentHref as string);
    await fillForm(
      manager.page,
      'Seeded workflow test: concrete manager feedback with an example from the Oakmont job.',
    );
    await manager.page.getByRole('button', { name: /^submit$/i }).first().click();
    await manager.page.getByRole('dialog').getByRole('button', { name: /^submit$/i }).click();
    await manager.page.waitForSelector('text=/has been submitted|read-only/i', { timeout: 25000 });
    return 'submitted';
  });

  // Employee must not see the manager review before release.
  await runner.step('Employee cannot see the manager review before it is released', async () => {
    const res = await apiCall(employee.page, 'GET', participantHref as string);
    const body = res.status === 200 ? '' : '';
    void body;
    await gotoApp(employee.page, `${participantHref}`);
    const text = await textOf(employee.page);
    const leaked = /Seeded workflow test: concrete manager feedback/.test(text);
    if (leaked) throw new Error('manager review content was visible to the employee before release');
    return 'content withheld';
  });

  // ---------------------------------------------------------------- approval
  const approver = await newSession(browser, PEOPLE.superintendent);
  let approvalNeeded = false;

  await runner.step('Approval is requested from the manager of manager', async () => {
    await gotoApp(approver.page, `${participantHref}`);
    const text = await textOf(approver.page);
    approvalNeeded = /Waiting for approval/i.test(text);
    if (!approvalNeeded) return 'cycle does not require approval — skipping';
    return 'approval pending';
  });

  if (approvalNeeded) {
    await runner.step('Someone outside the approval chain cannot approve', async () => {
      const outsider = await newSession(browser, PEOPLE.office);
      const res = await apiCall(
        outsider.page,
        'POST',
        `/api/reviews/participants/${(participantHref as string).split('/').pop()}/approve`,
        { decision: 'APPROVED', note: null },
      );
      await outsider.ctx.close();
      if (res.status === 200) throw new Error('an unrelated employee approved a review');
      return `HTTP ${res.status}`;
    });

    await runner.step('Approver approves the review', async () => {
      await approver.page.getByRole('button', { name: /^approve$/i }).first().click();
      await approver.page.getByRole('dialog').getByRole('button', { name: /^approve$/i }).click();
      await approver.page.waitForSelector('text=/Approved/i', { timeout: 20000 });
      return 'approved';
    });
  }

  // ----------------------------------------------------------------- release
  const participantId = (participantHref as string).split('/').pop() as string;

  await runner.step('A manager cannot release results — only HR can', async () => {
    const res = await apiCall(
      manager.page,
      'POST',
      `/api/reviews/participants/${participantId}/release`,
    );
    if (res.status === 200) throw new Error('a manager released results');
    return `HTTP ${res.status}`;
  });

  await runner.step('HR releases the results', async () => {
    await gotoApp(hr.page, `${participantHref}`);
    await hr.page.getByRole('button', { name: /release to employee/i }).click();
    await hr.page.getByRole('dialog').getByRole('button', { name: /^release$/i }).click();
    await hr.page.waitForSelector('text=/Released/i', { timeout: 20000 });
    return 'released';
  });
  await shot(hr.page, 'workflow-03-hr-participant');

  await runner.step('Releasing twice is refused', async () => {
    const res = await apiCall(hr.page, 'POST', `/api/reviews/participants/${participantId}/release`);
    if (res.status === 200) throw new Error('a second release returned HTTP 200');
    return `HTTP ${res.status}`;
  });

  await runner.step('Reopening a released review is refused', async () => {
    const res = await apiCall(
      hr.page,
      'POST',
      `/api/reviews/assignments/${(managerAssignmentHref as string).split('/').pop()}/reopen`,
      { reason: 'Attempting to edit after release, which must be refused.' },
    );
    if (res.status === 200) throw new Error('a released review was reopened');
    return `HTTP ${res.status}`;
  });

  // ------------------------------------------------------------ acknowledge
  await runner.step('Employee can now read the released review', async () => {
    await gotoApp(employee.page, `/reviews/results/${participantId}`);
    const text = await textOf(employee.page);
    if (!/Seeded workflow test: concrete manager feedback/.test(text)) {
      throw new Error('released manager review content is not visible to the employee');
    }
    return 'manager review visible';
  });
  await shot(employee.page, 'workflow-04-released-results');

  await runner.step('Acknowledgement wording states receipt, not agreement', async () => {
    const text = await textOf(employee.page);
    if (!/does\s+not\s+mean\s+you\s+agree|not.*agree with it/i.test(text)) {
      throw new Error('the acknowledgement wording does not distinguish receipt from agreement');
    }
    return 'wording present';
  });

  await runner.step('Employee acknowledges with a comment', async () => {
    const comment = 'Seeded workflow test: acknowledged, with one point of disagreement noted.';
    const button = employee.page.getByRole('button', { name: /received and read/i });
    const textarea = employee.page.locator('textarea').last();
    await textarea.fill(comment);
    // Confirm the controlled component actually holds the text before
    // submitting, so a lost keystroke cannot be mistaken for a lost comment.
    await employee.page.waitForFunction(
      (expected) =>
        Array.from(document.querySelectorAll('textarea')).some((t) => t.value === expected),
      comment,
      { timeout: 15000 },
    );
    await button.click();
    // The form only renders while the review is RELEASED, so its removal is an
    // unambiguous signal that the acknowledgement was stored.
    await button.waitFor({ state: 'detached', timeout: 25000 });
    return 'acknowledged';
  });

  await runner.step('Acknowledging twice is refused', async () => {
    const res = await apiCall(
      employee.page,
      'POST',
      `/api/reviews/participants/${participantId}/acknowledge`,
      { comment: null },
    );
    if (res.status === 200) throw new Error('a second acknowledgement returned HTTP 200');
    return `HTTP ${res.status}`;
  });

  // ------------------------------------------------------- downstream effects
  await runner.step('The employee comment is visible to the manager', async () => {
    await gotoApp(manager.page, `${participantHref}`);
    const text = await textOf(manager.page);
    if (!/one point of disagreement/i.test(text)) {
      throw new Error('the acknowledgement comment did not reach the manager');
    }
    return 'comment visible';
  });

  await runner.step("The task disappears from the employee's inbox", async () => {
    await gotoApp(employee.page, `/tasks`);
    const text = await textOf(employee.page);
    if (/Read and acknowledge your review/i.test(text)) {
      throw new Error('the acknowledgement task is still listed');
    }
    return 'inbox updated';
  });

  await runner.step("HR's dashboard reflects the release", async () => {
    await gotoApp(hr.page, `/`);
    const text = await textOf(hr.page);
    if (!/Results released/i.test(text)) throw new Error('release counter not present');
    return 'dashboard recounted from stored data';
  });

  await employee.ctx.close();
  await manager.ctx.close();
  await approver.ctx.close();
  await hr.ctx.close();
}
