'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, EyeOff, Plus, Save, Trash2, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { Checkbox, FormActions, FormError, Input, RadioGroup, Select, Textarea } from '@/components/ui/form';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import { SURVEY_QUESTION_TYPES, SURVEY_QUESTION_TYPE_LABELS, type SurveyQuestionType } from '@/lib/enums';

interface Scale {
  id: string;
  name: string;
  levels: { value: number; label: string }[];
}

interface DraftQuestion {
  type: string;
  prompt: string;
  helpText: string;
  required: boolean;
  factor: string;
  ratingScaleId: string;
  choices: string[];
}

const STARTER_ENGAGEMENT: { prompt: string; factor: string }[] = [
  { prompt: 'I can raise a concern here without it being a problem.', factor: 'Leadership' },
  { prompt: 'I have the tools and materials I need to do my job well.', factor: 'Tools & Resources' },
  { prompt: 'Good work gets noticed here.', factor: 'Recognition' },
  { prompt: 'I know what I would need to do to move up.', factor: 'Growth' },
  { prompt: 'My workload over the last few months has been sustainable.', factor: 'Workload & Schedule' },
];

/**
 * Survey builder.
 *
 * The anonymity decision is made first and sits at the top of the form, because
 * it is the one choice that cannot be revisited after launch and the one that
 * most changes what people are willing to write.
 */
