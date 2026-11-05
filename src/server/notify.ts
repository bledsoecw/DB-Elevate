import 'server-only';
import { prisma, type Db } from './db';

/**
 * In-app notifications plus the e-mail outbox.
 *
 * Both are written through one function so a notification and its e-mail can
 * never drift apart, and so both share the same idempotency key. Nothing is
 * sent to a real mail server unless the organization's `emailProvider` is
 * configured away from `outbox`; in development every message lands in
 * /admin/outbox instead. See docs/DEPLOYMENT.md ("E-mail").
 */

export interface NotifyInput {
  orgId: string;
  recipientEmployeeId: string;
  type: string;
  title: string;
  body?: string;
  linkUrl?: string;
  severity?: 'info' | 'warning' | 'urgent';
  /** Idempotency key. A repeated call with the same key is a no-op. */
  dedupeKey?: string;
  /** Also queue an e-mail. Defaults to false; in-app only. */
  email?: { subject: string; text: string } | false;
}

export async function notify(input: NotifyInput, db: Db = prisma): Promise<void> {
  const dedupeKey = input.dedupeKey ?? null;

  try {
    if (dedupeKey) {
      const existing = await db.notification.findFirst({
        where: { recipientEmployeeId: input.recipientEmployeeId, dedupeKey },
        select: { id: true },
      });
      if (existing) return;
    }

    await db.notification.create({
      data: {
        orgId: input.orgId,
        recipientEmployeeId: input.recipientEmployeeId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        linkUrl: input.linkUrl ?? null,
        severity: input.severity ?? 'info',
        dedupeKey,
      },
    });
  } catch (err) {
    // Unique constraint race on (recipient, dedupeKey) is the expected
    // collision and means the notification already exists.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('Unique constraint')) {
      console.error('[notify] failed', input.type, input.recipientEmployeeId, message);
    }
    return;
  }

  if (input.email) {
    await queueEmail(
      {
        orgId: input.orgId,
        employeeId: input.recipientEmployeeId,
        subject: input.email.subject,
        text: input.email.text,
        relatedType: input.type,
        relatedId: input.recipientEmployeeId,
        dedupeKey: dedupeKey ? `email:${dedupeKey}` : undefined,
      },
      db,
    );
  }
}

export async function notifyMany(inputs: NotifyInput[], db: Db = prisma): Promise<void> {
  for (const input of inputs) {
    await notify(input, db);
  }
}

export interface QueueEmailInput {
  orgId: string;
  employeeId?: string;
  toEmail?: string;
  toName?: string;
  subject: string;
  text: string;
  html?: string;
  relatedType?: string;
  relatedId?: string;
  dedupeKey?: string;
}

/**
 * Writes a message to the outbox. Delivery is a separate step (scripts/run-jobs
 * or the admin "send queued" action), so a page render never blocks on SMTP and
 * a failed send is visible and retryable.
 */
export async function queueEmail(input: QueueEmailInput, db: Db = prisma): Promise<void> {
  let toEmail = input.toEmail ?? null;
  let toName = input.toName ?? null;

  if (!toEmail && input.employeeId) {
    const employee = await db.employee.findUnique({
      where: { id: input.employeeId },
      select: { workEmail: true, firstName: true, lastName: true, employmentStatus: true },
    });
    if (!employee) return;
    // Never queue mail to a deactivated person.
    if (employee.employmentStatus === 'terminated') return;
    toEmail = employee.workEmail;
    toName = `${employee.firstName} ${employee.lastName}`;
  }
  if (!toEmail) return;

  const org = await db.organization.findUnique({
    where: { id: input.orgId },
    select: { emailProvider: true },
  });

  try {
    await db.emailMessage.create({
      data: {
        orgId: input.orgId,
        toEmail,
        toName,
        subject: input.subject,
        textBody: input.text,
        htmlBody: input.html ?? null,
        provider: org?.emailProvider ?? 'outbox',
        status: 'QUEUED',
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('Unique constraint')) {
      console.error('[email] failed to queue', input.subject, message);
    }
  }
}

export async function unreadNotificationCount(employeeId: string): Promise<number> {
  return prisma.notification.count({ where: { recipientEmployeeId: employeeId, readAt: null } });
}
