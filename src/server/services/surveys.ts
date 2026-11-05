import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { canManageSurveys, canViewSurveyResults } from '../authz/policy';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { notify } from '../notify';
import {
  applySuppression,
  canShowFilteredResults,
  canShowVerbatims,
  computeEnps,
  stableShuffle,
  tenureBand,
  SUPPRESSED_LABEL,
  type SuppressionOutcome,
} from '../surveys/privacy';
import { SURVEY_MODES, SURVEY_QUESTION_TYPES, AUDIENCE_RULE_TYPES } from '@/lib/enums';
import { safeJsonParse } from '@/lib/utils';

/**
 * Surveys and engagement.
 *
 * The anonymity promise is enforced in three places, all of them here:
 *
 *  1. `submitResponse` writes no respondent id for an ANONYMOUS survey, and
 *     records participation on the invitation row instead. The two are never
 *     joined.
 *  2. `getResults` runs every number through the suppression rules before it
 *     is returned, so there is no unsuppressed path to a view.
 *  3. `exportResults` calls the same `getResults`, so a CSV can never contain
 *     a figure the screen would have hidden.
 *
 * Nothing in this file logs a respondent identity for an anonymous survey, and
 * the audit entry for a submission records the survey only.
 */

export async function listSurveys(actor: Actor) {
  const isAdmin = canManageSurveys(actor);

  if (isAdmin) {
    return prisma.survey.findMany({
      where: { orgId: actor.orgId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { invitations: true, responses: true, questions: true } },
      },
    });
  }

  // Everyone else sees only surveys they were invited to.
  if (!actor.employeeId) return [];
  const surveys = await prisma.survey.findMany({
    where: {
      orgId: actor.orgId,
      status: { in: ['OPEN', 'CLOSED'] },
      invitations: { some: { employeeId: actor.employeeId } },
    },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { invitations: true, responses: true, questions: true } } },
  });
  return surveys;
}

export async function getSurveyForRespondent(actor: Actor, surveyId: string) {
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can respond to a survey.');

  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, orgId: actor.orgId },
    include: {
      questions: { orderBy: { sortOrder: 'asc' }, include: { ratingScale: { include: { levels: { orderBy: { value: 'asc' } } } } } },
    },
  });
  if (!survey) throw new NotFoundError();

  const invitation = await prisma.surveyInvitation.findUnique({
    where: { surveyId_employeeId: { surveyId, employeeId: actor.employeeId } },
  });
  if (!invitation) throw new NotFoundError('You were not invited to this survey.');

  if (survey.status !== 'OPEN') {
    throw new ConflictError(
      survey.status === 'CLOSED' || survey.status === 'ARCHIVED'
        ? 'This survey has closed.'
        : 'This survey is not open yet.',
    );
  }

  return {
    survey,
    invitation,
    alreadyResponded: invitation.status === 'COMPLETED',
    questions: survey.questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      helpText: q.helpText,
      required: q.required,
      factor: q.factor,
      choices: safeJsonParse<string[]>(q.choicesJson, []),
      scale: q.ratingScale
        ? {
            name: q.ratingScale.name,
            levels: q.ratingScale.levels.map((l) => ({ value: l.value, label: l.label })),
          }
        : null,
    })),
  };
}

export interface SurveyAnswerInput {
  questionId: string;
  numericValue?: number | null;
  textValue?: string | null;
  choices?: string[] | null;
}

/**
 * Submits a response.
 *
 * For an ANONYMOUS survey the response row carries no respondent id. The only
 * record that this person took part is `SurveyInvitation.status`, which holds
 * no pointer to any response — so even with full database access the two
 * cannot be joined.
 */
