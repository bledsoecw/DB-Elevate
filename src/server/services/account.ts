import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { hashPassword, passwordProblems, verifyPassword } from '../auth/password';

/**
 * A person's own account: their details, their password, and their sessions.
 *
 * Everything here is scoped to the signed-in user by construction — the actor's
 * own id is used, never an id from the request — so there is no object to
 * authorize and no way to address somebody else's account through these
 * functions.
 */

export async function getOwnAccount(actor: Actor) {
  const user = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: {
      id: true,
      email: true,
      status: true,
      mustChangePassword: true,
      passwordHash: true,
      lastLoginAt: true,
      createdAt: true,
      roles: { select: { role: true, grantedAt: true } },
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          workEmail: true,
          workPhone: true,
          employeeNumber: true,
          hireDate: true,
          employmentType: true,
          workLocation: true,
          crew: true,
          jobTitle: { select: { name: true, level: true } },
          department: { select: { name: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!user) throw new NotFoundError();

  const sessions = await prisma.session.findMany({
    where: { userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      ip: true,
      userAgent: true,
    },
  });

  return {
    user,
    sessions: sessions.map((s) => ({
      ...s,
      isCurrent: s.id === actor.sessionId,
      device: describeUserAgent(s.userAgent),
    })),
    hasPassword: user.passwordHash !== null,
  };
}

/**
 * Turns a user-agent string into something a person can recognize. Deliberately
 * coarse: the point is "is this me on my phone", not fingerprinting.
 */
function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua) && !/Chrome/.test(ua)
          ? 'Safari'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : 'Browser';
  const platform = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown platform';
  return `${browser} on ${platform}`;
}

/**
 * Changes the signed-in user's own password.
 *
 * The current password is required even though there is already a valid
 * session: it is what stops someone who walked up to an unlocked machine from
 * locking the real owner out. Every other session is revoked, because a
 * password change is also how a person responds to suspecting one is not
 * theirs — the session doing the changing is kept so they are not signed out
 * mid-action.
 */
export async function changeOwnPassword(
  actor: Actor,
  currentPassword: string,
  newPassword: string,
): Promise<{ otherSessionsEnded: number }> {
  const user = await prisma.user.findFirst({
    where: { id: actor.userId, orgId: actor.orgId },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!user) throw new NotFoundError();

  if (!user.passwordHash) {
    throw new ConflictError(
      'This account signs in through an external identity provider, so there is no password to change here.',
    );
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    throw new ValidationError('That is not your current password.', [
      { path: 'currentPassword', message: 'This does not match your current password.' },
    ]);
  }

  const problems = passwordProblems(newPassword);
  if (problems.length > 0) {
    throw new ValidationError(problems.join(' '), [
      { path: 'newPassword', message: problems.join(' ') },
    ]);
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new ValidationError('That is already your password. Choose a different one.', [
      { path: 'newPassword', message: 'Choose a password you are not already using.' },
    ]);
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // Keep this session; end the rest.
    return tx.session.updateMany({
      where: { userId: user.id, id: { not: actor.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entityType: 'user',
    entityId: user.id,
    // The password itself is never recorded, here or anywhere.
    summary: `Changed their own password; ${result.count} other session(s) ended`,
    metadata: { otherSessionsEnded: result.count },
  });

  return { otherSessionsEnded: result.count };
}

/** Ends one of the user's own sessions. */
export async function revokeOwnSession(actor: Actor, sessionId: string): Promise<void> {
  if (sessionId === actor.sessionId) {
    throw new ValidationError(
      'That is the session you are using now. Sign out from the menu instead.',
    );
  }
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId: actor.userId },
    select: { id: true },
  });
  // Scoped to the actor's own user id, so another person's session is simply
  // not found rather than refused.
  if (!session) throw new NotFoundError();

  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });

  await recordAudit(actor, {
    action: 'auth.session.revoked',
    entityType: 'user',
    entityId: actor.userId,
    summary: 'Ended one of their other sessions',
  });
}

/** Ends every session except the current one. */
export async function revokeOtherSessions(actor: Actor): Promise<{ ended: number }> {
  const result = await prisma.session.updateMany({
    where: { userId: actor.userId, id: { not: actor.sessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAudit(actor, {
    action: 'auth.session.revoked',
    entityType: 'user',
    entityId: actor.userId,
    summary: `Ended ${result.count} other session(s)`,
  });
  return { ended: result.count };
}

/**
 * The one detail a person may change about themselves. Everything else on a
 * personnel record — name, job title, department, manager — is changed by HR,
 * because those fields drive who can see what and a self-service edit to them
 * would be a self-service permission change.
 */
export async function updateOwnContact(
  actor: Actor,
  input: { workPhone?: string | null; preferredName?: string | null },
): Promise<void> {
  if (!actor.employeeId) {
    throw new ForbiddenError('This account has no employee record attached.');
  }
  await prisma.employee.update({
    where: { id: actor.employeeId },
    data: {
      workPhone: input.workPhone === undefined ? undefined : input.workPhone?.trim() || null,
      preferredName:
        input.preferredName === undefined ? undefined : input.preferredName?.trim() || null,
    },
  });
  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
    entityType: 'employee',
    entityId: actor.employeeId,
    summary: 'Updated their own preferred name or phone number',
  });
}
