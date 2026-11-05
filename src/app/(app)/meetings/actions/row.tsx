'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckSquare, Square } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Badge, Td } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { ACTION_STATUS_LABELS, type ActionStatus } from '@/lib/enums';

/** One row of the action list, with an inline complete toggle. */
export function ActionRow({
  id,
  title,
  description,
  status,
  dueLabel,
  overdue,
  ownerName,
  sourceLabel,
  sourceHref,
}: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  /** Rendered on the server. Deriving it here from the clock would make the
   *  server and client markup disagree. */
  dueLabel: string;
  overdue: boolean;
  ownerName: string;
  sourceLabel: string;
  sourceHref: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await api.patch(`/api/actions/${id}`, {
        status: status === 'COMPLETED' ? 'OPEN' : 'COMPLETED',
      });
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const showOverdue = overdue && status !== 'COMPLETED';

  return (
    <tr className={cn('hover:bg-slate-50', showOverdue && 'bg-rose-50/30')}>
      <Td className="w-10">
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="text-slate-400 hover:text-emerald-600 disabled:opacity-50"
          aria-label={status === 'COMPLETED' ? `Reopen "${title}"` : `Mark "${title}" complete`}
        >
          {status === 'COMPLETED' ? (
            <CheckSquare className="h-4 w-4 text-emerald-600" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
      </Td>
      <Td>
        <span className={cn('font-medium', status === 'COMPLETED' ? 'text-slate-500 line-through' : 'text-slate-900')}>
          {title}
        </span>
        {description && <span className="mt-0.5 block text-xs text-slate-600">{description}</span>}
      </Td>
      <Td className="text-slate-700">{ownerName}</Td>
      <Td className="text-slate-600">
        {sourceHref ? (
          <Link href={sourceHref} className="hover:underline">
            {sourceLabel}
          </Link>
        ) : (
          sourceLabel
        )}
      </Td>
      <Td className={showOverdue ? 'font-medium text-rose-700' : 'text-slate-600'}>{dueLabel}</Td>
      <Td>
        <Badge
          tone={status === 'COMPLETED' ? 'success' : status === 'IN_PROGRESS' ? 'info' : 'neutral'}
        >
          {ACTION_STATUS_LABELS[status as ActionStatus] ?? status}
        </Badge>
      </Td>
    </tr>
  );
}
