import { requireActor } from '@/server/authz/actor';
import { prisma } from '@/server/db';
import { listGoals } from '@/server/services/goals';
import { PageHeader } from '@/components/ui/primitives';
import { RequestFeedbackForm } from './form';

export const metadata = { title: 'Ask for feedback' };

export default async function RequestFeedbackPage() {
  const actor = await requireActor();

  const [people, competencies, goals] = await Promise.all([
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
    listGoals(actor, { scope: 'MINE' }),
  ]);

  // You can ask about yourself, or about someone in your reporting line.
  const subjects = people.filter(
    (p) => p.id === actor.employeeId || actor.descendantIds.includes(p.id) || actor.isHrAdmin,
  );

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Feedback', href: '/feedback' }, { label: 'Ask for feedback' }]}
        title="Ask for feedback"
        description="Ask a colleague for their view, about you or about someone in your team. They are notified and it appears in their task list."
      />
      <RequestFeedbackForm
        people={people.filter((p) => p.id !== actor.employeeId)}
        subjects={subjects}
        competencies={competencies}
        goals={goals.map((g) => ({ id: g.id, title: g.title }))}
        defaultSubjectId={actor.employeeId ?? ''}
      />
    </>
  );
}
