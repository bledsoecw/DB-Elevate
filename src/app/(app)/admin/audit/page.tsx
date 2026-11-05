import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { auditActionGroups, listAuditEvents } from '@/server/services/admin';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { countLabel, formatDateTime, safeJsonParse } from '@/lib/utils';

export const metadata = { title: 'Audit log' };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; from?: string; to?: string; cursor?: string }>;
}) {
  const actor = await requireActor();
  // Both administrators may read the log; see canReadAuditLog in policy.ts.
  if (!actor.isSysAdmin && !actor.isHrAdmin) redirect('/');

  const params = await searchParams;
  const [{ events, nextCursor }, groups] = await Promise.all([
    listAuditEvents(actor, {
      action: params.action,
      entityType: params.entityType,
      from: params.from,
      to: params.to,
      cursor: params.cursor,
      take: 100,
    }),
    auditActionGroups(actor),
  ]);

  const query = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, cursor: undefined, ...overrides })) {
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/admin/audit?${qs}` : '/admin/audit';
  };

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Audit log' }]}
        title="Audit log"
        description="Every consequential action, who took it and when. Append-only: the application never updates or deletes a row here."
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="What this log does not contain">
        Deliberately absent: the text of a review answer, the content of a private one-on-one note, and
        any respondent identity for an anonymous survey. The log records that a review was submitted,
        not what it said. That is what lets it be read by a system administrator who has no business
        reading the review itself — and it is why reading this page grants no access to the records it
        refers to.
      </Alert>

      <Card>
        <CardHeader
          title="Events"
          description={
            events.length === 0
              ? 'No events match these filters.'
              : `${countLabel(events.length, 'event')}, most recent first.`
          }
          actions={
            <form action="/admin/audit" method="get" className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">
                <span className="mb-0.5 block font-medium">Area</span>
                <select
                  name="action"
                  defaultValue={params.action ?? ''}
                  className="rounded-md border-0 px-2 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                >
                  <option value="">All areas</option>
                  {groups.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.value} ({g.count})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                <span className="mb-0.5 block font-medium">From</span>
                <input
                  type="date"
                  name="from"
                  defaultValue={params.from ?? ''}
                  className="rounded-md border-0 px-2 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                />
              </label>
              <label className="text-xs text-slate-600">
                <span className="mb-0.5 block font-medium">To</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={params.to ?? ''}
                  className="rounded-md border-0 px-2 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                Apply
              </button>
              {(params.action || params.from || params.to) && (
                <Link
                  href="/admin/audit"
                  className="px-1 text-sm font-medium text-brand-700 underline"
                >
                  Clear
                </Link>
              )}
            </form>
          }
        />

        {events.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="h-5 w-5" />}
            title="No matching events"
            description="Either nothing has happened in this area yet, or the date range excludes it."
            action={
              params.action || params.from || params.to ? (
                <Link href="/admin/audit" className="text-sm font-medium text-brand-700 underline">
                  Clear the filters
                </Link>
              ) : undefined
            }
          />
        ) : (
          <TableWrap>
              <thead>
                <tr>
                  <Th className="w-44">When</Th>
                  <Th className="w-40">Who</Th>
                  <Th className="w-52">Action</Th>
                  <Th>What happened</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((e) => {
                  const metadata = e.metadataJson
                    ? safeJsonParse<Record<string, unknown>>(e.metadataJson, {})
                    : null;
                  return (
                    <tr key={e.id} className="align-top">
                      <Td>
                        <span className="whitespace-nowrap text-xs text-slate-600">
                          {formatDateTime(e.createdAt)}
                        </span>
                        {e.ip && (
                          <p className="truncate font-mono text-[11px] text-slate-400" title={e.ip}>
                            {e.ip}
                          </p>
                        )}
                      </Td>
                      <Td>
                        {e.actorEmployeeId ? (
                          <Link
                            href={`/people/${e.actorEmployeeId}`}
                            className="text-xs font-medium text-slate-800 hover:underline"
                          >
                            {e.actorLabel ?? 'Unknown'}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-600">{e.actorLabel ?? 'System'}</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={toneFor(e.action)} className="font-mono text-[11px]">
                          {e.action}
                        </Badge>
                      </Td>
                      <Td>
                        <p className="leading-relaxed text-slate-700">{e.summary}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                          {e.entityType}:{e.entityId.slice(0, 10)}…
                        </p>
                        {metadata && Object.keys(metadata).length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">
                              Details
                            </summary>
                            <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700">
                              {JSON.stringify(metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
          </TableWrap>
        )}

        {nextCursor && (
          <div className="border-t border-slate-100 px-5 py-3">
            <Link
              href={query({ cursor: nextCursor })}
              className="text-sm font-medium text-brand-700 underline"
            >
              Load the next 100 events
            </Link>
          </div>
        )}
      </Card>
    </>
  );
}

function toneFor(action: string): 'neutral' | 'info' | 'warning' | 'danger' | 'success' {
  if (action.startsWith('auth.login.failed')) return 'warning';
  if (action.includes('deactivated') || action.includes('cancelled') || action.includes('removed')) {
    return 'danger';
  }
  if (action.startsWith('user.role') || action.startsWith('org.')) return 'warning';
  if (action.includes('released') || action.includes('published') || action.includes('launched')) {
    return 'success';
  }
  return 'neutral';
}
