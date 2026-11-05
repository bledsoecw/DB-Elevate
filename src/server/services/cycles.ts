import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { loadReportingGraph } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { canManageCycles } from '../authz/policy';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { notify } from '../notify';
import { APPROVAL_AUTHORITIES, PEER_VISIBILITY_MODES, RELEASE_MODES } from '@/lib/enums';

/**
 * Review cycles.
 *
 * Launching is the moment everything becomes real, and it is the moment the
 * snapshot is taken. For every participant the cycle records the template
 * version, the manager of record, the job title and the department as they
 * stood right then. Everything downstream — who can read the review, which
 * questions were asked, who approves it — resolves against that snapshot and
 * not against the organization as it is later.
 */

export async function getCycle(actor: Actor, cycleId: string) {
  if (!canManageCycles(actor)) {
    throw new ForbiddenError('Only an HR administrator can manage review cycles.');
  }
  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    include: {
      templateVersion: {
        include: {
          template: { select: { id: true, name: true, category: true } },
          _count: { select: { sections: true } },
        },
      },
      participants: {
        orderBy: { employee: { lastName: 'asc' } },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              employmentStatus: true,
              jobTitle: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
          assignments: {
            include: { reviewer: { select: { id: true, firstName: true, lastName: true, preferredName: true } } },
          },
          approvals: { select: { status: true } },
        },
      },
    },
  });
  if (!cycle) throw new NotFoundError();
  return cycle;
}

export interface CycleInput {
  name: string;
  description?: string | null;
  templateVersionId: string;
  periodStart: string;
  periodEnd: string;
  selfReviewEnabled: boolean;
  managerReviewEnabled: boolean;
  peerReviewEnabled: boolean;
  peerReviewTarget?: number;
  peerVisibilityMode?: string;
  requireApproval: boolean;
  approvalAuthority?: string;
  releaseMode?: string;
  shareSelfWithManager: boolean;
  sharePeerWithEmployee: boolean;
  requireAcknowledgement: boolean;
  selfDueAt?: string | null;
  managerDueAt?: string | null;
  peerDueAt?: string | null;
}

function validateCycleInput(input: CycleInput): void {
  if (!input.name || input.name.trim().length < 3) {
    throw new ValidationError('Give the cycle a name of at least 3 characters.');
  }
  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError('The review period needs a valid start and end date.');
  }
  if (start > end) throw new ValidationError('The review period starts after it ends.');
  if (!input.selfReviewEnabled && !input.managerReviewEnabled && !input.peerReviewEnabled) {
    throw new ValidationError('A cycle needs at least one kind of review.');
  }
  if (input.peerVisibilityMode && !PEER_VISIBILITY_MODES.includes(input.peerVisibilityMode as never)) {
    throw new ValidationError('Unknown setting for peer review visibility.');
  }
  if (input.approvalAuthority && !APPROVAL_AUTHORITIES.includes(input.approvalAuthority as never)) {
    throw new ValidationError('Unknown approval authority.');
  }
  if (input.releaseMode && !RELEASE_MODES.includes(input.releaseMode as never)) {
    throw new ValidationError('Unknown release mode.');
  }
  if (input.selfDueAt && input.managerDueAt && new Date(input.selfDueAt) > new Date(input.managerDueAt)) {
    throw new ValidationError(
      'Self-assessments are due after manager reviews, which means managers would be writing without them. Swap the dates.',
    );
  }
}

