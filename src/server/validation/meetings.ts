import { z } from 'zod';
import { ACTION_STATUSES, AGENDA_STATUSES, MEETING_CADENCES, NOTE_VISIBILITIES } from '@/lib/enums';
import { Id, IsoDate } from './common';

export const MeetingSchema = z.object({
  title: z.string().trim().max(200).optional(),
  otherEmployeeId: Id,
  scheduledAt: z.string().trim().min(1, 'Choose a date and time.').max(40),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  location: z.string().trim().max(200).nullable().optional(),
  cadence: z.enum(MEETING_CADENCES).optional(),
  createSeries: z.boolean().optional(),
});

export const AgendaSchema = z.object({
  title: z.string().trim().min(1, 'Give the agenda item a title.').max(300),
  notes: z.string().trim().max(5000).nullable().optional(),
  goalId: Id.nullable().optional(),
});

export const AgendaPatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(AGENDA_STATUSES).optional(),
});

export const NoteSchema = z.object({
  noteId: Id.optional(),
  body: z.string().trim().min(1, 'Write something before saving.').max(20000),
  visibility: z.enum(NOTE_VISIBILITIES),
});

export const CompleteMeetingSchema = z.object({
  scheduleNext: z.boolean().optional(),
});

export const ActionItemSchema = z.object({
  title: z.string().trim().min(1, 'Give the action a title.').max(300),
  description: z.string().trim().max(5000).nullable().optional(),
  ownerEmployeeId: Id,
  dueDate: IsoDate,
  meetingId: Id.nullable().optional(),
  goalId: Id.nullable().optional(),
  developmentPlanId: Id.nullable().optional(),
  visibility: z.enum(['PARTICIPANTS', 'OWNER_AND_MANAGER', 'HR_RESTRICTED']).optional(),
});

export const ActionItemPatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(ACTION_STATUSES).optional(),
  dueDate: IsoDate,
  ownerEmployeeId: Id.optional(),
});
