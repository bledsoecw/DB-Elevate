import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { PageHeader } from '@/components/ui/primitives';
import { ImportWizard } from './wizard';
import { IMPORT_FIELDS } from '@/server/services/employee-import';

export const metadata = { title: 'Import employees' };

export default async function ImportPage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/people');

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'People', href: '/people' }, { label: 'Import' }]}
        title="Import employees from a spreadsheet"
        description="Four steps: choose the file, confirm which column means what, review exactly what would change, then apply it. Nothing is written until the last step."
      />
      <ImportWizard
        fields={IMPORT_FIELDS.map((f) => ({
          key: f.key,
          label: f.label,
          required: f.required,
          help: f.help,
        }))}
      />
    </>
  );
}
