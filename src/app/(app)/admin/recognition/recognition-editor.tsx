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
 * Create and edit a recognition value.
 *
 * The colour is a label colour only — it never carries meaning on its own, and
 * the name is always shown beside it, so the list stays readable to someone who
 * cannot distinguish the hues.
 */

export interface RecognitionDraft {
  id?: string;
  name: string;
  description: string | null;
  colorHex: string;
  active: boolean;
  sortOrder: number;
}

const SWATCHES = ['#1d4e89', '#e07a1f', '#2f7d63', '#8c3b5e', '#4b5d78', '#a8631b'];

const EMPTY: RecognitionDraft = {
  name: '',
  description: null,
  colorHex: '#e07a1f',
  active: true,
  sortOrder: 0,
};

export function NewRecognitionButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        New value
      </Button>
      {open && <RecognitionDialog draft={EMPTY} usageCount={0} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RecognitionEditor({
  value,
  usageCount,
}: {
  value: RecognitionDraft;
  usageCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <RecognitionDialog draft={value} usageCount={usageCount} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function RecognitionDialog({
  draft: initial,
  usageCount,
  onClose,
}: {
  draft: RecognitionDraft;
  usageCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<RecognitionDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const editing = Boolean(initial.id);

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const payload = {
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      colorHex: draft.colorHex,
      active: draft.active,
      sortOrder: draft.sortOrder,
    };
    try {
      if (editing) {
        await api.patch(`/api/admin/recognition/${initial.id}`, payload);
      } else {
        await api.post('/api/admin/recognition', payload);
      }
      toast.success(editing ? 'Value updated.' : 'Value added.');
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

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      const result = await api.del<{ deleted: boolean }>(`/api/admin/recognition/${initial.id}`);
      toast.success(
        result.deleted
          ? 'Value removed.'
          : 'Value deactivated. Recognition already given against it is unchanged.',
      );
      onClose();
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={editing ? `Edit ${initial.name}` : 'New recognition value'}
      footer={
        <>
          {editing && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-700 hover:bg-rose-50"
              loading={removing}
              loadingLabel="Removing…"
              onClick={remove}
            >
              {usageCount > 0 ? 'Deactivate' : 'Remove'}
            </Button>
          )}
          <Button onClick={onClose} disabled={saving || removing}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Saving…" onClick={save}>
            {editing ? 'Save changes' : 'Add value'}
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
          placeholder="e.g. Safe work"
        />

        <Textarea
          label="Description"
          required={false}
          rows={2}
          value={draft.description ?? ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          help="Shown beside the value so people pick the right one."
        />

        <Field label="Label colour" help="Decoration only — the name is always shown with it.">
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`Use colour ${hex}`}
                aria-pressed={draft.colorHex.toLowerCase() === hex.toLowerCase()}
                onClick={() => setDraft({ ...draft, colorHex: hex })}
                style={{ backgroundColor: hex }}
                className={
                  'h-7 w-7 rounded-md ring-offset-2 transition focus:outline-none focus:ring-2 focus:ring-brand-600 ' +
                  (draft.colorHex.toLowerCase() === hex.toLowerCase()
                    ? 'ring-2 ring-slate-900'
                    : 'ring-1 ring-slate-300')
                }
              />
            ))}
            <input
              type="text"
              value={draft.colorHex}
              aria-label="Colour hex value"
              onChange={(e) => setDraft({ ...draft, colorHex: e.target.value })}
              className="w-28 rounded-md border-0 px-2 py-1.5 font-mono text-xs shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
            />
          </div>
          {fieldErrors.colorHex && (
            <p className="mt-1 text-xs font-medium text-rose-700">{fieldErrors.colorHex}</p>
          )}
        </Field>

        <Input
          type="number"
          label="Order"
          required={false}
          min={0}
          max={999}
          value={draft.sortOrder}
          onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
          help="Lower numbers appear first."
        />

        {editing && (
          <Checkbox
            label="Offered when giving recognition"
            description={
              usageCount > 0
                ? `Given ${countLabel(usageCount, 'time')}. Unchecking hides it from the picker without touching past recognition.`
                : 'Unchecking hides it from the picker.'
            }
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
        )}
      </div>
    </Dialog>
  );
}
