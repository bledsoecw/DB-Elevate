'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { FormError, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/client-api';

const PHRASE = 'REMOVE DEMO DATA';

/**
 * Removal is irreversible and there is no undo, so it is gated on typing the
 * phrase rather than on a single click. The service checks the same phrase, so
 * a scripted POST gets no shortcut.
 */
export function RemoveDemoDataForm({
  total,
  selfIsDemo,
  hasRealEmployees,
}: {
  total: number;
  selfIsDemo: boolean;
  hasRealEmployees: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Record<string, number> | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ removed: Record<string, number> }>('/api/admin/demo-data', {
        confirmation: phrase,
      });
      setRemoved(result.removed);
      toast.success('Demonstration data removed.');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (removed) {
    const lines = Object.entries(removed).filter(([, n]) => n > 0);
    return (
      <Card>
        <CardHeader title="Removed" />
        <CardBody>
          <p className="text-sm text-slate-700">The demonstration data is gone. Removed:</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {lines.map(([key, n]) => (
              <li key={key}>
                {n} {key}
              </li>
            ))}
          </ul>
          {lines.length === 0 && <p className="mt-2 text-sm text-slate-600">Nothing was left to remove.</p>}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="border-rose-200">
      <CardHeader
        title="Remove the demonstration data"
        description="Permanent. There is no undo, and the records cannot be restored from within the application — only from a database backup."
      />
      <CardBody className="space-y-4">
        <FormError message={error} />

        {selfIsDemo ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
            You are signed in as one of the demonstration accounts, so removing the data would delete
            your own access part-way through. Create a real administrator account first (Accounts →
            Create account), sign in as that, and then come back. The removal is refused until then —
            including from a direct API call.
          </p>
        ) : (
          <>
            {!hasRealEmployees && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
                There are no real employee records yet, so this will leave the application empty. That
                is allowed — just be sure it is what you want.
              </p>
            )}
            <Input
              label={`Type ${PHRASE} to confirm`}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={PHRASE}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              help={`${total} records will be deleted along with everything that belongs to them.`}
            />
            <Button
              variant="danger"
              icon={<Trash2 className="h-4 w-4" />}
              loading={busy}
              loadingLabel="Removing…"
              disabled={phrase !== PHRASE}
              onClick={remove}
            >
              Remove {total} demonstration records
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
