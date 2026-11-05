'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import { COMPETENCY_CATEGORIES, COMPETENCY_LEVELS } from '@/lib/enums';

/**
 * Create and edit a competency, including the behavioural ladder.
 *
 * The ladder is a textarea per career level. A level left empty is simply not
 * stored — a competency does not have to describe every rung, and an empty box
 * is a clearer "not defined" than a placeholder sentence would be.
 */

export interface CompetencyDraft {
  id?: string;
  name: string;
  description: string | null;
  category: string | null;
  active: boolean;
  behaviors: { level: string; descriptor: string }[];
}

const EMPTY: CompetencyDraft = {
  name: '',
  description: null,
  category: null,
  active: true,
  behaviors: [],
};

export function NewCompetencyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        New competency
      </Button>
      {open && <CompetencyDialog draft={EMPTY} onClose={() => setOpen(false)} />}
    </>
  );
}

export function CompetencyEditor({
  competency,
  referenced,
}: {
  competency: CompetencyDraft;
  referenced: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <CompetencyDialog
          draft={competency}
          referenced={referenced}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CompetencyDialog({
  draft: initial,
  referenced = false,
  onClose,
}: {
  draft: CompetencyDraft;
  referenced?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<CompetencyDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const editing = Boolean(initial.id);
  const ladder = new Map(draft.behaviors.map((b) => [b.level, b.descriptor]));

  function setLevel(level: string, descriptor: string) {
    const next = draft.behaviors.filter((b) => b.level !== level);
    if (descriptor.trim()) next.push({ level, descriptor });
    setDraft({ ...draft, behaviors: next });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const payload = {
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      category: draft.category || null,
      active: draft.active,
      behaviors: COMPETENCY_LEVELS.filter((l) => (ladder.get(l) ?? '').trim()).map((l) => ({
        level: l,
        descriptor: (ladder.get(l) as string).trim(),
      })),
    };
    try {
      if (editing) {
        await api.patch(`/api/admin/competencies/${initial.id}`, payload);
      } else {
        await api.post('/api/admin/competencies', payload);
      }
      toast.success(editing ? 'Competency updated.' : 'Competency added.');
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

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${initial.name}` : 'New competency'}
      description="Name it the way your crews would say it. The level descriptors are what stop a 3 meaning two different things to two raters."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Saving…" onClick={save}>
            {editing ? 'Save changes' : 'Add competency'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        <Input
          label="Name"
          required
          value={draft.name}
          error={fieldErrors.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Jobsite safety"
        />

        <Select
          label="Category"
          required={false}
          placeholder="No category"
          value={draft.category ?? ''}
          onChange={(e) => setDraft({ ...draft, category: e.target.value || null })}
          options={COMPETENCY_CATEGORIES.map((c) => ({ value: c, label: c }))}
          help="Used to group competencies in the template builder and in reports."
        />

        <Textarea
          label="Description"
          required={false}
          rows={2}
          value={draft.description ?? ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          help="One or two sentences a reviewer reads before rating."
        />

        {editing && (
          <Checkbox
            label="Offered when building templates"
            description={
              referenced
                ? 'Unchecking retires it. Reviews that already use it keep showing it.'
                : 'Unchecking hides it from the template builder.'
            }
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
        )}

        <Field
          label="What each level looks like"
          help="Leave a level blank if it does not apply to this competency. These descriptors appear beside the rating scale while a review is being written."
        >
          <div className="space-y-2.5">
            {COMPETENCY_LEVELS.map((level) => (
              <div key={level} className="sm:flex sm:items-start sm:gap-3">
                <span className="mt-2 block w-24 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {level}
                </span>
                <textarea
                  aria-label={`${level} descriptor`}
                  rows={2}
                  value={ladder.get(level) ?? ''}
                  onChange={(e) => setLevel(level, e.target.value)}
                  placeholder={`What ${level.toLowerCase()}-level performance looks like`}
                  className="block w-full resize-y rounded-md border-0 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                />
              </div>
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
