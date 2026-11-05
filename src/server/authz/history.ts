import 'server-only';
import { prisma } from '../db';

/**
 * Batched access to historical reporting lines.
 *
 * `managerChainAt` in actor.ts answers one question with one query, which is
 * right for a single record. A list of participants needs the same answer
 * dozens of times at different dates, so this loads the append-only
 * ManagerAssignment history once and answers from memory.
 */
export interface ManagerHistory {
  /** The manager in effect for an employee on a given date, or null. */
  managerAt(employeeId: string, at: Date): string | null;
  /** The full upward chain on a given date, excluding the employee. */
  chainAt(employeeId: string, at: Date): string[];
}

interface Row {
  employeeId: string;
  managerId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export async function loadManagerHistory(orgId: string): Promise<ManagerHistory> {
  const rows: Row[] = await prisma.managerAssignment.findMany({
    where: { employee: { orgId } },
    select: { employeeId: true, managerId: true, effectiveFrom: true, effectiveTo: true },
    orderBy: { effectiveFrom: 'desc' },
  });

  // Fall back to the current reporting line for anyone with no history rows,
  // so a record created before history tracking still resolves.
  const current = await prisma.employee.findMany({
    where: { orgId },
    select: { id: true, managerId: true },
  });
  const currentManager = new Map(current.map((e) => [e.id, e.managerId]));

  const byEmployee = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId, list);
  }

  function managerAt(employeeId: string, at: Date): string | null {
    const history = byEmployee.get(employeeId);
    if (!history || history.length === 0) return currentManager.get(employeeId) ?? null;
    const t = at.getTime();
    for (const r of history) {
      const from = r.effectiveFrom.getTime();
      const to = r.effectiveTo ? r.effectiveTo.getTime() : Number.POSITIVE_INFINITY;
      if (t >= from && t < to) return r.managerId;
    }
    // Before the earliest recorded assignment: use the earliest one, which is
    // the closest honest answer to "who did they report to then".
    return history[history.length - 1]?.managerId ?? null;
  }

  function chainAt(employeeId: string, at: Date): string[] {
    const chain: string[] = [];
    const seen = new Set<string>([employeeId]);
    let cursor = managerAt(employeeId, at);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      chain.push(cursor);
      cursor = managerAt(cursor, at);
    }
    return chain;
  }

  return { managerAt, chainAt };
}
