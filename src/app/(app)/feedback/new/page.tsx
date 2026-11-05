import { requireActor } from '@/server/authz/actor';
import { prisma } from '@/server/db';
import { listRecognitionValues } from '@/server/services/feedback';
import { listGoals } from '@/server/services/goals';
import { PageHeader } from '@/components/ui/primitives';
import { FeedbackForm } from '../feedback-form';

export const metadata = { title: 'Give feedback' };

export default async function NewFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ about?: string; kind?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const [people, competencies, recognitionValues, goals] = await Promise.all([
    prisma.employee.findMany({
      where: { orgId: actor.orgId, employmentStatus: { not: 'terminated' } },
      orderBy: [{ lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, preferredName: true },
    }),
    prisma.competency.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    listRecognitionValues(actor.orgId),
    sp.about ? listGoals(actor, { ownerEmployeeId: sp.about }) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Feedback', href: '/feedback' }, { label: 'Give feedback' }]}
        title="Give feedback"
        description="Specific beats general. Name the job, the date and what actually happened."
      />
      <FeedbackForm
        people={people}
        competencies={competencies}
        recognitionValues={recognitionValues}
        goals={goals.map((g) => ({ id: g.id, title: g.title }))}
        defaults={{ aboutEmployeeId: sp.about, kind: sp.kind }}
      />
    </>
  );
}
