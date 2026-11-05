import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HardHat, ShieldCheck } from 'lucide-react';
import { prisma } from '@/server/db';
import { getActor } from '@/server/authz/actor';
import { getPublicBranding } from '@/server/services/branding';
import { DemoButton, LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

/**
 * Whether the one-click demo panel may be shown.
 *
 * Three conditions, all required. The panel is a convenience that fills in the
 * form; it posts to the same endpoint with the same password as any other
 * sign-in, so there is no alternative authentication path to secure.
 */
function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_LOGIN === 'true';
}

async function demoAccounts() {
  if (!devLoginEnabled()) return [];
  const { DEV_LOGIN_ORDER } = await import('../../../../prisma/seed/people');
  const users = await prisma.user.findMany({
    where: { isDemoAccount: true, status: 'active' },
    select: {
      email: true,
      roles: { select: { role: true } },
      employee: {
        select: {
          firstName: true,
          lastName: true,
          jobTitle: { select: { name: true } },
          _count: { select: { directReports: true } },
        },
      },
    },
  });

  const order = new Map(DEV_LOGIN_ORDER.map((key, i) => [key, i]));
  const keyOf = (email: string) => email.split('@')[0]!.split('.')[0]!;

  return users
    .filter((u) => order.has(keyOf(u.email)))
    .sort((a, b) => (order.get(keyOf(a.email)) ?? 99) - (order.get(keyOf(b.email)) ?? 99))
    .map((u) => {
      const roles = u.roles.map((r) => r.role);
      const reports = u.employee?._count.directReports ?? 0;
      const labels: string[] = [];
      if (roles.includes('SYS_ADMIN')) labels.push('System admin');
      if (roles.includes('HR_ADMIN')) labels.push('HR admin');
      if (roles.includes('LEADERSHIP')) labels.push('Leadership');
      if (reports > 0) labels.push(`Manager · ${reports} ${reports === 1 ? 'report' : 'reports'}`);
      if (labels.length === 0) labels.push('Employee');
      return {
        email: u.email,
        name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email,
        title: u.employee?.jobTitle?.name ?? '',
        roleLabel: labels.join(' · '),
      };
    });
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const actor = await getActor();
  if (actor) redirect('/');

  const [branding, accounts, params] = await Promise.all([
    getPublicBranding(),
    demoAccounts(),
    searchParams,
  ]);

  const employeeCount = await prisma.employee.count().catch(() => 0);
  const needsSetup = employeeCount === 0;

  // Only ever read in development; see devLoginEnabled().
  const demoPassword = devLoginEnabled() ? (process.env.SEED_PASSWORD || 'ElevateDemo!2026') : null;

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel. Hidden on phones so the form is the first thing seen. */}
      <div className="hidden bg-brand-800 lg:flex lg:w-[42%] lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt="" className="h-9 w-auto" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-600 text-white">
              <HardHat aria-hidden className="h-5 w-5" />
            </span>
          )}
          <span className="text-lg font-semibold tracking-tight text-white">
            {branding.wordmarkText}
          </span>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-white">
            Reviews, goals and feedback that people actually finish.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-brand-100">
            {branding.orgName} runs performance reviews, one-to-ones, goals and engagement surveys
            here — from the field crews to the office.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-brand-100">
            {[
              'Your own reviews, goals and feedback in one place',
              'Managers see their own reporting line, and only that',
              'Anonymous surveys stay anonymous, including in reports',
            ].map((item) => (
              <li key={item} className="flex gap-2.5">
                <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-brand-200">
          {branding.orgName} · {branding.productName}
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-700 text-white">
              <HardHat aria-hidden className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight text-slate-900">
              {branding.wordmarkText}
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Use your work e-mail address and the password you were given.
          </p>

          {needsSetup && (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">No accounts exist yet</p>
              <p className="mt-1 leading-relaxed">
                To set up a real organization, run{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">
                  npm run create-admin -- --email you@company.com --name &quot;Your Name&quot;
                </code>{' '}
                and sign in with the password it prints.
              </p>
              <p className="mt-1.5 leading-relaxed">
                To explore with sample data instead, run{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">npm run db:seed</code>.
                That creates 27 fictional employees, which you would not want in a real
                installation.
              </p>
            </div>
          )}

          <div className="mt-6">
            <LoginForm nextPath={params.next ?? '/'} />
          </div>

          {accounts.length > 0 && demoPassword && (
            <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Demonstration accounts</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                    Development only. Choosing one fills in the form and performs a normal password
                    sign-in — it does not bypass authentication. Set{' '}
                    <code className="font-mono">ENABLE_DEV_LOGIN=false</code> to hide this.
                  </p>
                </div>
              </div>
              <ul className="mt-3 divide-y divide-slate-100">
                {accounts.map((a) => (
                  <li key={a.email}>
                    <DemoButton
                      email={a.email}
                      password={demoPassword}
                      name={a.name}
                      title={a.title}
                      roleLabel={a.roleLabel}
                      nextPath={params.next ?? '/'}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-8 text-xs leading-relaxed text-slate-500">
            Trouble signing in? Contact your HR administrator — they can reset your password. This
            application does not send password-reset e-mail until an outbound mail provider has been
            configured.{' '}
            <Link href="/api/health" className="underline hover:text-slate-700">
              System status
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
