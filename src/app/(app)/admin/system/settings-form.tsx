'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import {
  Checkbox,
  Field,
  FormActions,
  FormError,
  Input,
  Select,
  Textarea,
} from '@/components/ui/form';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';

/**
 * Organization settings.
 *
 * The brand swatches preview live so the effect of a colour is visible before
 * saving, and the privacy fields carry the explanation next to the number
 * rather than in a help page — a threshold nobody understands is a threshold
 * someone will lower.
 */

export interface OrgSettings {
  name: string;
  productName: string;
  wordmarkText: string | null;
  logoUrl: string | null;
  brandPrimaryHex: string;
  brandAccentHex: string;
  timezone: string;
  surveyMinResponses: number;
  surveySuppressComplement: boolean;
  peerReviewMinForAggregate: number;
  requireReviewAcknowledgement: boolean;
  emailProvider: string;
  emailFromName: string;
  emailFromAddr: string;
}

const TIMEZONES = [
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

export function SettingsForm({
  settings: initial,
  transportConfigured,
}: {
  settings: OrgSettings;
  transportConfigured: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<OrgSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedChangesWarning(dirty && !saving);

  function set<K extends keyof OrgSettings>(key: K, value: OrgSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.patch('/api/admin/settings', {
        name: form.name.trim(),
        productName: form.productName.trim(),
        wordmarkText: form.wordmarkText?.trim() || null,
        logoUrl: form.logoUrl?.trim() || null,
        brandPrimaryHex: form.brandPrimaryHex,
        brandAccentHex: form.brandAccentHex,
        timezone: form.timezone,
        surveyMinResponses: form.surveyMinResponses,
        surveySuppressComplement: form.surveySuppressComplement,
        peerReviewMinForAggregate: form.peerReviewMinForAggregate,
        requireReviewAcknowledgement: form.requireReviewAcknowledgement,
        emailProvider: form.emailProvider as 'outbox' | 'smtp' | 'ses' | 'sendgrid',
        emailFromName: form.emailFromName.trim(),
        emailFromAddr: form.emailFromAddr.trim(),
      });
      toast.success('Settings saved.');
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length) {
        const map: Record<string, string> = {};
        for (const f of e.fieldErrors) map[f.path] = f.message;
        setFieldErrors(map);
      }
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      <FormError message={error} />

      <Card>
        <CardHeader
          title="Naming"
          description="The company name appears on reports and e-mail. The product name is what this application calls itself in the interface."
        />
        <CardBody className="space-y-4">
          <Input
            label="Company name"
            required
            value={form.name}
            error={fieldErrors.name}
            onChange={(e) => set('name', e.target.value)}
          />
          <Input
            label="Product name"
            required
            value={form.productName}
            error={fieldErrors.productName}
            onChange={(e) => set('productName', e.target.value)}
            help="Shown in the sidebar, page titles and e-mail subject lines."
          />
          <Input
            label="Wordmark text"
            required={false}
            value={form.wordmarkText ?? ''}
            onChange={(e) => set('wordmarkText', e.target.value)}
            help="Overrides the product name in the sidebar. Leave blank to use the product name."
          />
          <Select
            label="Time zone"
            value={form.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            options={TIMEZONES.map((t) => ({ value: t, label: t }))}
            help="Deadlines and reminders are evaluated against this zone."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Branding"
          description="Two colours are expanded into the full palette, so the interface stays legible without anyone hand-picking ten shades."
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField
              label="Primary colour"
              value={form.brandPrimaryHex}
              error={fieldErrors.brandPrimaryHex}
              onChange={(v) => set('brandPrimaryHex', v)}
              help="Navigation, links and primary buttons."
            />
            <ColorField
              label="Accent colour"
              value={form.brandAccentHex}
              error={fieldErrors.brandAccentHex}
              onChange={(v) => set('brandAccentHex', v)}
              help="Highlights and recognition. Used sparingly."
            />
          </div>

          <Textarea
            label="Logo URL"
            required={false}
            rows={2}
            value={form.logoUrl ?? ''}
            onChange={(e) => set('logoUrl', e.target.value)}
            help="An https URL or a path under /public. Leave blank and the wordmark text is used instead — a fresh installation still looks finished."
          />

          <Field label="Preview">
            <div
              className="flex items-center gap-3 rounded-md border border-slate-200 p-4"
              style={{ backgroundColor: `${form.brandPrimaryHex}0d` }}
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-md text-sm font-bold text-white"
                style={{ backgroundColor: form.brandPrimaryHex }}
              >
                {(form.wordmarkText || form.productName).slice(0, 2).toUpperCase()}
              </span>
              <span className="text-sm font-semibold" style={{ color: form.brandPrimaryHex }}>
                {form.wordmarkText || form.productName}
              </span>
              <span
                className="ml-auto rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                style={{ backgroundColor: form.brandAccentHex }}
              >
                Accent
              </span>
            </div>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Privacy thresholds"
          description="These are the numbers that make the anonymity promise true. Raising one is always safe; lowering one reveals less-aggregated data, so do it deliberately."
        />
        <CardBody className="space-y-4">
          <Input
            type="number"
            label="Minimum responses before survey results are shown"
            required
            min={3}
            max={100}
            value={form.surveyMinResponses}
            error={fieldErrors.surveyMinResponses}
            onChange={(e) => set('surveyMinResponses', Number(e.target.value))}
            help="Applies to anonymous surveys and to every breakdown within one. Below this count the results are withheld rather than shown with a caveat — a caveat does not un-identify anyone. A survey can set a higher threshold for itself, never a lower one."
          />
          <Checkbox
            label="Also suppress a group when its complement would be identifying"
            description="With this on, a department of 40 is hidden too if the other 4 people could be worked out by subtraction. This is the setting that stops arithmetic defeating the threshold, and it should stay on."
            checked={form.surveySuppressComplement}
            onChange={(e) => set('surveySuppressComplement', e.target.checked)}
          />
          <Input
            type="number"
            label="Minimum peer reviews before peer feedback is aggregated"
            required
            min={1}
            max={50}
            value={form.peerReviewMinForAggregate}
            error={fieldErrors.peerReviewMinForAggregate}
            onChange={(e) => set('peerReviewMinForAggregate', Number(e.target.value))}
            help="Below this, peer input is not shown as an average to the employee — two peers averaged is two peers identified."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Review policy"
          description="Defaults for new cycles. A cycle can override them at launch."
        />
        <CardBody>
          <Checkbox
            label="Require acknowledgement of a released review"
            description="An acknowledgement records that the employee received and read the review. It is not agreement, and the interface says so where it is captured."
            checked={form.requireReviewAcknowledgement}
            onChange={(e) => set('requireReviewAcknowledgement', e.target.checked)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="E-mail"
          description="Where notification e-mail goes. Credentials live in the server environment and are never stored here."
        />
        <CardBody className="space-y-4">
          <Select
            label="Delivery"
            value={form.emailProvider}
            onChange={(e) => set('emailProvider', e.target.value)}
            options={[
              { value: 'outbox', label: 'Local outbox — nothing is sent' },
              { value: 'smtp', label: 'SMTP', disabled: !transportConfigured },
              { value: 'ses', label: 'Amazon SES', disabled: !transportConfigured },
              { value: 'sendgrid', label: 'SendGrid', disabled: !transportConfigured },
            ]}
            help={
              transportConfigured
                ? 'A mail transport is configured on the server, so a real provider can be selected.'
                : 'No mail transport is configured on this server, so the real providers are unavailable. Messages are written to the outbox where you can read them. See docs/DEPLOYMENT.md to configure one.'
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="From name"
              value={form.emailFromName}
              onChange={(e) => set('emailFromName', e.target.value)}
            />
            <Input
              label="From address"
              value={form.emailFromAddr}
              onChange={(e) => set('emailFromAddr', e.target.value)}
            />
          </div>
        </CardBody>
      </Card>

      <FormActions className="sticky bottom-0 -mx-1 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur">
        <Button
          variant="primary"
          icon={<Save className="h-4 w-4" />}
          loading={saving}
          loadingLabel="Saving…"
          disabled={!dirty}
          onClick={save}
        >
          Save settings
        </Button>
        {dirty ? (
          <span className="text-xs font-medium text-amber-700">Unsaved changes</span>
        ) : (
          <span className="text-xs text-slate-500">All changes saved</span>
        )}
        {dirty && (
          <Button className="ml-auto" onClick={() => setForm(initial)} disabled={saving}>
            Discard changes
          </Button>
        )}
      </FormActions>
    </div>
  );
}

function ColorField({
  label,
  value,
  error,
  help,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  help?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} help={help} error={error}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          aria-label={`${label} swatch`}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 flex-shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5"
        />
        <input
          type="text"
          value={value}
          aria-label={`${label} hex value`}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border-0 px-3 py-2 font-mono text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
        />
      </div>
    </Field>
  );
}
