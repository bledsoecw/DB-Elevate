/**
 * Pure authorization predicates.
 *
 * Nothing here touches the database, so every rule can be unit-tested against
 * plain objects (see tests/unit/policy.test.ts). The service layer is
 * responsible for loading the minimal resource shape and, for historical
 * review access, for resolving the reporting chain as it stood at the time.
 *
 * The full matrix in prose lives in docs/PERMISSIONS.md. Where the two
 * disagree, this file is the implementation and the document is the bug.
 */

import type { Actor } from './actor';
import type {
  AssignmentStatus,
  AuthorVisibility,
  CycleStatus,
  FeedbackVisibility,
  GoalVisibility,
  ParticipantStatus,
  PeerVisibilityMode,
  ReviewerKind,
} from '@/lib/enums';

// ---------------------------------------------------------------------------
// Role-level capabilities
// ---------------------------------------------------------------------------

/**
 * Design decision: SYS_ADMIN is an *application* administration role. It can
 * manage accounts, roles, branding, integrations and read the audit log, but it
 * does NOT by itself grant access to review content, private notes, or
 * HR-restricted personnel records. An administrator who legitimately needs both
 * is granted SYS_ADMIN and HR_ADMIN explicitly, and that grant is audited.
 */
export function canAdministerApp(actor: Actor): boolean {
  return actor.isSysAdmin;
}

/** HR / performance-program administration: people, templates, cycles, surveys. */
export function canAdministerProgram(actor: Actor): boolean {
  return actor.isHrAdmin;
}

export function canManageTemplates(actor: Actor): boolean {
  return actor.isHrAdmin;
}

export function canManageCycles(actor: Actor): boolean {
  return actor.isHrAdmin;
}

export function canManageSurveys(actor: Actor): boolean {
  return actor.isHrAdmin;
}

/**
 * Organization settings, branding, mail delivery and AI configuration are
 * application administration, so they are SYS_ADMIN only.
 *
 * Deliberately NOT granted to HR_ADMIN. An HR administrator running the
 * performance programme has no business changing the mail provider, lowering a
 * privacy threshold, or switching on a metered AI service — and the two roles
 * only overlap where someone has been granted both explicitly.
 */
export function canManageOrgSettings(actor: Actor): boolean {
  return actor.isSysAdmin;
}

export function canManageAccountsAndRoles(actor: Actor): boolean {
  return actor.isSysAdmin;
}

/**
 * Both administrators can read the log, and that is intentional. It holds no
 * review text, no private note and no respondent identity (see audit.ts), so
 * reading it discloses nothing either role is not already trusted with — while
 * an HR administrator genuinely needs to answer "who released this review, and
 * when". Reading the log grants no access to the records it refers to.
 */
export function canReadAuditLog(actor: Actor): boolean {
  return actor.isSysAdmin || actor.isHrAdmin;
}

/** Organization-wide aggregate reporting. */
export function canViewOrgWideReports(actor: Actor): boolean {
  return actor.isHrAdmin || actor.isLeadership;
}

export function canRunCalibration(actor: Actor): boolean {
  return actor.isHrAdmin;
}

// ---------------------------------------------------------------------------
// Compensation
//
// A deliberately separate access model. Salary is a different confidentiality
// class from performance: in most organizations it is explicitly NOT for the
// direct manager who writes the review, and it is often restricted to finance
// and senior leadership regardless of the reporting line.
//
// So COMPENSATION_ADMIN is never implied by HR_ADMIN, SYS_ADMIN or LEADERSHIP.
// Somebody who needs both is granted both, and the grant is audited.
// ---------------------------------------------------------------------------

export function canAdministerCompensation(actor: Actor): boolean {
  return actor.isCompensationAdmin;
}

/** Everyone may see their own pay. */
export function canViewOwnCompensation(actor: Actor, employeeId: string): boolean {
  return actor.employeeId !== null && actor.employeeId === employeeId;
}

export interface CompParticipantRef {
  employeeId: string;
  /** The manager who owns this allocation, snapshotted at launch. */
  managerIdSnapshot: string | null;
  cycleStatus: string;
  status: string;
}

/**
 * Whether the actor may see this person's pay inside a compensation cycle.
 *
 * A manager sees their own reports' current pay only while they are actually
 * allocating — that is the narrowest grant that lets the task be done, and it
 * closes again when the cycle does. It is scoped to the manager of record at
 * launch, so a reorganization mid-cycle does not move who is deciding
 * somebody's pay.
 */
