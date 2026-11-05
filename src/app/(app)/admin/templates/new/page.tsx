import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { prisma } from '@/server/db';
import { PageHeader } from '@/components/ui/primitives';
import { TemplateBuilder } from '../template-builder';
import { emptyQuestion } from '../draft';

export const metadata = { title: 'New template' };

export default async function NewTemplatePage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const [scales, competencies] = await Promise.all([
    prisma.ratingScale.findMany({
      where: { orgId: actor.orgId, archived: false },
      orderBy: { name: 'asc' },
      include: { levels: { orderBy: { value: 'asc' } } },
    }),
    prisma.competency.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true, category: true },
    }),
  ]);

  const defaultScale = scales[0]?.id ?? '';

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Administration', href: '/admin' },
          { label: 'Templates', href: '/admin/templates' },
          { label: 'New' },
        ]}
        title="Build a review template"
        description="Sections hold questions. A section can be limited to particular reviewer types, so a self-assessment and a manager review can ask different things from the same template."
      />
      <TemplateBuilder
        mode="create"
        catalog={{
          scales: scales.map((s) => ({
            id: s.id,
            name: s.name,
            levels: s.levels.map((l) => ({ value: l.value, label: l.label, description: l.description })),
          })),
          competencies,
        }}
        initial={{
          name: '',
          description: '',
          category: 'annual',
          selfWeight: 0,
          managerWeight: 1,
          peerWeight: 0,
          sections: [
            {
              title: 'The year in review',
              instructions: 'Written answers only — nothing in this section is scored.',
              weight: 0,
              appliesTo: 'SELF,MANAGER',
              questions: [{ ...emptyQuestion('TEXT'), prompt: '', required: true }],
            },
            {
              title: 'Core expectations',
              instructions: '',
              weight: 2,
              appliesTo: 'SELF,MANAGER,PEER',
              questions: [emptyQuestion('COMPETENCY_RATING', defaultScale)],
            },
          ],
        }}
      />
    </>
  );
}
