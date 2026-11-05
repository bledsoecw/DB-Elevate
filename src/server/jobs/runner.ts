import 'server-only';
import { prisma } from '../db';
import { recordSystemAudit } from '../audit';
import { notify, queueEmail } from '../notify';
import { deliverQueued } from '../email/transport';
import { formatDate } from '@/lib/utils';

/**
 * Scheduled work: reminders, cycle and survey transitions, and e-mail delivery.
 *
 * The runner is invoked from `scripts/run-jobs.ts` (cron, a systemd timer, or a
 * platform scheduler) or from `POST /api/jobs/run` with a shared secret. It is
 * written to be safe to run as often as you like:
 *
 *  - Every notification carries a `dedupeKey`, so running the reminder sweep
 *    five times in an hour produces one reminder, not five. That property is
 *    enforced by a unique index, not by the runner remembering.
 *  - Stored jobs are claimed with a conditional update, so two runners starting
 *    at the same moment cannot both execute one job.
 *  - A handler that throws marks its own job FAILED with the message and lets
 *    the others continue; one bad row does not stop the sweep.
 *
 * Nothing here sends mail by itself. It queues messages, and delivery is a
 * separate step that refuses to run unless the server environment has
 * explicitly authorized a transport. See email/transport.ts.
 */

export interface JobRunSummary {
  startedAt: string;
  finishedAt: string;
  dueJobs: { ran: number; failed: number };
  reminders: { reviewsDue: number; surveysDue: number; actionsDue: number; plansDue: number };
  transitions: { cyclesLaunched: number; surveysOpened: number; surveysClosed: number };
  email: { sent: number; failed: number; suppressed: number; skipped: number };
  errors: string[];
}

