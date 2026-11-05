import type { Actor } from '@/server/authz/actor';

/**
 * Navigation is derived from the actor's roles and reporting position, so a
 * person is never shown a section they would be refused on arrival. The server
 * still authorizes every page independently — this only decides what to offer.
 */

export interface NavChild {
  key: string;
  label: string;
  href: string;
}

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** Shown as a badge; resolved by the shell. */
  badgeKey?: 'tasks';
  description: string;
  /**
   * Sub-items, revealed when the section is expanded.
   *
   * The grouping deliberately mirrors the tool this replaces, because the
   * people using it already know where things live. Matching their muscle
   * memory is worth more than a tidier taxonomy of my own devising — every
   * child here is a destination that already existed, usually as a tab.
   */
  children?: NavChild[];
}

export interface NavSection {
  heading: string | null;
  items: NavItem[];
}

export function navigationFor(actor: Actor): NavSection[] {
  const isManager = actor.isManager;
  const isHr = actor.isHrAdmin;
  const isSys = actor.isSysAdmin;
  const isLeadership = actor.isLeadership;

  const main: NavItem[] = [
    { key: 'home', label: 'Home', href: '/', icon: 'home', description: 'Your dashboard' },
    {
      key: 'tasks',
      label: 'My tasks',
      href: '/tasks',
      icon: 'inbox',
      badgeKey: 'tasks',
      description: 'Everything waiting on you',
    },
    {
      key: 'people',
      label: isManager || isHr ? 'People' : 'Directory',
      href: '/people',
      icon: 'users',
      description: isManager || isHr ? 'Your team and the employee directory' : 'Who works here',
    },
    {
      key: 'reviews',
      label: 'Reviews',
      href: '/reviews',
      icon: 'clipboard-check',
      description: 'Review cycles, assignments and results',
      children: [
        { key: 'reviews-mine', label: 'Forms I need to do', href: '/reviews?tab=mine' },
        { key: 'reviews-results', label: 'Reviews of me', href: '/reviews?tab=results' },
        ...(isManager || isHr
          ? [{ key: 'reviews-team', label: "My team's reviews", href: '/reviews?tab=team' }]
          : []),
        ...(isHr || isLeadership
          ? [{ key: 'reviews-approvals', label: 'Awaiting my approval', href: '/reviews?tab=approvals' }]
          : []),
        ...(isHr
          ? [
              { key: 'reviews-cycles', label: 'Review cycles', href: '/reviews/cycles' },
              { key: 'reviews-templates', label: 'Review templates', href: '/admin/templates' },
            ]
          : []),
      ],
    },
    {
      key: 'goals',
      label: 'Goals',
      href: '/goals',
      icon: 'target',
      description: 'Individual, team and company goals',
      children: [
        { key: 'goals-mine', label: 'My goals', href: '/goals?scope=mine' },
        ...(isManager ? [{ key: 'goals-team', label: "My team's goals", href: '/goals?scope=team' }] : []),
        { key: 'goals-company', label: 'Company goals', href: '/goals?scope=company' },
      ],
    },
    {
      key: 'feedback',
      label: 'Feedback',
      href: '/feedback',
      icon: 'message-square',
      description: 'Recognition, feedback and requests',
      children: [
        { key: 'feedback-received', label: 'Feedback about me', href: '/feedback?tab=received' },
        { key: 'feedback-given', label: 'Feedback I gave', href: '/feedback?tab=given' },
        { key: 'feedback-give', label: 'Give feedback', href: '/feedback/new' },
        { key: 'feedback-request', label: 'Request feedback', href: '/feedback/request' },
      ],
    },
    {
      key: 'meetings',
      label: 'Meetings',
      href: '/meetings',
      icon: 'calendar-days',
      description: 'One-to-ones, agendas and action items',
      children: [
        { key: 'meetings-list', label: 'My one-to-ones', href: '/meetings' },
        { key: 'meetings-actions', label: 'Action items', href: '/meetings/actions' },
      ],
    },
    { key: 'surveys', label: 'Surveys', href: '/surveys', icon: 'bar-chart-3', description: 'Engagement and pulse surveys' },
    {
      key: 'development',
      label: 'Development',
      href: '/development',
      icon: 'graduation-cap',
      description: 'Development plans and competencies',
      children: [
        { key: 'dev-mine', label: 'My plans', href: '/development' },
        ...(isManager ? [{ key: 'dev-team', label: "My team's plans", href: '/development?scope=team' }] : []),
        ...(isHr ? [{ key: 'dev-competencies', label: 'Competencies', href: '/admin/competencies' }] : []),
      ],
    },
  ];

  const sections: NavSection[] = [{ heading: null, items: main }];

  if (isHr || isLeadership || isManager) {
    sections.push({
      heading: 'Insight',
      items: [
        {
          key: 'reports',
          label: 'Reports',
          href: '/reports',
          icon: 'line-chart',
          description: isHr || isLeadership ? 'Company-wide reporting' : 'Reporting for your team',
        },
      ],
    });
  }

  if (isHr || isSys) {
    const admin: NavItem[] = [];
    if (isHr) {
      admin.push({
        key: 'admin-program',
        label: 'Program setup',
        href: '/admin',
        icon: 'settings',
        description: 'Templates, cycles, competencies and scales',
      });
    }
    if (isSys) {
      admin.push({
        key: 'admin-system',
        label: 'System',
        href: '/admin/system',
        icon: 'shield',
        description: 'Accounts, roles, branding, integrations and audit log',
      });
    }
    sections.push({ heading: 'Administration', items: admin });
  }

  return sections;
}

/** Longest-prefix match, so a detail page keeps its section highlighted. */
export function activeNavKey(sections: NavSection[], pathname: string): string {
  let best: { key: string; length: number } | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const matches = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
      if (matches && (!best || item.href.length > best.length)) {
        best = { key: item.key, length: item.href.length };
      }
    }
  }
  return best?.key ?? 'home';
}
