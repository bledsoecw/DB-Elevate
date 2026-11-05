'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, Plus, Rocket, Square, Trash2, X } from 'lucide-react';
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
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { FormError, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { cn, formatDate } from '@/lib/utils';
import { ASSIGNMENT_STATUS_LABELS, REVIEWER_KIND_LABELS, type AssignmentStatus, type ReviewerKind } from '@/lib/enums';

/** Launch, remind, close, cancel. */
export function CycleControls({
  cycleId,
  status,
  participantCount,
  name,
}: {
  cycleId: string;
  status: string;
  participantCount: number;
  name: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<'launch' | 'close' | 'cancel' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [launchResult, setLaunchResult] = useState<{
    participants: number;
    assignments: number;
    skipped: { name: string; reason: string }[];
  } | null>(null);

  async function run(path: string, body: unknown, onDone: (r: unknown) => void) {
    setLoading(true);
    setError(null);
    try {
      const r = await api.post(path, body);
      onDone(r);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {status === 'DRAFT' && (
        <Button
          variant="primary"
          icon={<Rocket className="h-4 w-4" />}
          onClick={() => setOpen('launch')}
          disabled={participantCount === 0}
          title={participantCount === 0 ? 'Add at least one person first.' : undefined}
        >
          Launch
        </Button>
      )}
      {status === 'ACTIVE' && (
        <>
          <Button
            variant="secondary"
            icon={<Bell className="h-4 w-4" />}
            loading={loading}
            onClick={() =>
              run(`/api/admin/cycles/${cycleId}/remind`, {}, (r) => {
                const sent = (r as { sent?: number }).sent ?? 0;
                toast.success(
                  `Reminder sent for ${sent} outstanding ${sent === 1 ? 'review' : 'reviews'}`,
                  'At most one per person per day.',
                );
              })
            }
          >
            Send reminders
          </Button>
          <Button variant="secondary" icon={<Square className="h-4 w-4" />} onClick={() => setOpen('close')}>
            Close cycle
          </Button>
        </>
      )}
      {(status === 'DRAFT' || status === 'SCHEDULED') && (
        <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => setOpen('cancel')}>
          Cancel
        </Button>
      )}

      {/* ------------------------------------------------------- launch */}
      <Dialog
        open={open === 'launch'}
        onClose={() => {
          setOpen(null);
          setLaunchResult(null);
        }}
        title={launchResult ? 'Cycle launched' : `Launch "${name}"?`}
        description={
          launchResult
            ? undefined
            : 'Reviews are created and everyone involved is notified. This cannot be undone.'
        }
        footer={
          launchResult ? (
            <Button
              variant="primary"
              onClick={() => {
                setOpen(null);
                setLaunchResult(null);
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(null)} disabled={loading}>
                Not yet
              </Button>
              <Button
                variant="primary"
                loading={loading}
                onClick={() =>
                  run(`/api/admin/cycles/${cycleId}/launch`, {}, (r) => {
                    setLaunchResult(
                      r as { participants: number; assignments: number; skipped: { name: string; reason: string }[] },
                    );
                    toast.success('Cycle launched');
                  })
                }
              >
                Launch to {participantCount} {participantCount === 1 ? 'person' : 'people'}
              </Button>
            </>
          )
        }
      >
        <FormError message={error} />
        {launchResult ? (
          <div className="space-y-3">
            <Alert tone="success">
              {launchResult.assignments} review{launchResult.assignments === 1 ? '' : 's'} created
              for {launchResult.participants}{' '}
              {launchResult.participants === 1 ? 'person' : 'people'}. Everyone involved has been
              notified.
            </Alert>
            {launchResult.skipped.length > 0 && (
              <Alert tone="warning" title={`${launchResult.skipped.length} things to look at`}>
                <ul className="mt-1 space-y-1">
                  {launchResult.skipped.map((s, i) => (
                    <li key={i}>
                      <strong>{s.name}:</strong> {s.reason}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        ) : (
          <ul className="space-y-1.5 text-sm text-slate-700">
            <li>Each person&rsquo;s manager, job title and department are recorded as they are now.</li>
            <li>
              Those recorded facts decide who can read the review later, so a transfer afterwards
              does not change anything about this cycle.
            </li>
            <li>The template version is frozen into every review.</li>
            <li>Reviewers are notified and the work appears in their task list.</li>
          </ul>
        )}
      </Dialog>

      {/* -------------------------------------------------------- close */}
      <Dialog
        open={open === 'close'}
        onClose={() => setOpen(null)}
        title={`Close "${name}"?`}
        description="No more responses can be submitted. Released reviews stay available to everyone who could already read them."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="accent"
              loading={loading}
              onClick={() =>
                run(`/api/admin/cycles/${cycleId}/close`, {}, (r) => {
                  const unreleased = (r as { unreleased?: number }).unreleased ?? 0;
                  setOpen(null);
                  toast.success(
                    'Cycle closed',
                    unreleased > 0
                      ? `${unreleased} review${unreleased === 1 ? ' was' : 's were'} never released and keep their unfinished state.`
                      : undefined,
                  );
                })
              }
            >
              Close it
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <p className="text-sm text-slate-700">
          Anything unreleased keeps its unfinished state rather than being quietly marked complete,
          so the record stays honest about what actually happened.
        </p>
      </Dialog>

      {/* ------------------------------------------------------- cancel */}
      <Dialog
        open={open === 'cancel'}
        onClose={() => setOpen(null)}
        title={`Cancel "${name}"?`}
        description="The cycle is marked cancelled and kept for the record."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={loading}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={loading}
              onClick={() =>
                run(`/api/admin/cycles/${cycleId}/cancel`, { reason }, () => {
                  setOpen(null);
                  toast.success('Cycle cancelled');
                  router.push('/reviews/cycles');
                })
              }
            >
              Cancel the cycle
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <Textarea
          label="Why?"
          required
          help="At least 10 characters. Kept in the audit log."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </Dialog>
    </>
  );
}

interface Eligible {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  department: string | null;
  managerName: string | null;
  cohort: string | null;
  hireDate: Date | string | null;
  included: boolean;
  blockers: string[];
}

/**
 * Choosing who takes part.
 *
 * Anyone the cycle cannot properly review — no manager, no account — is shown
 * with the reason rather than silently excluded, because the fix is usually a
 * two-minute change on their record.
 */
export function ParticipantPicker({
  cycleId,
  locked,
  launched,
  employees,
}: {
  cycleId: string;
  locked: boolean;
  launched: boolean;
  employees: Eligible[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(employees.filter((e) => e.included).map((e) => e.id)),
  );
  const [filter, setFilter] = useState('');
  const [department, setDepartment] = useState('');
  const [cohort, setCohort] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort() as string[],
    [employees],
  );
  const cohorts = useMemo(
    () => [...new Set(employees.map((e) => e.cohort).filter(Boolean))].sort() as string[],
    [employees],
  );

  const visible = employees.filter((e) => {
    if (department && e.department !== department) return false;
    if (cohort && e.cohort !== cohort) return false;
    if (filter && !e.name.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const changed =
    selected.size !== employees.filter((e) => e.included).length ||
    employees.some((e) => e.included !== selected.has(e.id));

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ added: number; removed: number }>(
        `/api/admin/cycles/${cycleId}/participants`,
        { employeeIds: [...selected] },
      );
      toast.success(
        'Participants updated',
        `${r.added} added, ${r.removed} removed.`,
      );
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
        title="Who takes part"
        description={
          launched
            ? 'This cycle is running. Adding someone now creates their reviews immediately; somebody who has already started cannot be removed.'
            : 'Nothing is sent to anyone until the cycle is launched.'
        }
        actions={<Badge tone="brand">{selected.size} selected</Badge>}
      />

      <CardBody className="space-y-3 border-b border-slate-200">
        <FormError message={error} />
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Name"
            containerClassName="min-w-[12rem] flex-1"
          />
          <Select
            label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="All"
            containerClassName="w-48"
          >
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          {cohorts.length > 0 && (
            <Select
              label="Cohort"
              value={cohort}
              onChange={(e) => setCohort(e.target.value)}
              placeholder="All"
              containerClassName="w-44"
            >
              {cohorts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </div>
        {!locked && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelected(new Set([...selected, ...visible.filter((e) => e.blockers.length === 0).map((e) => e.id)]))}
            >
              Select all shown ({visible.filter((e) => e.blockers.length === 0).length})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const next = new Set(selected);
                for (const e of visible) next.delete(e.id);
                setSelected(next);
              }}
            >
              Clear shown
            </Button>
          </div>
        )}
      </CardBody>

      <TableWrap>
        <thead>
          <tr>
            <Th />
            <Th>Employee</Th>
            <Th>Role</Th>
            <Th>Department</Th>
            <Th>Manager</Th>
            <Th>Hired</Th>
            <Th />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visible.map((e) => {
            const blocked = e.blockers.length > 0;
            const isSelected = selected.has(e.id);
            return (
              <tr key={e.id} className={cn('hover:bg-slate-50', blocked && 'bg-amber-50/40')}>
                <Td className="w-10">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={locked || blocked}
                    onChange={(ev) => {
                      const next = new Set(selected);
                      if (ev.target.checked) next.add(e.id);
                      else next.delete(e.id);
                      setSelected(next);
                    }}
                    aria-label={`Include ${e.name}`}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 disabled:opacity-40"
                  />
                </Td>
                <Td>
                  <span className="flex items-center gap-2.5">
                    <Avatar firstName={e.firstName} lastName={e.lastName} size="xs" />
                    <span className="font-medium text-slate-900">{e.name}</span>
                  </span>
                </Td>
                <Td className="text-slate-600">{e.jobTitle ?? '—'}</Td>
                <Td className="text-slate-600">{e.department ?? '—'}</Td>
                <Td className="text-slate-600">{e.managerName ?? <span className="text-amber-700">None</span>}</Td>
                <Td className="whitespace-nowrap text-xs text-slate-600">{formatDate(e.hireDate)}</Td>
                <Td>
                  {blocked && (
                    <span className="flex flex-col gap-1">
                      {e.blockers.map((b, i) => (
                        <Badge key={i} tone="warning">
                          {b}
                        </Badge>
                      ))}
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      {!locked && (
        <CardFooter className="flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={loading} disabled={!changed} onClick={() => void save()}>
            Save the participant list
          </Button>
          {changed && <span className="text-xs text-amber-700">Unsaved changes</span>}
          {!changed && <span className="text-xs text-slate-500">No changes to save</span>}
        </CardFooter>
      )}
    </Card>
  );
}

/** Add or remove reviewers for one participant. */
export function ReviewerEditor({
  participantId,
  subjectName,
  subjectFirstName,
  subjectLastName,
  assignments,
  peerEnabled,
}: {
  participantId: string;
  subjectName: string;
  subjectFirstName: string;
  subjectLastName: string;
  assignments: { id: string; kind: string; status: string; reviewerName: string; reviewerId: string }[];
  peerEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState<{ id: string; firstName: string; lastName: string; preferredName: string | null }[]>([]);
  const [reviewerId, setReviewerId] = useState('');
  const [kind, setKind] = useState('PEER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openAdd() {
    setAdding(true);
    if (people.length === 0) {
      try {
        const r = await api.get<{ managers: typeof people }>('/api/options/people');
        setPeople(r.managers);
      } catch {
        setError('Could not load the list of people.');
      }
    }
  }

  async function add() {
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/admin/cycles/x/reviewers', {
        participantId,
        reviewerEmployeeId: reviewerId,
        kind,
      });
      setAdding(false);
      setReviewerId('');
      toast.success('Reviewer assigned');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function remove(assignmentId: string) {
    try {
      await api.del(`/api/admin/cycles/x/reviewers?assignment=${assignmentId}`);
      toast.success('Reviewer removed');
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <Avatar firstName={subjectFirstName} lastName={subjectLastName} size="sm" />
          <span className="font-medium text-slate-900">{subjectName}</span>
        </span>
        {!adding && (
          <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => void openAdd()}>
            Add a reviewer
          </Button>
        )}
      </div>

      <ul className="mt-2 flex flex-wrap gap-2">
        {assignments.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
          >
            <span className="font-medium text-slate-700">
              {REVIEWER_KIND_LABELS[a.kind as ReviewerKind] ?? a.kind}
            </span>
            <span className="text-slate-600">{a.reviewerName}</span>
            <Badge tone={a.status === 'SUBMITTED' ? 'success' : 'neutral'}>
              {a.status === 'SUBMITTED' && <Check aria-hidden className="h-3 w-3" />}
              {ASSIGNMENT_STATUS_LABELS[a.status as AssignmentStatus] ?? a.status}
            </Badge>
            {a.status !== 'SUBMITTED' && (
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="rounded p-0.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                aria-label={`Remove ${a.reviewerName} as a ${a.kind.toLowerCase()} reviewer`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
        {assignments.length === 0 && (
          <li className="text-xs text-amber-700">No reviewers assigned.</li>
        )}
      </ul>

      {adding && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3">
          <Select
            label="Review type"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            containerClassName="w-44"
          >
            {(peerEnabled ? ['PEER', 'MANAGER', 'SKIP_LEVEL', 'UPWARD'] : ['MANAGER', 'SKIP_LEVEL']).map((k) => (
              <option key={k} value={k}>
                {REVIEWER_KIND_LABELS[k as ReviewerKind] ?? k}
              </option>
            ))}
          </Select>
          <Select
            label="Reviewer"
            value={reviewerId}
            onChange={(e) => setReviewerId(e.target.value)}
            placeholder="Choose"
            containerClassName="min-w-[14rem] flex-1"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.preferredName || p.firstName} {p.lastName}
              </option>
            ))}
          </Select>
          <Button variant="primary" size="sm" loading={loading} disabled={!reviewerId} onClick={() => void add()}>
            Assign
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          {error && <p className="w-full text-xs text-rose-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