export async function runJobs(options: { now?: Date; deliverEmail?: boolean } = {}): Promise<JobRunSummary> {
  const now = options.now ?? new Date();
  const startedAt = new Date();
  const errors: string[] = [];

  const orgs = await prisma.organization.findMany({ select: { id: true, timezone: true } });

  const summary: JobRunSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    dueJobs: { ran: 0, failed: 0 },
    reminders: { reviewsDue: 0, surveysDue: 0, actionsDue: 0, plansDue: 0 },
    transitions: { cyclesLaunched: 0, surveysOpened: 0, surveysClosed: 0 },
    email: { sent: 0, failed: 0, suppressed: 0, skipped: 0 },
    errors,
  };

  for (const org of orgs) {
    try {
      const stored = await runStoredJobs(org.id, now);
      summary.dueJobs.ran += stored.ran;
      summary.dueJobs.failed += stored.failed;
      errors.push(...stored.errors);

      summary.transitions.surveysOpened += await openDueSurveys(org.id, now);
      summary.transitions.surveysClosed += await closeDueSurveys(org.id, now);

      summary.reminders.reviewsDue += await remindOverdueReviews(org.id, now);
      summary.reminders.surveysDue += await remindOpenSurveys(org.id, now);
      summary.reminders.actionsDue += await remindOverdueActions(org.id, now);
      summary.reminders.plansDue += await remindPlanTargets(org.id, now);

      if (options.deliverEmail !== false) {
        const mail = await deliverQueued(org.id);
        summary.email.sent += mail.sent;
        summary.email.failed += mail.failed;
        summary.email.suppressed += mail.suppressed;
        summary.email.skipped += mail.skipped;
      }
    } catch (e) {
      errors.push(`org ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  summary.finishedAt = new Date().toISOString();

  // Only record a run that actually did something, so the audit log stays
  // readable rather than filling with hourly "nothing happened" rows.
  const didSomething =
    summary.dueJobs.ran +
      summary.reminders.reviewsDue +
      summary.reminders.surveysDue +
      summary.reminders.actionsDue +
      summary.reminders.plansDue +
      summary.transitions.cyclesLaunched +
      summary.transitions.surveysOpened +
      summary.transitions.surveysClosed +
      summary.email.sent +
      summary.email.failed >
    0;

  if (didSomething && orgs[0]) {
    await recordSystemAudit(orgs[0].id, {
      action: 'jobs.run',
      entityType: 'organization',
      entityId: orgs[0].id,
      summary:
        `Scheduled run: ${summary.dueJobs.ran} stored job(s), ` +
        `${summary.reminders.reviewsDue + summary.reminders.surveysDue + summary.reminders.actionsDue + summary.reminders.plansDue} reminder(s), ` +
        `${summary.email.sent} e-mail(s) sent`,
      metadata: { ...summary, errors: errors.slice(0, 10) },
    });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Stored jobs
// ---------------------------------------------------------------------------

async function runStoredJobs(
  orgId: string,
  now: Date,
): Promise<{ ran: number; failed: number; errors: string[] }> {
  const due = await prisma.scheduledJob.findMany({
    where: { orgId, status: 'PENDING', runAt: { lte: now } },
    orderBy: { runAt: 'asc' },
    take: 100,
    select: { id: true, kind: true, payloadJson: true, attempts: true },
  });

  let ran = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const job of due) {
    // Claim it. A second runner's update matches nothing and it moves on.
    const claim = await prisma.scheduledJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'RUNNING', lockedAt: now, attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;

    try {
      await runOneJob(orgId, job.kind, job.payloadJson, now);
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: 'DONE', completedAt: new Date(), lastError: null },
      });
      ran += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Three attempts, then it stays FAILED for a person to look at. Silently
      // retrying forever would hide a broken job.
      const exhausted = job.attempts + 1 >= 3;
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: exhausted ? 'FAILED' : 'PENDING', lastError: message, lockedAt: null },
      });
      failed += 1;
      errors.push(`job ${job.kind} ${job.id}: ${message}`);
    }
  }

  return { ran, failed, errors };
}

async function runOneJob(
  orgId: string,
  kind: string,
  payloadJson: string | null,
  now: Date,
): Promise<void> {
  const payload = payloadJson ? (JSON.parse(payloadJson) as Record<string, unknown>) : {};

  switch (kind) {
    case 'survey.open':
      await openSurvey(orgId, String(payload.surveyId ?? ''), now);
      return;
    case 'survey.close':
      await closeSurvey(orgId, String(payload.surveyId ?? ''), now);
      return;
    case 'review.reminder':
      await remindOverdueReviews(orgId, now);
      return;
    case 'survey.reminder':
      await remindOpenSurveys(orgId, now);
      return;
    case 'meeting.rollforward':
      // Carrying unfinished action items into the next meeting happens when the
      // meeting is completed, not on a timer; nothing to do here.
      return;
    case 'cycle.launch':
      // Launching a cycle creates review assignments for real people and is
      // deliberately not automated: it stays a decision somebody makes and can
      // see the consequences of first. The stored job only reminds.
      await notifyCycleReadyToLaunch(orgId, String(payload.cycleId ?? ''));
      return;
    default:
      throw new Error(`Unknown job kind "${kind}"`);
  }
}

// ---------------------------------------------------------------------------
// Survey transitions
// ---------------------------------------------------------------------------

async function openDueSurveys(orgId: string, now: Date): Promise<number> {
  const due = await prisma.survey.findMany({
    where: { orgId, status: 'SCHEDULED', opensAt: { lte: now } },
    select: { id: true },
  });
  let count = 0;
  for (const survey of due) {
    try {
      await openSurvey(orgId, survey.id, now);
      count += 1;
    } catch {
      // Reported through the stored-job path when one exists; a scan failure
      // here must not abort the rest of the sweep.
    }
  }
  return count;
}

async function openSurvey(orgId: string, surveyId: string, now: Date): Promise<void> {
  if (!surveyId) throw new Error('No surveyId in the job payload.');
  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, orgId },
    select: { id: true, title: true, status: true, mode: true, closesAt: true },
  });
  if (!survey) throw new Error('Survey not found.');
  if (survey.status !== 'SCHEDULED') return; // already handled

  const claim = await prisma.survey.updateMany({
    where: { id: surveyId, status: 'SCHEDULED' },
    data: { status: 'OPEN', launchedAt: now },
  });
  if (claim.count === 0) return;

  const invitations = await prisma.surveyInvitation.findMany({
    where: { surveyId },
    select: { employeeId: true },
  });

  for (const invitation of invitations) {
    await notify({
      orgId,
      recipientEmployeeId: invitation.employeeId,
      type: 'survey.opened',
      title: `${survey.title} is open`,
      body:
        survey.mode === 'ANONYMOUS'
          ? 'Your answers are anonymous. Whether you responded is recorded separately from what you said.'
          : 'Your name is attached to your answers in this survey.',
      linkUrl: `/surveys/respond/${surveyId}`,
      dedupeKey: `survey.opened:${surveyId}:${invitation.employeeId}`,
      email: {
        subject: `${survey.title} is open`,
        text:
          `${survey.title} is now open for responses.\n\n` +
          (survey.closesAt ? `It closes on ${formatDate(survey.closesAt)}.\n\n` : '') +
          (survey.mode === 'ANONYMOUS'
            ? 'This survey is anonymous: your answers are not linked to your name. Whether you took part is recorded, but not what you said.\n\n'
            : 'This survey is named: your answers are attributed to you.\n\n'),
      },
    });
  }

  await recordSystemAudit(orgId, {
    action: 'survey.launched',
    entityType: 'survey',
    entityId: surveyId,
    summary: `Opened "${survey.title}" on schedule and notified ${invitations.length} invitee(s)`,
  });
}

async function closeDueSurveys(orgId: string, now: Date): Promise<number> {
  const due = await prisma.survey.findMany({
    where: { orgId, status: 'OPEN', closesAt: { lte: now } },
    select: { id: true },
  });
  let count = 0;
  for (const survey of due) {
    try {
      await closeSurvey(orgId, survey.id, now);
      count += 1;
    } catch {
      /* see openDueSurveys */
    }
  }
  return count;
}

async function closeSurvey(orgId: string, surveyId: string, now: Date): Promise<void> {
  if (!surveyId) throw new Error('No surveyId in the job payload.');
  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, orgId },
    select: { id: true, title: true, status: true },
  });
  if (!survey) throw new Error('Survey not found.');
  if (survey.status !== 'OPEN') return;

  const claim = await prisma.survey.updateMany({
    where: { id: surveyId, status: 'OPEN' },
    data: { status: 'CLOSED', closedAtActual: now },
  });
  if (claim.count === 0) return;

  await recordSystemAudit(orgId, {
    action: 'survey.closed',
    entityType: 'survey',
    entityId: surveyId,
    summary: `Closed "${survey.title}" on schedule`,
  });
}

async function notifyCycleReadyToLaunch(orgId: string, cycleId: string): Promise<void> {
  if (!cycleId) throw new Error('No cycleId in the job payload.');
  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, orgId },
    select: { id: true, name: true, status: true },
  });
  if (!cycle || cycle.status !== 'SCHEDULED') return;

  const admins = await prisma.employee.findMany({
    where: { orgId, user: { roles: { some: { role: 'HR_ADMIN' } }, status: 'active' } },
    select: { id: true },
  });

  for (const admin of admins) {
    await notify({
      orgId,
      recipientEmployeeId: admin.id,
      type: 'cycle.ready',
      title: `${cycle.name} is scheduled to start`,
      body: 'Launching creates the review assignments. It stays a decision somebody makes.',
      linkUrl: `/reviews/cycles/${cycleId}`,
      severity: 'warning',
      dedupeKey: `cycle.ready:${cycleId}:${admin.id}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/**
 * Reminds reviewers whose assignment is due soon or overdue.
 *
 * The dedupe key is bucketed by day, so a reviewer gets at most one reminder
 * per assignment per day however often the runner fires, and the bucket moves
 * on tomorrow so a genuinely overdue review is chased again.
 */
async function remindOverdueReviews(orgId: string, now: Date): Promise<number> {
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const day = now.toISOString().slice(0, 10);

  const assignments = await prisma.reviewAssignment.findMany({
    where: {
      status: { in: ['NOT_STARTED', 'DRAFT', 'REOPENED'] },
      dueAt: { lte: soon },
      participant: { cycle: { orgId, status: 'ACTIVE' } },
      reviewer: { employmentStatus: { not: 'terminated' } },
    },
    select: {
      id: true,
      kind: true,
      dueAt: true,
      reviewerEmployeeId: true,
      participant: {
        select: {
          employee: { select: { firstName: true, lastName: true } },
          cycle: { select: { id: true, name: true } },
        },
      },
    },
    take: 1000,
  });

  let count = 0;
  for (const a of assignments) {
    const overdue = a.dueAt !== null && a.dueAt < now;
    const subject = `${a.participant.employee.firstName} ${a.participant.employee.lastName}`;
    const isSelf = a.kind === 'SELF';

    const created = await notify({
      orgId,
      recipientEmployeeId: a.reviewerEmployeeId,
      type: overdue ? 'review.overdue' : 'review.due',
      title: isSelf
        ? overdue
          ? 'Your self-review is overdue'
          : 'Your self-review is due soon'
        : overdue
          ? `Your review of ${subject} is overdue`
          : `Your review of ${subject} is due soon`,
      body: a.dueAt ? `Due ${formatDate(a.dueAt)} · ${a.participant.cycle.name}` : a.participant.cycle.name,
      linkUrl: `/reviews/assignments/${a.id}`,
      severity: overdue ? 'urgent' : 'warning',
      // One per assignment per day.
      dedupeKey: `review.reminder:${a.id}:${day}`,
      email: {
        subject: isSelf
          ? overdue
            ? 'Your self-review is overdue'
            : 'Your self-review is due soon'
          : `Review of ${subject} ${overdue ? 'is overdue' : 'is due soon'}`,
        text:
          `${a.participant.cycle.name}\n\n` +
          (a.dueAt ? `Due ${formatDate(a.dueAt)}.\n\n` : '') +
          'Your draft is saved as you type and nobody can read it until you submit it.\n',
      },
    });
    if (created) count += 1;
  }
  return count;
}

async function remindOpenSurveys(orgId: string, now: Date): Promise<number> {
  const day = now.toISOString().slice(0, 10);

  const pending = await prisma.surveyInvitation.findMany({
    where: {
      completedAt: null,
      survey: { orgId, status: 'OPEN' },
      employee: { employmentStatus: { not: 'terminated' } },
    },
    select: {
      employeeId: true,
      surveyId: true,
      survey: { select: { title: true, closesAt: true, mode: true } },
    },
    take: 2000,
  });

  let count = 0;
  for (const invitation of pending) {
    // Only chase once the close date is in sight; nagging on day one teaches
    // people to ignore the notification.
    const closes = invitation.survey.closesAt;
    if (closes && closes.getTime() - now.getTime() > 5 * 86_400_000) continue;

    const created = await notify({
      orgId,
      recipientEmployeeId: invitation.employeeId,
      type: 'survey.reminder',
      title: `${invitation.survey.title} closes soon`,
      body:
        invitation.survey.mode === 'ANONYMOUS'
          ? 'Your answers are anonymous. Only whether you responded is recorded.'
          : undefined,
      linkUrl: `/surveys/respond/${invitation.surveyId}`,
      dedupeKey: `survey.reminder:${invitation.surveyId}:${invitation.employeeId}:${day}`,
    });
    if (created) count += 1;
  }
  return count;
}

async function remindOverdueActions(orgId: string, now: Date): Promise<number> {
  const day = now.toISOString().slice(0, 10);

  const overdue = await prisma.actionItem.findMany({
    where: {
      orgId,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      dueDate: { lt: now },
      owner: { employmentStatus: { not: 'terminated' } },
    },
    select: { id: true, title: true, dueDate: true, ownerEmployeeId: true },
    take: 1000,
  });

  let count = 0;
  for (const item of overdue) {

    const created = await notify({
      orgId,
      recipientEmployeeId: item.ownerEmployeeId,
      type: 'action.overdue',
      title: 'An action item is overdue',
      body: item.dueDate ? `${item.title} — was due ${formatDate(item.dueDate)}` : item.title,
      linkUrl: '/meetings/actions',
      severity: 'warning',
      dedupeKey: `action.overdue:${item.id}:${day}`,
    });
    if (created) count += 1;
  }
  return count;
}

async function remindPlanTargets(orgId: string, now: Date): Promise<number> {
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const day = now.toISOString().slice(0, 10);

  const plans = await prisma.developmentPlan.findMany({
    where: {
      orgId,
      status: 'ACTIVE',
      targetDate: { lte: soon },
      employee: { employmentStatus: { not: 'terminated' } },
    },
    select: {
      id: true,
      title: true,
      targetDate: true,
      planType: true,
      employeeId: true,
      employee: { select: { managerId: true } },
    },
    take: 500,
  });

  let count = 0;
  for (const plan of plans) {
    const overdue = plan.targetDate !== null && plan.targetDate < now;
    // The employee and their direct manager — never the wider chain, which
    // matches who may read an improvement plan at all.
    const recipients = [plan.employeeId, plan.employee.managerId].filter(
      (id): id is string => Boolean(id),
    );

    for (const recipient of recipients) {
      const created = await notify({
        orgId,
        recipientEmployeeId: recipient,
        type: overdue ? 'plan.overdue' : 'plan.due',
        title: overdue ? 'A plan has passed its target date' : 'A plan reaches its target date soon',
        body: plan.targetDate ? `${plan.title} — ${formatDate(plan.targetDate)}` : plan.title,
        linkUrl: `/development/${plan.id}`,
        severity: overdue && plan.planType === 'PERFORMANCE_IMPROVEMENT' ? 'urgent' : 'warning',
        dedupeKey: `plan.target:${plan.id}:${recipient}:${day}`,
      });
      if (created) count += 1;
    }
  }
  return count;
}

/** Queues a one-off message. Used by the admin "send a test" action. */
export async function queueTestEmail(orgId: string, toEmail: string): Promise<void> {
  await queueEmail({
    orgId,
    toEmail,
    subject: 'DB Elevate test message',
    text:
      'This is a test message from DB Elevate.\n\n' +
      'If you are reading it in the application outbox rather than an inbox, that is correct: ' +
      'no mail transport is configured, so nothing was sent.\n',
    relatedType: 'test',
  });
}
