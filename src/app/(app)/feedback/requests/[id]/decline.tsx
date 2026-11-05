'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';

/** Declining is a legitimate answer, so it is offered plainly rather than hidden. */
export function DeclineRequest({ requestId }: { requestId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        I am not the right person to answer this
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Decline this request?"
        description="The person who asked will be told, so they can ask someone else."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="accent"
              loading={loading}
              onClick={async () => {
                setLoading(true);
                setError(null);
                try {
                  await api.post(`/api/feedback/requests/${requestId}/decline`, {
                    reason: reason.trim() || null,
                  });
                  setOpen(false);
                  toast.success('Request declined');
                  router.push('/feedback');
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              Decline
            </Button>
          </>
        }
      >
        <FormError message={error} />
        <Textarea
          label="Reason"
          required={false}
          help="Optional, but it helps them find someone who can answer."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </Dialog>
    </>
  );
}