export async function createCycle(actor: Actor, input: CycleInput) {
  if (!canManageCycles(actor)) {
    throw new ForbiddenError('Only an HR administrator can create a review cycle.');
  }
  validateCycleInput(input);

  const version = await prisma.reviewTemplateVersion.findFirst({
    where: { id: input.templateVersionId, template: { orgId: actor.orgId } },
    include: { template: true },
  });
  if (!version) throw new ValidationError('That template version could not be found.');
  if (!version.publishedAt) {
    throw new ValidationError(
      'A cycle can only use a published template version. Publish it first so it is frozen.',
    );
  }

  const cycle = await prisma.reviewCycle.create({
    data: {
      orgId: actor.orgId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: 'DRAFT',
      templateVersionId: input.templateVersionId,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      selfReviewEnabled: input.selfReviewEnabled,
      managerReviewEnabled: input.managerReviewEnabled,
      peerReviewEnabled: input.peerReviewEnabled,
      peerReviewTarget: input.peerReviewEnabled ? (input.peerReviewTarget ?? 3) : 0,
      peerVisibilityMode: input.peerVisibilityMode ?? 'CONFIDENTIAL',
      requireApproval: input.requireApproval,
      approvalAuthority: input.approvalAuthority ?? 'MANAGER_OF_MANAGER',
      releaseMode: input.releaseMode ?? 'MANUAL',
      shareSelfWithManager: input.shareSelfWithManager,
      sharePeerWithEmployee: input.sharePeerWithEmployee,
      requireAcknowledgement: input.requireAcknowledgement,
      selfDueAt: input.selfDueAt ? new Date(input.selfDueAt) : null,
      managerDueAt: input.managerDueAt ? new Date(input.managerDueAt) : null,
      peerDueAt: input.peerDueAt ? new Date(input.peerDueAt) : null,
      createdById: actor.userId,
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.CYCLE_CREATED,
    entityType: 'review_cycle',
    entityId: cycle.id,
    summary: `Created the review cycle "${cycle.name}" as a draft.`,
    metadata: { template: version.template.name, version: version.versionNumber },
  });

  return cycle;
}

export async function updateCycle(actor: Actor, cycleId: string, input: Partial<CycleInput>) {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const cycle = await prisma.reviewCycle.findFirst({ where: { id: cycleId, orgId: actor.orgId } });
  if (!cycle) throw new NotFoundError();

  // After launch, the questions and who writes them are fixed. Dates and the
  // release settings can still move, because those are administration rather
  // than content.
  const launched = cycle.status === 'ACTIVE' || cycle.status === 'CLOSED';
  if (launched) {
    const frozen: (keyof CycleInput)[] = [
      'templateVersionId',
      'selfReviewEnabled',
      'managerReviewEnabled',
      'peerReviewEnabled',
      'peerVisibilityMode',
    ];
    for (const key of frozen) {
      if (input[key] !== undefined) {
        throw new ConflictError(
          'This cycle has already been launched, so its template and the kinds of review it collects are fixed. Dates and release settings can still be changed.',
        );
      }
    }
  }

  const updated = await prisma.reviewCycle.update({
    where: { id: cycleId },
    data: {
      name: input.name?.trim() ?? undefined,
      description: input.description !== undefined ? input.description?.trim() || null : undefined,
      templateVersionId: input.templateVersionId ?? undefined,
      periodStart: input.periodStart ? new Date(input.periodStart) : undefined,
      periodEnd: input.periodEnd ? new Date(input.periodEnd) : undefined,
      selfReviewEnabled: input.selfReviewEnabled ?? undefined,
      managerReviewEnabled: input.managerReviewEnabled ?? undefined,
      peerReviewEnabled: input.peerReviewEnabled ?? undefined,
      peerReviewTarget: input.peerReviewTarget ?? undefined,
      peerVisibilityMode: input.peerVisibilityMode ?? undefined,
      requireApproval: input.requireApproval ?? undefined,
      approvalAuthority: input.approvalAuthority ?? undefined,
      releaseMode: input.releaseMode ?? undefined,
      shareSelfWithManager: input.shareSelfWithManager ?? undefined,
      sharePeerWithEmployee: input.sharePeerWithEmployee ?? undefined,
      requireAcknowledgement: input.requireAcknowledgement ?? undefined,
      selfDueAt: input.selfDueAt !== undefined ? (input.selfDueAt ? new Date(input.selfDueAt) : null) : undefined,
      managerDueAt:
        input.managerDueAt !== undefined ? (input.managerDueAt ? new Date(input.managerDueAt) : null) : undefined,
      peerDueAt: input.peerDueAt !== undefined ? (input.peerDueAt ? new Date(input.peerDueAt) : null) : undefined,
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.CYCLE_UPDATED,
    entityType: 'review_cycle',
    entityId: cycleId,
    summary: `Updated the cycle "${updated.name}".`,
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export interface EligibleEmployee {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: string | null;
  managerName: string | null;
  managerId: string | null;
  cohort: string | null;
  hireDate: Date | null;
  included: boolean;
  blockers: string[];
}

export async function listEligibleEmployees(actor: Actor, cycleId: string): Promise<EligibleEmployee[]> {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can do that.');

  const [employees, participants, cycle] = await Promise.all([
    prisma.employee.findMany({
      where: { orgId: actor.orgId, employmentStatus: { not: 'terminated' } },
      orderBy: [{ lastName: 'asc' }],
      include: {
        jobTitle: { select: { name: true } },
        department: { select: { name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      },
    }),
    prisma.cycleParticipant.findMany({ where: { cycleId }, select: { employeeId: true } }),
    prisma.reviewCycle.findFirst({ where: { id: cycleId, orgId: actor.orgId } }),
  ]);
  if (!cycle) throw new NotFoundError();

  const included = new Set(participants.map((p) => p.employeeId));

  return employees.map((e) => {
    const blockers: string[] = [];
    if (!e.reviewEligible) blockers.push('Marked as not eligible for reviews');
    if (cycle.managerReviewEnabled && !e.managerId) {
      blockers.push('No manager, so no manager review can be assigned');
    }
    if (!e.userId) blockers.push('No sign-in account, so they cannot complete a self-assessment');
    return {
      id: e.id,
      name: `${e.preferredName || e.firstName} ${e.lastName}`,
      firstName: e.firstName,
      lastName: e.lastName,
      jobTitle: e.jobTitle?.name ?? null,
      department: e.department?.name ?? null,
      managerName: e.manager ? `${e.manager.preferredName || e.manager.firstName} ${e.manager.lastName}` : null,
      managerId: e.managerId,
      cohort: e.reviewCohort,
      hireDate: e.hireDate,
      included: included.has(e.id),
      blockers,
    };
  });
}

export async function setParticipants(
  actor: Actor,
  cycleId: string,
  employeeIds: string[],
): Promise<{ added: number; removed: number }> {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const cycle = await prisma.reviewCycle.findFirst({ where: { id: cycleId, orgId: actor.orgId } });
  if (!cycle) throw new NotFoundError();
  if (cycle.status === 'CLOSED' || cycle.status === 'CANCELLED') {
    throw new ConflictError('This cycle is closed.');
  }

  const existing = await prisma.cycleParticipant.findMany({
    where: { cycleId },
    select: { id: true, employeeId: true, status: true },
  });
  const existingIds = new Set(existing.map((p) => p.employeeId));
  const wanted = new Set(employeeIds);

  const toAdd = employeeIds.filter((id) => !existingIds.has(id));
  const toRemove = existing.filter((p) => !wanted.has(p.employeeId));

  // Somebody who has already started cannot simply be dropped: removing them
  // would delete work they have done.
  const started = toRemove.filter((p) => p.status !== 'NOT_STARTED');
  if (started.length > 0 && cycle.status === 'ACTIVE') {
    throw new ConflictError(
      `${started.length} ${started.length === 1 ? 'person has' : 'people have'} already started their review, so they cannot be removed. Cancel their individual assignments instead if they should not take part.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.cycleParticipant.deleteMany({ where: { id: { in: toRemove.map((p) => p.id) } } });
    }
    for (const employeeId of toAdd) {
      await tx.cycleParticipant.create({
        data: {
          cycleId,
          employeeId,
          templateVersionId: cycle.templateVersionId,
          status: 'NOT_STARTED',
        },
      });
    }
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.PARTICIPANT_ADDED,
    entityType: 'review_cycle',
    entityId: cycleId,
    summary: `Updated the participant list for "${cycle.name}": ${toAdd.length} added, ${toRemove.length} removed.`,
    metadata: { added: toAdd.length, removed: toRemove.length },
  });

  // A cycle already running needs assignments for anyone newly added.
  if (cycle.status === 'ACTIVE' && toAdd.length > 0) {
    await generateAssignments(actor, cycleId, { onlyMissing: true });
  }

  return { added: toAdd.length, removed: toRemove.length };
}

/**
 * Creates the self, manager and peer assignments, and takes the snapshot.
 *
 * Called at launch, and again when someone is added to a running cycle.
 */
export async function generateAssignments(
  actor: Actor,
  cycleId: string,
  options: { onlyMissing?: boolean } = {},
): Promise<{ assignments: number; skipped: { name: string; reason: string }[] }> {
  const cycle = await prisma.reviewCycle.findFirstOrThrow({
    where: { id: cycleId, orgId: actor.orgId },
    include: {
      participants: {
        include: {
          employee: {
            include: {
              manager: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
              jobTitle: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
          assignments: { select: { kind: true, reviewerEmployeeId: true } },
        },
      },
    },
  });

  const now = new Date();
  const skipped: { name: string; reason: string }[] = [];
  let created = 0;

  // Peer selection uses today's structure, since peers are chosen at launch.
  const { childrenOf } = await loadReportingGraph(actor.orgId);

  for (const p of cycle.participants) {
    if (options.onlyMissing && p.assignments.length > 0) continue;

    const e = p.employee;
    const name = `${e.preferredName || e.firstName} ${e.lastName}`;

    // Snapshot the organizational facts, once.
    if (!p.snapshotTakenAt) {
      await prisma.cycleParticipant.update({
        where: { id: p.id },
        data: {
          managerIdSnapshot: e.managerId,
          managerNameSnapshot: e.manager
            ? `${e.manager.preferredName || e.manager.firstName} ${e.manager.lastName}`
            : null,
          jobTitleNameSnapshot: e.jobTitle?.name ?? null,
          departmentNameSnapshot: e.department?.name ?? null,
          snapshotTakenAt: now,
        },
      });
    }

    const has = (kind: string, reviewerId?: string) =>
      p.assignments.some((a) => a.kind === kind && (!reviewerId || a.reviewerEmployeeId === reviewerId));

    if (cycle.selfReviewEnabled && !has('SELF')) {
      if (!e.userId) {
        skipped.push({ name, reason: 'No sign-in account, so no self-assessment was assigned.' });
      } else {
        await prisma.reviewAssignment.create({
          data: {
            participantId: p.id,
            reviewerEmployeeId: e.id,
            kind: 'SELF',
            templateVersionId: p.templateVersionId,
            dueAt: cycle.selfDueAt,
          },
        });
        created += 1;
      }
    }

    if (cycle.managerReviewEnabled && !has('MANAGER')) {
      if (!e.managerId) {
        skipped.push({ name, reason: 'No manager, so no manager review was assigned.' });
      } else {
        await prisma.reviewAssignment.create({
          data: {
            participantId: p.id,
            reviewerEmployeeId: e.managerId,
            kind: 'MANAGER',
            templateVersionId: p.templateVersionId,
            dueAt: cycle.managerDueAt,
          },
        });
        created += 1;
      }
    }

    if (cycle.peerReviewEnabled && cycle.peerReviewTarget > 0) {
      const existingPeers = p.assignments.filter((a) => a.kind === 'PEER').length;
      const needed = cycle.peerReviewTarget - existingPeers;
      if (needed > 0) {
        // Default peers: colleagues who share a manager. HR can change them.
        const siblings = (childrenOf.get(e.managerId) ?? []).filter((id) => id !== e.id);
        const chosen = siblings.slice(0, needed);
        for (const peerId of chosen) {
          if (has('PEER', peerId)) continue;
          await prisma.reviewAssignment.create({
            data: {
              participantId: p.id,
              reviewerEmployeeId: peerId,
              kind: 'PEER',
              templateVersionId: p.templateVersionId,
              dueAt: cycle.peerDueAt ?? cycle.managerDueAt,
            },
          });
          created += 1;
        }
        if (chosen.length < needed) {
          skipped.push({
            name,
            reason: `Only ${chosen.length} of ${cycle.peerReviewTarget} peer reviewers could be chosen automatically. Assign the rest by hand.`,
          });
        }
      }
    }
  }

  return { assignments: created, skipped };
}

export async function launchCycle(
  actor: Actor,
  cycleId: string,
): Promise<{ participants: number; assignments: number; skipped: { name: string; reason: string }[] }> {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can launch a cycle.');

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    include: {
      participants: { select: { id: true } },
      templateVersion: { include: { template: { select: { name: true } } } },
    },
  });
  if (!cycle) throw new NotFoundError();
  if (cycle.status === 'ACTIVE') throw new ConflictError('This cycle has already been launched.');
  if (cycle.status === 'CLOSED' || cycle.status === 'CANCELLED') {
    throw new ConflictError('This cycle is closed.');
  }
  if (cycle.participants.length === 0) {
    throw new ConflictError('Add at least one person before launching.');
  }
  if (!cycle.templateVersion.publishedAt) {
    throw new ConflictError('The template version this cycle uses has not been published.');
  }

  const result = await generateAssignments(actor, cycleId);

  await prisma.reviewCycle.update({
    where: { id: cycleId },
    data: { status: 'ACTIVE', launchedAt: new Date() },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.CYCLE_LAUNCHED,
    entityType: 'review_cycle',
    entityId: cycleId,
    summary: `Launched "${cycle.name}" to ${cycle.participants.length} participants, creating ${result.assignments} review assignments. Each participant's manager, job title and department were snapshotted at this moment.`,
    metadata: {
      participants: cycle.participants.length,
      assignments: result.assignments,
      skipped: result.skipped.length,
    },
  });

  // Notify every reviewer about what they now owe.
  const assignments = await prisma.reviewAssignment.findMany({
    where: { participant: { cycleId } },
    include: {
      participant: { include: { employee: { select: { firstName: true, lastName: true, preferredName: true } } } },
    },
  });

  for (const a of assignments) {
    const subject = `${a.participant.employee.preferredName || a.participant.employee.firstName} ${a.participant.employee.lastName}`;
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: a.reviewerEmployeeId,
      type: 'review.assigned',
      title:
        a.kind === 'SELF'
          ? `Your self-assessment for ${cycle.name} is ready`
          : a.kind === 'PEER'
            ? `You have been asked for peer feedback on ${subject}`
            : `Your manager review of ${subject} is ready`,
      body: a.dueAt
        ? `Due ${a.dueAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
        : undefined,
      linkUrl: `/reviews/assignments/${a.id}`,
      dedupeKey: `review.assigned:${a.id}`,
      email: {
        subject: a.kind === 'SELF' ? `Your self-assessment for ${cycle.name}` : `A review is waiting for you`,
        text: `${cycle.name} has started.\n\n${
          a.kind === 'SELF'
            ? 'Your self-assessment is ready to complete.'
            : `You have been assigned a ${a.kind.toLowerCase()} review of ${subject}.`
        }${a.dueAt ? `\n\nIt is due ${a.dueAt.toLocaleDateString('en-US')}.` : ''}\n\nOpen it here: ${process.env.APP_URL ?? 'http://localhost:3000'}/reviews/assignments/${a.id}`,
      },
    });
  }

  return { participants: cycle.participants.length, assignments: result.assignments, skipped: result.skipped };
}

export async function closeCycle(actor: Actor, cycleId: string) {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can close a cycle.');
  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    include: { participants: { select: { status: true } } },
  });
  if (!cycle) throw new NotFoundError();
  if (cycle.status !== 'ACTIVE') throw new ConflictError('Only an active cycle can be closed.');

  const unreleased = cycle.participants.filter(
    (p) => !['RELEASED', 'ACKNOWLEDGED', 'CLOSED'].includes(p.status),
  ).length;

  await prisma.$transaction(async (tx) => {
    await tx.reviewCycle.update({
      where: { id: cycleId },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    // Released and acknowledged records move to CLOSED; anything unreleased
    // keeps its state so the record stays honest about what happened.
    await tx.cycleParticipant.updateMany({
      where: { cycleId, status: { in: ['RELEASED', 'ACKNOWLEDGED'] } },
      data: { status: 'CLOSED' },
    });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.CYCLE_CLOSED,
    entityType: 'review_cycle',
    entityId: cycleId,
    summary: `Closed "${cycle.name}".${unreleased > 0 ? ` ${unreleased} review${unreleased === 1 ? ' was' : 's were'} never released and keep their unfinished state.` : ''}`,
    metadata: { unreleased },
  });

  return { unreleased };
}

export async function cancelCycle(actor: Actor, cycleId: string, reason: string) {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const cycle = await prisma.reviewCycle.findFirst({ where: { id: cycleId, orgId: actor.orgId } });
  if (!cycle) throw new NotFoundError();
  if (cycle.status === 'CLOSED') throw new ConflictError('This cycle is already closed.');
  if (!reason || reason.trim().length < 10) {
    throw new ValidationError('Record a reason of at least 10 characters.');
  }

  await prisma.reviewCycle.update({
    where: { id: cycleId },
    data: { status: 'CANCELLED', closedAt: new Date() },
  });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.CYCLE_CANCELLED,
    entityType: 'review_cycle',
    entityId: cycleId,
    summary: `Cancelled "${cycle.name}". ${reason.trim()}`,
  });
}

export async function assignReviewer(
  actor: Actor,
  participantId: string,
  reviewerEmployeeId: string,
  kind: string,
) {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const participant = await prisma.cycleParticipant.findFirst({
    where: { id: participantId, cycle: { orgId: actor.orgId } },
    include: { cycle: true, employee: { select: { firstName: true, lastName: true } } },
  });
  if (!participant) throw new NotFoundError();
  if (reviewerEmployeeId === participant.employeeId && kind !== 'SELF') {
    throw new ValidationError('Someone cannot be their own peer or manager reviewer.');
  }

  const reviewer = await prisma.employee.findFirst({
    where: { id: reviewerEmployeeId, orgId: actor.orgId, employmentStatus: { not: 'terminated' } },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!reviewer) throw new ValidationError('That reviewer cannot be assigned.');

  const existing = await prisma.reviewAssignment.findFirst({
    where: { participantId, reviewerEmployeeId, kind },
  });
  if (existing) throw new ConflictError('That person is already assigned this review.');

  const assignment = await prisma.reviewAssignment.create({
    data: {
      participantId,
      reviewerEmployeeId,
      kind,
      templateVersionId: participant.templateVersionId,
      dueAt:
        kind === 'SELF'
          ? participant.cycle.selfDueAt
          : kind === 'MANAGER'
            ? participant.cycle.managerDueAt
            : (participant.cycle.peerDueAt ?? participant.cycle.managerDueAt),
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEWER_ASSIGNED,
    entityType: 'cycle_participant',
    entityId: participantId,
    summary: `Assigned ${reviewer.firstName} ${reviewer.lastName} a ${kind.toLowerCase()} review of ${participant.employee.firstName} ${participant.employee.lastName}.`,
  });

  if (participant.cycle.status === 'ACTIVE') {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: reviewerEmployeeId,
      type: 'review.assigned',
      title: `You have been assigned a ${kind.toLowerCase()} review of ${participant.employee.firstName} ${participant.employee.lastName}`,
      linkUrl: `/reviews/assignments/${assignment.id}`,
      dedupeKey: `review.assigned:${assignment.id}`,
    });
  }
  return assignment;
}

export async function unassignReviewer(actor: Actor, assignmentId: string) {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const assignment = await prisma.reviewAssignment.findFirst({
    where: { id: assignmentId, participant: { cycle: { orgId: actor.orgId } } },
    include: {
      reviewer: { select: { firstName: true, lastName: true } },
      participant: { include: { employee: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!assignment) throw new NotFoundError();
  if (assignment.status === 'SUBMITTED') {
    throw new ConflictError(
      'This review has been submitted. Removing it would delete somebody’s completed work. Reopen it instead if it needs changing.',
    );
  }

  await prisma.reviewAssignment.delete({ where: { id: assignmentId } });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEWER_UNASSIGNED,
    entityType: 'cycle_participant',
    entityId: assignment.participantId,
    summary: `Removed ${assignment.reviewer.firstName} ${assignment.reviewer.lastName} as a ${assignment.kind.toLowerCase()} reviewer of ${assignment.participant.employee.firstName} ${assignment.participant.employee.lastName}.`,
  });
}

/** Sends a reminder to everyone with an outstanding assignment. */
export async function sendCycleReminders(actor: Actor, cycleId: string): Promise<{ sent: number }> {
  if (!canManageCycles(actor)) throw new ForbiddenError('Only an HR administrator can do that.');
  const cycle = await prisma.reviewCycle.findFirst({ where: { id: cycleId, orgId: actor.orgId } });
  if (!cycle) throw new NotFoundError();
  if (cycle.status !== 'ACTIVE') throw new ConflictError('Only an active cycle can send reminders.');

  const outstanding = await prisma.reviewAssignment.findMany({
    where: { participant: { cycleId }, status: { in: ['NOT_STARTED', 'DRAFT', 'REOPENED'] } },
    include: {
      participant: { include: { employee: { select: { firstName: true, lastName: true } } } },
    },
  });

  const today = new Date().toDateString();
  for (const a of outstanding) {
    const overdue = a.dueAt !== null && a.dueAt < new Date();
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: a.reviewerEmployeeId,
      type: 'review.reminder',
      title:
        a.kind === 'SELF'
          ? `Reminder: your self-assessment for ${cycle.name}`
          : `Reminder: your review of ${a.participant.employee.firstName} ${a.participant.employee.lastName}`,
      body: a.dueAt
        ? overdue
          ? `This was due ${a.dueAt.toLocaleDateString('en-US')}.`
          : `Due ${a.dueAt.toLocaleDateString('en-US')}.`
        : undefined,
      linkUrl: `/reviews/assignments/${a.id}`,
      severity: overdue ? 'urgent' : 'warning',
      // One reminder per assignment per day regardless of how often this runs.
      dedupeKey: `review.reminder:${a.id}:${today}`,
    });
  }

  return { sent: outstanding.length };
}
