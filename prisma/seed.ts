/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/server/auth/password';
import { computeGoalProgress } from '../src/server/scoring/goal-progress';
import { tenureBand } from '../src/server/surveys/privacy';
import {
  COMPETENCIES,
  COMPETENCY_LIBRARIES,
  DEPARTMENTS,
  JOB_TITLES,
  ORG_SLUG,
  RATING_SCALES,
  PAY_POSITIONS,
  RECOGNITION_VALUES,
  SALARY_BANDS,
  seedOrganization,
} from './seed/catalog';
import { MANAGER_HISTORY, PEOPLE, type SeedPerson } from './seed/people';
import { STARTER_TEMPLATES } from './seed/templates';
import { Rng, type Profile } from './seed/rng';
import { increaseFromBasisPoints, newBaseFrom, recommendIncrease } from '../src/lib/money';
import {
  fillAssignment,
  finalizeParticipantScore,
  loadForm,
  snapshotGoals,
  type GoalForReview,
  type LoadedForm,
} from './seed/review-gen';

/**
 * Seeds a complete, self-consistent demonstration organization.
 *
 * Safety rails:
 *  - refuses to run against NODE_ENV=production unless ALLOW_PROD_SEED=true
 *  - every account is flagged isDemoAccount, every record isDemoData
 *  - the demo password comes from SEED_PASSWORD, with a documented default
 *    that is only usable because these accounts are marked as demo accounts
 *
 * Run with: npm run db:seed   (or npm run setup for a fresh install)
 */

const db = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'ElevateDemo!2026';
const TODAY = new Date('2026-11-04T09:00:00.000Z');

function date(iso: string): Date {
  return new Date(`${iso}T09:00:00.000Z`);
}

