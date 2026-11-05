'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, TrendingUp } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Avatar, Card, CardBody, CardHeader, ProseText } from '@/components/ui/primitives';
import { Checkbox, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { formatRelativeTime } from '@/lib/utils';
import { GOAL_HEALTHS, GOAL_HEALTH_LABELS, GOAL_STATUSES, GOAL_STATUS_LABELS } from '@/lib/enums';

/**
 * Posting a progress update.
 *
 * The form only asks for what the goal's measurement type actually uses: a
 * numeric goal asks for the current value and calculates the percentage; a
 * percent goal asks for the percentage directly and says it is being reported
 * rather than calculated.
 */
export function GoalProgressPanel({
  goalId,
  measurementType,
  unit,
  currentValue,
  reportedProgressPct,
  status,
  health,
  milestones,
}: {
  goalId: string;
  measurementType: string;
  unit: string | null;
  currentValue: number | null;
  reportedProgressPct: number | null;
  status: string;
  health: string;
  milestones: { id: string; title: string; done: boolean }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [value, setValue] = useState(currentValue !== null ? String(currentValue) : '');
  const [pct, setPct] = useState(reportedProgressPct !== null ? String(Math.round(reportedProgressPct)) : '');
  const [nextStatus, setNextStatus] = useState(status);
  const [nextHealth, setNextHealth] = useState(health);
  const [done, setDone] = useState<Record<string, boolean>>(
    Object.fromEntries(milestones.map((m) => [m.id, m.done])),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const completed = milestones.filter((m) => !m.done && done[m.id]).map((m) => m.id);
      const reopened = milestones.filter((m) => m.done && !done[m.id]).map((m) => m.id);
      await api.post(`/api/goals/${goalId}/updates`, {
        body: body.trim() || null,
        currentValue: measurementType === 'NUMERIC' && value !== '' ? Number(value) : undefined,
        reportedProgressPct: measurementType === 'PERCENT' && pct !== '' ? Number(pct) : undefined,
        status: nextStatus !== status ? nextStatus : undefined,
        health: nextHealth !== health ? nextHealth : undefined,
        completedMilestoneIds: completed.length ? completed : undefined,
        reopenedMilestoneIds: reopened.length ? reopened : undefined,
      });
      setBody('');
      setOpen(false);
      toast.success('Progress recorded');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Card>
        <CardBody>
          <Button
            variant="primary"
            icon={<TrendingUp className="h-4 w-4" />}
            onClick={() => setOpen(true)}
          >
            Record progress
          </Button>
          <p className="mt-2 text-xs text-slate-500">
            Each update is added to the history. Nothing is overwritten.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Record progress" description="Added to the history with today's date." />
      <CardBody className="space-y-4">
        <FormError message={error} />

        {measurementType === 'NUMERIC' && (
          <Input
            label={`Current value${unit ? ` (${unit})` : ''}`}
            type="number"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            help="The percentage is calculated from this against the start and target values."
          />
        )}

        {measurementType === 'PERCENT' && (
          <Input
            label="Percent complete"
            type="number"
            min={0}
            max={100}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            help="Reported by you. This goal has no measurement to calculate from, so this is the only figure."
          />
        )}

        {measurementType === 'MILESTONE' && milestones.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-800">Milestones</legend>
            <p className="text-xs text-slate-600">
              The percentage is calculated from which of these are complete.
            </p>
            {milestones.map((m) => (
              <Checkbox
                key={m.id}
                label={m.title}
                checked={done[m.id] ?? false}
                onChange={(e) => setDone((d) => ({ ...d, [m.id]: e.target.checked }))}
              />
            ))}
          </fieldset>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Status" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
            {GOAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {GOAL_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            label="How is it going?"
            value={nextHealth}
            onChange={(e) => setNextHealth(e.target.value)}
            help="Flagging a goal off track or blocked notifies the owner's manager."
          >
            {GOAL_HEALTHS.map((h) => (
              <option key={h} value={h}>
                {GOAL_HEALTH_LABELS[h]}
              </option>
            ))}
          </Select>
        </div>

        <Textarea
          label="What has happened?"
          required={false}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="What moved, what is in the way, what happens next."
        />

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            Record it
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function GoalComments({
  goalId,
  canComment,
  comments,
}: {
  goalId: string;
  canComment: boolean;
  comments: {
    id: string;
    body: string;
    createdAt: string;
    authorName: string;
    authorFirstName: string;
    authorLastName: string;
  }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/goals/${goalId}/comments`, { body });
      setBody('');
      toast.success('Comment posted');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <MessageSquare aria-hidden className="h-4 w-4 text-slate-400" />
            Discussion ({comments.length})
          </span>
        }
        description="Visible to everyone who can see this goal."
      />
      {comments.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3 px-5 py-3.5">
              <Avatar firstName={c.authorFirstName} lastName={c.authorLastName} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-slate-900">{c.authorName}</span>
                  <span className="text-xs text-slate-500">{formatRelativeTime(c.createdAt)}</span>
                </p>
                <ProseText className="mt-1">{c.body}</ProseText>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <CardBody className="border-t border-slate-200">
          <FormError message={error} />
          <Textarea
            label="Add a comment"
            required={false}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            containerClassName="mb-3"
          />
          <Button variant="primary" size="sm" loading={loading} disabled={!body.trim()} onClick={() => void post()}>
            Post
          </Button>
        </CardBody>
      )}
    </Card>
  );
}
