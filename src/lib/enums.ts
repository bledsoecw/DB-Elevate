/**
 * Single source of truth for every enumerated value in the system.
 *
 * SQLite (the default development datasource) does not support Prisma `enum`,
 * so these are stored as strings and validated by Zod at every write boundary.
 * Keeping them here means the database, the API contracts, and the UI labels
 * can never drift apart.
 */

export const ROLES = ['SYS_ADMIN', 'HR_ADMIN', 'LEADERSHIP', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SYS_ADMIN: 'System administrator',
  HR_ADMIN: 'HR / program administrator',
  LEADERSHIP: 'Leadership (reporting access)',
  EMPLOYEE: 'Employee',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SYS_ADMIN:
    'Application administration: accounts, roles, branding, integrations, audit log. Does not grant blanket access to review content.',
  HR_ADMIN:
    'Performance-program administration: people records, templates, cycles, surveys, calibration, HR-restricted records.',
  LEADERSHIP:
    'Aggregate reporting across the organization. No access to individual draft reviews or private notes.',
  EMPLOYEE: 'Own records, plus anything explicitly shared. Granted to every account.',
};

export const USER_STATUSES = ['active', 'invited', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'seasonal', 'subcontractor'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  seasonal: 'Seasonal',
  subcontractor: 'Subcontractor',
};

export const EMPLOYMENT_STATUSES = ['active', 'on_leave', 'terminated'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: 'Active',
  on_leave: 'On leave',
  terminated: 'Deactivated',
};

// --- Templates -------------------------------------------------------------

export const TEMPLATE_CATEGORIES = [
  'annual',
  'quarterly',
  'new_hire',
  'project',
  'development',
  'pip',
  'custom',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  annual: 'Annual review',
  quarterly: 'Quarterly check-in',
  new_hire: 'New-hire review',
  project: 'Project-based feedback',
  development: 'Development review',
  pip: 'Improvement plan review',
  custom: 'Custom',
};

export const TEMPLATE_STATUSES = ['draft', 'published', 'archived'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const QUESTION_TYPES = [
  'TEXT',
  'RATING',
  'MULTIPLE_CHOICE',
  'MULTI_SELECT',
  'COMPETENCY_RATING',
  'GOAL_REVIEW',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  TEXT: 'Written response',
  RATING: 'Rating scale',
  MULTIPLE_CHOICE: 'Multiple choice (one answer)',
  MULTI_SELECT: 'Multiple choice (several answers)',
  COMPETENCY_RATING: 'Competency assessment',
  GOAL_REVIEW: 'Goal review',
};

/** Question types that contribute a numeric score. See docs/SCORING.md. */
export const SCOREABLE_QUESTION_TYPES: QuestionType[] = ['RATING', 'COMPETENCY_RATING'];

export const REVIEWER_KINDS = ['SELF', 'MANAGER', 'PEER', 'SKIP_LEVEL', 'UPWARD'] as const;
export type ReviewerKind = (typeof REVIEWER_KINDS)[number];
export const REVIEWER_KIND_LABELS: Record<ReviewerKind, string> = {
  SELF: 'Self-assessment',
  MANAGER: 'Manager review',
  PEER: 'Peer review',
  SKIP_LEVEL: 'Skip-level review',
  UPWARD: 'Upward review',
};

export const GOAL_SCOPE_FOR_QUESTION = ['OWNED', 'OWNED_AND_TEAM', 'CYCLE_PERIOD'] as const;

// --- Cycles ----------------------------------------------------------------

export const CYCLE_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'CANCELLED'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];
export const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Collecting responses',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const PARTICIPANT_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'AWAITING_APPROVAL',
  'APPROVED',
  'RELEASED',
  'ACKNOWLEDGED',
  'CLOSED',
] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];
export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'Collecting responses',
  AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved, not released',
  RELEASED: 'Released to employee',
  ACKNOWLEDGED: 'Acknowledged',
  CLOSED: 'Closed',
};

export const ASSIGNMENT_STATUSES = [
  'NOT_STARTED',
  'DRAFT',
  'SUBMITTED',
  'REOPENED',
  'DECLINED',
  'CANCELLED',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  NOT_STARTED: 'Not started',
  DRAFT: 'In progress',
  SUBMITTED: 'Submitted',
  REOPENED: 'Reopened for edits',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
};

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'CHANGES_REQUESTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_AUTHORITIES = ['MANAGER_OF_MANAGER', 'HR_ADMIN'] as const;
export type ApprovalAuthority = (typeof APPROVAL_AUTHORITIES)[number];
export const APPROVAL_AUTHORITY_LABELS: Record<ApprovalAuthority, string> = {
  MANAGER_OF_MANAGER: "The manager's manager",
  HR_ADMIN: 'An HR / program administrator',
};

