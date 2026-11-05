import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Lock, TrendingDown, TrendingUp } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import {
  competencySubjects,
  getCompetencyProfile,
  type CompetencyProfileItem,
} from '@/server/services/competencies';
import { isAppError } from '@/server/errors';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkTabs,
  PageHeader,
} from '@/components/ui/primitives';
import { formatDate, fullName } from '@/lib/utils';
import { REVIEWER_KIND_LABELS, type ReviewerKind } from '@/lib/enums';
import { SubjectPicker } from './subject-picker';

export const metadata = { title: 'Competencies' };

export default async function CompetenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string }>;
}) {
  const actor = await requireActor();
  const { employee: requested } = await searchParams;

  const subjectId = requested ?? actor.employeeId;
  if (!subjectId) {
    return (
      <>
        <PageHeader title="Competencies" />
        <Card>
          <EmptyState
            illustration="withheld"
            title="No employee record attached to this account"
            description="Competencies describe a person's role, so this page needs an employee record. A system administrator can link one."
          />
        </Card>
      </>
    );
  }

  let profile;
  try {
    profile = await getCompetencyProfile(actor, subjectId);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const subjects = await competencySubjects(actor);
  const isSelf = subjectId === actor.employeeId;
  const { employee, library, items, level } = profile;

  const expected = items.filter((i) => i.expectedForRole);
  const other = items.filter((i) => !i.expectedForRole);
  const rated = items.filter((i) => i.latest !== null).length;

  const tabs = [
    { key: 'profile', label: isSelf ? 'My competencies' : 'Profile', href: `/competencies${isSelf ? '' : `?employee=${subjectId}`}` },
  ];
  if (actor.isManager || actor.isHrAdmin || actor.isLeadership) {
    tabs.push({ key: 'team', label: actor.isHrAdmin ? 'Everyone' : 'My team', href: '/competencies/team' });
  }

  return (
    <>
      <PageHeader
        title="Competencies"
        description={
          isSelf
            ? 'The skills your role is assessed on, what good looks like at your level, and how you have been rated.'
            : `What ${fullName(employee)}'s role is assessed on, and how they have been rated.`
        }
        actions={subjects.length > 1 ? <SubjectPicker subjects={subjects.map((s) => ({ id: s.id, name: fullName(s), jobTitle: s.jobTitle?.name ?? null }))} current={subjectId} /> : undefined}
        meta={
          <>
            {employee.jobTitle && <Badge tone="neutral">{employee.jobTitle.name}</Badge>}
            {level && <Badge tone="info">{level}</Badge>}
            {library && <Badge tone="neutral">{library.name}</Badge>}
          </>
        }
      />

      {tabs.length > 1 && <LinkTabs tabs={tabs} current="profile" className="mb-5" />}

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="Where these ratings come from">
        Every rating here was given in a review that has been released. Nothing from a draft or an
        unreleased review appears, which is why a recent cycle may not be reflected yet. Ratings are
        shown on the scale the reviewer actually used — a 3 out of 5 and a 3 out of 3 are different
        things, so they are never pooled into one number.
      </Alert>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            illustration="plans"
            title="No competencies defined for this role yet"
            description={
              library
                ? `The ${library.name} library is attached to this job title but has no competencies in it yet.`
                : 'No competency library is attached to this job title, and no review has rated a competency for this person. An HR administrator sets these up in Administration → Competencies.'
            }
            action={
              actor.isHrAdmin ? (
                <Link href="/admin/competencies" className="text-sm font-medium text-brand-700 underline">
                  Set up competencies
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-slate-600">
                <span>
                  <strong className="font-semibold text-slate-900">{expected.length}</strong>{' '}
                  expected for this role
                </span>
                <span>
                  <strong className="font-semibold text-slate-900">{rated}</strong> rated in a
                  released review
                </span>
                {other.length > 0 && (
                  <span>
                    <strong className="font-semibold text-slate-900">{other.length}</strong> rated
                    but no longer in the role&rsquo;s library
                  </span>
                )}
              </div>
            </CardBody>
          </Card>

          {expected.map((item) => (
            <CompetencyCard key={item.id} item={item} />
          ))}

          {other.length > 0 && (
            <>
              <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Rated previously
              </h2>
              <p className="-mt-3 max-w-3xl text-xs leading-relaxed text-slate-500">
                These are no longer in the library attached to this job title — usually because the
                role changed or the library was edited. The history is kept rather than erased.
              </p>
              {other.map((item) => (
                <CompetencyCard key={item.id} item={item} />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

function CompetencyCard({ item }: { item: CompetencyProfileItem }) {
  const latest = item.latest;

  return (
    <Card>
      <CardHeader
        title={item.name}
        description={item.description ?? undefined}
        actions={
          <>
            {item.category && <Badge tone="neutral">{item.category}</Badge>}
            {!item.active && <Badge tone="neutral">Retired</Badge>}
            {latest ? (
              <span className="flex items-center gap-2">
                <span className="text-right">
                  <span className="block text-lg font-semibold leading-none text-slate-900">
                    {latest.rawValue}
                    <span className="text-sm font-normal text-slate-500"> / {latest.scaleMax}</span>
                  </span>
                  {latest.rawLabel && (
                    <span className="block text-[11px] text-slate-500">{latest.rawLabel}</span>
                  )}
                </span>
                {item.movement !== null && item.movement !== 0 && (
                  <span
                    className={
                      'flex items-center gap-0.5 text-xs font-medium ' +
                      (item.movement > 0 ? 'text-emerald-700' : 'text-amber-700')
                    }
                    title="Change from the previous released rating on the same scale"
                  >
                    {item.movement > 0 ? (
                      <TrendingUp aria-hidden className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingDown aria-hidden className="h-3.5 w-3.5" />
                    )}
                    {item.movement > 0 ? '+' : ''}
                    {item.movement}
                  </span>
                )}
              </span>
            ) : (
              <Badge tone="neutral">Not yet rated</Badge>
            )}
          </>
        }
      />
      <CardBody>
        {item.levelDescriptor ? (
          <div className="rounded-md border border-brand-100 bg-brand-50/60 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">
              What good looks like at this level
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-800">{item.levelDescriptor}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No descriptor has been written for this level yet, so this competency is being rated
            without a shared definition of what the number means.
          </p>
        )}

        {item.ladder.length > 1 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
              Show every level ({item.ladder.length})
            </summary>
            <dl className="mt-2 space-y-2 border-l-2 border-slate-200 pl-4">
              {item.ladder.map((rung) => (
                <div key={rung.level} className="sm:flex sm:gap-4">
                  <dt
                    className={
                      'w-28 flex-shrink-0 text-xs font-semibold uppercase tracking-wide ' +
                      (rung.isMine ? 'text-brand-700' : 'text-slate-400')
                    }
                  >
                    {rung.level}
                    {rung.isMine && <span className="block text-[10px] font-normal">this role</span>}
                  </dt>
                  <dd className="text-sm leading-relaxed text-slate-700">{rung.descriptor}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        {item.ratings.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Rating history
            </p>
            <ul className="space-y-1.5">
              {[...item.ratings].reverse().map((r, i) => (
                <li
                  key={`${r.cycleId}-${r.reviewerKind}-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
                >
                  <span className="text-slate-700">
                    {r.cycleName}
                    <span className="text-slate-400">
                      {' · '}
                      {REVIEWER_KIND_LABELS[r.reviewerKind as ReviewerKind] ?? r.reviewerKind}
                    </span>
                  </span>
                  <span className="text-slate-600">
                    <strong className="font-semibold text-slate-900">{r.rawValue}</strong>
                    <span className="text-slate-400"> / {r.scaleMax}</span>
                    {r.rawLabel && <span className="text-slate-500"> · {r.rawLabel}</span>}
                    <span className="ml-2 text-xs text-slate-400">
                      {r.releasedAt ? formatDate(r.releasedAt) : formatDate(r.periodEnd)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {new Set(item.ratings.map((r) => r.scaleName)).size > 1 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-700">
                <Lock aria-hidden className="mt-px h-3 w-3 flex-shrink-0" />
                <span>
                  These ratings were given on more than one scale, so the change between them is not
                  a like-for-like comparison and no trend is shown.
                </span>
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
