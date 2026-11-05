import { handler, parseBody } from '@/server/api';
import { CompetencySchema } from '@/server/validation/admin';
import { createCompetency, listCompetencies } from '@/server/services/catalog';

export const GET = handler(async ({ actor }) => {
  const competencies = await listCompetencies(actor);
  return { competencies };
});

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, CompetencySchema);
  const competency = await createCompetency(actor, body);
  return { id: competency.id };
});
