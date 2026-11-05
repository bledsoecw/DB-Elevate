import Link from 'next/link';
import { Award, Lock, MessageSquarePlus, Send, ShieldQuestion } from 'lucide-react';
import { prisma } from '@/server/db';
import { requireActor } from '@/server/authz/actor';
import { listFeedback, type FeedbackItem } from '@/server/services/feedback';
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  LinkTabs,
  PageHeader,
  ProseText,
} from '@/components/ui/primitives';
import { formatRelativeTime, relativeDueLabel, truncate } from '@/lib/utils';
import { FEEDBACK_KIND_LABELS, FEEDBACK_VISIBILITY_LABELS, type FeedbackKind, type FeedbackVisibility } from '@/lib/enums';

export const metadata = { title: 'Feedback' };

function FeedbackRow({ item, showAbout }: { item: FeedbackItem; showAbout: boolean }) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {item.recognition ? (
          <Badge tone="accent">
            <Award aria-hidden className="h-3 w-3" />
            {item.recognition.name}
          </Badge>
        ) : (
          <Badge tone={item.kind === 'PRIVATE_NOTE' ? 'muted' : 'neutral'}>
            {item.kind === 'PRIVATE_NOTE' && <Lock aria-hidden className="h-3 w-3" />}
            {FEEDBACK_KIND_LABELS[item.kind as FeedbackKind] ?? item.kind}
          </Badge>
        )}
        {showAbout && (
          <span className="text-sm text-slate-700">
            about{' '}
            <Link href={`/people/${item.aboutEmployeeId}`} className="font-medium hover:underline">
              {item.aboutName}
            </Link>
          </span>
        )}
        <span className="text-xs text-slate-500">
          {item.authorIsHidden
            ? item.authorVisibility === 'ANONYMOUS'
              ? 'Anonymous — no author was recorded'
              : 'Name withheld'
            : `by ${item.authorName}`}
          {' · '}
          {formatRelativeTime(item.createdAt)}
        </span>
      </div>

      <ProseText className="mt-2">{item.body}</ProseText>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.competencyName && <Badge tone="info">{item.competencyName}</Badge>}
        {item.goalTitle && (
          <Badge tone="brand" title={item.goalTitle}>
            {truncate(item.goalTitle, 44)}
          </Badge>
        )}
        {item.projectTag && <Badge tone="neutral">{item.projectTag}</Badge>}
        <span className="ml-auto text-[11px] text-slate-400">
          {FEEDBACK_VISIBILITY_LABELS[item.visibility as FeedbackVisibility] ?? item.visibility}
        </span>
      </div>
    </li>
  );
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const actor = await requireActor();
  const sp = await searchParams;

  const view = (
    ['about-me', 'written-by-me', 'my-notes', 'recognition', 'team', 'all'].includes(sp.view ?? '')
      ? sp.view
      : 'about-me'
  ) as 'about-me' | 'written-by-me' | 'my-notes' | 'recognition' | 'team' | 'all';

  const [items, aboutMe, byMe, notes, requests] = await Promise.all([
    listFeedback(actor, { view }),
    listFeedback(actor, { view: 'about-me', limit: 200 }),
    listFeedback(actor, { view: 'written-by-me', limit: 200 }),
    listFeedback(actor, { view: 'my-notes', limit: 200 }),
    actor.employeeId
      ? prisma.feedbackRequest.findMany({
          where: {
            orgId: actor.orgId,
            status: 'PENDING',
            OR: [
              { responderEmployeeId: actor.employeeId },
              { requesterEmployeeId: actor.employeeId },
            ],
          },
          orderBy: { createdAt: 'desc' },
          include: {
            requester: { select: { firstName: true, lastName: true, preferredName: true } },
            responder: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
            about: { select: { id: true, firstName: true, lastName: true, preferredName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const toAnswer = requests.filter((r) => r.responderEmployeeId === actor.employeeId);
  const awaiting = requests.filter((r) => r.requesterEmployeeId === actor.employeeId);

  const tabs = [
    { key: 'about-me', label: 'About me', href: '/feedback?view=about-me', count: aboutMe.length },
    { key: 'written-by-me', label: 'I wrote', href: '/feedback?view=written-by-me', count: byMe.length },
    { key: 'my-notes', label: 'My private notes', href: '/feedback?view=my-notes', count: notes.length },
    { key: 'recognition', label: 'Recognition wall', href: '/feedback?view=recognition' },
    ...(actor.isManager || actor.isHrAdmin
      ? [{ key: 'team', label: 'My team', href: '/feedback?view=team' }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Feedback"
        description="Recognition, constructive feedback and private notes. Every form says who will see it before you submit."
        actions={
          <>
            <ButtonLink href="/feedback/request">
              <ShieldQuestion aria-hidden className="h-4 w-4" />
              Ask for feedback
            </ButtonLink>
            <ButtonLink href="/feedback/new" variant="primary">
              <MessageSquarePlus aria-hidden className="h-4 w-4" />
              Give feedback
            </ButtonLink>
          </>
        }
      />

      {toAnswer.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title="People waiting on you"
            description="Feedback somebody has asked you for."
            actions={<Badge tone="warning">{toAnswer.length}</Badge>}
          />
          <ul className="divide-y divide-slate-100">
            {toAnswer.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar firstName={r.about.firstName} lastName={r.about.lastName} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900">
                      <span className="font-medium">
                        {r.requester.preferredName || r.requester.firstName}
                      </span>{' '}
                      asked for feedback about{' '}
                      <span className="font-medium">
                        {r.about.preferredName || r.about.firstName} {r.about.lastName}
                      </span>
                    </p>
                    {r.message && (
                      <p className="mt-0.5 text-xs text-slate-600">{truncate(r.message, 140)}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {r.dueAt && <span className="text-xs text-slate-500">{relativeDueLabel(r.dueAt)}</span>}
                  <ButtonLink href={`/feedback/requests/${r.id}`} size="sm" variant="primary">
                    Respond
                  </ButtonLink>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {awaiting.length > 0 && view === 'written-by-me' && (
        <Card className="mb-5">
          <CardHeader title="Requests you have sent" description="Still waiting for a response." />
          <ul className="divide-y divide-slate-100">
            {awaiting.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="text-slate-700">
                  Asked {r.responder.preferredName || r.responder.firstName} about{' '}
                  {r.about.preferredName || r.about.firstName}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Send aria-hidden className="h-3 w-3" />
                  {formatRelativeTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <LinkTabs tabs={tabs} current={view} className="mb-5" />

      {view === 'my-notes' && (
        <Card className="mb-4">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Lock aria-hidden className="h-4 w-4 text-slate-400" />
                Private notes
              </span>
            }
            description="Visible to you and to nobody else. No role overrides this — not HR, not a system administrator. Useful for keeping dated specifics so a review is written from notes rather than memory."
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title={
            view === 'about-me'
              ? 'Feedback about me'
              : view === 'written-by-me'
                ? 'Feedback I have written'
                : view === 'my-notes'
                  ? 'My private notes'
                  : view === 'recognition'
                    ? 'Recognition'
                    : 'My team'
          }
          description={
            view === 'about-me'
              ? 'What people have shared with you. Private notes other people keep about you are not here, and never will be.'
              : undefined
          }
        />
        {items.length === 0 ? (
          <EmptyState
            illustration="feedback"
            icon={<MessageSquarePlus className="h-5 w-5" />}
            title="Nothing here yet"
            description={
              view === 'about-me'
                ? 'When someone shares feedback with you it appears here. You can also ask for it.'
                : view === 'my-notes'
                  ? 'Keep a dated note when something happens and the annual review writes itself.'
                  : 'Nothing to show.'
            }
            action={
              <>
                <ButtonLink href="/feedback/new" variant="primary">
                  Give feedback
                </ButtonLink>
                <ButtonLink href="/feedback/request">Ask for feedback</ButtonLink>
              </>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <FeedbackRow key={item.id} item={item} showAbout={view !== 'about-me'} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
