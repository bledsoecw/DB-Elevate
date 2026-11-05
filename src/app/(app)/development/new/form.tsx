'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FormActions,
  FormError,
  Input,
  RadioGroup,
  Select,
  Textarea,
} from '@/components/ui/form';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import type { PlanType } from '@/lib/enums';

export interface PersonOption {
  id: string;
  name: string;
  jobTitle: string | null;
  canStartImprovement: boolean;
}

interface DraftAction {
  title: string;
  description: string;
  itemType: 'ACTION' | 'MILESTONE';
  competencyId: string;
  dueDate: string;
}

const emptyAction = (): DraftAction => ({
  title: '',
  description: '',
  itemType: 'ACTION',
  competencyId: '',
  dueDate: '',
});

export function NewPlanForm({
  people,
  competencies,
  defaultEmployeeId,
  defaultType,
}: {
  people: PersonOption[];
  competencies: { id: string; name: string; category: string | null }[];
  defaultEmployeeId: string;
  defaultType: PlanType;
}) {
  const router = useRouter();
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [planType, setPlanType] = useState<PlanType>(defaultType);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [actions, setActions] = useState<DraftAction[]>([emptyAction()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty = title.trim().length > 0 || actions.some((a) => a.title.trim().length > 0);
  useUnsavedChangesWarning(dirty && !busy);

  const subject = people.find((p) => p.id === employeeId) ?? null;
  const improvementAllowed = subject?.canStartImprovement ?? false;
  const isPip = planType === 'PERFORMANCE_IMPROVEMENT';

  function setAction(index: number, patch: Partial<DraftAction>) {
    setActions((list) => list.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const filled = actions.filter((a) => a.title.trim().length > 0);
    try {
      const result = await api.post<{ id: string }>('/api/development', {
        employeeId,
        title: title.trim(),
        description: description.trim() || null,
        planType,
        startDate: startDate || null,
        targetDate: targetDate || null,
        actions: filled.map((a) => ({
          title: a.title.trim(),
          description: a.description.trim() || null,
          itemType: a.itemType,
          competencyId: a.competencyId || null,
          dueDate: a.dueDate || null,
        })),
      });
      toast.success('Plan created as a draft.');
      router.push(`/development/${result.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length) {
        const map: Record<string, string> = {};
        for (const f of e.fieldErrors) map[f.path] = f.message;
        setFieldErrors(map);
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const grouped = competencies.reduce<Map<string, typeof competencies>>((map, c) => {
    const key = c.category ?? 'Other';
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
    return map;
  }, new Map());

  return (
    <div className="space-y-5">
      <FormError message={error} />

      <Select
        label="Who the plan is for"
        required
        value={employeeId}
        error={fieldErrors.employeeId}
        onChange={(e) => {
          setEmployeeId(e.target.value);
          const next = people.find((p) => p.id === e.target.value);
          // Keep the type honest: if this person cannot be given an improvement
          // plan by this actor, fall back rather than letting the server refuse.
          if (!next?.canStartImprovement && planType === 'PERFORMANCE_IMPROVEMENT') {
            setPlanType('DEVELOPMENT');
          }
        }}
        options={people.map((p) => ({
          value: p.id,
          label: p.jobTitle ? `${p.name} — ${p.jobTitle}` : p.name,
        }))}
      />

      <RadioGroup<PlanType>
        name="plan-type"
        legend="Kind of plan"
        required
        value={planType}
        onChange={setPlanType}
        error={fieldErrors.planType}
        options={[
          {
            value: 'DEVELOPMENT',
            label: 'Development plan',
            description:
              'Building skill. Visible to the employee, their management chain and HR. The employee can work it themselves.',
          },
          {
            value: 'PERFORMANCE_IMPROVEMENT',
            label: 'Performance improvement plan',
            description: improvementAllowed
              ? 'A restricted personnel record. Visible to the employee, their direct manager and HR only — not the wider chain, not leadership. The employee can record progress but cannot change its terms. This restriction cannot be relaxed later.'
              : 'Only the person’s direct manager or an HR administrator can start one of these.',
            disabled: !improvementAllowed,
          },
        ]}
      />

      <Input
        label="Title"
        required
        value={title}
        error={fieldErrors.title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={
          isPip ? 'e.g. Jobsite safety compliance — 60 day plan' : 'e.g. Step up to crew lead'
        }
      />

      <Textarea
        label={isPip ? 'What has to change, and by when' : 'What this is for'}
        required={false}
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        help={
          isPip
            ? 'Be specific about the standard being asked for. A plan the employee cannot tell they have met is not a fair plan.'
            : 'Where they are heading, in a sentence or two.'
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          type="date"
          label="Start"
          required={false}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          type="date"
          label="Target"
          required={false}
          value={targetDate}
          error={fieldErrors.targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          help={isPip ? 'The date the plan is assessed against.' : undefined}
        />
      </div>

      <Field
        label="Actions"
        help="You can add more later. Leave a row blank and it is ignored."
      >
        <div className="space-y-3">
          {actions.map((action, index) => (
            <div key={index} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    type="text"
                    value={action.title}
                    aria-label={`Action ${index + 1} title`}
                    placeholder="What has to happen"
                    onChange={(e) => setAction(index, { title: e.target.value })}
                    className="block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select
                      value={action.itemType}
                      aria-label={`Action ${index + 1} kind`}
                      onChange={(e) =>
                        setAction(index, { itemType: e.target.value as 'ACTION' | 'MILESTONE' })
                      }
                      className="rounded-md border-0 px-2 py-1.5 text-xs shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                    >
                      <option value="ACTION">Action</option>
                      <option value="MILESTONE">Milestone</option>
                    </select>
                    <select
                      value={action.competencyId}
                      aria-label={`Action ${index + 1} competency`}
                      onChange={(e) => setAction(index, { competencyId: e.target.value })}
                      className="rounded-md border-0 px-2 py-1.5 text-xs shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                    >
                      <option value="">No competency</option>
                      {[...grouped.entries()].map(([category, items]) => (
                        <optgroup key={category} label={category}>
                          {items.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={action.dueDate}
                      aria-label={`Action ${index + 1} due date`}
                      onChange={(e) => setAction(index, { dueDate: e.target.value })}
                      className="rounded-md border-0 px-2 py-1.5 text-xs shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
                    />
                  </div>
                </div>
                {actions.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove action ${index + 1}`}
                    onClick={() => setActions((list) => list.filter((_, i) => i !== index))}
                    className="mt-1 rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {actions.length < 20 && (
          <Button
            size="sm"
            className="mt-2"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setActions((list) => [...list, emptyAction()])}
          >
            Add another
          </Button>
        )}
      </Field>

      <FormActions>
        <Button
          variant="primary"
          loading={busy}
          loadingLabel="Creating…"
          disabled={title.trim().length < 3}
          onClick={submit}
        >
          Create as draft
        </Button>
        <span className="text-xs text-slate-500">
          Created as a draft. Nobody is notified until you activate it.
        </span>
      </FormActions>
    </div>
  );
}
