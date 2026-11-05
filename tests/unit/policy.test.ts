import { describe, it, expect } from 'vitest';
import type { Actor } from '@/server/authz/actor';
import {
  canAdministerApp,
  canAdministerCompensation,
  canAllocateCompensation,
  canApproveCompensation,
  canManageSalaryBands,
  canViewCompensationParticipant,
  type CompParticipantRef,
  canAdministerProgram,
  canManageAccountsAndRoles,
  canManageCycles,
  canManageOrgSettings,
  canManageSurveys,
  canManageTemplates,
  canReadAuditLog,
  canRunCalibration,
  canViewEmployeePerformanceRecord,
  canViewHrRestricted,
  canEditAssignment,
  canReleaseParticipant,
  canSeeFeedbackAuthor,
  canSeePeerReviewerIdentity,
  canUseFeedbackVisibility,
  canViewAssignmentContent,
  canViewFeedback,
  canViewGoal,
  canViewMeetingNote,
  canViewParticipantScore,
  canViewPlan,
  participantAccess,
  reportScope,
  type CycleRef,
  type ParticipantRef,
} from '@/server/authz/policy';

/**
 * The authorization rules, exercised as pure functions.
 *
 * These run without a database, which means every branch of the matrix in
 * docs/PERMISSIONS.md can be asserted cheaply and the document can be checked
 * against the code rather than drifting from it.
 */

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'u1',
    sessionId: 's1',
    orgId: 'org1',
    email: 'person@example.com',
    roles: ['EMPLOYEE'],
    employeeId: 'me',
    displayName: 'Test Person',
    departmentId: 'dept-field',
    jobTitleId: 'title-1',
    isSysAdmin: false,
    isHrAdmin: false,
    isCompensationAdmin: false,
    isLeadership: false,
    isManager: false,
    directReportIds: [],
    descendantIds: [],
    managerChainIds: [],
    org: {
      id: 'org1',
      name: 'Test Co',
      productName: 'DB Elevate',
      brandPrimaryHex: '#1d4e89',
      brandAccentHex: '#e07a1f',
      logoUrl: null,
      wordmarkText: null,
      surveyMinResponses: 5,
      surveySuppressComplement: true,
      peerReviewMinForAggregate: 3,
      aiEnabled: false,
      aiProvider: 'none',
      timezone: 'UTC',
    },
    ...overrides,
  };
}

const employee = actor();
const manager = actor({
  employeeId: 'mgr',
  isManager: true,
  directReportIds: ['me', 'peer'],
  descendantIds: ['me', 'peer', 'grandchild'],
});
const hr = actor({ employeeId: 'hr', isHrAdmin: true, roles: ['HR_ADMIN', 'EMPLOYEE'] });
const sysadmin = actor({ employeeId: 'sys', isSysAdmin: true, roles: ['SYS_ADMIN', 'EMPLOYEE'] });
const leadership = actor({ employeeId: 'exec', isLeadership: true, roles: ['LEADERSHIP', 'EMPLOYEE'] });
const stranger = actor({ employeeId: 'other', departmentId: 'dept-office' });

const cycle: CycleRef = {
  id: 'c1',
  status: 'ACTIVE',
  requireApproval: true,
  shareSelfWithManager: true,
  sharePeerWithEmployee: false,
  peerVisibilityMode: 'CONFIDENTIAL',
  requireAcknowledgement: true,
};

const participant: ParticipantRef = {
  id: 'p1',
  employeeId: 'me',
  managerIdSnapshot: 'mgr',
  status: 'IN_PROGRESS',
};

describe('role capabilities', () => {
  it('treats SYS_ADMIN as application administration only', () => {
    expect(canAdministerApp(sysadmin)).toBe(true);
    // A system administrator is not an HR administrator by default.
    expect(participantAccess(sysadmin, participant, [])).toBe('NONE');
    expect(canReleaseParticipant(sysadmin, 'NONE')).toBe(false);
  });

  it('gives HR the program administration powers', () => {
    expect(participantAccess(hr, participant, [])).toBe('HR');
    expect(canReleaseParticipant(hr, 'HR')).toBe(true);
  });

  it('does not let a manager release results', () => {
    expect(canReleaseParticipant(manager, 'MANAGER_OF_RECORD')).toBe(false);
  });
});