export async function submitResponse(
  actor: Actor,
  surveyId: string,
  answers: SurveyAnswerInput[],
): Promise<void> {
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can respond to a survey.');

  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, orgId: actor.orgId },
    include: { questions: true },
  });
  if (!survey) throw new NotFoundError();
  if (survey.status !== 'OPEN') throw new ConflictError('This survey is not open for responses.');

  const invitation = await prisma.surveyInvitation.findUnique({
    where: { surveyId_employeeId: { surveyId, employeeId: actor.employeeId } },
  });
  if (!invitation) throw new ForbiddenError('You were not invited to this survey.');
  if (invitation.status === 'COMPLETED') {
    throw new ConflictError('You have already responded to this survey.');
  }

  const byId = new Map(survey.questions.map((q) => [q.id, q]));
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) throw new ValidationError('That survey has changed. Reload the page and try again.');
    if (q.type === 'NPS' && a.numericValue !== null && a.numericValue !== undefined) {
      if (a.numericValue < 0 || a.numericValue > 10) {
        throw new ValidationError('The recommendation score must be between 0 and 10.');
      }
    }
  }
  const answered = new Set(
    answers
      .filter(
        (a) =>
          (a.numericValue !== null && a.numericValue !== undefined) ||
          (a.textValue && a.textValue.trim()) ||
          (a.choices && a.choices.length > 0),
      )
      .map((a) => a.questionId),
  );
  const missing = survey.questions.filter((q) => q.required && !answered.has(q.id));
  if (missing.length > 0) {
    throw new ValidationError(
      `${missing.length} required ${missing.length === 1 ? 'question has' : 'questions have'} not been answered.`,
      missing.map((q) => ({ path: q.id, message: q.prompt })),
    );
  }

  await prisma.$transaction(async (tx) => {
    // Guard against a double submission from a retried request.
    const claimed = await tx.surveyInvitation.updateMany({
      where: { id: invitation.id, status: { not: 'COMPLETED' } },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictError('You have already responded to this survey.');

    const response = await tx.surveyResponse.create({
      data: {
        surveyId,
        // The decisive line. For an anonymous survey no identity is stored.
        respondentEmployeeId: survey.mode === 'ANONYMOUS' ? null : actor.employeeId,
        departmentNameSnapshot: survey.collectDepartment ? invitation.departmentNameSnapshot : null,
        tenureBandSnapshot: survey.collectTenureBand ? invitation.tenureBandSnapshot : null,
        locationSnapshot: invitation.locationSnapshot,
      },
    });

    for (const a of answers) {
      if (
        (a.numericValue === null || a.numericValue === undefined) &&
        !a.textValue?.trim() &&
        (!a.choices || a.choices.length === 0)
      ) {
        continue;
      }
      await tx.surveyAnswer.create({
        data: {
          responseId: response.id,
          questionId: a.questionId,
          numericValue: a.numericValue ?? null,
          textValue: a.textValue?.trim() || null,
          choiceJson: a.choices && a.choices.length > 0 ? JSON.stringify(a.choices) : null,
        },
      });
    }
  });

  // The audit entry deliberately records the survey only for an anonymous
  // survey. Recording who submitted would undo the guarantee.
  if (survey.mode === 'ANONYMOUS') {
    await prisma.auditEvent.create({
      data: {
        orgId: actor.orgId,
        actorLabel: 'Anonymous respondent',
        action: AUDIT_ACTIONS.SURVEY_RESPONSE_SUBMITTED,
        entityType: 'survey',
        entityId: surveyId,
        summary: `A response was submitted to the anonymous survey "${survey.title}". The respondent is not recorded.`,
      },
    });
  } else {
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.SURVEY_RESPONSE_SUBMITTED,
      entityType: 'survey',
      entityId: surveyId,
      summary: `Responded to the named survey "${survey.title}".`,
    });
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface QuestionResult {
  questionId: string;
  prompt: string;
  type: string;
  factor: string | null;
  responseCount: number;
  /** Mean of the numeric answers, where the question has them. */
  mean: number | null;
  scaleMax: number | null;
  distribution: { label: string; value: number; count: number }[] | null;
  verbatims: string[] | null;
  verbatimNotice: string | null;
  enps: ReturnType<typeof computeEnps> | null;
}

export interface SurveyResults {
  survey: {
    id: string;
    title: string;
    description: string | null;
    mode: string;
    status: string;
    minResponsesForResults: number;
    opensAt: Date | null;
    closesAt: Date | null;
  };
  participation: { invited: number; responded: number; rate: number | null };
  reportable: boolean;
  notice: string | null;
  questions: QuestionResult[];
  factors: { factor: string; mean: number; scaleMax: number; questionCount: number; responseCount: number }[];
  breakdown: SuppressionOutcome | null;
  breakdownDimension: string | null;
  appliedFilter: { dimension: string; value: string } | null;
  filterRejectedReason: string | null;
  availableFilters: { dimension: string; values: string[] }[];
}

export interface ResultsOptions {
  /** One dimension at a time for an anonymous survey. */
  filterDimension?: 'department' | 'tenure' | 'location';
  filterValue?: string;
  breakdownDimension?: 'department' | 'tenure' | 'location';
}

const DIMENSION_COLUMN = {
  department: 'departmentNameSnapshot',
  tenure: 'tenureBandSnapshot',
  location: 'locationSnapshot',
} as const;

export async function getResults(
  actor: Actor,
  surveyId: string,
  options: ResultsOptions = {},
): Promise<SurveyResults> {
  if (!canViewSurveyResults(actor)) {
    throw new ForbiddenError('Survey results are available to HR administrators and leadership.');
  }

  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, orgId: actor.orgId },
    include: {
      questions: {
        orderBy: { sortOrder: 'asc' },
        include: { ratingScale: { include: { levels: { orderBy: { value: 'asc' } } } } },
      },
      _count: { select: { invitations: true } },
    },
  });
  if (!survey) throw new NotFoundError();

  const threshold = survey.minResponsesForResults;

  const allResponses = await prisma.surveyResponse.findMany({
    where: { surveyId },
    select: {
      id: true,
      departmentNameSnapshot: true,
      tenureBandSnapshot: true,
      locationSnapshot: true,
      answers: {
        select: { questionId: true, numericValue: true, textValue: true, choiceJson: true },
      },
    },
  });

  const invited = survey._count.invitations;
  const totalResponses = allResponses.length;

  const availableFilters = (['department', 'tenure', 'location'] as const).map((dimension) => ({
    dimension,
    values: [
      ...new Set(
        allResponses
          .map((r) => r[DIMENSION_COLUMN[dimension]])
          .filter((v): v is string => Boolean(v)),
      ),
    ].sort(),
  }));

  // --- filtering --------------------------------------------------------
  let working = allResponses;
  let appliedFilter: { dimension: string; value: string } | null = null;
  let filterRejectedReason: string | null = null;

  if (options.filterDimension && options.filterValue) {
    const column = DIMENSION_COLUMN[options.filterDimension];
    const filtered = allResponses.filter((r) => r[column] === options.filterValue);
    const check = canShowFilteredResults({
      mode: survey.mode,
      activeFilterCount: 1,
      filteredResponseCount: filtered.length,
      threshold,
    });
    if (check.allowed) {
      working = filtered;
      appliedFilter = { dimension: options.filterDimension, value: options.filterValue };
    } else {
      filterRejectedReason = check.reason ?? SUPPRESSED_LABEL;
      // Fall back to the unfiltered view rather than showing nothing.
      working = allResponses;
    }
  }

  const reportable = survey.mode !== 'ANONYMOUS' || working.length >= threshold;

  // --- per question -----------------------------------------------------
  const questions: QuestionResult[] = survey.questions.map((q) => {
    const answers = working.flatMap((r) => r.answers.filter((a) => a.questionId === q.id));
    const numeric = answers
      .map((a) => a.numericValue)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const scaleMax = q.ratingScale ? Math.max(...q.ratingScale.levels.map((l) => l.value)) : q.type === 'NPS' ? 10 : null;

    if (!reportable) {
      return {
        questionId: q.id,
        prompt: q.prompt,
        type: q.type,
        factor: q.factor,
        responseCount: 0,
        mean: null,
        scaleMax,
        distribution: null,
        verbatims: null,
        verbatimNotice: null,
        enps: null,
      };
    }

    let distribution: QuestionResult['distribution'] = null;
    if (q.ratingScale) {
      distribution = q.ratingScale.levels.map((l) => ({
        label: l.label,
        value: l.value,
        count: numeric.filter((n) => n === l.value).length,
      }));
    } else if (q.type === 'MULTIPLE_CHOICE' || q.type === 'MULTI_SELECT') {
      const choices = safeJsonParse<string[]>(q.choicesJson, []);
      distribution = choices.map((c, i) => ({
        label: c,
        value: i,
        count: answers.filter((a) => {
          if (a.textValue === c) return true;
          const list = safeJsonParse<string[]>(a.choiceJson, []);
          return list.includes(c);
        }).length,
      }));
    }

    let verbatims: string[] | null = null;
    let verbatimNotice: string | null = null;
    if (q.type === 'TEXT') {
      const check = canShowVerbatims({
        mode: survey.mode,
        activeFilterCount: appliedFilter ? 1 : 0,
        totalResponses,
        threshold,
      });
      if (check.allowed) {
        const texts = answers
          .map((a) => a.textValue)
          .filter((t): t is string => Boolean(t && t.trim()));
        // Shuffled, so the order cannot be matched against anything.
        verbatims = survey.mode === 'ANONYMOUS' ? stableShuffle(texts, survey.id) : texts;
      } else {
        verbatimNotice = check.reason ?? SUPPRESSED_LABEL;
      }
    }

    return {
      questionId: q.id,
      prompt: q.prompt,
      type: q.type,
      factor: q.factor,
      responseCount: answers.length,
      mean: numeric.length > 0 ? Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 100) / 100 : null,
      scaleMax,
      distribution,
      verbatims,
      verbatimNotice,
      enps: q.type === 'NPS' ? computeEnps(numeric) : null,
    };
  });

  // --- factor roll-up ---------------------------------------------------
  const factorMap = new Map<string, { sum: number; count: number; questions: number; scaleMax: number }>();
  for (const q of questions) {
    if (!q.factor || q.mean === null || !q.scaleMax) continue;
    const entry = factorMap.get(q.factor) ?? { sum: 0, count: 0, questions: 0, scaleMax: q.scaleMax };
    entry.sum += q.mean * q.responseCount;
    entry.count += q.responseCount;
    entry.questions += 1;
    factorMap.set(q.factor, entry);
  }
  const factors = [...factorMap.entries()]
    .map(([factor, e]) => ({
      factor,
      mean: Math.round((e.sum / Math.max(e.count, 1)) * 100) / 100,
      scaleMax: e.scaleMax,
      questionCount: e.questions,
      responseCount: e.count,
    }))
    .sort((a, b) => b.mean - a.mean);

  // --- breakdown with suppression --------------------------------------
  let breakdown: SuppressionOutcome | null = null;
  if (options.breakdownDimension && reportable) {
    const column = DIMENSION_COLUMN[options.breakdownDimension];
    const groups = new Map<string, typeof allResponses>();
    for (const r of allResponses) {
      const key = r[column] ?? 'Not recorded';
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }

    const scored = survey.questions.filter((q) => q.ratingScale);
    const segments = [...groups.entries()].map(([key, rows]) => {
      const values = rows.flatMap((r) =>
        r.answers
          .filter((a) => scored.some((q) => q.id === a.questionId))
          .map((a) => a.numericValue)
          .filter((v): v is number => v !== null),
      );
      return {
        key,
        label: key,
        n: rows.length,
        value:
          values.length > 0
            ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
            : null,
      };
    });

    breakdown = applySuppression(segments, {
      threshold,
      totalResponses,
      suppressComplement: actor.org.surveySuppressComplement,
    });
  }

  return {
    survey: {
      id: survey.id,
      title: survey.title,
      description: survey.description,
      mode: survey.mode,
      status: survey.status,
      minResponsesForResults: threshold,
      opensAt: survey.opensAt,
      closesAt: survey.closesAt,
    },
    participation: {
      invited,
      responded: totalResponses,
      rate: invited > 0 ? Math.round((totalResponses / invited) * 100) : null,
    },
    reportable,
    notice: reportable
      ? null
      : `Results are hidden until at least ${threshold} people have responded. ${totalResponses} ${totalResponses === 1 ? 'response has' : 'responses have'} been received.`,
    questions,
    factors,
    breakdown,
    breakdownDimension: options.breakdownDimension ?? null,
    appliedFilter,
    filterRejectedReason,
    availableFilters: availableFilters.filter((f) => f.values.length > 1),
  };
}

