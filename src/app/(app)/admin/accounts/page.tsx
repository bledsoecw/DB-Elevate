import Link from 'next/link';
import { redirect } from 'next/navigation';
import { KeyRound, ShieldCheck, UserX } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listAccounts, listEmployeesWithoutAccounts } from '@/server/services/admin';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Grid,
  PageHeader,
  StatTile,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@/lib/enums';
import { countLabel, formatRelativeTime, fullName } from '@/lib/utils';
import { AccountControls, CreateAccountButton } from './account-controls';

export const metadata = { title: 'Accounts and roles' };

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.isSysAdmin) redirect('/admin');

  const { q } = await searchParams;
  const [accounts, withoutAccounts] = await Promise.all([
    listAccounts(actor, q),
    listEmployeesWithoutAccounts(actor),
  ]);

  const activeCount = accounts.filter((a) => a.status === 'active').length;
  const suspended = accounts.filter((a) => a.status === 'suspended');
  const sysAdmins = accounts.filter(
    (a) => a.status === 'active' && a.roles.some((r) => r.role === 'SYS_ADMIN'),
  );
  const hrAdmins = accounts.filter(
    (a) => a.status === 'active' && a.roles.some((r) => r.role === 'HR_ADMIN'),
  );

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Accounts' }]}
        title="Accounts and roles"
        description="Who can sign in, and what each role grants. Roles are additive and every grant is recorded in the audit log."
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="The separation that matters">
        A system administrator runs the application — accounts, branding, integrations, the log — and
        that role grants no access to review content, private notes or anonymous survey answers. An HR
        administrator runs the performance programme and has no keys to the application. If one person
        genuinely needs both, grant both roles explicitly; the grant itself is audited, which is the
        point.
      </Alert>

      <Grid cols={4} className="mb-6">
        <StatTile label="Active accounts" value={activeCount} denominator={`of ${accounts.length}`} />
        <StatTile
          label="System administrators"
          value={sysAdmins.length}
          tone={sysAdmins.length === 1 ? 'warning' : 'neutral'}
          hint={sysAdmins.length === 1 ? 'Only one. Consider a second so nobody is locked out.' : undefined}
        />
        <StatTile label="HR administrators" value={hrAdmins.length} />
        <StatTile
          label="Employees with no account"
          value={withoutAccounts.length}
          tone={withoutAccounts.length > 0 ? 'warning' : 'success'}
          hint={withoutAccounts.length > 0 ? 'They cannot take part in a cycle.' : undefined}
        />
      </Grid>

      <Card className="mb-6">
        <CardHeader title="What each role grants" level={2} />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            {ROLES.map((role) => (
              <div key={role}>
                <dt className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <ShieldCheck aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                  {ROLE_LABELS[role]}
                </dt>
                <dd className="mt-1 text-xs leading-relaxed text-slate-600">
                  {ROLE_DESCRIPTIONS[role]}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600">
            <strong className="font-semibold text-slate-800">Manager</strong> is not a role here. It is
            structural: someone is a manager because people report to them, and their access follows the
            reporting line as it stood when a review was launched. That is why a reorganization cannot
            retroactively open an old review, and why nobody can be made a manager by granting a
            checkbox.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Accounts"
          description={q ? `Filtered by “${q}”.` : `${countLabel(accounts.length, 'account')}.`}
          actions={
            <form action="/admin/accounts" method="get" className="flex items-center gap-2">
              <label htmlFor="account-search" className="sr-only">
                Search accounts
              </label>
              <input
                id="account-search"
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Name or e-mail"
                className="w-48 rounded-md border-0 px-3 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
              />
              <button
                type="submit"
                className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                Search
              </button>
            </form>
          }
        />
        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts match"
            description={q ? 'Try a different name or e-mail address.' : 'No accounts exist yet.'}
            action={
              q ? (
                <Link href="/admin/accounts" className="text-sm font-medium text-brand-700 underline">
                  Clear the filter
                </Link>
              ) : undefined
            }
          />
        ) : (
          <TableWrap>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Roles</Th>
                  <Th>Status</Th>
                  <Th>Last sign-in</Th>
                  <Th align="right">Manage</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((a) => {
                  const roles = a.roles.map((r) => r.role as Role);
                  const locked = a.lockedUntil && a.lockedUntil > new Date();
                  return (
                    <tr key={a.id} className="align-top">
                      <Td>
                        <div className="min-w-0">
                          {a.employee ? (
                            <Link
                              href={`/people/${a.employee.id}`}
                              className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                            >
                              {fullName(a.employee)}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-900">
                              No linked employee record
                            </span>
                          )}
                          <p className="truncate text-xs text-slate-500">{a.email}</p>
                          {a.employee && (
                            <p className="text-xs text-slate-500">
                              {a.employee.jobTitle?.name ?? 'No job title'}
                              {a.employee._count.directReports > 0 && (
                                <> · {countLabel(a.employee._count.directReports, 'direct report')}</>
                              )}
                            </p>
                          )}
                          {a.isDemoAccount && (
                            <Badge tone="neutral" className="mt-1">
                              Demonstration account
                            </Badge>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {roles.length === 0 && <span className="text-xs text-slate-500">None</span>}
                          {roles.map((role) => (
                            <Badge
                              key={role}
                              tone={
                                role === 'SYS_ADMIN'
                                  ? 'danger'
                                  : role === 'HR_ADMIN'
                                    ? 'info'
                                    : role === 'LEADERSHIP'
                                      ? 'success'
                                      : 'neutral'
                              }
                              title={ROLE_DESCRIPTIONS[role]}
                            >
                              {role === 'SYS_ADMIN'
                                ? 'System'
                                : role === 'HR_ADMIN'
                                  ? 'HR'
                                  : role === 'LEADERSHIP'
                                    ? 'Leadership'
                                    : 'Employee'}
                            </Badge>
                          ))}
                        </div>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            a.status === 'active'
                              ? locked
                                ? 'warning'
                                : 'success'
                              : a.status === 'suspended'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {a.status === 'active' && locked ? 'Locked out' : a.status}
                        </Badge>
                        {a.mustChangePassword && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                            <KeyRound aria-hidden className="h-3 w-3" /> Must change password
                          </p>
                        )}
                        {!a.passwordHash && (
                          <p className="mt-1 text-xs text-slate-500">
                            {a.externalIdpSubject
                              ? 'Signs in with Google — no password'
                              : 'No password set'}
                          </p>
                        )}
                        {a.passwordHash && a.externalIdpSubject && (
                          <p className="mt-1 text-xs text-slate-500">
                            Linked to a Google account
                          </p>
                        )}
                        {a.employee?.employmentStatus === 'terminated' && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                            <UserX aria-hidden className="h-3 w-3" /> Employee deactivated
                          </p>
                        )}
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-600">
                          {a.lastLoginAt ? formatRelativeTime(a.lastLoginAt) : 'Never'}
                        </span>
                        {a.failedLoginCount > 0 && (
                          <p className="text-xs text-amber-700">
                            {countLabel(a.failedLoginCount, 'failed attempt')}
                          </p>
                        )}
                      </Td>
                      <Td align="right">
                        <AccountControls
                          account={{
                            id: a.id,
                            email: a.email,
                            status: a.status,
                            roles,
                            personName: a.employee ? fullName(a.employee) : a.email,
                            ssoLinked: a.externalIdpSubject !== null,
                          }}
                          isSelf={a.id === actor.userId}
                          lastActiveSysAdmin={
                            roles.includes('SYS_ADMIN') && sysAdmins.length === 1 && a.status === 'active'
                          }
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
          </TableWrap>
        )}
      </Card>

      {withoutAccounts.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Employees with no sign-in account"
            description="They have a personnel record but cannot sign in, so they can neither write a self-review nor acknowledge a released one."
          />
          <ul className="divide-y divide-slate-100">
            {withoutAccounts.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/people/${e.id}`}
                    className="text-sm font-medium text-slate-800 hover:underline"
                  >
                    {e.firstName} {e.lastName}
                  </Link>
                  <p className="truncate text-xs text-slate-500">
                    {e.workEmail} · {e.jobTitle?.name ?? 'No job title'}
                  </p>
                </div>
                <CreateAccountButton
                  employeeId={e.id}
                  personName={`${e.firstName} ${e.lastName}`}
                  email={e.workEmail}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {suspended.length > 0 && (
        <p className="mt-5 text-xs text-slate-500">
          {countLabel(suspended.length, 'suspended account')}. A suspended account keeps its records
          and its history; it simply cannot sign in, and its live sessions were ended the moment it was
          suspended.
        </p>
      )}
    </>
  );
}
