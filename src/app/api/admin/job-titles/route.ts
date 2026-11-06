import { handler, parseBody } from '@/server/api';
import { JobTitleSchema } from '@/server/validation/admin';
import { createJobTitle, listJobTitles } from '@/server/services/catalog';

export const GET = handler(async ({ actor }) => {
  const jobTitles = await listJobTitles(actor);
  return { jobTitles };
});

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, JobTitleSchema);
  const jobTitle = await createJobTitle(actor, body);
  return { id: jobTitle.id };
});
