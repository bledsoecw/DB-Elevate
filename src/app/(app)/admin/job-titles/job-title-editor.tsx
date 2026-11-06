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
 * Create and edit a job title.
 *
 * The title is not a label. It carries the competency library a review is
 * built from and it owns the salary band a pay recommendation is measured
 * against, so an employee with no title gets a review with no competencies
 * and a compensation row with no band. That is why this is deactivated and
 * never deleted: deleting would take the band with it and strip the title
 * from the snapshots past reviews and past pay decisions were made against.
 */

export interface JobTitleDraft {
  id?: string;
  name: string;
  level: string | null;
  departmentId: string | null;
  competencyLibraryId: string | null;
  active: boolean;
}

export interface NamedOption {
  id: string;
  name: string;
  active: boolean;
}

const EMPTY: JobTitleDraft = {
  name: '',
  level: null,
  departmentId: null,
  competencyLibraryId: null,
  active: true,
};

export function NewJobTitleButton({
  departments,
  libraries,
}: {
  departments: NamedOption[];
  libraries: NamedOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        New job title
      </Button>
      {open && (
        <JobTitleDialog
          draft={EMPTY}
          departments={departments}
          libraries={libraries}
          holderCount={0}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function JobTitleEditor({
  jobTitle,
  departments,
  libraries,
  holderCount,
}: {
  jobTitle: JobTitleDraft;
  departments: NamedOption[];
  libraries: NamedOption[];
  holderCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Edit
      </Button>
      {open && (
        <JobTitleDialog
          draft={jobTitle}
          departments={departments}
          libraries={libraries}
          holderCount={holderCount}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function JobTitleDialog({
  draft: initial,
  departments,
  libraries,
  holderCount,
  onClose,
}: {
  draft: JobTitleDraft;
  departments: NamedOption[];
  libraries: NamedOption[];
  holderCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<JobTitleDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const editing = Boolean(initial.id);

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const payload = {
      name: draft.name.trim(),
      level: draft.level?.trim() || null,
      departmentId: draft.departmentId || null,
      competencyLibraryId: draft.competencyLibraryId || null,
      active: draft.active,
    };
    try {
      if (editing) {
        await api.patch(`/api/admin/job-titles/${initial.id}`, payload);
      } else {
        await api.post('/api/admin/job-titles', payload);
      }
      toast.success(editing ? 'Job title updated.' : 'Job title added.');
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
      title={editing ? `Edit ${initial.name}` : 'New job title'}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} loadingLabel="Saving…" onClick={save}>
            {editing ? 'Save changes' : 'Add job title'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        <Input
          label="Title"
          required
          value={draft.name}
          error={fieldErrors.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Lead Carpenter"
        />

        <Input
          label="Level"
          required={false}
          value={draft.level ?? ''}
          error={fieldErrors.level}
          onChange={(e) => setDraft({ ...draft, level: e.target.value })}
          help="Optional. Shown beside the title, and useful when two departments use the same word."
          placeholder="e.g. Apprentice, Journeyman, Lead, Superintendent"
        />

        <Select
          label="Department"
          required={false}
          value={draft.departmentId ?? ''}
          error={fieldErrors.departmentId}
          onChange={(e) => setDraft({ ...draft, departmentId: e.target.value || null })}
          placeholder="Not set"
          help={
            departments.length === 0
              ? 'No departments exist yet. Add one below and come back to this.'
              : 'Where this title usually sits. An employee record can still say otherwise.'
          }
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.active ? '' : ' (archived)'}
            </option>
          ))}
        </Select>

        <Select
          label="Competency library"
          required={false}
          value={draft.competencyLibraryId ?? ''}
          error={fieldErrors.competencyLibraryId}
          onChange={(e) => setDraft({ ...draft, competencyLibraryId: e.target.value || null })}
          placeholder="None"
          help={
            libraries.length === 0
              ? 'No libraries exist yet. Build one under Competencies and libraries, then attach it here.'
              : 'The competencies a review of this title assesses. Without one, a competency question has nothing to ask about.'
          }
        >
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.active ? '' : ' (inactive)'}
            </option>
          ))}
        </Select>

        {editing && (
          <Checkbox
            label="Offered in the pickers"
            description={
              holderCount > 0
                ? `${countLabel(holderCount, 'active person holds', 'active people hold')} this title. Archiving is refused until they are moved.`
                : 'Unchecking archives it. Past reviews and pay decisions are unchanged.'
            }
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
        )}
      </div>
    </Dialog>
  );
}
