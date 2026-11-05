import 'server-only';
import { prisma, type Db } from '../db';
import type { Actor } from '../authz/actor';
import { managerChainAt } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import {
  canEditAssignment,
  canReleaseParticipant,
  canReopenAssignment,
  canSeePeerReviewerIdentity,
  canViewAssignmentContent,
  canViewOwnAssignment,
  canViewParticipantScore,
  isReleased,
  participantAccess,
  type ParticipantAccess,
} from '../authz/policy';
import {
  computeFinalScore,
  scoreReview,
  type ScoringAnswer,
  type ScoringSection,
} from '../scoring/review-score';
import { computeGoalProgress } from '../scoring/goal-progress';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { notify } from '../notify';
import { parseJsonArray, safeJsonParse } from '@/lib/utils';

/**
 * Review workflow.
 *
 * Every read and write in the review module goes through this file. Pages and
 * API routes do not query review tables directly, which is what makes the
 * authorization rules hold for a direct API call as well as for a click.
 *
 * The lifecycle this implements, and the states it moves between, are a design
 * decision — PerformYard does not publish its own state names. See
 * docs/ARCHITECTURE.md ("Review lifecycle").
 *
 *   Cycle:      DRAFT -> SCHEDULED -> ACTIVE -> CLOSED   (or CANCELLED)
 *   Assignment: NOT_STARTED -> DRAFT -> SUBMITTED (-> REOPENED -> SUBMITTED)
 *   Participant: NOT_STARTED -> IN_PROGRESS -> [AWAITING_APPROVAL ->] APPROVED
 *                -> RELEASED -> ACKNOWLEDGED -> CLOSED
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export interface RenderedChoice {
  value: string;
  label: string;
}

export interface RenderedQuestion {
  id: string;
  /** Unique per rendered row: questionId + subjectKey. */
  key: string;
  subjectKey: string;
  subjectLabel?: string;
  subjectDetail?: string;
  type: string;
  prompt: string;
  helpText: string | null;
  required: boolean;
  weight: number;
  allowNotApplicable: boolean;
  commentEnabled: boolean;
  commentRequired: boolean;
  maxLength: number | null;
  choices: RenderedChoice[];
  scale: {
    id: string;
    name: string;
    description: string | null;
    levels: { value: number; label: string; description: string | null }[];
  } | null;
  competency: { id: string; name: string; description: string | null; behaviors: { level: string; descriptor: string }[] } | null;
  answer: {
    textValue: string | null;
    numericValue: number | null;
    choices: string[];
    commentValue: string | null;
    notApplicable: boolean;
  };
}

export interface RenderedSection {
  id: string;
  title: string;
  instructions: string | null;
  weight: number;
  questions: RenderedQuestion[];
}

export interface RenderedForm {
  sections: RenderedSection[];
  /** Sections and questions that this reviewer kind does not answer. */
  hiddenSectionCount: number;
}

function appliesToKind(sectionAppliesTo: string, questionAppliesTo: string | null, kind: string): boolean {
  const spec = (questionAppliesTo && questionAppliesTo.trim()) || sectionAppliesTo;
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(kind);
}

// ---------------------------------------------------------------------------
// Loading a form
// ---------------------------------------------------------------------------

interface GoalForForm {
  id: string;
  title: string;
  detail: string;
}

/**
 * Goals shown inside a review.
 *
 * Before results are finalized these come live from the Goals module, so a
 * manager sees current progress. Once a review has been released the frozen
 * ReviewGoalSnapshot rows are used instead, so later goal edits cannot rewrite
 * what the review was based on.
 */
