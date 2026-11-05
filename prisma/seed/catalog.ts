import type { PrismaClient } from '@prisma/client';

/**
 * Organization, structure and configurable catalogues.
 *
 * Everything here is seeded *data*, not application behaviour: departments, job
 * titles, rating scales, competencies and recognition values are all editable
 * in Administration once the application is running. No construction-specific
 * value is hardcoded anywhere in src/.
 */

export const ORG_SLUG = 'dreambuilder';

export async function seedOrganization(db: PrismaClient) {
  return db.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: {
      slug: ORG_SLUG,
      name: 'Dreambuilder Construction & Remodeling',
      productName: process.env.APP_PRODUCT_NAME || 'DB Elevate',
      wordmarkText: 'DB Elevate',
      // Kept in step with the defaults in globals.css, so a seeded
      // organization and a blank one do not look like different products.
      brandPrimaryHex: '#1d4e89',
      brandAccentHex: '#22945c',
      timezone: 'America/Denver',
      fiscalYearStart: 1,
      surveyMinResponses: 5,
      surveySuppressComplement: true,
      peerReviewMinForAggregate: 3,
      emailProvider: 'outbox',
      emailFromName: 'DB Elevate',
      emailFromAddr: 'no-reply@dreambuilder.example',
      aiEnabled: false,
      aiProvider: 'none',
    },
  });
}

export const DEPARTMENTS: { name: string; code: string; parent?: string; sortOrder: number }[] = [
  { name: 'Leadership', code: 'LEAD', sortOrder: 1 },
  { name: 'Field Operations', code: 'FIELD', sortOrder: 2 },
  { name: 'Framing', code: 'FRAME', parent: 'Field Operations', sortOrder: 3 },
  { name: 'Finish & Remodel', code: 'FINISH', parent: 'Field Operations', sortOrder: 4 },
  { name: 'Project Management', code: 'PM', sortOrder: 5 },
  { name: 'Sales & Estimating', code: 'SALES', sortOrder: 6 },
  { name: 'Office Administration', code: 'ADMIN', sortOrder: 7 },
];

export const JOB_TITLES: { name: string; level: string; department: string; library?: string }[] = [
  { name: 'Owner / President', level: 'Executive', department: 'Leadership' },
  { name: 'General Manager', level: 'Executive', department: 'Leadership', library: 'Leadership' },
  { name: 'Operations Manager', level: 'Manager', department: 'Field Operations', library: 'Crew Leadership' },
  { name: 'Field Superintendent', level: 'Manager', department: 'Field Operations', library: 'Crew Leadership' },
  { name: 'Crew Lead', level: 'Lead', department: 'Field Operations', library: 'Crew Leadership' },
  { name: 'Lead Carpenter', level: 'Lead', department: 'Framing', library: 'Field Crew' },
  { name: 'Carpenter', level: 'Journeyman', department: 'Framing', library: 'Field Crew' },
  { name: 'Finish Carpenter', level: 'Journeyman', department: 'Finish & Remodel', library: 'Field Crew' },
  { name: 'Tile & Flooring Specialist', level: 'Journeyman', department: 'Finish & Remodel', library: 'Field Crew' },
  { name: 'Carpenter Apprentice', level: 'Apprentice', department: 'Field Operations', library: 'Field Crew' },
  { name: 'Warehouse & Equipment Coordinator', level: 'Journeyman', department: 'Field Operations', library: 'Field Crew' },
  { name: 'Senior Project Manager', level: 'Manager', department: 'Project Management', library: 'Project Management' },
  { name: 'Project Manager', level: 'Lead', department: 'Project Management', library: 'Project Management' },
  { name: 'Project Coordinator', level: 'Journeyman', department: 'Project Management', library: 'Project Management' },
  { name: 'Sales Manager', level: 'Manager', department: 'Sales & Estimating', library: 'Sales & Estimating' },
  { name: 'Design Consultant', level: 'Journeyman', department: 'Sales & Estimating', library: 'Sales & Estimating' },
  { name: 'Estimator', level: 'Journeyman', department: 'Sales & Estimating', library: 'Sales & Estimating' },
  { name: 'HR & Office Manager', level: 'Manager', department: 'Office Administration', library: 'Office Administration' },
  { name: 'Office Administrator', level: 'Journeyman', department: 'Office Administration', library: 'Office Administration' },
  { name: 'Bookkeeper', level: 'Journeyman', department: 'Office Administration', library: 'Office Administration' },
  { name: 'Systems Administrator', level: 'Journeyman', department: 'Office Administration' },
];

