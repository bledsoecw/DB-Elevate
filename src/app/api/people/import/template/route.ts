import { csvResponse, handler } from '@/server/api';
import { importTemplateCsv, IMPORT_FIELDS } from '@/server/services/employee-import';
import { ForbiddenError } from '@/server/errors';

/** A starter file with the expected headers and one example row. */
export const GET = handler(async ({ actor }) => {
  if (!actor.isHrAdmin) throw new ForbiddenError('Only an HR administrator can import employees.');
  const [headerLine, exampleLine] = importTemplateCsv().trim().split('\r\n');
  return csvResponse('db-elevate-employee-import-template.csv', [
    (headerLine ?? '').split(','),
    (exampleLine ?? '').split(','),
    [],
    ['# Required columns:', IMPORT_FIELDS.filter((f) => f.required).map((f) => f.label).join(' / ')],
  ]);
});
