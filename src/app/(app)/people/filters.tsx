'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Directory filters.
 *
 * State lives in the URL rather than in component state, so a filtered view can
 * be bookmarked, shared and reloaded, and so the server does the filtering with
 * the permission rules applied.
 */
export function DirectoryFilters({
  departments,
  jobTitles,
  showScope,
  showStatus,
  initial,
}: {
  departments: { id: string; name: string }[];
  jobTitles: { id: string; name: string }[];
  showScope: boolean;
  showStatus: boolean;
  initial: { q: string; department: string; title: string; status: string; scope: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(initial.q);

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  // Debounced search, so typing does not fire a request per keystroke.
  useEffect(() => {
    if (query === initial.q) return;
    const timer = setTimeout(() => apply({ q: query }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const hasFilters =
    initial.q || initial.department || initial.title || initial.scope !== 'all' || initial.status !== 'active';

  const select =
    'rounded-md border-0 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600';

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-[14rem] flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        <label htmlFor="people-search" className="sr-only">
          Search people
        </label>
        <input
          id="people-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, e-mail, employee number or crew"
          className="block w-full rounded-md border-0 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
        />
      </div>

      <label className="sr-only" htmlFor="filter-department">
        Department
      </label>
      <select
        id="filter-department"
        className={select}
        value={initial.department}
        onChange={(e) => apply({ department: e.target.value })}
      >
        <option value="">All departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="filter-title">
        Job title
      </label>
      <select
        id="filter-title"
        className={select}
        value={initial.title}
        onChange={(e) => apply({ title: e.target.value })}
      >
        <option value="">All job titles</option>
        {jobTitles.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {showScope && (
        <>
          <label className="sr-only" htmlFor="filter-scope">
            Scope
          </label>
          <select
            id="filter-scope"
            className={select}
            value={initial.scope}
            onChange={(e) => apply({ scope: e.target.value === 'all' ? '' : e.target.value })}
          >
            <option value="all">Everyone</option>
            <option value="team">My reporting line</option>
            <option value="direct">My direct reports</option>
          </select>
        </>
      )}

      {showStatus && (
        <>
          <label className="sr-only" htmlFor="filter-status">
            Employment status
          </label>
          <select
            id="filter-status"
            className={select}
            value={initial.status}
            onChange={(e) => apply({ status: e.target.value === 'active' ? '' : e.target.value })}
          >
            <option value="active">Active</option>
            <option value="on_leave">On leave</option>
            <option value="terminated">Deactivated</option>
            <option value="all">Any status</option>
          </select>
        </>
      )}

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          icon={<X className="h-3.5 w-3.5" />}
          onClick={() => {
            setQuery('');
            startTransition(() => router.replace(pathname));
          }}
        >
          Clear
        </Button>
      )}

      {pending && <span className="text-xs text-slate-500">Updating…</span>}
    </div>
  );
}
