import { csvResponse, handler } from '@/server/api';
import { listGoals } from '@/server/services/goals';
import { AUDIT_ACTIONS, recordAudit } from '@/server/audit';

/**
 * Goal export. Uses `listGoals`, which applies each goal's own visibility
 * rule, so a private goal cannot be exported by someone who could not open it.
 */
export const GET = handler(async ({ actor, request }) => {
  const url = new URL(request.url);
  const scope = (url.searchParams.get('scope') ?? 'ALL') as 'ALL' | 'MINE' | 'TEAM' | 'COMPANY';
  const goals = await listGoals(actor, { scope });

  const rows: (string | number | null)[][] = [
    ['DB Elevate — goal export'],
    ['Scope', scope],
    ['Rows', `${goals.length} goals you have permission to see`],
    ['Exported by', actor.displayName],
    ['Exported', new Date().toISOString()],
    [
      'Note',
      'Reported progress is entered by the goal owner. Calculated progress is derived from the goal\u2019s own measurements. Where both exist they are shown separately and neither overwrites the other.',
    ],
    [],
    [
      'Title',
      'Owner',
      'Type',
      'Category',
      'Status',
      'Health',
      'Start',
      'Due',
      'Measurement',
      'Start value',
      'Current value',
      'Target value',
      'Unit',
      'Reported %',
      'Calculated %',
      'Shown %',
      'Source of shown %',
      'Needs attention',
      'Supports',
    ],
  ];

  for (const g of goals) {
    rows.push([
      g.title,
      g.ownerName ?? '',
      g.scope,
      g.category ?? '',
      g.status,
      g.health,
      g.startDate ? g.startDate.toISOString().slice(0, 10) : '',
      g.dueDate ? g.dueDate.toISOString().slice(0, 10) : '',
      g.measurementType,
      g.startValue ?? '',
      g.currentValue ?? '',
      g.targetValue ?? '',
      g.unit ?? '',
      g.progress.reportedPct ?? '',
      g.progress.computedPct ?? '',
      g.progress.displayPct ?? '',
      g.progress.source,
      g.risk === 'NONE' || g.risk === 'DUE_SOON' ? '' : g.risk,
      g.parentGoalTitle ?? '',
    ]);
  }

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EXPORT_GENERATED,
    entityType: 'goal',
    entityId: 'bulk',
    summary: `Exported ${goals.length} goals (scope: ${scope}).`,
  });

  return csvResponse('goals.csv', rows);
});
