import Link from 'next/link';
import { AlertTriangle, Download, Info } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import {
  actionReport,
  competencyReport,
  goalReport,
  listReportableCycles,
  nineBoxReport,
  participationByGroup,
  ratingDistributionReport,
  reviewCompletionReport,
  scoreTrendReport,
} from '@/server/services/reports';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Grid,
  LinkTabs,
  PageHeader,
  StatTile,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { BarChart, SegmentedBar } from '@/components/charts/bar-chart';
import { ColumnChart, StackedColumnChart } from '@/components/charts/column-chart';
import { LineChart } from '@/components/charts/line-chart';
import { Heatmap } from '@/components/charts/heatmap';
import { CHROME, ORDINAL_5, STATUS, STAGE_COLORS, healthColor } from '@/components/charts/palette';
import { CycleSelect } from './cycle-select';
import { formatDate } from '@/lib/utils';
import { GOAL_HEALTH_LABELS, GOAL_STATUS_LABELS, type GoalHealth, type GoalStatus } from '@/lib/enums';

export const metadata = { title: 'Reports' };

type Tab = 'reviews' | 'goals' | 'meetings' | 'talent';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cycle?: string; group?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const cycles = await listReportableCycles(actor);
  const cycleId = sp.cycle && cycles.some((c) => c.id === sp.cycle) ? sp.cycle : cycles[0]?.id;

  const tab = (['reviews', 'goals', 'meetings', 'talent'].includes(sp.tab ?? '') ? sp.tab : 'reviews') as Tab;
  const groupBy = (['department', 'jobTitle', 'manager'].includes(sp.group ?? '')
    ? sp.group
    : 'department') as 'department' | 'jobTitle' | 'manager';

  const canSeeTalent = actor.isHrAdmin || actor.isLeadership;

  const [completion, distribution, trend, goals, actions, participation, competencies, nineBox] =
    await Promise.all([
      tab === 'reviews' ? reviewCompletionReport(actor) : null,
      tab === 'reviews' && cycleId ? ratingDistributionReport(actor, cycleId) : null,
      tab === 'reviews' ? scoreTrendReport(actor) : null,
      tab === 'goals' ? goalReport(actor) : null,
      tab === 'meetings' ? actionReport(actor) : null,
      tab === 'reviews' && cycleId ? participationByGroup(actor, cycleId, groupBy) : null,
      tab === 'talent' && cycleId ? competencyReport(actor, cycleId) : null,
      tab === 'talent' && cycleId && canSeeTalent ? nineBoxReport(actor, cycleId) : null,
    ]);

  const tabs = [
    { key: 'reviews', label: 'Reviews', href: '/reports?tab=reviews' },
    { key: 'goals', label: 'Goals', href: '/reports?tab=goals' },
    { key: 'meetings', label: 'Meetings & follow-up', href: '/reports?tab=meetings' },
    ...(canSeeTalent ? [{ key: 'talent', label: 'Competencies & talent', href: '/reports?tab=talent' }] : []),
  ];

  const scopeNote =
    completion?.note ??
    (actor.isHrAdmin || actor.isLeadership
      ? 'Covering every employee in the organization.'
      : actor.isManager
        ? 'Covering you and your reporting line.'
        : 'Covering your own records only.');

  return (
    <>
      <PageHeader
        title="Reports"
        description="Built from stored records at page load. Every figure shows the counts it was derived from."
        meta={
          <Badge tone="brand">
            <Info aria-hidden className="h-3 w-3" />
            {scopeNote}
          </Badge>
        }
        actions={
          cycleId ? (
            <ButtonLink href={`/api/reports/cycle/${cycleId}/export`}>
              <Download aria-hidden className="h-4 w-4" />
              Export this cycle
            </ButtonLink>
          ) : undefined
        }
      />

      <LinkTabs tabs={tabs} current={tab} className="mb-5" />

      {cycles.length === 0 ? (
        <Card>
          <EmptyState
            illustration="results"
            title="Nothing to report on yet"
            description="Once a review cycle has been launched, completion, participation and rating reports appear here."
            action={actor.isHrAdmin ? <ButtonLink href="/reviews/cycles/new" variant="primary">Create a review cycle</ButtonLink> : undefined}
          />
        </Card>
      ) : (
        <>
          {(tab === 'reviews' || tab === 'talent') && (
            <Card className="mb-5">
              <CardBody>
                <CycleSelect
                  cycles={cycles.map((c) => ({
                    id: c.id,
                    label: `${c.name} (${formatDate(c.periodStart)} — ${formatDate(c.periodEnd)})`,
                  }))}
                  current={cycleId ?? ''}
                  tab={tab}
                  groupBy={tab === 'reviews' ? groupBy : undefined}
                />
              </CardBody>
            </Card>
          )}

          {/* ------------------------------------------------- reviews */}
          {tab === 'reviews' && completion && (
            <div className="space-y-5">
              <Card>
                <CardHeader
                  title="Completion by cycle"
                  description="Submitted reviews against reviews assigned."
                />
                {completion.cycles.length === 0 ? (
                  <EmptyState
            illustration="results" title="No cycles in your scope" />
                ) : (
                  <TableWrap>
                    <thead>
                      <tr>
                        <Th>Cycle</Th>
                        <Th align="right">People</Th>
                        <Th align="right">Self</Th>
                        <Th align="right">Manager</Th>
                        <Th align="right">Peer</Th>
                        <Th align="right">Released</Th>
                        <Th align="right">Acknowledged</Th>
                        <Th align="right">Overdue</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {completion.cycles.map((c) => (
                        <tr key={c.cycleId} className="hover:bg-slate-50">
                          <Td>
                            <Link href={`/reviews/cycles/${c.cycleId}`} className="font-medium text-slate-900 hover:underline">
                              {c.cycleName}
                            </Link>
                            <span className="block text-xs text-slate-500">{c.templateName}</span>
                          </Td>
                          <Td align="right" className="tabular-nums">{c.participants}</Td>
                          <Td align="right" className="tabular-nums">
                            {c.selfTotal === 0 ? '—' : `${c.selfSubmitted}/${c.selfTotal}`}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {c.managerTotal === 0 ? '—' : `${c.managerSubmitted}/${c.managerTotal}`}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {c.peerTotal === 0 ? '—' : `${c.peerSubmitted}/${c.peerTotal}`}
                          </Td>
                          <Td align="right" className="tabular-nums">{c.released}</Td>
                          <Td align="right" className="tabular-nums">{c.acknowledged}</Td>
                          <Td align="right" className="tabular-nums">
                            {c.overdue > 0 ? (
                              <span className="font-semibold text-rose-700">{c.overdue}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                )}
                {completion.cycles.length > 0 && (
                  <CardBody className="border-t border-slate-200">
                    <StackedColumnChart
                      title="Where each cycle's reviews have got to"
                      subtitle="Manager reviews only, since that is the step the cycle waits on."
                      groups={completion.cycles.map((c) => ({
                        label: c.cycleName.length > 18 ? `${c.cycleName.slice(0, 16)}…` : c.cycleName,
                        values: {
                          submitted: c.managerSubmitted,
                          outstanding: Math.max(c.managerTotal - c.managerSubmitted - c.overdue, 0),
                          overdue: c.overdue,
                        },
                      }))}
                      stages={[
                        { key: 'submitted', label: 'Submitted', color: ORDINAL_5[3] },
                        { key: 'outstanding', label: 'Still to do', color: ORDINAL_5[0] },
                        { key: 'overdue', label: 'Overdue', color: STATUS.critical },
                      ]}
                      footnote="Counted from assignment records. Each bar totals the manager reviews assigned in that cycle."
                    />
                  </CardBody>
                )}
              </Card>

              {completion.overdue.length > 0 && (
                <Card>
                  <CardHeader
                    title={
                      <span className="flex items-center gap-2">
                        <AlertTriangle aria-hidden className="h-4 w-4 text-amber-500" />
                        Overdue assignments
                      </span>
                    }
                    description="Open reviews past their due date, oldest first."
                    actions={<Badge tone="danger">{completion.overdue.length}</Badge>}
                  />
                  <TableWrap>
                    <thead>
                      <tr>
                        <Th>Reviewer</Th>
                        <Th>Review of</Th>
                        <Th>Type</Th>
                        <Th>Cycle</Th>
                        <Th align="right">Days overdue</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {completion.overdue.slice(0, 40).map((o) => (
                        <tr key={o.assignmentId} className="hover:bg-slate-50">
                          <Td>
                            <Link href={`/people/${o.reviewerId}`} className="font-medium text-slate-900 hover:underline">
                              {o.reviewerName}
                            </Link>
                          </Td>
                          <Td className="text-slate-700">{o.subjectName}</Td>
                          <Td className="text-slate-600">{o.kind.toLowerCase()}</Td>
                          <Td className="text-slate-600">{o.cycleName}</Td>
                          <Td align="right" className="font-semibold tabular-nums text-rose-700">
                            {o.daysOverdue}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </Card>
              )}

              {participation && (
                <Card>
                  <CardHeader
                    title="Participation by group"
                    description={participation.note}
                  />
                  <TableWrap>
                    <thead>
                      <tr>
                        <Th>{groupBy === 'manager' ? 'Manager of record' : groupBy === 'jobTitle' ? 'Job title' : 'Department'}</Th>
                        <Th align="right">People</Th>
                        <Th align="right">Self submitted</Th>
                        <Th align="right">Manager submitted</Th>
                        <Th align="right">Released</Th>
                        <Th align="right">Acknowledged</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {participation.rows.map((r) => (
                        <tr key={r.group}>
                          <Td className="font-medium text-slate-800">{r.group}</Td>
                          <Td align="right" className="tabular-nums">{r.people}</Td>
                          <Td align="right" className="tabular-nums">
                            {r.selfTotal === 0 ? '—' : `${r.selfSubmitted} of ${r.selfTotal}`}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {r.managerTotal === 0 ? '—' : `${r.managerSubmitted} of ${r.managerTotal}`}
                          </Td>
                          <Td align="right" className="tabular-nums">{r.released} of {r.people}</Td>
                          <Td align="right" className="tabular-nums">{r.acknowledged} of {r.people}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </Card>
              )}

              {distribution && distribution.buckets.length > 0 && (
                <Card>
                  <CardBody>
                    <ColumnChart
                      title={`Rating distribution — ${distribution.cycleName}`}
                      subtitle={
                        distribution.mean !== null
                          ? `Mean ${distribution.mean} of 100 across ${distribution.scored} scored reviews.`
                          : 'No scores recorded yet.'
                      }
                      data={distribution.buckets.map((b, i) => ({
                        label: b.label.split('—')[1]?.trim() ?? b.label,
                        value: b.count,
                        color: ORDINAL_5[Math.min(i, ORDINAL_5.length - 1)],
                      }))}
                      yLabel="People"
                      valueFormat="integer"
                      footnote={
                        <>
                          {distribution.scored} of {distribution.participants} participants have a
                          score; {distribution.notScored} do not yet.
                          {distribution.scaleName &&
                            ` Bands are the levels of the "${distribution.scaleName}" scale, mapped from the 0–100 overall score.`}
                          {distribution.mixedTemplates && (
                            <>
                              {' '}
                              <strong>
                                This cycle used more than one template ({distribution.templateNames.join(', ')}).
                              </strong>{' '}
                              A score is a position on its own template&rsquo;s scale, so these bars
                              pool measures that are not strictly identical.
                            </>
                          )}
                        </>
                      }
                    />
                  </CardBody>
                </Card>
              )}

              {trend && trend.points.length > 1 && (
                <Card>
                  <CardBody>
                    <LineChart
                      title="Mean score across cycles"
                      subtitle="One point per cycle, in period order."
                      series={[
                        {
                          label: 'Mean score',
                          points: trend.points.map((p) => ({
                            x: p.cycleName.length > 14 ? `${p.cycleName.slice(0, 12)}…` : p.cycleName,
                            y: p.mean,
                          })),
                        },
                      ]}
                      yMin={0}
                      yMax={100}
                      yLabel="of 100"
                      footnote={
                        <>
                          Each point is the mean of the finalized scores for that cycle, over{' '}
                          {trend.points.map((p) => `${p.scored} of ${p.participants}`).join(', ')}{' '}
                          participants respectively. A period with no scored reviews breaks the line
                          rather than being drawn as zero.
                          {trend.caveat && (
                            <>
                              {' '}
                              <strong className="text-amber-700">{trend.caveat}</strong>
                            </>
                          )}
                        </>
                      }
                    />
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {/* --------------------------------------------------- goals */}
          {tab === 'goals' && goals && (
            <div className="space-y-5">
              <Grid cols={4}>
                <StatTile label="Goals in scope" value={goals.total} />
                <StatTile
                  label="Average progress"
                  value={goals.averageProgress === null ? '—' : `${goals.averageProgress}%`}
                  denominator={`across the ${goals.withProgress} of ${goals.total} with progress recorded`}
                />
                <StatTile
                  label="Needing attention"
                  value={goals.needsAttention}
                  tone={goals.needsAttention > 0 ? 'warning' : 'success'}
                  denominator="overdue, blocked, at risk or off track"
                />
                <StatTile
                  label="Completed on time"
                  value={goals.completedOnTime}
                  denominator={`${goals.completedLate} completed late`}
                  tone="success"
                />
              </Grid>

              <Card>
                <CardBody>
                  <SegmentedBar
                    title="Goals by status"
                    subtitle="Every goal in your reporting scope."
                    parts={goals.byStatus.map((s) => ({
                      label: GOAL_STATUS_LABELS[s.status as GoalStatus] ?? s.status,
                      value: s.count,
                      color: STAGE_COLORS[s.status] ?? ORDINAL_5[2],
                    }))}
                    totalLabel={`${goals.total} goals`}
                    footnote="Counted from goal records at page load."
                  />
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <BarChart
                    title="Goals by health"
                    subtitle="As last reported by the goal owner."
                    data={goals.byHealth.map((h) => ({
                      label: GOAL_HEALTH_LABELS[h.health as GoalHealth] ?? h.health,
                      value: h.count,
                      color: healthColor(h.health),
                    }))}
                    valueFormat="integer"
                    footnote="Health is self-reported on each goal and is only as current as the last update. The goals page flags any goal with no update for a month."
                    legend={goals.byHealth.map((h) => ({
                      label: GOAL_HEALTH_LABELS[h.health as GoalHealth] ?? h.health,
                      color: healthColor(h.health),
                      note: 'icon and label carry the meaning',
                    }))}
                  />
                </CardBody>
              </Card>

              {goals.byDepartment.length > 1 && (
                <Card>
                  <CardBody>
                    <BarChart
                      title="Average progress by department"
                      data={goals.byDepartment.map((d) => ({
                        label: d.department,
                        value: d.averageProgress ?? 0,
                        displayValue:
                          d.averageProgress === null ? 'Not recorded' : `${d.averageProgress}%`,
                        note: `${d.withProgress} of ${d.total} goals have progress recorded`,
                        color: d.averageProgress === null ? CHROME.absent : ORDINAL_5[2],
                      }))}
                      max={100}
                      footnote="Averaged only over goals that have a progress figure. Departments where no goal has been updated show as not recorded rather than as zero."
                    />
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {/* ------------------------------------------------ meetings */}
          {tab === 'meetings' && actions && (
            <div className="space-y-5">
              <Grid cols={4}>
                <StatTile label="Meetings held" value={actions.meetingsHeld} denominator={`${actions.meetingsScheduled} upcoming`} />
                <StatTile label="Action items" value={actions.total} />
                <StatTile
                  label="Overdue"
                  value={actions.overdue}
                  tone={actions.overdue > 0 ? 'danger' : 'success'}
                  denominator={`of ${actions.open + actions.inProgress} still open`}
                />
                <StatTile
                  label="Completed on time"
                  value={actions.completedOnTime}
                  denominator={`${actions.completedLate} completed late, of ${actions.completed} completed`}
                  tone="success"
                />
              </Grid>

              <Card>
                <CardBody>
                  <SegmentedBar
                    title="Action items by status"
                    parts={[
                      { label: 'Completed', value: actions.completed, color: ORDINAL_5[3] },
                      { label: 'In progress', value: actions.inProgress, color: ORDINAL_5[1] },
                      { label: 'Open', value: actions.open, color: CHROME.absent },
                    ]}
                    totalLabel={`${actions.total} action items in scope`}
                    footnote="HR-restricted action items, such as those on an improvement plan, are excluded from aggregate reporting."
                  />
                </CardBody>
              </Card>

              {actions.byOwner.length > 0 && (
                <Card>
                  <CardHeader title="By owner" description="Sorted by overdue, then open." />
                  <TableWrap>
                    <thead>
                      <tr>
                        <Th>Person</Th>
                        <Th align="right">Open</Th>
                        <Th align="right">Overdue</Th>
                        <Th align="right">Completed</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {actions.byOwner.map((o) => (
                        <tr key={o.name}>
                          <Td className="font-medium text-slate-800">{o.name}</Td>
                          <Td align="right" className="tabular-nums">{o.open}</Td>
                          <Td align="right" className="tabular-nums">
                            {o.overdue > 0 ? (
                              <span className="font-semibold text-rose-700">{o.overdue}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </Td>
                          <Td align="right" className="tabular-nums">{o.completed}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </Card>
              )}
            </div>
          )}

          {/* -------------------------------------------------- talent */}
          {tab === 'talent' && (
            <div className="space-y-5">
              {competencies && competencies.rows.length > 0 ? (
                <Card>
                  <CardBody>
                    <BarChart
                      title="Competency ratings, weakest first"
                      subtitle="Mean manager rating for each competency assessed in this cycle."
                      data={competencies.rows.map((r) => ({
                        label: r.competency,
                        value: r.mean,
                        displayValue: `${r.mean.toFixed(2)} / ${r.scaleMax}`,
                        note: `${r.responses} ratings${r.notApplicable > 0 ? `, ${r.notApplicable} marked not applicable` : ''}`,
                      }))}
                      max={Math.max(...competencies.rows.map((r) => r.scaleMax))}
                      footnote={competencies.note}
                    />
                  </CardBody>
                </Card>
              ) : (
                <Card>
                  <EmptyState
            illustration="results"
                    title="No competency ratings in this cycle"
                    description="Competency ratings appear once manager reviews using a competency template have been submitted."
                  />
                </Card>
              )}

              {nineBox && (
                <Card>
                  <CardBody>
                    <Heatmap
                      title={`Performance and readiness — ${nineBox.cycleName}`}
                      subtitle="Both axes come from answers people gave. Nothing here is inferred."
                      rowLabels={nineBox.rowLabels}
                      colLabels={nineBox.colLabels}
                      cells={nineBox.cells}
                      rowAxisLabel="Performance"
                      colAxisLabel="Readiness for more responsibility"
                      footnote={
                        <>
                          {nineBox.note} This view is a conversation starter for a calibration
                          session, not a decision. Any action that follows from it needs a person to
                          make it.
                        </>
                      }
                    />
                  </CardBody>
                </Card>
              )}

              {nineBox && nineBox.unplaced > 0 && (
                <Alert tone="neutral" title={`${nineBox.unplaced} people could not be placed`}>
                  Someone is left off the grid when their review has no overall score, or the
                  readiness question was not answered. They are not quietly dropped into the bottom
                  corner.
                </Alert>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