async function goalsForParticipant(
  participantId: string,
  employeeId: string,
  periodStart: Date,
  periodEnd: Date,
  useSnapshot: boolean,
  db: Db = prisma,
): Promise<GoalForForm[]> {
  if (useSnapshot) {
    const snapshots = await db.reviewGoalSnapshot.findMany({
      where: { participantId },
      orderBy: { capturedAt: 'asc' },
    });
    if (snapshots.length > 0) {
      return snapshots.map((s) => ({
        id: s.goalId ?? s.id,
        title: s.titleSnapshot,
        detail: [
          s.statusSnapshot.replace(/_/g, ' ').toLowerCase(),
          s.progressSnapshot !== null ? `${Math.round(s.progressSnapshot)}% at the time` : null,
          s.targetSnapshot ? `target ${s.targetSnapshot}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }));
    }
  }

  const goals = await db.goal.findMany({
    where: {
      ownerEmployeeId: employeeId,
      OR: [
        { startDate: { lte: periodEnd }, dueDate: { gte: periodStart } },
        { startDate: { lte: periodEnd }, dueDate: null },
        { startDate: null, dueDate: { gte: periodStart } },
      ],
    },
    include: { milestones: { select: { completedAt: true, weight: true } } },
    orderBy: { dueDate: 'asc' },
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
      detail: [
        g.status.replace(/_/g, ' ').toLowerCase(),
        progress.displayPct !== null
          ? `${Math.round(progress.displayPct)}% ${progress.source === 'COMPUTED' ? 'calculated' : 'reported'}`
          : 'no progress recorded',
        g.targetValue !== null ? `target ${g.targetValue}${g.unit ? ` ${g.unit}` : ''}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  });
}

async function buildForm(
  templateVersionId: string,
  kind: string,
  assignmentId: string | null,
  goals: GoalForForm[],
  db: Db = prisma,
): Promise<RenderedForm> {
  const version = await db.reviewTemplateVersion.findUnique({
    where: { id: templateVersionId },
    include: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        include: {
          questions: {
            orderBy: { sortOrder: 'asc' },
            include: {
              ratingScale: { include: { levels: { orderBy: { value: 'asc' } } } },
              competency: { include: { behaviors: { orderBy: { sortOrder: 'asc' } } } },
            },
          },
        },
      },
    },
  });
  if (!version) throw new NotFoundError('That review form could not be found.');

  const responses = assignmentId
    ? await db.reviewResponse.findMany({ where: { assignmentId } })
    : [];
  const byKey = new Map(responses.map((r) => [`${r.questionId}::${r.subjectKey}`, r]));

  const sections: RenderedSection[] = [];
  let hiddenSectionCount = 0;

  for (const section of version.sections) {
    const visibleQuestions = section.questions.filter((q) =>
      appliesToKind(section.appliesTo, q.appliesTo, kind),
    );
    if (visibleQuestions.length === 0) {
      hiddenSectionCount += 1;
      continue;
    }

    const rendered: RenderedQuestion[] = [];

    for (const q of visibleQuestions) {
      const base = {
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        helpText: q.helpText,
        required: q.required,
        weight: q.weight,
        allowNotApplicable: q.allowNotApplicable,
        commentEnabled: q.commentEnabled,
        commentRequired: q.commentRequired,
        maxLength: q.maxLength,
        choices: parseJsonArray(q.choicesJson).map((c) => ({ value: c, label: c })),
        scale: q.ratingScale
          ? {
              id: q.ratingScale.id,
              name: q.ratingScale.name,
              description: q.ratingScale.description,
              levels: q.ratingScale.levels.map((l) => ({
                value: l.value,
                label: l.label,
                description: l.description,
              })),
            }
          : null,
        competency: q.competency
          ? {
              id: q.competency.id,
              name: q.competency.name,
              description: q.competency.description,
              behaviors: q.competency.behaviors.map((b) => ({
                level: b.level,
                descriptor: b.descriptor,
              })),
            }
          : null,
      };

      const makeAnswer = (subjectKey: string) => {
        const r = byKey.get(`${q.id}::${subjectKey}`);
        return {
          textValue: r?.textValue ?? null,
          numericValue: r?.numericValue ?? null,
          choices: safeJsonParse<string[]>(r?.choiceJson, []),
          commentValue: r?.commentValue ?? null,
          notApplicable: r?.notApplicable ?? false,
        };
      };

      if (q.type === 'GOAL_REVIEW') {
        // Repeats once per goal in scope. With no goals the question simply
        // does not appear, rather than showing an empty widget.
        for (const goal of goals) {
          rendered.push({
            ...base,
            key: `${q.id}::${goal.id}`,
            subjectKey: goal.id,
            subjectLabel: goal.title,
            subjectDetail: goal.detail,
            answer: makeAnswer(goal.id),
          });
        }
        continue;
      }

      rendered.push({
        ...base,
        key: `${q.id}::`,
        subjectKey: '',
        subjectLabel: q.competency?.name,
        answer: makeAnswer(''),
      });
    }

    if (rendered.length === 0) {
      hiddenSectionCount += 1;
      continue;
    }

    sections.push({
      id: section.id,
      title: section.title,
      instructions: section.instructions,
      weight: section.weight,
      questions: rendered,
    });
  }

  return { sections, hiddenSectionCount };
}

// ---------------------------------------------------------------------------
// Reading an assignment (the form the reviewer fills in)
// ---------------------------------------------------------------------------

export async function getAssignmentForEditing(actor: Actor, assignmentId: string) {
  const assignment = await prisma.reviewAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      participant: {
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              jobTitle: { select: { name: true } },
              department: { select: { name: true } },
              hireDate: true,
            },
          },
          cycle: true,
        },
      },
      reviewer: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
    },
  });

  if (!assignment || assignment.participant.cycle.orgId !== actor.orgId) {
    throw new NotFoundError();
  }
  if (!canViewOwnAssignment(actor, assignment)) {
    // A reviewer's own working copy is not readable by anyone else, so this is
    // a 404 rather than a 403 — the existence of the draft is itself private.
    throw new NotFoundError();
  }

  const cycle = assignment.participant.cycle;
  if (cycle.status === 'DRAFT' || cycle.status === 'CANCELLED') {
    throw new NotFoundError('That review is not open.');
  }

  const editable = canEditAssignment(actor, assignment);

  const goals =
    assignment.kind === 'PEER'
      ? []
      : await goalsForParticipant(
          assignment.participantId,
          assignment.participant.employeeId,
          cycle.periodStart,
          cycle.periodEnd,
          false,
        );

  const form = await buildForm(assignment.templateVersionId, assignment.kind, assignment.id, goals);

  // A manager writing their review may see the employee's submitted
  // self-assessment when the cycle allows it. Draft self-assessments are never
  // shown, whatever the setting.
  let selfReview: { sections: RenderedSection[]; submittedAt: Date | null } | null = null;
  if (assignment.kind === 'MANAGER' && cycle.shareSelfWithManager) {
    const selfAssignment = await prisma.reviewAssignment.findFirst({
      where: { participantId: assignment.participantId, kind: 'SELF', status: 'SUBMITTED' },
    });
    if (selfAssignment) {
      const selfForm = await buildForm(
        selfAssignment.templateVersionId,
        'SELF',
        selfAssignment.id,
        goals,
      );
      selfReview = { sections: selfForm.sections, submittedAt: selfAssignment.submittedAt };
    }
  }

  return {
    assignment: {
      id: assignment.id,
      kind: assignment.kind,
      status: assignment.status,
      dueAt: assignment.dueAt,
      lastSavedAt: assignment.lastSavedAt,
      submittedAt: assignment.submittedAt,
      reopenReason: assignment.reopenReason,
      submissionCount: assignment.submissionCount,
    },
    participant: {
      id: assignment.participantId,
      status: assignment.participant.status,
      employee: assignment.participant.employee,
      jobTitleSnapshot: assignment.participant.jobTitleNameSnapshot,
      departmentSnapshot: assignment.participant.departmentNameSnapshot,
    },
    cycle: {
      id: cycle.id,
      name: cycle.name,
      description: cycle.description,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      peerVisibilityMode: cycle.peerVisibilityMode,
      sharePeerWithEmployee: cycle.sharePeerWithEmployee,
    },
    form,
    goals,
    selfReview,
    editable,
  };
}