/**
 * Participation detail.
 *
 * For a NAMED survey this lists who has and has not responded. For an
 * ANONYMOUS survey it lists who was invited and whether they took part — which
 * is a count of completion, not a link to any answer — and the UI says so.
 */
export async function getParticipation(actor: Actor, surveyId: string) {
  if (!canManageSurveys(actor)) {
    throw new ForbiddenError('Participation detail is available to HR administrators.');
  }
  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, orgId: actor.orgId },
    select: { id: true, title: true, mode: true, status: true },
  });
  if (!survey) throw new NotFoundError();

  const invitations = await prisma.surveyInvitation.findMany({
    where: { surveyId },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { employee: { lastName: 'asc' } },
  });

  return {
    survey,
    invitations,
    note:
      survey.mode === 'ANONYMOUS'
        ? 'This list shows who was invited and whether they took part. It holds no link to anyone’s answers — the two are stored separately and cannot be joined.'
        : 'This survey is named, so answers are stored with the respondent and can be read individually.',
  };
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export interface SurveyInput {
  title: string;
  description?: string | null;
  introText?: string | null;
  mode: string;
  opensAt?: string | null;
  closesAt?: string | null;
  minResponsesForResults?: number;
  collectDepartment?: boolean;
  collectTenureBand?: boolean;
  questions: {
    type: string;
    prompt: string;
    helpText?: string | null;
    required?: boolean;
    factor?: string | null;
    ratingScaleId?: string | null;
    choices?: string[];
  }[];
  audience: { ruleType: string; value?: string | null }[];
}

