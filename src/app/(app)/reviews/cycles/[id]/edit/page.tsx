import { notFound, redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getCycle } from '@/server/services/cycles';
import { listPublishedVersions } from '@/server/services/templates';
import { isAppError } from '@/server/errors';
import { PageHeader } from '@/components/ui/primitives';
import { CycleForm } from '../../cycle-form';
import { toDateInputValue } from '@/lib/utils';

export const metadata = { title: 'Edit review cycle' };

export default async function EditCyclePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/reviews');
  const { id } = await params;

  let cycle: Awaited<ReturnType<typeof getCycle>>;
  try {
    cycle = await getCycle(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const versions = await listPublishedVersions(actor);
  const launched = cycle.status === 'ACTIVE' || cycle.status === 'CLOSED';

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Cycles', href: '/reviews/cycles' },
          { label: cycle.name, href: `/reviews/cycles/${id}` },
          { label: 'Edit' },
        ]}
        title={`Edit ${cycle.name}`}
        description={
          launched
            ? 'This cycle has launched, so the template and which reviews it collects are fixed. Dates and release settings can still change.'
            : undefined
        }
      />
      <CycleForm
        mode="edit"
        cycleId={id}
        launched={launched}
        versions={versions.map((v) => ({
          id: v.id,
          label: `${v.template.name} — v${v.versionNumber}`,
          category: v.template.category,
          sections: v._count.sections,
          selfWeight: v.selfWeight,
          managerWeight: v.managerWeight,
          peerWeight: v.peerWeight,
        }))}
        initial={{
          name: cycle.name,
          description: cycle.description ?? '',
          templateVersionId: cycle.templateVersionId,
          periodStart: toDateInputValue(cycle.periodStart),
          periodEnd: toDateInputValue(cycle.periodEnd),
          selfReviewEnabled: cycle.selfReviewEnabled,
          managerReviewEnabled: cycle.managerReviewEnabled,
          peerReviewEnabled: cycle.peerReviewEnabled,
          peerReviewTarget: cycle.peerReviewTarget,
          peerVisibilityMode: cycle.peerVisibilityMode,
          requireApproval: cycle.requireApproval,
          approvalAuthority: cycle.approvalAuthority,
          releaseMode: cycle.releaseMode,
          shareSelfWithManager: cycle.shareSelfWithManager,
          sharePeerWithEmployee: cycle.sharePeerWithEmployee,
          requireAcknowledgement: cycle.requireAcknowledgement,
          selfDueAt: toDateInputValue(cycle.selfDueAt),
          managerDueAt: toDateInputValue(cycle.managerDueAt),
          peerDueAt: toDateInputValue(cycle.peerDueAt),
        }}
      />
    </>
  );
}
