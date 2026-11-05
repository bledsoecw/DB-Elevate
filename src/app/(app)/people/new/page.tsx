import { redirect } from 'next/navigation';
import { requireActor } from '@/server/authz/actor';
import { getFormOptions } from '@/server/services/people';
import { PageHeader } from '@/components/ui/primitives';
import { EmployeeForm } from '../employee-form';

export const metadata = { title: 'Add an employee' };

export default async function NewEmployeePage() {
  const actor = await requireActor();
  if (!actor.isHrAdmin) redirect('/people');
  const options = await getFormOptions(actor.orgId);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'People', href: '/people' }, { label: 'Add an employee' }]}
        title="Add an employee"
        description="Nothing is sent to anyone when you add a record. If you give them a sign-in account they can use it immediately."
      />
      <EmployeeForm
        mode="create"
        canSetReportingLine
        options={options}
        initial={{
          firstName: '',
          lastName: '',
          preferredName: '',
          workEmail: '',
          workPhone: '',
          employeeNumber: '',
          departmentId: '',
          jobTitleId: '',
          managerId: '',
          hireDate: '',
          employmentType: 'full_time',
          employmentStatus: 'active',
          workLocation: '',
          crew: '',
          reviewCohort: '',
          reviewEligible: true,
        }}
      />
    </>
  );
}
