-- CreateTable
CREATE TABLE "salary_bands" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "jobTitleId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "minMinor" INTEGER NOT NULL,
    "midMinor" INTEGER,
    "maxMinor" INTEGER NOT NULL,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "salary_bands_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "salary_bands_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "job_titles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "compensation_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "baseMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveDate" DATETIME NOT NULL,
    "changeType" TEXT NOT NULL,
    "note" TEXT,
    "sourceCycleId" TEXT,
    "recordedByUserId" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compensation_records_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "compensation_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "compensation_records_sourceCycleId_fkey" FOREIGN KEY ("sourceCycleId") REFERENCES "compensation_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "compensation_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveDate" DATETIME NOT NULL,
    "dueAt" DATETIME,
    "reviewCycleId" TEXT,
    "totalPoolMinor" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT,
    "launchedAt" DATETIME,
    "approvedAt" DATETIME,
    "appliedAt" DATETIME,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "compensation_cycles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "compensation_cycles_reviewCycleId_fkey" FOREIGN KEY ("reviewCycleId") REFERENCES "review_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "compensation_budgets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleId" TEXT NOT NULL,
    "ownerEmployeeId" TEXT NOT NULL,
    "poolMinor" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "compensation_budgets_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "compensation_cycles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "compensation_budgets_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "compensation_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerIdSnapshot" TEXT,
    "managerNameSnapshot" TEXT,
    "jobTitleNameSnapshot" TEXT,
    "departmentNameSnapshot" TEXT,
    "currentBaseMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "bandMinMinor" INTEGER,
    "bandMaxMinor" INTEGER,
    "performanceScore" REAL,
    "performanceBand" TEXT,
    "recommendedBp" INTEGER,
    "decidedBp" INTEGER,
    "decidedAmountMinor" INTEGER,
    "newBaseMinor" INTEGER,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedByEmployeeId" TEXT,
    "decidedAt" DATETIME,
    "submittedAt" DATETIME,
    "approvedByUserId" TEXT,
    "approvedAt" DATETIME,
    "approvalNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "compensation_participants_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "compensation_cycles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "compensation_participants_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "compensation_participants_decidedByEmployeeId_fkey" FOREIGN KEY ("decidedByEmployeeId") REFERENCES "employees" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_bands_jobTitleId_key" ON "salary_bands"("jobTitleId");

-- CreateIndex
CREATE INDEX "salary_bands_orgId_idx" ON "salary_bands"("orgId");

-- CreateIndex
CREATE INDEX "compensation_records_employeeId_effectiveDate_idx" ON "compensation_records"("employeeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "compensation_records_orgId_idx" ON "compensation_records"("orgId");

-- CreateIndex
CREATE INDEX "compensation_cycles_orgId_status_idx" ON "compensation_cycles"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "compensation_budgets_cycleId_ownerEmployeeId_key" ON "compensation_budgets"("cycleId", "ownerEmployeeId");

-- CreateIndex
CREATE INDEX "compensation_participants_cycleId_status_idx" ON "compensation_participants"("cycleId", "status");

-- CreateIndex
CREATE INDEX "compensation_participants_managerIdSnapshot_idx" ON "compensation_participants"("managerIdSnapshot");

-- CreateIndex
CREATE UNIQUE INDEX "compensation_participants_cycleId_employeeId_key" ON "compensation_participants"("cycleId", "employeeId");
