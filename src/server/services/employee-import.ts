import 'server-only';
import { prisma } from '../db';
import type { Actor } from '../authz/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { AUDIT_ACTIONS, recordAudit } from '../audit';
import { hashPassword } from '../auth/password';
import { EMPLOYMENT_TYPES } from '@/lib/enums';

/**
 * CSV employee import.
 *
 * Four deliberate stages, because an import that writes straight from a file
 * is how an HR system ends up with duplicate people and broken reporting lines:
 *
 *   1. parse     — read the file, keep the rows in a staging row, suggest a mapping
 *   2. map       — the administrator confirms which column means what
 *   3. validate  — every row checked, every outcome classified, nothing written
 *   4. commit    — apply, in one transaction, exactly what the preview showed
 *
 * The staged rows are discarded on commit or cancel, so an uncommitted file
 * does not sit in the database indefinitely.
 */

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** RFC 4180 style parser: handles quoted fields, embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 byte order mark, which Excel adds and which would otherwise
  // become part of the first header name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < input.length) {
    const char = input[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop entirely blank trailing lines.
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  help: string;
  /** Header names that map to this field without the user choosing. */
  aliases: string[];
}

export const IMPORT_FIELDS: ImportField[] = [
  {
    key: 'workEmail',
    label: 'Work e-mail',
    required: true,
    help: 'Used to match existing people, and as the sign-in address.',
    aliases: ['email', 'work email', 'e-mail', 'work e-mail', 'email address', 'workemail'],
  },
  { key: 'firstName', label: 'First name', required: true, help: '', aliases: ['first name', 'firstname', 'given name', 'first'] },
  { key: 'lastName', label: 'Last name', required: true, help: '', aliases: ['last name', 'lastname', 'surname', 'family name', 'last'] },
  { key: 'preferredName', label: 'Preferred name', required: false, help: 'What they are actually called, if different.', aliases: ['preferred name', 'nickname', 'goes by', 'known as'] },
  { key: 'employeeNumber', label: 'Employee number', required: false, help: '', aliases: ['employee number', 'employee id', 'emp no', 'payroll id', 'employee #'] },
  { key: 'jobTitle', label: 'Job title', required: false, help: 'Matched by name; unknown titles are reported, not created silently.', aliases: ['job title', 'title', 'position', 'role'] },
  { key: 'department', label: 'Department', required: false, help: 'Matched by name.', aliases: ['department', 'dept', 'division', 'team'] },
  { key: 'managerEmail', label: 'Manager e-mail', required: false, help: 'The reporting line is set by matching this against another row or an existing employee.', aliases: ['manager email', 'manager e-mail', 'supervisor email', 'reports to', 'manager'] },
  { key: 'hireDate', label: 'Hire date', required: false, help: 'YYYY-MM-DD, or a date Excel exported.', aliases: ['hire date', 'start date', 'date hired', 'hired', 'start'] },
  { key: 'employmentType', label: 'Employment type', required: false, help: `One of: ${EMPLOYMENT_TYPES.join(', ')}.`, aliases: ['employment type', 'type', 'status type', 'full/part time'] },
  { key: 'workLocation', label: 'Work location', required: false, help: '', aliases: ['location', 'work location', 'site', 'office'] },
  { key: 'crew', label: 'Crew / project team', required: false, help: '', aliases: ['crew', 'team name', 'project team', 'squad'] },
  { key: 'workPhone', label: 'Work phone', required: false, help: '', aliases: ['phone', 'work phone', 'mobile', 'telephone'] },
];

