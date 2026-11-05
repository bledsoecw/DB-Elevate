import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn, AVATAR_PALETTE, colorFromString, initials } from '@/lib/utils';

/**
 * Server-renderable UI primitives.
 *
 * Nothing here is a client component, so pages stay server-rendered by default
 * and only genuinely interactive pieces ship JavaScript.
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  meta,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  meta?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-slate-500">
            {breadcrumb.map((b, i) => (
              <li key={`${b.label}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden className="text-slate-300">/</span>}
                {b.href ? (
                  <Link href={b.href} className="hover:text-brand-700 hover:underline">
                    {b.label}
                  </Link>
                ) : (
                  <span className="text-slate-700">{b.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && (
            <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-600">
              {description}
            </div>
          )}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <Tag className={cn('rounded-lg border border-slate-200 bg-white shadow-card', className)}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  level = 2,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  level?: 2 | 3 | 4;
}) {
  const Heading = (`h${level}` as unknown) as 'h2';
  return (
    <div
      className={cn(
        'flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-base font-semibold text-slate-900">{title}</Heading>
        {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('border-t border-slate-200 bg-slate-50/70 px-5 py-3', className)}>
      {children}
    </div>
  );
}

export function Grid({
  children,
  cols = 3,
  className,
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4;
  className?: string;
}) {
  const map = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  } as const;
  return <div className={cn('grid grid-cols-1 gap-4', map[cols], className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Badges and status
// ---------------------------------------------------------------------------

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent'
  | 'muted';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-rose-50 text-rose-800 ring-rose-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  accent: 'bg-accent-50 text-accent-700 ring-accent-100',
  muted: 'bg-white text-slate-500 ring-slate-200',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small key/value pair, used across detail pages. */
export function DetailItem({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export function DetailList({
  children,
  cols = 3,
  className,
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const map = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const;
  return <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4', map[cols], className)}>{children}</dl>;
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

export function Avatar({
  firstName,
  lastName,
  size = 'md',
  className,
}: {
  firstName: string;
  lastName: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const sizes = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-lg',
  } as const;
  const palette = AVATAR_PALETTE[colorFromString(`${firstName}${lastName}`)] ?? AVATAR_PALETTE[0];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold',
        sizes[size],
        palette,
        className,
      )}
    >
      {initials(firstName, lastName)}
    </span>
  );
}

export function PersonChip({
  firstName,
  lastName,
  preferredName,
  subtitle,
  href,
  size = 'sm',
  className,
}: {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  subtitle?: ReactNode;
  href?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const name = `${preferredName || firstName} ${lastName}`;
  const inner = (
    <>
      <Avatar firstName={firstName} lastName={lastName} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">{name}</span>
        {subtitle && <span className="block truncate text-xs text-slate-500">{subtitle}</span>}
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cn('group inline-flex items-center gap-2.5 hover:underline', className)}>
        {inner}
      </Link>
    );
  }
  return <span className={cn('inline-flex items-center gap-2.5', className)}>{inner}</span>;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('scroll-thin -mx-px overflow-x-auto', className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = 'left',
  scope = 'col',
}: {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  scope?: 'col' | 'row';
}) {
  return (
    <th
      scope={scope}
      className={cn(
        'whitespace-nowrap bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = 'left',
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'px-4 py-3 align-top text-slate-700',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-6 py-12 text-center', className)}>
      {icon && (
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && (
        <div className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
          {description}
        </div>
      )}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  icon,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'neutral';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-rose-200 bg-rose-50 text-rose-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    neutral: 'border-slate-200 bg-slate-50 text-slate-800',
  } as const;
  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm', tones[tone], className)} role="note">
      <div className="flex gap-3">
        {icon && <span className="mt-0.5 flex-shrink-0">{icon}</span>}
        <div className="min-w-0">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn('leading-relaxed', title && 'mt-1')}>{children}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress and metrics
// ---------------------------------------------------------------------------

export function ProgressBar({
  value,
  tone = 'brand',
  label,
  size = 'md',
  className,
}: {
  /** 0-100, or null when no progress figure exists. */
  value: number | null;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'slate';
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const tones = {
    brand: 'bg-brand-600',
    success: 'bg-emerald-600',
    warning: 'bg-amber-500',
    danger: 'bg-rose-600',
    slate: 'bg-slate-400',
  } as const;
  if (value === null) {
    return (
      <div className={cn('text-xs italic text-slate-500', className)}>No progress recorded</div>
    );
  }
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={className}>
      <div
        className={cn('w-full overflow-hidden rounded-full bg-slate-200', size === 'sm' ? 'h-1.5' : 'h-2')}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div className={cn('h-full rounded-full transition-all', tones[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
  denominator,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'brand';
  href?: string;
  /** Spelled out so a percentage is never shown without its basis. */
  denominator?: string;
}) {
  const tones = {
    neutral: 'text-slate-900',
    warning: 'text-amber-700',
    danger: 'text-rose-700',
    success: 'text-emerald-700',
    brand: 'text-brand-700',
  } as const;
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</p>
      {denominator && <p className="mt-0.5 text-xs text-slate-500">{denominator}</p>}
      {hint && <p className="mt-1 text-xs leading-snug text-slate-600">{hint}</p>}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-card transition hover:border-brand-300 hover:shadow-pop"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3.5 shadow-card">{body}</div>
  );
}

// ---------------------------------------------------------------------------
// Links that look like buttons (no client JS needed)
// ---------------------------------------------------------------------------

/**
 * Pill-shaped, matching the tool this replaces. Worth copying because a fully
 * rounded button reads as "press me" at a glance in a dense interface, which
 * is most of what a button has to do here.
 */
export const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';

export const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
  accent: 'bg-accent-600 text-white hover:bg-accent-700 shadow-sm',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  link: 'text-brand-700 hover:text-brand-800 hover:underline',
} as const;

export const BUTTON_SIZES = {
  // A pill needs more horizontal padding than a rectangle to look balanced.
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2',
  lg: 'px-6 py-2.5 text-base',
} as const;

export function ButtonLink({
  href,
  children,
  variant = 'secondary',
  size = 'md',
  className,
  prefetch,
  target,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  className?: string;
  prefetch?: boolean;
  target?: string;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      target={target}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Tabs implemented as links, so tab state survives a reload and is linkable
// ---------------------------------------------------------------------------

export function LinkTabs({
  tabs,
  current,
  className,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  current: string;
  className?: string;
}) {
  return (
    <div className={cn('border-b border-slate-200', className)}>
      <nav className="scroll-thin -mb-px flex gap-1 overflow-x-auto" aria-label="Sections">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition',
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                    active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600',
                  )}
                >
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Long-form prose written by a person. Preserves line breaks safely as text. */
export function ProseText({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('whitespace-pre-wrap text-sm leading-relaxed text-slate-800', className)}>
      {children}
    </div>
  );
}

export function Divider({ className, label }: { className?: string; label?: string }) {
  if (label) {
    return (
      <div className={cn('relative my-5', className)}>
        <div aria-hidden className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            {label}
          </span>
        </div>
      </div>
    );
  }
  return <hr className={cn('my-5 border-slate-200', className)} />;
}
