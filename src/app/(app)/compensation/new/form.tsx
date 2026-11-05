'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, FormActions, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/client-api';
import { formatMoney, parseMoneyToMinor } from '@/lib/money';

/**
 * Cycle creation.
 *
 * The budget is typed as currency and converted to integer minor units here
 * with the same parser the server validates against, so the figure the
 * administrator reads back is the figure that was stored.
 */
export function NewCycleForm({
  reviewCycles,
  defaultName,
  defaultEffective,
}: {
  reviewCycles: { id: string; label: string }[];
  defaultName: string;
  defaultEffective: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState(defaultName);
  const [effectiveDate, setEffectiveDate] = useState(defaultEffective);
  const [dueAt, setDueAt] = useState('');
  const [reviewCycleId, setReviewCycleId] = useState(reviewCycles[0]?.id ?? '');
  const [pool, setPool] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poolMinor = pool.trim() === '' ? 0 : parseMoneyToMinor(pool);
  const poolInvalid = pool.trim() !== '' && poolMinor === null;

  async function submit() {
    setError(null);
    if (poolInvalid) {
      setError('The budget is not a number I can read. Enter it as an amount, like 250000.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ id: string; included: number; skippedNoPay: string[] }>(
        '/api/compensation',
        {
          name: name.trim(),
          effectiveDate,
          dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
          reviewCycleId: reviewCycleId || null,
          totalPoolMinor: poolMinor ?? 0,
          notes: notes.trim() || null,
        },
      );
      toast.success(
        'Draft cycle created',
        result.skippedNoPay.length > 0
          ? `${result.included} included. ${result.skippedNoPay.length} left out for having no salary on record.`
          : `${result.included} people included.`,
      );
      router.push(`/compensation/${result.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Cycle details"
        description="Everyone active with a salary on record is included. Anyone without one is left out and named, because there is nothing to base an increase on."
      />
      <CardBody className="space-y-5">
        <Field label="Name" htmlFor="cycle-name" required>
          <Input
            id="cycle-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="2026 Merit Increase"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Effective date"
            htmlFor="cycle-effective"
            required
            help="The date an approved increase takes effect in pay history."
          >
            <Input
              id="cycle-effective"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </Field>
          <Field
            label="Manager deadline"
            htmlFor="cycle-due"
            required={false}
            help="Shown to managers. It does not close anything on its own."
          >
            <Input
              id="cycle-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Total pool"
          htmlFor="cycle-pool"
          required={false}
          help="Leave this blank or zero and no ceiling is enforced at submission. A figure here is divided between managers as budgets."
          hint={poolMinor && poolMinor > 0 ? formatMoney(poolMinor, { whole: true }) : undefined}
          error={poolInvalid ? 'Enter an amount, like 250000.' : null}
        >
          <Input
            id="cycle-pool"
            inputMode="decimal"
            value={pool}
            onChange={(e) => setPool(e.target.value)}
            placeholder="250000"
          />
        </Field>

        <Field
          label="Informed by review cycle"
          htmlFor="cycle-review"
          required={false}
          help={
            reviewCycles.length === 0
              ? 'No review cycle has released results yet. Without one there is no performance score, so no increase is suggested and every decision is made on its own merits.'
              : 'Released scores from this cycle produce the suggested increase. The score informs the suggestion; it never sets the decision.'
          }
        >
          <Select
            id="cycle-review"
            value={reviewCycleId}
            onChange={(e) => setReviewCycleId(e.target.value)}
            placeholder="No review cycle — decide on merit alone"
            options={reviewCycles.map((c) => ({ value: c.id, label: c.label }))}
            disabled={reviewCycles.length === 0}
          />
        </Field>

        <Field label="Notes" htmlFor="cycle-notes" required={false}>
          <Textarea
            id="cycle-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Guidance for managers allocating in this cycle."
          />
        </Field>

        <FormError message={error} />

        <FormActions>
          <Button variant="ghost" onClick={() => router.push('/compensation')} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || name.trim().length < 3 || !effectiveDate}
          >
            {busy ? 'Creating…' : 'Create draft'}
          </Button>
        </FormActions>
      </CardBody>
    </Card>
  );
}
