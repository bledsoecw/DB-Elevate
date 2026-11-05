import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { loadManagerHistory } from '../authz/history';
import { participantAccess, type ParticipantAccess } from '../authz/policy';
import { ForbiddenError } from '../errors';

/**
 * Listing queries for the reviews module.
 *
 * The important one is `listVisibleParticipants`. A naive implementation would
 * filter on today's reporting line, which would hand a manager the historical
 * reviews of someone who only recently joined their team — and hide the reviews
 * of someone who has since moved away but whose review that manager wrote.
 * This resolves each participant against the reporting line captured when its
 * cycle launched.
 */

export async function listMyAssignments(actor: Actor) {
  if (!actor.employeeId) return [];
  return prisma.reviewAssignment.findMany({
    where: {
      reviewerEmployeeId: actor.employeeId,
      participant: { cycle: { status: { in: ['ACTIVE', 'CLOSED'] } } },
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    select: {
      id: true,
      kind: true,
      status: true,
      dueAt: true,
      submittedAt: true,
      participant: {
        select: {
          id: true,
          status: true,
          employeeId: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              jobTitle: { select: { name: true } },
            },
          },
          cycle: { select: { id: true, name: true, status: true } },
        },
      },
    },
  });
}

export async function listMyResults(actor: Actor) {
  if (!actor.employeeId) return [];
  return prisma.cycleParticipant.findMany({
    where: {
      employeeId: actor.employeeId,
      status: { in: ['RELEASED', 'ACKNOWLEDGED', 'CLOSED'] },
    },
    orderBy: { releasedAt: 'desc' },
    select: {
      id: true,
      status: true,
      finalScore: true,
      calibratedScore: true,
      releasedAt: true,
      acknowledgedAt: true,
      managerNameSnapshot: true,
      cycle: { select: { id: true, name: true, periodStart: true, periodEnd: true } },
    },
  });
}

export interface VisibleParticipantRow {
  id: string;
  status: string;
  employeeId: string;
  employeeName: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  managerNameSnapshot: string | null;
  cycleId: string;
  cycleName: string;
  cycleStatus: string;
  finalScore: number | null;
  calibratedScore: number | null;
  releasedAt: Date | null;
  access: ParticipantAccess;
  selfStatus: string | null;
  managerStatus: string | null;
  peerSubmitted: number;
  peerTotal: number;
  managerDueAt: Date | null;
}

/**
 * Every participant record the actor may see, resolved against the reporting
 * line as it stood when each cycle launched.
 */
export async function listVisibleParticipants(
  actor: Actor,
  options: { cycleId?: string; includeClosed?: boolean; employeeId?: string } = {},
): Promise<VisibleParticipantRow[]> {
  if (!actor.employeeId && !actor.isHrAdmin) return [];

  const statusFilter = options.includeClosed
    ? undefined
    : { status: { in: ['ACTIVE', 'CLOSED'] as string[] } };

  // Narrow the candidate set before the per-record check. HR sees everything in
  // the organization; everyone else starts from "me, my current reporting line,
  // or anywhere I am recorded as the manager of record".
  const candidateWhere = actor.isHrAdmin
    ? {
        cycle: { orgId: actor.orgId, ...(statusFilter ?? {}) },
        ...(options.cycleId ? { cycleId: options.cycleId } : {}),
        ...(options.employeeId ? { employeeId: options.employeeId } : {}),
      }
    : {
        cycle: { orgId: actor.orgId, ...(statusFilter ?? {}) },
        ...(options.cycleId ? { cycleId: options.cycleId } : {}),
        ...(options.employeeId ? { employeeId: options.employeeId } : {}),
        OR: [
          { employeeId: actor.employeeId as string },
          { managerIdSnapshot: actor.employeeId as string },
          { employeeId: { in: actor.descendantIds } },
        ],
      };

  const rows = await prisma.cycleParticipant.findMany({
    where: candidateWhere,
    orderBy: [{ cycle: { periodEnd: 'desc' } }, { employee: { lastName: 'asc' } }],
    select: {
      id: true,
      status: true,
      employeeId: true,
      managerIdSnapshot: true,
      managerNameSnapshot: true,
      snapshotTakenAt: true,
      finalScore: true,
      calibratedScore: true,
      releasedAt: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          preferredName: true,
          jobTitle: { select: { name: true } },
        },
      },
      cycle: { select: { id: true, name: true, status: true, launchedAt: true, managerDueAt: true } },
      assignments: { select: { kind: true, status: true } },
    },
    take: 500,
  });

  const history = await loadManagerHistory(actor.orgId);

  const out: VisibleParticipantRow[] = [];
  for (const p of rows) {
    const at = p.snapshotTakenAt ?? p.cycle.launchedAt ?? new Date();
    const chain = history.chainAt(p.employeeId, at);
    const access = participantAccess(actor, p, chain);
    if (access === 'NONE') continue;

    const peers = p.assignments.filter((a) => a.kind === 'PEER');
    out.push({
      id: p.id,
      status: p.status,
      employeeId: p.employeeId,
      employeeName: `${p.employee.preferredName || p.employee.firstName} ${p.employee.lastName}`,
      firstName: p.employee.firstName,
      lastName: p.employee.lastName,
      jobTitle: p.employee.jobTitle?.name ?? null,
      managerNameSnapshot: p.managerNameSnapshot,
      cycleId: p.cycle.id,
      cycleName: p.cycle.name,
      cycleStatus: p.cycle.status,
      finalScore: p.finalScore,
      calibratedScore: p.calibratedScore,
      releasedAt: p.releasedAt,
      access,
      selfStatus: p.assignments.find((a) => a.kind === 'SELF')?.status ?? null,
      managerStatus: p.assignments.find((a) => a.kind === 'MANAGER')?.status ?? null,
      peerSubmitted: peers.filter((a) => a.status === 'SUBMITTED').length,
      peerTotal: peers.length,
      managerDueAt: p.cycle.managerDueAt,
    });
  }

  return out;
}

export async function listCycles(actor: Actor) {
  if (!actor.isHrAdmin) throw new ForbiddenError('Only an HR administrator can manage review cycles.');
  return prisma.reviewCycle.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ status: 'asc' }, { periodEnd: 'desc' }],
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      selfDueAt: true,
      managerDueAt: true,
      launchedAt: true,
      closedAt: true,
      requireApproval: true,
      peerReviewEnabled: true,
      templateVersion: {
        select: {
          versionNumber: true,
          template: { select: { id: true, name: true, category: true } },
        },
      },
      _count: { select: { participants: true } },
    },
  });
}

/** Approvals this person is responsible for deciding. */
export async function listPendingApprovals(actor: Actor) {
  if (!actor.employeeId && !actor.isHrAdmin) return [];
  return prisma.reviewApproval.findMany({
    where: {
      status: 'PENDING',
      participant: { cycle: { orgId: actor.orgId } },
      ...(actor.isHrAdmin ? {} : { approverEmployeeId: actor.employeeId as string }),
    },
    orderBy: { requestedAt: 'asc' },
    select: {
      id: true,
      requestedAt: true,
      approverEmployeeId: true,
      approver: { select: { firstName: true, lastName: true, preferredName: true } },
      participant: {
        select: {
          id: true,
          finalScore: true,
          managerNameSnapshot: true,
          employee: {
            select: {
              firstName: true,
              lastName: true,
              preferredName: true,
              jobTitle: { select: { name: true } },
            },
          },
          cycle: { select: { id: true, name: true, managerDueAt: true } },
        },
      },
    },
  });
}
