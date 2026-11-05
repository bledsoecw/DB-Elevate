import Link from 'next/link';
import { Plus, Target, TriangleAlert } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listGoals, type GoalWithProgress } from '@/server/services/goals';
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  Grid,
  LinkTabs,
  PageHeader,
  ProgressBar,
  StatTile,
} from '@/components/ui/primitives';
import { formatDate, relativeDueLabel, truncate } from '@/lib/utils';
import {
  GOAL_HEALTH_LABELS,
  GOAL_SCOPE_LABELS,
  GOAL_STATUS_LABELS,
  type GoalHealth,
  type GoalScope,
  type GoalStatus,
} from '@/lib/enums';

export const metadata = { title: 'Goals' };

const RISK_LABEL: Record<string, string> = {
  OVERDUE: 'Past due',
  BLOCKED: 'Blocked',
  OFF_TRACK: 'Off track',
  AT_RISK: 'At risk',
  DUE_SOON: 'Due soon',
};

const RISK_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  OVERDUE: 'danger',
  BLOCKED: 'danger',
  OFF_TRACK: 'warning',
  AT_RISK: 'warning',
  DUE_SOON: 'neutral',
};

function GoalCard({ goal, showOwner }: { goal: GoalWithProgress; showOwner: boolean }) {
  const tone =
    goal.risk === 'OVERDUE' || goal.risk === 'BLOCKED'
      ? 'danger'
      : goal.risk === 'AT_RISK' || goal.risk === 'OFF_TRACK'
        ? 'warning'
        : goal.status === 'COMPLETED'
          ? 'success'
          : 'brand';

  return (
    <li>
      <Link
        href={`/goals/${goal.id}`}
        className="block h-full rounded-lg border border-slate-200 bg-white p-4 shadow-card transition hover:border-brand-300 hover:shadow-pop"
      >
        <div className="flex items-start justify-between gap-2">
          <Badge tone={goal.scope === 'COMPANY' ? 'brand' : goal.scope === 'TEAM' ? 'info' : 'neutral'}>
            {GOAL_SCOPE_LABELS[goal.scope as GoalScope] ?? goal.scope}
          </Badge>
          {goal.risk !== 'NONE' && (
            <Badge tone={RISK_TONE[goal.risk] ?? 'neutral'}>{RISK_LABEL[goal.risk] ?? goal.risk}</Badge>
          )}
        </div>

        <h3 className="mt-2.5 text-sm font-semibold leading-snug text-slate-900">{goal.title}</h3>
        {goal.description && (
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{truncate(goal.description, 120)}</p>
        )}

        <div className="mt-3">
          <ProgressBar value={goal.progress.displayPct} tone={tone} label={goal.title} />
          <div className="mt-1.5 flex items-baseline justify-between gap-2">
            <span className="text-xs tabular-nums text-slate-700">
              {goal.progress.displayPct === null
                ? 'No progress recorded'
                : `${Math.round(goal.progress.displayPct)}%`}
            </span>
            <span className="text-[11px] text-slate-500">
              {goal.progress.source === 'COMPUTED'
                ? 'calculated'
                : goal.progress.source === 'REPORTED'
                  ? 'reported'
                  : ''}
            </span>
          </div>
          {goal.progress.divergent && (
            <p className="mt-1 text-[11px] text-amber-700">
              Owner reports {Math.round(goal.progress.reportedPct as number)}%
            </p>
          )}
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          {showOwner && goal.ownerName && (
            <div>
              <dt className="sr-only">Owner</dt>
              <dd>{goal.ownerName}</dd>
            </div>
          )}
          <div>
            <dt className="sr-only">Status</dt>
            <dd>{GOAL_STATUS_LABELS[goal.status as GoalStatus] ?? goal.status}</dd>
          </div>
          <div>
            <dt className="sr-only">Due</dt>
            <dd>{goal.dueDate ? relativeDueLabel(goal.dueDate) : 'No due date'}</dd>
          </div>
          {goal.parentGoalTitle && (
            <div className="w-full">
              <dt className="sr-only">Aligned to</dt>
              <dd className="truncate">Supports: {goal.parentGoalTitle}</dd>
            </div>
          )}
        </dl>
      </Link>
    </li>
  );
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; status?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const scopeParam = (sp.scope ?? 'mine').toUpperCase();
  const scope = ['MINE', 'TEAM', 'COMPANY', 'ALL'].includes(scopeParam)
    ? (scopeParam as 'MINE' | 'TEAM' | 'COMPANY' | 'ALL')
    : 'MINE';

  const [goals, mine, teamGoals, companyGoals] = await Promise.all([
    listGoals(actor, { scope, status: sp.status }),
    listGoals(actor, { scope: 'MINE' }),
    actor.isManager || actor.isHrAdmin ? listGoals(actor, { scope: 'TEAM' }) : Promise.resolve([]),
    listGoals(actor, { scope: 'COMPANY' }),
  ]);

  const tabs = [
    { key: 'mine', label: 'My goals', href: '/goals?scope=mine', count: mine.length },
    ...(actor.isManager || actor.isHrAdmin
      ? [{ key: 'team', label: 'My team', href: '/goals?scope=team', count: teamGoals.length }]
      : []),
    { key: 'company', label: 'Company', href: '/goals?scope=company', count: companyGoals.length },
    { key: 'all', label: 'Everything I can see', href: '/goals?scope=all' },
  ];

  const active = goals.filter((g) => g.status === 'NOT_STARTED' || g.status === 'IN_PROGRESS');
  const needsAttention = active.filter((g) => g.risk !== 'NONE' && g.risk !== 'DUE_SOON');
  const completed = goals.filter((g) => g.status === 'COMPLETED');
  const withProgress = active.filter((g) => g.progress.displayPct !== null);
  const averageProgress =
    withProgress.length > 0
      ? Math.round(
          withProgress.reduce((sum, g) => sum + (g.progress.displayPct as number), 0) /
            withProgress.length,
        )
      : null;

  return (
    <>
      <PageHeader
        title="Goals"
        description="Individual, team and company goals. What you can see depends on each goal's own visibility setting."
        actions={
          <ButtonLink href="/goals/new" variant="primary">
            <Plus aria-hidden className="h-4 w-4" />
            New goal
          </ButtonLink>
        }
      />

      <LinkTabs tabs={tabs} current={scope.toLowerCase()} className="mb-5" />

      <Grid cols={4} className="mb-5">
        <StatTile label="Active goals" value={active.length} />
        <StatTile
          label="Needing attention"
          value={needsAttention.length}
          tone={needsAttention.length > 0 ? 'warning' : 'success'}
          hint={needsAttention.length === 0 ? 'Nothing overdue, blocked or off track.' : undefined}
        />
        <StatTile
          label="Average progress"
          value={averageProgress === null ? '—' : `${averageProgress}%`}
          denominator={
            withProgress.length === active.length
              ? `across all ${active.length} active goals`
              : `across the ${withProgress.length} of ${active.length} with progress recorded`
          }
        />
        <StatTile label="Completed" value={completed.length} tone="success" />
      </Grid>

      {needsAttention.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <TriangleAlert aria-hidden className="h-4 w-4 text-amber-500" />
                Needing attention
              </span>
            }
            description="Overdue, blocked, at risk or off track."
          />
          <ul className="divide-y divide-slate-100">
            {needsAttention.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <Link href={`/goals/${g.id}`} className="font-medium text-slate-900 hover:underline">
                    {g.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {g.ownerName && scope !== 'MINE' ? `${g.ownerName} · ` : ''}
                    {GOAL_HEALTH_LABELS[g.health as GoalHealth] ?? g.health}
                    {g.dueDate ? ` · ${relativeDueLabel(g.dueDate)}` : ''}
                  </p>
                </div>
                <Badge tone={RISK_TONE[g.risk] ?? 'neutral'}>{RISK_LABEL[g.risk] ?? g.risk}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="h-5 w-5" />}
            title={scope === 'MINE' ? 'You have no goals yet' : 'Nothing to show'}
            description={
              scope === 'MINE'
                ? 'Two or three goals is usually right. A goal with a number attached gives a review something concrete to talk about.'
                : scope === 'COMPANY'
                  ? 'No company goals have been set. HR administrators and leadership can create them.'
                  : 'No goals here that you have permission to see.'
            }
            action={
              <ButtonLink href="/goals/new" variant="primary">
                Set a goal
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((g) => (
              <GoalCard key={g.id} goal={g} showOwner={scope !== 'MINE'} />
            ))}
          </ul>

          {completed.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Completed
              </h2>
              <Card>
                <ul className="divide-y divide-slate-100">
                  {completed.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/goals/${g.id}`} className="font-medium text-slate-900 hover:underline">
                          {g.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {g.ownerName && scope !== 'MINE' ? `${g.ownerName} · ` : ''}
                          Completed {formatDate(g.completedAt)}
                        </p>
                      </div>
                      <Badge tone="success">Completed</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
