import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { collectManagerChain, loadReportingGraph } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import {
  canEditActionItem,
  canEditMeeting,
  canViewActionItem,
  canViewMeeting,
  canViewMeetingNote,
} from '../authz/policy';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { notify } from '../notify';
import { ACTION_STATUSES, MEETING_CADENCES } from '@/lib/enums';

/**
 * One-to-one meetings.
 *
 * The part that makes meetings worth having in a performance tool is the
 * carry-forward: an agenda item that was not discussed and an action item that
 * was not finished both follow the pair into the next meeting rather than
 * being quietly lost. That is implemented in `completeMeeting`.
 *
 * Private notes are visible to their author and to nobody else. No role
 * overrides this — not HR, not a system administrator. That is a deliberate
 * design decision recorded in docs/PERMISSIONS.md.
 */

const CADENCE_DAYS: Record<string, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  MONTHLY: 30,
  QUARTERLY: 91,
  NONE: 0,
};

export async function listMeetings(
  actor: Actor,
  filters: { scope?: 'mine' | 'team'; past?: boolean; limit?: number } = {},
) {
  if (!actor.employeeId) return [];
  const participantIds =
    filters.scope === 'team'
      ? [actor.employeeId, ...actor.descendantIds]
      : [actor.employeeId];

  return prisma.meeting.findMany({
    where: {
      orgId: actor.orgId,
      participants: { some: { employeeId: { in: participantIds } } },
      ...(filters.past
        ? { status: { in: ['COMPLETED', 'CANCELLED'] } }
        : { status: 'SCHEDULED' }),
    },
    orderBy: { scheduledAt: filters.past ? 'desc' : 'asc' },
    take: filters.limit ?? 50,
    include: {
      participants: {
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, preferredName: true, jobTitle: { select: { name: true } } },
          },
        },
      },
      series: { select: { id: true, title: true, cadence: true } },
      _count: { select: { agendaItems: true, actionItems: true, notes: true } },
    },
  });
}

export async function listSeries(actor: Actor) {
  if (!actor.employeeId) return [];
  return prisma.meetingSeries.findMany({
    where: {
      orgId: actor.orgId,
      active: true,
      OR: [{ personAId: actor.employeeId }, { personBId: actor.employeeId }],
    },
    include: {
      personA: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      personB: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      meetings: {
        orderBy: { scheduledAt: 'desc' },
        take: 1,
        select: { id: true, scheduledAt: true, status: true },
      },
    },
    orderBy: { title: 'asc' },
  });
}

export async function getMeeting(actor: Actor, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, orgId: actor.orgId },
    include: {
      participants: {
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              jobTitle: { select: { name: true } },
            },
          },
        },
      },
      series: true,
      agendaItems: {
        orderBy: { sortOrder: 'asc' },
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
          goal: { select: { id: true, title: true, status: true, health: true } },
        },
      },
      notes: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, firstName: true, lastName: true, preferredName: true } } },
      },
      actionItems: {
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        include: {
          owner: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
          assignedBy: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
          goal: { select: { id: true, title: true } },
        },
      },
    },
  });
  if (!meeting) throw new NotFoundError();

  const participantIds = meeting.participants.map((p) => p.employeeId);
  if (!canViewMeeting(actor, { id: meeting.id, participantIds })) throw new NotFoundError();

  const isParticipant = actor.employeeId !== null && participantIds.includes(actor.employeeId);

  // Private notes are filtered here, at the service, so no view or export can
  // reach one by accident.
  const notes = meeting.notes.filter((n) =>
    canViewMeetingNote(actor, {
      authorEmployeeId: n.authorEmployeeId,
      visibility: n.visibility,
      meetingParticipantIds: participantIds,
    }),
  );

  // HR can confirm that a one-to-one happened without reading what was said.
  const hrObserverOnly = !isParticipant && actor.isHrAdmin;

  return {
    meeting: { ...meeting, notes: hrObserverOnly ? [] : notes },
    participantIds,
    isParticipant,
    hrObserverOnly,
    canEdit: canEditMeeting(actor, { id: meeting.id, participantIds }),
  };
}

