import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { daysUntil } from '@/lib/utils';

/**
 * The task inbox.
 *
 * One query set feeds the navigation badge, the dashboard and the My tasks
 * page, so those three can never disagree about how much work someone has
 * outstanding. Every item is something the signed-in person is personally
 * expected to do, and every item links to the screen where they do it.
 */

export type TaskKind =
  | 'SELF_REVIEW'
  | 'MANAGER_REVIEW'
  | 'PEER_REVIEW'
  | 'REVIEW_APPROVAL'
  | 'REVIEW_ACKNOWLEDGEMENT'
  | 'FEEDBACK_REQUEST'
  | 'SURVEY'
  | 'ACTION_ITEM'
  | 'GOAL_UPDATE'
  | 'DEVELOPMENT_ACTION'
  | 'MEETING';

export interface InboxTask {
  id: string;
  kind: TaskKind;
  title: string;
  subtitle?: string;
  href: string;
  dueAt: Date | null;
  /** Negative when overdue. */
  daysRemaining: number | null;
  overdue: boolean;
  /** Set when a draft already exists, so the label can say "Continue". */
  inProgress?: boolean;
  group: 'Reviews' | 'Feedback' | 'Surveys' | 'Follow-up' | 'Goals' | 'Meetings';
}

export interface Inbox {
  tasks: InboxTask[];
  total: number;
  overdueCount: number;
  byKind: Record<string, number>;
}

const GOAL_UPDATE_STALE_DAYS = 30;

