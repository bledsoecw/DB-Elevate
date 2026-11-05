import { z } from 'zod';

/**
 * Shapes accepted by the review API.
 *
 * Validation lives here rather than in the route handlers so the same schema
 * governs a request from the UI and a request made directly with curl, and so
 * the integration tests can assert against the exact contract.
 */

export const AnswerSchema = z.object({
  questionId: z.string().min(1).max(64),
  subjectKey: z.string().max(200).optional().default(''),
  textValue: z.string().max(20000).nullable().optional(),
  numericValue: z.number().finite().nullable().optional(),
  choices: z.array(z.string().max(500)).max(50).nullable().optional(),
  commentValue: z.string().max(20000).nullable().optional(),
  notApplicable: z.boolean().optional().default(false),
});

export const SaveDraftSchema = z.object({
  answers: z.array(AnswerSchema).max(500),
});

export const SubmitSchema = z.object({
  answers: z.array(AnswerSchema).max(500).optional().default([]),
});

export const ReopenSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Give a reason of at least 10 characters. The reviewer sees it.')
    .max(2000),
});

export const ApprovalSchema = z.object({
  decision: z.enum(['APPROVED', 'CHANGES_REQUESTED']),
  note: z.string().trim().max(4000).nullable().optional(),
});

export const AcknowledgeSchema = z.object({
  comment: z.string().trim().max(4000).nullable().optional(),
});

export const CalibrateSchema = z.object({
  score: z.number().min(0).max(100).nullable(),
  note: z.string().trim().min(15, 'Record why the score was adjusted.').max(4000),
});
