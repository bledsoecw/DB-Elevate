'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Bell,
  CalendarDays,
  Award,
  ChevronDown,
  Search,
  ClipboardCheck,
  GraduationCap,
  HardHat,
  Home,
  Inbox,
  LineChart,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Shield,
  Target,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { api } from '@/lib/client-api';
import { Wordmark } from '@/components/ui/wordmark';
import { activeNavKey, type NavSection } from './nav';

const ICONS: Record<string, typeof Home> = {
  home: Home,
  inbox: Inbox,
  users: Users,
  'clipboard-check': ClipboardCheck,
  target: Target,
  'message-square': MessageSquare,
  'calendar-days': CalendarDays,
  'bar-chart-3': BarChart3,
  'graduation-cap': GraduationCap,
  'line-chart': LineChart,
  award: Award,
  wallet: Wallet,
  settings: Settings,
  shield: Shield,
};

export interface ShellUser {
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  roleSummary: string;
}

export interface ShellBranding {
  wordmarkText: string;
  logoUrl: string | null;
  orgName: string;
  productName: string;
}

export function AppShell({
  sections,
  user,
  branding,
  taskCount,
  overdueCount,
  notificationCount,
  notifications,
  isDemoOrg,
  children,
}: {
  sections: NavSection[];
  user: ShellUser;
  branding: ShellBranding;
  taskCount: number;
  overdueCount: number;
  notificationCount: number;
  notifications: {
    id: string;
    title: string;
    body: string | null;
    linkUrl: string | null;
    severity: string;
    createdAt: string;
    read: boolean;
  }[];
  isDemoOrg: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const activeKey = activeNavKey(sections, pathname);

  /**
   * Published so automated tests can wait for React to have taken over before
   * interacting. Without it a click can land on server-rendered markup that no
   * handler is attached to yet, which produces failures that look like
   * application bugs. Costs one attribute.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Close transient UI whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
    setBellOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen && !bellOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-popover]')) {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen, bellOpen]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Sign out locally regardless; the cookie is cleared server-side on retry.
    }
    router.replace('/login');
    router.refresh();
  }

  async function markAllRead() {
    try {
      await api.post('/api/notifications/read-all');
      router.refresh();
    } catch {
      /* non-critical */
    }
  }

  /**
   * Which nav sections are expanded.
   *
   * Seeded from the active route so arriving on a sub-page shows you where you
   * are, then owned by the user's clicks. Expanding is not navigation — the
   * parent remains a link, so one click still gets you to the section's main
   * page and the chevron is a separate target.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sectionOpen = (key: string) => expanded[key] ?? key === activeKey;

  const navList = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {sections.map((section, si) => (
        <div key={section.heading ?? `section-${si}`}>
          {section.heading && (
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {section.heading}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Home;
              const active = item.key === activeKey;
              const badge = item.badgeKey === 'tasks' ? taskCount : 0;
              const hasChildren = Boolean(item.children?.length);
              const open = hasChildren && sectionOpen(item.key);
              return (
                <li key={item.key}>
                  <div
                    className={cn(
                      'group flex items-center rounded-md transition',
                      active
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                    )}
                  >
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      title={item.description}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-sm font-medium"
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          'h-[18px] w-[18px] flex-shrink-0',
                          active ? 'text-brand-700' : 'text-slate-400 group-hover:text-slate-600',
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge > 0 && (
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                            overdueCount > 0
                              ? 'bg-accent-600 text-white'
                              : 'bg-brand-600 text-white',
                          )}
                        >
                          {badge}
                        </span>
                      )}
                    </Link>
                    {hasChildren && (
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => ({ ...e, [item.key]: !open }))}
                        aria-expanded={open}
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
                        className="flex-shrink-0 rounded px-2 py-2 text-slate-400 transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                      >
                        <ChevronDown
                          aria-hidden
                          className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
                        />
                      </button>
                    )}
                  </div>

                  {open && item.children && (
                    <ul className="mb-1 mt-0.5 space-y-0.5">
                      {item.children.map((child) => (
                        <li key={child.key}>
                          <Link
                            href={child.href}
                            onClick={() => setMobileOpen(false)}
                            className="block truncate rounded-md py-1.5 pl-[38px] pr-2.5 text-[13px] text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const sidebarInner = (
    <>
      {/*
        The company's mark on top, the product's name under it — the same
        order and the same relationship as the sign-in page, so the two do not
        disagree about what this application is called.
      */}
      <div className="flex-shrink-0 border-b border-slate-200 px-4 py-3.5">
        {branding.logoUrl ? (
          // Sized to the slot rather than to a fixed height: a wordmark is
          // usually wide and short, and capping only the height squeezes it
          // into a strip too small to read. Capping both lets a tall logo and
          // a wide one each use the space they need.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt={branding.orgName}
            className="max-h-9 w-auto max-w-[190px] object-contain"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-700 text-white">
            <HardHat aria-hidden className="h-[18px] w-[18px]" />
          </span>
        )}
        <Wordmark
          text={branding.wordmarkText}
          onDark={false}
          size="xs"
          className="mt-3"
        />
      </div>

      {navList}

      {/*
        The person, pinned at the bottom. It answers "who am I signed in as"
        without a click, which matters in an application where the answer
        changes what you are allowed to see.
      */}
      <div className="flex-shrink-0 border-t border-slate-200 p-3">
        <Link
          href="/account"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2.5 rounded-md px-2 py-2 transition hover:bg-slate-100"
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-800">
            {initials(user.firstName, user.lastName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">{user.name}</span>
            <span className="block truncate text-[11px] text-slate-500">
              {user.jobTitle ?? user.roleSummary}
            </span>
            <span className="block truncate text-[11px] text-slate-400">{user.email}</span>
          </span>
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:flex" data-hydrated={hydrated ? 'true' : 'false'}>
      <a href="#main-content" className="skip-link no-print">
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="no-print hidden w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white lg:flex lg:fixed lg:inset-y-0">
        {sidebarInner}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative flex h-full w-72 max-w-[85%] flex-col bg-white">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-md p-1.5 text-brand-100 hover:bg-white/10"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarInner}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-30 flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="-ml-1.5 rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex-1" />

          {/*
            Employee search. Submits to the directory rather than doing
            type-ahead against an endpoint, because the directory already
            applies the viewer's scope — a manager searching finds their own
            reporting line, not the whole company. A separate search endpoint
            would be a second place for that rule to be got wrong.
          */}
          <form action="/people" method="get" className="min-w-0 max-w-xs flex-1 sm:w-72 sm:flex-none">
            <label htmlFor="employee-search" className="sr-only">
              Search employees
            </label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                id="employee-search"
                type="search"
                name="q"
                placeholder="Search employee…"
                className="block w-full rounded-full border-0 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-brand-600"
              />
            </div>
          </form>

          {/* Notifications */}
          <div className="relative" data-popover>
            <button
              type="button"
              onClick={() => {
                setBellOpen((v) => !v);
                setMenuOpen(false);
              }}
              aria-expanded={bellOpen}
              aria-haspopup="true"
              className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100"
            >
              <Bell className="h-5 w-5" />
              <span className="sr-only">
                Notifications{notificationCount > 0 ? `, ${notificationCount} unread` : ''}
              </span>
              {notificationCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-semibold text-white">
                  {notificationCount > 9 ? '9+' : notificationCount}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-pop">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                  <p className="text-sm font-semibold text-slate-900">Notifications</p>
                  {notificationCount > 0 && (
                    <button
                      type="button"
                      onClick={markAllRead}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <ul className="scroll-thin max-h-80 divide-y divide-slate-100 overflow-y-auto">
                  {notifications.length === 0 && (
                    <li className="px-4 py-8 text-center text-sm text-slate-500">
                      Nothing new. You are up to date.
                    </li>
                  )}
                  {notifications.map((n) => (
                    <li key={n.id} className={cn(!n.read && 'bg-brand-50/50')}>
                      <Link
                        href={n.linkUrl ?? '/tasks'}
                        className="block px-4 py-3 hover:bg-slate-50"
                        onClick={() => setBellOpen(false)}
                      >
                        <p className="flex items-start gap-2 text-sm font-medium text-slate-900">
                          {!n.read && (
                            <span
                              aria-hidden
                              className={cn(
                                'mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full',
                                n.severity === 'urgent'
                                  ? 'bg-rose-500'
                                  : n.severity === 'warning'
                                    ? 'bg-amber-500'
                                    : 'bg-brand-500',
                              )}
                            />
                          )}
                          <span className="min-w-0">{n.title}</span>
                        </p>
                        {n.body && (
                          <p className="mt-0.5 pl-3.5 text-xs leading-relaxed text-slate-600">{n.body}</p>
                        )}
                        <p className="mt-0.5 pl-3.5 text-[11px] text-slate-400">{n.createdAt}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-2">
                  <Link href="/tasks" className="text-xs font-medium text-brand-700 hover:underline">
                    Go to my tasks
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Account menu */}
          <div className="relative" data-popover>
            <button
              type="button"
              onClick={() => {
                setMenuOpen((v) => !v);
                setBellOpen(false);
              }}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              className="flex items-center rounded-full p-0.5 transition hover:ring-2 hover:ring-slate-200"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
              >
                {user.firstName[0]}
                {user.lastName[0]}
              </span>
              <span className="sr-only">Account menu for {user.name}</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-pop">
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
                  <p className="truncate text-xs text-slate-600">{user.email}</p>
                  <p className="mt-1.5 text-xs text-slate-500">{user.roleSummary}</p>
                </div>
                <div className="py-1">
                  <Link
                    href="/people/me"
                    className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    My profile and history
                  </Link>
                  <Link
                    href="/account"
                    className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Account and password
                  </Link>
                </div>
                <div className="border-t border-slate-200 py-1">
                  <button
                    type="button"
                    onClick={signOut}
                    disabled={signingOut}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    <LogOut aria-hidden className="h-4 w-4" />
                    {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>

        {isDemoOrg && (
          <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 sm:px-6">
            <strong className="font-semibold">Demonstration data.</strong> Every person, review and
            survey answer here is synthetic.{' '}
            <Link href="/admin/demo-data" className="underline hover:text-amber-950">
              Replace it with your own
            </Link>
          </div>
        )}

        <main id="main-content" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>

        <footer className="no-print border-t border-slate-200 px-4 py-4 text-xs text-slate-500 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <span>
              {branding.productName} · {branding.orgName}
            </span>
            <span className="flex gap-4">
              {/* -my-1 py-1 keeps the tap area comfortable on a phone without
                  changing how the footer reads on a desktop. */}
              <Link
                href="/help/privacy"
                className="-my-1 inline-flex items-center py-1 hover:text-slate-700 hover:underline"
              >
                How your information is used
              </Link>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
