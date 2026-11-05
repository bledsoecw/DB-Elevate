import { NextResponse } from 'next/server';
import { publicHandler, requestMeta } from '@/server/api';
import { clearSessionCookie, readSessionToken, resolveSession, revokeSession } from '@/server/auth/session';
import { AUDIT_ACTIONS, recordAudit } from '@/server/audit';

/** Revokes the server-side session and clears the cookie. */
export const POST = publicHandler(async ({ request }) => {
  const token = await readSessionToken();
  const session = await resolveSession(token);

  if (session) {
    const employee = session.user.employee;
    await recordAudit(
      {
        orgId: session.user.orgId,
        userId: session.user.id,
        employeeId: employee?.id ?? null,
        displayName: employee ? `${employee.firstName} ${employee.lastName}` : session.user.email,
      },
      {
        action: AUDIT_ACTIONS.LOGOUT,
        entityType: 'user',
        entityId: session.user.id,
        summary: 'Signed out.',
        ...requestMeta(request),
      },
    );
  }

  await revokeSession(token);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
