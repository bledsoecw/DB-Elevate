import { cn } from '@/lib/utils';

/**
 * The product wordmark, as a lockup rather than a line of bold text.
 *
 * It borrows the device the company logo already uses — a heavy name over a
 * small, widely-spaced descriptor bar — so the product reads as belonging to
 * the parent brand rather than sitting beside it. Oswald is condensed, which
 * is what lets the letter-spacing open this far without the name sprawling
 * across the panel.
 *
 * The name comes from the organization's settings, so this has to work for
 * whatever text somebody puts there. Nothing here depends on it being two
 * words, or on it being "DB Elevate".
 */
export function Wordmark({
  text,
  onDark,
  size = 'lg',
  descriptor = 'Performance & development',
  className,
}: {
  text: string;
  onDark: boolean;
  size?: 'lg' | 'sm' | 'xs';
  /** Set to null to show the name alone. */
  descriptor?: string | null;
  className?: string;
}) {
  const name = {
    lg: 'text-[2.15rem] tracking-[0.2em]',
    sm: 'text-[1.45rem] tracking-[0.18em]',
    xs: 'text-[0.95rem] tracking-[0.16em]',
  }[size];

  const sub = {
    lg: 'text-[0.625rem] tracking-[0.3em]',
    sm: 'text-[0.5625rem] tracking-[0.26em]',
    xs: 'text-[0.5rem] tracking-[0.22em]',
  }[size];

  const rule = { lg: 'w-8', sm: 'w-6', xs: 'w-4' }[size];
  const gap = { lg: 'mt-3', sm: 'mt-2', xs: 'mt-1.5' }[size];

  return (
    <div className={cn('select-none', className)}>
      <span
        className={cn(
          'block font-head font-medium uppercase leading-none',
          name,
          onDark ? 'text-white' : 'text-slate-900',
        )}
      >
        {text}
      </span>
      {descriptor && (
        <span className={cn('flex items-center gap-2.5', gap)}>
          <span
            aria-hidden
            className={cn(
              'h-[2px] flex-shrink-0 rounded-full',
              rule,
              onDark ? 'bg-accent-400' : 'bg-accent-600',
            )}
          />
          <span
            className={cn(
              'font-semibold uppercase leading-none',
              sub,
              onDark ? 'text-brand-200' : 'text-slate-500',
            )}
          >
            {descriptor}
          </span>
        </span>
      )}
    </div>
  );
}
