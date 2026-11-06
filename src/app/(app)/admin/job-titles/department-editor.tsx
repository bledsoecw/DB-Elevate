'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, FormError, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import { countLabel } from '@/lib/utils';

/**
 * Create and edit a department.
 *
 * A department is never deleted here. People, job titles and goals point at
 * it, and a record that loses its department loses the grouping every report
 * and feedback-visibility rule is built on. Archiving takes it out of the
 * pickers and leaves those records intact.
 */

export interface DepartmentDraft {
  id?: string;
  name: string;
  code: string | null;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
}

/** Departments offered as a parent. */
export interface ParentOption {
  id: string;
  name: string;
  active: boolean;
}

const EMPTY: DepartmentDraft = {
  name: '',
  code: null,
  parentId: null,
  sortOrder: 0,
  active: true,
};

export function NewDepartmentButton({ parents }: { parents: ParentOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        New department
      </Button>
      {open && (
        <DepartmentDialog
          draft={EMPTY}
          parents={parents}
          peopleCount={0}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function DepartmentEditor({
  department,
  parents,
  peopleCount,
}: {
  department: DepartmentDraft;
  parents: ParentOption[];
  peopleCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <DepartmentDialog
          draft={department}
          parents={parents}
          peopleCount={peopleCount}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DepartmentDialog({
  draft: initial,
  parents,
  peopleCount,
  onClose,
}: {
  draft: DepartmentDraft;
  parents: ParentOption[];
  peopleCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<DepartmentDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const editing = Boolean(initial.id);

  // A department cannot be its own parent. Deeper cycles are refused by the
  // server, which is the only place that can see the whole tree.
  const parentChoices = parents.filter((p) => p.id !== initial.id);

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const payload = {
      name: draft.name.trim(),
      code: draft.code?.trim() || null,
      parentId: draft.parentId || null,
      sortOrder: draft.sortOrder,
      active: draft.active,
    };
    try {
      if (editing) {
        await api.patch(`/api/admin/departments/${initial.id}`, payload);
      } else {
        await api.post('/api/admin/departments', payload);
      }
      toast.success(editing ? 'Department updated.' : 'Department added.');
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
      size="md"
      title={editing ? `Edit ${initial.name}` : 'New department'}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Saving…" onClick={save}>
            {editing ? 'Save changes' : 'Add department'}
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
          placeholder="e.g. Field Operations"
        />

        <Input
          label="Code"
          required={false}
          value={draft.code ?? ''}
          error={fieldErrors.code}
          onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          help="Optional. Your own short code, if you use one in payroll or accounting."
          placeholder="e.g. FIELD"
        />

        <Select
          label="Reports to"
          required={false}
          value={draft.parentId ?? ''}
          error={fieldErrors.parentId}
          onChange={(e) => setDraft({ ...draft, parentId: e.target.value || null })}
          placeholder="Top level"
          help="Optional. Use this to nest a crew or trade under a larger department."
        >
          {parentChoices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.active ? '' : ' (archived)'}
            </option>
          ))}
        </Select>

        <Input
          type="number"
          label="Order"
          required={false}
          min={0}
          max={999}
          value={draft.sortOrder}
          error={fieldErrors.sortOrder}
          onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
          help="Lower numbers appear first in the pickers."
        />

        {editing && (
          <Checkbox
            label="Offered in the pickers"
            description={
              peopleCount > 0
                ? `${countLabel(peopleCount, 'active person', 'active people')} in this department. Archiving is refused until they are moved.`
                : 'Unchecking archives it. People and job titles already in it keep pointing at it.'
            }
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
        )}
      </div>
    </Dialog>
  );
}
