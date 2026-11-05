import { z } from 'zod';
import { handler, parseBody } from '@/server/api';
import { requestSuggestion } from '@/server/ai/assist';

const Schema = z.object({
  kind: z.enum([
    'review_question',
    'feedback_clarity',
    'review_summary',
    'goal_wording',
    'meeting_summary',
  ]),
  contextType: z.string().trim().min(1).max(60),
  contextId: z.string().trim().min(1).max(60),
  draft: z.string().max(8000).optional(),
});

/**
 * Returns 409 with the reason whenever AI is not available — off, no provider,
 * no credential, spend not approved, or the monthly budget used up. The caller
 * shows that reason; nothing silently falls back to the mock provider, because
 * somebody told "AI is on" should not be reading placeholder text.
 */
export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, Schema);
  const result = await requestSuggestion(actor, body);
  return {
    id: result.id,
    text: result.text,
    provider: result.provider,
    model: result.model,
    local: result.local,
    sourceLabel: result.sourceLabel,
    contextDigest: result.contextDigest,
  };
});
