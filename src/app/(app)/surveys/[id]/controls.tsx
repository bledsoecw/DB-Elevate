'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, Play, Square } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/primitives';
import { FormError, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';

/** Launch, remind, close. Launching fixes the mode permanently. */
export function SurveyAdminControls({
  surveyId,
  status,
  mode,
}: {
  surveyId: string;
  status: string;
  mode: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<'launch' | 'close' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, onDone: (result: unknown) => void) {
    setLoading(true);
    setError(null);
    try {
      const r = await api.post(path);
      setOpen(null);
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
      {(status === 'DRAFT' || status === 'SCHEDULED') && (
        <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={() => setOpen('launch')}>
          Launch
        </Button>
      )}
      {status === 'OPEN' && (
        <>
          <Button
            variant="secondary"
            icon={<Bell className="h-4 w-4" />}
            loading={loading}
            onClick={() =>
              run(`/api/surveys/${surveyId}/remind`, (r) => {
                const sent = (r as { sent?: number }).sent ?? 0;
                toast.success(
                  `Reminder sent to ${sent} ${sent === 1 ? 'person' : 'people'}`,
                  'At most one reminder per person per day, however many times this is pressed.',
                );
              })
            }
          >
            Remind
          </Button>
          <Button variant="secondary" icon={<Square className="h-4 w-4" />} onClick={() => setOpen('close')}>
            Close
          </Button>
        </>
      )}

      <Dialog
        open={open === 'launch'}
        onClose={() => setOpen(null)}
        title="Launch this survey?"
        description="Invitations go out immediately and everyone invited gets a task."
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
                run(`/api/surveys/${surveyId}/launch`, (r) => {
                  const invited = (r as { invited?: number }).invited ?? 0;
                  toast.success(`Survey launched to ${invited} people`);
                })
              }
            >
              Launch
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <Alert
          tone={mode === 'ANONYMOUS' ? 'success' : 'warning'}
          title={mode === 'ANONYMOUS' ? 'This survey is anonymous' : 'This survey is named'}
        >
          {mode === 'ANONYMOUS'
            ? 'Responses will be stored with no respondent identity. This cannot be changed after launch, and the data cannot be de-anonymized later because the identity is never written.'
            : 'Responses will be stored against each person’s name, and administrators will be able to read them individually. This cannot be changed after launch.'}
        </Alert>
      </Dialog>

      <Dialog
        open={open === 'close'}
        onClose={() => setOpen(null)}
        title="Close this survey?"
        description="Nobody will be able to respond after this. Results stay available."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(null)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="accent"
              loading={loading}
              onClick={() => run(`/api/surveys/${surveyId}/close`, () => toast.success('Survey closed'))}
            >
              Close it
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <p className="text-sm text-slate-700">
          Anyone part-way through will lose what they had typed, since nothing is saved until
          submission. Consider sending a reminder first.
        </p>
      </Dialog>
    </>
  );
}

/**
 * Result filters.
 *
 * For an anonymous survey only one dimension can be filtered at a time, which
 * is why these are radio-style selects rather than a stack of independent
 * filters: the restriction is in the shape of the control, not only in an error
 * message after the fact.
 */
export function ResultsFilters({
  surveyId,
  anonymous,
  filters,
  active,
  breakdown,
}: {
  surveyId: string;
  anonymous: boolean;
  filters: { dimension: string; values: string[] }[];
  active: { dimension: string; value: string } | null;
  breakdown: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  const dimensionValues = filters.find((f) => f.dimension === (active?.dimension ?? ''))?.values ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Break down by"
          value={breakdown ?? 'department'}
          onChange={(e) => apply({ breakdown: e.target.value })}
          containerClassName="w-44"
        >
          {filters.map((f) => (
            <option key={f.dimension} value={f.dimension}>
              {f.dimension[0]?.toUpperCase()}
              {f.dimension.slice(1)}
            </option>
          ))}
        </Select>

        <Select
          label="Filter to one group"
          value={active?.dimension ?? ''}
          onChange={(e) => apply({ dim: e.target.value, value: '' })}
          placeholder="No filter"
          containerClassName="w-44"
        >
          {filters.map((f) => (
            <option key={f.dimension} value={f.dimension}>
              {f.dimension[0]?.toUpperCase()}
              {f.dimension.slice(1)}
            </option>
          ))}
        </Select>

        {active?.dimension && (
          <Select
            label="Value"
            value={active.value ?? ''}
            onChange={(e) => apply({ value: e.target.value })}
            placeholder="Choose"
            containerClassName="w-52"
          >
            {dimensionValues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        )}

        {(active || breakdown !== 'department') && (
          <Button variant="ghost" size="sm" onClick={() => router.replace(`/surveys/${surveyId}`)}>
            Reset
          </Button>
        )}
        {pending && <span className="pb-2 text-xs text-slate-500">Updating…</span>}
      </div>

      {anonymous && (
        <p className="text-xs leading-relaxed text-slate-500">
          Only one dimension can be filtered at a time on an anonymous survey. Combining two would
          narrow the group far enough to identify individual respondents, so the second filter is
          refused rather than quietly returning a small number.
        </p>
      )}
    </div>
  );
}
