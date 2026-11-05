'use client';

import { useRouter } from 'next/navigation';

/**
 * Whose competencies to show. A plain select that navigates, rather than a
 * fetch — the server decides what this person may open, and a client-side
 * list would be a second place to get that wrong.
 */
export function SubjectPicker({
  subjects,
  current,
}: {
  subjects: { id: string; name: string; jobTitle: string | null }[];
  current: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-600">Showing</span>
      <select
        value={current}
        onChange={(e) => router.push(`/competencies?employee=${e.target.value}`)}
        className="rounded-full border-0 bg-white py-1.5 pl-3 pr-8 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
      >
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.jobTitle ? `${s.name} — ${s.jobTitle}` : s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
