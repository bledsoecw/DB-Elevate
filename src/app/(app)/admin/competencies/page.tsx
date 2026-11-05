import { redirect } from 'next/navigation';
import { Layers, Library } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import {
  listCompetencies,
  listJobTitles,
  listLibraries,
} from '@/server/services/catalog';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  LinkTabs,
  PageHeader,
} from '@/components/ui/primitives';
import { COMPETENCY_LEVELS } from '@/lib/enums';
import { countLabel } from '@/lib/utils';
import { CompetencyEditor, NewCompetencyButton } from './competency-editor';
import { LibraryEditor, NewLibraryButton } from './library-editor';

export const metadata = { title: 'Competencies' };

const TABS = [
  { key: 'competencies', label: 'Competencies', href: '/admin/competencies' },
  { key: 'libraries', label: 'Libraries by role', href: '/admin/competencies?tab=libraries' },
];

export default async function CompetenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const { tab } = await searchParams;
  const current = tab === 'libraries' ? 'libraries' : 'competencies';

  const [competencies, libraries, jobTitles] = await Promise.all([
    listCompetencies(actor),
    listLibraries(actor),
    listJobTitles(actor),
  ]);

  const options = competencies.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    active: c.active,
  }));
  const titleOptions = jobTitles.map((t) => ({
    id: t.id,
    name: t.name,
    level: t.level,
    libraryId: t.competencyLibrary?.id ?? null,
    headcount: t._count.employees,
  }));

  const active = competencies.filter((c) => c.active);
  const retired = competencies.filter((c) => !c.active);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Competencies' }]}
        title="Competencies and libraries"
        description="The skills reviews assess. A competency can carry a written descriptor for each career level, so a rating means the same thing to the apprentice and to the project manager rating them."
        actions={
          current === 'libraries' ? (
            <NewLibraryButton competencies={options} jobTitles={titleOptions} />
          ) : (
            <NewCompetencyButton />
          )
        }
      />

      <LinkTabs tabs={TABS} current={current} className="mb-5" />

      {current === 'competencies' ? (
        <>
          <Alert tone="neutral" className="mb-5 max-w-4xl" title="Editing is safe, deleting is not">
            Renaming a competency or rewriting a descriptor takes effect everywhere it is shown next.
            A competency a review question already points at is retired rather than deleted, because
            deleting it would leave an answered question pointing at nothing. Retired competencies stay
            readable on old reviews and are no longer offered when building a template.
          </Alert>

          {active.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Layers className="h-5 w-5" />}
                title="No competencies yet"
                description="Add the skills your reviews should assess — safety, craftsmanship, client service, whatever your trade actually measures."
                action={<NewCompetencyButton />}
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {active.map((c) => (
                <CompetencyCard key={c.id} competency={c} />
              ))}
            </div>
          )}

          {retired.length > 0 && (
            <Card className="mt-6">
              <CardHeader
                title="Retired"
                description="No longer offered when building a template. Still shown on reviews that used them."
              />
              <ul className="divide-y divide-slate-100">
                {retired.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-700">{c.name}</p>
                      {c._count.questions > 0 && (
                        <p className="text-xs text-slate-500">
                          Used by {countLabel(c._count.questions, 'review question')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">Retired</Badge>
                      <CompetencyEditor
                        competency={{
                          id: c.id,
                          name: c.name,
                          description: c.description,
                          category: c.category,
                          active: c.active,
                          behaviors: c.behaviors.map((b) => ({ level: b.level, descriptor: b.descriptor })),
                        }}
                        referenced={c._count.questions + c._count.feedbackItems + c._count.devActions > 0}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <>
          <Alert tone="neutral" className="mb-5 max-w-4xl" title="What a library is for">
            A library is the competency set that applies to a kind of work. Attach it to the job titles
            it fits, and the template builder offers that set first when a review is aimed at those
            roles. Libraries are a convenience for authoring — they do not grant or restrict access, and
            changing one never alters a review that has already been written.
          </Alert>

          {libraries.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Library className="h-5 w-5" />}
                title="No libraries yet"
                description="Group competencies into the sets that fit field crews, crew leadership, project management, sales and office administration."
                action={<NewLibraryButton competencies={options} jobTitles={titleOptions} />}
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {libraries.map((lib) => (
                <Card key={lib.id}>
                  <CardHeader
                    title={lib.name}
                    description={lib.description ?? undefined}
                    actions={
                      <>
                        {!lib.active && <Badge tone="neutral">Inactive</Badge>}
                        <Badge tone="neutral">{countLabel(lib.items.length, 'competency', 'competencies')}</Badge>
                        <LibraryEditor
                          library={{
                            id: lib.id,
                            name: lib.name,
                            description: lib.description,
                            active: lib.active,
                            items: lib.items.map((i) => ({
                              competencyId: i.competencyId,
                              weight: i.weight,
                            })),
                            jobTitleIds: lib.jobTitles.map((t) => t.id),
                          }}
                          competencies={options}
                          jobTitles={titleOptions}
                        />
                      </>
                    }
                  />
                  <CardBody>
                    {lib.items.length === 0 ? (
                      <p className="text-sm text-slate-500">No competencies in this library yet.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {lib.items.map((item) => (
                          <li
                            key={item.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-700"
                          >
                            <span className="font-medium">{item.competency.name}</span>
                            {item.weight !== 1 && (
                              <span className="text-slate-500">· weight {item.weight}</span>
                            )}
                            {!item.competency.active && <span className="text-slate-400">· retired</span>}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Applies to job titles
                      </p>
                      {lib.jobTitles.length === 0 ? (
                        <p className="mt-1 text-sm text-slate-500">
                          Not attached to a job title yet, so it is offered but never suggested.
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-slate-700">
                          {lib.jobTitles.map((t) => t.name).join(', ')}
                        </p>
                      )}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

type CompetencyRow = Awaited<ReturnType<typeof listCompetencies>>[number];

function CompetencyCard({ competency: c }: { competency: CompetencyRow }) {
  const byLevel = new Map(c.behaviors.map((b) => [b.level, b.descriptor]));
  const defined = COMPETENCY_LEVELS.filter((level) => byLevel.has(level));

  return (
    <Card>
      <CardHeader
        title={c.name}
        description={c.description ?? undefined}
        actions={
          <>
            {c.category && <Badge tone="info">{c.category}</Badge>}
            <CompetencyEditor
              competency={{
                id: c.id,
                name: c.name,
                description: c.description,
                category: c.category,
                active: c.active,
                behaviors: c.behaviors.map((b) => ({ level: b.level, descriptor: b.descriptor })),
              }}
              referenced={c._count.questions + c._count.feedbackItems + c._count.devActions > 0}
            />
          </>
        }
      />
      <CardBody>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-600">
          <span>
            {defined.length === 0
              ? 'No level descriptors'
              : `${defined.length} of ${COMPETENCY_LEVELS.length} levels described`}
          </span>
          <span>{countLabel(c._count.questions, 'review question')}</span>
          <span>In {countLabel(c._count.libraryItems, 'library', 'libraries')}</span>
        </div>

        {defined.length > 0 && (
          <dl className="mt-3 space-y-2">
            {defined.map((level) => (
              <div key={level} className="sm:flex sm:gap-4">
                <dt className="w-28 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {level}
                </dt>
                <dd className="text-sm leading-relaxed text-slate-700">{byLevel.get(level)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}
