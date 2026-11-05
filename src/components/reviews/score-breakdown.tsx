import { Calculator, Info, UserCheck } from 'lucide-react';
import { Alert, Badge, Card, CardBody, CardHeader, TableWrap, Td, Th } from '@/components/ui/primitives';
import type { FinalScoreResult, ReviewScoreResult } from '@/server/scoring/review-score';
import { REVIEWER_KIND_LABELS, type ReviewerKind } from '@/lib/enums';
import { safeJsonParse } from '@/lib/utils';

/**
 * Shows how a score was arrived at.
 *
 * A number on its own invites argument; the same number with its inputs,
 * its exclusions and its weighting is something a manager and an employee can
 * actually talk about. Every figure here is read back from the stored
 * calculation, not recomputed in the browser.
 */
export function ScoreBreakdown({
  finalScoreJson,
  finalScore,
  calibratedScore,
  calibrationNote,
  assignmentBreakdowns,
}: {
  finalScoreJson: string | null;
  finalScore: number | null;
  calibratedScore: number | null;
  calibrationNote: string | null;
  /** Per-assignment detail, so each section's contribution can be shown. */
  assignmentBreakdowns?: { kind: string; scoreJson: string | null }[];
}) {
  const final = safeJsonParse<FinalScoreResult | null>(finalScoreJson, null);

  if (finalScore === null && !final) {
    return (
      <Card>
        <CardHeader title="Score" />
        <CardBody>
          <Alert tone="neutral" icon={<Info className="h-4 w-4" />}>
            No score has been calculated. That happens when no submitted review contained a rating —
            a written-only review is perfectly valid and simply has no number attached.
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Score and how it was calculated"
        description="Every figure below comes from the stored calculation made when the review was submitted."
      />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Calculated score
            </p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">
              {finalScore === null ? 'Not scored' : finalScore.toFixed(1)}
              {finalScore !== null && (
                <span className="ml-1 text-base font-normal text-slate-500">of 100</span>
              )}
            </p>
          </div>
          {calibratedScore !== null && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-accent-700">
                <UserCheck aria-hidden className="h-3.5 w-3.5" />
                After calibration
              </p>
              <p className="mt-1 text-3xl font-semibold text-accent-700">
                {calibratedScore.toFixed(1)}
                <span className="ml-1 text-base font-normal text-slate-500">of 100</span>
              </p>
            </div>
          )}
        </div>

        {calibratedScore !== null && (
          <Alert tone="warning" title="A person adjusted this score">
            <p>{calibrationNote ?? 'No reason was recorded.'}</p>
            <p className="mt-1 text-xs">
              The calculated score of {finalScore?.toFixed(1) ?? 'none'} is kept and shown above. The
              adjustment sits beside it rather than replacing it.
            </p>
          </Alert>
        )}

        {final && (
          <>
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Calculator aria-hidden className="h-4 w-4 text-slate-400" />
                Weighting across review types
              </h4>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Review type</Th>
                    <Th align="right">Weight</Th>
                    <Th align="right">Score</Th>
                    <Th align="right">Submitted</Th>
                    <Th>Counted?</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {final.components.map((c) => (
                    <tr key={c.kind}>
                      <Td className="font-medium text-slate-800">
                        {REVIEWER_KIND_LABELS[c.kind as ReviewerKind] ?? c.kind}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {c.weight === 0 ? '—' : `${Math.round(c.weight * 100)}%`}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {c.score === null ? '—' : c.score.toFixed(1)}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {c.contributing}
                      </Td>
                      <Td>
                        {c.included ? (
                          <Badge tone="success">Counted</Badge>
                        ) : (
                          <span className="text-xs text-slate-500">{c.note}</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{final.note}</p>
              {final.coverage < 1 && (
                <p className="mt-1 text-xs leading-relaxed text-amber-700">
                  {Math.round((1 - final.coverage) * 100)}% of the configured weight had no submitted
                  score and was dropped. The remaining weights were renormalized, so the score is a
                  fair figure for what was received — not a penalty for what was not.
                </p>
              )}
            </div>

            {assignmentBreakdowns && assignmentBreakdowns.length > 0 && (
              <div className="space-y-4">
                {assignmentBreakdowns.map((b, i) => {
                  const detail = safeJsonParse<ReviewScoreResult | null>(b.scoreJson, null);
                  if (!detail) return null;
                  return (
                    <div key={`${b.kind}-${i}`}>
                      <h4 className="mb-2 text-sm font-semibold text-slate-800">
                        {REVIEWER_KIND_LABELS[b.kind as ReviewerKind] ?? b.kind} — section detail
                      </h4>
                      <TableWrap>
                        <thead>
                          <tr>
                            <Th>Section</Th>
                            <Th align="right">Weight</Th>
                            <Th align="right">Section score</Th>
                            <Th align="right">Questions counted</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {detail.sections.map((s) => {
                            const counted = s.questions.filter((q) => q.included).length;
                            const scoreable = s.questions.filter(
                              (q) => q.exclusionReason !== 'NOT_SCOREABLE',
                            ).length;
                            return (
                              <tr key={s.sectionId}>
                                <Td className="font-medium text-slate-800">{s.title}</Td>
                                <Td align="right" className="tabular-nums">
                                  {s.totalScoreableWeight === 0 ? 'Not scored' : s.weight}
                                </Td>
                                <Td align="right" className="tabular-nums">
                                  {s.score === null ? (
                                    <span className="text-slate-500">
                                      {scoreable === 0 ? 'Not scored' : 'No usable answers'}
                                    </span>
                                  ) : (
                                    s.score.toFixed(1)
                                  )}
                                </Td>
                                <Td align="right" className="tabular-nums text-slate-600">
                                  {scoreable === 0 ? '—' : `${counted} of ${scoreable}`}
                                </Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </TableWrap>

                      {(() => {
                        const excluded = detail.sections
                          .flatMap((s) => s.questions)
                          .filter(
                            (q) =>
                              q.exclusionReason &&
                              q.exclusionReason !== 'NOT_SCOREABLE' &&
                              !q.included,
                          );
                        if (excluded.length === 0) return null;
                        return (
                          <details className="mt-2 rounded-md bg-slate-50 px-3 py-2">
                            <summary className="cursor-pointer text-xs font-medium text-slate-700">
                              {excluded.length} rating{excluded.length === 1 ? '' : 's'} left out of
                              the score
                            </summary>
                            <ul className="mt-1.5 space-y-1 text-xs text-slate-600">
                              {excluded.map((q, qi) => (
                                <li key={`${q.questionId}-${q.subjectKey}-${qi}`}>
                                  <span className="font-medium text-slate-700">
                                    {q.subjectLabel ?? q.prompt}
                                  </span>{' '}
                                  —{' '}
                                  {q.exclusionReason === 'NOT_APPLICABLE'
                                    ? 'marked not applicable'
                                    : q.exclusionReason === 'UNANSWERED'
                                      ? 'not answered'
                                      : 'the scale could not produce a number'}
                                  . Excluded from both the top and the bottom of the calculation, so
                                  it is not a zero.
                                </li>
                              ))}
                            </ul>
                          </details>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}

            <Alert tone="neutral" icon={<Info className="h-4 w-4" />}>
              <p className="font-medium">How a rating becomes a number</p>
              <p className="mt-1 leading-relaxed">
                Each rating is placed on a 0–100 range using its own scale&rsquo;s lowest and highest
                level. A 3 on a 1–5 scale is 50; a 3 on a 1–3 scale is 100. Section scores are the
                weighted mean of the ratings that were given, and the overall score is the weighted
                mean of the sections. Because scales differ, scores from different templates should
                not be compared directly — see the note on any report that mixes them.
              </p>
            </Alert>
          </>
        )}
      </CardBody>
    </Card>
  );
}
