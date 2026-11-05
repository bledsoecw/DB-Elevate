import { CheckSquare } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listActionItems } from '@/server/services/meetings';
import {
  Card,
  CardHeader,
  EmptyState,
  Grid,
  LinkTabs,
  PageHeader,
  StatTile,
  TableWrap,
  Th,
} from '@/components/ui/primitives';
import { ActionRow } from './row';
import { isOverdue, relativeDueLabel } from '@/lib/utils';

export const metadata = { title: 'Action items' };

export default async function ActionItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; status?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;
  const scope = (['mine', 'assigned', 'team'].includes(sp.scope ?? '') ? sp.scope : 'mine') as
    | 'mine'
    | 'assigned'
    | 'team';

  const [items, mine] = await Promise.all([
    listActionItems(actor, { scope, status: sp.status }),
    listActionItems(actor, { scope: 'mine' }),
  ]);

  const overdue = items.filter((a) => a.dueDate && isOverdue(a.dueDate) && a.status !== 'COMPLETED');
  const dueThisWeek = items.filter(
    (a) => a.dueDate && !isOverdue(a.dueDate) && a.dueDate.getTime() - Date.now() < 7 * 86_400_000,
  );

  const tabs = [
    { key: 'mine', label: 'Mine', href: '/meetings/actions?scope=mine', count: mine.length },
    { key: 'assigned', label: 'I assigned', href: '/meetings/actions?scope=assigned' },
    ...(actor.isManager || actor.isHrAdmin
      ? [{ key: 'team', label: 'My team', href: '/meetings/actions?scope=team' }]
      : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Meetings', href: '/meetings' }, { label: 'Action items' }]}
        title="Action items"
        description="Follow-up work from one-to-ones, goals, development plans and survey results."
      />

      <Grid cols={3} className="mb-5">
        <StatTile label="Open" value={items.filter((a) => a.status !== 'COMPLETED').length} />
        <StatTile
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? 'danger' : 'success'}
        />
        <StatTile label="Due this week" value={dueThisWeek.length} tone={dueThisWeek.length > 0 ? 'warning' : 'neutral'} />
      </Grid>

      <LinkTabs tabs={tabs} current={scope} className="mb-5" />

      <Card>
        <CardHeader
          title={scope === 'mine' ? 'Assigned to me' : scope === 'assigned' ? 'I assigned these' : 'My team'}
        />
        {items.length === 0 ? (
          <EmptyState
            icon={<CheckSquare className="h-5 w-5" />}
            title="Nothing outstanding"
            description="Action items created in a one-to-one or from a survey result appear here."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th />
                <Th>What</Th>
                <Th>Owner</Th>
                <Th>From</Th>
                <Th>Due</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((a) => (
                <ActionRow
                  key={a.id}
                  id={a.id}
                  title={a.title}
                  description={a.description}
                  status={a.status}
                  dueLabel={a.dueDate ? relativeDueLabel(a.dueDate) : 'No due date'}
                  overdue={a.dueDate !== null && isOverdue(a.dueDate)}
                  ownerName={`${a.owner.preferredName || a.owner.firstName} ${a.owner.lastName}`}
                  sourceLabel={
                    a.meeting
                      ? a.meeting.title
                      : a.goal
                        ? a.goal.title
                        : a.developmentPlan
                          ? a.developmentPlan.title
                          : 'Survey follow-up'
                  }
                  sourceHref={
                    a.meeting
                      ? `/meetings/${a.meeting.id}`
                      : a.goal
                        ? `/goals/${a.goal.id}`
                        : a.developmentPlan
                          ? `/development/${a.developmentPlan.id}`
                          : null
                  }
                />
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <p className="mt-4 text-xs text-slate-500">
        You can see action items you own, ones you assigned, ones from a meeting you were in, and
        ones owned by someone in your reporting line.
      </p>
    </>
  );
}
