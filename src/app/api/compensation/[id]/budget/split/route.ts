import { handler } from '@/server/api';
import { splitBudgetByPayroll } from '@/server/services/compensation';

/** Divides the pool between managers by payroll. Overwrites existing budgets. */
export const POST = handler(async ({ actor, params }) =>
  splitBudgetByPayroll(actor, params.id as string),
);
