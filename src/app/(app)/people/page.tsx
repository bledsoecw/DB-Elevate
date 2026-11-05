import Link from 'next/link';
import { Download, Upload, UserPlus, Users } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listDirectory, getFormOptions } from '@/server/services/people';
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { DirectoryFilters } from './filters';
import { formatDate, countLabel } from '@/lib/utils';
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, type EmploymentStatus, type EmploymentType } from '@/lib/enums';

export const metadata = { title: 'People' };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const filters = {
    query: sp.q,
    departmentId: sp.department,
    jobTitleId: sp.title,
    status: (sp.status as 'active' | 'on_leave' | 'terminated' | 'all') ?? 'active',
    scope: (sp.scope as 'all' | 'team' | 'direct') ?? 'all',
  };

  const [people, options] = await Promise.all([
    listDirectory(actor, filters),
    getFormOptions(actor.orgId),
  ]);

  const canManage = actor.isHrAdmin;
  const hasFilters = Boolean(sp.q || sp.department || sp.title || sp.scope || (sp.status && sp.status !== 'active'));

  return (
    <>
      <PageHeader
        title={actor.isManager || actor.isHrAdmin ? 'People' : 'Directory'}
        description={
          actor.isHrAdmin
            ? 'Everyone in the organization. Changing a reporting line here is recorded as an event, so historical reviews keep the manager who wrote them.'
            : actor.isManager
              ? 'Everyone in the company. You can open the full record for anyone in your reporting line.'
              : 'Everyone in the company. You can see names, roles and who reports to whom.'
        }
        actions={
          canManage ? (
            <>
              <ButtonLink href="/api/people/import/template">
                <Download aria-hidden className="h-4 w-4" />
                CSV template
              </ButtonLink>
              <ButtonLink href="/people/import">
                <Upload aria-hidden className="h-4 w-4" />
                Import
              </ButtonLink>
              <ButtonLink href="/people/new" variant="primary">
                <UserPlus aria-hidden className="h-4 w-4" />
                Add an employee
              </ButtonLink>
            </>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardBody>
          <DirectoryFilters
            departments={options.departments}
            jobTitles={options.jobTitles}
            showScope={actor.isManager}
            showStatus={actor.isHrAdmin}
            initial={{
              q: sp.q ?? '',
              department: sp.department ?? '',
              title: sp.title ?? '',
              status: filters.status,
              scope: filters.scope,
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={countLabel(people.length, 'person', 'people')}
          description={
            filters.status === 'active'
              ? 'Active employees only. Use the status filter to include deactivated records.'
              : undefined
          }
        />
        {people.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={hasFilters ? 'Nobody matches those filters' : 'No employees yet'}
            description={
              hasFilters
                ? 'Try a different search, or clear the filters.'
                : canManage
                  ? 'Add people one at a time, or import a spreadsheet. Nothing is sent to anyone when you add them.'
                  : 'The directory is empty.'
            }
            action={
              hasFilters ? (
                <ButtonLink href="/people">Clear filters</ButtonLink>
              ) : canManage ? (
                <>
                  <ButtonLink href="/people/new" variant="primary">
                    Add an employee
                  </ButtonLink>
                  <ButtonLink href="/people/import">Import a spreadsheet</ButtonLink>
                </>
              ) : undefined
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Department</Th>
                <Th>Manager</Th>
                <Th>Hired</Th>
                <Th align="right">Reports</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>
                    <span className="flex items-center gap-2.5">
                      <Avatar firstName={p.firstName} lastName={p.lastName} size="sm" />
                      <span className="min-w-0">
                        <Link
                          href={`/people/${p.id}`}
                          className="block font-medium text-slate-900 hover:underline"
                        >
                          {p.preferredName || p.firstName} {p.lastName}
                        </Link>
                        <span className="block truncate text-xs text-slate-500">{p.workEmail}</span>
                      </span>
                    </span>
                  </Td>
                  <Td className="text-slate-700">
                    {p.jobTitle?.name ?? <span className="text-slate-400">Not set</span>}
                    {p.crew && <span className="block text-xs text-slate-500">{p.crew}</span>}
                  </Td>
                  <Td className="text-slate-700">
                    {p.department?.name ?? <span className="text-slate-400">—</span>}
                  </Td>
                  <Td className="text-slate-700">
                    {p.manager ? (
                      <Link href={`/people/${p.manager.id}`} className="hover:underline">
                        {p.manager.preferredName || p.manager.firstName} {p.manager.lastName}
                      </Link>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">{formatDate(p.hireDate)}</Td>
                  <Td align="right" className="tabular-nums text-slate-700">
                    {p._count.directReports || <span className="text-slate-300">—</span>}
                  </Td>
                  <Td>
                    <span className="flex flex-wrap justify-end gap-1.5">
                      {p.employmentStatus !== 'active' && (
                        <Badge tone={p.employmentStatus === 'terminated' ? 'danger' : 'warning'}>
                          {EMPLOYMENT_STATUS_LABELS[p.employmentStatus as EmploymentStatus] ??
                            p.employmentStatus}
                        </Badge>
                      )}
                      {p.employmentType !== 'full_time' && (
                        <Badge tone="neutral">
                          {EMPLOYMENT_TYPE_LABELS[p.employmentType as EmploymentType] ?? p.employmentType}
                        </Badge>
                      )}
                      {actor.isHrAdmin && !p.hasAccount && (
                        <Badge tone="warning" title="This person cannot sign in.">
                          No account
                        </Badge>
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
