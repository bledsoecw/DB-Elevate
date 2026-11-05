'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRightCircle,
  Check,
  CheckSquare,
  Lock,
  Plus,
  Square,
  Trash2,
  Users,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Alert,
  Avatar,
  Badge,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  ProseText,
} from '@/components/ui/primitives';
import { FormError, Input, RadioGroup, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { cn, formatDate, formatRelativeTime, isOverdue, relativeDueLabel } from '@/lib/utils';
import { ACTION_STATUSES, ACTION_STATUS_LABELS, type ActionStatus } from '@/lib/enums';

/** Shared agenda, built collaboratively before the meeting. */
export function AgendaPanel({
  meetingId,
  canEdit,
  items,
  goals,
}: {
  meetingId: string;
  canEdit: boolean;
  items: {
    id: string;
    title: string;
    notes: string | null;
    status: string;
    carriedFrom: boolean;
    createdByName: string;
    goalId: string | null;
    goalTitle: string | null;
  }[];
  goals: { id: string; title: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [goalId, setGoalId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/meetings/${meetingId}/agenda`, {
        title,
        notes: notes.trim() || null,
        goalId: goalId || null,
      });
      setTitle('');
      setNotes('');
      setGoalId('');
      setAdding(false);
      toast.success('Agenda item added');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(itemId: string, status: string) {
    try {
      await api.patch(`/api/meetings/agenda/${itemId}`, { status });
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(itemId: string) {
    try {
      await api.del(`/api/meetings/agenda/${itemId}`);
      toast.success('Agenda item removed');
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Agenda"
        description="Either of you can add to this. Anything still open when the meeting is completed carries forward to the next one."
        actions={
          canEdit && !adding ? (
            <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
              Add item
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 && !adding ? (
        <EmptyState
          title="Nothing on the agenda yet"
          description="Add what you want to cover. The other person can see it before the meeting and add their own."
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add the first item
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-5 py-3">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setStatus(item.id, item.status === 'DISCUSSED' ? 'OPEN' : 'DISCUSSED')}
                  className="mt-0.5 flex-shrink-0 rounded text-slate-400 hover:text-brand-600"
                  aria-label={item.status === 'DISCUSSED' ? 'Mark as not discussed' : 'Mark as discussed'}
                >
                  {item.status === 'DISCUSSED' ? (
                    <CheckSquare className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <span className="mt-0.5 flex-shrink-0">
                  {item.status === 'DISCUSSED' ? (
                    <CheckSquare aria-hidden className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Square aria-hidden className="h-4 w-4 text-slate-300" />
                  )}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium',
                    item.status === 'DISCUSSED' ? 'text-slate-500' : 'text-slate-900',
                  )}
                >
                  {item.title}
                </p>
                {item.notes && <ProseText className="mt-1 text-xs">{item.notes}</ProseText>}
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span>added by {item.createdByName}</span>
                  {item.carriedFrom && (
                    <Badge tone="info">
                      <ArrowRightCircle aria-hidden className="h-3 w-3" />
                      Carried forward
                    </Badge>
                  )}
                  {item.status === 'CARRIED_FORWARD' && <Badge tone="neutral">Moved to the next meeting</Badge>}
                  {item.goalTitle && <Badge tone="brand">{item.goalTitle}</Badge>}
                </p>
              </div>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="mt-0.5 flex-shrink-0 rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Remove "${item.title}"`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <CardBody className="border-t border-slate-200">
          <FormError message={error} />
          <div className="space-y-3">
            <Input
              label="What do you want to cover?"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <Textarea
              label="Anything to add beforehand?"
              required={false}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
            {goals.length > 0 && (
              <Select
                label="Related goal"
                required={false}
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                placeholder="None"
              >
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </Select>
            )}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={loading} disabled={!title.trim()} onClick={() => void add()}>
                Add
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)} disabled={loading}>
                Cancel
              </Button>
            </div>
          </div>
        </CardBody>
      )}
    </Card>
  );
}

