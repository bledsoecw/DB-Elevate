'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { Checkbox, FormActions, FormError, Input, RadioGroup, Select, Textarea } from '@/components/ui/form';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import {
  APPROVAL_AUTHORITIES,
  APPROVAL_AUTHORITY_LABELS,
  PEER_VISIBILITY_LABELS,
  PEER_VISIBILITY_MODES,
  TEMPLATE_CATEGORY_LABELS,
  type ApprovalAuthority,
  type PeerVisibilityMode,
  type TemplateCategory,
} from '@/lib/enums';

export interface CycleFormValues {
  name: string;
  description: string;
  templateVersionId: string;
  periodStart: string;
  periodEnd: string;
  selfReviewEnabled: boolean;
  managerReviewEnabled: boolean;
  peerReviewEnabled: boolean;
  peerReviewTarget: number;
  peerVisibilityMode: string;
  requireApproval: boolean;
  approvalAuthority: string;
  releaseMode: string;
  shareSelfWithManager: boolean;
  sharePeerWithEmployee: boolean;
  requireAcknowledgement: boolean;
  selfDueAt: string;
  managerDueAt: string;
  peerDueAt: string;
}

interface VersionOption {
  id: string;
  label: string;
  category: string;
  sections: number;
  selfWeight: number;
  managerWeight: number;
  peerWeight: number;
}

/**
 * Cycle setup.
 *
 * The settings that decide who reads what are grouped together and spelled out
 * in full, because they are the ones people get wrong and the ones that matter
 * most to the person being reviewed.
 */