export interface MeetingInput {
  title?: string;
  otherEmployeeId: string;
  scheduledAt: string;
  durationMinutes?: number;
  location?: string | null;
  cadence?: string;
  createSeries?: boolean;
}

export async function createMeeting(actor: Actor, input: MeetingInput) {
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can schedule a meeting.');
  if (input.otherEmployeeId === actor.employeeId) {
    throw new ValidationError('A one-to-one needs two different people.');
  }

  const other = await prisma.employee.findFirst({
    where: { id: input.otherEmployeeId, orgId: actor.orgId, employmentStatus: { not: 'terminated' } },
    select: { id: true, firstName: true, lastName: true, preferredName: true },
  });
  if (!other) throw new ValidationError('That person cannot be scheduled with.');

  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new ValidationError('That is not a valid date and time.');

  const cadence = input.cadence ?? 'NONE';
  if (!MEETING_CADENCES.includes(cadence as never)) throw new ValidationError('Unknown cadence.');

  const myName = actor.displayName.split(' ')[0];
  const title = input.title?.trim() || `${myName} & ${other.preferredName || other.firstName} 1:1`;

  const meeting = await prisma.$transaction(async (tx) => {
    let seriesId: string | null = null;
    if (input.createSeries && cadence !== 'NONE') {
      const series = await tx.meetingSeries.create({
        data: {
          orgId: actor.orgId,
          title,
          cadence,
          personAId: actor.employeeId as string,
          personBId: other.id,
          nextDueAt: new Date(scheduledAt.getTime() + (CADENCE_DAYS[cadence] ?? 14) * 86_400_000),
        },
      });
      seriesId = series.id;
    }

    return tx.meeting.create({
      data: {
        orgId: actor.orgId,
        seriesId,
        title,
        scheduledAt,
        durationMinutes: input.durationMinutes ?? 30,
        location: input.location?.trim() || null,
        status: 'SCHEDULED',
        createdById: actor.userId,
        participants: {
          create: [
            { employeeId: actor.employeeId as string, role: 'ORGANIZER' },
            { employeeId: other.id, role: 'ATTENDEE' },
          ],
        },
      },
    });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.MEETING_CREATED,
    entityType: 'meeting',
    entityId: meeting.id,
    summary: `Scheduled a one-to-one with ${other.firstName} ${other.lastName}.`,
  });

  await notify({
    orgId: actor.orgId,
    recipientEmployeeId: other.id,
    type: 'meeting.scheduled',
    title: `${actor.displayName} scheduled a one-to-one with you`,
    body: scheduledAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    linkUrl: `/meetings/${meeting.id}`,
    dedupeKey: `meeting:${meeting.id}`,
  });

  return meeting;
}

async function assertParticipant(actor: Actor, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, orgId: actor.orgId },
    include: { participants: { select: { employeeId: true } } },
  });
  if (!meeting) throw new NotFoundError();
  const participantIds = meeting.participants.map((p) => p.employeeId);
  if (!canEditMeeting(actor, { id: meeting.id, participantIds })) {
    throw new ForbiddenError('Only the people in a meeting can change its agenda or notes.');
  }
  return { meeting, participantIds };
}

export async function addAgendaItem(
  actor: Actor,
  meetingId: string,
  input: { title: string; notes?: string | null; goalId?: string | null },
) {
  const { participantIds } = await assertParticipant(actor, meetingId);
  if (!input.title.trim()) throw new ValidationError('Give the agenda item a title.');

  const count = await prisma.agendaItem.count({ where: { meetingId } });
  const item = await prisma.agendaItem.create({
    data: {
      meetingId,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      goalId: input.goalId || null,
      sortOrder: count,
      createdByEmployeeId: actor.employeeId as string,
    },
  });

  // The other person should know something was added before the meeting.
  for (const id of participantIds) {
    if (id === actor.employeeId) continue;
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: id,
      type: 'meeting.agenda',
      title: `${actor.displayName} added an agenda item`,
      body: item.title,
      linkUrl: `/meetings/${meetingId}`,
      dedupeKey: `agenda:${item.id}`,
    });
  }
  return item;
}

