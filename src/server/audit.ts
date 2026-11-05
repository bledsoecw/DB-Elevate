import 'server-only';
import { prisma, type Db } from './db';
import type { Actor } from './authz/actor';

/**
 * Audit trail for consequential changes.
 *
 * `actorLabel` stores a human-readable name at the time of the event so the log
 * stays readable after an account is deactivated or an employee record is
 * renamed. Audit rows are never updated or deleted by application code.
 *
 * What is deliberately NOT recorded: the body of a review answer, a private
 * note, or any respondent identity for an anonymous survey. The log records
 * that something happened and who did it, not the confidential content.
 */
export const AUDIT_ACTIONS = {
  // Authentication
  LOGIN_SUCCEEDED: 'auth.login.succeeded',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password.changed',

  // People
  EMPLOYEE_CREATED: 'employee.created',
  EMPLOYEE_UPDATED: 'employee.updated',
  EMPLOYEE_DEACTIVATED: 'employee.deactivated',
  EMPLOYEE_REACTIVATED: 'employee.reactivated',
  MANAGER_CHANGED: 'employee.manager.changed',
  EMPLOYEES_IMPORTED: 'employee.imported',
  ROLE_GRANTED: 'user.role.granted',
  ROLE_REVOKED: 'user.role.revoked',
  USER_INVITED: 'user.invited',
  USER_STATUS_CHANGED: 'user.status.changed',

  // Catalogue (competencies, libraries, scales, recognition values)
  COMPETENCY_CREATED: 'competency.created',
  COMPETENCY_UPDATED: 'competency.updated',
  LIBRARY_CREATED: 'competency.library.created',
  LIBRARY_UPDATED: 'competency.library.updated',
  SCALE_CREATED: 'rating_scale.created',
  SCALE_UPDATED: 'rating_scale.updated',
  RECOGNITION_CREATED: 'recognition_value.created',
  RECOGNITION_UPDATED: 'recognition_value.updated',

  // Templates
  TEMPLATE_CREATED: 'template.created',
  TEMPLATE_UPDATED: 'template.updated',
  TEMPLATE_PUBLISHED: 'template.published',
  TEMPLATE_VERSION_CREATED: 'template.version.created',
  TEMPLATE_DUPLICATED: 'template.duplicated',
  TEMPLATE_ARCHIVED: 'template.archived',

  // Cycles
  CYCLE_CREATED: 'cycle.created',
  CYCLE_UPDATED: 'cycle.updated',
  CYCLE_LAUNCHED: 'cycle.launched',
  CYCLE_CLOSED: 'cycle.closed',
  CYCLE_CANCELLED: 'cycle.cancelled',
  PARTICIPANT_ADDED: 'cycle.participant.added',
  PARTICIPANT_REMOVED: 'cycle.participant.removed',
  REVIEWER_ASSIGNED: 'cycle.reviewer.assigned',
  REVIEWER_UNASSIGNED: 'cycle.reviewer.unassigned',

  // Review lifecycle
  REVIEW_SUBMITTED: 'review.submitted',
  REVIEW_REOPENED: 'review.reopened',
  REVIEW_DECLINED: 'review.declined',
  REVIEW_APPROVAL_REQUESTED: 'review.approval.requested',
  REVIEW_APPROVED: 'review.approved',
  REVIEW_CHANGES_REQUESTED: 'review.changes_requested',
  REVIEW_RELEASED: 'review.released',
  REVIEW_ACKNOWLEDGED: 'review.acknowledged',
  REVIEW_SCORE_CALIBRATED: 'review.score.calibrated',
  CALIBRATION_SESSION_CREATED: 'calibration.session.created',
  CALIBRATION_FINALIZED: 'calibration.finalized',

  // Goals / feedback / meetings
  GOAL_CREATED: 'goal.created',
  GOAL_UPDATED: 'goal.updated',
  GOAL_CLOSED: 'goal.closed',
  GOAL_VISIBILITY_CHANGED: 'goal.visibility.changed',
  FEEDBACK_CREATED: 'feedback.created',
  FEEDBACK_REQUESTED: 'feedback.requested',
  MEETING_CREATED: 'meeting.created',
  MEETING_COMPLETED: 'meeting.completed',
  ACTION_ITEM_CREATED: 'action.created',
  ACTION_ITEM_COMPLETED: 'action.completed',

  // Surveys
  SURVEY_CREATED: 'survey.created',
  SURVEY_UPDATED: 'survey.updated',
  SURVEY_LAUNCHED: 'survey.launched',
  SURVEY_CLOSED: 'survey.closed',
  SURVEY_RESPONSE_SUBMITTED: 'survey.response.submitted',

  // Development
  PLAN_CREATED: 'plan.created',
  PLAN_UPDATED: 'plan.updated',
  PLAN_CLOSED: 'plan.closed',

  // Administration
  ORG_SETTINGS_UPDATED: 'org.settings.updated',
  BRANDING_UPDATED: 'org.branding.updated',
  AI_SETTINGS_UPDATED: 'org.ai.updated',
  EXPORT_GENERATED: 'report.export.generated',
  ATTACHMENT_UPLOADED: 'attachment.uploaded',
  ATTACHMENT_DOWNLOADED: 'attachment.downloaded',
  AI_SUGGESTION_REQUESTED: 'ai.suggestion.requested',
  AI_SUGGESTION_DECIDED: 'ai.suggestion.decided',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditInput {
  action: AuditAction | string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(
  actor: Pick<Actor, 'orgId' | 'userId' | 'employeeId' | 'displayName'> | null,
  input: AuditInput,
  db: Db = prisma,
): Promise<void> {
  if (!actor) return;
  try {
    await db.auditEvent.create({
      data: {
        orgId: actor.orgId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorLabel: actor.displayName,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 500) : null,
      },
    });
  } catch (err) {
    // An audit failure must not take down the operation the user asked for, but
    // it must be loud in the logs.
    console.error('[audit] failed to record event', input.action, input.entityId, err);
  }
}

/** Audit an event with no signed-in actor (scheduled jobs, system actions). */
export async function recordSystemAudit(
  orgId: string,
  input: AuditInput,
  db: Db = prisma,
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        orgId,
        actorLabel: 'System',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        summary: input.summary,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to record system event', input.action, err);
  }
}
