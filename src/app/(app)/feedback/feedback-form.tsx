'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Award, Eye, Lock, Send, UserX } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { FormActions, FormError, Input, RadioGroup, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import {
  AUTHOR_VISIBILITIES,
  AUTHOR_VISIBILITY_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_VISIBILITIES,
  FEEDBACK_VISIBILITY_LABELS,
  type AuthorVisibility,
  type FeedbackKind,
  type FeedbackVisibility,
} from '@/lib/enums';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
}

/**
 * Giving feedback.
 *
 * The audience and the authorship setting are chosen before writing, and the
 * consequence of each is spelled out in a panel that updates as the choice
 * changes. The intent is that nobody submits feedback having misunderstood who
 * will read it or whether their name is attached.
 */
export function FeedbackForm({
  people,
  competencies,
  recognitionValues,
  goals,
  defaults,
  requestId,
  lockAbout,
}: {
  people: Person[];
  competencies: { id: string; name: string }[];
  recognitionValues: { id: string; name: string; description: string | null }[];
  goals: { id: string; title: string }[];
  defaults: { aboutEmployeeId?: string; kind?: string; visibility?: string };
  requestId?: string;
  lockAbout?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [aboutEmployeeId, setAbout] = useState(defaults.aboutEmployeeId ?? '');
  const [kind, setKind] = useState(defaults.kind ?? 'RECOGNITION');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState(defaults.visibility ?? 'ORGANIZATION');
  const [authorVisibility, setAuthorVisibility] = useState('NAMED');
  const [competencyId, setCompetencyId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [projectTag, setProjectTag] = useState('');
  const [recognitionValueId, setRecognitionValueId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPrivateNote = visibility === 'PRIVATE_NOTE_SELF';
  const isRecognition = kind === 'RECOGNITION';

  // The guarantees differ, so the options offered differ too.
  const authorOptions = AUTHOR_VISIBILITIES.filter((a) => {
    if (isRecognition) return a === 'NAMED';
    if (isPrivateNote) return a === 'NAMED';
    if (a === 'ANONYMOUS') return visibility === 'HR_ONLY';
    return true;
  });

  const aboutName = (() => {
    const p = people.find((x) => x.id === aboutEmployeeId);
    return p ? `${p.preferredName || p.firstName} ${p.lastName}` : 'this person';
  })();

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/feedback', {
        aboutEmployeeId,
        kind: isPrivateNote ? 'PRIVATE_NOTE' : kind,
        body,
        visibility,
        authorVisibility: authorOptions.includes(authorVisibility as AuthorVisibility)
          ? authorVisibility
          : 'NAMED',
        competencyId: competencyId || null,
        goalId: goalId || null,
        projectTag: projectTag || null,
        recognitionValueId: isRecognition ? recognitionValueId || null : null,
        requestId: requestId ?? null,
      });
      toast.success(
        isPrivateNote ? 'Private note saved' : 'Feedback shared',
        isPrivateNote ? 'Only you can see it.' : undefined,
      );
      router.push(requestId ? '/feedback' : `/feedback?view=written-by-me`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="max-w-3xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormError message={error} />

      <Card>
        <CardHeader title="Who and what" />
        <CardBody className="space-y-4">
          <Select
            label="Who is this about?"
            required
            value={aboutEmployeeId}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="Choose a person"
            disabled={lockAbout}
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.preferredName || p.firstName} {p.lastName}
              </option>
            ))}
          </Select>

          <RadioGroup
            name="kind"
            legend="What kind of feedback is this?"
            value={isPrivateNote ? 'PRIVATE_NOTE' : (kind as FeedbackKind)}
            onChange={(value) => {
              setKind(value);
              if (value === 'PRIVATE_NOTE') {
                setVisibility('PRIVATE_NOTE_SELF');
                setAuthorVisibility('NAMED');
              } else if (visibility === 'PRIVATE_NOTE_SELF') {
                setVisibility('RECIPIENT_AND_MANAGER');
              }
              if (value === 'RECOGNITION') {
                setVisibility('ORGANIZATION');
                setAuthorVisibility('NAMED');
              }
            }}
            columns={2}
            options={FEEDBACK_KINDS.filter((k) => k !== 'REQUEST_RESPONSE').map((k) => ({
              value: k,
              label: FEEDBACK_KIND_LABELS[k],
              description:
                k === 'RECOGNITION'
                  ? 'Something that deserves saying out loud.'
                  : k === 'CONSTRUCTIVE'
                    ? 'Something that needs to change, with an example.'
                    : k === 'PRIVATE_NOTE'
                      ? 'A note to yourself. Nobody else ever sees it.'
                      : 'Anything else worth recording.',
            }))}
          />

          {isRecognition && recognitionValues.length > 0 && (
            <Select
              label="Which of our values does this show?"
              required={false}
              value={recognitionValueId}
              onChange={(e) => setRecognitionValueId(e.target.value)}
              placeholder="None in particular"
            >
              {recognitionValues.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.description ? ` — ${r.description}` : ''}
                </option>
              ))}
            </Select>
          )}

          <Textarea
            label={isPrivateNote ? 'Your note' : 'Your feedback'}
            required
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            help={
              isPrivateNote
                ? 'Dates and specifics now save you guessing at review time.'
                : 'Name the job, the date and what actually happened. Feedback without an example is hard to act on.'
            }
            maxLength={10000}
            hint={`${body.length} / 10000`}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Competency"
              required={false}
              value={competencyId}
              onChange={(e) => setCompetencyId(e.target.value)}
              placeholder="None"
            >
              {competencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select
              label="Goal"
              required={false}
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              placeholder="None"
            >
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </Select>
            <Input
              label="Project or job"
              required={false}
              value={projectTag}
              onChange={(e) => setProjectTag(e.target.value)}
              placeholder="e.g. Riverbend Addition"
            />
          </div>
        </CardBody>
      </Card>

      {!isPrivateNote && (
        <Card>
          <CardHeader
            title="Who will see this"
            description="Decide before you write, not after. This is enforced everywhere, including reports."
          />
          <CardBody className="space-y-4">
            <Select
              label="Audience"
              required
              value={visibility}
              onChange={(e) => {
                setVisibility(e.target.value);
                if (e.target.value !== 'HR_ONLY' && authorVisibility === 'ANONYMOUS') {
                  setAuthorVisibility('CONFIDENTIAL');
                }
              }}
            >
              {FEEDBACK_VISIBILITIES.filter((v) => v !== 'PRIVATE_NOTE_SELF').map((v) => (
                <option key={v} value={v}>
                  {FEEDBACK_VISIBILITY_LABELS[v as FeedbackVisibility]}
                </option>
              ))}
            </Select>

            <RadioGroup
              name="authorVisibility"
              legend="Your name"
              value={authorVisibility as AuthorVisibility}
              onChange={(value) => setAuthorVisibility(value)}
              options={authorOptions.map((a) => ({
                value: a,
                label: AUTHOR_VISIBILITY_LABELS[a].split('—')[0]?.trim() ?? a,
                description: AUTHOR_VISIBILITY_LABELS[a].split('—')[1]?.trim(),
              }))}
            />

            {authorVisibility === 'ANONYMOUS' && (
              <Alert tone="warning" icon={<UserX className="h-4 w-4" />} title="This is irreversible">
                Your name will not be stored on this record at all. Nobody can recover it later —
                not HR, not a system administrator, not whoever runs the database. If you may need to
                be contacted about it, choose confidential instead.
              </Alert>
            )}
            {authorVisibility === 'CONFIDENTIAL' && (
              <Alert tone="neutral" icon={<Eye className="h-4 w-4" />} title="What confidential means here">
                Your name is stored and HR administrators can see it. {aboutName} and their manager
                cannot.
              </Alert>
            )}
            {isRecognition && (
              <Alert tone="neutral" icon={<Award className="h-4 w-4" />}>
                Recognition is always named — that is what makes it recognition.
              </Alert>
            )}
          </CardBody>
        </Card>
      )}

      {isPrivateNote && (
        <Alert tone="neutral" icon={<Lock className="h-4 w-4" />} title="This note is yours alone">
          Nobody else can read it. No role overrides that, including HR and system administrators. It
          is not included in exports and does not appear on {aboutName}&rsquo;s record.
        </Alert>
      )}

      <FormActions>
        <Button
          type="submit"
          variant="primary"
          icon={<Send className="h-4 w-4" />}
          loading={loading}
          disabled={!aboutEmployeeId || body.trim().length < 10}
        >
          {isPrivateNote ? 'Save note' : 'Share feedback'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
