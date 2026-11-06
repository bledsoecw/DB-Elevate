import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { collectManagerChain, loadReportingGraph } from '../authz/actor';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import {
  canSeeFeedbackAuthor,
  canUseFeedbackVisibility,
  canViewFeedback,
  canWritePrivateNoteAbout,
  type FeedbackRef,
} from '../authz/policy';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { notify } from '../notify';
import { AUTHOR_VISIBILITIES, FEEDBACK_KINDS, FEEDBACK_VISIBILITIES } from '@/lib/enums';
import { containsInsensitive } from '../search';

/**
 * Continuous feedback and recognition.
 *
 * The distinction the product has to get right, and states plainly in the UI:
 *
 *   NAMED        the author is shown to everyone who can see the item.
 *   CONFIDENTIAL the author is stored and shown to HR administrators only.
 *   ANONYMOUS    the author is never stored. Nobody can recover it, including
 *                HR and including whoever runs the database.
 *
 * Because ANONYMOUS genuinely discards the identity, it is restricted to
 * routes where that is defensible, and the UI says so before submission.
 */

export interface FeedbackItem {
  id: string;
  kind: string;
  body: string;
  visibility: string;
  authorVisibility: string;
  createdAt: Date;
  aboutEmployeeId: string;
  aboutName: string;
  aboutFirstName: string;
  aboutLastName: string;
  authorName: string | null;
  authorFirstName: string | null;
  authorLastName: string | null;
  authorIsHidden: boolean;
  competencyName: string | null;
  goalId: string | null;
  goalTitle: string | null;
  projectTag: string | null;
  recognition: { name: string; colorHex: string; icon: string } | null;
  isMine: boolean;
}

async function chainLookup(orgId: string) {
  const { managerOf } = await loadReportingGraph(orgId);
  const cache = new Map<string, string[]>();
  return (employeeId: string): string[] => {
    const hit = cache.get(employeeId);
    if (hit) return hit;
    const chain = collectManagerChain(employeeId, managerOf);
    cache.set(employeeId, chain);
    return chain;
  };
}

type Row = Awaited<ReturnType<typeof loadRows>>[number];

async function loadRows(where: object, take: number) {
  return prisma.feedback.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    include: {
      author: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      about: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          departmentId: true,
        },
      },
      competency: { select: { name: true } },
      goal: { select: { id: true, title: true } },
      recognitionValue: { select: { name: true, colorHex: true, icon: true } },
    },
  });
}

function shape(row: Row, actor: Actor): FeedbackItem {
  const ref: FeedbackRef = {
    id: row.id,
    authorEmployeeId: row.authorEmployeeId,
    aboutEmployeeId: row.aboutEmployeeId,
    visibility: row.visibility,
    authorVisibility: row.authorVisibility,
    aboutManagerChainIds: [],
    aboutDepartmentId: row.about.departmentId,
  };
  const showAuthor = canSeeFeedbackAuthor(actor, ref);
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    visibility: row.visibility,
    authorVisibility: row.authorVisibility,
    createdAt: row.createdAt,
    aboutEmployeeId: row.aboutEmployeeId,
    aboutName: `${row.about.preferredName || row.about.firstName} ${row.about.lastName}`,
    aboutFirstName: row.about.firstName,
    aboutLastName: row.about.lastName,
    authorName:
      showAuthor && row.author
        ? `${row.author.preferredName || row.author.firstName} ${row.author.lastName}`
        : null,
    authorFirstName: showAuthor ? (row.author?.firstName ?? null) : null,
    authorLastName: showAuthor ? (row.author?.lastName ?? null) : null,
    authorIsHidden: !showAuthor,
    competencyName: row.competency?.name ?? null,
    goalId: row.goal?.id ?? null,
    goalTitle: row.goal?.title ?? null,
    projectTag: row.projectTag,
    recognition: row.recognitionValue
      ? {
          name: row.recognitionValue.name,
          colorHex: row.recognitionValue.colorHex,
          icon: row.recognitionValue.icon,
        }
      : null,
    isMine: row.authorEmployeeId !== null && row.authorEmployeeId === actor.employeeId,
  };
}

export interface FeedbackFilters {
  view?: 'all' | 'about-me' | 'written-by-me' | 'my-notes' | 'recognition' | 'team';
  aboutEmployeeId?: string;
  kind?: string;
  query?: string;
  limit?: number;
}

