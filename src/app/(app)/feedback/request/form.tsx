'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { FormActions, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { FEEDBACK_VISIBILITIES, FEEDBACK_VISIBILITY_LABELS, type FeedbackVisibility } from '@/lib/enums';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
}

/**
 * Asking for feedback.
 *
 * The audience the response will take is chosen here, by the requester, and is
 * shown to the responder before they write — so nobody writes something for a
 * manager's eyes that then goes to the whole company, or the reverse.
 */
export function RequestFeedbackForm({
  people,
  subjects,
  competencies,
  goals,
  defaultSubjectId,
}: {
  people: Person[];
  subjects: Person[];
  competencies: { id: string; name: string }[];
  goals: { id: string; title: string }[];
  defaultSubjectId: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [responderEmployeeId, setResponder] = useState('');
  const [aboutEmployeeId, setAbout] = useState(defaultSubjectId);
  const [message, setMessage] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [competencyId, setCompetencyId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [projectTag, setProjectTag] = useState('');
  const [responseVisibility, setResponseVisibility] = useState('RECIPIENT_AND_MANAGER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aboutSelf = aboutEmployeeId === defaultSubjectId;

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/feedback/requests', {
        responderEmployeeId,
        aboutEmployeeId,
        message: message.trim() || null,
        dueAt: dueAt || null,
        competencyId: competencyId || null,
        goalId: goalId || null,
        projectTag: projectTag || null,
        responseVisibility,
      });
      toast.success('Request sent', 'It is now in their task list.');
      router.push('/feedback');
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
        <CardHeader title="Who are you asking?" />
        <CardBody className="space-y-4">
          <Select
            label="Ask this person"
            required
            value={responderEmployeeId}
            onChange={(e) => setResponder(e.target.value)}
            placeholder="Choose a colleague"
            help="They get a notification and a task. Pick someone who has actually worked with them."
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.preferredName || p.firstName} {p.lastName}
              </option>
            ))}
          </Select>

          <Select
            label="About"
            required
            value={aboutEmployeeId}
            onChange={(e) => setAbout(e.target.value)}
            help="Yourself, or someone in your reporting line."
          >
            {subjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === defaultSubjectId ? 'Me' : `${p.preferredName || p.firstName} ${p.lastName}`}
              </option>
            ))}
          </Select>

          <Textarea
            label="What would you like them to comment on?"
            required={false}
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            help="A specific question gets a far more useful answer than 'any feedback?'."
            placeholder="e.g. We worked together on the Riverbend addition. How did the coordination with your crew go, and what would you want done differently next time?"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Select
              label="Focus on a competency"
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
            {aboutSelf && goals.length > 0 && (
              <Select
                label="About a goal"
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
            )}
            <Input
              label="Project or job"
              required={false}
              value={projectTag}
              onChange={(e) => setProjectTag(e.target.value)}
            />
          </div>

          <Input
            label="Due by"
            type="date"
            required={false}
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            help="Shown on their task, and used to sort their inbox."
            containerClassName="max-w-xs"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Who will see their answer"
          description="You choose this now, and they are told before they write."
        />
        <CardBody className="space-y-3">
          <Select
            label="Audience for the response"
            required
            value={responseVisibility}
            onChange={(e) => setResponseVisibility(e.target.value)}
          >
            {FEEDBACK_VISIBILITIES.filter(
              (v) => v !== 'PRIVATE_NOTE_SELF' && v !== 'HR_ONLY' && v !== 'MANAGER_ONLY',
            ).map((v) => (
              <option key={v} value={v}>
                {FEEDBACK_VISIBILITY_LABELS[v as FeedbackVisibility]}
              </option>
            ))}
          </Select>
          <Alert tone="neutral">
            The person answering can still choose whether their name is shown. Setting the audience
            here means they are not guessing at how widely their words will travel.
          </Alert>
        </CardBody>
      </Card>

      <FormActions>
        <Button
          type="submit"
          variant="primary"
          icon={<Send className="h-4 w-4" />}
          loading={loading}
          disabled={!responderEmployeeId || !aboutEmployeeId}
        >
          Send the request
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
