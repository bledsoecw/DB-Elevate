import { z } from 'zod';
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES } from '@/lib/enums';
import { Id, IsoDate } from './common';

export const EmployeeSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(120),
  lastName: z.string().trim().min(1, 'Last name is required.').max(120),
  preferredName: z.string().trim().max(120).nullable().optional(),
  workEmail: z.string().trim().email('Enter a valid work e-mail address.').max(320),
  workPhone: z.string().trim().max(60).nullable().optional(),
  employeeNumber: z.string().trim().max(60).nullable().optional(),
  departmentId: Id.nullable().optional(),
  jobTitleId: Id.nullable().optional(),
  managerId: Id.nullable().optional(),
  hireDate: IsoDate,
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  workLocation: z.string().trim().max(160).nullable().optional(),
  crew: z.string().trim().max(160).nullable().optional(),
  reviewCohort: z.string().trim().max(120).nullable().optional(),
  reviewEligible: z.boolean().optional(),
  createAccount: z.boolean().optional(),
  temporaryPassword: z.string().max(200).nullable().optional(),
});

export const EmployeePatchSchema = EmployeeSchema.partial().omit({ workEmail: true });

export const ManagerChangeSchema = z.object({
  managerId: Id.nullable(),
  reason: z.string().trim().min(5, 'Record a short reason for the change.').max(1000),
  effectiveFrom: IsoDate,
});

export const DeactivateSchema = z.object({
  reason: z.string().trim().min(5, 'Record a short reason.').max(1000),
  terminationDate: IsoDate,
});

export const ImportCreateSchema = z.object({
  filename: z.string().trim().min(1).max(250),
  csv: z.string().min(1, 'The file appears to be empty.').max(5_000_000),
});

export const ImportValidateSchema = z.object({
  mapping: z.record(z.string(), z.string()),
});

export const ImportCommitSchema = z.object({
  createAccounts: z.boolean(),
  temporaryPassword: z.string().max(200).optional(),
});
