/**
 * Starter review templates.
 *
 * These are seeded *content*, fully editable in the template builder. The
 * question types, scales and weights they use are the same ones the builder
 * offers — nothing here is a special case in the application code.
 *
 * The construction-specific wording is deliberate (that is the first rollout),
 * but it lives in this seed file only. An organization in another industry
 * edits or deletes these and builds its own.
 */

export interface SeedQuestion {
  type: 'TEXT' | 'RATING' | 'MULTIPLE_CHOICE' | 'MULTI_SELECT' | 'COMPETENCY_RATING' | 'GOAL_REVIEW';
  prompt: string;
  helpText?: string;
  required?: boolean;
  weight?: number;
  scale?: string;
  competency?: string;
  choices?: string[];
  allowNotApplicable?: boolean;
  commentEnabled?: boolean;
  commentRequired?: boolean;
  goalScope?: 'OWNED' | 'OWNED_AND_TEAM' | 'CYCLE_PERIOD';
  maxLength?: number;
  /** Narrows which reviewer kinds answer this question; defaults to the section. */
  appliesTo?: string;
}

export interface SeedSection {
  title: string;
  instructions?: string;
  weight?: number;
  appliesTo?: string;
  questions: SeedQuestion[];
}

export interface SeedTemplate {
  name: string;
  description: string;
  category: 'annual' | 'quarterly' | 'new_hire' | 'project' | 'development' | 'pip' | 'custom';
  selfWeight: number;
  managerWeight: number;
  peerWeight: number;
  sections: SeedSection[];
}

const FIVE = '5-point performance scale';
const FOUR = '4-point proficiency scale';
const THREE = '3-point check-in scale';

/** Competency questions share wording, so build them from the library list. */
function competencyQuestions(names: string[], scale = FOUR): SeedQuestion[] {
  return names.map((name) => ({
    type: 'COMPETENCY_RATING' as const,
    prompt: name,
    competency: name,
    scale,
    required: true,
    weight: 1,
    allowNotApplicable: true,
    commentEnabled: true,
    helpText: 'Rate where this person is today, and add an example if you can.',
  }));
}

