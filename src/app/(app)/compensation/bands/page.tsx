import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { canManageSalaryBands } from '@/server/authz/policy';
import { listSalaryBands } from '@/server/services/compensation';
import { Alert, Card, EmptyState, Grid, PageHeader, StatTile } from '@/components/ui/primitives';
import { countLabel } from '@/lib/utils';
import { BandTable } from './table';

export const metadata = { title: 'Salary bands' };

export default async function SalaryBandsPage() {
  const actor = await requireActor();
  if (!canManageSalaryBands(actor)) redirect('/compensation');

  const rows = await listSalaryBands(actor);
  const withBand = rows.filter((r) => r.band !== null);
  const peopleWithoutBand = rows
    .filter((r) => r.band === null)
    .reduce((sum, r) => sum + r.headcount, 0);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Compensation', href: '/compensation' }, { label: 'Salary bands' }]}
        title="Salary bands"
        description="The agreed range for each job title. One band per title."
      />

      <Grid cols={3} className="mb-6">
        <StatTile
          label="Titles with a band"
          value={withBand.length}
          denominator={`of ${rows.length}`}
          tone={withBand.length === rows.length ? 'success' : 'neutral'}
        />
        <StatTile
          label="People in a banded title"
          value={rows.reduce((s, r) => s + (r.band ? r.headcount : 0), 0)}
        />
        <StatTile
          label="People with no band"
          value={peopleWithoutBand}
          tone={peopleWithoutBand > 0 ? 'warning' : 'neutral'}
          hint={peopleWithoutBand > 0 ? 'No position-in-band input to their recommendation' : undefined}
        />
      </Grid>

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="What a band does and does not do">
        A band is one of two inputs to a suggested increase; the other is the performance band. It
        is not a cap — a manager can decide a figure that takes somebody past the top of the range,
        and the decision stands with its recorded reason. Revising a band here does not reach back
        into an open cycle: each participant carries the range it was launched against, so a change
        today cannot alter the basis of a decision already taken.
        {peopleWithoutBand > 0 && (
          <>
            {' '}
            <strong className="font-semibold">
              {countLabel(peopleWithoutBand, 'person', 'people')}
            </strong>{' '}
            sit in a title with no band. They can still take part in a cycle — the suggestion just
            rests on performance alone.
          </>
        )}
      </Alert>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            illustration="results"
            title="No job titles yet"
            description="A band belongs to a job title, so the titles have to exist first. An HR administrator maintains those."
          />
        </Card>
      ) : (
        <BandTable rows={rows} />
      )}
    </>
  );
}
