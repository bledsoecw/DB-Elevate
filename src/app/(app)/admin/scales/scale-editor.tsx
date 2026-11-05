'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import { countLabel } from '@/lib/utils';

/**
 * Create and edit a rating scale.
 *
 * When the scale is frozen (used by a published template version or a launched
 * survey) the level editor is disabled and says so. The server refuses the
 * change regardless — this is the explanation, not the enforcement.
 */

export interface ScaleLevelDraft {
  value: number;
  label: string;
  description: string | null;
}

export interface ScaleDraft {
  id?: string;
  name: string;
  description: string | null;
  numeric: boolean;
  archived?: boolean;
  levels: ScaleLevelDraft[];
}

const STARTER: ScaleDraft = {
  name: '',
  description: null,
  numeric: true,
  levels: [
    { value: 1, label: 'Below expectations', description: null },
    { value: 2, label: 'Approaching expectations', description: null },
    { value: 3, label: 'Meets expectations', description: null },
    { value: 4, label: 'Exceeds expectations', description: null },
    { value: 5, label: 'Outstanding', description: null },
  ],
};

export function NewScaleButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        New scale
      </Button>
      {open && (
        <ScaleDialog
          draft={STARTER}
          frozen={false}
          usage={{ questions: 0, surveyQuestions: 0 }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function ScaleEditor({
  scale,
  frozen,
  usage,
}: {
  scale: ScaleDraft;
  frozen: boolean;
  usage: { questions: number; surveyQuestions: number };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <ScaleDialog draft={scale} frozen={frozen} usage={usage} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ScaleDialog({
  draft: initial,
  frozen,
  usage,
  onClose,
}: {
  draft: ScaleDraft;
  frozen: boolean;
  usage: { questions: number; surveyQuestions: number };
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<ScaleDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const editing = Boolean(initial.id);

  function setLevel(index: number, patch: Partial<ScaleLevelDraft>) {
    setDraft({
      ...draft,
      levels: draft.levels.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    });
  }

  function addLevel() {
    const highest = draft.levels.reduce((max, l) => Math.max(max, l.value), 0);
    setDraft({
      ...draft,
      levels: [...draft.levels, { value: highest + 1, label: '', description: null }],
    });
  }

  function removeLevel(index: number) {
    setDraft({ ...draft, levels: draft.levels.filter((_, i) => i !== index) });
  }

  const duplicateValue = (() => {
    const seen = new Set<number>();
    for (const l of draft.levels) {
      if (seen.has(l.value)) return l.value;
      seen.add(l.value);
    }
    return null;
  })();

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});

    // Send only what is allowed to change for a frozen scale, so a locked
    // editor cannot accidentally trip the server's refusal.
    const payload = frozen
      ? {
          name: draft.name.trim(),
          description: draft.description?.trim() || null,
          archived: draft.archived ?? false,
        }
      : {
          name: draft.name.trim(),
          description: draft.description?.trim() || null,
          numeric: draft.numeric,
          archived: draft.archived ?? false,
          levels: draft.levels.map((l) => ({
            value: l.value,
            label: l.label.trim(),
            description: l.description?.trim() || null,
          })),
        };

    try {
      if (editing) {
        await api.patch(`/api/admin/scales/${initial.id}`, payload);
      } else {
        await api.post('/api/admin/scales', payload);
      }
      toast.success(editing ? 'Scale updated.' : 'Scale added.');
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
      title={editing ? `Edit ${initial.name}` : 'New rating scale'}
      description="Give every level a label and, ideally, a sentence describing what it looks like in practice."
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saving}
            loadingLabel="Saving…"
            disabled={duplicateValue !== null}
            onClick={save}
          >
            {editing ? 'Save changes' : 'Add scale'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        {frozen && (
          <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
            <Lock aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span className="leading-relaxed">
              This scale is in use by {countLabel(usage.questions, 'published review question')} and{' '}
              {countLabel(usage.surveyQuestions, 'survey question')}, so the levels are locked. You can
              still change the name, the description, and whether it is archived.
            </span>
          </div>
        )}

        <Input
          label="Name"
          required
          value={draft.name}
          error={fieldErrors.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Five-point performance scale"
        />

        <Textarea
          label="Description"
          required={false}
          rows={2}
          value={draft.description ?? ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          help="Where this scale is meant to be used."
        />

        <Checkbox
          label="Answers on this scale count toward calculated scores"
          description="Leave this off for a directional scale — the answers are still shown and still appear in distributions, but they are excluded from averages rather than being treated as numbers nobody intended."
          checked={draft.numeric}
          disabled={frozen}
          onChange={(e) => setDraft({ ...draft, numeric: e.target.checked })}
        />

        {editing && (
          <Checkbox
            label="Archived"
            description="Keeps the scale and everything answered on it, but stops offering it for new templates."
            checked={draft.archived ?? false}
            onChange={(e) => setDraft({ ...draft, archived: e.target.checked })}
          />
        )}

        <Field
          label="Levels"
          required
          error={
            duplicateValue !== null
              ? `Two levels both use the value ${duplicateValue}. Each level needs a different number.`
              : fieldErrors.levels
          }
          help={
            frozen
              ? undefined
              : 'The number is what scoring uses. Order them low to high; two to eleven levels.'
          }
        >
          <div className="space-y-2">
            {draft.levels.map((level, index) => (
              <div key={index} className="flex items-start gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={level.value}
                  disabled={frozen}
                  aria-label={`Value for level ${index + 1}`}
                  onChange={(e) => setLevel(index, { value: Number(e.target.value) })}
                  className="w-16 flex-shrink-0 rounded-md border-0 px-2 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <input
                    type="text"
                    value={level.label}
                    disabled={frozen}
                    placeholder="Label, e.g. Meets expectations"
                    aria-label={`Label for level ${index + 1}`}
                    onChange={(e) => setLevel(index, { label: e.target.value })}
                    className="block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                  <textarea
                    rows={2}
                    value={level.description ?? ''}
                    disabled={frozen}
                    placeholder="What this level looks like (optional, but it is what makes the number mean something)"
                    aria-label={`Description for level ${index + 1}`}
                    onChange={(e) => setLevel(index, { description: e.target.value })}
                    className="block w-full resize-y rounded-md border-0 px-3 py-2 text-xs leading-relaxed shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
                {!frozen && draft.levels.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeLevel(index)}
                    aria-label={`Remove level ${index + 1}`}
                    className="mt-1 rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!frozen && draft.levels.length < 11 && (
            <Button size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={addLevel}>
              Add level
            </Button>
          )}
        </Field>
      </div>
    </Dialog>
  );
}
