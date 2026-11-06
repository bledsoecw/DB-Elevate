import { z } from 'zod';
import {
  APPROVAL_AUTHORITIES,
  COMPETENCY_LEVELS,
  PEER_VISIBILITY_MODES,
  PLAN_STATUSES,
  PLAN_TYPES,
  QUESTION_TYPES,
  RELEASE_MODES,
  REVIEWER_KINDS,
  TEMPLATE_CATEGORIES,
} from '@/lib/enums';
import { Id, IsoDate } from './common';

export const TemplateQuestionSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().trim().min(1, 'Every question needs a prompt.').max(1000),
  helpText: z.string().trim().max(2000).nullable().optional(),
  required: z.boolean().optional(),
  weight: z.number().min(0).max(100).optional(),
  allowNotApplicable: z.boolean().optional(),
  commentEnabled: z.boolean().optional(),
  commentRequired: z.boolean().optional(),
  maxLength: z.number().int().min(50).max(20000).nullable().optional(),
  ratingScaleId: Id.nullable().optional(),
  competencyId: Id.nullable().optional(),
  goalScope: z.enum(['OWNED', 'OWNED_AND_TEAM', 'CYCLE_PERIOD']).nullable().optional(),
  choices: z.array(z.string().trim().max(300)).max(20).optional(),
  appliesTo: z.string().trim().max(60).nullable().optional(),
});

export const TemplateSectionSchema = z.object({
  title: z.string().trim().min(1, 'Every section needs a title.').max(300),
  instructions: z.string().trim().max(3000).nullable().optional(),
  weight: z.number().min(0).max(100).optional(),
  appliesTo: z.string().trim().max(60).optional(),
  questions: z.array(TemplateQuestionSchema).min(1, 'A section needs at least one question.').max(60),
});

export const TemplateSchema = z.object({
  name: z.string().trim().min(3, 'Give the template a name.').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(TEMPLATE_CATEGORIES),
  selfWeight: z.number().min(0).max(1),
  managerWeight: z.number().min(0).max(1),
  peerWeight: z.number().min(0).max(1),
  sections: z.array(TemplateSectionSchema).min(1, 'A template needs at least one section.').max(30),
  changeNote: z.string().trim().max(500).optional(),
});

export const DuplicateSchema = z.object({
  versionId: Id,
  name: z.string().trim().min(3).max(200),
});

export const CycleSchema = z.object({
  name: z.string().trim().min(3, 'Give the cycle a name.').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  templateVersionId: Id,
  periodStart: z.string().trim().min(1),
  periodEnd: z.string().trim().min(1),
  selfReviewEnabled: z.boolean(),
  managerReviewEnabled: z.boolean(),
  peerReviewEnabled: z.boolean(),
  peerReviewTarget: z.number().int().min(0).max(10).optional(),
  peerVisibilityMode: z.enum(PEER_VISIBILITY_MODES).optional(),
  requireApproval: z.boolean(),
  approvalAuthority: z.enum(APPROVAL_AUTHORITIES).optional(),
  releaseMode: z.enum(RELEASE_MODES).optional(),
  shareSelfWithManager: z.boolean(),
  sharePeerWithEmployee: z.boolean(),
  requireAcknowledgement: z.boolean(),
  selfDueAt: IsoDate,
  managerDueAt: IsoDate,
  peerDueAt: IsoDate,
});

export const CyclePatchSchema = CycleSchema.partial();

export const ParticipantsSchema = z.object({
  employeeIds: z.array(Id).max(2000),
});

export const AssignReviewerSchema = z.object({
  participantId: Id,
  reviewerEmployeeId: Id,
  kind: z.enum(REVIEWER_KINDS),
});

export const CancelCycleSchema = z.object({
  reason: z.string().trim().min(10, 'Record a reason of at least 10 characters.').max(2000),
});

export const OrgSettingsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  productName: z.string().trim().min(1).max(100).optional(),
  wordmarkText: z.string().trim().max(60).nullable().optional(),
  logoUrl: z.string().trim().max(2000).nullable().optional(),
  brandPrimaryHex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour.').optional(),
  brandAccentHex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour.').optional(),
  timezone: z.string().trim().max(60).optional(),
  surveyMinResponses: z.number().int().min(3).max(100).optional(),
  surveySuppressComplement: z.boolean().optional(),
  peerReviewMinForAggregate: z.number().int().min(1).max(50).optional(),
  requireReviewAcknowledgement: z.boolean().optional(),
  emailProvider: z.enum(['outbox', 'smtp', 'ses', 'sendgrid']).optional(),
  emailFromName: z.string().trim().max(120).optional(),
  emailFromAddr: z.string().trim().max(320).optional(),
  aiEnabled: z.boolean().optional(),
  aiProvider: z.enum(['none', 'mock', 'anthropic', 'openai', 'azure-openai']).optional(),
  aiModel: z.string().trim().max(120).nullable().optional(),
  aiMonthlyCallBudget: z.number().int().min(0).max(1000000).optional(),
});

// --- Catalogue: competencies, libraries, scales, recognition ---------------

export const CompetencyBehaviorSchema = z.object({
  level: z.enum(COMPETENCY_LEVELS),
  descriptor: z.string().trim().min(1, 'Describe what this level looks like.').max(1000),
});

