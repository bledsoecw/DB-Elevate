import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { computeGoalProgress, goalRisk } from '../scoring/goal-progress';

/**
 * Dashboard data.
 *
 * Every number returned here is counted from stored rows at request time —
 * there are no cached aggregates and no illustrative figures. Where a figure is
 * a proportion it is returned together with its denominator, so the page can
 * state what the percentage is of.
 */

export interface GoalSummary {
  id: string;
  title: string;
  scope: string;
  status: string;
  health: string;
  dueDate: Date | null;
  displayPct: number | null;
  progressSource: string;
  risk: string;
  ownerName?: string;
}

async function summarizeGoals(where: object, take = 8): Promise<GoalSummary[]> {
  const goals = await prisma.goal.findMany({
    where,
    include: {
      milestones: { select: { completedAt: true, weight: true } },
      owner: { select: { firstName: true, lastName: true, preferredName: true } },
    },
    orderBy: [{ dueDate: 'asc' }],
    take,
  });

  return goals.map((g) => {
    const progress = computeGoalProgress({
      measurementType: g.measurementType,
      startValue: g.startValue,
      targetValue: g.targetValue,
      currentValue: g.currentValue,
      higherIsBetter: g.higherIsBetter,
      reportedProgressPct: g.reportedProgressPct,
      status: g.status,
      milestones: g.milestones,
    });
    return {
      id: g.id,
      title: g.title,
      scope: g.scope,
      status: g.status,
      health: g.health,
      dueDate: g.dueDate,
      displayPct: progress.displayPct,
      progressSource: progress.source,
      risk: goalRisk({ status: g.status, health: g.health, dueDate: g.dueDate }),
      ownerName: g.owner
        ? `${g.owner.preferredName || g.owner.firstName} ${g.owner.lastName}`
        : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export async function employeeDashboard(actor: Actor) {
  const employeeId = actor.employeeId;
  if (!employeeId) return null;

  const now = new Date();

  const [myGoals, upcomingMeetings, recentFeedback, latestResult, openActions, recognitionGiven] =
    await Promise.all([
      summarizeGoals({
        ownerEmployeeId: employeeId,
        status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
      }),

      prisma.meeting.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { gte: now },
          participants: { some: { employeeId } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 3,
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          location: true,
          _count: { select: { agendaItems: true, actionItems: true } },
          participants: {
            select: { employee: { select: { firstName: true, lastName: true, id: true } } },
          },
        },
      }),

      // Feedback about me that I am allowed to see. Private notes written by
      // other people are excluded at the query level, not filtered in the view.
      prisma.feedback.findMany({
        where: {
          aboutEmployeeId: employeeId,
          visibility: { in: ['RECIPIENT_ONLY', 'RECIPIENT_AND_MANAGER', 'DEPARTMENT', 'ORGANIZATION'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: {
          id: true,
          kind: true,
          body: true,
          createdAt: true,
          authorVisibility: true,
          author: { select: { firstName: true, lastName: true, preferredName: true } },
          recognitionValue: { select: { name: true, colorHex: true } },
        },
      }),

      prisma.cycleParticipant.findFirst({
        where: { employeeId, status: { in: ['RELEASED', 'ACKNOWLEDGED', 'CLOSED'] } },
        orderBy: { releasedAt: 'desc' },
        select: {
          id: true,
          status: true,
          finalScore: true,
          calibratedScore: true,
          releasedAt: true,
          acknowledgedAt: true,
          cycle: { select: { name: true, periodStart: true, periodEnd: true } },
        },
      }),

      prisma.actionItem.count({
        where: { ownerEmployeeId: employeeId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),

      prisma.feedback.count({
        where: {
          authorEmployeeId: employeeId,
          kind: 'RECOGNITION',
          createdAt: { gte: new Date(now.getTime() - 90 * 86_400_000) },
        },
      }),
    ]);

  return { myGoals, upcomingMeetings, recentFeedback, latestResult, openActions, recognitionGiven };
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export async function managerDashboard(actor: Actor) {
  if (!actor.employeeId || actor.descendantIds.length === 0) return null;
  const teamIds = actor.descendantIds;
  const directIds = actor.directReportIds;
  const now = new Date();

  const [assignments, teamGoals, overdueActions, teamParticipants, directReports] = await Promise.all([
    // The reviews this manager personally owes, plus their team's progress.
    prisma.reviewAssignment.findMany({
      where: {
        participant: { employeeId: { in: teamIds }, cycle: { status: 'ACTIVE' } },
      },
      select: {
        id: true,
        kind: true,
        status: true,
        dueAt: true,
        reviewerEmployeeId: true,
        participant: {
          select: {
            id: true,
            employeeId: true,
            status: true,
            employee: { select: { firstName: true, lastName: true, preferredName: true } },
            cycle: { select: { id: true, name: true } },
          },
        },
      },
    }),

    summarizeGoals(
      { ownerEmployeeId: { in: teamIds }, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
      40,
    ),

    prisma.actionItem.count({
      where: {
        ownerEmployeeId: { in: teamIds },
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        dueDate: { lt: now },
      },
    }),

    prisma.cycleParticipant.findMany({
      where: { employeeId: { in: teamIds }, cycle: { status: 'ACTIVE' } },
      select: {
        id: true,
        status: true,
        employeeId: true,
        employee: { select: { firstName: true, lastName: true, preferredName: true } },
        cycle: { select: { id: true, name: true, managerDueAt: true } },
        assignments: { select: { kind: true, status: true } },
      },
    }),

    // Direct reports with their last one-to-one, so a lapsed cadence is visible.
    prisma.employee.findMany({
      where: { id: { in: directIds }, employmentStatus: { not: 'terminated' } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        jobTitle: { select: { name: true } },
        meetingParticipations: {
          where: { meeting: { status: 'COMPLETED' } },
          orderBy: { meeting: { scheduledAt: 'desc' } },
          take: 1,
          select: { meeting: { select: { scheduledAt: true } } },
        },
      },
      orderBy: { lastName: 'asc' },
    }),
  ]);

  const myAssignments = assignments.filter((a) => a.reviewerEmployeeId === actor.employeeId);

  const goalsAtRisk = teamGoals.filter((g) => g.risk !== 'NONE' && g.risk !== 'DUE_SOON');

  return {
    teamSize: teamIds.length,
    directReportCount: directIds.length,
    myOutstandingReviews: myAssignments.filter((a) =>
      ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(a.status),
    ),
    myOverdueReviews: myAssignments.filter(
      (a) =>
        ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(a.status) &&
        a.dueAt !== null &&
        a.dueAt < now,
    ),
    teamParticipants,
    teamGoals,
    goalsAtRisk,
    overdueActions,
    directReports: directReports.map((r) => ({
      id: r.id,
      name: `${r.preferredName || r.firstName} ${r.lastName}`,
      firstName: r.firstName,
      lastName: r.lastName,
      jobTitle: r.jobTitle?.name ?? null,
      lastMeetingAt: r.meetingParticipations[0]?.meeting.scheduledAt ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// HR / program administration
// ---------------------------------------------------------------------------

export async function hrDashboard(actor: Actor) {
  if (!actor.isHrAdmin) return null;
  const now = new Date();

  const [cycles, pendingApprovals, openSurveys, exceptions, activeEmployees, reopenedCount] =
    await Promise.all([
      prisma.reviewCycle.findMany({
        where: { orgId: actor.orgId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
        orderBy: { managerDueAt: 'asc' },
        select: {
          id: true,
          name: true,
          status: true,
          selfDueAt: true,
          managerDueAt: true,
          requireApproval: true,
          participants: {
            select: {
              id: true,
              status: true,
              assignments: { select: { kind: true, status: true, dueAt: true } },
            },
          },
        },
      }),

      prisma.reviewApproval.count({
        where: { status: 'PENDING', participant: { cycle: { orgId: actor.orgId } } },
      }),

      prisma.survey.findMany({
        where: { orgId: actor.orgId, status: 'OPEN' },
        select: {
          id: true,
          title: true,
          mode: true,
          closesAt: true,
          minResponsesForResults: true,
          _count: { select: { invitations: true, responses: true } },
        },
      }),

      // Administrative exceptions: things that need a person to look at them.
      Promise.all([
        // Active employees with no manager, who therefore get no manager review.
        prisma.employee.count({
          where: {
            orgId: actor.orgId,
            employmentStatus: 'active',
            managerId: null,
            reviewEligible: true,
          },
        }),
        // Participants whose reviewer is now deactivated.
        prisma.reviewAssignment.count({
          where: {
            status: { in: ['NOT_STARTED', 'DRAFT'] },
            participant: { cycle: { orgId: actor.orgId, status: 'ACTIVE' } },
            reviewer: { employmentStatus: 'terminated' },
          },
        }),
        // Reviews approved but never released.
        prisma.cycleParticipant.count({
          where: { status: 'APPROVED', cycle: { orgId: actor.orgId, status: 'ACTIVE' } },
        }),
        // Released more than 21 days ago and still not acknowledged.
        prisma.cycleParticipant.count({
          where: {
            status: 'RELEASED',
            releasedAt: { lt: new Date(now.getTime() - 21 * 86_400_000) },
            cycle: { orgId: actor.orgId },
          },
        }),
        // Active employees with no account, who cannot take part at all.
        prisma.employee.count({
          where: { orgId: actor.orgId, employmentStatus: 'active', userId: null },
        }),
      ]),

      prisma.employee.count({ where: { orgId: actor.orgId, employmentStatus: 'active' } }),

      prisma.reviewAssignment.count({
        where: { status: 'REOPENED', participant: { cycle: { orgId: actor.orgId } } },
      }),
    ]);

  const [noManager, deactivatedReviewer, approvedNotReleased, staleAcknowledgement, noAccount] =
    exceptions;

  const cycleSummaries = cycles.map((c) => {
    const participants = c.participants;
    const allAssignments = participants.flatMap((p) => p.assignments);
    const selfAssignments = allAssignments.filter((a) => a.kind === 'SELF');
    const managerAssignments = allAssignments.filter((a) => a.kind === 'MANAGER');
    const peerAssignments = allAssignments.filter((a) => a.kind === 'PEER');
    const submitted = (list: typeof allAssignments) =>
      list.filter((a) => a.status === 'SUBMITTED').length;
    const overdue = allAssignments.filter(
      (a) => ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(a.status) && a.dueAt && a.dueAt < now,
    ).length;

    const statusCounts: Record<string, number> = {};
    for (const p of participants) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

    return {
      id: c.id,
      name: c.name,
      status: c.status,
      selfDueAt: c.selfDueAt,
      managerDueAt: c.managerDueAt,
      requireApproval: c.requireApproval,
      participantCount: participants.length,
      statusCounts,
      selfSubmitted: submitted(selfAssignments),
      selfTotal: selfAssignments.length,
      managerSubmitted: submitted(managerAssignments),
      managerTotal: managerAssignments.length,
      peerSubmitted: submitted(peerAssignments),
      peerTotal: peerAssignments.length,
      overdueAssignments: overdue,
      releasedCount:
        (statusCounts.RELEASED ?? 0) + (statusCounts.ACKNOWLEDGED ?? 0) + (statusCounts.CLOSED ?? 0),
    };
  });

  return {
    cycles: cycleSummaries,
    pendingApprovals,
    openSurveys,
    activeEmployees,
    reopenedCount,
    exceptions: {
      noManager,
      deactivatedReviewer,
      approvedNotReleased,
      staleAcknowledgement,
      noAccount,
      total:
        noManager + deactivatedReviewer + approvedNotReleased + staleAcknowledgement + noAccount,
    },
  };
}

/** Company-wide goal roll-up for the leadership view. */
export async function leadershipGoalSummary(actor: Actor) {
  if (!actor.isHrAdmin && !actor.isLeadership) return null;
  const companyGoals = await summarizeGoals({ orgId: actor.orgId, scope: 'COMPANY' }, 10);
  const teamGoals = await summarizeGoals({ orgId: actor.orgId, scope: 'TEAM' }, 20);
  return { companyGoals, teamGoals };
}
