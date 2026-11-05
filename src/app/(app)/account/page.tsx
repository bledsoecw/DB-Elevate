import Link from 'next/link';
import { requireActor } from '@/server/authz/actor';
import { getOwnAccount } from '@/server/services/account';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailItem,
  DetailList,
  PageHeader,
} from '@/components/ui/primitives';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@/lib/enums';
import { formatDate, formatRelativeTime } from '@/lib/utils';
import { ContactForm, PasswordForm, SessionList } from './controls';

export const metadata = { title: 'Your account' };

export default async function AccountPage() {
  const actor = await requireActor();
  const { user, sessions, hasPassword } = await getOwnAccount(actor);
  const employee = user.employee;

  return (
    <>
      <PageHeader
        title="Your account"
        description="How you sign in, where you are signed in, and what your roles let you do."
      />

      {user.mustChangePassword && (
        <Alert tone="warning" className="mb-5 max-w-3xl" title="Change your password">
          Your password was set by an administrator, so it should be changed to something only you
          know.
        </Alert>
      )}

      <div className="grid max-w-5xl gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Sign-in"
              description={`You sign in with ${user.email}.`}
            />
            <CardBody>
              {hasPassword ? (
                <PasswordForm />
              ) : (
                <p className="text-sm leading-relaxed text-slate-600">
                  This account signs in through an external identity provider, so there is no password
                  to change here.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Where you are signed in"
              description="Each browser you sign in from keeps its own session. If you see one you do not recognize, end it and change your password."
            />
            <SessionList
              sessions={sessions.map((s) => ({
                id: s.id,
                device: s.device,
                ip: s.ip,
                isCurrent: s.isCurrent,
                lastSeen: formatRelativeTime(s.lastSeenAt),
                started: formatDate(s.createdAt),
                expires: formatDate(s.expiresAt),
              }))}
            />
          </Card>

          {employee && (
            <Card>
              <CardHeader
                title="Your details"
                description="You can change what you are called and your phone number. Everything else is part of your personnel record."
              />
              <CardBody>
                <ContactForm
                  preferredName={employee.preferredName}
                  workPhone={employee.workPhone}
                  firstName={employee.firstName}
                />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Your roles" level={3} />
            <CardBody>
              <ul className="space-y-3">
                {user.roles.map((r) => (
                  <li key={r.role}>
                    <p className="text-sm font-medium text-slate-900">
                      {ROLE_LABELS[r.role as Role] ?? r.role}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                      {ROLE_DESCRIPTIONS[r.role as Role] ?? ''}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Granted {formatDate(r.grantedAt)}
                    </p>
                  </li>
                ))}
              </ul>
              {actor.isManager && (
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600">
                  You also have manager access, because{' '}
                  {actor.directReportIds.length === 1
                    ? 'someone reports'
                    : `${actor.directReportIds.length} people report`}{' '}
                  to you. That is not a role anyone granted — it follows the reporting structure, and
                  for a past review it follows the structure as it stood when that review was
                  launched.
                </p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Roles are changed by a system administrator. Every grant is recorded.
              </p>
            </CardBody>
          </Card>

          {employee && (
            <Card>
              <CardHeader title="Your record" level={3} />
              <CardBody>
                <DetailList cols={1}>
                  <DetailItem label="Name">
                    {employee.firstName} {employee.lastName}
                  </DetailItem>
                  {employee.jobTitle && (
                    <DetailItem label="Job title">
                      {employee.jobTitle.name}
                      {employee.jobTitle.level && ` · ${employee.jobTitle.level}`}
                    </DetailItem>
                  )}
                  {employee.department && (
                    <DetailItem label="Department">{employee.department.name}</DetailItem>
                  )}
                  <DetailItem label="Manager">
                    {employee.manager ? (
                      <Link href={`/people/${employee.manager.id}`} className="hover:underline">
                        {employee.manager.firstName} {employee.manager.lastName}
                      </Link>
                    ) : (
                      'None recorded'
                    )}
                  </DetailItem>
                  {employee.hireDate && (
                    <DetailItem label="Started">{formatDate(employee.hireDate)}</DetailItem>
                  )}
                  {employee.workLocation && (
                    <DetailItem label="Location">{employee.workLocation}</DetailItem>
                  )}
                  {employee.crew && <DetailItem label="Crew">{employee.crew}</DetailItem>}
                </DetailList>
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600">
                  Job title, department and manager are changed by HR. They decide who can see what,
                  so they are not something to edit about yourself.{' '}
                  <Link href={`/people/${employee.id}`} className="font-medium underline">
                    View your full profile
                  </Link>
                  .
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Your privacy" level={3} />
            <CardBody>
              <p className="text-sm leading-relaxed text-slate-700">
                What is private, what your manager can see, and how anonymous surveys actually work.
              </p>
              <Link
                href="/help/privacy"
                className="mt-2 inline-block text-sm font-medium text-brand-700 underline"
              >
                Read the privacy notes
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Account status" level={3} />
            <CardBody>
              <DetailList cols={1}>
                <DetailItem label="Status">
                  <Badge tone={user.status === 'active' ? 'success' : 'warning'}>{user.status}</Badge>
                </DetailItem>
                <DetailItem label="Last sign-in">
                  {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : 'This is your first'}
                </DetailItem>
                <DetailItem label="Account created">{formatDate(user.createdAt)}</DetailItem>
              </DetailList>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
