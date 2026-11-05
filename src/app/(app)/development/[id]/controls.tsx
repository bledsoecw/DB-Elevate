'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleDot, Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Card, CardBody, CardHeader, Badge } from '@/components/ui/primitives';
import { FormError, Input, RadioGroup, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import { ACTION_STATUS_LABELS, type ActionStatus } from '@/lib/enums';

/**
 * Plan actions and check-ins.
 *
 * Note the split between `canEdit` and `canRecordProgress`. On an improvement
 * plan the employee gets the second and not the first: they can mark an action
 * done, which is how they demonstrate they have met the plan, but they cannot
 * add, reword, remove or cancel one, because that would be editing what was
 * asked of them. The server enforces the same split.
 */

export interface PlanActionRow {
  id: string;
  title: string;
  description: string | null;
  itemType: string;
  status: string;
  dueDate: string | null;
  dueLabel: string | null;
  overdue: boolean;
  ownerName: string | null;
  competencyName: string | null;
}

export function ActionList({
  planId,
  actions,
  canEdit,
  canRecordProgress,
  isSubject,
}: {
  planId: string;
  actions: PlanActionRow[];
  canEdit: boolean;
  canRecordProgress: boolean;
  isSubject: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<PlanActionRow | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(action: PlanActionRow, status: ActionStatus) {
    setBusy(action.id);
    try {
      await api.patch(`/api/development/${planId}/actions/${action.id}`, { status });
      toast.success(
        status === 'COMPLETED' ? 'Marked complete.' : `Marked ${ACTION_STATUS_LABELS[status].toLowerCase()}.`,
      );
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(action: PlanActionRow) {
    setBusy(action.id);
    try {
      await api.del(`/api/development/${planId}/actions/${action.id}`);
      toast.success('Action removed.');
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Actions"
          description={
            canEdit
              ? 'The specific things that have to happen, each with an owner and a date.'
              : canRecordProgress && isSubject
                ? 'Mark each one as you get to it. You cannot change or remove an action — that is your manager’s to adjust.'
                : 'What this plan asks for.'
          }
          actions={
            canEdit ? (
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>
                Add action
              </Button>
            ) : undefined
          }
        />
        {actions.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-500">
              No actions yet.{' '}
              {canEdit
                ? 'Add the first one — a plan without actions is an intention.'
                : 'Nothing has been set out yet.'}
            </p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-slate-100">
            {actions.map((action) => {
              const complete = action.status === 'COMPLETED';
              const cancelled = action.status === 'CANCELLED';
              return (
                <li key={action.id} className="flex gap-3 px-5 py-3.5">
                  {canRecordProgress && !cancelled ? (
                    <button
                      type="button"
                      aria-label={complete ? `Reopen ${action.title}` : `Mark ${action.title} complete`}
                      aria-pressed={complete}
                      disabled={busy === action.id}
                      onClick={() => setStatus(action, complete ? 'OPEN' : 'COMPLETED')}
                      className={
                        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-1 disabled:opacity-50 ' +
                        (complete
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-300 bg-white hover:border-brand-500')
                      }
                    >
                      {complete && <Check aria-hidden className="h-3 w-3" />}
                    </button>
                  ) : (
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center text-slate-300"
                    >
                      {action.itemType === 'MILESTONE' ? (
                        <Flag className="h-3.5 w-3.5" />
                      ) : (
                        <CircleDot className="h-3.5 w-3.5" />
                      )}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        'text-sm ' +
                        (complete
                          ? 'text-slate-500 line-through'
                          : cancelled
                            ? 'text-slate-400 line-through'
                            : 'font-medium text-slate-900')
                      }
                    >
                      {action.title}
                    </p>
                    {action.description && (
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                        {action.description}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      {action.itemType === 'MILESTONE' && <Badge tone="info">Milestone</Badge>}
                      {action.ownerName && <span>{action.ownerName}</span>}
                      {action.competencyName && <span>{action.competencyName}</span>}
                      {action.dueLabel && (
                        <span className={action.overdue ? 'font-medium text-rose-700' : undefined}>
                          {action.dueLabel}
                        </span>
                      )}
                      {cancelled && <span className="text-slate-400">Cancelled</span>}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex flex-shrink-0 items-start gap-1">
                      <button
                        type="button"
                        aria-label={`Edit ${action.title}`}
                        onClick={() => setEditing(action)}
                        className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-600"
                      >
                        <Pencil aria-hidden className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${action.title}`}
                        disabled={busy === action.id}
                        onClick={() => remove(action)}
                        className="rounded p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:opacity-50"
                      >
                        <Trash2 aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editing && (
        <ActionDialog
          planId={planId}
          action={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ActionDialog({
  planId,
  action,
  onClose,
}: {
  planId: string;
  action: PlanActionRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState(action?.title ?? '');
  const [description, setDescription] = useState(action?.description ?? '');
  const [itemType, setItemType] = useState<'ACTION' | 'MILESTONE'>(
    (action?.itemType as 'ACTION' | 'MILESTONE') ?? 'ACTION',
  );
  const [dueDate, setDueDate] = useState(action?.dueDate ?? '');
  const [status, setStatus] = useState<ActionStatus>((action?.status as ActionStatus) ?? 'OPEN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.post(`/api/development/${planId}/actions`, {
        ...(action ? { id: action.id } : {}),
        title: title.trim(),
        description: description.trim() || null,
        itemType,
        dueDate: dueDate || null,
        status,
      });
      toast.success(action ? 'Action updated.' : 'Action added.');
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
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={action ? 'Edit action' : 'Add an action'}
      description="Something specific enough that both of you will agree later on whether it happened."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            loadingLabel="Saving…"
            disabled={title.trim().length === 0}
            onClick={save}
          >
            {action ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        <Input
          label="What has to happen"
          required
          value={title}
          error={fieldErrors.title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Run the Monday toolbox talk for a full month"
        />

        <Textarea
          label="Detail"
          required={false}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          help="What good looks like, or where to get help."
        />

        <RadioGroup<'ACTION' | 'MILESTONE'>
          name="item-type"
          legend="Kind"
          columns={2}
          value={itemType}
          onChange={setItemType}
          options={[
            { value: 'ACTION', label: 'Action', description: 'Something to do.' },
            { value: 'MILESTONE', label: 'Milestone', description: 'A point reached.' },
          ]}
        />

        <Input
          type="date"
          label="Due"
          required={false}
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />

        {action && (
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ActionStatus)}
            options={(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as ActionStatus[]).map(
              (s) => ({ value: s, label: ACTION_STATUS_LABELS[s] }),
            )}
            help="A cancelled action is excluded from the progress denominator rather than counted as incomplete."
          />
        )}
      </div>
    </Dialog>
  );
}

export function CheckInForm({ planId }: { planId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/development/${planId}/checkins`, { body: body.trim() });
      setBody('');
      toast.success('Check-in added.');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <FormError message={error} />
      <Textarea
        label="Add a check-in"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What was discussed, what changed, what is next."
        help="Visible to everyone who can see this plan. It cannot be edited or removed afterwards."
      />
      <Button
        variant="primary"
        loading={busy}
        loadingLabel="Adding…"
        disabled={body.trim().length === 0}
        onClick={submit}
      >
        Add check-in
      </Button>
    </div>
  );
}

export function PlanStatusControls({
  planId,
  status,
  outcome,
  planType,
}: {
  planId: string;
  status: string;
  outcome: string | null;
  planType: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [closing, setClosing] = useState<'COMPLETED' | 'CANCELLED' | null>(null);
  const [text, setText] = useState(outcome ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setBusy(true);
    try {
      await api.patch(`/api/development/${planId}`, { status: 'ACTIVE' });
      toast.success(
        planType === 'PERFORMANCE_IMPROVEMENT'
          ? 'Plan activated. The employee has been notified.'
          : 'Plan activated.',
      );
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!closing) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/development/${planId}`, { status: closing, outcome: text.trim() });
      toast.success('Plan closed.');
      setClosing(null);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      await api.patch(`/api/development/${planId}`, { status: 'ACTIVE' });
      toast.success('Plan reopened.');
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {status === 'DRAFT' && (
        <Button variant="primary" size="sm" loading={busy} onClick={activate}>
          Activate
        </Button>
      )}
      {status === 'ACTIVE' && (
        <>
          <Button size="sm" loading={busy} onClick={() => setClosing('COMPLETED')}>
            Close as met
          </Button>
          <Button size="sm" loading={busy} onClick={() => setClosing('CANCELLED')}>
            Cancel plan
          </Button>
        </>
      )}
      {(status === 'COMPLETED' || status === 'CANCELLED') && (
        <Button size="sm" loading={busy} onClick={reopen}>
          Reopen
        </Button>
      )}

      {closing && (
        <Dialog
          open
          onClose={() => setClosing(null)}
          size="md"
          title={closing === 'COMPLETED' ? 'Close this plan as met?' : 'Cancel this plan?'}
          description={
            closing === 'COMPLETED'
              ? 'Record what changed. This is the part someone reading the file in a year actually needs.'
              : 'Record why it is being stopped. Cancelling is not a failure state — circumstances change — but the reason matters.'
          }
          footer={
            <>
              <Button onClick={() => setClosing(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={closing === 'COMPLETED' ? 'primary' : 'danger'}
                loading={busy}
                loadingLabel="Closing…"
                disabled={text.trim().length === 0}
                onClick={close}
              >
                {closing === 'COMPLETED' ? 'Close as met' : 'Stop the plan'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <FormError message={error} />
            <Textarea
              label="Outcome"
              required
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                closing === 'COMPLETED'
                  ? 'What improved, and how you know.'
                  : 'Why the plan is stopping, and what happens instead.'
              }
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