export const RATING_SCALES: {
  name: string;
  description: string;
  levels: { value: number; label: string; description: string }[];
}[] = [
  {
    name: '5-point performance scale',
    description:
      'Default scale for annual reviews. Level 3 is the standard the job is expected to be done to, not a disappointment.',
    levels: [
      { value: 1, label: 'Not yet meeting', description: 'Work regularly falls short of the standard; needs close direction and rework is common.' },
      { value: 2, label: 'Developing', description: 'Meets some of the standard; still needs regular coaching or checking.' },
      { value: 3, label: 'Meets the standard', description: 'Does the job well and reliably, with normal supervision. This is the expected rating.' },
      { value: 4, label: 'Exceeds the standard', description: 'Consistently better than expected; others look to this person as an example.' },
      { value: 5, label: 'Outstanding', description: 'Sets the standard for the company; raises the performance of the people around them.' },
    ],
  },
  {
    name: '4-point proficiency scale',
    description: 'For competency assessments, where the question is how far along a skill is rather than how good the year was.',
    levels: [
      { value: 1, label: 'Learning', description: 'Needs instruction and supervision for this skill.' },
      { value: 2, label: 'Proficient', description: 'Handles routine work in this area independently.' },
      { value: 3, label: 'Advanced', description: 'Handles difficult or unusual work in this area independently.' },
      { value: 4, label: 'Expert', description: 'Sets the method for this area and trains others in it.' },
    ],
  },
  {
    name: '3-point check-in scale',
    description: 'Light scale for quarterly check-ins, where a fine-grained rating would imply more precision than a short conversation supports.',
    levels: [
      { value: 1, label: 'Needs attention', description: 'Something specific needs to change before the next check-in.' },
      { value: 2, label: 'On track', description: 'Going as expected.' },
      { value: 3, label: 'Going very well', description: 'Better than expected this quarter.' },
    ],
  },
  {
    name: 'Agreement scale (1-5)',
    description: 'Survey scale, from strong disagreement to strong agreement.',
    levels: [
      { value: 1, label: 'Strongly disagree', description: '' },
      { value: 2, label: 'Disagree', description: '' },
      { value: 3, label: 'Neither agree nor disagree', description: '' },
      { value: 4, label: 'Agree', description: '' },
      { value: 5, label: 'Strongly agree', description: '' },
    ],
  },
];

