import { SCOREABLE_QUESTION_TYPES, type QuestionType } from '@/lib/enums';

/**
 * Shapes shared between the template builder (a client component) and the
 * pages that seed it (server components). Kept out of the client module so a
 * server page can call `emptyQuestion` without crossing the boundary.
 */

export interface DraftQuestion {
  type: string;
  prompt: string;
  helpText: string;
  required: boolean;
  weight: number;
  allowNotApplicable: boolean;
  commentEnabled: boolean;
  commentRequired: boolean;
  maxLength: number | null;
  ratingScaleId: string;
  competencyId: string;
  goalScope: string;
  choices: string[];
  appliesTo: string;
}

export interface DraftSection {
  title: string;
  instructions: string;
  weight: number;
  appliesTo: string;
  questions: DraftQuestion[];
}

export interface TemplateDraft {
  name: string;
  description: string;
  category: string;
  selfWeight: number;
  managerWeight: number;
  peerWeight: number;
  sections: DraftSection[];
}

/** A new question with defaults that suit its type. */
export function emptyQuestion(type = 'RATING', defaultScaleId = ''): DraftQuestion {
  const scoreable = SCOREABLE_QUESTION_TYPES.includes(type as QuestionType);
  return {
    type,
    prompt: '',
    helpText: '',
    required: type !== 'TEXT',
    weight: 1,
    allowNotApplicable: type === 'COMPETENCY_RATING' || type === 'GOAL_REVIEW',
    commentEnabled: scoreable,
    commentRequired: false,
    maxLength: type === 'TEXT' ? 3000 : null,
    ratingScaleId: scoreable ? defaultScaleId : '',
    competencyId: '',
    goalScope: type === 'GOAL_REVIEW' ? 'OWNED' : '',
    choices: type === 'MULTIPLE_CHOICE' || type === 'MULTI_SELECT' ? ['', ''] : [],
    appliesTo: '',
  };
}
