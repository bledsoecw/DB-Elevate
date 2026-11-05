'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Check, CloudOff, Loader2, Save, Send } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import { Alert, Badge, Card, CardBody, CardHeader, ProseText } from '@/components/ui/primitives';
import { QuestionInput, type AnswerState } from '@/components/reviews/question-input';
import type { RenderedForm, RenderedSection } from '@/server/services/reviews';
import { cn, formatRelativeTime } from '@/lib/utils';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'failed'; message: string };

const AUTOSAVE_DELAY_MS = 2500;

/**
 * The review form.
 *
 * Two behaviours matter more than anything else here:
 *
 *  - The save indicator tells the truth. It says "saving", "saved at HH:MM" or
 *    "not saved" with the reason, and it never shows "saved" for a request that
 *    failed. A failed autosave leaves the edits in the form and warns on exit.
 *  - Submitting saves first. If validation then rejects the submission, the
 *    reviewer's work is already stored and the page lists exactly which answers
 *    are missing, each one a link to the question.
 */
export function ReviewForm({
  assignmentId,
  form,
  initialStatus,
  initialSavedAt,
  editable,
  selfReview,
  subjectName,
  isSelf,
}: {
  assignmentId: string;
  form: RenderedForm;
  initialStatus: string;
  initialSavedAt: string | null;
  editable: boolean;
  selfReview: { sections: RenderedSection[]; submittedAt: string | null } | null;
  subjectName: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const allQuestions = useMemo(
    () => form.sections.flatMap((s) => s.questions),
    [form.sections],
  );

  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => {
    const initial: Record<string, AnswerState> = {};
    for (const q of allQuestions) {
      initial[q.key] = {
        textValue: q.answer.textValue,
        numericValue: q.answer.numericValue,
        choices: q.answer.choices,
        commentValue: q.answer.commentValue,
        notApplicable: q.answer.notApplicable,
      };
    }
    return initial;
  });

  const [saveState, setSaveState] = useState<SaveState>(
    initialSavedAt ? { kind: 'saved', at: new Date(initialSavedAt) } : { kind: 'idle' },
  );
  const [problems, setProblems] = useState<{ questionId: string; subjectKey: string; prompt: string; message: string }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const unsaved = saveState.kind === 'dirty' || saveState.kind === 'failed';
  useUnsavedChangesWarning(unsaved && editable);

  const payload = useCallback(() => {
    return allQuestions.map((q) => {
      const a = answersRef.current[q.key] as AnswerState;
      return {
        questionId: q.id,
        subjectKey: q.subjectKey,
        textValue: a.textValue,
        numericValue: a.numericValue,
        choices: a.choices,
        commentValue: a.commentValue,
        notApplicable: a.notApplicable,
      };
    });
  }, [allQuestions]);

  const save = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!editable) return false;
      setSaveState({ kind: 'saving' });
      try {
        const result = await api.post<{ savedAt: string }>(
          `/api/reviews/assignments/${assignmentId}/save`,
          { answers: payload() },
        );
        dirtyRef.current = false;
        setSaveState({ kind: 'saved', at: new Date(result.savedAt) });
        return true;
      } catch (e) {
        const message = errorMessage(e);
        setSaveState({ kind: 'failed', message });
        if (!opts.silent) toast.error('Your answers were not saved', message);
        return false;
      }
    },
    [assignmentId, editable, payload, toast],
  );

  // Debounced autosave. Only fires when something actually changed.
  useEffect(() => {
    if (!editable || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save({ silent: true }), AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [answers, editable, save]);

  function update(key: string, next: AnswerState) {
    dirtyRef.current = true;
    setSaveState({ kind: 'dirty' });
    setAnswers((prev) => ({ ...prev, [key]: next }));
    setProblems((prev) => prev.filter((p) => `${p.questionId}::${p.subjectKey}` !== key));
  }

  async function submit() {
    setSubmitting(true);
    setProblems([]);
    setFatalError(null);
    try {
      await api.post(`/api/reviews/assignments/${assignmentId}/submit`, { answers: payload() });
      dirtyRef.current = false;
      setSaveState({ kind: 'saved', at: new Date() });
      setConfirming(false);
      toast.success(
        isSelf ? 'Your self-assessment has been submitted' : `Your review of ${subjectName} has been submitted`,
        'It can no longer be edited. An HR administrator can reopen it if something needs changing.',
      );
      router.refresh();
    } catch (e) {
      setConfirming(false);
      if (e instanceof ApiError && e.code === 'validation_failed' && Array.isArray(e.details)) {
        const detail = e.details as unknown as {
          questionId?: string;
          subjectKey?: string;
          prompt?: string;
          message?: string;
        }[];
        const mapped = detail
          .filter((d) => d.questionId)
          .map((d) => ({
            questionId: String(d.questionId),
            subjectKey: String(d.subjectKey ?? ''),
            prompt: String(d.prompt ?? 'This question'),
            message: String(d.message ?? 'This answer is required.'),
          }));
        if (mapped.length > 0) {
          setProblems(mapped);
          setSaveState({ kind: 'saved', at: new Date() });
          toast.error(
            `${mapped.length} ${mapped.length === 1 ? 'answer is' : 'answers are'} still needed`,
            'Your work has been saved. The missing answers are listed at the top of the form.',
          );
          document.getElementById('submit-problems')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setSubmitting(false);
          return;
        }
      }
      setFatalError(errorMessage(e));
      toast.error('Could not submit', errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const answeredCount = allQuestions.filter((q) => {
    const a = answers[q.key] as AnswerState;
    if (a.notApplicable) return true;
    return (
      (a.textValue && a.textValue.trim().length > 0) ||
      a.numericValue !== null ||
      a.choices.length > 0
    );
  }).length;
  const requiredRemaining = allQuestions.filter((q) => {
    if (!q.required) return false;
    const a = answers[q.key] as AnswerState;
    if (a.notApplicable) return false;
    if (q.type === 'TEXT' || q.type === 'MULTIPLE_CHOICE') return !a.textValue?.trim();
    if (q.type === 'MULTI_SELECT') return a.choices.length === 0;
    return a.numericValue === null;
  }).length;

  const problemKeys = new Set(problems.map((p) => `${p.questionId}::${p.subjectKey}`));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        {!editable && (
          <Alert tone="neutral" className="mb-5" title="This review is read-only">
            {initialStatus === 'SUBMITTED'
              ? 'It has been submitted. Ask an HR administrator to reopen it if something needs changing.'
              : 'It is not currently open for editing.'}
          </Alert>
        )}

        {fatalError && (
          <Alert tone="danger" className="mb-5" title="Could not submit" icon={<AlertCircle className="h-4 w-4" />}>
            {fatalError}
          </Alert>
        )}

        {problems.length > 0 && (
          <div id="submit-problems" className="mb-5">
            <Alert
              tone="danger"
              title={`${problems.length} ${problems.length === 1 ? 'answer is' : 'answers are'} still needed`}
              icon={<AlertCircle className="h-4 w-4" />}
            >
              <p>Everything you have typed has been saved. These are still outstanding:</p>
              <ul className="mt-2 space-y-1">
                {problems.map((p) => (
                  <li key={`${p.questionId}::${p.subjectKey}`}>
                    <a
                      href={`#q-${p.questionId}::${p.subjectKey}`}
                      className="font-medium underline underline-offset-2"
                    >
                      {p.prompt}
                    </a>{' '}
                    — {p.message}
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        {selfReview && (
          <Card className="mb-6">
            <CardHeader
              title={`${subjectName}'s self-assessment`}
              description={
                selfReview.submittedAt
                  ? `Submitted ${formatRelativeTime(selfReview.submittedAt)}. Read it before writing yours.`
                  : undefined
              }
              actions={<Badge tone="info">Submitted</Badge>}
            />
            <CardBody className="space-y-4">
              {selfReview.sections.map((s) => (
                <div key={s.id}>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {s.title}
                  </h4>
                  <dl className="mt-2 space-y-3">
                    {s.questions
                      .filter(
                        (q) =>
                          q.answer.textValue ||
                          q.answer.numericValue !== null ||
                          q.answer.choices.length > 0 ||
                          q.answer.commentValue,
                      )
                      .map((q) => (
                        <div key={q.key}>
                          <dt className="text-sm font-medium text-slate-800">
                            {q.subjectLabel ?? q.prompt}
                          </dt>
                          <dd className="mt-0.5 text-sm text-slate-700">
                            {q.answer.numericValue !== null && q.scale && (
                              <p className="font-medium text-brand-800">
                                {q.answer.numericValue} —{' '}
                                {q.scale.levels.find((l) => l.value === q.answer.numericValue)?.label}
                              </p>
                            )}
                            {q.answer.notApplicable && (
                              <p className="italic text-slate-500">Marked not applicable</p>
                            )}
                            {q.answer.textValue && <ProseText>{q.answer.textValue}</ProseText>}
                            {q.answer.choices.length > 0 && (
                              <p>{q.answer.choices.join(', ')}</p>
                            )}
                            {q.answer.commentValue && (
                              <ProseText className="mt-1 border-l-2 border-slate-200 pl-3 text-slate-600">
                                {q.answer.commentValue}
                              </ProseText>
                            )}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        <div className="space-y-6">
          {form.sections.map((section) => (
            <section key={section.id} aria-labelledby={`section-${section.id}`}>
              <div className="mb-3">
                <h2 id={`section-${section.id}`} className="text-base font-semibold text-slate-900">
                  {section.title}
                </h2>
                {section.instructions && (
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
                    {section.instructions}
                  </p>
                )}
                {section.weight === 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Not scored — the written answers here are the point.
                  </p>
                )}
              </div>
              <div className="space-y-3">
                {section.questions.map((q) => (
                  <QuestionInput
                    key={q.key}
                    question={q}
                    value={answers[q.key] as AnswerState}
                    onChange={(next) => update(q.key, next)}
                    disabled={!editable}
                    error={
                      problemKeys.has(q.key)
                        ? (problems.find((p) => `${p.questionId}::${p.subjectKey}` === q.key)?.message ??
                          null)
                        : null
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------- side panel */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardBody className="space-y-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Progress</p>
              <p className="mt-1 text-sm text-slate-800">
                <span className="text-xl font-semibold tabular-nums">{answeredCount}</span>
                <span className="text-slate-500"> of {allQuestions.length} answered</span>
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{
                    width: `${allQuestions.length ? (answeredCount / allQuestions.length) * 100 : 0}%`,
                  }}
                />
              </div>
              {requiredRemaining > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  {requiredRemaining} required {requiredRemaining === 1 ? 'answer' : 'answers'} still
                  needed.
                </p>
              )}
            </div>

            <div className="border-t border-slate-200 pt-3">
              <SaveIndicator state={saveState} editable={editable} />
            </div>

            {editable && (
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <Button
                  variant="secondary"
                  fullWidth
                  icon={<Save className="h-4 w-4" />}
                  loading={saveState.kind === 'saving'}
                  onClick={() => void save()}
                >
                  Save draft
                </Button>
                <Button
                  variant="primary"
                  fullWidth
                  icon={<Send className="h-4 w-4" />}
                  onClick={() => setConfirming(true)}
                >
                  Submit
                </Button>
                <p className="text-xs leading-relaxed text-slate-500">
                  Nobody else can read this until you submit it — not your manager, not HR.
                </p>
              </div>
            )}

            {!editable && (
              <Link
                href="/tasks"
                className="block text-sm font-medium text-brand-700 hover:underline"
              >
                Back to my tasks
              </Link>
            )}
          </CardBody>
        </Card>
      </aside>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={isSelf ? 'Submit your self-assessment?' : `Submit your review of ${subjectName}?`}
        description="Once submitted it cannot be edited. An HR administrator can reopen it if something genuinely needs changing, and that is recorded."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={submitting}>
              Keep editing
            </Button>
            <Button variant="primary" onClick={() => void submit()} loading={submitting}>
              Submit
            </Button>
          </>
        }
      >
        <ul className="space-y-1.5 text-sm text-slate-700">
          <li className="flex gap-2">
            <Check aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
            <span>
              {answeredCount} of {allQuestions.length} questions answered
            </span>
          </li>
          {requiredRemaining > 0 ? (
            <li className="flex gap-2 text-amber-800">
              <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                {requiredRemaining} required {requiredRemaining === 1 ? 'answer is' : 'answers are'}{' '}
                still missing. Submitting will be refused and they will be listed for you.
              </span>
            </li>
          ) : (
            <li className="flex gap-2">
              <Check aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              <span>All required answers are complete</span>
            </li>
          )}
          {!isSelf && (
            <li className="flex gap-2">
              <Check aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
              <span>
                {subjectName} will not see this until an HR administrator releases the results
              </span>
            </li>
          )}
        </ul>
      </Dialog>
    </div>
  );
}

function SaveIndicator({ state, editable }: { state: SaveState; editable: boolean }) {
  if (!editable) {
    return <p className="text-xs text-slate-500">Read-only — no changes are being saved.</p>;
  }
  const common = 'flex items-start gap-1.5 text-xs';
  switch (state.kind) {
    case 'saving':
      return (
        <p className={cn(common, 'text-slate-600')}>
          <Loader2 aria-hidden className="mt-0.5 h-3.5 w-3.5 animate-spin" />
          Saving…
        </p>
      );
    case 'saved':
      return (
        <p className={cn(common, 'text-emerald-700')}>
          <Check aria-hidden className="mt-0.5 h-3.5 w-3.5" />
          <span>
            Draft saved{' '}
            {state.at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        </p>
      );
    case 'dirty':
      return (
        <p className={cn(common, 'text-amber-700')}>
          <span aria-hidden className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
          Unsaved changes — saving shortly
        </p>
      );
    case 'failed':
      return (
        <p className={cn(common, 'text-rose-700')} role="alert">
          <CloudOff aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <strong className="font-semibold">Not saved.</strong> {state.message} Your answers are
            still on screen — use Save draft to try again.
          </span>
        </p>
      );
    default:
      return <p className="text-xs text-slate-500">No changes yet.</p>;
  }
}
