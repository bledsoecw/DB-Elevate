import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getOrgSettings } from '@/server/services/admin';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { SettingsForm } from './settings-form';

export const metadata = { title: 'Organization and branding' };

export default async function SystemSettingsPage() {
  const actor = await requireActor();
  if (!actor.isSysAdmin) redirect('/admin');

  const org = await getOrgSettings(actor);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Administration', href: '/admin' }, { label: 'Organization' }]}
        title="Organization and branding"
        description="Company and product naming, colours, the privacy thresholds that govern survey reporting, and how e-mail leaves the application."
      />

      <Alert tone="neutral" className="mb-5 max-w-4xl" title="What changes immediately">
        Naming and colours apply on the next page load — the theme is driven by CSS variables, so
        re-branding needs no rebuild and no asset drop. Privacy thresholds apply the next time a report
        is calculated; they never retroactively reveal something that was already suppressed.
      </Alert>

      <SettingsForm
        settings={{
          name: org.name,
          productName: org.productName,
          wordmarkText: org.wordmarkText,
          logoUrl: org.logoUrl,
          brandPrimaryHex: org.brandPrimaryHex,
          brandAccentHex: org.brandAccentHex,
          timezone: org.timezone,
          surveyMinResponses: org.surveyMinResponses,
          surveySuppressComplement: org.surveySuppressComplement,
          peerReviewMinForAggregate: org.peerReviewMinForAggregate,
          requireReviewAcknowledgement: org.requireReviewAcknowledgement,
          emailProvider: org.emailProvider,
          emailFromName: org.emailFromName,
          emailFromAddr: org.emailFromAddr,
        }}
        transportConfigured={process.env.EMAIL_TRANSPORT_CONFIGURED === 'true'}
      />
    </>
  );
}
