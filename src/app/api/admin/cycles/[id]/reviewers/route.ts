import { handler, parseBody } from '@/server/api';
import { AssignReviewerSchema } from '@/server/validation/admin';
import { assignReviewer, unassignReviewer } from '@/server/services/cycles';
import { ValidationError } from '@/server/errors';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, AssignReviewerSchema);
  const created = await assignReviewer(
    actor,
    body.participantId,
    body.reviewerEmployeeId,
    body.kind,
  );
  return { id: created.id };
});

export const DELETE = handler(async ({ actor, request }) => {
  const url = new URL(request.url);
  const assignmentId = url.searchParams.get('assignment');
  if (!assignmentId) throw new ValidationError('Specify which assignment to remove.');
  await unassignReviewer(actor, assignmentId);
  return { ok: true };
});
