import 'server-only';
import { z } from 'zod';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { canRunCalibration } from '../authz/policy';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { formatScore } from '@/lib/utils';
import type { ParticipantStatus } from '@/lib/enums';
import type { CalibrationSessionSchema } from '../validation/admin';

/**
 * Calibration: comparing a cohort's scores side by side before anything is
 * released, and recording what was decided.
 *
 * Three rules shape this module.
 *
 *  1. **A calibration session changes nothing by itself.** It is a workspace.
 *     Scores move only when a person records a decision, and a decision cannot
 *     be saved without a written reason.
 *
 *  2. **The original score is frozen when the session opens.** `originalScore`
 *     is copied once and never recomputed, so "what the reviews actually said"
 *     survives however many times the number is later adjusted. Without that,
 *     an adjustment would overwrite its own baseline and the audit trail would
 *     be a list of changes with nothing to compare against.
 *
 *  3. **Released results are out of scope.** Once an employee has read their
 *     review, the score behind it is not a thing a meeting gets to revise.
 *     Such participants are excluded when a session is created and refused if
 *     one is somehow still in an open session.
 *
 * Nothing here is automatic. There is deliberately no "normalise to a curve"
 * action: a distribution target is an input to a human conversation, not a
 * transformation to apply to people's records.
 */

type SessionInput = z.infer<typeof CalibrationSessionSchema>;

/**
 * Participant states whose score is settled enough to compare, but not yet
 * released.
 *
 * Typed as ParticipantStatus so a value that is not a real participant state
 * fails the build. An earlier version of this list read
 * `['SUBMITTED', 'IN_APPROVAL', 'APPROVED']` — SUBMITTED and IN_APPROVAL are
 * *assignment* statuses, not participant ones, so the filter silently matched
 * only APPROVED and quietly left half the eligible cohort out of every session.
 * Nothing errored; the list was just short, which is the worst way for a
 * filter to be wrong.
 */
const CALIBRATABLE_STATUSES: readonly ParticipantStatus[] = [
  'AWAITING_APPROVAL',
  'APPROVED',
] as const;

function requireCalibrator(actor: Actor): void {
  if (!canRunCalibration(actor)) {
    throw new ForbiddenError('Only an HR administrator can run a calibration session.');
  }
}

export async function listCalibrationSessions(actor: Actor) {
  requireCalibrator(actor);
  return prisma.calibrationSession.findMany({
    where: { orgId: actor.orgId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      cycle: { select: { id: true, name: true, status: true } },
      facilitator: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { entries: true } },
    },
  });
}

/** Cycles with participants worth calibrating, for the create form. */
export async function calibratableCycles(actor: Actor) {
  requireCalibrator(actor);
  const cycles = await prisma.reviewCycle.findMany({
    where: { orgId: actor.orgId, status: { in: ['ACTIVE', 'CLOSED'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      _count: {
        select: {
          participants: { where: { status: { in: [...CALIBRATABLE_STATUSES] } } },
        },
      },
    },
  });
  return cycles.filter((c) => c._count.participants > 0);
}

export async function createCalibrationSession(actor: Actor, input: SessionInput) {
  requireCalibrator(actor);

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: input.cycleId, orgId: actor.orgId },
    select: { id: true, name: true },
  });
  if (!cycle) throw new NotFoundError();

  // Only participants whose reviews are in and not yet released. Releasing is
  // the line: after it, the score is a record the employee has read.
  const eligible = await prisma.cycleParticipant.findMany({
    where: {
      cycleId: cycle.id,
      status: { in: [...CALIBRATABLE_STATUSES] },
      ...(input.participantIds?.length ? { id: { in: input.participantIds } } : {}),
    },
    select: { id: true, finalScore: true, calibratedScore: true },
  });

  if (eligible.length === 0) {
    throw new ConflictError(
      'No participants in that cycle are ready to calibrate. A review has to be submitted and not yet ' +
        'released — there is nothing to compare before the first, and nothing to revise after the last.',
    );
  }

  const session = await prisma.calibrationSession.create({
    data: {
      orgId: actor.orgId,
      cycleId: cycle.id,
      name: input.name,
      notes: input.notes ?? null,
      facilitatorEmployeeId: input.facilitatorEmployeeId ?? actor.employeeId,
      status: 'IN_PROGRESS',
      entries: {
        create: eligible.map((p) => ({
          participantId: p.id,
          // Frozen here, once. Any later adjustment is measured against this.
          originalScore: p.calibratedScore ?? p.finalScore,
        })),
      },
    },
    include: { _count: { select: { entries: true } } },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.CALIBRATION_SESSION_CREATED,
    entityType: 'calibration_session',
    entityId: session.id,
    summary: `Opened calibration session "${session.name}" over ${eligible.length} participant(s) of ${cycle.name}`,
    metadata: { cycleId: cycle.id, participantCount: eligible.length },
  });

  return session;
}