export function suggestMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const [index, header] of headers.entries()) {
    const normalized = header.trim().toLowerCase().replace(/[_-]+/g, ' ');
    const field = IMPORT_FIELDS.find(
      (f) => !used.has(f.key) && (f.key.toLowerCase() === normalized || f.aliases.includes(normalized)),
    );
    if (field) {
      mapping[field.key] = String(index);
      used.add(field.key);
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

const MAX_ROWS = 2000;

export async function createImportBatch(actor: Actor, filename: string, csvText: string) {
  if (!actor.isHrAdmin) throw new ForbiddenError('Only an HR administrator can import employees.');

  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new ValidationError(
      'That file has no data rows. The first line should be the column headers, with at least one employee below it.',
    );
  }
  const headers = (rows[0] as string[]).map((h) => h.trim());
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) {
    throw new ValidationError(
      `That file has ${dataRows.length} rows. Import at most ${MAX_ROWS} at a time so a mistake stays easy to undo.`,
    );
  }

  const batch = await prisma.importBatch.create({
    data: {
      orgId: actor.orgId,
      filename: filename.slice(0, 250),
      status: 'PENDING_MAPPING',
      kind: 'employees',
      rawRowsJson: JSON.stringify({ headers, rows: dataRows }),
      mappingJson: JSON.stringify(suggestMapping(headers)),
      rowCount: dataRows.length,
      createdById: actor.userId,
    },
  });

  return {
    id: batch.id,
    headers,
    rowCount: dataRows.length,
    sample: dataRows.slice(0, 5),
    mapping: suggestMapping(headers),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type RowOutcome = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';

export interface ValidatedRow {
  rowNumber: number;
  outcome: RowOutcome;
  email: string;
  name: string;
  messages: string[];
  /** Fields that would change on an update. */
  changes: string[];
  values: Record<string, string>;
  existingEmployeeId?: string;
  managerResolution?: string;
}

export interface ValidationReport {
  rows: ValidatedRow[];
  summary: { create: number; update: number; skip: number; error: number };
  /** Names seen in the file that do not exist yet. */
  unknownDepartments: string[];
  unknownJobTitles: string[];
  duplicateEmailsInFile: string[];
  unresolvedManagers: string[];
}

function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // ISO first, then the common US spreadsheet format.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const us = /^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/.exec(trimmed);
  if (us) {
    const year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
    const d = new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function validateImportBatch(
  actor: Actor,
  batchId: string,
  mapping: Record<string, string>,
): Promise<ValidationReport> {
  if (!actor.isHrAdmin) throw new ForbiddenError('Only an HR administrator can import employees.');

  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, orgId: actor.orgId } });
  if (!batch) throw new NotFoundError('That import could not be found. It may have been cancelled.');
  if (batch.status === 'COMMITTED') throw new ConflictError('That import has already been applied.');

  for (const field of IMPORT_FIELDS.filter((f) => f.required)) {
    if (mapping[field.key] === undefined || mapping[field.key] === '') {
      throw new ValidationError(`Choose which column holds the ${field.label.toLowerCase()}.`);
    }
  }

  const staged = JSON.parse(batch.rawRowsJson) as { headers: string[]; rows: string[][] };

  const [employees, departments, jobTitles] = await Promise.all([
    prisma.employee.findMany({
      where: { orgId: actor.orgId },
      select: {
        id: true,
        workEmail: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        employeeNumber: true,
        departmentId: true,
        jobTitleId: true,
        hireDate: true,
        employmentType: true,
        workLocation: true,
        crew: true,
        workPhone: true,
        employmentStatus: true,
      },
    }),
    prisma.department.findMany({ where: { orgId: actor.orgId }, select: { id: true, name: true } }),
    prisma.jobTitle.findMany({ where: { orgId: actor.orgId }, select: { id: true, name: true } }),
  ]);

  const byEmail = new Map(employees.map((e) => [e.workEmail.toLowerCase(), e]));
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));
  const titleByName = new Map(jobTitles.map((t) => [t.name.toLowerCase(), t]));

  const get = (row: string[], key: string): string => {
    const index = mapping[key];
    if (index === undefined || index === '') return '';
    return (row[Number(index)] ?? '').trim();
  };

  const emailsInFile = new Map<string, number[]>();
  staged.rows.forEach((row, i) => {
    const email = get(row, 'workEmail').toLowerCase();
    if (!email) return;
    const list = emailsInFile.get(email) ?? [];
    list.push(i + 2); // +2: 1-indexed, plus the header line
    emailsInFile.set(email, list);
  });
  const duplicateEmailsInFile = [...emailsInFile.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([email]) => email);

  const unknownDepartments = new Set<string>();
  const unknownJobTitles = new Set<string>();
  const unresolvedManagers = new Set<string>();

  const rows: ValidatedRow[] = staged.rows.map((row, index) => {
    const rowNumber = index + 2;
    const messages: string[] = [];
    const changes: string[] = [];
    const values: Record<string, string> = {};
    for (const field of IMPORT_FIELDS) values[field.key] = get(row, field.key);

    const email = values.workEmail?.toLowerCase() ?? '';
    const name = `${values.firstName ?? ''} ${values.lastName ?? ''}`.trim();

    if (!email) {
      messages.push('No work e-mail address, so this row cannot be matched or created.');
    } else if (!EMAIL_RE.test(email)) {
      messages.push(`"${values.workEmail}" is not a valid e-mail address.`);
    }
    if (!values.firstName) messages.push('No first name.');
    if (!values.lastName) messages.push('No last name.');

    if (email && (emailsInFile.get(email)?.length ?? 0) > 1) {
      messages.push(
        `This e-mail appears on more than one row (lines ${emailsInFile.get(email)?.join(', ')}). Only the first will be applied.`,
      );
    }

    if (values.department) {
      if (!deptByName.has(values.department.toLowerCase())) {
        unknownDepartments.add(values.department);
        messages.push(`Department "${values.department}" does not exist yet and will be left unset.`);
      }
    }
    if (values.jobTitle) {
      if (!titleByName.has(values.jobTitle.toLowerCase())) {
        unknownJobTitles.add(values.jobTitle);
        messages.push(`Job title "${values.jobTitle}" does not exist yet and will be left unset.`);
      }
    }
    if (values.hireDate && !parseDate(values.hireDate)) {
      messages.push(`Could not read "${values.hireDate}" as a date. It will be left unset.`);
    }
    if (values.employmentType && !EMPLOYMENT_TYPES.includes(values.employmentType.toLowerCase().replace(/[\s-]/g, '_') as never)) {
      messages.push(
        `Employment type "${values.employmentType}" is not recognised; "full_time" will be used.`,
      );
    }

    let managerResolution: string | undefined;
    if (values.managerEmail) {
      const managerEmail = values.managerEmail.toLowerCase();
      if (byEmail.has(managerEmail)) {
        managerResolution = `Existing employee ${byEmail.get(managerEmail)?.firstName} ${byEmail.get(managerEmail)?.lastName}`;
      } else if (emailsInFile.has(managerEmail)) {
        managerResolution = 'Another row in this file';
      } else {
        unresolvedManagers.add(values.managerEmail);
        managerResolution = 'Not found — the reporting line will be left unset';
        messages.push(
          `Manager "${values.managerEmail}" is neither an existing employee nor a row in this file.`,
        );
      }
    }

    const hasBlockingError = messages.some(
      (m) => m.includes('cannot be matched') || m.includes('not a valid e-mail') || m.startsWith('No first name') || m.startsWith('No last name'),
    );
    if (hasBlockingError) {
      return { rowNumber, outcome: 'ERROR', email, name, messages, changes, values, managerResolution };
    }

    const existing = byEmail.get(email);
    if (!existing) {
      return { rowNumber, outcome: 'CREATE', email, name, messages, changes, values, managerResolution };
    }

    // An update only lists fields that would actually change.
    const compare: [string, string | null, string | null][] = [
      ['firstName', values.firstName || null, existing.firstName],
      ['lastName', values.lastName || null, existing.lastName],
      ['preferredName', values.preferredName || null, existing.preferredName],
      ['employeeNumber', values.employeeNumber || null, existing.employeeNumber],
      ['workLocation', values.workLocation || null, existing.workLocation],
      ['crew', values.crew || null, existing.crew],
      ['workPhone', values.workPhone || null, existing.workPhone],
    ];
    for (const [field, next, current] of compare) {
      if (next !== null && next !== current) changes.push(field);
    }
    const deptId = values.department ? (deptByName.get(values.department.toLowerCase())?.id ?? null) : null;
    if (deptId && deptId !== existing.departmentId) changes.push('department');
    const titleId = values.jobTitle ? (titleByName.get(values.jobTitle.toLowerCase())?.id ?? null) : null;
    if (titleId && titleId !== existing.jobTitleId) changes.push('jobTitle');
    const hire = values.hireDate ? parseDate(values.hireDate) : null;
    if (hire && hire.getTime() !== existing.hireDate?.getTime()) changes.push('hireDate');

    if (existing.employmentStatus === 'terminated') {
      messages.push(
        'This person is deactivated. The import will update their details but will NOT reactivate them — do that deliberately from their profile.',
      );
    }

    return {
      rowNumber,
      outcome: changes.length === 0 ? 'SKIP' : 'UPDATE',
      email,
      name,
      messages:
        changes.length === 0 ? [...messages, 'Nothing would change for this person.'] : messages,
      changes,
      values,
      existingEmployeeId: existing.id,
      managerResolution,
    };
  });

  const report: ValidationReport = {
    rows,
    summary: {
      create: rows.filter((r) => r.outcome === 'CREATE').length,
      update: rows.filter((r) => r.outcome === 'UPDATE').length,
      skip: rows.filter((r) => r.outcome === 'SKIP').length,
      error: rows.filter((r) => r.outcome === 'ERROR').length,
    },
    unknownDepartments: [...unknownDepartments],
    unknownJobTitles: [...unknownJobTitles],
    duplicateEmailsInFile,
    unresolvedManagers: [...unresolvedManagers],
  };

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      status: 'VALIDATED',
      mappingJson: JSON.stringify(mapping),
      reportJson: JSON.stringify(report),
      createdCount: report.summary.create,
      updatedCount: report.summary.update,
      errorCount: report.summary.error,
      skippedCount: report.summary.skip,
    },
  });

  return report;
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export async function commitImportBatch(
  actor: Actor,
  batchId: string,
  options: { createAccounts: boolean; temporaryPassword?: string },
): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
  if (!actor.isHrAdmin) throw new ForbiddenError('Only an HR administrator can import employees.');

  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, orgId: actor.orgId } });
  if (!batch) throw new NotFoundError('That import could not be found.');
  if (batch.status === 'COMMITTED') throw new ConflictError('That import has already been applied.');
  if (batch.status !== 'VALIDATED' || !batch.reportJson) {
    throw new ConflictError('Validate the import and review the preview before applying it.');
  }

  if (options.createAccounts) {
    const temp = options.temporaryPassword?.trim() ?? '';
    if (temp.length < 10) {
      throw new ValidationError(
        'To create sign-in accounts, set a temporary password of at least 10 characters. Everyone imported is required to change it at first sign-in.',
      );
    }
  }

  const report = JSON.parse(batch.reportJson) as ValidationReport;
  const [departments, jobTitles] = await Promise.all([
    prisma.department.findMany({ where: { orgId: actor.orgId }, select: { id: true, name: true } }),
    prisma.jobTitle.findMany({ where: { orgId: actor.orgId }, select: { id: true, name: true } }),
  ]);
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const titleByName = new Map(jobTitles.map((t) => [t.name.toLowerCase(), t.id]));

  const passwordHash = options.createAccounts
    ? await hashPassword(options.temporaryPassword as string)
    : null;

  let created = 0;
  let updated = 0;
  const seen = new Set<string>();
  const emailToId = new Map<string, string>();

  // Pass 1: create and update people, without reporting lines.
  await prisma.$transaction(
    async (tx) => {
      for (const row of report.rows) {
        if (row.outcome === 'ERROR' || row.outcome === 'SKIP') continue;
        if (seen.has(row.email)) continue; // first row wins for a duplicated address
        seen.add(row.email);

        const v = row.values;
        const data = {
          firstName: v.firstName as string,
          lastName: v.lastName as string,
          preferredName: v.preferredName || null,
          employeeNumber: v.employeeNumber || null,
          workPhone: v.workPhone || null,
          workLocation: v.workLocation || null,
          crew: v.crew || null,
          departmentId: v.department ? (deptByName.get(v.department.toLowerCase()) ?? null) : null,
          jobTitleId: v.jobTitle ? (titleByName.get(v.jobTitle.toLowerCase()) ?? null) : null,
          hireDate: v.hireDate ? parseDate(v.hireDate) : null,
          employmentType: EMPLOYMENT_TYPES.includes(
            (v.employmentType ?? '').toLowerCase().replace(/[\s-]/g, '_') as never,
          )
            ? (v.employmentType as string).toLowerCase().replace(/[\s-]/g, '_')
            : 'full_time',
        };

        if (row.outcome === 'UPDATE' && row.existingEmployeeId) {
          // Only write the fields that have a value in the file, so a sparse
          // column never blanks data that is already correct.
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data)) {
            if (value !== null && value !== undefined && value !== '') patch[key] = value;
          }
          await tx.employee.update({ where: { id: row.existingEmployeeId }, data: patch });
          emailToId.set(row.email, row.existingEmployeeId);
          updated += 1;
          continue;
        }

        let userId: string | null = null;
        if (options.createAccounts && passwordHash) {
          const user = await tx.user.create({
            data: {
              orgId: actor.orgId,
              email: row.email,
              passwordHash,
              status: 'active',
              mustChangePassword: true,
            },
          });
          await tx.userRole.create({ data: { userId: user.id, role: 'EMPLOYEE' } });
          userId = user.id;
        }

        const employee = await tx.employee.create({
          data: { orgId: actor.orgId, userId, workEmail: row.email, ...data },
        });
        emailToId.set(row.email, employee.id);
        created += 1;
      }

      // Pass 2: reporting lines, now that every row exists.
      for (const row of report.rows) {
        if (row.outcome === 'ERROR' || row.outcome === 'SKIP') continue;
        const managerEmail = row.values.managerEmail?.toLowerCase();
        if (!managerEmail) continue;

        const employeeId = emailToId.get(row.email);
        if (!employeeId) continue;

        let managerId = emailToId.get(managerEmail) ?? null;
        if (!managerId) {
          const existing = await tx.employee.findFirst({
            where: { orgId: actor.orgId, workEmail: managerEmail },
            select: { id: true },
          });
          managerId = existing?.id ?? null;
        }
        if (!managerId || managerId === employeeId) continue;

        const current = await tx.employee.findUnique({
          where: { id: employeeId },
          select: { managerId: true, hireDate: true },
        });
        if (current?.managerId === managerId) continue;

        await tx.managerAssignment.updateMany({
          where: { employeeId, effectiveTo: null },
          data: { effectiveTo: new Date() },
        });
        await tx.managerAssignment.create({
          data: {
            employeeId,
            managerId,
            effectiveFrom: current?.hireDate ?? new Date(),
            reason: `Set by the import of ${batch.filename}.`,
            createdById: actor.userId,
          },
        });
        await tx.employee.update({ where: { id: employeeId }, data: { managerId } });
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: 'COMMITTED',
          committedAt: new Date(),
          createdCount: created,
          updatedCount: updated,
          // The staged file is no longer needed once it has been applied.
          rawRowsJson: '{"headers":[],"rows":[]}',
        },
      });
    },
    { timeout: 120_000 },
  );

  await recordAudit(actor, {
    action: AUDIT_ACTIONS.EMPLOYEES_IMPORTED,
    entityType: 'import_batch',
    entityId: batchId,
    summary: `Imported ${batch.filename}: ${created} created, ${updated} updated, ${report.summary.skip} unchanged, ${report.summary.error} rejected.`,
    metadata: {
      created,
      updated,
      skipped: report.summary.skip,
      errors: report.summary.error,
      accountsCreated: options.createAccounts,
    },
  });

  return { created, updated, skipped: report.summary.skip, errors: report.summary.error };
}