export async function listFeedback(actor: Actor, filters: FeedbackFilters = {}): Promise<FeedbackItem[]> {
  const where: Record<string, unknown> = { orgId: actor.orgId };
  const view = filters.view ?? 'all';

  if (view === 'about-me' && actor.employeeId) {
    where.aboutEmployeeId = actor.employeeId;
    where.visibility = { not: 'PRIVATE_NOTE_SELF' };
  } else if (view === 'written-by-me' && actor.employeeId) {
    where.authorEmployeeId = actor.employeeId;
  } else if (view === 'my-notes' && actor.employeeId) {
    where.authorEmployeeId = actor.employeeId;
    where.visibility = 'PRIVATE_NOTE_SELF';
  } else if (view === 'recognition') {
    where.kind = 'RECOGNITION';
  } else if (view === 'team' && actor.employeeId) {
    where.aboutEmployeeId = { in: actor.descendantIds };
  }

  if (filters.aboutEmployeeId) where.aboutEmployeeId = filters.aboutEmployeeId;
  if (filters.kind) where.kind = filters.kind;
  if (filters.query) where.body = containsInsensitive(filters.query);

  // Private notes are excluded at the query level unless they are the author's.
  if (view !== 'my-notes' && view !== 'written-by-me') {
    where.NOT = [
      {
        visibility: 'PRIVATE_NOTE_SELF',
        authorEmployeeId: actor.employeeId ? { not: actor.employeeId } : undefined,
      },
    ];
  }

  const rows = await loadRows(where, filters.limit ?? 120);
  const chainFor = await chainLookup(actor.orgId);

  return rows
    .filter((row) =>
      canViewFeedback(actor, {
        id: row.id,
        authorEmployeeId: row.authorEmployeeId,
        aboutEmployeeId: row.aboutEmployeeId,
        visibility: row.visibility,
        authorVisibility: row.authorVisibility,
        aboutManagerChainIds: chainFor(row.aboutEmployeeId),
        aboutDepartmentId: row.about.departmentId,
      }),
    )
    .map((row) => shape(row, actor));
}

export interface FeedbackInput {
  aboutEmployeeId: string;
  kind: string;
  body: string;
  visibility: string;
  authorVisibility?: string;
  competencyId?: string | null;
  goalId?: string | null;
  projectTag?: string | null;
  recognitionValueId?: string | null;
  requestId?: string | null;
}