/** Notes, shared or private. The distinction is never ambiguous on screen. */
export function NotesPanel({
  meetingId,
  canEdit,
  currentEmployeeId,
  notes,
}: {
  meetingId: string;
  canEdit: boolean;
  currentEmployeeId: string | null;
  notes: {
    id: string;
    body: string;
    visibility: string;
    authorEmployeeId: string;
    authorName: string;
    authorFirstName: string;
    authorLastName: string;
    updatedAt: string;
  }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'SHARED' | 'PRIVATE'>('SHARED');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/meetings/${meetingId}/notes`, { body, visibility });
      setBody('');
      setWriting(false);
      toast.success(visibility === 'PRIVATE' ? 'Private note saved' : 'Note saved', visibility === 'PRIVATE' ? 'Only you can see it.' : undefined);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function remove(noteId: string) {
    try {
      await api.del(`/api/meetings/notes/${noteId}`);
      toast.success('Note deleted');
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Notes"
        description="Shared notes are visible to both of you. Private notes are visible only to whoever wrote them."
        actions={
          canEdit && !writing ? (
            <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setWriting(true)}>
              Add a note
            </Button>
          ) : undefined
        }
      />

      {notes.length === 0 && !writing ? (
        <EmptyState title="No notes yet" description="What was agreed, and what each of you is doing next." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {notes.map((n) => (
            <li
              key={n.id}
              className={cn('px-5 py-3.5', n.visibility === 'PRIVATE' && 'bg-amber-50/40')}
            >
              <div className="flex items-start gap-3">
                <Avatar firstName={n.authorFirstName} lastName={n.authorLastName} size="xs" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-900">{n.authorName}</span>
                    {n.visibility === 'PRIVATE' ? (
                      <Badge tone="warning">
                        <Lock aria-hidden className="h-3 w-3" />
                        Private to you
                      </Badge>
                    ) : (
                      <Badge tone="neutral">
                        <Users aria-hidden className="h-3 w-3" />
                        Shared
                      </Badge>
                    )}
                    <span className="text-xs text-slate-500">{formatRelativeTime(n.updatedAt)}</span>
                  </p>
                  <ProseText className="mt-1.5">{n.body}</ProseText>
                </div>
                {n.authorEmployeeId === currentEmployeeId && (
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    className="flex-shrink-0 rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Delete this note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {writing && (
        <CardBody className="border-t border-slate-200">
          <FormError message={error} />
          <div className="space-y-3">
            <Textarea
              label="Note"
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              autoFocus
            />
            <RadioGroup
              name="note-visibility"
              legend="Who can see this note?"
              value={visibility}
              onChange={(v) => setVisibility(v)}
              columns={2}
              options={[
                {
                  value: 'SHARED',
                  label: 'Shared',
                  description: 'Both of you can read it. The normal choice for what was agreed.',
                },
                {
                  value: 'PRIVATE',
                  label: 'Private to me',
                  description: 'Only you. Not visible to the other person, HR, or a system administrator.',
                },
              ]}
            />
            {visibility === 'PRIVATE' && (
              <Alert tone="warning" icon={<Lock className="h-4 w-4" />}>
                This note is yours alone. It is excluded from exports and from anything the other
                person sees.
              </Alert>
            )}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={loading} disabled={!body.trim()} onClick={() => void save()}>
                Save note
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setWriting(false)} disabled={loading}>
                Cancel
              </Button>
            </div>
          </div>
        </CardBody>
      )}
    </Card>
  );
}

/** Action items, which outlive the meeting they came from. */
export function ActionsPanel({
  meetingId,
  canEdit,
  people,
  defaultOwnerId,
  items,
}: {
  meetingId: string;
  canEdit: boolean;
  people: { id: string; firstName: string; lastName: string; preferredName: string | null }[];
  defaultOwnerId: string;
  items: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    dueDate: string | null;
    ownerName: string;
    ownerId: string;
    assignedByName: string | null;
    goalTitle: string | null;
  }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/actions', {
        title,
        ownerEmployeeId: ownerId,
        dueDate: dueDate || null,
        meetingId,
      });
      setTitle('');
      setDueDate('');
      setAdding(false);
      toast.success('Action item created');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(itemId: string, status: string) {
    try {
      await api.patch(`/api/actions/${itemId}`, { status });
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Action items"
        description="Who is doing what, by when."
        level={3}
        actions={
          canEdit && !adding ? (
            <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
              Add
            </Button>
          ) : undefined
        }
      />
      {items.length === 0 && !adding ? (
        <EmptyState
          title="No actions yet"
          description="A one-to-one that produces no actions usually produces no change."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 px-5 py-3">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setStatus(a.id, a.status === 'COMPLETED' ? 'OPEN' : 'COMPLETED')}
                  className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-emerald-600"
                  aria-label={a.status === 'COMPLETED' ? 'Reopen' : 'Mark complete'}
                >
                  {a.status === 'COMPLETED' ? (
                    <CheckSquare className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <Check aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-300" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm',
                    a.status === 'COMPLETED' ? 'text-slate-500 line-through' : 'text-slate-900',
                  )}
                >
                  {a.title}
                </p>
                <p
                  className={
                    a.dueDate && isOverdue(a.dueDate) && a.status !== 'COMPLETED'
                      ? 'mt-0.5 text-xs font-medium text-rose-700'
                      : 'mt-0.5 text-xs text-slate-500'
                  }
                >
                  {a.ownerName}
                  {a.dueDate ? ` · ${relativeDueLabel(a.dueDate)}` : ' · no due date'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <CardBody className="border-t border-slate-200 space-y-3">
          <FormError message={error} />
          <Input label="What needs doing?" required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Select label="Who owns it?" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.preferredName || p.firstName} {p.lastName}
              </option>
            ))}
          </Select>
          <Input
            label="Due"
            type="date"
            required={false}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={loading} disabled={!title.trim()} onClick={() => void add()}>
              Add
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)} disabled={loading}>
              Cancel
            </Button>
          </div>
        </CardBody>
      )}
      {items.length > 0 && (
        <CardFooter>
          <p className="text-xs text-slate-600">
            {items.filter((a) => a.status === 'COMPLETED').length} of {items.length} complete. Open
            items stay on the owner&rsquo;s task list after this meeting ends.
          </p>
        </CardFooter>
      )}
    </Card>
  );
}

/** Completing a meeting carries unfinished agenda items forward. */
export function CompleteMeetingButton({
  meetingId,
  openAgendaCount,
  hasSeries,
}: {
  meetingId: string;
  openAgendaCount: number;
  hasSeries: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button variant="primary" icon={<Check className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Mark complete
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Mark this meeting complete?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={async () => {
                setLoading(true);
                setError(null);
                try {
                  const r = await api.post<{ carriedForward: number; nextMeetingId: string | null }>(
                    `/api/meetings/${meetingId}/complete`,
                    {},
                  );
                  setOpen(false);
                  toast.success(
                    'Meeting completed',
                    r.carriedForward > 0
                      ? `${r.carriedForward} agenda ${r.carriedForward === 1 ? 'item was' : 'items were'} carried forward.`
                      : undefined,
                  );
                  if (r.nextMeetingId) router.push(`/meetings/${r.nextMeetingId}`);
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              Complete
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <ul className="space-y-1.5 text-sm text-slate-700">
          {hasSeries ? (
            <li>The next meeting in the series will be scheduled automatically.</li>
          ) : (
            <li>This is a one-off meeting, so nothing further will be scheduled.</li>
          )}
          {openAgendaCount > 0 && hasSeries && (
            <li>
              {openAgendaCount} agenda {openAgendaCount === 1 ? 'item is' : 'items are'} still open
              and will be carried forward to the next meeting.
            </li>
          )}
          <li>Open action items stay open and remain on their owner&rsquo;s task list.</li>
          <li>Notes stay exactly as they are, including private ones.</li>
        </ul>
      </Dialog>
    </>
  );
}

/** Status filter chip used on the action items page. */
export function ActionStatusSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by status">
      <option value="">Open and in progress</option>
      {ACTION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {ACTION_STATUS_LABELS[s as ActionStatus]}
        </option>
      ))}
    </Select>
  );
}

export { formatDate };
