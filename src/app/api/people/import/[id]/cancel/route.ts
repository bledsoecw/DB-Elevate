import { handler } from '@/server/api';
import { cancelImportBatch } from '@/server/services/employee-import';

export const POST = handler(async ({ actor, params }) => {
  await cancelImportBatch(actor, params.id as string);
  return { ok: true };
});