// ---------------------------------------------------------------------------
// Saving and submitting
// ---------------------------------------------------------------------------

export interface AnswerInput {
  questionId: string;
  subjectKey?: string;
  textValue?: string | null;
  numericValue?: number | null;
  choices?: string[] | null;
  commentValue?: string | null;
  notApplicable?: boolean;
}

async function loadAssignmentForWrite(actor: Actor, assignmentId: string) {
  const assignment = await prisma.reviewAssignment.findUnique({
    where: { id: assignmentId },
    include: { participant: { include: { cycle: true, employee: true } } },
  });
  if (!assignment || assignment.participant.cycle.orgId !== actor.orgId) throw new NotFoundError();
  return assignment;
}

/** Rejects answers that do not belong to this assignment's template version. */
async function validateAnswerTargets(
  templateVersionId: string,
  answers: AnswerInput[],
  kind: string,
): Promise<Map<string, { type: string; required: boolean; maxLength: number | null; allowNotApplicable: boolean; choices: string[]; scaleValues: number[]; commentRequired: boolean; prompt: string }>> {
  const questions = await prisma.templateQuestion.findMany({
    where: { section: { versionId: templateVersionId } },
    include: {
      section: { select: { appliesTo: true } },
      ratingScale: { include: { levels: { select: { value: true } } } },
    },
  });

  const allowed = new Map<
    string,
    {
      type: string;
      required: boolean;
      maxLength: number | null;
      allowNotApplicable: boolean;
      choices: string[];
      scaleValues: number[];
      commentRequired: boolean;
      prompt: string;
    }
  >();
  for (const q of questions) {
    if (!appliesToKind(q.section.appliesTo, q.appliesTo, kind)) continue;
    allowed.set(q.id, {
      type: q.type,
      required: q.required,
      maxLength: q.maxLength,
      allowNotApplicable: q.allowNotApplicable,
      choices: parseJsonArray(q.choicesJson),
      scaleValues: q.ratingScale?.levels.map((l) => l.value) ?? [],
      commentRequired: q.commentRequired,
      prompt: q.prompt,
    });
  }

  for (const a of answers) {
    const q = allowed.get(a.questionId);
    if (!q) {
      throw new ValidationError(
        'This form has changed since it was opened. Reload the page before saving again.',
      );
    }
    if (a.numericValue !== null && a.numericValue !== undefined && q.scaleValues.length > 0) {
      if (!q.scaleValues.includes(a.numericValue)) {
        throw new ValidationError(`"${q.prompt}" was given a rating that is not on its scale.`);
      }
    }
    if (a.notApplicable && !q.allowNotApplicable) {
      throw new ValidationError(`"${q.prompt}" cannot be marked not applicable.`);
    }
    if (a.choices && a.choices.length > 0 && q.choices.length > 0) {
      const invalid = a.choices.filter((c) => !q.choices.includes(c));
      if (invalid.length > 0) {
        throw new ValidationError(`"${q.prompt}" was given an answer that is not one of its options.`);
      }
    }
    if (a.textValue && q.maxLength && a.textValue.length > q.maxLength) {
      throw new ValidationError(
        `"${q.prompt}" is limited to ${q.maxLength} characters; ${a.textValue.length} were provided.`,
      );
    }
  }

  return allowed;
}

/**
 * Saves a draft. Returns the server's save timestamp so the UI can show an
 * honest "saved at" rather than assuming success.
 */
export async function saveDraft(
  actor: Actor,
  assignmentId: string,
  answers: AnswerInput[],
): Promise<{ savedAt: Date; status: string }> {
  const assignment = await loadAssignmentForWrite(actor, assignmentId);

  if (!canViewOwnAssignment(actor, assignment)) throw new NotFoundError();
  if (!canEditAssignment(actor, assignment)) {
    throw new ConflictError(
      assignment.status === 'SUBMITTED'
        ? 'This review has already been submitted. Ask an HR administrator to reopen it if it needs changing.'
        : 'This review is no longer open for editing.',
    );
  }
  if (assignment.participant.cycle.status !== 'ACTIVE') {
    throw new ConflictError('This review cycle is not open for responses.');
  }

  await validateAnswerTargets(assignment.templateVersionId, answers, assignment.kind);

  const savedAt = new Date();

  await prisma.$transaction(async (tx) => {
    for (const a of answers) {
      const subjectKey = a.subjectKey ?? '';
      const data = {
        textValue: a.textValue ?? null,
        numericValue: a.numericValue ?? null,
        choiceJson: a.choices && a.choices.length > 0 ? JSON.stringify(a.choices) : null,
        commentValue: a.commentValue ?? null,
        notApplicable: a.notApplicable ?? false,
      };
      const empty =
        !data.textValue &&
        data.numericValue === null &&
        !data.choiceJson &&
        !data.commentValue &&
        !data.notApplicable;

      if (empty) {
        await tx.reviewResponse.deleteMany({
          where: { assignmentId, questionId: a.questionId, subjectKey },
        });
        continue;
      }

      await tx.reviewResponse.upsert({
        where: {
          assignmentId_questionId_subjectKey: { assignmentId, questionId: a.questionId, subjectKey },
        },
        create: { assignmentId, questionId: a.questionId, subjectKey, ...data },
        update: data,
      });
    }

    await tx.reviewAssignment.update({
      where: { id: assignmentId },
      data: { lastSavedAt: savedAt, status: assignment.status === 'NOT_STARTED' ? 'DRAFT' : assignment.status },
    });
  });

  return { savedAt, status: assignment.status === 'NOT_STARTED' ? 'DRAFT' : assignment.status };
}

export interface SubmitProblem {
  questionId: string;
  subjectKey: string;
  prompt: string;
  message: string;
}

