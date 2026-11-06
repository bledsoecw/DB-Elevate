import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Briefcase, Network } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listDepartments, listJobTitles, listLibraries } from '@/server/services/catalog';
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/primitives';
import { countLabel } from '@/lib/utils';
import { DepartmentEditor, NewDepartmentButton } from './department-editor';
import { JobTitleEditor, NewJobTitleButton } from './job-title-editor';

export const metadata = { title: 'Job titles and departments' };

/**
 * Job titles and departments.
 *
 * These two populate the pickers on an employee record, and until this page
 * existed they could only be created by the seed — so a real installation had
 * two empty dropdowns and no way to fill them. They are on one page because
 * they are set up together: a title usually belongs to a department, and
 * neither is useful alone.
 */
export default async function JobTitlesPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/admin');

  const [jobTitles, departments, libraries] = await Promise.all([
    listJobTitles(actor),
    listDepartments(actor),
    listLibraries(actor),
  ]);

  const activeTitles = jobTitles.filter((t) => t.active);
  const inactiveTitles = jobTitles.filter((t) => !t.active);
  const activeDepartments = departments.filter((d) => d.active);
  const inactiveDepartments = departments.filter((d) => !d.active);

  const departmentOptions = departments.map((d) => ({ id: d.id, name: d.name, active: d.active }));
  const libraryOptions = libraries.map((l) => ({ id: l.id, name: l.name, active: l.active }));

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'Administration', href: '/admin' },
          { label: 'Job titles and departments' },
        ]}
        title="Job titles and departments"
        description="The two lists behind the pickers on every employee record. Set these up before adding people, or the pickers have nothing to offer."
        actions={
          <>
            <NewDepartmentButton parents={departmentOptions} />
            <NewJobTitleButton departments={departmentOptions} libraries={libraryOptions} />
          </>
        }
        meta={`${countLabel(activeTitles.length, 'job title')} · ${countLabel(activeDepartments.length, 'department')}`}
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="Why these matter">
        A job title is not a label. It carries the{' '}
        <Link href="/admin/competencies" className="font-medium underline">
          competency library
        </Link>{' '}
        a review of that role is built from, and it owns the salary band a pay recommendation is
        measured against — so someone with no title gets a review with no competencies and a
        compensation row with no band. A department groups people for reporting and for feedback
        visibility. Neither is ever deleted here: once anyone holds a title, it is archived instead,
        so past reviews and past pay decisions keep pointing at something that still has a name.
      </Alert>

      {activeTitles.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Briefcase className="h-5 w-5" />}
            title="No job titles yet"
            description="Add the roles you actually hire for — Apprentice Carpenter, Lead Carpenter, Superintendent, Project Manager, Estimator. You can attach a competency library to each one later."
            action={<NewJobTitleButton departments={departmentOptions} libraries={libraryOptions} />}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Job titles"
            description="Offered on an employee record, in alphabetical order."
          />
          <ul className="divide-y divide-slate-100">
            {activeTitles.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex min-w-0 gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700"
                  >
                    <Briefcase className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {t.name}
                      {t.level && <span className="font-normal text-slate-500"> · {t.level}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {t.department ? t.department.name : 'No department'}
                      {' — '}
                      {t.competencyLibrary
                        ? `${t.competencyLibrary.name} library`
                        : 'no competency library'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t._count.employees === 0
                        ? 'Nobody holds this title'
                        : countLabel(t._count.employees, 'person holds it', 'people hold it')}
                    </p>
                  </div>
                </div>
                <JobTitleEditor
                  jobTitle={{
                    id: t.id,
                    name: t.name,
                    level: t.level,
                    departmentId: t.departmentId,
                    competencyLibraryId: t.competencyLibraryId,
                    active: t.active,
                  }}
                  departments={departmentOptions}
                  libraries={libraryOptions}
                  holderCount={t._count.employees}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {inactiveTitles.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Archived job titles"
            description="No longer offered. Employee history, reviews and pay decisions against them are unchanged."
          />
          <ul className="divide-y divide-slate-100">
            {inactiveTitles.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-700">
                    {t.name}
                    {t.level ? ` · ${t.level}` : ''}
                  </p>
                  {t._count.employees > 0 && (
                    <p className="text-xs text-slate-500">
                      {countLabel(t._count.employees, 'active person still holds it', 'active people still hold it')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">Archived</Badge>
                  <JobTitleEditor
                    jobTitle={{
                      id: t.id,
                      name: t.name,
                      level: t.level,
                      departmentId: t.departmentId,
                      competencyLibraryId: t.competencyLibraryId,
                      active: t.active,
                    }}
                    departments={departmentOptions}
                    libraries={libraryOptions}
                    holderCount={t._count.employees}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-8">
        {activeDepartments.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Network className="h-5 w-5" />}
              title="No departments yet"
              description="Add the groups you run work through — Field Operations, Carpentry, Estimating, Office. A department can sit under another one if you need crews inside a trade."
              action={<NewDepartmentButton parents={departmentOptions} />}
            />
          </Card>
        ) : (
          <Card>
            <CardHeader
              title="Departments"
              description="Offered on an employee record, and used to group reporting. Lowest order number first."
            />
            <ul className="divide-y divide-slate-100">
              {activeDepartments.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="flex min-w-0 gap-3">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600"
                    >
                      <Network className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {d.name}
                        {d.code && (
                          <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                            {d.code}
                          </span>
                        )}
                      </p>
                      {d.parent && (
                        <p className="mt-0.5 text-xs text-slate-600">Under {d.parent.name}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        {countLabel(d._count.employees, 'active person', 'active people')}
                        {d._count.jobTitles > 0 && ` · ${countLabel(d._count.jobTitles, 'job title')}`}
                        {d._count.children > 0 && ` · ${countLabel(d._count.children, 'sub-department')}`}
                      </p>
                    </div>
                  </div>
                  <DepartmentEditor
                    department={{
                      id: d.id,
                      name: d.name,
                      code: d.code,
                      parentId: d.parentId,
                      sortOrder: d.sortOrder,
                      active: d.active,
                    }}
                    parents={departmentOptions}
                    peopleCount={d._count.employees}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {inactiveDepartments.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Archived departments"
            description="No longer offered. Records already pointing at them are unchanged."
          />
          <ul className="divide-y divide-slate-100">
            {inactiveDepartments.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <p className="min-w-0 truncate text-sm text-slate-700">{d.name}</p>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">Archived</Badge>
                  <DepartmentEditor
                    department={{
                      id: d.id,
                      name: d.name,
                      code: d.code,
                      parentId: d.parentId,
                      sortOrder: d.sortOrder,
                      active: d.active,
                    }}
                    parents={departmentOptions}
                    peopleCount={d._count.employees}
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
