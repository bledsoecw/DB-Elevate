-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productName" TEXT NOT NULL DEFAULT 'DB Elevate',
    "logoUrl" TEXT,
    "wordmarkText" TEXT,
    "brandPrimaryHex" TEXT NOT NULL DEFAULT '#1d4e89',
    "brandAccentHex" TEXT NOT NULL DEFAULT '#e07a1f',
    "timezone" TEXT NOT NULL DEFAULT 'America/Denver',
    "fiscalYearStart" INTEGER NOT NULL DEFAULT 1,
    "weekStartsOn" INTEGER NOT NULL DEFAULT 0,
    "surveyMinResponses" INTEGER NOT NULL DEFAULT 5,
    "surveySuppressComplement" BOOLEAN NOT NULL DEFAULT true,
    "allowSelfReviewSharing" BOOLEAN NOT NULL DEFAULT true,
    "peerReviewMinForAggregate" INTEGER NOT NULL DEFAULT 3,
    "requireReviewAcknowledgement" BOOLEAN NOT NULL DEFAULT true,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT NOT NULL DEFAULT 'none',
    "aiModel" TEXT,
    "aiMonthlyCallBudget" INTEGER NOT NULL DEFAULT 0,
    "emailProvider" TEXT NOT NULL DEFAULT 'outbox',
    "emailFromName" TEXT NOT NULL DEFAULT 'DB Elevate',
    "emailFromAddr" TEXT NOT NULL DEFAULT 'no-reply@example.invalid',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "externalIdpSubject" TEXT,
    "isDemoAccount" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,
    CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "departments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "competencyLibraryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "job_titles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "job_titles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "job_titles_competencyLibraryId_fkey" FOREIGN KEY ("competencyLibraryId") REFERENCES "competency_libraries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "employeeNumber" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "workEmail" TEXT NOT NULL,
    "workPhone" TEXT,
    "departmentId" TEXT,
    "jobTitleId" TEXT,
    "managerId" TEXT,
    "hireDate" DATETIME,
    "terminationDate" DATETIME,
    "employmentType" TEXT NOT NULL DEFAULT 'full_time',
    "employmentStatus" TEXT NOT NULL DEFAULT 'active',
    "workLocation" TEXT,
    "crew" TEXT,
    "reviewEligible" BOOLEAN NOT NULL DEFAULT true,
    "reviewCohort" TEXT,
    "avatarColor" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "employees_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "employees_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "job_titles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "employees_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "manager_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manager_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "manager_assignments_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rating_scales" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "numeric" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "rating_scales_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rating_scale_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scaleId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "rating_scale_levels_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "rating_scales" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "competencies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "competencies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "competency_behaviors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competencyId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "descriptor" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "competency_behaviors_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "competency_libraries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "competency_libraries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "competency_library_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "competency_library_items_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "competency_libraries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "competency_library_items_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'custom',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isStarter" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "review_templates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_template_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "changeNote" TEXT,
    "publishedAt" DATETIME,
    "publishedById" TEXT,
    "archivedAt" DATETIME,
    "selfWeight" REAL NOT NULL DEFAULT 0,
    "managerWeight" REAL NOT NULL DEFAULT 1,
    "peerWeight" REAL NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "review_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "review_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "template_sections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "weight" REAL NOT NULL DEFAULT 1,
    "appliesTo" TEXT NOT NULL DEFAULT 'SELF,MANAGER,PEER',
    CONSTRAINT "template_sections_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "review_template_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "template_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sectionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "weight" REAL NOT NULL DEFAULT 1,
    "allowNotApplicable" BOOLEAN NOT NULL DEFAULT false,
    "commentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "commentRequired" BOOLEAN NOT NULL DEFAULT false,
    "maxLength" INTEGER,
    "ratingScaleId" TEXT,
    "competencyId" TEXT,
    "goalScope" TEXT,
    "choicesJson" TEXT,
    "appliesTo" TEXT,
    CONSTRAINT "template_questions_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "template_sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "template_questions_ratingScaleId_fkey" FOREIGN KEY ("ratingScaleId") REFERENCES "rating_scales" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "template_questions_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "templateVersionId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "selfReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "managerReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "peerReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "peerReviewTarget" INTEGER NOT NULL DEFAULT 3,
    "peerVisibilityMode" TEXT NOT NULL DEFAULT 'CONFIDENTIAL',
    "requireApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvalAuthority" TEXT NOT NULL DEFAULT 'MANAGER_OF_MANAGER',
    "releaseMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "shareSelfWithManager" BOOLEAN NOT NULL DEFAULT true,
    "sharePeerWithEmployee" BOOLEAN NOT NULL DEFAULT false,
    "requireAcknowledgement" BOOLEAN NOT NULL DEFAULT true,
    "selfDueAt" DATETIME,
    "managerDueAt" DATETIME,
    "peerDueAt" DATETIME,
    "scheduledLaunchAt" DATETIME,
    "launchedAt" DATETIME,
    "closedAt" DATETIME,
    "createdById" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "review_cycles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_cycles_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "review_template_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cycle_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerIdSnapshot" TEXT,
    "departmentNameSnapshot" TEXT,
    "jobTitleNameSnapshot" TEXT,
    "managerNameSnapshot" TEXT,
    "snapshotTakenAt" DATETIME,
    "templateVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "releasedAt" DATETIME,
    "releasedById" TEXT,
    "acknowledgedAt" DATETIME,
    "acknowledgementNote" TEXT,
    "finalScore" REAL,
    "finalScoreJson" TEXT,
    "calibratedScore" REAL,
    "calibrationNote" TEXT,
    "calibratedById" TEXT,
    "calibratedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cycle_participants_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cycle_participants_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cycle_participants_managerIdSnapshot_fkey" FOREIGN KEY ("managerIdSnapshot") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "cycle_participants_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "review_template_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cycle_participants_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "reviewerEmployeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "dueAt" DATETIME,
    "lastSavedAt" DATETIME,
    "submittedAt" DATETIME,
    "reopenedAt" DATETIME,
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "score" REAL,
    "scoreJson" TEXT,
    "declineReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "review_assignments_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "cycle_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_assignments_reviewerEmployeeId_fkey" FOREIGN KEY ("reviewerEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_assignments_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "review_template_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "review_assignments_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_responses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL DEFAULT '',
    "textValue" TEXT,
    "numericValue" REAL,
    "choiceJson" TEXT,
    "commentValue" TEXT,
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_responses_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "review_assignments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_responses_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "template_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_approvals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "approverEmployeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "review_approvals_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "cycle_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_approvals_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_goal_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "goalId" TEXT,
    "titleSnapshot" TEXT NOT NULL,
    "statusSnapshot" TEXT NOT NULL,
    "healthSnapshot" TEXT,
    "progressSnapshot" REAL,
    "targetSnapshot" TEXT,
    "dueDateSnapshot" DATETIME,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_goal_snapshots_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "cycle_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "outcome" TEXT,
    "category" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "ownerEmployeeId" TEXT,
    "departmentId" TEXT,
    "parentGoalId" TEXT,
    "startDate" DATETIME,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "health" TEXT NOT NULL DEFAULT 'ON_TRACK',
    "visibility" TEXT NOT NULL DEFAULT 'MANAGER_CHAIN',
    "measurementType" TEXT NOT NULL DEFAULT 'PERCENT',
    "startValue" REAL,
    "targetValue" REAL,
    "currentValue" REAL,
    "unit" TEXT,
    "higherIsBetter" BOOLEAN NOT NULL DEFAULT true,
    "reportedProgressPct" REAL,
    "weight" REAL NOT NULL DEFAULT 1,
    "completedAt" DATETIME,
    "closedNote" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "goals_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goals_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "goals_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "goals_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "goals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "goal_collaborators" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COLLABORATOR',
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_collaborators_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goal_collaborators_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "goal_milestones" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATETIME,
    "completedAt" DATETIME,
    "weight" REAL NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "goal_milestones_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "goal_updates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalId" TEXT NOT NULL,
    "authorEmployeeId" TEXT NOT NULL,
    "body" TEXT,
    "valueAtUpdate" REAL,
    "reportedProgressPct" REAL,
    "statusAtUpdate" TEXT,
    "healthAtUpdate" TEXT,
    "computedProgressPct" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_updates_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goal_updates_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "goal_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "goalId" TEXT NOT NULL,
    "authorEmployeeId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_comments_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goal_comments_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "recognition_values" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'award',
    "colorHex" TEXT NOT NULL DEFAULT '#e07a1f',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "recognition_values_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "feedback_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "requesterEmployeeId" TEXT NOT NULL,
    "responderEmployeeId" TEXT NOT NULL,
    "aboutEmployeeId" TEXT NOT NULL,
    "message" TEXT,
    "dueAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "competencyId" TEXT,
    "goalId" TEXT,
    "projectTag" TEXT,
    "responseVisibility" TEXT NOT NULL DEFAULT 'RECIPIENT_AND_MANAGER',
    "responseAuthorVisibility" TEXT NOT NULL DEFAULT 'NAMED',
    "completedAt" DATETIME,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feedback_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feedback_requests_requesterEmployeeId_fkey" FOREIGN KEY ("requesterEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feedback_requests_responderEmployeeId_fkey" FOREIGN KEY ("responderEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feedback_requests_aboutEmployeeId_fkey" FOREIGN KEY ("aboutEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feedback_requests_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "feedback_requests_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "authorEmployeeId" TEXT,
    "aboutEmployeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'RECIPIENT_AND_MANAGER',
    "authorVisibility" TEXT NOT NULL DEFAULT 'NAMED',
    "competencyId" TEXT,
    "goalId" TEXT,
    "projectTag" TEXT,
    "recognitionValueId" TEXT,
    "requestId" TEXT,
    "sourceCycleId" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "feedback_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feedback_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "feedback_aboutEmployeeId_fkey" FOREIGN KEY ("aboutEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "feedback_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "feedback_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "feedback_recognitionValueId_fkey" FOREIGN KEY ("recognitionValueId") REFERENCES "recognition_values" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "feedback_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "feedback_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_series" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'BIWEEKLY',
    "personAId" TEXT NOT NULL,
    "personBId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextDueAt" DATETIME,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meeting_series_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "meeting_series_personAId_fkey" FOREIGN KEY ("personAId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "meeting_series_personBId_fkey" FOREIGN KEY ("personBId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "seriesId" TEXT,
    "title" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" DATETIME,
    "createdById" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meetings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "meetings_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "meeting_series" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meetingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ATTENDEE',
    "attended" BOOLEAN,
    CONSTRAINT "meeting_participants_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "meeting_participants_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agenda_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdByEmployeeId" TEXT NOT NULL,
    "goalId" TEXT,
    "carriedFromId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "agenda_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agenda_items_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agenda_items_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_notes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meetingId" TEXT NOT NULL,
    "authorEmployeeId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'SHARED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meeting_notes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "meeting_notes_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerEmployeeId" TEXT NOT NULL,
    "assignedByEmployeeId" TEXT,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" DATETIME,
    "meetingId" TEXT,
    "goalId" TEXT,
    "developmentPlanId" TEXT,
    "surveyId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PARTICIPANTS',
    "carriedFromId" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "action_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_items_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_items_assignedByEmployeeId_fkey" FOREIGN KEY ("assignedByEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "action_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "action_items_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "action_items_developmentPlanId_fkey" FOREIGN KEY ("developmentPlanId") REFERENCES "development_plans" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "action_items_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "introText" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'ANONYMOUS',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "opensAt" DATETIME,
    "closesAt" DATETIME,
    "launchedAt" DATETIME,
    "closedAtActual" DATETIME,
    "minResponsesForResults" INTEGER NOT NULL DEFAULT 5,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "collectDepartment" BOOLEAN NOT NULL DEFAULT true,
    "collectTenureBand" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "surveys_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "surveyId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "ratingScaleId" TEXT,
    "choicesJson" TEXT,
    "factor" TEXT,
    CONSTRAINT "survey_questions_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "survey_questions_ratingScaleId_fkey" FOREIGN KEY ("ratingScaleId") REFERENCES "rating_scales" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "survey_audience_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "surveyId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "value" TEXT,
    CONSTRAINT "survey_audience_rules_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "survey_invitations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "surveyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notifiedAt" DATETIME,
    "remindedAt" DATETIME,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATETIME,
    "departmentNameSnapshot" TEXT,
    "tenureBandSnapshot" TEXT,
    "locationSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "survey_invitations_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "survey_invitations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "surveyId" TEXT NOT NULL,
    "respondentEmployeeId" TEXT,
    "departmentNameSnapshot" TEXT,
    "tenureBandSnapshot" TEXT,
    "locationSnapshot" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "survey_responses_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "survey_responses_respondentEmployeeId_fkey" FOREIGN KEY ("respondentEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "survey_answers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "numericValue" REAL,
    "textValue" TEXT,
    "choiceJson" TEXT,
    CONSTRAINT "survey_answers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "survey_responses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "survey_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "survey_questions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "development_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "planType" TEXT NOT NULL DEFAULT 'DEVELOPMENT',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startDate" DATETIME,
    "targetDate" DATETIME,
    "closedAt" DATETIME,
    "outcome" TEXT,
    "hrRestricted" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "development_plans_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "development_plans_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "development_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "itemType" TEXT NOT NULL DEFAULT 'ACTION',
    "ownerEmployeeId" TEXT,
    "competencyId" TEXT,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "development_actions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "development_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "development_actions_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "development_actions_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "competencies" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plan_check_ins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "authorEmployeeId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "plan_check_ins_planId_fkey" FOREIGN KEY ("planId") REFERENCES "development_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "plan_check_ins_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "calibration_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "facilitatorEmployeeId" TEXT,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "calibration_sessions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "calibration_sessions_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "calibration_sessions_facilitatorEmployeeId_fkey" FOREIGN KEY ("facilitatorEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "calibration_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "originalScore" REAL,
    "proposedScore" REAL,
    "finalScore" REAL,
    "rationale" TEXT,
    "decidedByEmployeeId" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "calibration_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "calibration_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "calibration_entries_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "cycle_participants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "calibration_entries_decidedByEmployeeId_fkey" FOREIGN KEY ("decidedByEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "recipientEmployeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkUrl" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "readAt" DATETIME,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_recipientEmployeeId_fkey" FOREIGN KEY ("recipientEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toName" TEXT,
    "subject" TEXT NOT NULL,
    "textBody" TEXT NOT NULL,
    "htmlBody" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL DEFAULT 'outbox',
    "error" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "email_messages_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runAt" DATETIME NOT NULL,
    "payloadJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" DATETIME,
    "completedAt" DATETIME,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheduled_jobs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmployeeId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadataJson" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audit_events_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT,
    "uploadedByEmployeeId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'INHERIT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attachments_uploadedByEmployeeId_fkey" FOREIGN KEY ("uploadedByEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "requestedByEmployeeId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "model" TEXT,
    "promptSummary" TEXT NOT NULL,
    "contextDigest" TEXT,
    "suggestionText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "acceptedText" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_suggestions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ai_suggestions_requestedByEmployeeId_fkey" FOREIGN KEY ("requestedByEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_MAPPING',
    "kind" TEXT NOT NULL DEFAULT 'employees',
    "mappingJson" TEXT,
    "rawRowsJson" TEXT NOT NULL,
    "reportJson" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" DATETIME,
    CONSTRAINT "import_batches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "users_orgId_status_idx" ON "users"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_orgId_email_key" ON "users"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_role_key" ON "user_roles"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "departments_orgId_active_idx" ON "departments"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "departments_orgId_name_key" ON "departments"("orgId", "name");

-- CreateIndex
CREATE INDEX "job_titles_orgId_active_idx" ON "job_titles"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "job_titles_orgId_name_key" ON "job_titles"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");

-- CreateIndex
CREATE INDEX "employees_orgId_employmentStatus_idx" ON "employees"("orgId", "employmentStatus");

-- CreateIndex
CREATE INDEX "employees_orgId_managerId_idx" ON "employees"("orgId", "managerId");

-- CreateIndex
CREATE INDEX "employees_orgId_departmentId_idx" ON "employees"("orgId", "departmentId");

-- CreateIndex
CREATE INDEX "employees_orgId_lastName_idx" ON "employees"("orgId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "employees_orgId_workEmail_key" ON "employees"("orgId", "workEmail");

-- CreateIndex
CREATE INDEX "manager_assignments_employeeId_effectiveFrom_idx" ON "manager_assignments"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "manager_assignments_managerId_idx" ON "manager_assignments"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "rating_scales_orgId_name_key" ON "rating_scales"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rating_scale_levels_scaleId_value_key" ON "rating_scale_levels"("scaleId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "competencies_orgId_name_key" ON "competencies"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "competency_behaviors_competencyId_level_key" ON "competency_behaviors"("competencyId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "competency_libraries_orgId_name_key" ON "competency_libraries"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "competency_library_items_libraryId_competencyId_key" ON "competency_library_items"("libraryId", "competencyId");

-- CreateIndex
CREATE INDEX "review_templates_orgId_status_idx" ON "review_templates"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_templates_orgId_name_key" ON "review_templates"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "review_template_versions_templateId_versionNumber_key" ON "review_template_versions"("templateId", "versionNumber");

-- CreateIndex
CREATE INDEX "template_sections_versionId_sortOrder_idx" ON "template_sections"("versionId", "sortOrder");

-- CreateIndex
CREATE INDEX "template_questions_sectionId_sortOrder_idx" ON "template_questions"("sectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "review_cycles_orgId_status_idx" ON "review_cycles"("orgId", "status");

-- CreateIndex
CREATE INDEX "cycle_participants_cycleId_status_idx" ON "cycle_participants"("cycleId", "status");

-- CreateIndex
CREATE INDEX "cycle_participants_employeeId_idx" ON "cycle_participants"("employeeId");

-- CreateIndex
CREATE INDEX "cycle_participants_managerIdSnapshot_idx" ON "cycle_participants"("managerIdSnapshot");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_participants_cycleId_employeeId_key" ON "cycle_participants"("cycleId", "employeeId");

-- CreateIndex
CREATE INDEX "review_assignments_reviewerEmployeeId_status_idx" ON "review_assignments"("reviewerEmployeeId", "status");

-- CreateIndex
CREATE INDEX "review_assignments_participantId_idx" ON "review_assignments"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "review_assignments_participantId_reviewerEmployeeId_kind_key" ON "review_assignments"("participantId", "reviewerEmployeeId", "kind");

-- CreateIndex
CREATE INDEX "review_responses_assignmentId_idx" ON "review_responses"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "review_responses_assignmentId_questionId_subjectKey_key" ON "review_responses"("assignmentId", "questionId", "subjectKey");

-- CreateIndex
CREATE INDEX "review_approvals_participantId_idx" ON "review_approvals"("participantId");

-- CreateIndex
CREATE INDEX "review_approvals_approverEmployeeId_status_idx" ON "review_approvals"("approverEmployeeId", "status");

-- CreateIndex
CREATE INDEX "review_goal_snapshots_participantId_idx" ON "review_goal_snapshots"("participantId");

-- CreateIndex
CREATE INDEX "goals_orgId_scope_status_idx" ON "goals"("orgId", "scope", "status");

-- CreateIndex
CREATE INDEX "goals_ownerEmployeeId_idx" ON "goals"("ownerEmployeeId");

-- CreateIndex
CREATE INDEX "goals_departmentId_idx" ON "goals"("departmentId");

-- CreateIndex
CREATE INDEX "goals_parentGoalId_idx" ON "goals"("parentGoalId");

-- CreateIndex
CREATE UNIQUE INDEX "goal_collaborators_goalId_employeeId_key" ON "goal_collaborators"("goalId", "employeeId");

-- CreateIndex
CREATE INDEX "goal_milestones_goalId_sortOrder_idx" ON "goal_milestones"("goalId", "sortOrder");

-- CreateIndex
CREATE INDEX "goal_updates_goalId_createdAt_idx" ON "goal_updates"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "goal_comments_goalId_createdAt_idx" ON "goal_comments"("goalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recognition_values_orgId_name_key" ON "recognition_values"("orgId", "name");

-- CreateIndex
CREATE INDEX "feedback_requests_responderEmployeeId_status_idx" ON "feedback_requests"("responderEmployeeId", "status");

-- CreateIndex
CREATE INDEX "feedback_requests_aboutEmployeeId_idx" ON "feedback_requests"("aboutEmployeeId");

-- CreateIndex
CREATE INDEX "feedback_aboutEmployeeId_createdAt_idx" ON "feedback"("aboutEmployeeId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_authorEmployeeId_idx" ON "feedback"("authorEmployeeId");

-- CreateIndex
CREATE INDEX "feedback_orgId_kind_idx" ON "feedback"("orgId", "kind");

-- CreateIndex
CREATE INDEX "meeting_series_personAId_idx" ON "meeting_series"("personAId");

-- CreateIndex
CREATE INDEX "meeting_series_personBId_idx" ON "meeting_series"("personBId");

-- CreateIndex
CREATE INDEX "meetings_orgId_scheduledAt_idx" ON "meetings"("orgId", "scheduledAt");

-- CreateIndex
CREATE INDEX "meetings_seriesId_idx" ON "meetings"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_participants_meetingId_employeeId_key" ON "meeting_participants"("meetingId", "employeeId");

-- CreateIndex
CREATE INDEX "agenda_items_meetingId_sortOrder_idx" ON "agenda_items"("meetingId", "sortOrder");

-- CreateIndex
CREATE INDEX "meeting_notes_meetingId_idx" ON "meeting_notes"("meetingId");

-- CreateIndex
CREATE INDEX "action_items_ownerEmployeeId_status_idx" ON "action_items"("ownerEmployeeId", "status");

-- CreateIndex
CREATE INDEX "action_items_orgId_dueDate_idx" ON "action_items"("orgId", "dueDate");

-- CreateIndex
CREATE INDEX "surveys_orgId_status_idx" ON "surveys"("orgId", "status");

-- CreateIndex
CREATE INDEX "survey_questions_surveyId_sortOrder_idx" ON "survey_questions"("surveyId", "sortOrder");

-- CreateIndex
CREATE INDEX "survey_invitations_surveyId_status_idx" ON "survey_invitations"("surveyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "survey_invitations_surveyId_employeeId_key" ON "survey_invitations"("surveyId", "employeeId");

-- CreateIndex
CREATE INDEX "survey_responses_surveyId_idx" ON "survey_responses"("surveyId");

-- CreateIndex
CREATE INDEX "survey_answers_questionId_idx" ON "survey_answers"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_answers_responseId_questionId_key" ON "survey_answers"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "development_plans_employeeId_status_idx" ON "development_plans"("employeeId", "status");

-- CreateIndex
CREATE INDEX "development_plans_orgId_planType_idx" ON "development_plans"("orgId", "planType");

-- CreateIndex
CREATE INDEX "development_actions_planId_sortOrder_idx" ON "development_actions"("planId", "sortOrder");

-- CreateIndex
CREATE INDEX "plan_check_ins_planId_createdAt_idx" ON "plan_check_ins"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "calibration_sessions_cycleId_idx" ON "calibration_sessions"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "calibration_entries_sessionId_participantId_key" ON "calibration_entries"("sessionId", "participantId");

-- CreateIndex
CREATE INDEX "notifications_recipientEmployeeId_readAt_idx" ON "notifications"("recipientEmployeeId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipientEmployeeId_dedupeKey_key" ON "notifications"("recipientEmployeeId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_dedupeKey_key" ON "email_messages"("dedupeKey");

-- CreateIndex
CREATE INDEX "email_messages_orgId_status_idx" ON "email_messages"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_dedupeKey_key" ON "scheduled_jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "scheduled_jobs_status_runAt_idx" ON "scheduled_jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "audit_events_orgId_createdAt_idx" ON "audit_events"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_actorEmployeeId_idx" ON "audit_events"("actorEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_ownerType_ownerId_idx" ON "attachments"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "ai_suggestions_orgId_kind_idx" ON "ai_suggestions"("orgId", "kind");

-- CreateIndex
CREATE INDEX "ai_suggestions_contextType_contextId_idx" ON "ai_suggestions"("contextType", "contextId");

-- CreateIndex
CREATE INDEX "import_batches_orgId_status_idx" ON "import_batches"("orgId", "status");
