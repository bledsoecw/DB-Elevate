import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Inbox, MailWarning } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listOutbox } from '@/server/services/admin';
import { ActionButton } from '@/components/ui/action-button';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Grid,
  LinkTabs,
  PageHeader,
  StatTile,
} from '@/components/ui/primitives';
import { countLabel, formatDateTime } from '@/lib/utils';

export const metadata = { title: 'E-mail outbox' };

const STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SUPPRESSED'] as const;
type OutboxStatus = (typeof STATUSES)[number];

export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.isSysAdmin) redirect('/admin');

  const { status } = await searchParams;
  const filter = STATUSES.includes(status as OutboxStatus) ? (status as OutboxStatus) : undefined;

  const { messages, counts, provider, from, transportConfigured } = await listOutbox(actor, filter);
  const local = provider === 'outbox';

  const tabs = [
    { key: 'all', label: 'All', href: '/admin/outbox' },
    ...STATUSES.map((s) => ({
      key: s,
      label: s.charAt(0) + s.slice(1).toLowerCase(),
      href: `/admin/outbox?status=${s}`,
      count: counts[s] ?? 0,
    })),
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'E-mail outbox' }]}
        title="E-mail outbox"
        description="Every message the application would send, with its full text. Reading it here is how you check the wording before a single message leaves the building."
        actions={
          (counts.QUEUED ?? 0) > 0 ? (
            <ActionButton
              endpoint="/api/admin/outbox/discard"
              variant="secondary"
              successMessage="Queued messages discarded. None were sent."
              confirm={{
                title: 'Discard the queued messages?',
                description: `${countLabel(counts.QUEUED ?? 0, 'message')} will be marked suppressed and never sent. They are kept for the record rather than deleted, and they will not be re-queued.`,
                confirmLabel: 'Discard them',
                tone: 'danger',
              }}
            >
              Discard queued
            </ActionButton>
          ) : undefined
        }
      />

      {local ? (
        <Alert tone="info" className="mb-5 max-w-4xl" title="Nothing is being sent">
          Delivery is set to the local outbox, so messages are written here and go nowhere. No mail
          server is contacted, no address is touched, and no employee receives anything. This is the
          default, and it is the right setting until someone has decided the wording is correct and
          approved real delivery. To change it, configure a transport on the server and then pick a
          provider in{' '}
          <Link href="/admin/system" className="font-medium underline">
            Organization settings
          </Link>
          .
        </Alert>
      ) : (
        <Alert tone="warning" className="mb-5 max-w-4xl" title={`Live delivery via ${provider}`}>
          Messages queued here will be delivered to real addresses by the scheduled job runner. From:{' '}
          <span className="font-mono text-xs">{from}</span>
        </Alert>
      )}

      <Grid cols={4} className="mb-6">
        <StatTile
          label="Queued"
          value={counts.QUEUED ?? 0}
          tone={(counts.QUEUED ?? 0) > 0 ? (local ? 'neutral' : 'warning') : 'neutral'}
          hint={local ? 'Will stay queued; nothing sends.' : 'Awaiting the next job run.'}
        />
        <StatTile label="Sent" value={counts.SENT ?? 0} tone="success" />
        <StatTile
          label="Failed"
          value={counts.FAILED ?? 0}
          tone={(counts.FAILED ?? 0) > 0 ? 'danger' : 'neutral'}
        />
        <StatTile label="Suppressed" value={counts.SUPPRESSED ?? 0} hint="Discarded, or no address." />
        {(counts.SENDING ?? 0) > 0 && (
          <StatTile
            label="Stuck sending"
            value={counts.SENDING ?? 0}
            tone="danger"
            hint="A job runner claimed these and did not finish. Investigate before re-queueing."
          />
        )}
      </Grid>

      <LinkTabs tabs={tabs} current={filter ?? 'all'} className="mb-5" />

      {messages.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            title={filter ? `No ${filter.toLowerCase()} messages` : 'The outbox is empty'}
            description="Messages appear here when a cycle launches, a reminder is due, a review is released, or a survey opens."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Card key={m.id}>
              <CardHeader
                level={3}
                title={m.subject}
                description={
                  <span className="text-xs">
                    To {m.toName ? `${m.toName} <${m.toEmail}>` : m.toEmail} ·{' '}
                    {formatDateTime(m.createdAt)}
                    {m.sentAt && <> · sent {formatDateTime(m.sentAt)}</>}
                  </span>
                }
                actions={
                  <>
                    {m.relatedType && (
                      <Badge tone="neutral" className="font-mono text-[11px]">
                        {m.relatedType}
                      </Badge>
                    )}
                    <Badge
                      tone={
                        m.status === 'SENT'
                          ? 'success'
                          : m.status === 'FAILED'
                            ? 'danger'
                            : m.status === 'SUPPRESSED'
                              ? 'neutral'
                              : 'info'
                      }
                    >
                      {m.status.charAt(0) + m.status.slice(1).toLowerCase()}
                    </Badge>
                  </>
                }
              />
              <CardBody>
                {m.error && (
                  <p className="mb-2 flex items-start gap-1.5 text-xs text-rose-700">
                    <MailWarning aria-hidden className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                    <span>{m.error}</span>
                  </p>
                )}
                <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                  {m.textBody}
                </pre>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {!transportConfigured && (
        <p className="mt-5 max-w-3xl text-xs leading-relaxed text-slate-500">
          No mail transport is configured on this server (<span className="font-mono">EMAIL_TRANSPORT_CONFIGURED</span>{' '}
          is not set), which is why the real providers cannot be selected. That is a server-side guard,
          not a preference — it means this installation cannot send mail even if someone changed the
          setting.
        </p>
      )}
    </>
  );
}