/**
 * Submits a review.
 *
 * Idempotent by state: submitting an already-submitted assignment is rejected
 * rather than duplicated, so a double-click or a retried request cannot create
 * two submissions or fire two notifications.
 */
export async function submitAssignment(
  actor: Actor,
  assignmentId: string,
  answers: AnswerInput[],
): Promise<{ status: string; score: number | null; participantStatus: string }> {
  const assignment = await loadAssignmentForWrite(actor, assignmentId);
  if (!canViewOwnAssignment(actor, assignment)) throw new NotFoundError();

  if (assignment.status === 'SUBMITTED') {
    throw new ConflictError('This review has already been submitted.');
  }
  if (!canEditAssignment(actor, assignment)) {
    throw new ConflictError('This review is no longer open for editing.');
  }
  if (assignment.participant.cycle.status !== 'ACTIVE') {
    throw new ConflictError('This review cycle is not open for responses.');
  }

  // Persist whatever the reviewer had on screen before validating, so a failed
  // submission never loses their work.
  if (answers.length > 0) await saveDraft(actor, assignmentId, answers);

  const cycle = assignment.participant.cycle;
  const goals =
    assignment.kind === 'PEER'
      ? []
      : await goalsForParticipant(
          assignment.participantId,
          assignment.participant.employeeId,
          cycle.periodStart,
          cycle.periodEnd,
          false,
        );
  const form = await buildForm(assignment.templateVersionId, assignment.kind, assignment.id, goals);

  // Required-field validation, reported per question so the UI can point at them.
  const problems: SubmitProblem[] = [];
  for (const section of form.sections) {
    for (const q of section.questions) {
      if (!q.required) continue;
      const a = q.answer;
      if (a.notApplicable) continue;

      const missing =
        q.type === 'TEXT'
          ? !a.textValue || a.textValue.trim().length === 0
          : q.type === 'RATING' || q.type === 'COMPETENCY_RATING'
            ? a.numericValue === null
            : q.type === 'MULTIPLE_CHOICE'
              ? !a.textValue
              : q.type === 'MULTI_SELECT'
                ? a.choices.length === 0
                : false;

      if (missing) {
        problems.push({
          questionId: q.id,
          subjectKey: q.subjectKey,
          prompt: q.subjectLabel ? `${q.prompt} — ${q.subjectLabel}` : q.prompt,
          message: 'This answer is required.',
        });
        continue;
      }
      if (q.commentRequired && (!a.commentValue || a.commentValue.trim().length === 0)) {
        problems.push({
          questionId: q.id,
          subjectKey: q.subjectKey,
          prompt: q.subjectLabel ? `${q.prompt} — ${q.subjectLabel}` : q.prompt,
          message: 'A written comment is required with this rating.',
        });
      }
    }
  }

  if (problems.length > 0) {
    throw new ValidationError(
      `${problems.length} ${problems.length === 1 ? 'answer is' : 'answers are'} still needed before this can be submitted. Your work has been saved.`,
      problems,
    );
  }

  // Score the submission using the same engine the reports use.
  const scoringSections: ScoringSection[] = form.sections.map((s) => ({
    id: s.id,
    title: s.title,
    weight: s.weight,
    questions: s.questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      weight: q.weight,
      required: q.required,
      subjectKey: q.subjectKey,
      subjectLabel: q.subjectLabel,
      scale: q.scale
        ? { id: q.scale.id, name: q.scale.name, numeric: true, levels: q.scale.levels }
        : null,
    })),
  }));
  const scoringAnswers: ScoringAnswer[] = form.sections.flatMap((s) =>
    s.questions.map((q) => ({
      questionId: q.id,
      subjectKey: q.subjectKey,
      numericValue: q.answer.numericValue,
      notApplicable: q.answer.notApplicable,
      answered: q.answer.numericValue !== null,
    })),
  );
  const result = scoreReview(scoringSections, scoringAnswers);

  const now = new Date();
  let participantStatus = assignment.participant.status;

  await prisma.$transaction(async (tx) => {
    // Guard against a concurrent submit: only transition from an open state.
    const updated = await tx.reviewAssignment.updateMany({
      where: { id: assignmentId, status: { in: ['NOT_STARTED', 'DRAFT', 'REOPENED'] } },
      data: {
        status: 'SUBMITTED',
        submittedAt: now,
        lastSavedAt: now,
        score: result.score,
        scoreJson: JSON.stringify(result),
        submissionCount: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictError('This review has already been submitted.');
    }

    participantStatus = await advanceParticipant(tx, assignment.participantId, actor);
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEW_SUBMITTED,
    entityType: 'review_assignment',
    entityId: assignmentId,
    summary: `Submitted the ${assignment.kind.toLowerCase().replace('_', '-')} review for ${assignment.participant.employee.firstName} ${assignment.participant.employee.lastName}.`,
    metadata: { kind: assignment.kind, cycleId: cycle.id, scored: result.score !== null },
  });

  await notifyOnSubmission(assignment, actor);

  return { status: 'SUBMITTED', score: result.score, participantStatus };
}

/**
 * Recomputes a participant's status and score from its assignments.
 * Called after every submission, reopen or approval decision.
 */
async function advanceParticipant(tx: Db, participantId: string, actor: Actor): Promise<string> {
  const participant = await tx.cycleParticipant.findUniqueOrThrow({
    where: { id: participantId },
    include: {
      assignments: { select: { id: true, kind: true, status: true, score: true } },
      cycle: true,
      templateVersion: { select: { selfWeight: true, managerWeight: true, peerWeight: true } },
      approvals: true,
    },
  });

  // Released and later states are terminal for this calculation: once results
  // are out, a new submission does not quietly change what was released.
  if (['RELEASED', 'ACKNOWLEDGED', 'CLOSED'].includes(participant.status)) {
    return participant.status;
  }

  const final = computeFinalScore(participant.assignments, {
    selfWeight: participant.templateVersion.selfWeight,
    managerWeight: participant.templateVersion.managerWeight,
    peerWeight: participant.templateVersion.peerWeight,
  });

  const managerAssignment = participant.assignments.find((a) => a.kind === 'MANAGER');
  const managerDone = managerAssignment?.status === 'SUBMITTED';
  const anySubmitted = participant.assignments.some((a) => a.status === 'SUBMITTED');

  let status = participant.status;
  if (!managerDone) {
    status = anySubmitted ? 'IN_PROGRESS' : 'NOT_STARTED';
  } else if (participant.cycle.requireApproval) {
    const decided = participant.approvals.find((a) => a.status === 'APPROVED');
    status = decided ? 'APPROVED' : 'AWAITING_APPROVAL';
  } else {
    status = 'APPROVED';
  }

  await tx.cycleParticipant.update({
    where: { id: participantId },
    data: {
      status,
      finalScore: final.score,
      finalScoreJson: JSON.stringify(final),
    },
  });

  // Create the approval request once, pinned to a concrete approver.
  if (status === 'AWAITING_APPROVAL' && participant.approvals.length === 0) {
    const approverId = await resolveApprover(tx, participant.id);
    if (approverId) {
      await tx.reviewApproval.create({
        data: { participantId, approverEmployeeId: approverId, status: 'PENDING' },
      });
      await notify(
        {
          orgId: participant.cycle.orgId,
          recipientEmployeeId: approverId,
          type: 'review.approval.requested',
          title: 'A review is waiting for your approval',
          body: participant.cycle.name,
          linkUrl: `/reviews/participants/${participantId}`,
          severity: 'warning',
          dedupeKey: `review.approval:${participantId}`,
        },
        tx,
      );
    }
  }

  void actor;
  return status;
}

/**
 * Who approves a given participant's review.
 *
 * Resolved against the reporting line as it stood when the cycle launched, not
 * today's, and then stored on the approval row — so a reorganization midway
 * through a cycle does not move an in-flight decision to someone else.
 */
async function resolveApprover(tx: Db, participantId: string): Promise<string | null> {
  const participant = await tx.cycleParticipant.findUniqueOrThrow({
    where: { id: participantId },
    include: { cycle: true },
  });

  if (participant.cycle.approvalAuthority === 'HR_ADMIN') {
    const hr = await tx.user.findFirst({
      where: {
        orgId: participant.cycle.orgId,
        status: 'active',
        roles: { some: { role: 'HR_ADMIN' } },
        employee: { isNot: null },
      },
      select: { employee: { select: { id: true } } },
    });
    return hr?.employee?.id ?? null;
  }

  // MANAGER_OF_MANAGER
  if (!participant.managerIdSnapshot) return null;
  const at = participant.snapshotTakenAt ?? participant.cycle.launchedAt ?? new Date();
  const chain = await managerChainAt(participant.managerIdSnapshot, at);
  return chain[0] ?? null;
}

async function notifyOnSubmission(
  assignment: Awaited<ReturnType<typeof loadAssignmentForWrite>>,
  actor: Actor,
): Promise<void> {
  const cycle = assignment.participant.cycle;
  const subject = assignment.participant.employee;

  if (assignment.kind === 'SELF' && assignment.participant.managerIdSnapshot) {
    await notify({
      orgId: cycle.orgId,
      recipientEmployeeId: assignment.participant.managerIdSnapshot,
      type: 'review.self.submitted',
      title: `${subject.firstName} ${subject.lastName} submitted their self-assessment`,
      body: cycle.shareSelfWithManager
        ? 'You can read it while writing your review.'
        : 'Your review is the next step.',
      linkUrl: `/reviews/participants/${assignment.participantId}`,
      dedupeKey: `review.self.submitted:${assignment.id}`,
    });
  }

  if (assignment.kind === 'MANAGER' && !cycle.requireApproval) {
    const hrUsers = await prisma.user.findMany({
      where: {
        orgId: cycle.orgId,
        status: 'active',
        roles: { some: { role: 'HR_ADMIN' } },
        employee: { isNot: null },
      },
      select: { employee: { select: { id: true } } },
    });
    for (const u of hrUsers) {
      if (!u.employee) continue;
      await notify({
        orgId: cycle.orgId,
        recipientEmployeeId: u.employee.id,
        type: 'review.ready_to_release',
        title: `Review for ${subject.firstName} ${subject.lastName} is ready to release`,
        body: cycle.name,
        linkUrl: `/reviews/participants/${assignment.participantId}`,
        dedupeKey: `review.ready:${assignment.participantId}`,
      });
    }
  }

  void actor;
}

// ---------------------------------------------------------------------------
// Reopening, approving, releasing, acknowledging
// ---------------------------------------------------------------------------

export async function reopenAssignment(
  actor: Actor,
  assignmentId: string,
  reason: string,
): Promise<void> {
  if (!canReopenAssignment(actor)) {
    throw new ForbiddenError(
      'Only an HR administrator can reopen a submitted review. Ask them to reopen it for you.',
    );
  }
  const assignment = await loadAssignmentForWrite(actor, assignmentId);

  if (assignment.status !== 'SUBMITTED') {
    throw new ConflictError('Only a submitted review can be reopened.');
  }
  if (isReleased(assignment.participant)) {
    throw new ConflictError(
      'These results have already been released to the employee. Reopening would change a record they have already read. Close the cycle and run a correction instead.',
    );
  }
  if (!reason || reason.trim().length < 10) {
    throw new ValidationError(
      'Give a reason of at least 10 characters. It is recorded on the review and visible to the reviewer.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.reviewAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'REOPENED',
        reopenedAt: new Date(),
        reopenedById: actor.employeeId,
        reopenReason: reason.trim(),
      },
    });
    // Any approval already requested is withdrawn, because the content it was
    // based on is about to change.
    await tx.reviewApproval.deleteMany({
      where: { participantId: assignment.participantId, status: 'PENDING' },
    });
    await advanceParticipant(tx, assignment.participantId, actor);
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEW_REOPENED,
    entityType: 'review_assignment',
    entityId: assignmentId,
    summary: `Reopened a submitted ${assignment.kind.toLowerCase()} review for editing.`,
    metadata: { reason: reason.trim() },
  });

  await notify({
    orgId: actor.orgId,
    recipientEmployeeId: assignment.reviewerEmployeeId,
    type: 'review.reopened',
    title: 'A review you submitted has been reopened',
    body: reason.trim(),
    linkUrl: `/reviews/assignments/${assignmentId}`,
    severity: 'warning',
    dedupeKey: `review.reopened:${assignmentId}:${Date.now()}`,
  });
}

