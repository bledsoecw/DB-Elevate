import 'server-only';
import { prisma } from '../db';

/**
 * E-mail delivery.
 *
 * Everything the application wants to send is written to the `EmailMessage`
 * table first (see notify.ts) and delivered later by the job runner. That split
 * is deliberate: a page render never blocks on SMTP, a failed send is visible
 * and retryable rather than lost in a log, and — most importantly — the default
 * transport sends nothing at all.
 *
 * The guard that matters is `EMAIL_TRANSPORT_CONFIGURED`. A real transport is
 * only ever selected when that is `true` in the server environment *and* the
 * organization has chosen a provider. Neither alone is enough. This means a
 * development or demonstration installation cannot send mail to a real employee
 * even if somebody changes the setting in the interface, which is the whole
 * point: during development nothing goes to a live address without an explicit,
 * deliberate, server-side decision.
 */

export interface OutgoingMessage {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  textBody: string;
  htmlBody: string | null;
}

export type SendResult =
  | { status: 'SENT' }
  | { status: 'FAILED'; error: string }
  | { status: 'SUPPRESSED'; error: string };

export interface Transport {
  readonly name: string;
  /** False when the transport exists but is not usable in this environment. */
  readonly ready: boolean;
  send(message: OutgoingMessage, from: string): Promise<SendResult>;
}

/**
 * The default. Keeps the message in the database and reports honestly that it
 * was not delivered, rather than marking it SENT and leaving somebody to
 * believe an employee was told something.
 */
const outboxTransport: Transport = {
  name: 'outbox',
  ready: true,
  async send() {
    return {
      status: 'SUPPRESSED',
      error:
        'Held in the local outbox. No mail transport is active, so nothing was sent to a real address.',
    };
  },
};

/**
 * SMTP. Intentionally not implemented with a vendored client: adding one would
 * mean this installation could send live mail the moment somebody set four
 * environment variables, and the brief was that live employee messaging waits
 * for explicit authorization.
 *
 * To enable it, add a mailer (nodemailer or equivalent), implement `send`
 * below, and set EMAIL_TRANSPORT_CONFIGURED=true. The contract is small on
 * purpose — see docs/DEPLOYMENT.md ("E-mail").
 */
const smtpTransport: Transport = {
  name: 'smtp',
  ready: false,
  async send() {
    return {
      status: 'FAILED',
      error:
        'SMTP is selected but no mail client is installed in this build. See docs/DEPLOYMENT.md ("E-mail") ' +
        'for the one function to implement. The message stays queued and can be retried.',
    };
  },
};

const TRANSPORTS: Record<string, Transport> = {
  outbox: outboxTransport,
  smtp: smtpTransport,
  ses: { ...smtpTransport, name: 'ses' },
  sendgrid: { ...smtpTransport, name: 'sendgrid' },
};

export function transportConfigured(): boolean {
  return process.env.EMAIL_TRANSPORT_CONFIGURED === 'true';
}

/**
 * Resolves the transport for an organization. Falls back to the outbox whenever
 * the environment has not explicitly authorized delivery, so the safe path is
 * the default path and not something an operator has to remember.
 */
export async function transportFor(orgId: string): Promise<{
  transport: Transport;
  from: string;
  fellBack: boolean;
}> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { emailProvider: true, emailFromName: true, emailFromAddr: true },
  });

  const from = org ? `${org.emailFromName} <${org.emailFromAddr}>` : 'DB Elevate <no-reply@localhost>';
  const requested = org?.emailProvider ?? 'outbox';

  if (requested === 'outbox') return { transport: outboxTransport, from, fellBack: false };

  if (!transportConfigured()) {
    return { transport: outboxTransport, from, fellBack: true };
  }

  const transport = TRANSPORTS[requested];
  if (!transport || !transport.ready) {
    return { transport: TRANSPORTS[requested] ?? outboxTransport, from, fellBack: true };
  }
  return { transport, from, fellBack: false };
}

/**
 * Delivers up to `limit` queued messages for one organization.
 *
 * Each message is claimed with a conditional update before it is sent, so two
 * runners racing on the same queue cannot both send the same message. A claim
 * that loses the race simply moves on.
 */
export async function deliverQueued(
  orgId: string,
  limit = 50,
): Promise<{ sent: number; failed: number; suppressed: number; skipped: number }> {
  const { transport, from, fellBack } = await transportFor(orgId);

  const queued = await prisma.emailMessage.findMany({
    where: { orgId, status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      toEmail: true,
      toName: true,
      subject: true,
      textBody: true,
      htmlBody: true,
    },
  });

  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let skipped = 0;

  for (const message of queued) {
    // Claim it. `status: 'QUEUED'` in the filter is the lock.
    const claim = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: 'QUEUED' },
      data: { status: 'SENDING' },
    });
    if (claim.count === 0) {
      skipped += 1;
      continue;
    }

    const result = await transport.send(message, from);

    await prisma.emailMessage.update({
      where: { id: message.id },
      data: {
        status: result.status,
        provider: transport.name,
        error:
          result.status === 'SENT'
            ? null
            : fellBack
              ? `${result.error} (the organization asked for ${transport.name}, but the server has no mail transport configured)`
              : result.error,
        sentAt: result.status === 'SENT' ? new Date() : null,
      },
    });

    if (result.status === 'SENT') sent += 1;
    else if (result.status === 'FAILED') failed += 1;
    else suppressed += 1;
  }

  return { sent, failed, suppressed, skipped };
}