describe('participantAccess', () => {
  it('identifies the subject', () => {
    expect(participantAccess(employee, participant, [])).toBe('SUBJECT');
  });

  it('identifies the manager recorded at launch', () => {
    expect(participantAccess(manager, participant, [])).toBe('MANAGER_OF_RECORD');
  });

  it('identifies someone higher in the chain as it stood at launch', () => {
    const skip = actor({ employeeId: 'skip' });
    expect(participantAccess(skip, participant, ['skip', 'top'])).toBe('UPPER_CHAIN_OF_RECORD');
  });

  it('refuses a manager who was not in the chain at the time', () => {
    // The decisive case: today's manager, who was not the manager of record.
    const newManager = actor({
      employeeId: 'new-mgr',
      isManager: true,
      directReportIds: ['me'],
      descendantIds: ['me'],
    });
    // The snapshot chain does not contain the new manager.
    expect(participantAccess(newManager, participant, ['old-skip'])).toBe('NONE');
  });

  it('refuses an unrelated employee', () => {
    expect(participantAccess(stranger, participant, [])).toBe('NONE');
  });
});

describe('review content visibility', () => {
  const selfDraft = { id: 'a1', participantId: 'p1', reviewerEmployeeId: 'me', kind: 'SELF', status: 'DRAFT' };
  const selfSubmitted = { ...selfDraft, status: 'SUBMITTED' };
  const managerSubmitted = {
    id: 'a2',
    participantId: 'p1',
    reviewerEmployeeId: 'mgr',
    kind: 'MANAGER',
    status: 'SUBMITTED',
  };
  const peerSubmitted = {
    id: 'a3',
    participantId: 'p1',
    reviewerEmployeeId: 'peer',
    kind: 'PEER',
    status: 'SUBMITTED',
  };

  it('keeps a draft private to its author', () => {
    expect(canViewAssignmentContent(employee, cycle, participant, selfDraft, 'SUBJECT')).toBe(true);
    expect(canViewAssignmentContent(manager, cycle, participant, selfDraft, 'MANAGER_OF_RECORD')).toBe(false);
    expect(canViewAssignmentContent(hr, cycle, participant, selfDraft, 'HR')).toBe(false);
  });

  it('shows a submitted self-assessment to the manager when the cycle allows it', () => {
    expect(canViewAssignmentContent(manager, cycle, participant, selfSubmitted, 'MANAGER_OF_RECORD')).toBe(true);
    const noShare = { ...cycle, shareSelfWithManager: false };
    expect(canViewAssignmentContent(manager, noShare, participant, selfSubmitted, 'MANAGER_OF_RECORD')).toBe(
      false,
    );
  });

  it('withholds the manager review from the employee until release', () => {
    expect(canViewAssignmentContent(employee, cycle, participant, managerSubmitted, 'SUBJECT')).toBe(false);
    const released = { ...participant, status: 'RELEASED' };
    expect(canViewAssignmentContent(employee, cycle, released, managerSubmitted, 'SUBJECT')).toBe(true);
  });

  it('withholds peer content from the employee unless the cycle shares it', () => {
    const released = { ...participant, status: 'RELEASED' };
    expect(canViewAssignmentContent(employee, cycle, released, peerSubmitted, 'SUBJECT')).toBe(false);
    const sharing = { ...cycle, sharePeerWithEmployee: true };
    expect(canViewAssignmentContent(employee, sharing, released, peerSubmitted, 'SUBJECT')).toBe(true);
  });

  it('never shows individual peer answers in anonymous-aggregate mode, even to HR', () => {
    const anon = { ...cycle, peerVisibilityMode: 'ANONYMOUS_AGGREGATE' };
    expect(canViewAssignmentContent(hr, anon, participant, peerSubmitted, 'HR')).toBe(false);
    expect(canViewAssignmentContent(manager, anon, participant, peerSubmitted, 'MANAGER_OF_RECORD')).toBe(
      false,
    );
  });

  it('shows a reviewer their own work regardless of everything else', () => {
    const peer = actor({ employeeId: 'peer' });
    expect(canViewAssignmentContent(peer, cycle, participant, peerSubmitted, 'NONE')).toBe(true);
  });
});

