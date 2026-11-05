import type { PrismaClient } from '@prisma/client';
import { Rng, ratingFor, type Profile } from './rng';
import {
  CHECKIN_IN_WAY,
  CHECKIN_ONE_THING,
  CHECKIN_WENT_WELL,
  FOCUS_AREAS,
  GOAL_COMMENT,
  MANAGER_SUMMARY_DEVELOPING,
  MANAGER_SUMMARY_SOLID,
  MANAGER_SUMMARY_STRONG,
  NEW_HIRE_SUMMARY,
  PEER_CHANGE,
  PEER_COPY,
  SELF_HARDEST,
  SELF_PROUD,
  SUPPORT_NEEDED,
} from './rng';
import {
  computeFinalScore,
  scoreReview,
  type ScoringAnswer,
  type ScoringSection,
} from '../../src/server/scoring/review-score';

/**
 * Generates realistic answers for seeded review assignments.
 *
 * This runs the *same* scoring functions the application uses, so a seeded
 * score shown on a dashboard is calculated by production code rather than
 * written in by hand. That is what makes the seeded reports trustworthy as a
 * demonstration.
 */

export interface LoadedForm {
  sections: {
    id: string;
    title: string;
    weight: number;
    appliesTo: string;
    questions: {
      id: string;
      type: string;
      prompt: string;
      weight: number;
      required: boolean;
      appliesTo: string | null;
      allowNotApplicable: boolean;
      commentEnabled: boolean;
      choicesJson: string | null;
      goalScope: string | null;
      scale: { id: string; name: string; numeric: boolean; levels: { value: number; label: string }[] } | null;
      competencyId: string | null;
    }[];
  }[];
  weights: { selfWeight: number; managerWeight: number; peerWeight: number };
}

export async function loadForm(db: PrismaClient, versionId: string): Promise<LoadedForm> {
  const version = await db.reviewTemplateVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        include: {
          questions: {
            orderBy: { sortOrder: 'asc' },
            include: { ratingScale: { include: { levels: { orderBy: { value: 'asc' } } } } },
          },
        },
      },
    },
  });

  return {
    weights: {
      selfWeight: version.selfWeight,
      managerWeight: version.managerWeight,
      peerWeight: version.peerWeight,
    },
    sections: version.sections.map((s) => ({
      id: s.id,
      title: s.title,
      weight: s.weight,
      appliesTo: s.appliesTo,
      questions: s.questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        weight: q.weight,
        required: q.required,
        appliesTo: q.appliesTo,
        allowNotApplicable: q.allowNotApplicable,
        commentEnabled: q.commentEnabled,
        choicesJson: q.choicesJson,
        goalScope: q.goalScope,
        competencyId: q.competencyId,
        scale: q.ratingScale
          ? {
              id: q.ratingScale.id,
              name: q.ratingScale.name,
              numeric: q.ratingScale.numeric,
              levels: q.ratingScale.levels.map((l) => ({ value: l.value, label: l.label })),
            }
          : null,
      })),
    })),
  };
}

/** Whether a question is presented to a given reviewer kind. */
export function appliesToKind(
  sectionAppliesTo: string,
  questionAppliesTo: string | null,
  kind: string,
): boolean {
  const spec = (questionAppliesTo && questionAppliesTo.trim()) || sectionAppliesTo;
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(kind);
}

function managerSummaryFor(rng: Rng, profile: Profile): string {
  if (profile === 'outstanding' || profile === 'strong') return rng.pick(MANAGER_SUMMARY_STRONG);
  if (profile === 'solid') return rng.pick(MANAGER_SUMMARY_SOLID);
  return rng.pick(MANAGER_SUMMARY_DEVELOPING);
}

