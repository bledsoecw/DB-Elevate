'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { FormError } from '@/components/ui/form';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface Question {
  id: string;
  type: string;
  prompt: string;
  helpText: string | null;
  required: boolean;
  factor: string | null;
  choices: string[];
  scale: { name: string; levels: { value: number; label: string }[] } | null;
}

interface Answer {
  numericValue: number | null;
  textValue: string | null;
  choices: string[];
}

/**
 * The survey form.
 *
 * Deliberately not autosaved: a partial anonymous response would have to be
 * stored somewhere keyed to the respondent, which is exactly what the mode
 * promises not to do. The form warns before leaving instead.
 */
export function SurveyResponseForm({
  surveyId,
  anonymous,
  questions,
}: {
  surveyId: string;
  anonymous: boolean;
  questions: Question[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, { numericValue: null, textValue: null, choices: [] }])),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useUnsavedChangesWarning(dirty && !loading);

  function set(id: string, patch: Partial<Answer>) {
    setDirty(true);
    setMissing((m) => m.filter((x) => x !== id));
    setAnswers((a) => ({ ...a, [id]: { ...(a[id] as Answer), ...patch } }));
  }

  const answeredCount = questions.filter((q) => {
    const a = answers[q.id] as Answer;
    return a.numericValue !== null || (a.textValue && a.textValue.trim()) || a.choices.length > 0;
  }).length;

  async function submit() {
    setLoading(true);
    setError(null);
    setMissing([]);
    try {
      await api.post(`/api/surveys/${surveyId}/respond`, {
        answers: questions.map((q) => ({
          questionId: q.id,
          numericValue: (answers[q.id] as Answer).numericValue,
          textValue: (answers[q.id] as Answer).textValue,
          choices: (answers[q.id] as Answer).choices,
        })),
      });
      setDirty(false);
      toast.success('Response submitted', anonymous ? 'Stored with no link to you.' : undefined);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.fieldErrors) && e.fieldErrors.length > 0) {
        setMissing(e.fieldErrors.map((f) => f.path));
      }
      setError(errorMessage(e));
      document.getElementById('survey-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div id="survey-error">
        <FormError message={error} />
      </div>

      {questions.map((q, index) => {
        const a = answers[q.id] as Answer;
        const isMissing = missing.includes(q.id);
        return (
          <Card key={q.id} className={cn(isMissing && 'ring-1 ring-rose-300')}>
            <CardHeader
              title={
                <span className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 text-xs font-normal tabular-nums text-slate-400">
                    {index + 1}.
                  </span>
                  <span>
                    {q.prompt}
                    {q.required && (
                      <span className="ml-1 text-rose-600" title="Required">
                        *
                      </span>
                    )}
                  </span>
                </span>
              }
              description={q.helpText ?? undefined}
            />
            <CardBody>
              {isMissing && (
                <p role="alert" className="mb-2 text-xs font-medium text-rose-700">
                  This answer is required.
                </p>
              )}

              {q.type === 'RATING' && q.scale && (
                <fieldset>
                  <legend className="sr-only">{q.prompt}</legend>
                  <div className="space-y-1.5">
                    {q.scale.levels.map((l) => (
                      <label
                        key={l.value}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition',
                          a.numericValue === l.value
                            ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          checked={a.numericValue === l.value}
                          onChange={() => set(q.id, { numericValue: l.value })}
                          className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-600"
                        />
                        <span className="text-slate-900">{l.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {q.type === 'NPS' && (
                <fieldset>
                  <legend className="sr-only">{q.prompt}</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 11 }, (_, n) => (
                      <label
                        key={n}
                        className={cn(
                          'flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border text-sm font-medium transition',
                          a.numericValue === n
                            ? 'border-brand-600 bg-brand-600 text-white'
                            : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          checked={a.numericValue === n}
                          onChange={() => set(q.id, { numericValue: n })}
                          className="sr-only"
                        />
                        {n}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 flex justify-between text-xs text-slate-500">
                    <span>0 — not at all likely</span>
                    <span>10 — extremely likely</span>
                  </p>
                </fieldset>
              )}

              {q.type === 'MULTIPLE_CHOICE' && (
                <fieldset>
                  <legend className="sr-only">{q.prompt}</legend>
                  <div className="space-y-1.5">
                    {q.choices.map((c) => (
                      <label
                        key={c}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition',
                          a.textValue === c
                            ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          checked={a.textValue === c}
                          onChange={() => set(q.id, { textValue: c })}
                          className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-600"
                        />
                        <span className="text-slate-900">{c}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {q.type === 'MULTI_SELECT' && (
                <fieldset>
                  <legend className="sr-only">{q.prompt}</legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {q.choices.map((c) => (
                      <label
                        key={c}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition',
                          a.choices.includes(c)
                            ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={a.choices.includes(c)}
                          onChange={() =>
                            set(q.id, {
                              choices: a.choices.includes(c)
                                ? a.choices.filter((x) => x !== c)
                                : [...a.choices, c],
                            })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                        />
                        <span className="text-slate-900">{c}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {q.type === 'TEXT' && (
                <>
                  <label htmlFor={`text-${q.id}`} className="sr-only">
                    {q.prompt}
                  </label>
                  <textarea
                    id={`text-${q.id}`}
                    rows={4}
                    maxLength={10000}
                    value={a.textValue ?? ''}
                    onChange={(e) => set(q.id, { textValue: e.target.value })}
                    className="block w-full rounded-md border-0 px-3 py-2 text-sm leading-relaxed shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                  />
                  {anonymous && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Written answers are the easiest thing to recognise someone by. These are only
                      ever shown unfiltered and shuffled, and only once enough people have responded.
                    </p>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            <span className="font-semibold tabular-nums text-slate-900">{answeredCount}</span> of{' '}
            {questions.length} answered
          </p>
          <Button
            type="submit"
            variant="primary"
            icon={<Send className="h-4 w-4" />}
            loading={loading}
            loadingLabel="Submitting…"
          >
            Submit my response
          </Button>
        </CardBody>
      </Card>

      <p className="pb-6 text-center text-xs text-slate-500">
        {anonymous
          ? 'Nothing is saved until you press submit, because a partial anonymous answer would have to be stored against your name.'
          : 'Nothing is saved until you press submit.'}
      </p>
    </form>
  );
}
