'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  Lock,
  Plus,
  Save,
  Send,
  Trash2,
  Unlock,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from '@/components/ui/primitives';
import { Checkbox, FormError, Input, RadioGroup, Select, Textarea } from '@/components/ui/form';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import { QuestionInput } from '@/components/reviews/question-input';
import { emptyQuestion, type DraftQuestion, type DraftSection, type TemplateDraft } from './draft';
import { cn } from '@/lib/utils';
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  REVIEWER_KINDS,
  REVIEWER_KIND_LABELS,
  SCOREABLE_QUESTION_TYPES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS,
  type QuestionType,
  type ReviewerKind,
  type TemplateCategory,
} from '@/lib/enums';

interface Catalog {
  scales: {
    id: string;
    name: string;
    levels: { value: number; label: string; description: string | null }[];
  }[];
  competencies: { id: string; name: string; description: string | null; category: string | null }[];
}

/**
 * The template builder.
 *
 * Two things it deliberately makes visible while editing:
 *
 *  - Whether a version is frozen. If it is, saving forks it, and the button
 *    says so rather than quietly creating a version the administrator did not
 *    expect.
 *  - What the form will actually look like. The preview uses the same question
 *    component the reviewer sees, so there is no second rendering that could
 *    differ from the real thing.
 */
export function TemplateBuilder({
  mode,
  templateId,
  versionId,
  versionNumber,
  isPublished,
  inUse,
  canUnpublish,
  initial,
  catalog,
  versions,
}: {
  mode: 'create' | 'edit';
  templateId?: string;
  versionId?: string;
  versionNumber?: number;
  isPublished?: boolean;
  inUse?: boolean;
  canUnpublish?: boolean;
  initial: TemplateDraft;
  catalog: Catalog;
  versions?: { id: string; versionNumber: number; publishedAt: Date | string | null; inUse: boolean }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const defaultScale = catalog.scales[0]?.id ?? '';

  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [tab, setTab] = useState<'build' | 'preview' | 'scoring'>('build');
  const [previewKind, setPreviewKind] = useState<string>('MANAGER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [dialog, setDialog] = useState<'publish' | 'duplicate' | null>(null);
  const [duplicateName, setDuplicateName] = useState('');

  useUnsavedChangesWarning(dirty && !loading);

  const readOnly = Boolean(isPublished) && Boolean(inUse);

  function update(next: Partial<TemplateDraft>) {
    setDirty(true);
    setDraft((d) => ({ ...d, ...next }));
  }
  function updateSection(i: number, patch: Partial<DraftSection>) {
    setDirty(true);
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, j) => (i === j ? { ...s, ...patch } : s)),
    }));
  }
  function updateQuestion(si: number, qi: number, patch: Partial<DraftQuestion>) {
    setDirty(true);
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, j) =>
        j === si ? { ...s, questions: s.questions.map((q, k) => (k === qi ? { ...q, ...patch } : q)) } : s,
      ),
    }));
  }
  function moveSection(i: number, delta: number) {
    setDirty(true);
    setDraft((d) => {
      const next = [...d.sections];
      const t = i + delta;
      if (t < 0 || t >= next.length) return d;
      [next[i], next[t]] = [next[t] as DraftSection, next[i] as DraftSection];
      return { ...d, sections: next };
    });
  }
  function moveQuestion(si: number, qi: number, delta: number) {
    setDirty(true);
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s, j) => {
        if (j !== si) return s;
        const next = [...s.questions];
        const t = qi + delta;
        if (t < 0 || t >= next.length) return s;
        [next[qi], next[t]] = [next[t] as DraftQuestion, next[qi] as DraftQuestion];
        return { ...s, questions: next };
      }),
    }));
  }

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: draft.name,
        description: draft.description || null,
        category: draft.category,
        selfWeight: draft.selfWeight,
        managerWeight: draft.managerWeight,
        peerWeight: draft.peerWeight,
        changeNote: changeNote || undefined,
        sections: draft.sections.map((s) => ({
          title: s.title,
          instructions: s.instructions || null,
          weight: s.weight,
          appliesTo: s.appliesTo || 'SELF,MANAGER,PEER',
          questions: s.questions.map((q) => ({
            type: q.type,
            prompt: q.prompt,
            helpText: q.helpText || null,
            required: q.required,
            weight: q.weight,
            allowNotApplicable: q.allowNotApplicable,
            commentEnabled: q.commentEnabled,
            commentRequired: q.commentRequired,
            maxLength: q.maxLength,
            ratingScaleId: q.ratingScaleId || null,
            competencyId: q.competencyId || null,
            goalScope: q.goalScope || null,
            choices: q.choices.filter((c) => c.trim()),
            appliesTo: q.appliesTo || null,
          })),
        })),
      };

      if (mode === 'create') {
        const r = await api.post<{ id: string }>('/api/admin/templates', payload);
        setDirty(false);
        toast.success('Template created', 'It is a draft until you publish it.');
        router.push(`/admin/templates/${r.id}`);
      } else {
        const r = await api.patch<{ versionId: string; createdNewVersion: boolean }>(
          `/api/admin/templates/${templateId}?version=${versionId}`,
          payload,
        );
        setDirty(false);
        toast.success(
          r.createdNewVersion ? 'Saved as a new version' : 'Saved',
          r.createdNewVersion
            ? 'The published version was in use, so it has been left exactly as it was.'
            : undefined,
        );
        router.push(`/admin/templates/${templateId}?version=${r.versionId}`);
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const scoreableCount = draft.sections
    .flatMap((s) => s.questions)
    .filter((q) => SCOREABLE_QUESTION_TYPES.includes(q.type as QuestionType)).length;
  const totalQuestions = draft.sections.reduce((n, s) => n + s.questions.length, 0);
  const weightSum = draft.selfWeight + draft.managerWeight + draft.peerWeight;

  const tabs = [
    { key: 'build', label: 'Build', href: '#build' },
    { key: 'preview', label: 'Preview', href: '#preview' },
    { key: 'scoring', label: 'Scoring', href: '#scoring' },
  ];

  return (
    <div className="space-y-5">
      <FormError message={error} />

      {readOnly && (
        <Alert tone="warning" icon={<Lock className="h-4 w-4" />} title={`Version ${versionNumber} is in use`}>
          This version has been used by a review cycle, so it is frozen. You can still edit here —
          saving will create a new version and leave this one exactly as the people who answered it
          saw it.
        </Alert>
      )}
      {isPublished && !inUse && (
        <Alert tone="neutral" icon={<Lock className="h-4 w-4" />} title={`Version ${versionNumber} is published`}>
          It has not been used by a cycle yet, so you can unpublish it to edit in place, or just
          save — which creates a new version.
        </Alert>
      )}

      {versions && versions.length > 1 && (
        <Card>
          <CardHeader title="Versions" description="Each one keeps the questions exactly as they were." />
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/admin/templates/${templateId}?version=${v.id}`)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition',
                      v.id === versionId
                        ? 'border-brand-500 bg-brand-50 text-brand-800'
                        : 'border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-slate-50',
                    )}
                  >
                    <span className="font-medium">v{v.versionNumber}</span>
                    {v.publishedAt ? <Lock aria-hidden className="h-3 w-3" /> : <span className="text-amber-600">draft</span>}
                    {v.inUse && <span className="text-slate-400">in use</span>}
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="About this template" />
        <CardBody className="space-y-4">
          <Input
            label="Name"
            required
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            help="Name it for who it is for, not just what it is — e.g. 'Annual Review — Field Crew'."
          />
          <Textarea
            label="Description"
            required={false}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            rows={2}
          />
          <Select
            label="Category"
            value={draft.category}
            onChange={(e) => update({ category: e.target.value })}
            containerClassName="max-w-sm"
          >
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TEMPLATE_CATEGORY_LABELS[c as TemplateCategory]}
              </option>
            ))}
          </Select>
        </CardBody>
      </Card>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-1" aria-label="Builder sections">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as 'build' | 'preview' | 'scoring')}
              aria-current={tab === t.key ? 'page' : undefined}
              className={cn(
                'border-b-2 px-3.5 py-2.5 text-sm font-medium transition',
                tab === t.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ----------------------------------------------------------- build */}
      {tab === 'build' && (
        <div className="space-y-4">
          {draft.sections.map((section, si) => (
            <Card key={si}>
              <CardHeader
                title={`Section ${si + 1}`}
                actions={
                  <>
                    <Button variant="ghost" size="sm" icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => moveSection(si, -1)} disabled={si === 0} aria-label={`Move section ${si + 1} up`}>
                      <span className="sr-only">Up</span>
                    </Button>
                    <Button variant="ghost" size="sm" icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => moveSection(si, 1)} disabled={si === draft.sections.length - 1} aria-label={`Move section ${si + 1} down`}>
                      <span className="sr-only">Down</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      onClick={() => update({ sections: draft.sections.filter((_, j) => j !== si) })}
                      aria-label={`Remove section ${si + 1}`}
                    >
                      <span className="sr-only">Remove</span>
                    </Button>
                  </>
                }
              />
              <CardBody className="space-y-4">
                <Input
                  label="Section title"
                  required
                  value={section.title}
                  onChange={(e) => updateSection(si, { title: e.target.value })}
                />
                <Textarea
                  label="Instructions"
                  required={false}
                  value={section.instructions}
                  onChange={(e) => updateSection(si, { instructions: e.target.value })}
                  rows={2}
                  help="Shown above the questions. Good instructions are the cheapest way to improve review quality."
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="Weight"
                    type="number"
                    min={0}
                    step="0.5"
                    value={String(section.weight)}
                    onChange={(e) => updateSection(si, { weight: Number(e.target.value) })}
                    help="Relative to other sections. Set 0 for a section of written answers only."
                  />
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-slate-800">Who answers this section</p>
                    <div className="flex flex-wrap gap-3">
                      {(['SELF', 'MANAGER', 'PEER'] as const).map((k) => {
                        const list = section.appliesTo.split(',').filter(Boolean);
                        const on = list.includes(k);
                        return (
                          <label key={k} className="flex items-center gap-1.5 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...list, k]
                                  : list.filter((x) => x !== k);
                                updateSection(si, { appliesTo: next.join(',') });
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                            />
                            {REVIEWER_KIND_LABELS[k as ReviewerKind]}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-t border-slate-200 pt-4">
                  {section.questions.map((q, qi) => (
                    <QuestionEditor
                      key={qi}
                      question={q}
                      index={qi}
                      total={section.questions.length}
                      catalog={catalog}
                      onChange={(patch) => updateQuestion(si, qi, patch)}
                      onMove={(delta) => moveQuestion(si, qi, delta)}
                      onRemove={() =>
                        updateSection(si, { questions: section.questions.filter((_, k) => k !== qi) })
                      }
                    />
                  ))}

                  <div className="flex flex-wrap gap-2">
                    {(['RATING', 'COMPETENCY_RATING', 'TEXT', 'MULTIPLE_CHOICE', 'GOAL_REVIEW'] as const).map(
                      (type) => (
                        <Button
                          key={type}
                          variant="secondary"
                          size="sm"
                          icon={<Plus className="h-3.5 w-3.5" />}
                          onClick={() =>
                            updateSection(si, {
                              questions: [...section.questions, emptyQuestion(type, defaultScale)],
                            })
                          }
                        >
                          {QUESTION_TYPE_LABELS[type as QuestionType]}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}

          <Button
            variant="secondary"
            icon={<Plus className="h-4 w-4" />}
            onClick={() =>
              update({
                sections: [
                  ...draft.sections,
                  {
                    title: '',
                    instructions: '',
                    weight: 1,
                    appliesTo: 'SELF,MANAGER,PEER',
                    questions: [emptyQuestion('RATING', defaultScale)],
                  },
                ],
              })
            }
          >
            Add a section
          </Button>
        </div>
      )}

      {/* --------------------------------------------------------- preview */}
      {tab === 'preview' && (
        <div className="space-y-4">
          <Card>
            <CardBody>
              <RadioGroup
                name="previewKind"
                legend="Preview as"
                help="Sections and questions can be limited to particular reviewer types. This shows what each one actually gets."
                value={previewKind}
                onChange={(v) => setPreviewKind(v)}
                columns={2}
                options={REVIEWER_KINDS.filter((k) => ['SELF', 'MANAGER', 'PEER'].includes(k)).map((k) => ({
                  value: k,
                  label: REVIEWER_KIND_LABELS[k as ReviewerKind],
                }))}
              />
            </CardBody>
          </Card>

          {draft.sections.map((section, si) => {
            const spec = section.appliesTo.split(',').filter(Boolean);
            const visible = section.questions.filter((q) => {
              const own = q.appliesTo ? q.appliesTo.split(',').filter(Boolean) : spec;
              return own.includes(previewKind);
            });
            if (visible.length === 0) return null;
            return (
              <section key={si}>
                <h3 className="text-base font-semibold text-slate-900">
                  {section.title || `Section ${si + 1}`}
                </h3>
                {section.instructions && (
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
                    {section.instructions}
                  </p>
                )}
                <div className="mt-3 space-y-3">
                  {visible.map((q, qi) => {
                    const scale = catalog.scales.find((s) => s.id === q.ratingScaleId);
                    const competency = catalog.competencies.find((c) => c.id === q.competencyId);
                    return (
                      <QuestionInput
                        key={qi}
                        disabled
                        question={{
                          id: `preview-${si}-${qi}`,
                          key: `preview-${si}-${qi}`,
                          subjectKey: '',
                          subjectLabel: q.type === 'GOAL_REVIEW' ? 'Example goal' : competency?.name,
                          subjectDetail: q.type === 'GOAL_REVIEW' ? 'in progress · 60% calculated' : undefined,
                          type: q.type,
                          prompt: q.prompt || '(no prompt yet)',
                          helpText: q.helpText || null,
                          required: q.required,
                          weight: q.weight,
                          allowNotApplicable: q.allowNotApplicable,
                          commentEnabled: q.commentEnabled,
                          commentRequired: q.commentRequired,
                          maxLength: q.maxLength,
                          choices: q.choices.filter((c) => c.trim()).map((c) => ({ value: c, label: c })),
                          scale: scale
                            ? {
                                id: scale.id,
                                name: scale.name,
                                description: null,
                                levels: scale.levels,
                              }
                            : null,
                          competency: competency
                            ? {
                                id: competency.id,
                                name: competency.name,
                                description: competency.description,
                                behaviors: [],
                              }
                            : null,
                          answer: {
                            textValue: null,
                            numericValue: null,
                            choices: [],
                            commentValue: null,
                            notApplicable: false,
                          },
                        }}
                        value={{
                          textValue: null,
                          numericValue: null,
                          choices: [],
                          commentValue: null,
                          notApplicable: false,
                        }}
                        onChange={() => undefined}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}

          {totalQuestions === 0 && (
            <Alert tone="neutral">Nothing to preview yet. Add a section and some questions.</Alert>
          )}
        </div>
      )}

      {/* --------------------------------------------------------- scoring */}
      {tab === 'scoring' && (
        <Card>
          <CardHeader
            title="How a score is calculated"
            description="These weights decide how the reviewer types combine into one number."
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                label="Self-assessment weight"
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={String(draft.selfWeight)}
                onChange={(e) => update({ selfWeight: Number(e.target.value) })}
              />
              <Input
                label="Manager review weight"
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={String(draft.managerWeight)}
                onChange={(e) => update({ managerWeight: Number(e.target.value) })}
              />
              <Input
                label="Peer review weight"
                type="number"
                min={0}
                max={1}
                step="0.05"
                value={String(draft.peerWeight)}
                onChange={(e) => update({ peerWeight: Number(e.target.value) })}
              />
            </div>

            {weightSum === 0 && (
              <Alert tone="danger">
                All three weights are zero, so no score could ever be calculated. Give at least one a
                weight above zero.
              </Alert>
            )}
            {draft.peerWeight > draft.managerWeight && (
              <Alert tone="warning">
                Peer input is weighted more heavily than the manager review. Peer scores are averaged
                before weighting, but this still means colleagues carry more of the rating than the
                person accountable for it. That is a legitimate choice — just a deliberate one.
              </Alert>
            )}

            <Alert tone="neutral" title="The rules, in full">
              <ul className="mt-1 space-y-1">
                <li>
                  Each rating is placed on 0&ndash;100 using its own scale&rsquo;s lowest and highest
                  level. A 3 on a 1&ndash;5 scale is 50; a 3 on a 1&ndash;3 scale is 100.
                </li>
                <li>A section score is the weighted mean of the ratings that were actually given.</li>
                <li>
                  An unanswered or &ldquo;not applicable&rdquo; rating is excluded from both the top
                  and the bottom of the calculation. It is never counted as a zero.
                </li>
                <li>
                  Several peers are averaged first, so three peers cannot outvote one manager.
                </li>
                <li>
                  If a weighted reviewer type produced no submitted score, its weight is dropped and
                  the rest renormalized — and the review says what share of the weight contributed.
                </li>
                <li>Draft reviews never contribute to a score.</li>
              </ul>
            </Alert>

            <div className="rounded-md bg-slate-50 p-4 text-sm">
              <p className="font-medium text-slate-800">This template right now</p>
              <ul className="mt-1 space-y-0.5 text-slate-600">
                <li>
                  {totalQuestions} questions across {draft.sections.length} sections.
                </li>
                <li>
                  {scoreableCount} of them produce a number. The rest are written answers or choices,
                  which carry meaning but not a score.
                </li>
                <li>
                  Section weights:{' '}
                  {draft.sections.map((s) => `${s.title || 'untitled'} ${s.weight}`).join(', ') ||
                    'none'}
                  .
                </li>
              </ul>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardFooter className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={<Save className="h-4 w-4" />}
            loading={loading}
            onClick={() => void save()}
          >
            {mode === 'create'
              ? 'Create template'
              : isPublished
                ? 'Save as a new version'
                : 'Save changes'}
          </Button>

          {mode === 'edit' && !isPublished && (
            <Button variant="accent" icon={<Send className="h-4 w-4" />} onClick={() => setDialog('publish')}>
              Publish this version
            </Button>
          )}
          {mode === 'edit' && canUnpublish && (
            <Button
              variant="secondary"
              icon={<Unlock className="h-4 w-4" />}
              loading={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await api.del(`/api/admin/templates/${templateId}/publish?version=${versionId}`);
                  toast.success('Unpublished', 'You can edit this version in place again.');
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              Unpublish
            </Button>
          )}
          {mode === 'edit' && (
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => setDialog('duplicate')}>
              Duplicate
            </Button>
          )}
          <Button variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => setTab('preview')}>
            Preview
          </Button>

          {isPublished && (
            <Input
              aria-label="Change note"
              placeholder="What changed? (optional, kept on the new version)"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              containerClassName="min-w-[16rem] flex-1"
            />
          )}
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        </CardFooter>
      </Card>

      <Dialog
        open={dialog === 'publish'}
        onClose={() => setDialog(null)}
        title="Publish this version?"
        description="Publishing freezes the questions so they cannot change under a review that has already been answered."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={loading}>
              Not yet
            </Button>
            <Button
              variant="primary"
              loading={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await api.post(`/api/admin/templates/${templateId}/publish?version=${versionId}`);
                  setDialog(null);
                  toast.success('Published', 'This version can now be used by a review cycle.');
                  router.refresh();
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              Publish
            </Button>
          </>
        }
      >
        <ul className="space-y-1.5 text-sm text-slate-700">
          <li>A published version can be attached to a review cycle.</li>
          <li>Editing it afterwards creates a new version rather than changing this one.</li>
          <li>If it has not been used yet you can still unpublish it.</li>
        </ul>
      </Dialog>

      <Dialog
        open={dialog === 'duplicate'}
        onClose={() => setDialog(null)}
        title="Duplicate this template"
        description="Useful for making a variant for a different role without disturbing the original."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={loading}
              disabled={duplicateName.trim().length < 3}
              onClick={async () => {
                setLoading(true);
                try {
                  const r = await api.post<{ id: string }>(
                    `/api/admin/templates/${templateId}/duplicate`,
                    { versionId, name: duplicateName },
                  );
                  setDialog(null);
                  toast.success('Duplicated');
                  router.push(`/admin/templates/${r.id}`);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setLoading(false);
                }
              }}
            >
              Duplicate
            </Button>
          </>
        }
      >
        <Input
          label="Name for the copy"
          required
          value={duplicateName}
          onChange={(e) => setDuplicateName(e.target.value)}
          placeholder={`${draft.name} — copy`}
        />
      </Dialog>
    </div>
  );
}

function QuestionEditor({
  question,
  index,
  total,
  catalog,
  onChange,
  onMove,
  onRemove,
}: {
  question: DraftQuestion;
  index: number;
  total: number;
  catalog: Catalog;
  onChange: (patch: Partial<DraftQuestion>) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const scoreable = SCOREABLE_QUESTION_TYPES.includes(question.type as QuestionType);
  const hasChoices = question.type === 'MULTIPLE_CHOICE' || question.type === 'MULTI_SELECT';

  return (
    <div className="rounded-md border border-slate-200 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Badge tone="neutral">
          {QUESTION_TYPE_LABELS[question.type as QuestionType] ?? question.type}
        </Badge>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move question ${index + 1} up`}>
            <span className="sr-only">Up</span>
          </Button>
          <Button variant="ghost" size="sm" icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Move question ${index + 1} down`}>
            <span className="sr-only">Down</span>
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove} aria-label={`Remove question ${index + 1}`}>
            <span className="sr-only">Remove</span>
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Textarea
          label="Question"
          required
          value={question.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          rows={2}
        />
        <Input
          label="Help text"
          required={false}
          value={question.helpText}
          onChange={(e) => onChange({ helpText: e.target.value })}
          help="Shown under the question. Use it to say what 'good' looks like."
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Type" value={question.type} onChange={(e) => onChange({ type: e.target.value })}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABELS[t as QuestionType]}
              </option>
            ))}
          </Select>

          {scoreable && (
            <Select
              label="Rating scale"
              required
              value={question.ratingScaleId}
              onChange={(e) => onChange({ ratingScaleId: e.target.value })}
              placeholder="Choose a scale"
            >
              {catalog.scales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}

          {question.type === 'COMPETENCY_RATING' && (
            <Select
              label="Competency"
              required
              value={question.competencyId}
              onChange={(e) =>
                onChange({
                  competencyId: e.target.value,
                  prompt:
                    question.prompt ||
                    (catalog.competencies.find((c) => c.id === e.target.value)?.name ?? ''),
                })
              }
              placeholder="Choose"
            >
              {catalog.competencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}

          {question.type === 'GOAL_REVIEW' && (
            <Select
              label="Which goals"
              value={question.goalScope}
              onChange={(e) => onChange({ goalScope: e.target.value })}
            >
              <option value="OWNED">Goals this person owns</option>
              <option value="OWNED_AND_TEAM">Their goals and their team&rsquo;s</option>
              <option value="CYCLE_PERIOD">Any goal in the review period</option>
            </Select>
          )}

          {scoreable && (
            <Input
              label="Weight"
              type="number"
              min={0}
              step="0.5"
              value={String(question.weight)}
              onChange={(e) => onChange({ weight: Number(e.target.value) })}
              help="Within its section."
            />
          )}

          {question.type === 'TEXT' && (
            <Input
              label="Character limit"
              type="number"
              min={100}
              step={100}
              value={String(question.maxLength ?? 3000)}
              onChange={(e) => onChange({ maxLength: Number(e.target.value) })}
            />
          )}
        </div>

        {hasChoices && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-800">Options</p>
            {question.choices.map((c, ci) => (
              <div key={ci} className="flex gap-2">
                <Input
                  aria-label={`Option ${ci + 1}`}
                  value={c}
                  onChange={(e) => {
                    const next = [...question.choices];
                    next[ci] = e.target.value;
                    onChange({ choices: next });
                  }}
                  containerClassName="flex-1"
                />
                <Button
                  variant="ghost"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => onChange({ choices: question.choices.filter((_, k) => k !== ci) })}
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
              onClick={() => onChange({ choices: [...question.choices, ''] })}
            >
              Add option
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Checkbox
            label="Required"
            checked={question.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          {scoreable && (
            <>
              <Checkbox
                label="Allow 'not applicable'"
                description="Excluded from the score rather than counted as a low rating."
                checked={question.allowNotApplicable}
                onChange={(e) => onChange({ allowNotApplicable: e.target.checked })}
              />
              <Checkbox
                label="Comment box"
                checked={question.commentEnabled}
                onChange={(e) =>
                  onChange({
                    commentEnabled: e.target.checked,
                    commentRequired: e.target.checked ? question.commentRequired : false,
                  })
                }
              />
              {question.commentEnabled && (
                <Checkbox
                  label="Comment required"
                  description="Forces an example alongside the rating."
                  checked={question.commentRequired}
                  onChange={(e) => onChange({ commentRequired: e.target.checked })}
                />
              )}
            </>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-slate-700">
            Only shown to (leave all unticked to inherit the section)
          </p>
          <div className="flex flex-wrap gap-3">
            {(['SELF', 'MANAGER', 'PEER'] as const).map((k) => {
              const list = question.appliesTo.split(',').filter(Boolean);
              return (
                <label key={k} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={list.includes(k)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...list, k] : list.filter((x) => x !== k);
                      onChange({ appliesTo: next.join(',') });
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  />
                  {REVIEWER_KIND_LABELS[k as ReviewerKind]}
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

