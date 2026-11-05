import { z } from 'zod';
import {
  APPROVAL_AUTHORITIES,
  PEER_VISIBILITY_MODES,
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

export const RoleGrantSchema = z.object({
  role: z.enum(['SYS_ADMIN', 'HR_ADMIN', 'LEADERSHIP', 'EMPLOYEE']),
  granted: z.boolean(),
});

export const PasswordResetSchema = z.object({
  temporaryPassword: z.string().min(10, 'Use at least 10 characters.').max(200),
});
