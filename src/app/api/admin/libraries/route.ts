import { handler, parseBody } from '@/server/api';
import { CompetencyLibrarySchema } from '@/server/validation/admin';
import { createLibrary, listLibraries } from '@/server/services/catalog';

export const GET = handler(async ({ actor }) => {
  const libraries = await listLibraries(actor);
  return { libraries };
});

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, CompetencyLibrarySchema);
  const library = await createLibrary(actor, body);
  return { id: library.id };
});
