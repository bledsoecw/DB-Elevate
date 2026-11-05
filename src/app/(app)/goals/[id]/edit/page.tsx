import { notFound, redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getGoal, listAlignmentTargets } from '@/server/services/goals';
import { getFormOptions } from '@/server/services/people';
import { canCreateCompanyGoal } from '@/server/authz/policy';
import { isAppError } from '@/server/errors';
import { PageHeader } from '@/components/ui/primitives';
import { GoalForm } from '../../goal-form';
import { toDateInputValue } from '@/lib/utils';

export const metadata = { title: 'Edit goal' };

export default async function EditGoalPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getGoal>>;
  try {
    data = await getGoal(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  if (!data.canEdit) redirect(`/goals/${id}`);

  const [options, alignmentTargets] = await Promise.all([
    getFormOptions(actor.orgId),
    listAlignmentTargets(actor),
  ]);
  const g = data.goal;

  const assignable = actor.isHrAdmin
    ? options.managers
    : options.managers.filter(
        (p) => p.id === actor.employeeId || actor.descendantIds.includes(p.id) || p.id === g.ownerEmployeeId,
      );

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Goals', href: '/goals' },
          { label: g.title, href: `/goals/${id}` },
          { label: 'Edit' },
        ]}
        title="Edit goal"
        description="Changing how progress is measured does not rewrite the history. Past updates keep the figures they recorded."
      />
      <GoalForm
        mode="edit"
        goalId={id}
        canCreateCompany={canCreateCompanyGoal(actor)}
        canAssignToOthers={assignable.length > 1}
        options={{ people: assignable, departments: options.departments, alignmentTargets: alignmentTargets.filter((t) => t.id !== id) }}
        initial={{
          title: g.title,
          description: g.description ?? '',
          outcome: g.outcome ?? '',
          category: g.category ?? '',
          scope: g.scope,
          ownerEmployeeId: g.ownerEmployeeId ?? '',
          departmentId: g.departmentId ?? '',
          parentGoalId: g.parentGoalId ?? '',
          startDate: toDateInputValue(g.startDate),
          dueDate: toDateInputValue(g.dueDate),
          visibility: g.visibility,
          measurementType: g.measurementType,
          startValue: g.startValue !== null ? String(g.startValue) : '',
          targetValue: g.targetValue !== null ? String(g.targetValue) : '',
          currentValue: g.currentValue !== null ? String(g.currentValue) : '',
          unit: g.unit ?? '',
          higherIsBetter: g.higherIsBetter,
          reportedProgressPct: g.progress.reportedPct !== null ? String(Math.round(g.progress.reportedPct)) : '',
          milestones: g.milestones.map((m) => ({ title: m.title, dueDate: toDateInputValue(m.dueDate) })),
        }}
      />
    </>
  );
}
