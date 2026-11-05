import { requireActor } from '@/server/authz/actor';
import { planSubjectOptions } from '@/server/services/development';
import { prisma } from '@/server/db';
import { Alert, Card, CardBody, EmptyState, PageHeader } from '@/components/ui/primitives';
import { NewPlanForm } from './form';

export const metadata = { title: 'New development plan' };

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string; type?: string }>;
}) {
  const actor = await requireActor();
  const { employeeId, type } = await searchParams;

  const [people, competencies] = await Promise.all([
    planSubjectOptions(actor),
    prisma.competency.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, category: true },
    }),
  ]);

  if (people.length === 0) {
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: 'Development', href: '/development' }, { label: 'New plan' }]}
          title="New plan"
        />
        <Card>
          <EmptyState
            title="Nobody to start a plan for"
            description="You can start a plan for yourself or for someone who reports to you. Your account has no employee record attached, so there is nobody to attach a plan to — a system administrator can link one."
          />
        </Card>
      </>
    );
  }

  const canStartAnyImprovement = people.some((p) => p.canStartImprovement);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Development', href: '/development' }, { label: 'New plan' }]}
        title="Start a plan"
        description="A short list of specific things, with dates. Vague plans are the ones nobody can tell they have finished."
      />

      {canStartAnyImprovement && (
        <Alert tone="neutral" className="mb-5 max-w-3xl" title="Two different things">
          A <strong className="font-semibold">development plan</strong> is for building skill, and the
          management chain can see it. A{' '}
          <strong className="font-semibold">performance improvement plan</strong> is a restricted
          personnel record for when performance has to change — visible only to the employee, their
          direct manager and HR. Pick the one you mean; the restriction on an improvement plan cannot
          be relaxed later.
        </Alert>
      )}

      <Card className="max-w-3xl">
        <CardBody>
          <NewPlanForm
            people={people}
            competencies={competencies}
            defaultEmployeeId={
              employeeId && people.some((p) => p.id === employeeId)
                ? employeeId
                : (actor.employeeId ?? people[0]!.id)
            }
            defaultType={type === 'pip' ? 'PERFORMANCE_IMPROVEMENT' : 'DEVELOPMENT'}
          />
        </CardBody>
      </Card>
    </>
  );
}
