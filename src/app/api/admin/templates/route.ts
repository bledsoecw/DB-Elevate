import { handler, parseBody } from '@/server/api';
import { TemplateSchema } from '@/server/validation/admin';
import { createTemplate } from '@/server/services/templates';

export const POST = handler(async ({ actor, request }) => {
  const body = await parseBody(request, TemplateSchema);
  const template = await createTemplate(actor, body);
  return { id: template.id };
});
