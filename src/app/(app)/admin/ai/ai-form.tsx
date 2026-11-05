'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { Checkbox, FormActions, FormError, Input, RadioGroup } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';

/**
 * AI configuration.
 *
 * The form refuses to offer a paid provider the environment has not approved,
 * and the server refuses it again if someone posts past the form. The duplicate
 * is intentional: the screen explains, the server enforces.
 */

interface AiSettings {
  aiEnabled: boolean;
  aiProvider: string;
  aiModel: string | null;
  aiMonthlyCallBudget: number;
}

type Provider = 'none' | 'mock' | 'anthropic' | 'openai' | 'azure-openai';

const PROVIDERS: { value: Provider; label: string; description: string; paid: boolean }[] = [
  {
    value: 'none',
    label: 'None',
    description: 'No AI features are offered anywhere in the interface.',
    paid: false,
  },
  {
    value: 'mock',
    label: 'Mock provider (no cost, no network)',
    description:
      'Returns deterministic, clearly-labelled placeholder text. Use it to see where suggestions would appear and to test the accept/edit/discard flow. Makes no network call and costs nothing.',
    paid: false,
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    description: 'Metered. Requires a server-side API key and approved spend.',
    paid: true,
  },
  {
    value: 'openai',
    label: 'OpenAI',
    description: 'Metered. Requires a server-side API key and approved spend.',
    paid: true,
  },
  {
    value: 'azure-openai',
    label: 'Azure OpenAI',
    description: 'Metered. Requires a server-side key and endpoint, and approved spend.',
    paid: true,
  },
];

export function AiSettingsForm({
  settings: initial,
  environment,
  usageThisMonth,
}: {
  settings: AiSettings;
  environment: { billingApproved: boolean; credentials: Record<string, boolean> };
  usageThisMonth: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<AiSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const provider = form.aiProvider as Provider;
  const chosen = PROVIDERS.find((p) => p.value === provider);
  const paid = chosen?.paid ?? false;

  function blockedReason(p: (typeof PROVIDERS)[number]): string | null {
    if (!p.paid) return null;
    if (!environment.billingApproved) return 'Spend is not approved on this server.';
    if (!environment.credentials[p.value]) return 'No credential on this server.';
    return null;
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.patch('/api/admin/ai', {
        aiEnabled: form.aiEnabled,
        aiProvider: provider,
        aiModel: form.aiModel?.trim() || null,
        aiMonthlyCallBudget: form.aiMonthlyCallBudget,
      });
      toast.success(form.aiEnabled ? 'AI assistance enabled.' : 'AI assistance disabled.');
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

  const overBudget = paid && form.aiMonthlyCallBudget > 0 && usageThisMonth >= form.aiMonthlyCallBudget;

  return (
    <Card>
      <CardHeader
        title="Configuration"
        description="Four things must be true at once before a paid model is ever called: a provider chosen here, a credential on the server, a budget above zero, and the switch below."
      />
      <CardBody className="space-y-5">
        <FormError message={error} />

        <RadioGroup<Provider>
          name="ai-provider"
          legend="Provider"
          value={provider}
          onChange={(value) =>
            // Choosing "None" must actually switch assistance off, not merely
            // grey out the checkbox: a disabled-but-still-checked box would
            // post "enabled with no provider", which the server rightly
            // refuses, leaving the user staring at an error they did not cause.
            setForm({ ...form, aiProvider: value, aiEnabled: value === 'none' ? false : form.aiEnabled })
          }
          error={fieldErrors.aiProvider}
          options={PROVIDERS.map((p) => {
            const blocked = blockedReason(p);
            return {
              value: p.value,
              label: p.label,
              description: blocked ? `${p.description} — unavailable: ${blocked}` : p.description,
              disabled: Boolean(blocked),
            };
          })}
        />

        {provider !== 'none' && (
          <Input
            label="Model"
            required={false}
            value={form.aiModel ?? ''}
            onChange={(e) => setForm({ ...form, aiModel: e.target.value })}
            placeholder={provider === 'mock' ? 'Not used by the mock provider' : 'e.g. the model id'}
            disabled={provider === 'mock'}
            help="Left blank, the adapter uses its own default."
          />
        )}

        {paid && (
          <Input
            type="number"
            label="Monthly call budget"
            required
            min={0}
            max={1000000}
            value={form.aiMonthlyCallBudget}
            error={fieldErrors.aiMonthlyCallBudget}
            onChange={(e) => setForm({ ...form, aiMonthlyCallBudget: Number(e.target.value) })}
            help={`A hard ceiling on billable calls per calendar month. Reaching it stops further calls rather than slowing them down. Used so far this month: ${usageThisMonth}.`}
          />
        )}

        {overBudget && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            This month&rsquo;s budget is already reached ({usageThisMonth} of{' '}
            {form.aiMonthlyCallBudget}). No further billable calls will be made until the budget is
            raised or the month turns over. Everything else in the application carries on unaffected.
          </p>
        )}

        <div className="border-t border-slate-100 pt-4">
          <Checkbox
            label="Offer AI drafting assistance"
            description="With this off, no AI control appears anywhere and no request is ever assembled. Nothing else in the application changes — there is no feature that depends on it."
            checked={form.aiEnabled}
            disabled={provider === 'none'}
            onChange={(e) => setForm({ ...form, aiEnabled: e.target.checked })}
          />
        </div>

        <FormActions>
          <Button
            variant="primary"
            icon={<Save className="h-4 w-4" />}
            loading={saving}
            loadingLabel="Saving…"
            disabled={!dirty}
            onClick={save}
          >
            Save
          </Button>
          {dirty ? (
            <span className="text-xs font-medium text-amber-700">Unsaved changes</span>
          ) : (
            <span className="text-xs text-slate-500">Saved</span>
          )}
          {dirty && (
            <Button className="ml-auto" onClick={() => setForm(initial)} disabled={saving}>
              Discard
            </Button>
          )}
        </FormActions>
      </CardBody>
    </Card>
  );
}