export const COMPETENCIES: {
  name: string;
  category: string;
  description: string;
  behaviors: { level: string; descriptor: string }[];
}[] = [
  {
    name: 'Jobsite Safety',
    category: 'Safety',
    description: 'Works safely, keeps the site safe for everyone on it, and speaks up when something is not right.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Wears required protective equipment without being reminded and asks before using unfamiliar equipment.' },
      { level: 'Journeyman', descriptor: 'Spots and fixes common hazards unprompted; completes toolbox talks and incident reports properly.' },
      { level: 'Lead', descriptor: 'Runs the daily safety brief, corrects unsafe work on the spot, and stops work when it is genuinely unsafe.' },
      { level: 'Manager', descriptor: 'Builds safety into how jobs are planned and staffed; tracks near-misses and closes them out.' },
    ],
  },
  {
    name: 'Craftsmanship & Quality',
    category: 'Craft',
    description: 'Work meets the standard the first time, holds up on inspection, and holds up for the client years later.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Follows the method shown and asks rather than guessing when unsure.' },
      { level: 'Journeyman', descriptor: 'Work passes inspection and punch review with few callbacks.' },
      { level: 'Lead', descriptor: 'Sets the quality bar for the crew and catches problems before the client does.' },
      { level: 'Manager', descriptor: 'Defines what good looks like across jobs and resolves recurring quality causes.' },
    ],
  },
  {
    name: 'Schedule & Productivity',
    category: 'Delivery',
    description: 'Gets the planned work done in the planned time, and flags slippage early enough to act on.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Arrives ready to work and keeps pace on assigned tasks.' },
      { level: 'Journeyman', descriptor: 'Completes assigned scope within the time allowed and reports delays the same day.' },
      { level: 'Lead', descriptor: 'Sequences the crew to keep everyone productive and protects the critical path.' },
      { level: 'Manager', descriptor: 'Builds schedules that hold up and resolves cross-trade conflicts before they bite.' },
    ],
  },
  {
    name: 'Blueprint & Plan Reading',
    category: 'Craft',
    description: 'Reads plans and specifications accurately and builds to them.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Finds dimensions and details on a plan set with help.' },
      { level: 'Journeyman', descriptor: 'Works from plans independently and catches conflicts between sheets.' },
      { level: 'Lead', descriptor: 'Resolves plan conflicts with the project manager and documents the resolution.' },
      { level: 'Manager', descriptor: 'Reviews plan sets for constructability before work is scheduled.' },
    ],
  },
  {
    name: 'Client Communication',
    category: 'Client Service',
    description: 'Keeps clients informed, sets honest expectations, and handles concerns without making them worse.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Is courteous on site and refers client questions to the lead.' },
      { level: 'Journeyman', descriptor: 'Answers client questions within their scope accurately and knows when to escalate.' },
      { level: 'Lead', descriptor: 'Runs client walkthroughs and delivers unwelcome news early and clearly.' },
      { level: 'Manager', descriptor: 'Repairs strained client relationships and sets communication standards for the job.' },
    ],
  },
  {
    name: 'Tool & Equipment Care',
    category: 'Craft',
    description: 'Looks after company tools, vehicles and materials.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Cleans and returns tools; reports damage rather than hiding it.' },
      { level: 'Journeyman', descriptor: 'Keeps assigned equipment serviceable and maintains the vehicle it travels in.' },
      { level: 'Lead', descriptor: 'Accounts for crew tools and manages consumable stock on the job.' },
      { level: 'Manager', descriptor: 'Plans replacement and maintenance so work is never held up by equipment.' },
    ],
  },
  {
    name: 'Problem Solving',
    category: 'Craft',
    description: 'Works out a sound answer to a site problem instead of stopping or improvising badly.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Raises problems promptly rather than working around them.' },
      { level: 'Journeyman', descriptor: 'Proposes a workable fix along with the problem.' },
      { level: 'Lead', descriptor: 'Decides between options under time pressure and explains the trade-off.' },
      { level: 'Manager', descriptor: 'Removes the conditions that keep producing the same problem.' },
    ],
  },
  {
    name: 'Crew Leadership',
    category: 'Leadership',
    description: 'Directs a crew so the work gets done well and people want to stay.',
    behaviors: [
      { level: 'Journeyman', descriptor: 'Directs one or two people on a defined task.' },
      { level: 'Lead', descriptor: 'Runs a crew day to day, assigns work to strengths, and handles friction directly.' },
      { level: 'Manager', descriptor: 'Develops leads, staffs crews across jobs, and handles performance problems properly.' },
      { level: 'Director', descriptor: 'Builds the bench the company needs a year out.' },
    ],
  },
  {
    name: 'Mentoring & Training',
    category: 'Leadership',
    description: 'Brings less experienced people along deliberately.',
    behaviors: [
      { level: 'Journeyman', descriptor: 'Shows an apprentice how, and checks the result.' },
      { level: 'Lead', descriptor: 'Gives apprentices real work with the right amount of supervision.' },
      { level: 'Manager', descriptor: 'Runs a visible development path for the trade.' },
      { level: 'Director', descriptor: 'Makes training a standing part of how the company runs.' },
    ],
  },
  {
    name: 'Change Order Discipline',
    category: 'Delivery',
    description: 'Gets extra work priced, approved and documented before it is built.',
    behaviors: [
      { level: 'Journeyman', descriptor: 'Does not start out-of-scope work without the lead approving it.' },
      { level: 'Lead', descriptor: 'Identifies out-of-scope work on site and gets it written up the same day.' },
      { level: 'Manager', descriptor: 'Prices and closes change orders before the work is scheduled.' },
      { level: 'Director', descriptor: 'Keeps unbilled change work near zero across the portfolio.' },
    ],
  },
  {
    name: 'Punch List Follow-Through',
    category: 'Delivery',
    description: 'Closes out the last five percent of a job properly.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Completes assigned punch items and marks them done accurately.' },
      { level: 'Journeyman', descriptor: 'Clears punch items without creating new ones.' },
      { level: 'Lead', descriptor: 'Walks the job ahead of the client and gets the list short before they see it.' },
      { level: 'Manager', descriptor: 'Drives closeout so retention is released on time.' },
    ],
  },
  {
    name: 'Estimating Accuracy',
    category: 'Commercial',
    description: 'Produces estimates the company can actually build to.',
    behaviors: [
      { level: 'Journeyman', descriptor: 'Takes off quantities accurately from a plan set.' },
      { level: 'Lead', descriptor: 'Estimates typical jobs within the agreed tolerance of final cost.' },
      { level: 'Manager', descriptor: 'Feeds actual costs back into the estimating assumptions.' },
      { level: 'Director', descriptor: 'Owns margin accuracy across the book of work.' },
    ],
  },
  {
    name: 'Vendor & Subcontractor Coordination',
    category: 'Delivery',
    description: 'Gets subs and suppliers on site, on time, with what they need.',
    behaviors: [
      { level: 'Journeyman', descriptor: 'Confirms deliveries and flags shortfalls early.' },
      { level: 'Lead', descriptor: 'Sequences subs so they are not waiting on each other.' },
      { level: 'Manager', descriptor: 'Holds subs to scope and schedule, and replaces the ones who will not meet it.' },
      { level: 'Director', descriptor: 'Builds the trade base the company depends on.' },
    ],
  },
  {
    name: 'Documentation & Reporting',
    category: 'Office',
    description: 'Records what happened accurately and on time: time sheets, daily logs, photos, receipts.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Submits accurate time on schedule.' },
      { level: 'Journeyman', descriptor: 'Keeps daily logs and job photos current without reminders.' },
      { level: 'Lead', descriptor: 'Crew paperwork is complete and usable for billing.' },
      { level: 'Manager', descriptor: 'Job records support billing and would stand up in a dispute.' },
    ],
  },
  {
    name: 'Dependability',
    category: 'Core',
    description: 'Shows up, follows through, and does what they said they would do.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'On site on time and ready; calls in properly when they cannot be.' },
      { level: 'Journeyman', descriptor: 'Commitments can be relied on without follow-up.' },
      { level: 'Lead', descriptor: 'The crew and the office can plan around this person.' },
      { level: 'Manager', descriptor: 'Carries commitments the business depends on.' },
    ],
  },
  {
    name: 'Teamwork & Respect',
    category: 'Core',
    description: 'Works well with the rest of the crew, the office and the trades.',
    behaviors: [
      { level: 'Apprentice', descriptor: 'Pitches in and treats everyone on site decently.' },
      { level: 'Journeyman', descriptor: 'Helps others without being asked; handles disagreement without heat.' },
      { level: 'Lead', descriptor: 'Builds a crew people want to be on.' },
      { level: 'Manager', descriptor: 'Sets the tone between field, office and trades.' },
    ],
  },
];

