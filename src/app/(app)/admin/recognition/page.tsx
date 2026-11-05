import { redirect } from 'next/navigation';
import { Award } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listRecognitionValues } from '@/server/services/catalog';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/primitives';
import { countLabel } from '@/lib/utils';
import { NewRecognitionButton, RecognitionEditor } from './recognition-editor';

export const metadata = { title: 'Recognition values' };

export default async function RecognitionPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const values = await listRecognitionValues(actor);
  const active = values.filter((v) => v.active);
  const inactive = values.filter((v) => !v.active);
  const totalGiven = values.reduce((sum, v) => sum + v._count.feedbackItems, 0);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Recognition values' }]}
        title="Recognition values"
        description="What people can recognize each other for. Keep the list short — a list of fifteen values is a list nobody reads before clicking the first one."
        actions={<NewRecognitionButton />}
        meta={
          totalGiven > 0 ? `${countLabel(totalGiven, 'recognition')} given so far` : undefined
        }
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="How these are used">
        Recognition is a kind of feedback: visible to the person it is about, and by default to their
        manager. Choosing a value is optional — recognition without one still works. A value already
        used is deactivated rather than deleted, so past recognition keeps its meaning.
      </Alert>

      {active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Award className="h-5 w-5" />}
            title="No recognition values yet"
            description="Add the handful of things you actually want people calling out — safe work, finishing clean, looking after a client, helping an apprentice."
            action={<NewRecognitionButton />}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Offered when giving recognition"
            description="Shown in this order."
          />
          <ul className="divide-y divide-slate-100">
            {active.map((v) => (
              <li key={v.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex min-w-0 gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: `${v.colorHex}1a`, color: v.colorHex }}
                  >
                    <Award className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{v.name}</p>
                    {v.description && (
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{v.description}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {v._count.feedbackItems === 0
                        ? 'Not used yet'
                        : `Given ${countLabel(v._count.feedbackItems, 'time')}`}
                    </p>
                  </div>
                </div>
                <RecognitionEditor
                  value={{
                    id: v.id,
                    name: v.name,
                    description: v.description,
                    colorHex: v.colorHex,
                    active: v.active,
                    sortOrder: v.sortOrder,
                  }}
                  usageCount={v._count.feedbackItems}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {inactive.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Inactive"
            description="No longer offered. Recognition already given against them is unchanged."
          />
          <ul className="divide-y divide-slate-100">
            {inactive.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-700">{v.name}</p>
                  {v._count.feedbackItems > 0 && (
                    <p className="text-xs text-slate-500">
                      Given {countLabel(v._count.feedbackItems, 'time')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">Inactive</Badge>
                  <RecognitionEditor
                    value={{
                      id: v.id,
                      name: v.name,
                      description: v.description,
                      colorHex: v.colorHex,
                      active: v.active,
                      sortOrder: v.sortOrder,
                    }}
                    usageCount={v._count.feedbackItems}
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
