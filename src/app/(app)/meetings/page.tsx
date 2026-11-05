import Link from 'next/link';
import { CalendarDays, CalendarPlus, CheckSquare, Clock, Repeat } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listActionItems, listMeetings, listSeries } from '@/server/services/meetings';
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardFooter,
  CardHeader,
  EmptyState,
  Grid,
  PageHeader,
  StatTile,
} from '@/components/ui/primitives';
import { countLabel, formatDate, formatDateTime, fullName, isOverdue, relativeDueLabel } from '@/lib/utils';
import { MEETING_CADENCE_LABELS, type MeetingCadence } from '@/lib/enums';

export const metadata = { title: 'Meetings' };

export default async function MeetingsPage() {
  const actor = await requireActor();

  const [upcoming, past, series, myActions] = await Promise.all([
    listMeetings(actor, { scope: 'mine' }),
    listMeetings(actor, { scope: 'mine', past: true, limit: 12 }),
    listSeries(actor),
    listActionItems(actor, { scope: 'mine' }),
  ]);

  const overdueActions = myActions.filter((a) => a.dueDate && isOverdue(a.dueDate));
  const next = upcoming[0];

  return (
    <>
      <PageHeader
        title="One-to-ones"
        description="Shared agendas, notes and action items. A private note stays with whoever wrote it."
        actions={
          <>
            <ButtonLink href="/meetings/actions">
              <CheckSquare aria-hidden className="h-4 w-4" />
              Action items
            </ButtonLink>
            <ButtonLink href="/meetings/new" variant="primary">
              <CalendarPlus aria-hidden className="h-4 w-4" />
              Schedule one
            </ButtonLink>
          </>
        }
      />

      <Grid cols={4} className="mb-5">
        <StatTile
          label="Next meeting"
          value={next ? formatDate(next.scheduledAt) : '—'}
          hint={next ? next.title : 'Nothing scheduled'}
        />
        <StatTile label="Recurring series" value={series.length} />
        <StatTile label="My open action items" value={myActions.length} href="/meetings/actions" />
        <StatTile
          label="Overdue action items"
          value={overdueActions.length}
          tone={overdueActions.length > 0 ? 'danger' : 'success'}
          href="/meetings/actions"
        />
      </Grid>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Coming up"
              description="Add agenda items before the meeting so there is something to talk about."
            />
            {upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarDays className="h-5 w-5" />}
                title="Nothing scheduled"
                description="A recurring one-to-one is the single most useful habit in this system: unfinished agenda items and actions carry forward automatically."
                action={
                  <ButtonLink href="/meetings/new" variant="primary">
                    Schedule a one-to-one
                  </ButtonLink>
                }
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {upcoming.map((m) => {
                  const others = m.participants.filter((p) => p.employeeId !== actor.employeeId);
                  return (
                    <li key={m.id} className="flex items-start gap-3 px-5 py-3.5">
                      <div className="flex -space-x-2">
                        {others.map((p) => (
                          <Avatar
                            key={p.employeeId}
                            firstName={p.employee.firstName}
                            lastName={p.employee.lastName}
                            size="sm"
                            className="ring-2 ring-white"
                          />
                        ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/meetings/${m.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {m.title}
                        </Link>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Clock aria-hidden className="h-3 w-3" />
                            {formatDateTime(m.scheduledAt)}
                          </span>
                          {m.location && <span>· {m.location}</span>}
                          {m.series && (
                            <span className="inline-flex items-center gap-1">
                              · <Repeat aria-hidden className="h-3 w-3" />
                              {MEETING_CADENCE_LABELS[m.series.cadence as MeetingCadence]}
                            </span>
                          )}
                        </p>
                      </div>
                      <Badge tone={m._count.agendaItems === 0 ? 'warning' : 'neutral'}>
                        {m._count.agendaItems === 0
                          ? 'No agenda yet'
                          : countLabel(m._count.agendaItems, 'item')}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent meetings" description="Notes and actions stay available afterwards." />
            {past.length === 0 ? (
              <EmptyState title="No past meetings" description="Completed meetings appear here with their notes." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {past.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/meetings/${m.id}`} className="font-medium text-slate-900 hover:underline">
                        {m.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDate(m.scheduledAt)} · {countLabel(m._count.agendaItems, 'agenda item')} ·{' '}
                        {countLabel(m._count.actionItems, 'action')}
                      </p>
                    </div>
                    <Badge tone={m.status === 'COMPLETED' ? 'success' : 'neutral'}>
                      {m.status === 'COMPLETED' ? 'Completed' : 'Cancelled'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Recurring series" level={3} />
            {series.length === 0 ? (
              <EmptyState
                title="No recurring one-to-ones"
                description="A series keeps the cadence and carries unfinished items forward."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {series.map((s) => {
                  const other = s.personAId === actor.employeeId ? s.personB : s.personA;
                  const last = s.meetings[0];
                  return (
                    <li key={s.id} className="flex items-center gap-2.5 px-5 py-3">
                      <Avatar firstName={other.firstName} lastName={other.lastName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{fullName(other)}</p>
                        <p className="text-xs text-slate-500">
                          {MEETING_CADENCE_LABELS[s.cadence as MeetingCadence]}
                          {last ? ` · last met ${formatDate(last.scheduledAt)}` : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {myActions.length > 0 && (
            <Card>
              <CardHeader title="My action items" level={3} />
              <ul className="divide-y divide-slate-100">
                {myActions.slice(0, 8).map((a) => (
                  <li key={a.id} className="px-5 py-2.5">
                    <p className="text-sm text-slate-800">{a.title}</p>
                    <p
                      className={
                        a.dueDate && isOverdue(a.dueDate)
                          ? 'mt-0.5 text-xs font-medium text-rose-700'
                          : 'mt-0.5 text-xs text-slate-500'
                      }
                    >
                      {a.dueDate ? relativeDueLabel(a.dueDate) : 'No due date'}
                      {a.meeting ? ` · ${a.meeting.title}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
              <CardFooter>
                <Link href="/meetings/actions" className="text-sm font-medium text-brand-700 hover:underline">
                  All action items
                </Link>
              </CardFooter>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
