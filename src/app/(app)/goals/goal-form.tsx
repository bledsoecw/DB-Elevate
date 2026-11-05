'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { FormActions, FormError, Input, RadioGroup, Select, Textarea } from '@/components/ui/form';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import {
  GOAL_SCOPES,
  GOAL_SCOPE_LABELS,
  GOAL_VISIBILITIES,
  GOAL_VISIBILITY_LABELS,
  MEASUREMENT_TYPES,
  MEASUREMENT_TYPE_LABELS,
  type GoalScope,
  type GoalVisibility,
  type MeasurementType,
} from '@/lib/enums';

export interface GoalFormValues {
  title: string;
  description: string;
  outcome: string;
  category: string;
  scope: string;
  ownerEmployeeId: string;
  departmentId: string;
  parentGoalId: string;
  startDate: string;
  dueDate: string;
  visibility: string;
  measurementType: string;
  startValue: string;
  targetValue: string;
  currentValue: string;
  unit: string;
  higherIsBetter: boolean;
  reportedProgressPct: string;
  milestones: { title: string; dueDate: string }[];
}

const CATEGORIES = ['Safety', 'Quality', 'Schedule', 'Growth', 'Development', 'Client Service'];

export function GoalForm({
  mode,
  goalId,
  initial,
  options,
  canCreateCompany,
  canAssignToOthers,
}: {
  mode: 'create' | 'edit';
  goalId?: string;
  initial: GoalFormValues;
  options: {
    people: { id: string; firstName: string; lastName: string; preferredName: string | null }[];
    departments: { id: string; name: string }[];
    alignmentTargets: { id: string; title: string; scope: string; ownerName: string | null }[];
  };
  canCreateCompany: boolean;
  canAssignToOthers: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<GoalFormValues>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesWarning(dirty && !loading);

  function set<K extends keyof GoalFormValues>(key: K, value: GoalFormValues[K]) {
    setDirty(true);
    setV((prev) => ({ ...prev, [key]: value }));
  }

  const numeric = v.measurementType === 'NUMERIC';
  const milestoneBased = v.measurementType === 'MILESTONE';
  const percent = v.measurementType === 'PERCENT';

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        title: v.title,
        description: v.description || null,
        outcome: v.outcome || null,
        category: v.category || null,
        scope: v.scope,
        ownerEmployeeId: v.ownerEmployeeId || null,
        departmentId: v.departmentId || null,
        parentGoalId: v.parentGoalId || null,
        startDate: v.startDate || null,
        dueDate: v.dueDate || null,
        visibility: v.visibility,
        measurementType: v.measurementType,
        startValue: numeric && v.startValue !== '' ? Number(v.startValue) : null,
        targetValue: numeric && v.targetValue !== '' ? Number(v.targetValue) : null,
        currentValue: numeric && v.currentValue !== '' ? Number(v.currentValue) : null,
        unit: numeric ? v.unit || null : null,
        higherIsBetter: v.higherIsBetter,
        reportedProgressPct: percent && v.reportedProgressPct !== '' ? Number(v.reportedProgressPct) : null,
        milestones: milestoneBased
          ? v.milestones.filter((m) => m.title.trim()).map((m) => ({ title: m.title, dueDate: m.dueDate || null }))
          : undefined,
      };

      if (mode === 'create') {
        const r = await api.post<{ id: string }>('/api/goals', payload);
        setDirty(false);
        toast.success('Goal created');
        router.push(`/goals/${r.id}`);
      } else {
        await api.patch(`/api/goals/${goalId}`, payload);
        setDirty(false);
        toast.success('Goal saved');
        router.push(`/goals/${goalId}`);
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="max-w-3xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormError message={error} />

      <Card>
        <CardHeader title="What is the goal?" />
        <CardBody className="space-y-4">
          <Input
            label="Title"
            required
            value={v.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Cut average punch list to under 10 items per job"
            help="Short and specific. A title with a number in it is usually a good sign."
          />
          <Textarea
            label="Description"
            required={false}
            value={v.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            help="How it will be measured, and where the number comes from."
          />
          <Textarea
            label="Intended outcome"
            required={false}
            value={v.outcome}
            onChange={(e) => set('outcome', e.target.value)}
            rows={2}
            help="What is different once this is done. Useful at review time."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Category"
              required={false}
              value={v.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="None"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select
              label="Supports"
              required={false}
              value={v.parentGoalId}
              onChange={(e) => set('parentGoalId', e.target.value)}
              placeholder="Not linked to a wider goal"
              help="Links this to a team or company goal, so progress rolls up."
            >
              {options.alignmentTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.scope.toLowerCase()})
                </option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who owns it, and who can see it" />
        <CardBody className="space-y-4">
          <RadioGroup
            name="scope"
            legend="Goal type"
            value={v.scope as GoalScope}
            onChange={(value) => set('scope', value)}
            columns={2}
            options={GOAL_SCOPES.filter((s) => s !== 'COMPANY' || canCreateCompany).map((s) => ({
              value: s,
              label: GOAL_SCOPE_LABELS[s],
              description:
                s === 'INDIVIDUAL'
                  ? 'Owned by one person.'
                  : s === 'TEAM'
                    ? 'Owned by a lead on behalf of a department.'
                    : 'A company-wide objective other goals can align to.',
            }))}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Owner"
              value={v.ownerEmployeeId}
              onChange={(e) => set('ownerEmployeeId', e.target.value)}
              disabled={!canAssignToOthers}
              help={canAssignToOthers ? 'Yourself, or someone in your reporting line.' : 'You can set goals for yourself.'}
            >
              {options.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.preferredName || p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
            {v.scope !== 'INDIVIDUAL' && (
              <Select
                label="Department"
                required={false}
                value={v.departmentId}
                onChange={(e) => set('departmentId', e.target.value)}
                placeholder="None"
              >
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <RadioGroup
            name="visibility"
            legend="Who can see this goal"
            help="This is enforced everywhere, including reports and exports."
            value={v.visibility as GoalVisibility}
            onChange={(value) => set('visibility', value)}
            options={GOAL_VISIBILITIES.map((vis) => ({
              value: vis,
              label: GOAL_VISIBILITY_LABELS[vis].split('—')[0]?.trim() ?? vis,
              description: GOAL_VISIBILITY_LABELS[vis].split('—')[1]?.trim(),
            }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How progress is measured" />
        <CardBody className="space-y-4">
          <RadioGroup
            name="measurement"
            legend="Measurement"
            value={v.measurementType as MeasurementType}
            onChange={(value) => set('measurementType', value)}
            columns={2}
            options={MEASUREMENT_TYPES.map((m) => ({
              value: m,
              label: MEASUREMENT_TYPE_LABELS[m].split('(')[0]?.trim() ?? m,
              description: MEASUREMENT_TYPE_LABELS[m].match(/\(([^)]+)\)/)?.[1],
            }))}
          />

          {numeric && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <Input
                  label="Start"
                  type="number"
                  step="any"
                  required
                  value={v.startValue}
                  onChange={(e) => set('startValue', e.target.value)}
                />
                <Input
                  label="Current"
                  type="number"
                  step="any"
                  required={false}
                  value={v.currentValue}
                  onChange={(e) => set('currentValue', e.target.value)}
                />
                <Input
                  label="Target"
                  type="number"
                  step="any"
                  required
                  value={v.targetValue}
                  onChange={(e) => set('targetValue', e.target.value)}
                />
                <Input
                  label="Unit"
                  required={false}
                  value={v.unit}
                  onChange={(e) => set('unit', e.target.value)}
                  placeholder="%, days, $K"
                />
              </div>
              <RadioGroup
                name="direction"
                legend="Which direction is good?"
                value={v.higherIsBetter ? 'up' : 'down'}
                onChange={(value) => set('higherIsBetter', value === 'up')}
                columns={2}
                options={[
                  { value: 'up', label: 'Higher is better', description: 'e.g. revenue, first-time pass rate' },
                  { value: 'down', label: 'Lower is better', description: 'e.g. incidents, callbacks, days to close' },
                ]}
              />
              <Alert tone="neutral">
                Progress is calculated as (current − start) ÷ (target − start), clamped to 0–100%. It
                is never reported above 100% or below 0%.
              </Alert>
            </>
          )}

          {percent && (
            <>
              <Input
                label="Progress so far"
                type="number"
                min={0}
                max={100}
                required={false}
                value={v.reportedProgressPct}
                onChange={(e) => set('reportedProgressPct', e.target.value)}
                help="A percentage you keep up to date yourself."
                containerClassName="max-w-xs"
              />
              <Alert tone="warning">
                A percent-complete goal has nothing to calculate from, so the figure is only ever as
                good as the last time somebody updated it. If there is a number you could count
                instead, a numeric goal will be more honest.
              </Alert>
            </>
          )}

          {milestoneBased && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-800">Milestones</p>
              <p className="text-xs text-slate-600">
                Progress is calculated from how many of these are complete.
              </p>
              {v.milestones.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    aria-label={`Milestone ${i + 1}`}
                    value={m.title}
                    onChange={(e) => {
                      const next = [...v.milestones];
                      next[i] = { ...(next[i] as { title: string; dueDate: string }), title: e.target.value };
                      set('milestones', next);
                    }}
                    placeholder="What has to be done"
                    containerClassName="flex-1"
                  />
                  <Input
                    aria-label={`Milestone ${i + 1} due date`}
                    type="date"
                    value={m.dueDate}
                    onChange={(e) => {
                      const next = [...v.milestones];
                      next[i] = { ...(next[i] as { title: string; dueDate: string }), dueDate: e.target.value };
                      set('milestones', next);
                    }}
                    className="w-40"
                  />
                  <Button
                    variant="ghost"
                    icon={<Trash2 className="h-4 w-4" />}
                    aria-label={`Remove milestone ${i + 1}`}
                    onClick={() => set('milestones', v.milestones.filter((_, j) => j !== i))}
                  >
                    <span className="sr-only">Remove</span>
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => set('milestones', [...v.milestones, { title: '', dueDate: '' }])}
              >
                Add a milestone
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Start date"
              type="date"
              required={false}
              value={v.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
            <Input
              label="Due date"
              type="date"
              required={false}
              value={v.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
              help="A goal with no due date rarely gets finished."
            />
          </div>
        </CardBody>
      </Card>

      <FormActions>
        <Button type="submit" variant="primary" icon={<Save className="h-4 w-4" />} loading={loading}>
          {mode === 'create' ? 'Create goal' : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
