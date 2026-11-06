import { notFound, redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getEmployeeProfile, getFormOptions } from '@/server/services/people';
import { isAppError } from '@/server/errors';
import { PageHeader } from '@/components/ui/primitives';
import { EmployeeForm } from '../../employee-form';
import { fullName, toDateInputValue } from '@/lib/utils';

export const metadata = { title: 'Edit employee' };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getEmployeeProfile>>;
  try {
    data = await getEmployeeProfile(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  if (!data.canEdit) redirect(`/people/${id}`);

  const options = await getFormOptions(actor.orgId);
  const e = data.employee;
  const name = fullName(e);

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'People', href: '/people' },
          { label: name, href: `/people/${id}` },
          { label: 'Edit' },
        ]}
        title={`Edit ${name}`}
        description={
          data.canChangeManager
            ? undefined
            : 'You can maintain details for your direct reports. Reporting line and employment status are HR decisions.'
        }
      />
      <EmployeeForm
        mode="edit"
        employeeId={id}
        canSetReportingLine={data.canChangeManager}
        canManageCatalog={actor.isHrAdmin}
        options={options}
        initial={{
          firstName: e.firstName,
          lastName: e.lastName,
          preferredName: e.preferredName ?? '',
          workEmail: e.workEmail,
          workPhone: e.workPhone ?? '',
          employeeNumber: e.employeeNumber ?? '',
          departmentId: e.departmentId ?? '',
          jobTitleId: e.jobTitleId ?? '',
          managerId: e.managerId ?? '',
          hireDate: toDateInputValue(e.hireDate),
          employmentType: e.employmentType,
          employmentStatus: e.employmentStatus,
          workLocation: e.workLocation ?? '',
          crew: e.crew ?? '',
          reviewCohort: e.reviewCohort ?? '',
          reviewEligible: e.reviewEligible,
        }}
      />
    </>
  );
}
