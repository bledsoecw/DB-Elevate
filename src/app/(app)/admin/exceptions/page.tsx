import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listExceptions } from '@/server/services/admin';
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
import { REVIEWER_KIND_LABELS, type ReviewerKind } from '@/lib/enums';

export const metadata = { title: 'Exceptions' };

export default async function ExceptionsPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const ex = await listExceptions(actor);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Exceptions' }]}
        title="Things needing a decision"
        description="Situations the application will not resolve on its own, because each one is a judgement call about a real person."
        actions={
          <Badge tone={ex.total === 0 ? 'success' : 'warning'}>
            {ex.total === 0 ? 'Nothing outstanding' : `${ex.total} to work through`}
          </Badge>
        }
      />

      {ex.total === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Nothing needs attention"
            description="Everyone eligible has a manager and an account, no open review is assigned to a deactivated person, and nothing approved is waiting to be released."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Alert tone="neutral" className="max-w-4xl" title="Why these are not fixed automatically">
            Each one has more than one defensible answer. An employee with no manager might be the
            owner; a review assigned to someone who has left might need reassigning or might need the
            participant removed from the cycle. Guessing would quietly produce a record nobody
            intended, so the application surfaces the situation and leaves the decision where it
            belongs.
          </Alert>

          {ex.noManager.length > 0 && (
            <Section
              title="Active employees with no manager"
              count={ex.noManager.length}
              why="They are marked review-eligible but have nobody to write their manager review, so launching a cycle will skip them. Either set a manager, or mark them not review-eligible on their profile if that is correct — an owner, for instance."
            >
              <ul className="divide-y divide-slate-100">
                {ex.noManager.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/people/${e.id}`}
                        className="text-sm font-medium text-slate-800 hover:underline"
                      >
                        {e.firstName} {e.lastName}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {e.jobTitle?.name ?? 'No job title'} · {e.department?.name ?? 'No department'}
                      </p>
                    </div>
                    <Link
                      href={`/people/${e.id}/edit`}
                      className="text-xs font-medium text-brand-700 underline"
                    >
                      Set a manager
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {ex.noAccount.length > 0 && (
            <Section
              title="Active employees with no sign-in account"
              count={ex.noAccount.length}
              why="They have a personnel record but cannot sign in, so they can neither write a self-review nor acknowledge a released one. A system administrator creates the account; it is not HR's to create, which is the role split working as intended."
            >
              <ul className="divide-y divide-slate-100">
                {ex.noAccount.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/people/${e.id}`}
                        className="text-sm font-medium text-slate-800 hover:underline"
                      >
                        {e.firstName} {e.lastName}
                      </Link>
                      <p className="truncate text-xs text-slate-500">
                        {e.workEmail} · {e.jobTitle?.name ?? 'No job title'}
                      </p>
                    </div>
                    {actor.isSysAdmin ? (
                      <Link
                        href="/admin/accounts"
                        className="text-xs font-medium text-brand-700 underline"
                      >
                        Create an account
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">
                        Ask a system administrator
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {ex.deactivatedReviewer.length > 0 && (
            <Section
              title="Open reviews assigned to someone who has left"
              count={ex.deactivatedReviewer.length}
              why="The assignment will never be submitted, so the cycle cannot complete. Reassign it to whoever can speak to the work, or remove it — a manager review can be moved to the new manager, and a peer review usually to a different peer."
            >
              <ul className="divide-y divide-slate-100">
                {ex.deactivatedReviewer.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800">
                        <span className="font-medium">
                          {REVIEWER_KIND_LABELS[a.kind as ReviewerKind] ?? a.kind}
                        </span>{' '}
                        of {a.participant.employee.firstName} {a.participant.employee.lastName}
                      </p>
                      <p className="text-xs text-slate-500">
                        Assigned to {a.reviewer.firstName} {a.reviewer.lastName} (deactivated) ·{' '}
                        {a.participant.cycle.name}
                        {a.dueAt && <> · due {formatDate(a.dueAt)}</>}
                      </p>
                    </div>
                    <Link
                      href={`/reviews/cycles/${a.participant.cycle.id}?tab=reviewers`}
                      className="text-xs font-medium text-brand-700 underline"
                    >
                      Reassign
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {ex.approvedNotReleased.length > 0 && (
            <Section
              title="Approved but not released"
              count={ex.approvedNotReleased.length}
              why="The review is finished and signed off, but the employee still cannot see it. Release is a separate, deliberate step so a manager can hold the conversation before the record appears — but a review sitting here for weeks is usually an oversight."
            >
              <ul className="divide-y divide-slate-100">
                {ex.approvedNotReleased.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {p.employee.firstName} {p.employee.lastName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.cycle.name} · approved {formatRelativeTime(p.updatedAt)}
                      </p>
                    </div>
                    <Link
                      href={`/reviews/participants/${p.id}`}
                      className="text-xs font-medium text-brand-700 underline"
                    >
                      Review and release
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {ex.staleAck.length > 0 && (
            <Section
              title="Released over three weeks ago, still not acknowledged"
              count={ex.staleAck.length}
              why="The employee has not confirmed receipt. Usually a nudge; occasionally it means they never knew it was there. Acknowledgement records receipt, not agreement, so chasing it is reasonable."
            >
              <ul className="divide-y divide-slate-100">
                {ex.staleAck.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">
                        {p.employee.firstName} {p.employee.lastName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.cycle.name} · released{' '}
                        {p.releasedAt ? formatRelativeTime(p.releasedAt) : 'unknown'}
                      </p>
                    </div>
                    <Link
                      href={`/reviews/participants/${p.id}`}
                      className="text-xs font-medium text-brand-700 underline"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {ex.orphanedGoals.length > 0 && (
            <Section
              title="Open goals owned by someone who has left"
              count={ex.orphanedGoals.length}
              why="They stay open forever and drag down whatever team progress figure they are counted in. Reassign the goal, or close it with an outcome — closing it records what actually happened rather than deleting the history."
            >
              <ul className="divide-y divide-slate-100">
                {ex.orphanedGoals.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link
                        href={`/goals/${g.id}`}
                        className="text-sm font-medium text-slate-800 hover:underline"
                      >
                        {g.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {g.owner
                          ? `Owned by ${g.owner.firstName} ${g.owner.lastName} (deactivated)`
                          : 'The owner record has been removed'}
                      </p>
                    </div>
                    <Link
                      href={`/goals/${g.id}/edit`}
                      className="text-xs font-medium text-brand-700 underline"
                    >
                      Reassign or close
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  count,
  why,
  children,
}: {
  title: string;
  count: number;
  why: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        level={2}
        actions={<Badge tone="warning">{countLabel(count, 'item')}</Badge>}
      />
      <CardBody className="border-b border-slate-100 pb-3">
        <p className="text-xs leading-relaxed text-slate-600">{why}</p>
      </CardBody>
      {children}
    </Card>
  );
}
