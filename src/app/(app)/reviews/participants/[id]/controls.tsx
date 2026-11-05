'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, RotateCcw, Scale, Send, XCircle } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { FormError, Input, Textarea } from '@/components/ui/form';
import { formatRelativeTime } from '@/lib/utils';

/** Release results to the employee. HR only; a deliberate, recorded step. */
export function ReleaseControls({
  participantId,
  canRelease,
  employeeName,
  requiresApproval,
  status,
}: {
  participantId: string;
  canRelease: boolean;
  employeeName: string;
  requiresApproval: boolean;
  status: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRelease) return null;

  const blockedReason =
    status === 'NOT_STARTED' || status === 'IN_PROGRESS'
      ? 'The manager review has not been submitted yet.'
      : requiresApproval && status === 'AWAITING_APPROVAL'
        ? 'This review is still waiting for approval.'
        : null;

  async function release() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/reviews/participants/${participantId}/release`);
      setOpen(false);
      toast.success(`Results released to ${employeeName}`, 'They have been notified.');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        icon={<Send className="h-4 w-4" />}
        onClick={() => setOpen(true)}
        disabled={blockedReason !== null}
        title={blockedReason ?? undefined}
      >
        Release to employee
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Release results to ${employeeName}?`}
        description="They will be notified and will be able to read the review immediately."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void release()} loading={loading}>
              Release
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <ul className="mt-1 space-y-2 text-sm text-slate-700">
          <li>Reviews cannot be edited after release.</li>
          <li>
            The goal figures the review was based on are frozen at this point, so later goal edits
            will not change what {employeeName} reads.
          </li>
          <li>{employeeName} will be asked to acknowledge receipt, which does not mean agreement.</li>
        </ul>
      </Dialog>
    </>
  );
}

/** Approve, or send back with a reason. */
export function ApprovalControls({
  participantId,
  canApprove,
  approverName,
  employeeName,
  requestedAt,
}: {
  participantId: string;
  canApprove: boolean;
  approverName: string;
  employeeName: string;
  requestedAt: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<'APPROVED' | 'CHANGES_REQUESTED' | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'APPROVED' | 'CHANGES_REQUESTED') {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/reviews/participants/${participantId}/approve`, {
        decision,
        note: note.trim() || null,
      });
      setMode(null);
      setNote('');
      toast.success(
        decision === 'APPROVED'
          ? `Review of ${employeeName} approved`
          : `Sent back to the manager with your note`,
      );
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Alert
        tone="warning"
        title="Waiting for approval"
        icon={<CheckCircle2 className="h-4 w-4" />}
      >
        <p>
          This review needs {canApprove ? 'your' : `${approverName}'s`} approval before the results
          can be released. Requested {formatRelativeTime(requestedAt)}.
        </p>
        {canApprove && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => setMode('APPROVED')}>
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<XCircle className="h-3.5 w-3.5" />}
              onClick={() => setMode('CHANGES_REQUESTED')}
            >
              Request changes
            </Button>
          </div>
        )}
      </Alert>

      <Dialog
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === 'APPROVED' ? 'Approve this review?' : 'Send this review back?'}
        description={
          mode === 'APPROVED'
            ? 'Approving means the content is ready to go to the employee. HR still performs the release as a separate step.'
            : 'The manager review will be reopened for editing and the manager will see your note.'
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMode(null)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant={mode === 'APPROVED' ? 'primary' : 'accent'}
              onClick={() => mode && void decide(mode)}
              loading={loading}
            >
              {mode === 'APPROVED' ? 'Approve' : 'Send back'}
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <Textarea
          label={mode === 'APPROVED' ? 'Note (optional)' : 'What needs to change?'}
          help={
            mode === 'APPROVED'
              ? 'Kept on the record. The manager can see it.'
              : 'At least 10 characters. The manager sees exactly this text.'
          }
          required={mode === 'CHANGES_REQUESTED'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          containerClassName="mt-1"
        />
      </Dialog>
    </>
  );
}

/** Reopen a submitted review. HR only, reason required, recorded. */
export function ReopenControl({ assignmentId, kind }: { assignmentId: string; kind: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/reviews/assignments/${assignmentId}/reopen`, { reason });
      setOpen(false);
      setReason('');
      toast.success('Review reopened', 'The reviewer has been notified and can edit it again.');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<RotateCcw className="h-3.5 w-3.5" />}
        onClick={() => setOpen(true)}
      >
        Reopen
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reopen this review for editing?"
        description={`The ${kind.toLowerCase()} review goes back to the reviewer. Any approval already requested is withdrawn, because the content it was based on is about to change.`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="accent" onClick={() => void reopen()} loading={loading}>
              Reopen
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <Textarea
          label="Why is it being reopened?"
          help="At least 10 characters. Shown to the reviewer and kept in the audit log."
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          containerClassName="mt-1"
        />
      </Dialog>
    </>
  );
}

/** Record a human calibration adjustment beside the calculated score. */
export function CalibrateControl({
  participantId,
  currentScore,
  calibratedScore,
  employeeName,
}: {
  participantId: string;
  currentScore: number | null;
  calibratedScore: number | null;
  employeeName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(
    calibratedScore !== null ? String(calibratedScore) : currentScore !== null ? String(currentScore) : '',
  );
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(clear = false) {
    setLoading(true);
    setError(null);
    try {
      await api.post(`/api/reviews/participants/${participantId}/calibrate`, {
        score: clear ? null : Number(score),
        note,
      });
      setOpen(false);
      setNote('');
      toast.success(clear ? 'Adjustment removed' : 'Calibration adjustment recorded');
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
        title="Calibration"
        description="Adjust the score after a calibration discussion. The calculated score is kept."
        level={3}
      />
      <CardBody>
        <Button
          variant="secondary"
          size="sm"
          icon={<Scale className="h-3.5 w-3.5" />}
          onClick={() => setOpen(true)}
        >
          {calibratedScore !== null ? 'Change the adjustment' : 'Record an adjustment'}
        </Button>
      </CardBody>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Record a calibration adjustment for ${employeeName}`}
        description="The calculated score is never overwritten. The adjustment is shown beside it with your reason attached."
        size="sm"
        footer={
          <>
            {calibratedScore !== null && (
              <Button
                variant="ghost"
                onClick={() => void save(true)}
                disabled={loading || note.trim().length < 15}
                title="Removes the adjustment and leaves the calculated score alone"
              >
                Remove adjustment
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save(false)} loading={loading}>
              Record
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Calculated score:{' '}
            <strong className="tabular-nums text-slate-900">
              {currentScore === null ? 'none' : currentScore.toFixed(1)}
            </strong>
          </p>
          <Input
            label="Adjusted score"
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={score}
            onChange={(e) => setScore(e.target.value)}
            help="A number between 0 and 100."
            required
          />
          <Textarea
            label="Reason for the adjustment"
            help="At least 15 characters. Kept with the adjustment and shown wherever the score appears."
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </Dialog>
    </Card>
  );
}