export function canViewCompensationParticipant(
  actor: Actor,
  participant: CompParticipantRef,
): boolean {
  if (canAdministerCompensation(actor)) return true;
  if (canViewOwnCompensation(actor, participant.employeeId)) {
    // The employee sees their own line only once it has been applied —
    // an in-flight proposal is not yet a fact about their pay.
    return participant.status === 'APPLIED';
  }
  if (!actor.employeeId) return false;
  if (participant.managerIdSnapshot !== actor.employeeId) return false;
  return ['PLANNING', 'IN_APPROVAL', 'APPROVED', 'APPLIED'].includes(participant.cycleStatus);
}

/** Whether the actor may set the number. Only while the cycle is open for it. */
export function canAllocateCompensation(
  actor: Actor,
  participant: CompParticipantRef,
): boolean {
  if (participant.cycleStatus !== 'PLANNING') return false;
  // An employee never allocates their own pay, even if they manage themselves
  // through some data accident.
  if (actor.employeeId === participant.employeeId) return false;
  if (canAdministerCompensation(actor)) return true;
  return actor.employeeId !== null && participant.managerIdSnapshot === actor.employeeId;
}

/** Approving a submitted allocation is a compensation-administration act. */
export function canApproveCompensation(actor: Actor): boolean {
  return actor.isCompensationAdmin;
}

/** Salary bands are configuration, but they are salary configuration. */
export function canManageSalaryBands(actor: Actor): boolean {
  return actor.isCompensationAdmin;
}

// ---------------------------------------------------------------------------
// Employee records
// ---------------------------------------------------------------------------

export interface EmployeeRef {
  id: string;
  managerId: string | null;
  departmentId: string | null;
}

export type EmployeeAccess = 'SELF' | 'MANAGER' | 'HR' | 'LEADERSHIP' | 'DIRECTORY' | 'NONE';

/**
 * Directory-level access. Everyone in the organization can look up a colleague's
 * name, job title, department and manager — the same facts a company org chart
 * would show. Everything beyond that is gated by `employeeAccess`.
 */
export function canViewEmployeeDirectoryEntry(actor: Actor): boolean {
  return actor.employeeId !== null || actor.isHrAdmin || actor.isSysAdmin;
}

export function employeeAccess(actor: Actor, employeeId: string): EmployeeAccess {
  if (actor.employeeId && actor.employeeId === employeeId) return 'SELF';
  if (actor.isHrAdmin) return 'HR';
  if (actor.descendantIds.includes(employeeId)) return 'MANAGER';
  if (actor.isLeadership) return 'LEADERSHIP';
  if (actor.employeeId) return 'DIRECTORY';
  if (actor.isSysAdmin) return 'DIRECTORY';
  return 'NONE';
}

/** The employee's own performance record: reviews, goals, feedback, plans. */
export function canViewEmployeePerformanceRecord(actor: Actor, employeeId: string): boolean {
  const access = employeeAccess(actor, employeeId);
  return access === 'SELF' || access === 'MANAGER' || access === 'HR';
}

export function canEditEmployeeRecord(actor: Actor, employeeId: string): boolean {
  if (actor.isHrAdmin) return true;
  // A manager may maintain non-sensitive details for their own reports, but not
  // reassign reporting lines or employment status - see canChangeReportingLine.
  return actor.descendantIds.includes(employeeId) && actor.directReportIds.includes(employeeId);
}

export function canChangeReportingLine(actor: Actor): boolean {
  return actor.isHrAdmin;
}

export function canDeactivateEmployee(actor: Actor): boolean {
  return actor.isHrAdmin;
}

/** HR-restricted personnel content: improvement plans, HR-only feedback. */
export function canViewHrRestricted(actor: Actor): boolean {
  return actor.isHrAdmin;
}

// ---------------------------------------------------------------------------
// Review cycles, participants, assignments
// ---------------------------------------------------------------------------

export interface CycleRef {
  id: string;
  status: CycleStatus | string;
  requireApproval: boolean;
  shareSelfWithManager: boolean;
  sharePeerWithEmployee: boolean;
  peerVisibilityMode: PeerVisibilityMode | string;
  requireAcknowledgement: boolean;
}

