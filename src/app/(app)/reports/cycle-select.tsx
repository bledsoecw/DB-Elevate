'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/form';

/** Report filters, kept in the URL so a view can be bookmarked and shared. */
export function CycleSelect({
  cycles,
  current,
  tab,
  groupBy,
}: {
  cycles: { id: string; label: string }[];
  current: string;
  tab: string;
  groupBy?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    next.set('tab', tab);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        label="Review cycle"
        value={current}
        onChange={(e) => apply({ cycle: e.target.value })}
        containerClassName="min-w-[18rem] flex-1"
      >
        {cycles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </Select>

      {groupBy !== undefined && (
        <Select
          label="Group participation by"
          value={groupBy}
          onChange={(e) => apply({ group: e.target.value })}
          containerClassName="w-56"
        >
          <option value="department">Department at launch</option>
          <option value="jobTitle">Job title at launch</option>
          <option value="manager">Manager of record</option>
        </Select>
      )}

      {pending && <span className="pb-2 text-xs text-slate-500">Updating…</span>}
    </div>
  );
}