export const STARTER_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Annual Performance Review — Field Crew',
    description:
      'Annual review for carpenters, apprentices and trade specialists on the tools. Weighted towards safety, craft and reliability.',
    category: 'annual',
    selfWeight: 0,
    managerWeight: 1,
    peerWeight: 0,
    sections: [
      {
        title: 'The year in review',
        instructions:
          'Written answers only — nothing in this section is scored. Be specific: name jobs, dates and outcomes rather than describing character.',
        weight: 0,
        questions: [
          {
            type: 'TEXT',
            prompt: 'What work are you most proud of this year, and why?',
            helpText: 'Name the job or the task. One or two short paragraphs is plenty.',
            required: true,
            appliesTo: 'SELF',
            maxLength: 3000,
          },
          {
            type: 'TEXT',
            prompt: 'What was the hardest part of the year, and what did you learn from it?',
            required: true,
            appliesTo: 'SELF',
            maxLength: 3000,
          },
          {
            type: 'TEXT',
            prompt: 'Summary of the year',
            helpText:
              'Write this for the employee to read. Lead with what went well, then what needs to change, with examples for both.',
            required: true,
            appliesTo: 'MANAGER',
            maxLength: 4000,
          },
        ],
      },
      {
        title: 'Safety and reliability',
        instructions: 'The non-negotiables. Rate against the standard for the role, not against the best person on the crew.',
        weight: 3,
        questions: competencyQuestions(['Jobsite Safety', 'Dependability', 'Tool & Equipment Care']),
      },
      {
        title: 'Craft and productivity',
        weight: 3,
        instructions: 'How the work itself is going.',
        questions: competencyQuestions([
          'Craftsmanship & Quality',
          'Schedule & Productivity',
          'Blueprint & Plan Reading',
        ]),
      },
      {
        title: 'Working with others',
        weight: 2,
        questions: competencyQuestions(['Teamwork & Respect', 'Mentoring & Training']),
      },
      {
        title: 'Goals for the review period',
        instructions:
          'Goals are pulled in from the Goals module with their progress as it stood when this review was finalized.',
        weight: 2,
        questions: [
          {
            type: 'GOAL_REVIEW',
            prompt: 'How did this goal go?',
            goalScope: 'OWNED',
            scale: FIVE,
            required: false,
            weight: 1,
            allowNotApplicable: true,
            commentEnabled: true,
            helpText: 'Rate the outcome and say what helped or got in the way.',
          },
        ],
      },
      {
        title: 'Overall and next year',
        weight: 2,
        questions: [
          {
            type: 'RATING',
            prompt: 'Overall performance against the standard for this role',
            scale: FIVE,
            required: true,
            weight: 2,
            commentEnabled: true,
            commentRequired: true,
            appliesTo: 'MANAGER',
            helpText:
              '"Meets the standard" means the job is being done well. It is not a disappointing result.',
          },
          {
            type: 'MULTIPLE_CHOICE',
            prompt: 'Readiness for more responsibility',
            choices: [
              'Ready now',
              'Ready within a year with development',
              'Developing in the current role',
              'Needs to consolidate the current role first',
            ],
            required: true,
            appliesTo: 'MANAGER',
          },
          {
            type: 'TEXT',
            prompt: 'What are the two or three things to focus on next year?',
            required: true,
            maxLength: 2000,
          },
          {
            type: 'TEXT',
            prompt: 'What support, training or tools would help?',
            required: false,
            maxLength: 2000,
          },
        ],
      },
    ],
  },

  {
    name: 'Annual Performance Review — Office, Sales & Project Management',
    description:
      'Annual review for project management, sales, estimating and office roles. Weighted towards client outcomes, commercial discipline and documentation.',
    category: 'annual',
    selfWeight: 0,
    managerWeight: 1,
    peerWeight: 0,
    sections: [
      {
        title: 'The year in review',
        instructions: 'Written answers only — not scored.',
        weight: 0,
        questions: [
          {
            type: 'TEXT',
            prompt: 'What were your most significant contributions this year?',
            required: true,
            appliesTo: 'SELF',
            maxLength: 3000,
          },
          {
            type: 'TEXT',
            prompt: 'Where did things not go the way you wanted, and what would you do differently?',
            required: true,
            appliesTo: 'SELF',
            maxLength: 3000,
          },
          {
            type: 'TEXT',
            prompt: 'Summary of the year',
            helpText: 'Written for the employee to read, with examples.',
            required: true,
            appliesTo: 'MANAGER',
            maxLength: 4000,
          },
        ],
      },
      {
        title: 'Client and commercial',
        weight: 3,
        questions: competencyQuestions([
          'Client Communication',
          'Change Order Discipline',
          'Estimating Accuracy',
        ]),
      },
      {
        title: 'Delivery and coordination',
        weight: 3,
        questions: competencyQuestions([
          'Schedule & Productivity',
          'Vendor & Subcontractor Coordination',
          'Punch List Follow-Through',
          'Documentation & Reporting',
        ]),
      },
      {
        title: 'Judgement and teamwork',
        weight: 2,
        questions: competencyQuestions(['Problem Solving', 'Teamwork & Respect', 'Dependability']),
      },
      {
        title: 'Goals for the review period',
        weight: 2,
        questions: [
          {
            type: 'GOAL_REVIEW',
            prompt: 'How did this goal go?',
            goalScope: 'OWNED',
            scale: FIVE,
            weight: 1,
            allowNotApplicable: true,
            commentEnabled: true,
          },
        ],
      },
      {
        title: 'Overall and next year',
        weight: 2,
        questions: [
          {
            type: 'RATING',
            prompt: 'Overall performance against the standard for this role',
            scale: FIVE,
            required: true,
            weight: 2,
            commentEnabled: true,
            commentRequired: true,
            appliesTo: 'MANAGER',
          },
          {
            type: 'MULTIPLE_CHOICE',
            prompt: 'Readiness for more responsibility',
            choices: [
              'Ready now',
              'Ready within a year with development',
              'Developing in the current role',
              'Needs to consolidate the current role first',
            ],
            required: true,
            appliesTo: 'MANAGER',
          },
          {
            type: 'TEXT',
            prompt: 'Focus areas for next year',
            required: true,
            maxLength: 2000,
          },
        ],
      },
    ],
  },

  {
    name: 'Quarterly Check-In',
    description:
      'Short quarterly conversation. Deliberately light: three ratings and three questions, so it gets done rather than skipped.',
    category: 'quarterly',
    selfWeight: 0,
    managerWeight: 1,
    peerWeight: 0,
    sections: [
      {
        title: 'How the quarter went',
        weight: 1,
        questions: [
          {
            type: 'RATING',
            prompt: 'How did the quarter go overall?',
            scale: THREE,
            required: true,
            weight: 1,
            commentEnabled: true,
          },
          {
            type: 'RATING',
            prompt: 'Workload and schedule',
            scale: THREE,
            required: true,
            weight: 1,
            commentEnabled: true,
            helpText: 'Is the amount of work sustainable at the moment?',
          },
          {
            type: 'TEXT',
            prompt: 'What went well this quarter?',
            required: true,
            maxLength: 1500,
          },
          {
            type: 'TEXT',
            prompt: 'What is getting in the way?',
            required: true,
            maxLength: 1500,
          },
          {
            type: 'TEXT',
            prompt: 'What is the one thing to change before the next check-in?',
            required: false,
            maxLength: 1000,
          },
        ],
      },
      {
        title: 'Goal check-in',
        weight: 1,
        questions: [
          {
            type: 'GOAL_REVIEW',
            prompt: 'Is this goal on track?',
            goalScope: 'OWNED',
            scale: THREE,
            allowNotApplicable: true,
            commentEnabled: true,
          },
        ],
      },
    ],
  },

  {
    name: '90-Day New Hire Review',
    description:
      'Run at around 90 days. The decision this review supports is whether the hire is working out and what the next 90 days should focus on.',
    category: 'new_hire',
    selfWeight: 0,
    managerWeight: 1,
    peerWeight: 0,
    sections: [
      {
        title: 'Settling in',
        weight: 1,
        appliesTo: 'SELF,MANAGER',
        questions: [
          {
            type: 'TEXT',
            prompt: 'How have the first 90 days gone?',
            required: true,
            maxLength: 2500,
          },
          {
            type: 'MULTIPLE_CHOICE',
            prompt: 'Did onboarding give you what you needed to do the job safely?',
            choices: ['Yes, fully', 'Mostly, with gaps', 'No, there were real gaps'],
            required: true,
            appliesTo: 'SELF',
          },
          {
            type: 'TEXT',
            prompt: 'What is still unclear or missing?',
            required: false,
            appliesTo: 'SELF',
            maxLength: 1500,
          },
        ],
      },
      {
        title: 'Early competencies',
        instructions: 'At 90 days, "Learning" is the expected answer for most of these.',
        weight: 3,
        questions: competencyQuestions([
          'Jobsite Safety',
          'Dependability',
          'Craftsmanship & Quality',
          'Teamwork & Respect',
        ]),
      },
      {
        title: 'Decision and next 90 days',
        weight: 2,
        appliesTo: 'MANAGER',
        questions: [
          {
            type: 'MULTIPLE_CHOICE',
            prompt: 'Recommendation',
            choices: [
              'Continuing — on track',
              'Continuing — specific improvements needed',
              'Extend the review period',
              'Not working out',
            ],
            required: true,
            helpText:
              'This is a recommendation to be discussed with HR. It does not change anyone’s employment by itself.',
          },
          {
            type: 'TEXT',
            prompt: 'What should the next 90 days focus on?',
            required: true,
            maxLength: 2000,
          },
          {
            type: 'RATING',
            prompt: 'Overall progress at 90 days',
            scale: FIVE,
            required: true,
            weight: 1,
            commentEnabled: true,
          },
        ],
      },
    ],
  },

  {
    name: 'Project-Based Feedback',
    description:
      'Run at the close of a job. Short, and sent to everyone who worked on it, including the project manager and the trades coordinator.',
    category: 'project',
    selfWeight: 0,
    managerWeight: 1,
    peerWeight: 0,
    sections: [
      {
        title: 'This project',
        weight: 1,
        questions: [
          {
            type: 'TEXT',
            prompt: 'Which project is this about?',
            required: true,
            maxLength: 200,
          },
          {
            type: 'RATING',
            prompt: 'Contribution to this project',
            scale: FIVE,
            required: true,
            weight: 2,
            commentEnabled: true,
            commentRequired: true,
          },
          {
            type: 'RATING',
            prompt: 'Worked well with the rest of the team on this job',
            scale: FIVE,
            required: true,
            weight: 1,
            commentEnabled: true,
          },
          {
            type: 'MULTI_SELECT',
            prompt: 'What stood out on this job? Choose any that apply.',
            choices: [
              'Safety leadership',
              'Quality of finish',
              'Kept to schedule',
              'Handled a difficult client well',
              'Solved a site problem',
              'Helped another trade or crew',
              'Paperwork and documentation',
            ],
            required: false,
          },
          {
            type: 'TEXT',
            prompt: 'What should this person do differently on the next job like this?',
            required: false,
            maxLength: 1500,
          },
        ],
      },
    ],
  },

  {
    name: '360 Review — Self, Manager & Peers',
    description:
      'Used for crew leads and above. Blends a self-assessment, the manager review and peer input, with peer weighting kept low so a popularity contest cannot decide a rating.',
    category: 'annual',
    selfWeight: 0.2,
    managerWeight: 0.6,
    peerWeight: 0.2,
    sections: [
      {
        title: 'Leading the work',
        weight: 3,
        questions: competencyQuestions([
          'Crew Leadership',
          'Jobsite Safety',
          'Schedule & Productivity',
          'Problem Solving',
        ]),
      },
      {
        title: 'Working with people',
        weight: 3,
        questions: competencyQuestions([
          'Mentoring & Training',
          'Teamwork & Respect',
          'Client Communication',
        ]),
      },
      {
        title: 'Written feedback',
        weight: 0,
        questions: [
          {
            type: 'TEXT',
            prompt: 'What does this person do that you would want other leads to copy?',
            required: true,
            maxLength: 2000,
          },
          {
            type: 'TEXT',
            prompt: 'What is the single most useful thing they could change?',
            helpText: 'One concrete, actionable thing. Not a list.',
            required: true,
            maxLength: 2000,
          },
        ],
      },
      {
        title: 'Overall',
        weight: 2,
        appliesTo: 'SELF,MANAGER',
        questions: [
          {
            type: 'RATING',
            prompt: 'Overall performance as a lead',
            scale: FIVE,
            required: true,
            weight: 2,
            commentEnabled: true,
          },
        ],
      },
    ],
  },
];