export async function decideApproval(
  actor: Actor,
  participantId: string,
  decision: 'APPROVED' | 'CHANGES_REQUESTED',
  note: string | null,
): Promise<void> {
  const approval = await prisma.reviewApproval.findFirst({
    where: { participantId, status: 'PENDING' },
    include: { participant: { include: { cycle: true, employee: true } } },
  });
  if (!approval || approval.participant.cycle.orgId !== actor.orgId) {
    throw new NotFoundError('There is no approval waiting on this review.');
  }

  const isAssignedApprover = actor.employeeId === approval.approverEmployeeId;
  if (!isAssignedApprover && !actor.isHrAdmin) {
    throw new ForbiddenError('Only the assigned approver or an HR administrator can decide this.');
  }

  if (decision === 'CHANGES_REQUESTED' && (!note || note.trim().length < 10)) {
    throw new ValidationError(
      'Say what needs to change, in at least 10 characters. The manager sees this.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.reviewApproval.update({
      where: { id: approval.id },
      data: { status: decision, note: note?.trim() || null, decidedAt: new Date() },
    });

    if (decision === 'APPROVED') {
      await tx.cycleParticipant.update({
        where: { id: participantId },
        data: { status: 'APPROVED' },
      });
    } else {
      // Send the manager review back for editing.
      await tx.reviewAssignment.updateMany({
        where: { participantId, kind: 'MANAGER', status: 'SUBMITTED' },
        data: {
          status: 'REOPENED',
          reopenedAt: new Date(),
          reopenedById: actor.employeeId,
          reopenReason: note?.trim() || 'Changes requested by the approver.',
        },
      });
      await tx.cycleParticipant.update({
        where: { id: participantId },
        data: { status: 'IN_PROGRESS' },
      });
    }
  });

  await recordAudit(actor, {
    action:
      decision === 'APPROVED' ? AUDIT_ACTIONS.REVIEW_APPROVED : AUDIT_ACTIONS.REVIEW_CHANGES_REQUESTED,
    entityType: 'cycle_participant',
    entityId: participantId,
    summary:
      decision === 'APPROVED'
        ? `Approved the review for ${approval.participant.employee.firstName} ${approval.participant.employee.lastName}.`
        : `Requested changes to the review for ${approval.participant.employee.firstName} ${approval.participant.employee.lastName}.`,
    metadata: { note: note?.trim() ?? null },
  });

  if (approval.participant.managerIdSnapshot) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: approval.participant.managerIdSnapshot,
      type: decision === 'APPROVED' ? 'review.approved' : 'review.changes_requested',
      title:
        decision === 'APPROVED'
          ? `Your review of ${approval.participant.employee.firstName} ${approval.participant.employee.lastName} was approved`
          : `Changes requested on your review of ${approval.participant.employee.firstName} ${approval.participant.employee.lastName}`,
      body: note?.trim() || undefined,
      linkUrl: `/reviews/participants/${participantId}`,
      severity: decision === 'APPROVED' ? 'info' : 'warning',
      dedupeKey: `review.decision:${approval.id}`,
    });
  }

  // Auto-release where the cycle is configured for it.
  if (decision === 'APPROVED' && approval.participant.cycle.releaseMode === 'AUTO_ON_APPROVAL') {
    await releaseParticipant(actor, participantId);
  }
}

