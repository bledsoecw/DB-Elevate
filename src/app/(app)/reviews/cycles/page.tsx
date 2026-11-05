import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ClipboardList, Plus } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listCycles } from '@/server/services/review-lists';
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { formatDate, countLabel } from '@/lib/utils';
import { CYCLE_STATUS_LABELS, TEMPLATE_CATEGORY_LABELS, type CycleStatus, type TemplateCategory } from '@/lib/enums';

export const metadata = { title: 'Review cycles' };

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  ACTIVE: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'warning',
};

export default async function CyclesPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/reviews');

  const cycles = await listCycles(actor);
  const open = cycles.filter((c) => c.status !== 'CLOSED' && c.status !== 'CANCELLED');
  const closed = cycles.filter((c) => c.status === 'CLOSED' || c.status === 'CANCELLED');

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Reviews', href: '/reviews' }, { label: 'Cycles' }]}
        title="Review cycles"
        description="A cycle is a round of reviews: who takes part, which template, who reviews whom, and by when. Nothing reaches a reviewer until you launch it."
        actions={
          <ButtonLink href="/reviews/cycles/new" variant="primary">
            <Plus aria-hidden className="h-4 w-4" />
            New cycle
          </ButtonLink>
        }
      />

      {cycles.length === 0 ? (
        <Card>
          <EmptyState
            illustration="forms"
            icon={<ClipboardList className="h-5 w-5" />}
            title="No cycles yet"
            description="Build a template first, publish it, then create a cycle that uses it. You choose who takes part before anything is sent."
            action={
              <>
                <ButtonLink href="/admin/templates" variant="primary">
                  Review templates
                </ButtonLink>
                <ButtonLink href="/reviews/cycles/new">Create a cycle</ButtonLink>
              </>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {open.length > 0 && (
            <Card>
              <CardHeader title="Open" description="Drafts and cycles currently collecting responses." />
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Cycle</Th>
                    <Th>Template</Th>
                    <Th>Period</Th>
                    <Th align="right">People</Th>
                    <Th>Self due</Th>
                    <Th>Manager due</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {open.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <Td>
                        <Link href={`/reviews/cycles/${c.id}`} className="font-medium text-slate-900 hover:underline">
                          {c.name}
                        </Link>
                        {c.description && (
                          <span className="mt-0.5 block max-w-md text-xs text-slate-600">{c.description}</span>
                        )}
                      </Td>
                      <Td className="text-slate-700">
                        {c.templateVersion.template.name}
                        <span className="block text-xs text-slate-500">
                          v{c.templateVersion.versionNumber} ·{' '}
                          {TEMPLATE_CATEGORY_LABELS[c.templateVersion.template.category as TemplateCategory] ??
                            c.templateVersion.template.category}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">
                        {formatDate(c.periodStart)} — {formatDate(c.periodEnd)}
                      </Td>
                      <Td align="right" className="tabular-nums">{c._count.participants}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{formatDate(c.selfDueAt)}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{formatDate(c.managerDueAt)}</Td>
                      <Td>
                        <span className="flex flex-wrap gap-1.5">
                          <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>
                            {CYCLE_STATUS_LABELS[c.status as CycleStatus] ?? c.status}
                          </Badge>
                          {c.requireApproval && <Badge tone="neutral">Approval required</Badge>}
                          {c.peerReviewEnabled && <Badge tone="neutral">Peer reviews</Badge>}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>
          )}

          {closed.length > 0 && (
            <Card>
              <CardHeader
                title="Closed"
                description="Kept permanently. The questions, the ratings and the manager of record are exactly as they were."
              />
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Cycle</Th>
                    <Th>Template</Th>
                    <Th>Period</Th>
                    <Th align="right">People</Th>
                    <Th>Closed</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {closed.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <Td>
                        <Link href={`/reviews/cycles/${c.id}`} className="font-medium text-slate-900 hover:underline">
                          {c.name}
                        </Link>
                      </Td>
                      <Td className="text-slate-700">
                        {c.templateVersion.template.name} v{c.templateVersion.versionNumber}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">
                        {formatDate(c.periodStart)} — {formatDate(c.periodEnd)}
                      </Td>
                      <Td align="right" className="tabular-nums">{c._count.participants}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{formatDate(c.closedAt)}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>
                          {CYCLE_STATUS_LABELS[c.status as CycleStatus] ?? c.status}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>
          )}
        </div>
      )}

      <p className="mt-5 text-xs text-slate-500">
        {countLabel(cycles.length, 'cycle')} in total.
      </p>
    </>
  );
}