export function CycleForm({
  mode,
  cycleId,
  launched,
  versions,
  initial,
}: {
  mode: 'create' | 'edit';
  cycleId?: string;
  launched?: boolean;
  versions: VersionOption[];
  initial: CycleFormValues;
}) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<CycleFormValues>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesWarning(dirty && !loading);

  function set<K extends keyof CycleFormValues>(key: K, value: CycleFormValues[K]) {
    setDirty(true);
    setV((prev) => ({ ...prev, [key]: value }));
  }

  const version = versions.find((x) => x.id === v.templateVersionId);
  const frozen = Boolean(launched);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: v.name,
        description: v.description || null,
        templateVersionId: v.templateVersionId,
        periodStart: v.periodStart,
        periodEnd: v.periodEnd,
        selfReviewEnabled: v.selfReviewEnabled,
        managerReviewEnabled: v.managerReviewEnabled,
        peerReviewEnabled: v.peerReviewEnabled,
        peerReviewTarget: v.peerReviewTarget,
        peerVisibilityMode: v.peerVisibilityMode,
        requireApproval: v.requireApproval,
        approvalAuthority: v.approvalAuthority,
        releaseMode: v.releaseMode,
        shareSelfWithManager: v.shareSelfWithManager,
        sharePeerWithEmployee: v.sharePeerWithEmployee,
        requireAcknowledgement: v.requireAcknowledgement,
        selfDueAt: v.selfDueAt || null,
        managerDueAt: v.managerDueAt || null,
        peerDueAt: v.peerDueAt || null,
      };

      if (mode === 'create') {
        const r = await api.post<{ id: string }>('/api/admin/cycles', payload);
        setDirty(false);
        toast.success('Cycle created as a draft', 'Now choose who takes part.');
        router.push(`/reviews/cycles/${r.id}?tab=participants`);
      } else {
        // On a launched cycle, only the fields that are still changeable.
        const patch = frozen
          ? {
              name: payload.name,
              description: payload.description,
              periodStart: payload.periodStart,
              periodEnd: payload.periodEnd,
              requireApproval: payload.requireApproval,
              approvalAuthority: payload.approvalAuthority,
              releaseMode: payload.releaseMode,
              shareSelfWithManager: payload.shareSelfWithManager,
              sharePeerWithEmployee: payload.sharePeerWithEmployee,
              requireAcknowledgement: payload.requireAcknowledgement,
              selfDueAt: payload.selfDueAt,
              managerDueAt: payload.managerDueAt,
              peerDueAt: payload.peerDueAt,
            }
          : payload;
        await api.patch(`/api/admin/cycles/${cycleId}`, patch);
        setDirty(false);
        toast.success('Cycle updated');
        router.push(`/reviews/cycles/${cycleId}`);
      }
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
        <CardHeader title="The basics" />
        <CardBody className="space-y-4">
          <Input
            label="Name"
            required
            value={v.name}
            onChange={(e) => set('name', e.target.value)}
            help="What people will see in their task list."
          />
          <Textarea
            label="Description"
            required={false}
            value={v.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Review period starts"
              type="date"
              required
              value={v.periodStart}
              onChange={(e) => set('periodStart', e.target.value)}
              help="The work being reviewed, not the dates of the review itself."
            />
            <Input
              label="Review period ends"
              type="date"
              required
              value={v.periodEnd}
              onChange={(e) => set('periodEnd', e.target.value)}
            />
          </div>
          <Select
            label="Template"
            required
            value={v.templateVersionId}
            onChange={(e) => set('templateVersionId', e.target.value)}
            disabled={frozen}
            help={
              frozen
                ? 'Fixed once a cycle has launched — changing it would alter forms people are filling in.'
                : 'Only published versions can be used, because publishing freezes the questions.'
            }
          >
            {versions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
          {version && (
            <Alert tone="neutral">
              <strong>{version.label}</strong> —{' '}
              {TEMPLATE_CATEGORY_LABELS[version.category as TemplateCategory] ?? version.category},{' '}
              {version.sections} sections. Score weighting: self{' '}
              {Math.round(version.selfWeight * 100)}%, manager {Math.round(version.managerWeight * 100)}%,
              peer {Math.round(version.peerWeight * 100)}%. That weighting is set on the template,
              not here.
            </Alert>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Which reviews to collect" />
        <CardBody className="space-y-4">
          <div className="space-y-2">
            <Checkbox
              label="Self-assessment"
              description="The employee writes first. Nobody can read it until they submit."
              checked={v.selfReviewEnabled}
              disabled={frozen}
              onChange={(e) => set('selfReviewEnabled', e.target.checked)}
            />
            <Checkbox
              label="Manager review"
              description="Assigned to whoever each person's manager is when the cycle launches."
              checked={v.managerReviewEnabled}
              disabled={frozen}
              onChange={(e) => set('managerReviewEnabled', e.target.checked)}
            />
            <Checkbox
              label="Peer reviews"
              description="Colleagues are asked for input. Defaults to people who share a manager; you can change each one afterwards."
              checked={v.peerReviewEnabled}
              disabled={frozen}
              onChange={(e) => set('peerReviewEnabled', e.target.checked)}
            />
          </div>

          {v.peerReviewEnabled && (
            <div className="space-y-4 rounded-md bg-slate-50 p-4">
              <Input
                label="Peer reviewers per person"
                type="number"
                min={1}
                max={10}
                value={String(v.peerReviewTarget)}
                onChange={(e) => set('peerReviewTarget', Number(e.target.value))}
                containerClassName="max-w-xs"
                disabled={frozen}
              />
              <RadioGroup
                name="peerVisibility"
                legend="How peer responses are shown"
                help="Stated on the form before anyone writes, so nobody is surprised afterwards."
                value={v.peerVisibilityMode as PeerVisibilityMode}
                onChange={(value) => set('peerVisibilityMode', value)}
                options={PEER_VISIBILITY_MODES.map((m) => ({
                  value: m,
                  label: PEER_VISIBILITY_LABELS[m].split('—')[0]?.trim() ?? m,
                  description: PEER_VISIBILITY_LABELS[m].split('—')[1]?.trim(),
                  disabled: frozen,
                }))}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Self-assessments due"
              type="date"
              required={false}
              value={v.selfDueAt}
              onChange={(e) => set('selfDueAt', e.target.value)}
            />
            <Input
              label="Manager reviews due"
              type="date"
              required={false}
              value={v.managerDueAt}
              onChange={(e) => set('managerDueAt', e.target.value)}
              help="Leave room after the self-assessment deadline."
            />
            {v.peerReviewEnabled && (
              <Input
                label="Peer reviews due"
                type="date"
                required={false}
                value={v.peerDueAt}
                onChange={(e) => set('peerDueAt', e.target.value)}
              />
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Who sees what, and when"
          description="These decide what the person being reviewed experiences. Worth reading properly."
        />
        <CardBody className="space-y-4">
          <Checkbox
            label="Let the manager read the submitted self-assessment"
            description="Only once it has been submitted. A draft is never shared, whatever this is set to."
            checked={v.shareSelfWithManager}
            onChange={(e) => set('shareSelfWithManager', e.target.checked)}
          />
          {v.peerReviewEnabled && (
            <Checkbox
              label="Share peer content with the employee when results are released"
              description="If this is off, peer input informs the manager review but the employee never sees it."
              checked={v.sharePeerWithEmployee}
              onChange={(e) => set('sharePeerWithEmployee', e.target.checked)}
            />
          )}
          <Checkbox
            label="Require approval before results can be released"
            description="A second person reads the review before the employee does."
            checked={v.requireApproval}
            onChange={(e) => set('requireApproval', e.target.checked)}
          />
          {v.requireApproval && (
            <Select
              label="Who approves"
              value={v.approvalAuthority}
              onChange={(e) => set('approvalAuthority', e.target.value)}
              help="Pinned to a specific person when the cycle launches, so a reorganization cannot move an in-flight decision."
              containerClassName="max-w-md"
            >
              {APPROVAL_AUTHORITIES.map((a) => (
                <option key={a} value={a}>
                  {APPROVAL_AUTHORITY_LABELS[a as ApprovalAuthority]}
                </option>
              ))}
            </Select>
          )}
          <RadioGroup
            name="releaseMode"
            legend="Releasing results to the employee"
            value={v.releaseMode}
            onChange={(value) => set('releaseMode', value)}
            columns={2}
            options={[
              {
                value: 'MANUAL',
                label: 'Manual',
                description: 'An HR administrator releases each review deliberately, usually after the conversation has happened.',
              },
              {
                value: 'AUTO_ON_APPROVAL',
                label: 'Automatic once approved',
                description: 'The employee sees it as soon as the approver signs off. Faster, but the conversation may not have happened yet.',
              },
            ]}
          />
          <Checkbox
            label="Ask the employee to acknowledge"
            description="Acknowledging records receipt, not agreement — the form says so — and they can add a comment that is kept with the review."
            checked={v.requireAcknowledgement}
            onChange={(e) => set('requireAcknowledgement', e.target.checked)}
          />
        </CardBody>
      </Card>

      <FormActions>
        <Button type="submit" variant="primary" icon={<Save className="h-4 w-4" />} loading={loading}>
          {mode === 'create' ? 'Create the draft' : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
