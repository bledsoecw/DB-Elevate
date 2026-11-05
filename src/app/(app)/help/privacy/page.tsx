import { requireActor } from '@/server/authz/actor';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/primitives';

export const metadata = { title: 'How your information is used' };

/**
 * Plain-language privacy explanation, written for the people whose records
 * these are rather than for lawyers. It mirrors docs/PRIVACY.md.
 */
export default async function PrivacyHelpPage() {
  const actor = await requireActor();

  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: 'Reviews you are writing',
      body: (
        <>
          While you are writing a review it is a draft, and a draft is private to you. Your manager
          cannot read it. HR cannot read it. Nobody sees a word of it until you press Submit. If you
          close the page halfway through, what you have typed is saved and is still only yours.
        </>
      ),
    },
    {
      title: 'Reviews about you',
      body: (
        <>
          Your manager writes your review, and an approver may be asked to check it. You see it when
          HR releases it to you — not before. Once released it cannot be edited; a correction means a
          new record, not a silent change. Acknowledging a review records that you received it. It
          does not record that you agree, and you can add a comment that is stored with it
          permanently.
        </>
      ),
    },
    {
      title: 'Peer and 360 feedback',
      body: (
        <>
          How peer feedback is shown is set per cycle and is stated on the form before you write
          anything. It is one of three: your name is shown; your name is recorded but hidden from the
          person it is about; or responses are only ever shown combined with others, in which case
          nobody sees your individual answers.
        </>
      ),
    },
    {
      title: 'Feedback you give',
      body: (
        <>
          Every feedback form says who will see it before you submit. <strong>Named</strong> shows
          your name to everyone who can see it. <strong>Confidential</strong> hides your name from the
          recipient and their manager, but HR administrators can see it. <strong>Anonymous</strong>{' '}
          does not store your name at all — nobody can recover it, including HR, and it is only
          available for feedback sent to HR.
        </>
      ),
    },
    {
      title: 'Private notes',
      body: (
        <>
          A private note — in feedback or on a one-to-one — is visible to the person who wrote it and
          to nobody else. No role overrides this, including HR and system administrators.
        </>
      ),
    },
    {
      title: 'Anonymous surveys',
      body: (
        <>
          When a survey is marked anonymous, your answers are stored with no link to you. The system
          records separately that you took part, so participation can be chased, but the two records
          cannot be joined. Results are only shown once enough people have answered, groups smaller
          than that threshold are hidden, and a second group is hidden too where the first could
          otherwise be worked out by subtraction. Written answers are only ever shown unfiltered and
          in a shuffled order. These restrictions apply to exports as well as to the screen.
        </>
      ),
    },
    {
      title: 'Who can see your records',
      body: (
        <>
          You can always see your own. Your manager can see the records of people in their reporting
          line. HR administrators administer the performance programme and can see the records it
          contains. A system administrator manages accounts, branding and the audit log, and does{' '}
          <strong>not</strong> get access to review content unless they are also given the HR role.
          Leadership sees aggregate reporting, not individual drafts or private notes.
        </>
      ),
    },
    {
      title: 'If you change manager',
      body: (
        <>
          A past review stays with the manager who wrote it. A new manager does not gain access to
          reviews written before the transfer, and the previous manager keeps the record they wrote.
          Reporting-line changes are recorded with a date and a reason.
        </>
      ),
    },
    {
      title: 'If your account is deactivated',
      body: (
        <>
          Sign-in stops immediately. Your reviews, goals and feedback are kept as the employment
          record, visible to the same people who could already see them.
        </>
      ),
    },
    {
      title: 'What is logged',
      body: (
        <>
          Significant actions are recorded: signing in, submitting, approving, releasing and
          acknowledging a review, changing a reporting line, launching a survey. The log records that
          something happened and who did it. It does not record the text of a review answer, a
          private note, or who submitted an anonymous survey response.
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="How your information is used"
        description={`What ${actor.org.productName} stores about you, who can see it, and what is deliberately never recorded.`}
      />
      <div className="space-y-4">
        {sections.map((s) => (
          <Card key={s.title}>
            <CardHeader title={s.title} />
            <CardBody>
              <p className="max-w-3xl text-sm leading-relaxed text-slate-700">{s.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      <p className="mt-6 max-w-3xl text-xs leading-relaxed text-slate-500">
        These are the rules the application enforces, not a statement of intent. They are implemented
        in one place on the server and are covered by automated tests; see docs/PERMISSIONS.md and
        docs/PRIVACY.md in the source for the full matrix and the reasoning.
      </p>
    </>
  );
}
