'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, UserMinus, UserPlus, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

interface Option {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  jobTitle: { name: string } | null;
}

/**
 * Administrative actions on an employee record.
 *
 * Each one states its consequence before it is taken, because all three are
 * things people get wrong in HR systems: a manager change that quietly moves
 * historical access, and a deactivation that quietly deletes history.
 */
export function EmployeeAdminControls({
  employeeId,
  employeeName,
  canEdit,
  canChangeManager,
  canDeactivate,
  isDeactivated,
  isHrAdmin,
  currentManagerId,
}: {
  employeeId: string;
  employeeName: string;
  canEdit: boolean;
  canChangeManager: boolean;
  canDeactivate: boolean;
  isDeactivated: boolean;
  isHrAdmin: boolean;
  currentManagerId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<'manager' | 'deactivate' | 'reactivate' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managers, setManagers] = useState<Option[]>([]);

  const [managerId, setManagerId] = useState(currentManagerId ?? '');
  const [managerReason, setManagerReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [deactivateReason, setDeactivateReason] = useState('');
  const [terminationDate, setTerminationDate] = useState('');
  const [outcome, setOutcome] = useState<{ openAssignments: number; directReports: number } | null>(null);

  // Date defaults come from the clock, so they are set on mount rather than
  // during render, which would differ between the server and the browser.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setEffectiveFrom(today);
    setTerminationDate(today);
  }, []);

  // Manager options are only needed once the dialog opens.
  useEffect(() => {
    if (open !== 'manager' || managers.length > 0) return;
    api
      .get<{ managers: Option[] }>('/api/options/people')
      .then((r) => setManagers(r.managers))
      .catch(() => setError('Could not load the list of managers.'));
  }, [open, managers.length]);

  async function run(fn: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  if (!canEdit && !canChangeManager && !canDeactivate && !isHrAdmin) return null;

  return (
    <>
      {canEdit && (
        <Button
          variant="secondary"
          icon={<Pencil className="h-4 w-4" />}
          onClick={() => router.push(`/people/${employeeId}/edit`)}
        >
          Edit
        </Button>
      )}
      {canChangeManager && !isDeactivated && (
        <Button variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => setOpen('manager')}>
          Change manager
        </Button>
      )}
      {canDeactivate && (
        <Button variant="secondary" icon={<UserMinus className="h-4 w-4" />} onClick={() => setOpen('deactivate')}>
          Deactivate
        </Button>
      )}
      {isHrAdmin && isDeactivated && (
        <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setOpen('reactivate')}>
          Reactivate
        </Button>
      )}

      {/* ------------------------------------------------ change manager */}
      <Dialog
        open={open === 'manager'}
        onClose={() => setOpen(null)}
        title={`Change who ${employeeName} reports to`}
        description="Recorded as a dated event. Reviews already completed keep the manager who wrote them, and the new manager does not gain access to them."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={() =>
                run(async () => {
                  await api.post(`/api/people/${employeeId}/manager`, {
                    managerId: managerId || null,
                    reason: managerReason,
                    effectiveFrom,
                  });
                  setOpen(null);
                  setManagerReason('');
                  toast.success('Reporting line updated', 'Historical reviews are unchanged.');
                })
              }
            >
              Change manager
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormError message={error} />
          <Select
            label="New manager"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            placeholder="No manager"
          >
            {managers
              .filter((m) => m.id !== employeeId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.preferredName || m.firstName} {m.lastName}
                  {m.jobTitle ? ` — ${m.jobTitle.name}` : ''}
                </option>
              ))}
          </Select>
          <Input
            label="Effective from"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            help="Used when resolving who could see a review at a given time."
            required
          />
          <Textarea
            label="Reason"
            required
            help="At least 5 characters. Kept in the reporting history and the audit log."
            value={managerReason}
            onChange={(e) => setManagerReason(e.target.value)}
            rows={3}
          />
        </div>
      </Dialog>

      {/* --------------------------------------------------- deactivate */}
      <Dialog
        open={open === 'deactivate'}
        onClose={() => {
          setOpen(null);
          setOutcome(null);
        }}
        title={`Deactivate ${employeeName}?`}
        description="Their history is kept. Their access is not."
        footer={
          outcome ? (
            <Button
              variant="primary"
              onClick={() => {
                setOpen(null);
                setOutcome(null);
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(null)} disabled={loading}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={loading}
                onClick={() =>
                  run(async () => {
                    const result = await api.post<{ openAssignments: number; directReports: number }>(
                      `/api/people/${employeeId}/deactivate`,
                      { reason: deactivateReason, terminationDate },
                    );
                    setOutcome(result);
                    toast.success(`${employeeName} deactivated`);
                  })
                }
              >
                Deactivate
              </Button>
            </>
          )
        }
      >
        {outcome ? (
          <div className="space-y-3">
            <Alert tone="success" title="Deactivated">
              Sign-in has been revoked and every active session ended.
            </Alert>
            {outcome.openAssignments > 0 && (
              <Alert tone="warning" title="Reviews still assigned to them">
                {outcome.openAssignments} unfinished{' '}
                {outcome.openAssignments === 1 ? 'review was' : 'reviews were'} assigned to this person.
                They have not been deleted — reassign the reviewer from the cycle, or the reviews will
                stay unfinished. This is listed under administrative exceptions on your dashboard.
              </Alert>
            )}
            {outcome.directReports > 0 && (
              <Alert tone="warning" title="They had direct reports">
                {outcome.directReports}{' '}
                {outcome.directReports === 1 ? 'person still reports' : 'people still report'} to them.
                Move those reporting lines so their next review has a manager.
              </Alert>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <FormError message={error} />
            <Alert tone="neutral" title="What this does">
              <ul className="mt-1 space-y-1">
                <li>Sign-in is revoked and any open session ends immediately.</li>
                <li>
                  Reviews, goals, feedback and meeting history are <strong>kept</strong>. They remain
                  visible to the people who could already see them.
                </li>
                <li>Unfinished reviews assigned to them are reported so you can reassign them.</li>
                <li>This can be undone by reactivating the record.</li>
              </ul>
            </Alert>
            <Input
              label="Last day"
              type="date"
              value={terminationDate}
              onChange={(e) => setTerminationDate(e.target.value)}
              required
            />
            <Textarea
              label="Reason"
              required
              help="At least 5 characters. Kept in the audit log."
              value={deactivateReason}
              onChange={(e) => setDeactivateReason(e.target.value)}
              rows={3}
            />
          </div>
        )}
      </Dialog>

      {/* --------------------------------------------------- reactivate */}
      <Dialog
        open={open === 'reactivate'}
        onClose={() => setOpen(null)}
        title={`Reactivate ${employeeName}?`}
        description="Their sign-in account is restored and they become eligible for review cycles again."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={() =>
                run(async () => {
                  await api.post(`/api/people/${employeeId}/reactivate`);
                  setOpen(null);
                  toast.success(`${employeeName} reactivated`);
                })
              }
            >
              Reactivate
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <p className="text-sm text-slate-700">
          Their previous password still applies. If they no longer have it, set a new one from the
          account administration screen.
        </p>
      </Dialog>
    </>
  );
}