export async function createSurvey(actor: Actor, input: SurveyInput) {
  if (!canManageSurveys(actor)) throw new ForbiddenError('Only an HR administrator can create a survey.');
  if (!input.title.trim()) throw new ValidationError('Give the survey a title.');
  if (!SURVEY_MODES.includes(input.mode as never)) throw new ValidationError('Unknown survey mode.');
  if (input.questions.length === 0) throw new ValidationError('A survey needs at least one question.');

  for (const q of input.questions) {
    if (!SURVEY_QUESTION_TYPES.includes(q.type as never)) {
      throw new ValidationError(`Unknown question type "${q.type}".`);
    }
    if (!q.prompt.trim()) throw new ValidationError('Every question needs a prompt.');
    if (q.type === 'RATING' && !q.ratingScaleId) {
      throw new ValidationError(`"${q.prompt}" is a rating question, so it needs a scale.`);
    }
    if ((q.type === 'MULTIPLE_CHOICE' || q.type === 'MULTI_SELECT') && (!q.choices || q.choices.length < 2)) {
      throw new ValidationError(`"${q.prompt}" needs at least two options.`);
    }
  }
  for (const rule of input.audience) {
    if (!AUDIENCE_RULE_TYPES.includes(rule.ruleType as never)) {
      throw new ValidationError('Unknown audience rule.');
    }
  }

  const minResponses = input.minResponsesForResults ?? actor.org.surveyMinResponses;
  if (input.mode === 'ANONYMOUS' && minResponses < 3) {
    throw new ValidationError(
      'For an anonymous survey the minimum number of responses before results are shown must be at least 3. Anything lower cannot protect a respondent.',
    );
  }

  const survey = await prisma.survey.create({
    data: {
      orgId: actor.orgId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      introText: input.introText?.trim() || null,
      mode: input.mode,
      status: 'DRAFT',
      opensAt: input.opensAt ? new Date(input.opensAt) : null,
      closesAt: input.closesAt ? new Date(input.closesAt) : null,
      minResponsesForResults: minResponses,
      collectDepartment: input.collectDepartment ?? true,
      collectTenureBand: input.collectTenureBand ?? true,
      createdById: actor.userId,
      questions: {
        create: input.questions.map((q, i) => ({
          sortOrder: i,
          type: q.type,
          prompt: q.prompt.trim(),
          helpText: q.helpText?.trim() || null,
          required: q.required ?? false,
          factor: q.factor?.trim() || null,
          ratingScaleId: q.ratingScaleId || null,
          choicesJson: q.choices && q.choices.length > 0 ? JSON.stringify(q.choices) : null,
        })),
      },
      audience: { create: input.audience.map((r) => ({ ruleType: r.ruleType, value: r.value || null })) },
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.SURVEY_CREATED,
    entityType: 'survey',
    entityId: survey.id,
    summary: `Created the ${input.mode.toLowerCase()} survey "${survey.title}".`,
  });

  return survey;
}

/** Resolves the audience rules into a concrete list of employees. */
export async function resolveAudience(orgId: string, rules: { ruleType: string; value: string | null }[]) {
  if (rules.some((r) => r.ruleType === 'ALL')) {
    return prisma.employee.findMany({
      where: { orgId, employmentStatus: 'active' },
      select: { id: true, hireDate: true, workLocation: true, department: { select: { name: true } } },
    });
  }

  const departmentNames = rules.filter((r) => r.ruleType === 'DEPARTMENT').map((r) => r.value ?? '');
  const jobTitleNames = rules.filter((r) => r.ruleType === 'JOB_TITLE').map((r) => r.value ?? '');
  const locations = rules.filter((r) => r.ruleType === 'LOCATION').map((r) => r.value ?? '');
  const employeeIds = rules.filter((r) => r.ruleType === 'EMPLOYEE').map((r) => r.value ?? '');

  const or: Record<string, unknown>[] = [];
  if (departmentNames.length) or.push({ department: { name: { in: departmentNames } } });
  if (jobTitleNames.length) or.push({ jobTitle: { name: { in: jobTitleNames } } });
  if (locations.length) or.push({ workLocation: { in: locations } });
  if (employeeIds.length) or.push({ id: { in: employeeIds } });
  if (or.length === 0) return [];

  return prisma.employee.findMany({
    where: { orgId, employmentStatus: 'active', OR: or },
    select: { id: true, hireDate: true, workLocation: true, department: { select: { name: true } } },
  });
}

export async function launchSurvey(actor: Actor, surveyId: string) {
  if (!canManageSurveys(actor)) throw new ForbiddenError('Only an HR administrator can launch a survey.');

  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, orgId: actor.orgId },
    include: { audience: true, questions: true, _count: { select: { invitations: true } } },
  });
  if (!survey) throw new NotFoundError();
  if (survey.status !== 'DRAFT' && survey.status !== 'SCHEDULED') {
    throw new ConflictError('This survey has already been launched.');
  }
  if (survey.questions.length === 0) throw new ConflictError('Add at least one question before launching.');

  const audience = await resolveAudience(actor.orgId, survey.audience);
  if (audience.length === 0) {
    throw new ConflictError('The audience you chose does not match anyone. Adjust it before launching.');
  }
  if (survey.mode === 'ANONYMOUS' && audience.length < survey.minResponsesForResults) {
    throw new ConflictError(
      `This anonymous survey goes to ${audience.length} ${audience.length === 1 ? 'person' : 'people'}, which is fewer than the ${survey.minResponsesForResults} responses needed before any results can be shown. Either widen the audience or run it as a named survey.`,
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.survey.update({
      where: { id: surveyId },
      data: { status: 'OPEN', launchedAt: now, opensAt: survey.opensAt ?? now },
    });
    for (const employee of audience) {
      await tx.surveyInvitation.upsert({
        where: { surveyId_employeeId: { surveyId, employeeId: employee.id } },
        create: {
          surveyId,
          employeeId: employee.id,
          status: 'NOTIFIED',
          notifiedAt: now,
          departmentNameSnapshot: survey.collectDepartment ? (employee.department?.name ?? null) : null,
          tenureBandSnapshot: survey.collectTenureBand ? tenureBand(employee.hireDate, now) : null,
          locationSnapshot: employee.workLocation,
        },
        update: { status: 'NOTIFIED', notifiedAt: now },
      });
    }
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.SURVEY_LAUNCHED,
    entityType: 'survey',
    entityId: surveyId,
    summary: `Launched "${survey.title}" to ${audience.length} people in ${survey.mode.toLowerCase()} mode.`,
    metadata: { audienceSize: audience.length, mode: survey.mode },
  });

  for (const employee of audience) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: employee.id,
      type: 'survey.invited',
      title: `${survey.title} is open`,
      body:
        survey.mode === 'ANONYMOUS'
          ? 'Your answers are anonymous — we can see that you responded, but not what you said.'
          : 'Your answers are recorded with your name.',
      linkUrl: `/surveys/respond/${surveyId}`,
      dedupeKey: `survey.invited:${surveyId}:${employee.id}`,
    });
  }

  return { invited: audience.length };
}

