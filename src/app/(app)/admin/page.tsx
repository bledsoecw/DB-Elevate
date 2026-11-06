import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Award,
  Briefcase,
  ClipboardList,
  Database,
  FileText,
  Gauge,
  Inbox,
  Layers,
  Scale,
  Settings,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { prisma } from '@/server/db';
import { hrDashboard } from '@/server/services/dashboard';
import { Alert, Badge, Card, CardBody, CardHeader, Grid, PageHeader, StatTile } from '@/components/ui/primitives';
import { countLabel } from '@/lib/utils';

export const metadata = { title: 'Administration' };

export default async function AdminPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin && !actor.isSysAdmin) redirect('/');

  const [counts, hr, queuedEmail] = await Promise.all([
    Promise.all([
      prisma.reviewTemplate.count({ where: { orgId: actor.orgId, status: { not: 'archived' } } }),
      prisma.reviewCycle.count({ where: { orgId: actor.orgId, status: { in: ['DRAFT', 'SCHEDULED', 'ACTIVE'] } } }),
      prisma.competency.count({ where: { orgId: actor.orgId, active: true } }),
      prisma.ratingScale.count({ where: { orgId: actor.orgId, archived: false } }),
      prisma.employee.count({ where: { orgId: actor.orgId, employmentStatus: 'active' } }),
      prisma.employee.count({ where: { orgId: actor.orgId, isDemoData: true } }),
      prisma.jobTitle.count({ where: { orgId: actor.orgId, active: true } }),
      prisma.department.count({ where: { orgId: actor.orgId, active: true } }),
    ]),
    actor.isHrAdmin ? hrDashboard(actor) : null,
    prisma.emailMessage.count({ where: { orgId: actor.orgId, status: 'QUEUED' } }),
  ]);

  const [
    templateCount,
    activeCycles,
    competencyCount,
    scaleCount,
    employeeCount,
    demoCount,
    jobTitleCount,
    departmentCount,
  ] = counts;

  const programCards = [
    {
      href: '/admin/templates',
      icon: FileText,
      title: 'Review templates',
      description: 'Build and version the forms. Publishing freezes a version so a completed review can never be rewritten.',
      meta: countLabel(templateCount, 'template'),
    },
    {
      href: '/reviews/cycles',
      icon: ClipboardList,
      title: 'Review cycles',
      description: 'Choose who takes part, assign reviewers, set deadlines and launch.',
      meta: `${activeCycles} not yet closed`,
    },
    {
      href: '/admin/competencies',
      icon: Layers,
      title: 'Competencies and libraries',
      description: 'The skills assessed in reviews, with behavioural descriptors by level, grouped into libraries by role.',
      meta: countLabel(competencyCount, 'competency', 'competencies'),
    },
    {
      href: '/admin/job-titles',
      icon: Briefcase,
      title: 'Job titles and departments',
      description:
        'The two pickers on every employee record. A job title carries the competency library a review is built from and owns the salary band a pay recommendation is measured against.',
      meta:
        jobTitleCount === 0
          ? 'Not set up yet'
          : `${countLabel(jobTitleCount, 'job title')} · ${countLabel(departmentCount, 'department')}`,
    },
    {
      href: '/admin/scales',
      icon: Gauge,
      title: 'Rating scales',
      description: 'The scales reviews and surveys use. Each level carries a written description so a number means something.',
      meta: countLabel(scaleCount, 'scale'),
    },
    {
      href: '/admin/recognition',
      icon: Award,
      title: 'Recognition values',
      description: 'The values people can recognize each other against.',
      meta: null,
    },
    {
      href: '/admin/calibration',
      icon: Scale,
      title: 'Calibration',
      description: 'Review ratings together before release, and record every adjustment with its reason.',
      meta: null,
    },
  ];

  // The audit log is readable by both administrators (policy.ts), so HR sees a
  // link to it too rather than being sent to a page it is allowed to open.
  const auditCard = {
    href: '/admin/audit',
    icon: ShieldAlert,
    title: 'Audit log',
    description:
      'Every significant action, who took it and when. Review text and private notes are deliberately not recorded.',
    meta: null as string | null,
  };

  const systemCards = [
    {
      href: '/admin/system',
      icon: Settings,
      title: 'Organization and branding',
      description: 'Company name, product name, colours and logo. Privacy thresholds and e-mail settings.',
      meta: null,
    },
    {
      href: '/admin/accounts',
      icon: Users,
      title: 'Accounts and roles',
      description: 'Who can sign in and what each role grants. A system administrator does not get review content by default.',
      meta: countLabel(employeeCount, 'active employee'),
    },
    {
      href: '/admin/audit',
      icon: ShieldAlert,
      title: 'Audit log',
      description: 'Every significant action, who took it and when. Review text and private notes are deliberately not recorded.',
      meta: null,
    },
    {
      href: '/admin/outbox',
      icon: Inbox,
      title: 'E-mail outbox',
      description: 'Every message the application would send. Nothing leaves this machine until a mail provider is configured.',
      meta: queuedEmail > 0 ? `${queuedEmail} queued` : 'Nothing queued',
    },
    {
      href: '/admin/ai',
      icon: Sparkles,
      title: 'AI assistance',
      description: 'Optional drafting help, off by default. The application is fully functional without it.',
      meta: actor.org.aiEnabled ? 'Enabled' : 'Disabled',
    },
    {
      href: '/admin/demo-data',
      icon: Database,
      title: 'Demonstration data',
      description: 'Remove the synthetic organization once your own records are in.',
      meta: demoCount > 0 ? `${demoCount} demo records` : 'None',
    },
  ];

  return (
    <>
      <PageHeader
        title="Administration"
        description={
          actor.isHrAdmin && actor.isSysAdmin
            ? 'You hold both the HR and system administrator roles.'
            : actor.isHrAdmin
              ? 'Performance-programme administration. Application settings are handled by a system administrator.'
              : 'Application administration. Review content is handled by an HR administrator and is not shown to this role.'
        }
      />

      {hr && hr.exceptions.total > 0 && (
        <Alert tone="warning" className="mb-5" title="Things needing attention">
          <ul className="mt-1 space-y-0.5">
            {hr.exceptions.noManager > 0 && <li>{countLabel(hr.exceptions.noManager, 'active employee')} with no manager.</li>}
            {hr.exceptions.noAccount > 0 && <li>{countLabel(hr.exceptions.noAccount, 'active employee')} with no sign-in account.</li>}
            {hr.exceptions.deactivatedReviewer > 0 && (
              <li>{countLabel(hr.exceptions.deactivatedReviewer, 'open review')} assigned to a deactivated account.</li>
            )}
            {hr.exceptions.approvedNotReleased > 0 && (
              <li>{countLabel(hr.exceptions.approvedNotReleased, 'review')} approved but not released.</li>
            )}
            {hr.exceptions.staleAcknowledgement > 0 && (
              <li>{countLabel(hr.exceptions.staleAcknowledgement, 'released review')} unacknowledged for over three weeks.</li>
            )}
          </ul>
          <Link href="/admin/exceptions" className="mt-2 inline-block text-sm font-medium underline">
            Work through them
          </Link>
        </Alert>
      )}

      {actor.isHrAdmin && hr && (
        <Grid cols={4} className="mb-6">
          <StatTile label="Active cycles" value={hr.cycles.length} href="/reviews/cycles" />
          <StatTile label="Awaiting approval" value={hr.pendingApprovals} href="/reviews?tab=approvals" tone={hr.pendingApprovals > 0 ? 'warning' : 'neutral'} />
          <StatTile label="Open surveys" value={hr.openSurveys.length} href="/surveys" />
          <StatTile label="Reopened reviews" value={hr.reopenedCount} hint="Submitted reviews sent back for editing." />
        </Grid>
      )}

      {actor.isHrAdmin && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Performance programme
          </h2>
          <Grid cols={3}>
            {[...programCards, ...(actor.isSysAdmin ? [] : [auditCard])].map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="group rounded-lg border border-slate-200 bg-white p-5 shadow-card transition hover:border-brand-300 hover:shadow-pop"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 text-brand-700">
                  <c.icon aria-hidden className="h-[18px] w-[18px]" />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-slate-900 group-hover:text-brand-700">
                  {c.title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{c.description}</p>
                {c.meta && <p className="mt-2 text-xs font-medium text-slate-500">{c.meta}</p>}
              </Link>
            ))}
          </Grid>
        </section>
      )}

      {actor.isSysAdmin && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            System
          </h2>
          <Grid cols={3}>
            {systemCards.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                className="group rounded-lg border border-slate-200 bg-white p-5 shadow-card transition hover:border-brand-300 hover:shadow-pop"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                  <c.icon aria-hidden className="h-[18px] w-[18px]" />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-slate-900 group-hover:text-brand-700">
                  {c.title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{c.description}</p>
                {c.meta && <p className="mt-2 text-xs font-medium text-slate-500">{c.meta}</p>}
              </Link>
            ))}
          </Grid>
        </section>
      )}

      {!actor.isSysAdmin && actor.isHrAdmin && (
        <Card className="mt-6">
          <CardHeader title="Application settings" />
          <CardBody>
            <p className="text-sm leading-relaxed text-slate-600">
              Branding, accounts, roles, the audit log and integrations are handled by a system
              administrator. That separation is deliberate: the role that manages accounts does not
              automatically get access to review content, and the role that administers the
              performance programme does not automatically get the keys to the application.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              If one person genuinely needs both, grant both roles explicitly — the grant itself is
              audited.
            </p>
          </CardBody>
        </Card>
      )}

      <p className="mt-6 text-xs text-slate-500">
        <Badge tone="neutral">Scope</Badge> Everything here applies to{' '}
        {actor.org.name}. This installation is set up for one organization; records are scoped so a
        second one could be added without the two ever seeing each other.
      </p>
    </>
  );
}