export async function releaseParticipant(actor: Actor, participantId: string): Promise<void> {
  const participant = await prisma.cycleParticipant.findUnique({
    where: { id: participantId },
    include: {
      cycle: true,
      employee: true,
      assignments: { select: { kind: true, status: true } },
      approvals: true,
    },
  });
  if (!participant || participant.cycle.orgId !== actor.orgId) throw new NotFoundError();

  const chain = await managerChainAt(
    participant.employeeId,
    participant.snapshotTakenAt ?? participant.cycle.launchedAt ?? new Date(),
  );
  const access = participantAccess(actor, participant, chain);
  if (!canReleaseParticipant(actor, access)) {
    throw new ForbiddenError(
      'Only an HR administrator can release results to an employee. Managers prepare the review; release is a separate, recorded step.',
    );
  }

  if (isReleased(participant)) {
    throw new ConflictError('These results have already been released.');
  }
  const managerSubmitted = participant.assignments.some(
    (a) => a.kind === 'MANAGER' && a.status === 'SUBMITTED',
  );
  if (!managerSubmitted) {
    throw new ConflictError(
      'The manager review has not been submitted yet, so there is nothing to release.',
    );
  }
  if (participant.cycle.requireApproval) {
    const approved = participant.approvals.some((a) => a.status === 'APPROVED');
    if (!approved) {
      throw new ConflictError(
        'This cycle requires approval before results can be released, and this review has not been approved.',
      );
    }
  }

  // Freeze the goal facts the review was based on, if not already frozen.
  const existingSnapshots = await prisma.reviewGoalSnapshot.count({ where: { participantId } });
  if (existingSnapshots === 0) {
    const goals = await prisma.goal.findMany({
      where: {
        ownerEmployeeId: participant.employeeId,
        OR: [
          { startDate: { lte: participant.cycle.periodEnd }, dueDate: { gte: participant.cycle.periodStart } },
          { startDate: { lte: participant.cycle.periodEnd }, dueDate: null },
          { startDate: null, dueDate: { gte: participant.cycle.periodStart } },
        ],
      },
      include: { milestones: { select: { completedAt: true, weight: true } } },
    });
    if (goals.length > 0) {
      await prisma.reviewGoalSnapshot.createMany({
        data: goals.map((g) => {
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
            participantId,
            goalId: g.id,
            titleSnapshot: g.title,
            statusSnapshot: g.status,
            healthSnapshot: g.health,
            progressSnapshot: progress.displayPct,
            targetSnapshot: g.targetValue !== null ? `${g.targetValue}${g.unit ? ` ${g.unit}` : ''}` : null,
            dueDateSnapshot: g.dueDate,
          };
        }),
      });
    }
  }

  const released = await prisma.cycleParticipant.updateMany({
    where: { id: participantId, status: { notIn: ['RELEASED', 'ACKNOWLEDGED', 'CLOSED'] } },
    data: { status: 'RELEASED', releasedAt: new Date(), releasedById: actor.userId },
  });
  if (released.count === 0) throw new ConflictError('These results have already been released.');

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEW_RELEASED,
    entityType: 'cycle_participant',
    entityId: participantId,
    summary: `Released review results to ${participant.employee.firstName} ${participant.employee.lastName}.`,
    metadata: { cycleId: participant.cycleId },
  });

  await notify({
    orgId: actor.orgId,
    recipientEmployeeId: participant.employeeId,
    type: 'review.released',
    title: `Your ${participant.cycle.name} is ready to read`,
    body: 'Read it through and acknowledge that you have received it. Acknowledging records receipt — it does not mean you agree with it.',
    linkUrl: `/reviews/results/${participantId}`,
    severity: 'warning',
    dedupeKey: `review.released:${participantId}`,
    email: {
      subject: `Your ${participant.cycle.name} is ready`,
      text: `Your review for ${participant.cycle.name} has been released and is ready to read.\n\nOpen it here: ${process.env.APP_URL ?? 'http://localhost:3000'}/reviews/results/${participantId}\n\nAcknowledging the review records that you received it. It does not mean you agree with it, and you can add a comment of your own.`,
    },
  });
}