export async function createFeedback(actor: Actor, input: FeedbackInput) {
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can give feedback.');
  if (!input.body || input.body.trim().length < 10) {
    throw new ValidationError(
      'Write at least 10 characters. Feedback that is too short to contain an example is rarely useful.',
    );
  }
  if (!FEEDBACK_KINDS.includes(input.kind as never)) throw new ValidationError('Unknown feedback type.');
  if (!FEEDBACK_VISIBILITIES.includes(input.visibility as never)) {
    throw new ValidationError('Unknown audience.');
  }
  const authorVisibility = input.authorVisibility ?? 'NAMED';
  if (!AUTHOR_VISIBILITIES.includes(authorVisibility as never)) {
    throw new ValidationError('Unknown setting for showing your name.');
  }

  const about = await prisma.employee.findFirst({
    where: { id: input.aboutEmployeeId, orgId: actor.orgId },
    select: { id: true, firstName: true, lastName: true, employmentStatus: true },
  });
  if (!about) throw new NotFoundError('That person could not be found.');

  if (input.visibility === 'PRIVATE_NOTE_SELF') {
    if (!canWritePrivateNoteAbout(actor, input.aboutEmployeeId)) {
      throw new ForbiddenError(
        'Private notes can be kept about yourself or someone in your reporting line.',
      );
    }
    if (authorVisibility !== 'NAMED') {
      throw new ValidationError('A private note is only ever visible to you, so it is always named.');
    }
  }

  if (!canUseFeedbackVisibility(actor, input.visibility, input.aboutEmployeeId)) {
    throw new ForbiddenError(
      'Writing to someone’s manager without the employee seeing it is limited to their management chain and HR. Send it to HR instead if you need to raise a concern.',
    );
  }

  // Anonymous feedback is deliberately limited. It is a real guarantee — the
  // identity is never written — so it is offered only where it is defensible:
  // escalation to HR. Everywhere else, "confidential" is the honest option.
  if (authorVisibility === 'ANONYMOUS' && input.visibility !== 'HR_ONLY') {
    throw new ValidationError(
      'Anonymous feedback can only be sent to HR administrators. For other audiences choose "confidential", which hides your name from the recipient but records it for HR.',
    );
  }
  if (input.kind === 'RECOGNITION' && authorVisibility !== 'NAMED') {
    throw new ValidationError('Recognition is always named — that is what makes it recognition.');
  }

  const created = await prisma.feedback.create({
    data: {
      orgId: actor.orgId,
      // The identity is simply not written for anonymous feedback.
      authorEmployeeId: authorVisibility === 'ANONYMOUS' ? null : actor.employeeId,
      aboutEmployeeId: input.aboutEmployeeId,
      kind: input.kind,
      body: input.body.trim(),
      visibility: input.visibility,
      authorVisibility,
      competencyId: input.competencyId || null,
      goalId: input.goalId || null,
      projectTag: input.projectTag?.trim() || null,
      recognitionValueId: input.recognitionValueId || null,
      requestId: input.requestId || null,
    },
  });

  if (input.requestId) {
    await prisma.feedbackRequest.updateMany({
      where: { id: input.requestId, responderEmployeeId: actor.employeeId, status: 'PENDING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.FEEDBACK_CREATED,
    entityType: 'feedback',
    entityId: created.id,
    // The body is never written to the audit log.
    summary:
      authorVisibility === 'ANONYMOUS'
        ? `Submitted anonymous feedback to HR. The author is not recorded on the feedback item.`
        : `Gave ${input.kind.toLowerCase().replace('_', ' ')} feedback about ${about.firstName} ${about.lastName}.`,
    metadata: { visibility: input.visibility, authorVisibility, kind: input.kind },
  });

  // Notify the recipient, except for private notes and manager-only items,
  // where telling them would defeat the point of the audience they chose.
  const notifyRecipient =
    input.visibility !== 'PRIVATE_NOTE_SELF' &&
    input.visibility !== 'MANAGER_ONLY' &&
    input.visibility !== 'HR_ONLY' &&
    input.aboutEmployeeId !== actor.employeeId;

  if (notifyRecipient) {
    await notify({
      orgId: actor.orgId,
      recipientEmployeeId: input.aboutEmployeeId,
      type: input.kind === 'RECOGNITION' ? 'feedback.recognition' : 'feedback.received',
      title:
        input.kind === 'RECOGNITION'
          ? `${actor.displayName} recognized your work`
          : authorVisibility === 'NAMED'
            ? `${actor.displayName} shared feedback with you`
            : 'You have new feedback',
      linkUrl: '/feedback?view=about-me',
      dedupeKey: `feedback:${created.id}`,
    });
  }

  if (input.visibility === 'HR_ONLY') {
    const hrUsers = await prisma.user.findMany({
      where: {
        orgId: actor.orgId,
        status: 'active',
        roles: { some: { role: 'HR_ADMIN' } },
        employee: { isNot: null },
      },
      select: { employee: { select: { id: true } } },
    });
    for (const u of hrUsers) {
      if (!u.employee) continue;
      await notify({
        orgId: actor.orgId,
        recipientEmployeeId: u.employee.id,
        type: 'feedback.hr',
        title: 'New feedback sent to HR',
        body: authorVisibility === 'ANONYMOUS' ? 'Submitted anonymously.' : undefined,
        linkUrl: '/feedback?view=all',
        severity: 'warning',
        dedupeKey: `feedback.hr:${created.id}:${u.employee.id}`,
      });
    }
  }

  return created;
}

export interface FeedbackRequestInput {
  responderEmployeeId: string;
  aboutEmployeeId: string;
  message?: string | null;
  dueAt?: string | null;
  competencyId?: string | null;
  goalId?: string | null;
  projectTag?: string | null;
  responseVisibility?: string;
}

export async function requestFeedback(actor: Actor, input: FeedbackRequestInput) {
  if (!actor.employeeId) throw new ForbiddenError('Only an employee record can request feedback.');

  const aboutSelf = input.aboutEmployeeId === actor.employeeId;
  const aboutReport = actor.descendantIds.includes(input.aboutEmployeeId);
  if (!aboutSelf && !aboutReport && !actor.isHrAdmin) {
    throw new ForbiddenError(
      'You can ask for feedback about yourself, or about someone in your reporting line.',
    );
  }
  if (input.responderEmployeeId === actor.employeeId) {
    throw new ValidationError('Asking yourself for feedback would not tell you much.');
  }

  const [responder, about] = await Promise.all([
    prisma.employee.findFirst({
      where: { id: input.responderEmployeeId, orgId: actor.orgId, employmentStatus: { not: 'terminated' } },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.employee.findFirst({
      where: { id: input.aboutEmployeeId, orgId: actor.orgId },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  if (!responder) throw new ValidationError('That person cannot be asked for feedback.');
  if (!about) throw new NotFoundError();

  const created = await prisma.feedbackRequest.create({
    data: {
      orgId: actor.orgId,
      requesterEmployeeId: actor.employeeId,
      responderEmployeeId: input.responderEmployeeId,
      aboutEmployeeId: input.aboutEmployeeId,
      message: input.message?.trim() || null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      competencyId: input.competencyId || null,
      goalId: input.goalId || null,
      projectTag: input.projectTag?.trim() || null,
      responseVisibility: input.responseVisibility ?? 'RECIPIENT_AND_MANAGER',
    },
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.FEEDBACK_REQUESTED,
    entityType: 'feedback_request',
    entityId: created.id,
    summary: `Asked ${responder.firstName} ${responder.lastName} for feedback about ${about.firstName} ${about.lastName}.`,
  });

  await notify({
    orgId: actor.orgId,
    recipientEmployeeId: input.responderEmployeeId,
    type: 'feedback.requested',
    title: `${actor.displayName} asked you for feedback about ${aboutSelf ? 'them' : `${about.firstName} ${about.lastName}`}`,
    body: input.message?.trim() || undefined,
    linkUrl: `/feedback/requests/${created.id}`,
    dedupeKey: `feedback.request:${created.id}`,
    email: {
      subject: `${actor.displayName} asked you for feedback`,
      text: `${actor.displayName} has asked you for feedback about ${about.firstName} ${about.lastName}.\n\n${input.message?.trim() ?? ''}\n\nRespond here: ${process.env.APP_URL ?? 'http://localhost:3000'}/feedback/requests/${created.id}`,
    },
  });

  return created;
}

export async function getFeedbackRequest(actor: Actor, requestId: string) {
  const request = await prisma.feedbackRequest.findFirst({
    where: { id: requestId, orgId: actor.orgId },
    include: {
      requester: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      responder: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
      about: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          jobTitle: { select: { name: true } },
        },
      },
      competency: { select: { id: true, name: true, description: true } },
      goal: { select: { id: true, title: true } },
    },
  });
  if (!request) throw new NotFoundError();

  const involved =
    actor.employeeId === request.responderEmployeeId ||
    actor.employeeId === request.requesterEmployeeId ||
    actor.isHrAdmin;
  if (!involved) throw new NotFoundError();

  return { request, canRespond: actor.employeeId === request.responderEmployeeId && request.status === 'PENDING' };
}

export async function declineFeedbackRequest(actor: Actor, requestId: string, reason: string | null) {
  const request = await prisma.feedbackRequest.findFirst({
    where: { id: requestId, orgId: actor.orgId },
    include: { requester: { select: { id: true } }, about: { select: { firstName: true, lastName: true } } },
  });
  if (!request) throw new NotFoundError();
  if (actor.employeeId !== request.responderEmployeeId) {
    throw new ForbiddenError('Only the person asked can decline a request.');
  }
  await prisma.feedbackRequest.update({
    where: { id: requestId },
    data: { status: 'DECLINED', message: reason ? `${request.message ?? ''}\n\nDeclined: ${reason}` : request.message },
  });
  await notify({
    orgId: actor.orgId,
    recipientEmployeeId: request.requesterEmployeeId,
    type: 'feedback.declined',
    title: `${actor.displayName} declined your feedback request`,
    body: reason ?? undefined,
    linkUrl: '/feedback?view=written-by-me',
    dedupeKey: `feedback.declined:${requestId}`,
  });
}

/** Feedback that may be referenced while writing a review about someone. */
export async function feedbackForReview(actor: Actor, aboutEmployeeId: string, since: Date) {
  const items = await listFeedback(actor, { aboutEmployeeId, limit: 60 });
  return items.filter((f) => f.createdAt >= since && f.visibility !== 'PRIVATE_NOTE_SELF');
}

export async function listRecognitionValues(orgId: string) {
  return prisma.recognitionValue.findMany({
    where: { orgId, active: true },
    orderBy: { sortOrder: 'asc' },
  });
}
