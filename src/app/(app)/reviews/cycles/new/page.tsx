import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { listPublishedVersions } from '@/server/services/templates';
import { Alert, ButtonLink, Card, PageHeader, EmptyState } from '@/components/ui/primitives';
import { CycleForm } from '../cycle-form';

export const metadata = { title: 'New review cycle' };

export default async function NewCyclePage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/reviews');

  const versions = await listPublishedVersions(actor);

  if (versions.length === 0) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: 'Reviews', href: '/reviews' },
            { label: 'Cycles', href: '/reviews/cycles' },
            { label: 'New' },
          ]}
          title="Create a review cycle"
        />
        <Card>
          <EmptyState
            title="No published template to use"
            description="A cycle has to be built on a published template version, because publishing is what freezes the questions so a completed review cannot be rewritten later."
            action={<ButtonLink href="/admin/templates" variant="primary">Go to templates</ButtonLink>}
          />
        </Card>
      </>
    );
  }

  const year = new Date().getFullYear();

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Reviews', href: '/reviews' },
          { label: 'Cycles', href: '/reviews/cycles' },
          { label: 'New' },
        ]}
        title="Create a review cycle"
        description="This creates a draft. You choose who takes part on the next screen, and nothing reaches anyone until you launch."
      />
      <Alert tone="neutral" className="mb-5 max-w-3xl" title="What launching will do later">
        When you launch, each participant&rsquo;s manager, job title and department are recorded as
        they stand at that moment, and the template version is frozen into every review. Everything
        afterwards — who may read a review, who approves it — resolves against that record rather
        than against the organization as it later becomes.
      </Alert>
      <CycleForm
        mode="create"
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
          name: `${year} Annual Performance Review`,
          description: '',
          templateVersionId: versions[0]?.id ?? '',
          periodStart: `${year}-01-01`,
          periodEnd: `${year}-12-31`,
          selfReviewEnabled: true,
          managerReviewEnabled: true,
          peerReviewEnabled: false,
          peerReviewTarget: 3,
          peerVisibilityMode: 'CONFIDENTIAL',
          requireApproval: true,
          approvalAuthority: 'MANAGER_OF_MANAGER',
          releaseMode: 'MANUAL',
          shareSelfWithManager: true,
          sharePeerWithEmployee: false,
          requireAcknowledgement: true,
          selfDueAt: '',
          managerDueAt: '',
          peerDueAt: '',
        }}
      />
    </>
  );
}