export interface ParticipantRef {
  id: string;
  employeeId: string;
  managerIdSnapshot: string | null;
  status: ParticipantStatus | string;
}

export interface AssignmentRef {
  id: string;
  participantId: string;
  reviewerEmployeeId: string;
  kind: ReviewerKind | string;
  status: AssignmentStatus | string;
}

export type ParticipantAccess =
  | 'SUBJECT'
  | 'MANAGER_OF_RECORD'
  | 'UPPER_CHAIN_OF_RECORD'
  | 'HR'
  | 'NONE';

/**
 * Who may see a participant's review record at all.
 *
 * `snapshotChainIds` is the employee's management chain *as it stood when the
 * cycle launched* (excluding the manager of record, which is checked
 * separately). Passing today's chain instead would let a reorganization hand a
 * new manager access to reviews conducted under a previous one — which the
 * product explicitly must not do.
 */
export function participantAccess(
  actor: Actor,
  participant: ParticipantRef,
  snapshotChainIds: string[],
): ParticipantAccess {
  if (actor.employeeId && actor.employeeId === participant.employeeId) return 'SUBJECT';
  if (actor.isHrAdmin) return 'HR';
  if (actor.employeeId && participant.managerIdSnapshot === actor.employeeId) {
    return 'MANAGER_OF_RECORD';
  }
  if (actor.employeeId && snapshotChainIds.includes(actor.employeeId)) {
    return 'UPPER_CHAIN_OF_RECORD';
  }
  return 'NONE';
}

const RELEASED_STATUSES = new Set(['RELEASED', 'ACKNOWLEDGED', 'CLOSED']);
export function isReleased(participant: ParticipantRef): boolean {
  return RELEASED_STATUSES.has(String(participant.status));
}

/** A reviewer may always see and work on their own assignment. */
export function canViewOwnAssignment(actor: Actor, assignment: AssignmentRef): boolean {
  return actor.employeeId !== null && actor.employeeId === assignment.reviewerEmployeeId;
}

/**
 * May the actor edit this assignment's answers?
 * Only the assigned reviewer, and only while it is open for editing.
 */
export function canEditAssignment(actor: Actor, assignment: AssignmentRef): boolean {
  if (!canViewOwnAssignment(actor, assignment)) return false;
  return ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(String(assignment.status));
}

export function canSubmitAssignment(actor: Actor, assignment: AssignmentRef): boolean {
  return canEditAssignment(actor, assignment);
}

/**
 * Visibility of another person's assignment *content*.
 *
 * The decisive rule: draft content belongs to its author alone. Nobody — not the
 * manager, not HR, not leadership — reads an unsubmitted form. Progress and
 * status are visible to administrators; the words inside are not.
 */
export function canViewAssignmentContent(
  actor: Actor,
  cycle: CycleRef,
  participant: ParticipantRef,
  assignment: AssignmentRef,
  access: ParticipantAccess,
): boolean {
  // Own work is always visible to its author.
  if (canViewOwnAssignment(actor, assignment)) return true;
  if (access === 'NONE') return false;

  const submitted = String(assignment.status) === 'SUBMITTED';
  if (!submitted) return false; // drafts are private to the reviewer

  const kind = String(assignment.kind);
  const released = isReleased(participant);

  if (access === 'HR') {
    // HR administers the program and handles disputes, so may read submitted
    // content. Anonymous-aggregate peer content is withheld even from HR
    // because the promise made to the reviewer was that it is only ever shown
    // combined - see docs/PRIVACY.md.
    if (kind === 'PEER' && String(cycle.peerVisibilityMode) === 'ANONYMOUS_AGGREGATE') return false;
    return true;
  }

  if (access === 'MANAGER_OF_RECORD' || access === 'UPPER_CHAIN_OF_RECORD') {
    if (kind === 'SELF') return cycle.shareSelfWithManager;
    if (kind === 'MANAGER') return true;
    if (kind === 'PEER') {
      // Named and confidential peer reviews are readable by the manager who has
      // to write the review. Anonymous-aggregate is never shown item by item.
      return String(cycle.peerVisibilityMode) !== 'ANONYMOUS_AGGREGATE';
    }
    return true;
  }

  if (access === 'SUBJECT') {
    // The employee sees results only once they have been released.
    if (!released) return false;
    if (kind === 'SELF') return true;
    if (kind === 'MANAGER') return true;
    if (kind === 'PEER') {
      if (!cycle.sharePeerWithEmployee) return false;
      return String(cycle.peerVisibilityMode) !== 'ANONYMOUS_AGGREGATE';
    }
    return false;
  }

  return false;
}