/** Picks plausible prose for a written question based on its wording. */
function textAnswerFor(rng: Rng, prompt: string, kind: string, profile: Profile): string {
  const p = prompt.toLowerCase();
  if (p.includes('proud')) return rng.pick(SELF_PROUD);
  if (p.includes('hardest') || p.includes('not go the way')) return rng.pick(SELF_HARDEST);
  if (p.includes('significant contributions')) return rng.pick(SELF_PROUD);
  if (p.includes('summary of the year')) return managerSummaryFor(rng, profile);
  if (p.includes('focus') || p.includes('next year')) return rng.pick(FOCUS_AREAS);
  if (p.includes('support') || p.includes('training or tools')) return rng.pick(SUPPORT_NEEDED);
  if (p.includes('want other leads to copy')) return rng.pick(PEER_COPY);
  if (p.includes('useful thing they could change')) return rng.pick(PEER_CHANGE);
  if (p.includes('went well')) return rng.pick(CHECKIN_WENT_WELL);
  if (p.includes('getting in the way')) return rng.pick(CHECKIN_IN_WAY);
  if (p.includes('one thing to change')) return rng.pick(CHECKIN_ONE_THING);
  if (p.includes('first 90 days')) return rng.pick(NEW_HIRE_SUMMARY);
  if (p.includes('next 90 days')) return rng.pick(FOCUS_AREAS);
  if (p.includes('still unclear')) return 'The change-order process. I know it exists but not who approves what.';
  if (p.includes('which project')) return rng.pick(['Riverbend Addition', 'Hillcrest Kitchen', 'Oakmont Basement', 'Thornton Whole-Home Remodel']);
  if (p.includes('differently on the next job')) return rng.pick(PEER_CHANGE);
  if (kind === 'SELF') return rng.pick(SELF_PROUD);
  return managerSummaryFor(rng, profile);
}

export interface GoalForReview {
  id: string;
  title: string;
  status: string;
  health: string;
  reportedProgressPct: number | null;
  targetValue: number | null;
  unit: string | null;
  dueDate: Date | null;
}

export interface FillOptions {
  /** Leaves a few optional questions blank, which is what real forms look like. */
  leaveSomeBlank?: boolean;
  /** Self-assessments trend slightly higher than manager ratings. */
  selfBias?: number;
  /** Marks a couple of applicable-looking competencies as not applicable. */
  useNotApplicable?: boolean;
}

/**
 * Writes responses for one assignment and returns the computed score.
 * Does not change the assignment's status — the caller decides that.
 */
