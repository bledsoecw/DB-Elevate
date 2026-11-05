import { handler, parseBody } from '@/server/api';
import { ApprovalSchema } from '@/server/validation/reviews';
import { decideApproval } from '@/server/services/reviews';

export const POST = handler(async ({ actor, request, params }) => {
  const body = await parseBody(request, ApprovalSchema);
  await decideApproval(actor, params.id as string, body.decision, body.note ?? null);
  return { ok: true };
});
