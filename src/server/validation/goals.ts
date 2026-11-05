import { z } from 'zod';
import { GOAL_HEALTHS, GOAL_SCOPES, GOAL_STATUSES, GOAL_VISIBILITIES, MEASUREMENT_TYPES } from '@/lib/enums';
import { Id, IsoDate, Pct } from './common';

export const GoalSchema = z.object({
  title: z.string().trim().min(3, 'Give the goal a title of at least 3 characters.').max(300),
  description: z.string().trim().max(5000).nullable().optional(),
  outcome: z.string().trim().max(2000).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  scope: z.enum(GOAL_SCOPES),
  ownerEmployeeId: Id.nullable().optional(),
  departmentId: Id.nullable().optional(),
  parentGoalId: Id.nullable().optional(),
  startDate: IsoDate,
  dueDate: IsoDate,
  status: z.enum(GOAL_STATUSES).optional(),
  health: z.enum(GOAL_HEALTHS).optional(),
  visibility: z.enum(GOAL_VISIBILITIES),
  measurementType: z.enum(MEASUREMENT_TYPES),
  startValue: z.number().finite().nullable().optional(),
  targetValue: z.number().finite().nullable().optional(),
  currentValue: z.number().finite().nullable().optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  higherIsBetter: z.boolean().optional(),
  reportedProgressPct: Pct.nullable().optional(),
  weight: z.number().min(0).max(100).optional(),
  milestones: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        dueDate: IsoDate,
        weight: z.number().min(0).max(100).optional(),
      }),
    )
    .max(40)
    .optional(),
  collaboratorIds: z.array(Id).max(20).optional(),
});

export const GoalPatchSchema = GoalSchema.partial();

export const GoalUpdateSchema = z.object({
  body: z.string().trim().max(5000).nullable().optional(),
  currentValue: z.number().finite().nullable().optional(),
  reportedProgressPct: Pct.nullable().optional(),
  status: z.enum(GOAL_STATUSES).optional(),
  health: z.enum(GOAL_HEALTHS).optional(),
  completedMilestoneIds: z.array(Id).max(40).optional(),
  reopenedMilestoneIds: z.array(Id).max(40).optional(),
});

export const GoalCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something before posting.').max(5000),
});

export const GoalCloseSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED']),
  note: z.string().trim().max(2000),
});