describe('peer reviewer identity', () => {
  it('names the reviewer in NAMED mode', () => {
    expect(canSeePeerReviewerIdentity({ ...cycle, peerVisibilityMode: 'NAMED' }, 'SUBJECT')).toBe(true);
  });

  it('reveals a confidential reviewer only to HR', () => {
    expect(canSeePeerReviewerIdentity(cycle, 'HR')).toBe(true);
    expect(canSeePeerReviewerIdentity(cycle, 'MANAGER_OF_RECORD')).toBe(false);
    expect(canSeePeerReviewerIdentity(cycle, 'SUBJECT')).toBe(false);
  });

  it('reveals nobody in anonymous-aggregate mode', () => {
    const anon = { ...cycle, peerVisibilityMode: 'ANONYMOUS_AGGREGATE' };
    expect(canSeePeerReviewerIdentity(anon, 'HR')).toBe(false);
  });
});

describe('scores', () => {
  it('withholds the score from the employee until release', () => {
    expect(canViewParticipantScore(participant, 'SUBJECT')).toBe(false);
    expect(canViewParticipantScore({ ...participant, status: 'RELEASED' }, 'SUBJECT')).toBe(true);
  });

  it('shows the score to the manager of record before release', () => {
    expect(canViewParticipantScore(participant, 'MANAGER_OF_RECORD')).toBe(true);
  });
});

describe('assignment editing', () => {
  it('lets the assigned reviewer edit while open', () => {
    const a = { id: 'a', participantId: 'p', reviewerEmployeeId: 'me', kind: 'SELF', status: 'DRAFT' };
    expect(canEditAssignment(employee, a)).toBe(true);
    expect(canEditAssignment(employee, { ...a, status: 'SUBMITTED' })).toBe(false);
    expect(canEditAssignment(employee, { ...a, status: 'REOPENED' })).toBe(true);
  });

  it('never lets anyone else edit', () => {
    const a = { id: 'a', participantId: 'p', reviewerEmployeeId: 'me', kind: 'SELF', status: 'DRAFT' };
    expect(canEditAssignment(hr, a)).toBe(false);
    expect(canEditAssignment(manager, a)).toBe(false);
  });
});

describe('goals', () => {
  const goal = {
    id: 'g1',
    scope: 'INDIVIDUAL',
    ownerEmployeeId: 'me',
    departmentId: 'dept-field',
    visibility: 'MANAGER_CHAIN',
    collaboratorIds: [] as string[],
    ownerManagerChainIds: ['mgr', 'director'],
  };

  it('always shows an owner their own goal', () => {
    expect(canViewGoal(employee, { ...goal, visibility: 'PRIVATE' })).toBe(true);
  });

  it('hides a private goal from the manager chain', () => {
    expect(canViewGoal(manager, { ...goal, visibility: 'PRIVATE' })).toBe(false);
  });

  it('shows a manager-chain goal to the chain', () => {
    expect(canViewGoal(manager, goal)).toBe(true);
  });

  it('hides a manager-chain goal from an unrelated colleague', () => {
    expect(canViewGoal(stranger, goal)).toBe(false);
  });

  it('shows a department goal to the department', () => {
    const sameDept = actor({ employeeId: 'colleague', departmentId: 'dept-field' });
    expect(canViewGoal(sameDept, { ...goal, visibility: 'DEPARTMENT' })).toBe(true);
    expect(canViewGoal(stranger, { ...goal, visibility: 'DEPARTMENT' })).toBe(false);
  });

  it('shows an organization goal to everyone', () => {
    expect(canViewGoal(stranger, { ...goal, visibility: 'ORGANIZATION' })).toBe(true);
  });

  it('shows a company goal company-wide unless marked private', () => {
    expect(canViewGoal(stranger, { ...goal, scope: 'COMPANY', ownerEmployeeId: 'exec' })).toBe(true);
    expect(
      canViewGoal(stranger, { ...goal, scope: 'COMPANY', ownerEmployeeId: 'exec', visibility: 'PRIVATE' }),
    ).toBe(false);
  });

  it('lets a collaborator see a private goal', () => {
    expect(
      canViewGoal(stranger, { ...goal, visibility: 'PRIVATE', collaboratorIds: ['other'] }),
    ).toBe(true);
  });

  it('gives HR access for administration', () => {
    expect(canViewGoal(hr, { ...goal, visibility: 'PRIVATE' })).toBe(true);
  });
});

