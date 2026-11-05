/* eslint-disable no-console */
import { Runner, launch, newSession, warmUp, BASE_URL, PEOPLE } from './lib';
import { runReviewWorkflow } from './review-workflow';
import { runPermissionChecks } from './permissions';

/**
 * Browser test entry point.
 *
 *   npm run dev          (in another terminal)
 *   npm run test:e2e
 *
 * Set E2E_SHOT_DIR to capture a screenshot at each significant step.
 * These tests act on the seeded demonstration data and leave it changed, so
 * re-run `npm run db:reset` before using the data for a demonstration.
 */
async function main(): Promise<void> {
  console.log(`\nDB Elevate — browser tests against ${BASE_URL}`);
  console.log('='.repeat(70));

  // Fail fast with a useful message if nothing is listening.
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) throw new Error(`health check returned HTTP ${res.status}`);
  } catch (e) {
    console.error(
      `\nCould not reach ${BASE_URL}. Start the application with "npm run dev" first.\n${e instanceof Error ? e.message : ''}`,
    );
    process.exit(1);
  }

  const runner = new Runner();
  const browser = await launch();

  try {
    // Compile the routes under test before measuring anything.
    const warm = await newSession(browser, PEOPLE.hr);
    await warmUp(warm.page, [
      '/',
      '/tasks',
      '/reviews',
      '/reviews?tab=team',
      '/reviews?tab=results',
      '/reviews?tab=approvals',
      '/people',
      '/goals',
      '/feedback',
      '/meetings',
      '/surveys',
      '/reports',
      '/admin',
    ]);
    await warm.ctx.close();

    const only = process.argv[2];
    if (!only || only === 'workflow') await runReviewWorkflow({ browser, runner });
    if (!only || only === 'permissions') await runPermissionChecks({ browser, runner });
  } finally {
    await browser.close();
  }

  const ok = runner.summary();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('\nTest run failed to complete:', e);
  process.exit(1);
});
