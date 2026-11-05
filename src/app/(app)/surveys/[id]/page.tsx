import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, EyeOff, Lock, Shield, Users } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getParticipation, getResults } from '@/server/services/surveys';
import { prisma } from '@/server/db';
import { canManageSurveys, canViewSurveyResults } from '@/server/authz/policy';
import { isAppError } from '@/server/errors';
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
  ProgressBar,
  StatTile,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { BarChart } from '@/components/charts/bar-chart';
import { ColumnChart } from '@/components/charts/column-chart';
import { CHROME, ORDINAL_5, STATUS } from '@/components/charts/palette';
import { SurveyAdminControls, ResultsFilters } from './controls';
import { formatDate, fullName } from '@/lib/utils';
import { SURVEY_STATUS_LABELS, type SurveyStatus } from '@/lib/enums';

export const metadata = { title: 'Survey' };

export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; dim?: string; value?: string; breakdown?: string }>;
}) {
  const actor = await requireActor();
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  if (!canViewSurveyResults(actor)) {
    const invited = actor.employeeId
      ? await prisma.surveyInvitation.findFirst({
          where: { surveyId: id, employeeId: actor.employeeId },
          include: { survey: { select: { id: true, title: true, status: true, mode: true } } },
        })
      : null;
    if (!invited) notFound();
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: 'Surveys', href: '/surveys' }, { label: invited.survey.title }]}
          title={invited.survey.title}
        />
        <Alert tone="neutral" title="Results are not shown to everyone">
          Survey results are available to HR administrators and leadership.{' '}
          {invited.survey.status === 'OPEN' && invited.status !== 'COMPLETED' && (
            <>
              This survey is still open —{' '}
              <Link href={`/surveys/respond/${id}`} className="font-medium underline">
                respond to it here
              </Link>
              .
            </>
          )}
        </Alert>
      </>
    );
  }

  let results: Awaited<ReturnType<typeof getResults>>;
  try {
    results = await getResults(actor, id, {
      filterDimension: sp.dim as 'department' | 'tenure' | 'location' | undefined,
      filterValue: sp.value,
      breakdownDimension: (sp.breakdown as 'department' | 'tenure' | 'location' | undefined) ?? 'department',
    });
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const isAdmin = canManageSurveys(actor);
  const tab = sp.tab === 'participation' && isAdmin ? 'participation' : 'results';
  const participation = tab === 'participation' ? await getParticipation(actor, id) : null;
  const anonymous = results.survey.mode === 'ANONYMOUS';

  const tabs = [
    { key: 'results', label: 'Results', href: `/surveys/${id}` },
    ...(isAdmin
      ? [{ key: 'participation', label: 'Participation', href: `/surveys/${id}?tab=participation` }]
      : []),
  ];

  const enpsQuestion = results.questions.find((q) => q.type === 'NPS' && q.enps);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Surveys', href: '/surveys' }, { label: results.survey.title }]}
        title={results.survey.title}
        description={results.survey.description ?? undefined}
        meta={
          <>
            {anonymous ? (
              <Badge tone="success">
                <EyeOff aria-hidden className="h-3 w-3" />
                Anonymous
              </Badge>
            ) : (
              <Badge tone="warning">
                <Users aria-hidden className="h-3 w-3" />
                Named
              </Badge>
            )}
            <Badge tone="neutral">
              {SURVEY_STATUS_LABELS[results.survey.status as SurveyStatus] ?? results.survey.status}
            </Badge>
            {results.survey.closesAt && (
              <Badge tone="neutral">Closes {formatDate(results.survey.closesAt)}</Badge>
            )}
          </>
        }
        actions={
          <>
            {results.reportable && (
              <ButtonLink href={`/api/reports/survey/${id}/export`}>
                <Download aria-hidden className="h-4 w-4" />
                Export
              </ButtonLink>
            )}
            {isAdmin && (
              <SurveyAdminControls
                surveyId={id}
                status={results.survey.status}
                mode={results.survey.mode}
              />
            )}
          </>
        }
      />

      <LinkTabs tabs={tabs} current={tab} className="mb-5" />

      {tab === 'results' && (
        <>
          <Grid cols={4} className="mb-5">
            <StatTile
              label="Responses"
              value={results.participation.responded}
              denominator={`of ${results.participation.invited} invited`}
            />
            <StatTile
              label="Participation"
              value={results.participation.rate === null ? '—' : `${results.participation.rate}%`}
              denominator={`${results.participation.responded} of ${results.participation.invited}`}
            />
            <StatTile
              label="Minimum before results show"
              value={results.survey.minResponsesForResults}
              hint={anonymous ? 'Protects respondent anonymity.' : 'This survey is named.'}
            />
            {enpsQuestion?.enps && (
              <StatTile
                label="eNPS"
                value={enpsQuestion.enps.score === null ? '—' : enpsQuestion.enps.score}
                denominator={`${enpsQuestion.enps.promoters} promoters − ${enpsQuestion.enps.detractors} detractors, of ${enpsQuestion.enps.n}`}
                tone={
                  enpsQuestion.enps.score === null
                    ? 'neutral'
                    : enpsQuestion.enps.score >= 20
                      ? 'success'
                      : enpsQuestion.enps.score >= 0
                        ? 'warning'
                        : 'danger'
                }
              />
            )}
          </Grid>

          {!results.reportable ? (
            <Card>
              <EmptyState
                icon={<Lock className="h-5 w-5" />}
                title="Results are hidden"
                description={results.notice ?? undefined}
                action={
                  isAdmin ? (
                    <p className="max-w-md text-xs leading-relaxed text-slate-500">
                      This is not a setting you can override. For an anonymous survey, showing results
                      from a handful of people would make the promise on the survey form untrue.
                    </p>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <div className="space-y-5">
              {results.filterRejectedReason && (
                <Alert tone="warning" title="That filter was not applied" icon={<Shield className="h-4 w-4" />}>
                  {results.filterRejectedReason} The unfiltered results are shown instead.
                </Alert>
              )}

              {results.availableFilters.length > 0 && (
                <Card>
                  <CardBody>
                    <ResultsFilters
                      surveyId={id}
                      anonymous={anonymous}
                      filters={results.availableFilters}
                      active={results.appliedFilter}
                      breakdown={results.breakdownDimension}
                    />
                  </CardBody>
                </Card>
              )}

              {results.factors.length > 0 && (
                <Card>
                  <CardBody>
                    <BarChart
                      title="Engagement factors"
                      subtitle={
                        results.appliedFilter
                          ? `Filtered to ${results.appliedFilter.value}.`
                          : 'Average rating across the questions that roll up to each factor.'
                      }
                      data={results.factors.map((f) => ({
                        label: f.factor,
                        value: f.mean,
                        displayValue: `${f.mean.toFixed(2)} / ${f.scaleMax}`,
                        note: `${f.questionCount} ${f.questionCount === 1 ? 'question' : 'questions'}, ${f.responseCount} answers`,
                      }))}
                      max={Math.max(...results.factors.map((f) => f.scaleMax))}
                      footnote={
                        <>
                          Each bar is the mean of every answer to the questions tagged with that
                          factor, on a {results.factors[0]?.scaleMax ?? 5}-point scale. Denominator:{' '}
                          {results.participation.responded} responses from{' '}
                          {results.participation.invited} invited.
                        </>
                      }
                    />
                  </CardBody>
                </Card>
              )}

              {results.breakdown && (
                <Card>
                  <CardBody>
                    <BarChart
                      title={`By ${results.breakdownDimension}`}
                      subtitle="Average rating across all scored questions."
                      data={results.breakdown.segments.map((s) => ({
                        label: s.suppressed ? `${s.label} — hidden` : s.label,
                        value: s.suppressed ? 0 : ((s.value as number) ?? 0),
                        color: s.suppressed ? CHROME.absent : ORDINAL_5[2],
                        displayValue: s.suppressed
                          ? 'Hidden'
                          : `${((s.value as number) ?? 0).toFixed(2)} (n=${s.n})`,
                        note: s.suppressed
                          ? s.reason === 'BELOW_THRESHOLD'
                            ? `Fewer than ${results.breakdown?.threshold} responses in this group.`
                            : 'Hidden so another hidden group cannot be worked out by subtraction.'
                          : undefined,
                      }))}
                      max={5}
                      footnote={
                        <>
                          {results.breakdown.notice ??
                            'Every group had enough responses to be shown.'}{' '}
                          The minimum is {results.breakdown.threshold} responses. These restrictions
                          apply to the export as well as to this page.
                        </>
                      }
                    />
                  </CardBody>
                </Card>
              )}

              {results.questions.map((q) => (
                <Card key={q.questionId}>
                  <CardBody>
                    {q.distribution && q.distribution.length > 0 ? (
                      <ColumnChart
                        title={q.prompt}
                        subtitle={
                          q.mean !== null && q.scaleMax
                            ? `Average ${q.mean.toFixed(2)} of ${q.scaleMax} · ${q.responseCount} answers`
                            : `${q.responseCount} answers`
                        }
                        data={q.distribution.map((d) => ({
                          label: d.label,
                          value: d.count,
                        }))}
                        yLabel="Responses"
                        valueFormat="integer"
                        footnote={
                          <>
                            Counted from {q.responseCount} answers to this question.
                            {q.factor && ` Rolls up to the "${q.factor}" factor.`}
                          </>
                        }
                      />
                    ) : q.type === 'TEXT' ? (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{q.prompt}</h3>
                        {q.verbatimNotice ? (
                          <Alert tone="neutral" className="mt-3" icon={<Lock className="h-4 w-4" />}>
                            {q.verbatimNotice}
                          </Alert>
                        ) : q.verbatims && q.verbatims.length > 0 ? (
                          <>
                            <p className="mt-1 text-xs text-slate-600">
                              {q.verbatims.length} written {q.verbatims.length === 1 ? 'answer' : 'answers'}
                              {anonymous ? ', shown in a shuffled order' : ''}.
                            </p>
                            <ul className="mt-3 space-y-2">
                              {q.verbatims.map((text, i) => (
                                <li
                                  key={i}
                                  className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm leading-relaxed text-slate-700"
                                >
                                  {text}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="mt-2 text-sm text-slate-500">No written answers.</p>
                        )}
                      </div>
                    ) : q.enps ? (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{q.prompt}</h3>
                        <div className="mt-3 grid grid-cols-3 gap-3">
                          {[
                            { label: 'Promoters (9–10)', value: q.enps.promoters, color: STATUS.good },
                            { label: 'Passives (7–8)', value: q.enps.passives, color: STATUS.warning },
                            { label: 'Detractors (0–6)', value: q.enps.detractors, color: STATUS.critical },
                          ].map((band) => (
                            <div key={band.label} className="rounded-md border border-slate-200 px-3 py-2.5">
                              <p className="flex items-center gap-1.5 text-xs text-slate-600">
                                <span
                                  aria-hidden
                                  className="h-2.5 w-2.5 rounded-sm"
                                  style={{ backgroundColor: band.color }}
                                />
                                {band.label}
                              </p>
                              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                                {band.value}
                              </p>
                              <ProgressBar
                                value={q.enps && q.enps.n > 0 ? (band.value / q.enps.n) * 100 : 0}
                                size="sm"
                                className="mt-1.5"
                                label={band.label}
                              />
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-slate-500">
                          eNPS = percentage of promoters minus percentage of detractors, over{' '}
                          {q.enps.n} responses. It ranges from −100 to +100 and is not a percentage
                          of anything.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{q.prompt}</h3>
                        <p className="mt-2 text-sm text-slate-500">{q.responseCount} answers.</p>
                      </div>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'participation' && participation && (
        <Card>
          <CardHeader title="Participation" description={participation.note} />
          <TableWrap>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Department</Th>
                <Th>Status</Th>
                <Th>Responded</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {participation.invitations.map((inv) => (
                <tr key={inv.id}>
                  <Td>
                    <Link href={`/people/${inv.employeeId}`} className="font-medium text-slate-900 hover:underline">
                      {fullName(inv.employee)}
                    </Link>
                  </Td>
                  <Td className="text-slate-600">{inv.employee.department?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={inv.status === 'COMPLETED' ? 'success' : 'neutral'}>
                      {inv.status === 'COMPLETED' ? 'Responded' : 'Not yet'}
                    </Badge>
                  </Td>
                  <Td className="text-slate-600">{formatDate(inv.completedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {anonymous && (
            <CardBody className="border-t border-slate-200">
              <Alert tone="neutral" icon={<EyeOff className="h-4 w-4" />} title="What this list is, and is not">
                It records who was invited and who took part. It holds no pointer to any response,
                and the response rows hold no respondent identity, so the two cannot be joined — not
                here, not in an export, not in the database.
              </Alert>
            </CardBody>
          )}
        </Card>
      )}
    </>
  );
}