export async function updateAgendaItem(
  actor: Actor,
  itemId: string,
  input: { title?: string; notes?: string | null; status?: string },
) {
  const item = await prisma.agendaItem.findUnique({
    where: { id: itemId },
    include: { meeting: { include: { participants: { select: { employeeId: true } } } } },
  });
  if (!item || item.meeting.orgId !== actor.orgId) throw new NotFoundError();
  const participantIds = item.meeting.participants.map((p) => p.employeeId);
  if (!canEditMeeting(actor, { id: item.meetingId, participantIds })) {
    throw new ForbiddenError('Only the people in this meeting can change its agenda.');
  }
  return prisma.agendaItem.update({
    where: { id: itemId },
    data: {
      title: input.title?.trim() ?? undefined,
      notes: input.notes !== undefined ? input.notes?.trim() || null : undefined,
      status: input.status ?? undefined,
    },
  });
}

export async function deleteAgendaItem(actor: Actor, itemId: string) {
  const item = await prisma.agendaItem.findUnique({
    where: { id: itemId },
    include: { meeting: { include: { participants: { select: { employeeId: true } } } } },
  });
  if (!item || item.meeting.orgId !== actor.orgId) throw new NotFoundError();
  const participantIds = item.meeting.participants.map((p) => p.employeeId);
  if (!canEditMeeting(actor, { id: item.meetingId, participantIds })) {
    throw new ForbiddenError('Only the people in this meeting can change its agenda.');
  }
  await prisma.agendaItem.delete({ where: { id: itemId } });
}

export async function saveNote(
  actor: Actor,
  meetingId: string,
  input: { noteId?: string; body: string; visibility: 'SHARED' | 'PRIVATE' },
) {
  await assertParticipant(actor, meetingId);
  if (!input.body.trim()) throw new ValidationError('Write something before saving.');

  if (input.noteId) {
    const existing = await prisma.meetingNote.findUnique({ where: { id: input.noteId } });
    if (!existing || existing.meetingId !== meetingId) throw new NotFoundError();
    // Notes are owned by whoever wrote them, shared or not.
    if (existing.authorEmployeeId !== actor.employeeId) {
      throw new ForbiddenError('You can only edit a note you wrote.');
    }
    return prisma.meetingNote.update({
      where: { id: input.noteId },
      data: { body: input.body.trim(), visibility: input.visibility },
    });
  }

  return prisma.meetingNote.create({
    data: {
      meetingId,
      authorEmployeeId: actor.employeeId as string,
      body: input.body.trim(),
      visibility: input.visibility,
    },
  });
}

export async function deleteNote(actor: Actor, noteId: string) {
  const note = await prisma.meetingNote.findUnique({
    where: { id: noteId },
    include: { meeting: { select: { orgId: true } } },
  });
  if (!note || note.meeting.orgId !== actor.orgId) throw new NotFoundError();
  if (note.authorEmployeeId !== actor.employeeId) {
    throw new ForbiddenError('You can only delete a note you wrote.');
  }
  await prisma.meetingNote.delete({ where: { id: noteId } });
}

/**
 * Completes a meeting and carries unfinished work forward.
 *
 * Agenda items still open become carried-forward items on the next meeting in
 * the series; open action items keep their own identity and simply remain open,
 * because an action item belongs to a person rather than to a meeting.
 */
