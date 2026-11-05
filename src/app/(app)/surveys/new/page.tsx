import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { prisma } from '@/server/db';
import { canManageSurveys } from '@/server/authz/policy';
import { PageHeader } from '@/components/ui/primitives';
import { SurveyBuilder } from './builder';
import { ENGAGEMENT_FACTORS } from '@/lib/enums';

export const metadata = { title: 'New survey' };

export default async function NewSurveyPage() {
  const actor = await requireActor();
  if (!canManageSurveys(actor)) redirect('/surveys');

  const [scales, departments, jobTitles] = await Promise.all([
    prisma.ratingScale.findMany({
      where: { orgId: actor.orgId, archived: false },
      orderBy: { name: 'asc' },
      include: { levels: { orderBy: { value: 'asc' } } },
    }),
    prisma.department.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.jobTitle.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Surveys', href: '/surveys' }, { label: 'New survey' }]}
        title="Create a survey"
        description="Decide whether it is anonymous before you write the questions — it changes what people will tell you, and it cannot be changed after launch."
      />
      <SurveyBuilder
        scales={scales.map((s) => ({
          id: s.id,
          name: s.name,
          levels: s.levels.map((l) => ({ value: l.value, label: l.label })),
        }))}
        departments={departments}
        jobTitles={jobTitles}
        factors={[...ENGAGEMENT_FACTORS]}
        defaultMinResponses={actor.org.surveyMinResponses}
      />
    </>
  );
}
