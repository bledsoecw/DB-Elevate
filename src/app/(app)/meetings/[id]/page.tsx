import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Clock, Eye, EyeOff, MapPin, Repeat } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { getMeeting } from '@/server/services/meetings';
import { listGoals } from '@/server/services/goals';
import { prisma } from '@/server/db';
import { isAppError } from '@/server/errors';
import {
  Alert,
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailItem,
  DetailList,
  PageHeader,
} from '@/components/ui/primitives';
import { AgendaPanel, NotesPanel, ActionsPanel, CompleteMeetingButton } from './panels';
import { formatDate, formatDateTime, fullName } from '@/lib/utils';
import { MEETING_CADENCE_LABELS, type MeetingCadence } from '@/lib/enums';

export const metadata = { title: 'One-to-one' };

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getMeeting>>;
  try {
    data = await getMeeting(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }

  const { meeting, isParticipant, hrObserverOnly, canEdit } = data;
  const others = meeting.participants.filter((p) => p.employeeId !== actor.employeeId);

  // Goals belonging to either participant, for linking an agenda item.
  const [goals, people] = await Promise.all([
    Promise.all(
      meeting.participants.map((p) => listGoals(actor, { ownerEmployeeId: p.employeeId })),
    ).then((lists) => lists.flat()),
    prisma.employee.findMany({
      where: { id: { in: meeting.participants.map((p) => p.employeeId) } },
      select: { id: true, firstName: true, lastName: true, preferredName: true },
    }),
  ]);

  const openAgenda = meeting.agendaItems.filter((a) => a.status === 'OPEN').length;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Meetings', href: '/meetings' }, { label: meeting.title }]}
        title={meeting.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Clock aria-hidden className="h-3.5 w-3.5 text-slate-400" />
              {formatDateTime(meeting.scheduledAt)} · {meeting.durationMinutes} min
            </span>
            {meeting.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                {meeting.location}
              </span>
            )}
            {meeting.series && (
              <span className="inline-flex items-center gap-1.5">
                <Repeat aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                {MEETING_CADENCE_LABELS[meeting.series.cadence as MeetingCadence]}
              </span>
            )}
          </span>
        }
        meta={
          <>
            <Badge
              tone={
                meeting.status === 'COMPLETED' ? 'success' : meeting.status === 'CANCELLED' ? 'neutral' : 'info'
              }
            >
              {meeting.status === 'COMPLETED'
                ? `Completed ${formatDate(meeting.completedAt)}`
                : meeting.status === 'CANCELLED'
                  ? 'Cancelled'
                  : 'Scheduled'}
            </Badge>
            {others.map((p) => (
              <span key={p.employeeId} className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                <Avatar firstName={p.employee.firstName} lastName={p.employee.lastName} size="xs" />
                <Link href={`/people/${p.employeeId}`} className="hover:underline">
                  {fullName(p.employee)}
                </Link>
              </span>
            ))}
          </>
        }
        actions={
          canEdit && meeting.status === 'SCHEDULED' ? (
            <CompleteMeetingButton
              meetingId={id}
              openAgendaCount={openAgenda}
              hasSeries={meeting.seriesId !== null}
            />
          ) : undefined
        }
      />

      {hrObserverOnly && (
        <Alert tone="neutral" className="mb-5" icon={<EyeOff className="h-4 w-4" />} title="Administrator view">
          You are not in this meeting. You can see that it happened and what was agreed as action
          items, which is what participation reporting needs. The notes are not shown to you.
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <AgendaPanel
            meetingId={id}
            canEdit={canEdit}
            items={meeting.agendaItems.map((a) => ({
              id: a.id,
              title: a.title,
              notes: a.notes,
              status: a.status,
              carriedFrom: a.carriedFromId !== null,
              createdByName: fullName(a.createdBy),
              goalId: a.goalId,
              goalTitle: a.goal?.title ?? null,
            }))}
            goals={goals.map((g) => ({ id: g.id, title: g.title }))}
          />

          {!hrObserverOnly && (
            <NotesPanel
              meetingId={id}
              canEdit={canEdit}
              currentEmployeeId={actor.employeeId}
              notes={meeting.notes.map((n) => ({
                id: n.id,
                body: n.body,
                visibility: n.visibility,
                authorEmployeeId: n.authorEmployeeId,
                authorName: fullName(n.author),
                authorFirstName: n.author.firstName,
                authorLastName: n.author.lastName,
                updatedAt: n.updatedAt.toISOString(),
              }))}
            />
          )}
        </div>

        <aside className="space-y-5">
          <ActionsPanel
            meetingId={id}
            canEdit={canEdit}
            people={people}
            defaultOwnerId={actor.employeeId ?? ''}
            items={meeting.actionItems.map((a) => ({
              id: a.id,
              title: a.title,
              description: a.description,
              status: a.status,
              dueDate: a.dueDate ? a.dueDate.toISOString() : null,
              ownerName: fullName(a.owner),
              ownerId: a.ownerEmployeeId,
              assignedByName: a.assignedBy ? fullName(a.assignedBy) : null,
              goalTitle: a.goal?.title ?? null,
            }))}
          />

          <Card>
            <CardHeader title="In this meeting" level={3} />
            <CardBody>
              <DetailList cols={1}>
                {meeting.participants.map((p) => (
                  <DetailItem key={p.employeeId} label={p.role === 'ORGANIZER' ? 'Organizer' : 'Attendee'}>
                    <Link
                      href={`/people/${p.employeeId}`}
                      className="inline-flex items-center gap-2 hover:underline"
                    >
                      <Avatar firstName={p.employee.firstName} lastName={p.employee.lastName} size="xs" />
                      {fullName(p.employee)}
                    </Link>
                    {p.employee.jobTitle && (
                      <span className="mt-0.5 block text-xs text-slate-500">{p.employee.jobTitle.name}</span>
                    )}
                  </DetailItem>
                ))}
              </DetailList>
            </CardBody>
          </Card>

          {isParticipant && (
            <Card>
              <CardBody>
                <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
                  <Eye aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <span>
                    Shared notes are visible to both of you. A private note is visible only to the
                    person who wrote it — no role overrides that, including HR and system
                    administrators.
                  </span>
                </p>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