export async function completeMeeting(
  actor: Actor,
  meetingId: string,
  options: { scheduleNext?: boolean } = {},
): Promise<{ carriedForward: number; nextMeetingId: string | null }> {
  const { meeting, participantIds } = await assertParticipant(actor, meetingId);
  if (meeting.status === 'COMPLETED') throw new ConflictError('This meeting is already marked complete.');

  const openItems = await prisma.agendaItem.findMany({
    where: { meetingId, status: 'OPEN' },
    orderBy: { sortOrder: 'asc' },
  });

  let nextMeetingId: string | null = null;
  let carriedForward = 0;

  await prisma.$transaction(async (tx) => {
    await tx.meeting.update({
      where: { id: meetingId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    if (options.scheduleNext !== false && meeting.seriesId) {
      const series = await tx.meetingSeries.findUnique({ where: { id: meeting.seriesId } });
      if (series && series.active && series.cadence !== 'NONE') {
        const step = CADENCE_DAYS[series.cadence] ?? 14;
        const nextAt = new Date(meeting.scheduledAt.getTime() + step * 86_400_000);
        const next = await tx.meeting.create({
          data: {
            orgId: actor.orgId,
            seriesId: series.id,
            title: series.title,
            scheduledAt: nextAt,
            durationMinutes: meeting.durationMinutes,
            location: meeting.location,
            status: 'SCHEDULED',
            createdById: actor.userId,
            participants: {
              create: participantIds.map((employeeId, i) => ({
                employeeId,
                role: i === 0 ? 'ORGANIZER' : 'ATTENDEE',
              })),
            },
          },
        });
        nextMeetingId = next.id;
        await tx.meetingSeries.update({
          where: { id: series.id },
          data: { nextDueAt: new Date(nextAt.getTime() + step * 86_400_000) },
        });

        for (const [i, item] of openItems.entries()) {
          await tx.agendaItem.create({
            data: {
              meetingId: next.id,
              title: item.title,
              notes: item.notes,
              sortOrder: i,
              status: 'OPEN',
              createdByEmployeeId: item.createdByEmployeeId,
              goalId: item.goalId,
              carriedFromId: item.id,
            },
          });
          carriedForward += 1;
        }
        if (openItems.length > 0) {
          await tx.agendaItem.updateMany({
            where: { id: { in: openItems.map((i) => i.id) } },
            data: { status: 'CARRIED_FORWARD' },
          });
        }
      }
    }
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.MEETING_COMPLETED,
    entityType: 'meeting',
    entityId: meetingId,
    summary: `Marked the one-to-one complete.${carriedForward > 0 ? ` ${carriedForward} agenda ${carriedForward === 1 ? 'item was' : 'items were'} carried forward.` : ''}`,
  });

  return { carriedForward, nextMeetingId };
}

// ---------------------------------------------------------------------------
// Action items
// ---------------------------------------------------------------------------

export interface ActionItemInput {
  title: string;
  description?: string | null;
  ownerEmployeeId: string;
  dueDate?: string | null;
  meetingId?: string | null;
  goalId?: string | null;
  developmentPlanId?: string | null;
  visibility?: string;
}

export async function createActionItem(actor: Actor, input: ActionItemInput) {
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can create an action item.');
  if (!input.title.trim()) throw new ValidationError('Give the action item a title.');

  const ownerIsSelf = input.ownerEmployeeId === actor.employeeId;
  const ownerIsReport = actor.descendantIds.includes(input.ownerEmployeeId);

  if (!ownerIsSelf && !ownerIsReport && !actor.isHrAdmin) {
    // Someone in the same meeting may also assign an action.
    if (input.meetingId) {
      const meeting = await prisma.meeting.findFirst({
        where: { id: input.meetingId, orgId: actor.orgId },
        include: { participants: { select: { employeeId: true } } },
      });
      const ids = meeting?.participants.map((p) => p.employeeId) ?? [];
      if (!ids.includes(actor.employeeId) || !ids.includes(input.ownerEmployeeId)) {
        throw new ForbiddenError('You can assign an action to yourself, to a report, or within a meeting you are in.');
      }
    } else {
      throw new ForbiddenError('You can assign an action to yourself or to someone in your reporting line.');
    }
  }

  const item = await prisma.actionItem.create({
    data: {
      orgId: actor.orgId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      ownerEmployeeId: input.ownerEmployeeId,
      assignedByEmployeeId: actor.employeeId,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      meetingId: input.meetingId || null,
      goalId: input.goalId || null,
      developmentPlanId: input.developmentPlanId || null,
      visibility: input.visibility ?? 'PARTICIPANTS',
      status: 'OPEN',
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.ACTION_ITEM_CREATED,
    entityType: 'action_item',
    entityId: item.id,
    summary: `Created the action item "${item.title}".`,
  });

  if (!ownerIsSelf) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: input.ownerEmployeeId,
      type: 'action.assigned',
      title: `${actor.displayName} assigned you an action item`,
      body: item.title,
      linkUrl: input.meetingId ? `/meetings/${input.meetingId}` : '/meetings/actions',
      dedupeKey: `action:${item.id}`,
    });
  }
  return item;
}

async function loadActionForWrite(actor: Actor, itemId: string) {
  const item = await prisma.actionItem.findFirst({
    where: { id: itemId, orgId: actor.orgId },
    include: { meeting: { include: { participants: { select: { employeeId: true } } } } },
  });
  if (!item) throw new NotFoundError();
  const { managerOf } = await loadReportingGraph(actor.orgId);
  const ref = {
    ownerEmployeeId: item.ownerEmployeeId,
    assignedByEmployeeId: item.assignedByEmployeeId,
    visibility: item.visibility,
    meetingParticipantIds: item.meeting?.participants.map((p) => p.employeeId) ?? [],
    ownerManagerChainIds: collectManagerChain(item.ownerEmployeeId, managerOf),
  };
  if (!canViewActionItem(actor, ref)) throw new NotFoundError();
  return { item, ref };
}

export async function updateActionItem(
  actor: Actor,
  itemId: string,
  input: { title?: string; description?: string | null; status?: string; dueDate?: string | null; ownerEmployeeId?: string },
) {
  const { item, ref } = await loadActionForWrite(actor, itemId);
  if (!canEditActionItem(actor, ref)) throw new ForbiddenError('You cannot change this action item.');
  if (input.status && !ACTION_STATUSES.includes(input.status as never)) {
    throw new ValidationError('Unknown status.');
  }

  const completing = input.status === 'COMPLETED' && item.status !== 'COMPLETED';

  const updated = await prisma.actionItem.update({
    where: { id: itemId },
    data: {
      title: input.title?.trim() ?? undefined,
      description: input.description !== undefined ? input.description?.trim() || null : undefined,
      status: input.status ?? undefined,
      dueDate: input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : undefined,
      ownerEmployeeId: input.ownerEmployeeId ?? undefined,
      completedAt: completing ? new Date() : input.status && input.status !== 'COMPLETED' ? null : undefined,
    },
  });

  if (completing) {
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.ACTION_ITEM_COMPLETED,
      entityType: 'action_item',
      entityId: itemId,
      summary: `Completed the action item "${updated.title}".`,
    });
    if (item.assignedByEmployeeId && item.assignedByEmployeeId !== actor.employeeId) {
      await notify({
        orgId: actor.orgId,
        recipientEmployeeId: item.assignedByEmployeeId,
        type: 'action.completed',
        title: `${actor.displayName} completed an action item`,
        body: updated.title,
        linkUrl: item.meetingId ? `/meetings/${item.meetingId}` : '/meetings/actions',
        dedupeKey: `action.done:${itemId}`,
      });
    }
  }

  return updated;
}