export function SurveyBuilder({
  scales,
  departments,
  jobTitles,
  factors,
  defaultMinResponses,
}: {
  scales: Scale[];
  departments: { id: string; name: string }[];
  jobTitles: { id: string; name: string }[];
  factors: string[];
  defaultMinResponses: number;
}) {
  const router = useRouter();
  const toast = useToast();

  const defaultScale = scales.find((s) => s.name.toLowerCase().includes('agreement'))?.id ?? scales[0]?.id ?? '';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [introText, setIntroText] = useState('');
  const [mode, setMode] = useState<'ANONYMOUS' | 'NAMED'>('ANONYMOUS');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [minResponses, setMinResponses] = useState(String(defaultMinResponses));
  const [collectDepartment, setCollectDepartment] = useState(true);
  const [collectTenureBand, setCollectTenureBand] = useState(true);
  const [audienceType, setAudienceType] = useState<'ALL' | 'DEPARTMENT' | 'JOB_TITLE'>('ALL');
  const [audienceValues, setAudienceValues] = useState<string[]>([]);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useUnsavedChangesWarning(questions.length > 0 && !loading);

  function addQuestion(type = 'RATING', prompt = '', factor = '') {
    setQuestions((q) => [
      ...q,
      {
        type,
        prompt,
        helpText: '',
        required: type !== 'TEXT',
        factor,
        ratingScaleId: type === 'RATING' ? defaultScale : '',
        choices: type === 'MULTIPLE_CHOICE' || type === 'MULTI_SELECT' ? ['', ''] : [],
      },
    ]);
  }

  function update(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function move(index: number, delta: number) {
    setQuestions((qs) => {
      const next = [...qs];
      const target = index + delta;
      if (target < 0 || target >= next.length) return qs;
      [next[index], next[target]] = [next[target] as DraftQuestion, next[index] as DraftQuestion];
      return next;
    });
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>('/api/surveys', {
        title,
        description: description || null,
        introText: introText || null,
        mode,
        opensAt: opensAt || null,
        closesAt: closesAt || null,
        minResponsesForResults: Number(minResponses),
        collectDepartment,
        collectTenureBand,
        questions: questions.map((q) => ({
          type: q.type,
          prompt: q.prompt,
          helpText: q.helpText || null,
          required: q.required,
          factor: q.factor || null,
          ratingScaleId: q.type === 'RATING' ? q.ratingScaleId || null : null,
          choices: q.choices.filter((c) => c.trim()),
        })),
        audience:
          audienceType === 'ALL'
            ? [{ ruleType: 'ALL' }]
            : audienceValues.map((v) => ({ ruleType: audienceType, value: v })),
      });
      toast.success('Survey created as a draft', 'Review it, then launch when you are ready.');
      router.push(`/surveys/${r.id}`);
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
        <CardHeader title="Anonymous or named?" description="Decide this first. It cannot be changed after launch." />
        <CardBody className="space-y-3">
          <RadioGroup
            name="mode"
            legend="Mode"
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              {
                value: 'ANONYMOUS',
                label: 'Anonymous',
                description:
                  'Answers are stored with no respondent identity. Participation is tracked separately and the two cannot be joined. Results stay hidden until enough people respond, and small groups stay hidden.',
              },
              {
                value: 'NAMED',
                label: 'Named',
                description:
                  'Answers are stored against each person. Administrators can read individual responses and follow up directly. Use this when the point is to act on specifics.',
              },
            ]}
          />
          <Alert
            tone={mode === 'ANONYMOUS' ? 'success' : 'warning'}
            icon={mode === 'ANONYMOUS' ? <EyeOff className="h-4 w-4" /> : <Users className="h-4 w-4" />}
          >
            {mode === 'ANONYMOUS'
              ? 'The survey form will tell people their answers are anonymous. That promise is enforced in the data, not just the wording — the respondent identity is never written.'
              : 'The survey form will tell people plainly that their name is recorded with their answers.'}
          </Alert>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="About the survey" />
        <CardBody className="space-y-4">
          <Input
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Autumn 2026 Engagement Survey"
          />
          <Textarea
            label="Short description"
            required={false}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            help="Shown in the survey list."
          />
          <Textarea
            label="Introduction"
            required={false}
            value={introText}
            onChange={(e) => setIntroText(e.target.value)}
            rows={3}
            help="Shown above the first question. Say why you are asking and what will happen with the answers."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="Opens" type="date" required={false} value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
            <Input label="Closes" type="date" required={false} value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
            <Input
              label="Minimum responses"
              type="number"
              min={mode === 'ANONYMOUS' ? 3 : 1}
              value={minResponses}
              onChange={(e) => setMinResponses(e.target.value)}
              help="Before any results are shown."
            />
          </div>
          {mode === 'ANONYMOUS' && (
            <div className="space-y-2">
              <Checkbox
                label="Record department for breakdowns"
                description="A coarse label stored on the response. Breakdowns below the minimum response count stay hidden."
                checked={collectDepartment}
                onChange={(e) => setCollectDepartment(e.target.checked)}
              />
              <Checkbox
                label="Record tenure band for breakdowns"
                description="A band such as '1-3 years', never an exact hire date."
                checked={collectTenureBand}
                onChange={(e) => setCollectTenureBand(e.target.checked)}
              />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who gets it" />
        <CardBody className="space-y-3">
          <Select
            label="Audience"
            value={audienceType}
            onChange={(e) => {
              setAudienceType(e.target.value as 'ALL' | 'DEPARTMENT' | 'JOB_TITLE');
              setAudienceValues([]);
            }}
          >
            <option value="ALL">Everyone active</option>
            <option value="DEPARTMENT">Specific departments</option>
            <option value="JOB_TITLE">Specific job titles</option>
          </Select>

          {audienceType !== 'ALL' && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {(audienceType === 'DEPARTMENT' ? departments : jobTitles).map((item) => (
                <Checkbox
                  key={item.id}
                  label={item.name}
                  checked={audienceValues.includes(item.name)}
                  onChange={(e) =>
                    setAudienceValues((v) =>
                      e.target.checked ? [...v, item.name] : v.filter((x) => x !== item.name),
                    )
                  }
                />
              ))}
            </div>
          )}

          {mode === 'ANONYMOUS' && audienceType !== 'ALL' && audienceValues.length > 0 && (
            <Alert tone="warning">
              A narrow audience and anonymity work against each other. If the group is smaller than
              the minimum response count, no results can ever be shown — the launch will be refused
              rather than producing a survey nobody can read the answers to.
            </Alert>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Questions (${questions.length})`}
          description="Short surveys get answered. Ten to fifteen questions is usually the upper limit."
          actions={
            questions.length === 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  for (const q of STARTER_ENGAGEMENT) addQuestion('RATING', q.prompt, q.factor);
                  addQuestion('NPS', 'How likely are you to recommend working here to someone in the trade?');
                  addQuestion('TEXT', 'What is the one thing that would most improve working here?');
                }}
              >
                Start from the engagement template
              </Button>
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          {questions.length === 0 && (
            <p className="text-sm text-slate-500">
              No questions yet. Add them one at a time, or start from the engagement template and
              edit it.
            </p>
          )}

          {questions.map((q, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <Badge tone="neutral">Question {i + 1}</Badge>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ArrowUp className="h-3.5 w-3.5" />}
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move question ${i + 1} up`}
                  >
                    <span className="sr-only">Up</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ArrowDown className="h-3.5 w-3.5" />}
                    onClick={() => move(i, 1)}
                    disabled={i === questions.length - 1}
                    aria-label={`Move question ${i + 1} down`}
                  >
                    <span className="sr-only">Down</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                    aria-label={`Remove question ${i + 1}`}
                  >
                    <span className="sr-only">Remove</span>
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Textarea
                  label="Question"
                  required
                  value={q.prompt}
                  onChange={(e) => update(i, { prompt: e.target.value })}
                  rows={2}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Select
                    label="Type"
                    value={q.type}
                    onChange={(e) => {
                      const type = e.target.value;
                      update(i, {
                        type,
                        ratingScaleId: type === 'RATING' ? defaultScale : '',
                        choices:
                          type === 'MULTIPLE_CHOICE' || type === 'MULTI_SELECT' ? ['', ''] : [],
                      });
                    }}
                  >
                    {SURVEY_QUESTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SURVEY_QUESTION_TYPE_LABELS[t as SurveyQuestionType]}
                      </option>
                    ))}
                  </Select>

                  {q.type === 'RATING' && (
                    <Select
                      label="Scale"
                      required
                      value={q.ratingScaleId}
                      onChange={(e) => update(i, { ratingScaleId: e.target.value })}
                    >
                      {scales.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  )}

                  {(q.type === 'RATING' || q.type === 'NPS') && (
                    <Select
                      label="Factor"
                      required={false}
                      value={q.factor}
                      onChange={(e) => update(i, { factor: e.target.value })}
                      placeholder="None"
                      help="Groups questions in the results."
                    >
                      {factors.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>

                {(q.type === 'MULTIPLE_CHOICE' || q.type === 'MULTI_SELECT') && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-slate-800">Options</p>
                    {q.choices.map((c, ci) => (
                      <div key={ci} className="flex gap-2">
                        <Input
                          aria-label={`Option ${ci + 1}`}
                          value={c}
                          onChange={(e) => {
                            const next = [...q.choices];
                            next[ci] = e.target.value;
                            update(i, { choices: next });
                          }}
                          containerClassName="flex-1"
                        />
                        <Button
                          variant="ghost"
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => update(i, { choices: q.choices.filter((_, j) => j !== ci) })}
                          aria-label={`Remove option ${ci + 1}`}
                        >
                          <span className="sr-only">Remove</span>
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => update(i, { choices: [...q.choices, ''] })}
                    >
                      Add option
                    </Button>
                  </div>
                )}

                <Checkbox
                  label="Required"
                  checked={q.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                  description={
                    q.type === 'TEXT'
                      ? 'Making a written question required reduces response rates. Usually better left optional.'
                      : undefined
                  }
                />
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addQuestion('RATING')}>
              Rating question
            </Button>
            <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addQuestion('TEXT')}>
              Written question
            </Button>
            <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addQuestion('MULTIPLE_CHOICE')}>
              Multiple choice
            </Button>
            <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addQuestion('NPS')}>
              eNPS
            </Button>
          </div>
        </CardBody>
      </Card>

      <FormActions>
        <Button
          type="submit"
          variant="primary"
          icon={<Save className="h-4 w-4" />}
          loading={loading}
          disabled={!title.trim() || questions.length === 0}
        >
          Save as draft
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
        <p className="w-full text-xs text-slate-500">
          Saving creates a draft. Nothing is sent to anyone until you launch it from the survey page.
        </p>
      </FormActions>
    </form>
  );
}