describe('feedback', () => {
  const item = {
    id: 'f1',
    authorEmployeeId: 'mgr',
    aboutEmployeeId: 'me',
    visibility: 'RECIPIENT_AND_MANAGER',
    authorVisibility: 'NAMED',
    aboutManagerChainIds: ['mgr', 'director'],
    aboutDepartmentId: 'dept-field',
  };

  it('keeps a private note to its author alone', () => {
    const note = { ...item, visibility: 'PRIVATE_NOTE_SELF' };
    expect(canViewFeedback(manager, note)).toBe(true); // the author
    expect(canViewFeedback(employee, note)).toBe(false); // the subject
    expect(canViewFeedback(hr, note)).toBe(false); // HR too
    expect(canViewFeedback(sysadmin, note)).toBe(false);
  });

  it('shows manager-only feedback to the chain but not the employee', () => {
    const managerOnly = { ...item, visibility: 'MANAGER_ONLY', authorEmployeeId: 'peer' };
    expect(canViewFeedback(manager, managerOnly)).toBe(true);
    expect(canViewFeedback(employee, managerOnly)).toBe(false);
  });

  it('restricts HR-only feedback to HR and its author', () => {
    const hrOnly = { ...item, visibility: 'HR_ONLY', authorEmployeeId: 'peer' };
    expect(canViewFeedback(hr, hrOnly)).toBe(true);
    expect(canViewFeedback(manager, hrOnly)).toBe(false);
    expect(canViewFeedback(employee, hrOnly)).toBe(false);
  });

  describe('author visibility', () => {
    it('NAMED shows the author to anyone who can see the item', () => {
      expect(canSeeFeedbackAuthor(employee, item)).toBe(true);
    });

    it('CONFIDENTIAL records the author but reveals them only to HR', () => {
      const confidential = { ...item, authorVisibility: 'CONFIDENTIAL' };
      expect(canSeeFeedbackAuthor(employee, confidential)).toBe(false);
      expect(canSeeFeedbackAuthor(manager, confidential)).toBe(true); // the author themselves
      expect(canSeeFeedbackAuthor(hr, confidential)).toBe(true);
    });

    it('ANONYMOUS reveals nobody because nothing was stored', () => {
      const anonymous = { ...item, authorVisibility: 'ANONYMOUS', authorEmployeeId: null };
      expect(canSeeFeedbackAuthor(hr, anonymous)).toBe(false);
      expect(canSeeFeedbackAuthor(sysadmin, anonymous)).toBe(false);
    });
  });

  it('restricts the manager-only audience to the chain and HR', () => {
    expect(canUseFeedbackVisibility(stranger, 'MANAGER_ONLY', 'me')).toBe(false);
    expect(canUseFeedbackVisibility(manager, 'MANAGER_ONLY', 'me')).toBe(true);
    expect(canUseFeedbackVisibility(hr, 'MANAGER_ONLY', 'me')).toBe(true);
    // Anyone may escalate to HR.
    expect(canUseFeedbackVisibility(stranger, 'HR_ONLY', 'me')).toBe(true);
  });
});

describe('meeting notes', () => {
  const shared = {
    authorEmployeeId: 'mgr',
    visibility: 'SHARED',
    meetingParticipantIds: ['mgr', 'me'],
  };
  const privateNote = { ...shared, visibility: 'PRIVATE' };

  it('shows shared notes to both participants', () => {
    expect(canViewMeetingNote(employee, shared)).toBe(true);
    expect(canViewMeetingNote(manager, shared)).toBe(true);
  });

  it('keeps a private note to its author, with no role override', () => {
    expect(canViewMeetingNote(manager, privateNote)).toBe(true);
    expect(canViewMeetingNote(employee, privateNote)).toBe(false);
    expect(canViewMeetingNote(hr, privateNote)).toBe(false);
    expect(canViewMeetingNote(sysadmin, privateNote)).toBe(false);
  });

  it('hides even shared notes from someone who was not in the meeting', () => {
    expect(canViewMeetingNote(stranger, shared)).toBe(false);
  });
});