export async function acknowledgeParticipant(
  actor: Actor,
  participantId: string,
  comment: string | null,
): Promise<void> {
  const participant = await prisma.cycleParticipant.findUnique({
    where: { id: participantId },
    include: { cycle: true, employee: true },
  });
  if (!participant || participant.cycle.orgId !== actor.orgId) throw new NotFoundError();

  if (actor.employeeId !== participant.employeeId) {
    throw new ForbiddenError('Only the employee the review is about can acknowledge it.');
  }
  if (participant.status === 'ACKNOWLEDGED' || participant.status === 'CLOSED') {
    throw new ConflictError('You have already acknowledged this review.');
  }
  if (participant.status !== 'RELEASED') {
    throw new ConflictError('This review has not been released to you yet.');
  }

  const updated = await prisma.cycleParticipant.updateMany({
    where: { id: participantId, status: 'RELEASED' },
    data: {
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date(),
      acknowledgementNote: comment?.trim() || null,
    },
  });
  if (updated.count === 0) throw new ConflictError('You have already acknowledged this review.');

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEW_ACKNOWLEDGED,
    entityType: 'cycle_participant',
    entityId: participantId,
    summary: 'Acknowledged receipt of a released review.',
    metadata: { hasComment: Boolean(comment?.trim()) },
  });

  if (participant.managerIdSnapshot) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: participant.managerIdSnapshot,
      type: 'review.acknowledged',
      title: `${participant.employee.firstName} ${participant.employee.lastName} acknowledged their review`,
      body: comment?.trim() ? 'They added a comment.' : undefined,
      linkUrl: `/reviews/participants/${participantId}`,
      dedupeKey: `review.acknowledged:${participantId}`,
    });
  }
}

