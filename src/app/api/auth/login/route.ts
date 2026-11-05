import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { parseBody, publicHandler, requestMeta } from '@/server/api';
import { AppError } from '@/server/errors';
import { verifyPassword } from '@/server/auth/password';
import { createSession, setSessionCookie } from '@/server/auth/session';
import { passwordLoginAllowed } from '@/server/auth/sso';
import { AUDIT_ACTIONS, recordAudit, recordSystemAudit } from '@/server/audit';

const LoginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your work e-mail address.').max(320),
  password: z.string().min(1, 'Enter your password.').max(1024),
});

/**
 * A syntactically valid hash that matches nothing, verified against whenever
 * there is no real hash to check. Keeps the time spent on a failure roughly
 * constant whether the address is unknown, or known but single-sign-on only.
 */
const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';

/** Lockout after repeated failures, to make password guessing impractical. */
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

/**
 * Password sign-in.
 *
 * The same message is returned for an unknown address and a wrong password, so
 * the endpoint cannot be used to enumerate who works here. A failed attempt
 * still costs a password verification, so the response time does not reveal
 * whether the account exists.
 */
export const POST = publicHandler(async ({ request }) => {
  // Refused here, not merely hidden on the sign-in page. "Only our Google
  // Workspace accounts can sign in" is a property of this endpoint or it is
  // not a property of anything — a hidden form is still a form anybody can
  // POST to.
  if (!passwordLoginAllowed()) {
    throw new AppError(
      'Password sign-in is turned off for this installation. Use the Google Workspace button on the sign-in page.',
      403,
      'password_login_disabled',
    );
  }

  const { email, password } = await parseBody(request, LoginSchema);
  const meta = requestMeta(request);
  const normalizedEmail = email.toLowerCase();

  const user = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail } },
    include: { employee: { select: { id: true, firstName: true, lastName: true } }, org: true },
  });

  const genericFailure = new AppError(
    'That e-mail address and password do not match an active account.',
    401,
    'invalid_credentials',
  );

  if (!user) {
    // Burn comparable time so timing does not distinguish the two cases.
    await verifyPassword(password, DUMMY_HASH);
    throw genericFailure;
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    throw new AppError(
      `Too many failed sign-in attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or ask an administrator to reset your password.`,
      429,
      'account_locked',
    );
  }

  if (user.passwordHash === null) {
    /*
     * An account provisioned for single sign-on has no password to be wrong.
     *
     * It would be friendlier to say "use the Google button" — and that is
     * exactly the message that turns this endpoint into an address checker.
     * An attacker could sort a list of guessed addresses into "has an account
     * here" and "does not" without ever guessing a password. So this takes the
     * same generic failure and the same spent time as an unknown address, and
     * the guidance lives on the sign-in page, where it costs nothing to say it
     * to everybody at once.
     */
    await verifyPassword(password, DUMMY_HASH);
    throw genericFailure;
  }

  const ok = await verifyPassword(password, user.passwordHash);

  if (!ok) {
    const failures = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failures,
        lockedUntil:
          failures >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : null,
      },
    });
    await recordSystemAudit(user.orgId, {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'user',
      entityId: user.id,
      summary: `Failed sign-in attempt for ${user.email}.`,
      metadata: { attempt: failures, ip: meta.ip },
    });
    throw genericFailure;
  }

  if (user.status !== 'active') {
    // Deliberately specific: an employee who has been deactivated should be
    // told to talk to HR rather than left thinking they mistyped.
    throw new AppError(
      'This account is no longer active. Contact your HR administrator if you believe that is wrong.',
      403,
      'account_inactive',
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const { token, expiresAt } = await createSession(user.id, meta);
  await setSessionCookie(token, expiresAt);

  await recordAudit(
    {
      orgId: user.orgId,
      userId: user.id,
      employeeId: user.employee?.id ?? null,
      displayName: user.employee
        ? `${user.employee.firstName} ${user.employee.lastName}`
        : user.email,
    },
    {
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      entityType: 'user',
      entityId: user.id,
      summary: `Signed in.`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  );

  return NextResponse.json({
    ok: true,
    mustChangePassword: user.mustChangePassword,
    hasEmployeeRecord: Boolean(user.employee),
  });
});