export async function listActionItems(
  actor: Actor,
  filters: { scope?: 'mine' | 'assigned' | 'team'; status?: string } = {},
) {
  if (!actor.employeeId) return [];
  const where: Record<string, unknown> = { orgId: actor.orgId };

  if (filters.scope === 'assigned') where.assignedByEmployeeId = actor.employeeId;
  else if (filters.scope === 'team') where.ownerEmployeeId = { in: [actor.employeeId, ...actor.descendantIds] };
  else where.ownerEmployeeId = actor.employeeId;

  if (filters.status) where.status = filters.status;
  else where.status = { in: ['OPEN', 'IN_PROGRESS'] };

  const items = await prisma.actionItem.findMany({
    where,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take: 200,
    include: {
      owner: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      assignedBy: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      meeting: { select: { id: true, title: true, scheduledAt: true, participants: { select: { employeeId: true } } } },
      goal: { select: { id: true, title: true } },
      developmentPlan: { select: { id: true, title: true } },
    },
  });

  const { managerOf } = await loadReportingGraph(actor.orgId);
  return items.filter((item) =>
    canViewActionItem(actor, {
      ownerEmployeeId: item.ownerEmployeeId,
      assignedByEmployeeId: item.assignedByEmployeeId,
      visibility: item.visibility,
      meetingParticipantIds: item.meeting?.participants.map((p) => p.employeeId) ?? [],
      ownerManagerChainIds: collectManagerChain(item.ownerEmployeeId, managerOf),
    }),
  );
}