/** Whether the reviewer's name may be shown next to peer content. */
export function canSeePeerReviewerIdentity(
  cycle: CycleRef,
  access: ParticipantAccess,
): boolean {
  const mode = String(cycle.peerVisibilityMode);
  if (mode === 'NAMED') return access !== 'NONE';
  if (mode === 'CONFIDENTIAL') return access === 'HR';
  return false; // ANONYMOUS_AGGREGATE: identity is not shown to anyone
}

/** Who can see the computed score and its breakdown. */
export function canViewParticipantScore(
  participant: ParticipantRef,
  access: ParticipantAccess,
): boolean {
  if (access === 'NONE') return false;
  if (access === 'SUBJECT') return isReleased(participant);
  return true;
}

export function canReleaseParticipant(actor: Actor, access: ParticipantAccess): boolean {
  // Release is a deliberate administrative act. Managers prepare; HR releases.
  return actor.isHrAdmin && access !== 'NONE';
}

export function canReopenAssignment(actor: Actor): boolean {
  return actor.isHrAdmin;
}

export function canAcknowledge(actor: Actor, participant: ParticipantRef): boolean {
  return (
    actor.employeeId === participant.employeeId &&
    String(participant.status) === 'RELEASED'
  );
}

export function canCalibrate(actor: Actor): boolean {
  return actor.isHrAdmin;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalRef {
  id: string;
  scope: string;
  ownerEmployeeId: string | null;
  departmentId: string | null;
  visibility: GoalVisibility | string;
  collaboratorIds: string[];
  /** The owner's current management chain, resolved by the service layer. */
  ownerManagerChainIds: string[];
}

export function canViewGoal(actor: Actor, goal: GoalRef): boolean {
  if (actor.isHrAdmin) return true;
  if (!actor.employeeId) return false;
  if (goal.ownerEmployeeId === actor.employeeId) return true;
  if (goal.collaboratorIds.includes(actor.employeeId)) return true;

  const visibility = String(goal.visibility);
  if (String(goal.scope) === 'COMPANY') {
    // Company goals are visible company-wide unless explicitly marked private.
    return visibility !== 'PRIVATE';
  }
  if (visibility === 'PRIVATE') return false;
  if (visibility === 'ORGANIZATION') return true;
  if (visibility === 'DEPARTMENT') {
    if (goal.departmentId && goal.departmentId === actor.departmentId) return true;
    return goal.ownerManagerChainIds.includes(actor.employeeId);
  }
  // MANAGER_CHAIN
  if (goal.ownerManagerChainIds.includes(actor.employeeId)) return true;
  if (String(goal.scope) === 'TEAM' && goal.departmentId && goal.departmentId === actor.departmentId) {
    return true;
  }
  if (actor.isLeadership && visibility !== 'PRIVATE') return true;
  return false;
}

export function canEditGoal(actor: Actor, goal: GoalRef): boolean {
  if (actor.isHrAdmin) return true;
  if (!actor.employeeId) return false;
  if (goal.ownerEmployeeId === actor.employeeId) return true;
  if (goal.collaboratorIds.includes(actor.employeeId)) return true;
  // The owner's manager may edit a report's goal (setting direction is part of
  // the job); higher up the chain may view but not rewrite.
  if (goal.ownerEmployeeId && actor.directReportIds.includes(goal.ownerEmployeeId)) return true;
  if (String(goal.scope) === 'COMPANY') return false;
  return false;
}

export function canUpdateGoalProgress(actor: Actor, goal: GoalRef): boolean {
  return canEditGoal(actor, goal);
}

export function canCommentOnGoal(actor: Actor, goal: GoalRef): boolean {
  return canViewGoal(actor, goal);
}

export function canCreateCompanyGoal(actor: Actor): boolean {
  return actor.isHrAdmin || actor.isLeadership;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export interface FeedbackRef {
  id: string;
  authorEmployeeId: string | null;
  aboutEmployeeId: string;
  visibility: FeedbackVisibility | string;
  authorVisibility: AuthorVisibility | string;
  /** The subject's current management chain, resolved by the service layer. */
  aboutManagerChainIds: string[];
  aboutDepartmentId: string | null;
}

export function canViewFeedback(actor: Actor, item: FeedbackRef): boolean {
  if (!actor.employeeId && !actor.isHrAdmin) return false;
  const me = actor.employeeId;
  const visibility = String(item.visibility);

  // A private note is visible only to the person who wrote it, full stop.
  if (visibility === 'PRIVATE_NOTE_SELF') {
    return me !== null && item.authorEmployeeId === me;
  }

  // Authors can always see what they wrote (an anonymous item has no author).
  if (me && item.authorEmployeeId && item.authorEmployeeId === me) return true;

  if (visibility === 'HR_ONLY') return actor.isHrAdmin;
  if (actor.isHrAdmin) return true;
  if (!me) return false;

  const isSubject = me === item.aboutEmployeeId;
  const inChain = item.aboutManagerChainIds.includes(me);

  switch (visibility) {
    case 'RECIPIENT_ONLY':
      return isSubject;
    case 'RECIPIENT_AND_MANAGER':
      return isSubject || inChain;
    case 'MANAGER_ONLY':
      return inChain;
    case 'DEPARTMENT':
      return (
        isSubject ||
        inChain ||
        (item.aboutDepartmentId !== null && item.aboutDepartmentId === actor.departmentId)
      );
    case 'ORGANIZATION':
      return true;
    default:
      return false;
  }
}

/**
 * Whether the author's name may be shown.
 *  - NAMED        : shown to anyone who can see the item.
 *  - CONFIDENTIAL : stored, but revealed only to HR administrators.
 *  - ANONYMOUS    : not stored at all, so there is nothing to reveal.
 */
export function canSeeFeedbackAuthor(actor: Actor, item: FeedbackRef): boolean {
  const mode = String(item.authorVisibility);
  if (mode === 'ANONYMOUS') return false;
  if (item.authorEmployeeId === null) return false;
  if (actor.employeeId && item.authorEmployeeId === actor.employeeId) return true;
  if (mode === 'NAMED') return true;
  return actor.isHrAdmin; // CONFIDENTIAL
}

export function canWritePrivateNoteAbout(actor: Actor, aboutEmployeeId: string): boolean {
  if (!actor.employeeId) return false;
  if (actor.employeeId === aboutEmployeeId) return true;
  return actor.descendantIds.includes(aboutEmployeeId) || actor.isHrAdmin;
}

/** HR_ONLY and MANAGER_ONLY audiences are not available to everyone. */
export function canUseFeedbackVisibility(
  actor: Actor,
  visibility: string,
  aboutEmployeeId: string,
): boolean {
  if (visibility === 'HR_ONLY') return true; // anyone may escalate to HR
  if (visibility === 'PRIVATE_NOTE_SELF') return true;
  if (visibility === 'MANAGER_ONLY') {
    // Writing to someone's manager behind their back is restricted to the
    // management chain and HR, so it cannot be used for anonymous sniping.
    if (actor.isHrAdmin) return true;
    return actor.descendantIds.includes(aboutEmployeeId);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Meetings and action items
// ---------------------------------------------------------------------------

export interface MeetingRef {
  id: string;
  participantIds: string[];
}

export function canViewMeeting(actor: Actor, meeting: MeetingRef): boolean {
  if (!actor.employeeId) return actor.isHrAdmin;
  if (meeting.participantIds.includes(actor.employeeId)) return true;
  // HR can confirm that 1:1s are happening (participation reporting) but note
  // visibility is handled separately by canViewMeetingNote.
  return actor.isHrAdmin;
}

export function canEditMeeting(actor: Actor, meeting: MeetingRef): boolean {
  return actor.employeeId !== null && meeting.participantIds.includes(actor.employeeId);
}

export interface MeetingNoteRef {
  authorEmployeeId: string;
  visibility: string;
  meetingParticipantIds: string[];
}

/**
 * Private meeting notes are visible to their author only. No role overrides
 * this, including HR and system administrators. Shared notes are visible to
 * the meeting participants.
 */
export function canViewMeetingNote(actor: Actor, note: MeetingNoteRef): boolean {
  if (!actor.employeeId) return false;
  if (note.authorEmployeeId === actor.employeeId) return true;
  if (String(note.visibility) === 'PRIVATE') return false;
  return note.meetingParticipantIds.includes(actor.employeeId);
}

export interface ActionItemRef {
  ownerEmployeeId: string;
  assignedByEmployeeId: string | null;
  visibility: string;
  meetingParticipantIds: string[];
  /** The owner's current management chain. */
  ownerManagerChainIds: string[];
}

export function canViewActionItem(actor: Actor, item: ActionItemRef): boolean {
  if (String(item.visibility) === 'HR_RESTRICTED') {
    if (actor.isHrAdmin) return true;
    if (actor.employeeId === item.ownerEmployeeId) return true;
    return actor.employeeId !== null && item.ownerManagerChainIds.includes(actor.employeeId);
  }
  if (actor.isHrAdmin) return true;
  if (!actor.employeeId) return false;
  if (item.ownerEmployeeId === actor.employeeId) return true;
  if (item.assignedByEmployeeId === actor.employeeId) return true;
  if (item.meetingParticipantIds.includes(actor.employeeId)) return true;
  return item.ownerManagerChainIds.includes(actor.employeeId);
}

export function canEditActionItem(actor: Actor, item: ActionItemRef): boolean {
  if (!actor.employeeId) return actor.isHrAdmin;
  if (item.ownerEmployeeId === actor.employeeId) return true;
  if (item.assignedByEmployeeId === actor.employeeId) return true;
  if (item.ownerManagerChainIds.includes(actor.employeeId)) return true;
  return actor.isHrAdmin;
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------

export function canViewSurveyResults(actor: Actor): boolean {
  return actor.isHrAdmin || actor.isLeadership;
}

/** Participation (who has responded) is never available for anonymous surveys
 *  beyond a count; see the survey service for enforcement. */
export function canViewSurveyParticipation(actor: Actor): boolean {
  return actor.isHrAdmin;
}

// ---------------------------------------------------------------------------
// Development and improvement plans
// ---------------------------------------------------------------------------

export interface PlanRef {
  employeeId: string;
  planType: string;
  hrRestricted: boolean;
  /** The subject's current management chain. */
  employeeManagerChainIds: string[];
}

export function canViewPlan(actor: Actor, plan: PlanRef): boolean {
  if (actor.isHrAdmin) return true;
  if (!actor.employeeId) return false;
  if (plan.employeeId === actor.employeeId) return true;
  if (plan.hrRestricted || plan.planType === 'PERFORMANCE_IMPROVEMENT') {
    // Improvement plans are restricted to the employee, their direct manager
    // and HR. Leadership and the wider chain do not get them by default.
    return actor.directReportIds.includes(plan.employeeId);
  }
  return plan.employeeManagerChainIds.includes(actor.employeeId);
}

export function canEditPlan(actor: Actor, plan: PlanRef): boolean {
  if (actor.isHrAdmin) return true;
  if (!actor.employeeId) return false;
  if (actor.directReportIds.includes(plan.employeeId)) return true;
  // The employee can work their own development plan, but not a PIP's terms.
  if (plan.employeeId === actor.employeeId && plan.planType === 'DEVELOPMENT') return true;
  return false;
}

export function canCreateImprovementPlan(actor: Actor, aboutEmployeeId: string): boolean {
  return actor.isHrAdmin || actor.directReportIds.includes(aboutEmployeeId);
}

// ---------------------------------------------------------------------------
// Reporting scope
// ---------------------------------------------------------------------------

export type ReportScope =
  | { kind: 'ORGANIZATION' }
  | { kind: 'TEAM'; employeeIds: string[] }
  | { kind: 'SELF'; employeeIds: string[] }
  | { kind: 'NONE' };

/**
 * The set of employees whose data an actor may see in reports. Every report
 * query intersects with this, including CSV exports.
 */
export function reportScope(actor: Actor): ReportScope {
  if (actor.isHrAdmin || actor.isLeadership) return { kind: 'ORGANIZATION' };
  if (actor.employeeId && actor.descendantIds.length > 0) {
    return { kind: 'TEAM', employeeIds: [actor.employeeId, ...actor.descendantIds] };
  }
  if (actor.employeeId) return { kind: 'SELF', employeeIds: [actor.employeeId] };
  return { kind: 'NONE' };
}

export function canExportReports(actor: Actor): boolean {
  return reportScope(actor).kind !== 'NONE';
}
