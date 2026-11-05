import { z } from 'zod';
import { AUDIENCE_RULE_TYPES, SURVEY_MODES, SURVEY_QUESTION_TYPES } from '@/lib/enums';
import { Id, IsoDate } from './common';

export const SurveySchema = z.object({
  title: z.string().trim().min(3, 'Give the survey a title.').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  introText: z.string().trim().max(4000).nullable().optional(),
  mode: z.enum(SURVEY_MODES),
  opensAt: IsoDate,
  closesAt: IsoDate,
  minResponsesForResults: z.number().int().min(1).max(100).optional(),
  collectDepartment: z.boolean().optional(),
  collectTenureBand: z.boolean().optional(),
  questions: z
    .array(
      z.object({
        type: z.enum(SURVEY_QUESTION_TYPES),
        prompt: z.string().trim().min(1, 'Every question needs a prompt.').max(500),
        helpText: z.string().trim().max(1000).nullable().optional(),
        required: z.boolean().optional(),
        factor: z.string().trim().max(120).nullable().optional(),
        ratingScaleId: Id.nullable().optional(),
        choices: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
      }),
    )
    .min(1, 'A survey needs at least one question.')
    .max(60),
  audience: z
    .array(z.object({ ruleType: z.enum(AUDIENCE_RULE_TYPES), value: z.string().trim().max(200).nullable().optional() }))
    .min(1, 'Choose who the survey goes to.')
    .max(60),
});

export const SurveyResponseSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: Id,
        numericValue: z.number().finite().nullable().optional(),
        textValue: z.string().trim().max(10000).nullable().optional(),
        choices: z.array(z.string().trim().max(200)).max(30).nullable().optional(),
      }),
    )
    .max(100),
});
