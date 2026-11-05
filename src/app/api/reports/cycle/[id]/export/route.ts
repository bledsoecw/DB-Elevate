import { csvResponse, handler } from '@/server/api';
import { prisma } from '@/server/db';
import { loadManagerHistory } from '@/server/authz/history';
import { participantAccess } from '@/server/authz/policy';
import { AUDIT_ACTIONS, recordAudit } from '@/server/audit';
import { ForbiddenError, NotFoundError } from '@/server/errors';

/**
 * Review cycle export.
 *
 * Rows are filtered by exactly the same `participantAccess` rule the screens
 * use, resolved against the reporting line as it stood when the cycle launched.
 * A manager therefore exports their own line and nobody else's, and a
 * reorganization does not retroactively widen what they can download.
 *
 * Draft review content is never exported. Only the fact that something is in
 * progress leaves this endpoint.
 */
export const GET = handler(async ({ actor, params, request }) => {
  const cycleId = params.id as string;

  const cycle = await prisma.reviewCycle.findFirst({
    where: { id: cycleId, orgId: actor.orgId },
    include: {
      templateVersion: { include: { template: { select: { name: true } } } },
      participants: {
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              preferredName: true,
              workEmail: true,
              employeeNumber: true,
            },
          },
          assignments: {
            include: { reviewer: { select: { firstName: true, lastName: true } } },
          },
          approvals: { select: { status: true, decidedAt: true } },
        },
      },
    },
  });
  if (!cycle) throw new NotFoundError();

  const history = await loadManagerHistory(actor.orgId);
  const visible = cycle.participants.filter((p) => {
    const at = p.snapshotTakenAt ?? cycle.launchedAt ?? new Date();
    return participantAccess(actor, p, history.chainAt(p.employeeId, at)) !== 'NONE';
  });

  if (visible.length === 0) {
    throw new ForbiddenError('There is nothing in this cycle that you have access to.');
  }

  const url = new URL(request.url);
  const includeScores = url.searchParams.get('scores') !== 'false';

  const header = [
    'Employee',
    'Work e-mail',
    'Employee number',
    'Job title at launch',
    'Department at launch',
    'Manager of record',
    'Stage',
    'Self-assessment',
    'Self submitted',
    'Manager review',
    'Manager submitted',
    'Peer reviews submitted',
    'Peer reviews assigned',
    'Approval',
    'Released',
    'Acknowledged',
    ...(includeScores ? ['Calculated score', 'Calibrated score'] : []),
  ];

  const rows: (string | number | null)[][] = [
    ['DB Elevate — review cycle export'],
    ['Cycle', cycle.name],
    ['Template', `${cycle.templateVersion.template.name} v${cycle.templateVersion.versionNumber}`],
    ['Period', `${cycle.periodStart.toISOString().slice(0, 10)} to ${cycle.periodEnd.toISOString().slice(0, 10)}`],
    ['Rows', `${visible.length} of ${cycle.participants.length} participants (limited to your reporting scope)`],
    ['Exported by', actor.displayName],
    ['Exported', new Date().toISOString()],
    [
      'Note',
      'Scores are positions on this template\u2019s own rating scale and should not be compared against a cycle that used a different scale. Draft review content is never included in an export.',
    ],
    [],
    header,
  ];

  for (const p of visible) {
    const self = p.assignments.find((a) => a.kind === 'SELF');
    const mgr = p.assignments.find((a) => a.kind === 'MANAGER');
    const peers = p.assignments.filter((a) => a.kind === 'PEER');
    const approval = p.approvals[0];

    rows.push([
      `${p.employee.preferredName || p.employee.firstName} ${p.employee.lastName}`,
      p.employee.workEmail,
      p.employee.employeeNumber ?? '',
      p.jobTitleNameSnapshot ?? '',
      p.departmentNameSnapshot ?? '',
      p.managerNameSnapshot ?? '',
      p.status,
      self?.status ?? 'Not assigned',
      self?.submittedAt ? self.submittedAt.toISOString().slice(0, 10) : '',
      mgr?.status ?? 'Not assigned',
      mgr?.submittedAt ? mgr.submittedAt.toISOString().slice(0, 10) : '',
      peers.filter((a) => a.status === 'SUBMITTED').length,
      peers.length,
      approval ? approval.status : cycle.requireApproval ? 'Not requested' : 'Not required',
      p.releasedAt ? p.releasedAt.toISOString().slice(0, 10) : '',
      p.acknowledgedAt ? p.acknowledgedAt.toISOString().slice(0, 10) : '',
      ...(includeScores
        ? [p.finalScore ?? '', p.calibratedScore ?? '']
        : []),
    ]);
  }

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EXPORT_GENERATED,
    entityType: 'review_cycle',
    entityId: cycleId,
    summary: `Exported ${visible.length} participant rows from "${cycle.name}".`,
    metadata: { rows: visible.length, totalInCycle: cycle.participants.length },
  });

  const safe = cycle.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return csvResponse(`review-cycle-${safe}.csv`, rows);
});
