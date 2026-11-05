import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AlertTriangle, CalendarClock, FileText, Lock, Users } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getCycle, listEligibleEmployees } from '@/server/services/cycles';
import { isAppError } from '@/server/errors';
import {
  Alert,
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DetailItem,
  DetailList,
  EmptyState,
  Grid,
  LinkTabs,
  PageHeader,
  StatTile,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { SegmentedBar } from '@/components/charts/bar-chart';
import { STAGE_COLORS, STATUS } from '@/components/charts/palette';
import { CycleControls, ParticipantPicker, ReviewerEditor } from './controls';
import { formatDate, fullName } from '@/lib/utils';
import {
  APPROVAL_AUTHORITY_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  CYCLE_STATUS_LABELS,
  PARTICIPANT_STATUS_LABELS,
  PEER_VISIBILITY_LABELS,
  type ApprovalAuthority,
  type AssignmentStatus,
  type CycleStatus,
  type ParticipantStatus,
  type PeerVisibilityMode,
} from '@/lib/enums';

export const metadata = { title: 'Review cycle' };

type Tab = 'progress' | 'participants' | 'reviewers' | 'settings';

export default async function CyclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/reviews');
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  let cycle: Awaited<ReturnType<typeof getCycle>>;
  try {
    cycle = await getCycle(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const tab = (['progress', 'participants', 'reviewers', 'settings'].includes(sp.tab ?? '')
    ? sp.tab
    : cycle.status === 'DRAFT'
      ? 'participants'
      : 'progress') as Tab;

  const eligible = tab === 'participants' ? await listEligibleEmployees(actor, id) : [];

  const launched = cycle.status === 'ACTIVE' || cycle.status === 'CLOSED';
  const all = cycle.participants.flatMap((p) => p.assignments);
  const now = new Date();
  const overdue = all.filter(
    (a) => ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(a.status) && a.dueAt && a.dueAt < now,
  ).length;

  const statusCounts: Record<string, number> = {};
  for (const p of cycle.participants) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

  const stageParts = (
    ['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'APPROVED', 'RELEASED', 'ACKNOWLEDGED', 'CLOSED'] as ParticipantStatus[]
  )
    .map((s) => ({
      label: PARTICIPANT_STATUS_LABELS[s],
      value: statusCounts[s] ?? 0,
      color: STAGE_COLORS[s] ?? STATUS.warning,
    }))
    .filter((p) => p.value > 0);

  const tabs = [
    ...(launched ? [{ key: 'progress', label: 'Progress', href: `/reviews/cycles/${id}` }] : []),
    {
      key: 'participants',
      label: 'Who takes part',
      href: `/reviews/cycles/${id}?tab=participants`,
      count: cycle.participants.length,
    },
    ...(launched ? [{ key: 'reviewers', label: 'Reviewers', href: `/reviews/cycles/${id}?tab=reviewers` }] : []),
    { key: 'settings', label: 'Settings', href: `/reviews/cycles/${id}?tab=settings` },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Reviews', href: '/reviews' },
          { label: 'Cycles', href: '/reviews/cycles' },
          { label: cycle.name },
        ]}
        title={cycle.name}
        description={cycle.description ?? undefined}
        meta={
          <>
            <Badge
              tone={
                cycle.status === 'ACTIVE' ? 'success' : cycle.status === 'DRAFT' ? 'neutral' : 'info'
              }
            >
              {CYCLE_STATUS_LABELS[cycle.status as CycleStatus] ?? cycle.status}
            </Badge>
            <Badge tone="neutral">
              <FileText aria-hidden className="h-3 w-3" />
              {cycle.templateVersion.template.name} v{cycle.templateVersion.versionNumber}
            </Badge>
            <Badge tone="neutral">
              <CalendarClock aria-hidden className="h-3 w-3" />
              {formatDate(cycle.periodStart)} — {formatDate(cycle.periodEnd)}
            </Badge>
            {launched && cycle.launchedAt && (
              <Badge tone="brand">Launched {formatDate(cycle.launchedAt)}</Badge>
            )}
          </>
        }
        actions={
          <CycleControls
            cycleId={id}
            status={cycle.status}
            participantCount={cycle.participants.length}
            name={cycle.name}
          />
        }
      />

      {cycle.status === 'DRAFT' && (
        <Alert tone="info" className="mb-5" title="This cycle has not been launched">
          Nobody has been told about it and no reviews exist yet. Choose who takes part, check the
          settings, then launch. Launching records each person&rsquo;s manager, job title and
          department as they stand at that moment, and everything afterwards resolves against that.
        </Alert>
      )}

      <LinkTabs tabs={tabs} current={tab} className="mb-5" />

      {/* -------------------------------------------------------- progress */}
      {tab === 'progress' && launched && (
        <div className="space-y-5">
          <Grid cols={4}>
            <StatTile label="People in the cycle" value={cycle.participants.length} />
            <StatTile
              label="Self-assessments"
              value={all.filter((a) => a.kind === 'SELF' && a.status === 'SUBMITTED').length}
              denominator={`of ${all.filter((a) => a.kind === 'SELF').length} assigned`}
            />
            <StatTile
              label="Manager reviews"
              value={all.filter((a) => a.kind === 'MANAGER' && a.status === 'SUBMITTED').length}
              denominator={`of ${all.filter((a) => a.kind === 'MANAGER').length} assigned`}
            />
            <StatTile
              label="Overdue"
              value={overdue}
              tone={overdue > 0 ? 'danger' : 'success'}
              href="/reports"
            />
          </Grid>

          {stageParts.length > 0 && (
            <Card>
              <CardBody>
                <SegmentedBar
                  title="Where each person's review has got to"
                  parts={stageParts}
                  totalLabel={`${cycle.participants.length} people`}
                  footnote="Counted from participant records. Each person sits at exactly one stage."
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Everyone in this cycle" />
            <TableWrap>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Manager of record</Th>
                  <Th>Self</Th>
                  <Th>Manager</Th>
                  <Th>Peers</Th>
                  <Th>Stage</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cycle.participants.map((p) => {
                  const self = p.assignments.find((a) => a.kind === 'SELF');
                  const mgr = p.assignments.find((a) => a.kind === 'MANAGER');
                  const peers = p.assignments.filter((a) => a.kind === 'PEER');
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="flex items-center gap-2.5">
                          <Avatar firstName={p.employee.firstName} lastName={p.employee.lastName} size="xs" />
                          <span className="min-w-0">
                            <Link
                              href={`/reviews/participants/${p.id}`}
                              className="font-medium text-slate-900 hover:underline"
                            >
                              {fullName(p.employee)}
                            </Link>
                            <span className="block text-xs text-slate-500">
                              {p.jobTitleNameSnapshot ?? p.employee.jobTitle?.name ?? '—'}
                            </span>
                          </span>
                        </span>
                      </Td>
                      <Td className="text-slate-600">{p.managerNameSnapshot ?? '—'}</Td>
                      <Td className="text-xs text-slate-600">
                        {self ? (ASSIGNMENT_STATUS_LABELS[self.status as AssignmentStatus] ?? self.status) : '—'}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {mgr ? (ASSIGNMENT_STATUS_LABELS[mgr.status as AssignmentStatus] ?? mgr.status) : '—'}
                      </Td>
                      <Td className="text-xs tabular-nums text-slate-600">
                        {peers.length === 0
                          ? '—'
                          : `${peers.filter((a) => a.status === 'SUBMITTED').length} of ${peers.length}`}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            ['RELEASED', 'ACKNOWLEDGED', 'CLOSED'].includes(p.status)
                              ? 'success'
                              : p.status === 'AWAITING_APPROVAL'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {PARTICIPANT_STATUS_LABELS[p.status as ParticipantStatus] ?? p.status}
                        </Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      )}

      {/* ---------------------------------------------------- participants */}
      {tab === 'participants' && (
        <ParticipantPicker
          cycleId={id}
          locked={cycle.status === 'CLOSED' || cycle.status === 'CANCELLED'}
          launched={launched}
          employees={eligible}
        />
      )}

      {/* ------------------------------------------------------- reviewers */}
      {tab === 'reviewers' && launched && (
        <Card>
          <CardHeader
            title="Reviewers"
            description="Who writes each review. A submitted review cannot be unassigned — reopen it instead if it needs changing."
          />
          {cycle.participants.length === 0 ? (
            <EmptyState title="Nobody in this cycle" />
          ) : (
            <ul className="divide-y divide-slate-200">
              {cycle.participants.map((p) => (
                <li key={p.id} className="px-5 py-4">
                  <ReviewerEditor
                    participantId={p.id}
                    subjectName={fullName(p.employee)}
                    subjectFirstName={p.employee.firstName}
                    subjectLastName={p.employee.lastName}
                    assignments={p.assignments.map((a) => ({
                      id: a.id,
                      kind: a.kind,
                      status: a.status,
                      reviewerName: fullName(a.reviewer),
                      reviewerId: a.reviewerEmployeeId,
                    }))}
                    peerEnabled={cycle.peerReviewEnabled}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* -------------------------------------------------------- settings */}
      {tab === 'settings' && (
        <div className="space-y-5">
          {launched && (
            <Alert tone="neutral" icon={<Lock className="h-4 w-4" />} title="Partly fixed">
              This cycle has been launched, so the template and which kinds of review it collects
              cannot change — that would alter forms people are already filling in. Dates, release
              and acknowledgement settings can still be adjusted.
            </Alert>
          )}

          <Card>
            <CardHeader title="What this cycle collects" />
            <CardBody>
              <DetailList cols={2}>
                <DetailItem label="Template">
                  <Link
                    href={`/admin/templates/${cycle.templateVersion.template.id}?version=${cycle.templateVersionId}`}
                    className="hover:underline"
                  >
                    {cycle.templateVersion.template.name} v{cycle.templateVersion.versionNumber}
                  </Link>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {cycle.templateVersion._count.sections} sections. Frozen — editing the template
                    creates a new version and leaves this cycle alone.
                  </span>
                </DetailItem>
                <DetailItem label="Reviews collected">
                  <ul className="space-y-0.5 text-sm">
                    <li>{cycle.selfReviewEnabled ? 'Self-assessment' : 'No self-assessment'}</li>
                    <li>{cycle.managerReviewEnabled ? 'Manager review' : 'No manager review'}</li>
                    <li>
                      {cycle.peerReviewEnabled
                        ? `Peer reviews (${cycle.peerReviewTarget} per person)`
                        : 'No peer reviews'}
                    </li>
                  </ul>
                </DetailItem>
                <DetailItem label="Self-assessments due">{formatDate(cycle.selfDueAt)}</DetailItem>
                <DetailItem label="Manager reviews due">{formatDate(cycle.managerDueAt)}</DetailItem>
                <DetailItem label="Score weighting">
                  Self {Math.round(cycle.templateVersion.selfWeight * 100)}% · manager{' '}
                  {Math.round(cycle.templateVersion.managerWeight * 100)}% · peer{' '}
                  {Math.round(cycle.templateVersion.peerWeight * 100)}%
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Set on the template version. A component with no submitted score is dropped and
                    the rest renormalized.
                  </span>
                </DetailItem>
              </DetailList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Who sees what" />
            <CardBody>
              <DetailList cols={1}>
                <DetailItem label="Self-assessment shared with the manager">
                  {cycle.shareSelfWithManager
                    ? 'Yes — once submitted, the manager can read it while writing theirs. Drafts are never shared.'
                    : 'No — the manager writes without seeing it.'}
                </DetailItem>
                {cycle.peerReviewEnabled && (
                  <>
                    <DetailItem label="Peer review visibility">
                      {PEER_VISIBILITY_LABELS[cycle.peerVisibilityMode as PeerVisibilityMode] ??
                        cycle.peerVisibilityMode}
                    </DetailItem>
                    <DetailItem label="Peer content shared with the employee">
                      {cycle.sharePeerWithEmployee
                        ? 'Yes, on release.'
                        : 'No — peer input informs the manager review but is not shown to the employee.'}
                    </DetailItem>
                  </>
                )}
                <DetailItem label="Approval before release">
                  {cycle.requireApproval
                    ? `Yes — ${APPROVAL_AUTHORITY_LABELS[cycle.approvalAuthority as ApprovalAuthority] ?? cycle.approvalAuthority} approves each review. The approver is pinned when the cycle launches, so a reorganization does not move an in-flight decision.`
                    : 'No — a submitted manager review is ready to release.'}
                </DetailItem>
                <DetailItem label="Release">
                  {cycle.releaseMode === 'AUTO_ON_APPROVAL'
                    ? 'Automatic once approved.'
                    : 'Manual. An HR administrator releases each review deliberately.'}
                </DetailItem>
                <DetailItem label="Acknowledgement">
                  {cycle.requireAcknowledgement
                    ? 'Required. The employee confirms receipt, which does not mean agreement, and can add a comment stored with the review.'
                    : 'Not required.'}
                </DetailItem>
              </DetailList>
            </CardBody>
          </Card>

          {cycle.status === 'DRAFT' && (
            <Card>
              <CardHeader title="Change the settings" />
              <CardBody>
                <ButtonLink href={`/reviews/cycles/${id}/edit`}>Edit this cycle</ButtonLink>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {overdue > 0 && tab === 'progress' && (
        <Alert tone="warning" className="mt-5" icon={<AlertTriangle className="h-4 w-4" />}>
          {overdue} {overdue === 1 ? 'review is' : 'reviews are'} past their due date. Sending a
          reminder notifies only the people who still owe something, at most once each per day.
        </Alert>
      )}

      <p className="mt-5 flex items-center gap-1.5 text-xs text-slate-500">
        <Users aria-hidden className="h-3.5 w-3.5" />
        Cycle created {formatDate(cycle.createdAt)}
        {cycle.closedAt && ` · closed ${formatDate(cycle.closedAt)}`}
      </p>
    </>
  );
}