export const PEER_VISIBILITY_MODES = ['NAMED', 'CONFIDENTIAL', 'ANONYMOUS_AGGREGATE'] as const;
export type PeerVisibilityMode = (typeof PEER_VISIBILITY_MODES)[number];
export const PEER_VISIBILITY_LABELS: Record<PeerVisibilityMode, string> = {
  NAMED: 'Named — the employee and manager see who wrote each peer review',
  CONFIDENTIAL:
    'Confidential — the reviewer is recorded and visible to HR, hidden from the employee',
  ANONYMOUS_AGGREGATE:
    'Anonymous aggregate — peer content is only shown combined, and only above the minimum response count',
};

export const RELEASE_MODES = ['MANUAL', 'AUTO_ON_APPROVAL'] as const;
export type ReleaseMode = (typeof RELEASE_MODES)[number];

// --- Goals -----------------------------------------------------------------

export const GOAL_SCOPES = ['INDIVIDUAL', 'TEAM', 'COMPANY'] as const;
export type GoalScope = (typeof GOAL_SCOPES)[number];
export const GOAL_SCOPE_LABELS: Record<GoalScope, string> = {
  INDIVIDUAL: 'Individual',
  TEAM: 'Team / department',
  COMPANY: 'Company',
};

export const GOAL_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const GOAL_HEALTHS = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'BLOCKED'] as const;
export type GoalHealth = (typeof GOAL_HEALTHS)[number];
export const GOAL_HEALTH_LABELS: Record<GoalHealth, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OFF_TRACK: 'Off track',
  BLOCKED: 'Blocked',
};

export const GOAL_VISIBILITIES = ['PRIVATE', 'MANAGER_CHAIN', 'DEPARTMENT', 'ORGANIZATION'] as const;
export type GoalVisibility = (typeof GOAL_VISIBILITIES)[number];
export const GOAL_VISIBILITY_LABELS: Record<GoalVisibility, string> = {
  PRIVATE: 'Private — owner, collaborators and HR only',
  MANAGER_CHAIN: 'Owner and management chain',
  DEPARTMENT: 'Everyone in the department',
  ORGANIZATION: 'Everyone in the company',
};

export const MEASUREMENT_TYPES = ['PERCENT', 'NUMERIC', 'MILESTONE', 'BINARY'] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];
export const MEASUREMENT_TYPE_LABELS: Record<MeasurementType, string> = {
  PERCENT: 'Percent complete (reported by owner)',
  NUMERIC: 'Numeric target (computed from current value)',
  MILESTONE: 'Milestone checklist (computed from completed milestones)',
  BINARY: 'Done / not done',
};

// --- Feedback --------------------------------------------------------------

export const FEEDBACK_KINDS = [
  'RECOGNITION',
  'CONSTRUCTIVE',
  'GENERAL',
  'REQUEST_RESPONSE',
  'PRIVATE_NOTE',
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  RECOGNITION: 'Recognition',
  CONSTRUCTIVE: 'Constructive feedback',
  GENERAL: 'General feedback',
  REQUEST_RESPONSE: 'Response to a request',
  PRIVATE_NOTE: 'Private note',
};

export const FEEDBACK_VISIBILITIES = [
  'PRIVATE_NOTE_SELF',
  'RECIPIENT_ONLY',
  'RECIPIENT_AND_MANAGER',
  'MANAGER_ONLY',
  'HR_ONLY',
  'DEPARTMENT',
  'ORGANIZATION',
] as const;
export type FeedbackVisibility = (typeof FEEDBACK_VISIBILITIES)[number];
export const FEEDBACK_VISIBILITY_LABELS: Record<FeedbackVisibility, string> = {
  PRIVATE_NOTE_SELF: 'Private note — only you can see this',
  RECIPIENT_ONLY: 'The person it is about',
  RECIPIENT_AND_MANAGER: 'The person it is about and their manager chain',
  MANAGER_ONLY: 'Their manager chain only (not the employee)',
  HR_ONLY: 'HR administrators only',
  DEPARTMENT: 'Everyone in their department',
  ORGANIZATION: 'Everyone in the company',
};

export const AUTHOR_VISIBILITIES = ['NAMED', 'CONFIDENTIAL', 'ANONYMOUS'] as const;
export type AuthorVisibility = (typeof AUTHOR_VISIBILITIES)[number];
export const AUTHOR_VISIBILITY_LABELS: Record<AuthorVisibility, string> = {
  NAMED: 'Named — your name is shown to everyone who can see this',
  CONFIDENTIAL:
    'Confidential — your name is recorded and visible to HR administrators, but hidden from the recipient and their manager',
  ANONYMOUS:
    'Anonymous — your name is not stored on this record at all and cannot be recovered by anyone, including HR',
};

