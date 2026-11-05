'use client';

import { useId } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RenderedQuestion } from '@/server/services/reviews';

export interface AnswerState {
  textValue: string | null;
  numericValue: number | null;
  choices: string[];
  commentValue: string | null;
  notApplicable: boolean;
}

/**
 * Renders one question of a review form.
 *
 * Rating scales show every level's written description rather than bare
 * numbers, because "3" means nothing without "meets the standard, and that is
 * the expected rating". That text comes from the scale configured in
 * Administration, not from the code.
 */
export function QuestionInput({
  question,
  value,
  onChange,
  disabled,
  error,
}: {
  question: RenderedQuestion;
  value: AnswerState;
  onChange: (next: AnswerState) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const baseId = useId();
  const set = (patch: Partial<AnswerState>) => onChange({ ...value, ...patch });

  const scored = question.type === 'RATING' || question.type === 'COMPETENCY_RATING';
  const na = value.notApplicable;

  return (
    <div
      id={`q-${question.key}`}
      className={cn(
        'scroll-mt-24 rounded-lg border p-4 transition sm:p-5',
        error ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-white',
      )}
    >
      <div className="flex flex-col gap-1">
        {question.subjectLabel && question.type === 'GOAL_REVIEW' && (
          <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Goal</p>
        )}
        <p className="text-sm font-medium text-slate-900">
          {question.subjectLabel && question.type !== 'COMPETENCY_RATING'
            ? question.subjectLabel
            : question.prompt}
          {question.required && (
            <span className="ml-1 text-rose-600" title="Required">
              *
            </span>
          )}
          {!question.required && (
            <span className="ml-2 text-xs font-normal text-slate-500">(optional)</span>
          )}
        </p>
        {question.subjectDetail && (
          <p className="text-xs text-slate-600">{question.subjectDetail}</p>
        )}
        {question.subjectLabel && question.type === 'GOAL_REVIEW' && (
          <p className="mt-1 text-sm text-slate-700">{question.prompt}</p>
        )}
        {question.helpText && (
          <p className="mt-0.5 flex items-start gap-1.5 text-xs leading-relaxed text-slate-600">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            <span>{question.helpText}</span>
          </p>
        )}
        {question.competency?.description && question.type === 'COMPETENCY_RATING' && (
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            {question.competency.description}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
          {error}
        </p>
      )}

      <div className="mt-3.5 space-y-3">
        {/* ------------------------------------------------ rating scales */}
        {scored && question.scale && (
          <fieldset disabled={disabled || na} className={cn(na && 'opacity-50')}>
            <legend className="sr-only">{question.prompt}</legend>
            <div className="grid gap-1.5 sm:grid-cols-1">
              {question.scale.levels.map((level) => {
                const id = `${baseId}-${level.value}`;
                const selected = value.numericValue === level.value;
                return (
                  <label
                    key={level.value}
                    htmlFor={id}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition',
                      selected
                        ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                      (disabled || na) && 'cursor-not-allowed',
                    )}
                  >
                    <input
                      type="radio"
                      id={id}
                      name={`${baseId}-scale`}
                      checked={selected}
                      onChange={() => set({ numericValue: level.value })}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 border-slate-300 text-brand-600 focus:ring-brand-600"
                    />
                    <span className="min-w-0">
                      <span className="font-medium text-slate-900">
                        {level.value} — {level.label}
                      </span>
                      {level.description && (
                        <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">
                          {level.description}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* Competency level descriptors, as reference while rating. */}
        {question.type === 'COMPETENCY_RATING' &&
          question.competency &&
          question.competency.behaviors.length > 0 && (
            <details className="rounded-md bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                What this looks like at each level
              </summary>
              <dl className="mt-2 space-y-1.5">
                {question.competency.behaviors.map((b) => (
                  <div key={b.level} className="text-xs">
                    <dt className="font-medium text-slate-800">{b.level}</dt>
                    <dd className="text-slate-600">{b.descriptor}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}

        {/* --------------------------------------------- multiple choice */}
        {question.type === 'MULTIPLE_CHOICE' && (
          <fieldset disabled={disabled}>
            <legend className="sr-only">{question.prompt}</legend>
            <div className="space-y-1.5">
              {question.choices.map((c) => {
                const id = `${baseId}-${c.value}`;
                const selected = value.textValue === c.value;
                return (
                  <label
                    key={c.value}
                    htmlFor={id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition',
                      selected
                        ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="radio"
                      id={id}
                      name={`${baseId}-choice`}
                      checked={selected}
                      onChange={() => set({ textValue: c.value })}
                      className="h-4 w-4 flex-shrink-0 border-slate-300 text-brand-600 focus:ring-brand-600"
                    />
                    <span className="text-slate-900">{c.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* ------------------------------------------------ multi select */}
        {question.type === 'MULTI_SELECT' && (
          <fieldset disabled={disabled}>
            <legend className="sr-only">{question.prompt}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {question.choices.map((c) => {
                const id = `${baseId}-${c.value}`;
                const selected = value.choices.includes(c.value);
                return (
                  <label
                    key={c.value}
                    htmlFor={id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition',
                      selected
                        ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-500'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      id={id}
                      checked={selected}
                      onChange={() =>
                        set({
                          choices: selected
                            ? value.choices.filter((v) => v !== c.value)
                            : [...value.choices, c.value],
                        })
                      }
                      className="h-4 w-4 flex-shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                    />
                    <span className="text-slate-900">{c.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {/* ------------------------------------------------------- text */}
        {question.type === 'TEXT' && (
          <div>
            <label htmlFor={`${baseId}-text`} className="sr-only">
              {question.prompt}
            </label>
            <textarea
              id={`${baseId}-text`}
              rows={5}
              disabled={disabled}
              maxLength={question.maxLength ?? undefined}
              value={value.textValue ?? ''}
              onChange={(e) => set({ textValue: e.target.value })}
              className="block w-full rounded-md border-0 px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50"
              placeholder="Be specific — name jobs, dates and outcomes rather than describing character."
            />
            {question.maxLength && (
              <p className="mt-1 text-right text-xs tabular-nums text-slate-400">
                {(value.textValue ?? '').length} / {question.maxLength}
              </p>
            )}
          </div>
        )}

        {/* ------------------------------------- comment beside a rating */}
        {question.commentEnabled && scored && (
          <div>
            <label
              htmlFor={`${baseId}-comment`}
              className="mb-1 block text-xs font-medium text-slate-700"
            >
              Comment
              {question.commentRequired ? (
                <span className="ml-1 text-rose-600" title="Required">
                  *
                </span>
              ) : (
                <span className="ml-1.5 font-normal text-slate-500">
                  (optional, but an example makes the rating far more useful)
                </span>
              )}
            </label>
            <textarea
              id={`${baseId}-comment`}
              rows={3}
              disabled={disabled || na}
              maxLength={4000}
              value={value.commentValue ?? ''}
              onChange={(e) => set({ commentValue: e.target.value })}
              className="block w-full rounded-md border-0 px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50"
            />
          </div>
        )}

        {/* --------------------------------------------- not applicable */}
        {question.allowNotApplicable && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={na}
              disabled={disabled}
              onChange={(e) =>
                set(
                  e.target.checked
                    ? { notApplicable: true, numericValue: null }
                    : { notApplicable: false },
                )
              }
              className="h-3.5 w-3.5 rounded border-slate-300 text-slate-500 focus:ring-slate-400"
            />
            <span>
              Not applicable — I have not seen enough of this to rate it
              <span className="block text-slate-500">
                Left out of the score entirely. It is not counted as a low rating.
              </span>
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
