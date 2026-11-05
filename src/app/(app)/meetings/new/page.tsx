import { requireActor } from '@/server/authz/actor';
import { prisma } from '@/server/db';
import { PageHeader } from '@/components/ui/primitives';
import { NewMeetingForm } from './form';

export const metadata = { title: 'Schedule a one-to-one' };

export default async function NewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ with?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const people = await prisma.employee.findMany({
    where: {
      orgId: actor.orgId,
      employmentStatus: { not: 'terminated' },
      id: { not: actor.employeeId ?? undefined },
    },
    orderBy: [{ lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      jobTitle: { select: { name: true } },
    },
  });

  // Direct reports first — the most common case by a wide margin.
  const sorted = [
    ...people.filter((p) => actor.directReportIds.includes(p.id)),
    ...people.filter((p) => !actor.directReportIds.includes(p.id)),
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Meetings', href: '/meetings' }, { label: 'Schedule' }]}
        title="Schedule a one-to-one"
        description="A recurring series keeps the cadence and carries unfinished agenda items into the next meeting."
      />
      <NewMeetingForm
        people={sorted}
        directReportIds={actor.directReportIds}
        defaultWith={sp.with ?? ''}
      />
    </>
  );
}