// --- Meetings --------------------------------------------------------------

export const MEETING_CADENCES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'NONE'] as const;
export type MeetingCadence = (typeof MEETING_CADENCES)[number];
export const MEETING_CADENCE_LABELS: Record<MeetingCadence, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every two weeks',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  NONE: 'One-off',
};

export const MEETING_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const AGENDA_STATUSES = ['OPEN', 'DISCUSSED', 'CARRIED_FORWARD'] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

export const NOTE_VISIBILITIES = ['SHARED', 'PRIVATE'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const ACTION_VISIBILITIES = ['PARTICIPANTS', 'OWNER_AND_MANAGER', 'HR_RESTRICTED'] as const;
export type ActionVisibility = (typeof ACTION_VISIBILITIES)[number];

// --- Surveys ---------------------------------------------------------------

export const SURVEY_MODES = ['NAMED', 'ANONYMOUS'] as const;
export type SurveyMode = (typeof SURVEY_MODES)[number];
export const SURVEY_MODE_LABELS: Record<SurveyMode, string> = {
  NAMED: 'Named — answers are stored with the respondent and visible to authorized administrators',
  ANONYMOUS:
    'Anonymous — answers are stored with no respondent identity; only participation is tracked',
};

export const SURVEY_STATUSES = ['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'ARCHIVED'] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];
export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  OPEN: 'Open',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
};

export const SURVEY_QUESTION_TYPES = [
  'RATING',
  'MULTIPLE_CHOICE',
  'MULTI_SELECT',
  'TEXT',
  'NPS',
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];
export const SURVEY_QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  RATING: 'Rating scale',
  MULTIPLE_CHOICE: 'Multiple choice (one answer)',
  MULTI_SELECT: 'Multiple choice (several answers)',
  TEXT: 'Written response',
  NPS: 'eNPS (0-10 recommendation score)',
};

export const AUDIENCE_RULE_TYPES = [
  'ALL',
  'DEPARTMENT',
  'JOB_TITLE',
  'MANAGER_TREE',
  'EMPLOYEE',
  'LOCATION',
] as const;
export type AudienceRuleType = (typeof AUDIENCE_RULE_TYPES)[number];

export const INVITATION_STATUSES = ['PENDING', 'NOTIFIED', 'COMPLETED', 'DECLINED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Engagement factors used by the starter engagement survey. Configurable per question. */
export const ENGAGEMENT_FACTORS = [
  'Safety',
  'Leadership',
  'Recognition',
  'Growth',
  'Tools & Resources',
  'Communication',
  'Workload & Schedule',
] as const;

// --- Competencies ----------------------------------------------------------

/**
 * Career levels a competency can carry a behavioural descriptor for. These are
 * the rungs a construction and remodeling company actually uses; they are
 * ordered, and the order is what the library editor renders.
 */
export const COMPETENCY_LEVELS = [
  'Apprentice',
  'Journeyman',
  'Lead',
  'Manager',
  'Director',
  'Executive',
] as const;
export type CompetencyLevel = (typeof COMPETENCY_LEVELS)[number];

export const COMPETENCY_CATEGORIES = [
  'Safety',
  'Craftsmanship',
  'Client Service',
  'Leadership',
  'Planning & Execution',
  'Commercial',
  'Teamwork',
] as const;

// --- Development -----------------------------------------------------------

export const PLAN_TYPES = ['DEVELOPMENT', 'PERFORMANCE_IMPROVEMENT'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];
export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  DEVELOPMENT: 'Development plan',
  PERFORMANCE_IMPROVEMENT: 'Performance improvement plan',
};

export const PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const CALIBRATION_STATUSES = ['DRAFT', 'IN_PROGRESS', 'FINALIZED'] as const;
export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number];

// --- Infrastructure --------------------------------------------------------

export const JOB_KINDS = [
  'cycle.launch',
  'review.reminder',
  'survey.open',
  'survey.close',
  'survey.reminder',
  'meeting.rollforward',
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const AI_SUGGESTION_KINDS = [
  'review_question',
  'feedback_clarity',
  'review_summary',
  'goal_wording',
  'meeting_summary',
] as const;
export type AiSuggestionKind = (typeof AI_SUGGESTION_KINDS)[number];
export const AI_SUGGESTION_KIND_LABELS: Record<AiSuggestionKind, string> = {
  review_question: 'Draft review questions',
  feedback_clarity: 'Improve feedback clarity',
  review_summary: 'Summarize review content',
  goal_wording: 'Suggest goal wording',
  meeting_summary: 'Summarize meeting notes',
};

export const TENURE_BANDS = ['< 6 months', '6-12 months', '1-3 years', '3-5 years', '5+ years'] as const;
export type TenureBand = (typeof TENURE_BANDS)[number];
