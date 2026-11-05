import { redirect } from 'next/navigation';
import { Gauge, Lock } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listRatingScales, scaleIsFrozen } from '@/server/services/catalog';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/primitives';
import { countLabel } from '@/lib/utils';
import { NewScaleButton, ScaleEditor } from './scale-editor';

export const metadata = { title: 'Rating scales' };

export default async function ScalesPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const scales = await listRatingScales(actor);

  // Whether each scale is frozen is a fact about published history, so it is
  // resolved on the server and never inferred in the browser.
  const frozen = new Map(
    await Promise.all(
      scales.map(async (s) => [s.id, await scaleIsFrozen(actor.orgId, s.id)] as const),
    ),
  );

  const active = scales.filter((s) => !s.archived);
  const archived = scales.filter((s) => s.archived);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Rating scales' }]}
        title="Rating scales"
        description="The scales reviews and surveys are answered on. Every level carries a written description, because a 3 with no words next to it means whatever the rater assumed it meant."
        actions={<NewScaleButton />}
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="Why a used scale cannot be edited">
        Once a scale is attached to a published template version or a launched survey, its levels are
        frozen. The wording beside a number is part of what the person answered — changing &ldquo;Meets
        expectations&rdquo; to &ldquo;Needs improvement&rdquo; after the fact would silently rewrite
        every review that used it. Such a scale can still be renamed or archived; to change the levels,
        create a new scale.
      </Alert>

      {active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Gauge className="h-5 w-5" />}
            title="No rating scales yet"
            description="Create at least one before building a template with rating questions."
            action={<NewScaleButton />}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {active.map((scale) => (
            <ScaleCard key={scale.id} scale={scale} frozen={frozen.get(scale.id) ?? false} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Archived"
            description="No longer offered for new templates. Reviews and surveys that used them are unaffected."
          />
          <ul className="divide-y divide-slate-100">
            {archived.map((scale) => (
              <li key={scale.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-700">{scale.name}</p>
                  <p className="text-xs text-slate-500">
                    {countLabel(scale.levels.length, 'level')} ·{' '}
                    {countLabel(scale._count.questions, 'review question')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">Archived</Badge>
                  <ScaleEditor
                    scale={toDraft(scale)}
                    frozen={frozen.get(scale.id) ?? false}
                    usage={usageOf(scale)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

type ScaleRow = Awaited<ReturnType<typeof listRatingScales>>[number];

function usageOf(scale: ScaleRow): { questions: number; surveyQuestions: number } {
  return { questions: scale._count.questions, surveyQuestions: scale._count.surveyQuestions };
}

function toDraft(scale: ScaleRow) {
  return {
    id: scale.id,
    name: scale.name,
    description: scale.description,
    numeric: scale.numeric,
    archived: scale.archived,
    levels: scale.levels.map((l) => ({
      value: l.value,
      label: l.label,
      description: l.description,
    })),
  };
}

function ScaleCard({ scale, frozen }: { scale: ScaleRow; frozen: boolean }) {
  const usage = usageOf(scale);
  const span =
    scale.levels.length > 0
      ? `${scale.levels[0]!.value}–${scale.levels[scale.levels.length - 1]!.value}`
      : '—';

  return (
    <Card>
      <CardHeader
        title={scale.name}
        description={scale.description ?? undefined}
        actions={
          <>
            <Badge tone={scale.numeric ? 'success' : 'neutral'}>
              {scale.numeric ? 'Counts toward scores' : 'Not scored'}
            </Badge>
            {frozen && (
              <Badge tone="info" title="Used by a published template or launched survey">
                Frozen
              </Badge>
            )}
            <ScaleEditor scale={toDraft(scale)} frozen={frozen} usage={usage} />
          </>
        }
      />
      <CardBody>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-600">
          <span>
            {countLabel(scale.levels.length, 'level')} · {span}
          </span>
          <span>{countLabel(usage.questions, 'review question')}</span>
          <span>{countLabel(usage.surveyQuestions, 'survey question')}</span>
          {frozen && (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <Lock aria-hidden className="h-3 w-3" /> Levels locked
            </span>
          )}
        </div>

        <ol className="mt-3 space-y-1.5">
          {scale.levels.map((level) => (
            <li key={level.id} className="flex gap-3 text-sm">
              <span className="mt-px flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-semibold text-slate-700">
                {level.value}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-slate-900">{level.label}</span>
                {level.description && (
                  <span className="block text-xs leading-relaxed text-slate-600">
                    {level.description}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>

        {!scale.numeric && (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            This scale is directional only. Answers on it are shown on the review and in distributions
            but are left out of any average, so they cannot quietly contribute a number nobody intended.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
