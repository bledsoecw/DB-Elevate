import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { collectManagerChain, loadReportingGraph } from '../authz/actor';
import {
  canViewEmployeePerformanceRecord,
  canViewGoal,
  canViewMeeting,
  canViewOwnAssignment,
  canViewPlan,
} from '../authz/policy';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  deleteStoredFile,
  readStoredFile,
  storedFileExists,
  writeStoredFile,
} from '../storage/files';

/**
 * Attachments.
 *
 * An attachment has no visibility of its own. It inherits the record it hangs
 * off, and that inheritance is resolved on every single read — there is no
 * cached grant, no signed URL, and no path that returns bytes without first
 * loading the owning record and asking the same policy function the screen
 * asks.
 *
 * The owner types are deliberately a closed set. Adding a new one means adding
 * a branch to `canAccessOwner` below, which fails the build until it is
 * handled, rather than defaulting to "allowed" for a record nobody thought
 * about.
 */

export const ATTACHMENT_OWNER_TYPES = [
  'review_assignment',
  'goal',
  'development_plan',
  'meeting',
  'employee',
] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];

export function isAttachmentOwnerType(value: string): value is AttachmentOwnerType {
  return (ATTACHMENT_OWNER_TYPES as readonly string[]).includes(value);
}

/**
 * Whether the actor may see the record an attachment hangs off.
 *
 * `write` is stricter than read in one place that matters: a reviewer may
 * attach evidence to their own draft, but nobody attaches anything to a
 * submitted review — a record somebody signed should not grow new documents
 * afterwards.
 */
async function canAccessOwner(
  actor: Actor,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  mode: 'read' | 'write',
): Promise<boolean> {
  switch (ownerType) {
    case 'review_assignment': {
      const assignment = await prisma.reviewAssignment.findFirst({
        where: { id: ownerId, participant: { cycle: { orgId: actor.orgId } } },
        select: {
          id: true,
          kind: true,
          reviewerEmployeeId: true,
          status: true,
          participantId: true,
        },
      });
      if (!assignment) return false;
      const ref = {
        id: assignment.id,
        kind: assignment.kind,
        reviewerEmployeeId: assignment.reviewerEmployeeId,
        status: assignment.status,
        participantId: assignment.participantId,
      };
      if (mode === 'write') {
        // Only the author, and only while it is still theirs to edit.
        return (
          assignment.reviewerEmployeeId === actor.employeeId &&
          ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(assignment.status)
        );
      }
      return canViewOwnAssignment(actor, ref);
    }

    case 'goal': {
      const goal = await prisma.goal.findFirst({
        where: { id: ownerId, orgId: actor.orgId },
        select: {
          id: true,
          ownerEmployeeId: true,
          scope: true,
          visibility: true,
          departmentId: true,
          collaborators: { select: { employeeId: true } },
        },
      });
      if (!goal) return false;
      const { managerOf: goalManagerOf } = await loadReportingGraph(actor.orgId);
      return canViewGoal(actor, {
        id: goal.id,
        ownerEmployeeId: goal.ownerEmployeeId,
        scope: goal.scope,
        visibility: goal.visibility,
        departmentId: goal.departmentId,
        collaboratorIds: goal.collaborators.map((c) => c.employeeId),
        ownerManagerChainIds: goal.ownerEmployeeId
          ? collectManagerChain(goal.ownerEmployeeId, goalManagerOf)
          : [],
      });
    }

    case 'development_plan': {
      const plan = await prisma.developmentPlan.findFirst({
        where: { id: ownerId, orgId: actor.orgId },
        select: { employeeId: true, planType: true, hrRestricted: true },
      });
      if (!plan) return false;
      const { managerOf } = await loadReportingGraph(actor.orgId);
      return canViewPlan(actor, {
        employeeId: plan.employeeId,
        planType: plan.planType,
        hrRestricted: plan.hrRestricted,
        employeeManagerChainIds: collectManagerChain(plan.employeeId, managerOf),
      });
    }

    case 'meeting': {
      const meeting = await prisma.meeting.findFirst({
        where: { id: ownerId, orgId: actor.orgId },
        select: { id: true, participants: { select: { employeeId: true } } },
      });
      if (!meeting) return false;
      return canViewMeeting(actor, {
        id: meeting.id,
        participantIds: meeting.participants.map((p) => p.employeeId),
      });
    }

    case 'employee': {
      const employee = await prisma.employee.findFirst({
        where: { id: ownerId, orgId: actor.orgId },
        select: { id: true },
      });
      if (!employee) return false;
      // A document on a personnel record is personnel information, so it
      // follows the performance-record rule rather than the directory one.
      if (mode === 'write') return actor.isHrAdmin;
      return canViewEmployeePerformanceRecord(actor, ownerId);
    }
  }
}

