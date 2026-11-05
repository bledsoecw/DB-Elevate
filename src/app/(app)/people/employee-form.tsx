'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save } from 'lucide-react';
import { api, errorMessage, ApiError } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui/primitives';
import { Checkbox, FormActions, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { useToast, useUnsavedChangesWarning } from '@/components/ui/toast';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS } from '@/lib/enums';

export interface EmployeeFormValues {
  firstName: string;
  lastName: string;
  preferredName: string;
  workEmail: string;
  workPhone: string;
  employeeNumber: string;
  departmentId: string;
  jobTitleId: string;
  managerId: string;
  hireDate: string;
  employmentType: string;
  employmentStatus: string;
  workLocation: string;
  crew: string;
  reviewCohort: string;
  reviewEligible: boolean;
}

/**
 * Create / edit an employee.
 *
 * Only fields the application actually uses are collected. There is no home
 * address, no date of birth and no salary field, because nothing in this
 * product needs them and storing personal data that is never used is a
 * liability rather than a feature.
 */
export function EmployeeForm({
  mode,
  employeeId,
  initial,
  options,
  canSetReportingLine,
}: {
  mode: 'create' | 'edit';
  employeeId?: string;
  initial: EmployeeFormValues;
  options: {
    departments: { id: string; name: string }[];
    jobTitles: { id: string; name: string; level: string | null }[];
    managers: { id: string; firstName: string; lastName: string; preferredName: string | null; jobTitle: { name: string } | null }[];
  };
  canSetReportingLine: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<EmployeeFormValues>(initial);
  const [createAccount, setCreateAccount] = useState(mode === 'create');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useUnsavedChangesWarning(dirty && !loading);

  function set<K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) {
    setDirty(true);
    setValues((v) => ({ ...v, [key]: value }));
    setFieldErrors((f) => {
      const next = { ...f };
      delete next[key as string];
      return next;
    });
  }

  async function submit() {
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload: Record<string, unknown> = {
        firstName: values.firstName,
        lastName: values.lastName,
        preferredName: values.preferredName || null,
        workPhone: values.workPhone || null,
        employeeNumber: values.employeeNumber || null,
        departmentId: values.departmentId || null,
        jobTitleId: values.jobTitleId || null,
        hireDate: values.hireDate || null,
        employmentType: values.employmentType,
        workLocation: values.workLocation || null,
        crew: values.crew || null,
        reviewCohort: values.reviewCohort || null,
      };
      if (canSetReportingLine) {
        payload.managerId = values.managerId || null;
        payload.employmentStatus = values.employmentStatus;
        payload.reviewEligible = values.reviewEligible;
      }

      if (mode === 'create') {
        payload.workEmail = values.workEmail;
        payload.createAccount = createAccount;
        payload.temporaryPassword = createAccount ? temporaryPassword : null;
        const result = await api.post<{ id: string }>('/api/people', payload);
        setDirty(false);
        toast.success(`${values.firstName} ${values.lastName} added`);
        router.push(`/people/${result.id}`);
      } else {
        await api.patch(`/api/people/${employeeId}`, payload);
        setDirty(false);
        toast.success('Saved');
        router.push(`/people/${employeeId}`);
      }
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length > 0) {
        const map: Record<string, string> = {};
        for (const f of e.fieldErrors) map[f.path] = f.message;
        setFieldErrors(map);
      }
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
        <CardHeader title="Who they are" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            required
            value={values.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            error={fieldErrors.firstName}
          />
          <Input
            label="Last name"
            required
            value={values.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            error={fieldErrors.lastName}
          />
          <Input
            label="Preferred name"
            required={false}
            help="What they are actually called, if different from their first name."
            value={values.preferredName}
            onChange={(e) => set('preferredName', e.target.value)}
          />
          <Input
            label="Employee number"
            required={false}
            value={values.employeeNumber}
            onChange={(e) => set('employeeNumber', e.target.value)}
          />
          <Input
            label="Work e-mail"
            type="email"
            required
            disabled={mode === 'edit'}
            help={
              mode === 'edit'
                ? 'The work e-mail is the sign-in address and cannot be changed here. Change it from the account administration screen.'
                : 'Used to sign in, and to match this person on a future import.'
            }
            value={values.workEmail}
            onChange={(e) => set('workEmail', e.target.value)}
            error={fieldErrors.workEmail}
          />
          <Input
            label="Work phone"
            required={false}
            value={values.workPhone}
            onChange={(e) => set('workPhone', e.target.value)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Their job" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Job title"
            required={false}
            value={values.jobTitleId}
            onChange={(e) => set('jobTitleId', e.target.value)}
            placeholder="Not set"
            help="Job titles carry the competency library used in reviews."
          >
            {options.jobTitles.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.level ? ` (${t.level})` : ''}
              </option>
            ))}
          </Select>
          <Select
            label="Department"
            required={false}
            value={values.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
            placeholder="Not set"
          >
            {options.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            label="Manager"
            required={false}
            value={values.managerId}
            onChange={(e) => set('managerId', e.target.value)}
            placeholder="No manager"
            disabled={!canSetReportingLine}
            help={
              canSetReportingLine
                ? mode === 'edit'
                  ? 'Changing this here records a reporting-line event. Historical reviews are unaffected.'
                  : undefined
                : 'Only an HR administrator can set a reporting line.'
            }
          >
            {options.managers
              .filter((m) => m.id !== employeeId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.preferredName || m.firstName} {m.lastName}
                  {m.jobTitle ? ` — ${m.jobTitle.name}` : ''}
                </option>
              ))}
          </Select>
          <Input
            label="Hire date"
            type="date"
            required={false}
            value={values.hireDate}
            onChange={(e) => set('hireDate', e.target.value)}
            help="Used for tenure bands in survey reporting and for new-hire reviews."
          />
          <Select
            label="Employment type"
            value={values.employmentType}
            onChange={(e) => set('employmentType', e.target.value)}
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          {canSetReportingLine && mode === 'edit' && (
            <Select
              label="Employment status"
              value={values.employmentStatus}
              onChange={(e) => set('employmentStatus', e.target.value)}
              help="To deactivate someone, use Deactivate on their profile — it also revokes their access."
            >
              {EMPLOYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
          <Input
            label="Work location"
            required={false}
            value={values.workLocation}
            onChange={(e) => set('workLocation', e.target.value)}
            help="A coarse label, used for survey breakdowns."
          />
          <Input
            label="Crew or project team"
            required={false}
            value={values.crew}
            onChange={(e) => set('crew', e.target.value)}
          />
          <Input
            label="Review cohort"
            required={false}
            value={values.reviewCohort}
            onChange={(e) => set('reviewCohort', e.target.value)}
            help="Optional grouping used when choosing who goes in a review cycle, e.g. Field or Office."
          />
        </CardBody>
      </Card>

      {mode === 'create' && (
        <Card>
          <CardHeader title="Sign-in account" />
          <CardBody className="space-y-3">
            <Checkbox
              label="Create a sign-in account"
              description="Without one this person has an employee record but cannot sign in, take part in reviews or respond to surveys."
              checked={createAccount}
              onChange={(e) => setCreateAccount(e.target.checked)}
            />
            {createAccount && (
              <>
                <Input
                  label="Temporary password"
                  type="text"
                  required
                  autoComplete="off"
                  value={temporaryPassword}
                  onChange={(e) => setTemporaryPassword(e.target.value)}
                  help="At least 10 characters. They are required to change it the first time they sign in. Give it to them in person or over the phone, not by e-mail."
                />
                <Alert tone="neutral">
                  No e-mail is sent. Outbound e-mail is disabled until a mail provider is configured
                  in Administration.
                </Alert>
              </>
            )}
          </CardBody>
        </Card>
      )}

      <FormActions>
        <Button
          type="submit"
          variant="primary"
          icon={<Save className="h-4 w-4" />}
          loading={loading}
          loadingLabel="Saving…"
        >
          {mode === 'create' ? 'Add employee' : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={loading}>
          Cancel
        </Button>
      </FormActions>
    </form>
  );
}
