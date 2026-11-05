'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage } from '@/lib/client-api';
import { Button, type ButtonProps } from './button';
import { ConfirmDialog } from './dialog';
import { useToast } from './toast';

/**
 * A button that calls the REST API and then refreshes the server-rendered page.
 *
 * Mutations go through the same API routes an external caller would use, so the
 * permission checks exercised by the UI are exactly the ones an attacker would
 * hit. The page re-renders from the database afterwards, which is why on-screen
 * counts always match stored data.
 */
export function ActionButton({
  endpoint,
  method = 'POST',
  body,
  children,
  successMessage,
  confirm,
  onDone,
  disabledReason,
  ...buttonProps
}: Omit<ButtonProps, 'onClick' | 'loading'> & {
  endpoint: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  children: ReactNode;
  successMessage?: string;
  /** When present, the action is gated behind a confirmation dialog. */
  confirm?: {
    title: string;
    description?: ReactNode;
    confirmLabel?: string;
    tone?: 'primary' | 'danger' | 'accent';
    requirePhrase?: string;
    body?: ReactNode;
  };
  onDone?: (result: unknown) => void;
  /** Explains why the button is disabled, shown as a tooltip. */
  disabledReason?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const result =
        method === 'DELETE'
          ? await api.del(endpoint, body)
          : method === 'PATCH'
            ? await api.patch(endpoint, body)
            : await api.post(endpoint, body);
      setConfirming(false);
      if (successMessage) toast.success(successMessage);
      onDone?.(result);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        {...buttonProps}
        title={disabledReason ?? buttonProps.title}
        loading={loading}
        onClick={() => (confirm ? setConfirming(true) : run())}
      >
        {children}
      </Button>
      {confirm && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          onConfirm={run}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel ?? 'Confirm'}
          tone={confirm.tone ?? 'primary'}
          requirePhrase={confirm.requirePhrase}
          loading={loading}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
    </>
  );
}