describe('development and improvement plans', () => {
  const development = {
    employeeId: 'me',
    planType: 'DEVELOPMENT',
    hrRestricted: false,
    employeeManagerChainIds: ['mgr', 'director'],
  };
  const pip = { ...development, planType: 'PERFORMANCE_IMPROVEMENT', hrRestricted: true };

  it('shows a development plan to the employee and their chain', () => {
    expect(canViewPlan(employee, development)).toBe(true);
    expect(canViewPlan(manager, development)).toBe(true);
    const director = actor({ employeeId: 'director' });
    expect(canViewPlan(director, development)).toBe(true);
  });

  it('restricts an improvement plan to the employee, their direct manager and HR', () => {
    expect(canViewPlan(employee, pip)).toBe(true);
    expect(canViewPlan(manager, pip)).toBe(true); // direct manager
    expect(canViewPlan(hr, pip)).toBe(true);
    const director = actor({ employeeId: 'director' });
    expect(canViewPlan(director, pip)).toBe(false); // further up the chain: no
    expect(canViewPlan(leadership, pip)).toBe(false);
    expect(canViewPlan(stranger, pip)).toBe(false);
  });
});

describe('report scope', () => {
  it('gives HR and leadership the whole organization', () => {
    expect(reportScope(hr).kind).toBe('ORGANIZATION');
    expect(reportScope(leadership).kind).toBe('ORGANIZATION');
  });

  it('gives a manager their reporting line including themselves', () => {
    const scope = reportScope(manager);
    expect(scope.kind).toBe('TEAM');
    if (scope.kind === 'TEAM') {
      expect(scope.employeeIds).toContain('mgr');
      expect(scope.employeeIds).toContain('grandchild');
    }
  });

  it('gives an individual contributor only themselves', () => {
    const scope = reportScope(employee);
    expect(scope.kind).toBe('SELF');
    if (scope.kind === 'SELF') expect(scope.employeeIds).toEqual(['me']);
  });
});

/**
 * The administrative role split.
 *
 * This matters more than it looks. The pages redirect the wrong role away, but
 * a page redirect is cosmetic — the service predicate is what stops a direct
 * API call. An earlier version of `canManageOrgSettings` also returned true for
 * HR_ADMIN, which let an HR administrator rewrite branding, lower a privacy
 * threshold, change the mail provider and switch on a metered AI service by
 * POSTing straight to the route while every screen correctly refused them.
 * These assertions exist so that cannot come back.
 */
describe('administrative role separation', () => {
  it('confines organization settings to a system administrator', () => {
    expect(canManageOrgSettings(sysadmin)).toBe(true);
    expect(canManageOrgSettings(hr)).toBe(false);
    expect(canManageOrgSettings(manager)).toBe(false);
    expect(canManageOrgSettings(employee)).toBe(false);
  });

  it('confines accounts and roles to a system administrator', () => {
    expect(canManageAccountsAndRoles(sysadmin)).toBe(true);
    expect(canManageAccountsAndRoles(hr)).toBe(false);
    expect(canManageAccountsAndRoles(employee)).toBe(false);
  });

  it('confines the performance catalogue to an HR administrator', () => {
    expect(canAdministerProgram(hr)).toBe(true);
    expect(canAdministerProgram(sysadmin)).toBe(false);
    expect(canManageTemplates(sysadmin)).toBe(false);
    expect(canManageCycles(sysadmin)).toBe(false);
    expect(canManageSurveys(sysadmin)).toBe(false);
    expect(canRunCalibration(sysadmin)).toBe(false);
  });

  it('lets either administrator read the audit log, and nobody else', () => {
    // Intentionally shared: the log holds no review text, no private note and
    // no respondent identity, and HR needs to answer "who released this".
    expect(canReadAuditLog(sysadmin)).toBe(true);
    expect(canReadAuditLog(hr)).toBe(true);
    expect(canReadAuditLog(manager)).toBe(false);
    expect(canReadAuditLog(employee)).toBe(false);
  });

  it('does not let a system administrator reach review content through any predicate', () => {
    // The whole reason the roles are split: running the application must not
    // come with the right to read what people wrote about each other.
    expect(canViewHrRestricted(sysadmin)).toBe(false);
    expect(canViewEmployeePerformanceRecord(sysadmin, 'someone-else')).toBe(false);
    expect(reportScope(sysadmin).kind).toBe('SELF');
  });

  it('grants both sets only when both roles are held explicitly', () => {
    const both = actor({
      employeeId: 'both',
      isSysAdmin: true,
      isHrAdmin: true,
      roles: ['SYS_ADMIN', 'HR_ADMIN', 'EMPLOYEE'],
    });
    expect(canManageOrgSettings(both)).toBe(true);
    expect(canAdministerProgram(both)).toBe(true);
    expect(canViewHrRestricted(both)).toBe(true);
  });
});

