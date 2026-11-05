import { z } from 'zod';
import { AUTHOR_VISIBILITIES, FEEDBACK_KINDS, FEEDBACK_VISIBILITIES } from '@/lib/enums';
import { Id, IsoDate } from './common';

export const FeedbackSchema = z.object({
  aboutEmployeeId: Id,
  kind: z.enum(FEEDBACK_KINDS),
  body: z.string().trim().min(10, 'Write at least 10 characters.').max(10000),
  visibility: z.enum(FEEDBACK_VISIBILITIES),
  authorVisibility: z.enum(AUTHOR_VISIBILITIES).optional(),
  competencyId: Id.nullable().optional(),
  goalId: Id.nullable().optional(),
  projectTag: z.string().trim().max(160).nullable().optional(),
  recognitionValueId: Id.nullable().optional(),
  requestId: Id.nullable().optional(),
});

export const FeedbackRequestSchema = z.object({
  responderEmployeeId: Id,
  aboutEmployeeId: Id,
  message: z.string().trim().max(2000).nullable().optional(),
  dueAt: IsoDate,
  competencyId: Id.nullable().optional(),
  goalId: Id.nullable().optional(),
  projectTag: z.string().trim().max(160).nullable().optional(),
  responseVisibility: z.enum(FEEDBACK_VISIBILITIES).optional(),
});

export const DeclineSchema = z.object({
  reason: z.string().trim().max(1000).nullable().optional(),
});
