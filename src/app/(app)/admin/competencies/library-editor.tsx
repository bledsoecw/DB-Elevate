'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import { countLabel } from '@/lib/utils';

/**
 * Create and edit a competency library — a named set of competencies attached
 * to the job titles it fits.
 *
 * Weights are authoring hints carried into the template builder, not scoring
 * weights in themselves: a review's weights live on the template version it was
 * written against, so changing a library can never move a finished score.
 */

export interface LibraryDraft {
  id?: string;
  name: string;
  description: string | null;
  active: boolean;
  items: { competencyId: string; weight: number }[];
  jobTitleIds: string[];
}

export interface CompetencyOption {
  id: string;
  name: string;
  category: string | null;
  active: boolean;
}

export interface JobTitleOption {
  id: string;
  name: string;
  level: string | null;
  libraryId: string | null;
  headcount: number;
}

const EMPTY: LibraryDraft = {
  name: '',
  description: null,
  active: true,
  items: [],
  jobTitleIds: [],
};

export function NewLibraryButton({
  competencies,
  jobTitles,
}: {
  competencies: CompetencyOption[];
  jobTitles: JobTitleOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        New library
      </Button>
      {open && (
        <LibraryDialog
          draft={EMPTY}
          competencies={competencies}
          jobTitles={jobTitles}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function LibraryEditor({
  library,
  competencies,
  jobTitles,
}: {
  library: LibraryDraft;
  competencies: CompetencyOption[];
  jobTitles: JobTitleOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <LibraryDialog
          draft={library}
          competencies={competencies}
          jobTitles={jobTitles}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function LibraryDialog({
  draft: initial,
  competencies,
  jobTitles,
  onClose,
}: {
  draft: LibraryDraft;
  competencies: CompetencyOption[];
  jobTitles: JobTitleOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<LibraryDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const editing = Boolean(initial.id);
  const selected = new Map(draft.items.map((i) => [i.competencyId, i.weight]));

  function toggle(competencyId: string, on: boolean) {
    setDraft({
      ...draft,
      items: on
        ? [...draft.items, { competencyId, weight: 1 }]
        : draft.items.filter((i) => i.competencyId !== competencyId),
    });
  }

  function setWeight(competencyId: string, weight: number) {
    setDraft({
      ...draft,
      items: draft.items.map((i) => (i.competencyId === competencyId ? { ...i, weight } : i)),
    });
  }

  function toggleTitle(id: string, on: boolean) {
    setDraft({
      ...draft,
      jobTitleIds: on ? [...draft.jobTitleIds, id] : draft.jobTitleIds.filter((t) => t !== id),
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const payload = {
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      active: draft.active,
      items: draft.items,
      jobTitleIds: draft.jobTitleIds,
    };
    try {
      if (editing) {
        await api.patch(`/api/admin/libraries/${initial.id}`, payload);
      } else {
        await api.post('/api/admin/libraries', payload);
      }
      toast.success(editing ? 'Library updated.' : 'Library added.');
      onClose();
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length) {
        const map: Record<string, string> = {};
        for (const f of e.fieldErrors) map[f.path] = f.message;
        setFieldErrors(map);
      }
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const grouped = groupByCategory(competencies);
  /** Titles already pointing at a different library, so the move is visible. */
  const reassigning = jobTitles.filter(
    (t) => draft.jobTitleIds.includes(t.id) && t.libraryId && t.libraryId !== initial.id,
  );

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={editing ? `Edit ${initial.name}` : 'New competency library'}
      description="Pick the competencies this kind of work is assessed on, then say which job titles it applies to."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Saving…" onClick={save}>
            {editing ? 'Save changes' : 'Add library'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormError message={error} />

        <Input
          label="Name"
          required
          value={draft.name}
          error={fieldErrors.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Field crew"
        />

        <Textarea
          label="Description"
          required={false}
          rows={2}
          value={draft.description ?? ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />

        {editing && (
          <Checkbox
            label="Active"
            description="An inactive library is kept but no longer suggested."
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
        )}

        <Field
          label={`Competencies (${draft.items.length} selected)`}
          help="Weights are a starting point for the template builder. The weights that actually score a review live on the template version, so changing them here cannot move a finished score."
        >
          <div className="max-h-72 space-y-4 overflow-y-auto rounded-md border border-slate-200 p-3">
            {grouped.length === 0 && (
              <p className="text-sm text-slate-500">
                No competencies defined yet. Add some on the Competencies tab first.
              </p>
            )}
            {grouped.map(([category, items]) => (
              <div key={category}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {category}
                </p>
                <div className="space-y-1.5">
                  {items.map((c) => {
                    const on = selected.has(c.id);
                    return (
                      <div key={c.id} className="flex items-center gap-3">
                        <Checkbox
                          className="flex-1"
                          label={
                            <span className={c.active ? '' : 'text-slate-500'}>
                              {c.name}
                              {!c.active && ' (retired)'}
                            </span>
                          }
                          checked={on}
                          onChange={(e) => toggle(c.id, e.target.checked)}
                        />
                        {on && (
                          <label className="flex items-center gap-1.5 text-xs text-slate-600">
                            <span>Weight</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={selected.get(c.id) ?? 1}
                              onChange={(e) => setWeight(c.id, Number(e.target.value))}
                              aria-label={`Weight for ${c.name}`}
                              className="w-16 rounded-md border-0 px-2 py-1 text-xs shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Field>

        <Field
          label="Job titles this applies to"
          help="A job title points at one library. Selecting a title here moves it from whatever library it was on."
        >
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-slate-200 p-3">
            {jobTitles.length === 0 && (
              <p className="text-sm text-slate-500">No job titles defined yet.</p>
            )}
            {jobTitles.map((t) => (
              <Checkbox
                key={t.id}
                label={
                  <span>
                    {t.name}
                    {t.level && <span className="text-slate-500"> · {t.level}</span>}
                    {t.headcount > 0 && (
                      <span className="text-slate-400"> · {countLabel(t.headcount, 'person', 'people')}</span>
                    )}
                  </span>
                }
                checked={draft.jobTitleIds.includes(t.id)}
                onChange={(e) => toggleTitle(t.id, e.target.checked)}
              />
            ))}
          </div>
        </Field>

        {reassigning.length > 0 && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            {reassigning.map((t) => t.name).join(', ')}{' '}
            {reassigning.length === 1 ? 'is' : 'are'} currently on another library and will be moved to
            this one. No existing review changes.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function groupByCategory(items: CompetencyOption[]): [string, CompetencyOption[]][] {
  const map = new Map<string, CompetencyOption[]>();
  for (const item of items) {
    const key = item.category ?? 'Uncategorized';
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
