import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  MessageSquare,
  Target,
  ListChecks,
  BarChart3,
} from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getInbox, type InboxTask } from '@/server/services/inbox';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  Grid,
} from '@/components/ui/primitives';
import { formatDate, relativeDueLabel } from '@/lib/utils';

export const metadata = { title: 'My tasks' };

const GROUP_ICONS = {
  Reviews: ClipboardCheck,
  Feedback: MessageSquare,
  Surveys: BarChart3,
  'Follow-up': ListChecks,
  Goals: Target,
  Meetings: CalendarDays,
} as const;

const GROUP_ORDER: InboxTask['group'][] = [
  'Reviews',
  'Feedback',
  'Surveys',
  'Follow-up',
  'Goals',
  'Meetings',
];

function TaskRow({ task }: { task: InboxTask }) {
  return (
    <li>
      <Link
        href={task.href}
        className="group flex items-start gap-3 px-5 py-3.5 transition hover:bg-slate-50"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{task.title}</span>
            {task.inProgress && <Badge tone="info">Started</Badge>}
            {task.overdue && (
              <Badge tone="danger">
                <AlertTriangle aria-hidden className="h-3 w-3" />
                Overdue
              </Badge>
            )}
          </span>
          {task.subtitle && (
            <span className="mt-0.5 block text-xs text-slate-600">{task.subtitle}</span>
          )}
        </span>
        <span className="flex flex-shrink-0 items-center gap-3 pt-0.5">
          <span
            className={
              task.overdue
                ? 'whitespace-nowrap text-xs font-medium text-rose-700'
                : 'whitespace-nowrap text-xs text-slate-500'
            }
          >
            {task.dueAt ? relativeDueLabel(task.dueAt) : 'No due date'}
          </span>
          <ArrowRight
            aria-hidden
            className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
          />
        </span>
      </Link>
    </li>
  );
}

export default async function TasksPage() {
  const actor = await requireActor();
  const inbox = await getInbox(actor);

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    tasks: inbox.tasks.filter((t) => t.group === group),
  })).filter((g) => g.tasks.length > 0);

  const dueThisWeek = inbox.tasks.filter(
    (t) => t.daysRemaining !== null && t.daysRemaining >= 0 && t.daysRemaining <= 7,
  ).length;

  return (
    <>
      <PageHeader
        title="My tasks"
        description="Everything the application is waiting on you for, newest deadline first. Overdue work is listed at the top."
      />

      {inbox.total === 0 ? (
        <Card>
          <EmptyState
            illustration="clear"
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
            title="Nothing is waiting on you"
            description={
              <>
                No reviews to write, no feedback requests, no open surveys and no overdue action
                items. When something is assigned to you it will appear here and in the bell menu.
              </>
            }
            action={
              <>
                <Link
                  href="/goals"
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  Review your goals
                </Link>
                <span aria-hidden className="text-slate-300">
                  ·
                </span>
                <Link
                  href="/feedback/new"
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  Recognize a colleague
                </Link>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <Grid cols={3} className="mb-6">
            <StatTile
              label="Waiting on you"
              value={inbox.total}
              denominator={`${inbox.tasks.filter((t) => t.group === 'Reviews').length} of them review work`}
            />
            <StatTile
              label="Overdue"
              value={inbox.overdueCount}
              tone={inbox.overdueCount > 0 ? 'danger' : 'success'}
              hint={inbox.overdueCount === 0 ? 'Nothing past its due date.' : 'Shown first in the list below.'}
            />
            <StatTile
              label="Due in the next 7 days"
              value={dueThisWeek}
              tone={dueThisWeek > 0 ? 'warning' : 'neutral'}
            />
          </Grid>

          <div className="space-y-5">
            {grouped.map(({ group, tasks }) => {
              const Icon = GROUP_ICONS[group];
              const overdue = tasks.filter((t) => t.overdue).length;
              return (
                <Card key={group}>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-2">
                        <Icon aria-hidden className="h-4 w-4 text-slate-400" />
                        {group}
                      </span>
                    }
                    actions={
                      <span className="flex items-center gap-2">
                        {overdue > 0 && <Badge tone="danger">{overdue} overdue</Badge>}
                        <Badge tone="neutral">{tasks.length}</Badge>
                      </span>
                    }
                  />
                  <ul className="divide-y divide-slate-100">
                    {tasks.map((t) => (
                      <TaskRow key={`${t.kind}-${t.id}`} task={t} />
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-slate-500">
        Last refreshed {formatDate(new Date())}. This list is built from stored records each time the
        page loads.
      </p>
    </>
  );
}
