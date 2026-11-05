import { requireActor } from '@/server/authz/actor';
import { getFormOptions } from '@/server/services/people';
import { listAlignmentTargets } from '@/server/services/goals';
import { canCreateCompanyGoal } from '@/server/authz/policy';
import { PageHeader } from '@/components/ui/primitives';
import { GoalForm } from '../goal-form';
import { prisma } from '@/server/db';

export const metadata = { title: 'New goal' };

export default async function NewGoalPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const [options, alignmentTargets] = await Promise.all([
    getFormOptions(actor.orgId),
    listAlignmentTargets(actor),
  ]);

  // Someone can set a goal for themselves or for anyone in their reporting line.
  const assignable = actor.isHrAdmin
    ? options.managers
    : options.managers.filter(
        (p) => p.id === actor.employeeId || actor.descendantIds.includes(p.id),
      );
  const canAssignToOthers = assignable.length > 1;

  void prisma;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Goals', href: '/goals' }, { label: 'New goal' }]}
        title="Set a goal"
        description="A goal with a number attached gives a review something concrete to talk about. Two or three at a time is usually right."
      />
      <GoalForm
        mode="create"
        canCreateCompany={canCreateCompanyGoal(actor)}
        canAssignToOthers={canAssignToOthers}
        options={{
          people: assignable,
          departments: options.departments,
          alignmentTargets,
        }}
        initial={{
          title: '',
          description: '',
          outcome: '',
          category: '',
          scope: 'INDIVIDUAL',
          ownerEmployeeId: sp.owner ?? actor.employeeId ?? '',
          departmentId: actor.departmentId ?? '',
          parentGoalId: '',
          startDate: new Date().toISOString().slice(0, 10),
          dueDate: '',
          visibility: 'MANAGER_CHAIN',
          measurementType: 'NUMERIC',
          startValue: '',
          targetValue: '',
          currentValue: '',
          unit: '',
          higherIsBetter: true,
          reportedProgressPct: '',
          milestones: [{ title: '', dueDate: '' }],
        }}
      />
    </>
  );
}
