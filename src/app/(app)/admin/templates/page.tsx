import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Lock, Plus } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listTemplates } from '@/server/services/templates';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/primitives';
import { formatDate, countLabel } from '@/lib/utils';
import { TEMPLATE_CATEGORY_LABELS, type TemplateCategory } from '@/lib/enums';

export const metadata = { title: 'Review templates' };

export default async function TemplatesPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const templates = await listTemplates(actor);
  const active = templates.filter((t) => t.status !== 'archived');
  const archived = templates.filter((t) => t.status === 'archived');

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Templates' }]}
        title="Review templates"
        description="The forms reviews are written on. Each template keeps a version history, and publishing a version freezes it."
        actions={
          <ButtonLink href="/admin/templates/new" variant="primary">
            <Plus aria-hidden className="h-4 w-4" />
            New template
          </ButtonLink>
        }
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="How versioning protects history">
        A version is editable only while it is unpublished. Publishing freezes it, and editing a
        published version creates a new one by copy. A review cycle points at a version, never at
        the template, so a review completed last year still shows exactly the questions it was
        answered against — no matter how much the template has changed since.
      </Alert>

      {active.length === 0 ? (
        <Card>
          <EmptyState
            illustration="forms"
            icon={<FileText className="h-5 w-5" />}
            title="No templates yet"
            description="Build one from scratch, or start from a seeded starter template and edit it. Nothing is used until you publish it and attach it to a cycle."
            action={
              <ButtonLink href="/admin/templates/new" variant="primary">
                Create a template
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {active.map((t) => {
            const published = t.versions.filter((v) => v.publishedAt !== null);
            const latest = t.versions[0];
            const inUse = t.versions.reduce((sum, v) => sum + v._count.cycles, 0);
            return (
              <Card key={t.id}>
                <CardHeader
                  title={
                    <Link href={`/admin/templates/${t.id}`} className="hover:underline">
                      {t.name}
                    </Link>
                  }
                  description={t.description ?? undefined}
                  actions={
                    <>
                      <Badge tone="neutral">
                        {TEMPLATE_CATEGORY_LABELS[t.category as TemplateCategory] ?? t.category}
                      </Badge>
                      {t.isStarter && <Badge tone="info">Starter</Badge>}
                      <Badge tone={t.status === 'published' ? 'success' : 'neutral'}>
                        {t.status === 'published' ? 'Published' : 'Draft'}
                      </Badge>
                      <ButtonLink href={`/admin/templates/${t.id}`} size="sm">
                        Open
                      </ButtonLink>
                    </>
                  }
                />
                <CardBody>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
                    <span>{countLabel(t.versions.length, 'version')}</span>
                    <span>{countLabel(published.length, 'published version')}</span>
                    <span>
                      {inUse === 0
                        ? 'Not used by a cycle yet'
                        : `Used by ${countLabel(inUse, 'cycle')}`}
                    </span>
                    {latest && (
                      <span>
                        Latest: v{latest.versionNumber}
                        {latest.publishedAt
                          ? ` · published ${formatDate(latest.publishedAt)}`
                          : ' · draft'}
                      </span>
                    )}
                  </div>

                  <ul className="mt-3 flex flex-wrap gap-2">
                    {t.versions.slice(0, 6).map((v) => (
                      <li key={v.id}>
                        <Link
                          href={`/admin/templates/${t.id}?version=${v.id}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700 transition hover:border-brand-300 hover:bg-brand-50"
                        >
                          <span className="font-medium">v{v.versionNumber}</span>
                          {v.publishedAt ? (
                            <Lock aria-hidden className="h-3 w-3 text-slate-400" />
                          ) : (
                            <span className="text-amber-600">draft</span>
                          )}
                          {v._count.cycles > 0 && (
                            <span className="text-slate-400">· {v._count.cycles} cycles</span>
                          )}
                        </Link>
                      </li>
                    ))}
                    {t.versions.length > 6 && (
                      <li className="self-center text-xs text-slate-500">
                        +{t.versions.length - 6} more
                      </li>
                    )}
                  </ul>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Archived"
            description="No longer offered for new cycles. Completed reviews that used them are unaffected."
          />
          <ul className="divide-y divide-slate-100">
            {archived.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <Link href={`/admin/templates/${t.id}`} className="text-sm text-slate-700 hover:underline">
                  {t.name}
                </Link>
                <Badge tone="neutral">Archived</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
