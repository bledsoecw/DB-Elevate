import Link from 'next/link';
import { BarChart3, EyeOff, Lock, Plus, Users } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { listSurveys } from '@/server/services/surveys';
import { prisma } from '@/server/db';
import { canManageSurveys, canViewSurveyResults } from '@/server/authz/policy';
import {
  Alert,
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
import { formatDate, relativeDueLabel } from '@/lib/utils';
import { SURVEY_STATUS_LABELS, type SurveyStatus } from '@/lib/enums';

export const metadata = { title: 'Surveys' };

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  OPEN: 'success',
  CLOSED: 'neutral',
  ARCHIVED: 'neutral',
};

export default async function SurveysPage() {
  const actor = await requireActor();
  const isAdmin = canManageSurveys(actor);

  const [surveys, myInvitations] = await Promise.all([
    listSurveys(actor),
    actor.employeeId
      ? prisma.surveyInvitation.findMany({
          where: {
            employeeId: actor.employeeId,
            status: { in: ['PENDING', 'NOTIFIED'] },
            survey: { status: 'OPEN' },
          },
          include: { survey: { select: { id: true, title: true, mode: true, closesAt: true, description: true } } },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Surveys"
        description={
          isAdmin
            ? 'Engagement and pulse surveys. An anonymous survey cannot be de-anonymized later — the mode is fixed when it launches.'
            : 'Surveys you have been invited to.'
        }
        actions={
          isAdmin ? (
            <ButtonLink href="/surveys/new" variant="primary">
              <Plus aria-hidden className="h-4 w-4" />
              New survey
            </ButtonLink>
          ) : undefined
        }
      />

      {myInvitations.length > 0 && (
        <Card className="mb-5">
          <CardHeader title="Waiting for your response" />
          <ul className="divide-y divide-slate-100">
            {myInvitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{inv.survey.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    {inv.survey.mode === 'ANONYMOUS' ? (
                      <Badge tone="success">
                        <EyeOff aria-hidden className="h-3 w-3" />
                        Anonymous
                      </Badge>
                    ) : (
                      <Badge tone="warning">
                        <Users aria-hidden className="h-3 w-3" />
                        Named
                      </Badge>
                    )}
                    {inv.survey.closesAt && <span>{relativeDueLabel(inv.survey.closesAt)}</span>}
                  </p>
                </div>
                <ButtonLink href={`/surveys/respond/${inv.survey.id}`} variant="primary" size="sm">
                  Respond
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          title={isAdmin ? 'All surveys' : 'Surveys I was invited to'}
          description={
            isAdmin
              ? 'Results for an anonymous survey are withheld until enough people have answered, and small groups stay hidden in every view and export.'
              : undefined
          }
        />
        {surveys.length === 0 ? (
          <EmptyState
            illustration="results"
            icon={<BarChart3 className="h-5 w-5" />}
            title={isAdmin ? 'No surveys yet' : 'No surveys'}
            description={
              isAdmin
                ? 'A short, honest survey that people trust is worth more than a long one they do not. Start with the engagement template.'
                : 'When you are invited to a survey it will appear here and in your task list.'
            }
            action={
              isAdmin ? (
                <ButtonLink href="/surveys/new" variant="primary">
                  Create a survey
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Survey</Th>
                <Th>Mode</Th>
                <Th>Status</Th>
                <Th>Window</Th>
                <Th align="right">Responses</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {surveys.map((s) => {
                const below = s._count.responses < s.minResponsesForResults;
                const canSeeResults = canViewSurveyResults(actor);
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/surveys/${s.id}`} className="font-medium text-slate-900 hover:underline">
                        {s.title}
                      </Link>
                      {s.description && (
                        <span className="mt-0.5 block max-w-md text-xs text-slate-600">{s.description}</span>
                      )}
                    </Td>
                    <Td>
                      {s.mode === 'ANONYMOUS' ? (
                        <Badge tone="success">
                          <EyeOff aria-hidden className="h-3 w-3" />
                          Anonymous
                        </Badge>
                      ) : (
                        <Badge tone="warning">Named</Badge>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>
                        {SURVEY_STATUS_LABELS[s.status as SurveyStatus] ?? s.status}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-slate-600">
                      {s.opensAt ? formatDate(s.opensAt) : '—'} → {s.closesAt ? formatDate(s.closesAt) : '—'}
                    </Td>
                    <Td align="right" className="tabular-nums text-slate-700">
                      {s._count.responses} / {s._count.invitations}
                    </Td>
                    <Td align="right">
                      {canSeeResults && s.status !== 'DRAFT' ? (
                        below && s.mode === 'ANONYMOUS' ? (
                          <Badge tone="neutral" title={`Hidden until ${s.minResponsesForResults} people respond.`}>
                            <Lock aria-hidden className="h-3 w-3" />
                            Results hidden
                          </Badge>
                        ) : (
                          <Link href={`/surveys/${s.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                            Results
                          </Link>
                        )
                      ) : (
                        <Link href={`/surveys/${s.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                          Open
                        </Link>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {isAdmin && (
        <Alert tone="neutral" className="mt-5" title="How anonymity is protected here">
          <ul className="mt-1 space-y-1">
            <li>
              An anonymous response is stored with no respondent identity at all. Participation is
              recorded separately and the two cannot be joined.
            </li>
            <li>
              Nothing is shown until the survey reaches its minimum response count, and any group
              below that count stays hidden.
            </li>
            <li>
              Where hiding one group would let it be worked out by subtraction, a second group is
              hidden too.
            </li>
            <li>Written answers are only ever shown unfiltered, in a shuffled order.</li>
            <li>Exports go through the same rules as the screen.</li>
          </ul>
        </Alert>
      )}
    </>
  );
}