export async function fillAssignment(
  db: PrismaClient,
  args: {
    assignmentId: string;
    kind: string;
    form: LoadedForm;
    profile: Profile;
    goals: GoalForReview[];
    seed: string;
    options?: FillOptions;
  },
): Promise<{ score: number | null; scoreJson: string }> {
  const rng = new Rng(args.seed);
  const opts = args.options ?? {};
  const scoringSections: ScoringSection[] = [];
  const answers: ScoringAnswer[] = [];
  const rows: {
    assignmentId: string;
    questionId: string;
    subjectKey: string;
    textValue?: string | null;
    numericValue?: number | null;
    choiceJson?: string | null;
    commentValue?: string | null;
    notApplicable?: boolean;
  }[] = [];

  let naBudget = opts.useNotApplicable ? 1 : 0;

  for (const section of args.form.sections) {
    const visible = section.questions.filter((q) =>
      appliesToKind(section.appliesTo, q.appliesTo, args.kind),
    );
    if (visible.length === 0) continue;

    const scoringQuestions: ScoringSection['questions'] = [];

    for (const q of visible) {
      // GOAL_REVIEW repeats once per goal in scope.
      if (q.type === 'GOAL_REVIEW') {
        for (const goal of args.goals) {
          const min = q.scale ? Math.min(...q.scale.levels.map((l) => l.value)) : 1;
          const max = q.scale ? Math.max(...q.scale.levels.map((l) => l.value)) : 5;
          const notApplicable = goal.status === 'CANCELLED';
          const value = notApplicable
            ? null
            : ratingFor(rng, args.profile, min, max, opts.selfBias ?? 0);

          scoringQuestions.push({
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            weight: q.weight,
            required: q.required,
            scale: q.scale,
            subjectKey: goal.id,
            subjectLabel: goal.title,
          });
          answers.push({
            questionId: q.id,
            subjectKey: goal.id,
            numericValue: value,
            notApplicable,
            answered: !notApplicable,
          });
          rows.push({
            assignmentId: args.assignmentId,
            questionId: q.id,
            subjectKey: goal.id,
            numericValue: value,
            notApplicable,
            commentValue: q.commentEnabled ? rng.pick(GOAL_COMMENT) : null,
          });
        }
        continue;
      }

      const blank = opts.leaveSomeBlank && !q.required && rng.chance(0.35);

      if (q.type === 'RATING' || q.type === 'COMPETENCY_RATING') {
        const min = q.scale ? Math.min(...q.scale.levels.map((l) => l.value)) : 1;
        const max = q.scale ? Math.max(...q.scale.levels.map((l) => l.value)) : 5;
        const markNa = q.allowNotApplicable && naBudget > 0 && rng.chance(0.12);
        if (markNa) naBudget -= 1;

        const value = markNa || blank ? null : ratingFor(rng, args.profile, min, max, opts.selfBias ?? 0);

        scoringQuestions.push({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          weight: q.weight,
          required: q.required,
          scale: q.scale,
        });
        answers.push({
          questionId: q.id,
          numericValue: value,
          notApplicable: markNa,
          answered: value !== null,
        });
        rows.push({
          assignmentId: args.assignmentId,
          questionId: q.id,
          subjectKey: '',
          numericValue: value,
          notApplicable: markNa,
          commentValue:
            q.commentEnabled && !markNa && !blank && rng.chance(0.7)
              ? textAnswerFor(rng, q.prompt, args.kind, args.profile)
              : null,
        });
        continue;
      }

      // Non-scored question types still register so the breakdown can show them.
      scoringQuestions.push({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        weight: q.weight,
        required: q.required,
        scale: q.scale,
      });

      if (blank) continue;

      if (q.type === 'TEXT') {
        rows.push({
          assignmentId: args.assignmentId,
          questionId: q.id,
          subjectKey: '',
          textValue: textAnswerFor(rng, q.prompt, args.kind, args.profile),
        });
      } else if (q.type === 'MULTIPLE_CHOICE') {
        const choices: string[] = q.choicesJson ? JSON.parse(q.choicesJson) : [];
        if (choices.length) {
          // Weight the pick by profile so the readiness answers line up with ratings.
          const index =
            args.profile === 'outstanding' || args.profile === 'strong'
              ? rng.int(0, Math.min(1, choices.length - 1))
              : args.profile === 'solid'
                ? rng.int(1, Math.max(1, choices.length - 2))
                : rng.int(Math.max(0, choices.length - 2), choices.length - 1);
          rows.push({
            assignmentId: args.assignmentId,
            questionId: q.id,
            subjectKey: '',
            textValue: choices[Math.min(index, choices.length - 1)] as string,
          });
        }
      } else if (q.type === 'MULTI_SELECT') {
        const choices: string[] = q.choicesJson ? JSON.parse(q.choicesJson) : [];
        if (choices.length) {
          const picked = rng.pickMany(choices, rng.int(1, Math.min(3, choices.length)));
          rows.push({
            assignmentId: args.assignmentId,
            questionId: q.id,
            subjectKey: '',
            choiceJson: JSON.stringify(picked),
          });
        }
      }
    }

    scoringSections.push({
      id: section.id,
      title: section.title,
      weight: section.weight,
      questions: scoringQuestions,
    });
  }

  if (rows.length > 0) {
    await db.reviewResponse.createMany({ data: rows });
  }

  const result = scoreReview(scoringSections, answers);
  return { score: result.score, scoreJson: JSON.stringify(result) };
}

/** Recomputes and stores a participant's final score from its assignments. */
export async function finalizeParticipantScore(
  db: PrismaClient,
  participantId: string,
): Promise<number | null> {
  const participant = await db.cycleParticipant.findUniqueOrThrow({
    where: { id: participantId },
    include: {
      assignments: { select: { kind: true, status: true, score: true } },
      templateVersion: { select: { selfWeight: true, managerWeight: true, peerWeight: true } },
    },
  });

  const result = computeFinalScore(participant.assignments, {
    selfWeight: participant.templateVersion.selfWeight,
    managerWeight: participant.templateVersion.managerWeight,
    peerWeight: participant.templateVersion.peerWeight,
  });

  await db.cycleParticipant.update({
    where: { id: participantId },
    data: { finalScore: result.score, finalScoreJson: JSON.stringify(result) },
  });
  return result.score;
}

/** Freezes the goal facts a finalized review was based on. */
export async function snapshotGoals(
  db: PrismaClient,
  participantId: string,
  goals: GoalForReview[],
): Promise<void> {
  if (goals.length === 0) return;
  await db.reviewGoalSnapshot.createMany({
    data: goals.map((g) => ({
      participantId,
      goalId: g.id,
      titleSnapshot: g.title,
      statusSnapshot: g.status,
      healthSnapshot: g.health,
      progressSnapshot: g.reportedProgressPct,
      targetSnapshot: g.targetValue !== null ? `${g.targetValue}${g.unit ? ` ${g.unit}` : ''}` : null,
      dueDateSnapshot: g.dueDate,
    })),
  });
}