export const COMPETENCY_LIBRARIES: { name: string; description: string; items: string[] }[] = [
  {
    name: 'Field Crew',
    description: 'Expected competencies for carpenters, apprentices and trade specialists on the tools.',
    items: [
      'Jobsite Safety',
      'Craftsmanship & Quality',
      'Schedule & Productivity',
      'Blueprint & Plan Reading',
      'Tool & Equipment Care',
      'Dependability',
      'Teamwork & Respect',
    ],
  },
  {
    name: 'Crew Leadership',
    description: 'Expected competencies for crew leads, superintendents and field managers.',
    items: [
      'Jobsite Safety',
      'Crew Leadership',
      'Mentoring & Training',
      'Schedule & Productivity',
      'Craftsmanship & Quality',
      'Client Communication',
      'Change Order Discipline',
      'Punch List Follow-Through',
      'Dependability',
    ],
  },
  {
    name: 'Project Management',
    description: 'Expected competencies for project managers and coordinators.',
    items: [
      'Schedule & Productivity',
      'Client Communication',
      'Change Order Discipline',
      'Vendor & Subcontractor Coordination',
      'Documentation & Reporting',
      'Punch List Follow-Through',
      'Problem Solving',
      'Dependability',
    ],
  },
  {
    name: 'Sales & Estimating',
    description: 'Expected competencies for design consultants, sales and estimating.',
    items: [
      'Client Communication',
      'Estimating Accuracy',
      'Documentation & Reporting',
      'Problem Solving',
      'Teamwork & Respect',
      'Dependability',
    ],
  },
  {
    name: 'Office Administration',
    description: 'Expected competencies for office, accounting and administrative roles.',
    items: [
      'Documentation & Reporting',
      'Client Communication',
      'Teamwork & Respect',
      'Dependability',
      'Problem Solving',
    ],
  },
  {
    name: 'Leadership',
    description: 'Expected competencies for company leadership.',
    items: [
      'Crew Leadership',
      'Mentoring & Training',
      'Client Communication',
      'Problem Solving',
      'Estimating Accuracy',
      'Dependability',
    ],
  },
];