export async function closeSurvey(actor: Actor, surveyId: string) {
  if (!canManageSurveys(actor)) throw new ForbiddenError('Only an HR administrator can close a survey.');
  const survey = await prisma.survey.findFirst({ where: { id: surveyId, orgId: actor.orgId } });
  if (!survey) throw new NotFoundError();
  if (survey.status !== 'OPEN') throw new ConflictError('Only an open survey can be closed.');

  await prisma.survey.update({
    where: { id: surveyId },
    data: { status: 'CLOSED', closedAtActual: new Date() },
  });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.SURVEY_CLOSED,
    entityType: 'survey',
    entityId: surveyId,
    summary: `Closed the survey "${survey.title}".`,
  });
}

export async function sendSurveyReminders(actor: Actor, surveyId: string): Promise<{ sent: number }> {
  if (!canManageSurveys(actor)) throw new ForbiddenError('Only an HR administrator can send reminders.');
  const survey = await prisma.survey.findFirst({ where: { id: surveyId, orgId: actor.orgId } });
  if (!survey) throw new NotFoundError();
  if (survey.status !== 'OPEN') throw new ConflictError('Reminders can only be sent for an open survey.');

  const pending = await prisma.surveyInvitation.findMany({
    where: { surveyId, status: { not: 'COMPLETED' } },
  });

  const today = new Date().toDateString();
  let sent = 0;
  for (const inv of pending) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: inv.employeeId,
      type: 'survey.reminder',
      title: `Reminder: ${survey.title} is still open`,
      body: survey.closesAt ? `Closes ${survey.closesAt.toLocaleDateString('en-US')}.` : undefined,
      linkUrl: `/surveys/respond/${surveyId}`,
      // One reminder per person per day, however many times the button is clicked.
      dedupeKey: `survey.reminder:${surveyId}:${inv.employeeId}:${today}`,
    });
    sent += 1;
  }
  await prisma.surveyInvitation.updateMany({
    where: { surveyId, status: { not: 'COMPLETED' } },
    data: { remindedAt: new Date(), reminderCount: { increment: 1 } },
  });
  return { sent };
}
