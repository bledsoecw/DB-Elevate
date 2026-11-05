import { csvResponse, handler } from '@/server/api';
import { getResults } from '@/server/services/surveys';
import { AUDIT_ACTIONS, recordAudit } from '@/server/audit';

/**
 * Survey export.
 *
 * It calls exactly the same `getResults` the screen does, so a figure the page
 * would have suppressed cannot appear in the file. Suppressed groups are
 * written out as "Hidden" with the reason, rather than omitted, so the reader
 * can see that something was withheld and why.
 */
export const GET = handler(async ({ actor, params, request }) => {
  const url = new URL(request.url);
  const results = await getResults(actor, params.id as string, {
    breakdownDimension:
      (url.searchParams.get('breakdown') as 'department' | 'tenure' | 'location' | null) ?? 'department',
  });

  const rows: (string | number | null)[][] = [
    ['DB Elevate — survey results export'],
    ['Survey', results.survey.title],
    ['Mode', results.survey.mode === 'ANONYMOUS' ? 'Anonymous' : 'Named'],
    ['Status', results.survey.status],
    ['Invited', results.participation.invited],
    ['Responses', results.participation.responded],
    [
      'Participation rate',
      results.participation.rate === null ? 'n/a' : `${results.participation.rate}%`,
    ],
    ['Minimum responses before results are shown', results.survey.minResponsesForResults],
    ['Exported', new Date().toISOString()],
    [],
  ];

  if (!results.reportable) {
    rows.push(['RESULTS WITHHELD', results.notice ?? '']);
    rows.push([
      'Note',
      'This file contains no results because the survey has not reached the minimum number of responses. That restriction applies to exports as well as to the screen.',
    ]);
    await recordAudit(actor, {
      action: AUDIT_ACTIONS.EXPORT_GENERATED,
      entityType: 'survey',
      entityId: params.id as string,
      summary: `Exported survey "${results.survey.title}" — results withheld, below the response threshold.`,
    });
    return csvResponse(`survey-${params.id}-withheld.csv`, rows);
  }

  rows.push(['QUESTION RESULTS']);
  rows.push(['Question', 'Type', 'Factor', 'Answers', 'Mean', 'Scale max']);
  for (const q of results.questions) {
    rows.push([q.prompt, q.type, q.factor ?? '', q.responseCount, q.mean ?? '', q.scaleMax ?? '']);
  }

  if (results.factors.length > 0) {
    rows.push([]);
    rows.push(['FACTOR SUMMARY']);
    rows.push(['Factor', 'Mean', 'Scale max', 'Questions', 'Answers']);
    for (const f of results.factors) {
      rows.push([f.factor, f.mean, f.scaleMax, f.questionCount, f.responseCount]);
    }
  }

  if (results.breakdown) {
    rows.push([]);
    rows.push([`BREAKDOWN BY ${String(results.breakdownDimension).toUpperCase()}`]);
    rows.push(['Group', 'Responses', 'Mean rating', 'Note']);
    for (const s of results.breakdown.segments) {
      rows.push([
        s.label,
        s.suppressed ? 'Hidden' : (s.n ?? ''),
        s.suppressed ? 'Hidden' : ((s.value as number | null) ?? ''),
        s.suppressed
          ? s.reason === 'BELOW_THRESHOLD'
            ? `Fewer than ${results.breakdown.threshold} responses`
            : 'Hidden so another hidden group cannot be derived by subtraction'
          : '',
      ]);
    }
    if (results.breakdown.notice) rows.push(['Note', results.breakdown.notice]);
  }

  const verbatimQuestions = results.questions.filter((q) => q.type === 'TEXT');
  if (verbatimQuestions.length > 0) {
    rows.push([]);
    rows.push(['WRITTEN ANSWERS']);
    for (const q of verbatimQuestions) {
      rows.push([q.prompt]);
      if (q.verbatimNotice) {
        rows.push(['', `WITHHELD: ${q.verbatimNotice}`]);
      } else {
        for (const text of q.verbatims ?? []) rows.push(['', text]);
      }
      rows.push([]);
    }
  }

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EXPORT_GENERATED,
    entityType: 'survey',
    entityId: params.id as string,
    summary: `Exported results for the survey "${results.survey.title}".`,
    metadata: { mode: results.survey.mode, responses: results.participation.responded },
  });

  const safeTitle = results.survey.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return csvResponse(`survey-${safeTitle}.csv`, rows);
});
