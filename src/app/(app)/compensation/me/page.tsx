import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getPayHistory } from '@/server/services/compensation';
import { isAppError } from '@/server/errors';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailItem,
  DetailList,
  EmptyState,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { bandMidpoint, compaRatio, formatMoney } from '@/lib/money';
import { PAY_CHANGE_TYPE_LABELS, type PayChangeType } from '@/lib/enums';
import { formatDate, fullName } from '@/lib/utils';

export const metadata = { title: 'My pay' };

export default async function MyPayPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string }>;
}) {
  const actor = await requireActor();
  const { employee: requested } = await searchParams;
  const employeeId = requested ?? actor.employeeId;

  if (!employeeId) {
    return (
      <>
        <PageHeader title="My pay" />
        <Card>
          <EmptyState
            illustration="withheld"
            title="No employee record attached to this account"
            description="Pay belongs to a person, so this page needs an employee record. A system administrator can link one."
          />
        </Card>
      </>
    );
  }

  let data;
  try {
    data = await getPayHistory(actor, employeeId);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const { employee, records, current, isSelf } = data;
  const band = employee.jobTitle?.salaryBand ?? null;
  const compa =
    current && band
      ? compaRatio(current.baseMinor, band.minMinor, band.maxMinor, band.midMinor)
      : null;
  const midpoint = band ? bandMidpoint(band.minMinor, band.maxMinor, band.midMinor) : null;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Compensation', href: '/compensation' }, { label: isSelf ? 'My pay' : fullName(employee) }]}
        title={isSelf ? 'My pay' : `${fullName(employee)} — pay`}
        description={
          isSelf
            ? 'Your current salary and every change on record.'
            : 'Salary history, visible to you as a compensation administrator.'
        }
        meta={employee.jobTitle ? <Badge tone="neutral">{employee.jobTitle.name}</Badge> : undefined}
      />

      {records.length === 0 ? (
        <Card>
          <EmptyState
            illustration="withheld"
            title="No salary on record"
            description={
              isSelf
                ? 'Nothing has been recorded here yet. That does not mean you are not paid — it means this application has not been given your salary.'
                : 'This employee has no salary on record, so they cannot be included in a compensation cycle.'
            }
          />
        </Card>
      ) : (
        <div className="grid max-w-5xl gap-5 lg:grid-cols-3">
          {/* min-w-0: a grid item defaults to min-width auto, so without this
              the history table refuses to shrink and pushes the whole page
              wider than a phone screen instead of scrolling inside its own
              wrapper. */}
          <div className="min-w-0 space-y-5 lg:col-span-2">
            <Card>
              <CardHeader
                title="Current"
                description={current ? `Effective ${formatDate(current.effectiveDate)}` : undefined}
              />
              <CardBody>
                <p className="font-head text-4xl font-semibold tracking-tight text-slate-900">
                  {formatMoney(current?.baseMinor ?? null, {
                    currency: current?.currency ?? 'USD',
                    whole: true,
                  })}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Annual base salary
                  {current && (
                    <>
                      {' · '}
                      {PAY_CHANGE_TYPE_LABELS[current.changeType as PayChangeType] ??
                        current.changeType}
                    </>
                  )}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="History"
                description="Append-only. A correction appears as its own row rather than altering an earlier one."
              />
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Effective</Th>
                    <Th>Change</Th>
                    <Th align="right">Base salary</Th>
                    <Th>Note</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((r, i) => {
                    const previous = records[i + 1];
                    const delta = previous ? r.baseMinor - previous.baseMinor : null;
                    return (
                      <tr key={r.id}>
                        <Td>{formatDate(r.effectiveDate)}</Td>
                        <Td>
                          <Badge tone={r.changeType === 'CORRECTION' ? 'warning' : 'neutral'}>
                            {PAY_CHANGE_TYPE_LABELS[r.changeType as PayChangeType] ?? r.changeType}
                          </Badge>
                        </Td>
                        <Td align="right">
                          <span className="font-medium text-slate-900">
                            {formatMoney(r.baseMinor, { currency: r.currency, whole: true })}
                          </span>
                          {delta !== null && delta !== 0 && (
                            <span
                              className={
                                'ml-2 text-xs ' +
                                (delta > 0 ? 'text-emerald-700' : 'text-amber-700')
                              }
                            >
                              {delta > 0 ? '+' : '−'}
                              {formatMoney(Math.abs(delta), { currency: r.currency, whole: true })}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <span className="block max-w-[22rem] text-xs leading-relaxed text-slate-600">
                            {r.note ?? '—'}
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            </Card>
          </div>

          <div className="min-w-0 space-y-5">
            {band && (
              <Card>
                <CardHeader title="Your band" level={3} />
                <CardBody>
                  <DetailList cols={1}>
                    <DetailItem label="Range">
                      {formatMoney(band.minMinor, { currency: band.currency, whole: true })} –{' '}
                      {formatMoney(band.maxMinor, { currency: band.currency, whole: true })}
                    </DetailItem>
                    {midpoint && (
                      <DetailItem label="Midpoint">
                        {formatMoney(midpoint.minor, { currency: band.currency, whole: true })}
                        {!midpoint.agreed && (
                          <span className="ml-1.5 text-xs text-slate-500">
                            halfway, no midpoint agreed
                          </span>
                        )}
                      </DetailItem>
                    )}
                    {compa !== null && (
                      <DetailItem label="Position in band">
                        {Math.round(compa * 100)}% of midpoint
                      </DetailItem>
                    )}
                  </DetailList>
                  <p className="mt-3 text-xs leading-relaxed text-slate-600">
                    The band is the range for this job title. Where you sit in it is one input a
                    manager sees when deciding an increase — it is not a target, and being below the
                    midpoint is normal earlier in a role.
                  </p>
                </CardBody>
              </Card>
            )}

            <Card>
              <CardHeader title="Who can see this" level={3} />
              <CardBody>
                <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
                  <li>You, always.</li>
                  <li>A compensation administrator.</li>
                  <li>
                    Your manager sees your <em>current</em> salary only while a pay cycle is open
                    and they are allocating — not this history.
                  </li>
                  <li>
                    Not HR, not a system administrator, not leadership. Those roles do not include
                    salary.
                  </li>
                </ul>
                <Link
                  href="/help/privacy"
                  className="mt-3 inline-block text-sm font-medium text-brand-700 underline"
                >
                  How your information is used
                </Link>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {isSelf && records.length > 0 && (
        <Alert tone="neutral" className="mt-5 max-w-3xl" title="If something here looks wrong">
          Pay records are append-only, so nothing is quietly edited. A correction is recorded as its
          own row with a date and a reason. Raise it with whoever handles payroll and they can add
          one.
        </Alert>
      )}
    </>
  );
}