export async function listAttachments(
  actor: Actor,
  ownerType: AttachmentOwnerType,
  ownerId: string,
) {
  if (!(await canAccessOwner(actor, ownerType, ownerId, 'read'))) {
    throw new NotFoundError();
  }
  return prisma.attachment.findMany({
    where: { orgId: actor.orgId, ownerType, ownerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      uploadedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export interface UploadInput {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

export async function uploadAttachment(actor: Actor, input: UploadInput) {
  if (!actor.employeeId) {
    throw new ForbiddenError('An attachment has to be attributable to a person.');
  }
  if (!(await canAccessOwner(actor, input.ownerType, input.ownerId, 'write'))) {
    // 404, not 403: whether a record exists is itself information.
    throw new NotFoundError();
  }

  if (input.bytes.byteLength === 0) {
    throw new ValidationError('That file is empty.');
  }
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `That file is ${(input.bytes.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (!ALLOWED_MIME_TYPES[input.mimeType]) {
    throw new ValidationError(
      `Files of type ${input.mimeType || 'unknown'} are not accepted. Allowed: PDF, images, plain text, CSV, Word and Excel documents.`,
    );
  }

  const stored = await writeStoredFile(input.bytes);

  try {
    const attachment = await prisma.attachment.create({
      data: {
        orgId: actor.orgId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        // The chosen name is stored as a label only; it is never a path.
        filename: input.filename.slice(0, 255),
        mimeType: input.mimeType,
        sizeBytes: stored.sizeBytes,
        storageKey: stored.storageKey,
        checksum: stored.checksum,
        uploadedByEmployeeId: actor.employeeId,
        visibility: 'INHERIT',
      },
      select: { id: true, filename: true, sizeBytes: true },
    });

    await recordAudit(actor, {
      action: AUDIT_ACTIONS.ATTACHMENT_UPLOADED,
      entityType: input.ownerType,
      entityId: input.ownerId,
      summary: `Attached "${attachment.filename}" (${(attachment.sizeBytes / 1024).toFixed(0)} KB)`,
      metadata: { attachmentId: attachment.id, mimeType: input.mimeType },
    });

    return attachment;
  } catch (e) {
    // Do not leave an orphan on disk if the row could not be written.
    await deleteStoredFile(stored.storageKey);
    throw e;
  }
}

/**
 * Resolves an attachment for download, re-checking the owning record's
 * visibility every time. Downloads are audited, because who read a personnel
 * document is often exactly the question asked later.
 */
export async function readAttachment(
  actor: Actor,
  attachmentId: string,
): Promise<{ filename: string; mimeType: string; bytes: Buffer }> {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, orgId: actor.orgId },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      filename: true,
      mimeType: true,
      storageKey: true,
    },
  });
  if (!attachment) throw new NotFoundError();

  if (!isAttachmentOwnerType(attachment.ownerType)) {
    // A row with an owner type this build does not understand is refused
    // rather than served; failing closed is the only safe default here.
    throw new NotFoundError();
  }

  if (!(await canAccessOwner(actor, attachment.ownerType, attachment.ownerId, 'read'))) {
    throw new NotFoundError();
  }

  if (!(await storedFileExists(attachment.storageKey))) {
    throw new NotFoundError(
      'The record for this file exists but the file itself is missing from storage. Restore it from a backup, ' +
        'or remove the attachment.',
    );
  }

  const bytes = await readStoredFile(attachment.storageKey);

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.ATTACHMENT_DOWNLOADED,
    entityType: attachment.ownerType,
    entityId: attachment.ownerId,
    summary: `Downloaded "${attachment.filename}"`,
    metadata: { attachmentId: attachment.id },
  });

  return { filename: attachment.filename, mimeType: attachment.mimeType, bytes };
}

export async function deleteAttachment(actor: Actor, attachmentId: string): Promise<void> {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, orgId: actor.orgId },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      filename: true,
      storageKey: true,
      uploadedByEmployeeId: true,
    },
  });
  if (!attachment) throw new NotFoundError();
  if (!isAttachmentOwnerType(attachment.ownerType)) throw new NotFoundError();

  const mayWrite = await canAccessOwner(actor, attachment.ownerType, attachment.ownerId, 'write');
  const isUploader = attachment.uploadedByEmployeeId === actor.employeeId;
  if (!mayWrite && !(isUploader && actor.employeeId)) {
    throw new NotFoundError();
  }

  await prisma.attachment.delete({ where: { id: attachmentId } });
  await deleteStoredFile(attachment.storageKey);

  await recordAudit(actor, {
    action: 'attachment.deleted',
    entityType: attachment.ownerType,
    entityId: attachment.ownerId,
    summary: `Removed the attachment "${attachment.filename}"`,
    metadata: { attachmentId },
  });
}
