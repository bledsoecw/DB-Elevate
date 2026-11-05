import { redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getActor } from '@/server/authz/actor';
import { getInboxCount } from '@/server/services/inbox';
import { navigationFor } from '@/components/app-shell/nav';
import { AppShell } from '@/components/app-shell/shell';
import { ROLE_LABELS, type Role } from '@/lib/enums';
import { formatRelativeTime } from '@/lib/utils';

/**
 * Authenticated application shell.
 *
 * The session is resolved here against the database — the Edge middleware only
 * checks that a cookie exists. Every page nested under this layout can rely on
 * there being an actor, but each still authorizes its own data access.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect('/login');

  const [inbox, notificationRows, unreadCount, demoCount] = await Promise.all([
    getInboxCount(actor),
    actor.employeeId
      ? prisma.notification.findMany({
          where: { recipientEmployeeId: actor.employeeId },
          orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
          take: 12,
          select: {
            id: true,
            title: true,
            body: true,
            linkUrl: true,
            severity: true,
            createdAt: true,
            readAt: true,
          },
        })
      : Promise.resolve([]),
    actor.employeeId
      ? prisma.notification.count({ where: { recipientEmployeeId: actor.employeeId, readAt: null } })
      : Promise.resolve(0),
    prisma.employee.count({ where: { orgId: actor.orgId, isDemoData: true } }),
  ]);

  const roleSummary = (() => {
    const labels = actor.roles
      .filter((r) => r !== 'EMPLOYEE')
      .map((r) => ROLE_LABELS[r as Role] ?? r);
    if (actor.isManager) {
      labels.push(
        `Manager of ${actor.directReportIds.length} direct ${actor.directReportIds.length === 1 ? 'report' : 'reports'}`,
      );
    }
    return labels.length > 0 ? labels.join(' · ') : 'Employee';
  })();

  const [firstName = '', ...rest] = actor.displayName.split(' ');

  return (
    <AppShell
      sections={navigationFor(actor)}
      user={{
        name: actor.displayName,
        email: actor.email,
        firstName,
        lastName: rest.join(' ') || firstName,
        jobTitle: null,
        roleSummary,
      }}
      branding={{
        wordmarkText: actor.org.wordmarkText || actor.org.productName,
        logoUrl: actor.org.logoUrl,
        orgName: actor.org.name,
        productName: actor.org.productName,
      }}
      taskCount={inbox.total}
      overdueCount={inbox.overdue}
      notificationCount={unreadCount}
      notifications={notificationRows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        linkUrl: n.linkUrl,
        severity: n.severity,
        createdAt: formatRelativeTime(n.createdAt),
        read: n.readAt !== null,
      }))}
      isDemoOrg={demoCount > 0}
    >
      {children}
    </AppShell>
  );
}