export async function getCalibrationSession(actor: Actor, id: string) {
  requireCalibrator(actor);

  const session = await prisma.calibrationSession.findFirst({
    where: { id, orgId: actor.orgId },
    include: {
      cycle: {
        select: {
          id: true,
          name: true,
          status: true,
          templateVersion: {
            select: {
              versionNumber: true,
              template: { select: { name: true } },
            },
          },
        },
      },
      facilitator: { select: { id: true, firstName: true, lastName: true } },
      entries: {
        include: {
          decidedBy: { select: { id: true, firstName: true, lastName: true } },
          participant: {
            select: {
              id: true,
              status: true,
              finalScore: true,
              calibratedScore: true,
              calibrationNote: true,
              releasedAt: true,
              managerNameSnapshot: true,
              jobTitleNameSnapshot: true,
              departmentNameSnapshot: true,
              employee: {
                select: { id: true, firstName: true, lastName: true, preferredName: true },
              },
            },
          },
        },
      },
    },
  });
  if (!session) throw new NotFoundError();

  // Sorted by the score under discussion, descending, because that is the order
  // the conversation actually happens in.
  const entries = [...session.entries].sort((a, b) => {
    const left = currentScore(a);
    const right = currentScore(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  });

  return { ...session, entries, distribution: distributionOf(entries) };
}

type EntryLike = {
  finalScore: number | null;
  proposedScore: number | null;
  originalScore: number | null;
  participant: { calibratedScore: number | null; finalScore: number | null };
};

/** The score as it stands now: a recorded decision wins, then the proposal, then the original. */
function currentScore(entry: EntryLike): number | null {
  if (entry.finalScore !== null) return entry.finalScore;
  if (entry.proposedScore !== null) return entry.proposedScore;
  return entry.participant.calibratedScore ?? entry.participant.finalScore ?? entry.originalScore;
}

export { currentScore as calibrationCurrentScore };

/**
 * Buckets for the distribution view, with the denominator stated. Participants
 * with no score are counted separately and never folded into a band — a missing
 * score is not a low one.
 */
export function distributionOf(entries: EntryLike[]): {
  bands: { label: string; min: number; max: number; before: number; after: number }[];
  scored: number;
  unscored: number;
  total: number;
} {
  const bands = [
    { label: '0–59', min: 0, max: 59.999 },
    { label: '60–69', min: 60, max: 69.999 },
    { label: '70–79', min: 70, max: 79.999 },
    { label: '80–89', min: 80, max: 89.999 },
    { label: '90–100', min: 90, max: 100 },
  ].map((b) => ({ ...b, before: 0, after: 0 }));

  let scored = 0;
  let unscored = 0;

  for (const entry of entries) {
    const before = entry.originalScore;
    const after = currentScore(entry);
    if (after === null) unscored += 1;
    else scored += 1;
    for (const band of bands) {
      if (before !== null && before >= band.min && before <= band.max) band.before += 1;
      if (after !== null && after >= band.min && after <= band.max) band.after += 1;
    }
  }

  return { bands, scored, unscored, total: entries.length };
}

/**
 * Records a proposal. Proposals are explicitly *not* applied to the
 * participant: they are what the room is arguing about, and a proposal nobody
 * ratified must never end up on someone's review.
 */
export async function proposeCalibration(
  actor: Actor,
  sessionId: string,
  participantId: string,
  proposedScore: number | null,
  rationale: string | null,
): Promise<void> {
  requireCalibrator(actor);
  const { entry } = await loadOpenEntry(actor, sessionId, participantId);

  await prisma.calibrationEntry.update({
    where: { id: entry.id },
    data: {
      proposedScore,
      rationale: rationale?.trim() || entry.rationale,
    },
  });
}

/**
 * Ratifies a decision: writes it to the entry *and* applies it to the
 * participant's record, with the reason, the person and the time.
 *
 * A decision that changes nothing is allowed and recorded — "we looked at this
 * and left it alone" is a real outcome, and a later reader deserves to know it
 * was considered rather than skipped.
 */
export async function decideCalibration(
  actor: Actor,
  sessionId: string,
  participantId: string,
  finalScore: number | null,
  rationale: string,
): Promise<void> {
  requireCalibrator(actor);
  if (!actor.employeeId) {
    throw new ForbiddenError('A calibration decision has to be attributable to a person.');
  }

  const { entry, participant } = await loadOpenEntry(actor, sessionId, participantId);

  const reason = rationale.trim();
  if (reason.length < 10) {
    throw new ValidationError(
      'Record why this was decided, in at least 10 characters. The reason is kept with the decision and ' +
        'shown to whoever reads the score later.',
      [{ path: 'rationale', message: 'Give a reason of at least 10 characters.' }],
    );
  }
  if (finalScore !== null && (finalScore < 0 || finalScore > 100)) {
    throw new ValidationError('A calibrated score must be between 0 and 100.');
  }

  const unchanged = finalScore === (participant.calibratedScore ?? participant.finalScore);

  await prisma.$transaction(async (tx) => {
    await tx.calibrationEntry.update({
      where: { id: entry.id },
      data: {
        finalScore,
        rationale: reason,
        decidedByEmployeeId: actor.employeeId,
        decidedAt: new Date(),
      },
    });

    // Only touch the participant when the decision actually moves the number.
    // Recording "no change" on the entry is the right place for it; stamping a
    // calibration override onto the review would imply an adjustment that was
    // never made.
    if (!unchanged) {
      await tx.cycleParticipant.update({
        where: { id: participantId },
        data: {
          calibratedScore: finalScore,
          calibrationNote: reason,
          calibratedById: actor.userId,
          calibratedAt: new Date(),
        },
      });
    }
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEW_SCORE_CALIBRATED,
    entityType: 'cycle_participant',
    entityId: participantId,
    summary: unchanged
      ? `Calibration reviewed ${participant.employee.firstName} ${participant.employee.lastName} and left the score at ${formatScore(participant.finalScore)}`
      : `Calibration changed ${participant.employee.firstName} ${participant.employee.lastName} from ${formatScore(entry.originalScore)} to ${finalScore === null ? 'no score' : formatScore(finalScore)}`,
    metadata: {
      sessionId,
      original: entry.originalScore,
      computed: participant.finalScore,
      decided: finalScore,
      unchanged,
      reason,
    },
  });
}

/** Clears a recorded decision, putting the computed score back. */
export async function revertCalibration(
  actor: Actor,
  sessionId: string,
  participantId: string,
): Promise<void> {
  requireCalibrator(actor);
  const { entry, participant } = await loadOpenEntry(actor, sessionId, participantId);

  await prisma.$transaction(async (tx) => {
    await tx.calibrationEntry.update({
      where: { id: entry.id },
      data: { finalScore: null, decidedByEmployeeId: null, decidedAt: null },
    });
    await tx.cycleParticipant.update({
      where: { id: participantId },
      data: {
        calibratedScore: null,
        calibrationNote: null,
        calibratedById: null,
        calibratedAt: null,
      },
    });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEW_SCORE_CALIBRATED,
    entityType: 'cycle_participant',
    entityId: participantId,
    summary: `Reverted the calibration adjustment for ${participant.employee.firstName} ${participant.employee.lastName}; the calculated score applies again`,
    metadata: { sessionId, revertedFrom: entry.finalScore },
  });
}

async function loadOpenEntry(actor: Actor, sessionId: string, participantId: string) {
  const entry = await prisma.calibrationEntry.findFirst({
    where: {
      sessionId,
      participantId,
      session: { orgId: actor.orgId },
    },
    include: {
      session: { select: { id: true, status: true, name: true } },
      participant: {
        select: {
          id: true,
          status: true,
          finalScore: true,
          calibratedScore: true,
          releasedAt: true,
          employee: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!entry) throw new NotFoundError();

  if (entry.session.status === 'FINALIZED') {
    throw new ConflictError(
      'This session has been finalised, so its decisions are closed. Open a new session if something needs ' +
        'revisiting — the record of what was decided here stays as it is.',
    );
  }
  if (entry.participant.releasedAt) {
    throw new ConflictError(
      `${entry.participant.employee.firstName} ${entry.participant.employee.lastName}'s results have already been ` +
        'released. Changing the score now would alter a record they have read.',
    );
  }

  return { entry, participant: entry.participant };
}

/**
 * Closes the session. Every entry must have been looked at — either decided, or
 * explicitly left alone — so a session cannot be closed with people in it
 * nobody discussed.
 */
export async function finalizeCalibrationSession(
  actor: Actor,
  sessionId: string,
  notes: string | null,
): Promise<{ decided: number; unchanged: number }> {
  requireCalibrator(actor);

  const session = await prisma.calibrationSession.findFirst({
    where: { id: sessionId, orgId: actor.orgId },
    include: {
      entries: { select: { id: true, decidedAt: true, finalScore: true, originalScore: true } },
    },
  });
  if (!session) throw new NotFoundError();
  if (session.status === 'FINALIZED') {
    throw new ConflictError('This session is already finalised.');
  }

  const undecided = session.entries.filter((e) => e.decidedAt === null);
  if (undecided.length > 0) {
    throw new ConflictError(
      `${undecided.length} of ${session.entries.length} participants have no recorded decision. Record one for ` +
        'each — leaving a score unchanged is a decision and takes a reason too, which is what makes the session ' +
        'a record rather than a guess about who was discussed.',
      { undecided: undecided.length, total: session.entries.length },
    );
  }

  const changed = session.entries.filter((e) => e.finalScore !== e.originalScore).length;

  await prisma.calibrationSession.update({
    where: { id: sessionId },
    data: {
      status: 'FINALIZED',
      finalizedAt: new Date(),
      notes: notes?.trim() ?? session.notes,
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.CALIBRATION_FINALIZED,
    entityType: 'calibration_session',
    entityId: sessionId,
    summary: `Finalised calibration session "${session.name}": ${session.entries.length} reviewed, ${changed} adjusted`,
    metadata: { reviewed: session.entries.length, adjusted: changed },
  });

  return { decided: changed, unchanged: session.entries.length - changed };
}
