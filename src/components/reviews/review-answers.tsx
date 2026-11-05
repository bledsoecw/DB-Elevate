import { EyeOff } from 'lucide-react';
import { Alert, Badge, ProseText } from '@/components/ui/primitives';
import type { RenderedSection } from '@/server/services/reviews';

/**
 * Read-only rendering of a submitted review.
 *
 * Shared by the manager/HR view and the employee's released results, so the
 * employee reads exactly the text their manager wrote, formatted identically —
 * there is no second rendering path that could show something different.
 */
export function ReviewAnswers({ sections }: { sections: RenderedSection[] }) {
  const withAnswers = sections
    .map((s) => ({
      ...s,
      questions: s.questions.filter(
        (q) =>
          q.answer.notApplicable ||
          (q.answer.textValue && q.answer.textValue.trim()) ||
          q.answer.numericValue !== null ||
          q.answer.choices.length > 0 ||
          (q.answer.commentValue && q.answer.commentValue.trim()),
      ),
    }))
    .filter((s) => s.questions.length > 0);

  if (withAnswers.length === 0) {
    return <p className="px-5 py-6 text-sm italic text-slate-500">No answers were recorded.</p>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {withAnswers.map((section) => (
        <section key={section.id} className="px-5 py-4 print-break-inside-avoid">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {section.title}
          </h4>
          <dl className="mt-3 space-y-4">
            {section.questions.map((q) => (
              <div key={q.key} className="print-break-inside-avoid">
                <dt className="text-sm font-medium text-slate-900">
                  {q.type === 'GOAL_REVIEW' && q.subjectLabel ? (
                    <>
                      <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
                        Goal
                      </span>
                      {q.subjectLabel}
                    </>
                  ) : (
                    (q.subjectLabel ?? q.prompt)
                  )}
                </dt>
                {q.type === 'GOAL_REVIEW' && q.subjectDetail && (
                  <p className="mt-0.5 text-xs text-slate-500">{q.subjectDetail}</p>
                )}
                {q.type === 'GOAL_REVIEW' && (
                  <p className="mt-1 text-sm text-slate-600">{q.prompt}</p>
                )}
                <dd className="mt-1.5 space-y-1.5">
                  {q.answer.notApplicable ? (
                    <p className="text-sm italic text-slate-500">
                      Marked not applicable — excluded from the score, not counted as a low rating.
                    </p>
                  ) : (
                    <>
                      {q.answer.numericValue !== null && q.scale && (
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className="font-semibold text-brand-800">
                            {q.answer.numericValue} of {Math.max(...q.scale.levels.map((l) => l.value))}
                          </span>
                          <span className="text-slate-800">
                            {q.scale.levels.find((l) => l.value === q.answer.numericValue)?.label}
                          </span>
                          {q.scale.levels.find((l) => l.value === q.answer.numericValue)?.description && (
                            <span className="block w-full text-xs leading-relaxed text-slate-500">
                              {q.scale.levels.find((l) => l.value === q.answer.numericValue)?.description}
                            </span>
                          )}
                        </p>
                      )}
                      {q.answer.numericValue !== null && !q.scale && (
                        <p className="text-sm font-semibold text-slate-900">{q.answer.numericValue}</p>
                      )}
                      {q.answer.textValue && q.type !== 'MULTIPLE_CHOICE' && (
                        <ProseText>{q.answer.textValue}</ProseText>
                      )}
                      {q.answer.textValue && q.type === 'MULTIPLE_CHOICE' && (
                        <p className="text-sm text-slate-800">{q.answer.textValue}</p>
                      )}
                      {q.answer.choices.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                          {q.answer.choices.map((c) => (
                            <li key={c}>
                              <Badge tone="neutral">{c}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                      {q.answer.commentValue && (
                        <ProseText className="border-l-2 border-slate-200 pl-3 text-slate-600">
                          {q.answer.commentValue}
                        </ProseText>
                      )}
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Shown in place of content the viewer is not allowed to read. */
export function WithheldContent({ reason }: { reason: string }) {
  return (
    <div className="px-5 py-5">
      <Alert tone="neutral" icon={<EyeOff className="h-4 w-4" />} title="Not shown to you">
        {reason}
      </Alert>
    </div>
  );
}
