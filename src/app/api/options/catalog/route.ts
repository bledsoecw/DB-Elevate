import { prisma } from '@/server/db';
import { handler } from '@/server/api';

/**
 * Configurable catalogues used by the authoring forms: competencies, rating
 * scales and recognition values. All organization-scoped.
 */
export const GET = handler(async ({ actor }) => {
  const [competencies, ratingScales, recognitionValues, departments] = await Promise.all([
    prisma.competency.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, category: true, description: true },
    }),
    prisma.ratingScale.findMany({
      where: { orgId: actor.orgId, archived: false },
      orderBy: { name: 'asc' },
      include: { levels: { orderBy: { value: 'asc' } } },
    }),
    prisma.recognitionValue.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.department.findMany({
      where: { orgId: actor.orgId, active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  return { competencies, ratingScales, recognitionValues, departments };
});
