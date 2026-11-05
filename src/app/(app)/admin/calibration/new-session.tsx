'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError, Input, RadioGroup, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import { countLabel } from '@/lib/utils';

export interface CycleOption {
  id: string;
  name: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  eligible: number;
}

export function NewSessionButton({ cycles }: { cycles: CycleOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [cycleId, setCycleId] = useState<string | null>(cycles[0]?.id ?? null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const chosen = cycles.find((c) => c.id === cycleId) ?? null;

  async function create() {
    if (!cycleId) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await api.post<{ id: string }>('/api/admin/calibration', {
        cycleId,
        name: name.trim() || `${chosen?.name ?? 'Calibration'} — calibration`,
        notes: notes.trim() || null,
      });
      toast.success('Session opened.');
      router.push(`/admin/calibration/${result.id}`);
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

  if (cycles.length === 0) {
    return (
      <Button disabled title="No cycle currently has participants ready to calibrate.">
        New session
      </Button>
    );
  }

  return (
    <>
      <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        New session
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          size="lg"
          title="Open a calibration session"
          description="Everyone in the cycle whose reviews are in and not yet released is brought in. Their current score is frozen as the baseline, so every later adjustment can be measured against what the reviews actually said."
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={busy}
                loadingLabel="Opening…"
                disabled={!cycleId}
                onClick={create}
              >
                Open session
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <FormError message={error} />

            <RadioGroup<string>
              name="cycle"
              legend="Review cycle"
              required
              value={cycleId}
              onChange={setCycleId}
              error={fieldErrors.cycleId}
              options={cycles.map((c) => ({
                value: c.id,
                label: c.name,
                description: `${c.periodStart} – ${c.periodEnd} · ${countLabel(c.eligible, 'participant')} ready to calibrate`,
              }))}
            />

            <Input
              label="Session name"
              required={false}
              value={name}
              error={fieldErrors.name}
              onChange={(e) => setName(e.target.value)}
              placeholder={chosen ? `${chosen.name} — calibration` : 'Calibration'}
              help="Left blank, the cycle's name is used."
            />

            <Textarea
              label="Notes"
              required={false}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              help="Who is in the room, what the group is trying to settle. Visible to HR administrators only."
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
