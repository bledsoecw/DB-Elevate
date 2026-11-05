'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Gavel, Lock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardHeader, TableWrap, Td, Th, Badge } from '@/components/ui/primitives';
import { FormError, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import { formatScore } from '@/lib/utils';

/**
 * The calibration grid.
 *
 * Every row shows the calculated score and, separately, whatever a person has
 * since decided. They are never merged into one figure: the whole point is that
 * a reader can tell arithmetic from judgement.
 */

export interface CalibrationRow {
  participantId: string;
  name: string;
  employeeId: string;
  jobTitle: string | null;
  department: string | null;
  manager: string | null;
  status: string;
  originalScore: number | null;
  computedScore: number | null;
  proposedScore: number | null;
  finalScore: number | null;
  currentScore: number | null;
  rationale: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  released: boolean;
}

export function CalibrationGrid({
  sessionId,
  rows,
  readOnly,
}: {
  sessionId: string;
  rows: CalibrationRow[];
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState<CalibrationRow | null>(null);

  return (
    <>
      <Card>
        <CardHeader
          title="Participants"
          description={
            readOnly
              ? 'The decisions recorded in this session, as they were left.'
              : 'Record a decision for each person. Leaving a score unchanged is a decision too and takes a reason, which is what makes this a record rather than a guess about who got discussed.'
          }
        />
        <TableWrap>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th align="right">Calculated</Th>
              <Th align="right">Decided</Th>
              <Th>Reason</Th>
              <Th align="right">{readOnly ? 'Decided by' : 'Decision'}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const moved =
                row.decidedAt !== null && row.finalScore !== row.originalScore;
              return (
                <tr key={row.participantId} className="align-top">
                  <Td>
                    <Link
                      href={`/reviews/participants/${row.participantId}`}
                      className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {row.jobTitle ?? 'No job title'}
                      {row.department && <> · {row.department}</>}
                    </p>
                    {row.manager && (
                      <p className="text-xs text-slate-400">Manager at launch: {row.manager}</p>
                    )}
                  </Td>

                  <Td align="right">
                    <span className="font-medium text-slate-700">
                      {formatScore(row.computedScore)}
                    </span>
                    {row.computedScore === null && (
                      <p className="text-xs text-slate-400">No score</p>
                    )}
                  </Td>

                  <Td align="right">
                    {row.decidedAt ? (
                      <>
                        <span
                          className={
                            'font-semibold ' + (moved ? 'text-amber-700' : 'text-slate-700')
                          }
                        >
                          {formatScore(row.finalScore)}
                        </span>
                        {moved && row.originalScore !== null && (
                          <p className="text-xs text-slate-500">
                            was {formatScore(row.originalScore)}
                          </p>
                        )}
                        {!moved && <p className="text-xs text-slate-400">unchanged</p>}
                      </>
                    ) : row.proposedScore !== null ? (
                      <>
                        <span className="font-medium text-slate-500">
                          {formatScore(row.proposedScore)}
                        </span>
                        <p className="text-xs text-amber-700">proposed only</p>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>

                  <Td>
                    {row.rationale ? (
                      <p className="max-w-sm text-xs leading-relaxed text-slate-600">
                        {row.rationale}
                      </p>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {readOnly ? '—' : 'Not recorded yet'}
                      </span>
                    )}
                  </Td>

                  <Td align="right">
                    {row.released ? (
                      <Badge tone="neutral" title="Results already released to the employee">
                        <Lock aria-hidden className="mr-1 inline h-3 w-3" />
                        Released
                      </Badge>
                    ) : readOnly ? (
                      <span className="text-xs text-slate-500">
                        {row.decidedBy ?? '—'}
                        {row.decidedAt && (
                          <span className="block text-slate-400">{row.decidedAt}</span>
                        )}
                      </span>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <Button
                          size="sm"
                          variant={row.decidedAt ? 'secondary' : 'primary'}
                          icon={
                            row.decidedAt ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Gavel className="h-3.5 w-3.5" />
                            )
                          }
                          onClick={() => setEditing(row)}
                        >
                          {row.decidedAt ? 'Recorded' : 'Decide'}
                        </Button>
                        {row.decidedBy && (
                          <span className="text-[11px] text-slate-400">
                            {row.decidedBy}
                            {row.decidedAt && ` · ${row.decidedAt}`}
                          </span>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {editing && (
        <DecisionDialog
          sessionId={sessionId}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function DecisionDialog({
  sessionId,
  row,
  onClose,
}: {
  sessionId: string;
  row: CalibrationRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const baseline = row.computedScore;
  const [score, setScore] = useState<string>(
    row.finalScore !== null
      ? String(row.finalScore)
      : row.proposedScore !== null
        ? String(row.proposedScore)
        : baseline !== null
          ? String(Math.round(baseline * 10) / 10)
          : '',
  );
  const [rationale, setRationale] = useState(row.rationale ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const parsed = score.trim() === '' ? null : Number(score);
  const invalid = parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > 100);
  const unchanged = parsed === baseline || (parsed !== null && baseline !== null && Math.abs(parsed - baseline) < 0.05);

  async function decide() {
    setBusy('decide');
    setError(null);
    setFieldErrors({});
    try {
      await api.post(`/api/admin/calibration/${sessionId}/decide`, {
        participantId: row.participantId,
        finalScore: parsed,
        rationale: rationale.trim(),
      });
      toast.success(unchanged ? 'Recorded: score left as calculated.' : 'Adjustment recorded.');
      onClose();
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length) {
        const map: Record<string, string> = {};
        for (const f of e.fieldErrors) map[f.path] = f.message;
        setFieldErrors(map);
      }
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function revert() {
    setBusy('revert');
    setError(null);
    try {
      await api.del(`/api/admin/calibration/${sessionId}/decide`, {
        participantId: row.participantId,
      });
      toast.success('Decision cleared. The calculated score applies again.');
      onClose();
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={row.name}
      description={`${row.jobTitle ?? 'No job title'}${row.department ? ` · ${row.department}` : ''}`}
      footer={
        <>
          {row.decidedAt && (
            <Button
              variant="ghost"
              className="mr-auto"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              loading={busy === 'revert'}
              onClick={revert}
            >
              Clear decision
            </Button>
          )}
          <Button onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy === 'decide'}
            loadingLabel="Recording…"
            disabled={invalid || rationale.trim().length < 10}
            onClick={decide}
          >
            Record decision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        <dl className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Calculated
            </dt>
            <dd className="mt-0.5 font-semibold text-slate-900">{formatScore(row.computedScore)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Baseline at session open
            </dt>
            <dd className="mt-0.5 font-semibold text-slate-900">{formatScore(row.originalScore)}</dd>
          </div>
        </dl>

        <Input
          type="number"
          label="Decided score"
          required={false}
          min={0}
          max={100}
          step={0.1}
          value={score}
          error={invalid ? 'A score must be between 0 and 100.' : fieldErrors.finalScore}
          onChange={(e) => setScore(e.target.value)}
          help="Leave it as the calculated figure to record that the group looked and agreed. Clear it entirely to record that no score should stand."
        />

        {unchanged && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            This records that the score was reviewed and left alone. Nothing is written to the
            employee&rsquo;s review as an adjustment — the calculated figure stands, and the session
            keeps the note that it was considered.
          </p>
        )}

        {!unchanged && parsed !== null && row.computedScore !== null && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            This changes the score from {formatScore(row.computedScore)} to {formatScore(parsed)}. The
            released review will show both figures and this reason, so the employee can see that a
            person made the change rather than finding a number that disagrees with its own
            arithmetic.
          </p>
        )}

        <Textarea
          label="Reason"
          required
          rows={3}
          value={rationale}
          error={fieldErrors.rationale}
          onChange={(e) => setRationale(e.target.value)}
          help="At least 10 characters. Kept with the decision and shown to whoever reads the score later, including the employee."
          hint={`${rationale.trim().length} characters`}
        />
      </div>
    </Dialog>
  );
}

export function FinalizeButton({
  sessionId,
  total,
  decided,
  adjusted,
  notes,
}: {
  sessionId: string;
  total: number;
  decided: number;
  adjusted: number;
  notes: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [sessionNotes, setSessionNotes] = useState(notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = decided === total;

  async function finalize() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/calibration/${sessionId}/finalize`, {
        notes: sessionNotes.trim() || null,
      });
      toast.success('Session finalised.');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        disabled={!ready}
        title={
          ready
            ? undefined
            : `${total - decided} of ${total} participants still have no recorded decision.`
        }
      >
        Finalise session
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          size="md"
          title="Finalise this session?"
          description="The decisions become the closed record of what was agreed. Editing stops, and there is no reopen — if something needs revisiting later, a new session is opened so this reasoning stays readable."
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} loadingLabel="Finalising…" onClick={finalize}>
                Finalise
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormError message={error} />
            <ul className="space-y-1 text-sm text-slate-700">
              <li>{total} participants reviewed</li>
              <li>{adjusted} scores adjusted, each with a recorded reason</li>
              <li>{total - adjusted} left as calculated</li>
            </ul>
            <p className="text-xs leading-relaxed text-slate-600">
              Finalising does not release anything. Releasing results to employees stays a separate,
              deliberate step on each review, so a manager can hold the conversation first.
            </p>
            <Textarea
              label="Closing notes"
              required={false}
              rows={3}
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              help="What the group settled on, and anything a later reader should know."
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
