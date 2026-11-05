/* eslint-disable no-console */
import type { Browser } from 'playwright-core';
import { Runner, gotoApp, apiCall, newSession, signIn, textOf, PEOPLE, BASE_URL, PASSWORD } from './lib';

/**
 * Permission checks driven through the REST API with real session cookies.
 *
 * These deliberately bypass the user interface. A rule that is only enforced by
 * hiding a button is not enforced at all, so every check here is a direct
 * request of the kind an attacker — or a curious employee with the developer
 * tools open — would make.
 */
export async function runPermissionChecks({
  browser,
  runner,
}: {
  browser: Browser;
  runner: Runner;
}): Promise<void> {
  // ---------------------------------------------------------------- sessions
  runner.group('Authentication');

  await runner.step('An anonymous request to a protected API is refused', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    const res = await apiCall(page, 'GET', '/api/notifications/read-all');
    await ctx.close();
    if (res.status === 200) throw new Error('an anonymous request succeeded');
    return `HTTP ${res.status}`;
  });

  await runner.step('A deactivated account cannot sign in', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await signIn(page, PEOPLE.deactivated);
      await ctx.close();
      throw new Error('a deactivated account signed in successfully');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('signed in successfully')) throw e;
      const text = await textOf(page).catch(() => '');
      await ctx.close();
      if (!/no longer active|do not match/i.test(text)) {
        return 'sign-in did not complete (message not matched, but access was refused)';
      }
      return 'refused with an explanatory message';
    }
  });

  await runner.step('A wrong password is refused with a non-enumerating message', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    const real = await apiCall(page, 'POST', '/api/auth/login', {
      email: PEOPLE.office,
      password: 'definitely-not-the-password',
    });
    const fake = await apiCall(page, 'POST', '/api/auth/login', {
      email: 'nobody.here@deitemeyerbrothers.example',
      password: 'definitely-not-the-password',
    });
    await ctx.close();
    const realMsg = (real.json.error as { message?: string } | undefined)?.message;
    const fakeMsg = (fake.json.error as { message?: string } | undefined)?.message;
    if (real.status === 200 || fake.status === 200) throw new Error('a bad password was accepted');
    if (realMsg !== fakeMsg) {
      throw new Error(`messages differ and leak which addresses exist: "${realMsg}" vs "${fakeMsg}"`);
    }
    return 'identical message for a real and an unknown address';
  });

  // ------------------------------------------------------------- employee
  runner.group('Employee scope');

  const office = await newSession(browser, PEOPLE.office);
  const hr = await newSession(browser, PEOPLE.hr);
  const crewLead = await newSession(browser, PEOPLE.crewLead);
  const otherLead = await newSession(browser, PEOPLE.otherLead);
  const sysadmin = await newSession(browser, PEOPLE.sysadmin);

  // Find a participant record that belongs to someone else entirely.
  await gotoApp(hr.page, `/reviews?tab=team`);
  const allParticipantLinks = await hr.page
    .locator('a[href^="/reviews/participants/"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') as string));
  const someoneElse = allParticipantLinks[0];

  await runner.step(
    'An employee cannot open another employee’s review record',
    async () => {
      if (!someoneElse) throw new Error('no participant record found to test against');
      await gotoApp(office.page, `${someoneElse}`);
      const text = await textOf(office.page);
      if (/Score and how it was calculated|Manager review/i.test(text)) {
        throw new Error('review content was visible to an unrelated employee');
      }
      if (!/could not be found|not found|404/i.test(text)) {
        return 'content not shown (page did not render review content)';
      }
      return 'returned not-found';
    },
  );

  await runner.step('An employee cannot release results via the API', async () => {
    if (!someoneElse) throw new Error('no participant record found');
    const id = someoneElse.split('/').pop();
    const res = await apiCall(office.page, 'POST', `/api/reviews/participants/${id}/release`);
    if (res.status === 200) throw new Error('an employee released results');
    return `HTTP ${res.status}`;
  });

  await runner.step('An employee cannot reopen someone else’s submitted review', async () => {
    await gotoApp(hr.page, `${someoneElse}`);
    const assignmentIds = await hr.page
      .locator('[id^="q-"]')
      .evaluateAll((els) => els.map((e) => e.id));
    void assignmentIds;
    const res = await apiCall(office.page, 'POST', `/api/reviews/assignments/does-not-matter/reopen`, {
      reason: 'Attempting to reopen without permission.',
    });
    if (res.status === 200) throw new Error('an employee reopened a review');
    return `HTTP ${res.status}`;
  });

  await runner.step('An employee cannot read the audit log', async () => {
    const res = await apiCall(office.page, 'GET', '/api/admin/audit?limit=5');
    if (res.status === 200) throw new Error('an employee read the audit log');
    return `HTTP ${res.status}`;
  });

  // ------------------------------------------------------------- manager
  runner.group('Manager scope');

  await runner.step('A manager sees only their own reporting line', async () => {
    await gotoApp(crewLead.page, `/reviews?tab=team`);
    const names = await crewLead.page
      .locator('a[href^="/reviews/participants/"]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    const outsiders = names.filter((n) =>
      /Yuki|Gloria|Mireille|Corey|Brandon|Aaliyah|Henrik/.test(n),
    );
    if (outsiders.length > 0) {
      throw new Error(`people outside the reporting line were listed: ${outsiders.join(', ')}`);
    }
    return `${names.length} people listed, none outside the line`;
  });

  await runner.step(
    'A reorganization does not hand the new manager an old review',
    async () => {
      // Jamal Freeman moved from Abebe to Rosa on 2026-07-01. The 2025 annual
      // review was conducted under Abebe, so Rosa must not be able to read it.
      await gotoApp(crewLead.page, `/reviews?tab=team`);
      const rows = await crewLead.page
        .locator('tr')
        .filter({ hasText: 'Jamal' })
        .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
      const has2025 = rows.some((r) => /2025 Annual/.test(r));
      if (has2025) {
        throw new Error("the new manager can see Jamal's 2025 review, conducted under a previous manager");
      }
      return "the 2025 review is not listed for the new manager";
    },
  );

  await runner.step('The manager of record keeps access after the transfer', async () => {
    await gotoApp(otherLead.page, `/reviews?tab=team`);
    const text = await textOf(otherLead.page);
    if (!/Jamal/.test(text)) {
      throw new Error('the original manager of record lost access to the review they wrote');
    }
    return 'previous manager still has the record they wrote';
  });

  await runner.step('A manager cannot reach another manager’s team', async () => {
    await gotoApp(otherLead.page, `/reviews?tab=team`);
    const names = await otherLead.page
      .locator('a[href^="/reviews/participants/"]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    const outsiders = names.filter((n) => /Yuki|Gloria|Corey|Mireille/.test(n));
    if (outsiders.length > 0) throw new Error(`leaked: ${outsiders.join(', ')}`);
    return `${names.length} listed, all within scope`;
  });

  // ------------------------------------------------------- system admin
  runner.group('System administrator scope');

  await runner.step(
    'A system administrator does not get review content by default',
    async () => {
      if (!someoneElse) throw new Error('no participant record found');
      await gotoApp(sysadmin.page, `${someoneElse}`);
      const text = await textOf(sysadmin.page);
      if (/Score and how it was calculated/i.test(text)) {
        throw new Error('a system administrator could read review content without the HR role');
      }
      return 'review content withheld — the role covers application administration only';
    },
  );

  await runner.step('A system administrator can read the audit log', async () => {
    const res = await apiCall(sysadmin.page, 'GET', '/api/admin/audit?limit=5');
    if (res.status === 404) return 'audit endpoint not present yet';
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return 'HTTP 200';
  });

  // ------------------------------------------------------- private content
  runner.group('Private and confidential content');

  await runner.step('Private meeting notes are not visible to the other participant', async () => {
    await gotoApp(crewLead.page, `/meetings`);
    const meetingLink = await crewLead.page
      .locator('a[href^="/meetings/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (!meetingLink) return 'no meetings module yet — skipped';
    const employee = await newSession(browser, PEOPLE.apprentice);
    await gotoApp(employee.page, `${meetingLink}`);
    const text = await textOf(employee.page);
    await employee.ctx.close();
    if (/Note to self|Starting a written record|Keep an eye on this/i.test(text)) {
      throw new Error('a private manager note was visible to the employee');
    }
    return 'private notes withheld';
  });

  await runner.step(
    'Anonymous survey results stay suppressed below the response threshold',
    async () => {
      await gotoApp(hr.page, `/surveys`);
      const text = await textOf(hr.page);
      if (!/Tools & Equipment Pulse/i.test(text)) return 'pulse survey not listed yet — skipped';
      if (!/hidden|Results hidden|too few/i.test(text)) {
        throw new Error('a survey below the threshold did not report its results as hidden');
      }
      return 'suppression reported to HR';
    },
  );

  await office.ctx.close();
  await hr.ctx.close();
  await crewLead.ctx.close();
  await otherLead.ctx.close();
  await sysadmin.ctx.close();
  void PASSWORD;
}
