import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '../db';

export const SESSION_COOKIE = 'dbe_session';
const SESSION_TTL_DAYS = 14;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Creates a server-side session row and returns the opaque cookie value.
 * Only the SHA-256 of the token is persisted, so a leaked database copy cannot
 * be replayed as a live session.
 */
export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 500) : null,
    },
  });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export type ResolvedSession = NonNullable<Awaited<ReturnType<typeof resolveSession>>>;

export async function resolveSession(token: string | null) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          roles: true,
          org: true,
          employee: { include: { department: true, jobTitle: true } },
        },
      },
    },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.status !== 'active') return null;
  return session;
}

export async function revokeSession(token: string | null): Promise<void> {
  if (!token) return;
  await prisma.session
    .updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    })
    .catch(() => undefined);
}

/** Called when an account is deactivated, suspended, or its password changes. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function touchSession(sessionId: string): Promise<void> {
  await prisma.session
    .updateMany({
      where: { id: sessionId, lastSeenAt: { lt: new Date(Date.now() - TOUCH_INTERVAL_MS) } },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => undefined);
}

export { sha256 as hashSessionToken };