export async function cancelImportBatch(actor: Actor, batchId: string): Promise<void> {
  if (!actor.isHrAdmin) throw new ForbiddenError('Only an HR administrator can import employees.');
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, orgId: actor.orgId } });
  if (!batch) throw new NotFoundError();
  if (batch.status === 'COMMITTED') {
    throw new ConflictError('That import has already been applied and cannot be cancelled.');
  }
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: 'CANCELLED', rawRowsJson: '{"headers":[],"rows":[]}' },
  });
}

export async function getImportBatch(actor: Actor, batchId: string) {
  if (!actor.isHrAdmin) throw new ForbiddenError('Only an HR administrator can import employees.');
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, orgId: actor.orgId } });
  if (!batch) throw new NotFoundError();
  const staged = JSON.parse(batch.rawRowsJson) as { headers: string[]; rows: string[][] };
  return {
    batch,
    headers: staged.headers,
    sample: staged.rows.slice(0, 5),
    mapping: JSON.parse(batch.mappingJson ?? '{}') as Record<string, string>,
    report: batch.reportJson ? (JSON.parse(batch.reportJson) as ValidationReport) : null,
  };
}

/** The template an administrator downloads before filling in their own data. */
export function importTemplateCsv(): string {
  const headers = IMPORT_FIELDS.map((f) => f.label);
  const example = [
    'rosa.delgado@example.com',
    'Rosa',
    'Delgado',
    '',
    'DB-0007',
    'Crew Lead',
    'Framing',
    'grant.whitfield@example.com',
    '2018-02-12',
    'full_time',
    'Field',
    'Framing Crew A',
    '555-0142',
  ];
  return `${headers.join(',')}\r\n${example.join(',')}\r\n`;
}
