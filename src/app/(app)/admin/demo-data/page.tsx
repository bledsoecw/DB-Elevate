import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Database } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { demoDataSummary } from '@/server/services/admin';
import { prisma } from '@/server/db';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { countLabel } from '@/lib/utils';
import { RemoveDemoDataForm } from './remove-form';

export const metadata = { title: 'Demonstration data' };

const LABELS: Record<string, string> = {
  employees: 'Employee records',
  accounts: 'Sign-in accounts',
  cycles: 'Review cycles (with their reviews, scores and history)',
  goals: 'Goals (with their progress updates)',
  feedback: 'Feedback and recognition',
  feedbackRequests: 'Feedback requests',
  meetingSeries: 'One-on-one series',
  meetings: 'One-on-one meetings (with agendas and notes)',
  actionItems: 'Action items',
  surveys: 'Surveys (with invitations and responses)',
  plans: 'Development and improvement plans',
};

export default async function DemoDataPage() {
  const actor = await requireActor();
  if (!actor.isSysAdmin) redirect('/admin');

  const summary = await demoDataSummary(actor);

  // Whether the signed-in administrator is themselves demonstration data
  // decides whether removal is even offered.
  const selfIsDemo = actor.employeeId
    ? Boolean(
        await prisma.employee.findFirst({
          where: { id: actor.employeeId, isDemoData: true },
          select: { id: true },
        }),
      )
    : false;

  const rows = Object.entries(summary.counts).filter(([, n]) => n > 0);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Demonstration data' }]}
        title="Demonstration data"
        description="The synthetic construction company this installation ships with, so the application is explorable before a single real record exists."
        actions={
          <Badge tone={summary.total > 0 ? 'info' : 'success'}>
            {summary.total > 0 ? `${summary.total} records` : 'None present'}
          </Badge>
        }
      />

      {summary.total === 0 ? (
        <Card>
          <EmptyState
            icon={<Database className="h-5 w-5" />}
            title="No demonstration data"
            description="This installation holds only real records. Nothing to remove."
          />
        </Card>
      ) : (
        <div className="max-w-4xl space-y-5">
          <Alert tone="neutral" title="Every demonstration record is flagged in the database">
            Each one carries an <span className="font-mono text-xs">isDemoData</span> flag set when it
            was seeded, which is how this page can count them exactly rather than guessing from a name
            pattern. Names, e-mail addresses and review text are invented; the e-mail domain is{' '}
            <span className="font-mono text-xs">.example</span>, which cannot receive mail. No real
            person is described anywhere in it.
          </Alert>

          <Card>
            <CardHeader
              title="What would be removed"
              description="Everything below, plus the records that belong to them — a cycle takes its reviews, answers, scores and audit links with it."
            />
            <TableWrap>
                <thead>
                  <tr>
                    <Th>Record type</Th>
                    <Th align="right">Count</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(([key, count]) => (
                    <tr key={key}>
                      <Td>{LABELS[key] ?? key}</Td>
                      <Td align="right" className="font-medium">
                        {count}
                      </Td>
                    </tr>
                  ))}
                </tbody>
            </TableWrap>
          </Card>

          <Card>
            <CardHeader
              title="What would be kept"
              description="The configuration is a sensible starting point for a real rollout, so it survives. If you have edited any of it, your edits are safe."
            />
            <CardBody>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {summary.keeps.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span
                      aria-hidden
                      className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                Your organization settings, branding and the audit log are also kept. The audit log
                keeps its entries about the demonstration records on purpose: deleting history to tidy
                up is exactly what an append-only log exists to prevent.
              </p>
            </CardBody>
          </Card>

          {summary.realEmployees > 0 ? (
            <p className="text-sm text-slate-600">
              This installation also holds {countLabel(summary.realEmployees, 'real employee record')}.
              Those are untouched.
            </p>
          ) : (
            <Alert tone="warning" title="There are no real records yet">
              Removing the demonstration data now would leave an empty application. If you have not yet
              imported your own people, start at{' '}
              <Link href="/people/import" className="font-medium underline">
                People → Import
              </Link>{' '}
              and come back afterwards.
            </Alert>
          )}

          <RemoveDemoDataForm
            total={summary.total}
            selfIsDemo={selfIsDemo}
            hasRealEmployees={summary.realEmployees > 0}
          />
        </div>
      )}
    </>
  );
}