/** Records a human calibration adjustment. Never overwrites the computed score. */
export async function calibrateParticipant(
  actor: Actor,
  participantId: string,
  score: number | null,
  note: string,
): Promise<void> {
  if (!actor.isHrAdmin) {
    throw new ForbiddenError('Only an HR administrator can record a calibration adjustment.');
  }
  const participant = await prisma.cycleParticipant.findUnique({
    where: { id: participantId },
    include: { cycle: true, employee: true },
  });
  if (!participant || participant.cycle.orgId !== actor.orgId) throw new NotFoundError();

  if (isReleased(participant)) {
    throw new ConflictError(
      'These results have already been released. Adjusting the score now would change a record the employee has read.',
    );
  }
  if (!note || note.trim().length < 15) {
    throw new ValidationError(
      'Record why the score was adjusted, in at least 15 characters. The reason is kept with the adjustment.',
    );
  }
  if (score !== null && (score < 0 || score > 100)) {
    throw new ValidationError('An adjusted score must be between 0 and 100.');
  }

  await prisma.cycleParticipant.update({
    where: { id: participantId },
    data: {
      calibratedScore: score,
      calibrationNote: note.trim(),
      calibratedById: actor.userId,
      calibratedAt: new Date(),
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.REVIEW_SCORE_CALIBRATED,
    entityType: 'cycle_participant',
    entityId: participantId,
    summary: `Recorded a calibration adjustment for ${participant.employee.firstName} ${participant.employee.lastName}: ${participant.finalScore ?? 'no score'} → ${score ?? 'cleared'}.`,
    metadata: { from: participant.finalScore, to: score, note: note.trim() },
  });
}

// ---------------------------------------------------------------------------
// Reading a participant record (manager / HR / the employee)
// ---------------------------------------------------------------------------

export interface VisibleAssignment {
  id: string;
  kind: string;
  status: string;
  dueAt: Date | null;
  submittedAt: Date | null;
  score: number | null;
  reviewerName: string | null;
  reviewerHidden: boolean;
  /** Null when the viewer may see that it exists but not what it says. */
  sections: RenderedSection[] | null;
  withheldReason: string | null;
}

export async function getParticipantDetail(actor: Actor, participantId: string) {
  const participant = await prisma.cycleParticipant.findUnique({
    where: { id: participantId },
    include: {
      cycle: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          workEmail: true,
          hireDate: true,
          employmentStatus: true,
          jobTitle: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
      managerSnapshot: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      assignments: {
        include: {
          reviewer: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
        },
        orderBy: { kind: 'asc' },
      },
      approvals: {
        include: { approver: { select: { firstName: true, lastName: true, preferredName: true } } },
        orderBy: { requestedAt: 'desc' },
      },
      goalSnapshots: true,
      releasedBy: { select: { email: true, employee: { select: { firstName: true, lastName: true } } } },
    },
  });

  if (!participant || participant.cycle.orgId !== actor.orgId) throw new NotFoundError();

  const chain = await managerChainAt(
    participant.employeeId,
    participant.snapshotTakenAt ?? participant.cycle.launchedAt ?? new Date(),
  );
  const access = participantAccess(actor, participant, chain);

  // Someone who is only a reviewer on this participant can reach their own
  // assignment, but not the participant record.
  if (access === 'NONE') {
    const isReviewer = participant.assignments.some(
      (a) => a.reviewerEmployeeId === actor.employeeId,
    );
    if (!isReviewer) throw new NotFoundError();
  }

  const cycleRef = {
    id: participant.cycle.id,
    status: participant.cycle.status,
    requireApproval: participant.cycle.requireApproval,
    shareSelfWithManager: participant.cycle.shareSelfWithManager,
    sharePeerWithEmployee: participant.cycle.sharePeerWithEmployee,
    peerVisibilityMode: participant.cycle.peerVisibilityMode,
    requireAcknowledgement: participant.cycle.requireAcknowledgement,
  };

  const released = isReleased(participant);
  const goals = await goalsForParticipant(
    participant.id,
    participant.employeeId,
    participant.cycle.periodStart,
    participant.cycle.periodEnd,
    released,
  );

  const visible: VisibleAssignment[] = [];
  for (const a of participant.assignments) {
    const own = canViewOwnAssignment(actor, a);
    const mayRead = canViewAssignmentContent(actor, cycleRef, participant, a, access);
    const showReviewer =
      a.kind === 'PEER' ? canSeePeerReviewerIdentity(cycleRef, access) || own : true;

    let sections: RenderedSection[] | null = null;
    let withheldReason: string | null = null;

    if (mayRead) {
      const form = await buildForm(a.templateVersionId, a.kind, a.id, a.kind === 'PEER' ? [] : goals);
      sections = form.sections;
    } else if (a.status !== 'SUBMITTED') {
      withheldReason =
        'Not submitted yet. A review in progress is visible only to the person writing it.';
    } else if (access === 'SUBJECT' && !released) {
      withheldReason = 'This has been submitted but not yet released to you.';
    } else if (a.kind === 'PEER' && String(cycleRef.peerVisibilityMode) === 'ANONYMOUS_AGGREGATE') {
      withheldReason =
        'Peer responses in this cycle are only ever shown combined, never individually.';
    } else if (a.kind === 'SELF' && !cycleRef.shareSelfWithManager) {
      withheldReason = 'This cycle does not share self-assessments with managers.';
    } else {
      withheldReason = 'You do not have access to the content of this review.';
    }

    visible.push({
      id: a.id,
      kind: a.kind,
      status: a.status,
      dueAt: a.dueAt,
      submittedAt: a.submittedAt,
      score: canViewParticipantScore(participant, access) ? a.score : null,
      reviewerName: showReviewer
        ? `${a.reviewer.preferredName || a.reviewer.firstName} ${a.reviewer.lastName}`
        : null,
      reviewerHidden: !showReviewer,
      sections,
      withheldReason,
    });
  }

  const showScore = canViewParticipantScore(participant, access);

  return {
    participant: {
      id: participant.id,
      status: participant.status,
      employee: participant.employee,
      managerSnapshot: participant.managerSnapshot,
      managerNameSnapshot: participant.managerNameSnapshot,
      departmentNameSnapshot: participant.departmentNameSnapshot,
      jobTitleNameSnapshot: participant.jobTitleNameSnapshot,
      snapshotTakenAt: participant.snapshotTakenAt,
      releasedAt: participant.releasedAt,
      acknowledgedAt: participant.acknowledgedAt,
      acknowledgementNote: participant.acknowledgementNote,
      finalScore: showScore ? participant.finalScore : null,
      finalScoreJson: showScore ? participant.finalScoreJson : null,
      calibratedScore: showScore ? participant.calibratedScore : null,
      calibrationNote: showScore ? participant.calibrationNote : null,
      releasedByName: participant.releasedBy?.employee
        ? `${participant.releasedBy.employee.firstName} ${participant.releasedBy.employee.lastName}`
        : (participant.releasedBy?.email ?? null),
    },
    cycle: participant.cycle,
    access,
    released,
    assignments: visible,
    approvals: participant.approvals,
    goals,
    goalSnapshots: participant.goalSnapshots,
    canRelease: canReleaseParticipant(actor, access) && !released,
    canApprove:
      participant.approvals.some(
        (a) => a.status === 'PENDING' && (a.approverEmployeeId === actor.employeeId || actor.isHrAdmin),
      ) && participant.status === 'AWAITING_APPROVAL',
    canReopen: canReopenAssignment(actor) && !released,
    canCalibrate: actor.isHrAdmin && !released,
  };
}

export type ParticipantDetail = Awaited<ReturnType<typeof getParticipantDetail>>;
export type { ParticipantAccess };