/**
 * Compensation access.
 *
 * This module was deferred once precisely because salary needs an access model
 * that does not inherit from the reporting line. These assertions are that
 * model: COMPENSATION_ADMIN is never implied, a manager's window is as narrow
 * as the task requires, and nobody sets their own pay.
 */
describe('compensation access', () => {
  const comp = actor({
    employeeId: 'comp',
    isCompensationAdmin: true,
    roles: ['COMPENSATION_ADMIN', 'EMPLOYEE'],
  });
  const ref = (over: Partial<CompParticipantRef> = {}): CompParticipantRef => ({
    employeeId: 'me',
    managerIdSnapshot: 'mgr',
    cycleStatus: 'PLANNING',
    status: 'PENDING',
    ...over,
  });

  it('is never implied by another role', () => {
    // The whole point of the separate role. HR runs the performance programme
    // and that must not come with everybody's salary.
    expect(canAdministerCompensation(hr)).toBe(false);
    expect(canAdministerCompensation(sysadmin)).toBe(false);
    expect(canAdministerCompensation(manager)).toBe(false);
    expect(canAdministerCompensation(employee)).toBe(false);
    expect(canAdministerCompensation(comp)).toBe(true);
  });

  it('does not let HR or a system administrator read a pay line', () => {
    expect(canViewCompensationParticipant(hr, ref())).toBe(false);
    expect(canViewCompensationParticipant(sysadmin, ref())).toBe(false);
  });

  it('lets the manager of record see their report only while the cycle is live', () => {
    expect(canViewCompensationParticipant(manager, ref({ managerIdSnapshot: 'mgr', cycleStatus: 'PLANNING' }))).toBe(true);
    expect(canViewCompensationParticipant(manager, ref({ managerIdSnapshot: 'mgr', cycleStatus: 'DRAFT' }))).toBe(false);
    expect(canViewCompensationParticipant(manager, ref({ managerIdSnapshot: 'mgr', cycleStatus: 'CANCELLED' }))).toBe(false);
  });

  it('scopes a manager to the line as it stood at launch', () => {
    // A reorganization mid-cycle must not move who is deciding someone's pay.
    expect(canViewCompensationParticipant(manager, ref({ managerIdSnapshot: 'someone-else' }))).toBe(false);
  });

  it('shows an employee their own line only once it is applied', () => {
    const self = actor({ employeeId: 'me' });
    expect(canViewCompensationParticipant(self, ref({ status: 'PENDING' }))).toBe(false);
    expect(canViewCompensationParticipant(self, ref({ status: 'SUBMITTED' }))).toBe(false);
    expect(canViewCompensationParticipant(self, ref({ status: 'APPROVED' }))).toBe(false);
    expect(canViewCompensationParticipant(self, ref({ status: 'APPLIED' }))).toBe(true);
  });

  it('never lets anyone allocate their own pay', () => {
    const selfManaging = actor({
      employeeId: 'me',
      isCompensationAdmin: true,
      roles: ['COMPENSATION_ADMIN', 'EMPLOYEE'],
    });
    expect(canAllocateCompensation(selfManaging, ref({ employeeId: 'me' }))).toBe(false);
  });

  it('only allows allocation while the cycle is in planning', () => {
    for (const cycleStatus of ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'APPLIED', 'CANCELLED']) {
      expect(canAllocateCompensation(manager, ref({ cycleStatus }))).toBe(false);
    }
    expect(canAllocateCompensation(manager, ref({ cycleStatus: 'PLANNING' }))).toBe(true);
  });

  it('confines approval and salary bands to the compensation role', () => {
    expect(canApproveCompensation(comp)).toBe(true);
    expect(canApproveCompensation(hr)).toBe(false);
    expect(canApproveCompensation(manager)).toBe(false);
    expect(canManageSalaryBands(comp)).toBe(true);
    expect(canManageSalaryBands(hr)).toBe(false);
  });

  it('does not give a compensation administrator review content', () => {
    // The separation runs both ways: salary access is not performance access.
    expect(canViewHrRestricted(comp)).toBe(false);
    expect(canAdministerProgram(comp)).toBe(false);
    expect(canViewEmployeePerformanceRecord(comp, 'someone-else')).toBe(false);
  });
});
