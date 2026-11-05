import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getTeamCompetencyMatrix } from '@/server/services/competencies';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkTabs,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { countLabel, fullName } from '@/lib/utils';

export const metadata = { title: 'Team competencies' };

export default async function TeamCompetenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.isManager && !actor.isHrAdmin && !actor.isLeadership) redirect('/competencies');

  const { scope: raw } = await searchParams;
  const canSeeOrg = actor.isHrAdmin || actor.isLeadership;
  const scope = raw === 'org' && canSeeOrg ? 'org' : 'team';

  const { people, competencies, cells } = await getTeamCompetencyMatrix(actor, scope);

  const tabs = [
    { key: 'profile', label: 'My competencies', href: '/competencies' },
    { key: 'team', label: actor.isManager ? 'My team' : 'Team', href: '/competencies/team' },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Competencies', href: '/competencies' }, { label: 'Team' }]}
        title={scope === 'org' ? 'Competencies across the organization' : 'Team competencies'}
        description="The most recent released manager rating for each person and competency."
        actions={
          canSeeOrg ? (
            <div className="flex gap-2">
              <Link
                href="/competencies/team"
                className={
                  'rounded-full px-3 py-1.5 text-sm font-medium transition ' +
                  (scope === 'team' ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50')
                }
              >
                My team
              </Link>
              <Link
                href="/competencies/team?scope=org"
                className={
                  'rounded-full px-3 py-1.5 text-sm font-medium transition ' +
                  (scope === 'org' ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50')
                }
              >
                Everyone
              </Link>
            </div>
          ) : undefined
        }
      />

      <LinkTabs tabs={tabs} current="team" className="mb-5" />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="How to read this">
        Each cell is the manager rating from that person&rsquo;s most recent <em>released</em>{' '}
        review, shown on the scale it was given on. Self and peer ratings are deliberately left out
        — mixing them into one grid would compare a self-assessment against a manager&rsquo;s
        judgement as though they were the same measurement. A blank cell means no released review
        has rated that competency, which is not the same as a low score.
      </Alert>

      {people.length === 0 ? (
        <Card>
          <EmptyState
            illustration="people"
            title={scope === 'org' ? 'Nobody to show' : 'Nobody reports to you'}
            description="This grid covers the people in your reporting line."
          />
        </Card>
      ) : competencies.length === 0 ? (
        <Card>
          <EmptyState
            illustration="plans"
            title="No competency ratings yet"
            description="Once a review that rates competencies has been released, the ratings appear here. Nothing from a draft or an unreleased review is counted."
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`${countLabel(people.length, 'person', 'people')} · ${countLabel(competencies.length, 'competency', 'competencies')}`}
            description="Scroll sideways if the grid is wider than the screen."
          />
          <TableWrap>
            <thead>
              <tr>
                <Th className="sticky left-0 z-10 bg-slate-50">Person</Th>
                {competencies.map((c) => (
                  <Th key={c.id} align="center" className="min-w-[7rem]">
                    <span className="block whitespace-normal leading-tight">{c.name}</span>
                    {c.category && (
                      <span className="block text-[10px] font-normal normal-case text-slate-400">
                        {c.category}
                      </span>
                    )}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((person) => (
                <tr key={person.id}>
                  <Td className="sticky left-0 z-10 bg-white">
                    <Link
                      href={`/competencies?employee=${person.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                    >
                      {fullName(person)}
                    </Link>
                    {person.jobTitle && (
                      <p className="text-xs text-slate-500">
                        {person.jobTitle.name}
                        {person.jobTitle.level && ` · ${person.jobTitle.level}`}
                      </p>
                    )}
                  </Td>
                  {competencies.map((c) => {
                    const cell = cells.get(`${person.id}::${c.id}`);
                    return (
                      <Td key={c.id} align="center">
                        {cell ? (
                          <span
                            title={`${cell.rawLabel ?? ''} — ${cell.scaleName}, ${cell.cycleName}`}
                            className="inline-flex flex-col items-center"
                          >
                            <span className="text-sm font-semibold text-slate-900">
                              {cell.rawValue}
                              <span className="font-normal text-slate-400">/{cell.scaleMax}</span>
                            </span>
                            {cell.rawLabel && (
                              <span className="max-w-[6.5rem] truncate text-[10px] text-slate-500">
                                {cell.rawLabel}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300" title="No released rating">
                            —
                          </span>
                        )}
                      </Td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <CardBody className="border-t border-slate-100">
            <p className="text-xs leading-relaxed text-slate-500">
              Built from released manager reviews at page load.{' '}
              {new Set([...cells.values()].map((c) => c.scaleName)).size > 1 && (
                <>
                  <Badge tone="warning">Mixed scales</Badge> More than one rating scale appears in
                  this grid, so columns are not directly comparable to one another. Each cell states
                  its own maximum.
                </>
              )}
            </p>
          </CardBody>
        </Card>
      )}
    </>
  );
}
