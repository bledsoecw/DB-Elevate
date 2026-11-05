import 'server-only';
import { prisma } from '../db';
import type { Role } from '@/lib/enums';
import { AuthRequiredError } from '../errors';
import { readSessionToken, resolveSession, touchSession, type ResolvedSession } from '../auth/session';

/**
 * Everything the authorization layer needs about the signed-in user, resolved
 * once per request. Structural facts (direct reports, the downward chain, the
 * upward chain) reflect the organization *as it is today*; historical review
 * access is resolved separately against ManagerAssignment history so that a
 * reorganization cannot retroactively open old reviews.
 * See docs/PERMISSIONS.md.
 */
export interface Actor {
  userId: string;
  sessionId: string;
  orgId: string;
  email: string;
  roles: Role[];

  employeeId: string | null;
  displayName: string;
  departmentId: string | null;
  jobTitleId: string | null;

  isSysAdmin: boolean;
  isHrAdmin: boolean;
  isLeadership: boolean;
  /** Structural: true when the employee currently has at least one direct report. */
  isManager: boolean;

  /** Current direct reports. */
  directReportIds: string[];
  /** Current full downward chain, excluding the actor. */
  descendantIds: string[];
  /** Current upward chain from the actor's manager to the top, excluding the actor. */
  managerChainIds: string[];

  org: {
    id: string;
    name: string;
    productName: string;
    brandPrimaryHex: string;
    brandAccentHex: string;
    logoUrl: string | null;
    wordmarkText: string | null;
    surveyMinResponses: number;
    surveySuppressComplement: boolean;
    peerReviewMinForAggregate: number;
    aiEnabled: boolean;
    aiProvider: string;
    timezone: string;
  };
}

type EdgeRow = { id: string; managerId: string | null };

/**
 * Builds the reporting graph for the organization in a single query and walks
 * it in memory. At the scale this product targets (one construction company,
 * hundreds of employees) this is far cheaper than repeated recursive queries.
 * For tens of thousands of employees, replace with a recursive CTE — see
 * docs/ARCHITECTURE.md ("Scaling the reporting graph").
 */
export async function loadReportingGraph(orgId: string): Promise<{
  edges: EdgeRow[];
  childrenOf: Map<string | null, string[]>;
  managerOf: Map<string, string | null>;
}> {
  const edges = await prisma.employee.findMany({
    where: { orgId },
    select: { id: true, managerId: true },
  });
  const childrenOf = new Map<string | null, string[]>();
  const managerOf = new Map<string, string | null>();
  for (const e of edges) {
    managerOf.set(e.id, e.managerId);
    const list = childrenOf.get(e.managerId) ?? [];
    list.push(e.id);
    childrenOf.set(e.managerId, list);
  }
  return { edges, childrenOf, managerOf };
}

export function collectDescendants(
  rootId: string,
  childrenOf: Map<string | null, string[]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [...(childrenOf.get(rootId) ?? [])];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue; // guards against a cycle introduced by bad data
    seen.add(id);
    out.push(id);
    for (const child of childrenOf.get(id) ?? []) {
      if (!seen.has(child)) queue.push(child);
    }
  }
  return out;
}

export function collectManagerChain(
  startId: string,
  managerOf: Map<string, string | null>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([startId]);
  let cursor = managerOf.get(startId) ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    out.push(cursor);
    cursor = managerOf.get(cursor) ?? null;
  }
  return out;
}

export async function actorFromSession(session: ResolvedSession): Promise<Actor> {
  const roles = session.user.roles.map((r) => r.role as Role);
  const employee = session.user.employee;
  const orgId = session.user.orgId;

  let directReportIds: string[] = [];
  let descendantIds: string[] = [];
  let managerChainIds: string[] = [];

  if (employee) {
    const { childrenOf, managerOf } = await loadReportingGraph(orgId);
    directReportIds = childrenOf.get(employee.id) ?? [];
    descendantIds = collectDescendants(employee.id, childrenOf);
    managerChainIds = collectManagerChain(employee.id, managerOf);
  }

  const org = session.user.org;

  return {
    userId: session.user.id,
    sessionId: session.id,
    orgId,
    email: session.user.email,
    roles,
    employeeId: employee?.id ?? null,
    displayName: employee
      ? `${employee.preferredName ?? employee.firstName} ${employee.lastName}`
      : session.user.email,
    departmentId: employee?.departmentId ?? null,
    jobTitleId: employee?.jobTitleId ?? null,
    isSysAdmin: roles.includes('SYS_ADMIN'),
    isHrAdmin: roles.includes('HR_ADMIN'),
    isLeadership: roles.includes('LEADERSHIP'),
    isManager: directReportIds.length > 0,
    directReportIds,
    descendantIds,
    managerChainIds,
    org: {
      id: org.id,
      name: org.name,
      productName: org.productName,
      brandPrimaryHex: org.brandPrimaryHex,
      brandAccentHex: org.brandAccentHex,
      logoUrl: org.logoUrl,
      wordmarkText: org.wordmarkText,
      surveyMinResponses: org.surveyMinResponses,
      surveySuppressComplement: org.surveySuppressComplement,
      peerReviewMinForAggregate: org.peerReviewMinForAggregate,
      aiEnabled: org.aiEnabled,
      aiProvider: org.aiProvider,
      timezone: org.timezone,
    },
  };
}

/** Returns the actor, or null when there is no valid session. */
export async function getActor(): Promise<Actor | null> {
  const token = await readSessionToken();
  const session = await resolveSession(token);
  if (!session) return null;
  void touchSession(session.id);
  return actorFromSession(session);
}

/** Returns the actor or throws 401. Use in every API route and protected page. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthRequiredError();
  return actor;
}

/**
 * Resolves the manager chain for an employee *as it stood on a given date*,
 * using the append-only ManagerAssignment history. This is what historical
 * review access is checked against.
 */
export async function managerChainAt(employeeId: string, at: Date): Promise<string[]> {
  const rows = await prisma.managerAssignment.findMany({
    where: { effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: 'desc' },
    select: { employeeId: true, managerId: true, effectiveFrom: true, effectiveTo: true },
  });

  // Latest assignment in effect at `at`, per employee.
  const managerAt = new Map<string, string | null>();
  for (const r of rows) {
    if (managerAt.has(r.employeeId)) continue;
    if (r.effectiveTo && r.effectiveTo.getTime() <= at.getTime()) continue;
    managerAt.set(r.employeeId, r.managerId);
  }

  const chain: string[] = [];
  const seen = new Set<string>([employeeId]);
  let cursor = managerAt.get(employeeId) ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = managerAt.get(cursor) ?? null;
  }
  return chain;
}
