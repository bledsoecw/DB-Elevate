import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { requireActor } from '@/server/authz/actor';
import { aiEnvironmentStatus, aiUsageThisMonth, getOrgSettings } from '@/server/services/admin';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
} from '@/components/ui/primitives';
import { AiSettingsForm } from './ai-form';

export const metadata = { title: 'AI assistance' };

// Reads the server environment, so it must not be statically rendered.
export const dynamic = 'force-dynamic';

export default async function AiPage() {
  const actor = await requireActor();
  if (!actor.isSysAdmin) redirect('/admin');

  const [org, usage] = await Promise.all([
    getOrgSettings(actor),
    aiUsageThisMonth(actor.orgId),
  ]);
  const env = aiEnvironmentStatus();

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'AI assistance' }]}
        title="AI assistance"
        description="Optional drafting help. Off by default, and the application is fully functional without it."
        actions={
          <Badge tone={org.aiEnabled ? 'success' : 'neutral'}>
            {org.aiEnabled ? `Enabled · ${org.aiProvider}` : 'Disabled'}
          </Badge>
        }
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="What AI is allowed to do here">
        Suggest wording, and nothing else. Every suggestion arrives as editable draft text, labelled
        with where it came from, and a person has to accept it before it becomes part of a record. No
        rating, score, compensation figure, promotion or employment decision is ever produced or
        finalised by a model — those require an authorised human decision, and the application has no
        code path that would let a model make one.
      </Alert>

      <div className="max-w-4xl space-y-5">
        <Card>
          <CardHeader
            title="Server prerequisites"
            description="These are read from the server environment. They cannot be changed from this screen, which is the point — nobody starts a metered service by clicking a toggle in a browser."
          />
          <CardBody>
            <dl className="space-y-3">
              <Prerequisite
                ok={env.billingApproved}
                label="Spend approved"
                detail={
                  env.billingApproved
                    ? 'AI_BILLING_APPROVED=true is set, so a paid provider may be selected.'
                    : 'AI_BILLING_APPROVED is not set. A paid provider cannot be enabled until someone with authority sets it on the server — a deliberate sign-off that the cost is approved. The mock provider works without it.'
                }
              />
              {Object.entries(env.credentials).map(([provider, present]) => (
                <Prerequisite
                  key={provider}
                  ok={present}
                  label={`${provider} credential`}
                  detail={
                    present
                      ? 'A key is present in the server environment. Its value is never shown here, stored in the database, or written to a log.'
                      : 'No key in the server environment. Set it there if you intend to use this provider.'
                  }
                />
              ))}
            </dl>
          </CardBody>
        </Card>

        <AiSettingsForm
          settings={{
            aiEnabled: org.aiEnabled,
            aiProvider: org.aiProvider,
            aiModel: org.aiModel,
            aiMonthlyCallBudget: org.aiMonthlyCallBudget,
          }}
          environment={env}
          usageThisMonth={usage}
        />

        <Card>
          <CardHeader
            title="How context is assembled"
            description="If AI is ever switched on, what it is allowed to see follows the same permission rules as the screen you are looking at."
          />
          <CardBody>
            <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
              <li className="flex gap-2">
                <span aria-hidden className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
                <span>
                  A suggestion is assembled from records the <em>requesting person</em> may already
                  read. It cannot widen anyone&rsquo;s access, and a manager asking for help wording
                  feedback does not thereby get to see a peer&rsquo;s draft.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
                <span>
                  Private one-on-one notes and anonymous survey responses are excluded outright, at the
                  context-assembly layer, regardless of who is asking. Their protection does not depend
                  on the model behaving.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
                <span>
                  Every request stores a digest of exactly what was sent, so an audit can later show
                  what left the building without the log itself holding the content.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
                <span>
                  The mock provider returns deterministic, clearly-labelled fixtures. It makes no
                  network call, costs nothing, and is what the tests run against.
                </span>
              </li>
            </ul>
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600">
              Full detail in{' '}
              <Link href="/help/privacy" className="font-medium underline">
                the privacy notes
              </Link>
              , and in docs/PRIVACY.md.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Prerequisite({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className={
          'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ' +
          (ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')
        }
      >
        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>
      <div className="min-w-0">
        <dt className="text-sm font-medium text-slate-900">
          {label}
          <span className="sr-only">: {ok ? 'present' : 'not configured'}</span>
        </dt>
        <dd className="mt-0.5 text-xs leading-relaxed text-slate-600">{detail}</dd>
      </div>
    </div>
  );
}