export const RECOGNITION_VALUES: { name: string; description: string; icon: string; colorHex: string }[] = [
  { name: 'Safety First', description: 'Put safety ahead of speed or convenience.', icon: 'shield', colorHex: '#c2410c' },
  { name: 'Craftsmanship', description: 'Work that holds up and that we would put our name on.', icon: 'hammer', colorHex: '#1d4e89' },
  { name: 'Client Save', description: 'Turned a difficult client situation around.', icon: 'handshake', colorHex: '#047857' },
  { name: 'Crew Player', description: 'Stepped in to help another crew or trade.', icon: 'users', colorHex: '#7c3aed' },
  { name: 'Problem Solver', description: 'Found a sound answer to a hard site problem.', icon: 'lightbulb', colorHex: '#b45309' },
  { name: 'Teaching Moment', description: 'Brought someone else along.', icon: 'graduation-cap', colorHex: '#0e7490' },
];

/**
 * Salary bands, by job title.
 *
 * Whole dollars here; the seed converts to minor units. Two titles are left
 * out on purpose so the "no band set" state is visible on the bands page and
 * so at least one person in a cycle gets a recommendation resting on
 * performance alone.
 *
 * Several midpoints are deliberately not halfway between the minimum and the
 * maximum. A target rate is a market reference, not an average of the edges,
 * and the compa-ratio is measured against it — see src/lib/money.ts.
 */
export const SALARY_BANDS: {
  jobTitle: string;
  min: number;
  mid?: number;
  max: number;
}[] = [
  { jobTitle: 'Owner / President', min: 160_000, mid: 200_000, max: 240_000 },
  { jobTitle: 'General Manager', min: 130_000, mid: 152_000, max: 185_000 },
  { jobTitle: 'Operations Manager', min: 95_000, mid: 112_000, max: 135_000 },
  { jobTitle: 'Field Superintendent', min: 85_000, mid: 99_000, max: 120_000 },
  { jobTitle: 'Crew Lead', min: 62_000, mid: 72_000, max: 85_000 },
  { jobTitle: 'Lead Carpenter', min: 58_000, mid: 67_000, max: 78_000 },
  { jobTitle: 'Carpenter', min: 48_000, mid: 56_000, max: 66_000 },
  { jobTitle: 'Finish Carpenter', min: 52_000, mid: 61_000, max: 72_000 },
  { jobTitle: 'Tile & Flooring Specialist', min: 50_000, mid: 59_000, max: 70_000 },
  { jobTitle: 'Carpenter Apprentice', min: 36_000, mid: 41_000, max: 48_000 },
  { jobTitle: 'Senior Project Manager', min: 95_000, mid: 111_000, max: 130_000 },
  { jobTitle: 'Project Manager', min: 75_000, mid: 88_000, max: 105_000 },
  { jobTitle: 'Project Coordinator', min: 52_000, mid: 60_000, max: 70_000 },
  { jobTitle: 'Sales Manager', min: 90_000, mid: 105_000, max: 130_000 },
  { jobTitle: 'Design Consultant', min: 55_000, mid: 65_000, max: 80_000 },
  { jobTitle: 'Estimator', min: 60_000, mid: 71_000, max: 85_000 },
  { jobTitle: 'HR & Office Manager', min: 70_000, mid: 81_000, max: 95_000 },
  { jobTitle: 'Office Administrator', min: 42_000, mid: 49_000, max: 58_000 },
  { jobTitle: 'Bookkeeper', min: 48_000, max: 66_000 },
  // Deliberately omitted: Warehouse & Equipment Coordinator, Systems
  // Administrator. No range has been agreed for either.
];

/**
 * Where each person's current salary sits, as a fraction of their band.
 *
 * Expressed as a position between the minimum (0) and maximum (1) rather than
 * as a figure, so the salaries stay consistent with the bands above if either
 * is edited. Anybody not listed lands at 0.45, modestly below midpoint, which
 * is the ordinary case.
 *
 * Every figure is invented. This is demonstration data for a fictional
 * company; it is not anybody's pay.
 */
export const PAY_POSITIONS: Record<string, number> = {
  dana: 0.82,
  marcus: 0.68,
  grant: 0.58,
  abebe: 0.52,
  rosa: 0.46,
  priya: 0.61,
  terrence: 0.5,
  // Deliberately high in band: an outstanding performer near the ceiling, so
  // the matrix's "paid above the midpoint" row gets exercised.
  yuki: 0.88,
  // Deliberately low in band: newly promoted, so a larger increase is
  // suggested and the band position is doing visible work.
  jamal: 0.18,
  gloria: 0.4,
};
