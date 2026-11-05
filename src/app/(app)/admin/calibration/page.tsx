import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Scale } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { calibratableCycles, listCalibrationSessions } from '@/server/services/calibration';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/primitives';
import { countLabel, formatDate, formatRelativeTime } from '@/lib/utils';
import { NewSessionButton } from './new-session';

export const metadata = { title: 'Calibration' };

export default async function CalibrationPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const [sessions, cycles] = await Promise.all([
    listCalibrationSessions(actor),
    calibratableCycles(actor),
  ]);

  const open = sessions.filter((s) => s.status !== 'FINALIZED');
  const finalized = sessions.filter((s) => s.status === 'FINALIZED');

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Calibration' }]}
        title="Calibration"
        description="Compare a group's scores side by side before anything is released, and record what was decided and why."
        actions={
          <NewSessionButton
            cycles={cycles.map((c) => ({
              id: c.id,
              name: c.name,
              status: c.status,
              periodStart: formatDate(c.periodStart),
              periodEnd: formatDate(c.periodEnd),
              eligible: c._count.participants,
            }))}
          />
        }
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="What calibration does, and does not, do">
        A session is a workspace for a conversation. It changes nobody&rsquo;s score on its own: a score
        moves only when a person records a decision, and a decision cannot be saved without a written
        reason. There is deliberately no action that fits the group to a curve — a target distribution
        is something to discuss, not a transformation to apply to people&rsquo;s records. Every
        adjustment is shown on the review beside the calculated figure, so the employee sees that a
        human changed it rather than a number that quietly differs from its own arithmetic.
      </Alert>

      {cycles.length === 0 && open.length === 0 && (
        <Alert tone="info" className="mb-5 max-w-4xl" title="Nothing is ready to calibrate">
          A participant can be calibrated once their reviews are submitted and before the results are
          released. Nothing is in that window right now — either the reviews are still being written, or
          everything has already been released.
        </Alert>
      )}

      {open.length === 0 && finalized.length === 0 ? (
        <Card>
          <EmptyState
            illustration="results"
            icon={<Scale className="h-5 w-5" />}
            title="No calibration sessions"
            description="Open one when a group's reviews are in and you want to look across them before releasing."
            action={
              cycles.length > 0 ? (
                <NewSessionButton
                  cycles={cycles.map((c) => ({
                    id: c.id,
                    name: c.name,
                    status: c.status,
                    periodStart: formatDate(c.periodStart),
                    periodEnd: formatDate(c.periodEnd),
                    eligible: c._count.participants,
                  }))}
                />
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {open.map((s) => (
            <Card key={s.id}>
              <CardHeader
                title={
                  <Link href={`/admin/calibration/${s.id}`} className="hover:underline">
                    {s.name}
                  </Link>
                }
                description={s.cycle.name}
                actions={
                  <>
                    <Badge tone="info">In progress</Badge>
                    <Link
                      href={`/admin/calibration/${s.id}`}
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-2"
                    >
                      Open
                    </Link>
                  </>
                }
              />
              <CardBody>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-600">
                  <span>{countLabel(s._count.entries, 'participant')}</span>
                  {s.facilitator && (
                    <span>
                      Facilitated by {s.facilitator.firstName} {s.facilitator.lastName}
                    </span>
                  )}
                  <span>Opened {formatRelativeTime(s.createdAt)}</span>
                </div>
                {s.notes && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-700">{s.notes}</p>
                )}
              </CardBody>
            </Card>
          ))}

          {finalized.length > 0 && (
            <Card>
              <CardHeader
                title="Finalised"
                description="Closed, and kept as the record of what was decided. Reopening is deliberately not offered — a new session is opened instead, so the earlier decisions stay legible."
              />
              <ul className="divide-y divide-slate-100">
                {finalized.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/calibration/${s.id}`}
                        className="text-sm font-medium text-slate-800 hover:underline"
                      >
                        {s.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {s.cycle.name} · {countLabel(s._count.entries, 'participant')}
                        {s.finalizedAt && <> · finalised {formatDate(s.finalizedAt)}</>}
                      </p>
                    </div>
                    <Badge tone="neutral">Finalised</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