function daysFrom(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

const log = (...args: unknown[]) => console.log('  ', ...args);

// ===========================================================================
// Performance profiles, used to shape generated ratings
// ===========================================================================

const PROFILES: Record<string, Profile> = {
  dana: 'strong',
  marcus: 'outstanding',
  priya: 'strong',
  terrence: 'solid',
  elena: 'strong',
  grant: 'strong',
  rosa: 'outstanding',
  tyler: 'strong',
  jamal: 'solid',
  oleg: 'solid',
  casey: 'developing',
  abebe: 'strong',
  nina: 'outstanding',
  dmitri: 'solid',
  hana: 'developing',
  wesley: 'strong',
  sofia: 'outstanding',
  brandon: 'solid',
  aaliyah: 'strong',
  henrik: 'developing',
  dale: 'solid',
  mireille: 'strong',
  corey: 'struggling',
  yuki: 'solid',
  gloria: 'solid',
  sam: 'developing',
  vince: 'struggling',
};

// ===========================================================================
// Goal catalogue
// ===========================================================================

interface GoalSeed {
  title: string;
  description: string;
  outcome: string;
  category: string;
  measurementType: 'PERCENT' | 'NUMERIC' | 'MILESTONE' | 'BINARY';
  startValue?: number;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  higherIsBetter?: boolean;
  reportedProgressPct?: number;
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  health?: 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | 'BLOCKED';
  visibility?: 'PRIVATE' | 'MANAGER_CHAIN' | 'DEPARTMENT' | 'ORGANIZATION';
  milestones?: { title: string; done: boolean; weight?: number }[];
  dueDate: string;
  startDate: string;
}

const COMPANY_GOALS: GoalSeed[] = [
  {
    title: 'Zero lost-time safety incidents in 2026',
    description:
      'No incident that costs someone a shift. Measured from the incident log; near-misses are tracked separately and are expected to go up as reporting improves.',
    outcome: 'A full calendar year with no lost-time incident across every crew and the yard.',
    category: 'Safety',
    measurementType: 'NUMERIC',
    startValue: 3,
    targetValue: 0,
    currentValue: 1,
    unit: 'incidents',
    higherIsBetter: false,
    status: 'IN_PROGRESS',
    health: 'AT_RISK',
    visibility: 'ORGANIZATION',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
  },
  {
    title: 'Average punch list under 10 items per job',
    description:
      'Measured on the client walkthrough list, not the internal pre-walk. Counts every job handed over in the year.',
    outcome: 'Jobs handed over clean, so closeout and retention release stop dragging.',
    category: 'Quality',
    measurementType: 'NUMERIC',
    startValue: 22,
    targetValue: 10,
    currentValue: 14,
    unit: 'items/job',
    higherIsBetter: false,
    status: 'IN_PROGRESS',
    health: 'ON_TRACK',
    visibility: 'ORGANIZATION',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
  },
  {
    title: 'Grow remodel revenue to $4.2M',
    description: 'Signed and delivered remodel work, excluding new-build framing contracts.',
    outcome: 'A revenue mix less exposed to new-build slowdowns.',
    category: 'Growth',
    measurementType: 'NUMERIC',
    startValue: 3.1,
    targetValue: 4.2,
    currentValue: 3.8,
    unit: '$M',
    higherIsBetter: true,
    status: 'IN_PROGRESS',
    health: 'ON_TRACK',
    visibility: 'ORGANIZATION',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
  },
  {
    title: 'Every field employee holds a current OSHA 10 card',
    description:
      'Tracked as a checklist by crew. The apprentices hired this year are the remaining gap.',
    outcome: 'No crew member on site without current certification.',
    category: 'Safety',
    measurementType: 'MILESTONE',
    status: 'IN_PROGRESS',
    health: 'ON_TRACK',
    visibility: 'ORGANIZATION',
    startDate: '2026-02-01',
    dueDate: '2026-12-15',
    milestones: [
      { title: 'Framing Crew A certified', done: true },
      { title: 'Remodel Crew B certified', done: true },
      { title: 'Yard and equipment staff certified', done: true },
      { title: '2026 apprentice intake certified', done: false },
      { title: 'Renewals due in Q4 completed', done: false },
    ],
  },
];

const TEAM_GOALS: (GoalSeed & { department: string; ownerKey: string })[] = [
  {
    department: 'Field Operations',
    ownerKey: 'elena',
    title: 'Cut material waste by 15%',
    description: 'Measured as the dumpster and return-credit cost per job against the material budget.',
    outcome: 'Less money in the skip, and less time spent on emergency material runs.',
    category: 'Quality',
    measurementType: 'NUMERIC',
    startValue: 0,
    targetValue: 15,
    currentValue: 9,
    unit: '% reduction',
    status: 'IN_PROGRESS',
    health: 'ON_TRACK',
    visibility: 'DEPARTMENT',
    startDate: '2026-01-15',
    dueDate: '2026-12-31',
  },
  {
    department: 'Framing',
    ownerKey: 'rosa',
    title: 'Every framing inspection passes first time',
    description: 'Counted on the first inspection only. A re-inspection for any reason counts as a fail.',
    outcome: 'No lost days waiting on a second inspection.',
    category: 'Quality',
    measurementType: 'NUMERIC',
    startValue: 78,
    targetValue: 100,
    currentValue: 94,
    unit: '% first-time pass',
    status: 'IN_PROGRESS',
    health: 'ON_TRACK',
    visibility: 'DEPARTMENT',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
  },
  {
    department: 'Finish & Remodel',
    ownerKey: 'abebe',
    title: 'Fewer than 2 callbacks per completed job',
    description: 'A callback is any return visit for defect work within 90 days of handover.',
    outcome: 'Crews stay on new work instead of going back.',
    category: 'Quality',
    measurementType: 'NUMERIC',
    startValue: 4.2,
    targetValue: 2,
    currentValue: 2.6,
    unit: 'callbacks/job',
    higherIsBetter: false,
    status: 'IN_PROGRESS',
    health: 'ON_TRACK',
    visibility: 'DEPARTMENT',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
  },
  {
    department: 'Project Management',
    ownerKey: 'sofia',
    title: 'Change orders written up within 24 hours',
    description: 'From the point the out-of-scope work is identified on site to a priced change order in the client folder.',
    outcome: 'Stop building work we never billed for.',
    category: 'Schedule',
    measurementType: 'NUMERIC',
    startValue: 41,
    targetValue: 95,
    currentValue: 72,
    unit: '% within 24h',
    status: 'IN_PROGRESS',
    health: 'AT_RISK',
    visibility: 'DEPARTMENT',
    startDate: '2026-02-01',
    dueDate: '2026-12-31',
  },
  {
    department: 'Sales & Estimating',
    ownerKey: 'dale',
    title: 'Estimates within 5% of final job cost',
    description: 'Compared on closed jobs only, excluding client-driven scope changes.',
    outcome: 'Margin we can actually rely on when we quote.',
    category: 'Growth',
    measurementType: 'NUMERIC',
    startValue: 13,
    targetValue: 5,
    currentValue: 8.5,
    unit: '% variance',
    higherIsBetter: false,
    status: 'IN_PROGRESS',
    health: 'AT_RISK',
    visibility: 'DEPARTMENT',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
  },
  {
    department: 'Office Administration',
    ownerKey: 'priya',
    title: 'Close month-end within 5 business days',
    description: 'From the last day of the month to a signed-off set of job cost reports.',
    outcome: 'Job costing that is current enough to act on.',
    category: 'Schedule',
    measurementType: 'NUMERIC',
    startValue: 12,
    targetValue: 5,
    currentValue: 6,
    unit: 'business days',
    higherIsBetter: false,
    status: 'IN_PROGRESS',
    health: 'ON_TRACK',
    visibility: 'DEPARTMENT',
    startDate: '2026-01-01',
    dueDate: '2026-12-31',
  },
];

const INDIVIDUAL_GOAL_POOL: Record<string, GoalSeed[]> = {
  Field: [
    {
      title: 'Complete apprenticeship hours for the year',
      description: 'Logged hours against the state apprenticeship requirement, signed off by the crew lead.',
      outcome: 'On track to sit the journeyman assessment next year.',
      category: 'Development',
      measurementType: 'NUMERIC',
      startValue: 0,
      targetValue: 2000,
      currentValue: 1450,
      unit: 'hours',
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-01-06',
      dueDate: '2026-12-20',
    },
    {
      title: 'Run a two-day job start to finish without supervision',
      description: 'Pick a small deck or interior job, plan it, order materials, run it, close it out.',
      outcome: 'Ready to take a crew on short jobs.',
      category: 'Development',
      measurementType: 'MILESTONE',
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-03-02',
      dueDate: '2026-11-28',
      milestones: [
        { title: 'Shadow a lead through a full job', done: true },
        { title: 'Produce the material list unaided', done: true },
        { title: 'Run the job with the lead on call', done: false },
        { title: 'Close out and walk the client through', done: false },
      ],
    },
    {
      title: 'Zero rework items on my own work',
      description: 'Tracked from the internal pre-walk list, by the person who did the work.',
      outcome: 'Work right the first time.',
      category: 'Quality',
      measurementType: 'PERCENT',
      reportedProgressPct: 70,
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-01-06',
      dueDate: '2026-12-20',
    },
    {
      title: 'Get the OSHA 30 certification',
      description: 'The 30-hour course, not the 10-hour refresh. Needed to take on the site safety role.',
      outcome: 'Able to run the safety brief and sign off the daily checks.',
      category: 'Safety',
      measurementType: 'BINARY',
      status: 'COMPLETED',
      health: 'ON_TRACK',
      startDate: '2026-02-10',
      dueDate: '2026-06-30',
    },
    {
      title: 'Daily logs submitted same day, every day',
      description: 'Measured from the log timestamps. This has been the recurring gap in my paperwork.',
      outcome: 'Billing never waits on my paperwork.',
      category: 'Quality',
      measurementType: 'NUMERIC',
      startValue: 54,
      targetValue: 100,
      currentValue: 81,
      unit: '% same-day',
      status: 'IN_PROGRESS',
      health: 'AT_RISK',
      startDate: '2026-04-01',
      dueDate: '2026-12-31',
    },
  ],
  'Project Management': [
    {
      title: 'Every job has a current three-week lookahead',
      description: 'Updated every Friday for each active job, shared with the crew lead.',
      outcome: 'Crews and subs know what is coming before the week starts.',
      category: 'Schedule',
      measurementType: 'NUMERIC',
      startValue: 30,
      targetValue: 100,
      currentValue: 85,
      unit: '% of jobs',
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-01-15',
      dueDate: '2026-12-31',
    },
    {
      title: 'Cut average closeout time to 10 days',
      description: 'From final inspection to signed completion and retention invoice.',
      outcome: 'Cash in sooner and jobs actually finished.',
      category: 'Schedule',
      measurementType: 'NUMERIC',
      startValue: 26,
      targetValue: 10,
      currentValue: 17,
      unit: 'days',
      higherIsBetter: false,
      status: 'IN_PROGRESS',
      health: 'AT_RISK',
      startDate: '2026-02-01',
      dueDate: '2026-12-31',
    },
    {
      title: 'Take the lead on two whole-home remodels',
      description: 'Full responsibility, with Sofia available but not running them.',
      outcome: 'Ready to carry the larger jobs next year.',
      category: 'Development',
      measurementType: 'MILESTONE',
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-01-20',
      dueDate: '2026-12-15',
      milestones: [
        { title: 'Thornton remodel — run solo', done: true },
        { title: 'Thornton remodel — closed out', done: true },
        { title: 'Second remodel assigned', done: true },
        { title: 'Second remodel closed out', done: false },
      ],
    },
  ],
  Sales: [
    {
      title: 'Estimate variance under 6% on my jobs',
      description: 'My own estimates, compared against final cost on closed jobs.',
      outcome: 'Quotes the company can rely on.',
      category: 'Growth',
      measurementType: 'NUMERIC',
      startValue: 15,
      targetValue: 6,
      currentValue: 11,
      unit: '% variance',
      higherIsBetter: false,
      status: 'IN_PROGRESS',
      health: 'OFF_TRACK',
      startDate: '2026-01-06',
      dueDate: '2026-12-31',
    },
    {
      title: 'Book $1.4M in signed remodel work',
      description: 'Signed contracts, not proposals out.',
      outcome: 'A full pipeline for the finish crews into next spring.',
      category: 'Growth',
      measurementType: 'NUMERIC',
      startValue: 0,
      targetValue: 1.4,
      currentValue: 1.1,
      unit: '$M',
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-01-06',
      dueDate: '2026-12-31',
    },
    {
      title: 'Rebuild the selections process with the design team',
      description: 'Clients are choosing finishes too late and it is holding up the finish crews.',
      outcome: 'All selections locked before the framing inspection.',
      category: 'Quality',
      measurementType: 'PERCENT',
      reportedProgressPct: 45,
      status: 'IN_PROGRESS',
      health: 'AT_RISK',
      startDate: '2026-05-01',
      dueDate: '2026-12-31',
    },
  ],
  Office: [
    {
      title: 'Move time sheets off paper',
      description: 'Field crews submitting time through the tablet app rather than paper slips.',
      outcome: 'Payroll processed in a morning rather than two days.',
      category: 'Schedule',
      measurementType: 'NUMERIC',
      startValue: 0,
      targetValue: 100,
      currentValue: 68,
      unit: '% of crews',
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-03-01',
      dueDate: '2026-12-31',
    },
    {
      title: 'Subcontractor insurance certificates current, all of them',
      description: 'No sub on site with a lapsed certificate.',
      outcome: 'No exposure from an uninsured sub.',
      category: 'Quality',
      measurementType: 'NUMERIC',
      startValue: 71,
      targetValue: 100,
      currentValue: 97,
      unit: '% current',
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-01-06',
      dueDate: '2026-12-31',
    },
    {
      title: 'Document the month-end close as a written procedure',
      description: 'Right now it only exists in my head, which is a problem if I am away.',
      outcome: 'Someone else could close the month from the written procedure.',
      category: 'Development',
      measurementType: 'BINARY',
      status: 'COMPLETED',
      health: 'ON_TRACK',
      startDate: '2026-06-01',
      dueDate: '2026-09-30',
    },
  ],
  Leadership: [
    {
      title: 'Develop two crew leads ready for superintendent',
      description: 'Identified, given stretch work, and assessed against the leadership competencies.',
      outcome: 'A bench that does not depend on one superintendent.',
      category: 'Development',
      measurementType: 'MILESTONE',
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-01-06',
      dueDate: '2026-12-31',
      milestones: [
        { title: 'Candidates identified', done: true },
        { title: 'Development plans in place', done: true },
        { title: 'Each has run a job solo', done: true },
        { title: 'Assessed against leadership competencies', done: false },
      ],
    },
    {
      title: 'Voluntary turnover under 12%',
      description: 'Rolling twelve months, excluding seasonal roles.',
      outcome: 'Keep the people we have trained.',
      category: 'Growth',
      measurementType: 'NUMERIC',
      startValue: 23,
      targetValue: 12,
      currentValue: 15,
      unit: '%',
      higherIsBetter: false,
      status: 'IN_PROGRESS',
      health: 'ON_TRACK',
      startDate: '2026-01-01',
      dueDate: '2026-12-31',
    },
  ],
};

// ===========================================================================
// Main
// ===========================================================================

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to seed demonstration data with NODE_ENV=production. Set ALLOW_PROD_SEED=true only if you really mean it.',
    );
  }

  console.log('\nDB Elevate — seeding demonstration data');
  console.log('='.repeat(60));

  const existing = await db.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (existing) {
    const employeeCount = await db.employee.count({ where: { orgId: existing.id } });
    if (employeeCount > 0 && process.env.SEED_FORCE !== '1') {
      console.log(
        `\nOrganization "${existing.name}" already has ${employeeCount} employees.\n` +
          'Nothing was changed. To rebuild the demonstration data:\n' +
          '  npm run db:reset      (drops and recreates the database, then re-seeds)\n' +
          '  SEED_FORCE=1 npm run db:seed   (deletes this organization and re-seeds)\n',
      );
      return;
    }
    if (employeeCount > 0) {
      log(`SEED_FORCE=1 — deleting organization "${existing.name}" and all of its records`);
      await db.organization.delete({ where: { id: existing.id } });
    }
  }

  // -- Organization ---------------------------------------------------------
  const org = await seedOrganization(db);
  const orgId = org.id;
  log(`organization: ${org.name} (product name "${org.productName}")`);

  // -- Departments ----------------------------------------------------------
  const deptIds = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const created = await db.department.create({
      data: {
        orgId,
        name: d.name,
        code: d.code,
        sortOrder: d.sortOrder,
        parentId: d.parent ? (deptIds.get(d.parent) ?? null) : null,
      },
    });
    deptIds.set(d.name, created.id);
  }
  log(`departments: ${deptIds.size}`);

  // -- Rating scales --------------------------------------------------------
  const scaleIds = new Map<string, string>();
  for (const s of RATING_SCALES) {
    const created = await db.ratingScale.create({
      data: {
        orgId,
        name: s.name,
        description: s.description,
        numeric: true,
        levels: {
          create: s.levels.map((l, i) => ({
            value: l.value,
            label: l.label,
            description: l.description || null,
            sortOrder: i,
          })),
        },
      },
    });
    scaleIds.set(s.name, created.id);
  }
  log(`rating scales: ${scaleIds.size}`);

  // -- Competencies ---------------------------------------------------------
  const competencyIds = new Map<string, string>();
  for (const c of COMPETENCIES) {
    const created = await db.competency.create({
      data: {
        orgId,
        name: c.name,
        description: c.description,
        category: c.category,
        behaviors: {
          create: c.behaviors.map((b, i) => ({
            level: b.level,
            descriptor: b.descriptor,
            sortOrder: i,
          })),
        },
      },
    });
    competencyIds.set(c.name, created.id);
  }
  log(`competencies: ${competencyIds.size}`);

  const libraryIds = new Map<string, string>();
  for (const lib of COMPETENCY_LIBRARIES) {
    const created = await db.competencyLibrary.create({
      data: {
        orgId,
        name: lib.name,
        description: lib.description,
        items: {
          create: lib.items
            .map((name, i) => ({ competencyId: competencyIds.get(name), sortOrder: i }))
            .filter((x): x is { competencyId: string; sortOrder: number } => Boolean(x.competencyId)),
        },
      },
    });
    libraryIds.set(lib.name, created.id);
  }
  log(`competency libraries: ${libraryIds.size}`);

  // -- Job titles -----------------------------------------------------------
  const titleIds = new Map<string, string>();
  for (const t of JOB_TITLES) {
    const created = await db.jobTitle.create({
      data: {
        orgId,
        name: t.name,
        level: t.level,
        departmentId: deptIds.get(t.department) ?? null,
        competencyLibraryId: t.library ? (libraryIds.get(t.library) ?? null) : null,
      },
    });
    titleIds.set(t.name, created.id);
  }
  log(`job titles: ${titleIds.size}`);

  // -- Recognition values ---------------------------------------------------
  const recognitionIds = new Map<string, string>();
  for (const [i, r] of RECOGNITION_VALUES.entries()) {
    const created = await db.recognitionValue.create({
      data: { orgId, name: r.name, description: r.description, icon: r.icon, colorHex: r.colorHex, sortOrder: i },
    });
    recognitionIds.set(r.name, created.id);
  }
  log(`recognition values: ${recognitionIds.size}`);

  // -- People ---------------------------------------------------------------
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const employeeIds = new Map<string, string>();
  const userIds = new Map<string, string>();
  const personByKey = new Map<string, SeedPerson>(PEOPLE.map((p) => [p.key, p]));

  // Pass 1: create without manager links.
  for (const p of PEOPLE) {
    const user = await db.user.create({
      data: {
        orgId,
        email: p.email,
        passwordHash,
        status: p.employmentStatus === 'terminated' ? 'deactivated' : 'active',
        isDemoAccount: true,
        roles: { create: p.roles.map((role) => ({ role })) },
      },
    });
    userIds.set(p.key, user.id);

    const employee = await db.employee.create({
      data: {
        orgId,
        userId: user.id,
        employeeNumber: p.employeeNumber,
        firstName: p.firstName,
        lastName: p.lastName,
        preferredName: p.preferredName ?? null,
        workEmail: p.email,
        departmentId: deptIds.get(p.department) ?? null,
        jobTitleId: titleIds.get(p.jobTitle) ?? null,
        hireDate: date(p.hireDate),
        terminationDate: p.terminationDate ? date(p.terminationDate) : null,
        employmentType: p.employmentType,
        employmentStatus: p.employmentStatus ?? 'active',
        workLocation: p.workLocation,
        crew: p.crew ?? null,
        reviewCohort: p.reviewCohort,
        reviewEligible: p.employmentStatus !== 'terminated',
        isDemoData: true,
      },
    });
    employeeIds.set(p.key, employee.id);
  }

  // Pass 2: manager links + current reporting-line history.
  for (const p of PEOPLE) {
    if (!p.managerKey) continue;
    await db.employee.update({
      where: { id: employeeIds.get(p.key) as string },
      data: { managerId: employeeIds.get(p.managerKey) ?? null },
    });
  }

  // Current assignment row for everyone, then the explicit history overrides.
  const historyKeys = new Set(MANAGER_HISTORY.map((h) => h.employeeKey));
  for (const p of PEOPLE) {
    if (historyKeys.has(p.key)) continue;
    await db.managerAssignment.create({
      data: {
        employeeId: employeeIds.get(p.key) as string,
        managerId: p.managerKey ? (employeeIds.get(p.managerKey) ?? null) : null,
        effectiveFrom: date(p.hireDate),
        effectiveTo: null,
        reason: 'Initial assignment at hire.',
      },
    });
  }
  for (const h of MANAGER_HISTORY) {
    await db.managerAssignment.create({
      data: {
        employeeId: employeeIds.get(h.employeeKey) as string,
        managerId: h.managerKey ? (employeeIds.get(h.managerKey) ?? null) : null,
        effectiveFrom: date(h.effectiveFrom),
        effectiveTo: h.effectiveTo ? date(h.effectiveTo) : null,
        reason: h.reason,
      },
    });
  }
  log(`people: ${employeeIds.size} employees with accounts (1 deactivated)`);

  // -- Review templates -----------------------------------------------------
  const templateVersionIds = new Map<string, string>();
  for (const t of STARTER_TEMPLATES) {
    const template = await db.reviewTemplate.create({
      data: {
        orgId,
        name: t.name,
        description: t.description,
        category: t.category,
        status: 'published',
        isStarter: true,
        createdById: userIds.get('priya') ?? null,
      },
    });

    const version = await db.reviewTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        changeNote: 'Starter template provided with the initial setup.',
        publishedAt: date('2025-12-01'),
        publishedById: userIds.get('priya') ?? null,
        selfWeight: t.selfWeight,
        managerWeight: t.managerWeight,
        peerWeight: t.peerWeight,
        createdById: userIds.get('priya') ?? null,
      },
    });

    for (const [si, section] of t.sections.entries()) {
      const createdSection = await db.templateSection.create({
        data: {
          versionId: version.id,
          title: section.title,
          instructions: section.instructions ?? null,
          sortOrder: si,
          weight: section.weight ?? 1,
          appliesTo: section.appliesTo ?? 'SELF,MANAGER,PEER',
        },
      });
      for (const [qi, q] of section.questions.entries()) {
        await db.templateQuestion.create({
          data: {
            sectionId: createdSection.id,
            sortOrder: qi,
            type: q.type,
            prompt: q.prompt,
            helpText: q.helpText ?? null,
            required: q.required ?? false,
            weight: q.weight ?? 1,
            allowNotApplicable: q.allowNotApplicable ?? false,
            commentEnabled: q.commentEnabled ?? false,
            commentRequired: q.commentRequired ?? false,
            maxLength: q.maxLength ?? null,
            ratingScaleId: q.scale ? (scaleIds.get(q.scale) ?? null) : null,
            competencyId: q.competency ? (competencyIds.get(q.competency) ?? null) : null,
            goalScope: q.goalScope ?? null,
            choicesJson: q.choices ? JSON.stringify(q.choices) : null,
            appliesTo: q.appliesTo ?? null,
          },
        });
      }
    }

    await db.reviewTemplate.update({ where: { id: template.id }, data: { updatedAt: new Date() } });
    templateVersionIds.set(t.name, version.id);
  }
  log(`review templates: ${templateVersionIds.size} published starter templates`);

  // -- Goals ----------------------------------------------------------------
  const goalsByEmployee = new Map<string, GoalForReview[]>();

  async function createGoal(
    seed: GoalSeed,
    opts: { scope: 'INDIVIDUAL' | 'TEAM' | 'COMPANY'; ownerKey?: string; department?: string; parentId?: string },
  ): Promise<string> {
    const ownerId = opts.ownerKey ? (employeeIds.get(opts.ownerKey) as string) : null;
    const progress = computeGoalProgress({
      measurementType: seed.measurementType,
      startValue: seed.startValue,
      targetValue: seed.targetValue,
      currentValue: seed.currentValue,
      higherIsBetter: seed.higherIsBetter,
      reportedProgressPct: seed.reportedProgressPct,
      status: seed.status,
      milestones: seed.milestones?.map((m) => ({
        completedAt: m.done ? daysFrom(TODAY, -30) : null,
        weight: m.weight ?? 1,
      })),
    });

    const goal = await db.goal.create({
      data: {
        orgId,
        title: seed.title,
        description: seed.description,
        outcome: seed.outcome,
        category: seed.category,
        scope: opts.scope,
        ownerEmployeeId: ownerId,
        departmentId: opts.department ? (deptIds.get(opts.department) ?? null) : null,
        parentGoalId: opts.parentId ?? null,
        startDate: date(seed.startDate),
        dueDate: date(seed.dueDate),
        status: seed.status ?? 'IN_PROGRESS',
        health: seed.health ?? 'ON_TRACK',
        visibility: seed.visibility ?? 'MANAGER_CHAIN',
        measurementType: seed.measurementType,
        startValue: seed.startValue ?? null,
        targetValue: seed.targetValue ?? null,
        currentValue: seed.currentValue ?? null,
        unit: seed.unit ?? null,
        higherIsBetter: seed.higherIsBetter !== false,
        reportedProgressPct:
          seed.reportedProgressPct ?? (progress.computedPct !== null ? progress.computedPct : null),
        completedAt: seed.status === 'COMPLETED' ? daysFrom(TODAY, -45) : null,
        createdById: ownerId ?? (employeeIds.get('marcus') as string),
        isDemoData: true,
        milestones: seed.milestones
          ? {
              create: seed.milestones.map((m, i) => ({
                title: m.title,
                dueDate: daysFrom(date(seed.dueDate), -(seed.milestones!.length - i) * 21),
                completedAt: m.done ? daysFrom(TODAY, -40 + i * 7) : null,
                weight: m.weight ?? 1,
                sortOrder: i,
              })),
            }
          : undefined,
      },
    });

    if (ownerId) {
      const list = goalsByEmployee.get(ownerId) ?? [];
      list.push({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        health: goal.health,
        reportedProgressPct: goal.reportedProgressPct,
        targetValue: goal.targetValue,
        unit: goal.unit,
        dueDate: goal.dueDate,
      });
      goalsByEmployee.set(ownerId, list);
    }
    return goal.id;
  }

  const companyGoalIds: string[] = [];
  for (const g of COMPANY_GOALS) {
    companyGoalIds.push(await createGoal(g, { scope: 'COMPANY', ownerKey: 'marcus' }));
  }

  const teamGoalIds = new Map<string, string>();
  for (const [i, g] of TEAM_GOALS.entries()) {
    const id = await createGoal(g, {
      scope: 'TEAM',
      ownerKey: g.ownerKey,
      department: g.department,
      parentId: companyGoalIds[i % companyGoalIds.length],
    });
    teamGoalIds.set(g.department, id);
  }

  let individualGoalCount = 0;
  const goalRng = new Rng('individual-goals');
  for (const p of PEOPLE) {
    if (p.employmentStatus === 'terminated') continue;
    const pool = INDIVIDUAL_GOAL_POOL[p.reviewCohort] ?? INDIVIDUAL_GOAL_POOL.Field!;
    const count = p.reviewCohort === 'Leadership' ? 2 : goalRng.int(2, 3);
    const chosen = goalRng.pickMany(pool, Math.min(count, pool.length));
    for (const seed of chosen) {
      await createGoal(seed, {
        scope: 'INDIVIDUAL',
        ownerKey: p.key,
        parentId: teamGoalIds.get(p.department) ?? teamGoalIds.get('Field Operations'),
      });
      individualGoalCount += 1;
    }
  }
  log(
    `goals: ${COMPANY_GOALS.length} company, ${TEAM_GOALS.length} team, ${individualGoalCount} individual`,
  );

  // Goal progress updates, so the history tab is not empty.
  const updateRng = new Rng('goal-updates');
  const allGoals = await db.goal.findMany({
    where: { orgId, ownerEmployeeId: { not: null } },
    select: {
      id: true,
      ownerEmployeeId: true,
      status: true,
      health: true,
      currentValue: true,
      reportedProgressPct: true,
      measurementType: true,
      startValue: true,
      targetValue: true,
      higherIsBetter: true,
    },
  });
  const UPDATE_NOTES = [
    'Checked in at the weekly. Still on the plan.',
    'Slipped a bit this month, the two weeks we were short-staffed cost us.',
    'Good month. Ahead of where I expected to be.',
    'Blocked on the supplier. Chasing it, should clear next week.',
    'Picked back up after the summer slowdown.',
  ];
  let updateCount = 0;
  for (const g of allGoals) {
    const n = updateRng.int(1, 3);
    for (let i = n; i >= 1; i -= 1) {
      const interim =
        g.reportedProgressPct !== null
          ? Math.max(0, Math.round(g.reportedProgressPct - i * updateRng.int(8, 18)))
          : null;
      await db.goalUpdate.create({
        data: {
          goalId: g.id,
          authorEmployeeId: g.ownerEmployeeId as string,
          body: updateRng.pick(UPDATE_NOTES),
          valueAtUpdate: g.currentValue,
          reportedProgressPct: interim,
          computedProgressPct: interim,
          statusAtUpdate: g.status,
          healthAtUpdate: g.health,
          createdAt: daysFrom(TODAY, -i * 30 - updateRng.int(0, 6)),
        },
      });
      updateCount += 1;
    }
  }
  log(`goal updates: ${updateCount}`);

  // -- Review cycles --------------------------------------------------------
  const reviewSubjects = PEOPLE.filter((p) => p.key !== 'dana');
  const formCache = new Map<string, LoadedForm>();
  async function form(versionId: string): Promise<LoadedForm> {
    let f = formCache.get(versionId);
    if (!f) {
      f = await loadForm(db, versionId);
      formCache.set(versionId, f);
    }
    return f;
  }

  function templateFor(p: SeedPerson): string {
    if (p.reviewCohort === 'Field') {
      return 'Annual Performance Review — Field Crew';
    }
    return 'Annual Performance Review — Office, Sales & Project Management';
  }

  /** Manager as at a given date, from the seeded history. */
  function managerKeyAt(key: string, at: Date): string | null {
    const history = MANAGER_HISTORY.filter((h) => h.employeeKey === key);
    for (const h of history) {
      const from = date(h.effectiveFrom).getTime();
      const to = h.effectiveTo ? date(h.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      if (at.getTime() >= from && at.getTime() < to) return h.managerKey;
    }
    return personByKey.get(key)?.managerKey ?? null;
  }

  interface CycleSpec {
    name: string;
    description: string;
    status: 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'CLOSED';
    periodStart: string;
    periodEnd: string;
    launchedAt?: string;
    closedAt?: string;
    templateName?: string;
    byCohort?: boolean;
    subjects: string[];
    peer?: boolean;
    requireApproval?: boolean;
    selfDue: string;
    managerDue: string;
    /** Target lifecycle state per subject key; '*' is the default. */
    states: Record<string, ParticipantPlan>;
  }

  type ParticipantPlan =
    | 'not_started'
    | 'self_draft'
    | 'self_submitted'
    | 'manager_draft'
    | 'both_submitted'
    | 'awaiting_approval'
    | 'approved'
    | 'released'
    | 'acknowledged';

  const activeSubjects = reviewSubjects.filter((p) => p.employmentStatus !== 'terminated');

  const CYCLES: CycleSpec[] = [
    {
      name: '2025 Annual Performance Review',
      description:
        'The 2025 annual review, run in January 2026. Closed. Kept here as the historical record — the template has been edited since and this cycle still shows the questions as they were asked.',
      status: 'CLOSED',
      periodStart: '2025-01-01',
      periodEnd: '2025-12-31',
      launchedAt: '2026-01-05',
      closedAt: '2026-03-10',
      byCohort: true,
      requireApproval: true,
      selfDue: '2026-01-23',
      managerDue: '2026-02-13',
      subjects: reviewSubjects.filter((p) => date(p.hireDate) < date('2025-10-01')).map((p) => p.key),
      states: { '*': 'acknowledged' },
    },
    {
      name: 'Q3 2026 Check-In',
      description: 'Short quarterly conversation for the third quarter. Closed.',
      status: 'CLOSED',
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
      launchedAt: '2026-09-21',
      closedAt: '2026-10-17',
      templateName: 'Quarterly Check-In',
      selfDue: '2026-10-02',
      managerDue: '2026-10-10',
      subjects: activeSubjects.filter((p) => date(p.hireDate) < date('2026-07-01')).map((p) => p.key),
      states: { '*': 'acknowledged' },
    },
    {
      name: '2026 Annual Performance Review',
      description:
        'The current annual cycle. Self-assessments were due 30 October and manager reviews are due 20 November.',
      status: 'ACTIVE',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      launchedAt: '2026-10-15',
      byCohort: true,
      requireApproval: true,
      selfDue: '2026-10-30',
      managerDue: '2026-11-20',
      subjects: activeSubjects.filter((p) => date(p.hireDate) < date('2026-08-01')).map((p) => p.key),
      states: {
        '*': 'self_submitted',
        tyler: 'released',
        nina: 'acknowledged',
        jamal: 'both_submitted',
        oleg: 'awaiting_approval',
        casey: 'self_draft',
        dmitri: 'manager_draft',
        wesley: 'approved',
        brandon: 'both_submitted',
        aaliyah: 'awaiting_approval',
        henrik: 'not_started',
        corey: 'self_draft',
        mireille: 'approved',
        yuki: 'self_submitted',
        gloria: 'not_started',
        sam: 'self_draft',
        terrence: 'not_started',
        rosa: 'both_submitted',
        abebe: 'self_submitted',
        grant: 'self_submitted',
        elena: 'self_submitted',
      },
    },
    {
      name: '360 Review — Crew Leads 2026',
      description:
        'Peer input for the crew leads and superintendent, blended with the manager review and a self-assessment. Peer responses are confidential: the manager sees the content, the employee does not see who wrote it.',
      status: 'ACTIVE',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      launchedAt: '2026-10-20',
      templateName: '360 Review — Self, Manager & Peers',
      peer: true,
      selfDue: '2026-11-07',
      managerDue: '2026-11-25',
      subjects: ['rosa', 'abebe', 'grant', 'tyler'],
      states: { '*': 'self_submitted', rosa: 'both_submitted', abebe: 'both_submitted' },
    },
    {
      name: '90-Day Review — Autumn 2026 Intake',
      description: 'New-hire review at around 90 days for the people who started in August.',
      status: 'ACTIVE',
      periodStart: '2026-08-17',
      periodEnd: '2026-11-17',
      launchedAt: '2026-10-28',
      templateName: '90-Day New Hire Review',
      selfDue: '2026-11-07',
      managerDue: '2026-11-14',
      subjects: ['hana'],
      states: { '*': 'self_submitted' },
    },
    {
      name: '2027 Annual Performance Review',
      description:
        'Next year’s cycle, still being set up. Nothing has been sent to anyone and no reviewer can see it.',
      status: 'DRAFT',
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      byCohort: true,
      requireApproval: true,
      selfDue: '2027-01-22',
      managerDue: '2027-02-12',
      subjects: [],
      states: {},
    },
  ];

  let participantTotal = 0;
  let assignmentTotal = 0;
  /** Review cycle ids by name, so a compensation cycle can be linked to one. */
  const reviewCycleIds = new Map<string, string>();

  for (const spec of CYCLES) {
    const defaultTemplate = spec.templateName ?? 'Annual Performance Review — Field Crew';
    const defaultVersionId = templateVersionIds.get(defaultTemplate) as string;

    const cycle = await db.reviewCycle.create({
      data: {
        orgId,
        name: spec.name,
        description: spec.description,
        status: spec.status,
        templateVersionId: defaultVersionId,
        periodStart: date(spec.periodStart),
        periodEnd: date(spec.periodEnd),
        selfReviewEnabled: true,
        managerReviewEnabled: true,
        peerReviewEnabled: spec.peer ?? false,
        peerReviewTarget: spec.peer ? 3 : 0,
        peerVisibilityMode: 'CONFIDENTIAL',
        requireApproval: spec.requireApproval ?? false,
        approvalAuthority: 'MANAGER_OF_MANAGER',
        releaseMode: 'MANUAL',
        shareSelfWithManager: true,
        sharePeerWithEmployee: false,
        requireAcknowledgement: true,
        selfDueAt: date(spec.selfDue),
        managerDueAt: date(spec.managerDue),
        peerDueAt: spec.peer ? date(spec.managerDue) : null,
        launchedAt: spec.launchedAt ? date(spec.launchedAt) : null,
        closedAt: spec.closedAt ? date(spec.closedAt) : null,
        createdById: userIds.get('priya') ?? null,
        isDemoData: true,
      },
    });

    const launchDate = spec.launchedAt ? date(spec.launchedAt) : TODAY;

    for (const subjectKey of spec.subjects) {
      const person = personByKey.get(subjectKey);
      if (!person) continue;
      const plan: ParticipantPlan = spec.states[subjectKey] ?? spec.states['*'] ?? 'self_submitted';
      const versionId = spec.byCohort
        ? (templateVersionIds.get(templateFor(person)) as string)
        : defaultVersionId;
      const loaded = await form(versionId);

      const managerKey = managerKeyAt(subjectKey, launchDate);
      const managerId = managerKey ? (employeeIds.get(managerKey) as string) : null;
      const managerPerson = managerKey ? personByKey.get(managerKey) : null;

      const participant = await db.cycleParticipant.create({
        data: {
          cycleId: cycle.id,
          employeeId: employeeIds.get(subjectKey) as string,
          managerIdSnapshot: managerId,
          managerNameSnapshot: managerPerson
            ? `${managerPerson.firstName} ${managerPerson.lastName}`
            : null,
          departmentNameSnapshot: person.department,
          jobTitleNameSnapshot: person.jobTitle,
          snapshotTakenAt: launchDate,
          templateVersionId: versionId,
          status: 'NOT_STARTED',
        },
      });
      participantTotal += 1;

      const profile = PROFILES[subjectKey] ?? 'solid';
      const goals = (goalsByEmployee.get(employeeIds.get(subjectKey) as string) ?? []).slice(0, 3);

      // --- self assignment ---
      const selfAssignment = await db.reviewAssignment.create({
        data: {
          participantId: participant.id,
          reviewerEmployeeId: employeeIds.get(subjectKey) as string,
          kind: 'SELF',
          templateVersionId: versionId,
          status: 'NOT_STARTED',
          dueAt: date(spec.selfDue),
        },
      });
      assignmentTotal += 1;

      const managerAssignment = managerId
        ? await db.reviewAssignment.create({
            data: {
              participantId: participant.id,
              reviewerEmployeeId: managerId,
              kind: 'MANAGER',
              templateVersionId: versionId,
              status: 'NOT_STARTED',
              dueAt: date(spec.managerDue),
            },
          })
        : null;
      if (managerAssignment) assignmentTotal += 1;

      // --- peer assignments ---
      const peerAssignments: { id: string }[] = [];
      if (spec.peer) {
        const peerRng = new Rng(`peers-${cycle.id}-${subjectKey}`);
        const candidates = activeSubjects
          .filter((c) => c.key !== subjectKey && c.key !== managerKey && c.reviewCohort === person.reviewCohort)
          .map((c) => c.key);
        for (const peerKey of peerRng.pickMany(candidates, Math.min(3, candidates.length))) {
          const created = await db.reviewAssignment.create({
            data: {
              participantId: participant.id,
              reviewerEmployeeId: employeeIds.get(peerKey) as string,
              kind: 'PEER',
              templateVersionId: versionId,
              status: 'NOT_STARTED',
              dueAt: date(spec.managerDue),
            },
          });
          peerAssignments.push(created);
          assignmentTotal += 1;
        }
      }

      // --- drive the lifecycle to the planned state ---
      const wantSelfDraft = plan === 'self_draft';
      const wantSelfSubmitted = [
        'self_submitted',
        'manager_draft',
        'both_submitted',
        'awaiting_approval',
        'approved',
        'released',
        'acknowledged',
      ].includes(plan);
      const wantManagerDraft = plan === 'manager_draft';
      const wantManagerSubmitted = [
        'both_submitted',
        'awaiting_approval',
        'approved',
        'released',
        'acknowledged',
      ].includes(plan);

      if (wantSelfDraft || wantSelfSubmitted) {
        const { score, scoreJson } = await fillAssignment(db, {
          assignmentId: selfAssignment.id,
          kind: 'SELF',
          form: loaded,
          profile,
          goals,
          seed: `self-${cycle.id}-${subjectKey}`,
          options: { selfBias: 0.07, leaveSomeBlank: wantSelfDraft },
        });
        await db.reviewAssignment.update({
          where: { id: selfAssignment.id },
          data: wantSelfSubmitted
            ? {
                status: 'SUBMITTED',
                score,
                scoreJson,
                submittedAt: daysFrom(launchDate, 9),
                lastSavedAt: daysFrom(launchDate, 9),
                submissionCount: 1,
              }
            : { status: 'DRAFT', lastSavedAt: daysFrom(TODAY, -2) },
        });
      }

      if (managerAssignment && (wantManagerDraft || wantManagerSubmitted)) {
        const { score, scoreJson } = await fillAssignment(db, {
          assignmentId: managerAssignment.id,
          kind: 'MANAGER',
          form: loaded,
          profile,
          goals,
          seed: `mgr-${cycle.id}-${subjectKey}`,
          options: { useNotApplicable: true, leaveSomeBlank: wantManagerDraft },
        });
        await db.reviewAssignment.update({
          where: { id: managerAssignment.id },
          data: wantManagerSubmitted
            ? {
                status: 'SUBMITTED',
                score,
                scoreJson,
                submittedAt: daysFrom(launchDate, 22),
                lastSavedAt: daysFrom(launchDate, 22),
                submissionCount: 1,
              }
            : { status: 'DRAFT', lastSavedAt: daysFrom(TODAY, -1) },
        });
      }

      if (spec.peer && wantSelfSubmitted) {
        for (const [i, peer] of peerAssignments.entries()) {
          // One peer deliberately has not finished, so the progress view is honest.
          if (i === peerAssignments.length - 1 && plan !== 'both_submitted') continue;
          const { score, scoreJson } = await fillAssignment(db, {
            assignmentId: peer.id,
            kind: 'PEER',
            form: loaded,
            profile,
            goals: [],
            seed: `peer-${peer.id}`,
            options: { useNotApplicable: true },
          });
          await db.reviewAssignment.update({
            where: { id: peer.id },
            data: {
              status: 'SUBMITTED',
              score,
              scoreJson,
              submittedAt: daysFrom(launchDate, 14 + i),
              lastSavedAt: daysFrom(launchDate, 14 + i),
              submissionCount: 1,
            },
          });
        }
      }

      // --- participant status, approvals, release, acknowledgement ---
      let participantStatus: string = 'NOT_STARTED';
      if (plan === 'self_draft' || plan === 'manager_draft' || plan === 'self_submitted') {
        participantStatus = 'IN_PROGRESS';
      } else if (plan === 'both_submitted') {
        participantStatus = spec.requireApproval ? 'IN_PROGRESS' : 'APPROVED';
      } else if (plan === 'awaiting_approval') {
        participantStatus = 'AWAITING_APPROVAL';
      } else if (plan === 'approved') {
        participantStatus = 'APPROVED';
      } else if (plan === 'released') {
        participantStatus = 'RELEASED';
      } else if (plan === 'acknowledged') {
        participantStatus = spec.status === 'CLOSED' ? 'CLOSED' : 'ACKNOWLEDGED';
      }

      if (wantManagerSubmitted) await finalizeParticipantScore(db, participant.id);
      if (['awaiting_approval', 'approved', 'released', 'acknowledged'].includes(plan)) {
        await snapshotGoals(db, participant.id, goals);
      }

      // Approval record, pinned to a concrete approver at launch.
      if (spec.requireApproval && managerKey) {
        const approverKey = personByKey.get(managerKey)?.managerKey ?? 'marcus';
        const approverId = employeeIds.get(approverKey) as string;
        if (['awaiting_approval', 'approved', 'released', 'acknowledged'].includes(plan)) {
          await db.reviewApproval.create({
            data: {
              participantId: participant.id,
              approverEmployeeId: approverId,
              status: plan === 'awaiting_approval' ? 'PENDING' : 'APPROVED',
              note:
                plan === 'awaiting_approval'
                  ? null
                  : 'Read through, examples are specific and the rating matches what I have seen. Approved.',
              requestedAt: daysFrom(launchDate, 23),
              decidedAt: plan === 'awaiting_approval' ? null : daysFrom(launchDate, 26),
            },
          });
        }
      }

      const releaseData: Record<string, unknown> = { status: participantStatus };
      if (['released', 'acknowledged'].includes(plan) || spec.status === 'CLOSED') {
        releaseData.releasedAt = daysFrom(launchDate, 30);
        releaseData.releasedById = userIds.get('priya') ?? null;
      }
      if (plan === 'acknowledged') {
        releaseData.acknowledgedAt = daysFrom(launchDate, 33);
        releaseData.acknowledgementNote = new Rng(`ack-${participant.id}`).pick([
          'Read it. I agree with the main points and I am happy with the focus areas.',
          'Thanks — the examples were useful. I would add that the July staffing gap was a bigger factor than it reads here.',
          'Received. I would like to talk through the readiness rating at our next one-to-one.',
          'Acknowledged.',
          '',
        ]) || null;
      }
      await db.cycleParticipant.update({ where: { id: participant.id }, data: releaseData });
    }

    reviewCycleIds.set(spec.name, cycle.id);
    log(`cycle: ${spec.name} — ${spec.subjects.length} participants, status ${spec.status}`);
  }
  log(`review participants: ${participantTotal}, assignments: ${assignmentTotal}`);

  await seedFeedback();
  await seedMeetings();
  await seedSurveys();
  await seedDevelopmentPlans();
  await seedCalibration();
  await seedCompensation();
  await seedNotifications();
  await seedAudit();

  // ========================================================================
  // Continuous feedback
  // ========================================================================
  async function seedFeedback(): Promise<void> {
    const rng = new Rng('feedback');
    const RECOGNITION_BODIES: { value: string; body: string; from: string; about: string }[] = [
      {
        value: 'Safety First',
        from: 'grant',
        about: 'rosa',
        body: 'Stopped work on the Oakmont job when the scaffold tie looked wrong, even though it meant losing two hours. It was wrong. That is exactly the call I want crew leads making.',
      },
      {
        value: 'Craftsmanship',
        from: 'abebe',
        about: 'nina',
        body: 'The stair detail on the Thornton remodel is the best finish work that has gone out of this company. The client asked who did it.',
      },
      {
        value: 'Client Save',
        from: 'sofia',
        about: 'aaliyah',
        body: 'The Maple client was ready to walk. Aaliyah drove out the same evening, walked the whole house with them, and turned it around. We finished the job and got a referral out of it.',
      },
      {
        value: 'Crew Player',
        from: 'rosa',
        about: 'wesley',
        body: 'Came over to Framing Crew A for three days when we were short, having never worked with us, and just got on with it. Made a real difference to that week.',
      },
      {
        value: 'Problem Solver',
        from: 'brandon',
        about: 'tyler',
        body: 'Worked out how to get the beam in without pulling the window out. Saved a day and about four thousand dollars.',
      },
      {
        value: 'Teaching Moment',
        from: 'nina',
        about: 'dmitri',
        body: 'Spent a lunch break walking Hana through scribing to an uneven wall. Did not have to, and she can do it now.',
      },
      {
        value: 'Safety First',
        from: 'elena',
        about: 'sam',
        body: 'Caught the frayed sling on the loader before it was used. Pulled it out of service and ordered a replacement the same day.',
      },
      {
        value: 'Craftsmanship',
        from: 'grant',
        about: 'oleg',
        body: 'Framing on Riverbend was dead square and plumb throughout. Finish crew said it was the easiest house they have worked on this year.',
      },
    ];

    let count = 0;
    for (const [i, r] of RECOGNITION_BODIES.entries()) {
      await db.feedback.create({
        data: {
          orgId,
          authorEmployeeId: employeeIds.get(r.from) as string,
          aboutEmployeeId: employeeIds.get(r.about) as string,
          kind: 'RECOGNITION',
          body: r.body,
          visibility: 'ORGANIZATION',
          authorVisibility: 'NAMED',
          recognitionValueId: recognitionIds.get(r.value) ?? null,
          createdAt: daysFrom(TODAY, -(i * 9 + 3)),
          isDemoData: true,
        },
      });
      count += 1;
    }

    const CONSTRUCTIVE: { from: string; about: string; body: string; visibility: string }[] = [
      {
        from: 'rosa',
        about: 'casey',
        body: 'Three late starts in the last two weeks. I know the commute is long, but the whole crew waits. Let us talk about whether an earlier bus works, or whether you ride out with Oleg.',
        visibility: 'RECIPIENT_AND_MANAGER',
      },
      {
        from: 'sofia',
        about: 'henrik',
        body: 'The lookahead for Riverbend was three weeks out of date when the crew asked for it. The lookahead is only useful if it is current — update it every Friday before you leave.',
        visibility: 'RECIPIENT_AND_MANAGER',
      },
      {
        from: 'dale',
        about: 'corey',
        body: 'The last two takeoffs were low on labour by about fifteen percent, both on remodel work. Let us sit down with the job cost reports and recalibrate the remodel labour factors together.',
        visibility: 'RECIPIENT_AND_MANAGER',
      },
      {
        from: 'priya',
        about: 'brandon',
        body: 'Four change orders this quarter were written up more than a week after the work was built. Two of them we could not bill. This needs to be same-day.',
        visibility: 'RECIPIENT_AND_MANAGER',
      },
    ];
    for (const [i, c] of CONSTRUCTIVE.entries()) {
      await db.feedback.create({
        data: {
          orgId,
          authorEmployeeId: employeeIds.get(c.from) as string,
          aboutEmployeeId: employeeIds.get(c.about) as string,
          kind: 'CONSTRUCTIVE',
          body: c.body,
          visibility: c.visibility,
          authorVisibility: 'NAMED',
          createdAt: daysFrom(TODAY, -(i * 11 + 5)),
          isDemoData: true,
        },
      });
      count += 1;
    }

    // Private manager notes — visible to their author only.
    const NOTES: { from: string; about: string; body: string }[] = [
      {
        from: 'rosa',
        about: 'tyler',
        body: 'Note to self for the annual: Tyler is ready for a crew of their own. Raise with Grant before the next cycle so we can plan the backfill.',
      },
      {
        from: 'rosa',
        about: 'casey',
        body: 'Punctuality — 11 late starts year to date. Dates in my notebook. Improving since September.',
      },
      {
        from: 'sofia',
        about: 'brandon',
        body: 'Second conversation about change orders. If the next quarter is the same we should look at a formal plan.',
      },
      {
        from: 'grant',
        about: 'abebe',
        body: 'Abebe would take the superintendent role if it came up. Worth planning for.',
      },
    ];
    for (const [i, n] of NOTES.entries()) {
      await db.feedback.create({
        data: {
          orgId,
          authorEmployeeId: employeeIds.get(n.from) as string,
          aboutEmployeeId: employeeIds.get(n.about) as string,
          kind: 'PRIVATE_NOTE',
          body: n.body,
          visibility: 'PRIVATE_NOTE_SELF',
          authorVisibility: 'NAMED',
          createdAt: daysFrom(TODAY, -(i * 13 + 8)),
          isDemoData: true,
        },
      });
      count += 1;
    }

    // One confidential item (author recorded, shown to HR only) and one
    // anonymous item (no author stored at all), so the difference is visible.
    await db.feedback.create({
      data: {
        orgId,
        authorEmployeeId: employeeIds.get('dmitri') as string,
        aboutEmployeeId: employeeIds.get('grant') as string,
        kind: 'CONSTRUCTIVE',
        body: 'The schedule pressure on the Thornton job led to people working through breaks for most of a week. It was not said out loud but it was clearly expected.',
        visibility: 'HR_ONLY',
        authorVisibility: 'CONFIDENTIAL',
        createdAt: daysFrom(TODAY, -21),
        isDemoData: true,
      },
    });
    await db.feedback.create({
      data: {
        orgId,
        authorEmployeeId: null,
        aboutEmployeeId: employeeIds.get('dale') as string,
        kind: 'CONSTRUCTIVE',
        body: 'Quotes are being promised to clients on timelines the field cannot hit. It puts the crews in a bad position and nobody wants to be the one to say it.',
        visibility: 'HR_ONLY',
        authorVisibility: 'ANONYMOUS',
        createdAt: daysFrom(TODAY, -16),
        isDemoData: true,
      },
    });
    count += 2;

    // Open feedback requests, which land in the responder's task inbox.
    const REQUESTS: { requester: string; responder: string; about: string; message: string; days: number }[] = [
      {
        requester: 'rosa',
        responder: 'brandon',
        about: 'tyler',
        message:
          'Tyler ran the framing on Riverbend while you were the PM. Anything useful for the annual review, particularly on coordination with the trades?',
        days: 9,
      },
      {
        requester: 'priya',
        responder: 'abebe',
        about: 'jamal',
        message:
          'You were Jamal’s crew lead until July. Would you add your view of the first half of the year? Rosa only has the second half.',
        days: 6,
      },
      {
        requester: 'sofia',
        responder: 'elena',
        about: 'aaliyah',
        message: 'Aaliyah coordinated with your field team all year. How did that work from your side?',
        days: 4,
      },
      {
        requester: 'tyler',
        responder: 'rosa',
        about: 'tyler',
        message: 'Could I get some feedback on how I handled the Riverbend sequencing before I write my self-assessment?',
        days: 2,
      },
    ];
    for (const r of REQUESTS) {
      await db.feedbackRequest.create({
        data: {
          orgId,
          requesterEmployeeId: employeeIds.get(r.requester) as string,
          responderEmployeeId: employeeIds.get(r.responder) as string,
          aboutEmployeeId: employeeIds.get(r.about) as string,
          message: r.message,
          dueAt: daysFrom(TODAY, 7),
          status: 'PENDING',
          responseVisibility: 'RECIPIENT_AND_MANAGER',
          responseAuthorVisibility: 'NAMED',
          createdAt: daysFrom(TODAY, -r.days),
          isDemoData: true,
        },
      });
    }

    // General peer feedback, so the feed is not only recognition.
    const GENERAL_BODIES = [
      'Worked with you on the Hillcrest punch list — thanks for staying until it was actually finished rather than leaving the last few items.',
      'The material list you put together for the deck job was spot on. Nothing missing and nothing left over.',
      'Appreciated you taking the call from the client on Saturday. You did not have to.',
      'Good catch on the joist hanger spec. I had read it as the other size.',
    ];
    const peers = activeSubjects.map((p) => p.key);
    for (let i = 0; i < 10; i += 1) {
      const [from, about] = rng.pickMany(peers, 2);
      if (!from || !about) continue;
      await db.feedback.create({
        data: {
          orgId,
          authorEmployeeId: employeeIds.get(from) as string,
          aboutEmployeeId: employeeIds.get(about) as string,
          kind: 'GENERAL',
          body: rng.pick(GENERAL_BODIES),
          visibility: 'RECIPIENT_AND_MANAGER',
          authorVisibility: 'NAMED',
          createdAt: daysFrom(TODAY, -rng.int(2, 120)),
          isDemoData: true,
        },
      });
      count += 1;
    }

    log(`feedback: ${count} items, ${REQUESTS.length} open requests`);
  }

  // ========================================================================
  // One-on-one meetings
  // ========================================================================
  async function seedMeetings(): Promise<void> {
    const rng = new Rng('meetings');
    const PAIRS: [string, string][] = [
      ['rosa', 'tyler'],
      ['rosa', 'jamal'],
      ['rosa', 'casey'],
      ['abebe', 'nina'],
      ['abebe', 'hana'],
      ['grant', 'rosa'],
      ['grant', 'abebe'],
      ['sofia', 'brandon'],
      ['sofia', 'aaliyah'],
      ['sofia', 'henrik'],
      ['dale', 'corey'],
      ['dale', 'mireille'],
      ['priya', 'yuki'],
      ['elena', 'sam'],
      ['marcus', 'elena'],
      ['marcus', 'sofia'],
    ];

    const AGENDA_ITEMS = [
      'Riverbend schedule — trim start date',
      'Material deliveries running late',
      'Apprentice hours sign-off',
      'Punch list on Hillcrest',
      'Tool replacement request',
      'Goal check-in',
      'Holiday coverage over Thanksgiving',
      'Safety brief attendance',
      'Change order on the Maple job',
      'Training course request',
    ];
    const SHARED_NOTES = [
      'Agreed the trim start moves to the 18th. Brandon to confirm with the cabinet supplier.',
      'Walked through the goal progress. Material waste is tracking better than expected.',
      'Talked about the late starts. Agreed to try riding out with Oleg for a month and review.',
      'Covered the punch list. Six items left, all minor, should be clear by Friday.',
      'Discussed whether to put in for the 30-hour safety course. Yes, going ahead.',
    ];
    const PRIVATE_NOTES = [
      'Seems stretched. Keep an eye on this over the next month.',
      'Asked about progression again. I think the answer is yes within a year but I did not commit.',
      'Third time we have discussed the same thing. Starting a written record.',
    ];
    const ACTIONS = [
      ['Confirm trim start date with the cabinet supplier', 7],
      ['Send apprentice hours to Priya for sign-off', 5],
      ['Order replacement impact driver', 10],
      ['Walk the Hillcrest punch list with the client', 3],
      ['Book the 30-hour safety course', 14],
      ['Write up the Maple change order', 1],
      ['Update the three-week lookahead', 2],
      ['Follow up on the late material delivery', 4],
    ] as const;

    let seriesCount = 0;
    let meetingCount = 0;
    let actionCount = 0;

    for (const [managerKey, reportKey] of PAIRS) {
      const managerId = employeeIds.get(managerKey) as string;
      const reportId = employeeIds.get(reportKey) as string;
      const cadence = rng.pick(['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const);
      const stepDays = cadence === 'WEEKLY' ? 7 : cadence === 'BIWEEKLY' ? 14 : 30;

      const series = await db.meetingSeries.create({
        data: {
          orgId,
          title: `${personByKey.get(managerKey)?.firstName} & ${personByKey.get(reportKey)?.firstName} 1:1`,
          cadence,
          personAId: managerId,
          personBId: reportId,
          active: true,
          nextDueAt: daysFrom(TODAY, rng.int(1, stepDays)),
          isDemoData: true,
        },
      });
      seriesCount += 1;

      // Three past meetings and one upcoming.
      for (let i = 3; i >= 0; i -= 1) {
        const isPast = i > 0;
        const scheduledAt = isPast
          ? daysFrom(TODAY, -i * stepDays - rng.int(0, 2))
          : daysFrom(TODAY, rng.int(1, stepDays));

        const meeting = await db.meeting.create({
          data: {
            orgId,
            seriesId: series.id,
            title: series.title,
            scheduledAt,
            durationMinutes: rng.pick([20, 30, 45]),
            location: rng.pick(['Site trailer', 'Main office', 'Phone', 'Truck on the way to site']),
            status: isPast ? 'COMPLETED' : 'SCHEDULED',
            completedAt: isPast ? scheduledAt : null,
            createdById: userIds.get(managerKey) ?? null,
            isDemoData: true,
            participants: {
              create: [
                { employeeId: managerId, role: 'ORGANIZER', attended: isPast ? true : null },
                { employeeId: reportId, role: 'ATTENDEE', attended: isPast ? true : null },
              ],
            },
          },
        });
        meetingCount += 1;

        const itemCount = rng.int(2, 4);
        for (const [ai, title] of rng.pickMany(AGENDA_ITEMS, itemCount).entries()) {
          await db.agendaItem.create({
            data: {
              meetingId: meeting.id,
              title,
              notes: isPast && rng.chance(0.5) ? rng.pick(SHARED_NOTES) : null,
              sortOrder: ai,
              status: isPast ? (rng.chance(0.8) ? 'DISCUSSED' : 'CARRIED_FORWARD') : 'OPEN',
              createdByEmployeeId: rng.chance(0.6) ? managerId : reportId,
            },
          });
        }

        if (isPast) {
          await db.meetingNote.create({
            data: {
              meetingId: meeting.id,
              authorEmployeeId: managerId,
              body: rng.pick(SHARED_NOTES),
              visibility: 'SHARED',
            },
          });
          if (rng.chance(0.4)) {
            await db.meetingNote.create({
              data: {
                meetingId: meeting.id,
                authorEmployeeId: managerId,
                body: rng.pick(PRIVATE_NOTES),
                visibility: 'PRIVATE',
              },
            });
          }

          const [actionTitle, dueInDays] = rng.pick(ACTIONS);
          const overdue = rng.chance(0.3);
          const completed = !overdue && rng.chance(0.55);
          await db.actionItem.create({
            data: {
              orgId,
              title: actionTitle,
              ownerEmployeeId: rng.chance(0.5) ? managerId : reportId,
              assignedByEmployeeId: managerId,
              meetingId: meeting.id,
              dueDate: overdue ? daysFrom(TODAY, -rng.int(2, 20)) : daysFrom(scheduledAt, dueInDays),
              status: completed ? 'COMPLETED' : rng.chance(0.4) ? 'IN_PROGRESS' : 'OPEN',
              completedAt: completed ? daysFrom(scheduledAt, dueInDays - 1) : null,
              visibility: 'PARTICIPANTS',
              isDemoData: true,
            },
          });
          actionCount += 1;
        }
      }
    }
    log(
      `meetings: ${seriesCount} recurring series, ${meetingCount} meetings, ${actionCount} action items`,
    );
  }

  // ========================================================================
  // Surveys
  // ========================================================================
  async function seedSurveys(): Promise<void> {
    const agreementScaleId = scaleIds.get('Agreement scale (1-5)') as string;

    interface SurveyQ {
      type: 'RATING' | 'TEXT' | 'NPS' | 'MULTIPLE_CHOICE';
      prompt: string;
      factor?: string;
      required?: boolean;
      choices?: string[];
    }

    const ENGAGEMENT_QUESTIONS: SurveyQ[] = [
      { type: 'RATING', prompt: 'I can raise a safety concern on site without it being a problem.', factor: 'Safety', required: true },
      { type: 'RATING', prompt: 'We are given the time to do the job safely, not just quickly.', factor: 'Safety', required: true },
      { type: 'RATING', prompt: 'My crew lead or manager gives me clear direction.', factor: 'Leadership', required: true },
      { type: 'RATING', prompt: 'I trust the decisions company leadership makes.', factor: 'Leadership', required: true },
      { type: 'RATING', prompt: 'Good work gets noticed here.', factor: 'Recognition', required: true },
      { type: 'RATING', prompt: 'I know what I would need to do to move up.', factor: 'Growth', required: true },
      { type: 'RATING', prompt: 'I get the training I need for the work I am given.', factor: 'Growth', required: true },
      { type: 'RATING', prompt: 'I have the tools and materials I need to do my job well.', factor: 'Tools & Resources', required: true },
      { type: 'RATING', prompt: 'The office and the field communicate well with each other.', factor: 'Communication', required: true },
      { type: 'RATING', prompt: 'I find out about schedule changes early enough to plan.', factor: 'Communication', required: true },
      { type: 'RATING', prompt: 'My workload over the last few months has been sustainable.', factor: 'Workload & Schedule', required: true },
      { type: 'NPS', prompt: 'How likely are you to recommend working here to someone in the trade?', required: true },
      { type: 'TEXT', prompt: 'What is the one thing that would most improve working here?' },
      { type: 'TEXT', prompt: 'What should we be careful not to change?' },
    ];

    const VERBATIM_IMPROVE = [
      'Get the material deliveries right. We lose half-days waiting and it is demoralising.',
      'More notice on schedule changes. Finding out the morning of does not work when you have childcare.',
      'Pay review for the apprentices. Two of them are doing journeyman work.',
      'Better plan sets. Half the problems on site come from conflicts between sheets nobody resolved.',
      'A second truck for the remodel crew so we are not shuttling tools.',
      'The office should come out to site more. Some of the schedules are written by people who have not seen the job.',
      'Honestly, not much. It is the best outfit I have worked for.',
      'Stop promising clients dates the field has not agreed to.',
      'Tablets for the daily logs instead of paper in the truck at the end of the day.',
      'More structured training. Right now you learn from whoever you happen to be working with.',
      'Consistent start times. Some crews start at 6:30 and some at 7:00 and it causes friction.',
      'The porta-john situation on the Thornton job was not acceptable for that long.',
    ];
    const VERBATIM_KEEP = [
      'The crews. People actually help each other here.',
      'The quality standard. We do not get told to rush something that is not right.',
      'Being able to say no to unsafe work and having it backed up.',
      'The one-on-ones. I know where I stand.',
      'Friday finishes at 2:00 in the winter.',
      'The way apprentices get real work instead of just sweeping.',
      'Dana and Marcus being on site regularly.',
    ];

    // --- Survey 1: closed anonymous engagement survey ---
    const engagement = await db.survey.create({
      data: {
        orgId,
        title: 'Spring 2026 Engagement Survey',
        description:
          'Our twice-yearly engagement survey. Answers are anonymous: we can see that you responded, but not what you said.',
        introText:
          'This survey is anonymous. Your answers are stored with no link to your name, and results are only shown for groups of five or more people. It takes about six minutes.',
        mode: 'ANONYMOUS',
        status: 'CLOSED',
        opensAt: date('2026-04-06'),
        closesAt: date('2026-04-24'),
        launchedAt: date('2026-04-06'),
        closedAtActual: date('2026-04-24'),
        minResponsesForResults: 5,
        collectDepartment: true,
        collectTenureBand: true,
        createdById: userIds.get('priya') ?? null,
        isDemoData: true,
        audience: { create: [{ ruleType: 'ALL' }] },
      },
    });

    const engagementQIds: { id: string; type: string; factor: string | null }[] = [];
    for (const [i, q] of ENGAGEMENT_QUESTIONS.entries()) {
      const created = await db.surveyQuestion.create({
        data: {
          surveyId: engagement.id,
          sortOrder: i,
          type: q.type,
          prompt: q.prompt,
          required: q.required ?? false,
          factor: q.factor ?? null,
          ratingScaleId: q.type === 'RATING' ? agreementScaleId : null,
          choicesJson: q.choices ? JSON.stringify(q.choices) : null,
        },
      });
      engagementQIds.push({ id: created.id, type: q.type, factor: q.factor ?? null });
    }

    const invitees = PEOPLE.filter((p) => p.employmentStatus !== 'terminated');
    const surveyRng = new Rng('engagement-spring-2026');

    // Participation: 22 of 26 responded. Recorded on the invitation only.
    const responders = new Set(surveyRng.pickMany(invitees.map((p) => p.key), 22));
    for (const p of invitees) {
      const responded = responders.has(p.key);
      await db.surveyInvitation.create({
        data: {
          surveyId: engagement.id,
          employeeId: employeeIds.get(p.key) as string,
          status: responded ? 'COMPLETED' : 'NOTIFIED',
          notifiedAt: date('2026-04-06'),
          completedAt: responded ? daysFrom(date('2026-04-06'), surveyRng.int(0, 16)) : null,
          departmentNameSnapshot: p.department,
          tenureBandSnapshot: tenureBand(date(p.hireDate), date('2026-04-06')),
          locationSnapshot: p.workLocation,
        },
      });
    }

    // Answers: no respondent identity is written, by design. The coarse segment
    // labels are drawn from the responding population so the breakdowns are
    // consistent, but no row links back to a person.
    const respondingPeople = invitees.filter((p) => responders.has(p.key));
    let answerCount = 0;
    for (const [idx, p] of respondingPeople.entries()) {
      // Department sentiment varies, which is what makes the report interesting.
      const departmentMood: Record<string, number> = {
        Leadership: 0.3,
        'Field Operations': -0.1,
        Framing: -0.2,
        'Finish & Remodel': 0.05,
        'Project Management': -0.35,
        'Sales & Estimating': 0.1,
        'Office Administration': 0.15,
      };
      const mood = departmentMood[p.department] ?? 0;

      const response = await db.surveyResponse.create({
        data: {
          surveyId: engagement.id,
          respondentEmployeeId: null, // anonymous: never recorded
          departmentNameSnapshot: p.department,
          tenureBandSnapshot: tenureBand(date(p.hireDate), date('2026-04-06')),
          locationSnapshot: p.workLocation,
          submittedAt: daysFrom(date('2026-04-06'), surveyRng.int(0, 16)),
        },
      });

      for (const q of engagementQIds) {
        if (q.type === 'RATING') {
          const factorShift =
            q.factor === 'Tools & Resources' ? -0.5 : q.factor === 'Communication' ? -0.4 : q.factor === 'Safety' ? 0.45 : 0;
          const base = 3.6 + mood + factorShift + (surveyRng.next() - 0.5) * 1.6;
          await db.surveyAnswer.create({
            data: {
              responseId: response.id,
              questionId: q.id,
              numericValue: Math.min(5, Math.max(1, Math.round(base))),
            },
          });
          answerCount += 1;
        } else if (q.type === 'NPS') {
          const base = 7.2 + mood * 3 + (surveyRng.next() - 0.5) * 4;
          await db.surveyAnswer.create({
            data: {
              responseId: response.id,
              questionId: q.id,
              numericValue: Math.min(10, Math.max(0, Math.round(base))),
            },
          });
          answerCount += 1;
        } else if (q.type === 'TEXT' && surveyRng.chance(0.6)) {
          const bank = q.id === engagementQIds[12]?.id ? VERBATIM_IMPROVE : VERBATIM_KEEP;
          await db.surveyAnswer.create({
            data: {
              responseId: response.id,
              questionId: q.id,
              textValue: bank[(idx + bank.length) % bank.length] as string,
            },
          });
          answerCount += 1;
        }
      }
    }

    // --- Survey 2: open anonymous pulse with too few responses ---
    const pulse = await db.survey.create({
      data: {
        orgId,
        title: 'Tools & Equipment Pulse',
        description: 'Three questions on tools and equipment. Anonymous.',
        introText:
          'Three questions, anonymous. Results will not be shown to anyone until at least five people have answered.',
        mode: 'ANONYMOUS',
        status: 'OPEN',
        opensAt: daysFrom(TODAY, -5),
        closesAt: daysFrom(TODAY, 9),
        launchedAt: daysFrom(TODAY, -5),
        minResponsesForResults: 5,
        createdById: userIds.get('priya') ?? null,
        isDemoData: true,
        audience: { create: [{ ruleType: 'DEPARTMENT', value: 'Field Operations' }, { ruleType: 'DEPARTMENT', value: 'Framing' }, { ruleType: 'DEPARTMENT', value: 'Finish & Remodel' }] },
      },
    });
    const pulseQs = await Promise.all(
      [
        { prompt: 'I have the tools I need to do my job well.', type: 'RATING' as const },
        { prompt: 'Equipment is maintained well enough to rely on.', type: 'RATING' as const },
        { prompt: 'What one tool or piece of equipment would make the biggest difference?', type: 'TEXT' as const },
      ].map((q, i) =>
        db.surveyQuestion.create({
          data: {
            surveyId: pulse.id,
            sortOrder: i,
            type: q.type,
            prompt: q.prompt,
            required: q.type === 'RATING',
            ratingScaleId: q.type === 'RATING' ? agreementScaleId : null,
          },
        }),
      ),
    );

    const fieldPeople = invitees.filter((p) =>
      ['Field Operations', 'Framing', 'Finish & Remodel'].includes(p.department),
    );
    const pulseRng = new Rng('tools-pulse');
    const pulseResponders = new Set(pulseRng.pickMany(fieldPeople.map((p) => p.key), 3));
    for (const p of fieldPeople) {
      const responded = pulseResponders.has(p.key);
      await db.surveyInvitation.create({
        data: {
          surveyId: pulse.id,
          employeeId: employeeIds.get(p.key) as string,
          status: responded ? 'COMPLETED' : 'NOTIFIED',
          notifiedAt: daysFrom(TODAY, -5),
          completedAt: responded ? daysFrom(TODAY, -pulseRng.int(1, 4)) : null,
          departmentNameSnapshot: p.department,
          tenureBandSnapshot: tenureBand(date(p.hireDate), TODAY),
          locationSnapshot: p.workLocation,
        },
      });
    }
    for (const p of fieldPeople.filter((x) => pulseResponders.has(x.key))) {
      const response = await db.surveyResponse.create({
        data: {
          surveyId: pulse.id,
          respondentEmployeeId: null,
          departmentNameSnapshot: p.department,
          tenureBandSnapshot: tenureBand(date(p.hireDate), TODAY),
          locationSnapshot: p.workLocation,
          submittedAt: daysFrom(TODAY, -pulseRng.int(1, 4)),
        },
      });
      await db.surveyAnswer.createMany({
        data: [
          { responseId: response.id, questionId: pulseQs[0]!.id, numericValue: pulseRng.int(2, 5) },
          { responseId: response.id, questionId: pulseQs[1]!.id, numericValue: pulseRng.int(2, 4) },
          {
            responseId: response.id,
            questionId: pulseQs[2]!.id,
            textValue: pulseRng.pick([
              'A second track saw so we are not waiting.',
              'Cordless nailers. The hoses are a trip hazard in finished spaces.',
              'A decent site vacuum that actually holds suction.',
            ]),
          },
        ],
      });
      answerCount += 3;
    }

    // --- Survey 3: named survey, closed ---
    const named = await db.survey.create({
      data: {
        orgId,
        title: 'Safety Stand-Down Follow-Up',
        description:
          'Follow-up after the September stand-down. This survey is named: your answers are attributed to you so we can act on specifics.',
        introText:
          'This survey is NOT anonymous — your name is recorded with your answers, because we want to be able to follow up on specific sites and specific equipment.',
        mode: 'NAMED',
        status: 'CLOSED',
        opensAt: date('2026-09-28'),
        closesAt: date('2026-10-09'),
        launchedAt: date('2026-09-28'),
        closedAtActual: date('2026-10-09'),
        minResponsesForResults: 1,
        createdById: userIds.get('priya') ?? null,
        isDemoData: true,
        audience: { create: [{ ruleType: 'ALL' }] },
      },
    });
    const namedQs = await Promise.all(
      [
        { prompt: 'The stand-down covered the issues that actually matter on my site.', type: 'RATING' as const },
        { prompt: 'Is there a specific hazard on your current site that is still unresolved?', type: 'TEXT' as const },
      ].map((q, i) =>
        db.surveyQuestion.create({
          data: {
            surveyId: named.id,
            sortOrder: i,
            type: q.type,
            prompt: q.prompt,
            required: q.type === 'RATING',
            ratingScaleId: q.type === 'RATING' ? agreementScaleId : null,
          },
        }),
      ),
    );
    const namedRng = new Rng('safety-named');
    const namedResponders = namedRng.pickMany(invitees.map((p) => p.key), 18);
    for (const p of invitees) {
      const responded = namedResponders.includes(p.key);
      await db.surveyInvitation.create({
        data: {
          surveyId: named.id,
          employeeId: employeeIds.get(p.key) as string,
          status: responded ? 'COMPLETED' : 'NOTIFIED',
          notifiedAt: date('2026-09-28'),
          completedAt: responded ? daysFrom(date('2026-09-28'), namedRng.int(0, 10)) : null,
          departmentNameSnapshot: p.department,
          tenureBandSnapshot: tenureBand(date(p.hireDate), date('2026-09-28')),
          locationSnapshot: p.workLocation,
        },
      });
      if (!responded) continue;
      const response = await db.surveyResponse.create({
        data: {
          surveyId: named.id,
          // Named survey: the respondent IS recorded.
          respondentEmployeeId: employeeIds.get(p.key) as string,
          departmentNameSnapshot: p.department,
          tenureBandSnapshot: tenureBand(date(p.hireDate), date('2026-09-28')),
          locationSnapshot: p.workLocation,
          submittedAt: daysFrom(date('2026-09-28'), namedRng.int(0, 10)),
        },
      });
      await db.surveyAnswer.create({
        data: { responseId: response.id, questionId: namedQs[0]!.id, numericValue: namedRng.int(3, 5) },
      });
      if (namedRng.chance(0.4)) {
        await db.surveyAnswer.create({
          data: {
            responseId: response.id,
            questionId: namedQs[1]!.id,
            textValue: namedRng.pick([
              'The temporary stair on Thornton still has no handrail on the open side.',
              'Extension cords across the drive on Riverbend. Needs a ramp or an overhead run.',
              'Nothing outstanding on my site.',
              'Dust extraction on the tile saw is not working properly.',
            ]),
          },
        });
      }
    }

    // Follow-up actions created from survey results — the loop that closes it.
    await db.actionItem.createMany({
      data: [
        {
          orgId,
          title: 'Fix the material delivery process — survey follow-up',
          description:
            'Tools & Resources and Communication scored lowest in the spring survey, and late deliveries were the most common written comment. Elena to work with the yard and the two biggest suppliers on a two-day lead time.',
          ownerEmployeeId: employeeIds.get('elena') as string,
          assignedByEmployeeId: employeeIds.get('marcus') as string,
          surveyId: engagement.id,
          dueDate: daysFrom(TODAY, -10),
          status: 'IN_PROGRESS',
          visibility: 'PARTICIPANTS',
          isDemoData: true,
        },
        {
          orgId,
          title: 'Weekly schedule published by Friday noon — survey follow-up',
          description:
            'Communication was the second lowest factor, and "finding out the morning of" came up repeatedly. Sofia to publish the following week by Friday noon.',
          ownerEmployeeId: employeeIds.get('sofia') as string,
          assignedByEmployeeId: employeeIds.get('marcus') as string,
          surveyId: engagement.id,
          dueDate: daysFrom(TODAY, 21),
          status: 'OPEN',
          visibility: 'PARTICIPANTS',
          isDemoData: true,
        },
        {
          orgId,
          title: 'Install handrail on the Thornton temporary stair',
          ownerEmployeeId: employeeIds.get('abebe') as string,
          assignedByEmployeeId: employeeIds.get('priya') as string,
          surveyId: named.id,
          dueDate: daysFrom(TODAY, -22),
          status: 'COMPLETED',
          completedAt: daysFrom(TODAY, -21),
          visibility: 'PARTICIPANTS',
          isDemoData: true,
        },
      ],
    });

    log(
      `surveys: 3 (closed anonymous with 22 responses, open anonymous with 3 — below threshold, closed named with 18), ${answerCount} answers`,
    );
  }

  // ========================================================================
  // Development and improvement plans
  // ========================================================================
  async function seedDevelopmentPlans(): Promise<void> {
    const plans: {
      employeeKey: string;
      title: string;
      description: string;
      planType: 'DEVELOPMENT' | 'PERFORMANCE_IMPROVEMENT';
      status: 'DRAFT' | 'ACTIVE' | 'COMPLETED';
      hrRestricted?: boolean;
      startDate: string;
      targetDate: string;
      createdByKey: string;
      actions: { title: string; competency?: string; itemType?: 'ACTION' | 'MILESTONE'; ownerKey?: string; dueIn: number; done?: boolean }[];
      checkIns?: { authorKey: string; body: string; daysAgo: number }[];
    }[] = [
      {
        employeeKey: 'tyler',
        title: 'Path to Crew Lead',
        description:
          'Tyler is ready for a crew within a year. This plan covers the gaps: running a job end to end, handling the client directly, and the paperwork that goes with it.',
        planType: 'DEVELOPMENT',
        status: 'ACTIVE',
        startDate: '2026-04-01',
        targetDate: '2027-03-31',
        createdByKey: 'rosa',
        actions: [
          { title: 'Run two small jobs start to finish with Rosa on call', competency: 'Crew Leadership', itemType: 'MILESTONE', dueIn: -60, done: true },
          { title: 'Lead the daily safety brief for a full month', competency: 'Jobsite Safety', dueIn: -20, done: true },
          { title: 'Take two client walkthroughs with Brandon present', competency: 'Client Communication', dueIn: 25 },
          { title: 'Complete the 30-hour safety course', competency: 'Jobsite Safety', dueIn: 60 },
          { title: 'Shadow Rosa through a full crew schedule build', competency: 'Schedule & Productivity', dueIn: 90 },
        ],
        checkIns: [
          { authorKey: 'rosa', body: 'Both small jobs went well. The second one had a surprise with the slab and Tyler handled it without calling me, which is the point.', daysAgo: 45 },
          { authorKey: 'tyler', body: 'Safety brief is getting easier. The first week was uncomfortable, now it is routine.', daysAgo: 18 },
        ],
      },
      {
        employeeKey: 'hana',
        title: 'Apprentice development — first year',
        description: 'Structured first-year plan for the autumn intake, built around the Field Crew competency library.',
        planType: 'DEVELOPMENT',
        status: 'ACTIVE',
        startDate: '2026-08-17',
        targetDate: '2027-08-17',
        createdByKey: 'abebe',
        actions: [
          { title: 'OSHA 10 certification', competency: 'Jobsite Safety', dueIn: -5, done: true },
          { title: 'Reach 500 logged apprenticeship hours', itemType: 'MILESTONE', dueIn: 30 },
          { title: 'Able to read a plan set and find dimensions unaided', competency: 'Blueprint & Plan Reading', dueIn: 75 },
          { title: 'Scribe and fit trim to an uneven wall unaided', competency: 'Craftsmanship & Quality', dueIn: 120 },
          { title: 'Tool inventory and care sign-off', competency: 'Tool & Equipment Care', dueIn: 150 },
        ],
        checkIns: [
          { authorKey: 'abebe', body: 'Good first two months. Asks before guessing, which is exactly right at this stage.', daysAgo: 12 },
        ],
      },
      {
        employeeKey: 'abebe',
        title: 'Preparing for Field Superintendent',
        description: 'Succession plan. Abebe is the internal candidate if the superintendent role opens up.',
        planType: 'DEVELOPMENT',
        status: 'ACTIVE',
        startDate: '2026-02-01',
        targetDate: '2027-06-30',
        createdByKey: 'grant',
        actions: [
          { title: 'Cover for Grant for two weeks across all crews', competency: 'Crew Leadership', itemType: 'MILESTONE', dueIn: -90, done: true },
          { title: 'Build the crew schedule for a full month', competency: 'Schedule & Productivity', dueIn: -30, done: true },
          { title: 'Run a sub coordination meeting for a whole-home remodel', competency: 'Vendor & Subcontractor Coordination', dueIn: 40 },
          { title: 'Complete the leadership competency assessment with Marcus', dueIn: 70 },
        ],
      },
      {
        employeeKey: 'corey',
        title: 'Estimating accuracy improvement plan',
        description:
          'Estimate variance on remodel work has been consistently above the agreed tolerance across three quarters. This plan sets out what has to change, by when, and what support is provided. It is reviewed every two weeks.',
        planType: 'PERFORMANCE_IMPROVEMENT',
        status: 'ACTIVE',
        hrRestricted: true,
        startDate: '2026-10-05',
        targetDate: '2027-01-05',
        createdByKey: 'dale',
        actions: [
          { title: 'Review the last six remodel jobs against actual cost with Dale', dueIn: -14, done: true },
          { title: 'Rebuild the remodel labour factors from actual job cost data', competency: 'Estimating Accuracy', dueIn: 7 },
          { title: 'Every remodel estimate over $75k reviewed by Dale before it goes out', dueIn: 30 },
          { title: 'Variance on new estimates within 8% for the quarter', itemType: 'MILESTONE', dueIn: 60 },
          { title: 'Final review with Dale and Priya', itemType: 'MILESTONE', dueIn: 62 },
        ],
        checkIns: [
          { authorKey: 'dale', body: 'First two-week review. The job cost walkthrough was useful and Corey identified the labour factor problem independently. Engagement with the plan is good.', daysAgo: 16 },
          { authorKey: 'dale', body: 'Second review. Labour factors are drafted. One estimate went out without review — reminded Corey that step is not optional.', daysAgo: 3 },
        ],
      },
      {
        employeeKey: 'yuki',
        title: 'Taking on job cost reporting',
        description: 'Development into the job costing side of the role, to reduce the single point of failure at month end.',
        planType: 'DEVELOPMENT',
        status: 'ACTIVE',
        startDate: '2026-07-01',
        targetDate: '2027-01-31',
        createdByKey: 'priya',
        actions: [
          { title: 'Learn the month-end close procedure from Gloria', competency: 'Documentation & Reporting', dueIn: -40, done: true },
          { title: 'Run one month-end close with Gloria checking', itemType: 'MILESTONE', dueIn: 10 },
          { title: 'Run a month-end close unaided', itemType: 'MILESTONE', dueIn: 55 },
        ],
      },
      {
        employeeKey: 'casey',
        title: 'Reliability and punctuality',
        description:
          'Eleven late starts year to date. This plan records what was agreed, what support is in place, and how it will be reviewed. Improvement since September has been real.',
        planType: 'PERFORMANCE_IMPROVEMENT',
        status: 'ACTIVE',
        hrRestricted: true,
        startDate: '2026-09-14',
        targetDate: '2026-12-14',
        createdByKey: 'rosa',
        actions: [
          { title: 'Ride out with Oleg for one month, reviewed after', dueIn: -14, done: true },
          { title: 'No late starts for four consecutive weeks', itemType: 'MILESTONE', dueIn: 10 },
          { title: 'Review with Rosa and Priya', itemType: 'MILESTONE', dueIn: 40 },
        ],
        checkIns: [
          { authorKey: 'rosa', body: 'Four weeks since the plan started, one late start and it was a genuine traffic closure. Riding out with Oleg is working.', daysAgo: 22 },
        ],
      },
    ];

    let actionCount = 0;
    for (const p of plans) {
      const plan = await db.developmentPlan.create({
        data: {
          orgId,
          employeeId: employeeIds.get(p.employeeKey) as string,
          title: p.title,
          description: p.description,
          planType: p.planType,
          status: p.status,
          startDate: date(p.startDate),
          targetDate: date(p.targetDate),
          hrRestricted: p.hrRestricted ?? false,
          createdById: userIds.get(p.createdByKey) ?? null,
          isDemoData: true,
          actions: {
            create: p.actions.map((a, i) => ({
              title: a.title,
              itemType: a.itemType ?? 'ACTION',
              ownerEmployeeId: employeeIds.get(a.ownerKey ?? p.employeeKey) as string,
              competencyId: a.competency ? (competencyIds.get(a.competency) ?? null) : null,
              dueDate: daysFrom(TODAY, a.dueIn),
              status: a.done ? 'COMPLETED' : a.dueIn < 0 ? 'IN_PROGRESS' : 'OPEN',
              completedAt: a.done ? daysFrom(TODAY, a.dueIn - 1) : null,
              sortOrder: i,
            })),
          },
        },
      });
      actionCount += p.actions.length;

      for (const c of p.checkIns ?? []) {
        await db.planCheckIn.create({
          data: {
            planId: plan.id,
            authorEmployeeId: employeeIds.get(c.authorKey) as string,
            body: c.body,
            createdAt: daysFrom(TODAY, -c.daysAgo),
          },
        });
      }
    }
    log(
      `development plans: ${plans.length} (${plans.filter((p) => p.planType === 'PERFORMANCE_IMPROVEMENT').length} restricted improvement plans), ${actionCount} actions`,
    );
  }


  // ========================================================================
  // Compensation
  // ========================================================================

  /**
   * Salary bands, pay history and one live merit cycle.
   *
   * Every salary here is invented for a fictional company. Nothing in this
   * block is anybody's actual pay.
   *
   * The cycle is left mid-flight on purpose: most decisions taken, two
   * managers submitted, one person with no released review and so no
   * recommendation, and one override. That is the state in which the access
   * rules are actually interesting — a manager must see their own line and
   * nobody else's, and the compensation administrator must see all of it while
   * HR sees none of it.
   */
  async function seedCompensation(): Promise<void> {
    // -- Bands --------------------------------------------------------------
    let bandCount = 0;
    for (const b of SALARY_BANDS) {
      const jobTitleId = titleIds.get(b.jobTitle);
      if (!jobTitleId) continue;
      await db.salaryBand.create({
        data: {
          orgId,
          jobTitleId,
          currency: 'USD',
          minMinor: b.min * 100,
          midMinor: b.mid === undefined ? null : b.mid * 100,
          maxMinor: b.max * 100,
          effectiveFrom: date('2026-01-01'),
        },
      });
      bandCount += 1;
    }
    log(`salary bands: ${bandCount} of ${JOB_TITLES.length} job titles (2 left unbanded)`);

    // -- Current pay, derived from the band so the two stay consistent ------
    const bandByTitle = new Map(SALARY_BANDS.map((b) => [b.jobTitle, b]));

    /** Rounded to the nearest $100 so the figures read like real salaries. */
    function salaryFor(person: SeedPerson): number | null {
      const band = bandByTitle.get(person.jobTitle);
      if (!band) return null;
      const position = PAY_POSITIONS[person.key] ?? 0.45;
      const raw = band.min + (band.max - band.min) * position;
      return Math.round(raw / 100) * 100;
    }

    let recordCount = 0;
    let unpaidCount = 0;

    for (const person of PEOPLE) {
      const current = salaryFor(person);
      if (current === null) {
        // Nobody in an unbanded title gets a salary here, which is what makes
        // the "no salary on record" path reachable on a real screen.
        unpaidCount += 1;
        continue;
      }

      const hire = date(person.hireDate);
      const rng = new Rng(`pay-${person.key}`);

      /**
       * Walk backwards from today's salary, undoing one increase a year, so
       * the history is internally consistent: each row is the salary that was
       * in force from its effective date, and the last row is the hire.
       */
      const rows: { effective: Date; baseMinor: number; type: string; note: string | null }[] = [];
      let runningMinor = current * 100;
      let year = 2026;

      while (year > hire.getUTCFullYear() && rows.length < 8) {
        rows.push({
          effective: date(`${year}-03-01`),
          baseMinor: runningMinor,
          type: 'MERIT',
          note: `${year} merit increase.`,
        });
        // Undo an increase of between 2.5% and 4.5% to get the prior salary.
        const bp = 250 + rng.int(0, 200);
        const prior = Math.round(runningMinor / (1 + bp / 10_000));
        runningMinor = Math.round(prior / 10_000) * 10_000; // nearest $100
        year -= 1;
      }

      rows.push({
        effective: hire,
        baseMinor: runningMinor,
        type: 'HIRE',
        note: 'Starting salary on hire.',
      });

      for (const r of rows) {
        await db.compensationRecord.create({
          data: {
            orgId,
            employeeId: employeeIds.get(person.key) as string,
            baseMinor: r.baseMinor,
            currency: 'USD',
            effectiveDate: r.effective,
            changeType: r.type,
            note: r.note,
            isDemoData: true,
          },
        });
        recordCount += 1;
      }
    }

    // One correction, so the append-only story has a worked example on screen
    // rather than only a paragraph claiming it.
    const gloriaId = employeeIds.get('gloria');
    if (gloriaId) {
      const latest = await db.compensationRecord.findFirst({
        where: { employeeId: gloriaId },
        orderBy: { effectiveDate: 'desc' },
      });
      if (latest) {
        await db.compensationRecord.create({
          data: {
            orgId,
            employeeId: gloriaId,
            baseMinor: latest.baseMinor + 120_000,
            currency: 'USD',
            effectiveDate: date('2026-04-01'),
            changeType: 'CORRECTION',
            note:
              'Correction. The March increase was entered at the wrong figure; this row records the ' +
              'salary that was actually agreed. The original row is left as it was.',
            isDemoData: true,
          },
        });
        recordCount += 1;
      }
    }

    log(
      `pay records: ${recordCount} across ${PEOPLE.length - unpaidCount} people ` +
        `(${unpaidCount} left with no salary on record, 1 correction)`,
    );

    // -- A live merit cycle -------------------------------------------------
    const reviewCycleId = reviewCycleIds.get('2025 Annual Performance Review') ?? null;

    const cycle = await db.compensationCycle.create({
      data: {
        orgId,
        name: '2027 Merit Increase',
        currency: 'USD',
        status: 'PLANNING',
        effectiveDate: date('2027-01-01'),
        dueAt: date('2026-12-05'),
        reviewCycleId,
        totalPoolMinor: 9_500_000, // $95,000
        notes:
          'Pool is 3.2% of field and office payroll. Aim for the suggested figure unless you can say ' +
          'in a sentence why not — and if you can, say it, that is what the reason box is for.',
        createdById: employeeIds.get('gloria') ?? null,
        launchedAt: daysFrom(TODAY, -6),
        isDemoData: true,
      },
    });

    // Released 2025 scores, which is what a recommendation may rest on.
    const released = reviewCycleId
      ? await db.cycleParticipant.findMany({
          where: { cycleId: reviewCycleId, releasedAt: { not: null } },
          select: { employeeId: true, finalScore: true, calibratedScore: true },
        })
      : [];
    const scoreByEmployee = new Map<string, number>();
    for (const r of released) {
      const score = r.calibratedScore ?? r.finalScore;
      if (score !== null) scoreByEmployee.set(r.employeeId, score);
    }

    const participantPlans: Record<string, 'decided' | 'submitted' | 'approved' | 'pending' | 'override'> = {
      rosa: 'submitted',
      jamal: 'override',
      nina: 'submitted',
      tyler: 'decided',
      elena: 'decided',
      yuki: 'approved',
      oleg: 'pending',
      casey: 'pending',
    };

    let participantCount = 0;
    let decidedCount = 0;

    for (const person of PEOPLE) {
      if (person.employmentStatus === 'terminated') continue;
      const employeeId = employeeIds.get(person.key);
      if (!employeeId) continue;

      const currentPay = await db.compensationRecord.findFirst({
        where: { employeeId },
        orderBy: { effectiveDate: 'desc' },
        select: { baseMinor: true, currency: true },
      });
      // No salary on record means nothing to base an increase on, so the
      // person is not in the cycle at all. The create path says the same.
      if (!currentPay) continue;

      const band = bandByTitle.get(person.jobTitle);
      const score = scoreByEmployee.get(employeeId) ?? null;
      const rec = recommendIncrease({
        score,
        baseMinor: currentPay.baseMinor,
        rangeMinMinor: band ? band.min * 100 : null,
        rangeMaxMinor: band ? band.max * 100 : null,
        rangeMidMinor: band?.mid === undefined ? null : band.mid * 100,
      });

      const plan = participantPlans[person.key] ?? 'pending';
      const managerKey = person.managerKey;

      let decidedBp: number | null = null;
      let rationale: string | null = null;
      let status = 'PENDING';

      if (plan !== 'pending' && rec.bp !== null) {
        if (plan === 'override') {
          // Deliberately above the suggestion, with the reason the override
          // field exists to capture.
          decidedBp = rec.bp + 200;
          rationale =
            'Above the suggested figure on purpose. Jamal moved onto finish work in July and is now ' +
            'doing the job a grade up from the one he was hired into, while still sitting near the ' +
            'bottom of the band. This closes part of that gap; the rest should come with a title change.';
        } else {
          decidedBp = rec.bp;
        }
        status =
          plan === 'approved'
            ? 'APPROVED'
            : plan === 'submitted' || plan === 'override'
              ? 'SUBMITTED'
              : 'DECIDED';
        decidedCount += 1;
      }

      const decidedAmountMinor = increaseFromBasisPoints(currentPay.baseMinor, decidedBp);

      await db.compensationParticipant.create({
        data: {
          cycleId: cycle.id,
          employeeId,
          managerIdSnapshot: managerKey ? (employeeIds.get(managerKey) ?? null) : null,
          managerNameSnapshot: managerKey
            ? (() => {
                const m = PEOPLE.find((x) => x.key === managerKey);
                return m ? `${m.firstName} ${m.lastName}` : null;
              })()
            : null,
          jobTitleNameSnapshot: person.jobTitle,
          departmentNameSnapshot: person.department,
          currentBaseMinor: currentPay.baseMinor,
          currency: currentPay.currency,
          bandMinMinor: band ? band.min * 100 : null,
          bandMidMinor: band?.mid === undefined ? null : band.mid * 100,
          bandMaxMinor: band ? band.max * 100 : null,
          performanceScore: score,
          performanceBand: rec.band,
          recommendedBp: rec.bp,
          decidedBp,
          decidedAmountMinor,
          newBaseMinor: newBaseFrom(currentPay.baseMinor, decidedAmountMinor),
          rationale,
          status,
          decidedByEmployeeId:
            decidedBp !== null && managerKey ? (employeeIds.get(managerKey) ?? null) : null,
          decidedAt: decidedBp !== null ? daysFrom(TODAY, -3) : null,
          submittedAt: ['SUBMITTED', 'APPROVED'].includes(status) ? daysFrom(TODAY, -2) : null,
          approvedByUserId: status === 'APPROVED' ? (userIds.get('gloria') ?? null) : null,
          approvedAt: status === 'APPROVED' ? daysFrom(TODAY, -1) : null,
          approvalNote:
            status === 'APPROVED'
              ? 'Checked against the band and the released score. Approved. Not yet applied to pay.'
              : null,
        },
      });
      participantCount += 1;
    }

    // -- Manager budgets ----------------------------------------------------
    // Each manager with people in the cycle gets a share of the pool,
    // weighted by the payroll they are allocating over, so the sum of the
    // budgets equals the pool exactly rather than approximately.
    const byManager = await db.compensationParticipant.groupBy({
      by: ['managerIdSnapshot'],
      where: { cycleId: cycle.id, managerIdSnapshot: { not: null } },
      _sum: { currentBaseMinor: true },
    });
    const totalPayroll = byManager.reduce((sum, g) => sum + (g._sum.currentBaseMinor ?? 0), 0);

    let allocated = 0;
    for (const [i, g] of byManager.entries()) {
      const share = totalPayroll > 0 ? (g._sum.currentBaseMinor ?? 0) / totalPayroll : 0;
      // The last manager takes the remainder, so rounding never loses or
      // invents a cent against the pool.
      const poolMinor =
        i === byManager.length - 1
          ? cycle.totalPoolMinor - allocated
          : Math.round(cycle.totalPoolMinor * share);
      allocated += poolMinor;
      await db.compensationBudget.create({
        data: {
          cycleId: cycle.id,
          ownerEmployeeId: g.managerIdSnapshot as string,
          poolMinor,
          note: 'Weighted by the payroll in this manager’s scope.',
        },
      });
    }

    log(
      `compensation cycle: ${cycle.name} — ${participantCount} participants, ` +
        `${decidedCount} decided, ${byManager.length} manager budgets totalling ` +
        `${allocated / 100} of a ${cycle.totalPoolMinor / 100} pool`,
    );
  }
  // ========================================================================
  // Calibration
  // ========================================================================
  async function seedCalibration(): Promise<void> {
    const cycle = await db.reviewCycle.findFirst({
      where: { orgId, name: '2025 Annual Performance Review' },
    });
    if (!cycle) return;

    const participants = await db.cycleParticipant.findMany({
      where: { cycleId: cycle.id, finalScore: { not: null } },
      select: { id: true, finalScore: true, employee: { select: { reviewCohort: true } } },
    });
    const fieldParticipants = participants.filter((p) => p.employee.reviewCohort === 'Field');
    if (fieldParticipants.length === 0) return;

    const session = await db.calibrationSession.create({
      data: {
        orgId,
        cycleId: cycle.id,
        name: 'Field crew calibration — 2025 annual',
        status: 'FINALIZED',
        notes:
          'Grant, Rosa, Abebe and Priya reviewed every field rating together on 2026-02-20. Two adjustments were agreed, both recorded with a reason. Ratings that were not adjusted are unchanged.',
        facilitatorEmployeeId: employeeIds.get('priya') as string,
        finalizedAt: date('2026-02-20'),
      },
    });

    const rng = new Rng('calibration');
    for (const [i, p] of fieldParticipants.entries()) {
      const adjust = i === 1 ? -4.5 : i === 3 ? 3.5 : 0;
      const proposed = p.finalScore !== null ? Math.round((p.finalScore + adjust) * 10) / 10 : null;
      await db.calibrationEntry.create({
        data: {
          sessionId: session.id,
          participantId: p.id,
          originalScore: p.finalScore,
          proposedScore: proposed,
          finalScore: proposed,
          rationale:
            adjust === 0
              ? 'Reviewed, no change. Rating is consistent with the rest of the crew.'
              : adjust < 0
                ? 'Adjusted down. The written examples describe solid work meeting the standard, not work above it; the original rating was generous relative to peers doing the same work.'
                : 'Adjusted up. The manager rated conservatively; two other leads independently described this person as the strongest on the crew, and the written examples support it.',
          decidedByEmployeeId: employeeIds.get('priya') as string,
          decidedAt: date('2026-02-20'),
        },
      });
      if (adjust !== 0) {
        await db.cycleParticipant.update({
          where: { id: p.id },
          data: {
            calibratedScore: proposed,
            calibrationNote:
              adjust < 0
                ? 'Adjusted down in the 2026-02-20 field calibration session. The computed score is unchanged and still shown alongside.'
                : 'Adjusted up in the 2026-02-20 field calibration session. The computed score is unchanged and still shown alongside.',
            calibratedById: userIds.get('priya') ?? null,
            calibratedAt: date('2026-02-20'),
          },
        });
      }
      void rng;
    }
    log(`calibration: 1 finalized session covering ${fieldParticipants.length} field ratings, 2 adjustments`);
  }

  // ========================================================================
  // Notifications
  // ========================================================================
  async function seedNotifications(): Promise<void> {
    const open = await db.reviewAssignment.findMany({
      where: {
        status: { in: ['NOT_STARTED', 'DRAFT'] },
        participant: { cycle: { status: 'ACTIVE' } },
      },
      include: {
        participant: {
          include: { employee: { select: { firstName: true, lastName: true } }, cycle: { select: { name: true } } },
        },
      },
      take: 60,
    });

    let count = 0;
    for (const a of open) {
      const subject = `${a.participant.employee.firstName} ${a.participant.employee.lastName}`;
      const isSelf = a.kind === 'SELF';
      await db.notification.create({
        data: {
          orgId,
          recipientEmployeeId: a.reviewerEmployeeId,
          type: 'review.assigned',
          title: isSelf
            ? `Your self-assessment for ${a.participant.cycle.name} is waiting`
            : `${a.kind === 'PEER' ? 'Peer review' : 'Manager review'} for ${subject} is waiting`,
          body: a.dueAt
            ? `Due ${a.dueAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
            : null,
          linkUrl: `/reviews/assignments/${a.id}`,
          severity: a.dueAt && a.dueAt < TODAY ? 'urgent' : 'info',
          dedupeKey: `review.assigned:${a.id}`,
        },
      });
      count += 1;
    }

    const released = await db.cycleParticipant.findMany({
      where: { status: 'RELEASED', cycle: { orgId } },
      include: { cycle: { select: { name: true } } },
    });
    for (const p of released) {
      await db.notification.create({
        data: {
          orgId,
          recipientEmployeeId: p.employeeId,
          type: 'review.released',
          title: `Your ${p.cycle.name} is ready to read`,
          body: 'Read it through and acknowledge that you have received it. Acknowledging records receipt — it does not mean you agree with it.',
          linkUrl: `/reviews/results/${p.id}`,
          severity: 'warning',
          dedupeKey: `review.released:${p.id}`,
        },
      });
      count += 1;
    }

    const requests = await db.feedbackRequest.findMany({ where: { orgId, status: 'PENDING' } });
    for (const r of requests) {
      await db.notification.create({
        data: {
          orgId,
          recipientEmployeeId: r.responderEmployeeId,
          type: 'feedback.requested',
          title: 'Someone has asked you for feedback',
          linkUrl: `/feedback/requests/${r.id}`,
          dedupeKey: `feedback.requested:${r.id}`,
        },
      });
      count += 1;
    }

    const overdueActions = await db.actionItem.findMany({
      where: { orgId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueDate: { lt: TODAY } },
      take: 20,
    });
    for (const a of overdueActions) {
      await db.notification.create({
        data: {
          orgId,
          recipientEmployeeId: a.ownerEmployeeId,
          type: 'action.overdue',
          title: `Action item overdue: ${a.title}`,
          linkUrl: `/meetings/actions`,
          severity: 'warning',
          dedupeKey: `action.overdue:${a.id}`,
        },
      });
      count += 1;
    }

    const openSurvey = await db.survey.findFirst({ where: { orgId, status: 'OPEN' } });
    if (openSurvey) {
      const pending = await db.surveyInvitation.findMany({
        where: { surveyId: openSurvey.id, status: { not: 'COMPLETED' } },
      });
      for (const inv of pending) {
        await db.notification.create({
          data: {
            orgId,
            recipientEmployeeId: inv.employeeId,
            type: 'survey.invited',
            title: `${openSurvey.title} is open`,
            body: 'Three questions, anonymous. Closes in nine days.',
            linkUrl: `/surveys/respond/${openSurvey.id}`,
            dedupeKey: `survey.invited:${inv.id}`,
          },
        });
        count += 1;
      }
    }

    log(`notifications: ${count}`);
  }

  // ========================================================================
  // Audit trail for the seeded lifecycle events
  // ========================================================================
  async function seedAudit(): Promise<void> {
    const priyaUser = userIds.get('priya') as string;
    const priyaEmp = employeeIds.get('priya') as string;
    const rows: {
      action: string;
      entityType: string;
      entityId: string;
      summary: string;
      createdAt: Date;
    }[] = [];

    const cycles = await db.reviewCycle.findMany({ where: { orgId } });
    for (const c of cycles) {
      rows.push({
        action: 'cycle.created',
        entityType: 'review_cycle',
        entityId: c.id,
        summary: `Created review cycle "${c.name}".`,
        createdAt: c.launchedAt ? daysFrom(c.launchedAt, -7) : daysFrom(TODAY, -3),
      });
      if (c.launchedAt) {
        const n = await db.cycleParticipant.count({ where: { cycleId: c.id } });
        rows.push({
          action: 'cycle.launched',
          entityType: 'review_cycle',
          entityId: c.id,
          summary: `Launched "${c.name}" to ${n} participants.`,
          createdAt: c.launchedAt,
        });
      }
      if (c.closedAt) {
        rows.push({
          action: 'cycle.closed',
          entityType: 'review_cycle',
          entityId: c.id,
          summary: `Closed "${c.name}".`,
          createdAt: c.closedAt,
        });
      }
    }

    const releases = await db.cycleParticipant.findMany({
      where: { releasedAt: { not: null }, cycle: { orgId } },
      include: { employee: { select: { firstName: true, lastName: true } } },
      take: 80,
    });
    for (const p of releases) {
      rows.push({
        action: 'review.released',
        entityType: 'cycle_participant',
        entityId: p.id,
        summary: `Released review results to ${p.employee.firstName} ${p.employee.lastName}.`,
        createdAt: p.releasedAt as Date,
      });
    }

    const surveys = await db.survey.findMany({ where: { orgId } });
    for (const s of surveys) {
      if (s.launchedAt) {
        rows.push({
          action: 'survey.launched',
          entityType: 'survey',
          entityId: s.id,
          summary: `Launched survey "${s.title}" in ${s.mode === 'ANONYMOUS' ? 'anonymous' : 'named'} mode.`,
          createdAt: s.launchedAt,
        });
      }
    }

    const vince = employeeIds.get('vince') as string;
    rows.push({
      action: 'employee.deactivated',
      entityType: 'employee',
      entityId: vince,
      summary:
        'Deactivated Vince Trujillo. Sign-in revoked; review and goal history retained for the record.',
      createdAt: date('2026-09-30'),
    });
    rows.push({
      action: 'employee.manager.changed',
      entityType: 'employee',
      entityId: employeeIds.get('jamal') as string,
      summary:
        'Jamal Freeman moved from Abebe Tesfaye to Rosa Delgado. Existing review records keep their original manager of record.',
      createdAt: date('2026-07-01'),
    });

    await db.auditEvent.createMany({
      data: rows.map((r) => ({
        orgId,
        actorUserId: priyaUser,
        actorEmployeeId: priyaEmp,
        actorLabel: 'Priya Raghunathan',
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        summary: r.summary,
        createdAt: r.createdAt,
      })),
    });
    log(`audit events: ${rows.length}`);
  }

  // -- Summary --------------------------------------------------------------
  console.log('='.repeat(60));
  console.log('\nDemonstration organization ready.\n');
  console.log(`  Sign-in password for every demo account:  ${DEMO_PASSWORD}`);
  console.log('  (set SEED_PASSWORD before seeding to change it)\n');
  console.log('  Suggested accounts:');
  console.log('    priya.raghunathan@dreambuilder.example   HR / program administrator (no salary access)');
  console.log('    gloria.mbeki@dreambuilder.example        Compensation administrator (no review access)');
  console.log('    terrence.okafor@dreambuilder.example     System administrator');
  console.log('    rosa.delgado@dreambuilder.example        Manager (5 direct reports)');
  console.log('    marcus.villanueva@dreambuilder.example   Leadership + approver');
  console.log('    yuki.tanabe@dreambuilder.example         Employee, no reports');
  console.log('\n  Start the application with:  npm run dev');
  console.log('  Then open:                   http://localhost:3000\n');
}

main()
  .catch((e) => {
    console.error('\nSeed failed:\n', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