export const CompetencySchema = z.object({
  name: z.string().trim().min(2, 'Give the competency a name.').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  active: z.boolean().optional(),
  /** Behavioural descriptors by career level. A competency may define none. */
  behaviors: z.array(CompetencyBehaviorSchema).max(COMPETENCY_LEVELS.length).optional(),
});

export const CompetencyPatchSchema = CompetencySchema.partial();

export const LibraryItemSchema = z.object({
  competencyId: Id,
  weight: z.number().min(0).max(100).optional(),
});

export const CompetencyLibrarySchema = z.object({
  name: z.string().trim().min(2, 'Give the library a name.').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean().optional(),
  items: z.array(LibraryItemSchema).max(60).optional(),
  /** Job titles this library is the default competency set for. */
  jobTitleIds: z.array(Id).max(200).optional(),
});

export const CompetencyLibraryPatchSchema = CompetencyLibrarySchema.partial();

export const RatingScaleLevelSchema = z.object({
  value: z.number().int().min(0).max(100),
  label: z.string().trim().min(1, 'Every level needs a label.').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
});

export const RatingScaleSchema = z.object({
  name: z.string().trim().min(2, 'Give the scale a name.').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  numeric: z.boolean(),
  levels: z
    .array(RatingScaleLevelSchema)
    .min(2, 'A scale needs at least two levels.')
    .max(11, 'A scale of more than eleven levels is not usefully distinguishable.'),
});

export const RatingScalePatchSchema = RatingScaleSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const RecognitionValueSchema = z.object({
  name: z.string().trim().min(2, 'Give the value a name.').max(80),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.string().trim().max(40).optional(),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour.')
    .optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const RecognitionValuePatchSchema = RecognitionValueSchema.partial();

// --- Departments and job titles ---------------------------------------------

/*
 * A job title carries the competency library a review is built from and the
 * salary band a pay recommendation is measured against, so the pickers on an
 * employee record are not decoration. Neither entity is ever deleted through
 * the API: deactivating keeps historical employee records, past reviews and
 * past pay decisions pointing at something that still has a name.
 */

export const DepartmentSchema = z.object({
  name: z.string().trim().min(2, 'Give the department a name.').max(120),
  code: z.string().trim().max(40).nullable().optional(),
  parentId: Id.nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});

export const DepartmentPatchSchema = DepartmentSchema.partial();

export const JobTitleSchema = z.object({
  name: z.string().trim().min(2, 'Give the job title a name.').max(120),
  level: z.string().trim().max(60).nullable().optional(),
  departmentId: Id.nullable().optional(),
  competencyLibraryId: Id.nullable().optional(),
  active: z.boolean().optional(),
});

export const JobTitlePatchSchema = JobTitleSchema.partial();

// --- Development plans ------------------------------------------------------

export const PlanActionSchema = z.object({
  id: Id.optional(),
  title: z.string().trim().min(1, 'Describe the action.').max(300),
  description: z.string().trim().max(2000).nullable().optional(),
  itemType: z.enum(['ACTION', 'MILESTONE']).optional(),
  ownerEmployeeId: Id.nullable().optional(),
  competencyId: Id.nullable().optional(),
  dueDate: IsoDate.nullable().optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});

export const DevelopmentPlanSchema = z.object({
  employeeId: Id,
  title: z.string().trim().min(3, 'Give the plan a title.').max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  planType: z.enum(PLAN_TYPES),
  startDate: IsoDate.nullable().optional(),
  targetDate: IsoDate.nullable().optional(),
  /**
   * A performance improvement plan is restricted by default. The flag is
   * accepted but `createPlan` forces it true for PERFORMANCE_IMPROVEMENT so a
   * mis-set client can never widen access to one.
   */
  hrRestricted: z.boolean().optional(),
  actions: z.array(PlanActionSchema).max(40).optional(),
});

export const DevelopmentPlanPatchSchema = DevelopmentPlanSchema.partial()
  .omit({ employeeId: true })
  .extend({
    status: z.enum(PLAN_STATUSES).optional(),
    outcome: z.string().trim().max(4000).nullable().optional(),
  });

export const PlanCheckInSchema = z.object({
  body: z.string().trim().min(1, 'Write the check-in note.').max(4000),
});

// --- Calibration ------------------------------------------------------------

export const CalibrationSessionSchema = z.object({
  cycleId: Id,
  name: z.string().trim().min(3, 'Name the session.').max(200),
  notes: z.string().trim().max(4000).nullable().optional(),
  facilitatorEmployeeId: Id.nullable().optional(),
  participantIds: z.array(Id).max(500).optional(),
});

export const CalibrationEntrySchema = z.object({
  participantId: Id,
  proposedScore: z.number().min(0).max(100).nullable().optional(),
  rationale: z.string().trim().max(2000).nullable().optional(),
});

export const CalibrationDecisionSchema = z.object({
  participantId: Id,
  finalScore: z.number().min(0).max(100).nullable(),
  rationale: z
    .string()
    .trim()
    .min(10, 'Record why the score was changed — at least 10 characters.')
    .max(2000),
});

export const RoleGrantSchema = z.object({
  role: z.enum(['SYS_ADMIN', 'HR_ADMIN', 'LEADERSHIP', 'EMPLOYEE']),
  granted: z.boolean(),
});

export const PasswordResetSchema = z.object({
  temporaryPassword: z.string().min(10, 'Use at least 10 characters.').max(200),
});
