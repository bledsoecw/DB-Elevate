import { notFound, redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getTemplate } from '@/server/services/templates';
import { prisma } from '@/server/db';
import { isAppError } from '@/server/errors';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { TemplateBuilder } from '../template-builder';
import { parseJsonArray, formatDate } from '@/lib/utils';
import { TEMPLATE_CATEGORY_LABELS, type TemplateCategory } from '@/lib/enums';

export const metadata = { title: 'Review template' };

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  let data: Awaited<ReturnType<typeof getTemplate>>;
  try {
    data = await getTemplate(actor, id, sp.version);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

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

  const { template, version } = data;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Administration', href: '/admin' },
          { label: 'Templates', href: '/admin/templates' },
          { label: template.name },
        ]}
        title={template.name}
        description={template.description ?? undefined}
        meta={
          <>
            <Badge tone="neutral">
              {TEMPLATE_CATEGORY_LABELS[template.category as TemplateCategory] ?? template.category}
            </Badge>
            <Badge tone={version.publishedAt ? 'success' : 'warning'}>
              Version {version.versionNumber}
              {version.publishedAt ? ` · published ${formatDate(version.publishedAt)}` : ' · draft'}
            </Badge>
            {data.inUse && <Badge tone="brand">Used by {version._count.cycles} cycles</Badge>}
          </>
        }
      />
      <TemplateBuilder
        mode="edit"
        templateId={id}
        versionId={version.id}
        versionNumber={version.versionNumber}
        isPublished={version.publishedAt !== null}
        inUse={data.inUse}
        canUnpublish={data.canUnpublish}
        versions={template.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          publishedAt: v.publishedAt,
          inUse: v._count.cycles > 0 || v._count.participants > 0,
        }))}
        catalog={{
          scales: scales.map((s) => ({
            id: s.id,
            name: s.name,
            levels: s.levels.map((l) => ({ value: l.value, label: l.label, description: l.description })),
          })),
          competencies,
        }}
        initial={{
          name: template.name,
          description: template.description ?? '',
          category: template.category,
          selfWeight: version.selfWeight,
          managerWeight: version.managerWeight,
          peerWeight: version.peerWeight,
          sections: version.sections.map((s) => ({
            title: s.title,
            instructions: s.instructions ?? '',
            weight: s.weight,
            appliesTo: s.appliesTo,
            questions: s.questions.map((q) => ({
              type: q.type,
              prompt: q.prompt,
              helpText: q.helpText ?? '',
              required: q.required,
              weight: q.weight,
              allowNotApplicable: q.allowNotApplicable,
              commentEnabled: q.commentEnabled,
              commentRequired: q.commentRequired,
              maxLength: q.maxLength,
              ratingScaleId: q.ratingScaleId ?? '',
              competencyId: q.competencyId ?? '',
              goalScope: q.goalScope ?? '',
              choices: parseJsonArray(q.choicesJson),
              appliesTo: q.appliesTo ?? '',
            })),
          })),
        }}
      />
    </>
  );
}
