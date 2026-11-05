import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { canAdministerCompensation } from '@/server/authz/policy';
import { prisma } from '@/server/db';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { NewCycleForm } from './form';

export const metadata = { title: 'New compensation cycle' };

export default async function NewCompensationCyclePage() {
  const actor = await requireActor();
  if (!canAdministerCompensation(actor)) redirect('/compensation');

  // Only cycles that have actually released results can inform a
  // recommendation. An unreleased score is not available to compensation, and
  // offering the cycle here would imply otherwise.
  const reviewCycles = await prisma.reviewCycle.findMany({
    where: {
      orgId: actor.orgId,
      participants: { some: { releasedAt: { not: null } } },
    },
    orderBy: { periodEnd: 'desc' },
    take: 25,
    select: { id: true, name: true, periodEnd: true },
  });

  const year = new Date().getFullYear();

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Compensation', href: '/compensation' }, { label: 'New' }]}
        title="Open a compensation cycle"
        description="This creates a draft. Nothing reaches a manager until you open it for allocation."
      />

      <Alert tone="neutral" className="mb-5 max-w-3xl" title="What creating this records">
        Each person&rsquo;s current salary, salary band, manager and released performance score are
        recorded as they stand now. A later band revision or reorganization will not change the
        basis of a decision taken in this cycle, and the reporting line captured here is the one
        that decides who may allocate.
      </Alert>

      <NewCycleForm
        reviewCycles={reviewCycles.map((c) => ({
          id: c.id,
          label: `${c.name} — released ${c.periodEnd.getFullYear()}`,
        }))}
        defaultName={`${year} Merit Increase`}
        defaultEffective={`${year + 1}-01-01`}
      />
    </>
  );
}
