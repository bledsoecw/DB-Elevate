/**
 * Scheduled job runner.
 *
 *   npm run jobs:run                 # run everything that is due
 *   npm run jobs:run -- --dry-run    # reminders and transitions, no mail delivery
 *   npm run jobs:run -- --json       # machine-readable summary, for a wrapper
 *
 * Intended for cron, a systemd timer, or a platform scheduler, every 15 minutes
 * or so. It is safe to run more often than that: every notification carries a
 * day-bucketed idempotency key enforced by a unique index, and stored jobs are
 * claimed with a conditional update, so overlapping runs cannot double-send.
 *
 * Exits 0 when the sweep completed, 1 when any organization raised an error, so
 * a scheduler can alert on it. See docs/DEPLOYMENT.md ("Scheduled jobs").
 */
import { runJobs } from '../src/server/jobs/runner';
import { prisma } from '../src/server/db';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const asJson = args.includes('--json');

  const summary = await runJobs({ deliverEmail: !dryRun });

  if (asJson) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return summary.errors.length > 0 ? 1 : 0;
  }

  const r = summary.reminders;
  const t = summary.transitions;
  const e = summary.email;
  const reminders = r.reviewsDue + r.surveysDue + r.actionsDue + r.plansDue;

  console.log('');
  console.log('  DB Elevate — scheduled jobs');
  console.log('  ' + '-'.repeat(44));
  console.log(`  stored jobs      ${summary.dueJobs.ran} ran, ${summary.dueJobs.failed} failed`);
  console.log(
    `  reminders        ${reminders} (reviews ${r.reviewsDue}, surveys ${r.surveysDue}, actions ${r.actionsDue}, plans ${r.plansDue})`,
  );
  console.log(
    `  transitions      surveys opened ${t.surveysOpened}, closed ${t.surveysClosed}`,
  );
  if (dryRun) {
    console.log('  e-mail           skipped (--dry-run)');
  } else {
    console.log(
      `  e-mail           ${e.sent} sent, ${e.failed} failed, ${e.suppressed} held, ${e.skipped} claimed elsewhere`,
    );
    if (e.suppressed > 0 && e.sent === 0) {
      console.log('                   (held in the outbox — no mail transport is configured)');
    }
  }
  console.log('');

  if (summary.errors.length > 0) {
    console.error(`  ${summary.errors.length} error(s):`);
    for (const error of summary.errors.slice(0, 20)) console.error(`    - ${error}`);
    console.log('');
    return 1;
  }
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error('[jobs] the run failed before it could finish:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
