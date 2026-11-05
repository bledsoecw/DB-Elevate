import 'server-only';
import { prisma } from '../db';
import { AUDIT_ACTIONS, recordAudit, recordSystemAudit } from '../audit';
import type { VerifiedIdentity } from './google-claims';
import type { SsoConfig } from './sso-config';

/**
 * Turning a verified Google identity into a session.
 *
 * The identity is already proven at this point: the token was signed by
 * Google, issued for this application, answers this sign-in attempt, and
 * belongs to the right Workspace. What is left is matching it to an account
 * here, which is where the interesting failure modes are.
 */

export type SsoSignInResult =
  | { ok: true; userId: string; mustChangePassword: boolean; hasEmployeeRecord: boolean }
  | { ok: false; code: string; message: string };

/**
 * Matches by Google's subject first, then by e-mail address.
 *
 * Subject first because it is stable: somebody who changes their name, and
 * with it their address, keeps the same account here. E-mail second, so that
 * an account created by HR before the person has ever signed in can be
 * claimed on their first attempt.
 */
export async function signInWithGoogle(
  identity: VerifiedIdentity,
  config: SsoConfig,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<SsoSignInResult> {
  const bySubject = await prisma.user.findFirst({
    where: { externalIdpSubject: identity.subject },
    include: { employee: { select: { id: true, firstName: true, lastName: true } } },
  });

  const byEmail = await prisma.user.findFirst({
    where: { email: identity.email },
    include: { employee: { select: { id: true, firstName: true, lastName: true } } },
  });

  let user = bySubject ?? byEmail;

  /*
   * The address matches an account, but that account is already bound to a
   * DIFFERENT Google subject.
   *
   * This is what a recycled address looks like: alice@ leaves, her Workspace
   * account is deleted, and months later a new Alice is given the same
   * address. Google issues her a new subject. Matching on address alone would
   * hand her the former Alice's account here — her reviews, her pay history,
   * and whatever her manager wrote about her.
   *
   * So it is refused, loudly and on the record, and an administrator has to
   * unlink the account deliberately.
   */
  if (!bySubject && byEmail && byEmail.externalIdpSubject) {
    await recordSystemAudit(byEmail.orgId, {
      action: AUDIT_ACTIONS.SSO_REFUSED,
      entityType: 'user',
      entityId: byEmail.id,
      summary:
        `Refused a single sign-on attempt for ${identity.email}: the address matches an account that is ` +
        `already linked to a different Google account. This is what a reused address looks like.`,
      metadata: {
        reason: 'subject_mismatch',
        boundSubject: byEmail.externalIdpSubject,
        presentedSubject: identity.subject,
        ip: meta.ip ?? null,
      },
    });
    return {
      ok: false,
      code: 'sso_subject_mismatch',
      message:
        'This address is linked to a different Google account. If your Workspace account was recreated, ' +
        'a system administrator has to unlink the old one before you can sign in.',
    };
  }

  if (!user) {
    if (!config.autoProvision) {
      return {
        ok: false,
        code: 'sso_no_account',
        message:
          'Your Google sign-in worked, but there is no account here for that address yet. ' +
          'Ask an HR administrator to add you.',
      };
    }
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!org) {
      return { ok: false, code: 'sso_no_org', message: 'This installation has no organization yet.' };
    }
    const created = await prisma.user.create({
      data: {
        orgId: org.id,
        email: identity.email,
        // No password at all. An SSO-only account has nothing to guess.
        passwordHash: null,
        status: 'active',
        externalIdpSubject: identity.subject,
        roles: { create: { role: 'EMPLOYEE' } },
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    await recordSystemAudit(org.id, {
      action: AUDIT_ACTIONS.SSO_PROVISIONED,
      entityType: 'user',
      entityId: created.id,
      summary: `Created an account for ${identity.email} on first single sign-on (automatic provisioning is on).`,
      metadata: { via: 'sso', domain: identity.domain },
    });
    user = created;
  }

  if (user.status !== 'active') {
    return {
      ok: false,
      code: 'account_inactive',
      message:
        'This account is no longer active. Contact your HR administrator if you believe that is wrong.',
    };
  }

  // First successful sign-in for an account HR created in advance: bind it to
  // this Google subject so later sign-ins match on the stable identifier.
  if (!user.externalIdpSubject) {
    await prisma.user.update({
      where: { id: user.id },
      data: { externalIdpSubject: identity.subject },
    });
    await recordSystemAudit(user.orgId, {
      action: AUDIT_ACTIONS.SSO_LINKED,
      entityType: 'user',
      entityId: user.id,
      summary: `Linked ${user.email} to their Google Workspace account on first single sign-on.`,
      metadata: { domain: identity.domain },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

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
      summary: `Signed in with Google Workspace (${identity.domain}).`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  );

  return {
    ok: true,
    userId: user.id,
    // An SSO account has no password to change, whatever the flag says.
    mustChangePassword: user.passwordHash !== null && user.mustChangePassword,
    hasEmployeeRecord: Boolean(user.employee),
  };
}