export async function getInbox(actor: Actor): Promise<Inbox> {
  const employeeId = actor.employeeId;
  if (!employeeId) {
    return { tasks: [], total: 0, overdueCount: 0, byKind: {} };
  }

  const now = new Date();

  const [assignments, approvals, releases, feedbackRequests, surveyInvites, actions, devActions, meetings, staleGoals] =
    await Promise.all([
      // Reviews this person must write.
      prisma.reviewAssignment.findMany({
        where: {
          reviewerEmployeeId: employeeId,
          status: { in: ['NOT_STARTED', 'DRAFT', 'REOPENED'] },
          participant: { cycle: { status: 'ACTIVE' } },
        },
        select: {
          id: true,
          kind: true,
          status: true,
          dueAt: true,
          participant: {
            select: {
              employee: { select: { firstName: true, lastName: true, preferredName: true } },
              cycle: { select: { name: true } },
            },
          },
        },
        orderBy: { dueAt: 'asc' },
      }),

      // Reviews awaiting this person's approval. The approver is pinned at
      // launch, so a later reorganization does not move the decision.
      prisma.reviewApproval.findMany({
        where: {
          approverEmployeeId: employeeId,
          status: 'PENDING',
          participant: { cycle: { status: { in: ['ACTIVE', 'SCHEDULED'] } } },
        },
        select: {
          id: true,
          requestedAt: true,
          participant: {
            select: {
              id: true,
              employee: { select: { firstName: true, lastName: true, preferredName: true } },
              cycle: { select: { name: true, managerDueAt: true } },
            },
          },
        },
      }),

      // Released reviews this person has not acknowledged.
      prisma.cycleParticipant.findMany({
        where: {
          employeeId,
          status: 'RELEASED',
          cycle: { requireAcknowledgement: true },
        },
        select: {
          id: true,
          releasedAt: true,
          cycle: { select: { name: true } },
        },
      }),

      prisma.feedbackRequest.findMany({
        where: { responderEmployeeId: employeeId, status: 'PENDING' },
        select: {
          id: true,
          dueAt: true,
          about: { select: { firstName: true, lastName: true, preferredName: true } },
          requester: { select: { firstName: true, lastName: true } },
        },
        orderBy: { dueAt: 'asc' },
      }),

      prisma.surveyInvitation.findMany({
        where: {
          employeeId,
          status: { in: ['PENDING', 'NOTIFIED'] },
          survey: { status: 'OPEN' },
        },
        select: {
          id: true,
          survey: { select: { id: true, title: true, closesAt: true, mode: true } },
        },
      }),

      prisma.actionItem.findMany({
        where: { ownerEmployeeId: employeeId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        select: { id: true, title: true, dueDate: true, status: true, meetingId: true },
        orderBy: { dueDate: 'asc' },
        take: 50,
      }),

      prisma.developmentAction.findMany({
        where: {
          ownerEmployeeId: employeeId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          plan: { status: 'ACTIVE' },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          plan: { select: { id: true, title: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 30,
      }),

      prisma.meeting.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) },
          participants: { some: { employeeId } },
        },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          _count: { select: { agendaItems: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      }),

      // Active goals with no update for a month, which is the single most
      // common reason goal data goes stale.
      prisma.goal.findMany({
        where: {
          ownerEmployeeId: employeeId,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          health: true,
          updates: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);

  const tasks: InboxTask[] = [];
  const name = (p: { firstName: string; lastName: string; preferredName?: string | null }) =>
    `${p.preferredName || p.firstName} ${p.lastName}`;

  const push = (t: Omit<InboxTask, 'daysRemaining' | 'overdue'>) => {
    const days = daysUntil(t.dueAt, now);
    tasks.push({ ...t, daysRemaining: days, overdue: days !== null && days < 0 });
  };

  for (const a of assignments) {
    const subject = name(a.participant.employee);
    const inProgress = a.status === 'DRAFT' || a.status === 'REOPENED';
    if (a.kind === 'SELF') {
      push({
        id: a.id,
        kind: 'SELF_REVIEW',
        title: 'Write your self-assessment',
        subtitle: a.participant.cycle.name,
        href: `/reviews/assignments/${a.id}`,
        dueAt: a.dueAt,
        inProgress,
        group: 'Reviews',
      });
    } else if (a.kind === 'MANAGER') {
      push({
        id: a.id,
        kind: 'MANAGER_REVIEW',
        title: `Write the manager review for ${subject}`,
        subtitle: a.participant.cycle.name,
        href: `/reviews/assignments/${a.id}`,
        dueAt: a.dueAt,
        inProgress,
        group: 'Reviews',
      });
    } else {
      push({
        id: a.id,
        kind: 'PEER_REVIEW',
        title: `Give peer feedback on ${subject}`,
        subtitle: a.participant.cycle.name,
        href: `/reviews/assignments/${a.id}`,
        dueAt: a.dueAt,
        inProgress,
        group: 'Reviews',
      });
    }
  }

  for (const ap of approvals) {
    push({
      id: ap.id,
      kind: 'REVIEW_APPROVAL',
      title: `Approve the review for ${name(ap.participant.employee)}`,
      subtitle: ap.participant.cycle.name,
      href: `/reviews/participants/${ap.participant.id}`,
      dueAt: ap.participant.cycle.managerDueAt,
      group: 'Reviews',
    });
  }

  for (const r of releases) {
    push({
      id: r.id,
      kind: 'REVIEW_ACKNOWLEDGEMENT',
      title: 'Read and acknowledge your review',
      subtitle: r.cycle.name,
      href: `/reviews/results/${r.id}`,
      dueAt: r.releasedAt ? new Date(r.releasedAt.getTime() + 14 * 86_400_000) : null,
      group: 'Reviews',
    });
  }

  for (const f of feedbackRequests) {
    push({
      id: f.id,
      kind: 'FEEDBACK_REQUEST',
      title: `${f.requester.firstName} asked for feedback on ${name(f.about)}`,
      href: `/feedback/requests/${f.id}`,
      dueAt: f.dueAt,
      group: 'Feedback',
    });
  }

  for (const s of surveyInvites) {
    push({
      id: s.id,
      kind: 'SURVEY',
      title: `Respond to ${s.survey.title}`,
      subtitle: s.survey.mode === 'ANONYMOUS' ? 'Anonymous survey' : 'Named survey',
      href: `/surveys/respond/${s.survey.id}`,
      dueAt: s.survey.closesAt,
      group: 'Surveys',
    });
  }

  for (const a of actions) {
    push({
      id: a.id,
      kind: 'ACTION_ITEM',
      title: a.title,
      subtitle: a.meetingId ? 'From a one-to-one' : 'Action item',
      href: a.meetingId ? `/meetings/${a.meetingId}` : '/meetings/actions',
      dueAt: a.dueDate,
      inProgress: a.status === 'IN_PROGRESS',
      group: 'Follow-up',
    });
  }

  for (const d of devActions) {
    push({
      id: d.id,
      kind: 'DEVELOPMENT_ACTION',
      title: d.title,
      subtitle: d.plan.title,
      href: `/development/${d.plan.id}`,
      dueAt: d.dueDate,
      group: 'Follow-up',
    });
  }

  for (const m of meetings) {
    push({
      id: m.id,
      kind: 'MEETING',
      title: m.title,
      subtitle:
        m._count.agendaItems === 0
          ? 'No agenda items yet — add what you want to cover'
          : `${m._count.agendaItems} agenda ${m._count.agendaItems === 1 ? 'item' : 'items'}`,
      href: `/meetings/${m.id}`,
      dueAt: m.scheduledAt,
      group: 'Meetings',
    });
  }

  for (const g of staleGoals) {
    const last = g.updates[0]?.createdAt;
    const staleDays = last ? (now.getTime() - last.getTime()) / 86_400_000 : Infinity;
    const overdueGoal = g.dueDate !== null && g.dueDate.getTime() < now.getTime();
    if (staleDays < GOAL_UPDATE_STALE_DAYS && !overdueGoal) continue;
    push({
      id: g.id,
      kind: 'GOAL_UPDATE',
      title: overdueGoal ? `Goal past its due date: ${g.title}` : `Update progress on ${g.title}`,
      subtitle: overdueGoal
        ? 'Close it, extend it, or say what is blocking it'
        : last
          ? `Last updated ${Math.round(staleDays)} days ago`
          : 'No progress recorded yet',
      href: `/goals/${g.id}`,
      dueAt: g.dueDate,
      group: 'Goals',
    });
  }

  // Overdue first, then by due date, then undated.
  tasks.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.title.localeCompare(b.title);
  });

  const byKind: Record<string, number> = {};
  for (const t of tasks) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;

  return {
    tasks,
    total: tasks.length,
    overdueCount: tasks.filter((t) => t.overdue).length,
    byKind,
  };
}

/** Lightweight count for the navigation badge. */
export async function getInboxCount(actor: Actor): Promise<{ total: number; overdue: number }> {
  const inbox = await getInbox(actor);
  return { total: inbox.total, overdue: inbox.overdueCount };
}
