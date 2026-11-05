import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import {
  calibrationCurrentScore,
  getCalibrationSession,
} from '@/server/services/calibration';
import { isAppError } from '@/server/errors';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailItem,
  DetailList,
  Grid,
  PageHeader,
  StatTile,
} from '@/components/ui/primitives';
import { countLabel, formatDate, formatScore, fullName } from '@/lib/utils';
import { CalibrationGrid, FinalizeButton } from './grid';

export const metadata = { title: 'Calibration session' };

export default async function CalibrationSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const { id } = await params;
  let session;
  try {
    session = await getCalibrationSession(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const finalized = session.status === 'FINALIZED';
  const decided = session.entries.filter((e) => e.decidedAt !== null).length;
  const adjusted = session.entries.filter(
    (e) => e.decidedAt !== null && e.finalScore !== e.originalScore,
  ).length;
  const released = session.entries.filter((e) => e.participant.releasedAt !== null).length;

  const rows = session.entries.map((e) => ({
    participantId: e.participant.id,
    name: fullName(e.participant.employee),
    employeeId: e.participant.employee.id,
    jobTitle: e.participant.jobTitleNameSnapshot,
    department: e.participant.departmentNameSnapshot,
    manager: e.participant.managerNameSnapshot,
    status: e.participant.status,
    originalScore: e.originalScore,
    computedScore: e.participant.finalScore,
    proposedScore: e.proposedScore,
    finalScore: e.finalScore,
    currentScore: calibrationCurrentScore(e),
    rationale: e.rationale,
    decidedAt: e.decidedAt ? formatDate(e.decidedAt) : null,
    decidedBy: e.decidedBy ? `${e.decidedBy.firstName} ${e.decidedBy.lastName}` : null,
    released: e.participant.releasedAt !== null,
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Administration', href: '/admin' },
          { label: 'Calibration', href: '/admin/calibration' },
          { label: session.name },
        ]}
        title={session.name}
        description={
          <>
            <Link href={`/reviews/cycles/${session.cycle.id}`} className="font-medium underline">
              {session.cycle.name}
            </Link>
            {session.cycle.templateVersion && (
              <>
                {' · '}
                {session.cycle.templateVersion.template.name} v
                {session.cycle.templateVersion.versionNumber}
              </>
            )}
          </>
        }
        actions={
          <>
            <Badge tone={finalized ? 'neutral' : 'info'}>
              {finalized ? 'Finalised' : 'In progress'}
            </Badge>
            {!finalized && (
              <FinalizeButton
                sessionId={session.id}
                total={session.entries.length}
                decided={decided}
                adjusted={adjusted}
                notes={session.notes}
              />
            )}
          </>
        }
      />

      <Grid cols={4} className="mb-6">
        <StatTile
          label="Decisions recorded"
          value={decided}
          denominator={`of ${session.entries.length}`}
          tone={decided === session.entries.length ? 'success' : 'neutral'}
        />
        <StatTile
          label="Scores adjusted"
          value={adjusted}
          hint={adjusted === 0 ? 'Nothing moved.' : 'Each one carries its reason.'}
        />
        <StatTile
          label="Scored"
          value={session.distribution.scored}
          denominator={`of ${session.distribution.total}`}
          hint={
            session.distribution.unscored > 0
              ? `${session.distribution.unscored} have no score and are counted separately.`
              : undefined
          }
        />
        <StatTile
          label="Already released"
          value={released}
          tone={released > 0 ? 'warning' : 'neutral'}
          hint={released > 0 ? 'Locked — the employee has read them.' : 'None.'}
        />
      </Grid>

      {finalized && (
        <Alert tone="neutral" className="mb-5 max-w-4xl" title="This session is closed">
          Its decisions are the record of what was agreed and cannot be edited. If something needs
          revisiting, open a new session — the earlier reasoning stays readable rather than being
          overwritten.
          {session.finalizedAt && <> Finalised {formatDate(session.finalizedAt)}.</>}
        </Alert>
      )}

      {released > 0 && !finalized && (
        <Alert tone="warning" className="mb-5 max-w-4xl" title="Some results have been released">
          {countLabel(released, 'participant')} in this session {released === 1 ? 'has' : 'have'}
          {' '}already had results released. Their scores are locked: changing one now would alter a
          record the employee has already read. They are shown for context only.
        </Alert>
      )}

      <Card className="mb-5">
        <CardHeader
          title="Distribution"
          description={`Before and after the decisions recorded so far. Denominator: the ${session.distribution.scored} participants who have a score. The ${session.distribution.unscored} without one are not placed in a band — a missing score is not a low score.`}
        />
        <CardBody>
          {session.distribution.scored === 0 ? (
            <p className="text-sm text-slate-500">
              Nobody in this session has a calculated score yet, so there is no distribution to show.
            </p>
          ) : (
            <table className="w-full max-w-2xl text-sm">
              <caption className="sr-only">
                Score distribution before and after calibration decisions
              </caption>
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th scope="col" className="py-1 text-left font-semibold">
                    Band
                  </th>
                  <th scope="col" className="py-1 text-right font-semibold">
                    Before
                  </th>
                  <th scope="col" className="py-1 text-right font-semibold">
                    Now
                  </th>
                  <th scope="col" className="w-1/2 py-1 pl-4 text-left font-semibold">
                    Now
                  </th>
                </tr>
              </thead>
              <tbody>
                {session.distribution.bands.map((band) => {
                  const pct =
                    session.distribution.scored > 0
                      ? (band.after / session.distribution.scored) * 100
                      : 0;
                  const moved = band.after - band.before;
                  return (
                    <tr key={band.label} className="border-t border-slate-100">
                      <th scope="row" className="py-1.5 text-left font-medium text-slate-700">
                        {band.label}
                      </th>
                      <td className="py-1.5 text-right text-slate-500">{band.before}</td>
                      <td className="py-1.5 text-right font-medium text-slate-900">
                        {band.after}
                        {moved !== 0 && (
                          <span
                            className={
                              'ml-1 text-xs font-normal ' +
                              (moved > 0 ? 'text-emerald-700' : 'text-amber-700')
                            }
                          >
                            {moved > 0 ? `+${moved}` : moved}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pl-4">
                        <div className="flex items-center gap-2">
                          <div
                            aria-hidden
                            className="h-2.5 rounded-sm bg-brand-600"
                            style={{ width: `${Math.max(pct, band.after > 0 ? 2 : 0)}%` }}
                          />
                          <span className="text-xs text-slate-500">{Math.round(pct)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <CalibrationGrid sessionId={session.id} rows={rows} readOnly={finalized} />

      {(session.notes || session.facilitator) && (
        <Card className="mt-5">
          <CardHeader title="Session" />
          <CardBody>
            <DetailList cols={2}>
              {session.facilitator && (
                <DetailItem label="Facilitator">
                  {session.facilitator.firstName} {session.facilitator.lastName}
                </DetailItem>
              )}
              <DetailItem label="Opened">{formatDate(session.createdAt)}</DetailItem>
            </DetailList>
            {session.notes && (
              <p className="mt-3 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-700">
                {session.notes}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <p className="mt-6 max-w-3xl text-xs leading-relaxed text-slate-500">
        Scores shown here are the weighted result of the submitted reviews, calculated from the
        template version this cycle was launched against. A calibrated score never replaces the
        calculated one in the record — both are kept, and the released review shows the adjustment and
        its reason beside the arithmetic. See docs/SCORING.md for how the figure is derived, including
        what happens when a component is missing: a question nobody answered is excluded and lowers
        coverage, rather than being counted as {formatScore(0)}.
      </p>
    </>
  );
}
