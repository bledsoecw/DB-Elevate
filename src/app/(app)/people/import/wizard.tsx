'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  StatTile,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/primitives';
import { Checkbox, FormError, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { cn, countLabel } from '@/lib/utils';

interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  help: string;
}

interface ParseResult {
  id: string;
  headers: string[];
  rowCount: number;
  sample: string[][];
  mapping: Record<string, string>;
}

type RowOutcome = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';

interface ValidatedRow {
  rowNumber: number;
  outcome: RowOutcome;
  email: string;
  name: string;
  messages: string[];
  changes: string[];
  managerResolution?: string;
}

interface ValidationReport {
  rows: ValidatedRow[];
  summary: { create: number; update: number; skip: number; error: number };
  unknownDepartments: string[];
  unknownJobTitles: string[];
  duplicateEmailsInFile: string[];
  unresolvedManagers: string[];
}

const OUTCOME_TONE: Record<RowOutcome, 'success' | 'info' | 'neutral' | 'danger'> = {
  CREATE: 'success',
  UPDATE: 'info',
  SKIP: 'neutral',
  ERROR: 'danger',
};

const OUTCOME_LABEL: Record<RowOutcome, string> = {
  CREATE: 'Will be added',
  UPDATE: 'Will be updated',
  SKIP: 'No change',
  ERROR: 'Rejected',
};

/**
 * The import wizard.
 *
 * Each step is reversible until the last one. The preview is the contract: the
 * commit applies exactly the outcomes shown, so an administrator is never asked
 * to approve a change they have not seen.
 */
export function ImportWizard({ fields }: { fields: FieldDef[] }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [createAccounts, setCreateAccounts] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: number } | null>(
    null,
  );
  const [showOnly, setShowOnly] = useState<RowOutcome | 'ALL'>('ALL');

  async function onFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const text = await file.text();
      const r = await api.post<ParseResult>('/api/people/import', { filename: file.name, csv: text });
      setParsed(r);
      setMapping(r.mapping);
      setStep(2);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function validate() {
    if (!parsed) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<ValidationReport>(`/api/people/import/${parsed.id}/validate`, { mapping });
      setReport(r);
      setStep(3);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!parsed) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ created: number; updated: number; skipped: number; errors: number }>(
        `/api/people/import/${parsed.id}/commit`,
        { createAccounts, temporaryPassword: createAccounts ? temporaryPassword : undefined },
      );
      setResult(r);
      setStep(4);
      toast.success('Import applied', `${r.created} added, ${r.updated} updated.`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    if (parsed) await api.post(`/api/people/import/${parsed.id}/cancel`).catch(() => undefined);
    setParsed(null);
    setReport(null);
    setStep(1);
    setError(null);
  }

  const steps = ['Choose a file', 'Match the columns', 'Review the changes', 'Done'];

  return (
    <div className="max-w-5xl space-y-5">
      {/* progress */}
      <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Import steps">
        {steps.map((label, i) => {
          const index = (i + 1) as 1 | 2 | 3 | 4;
          const state = index < step ? 'done' : index === step ? 'current' : 'todo';
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'done' && 'bg-emerald-600 text-white',
                  state === 'current' && 'bg-brand-600 text-white',
                  state === 'todo' && 'bg-slate-200 text-slate-500',
                )}
                aria-hidden
              >
                {state === 'done' ? '✓' : index}
              </span>
              <span
                className={cn(
                  'text-sm',
                  state === 'current' ? 'font-semibold text-slate-900' : 'text-slate-600',
                )}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      <FormError message={error} />

      {/* ------------------------------------------------------- step 1 */}
      {step === 1 && (
        <Card>
          <CardHeader
            title="Choose a CSV file"
            description="The first row must be the column headers. Up to 2,000 people at a time."
            actions={
              <ButtonLink href="/api/people/import/template" size="sm">
                Download a template
              </ButtonLink>
            }
          />
          <CardBody>
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) void onFile(file);
              }}
            >
              <FileSpreadsheet aria-hidden className="mb-3 h-8 w-8 text-slate-400" />
              <p className="text-sm font-medium text-slate-900">Drop a CSV file here</p>
              <p className="mt-1 text-xs text-slate-600">or choose one from your computer</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
              <Button
                variant="primary"
                className="mt-4"
                icon={<Upload className="h-4 w-4" />}
                loading={loading}
                onClick={() => fileRef.current?.click()}
              >
                Choose a file
              </Button>
            </div>
            <Alert tone="neutral" className="mt-4" title="What this will and will not do">
              <ul className="mt-1 space-y-1">
                <li>People are matched on work e-mail address.</li>
                <li>A blank cell never blanks information that is already correct.</li>
                <li>Departments and job titles are matched by name and are never created silently.</li>
                <li>Nobody is deactivated by an import.</li>
              </ul>
            </Alert>
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------------- step 2 */}
      {step === 2 && parsed && (
        <Card>
          <CardHeader
            title="Match the columns"
            description={`${countLabel(parsed.rowCount, 'row')} found. We have guessed from the headers — check anything marked required.`}
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <Select
                  key={f.key}
                  label={f.label}
                  required={f.required ? true : false}
                  help={f.help || undefined}
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  placeholder="Not in this file"
                >
                  {parsed.headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={String(i)}>
                      {h || `(column ${i + 1})`}
                    </option>
                  ))}
                </Select>
              ))}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-800">First few rows of your file</h4>
              <TableWrap>
                <thead>
                  <tr>
                    {parsed.headers.map((h, i) => (
                      <Th key={`${h}-${i}`}>{h || `Column ${i + 1}`}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsed.sample.map((row, ri) => (
                    <tr key={ri}>
                      {parsed.headers.map((_, ci) => (
                        <Td key={ci} className="whitespace-nowrap text-xs">
                          {row[ci] ?? ''}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </CardBody>
          <CardFooter>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={loading} onClick={() => void validate()}>
                Check the file
              </Button>
              <Button variant="secondary" onClick={() => void cancel()} disabled={loading}>
                Start over
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}

      {/* ------------------------------------------------------- step 3 */}
      {step === 3 && report && parsed && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Will be added" value={report.summary.create} tone="success" />
            <StatTile label="Will be updated" value={report.summary.update} tone="brand" />
            <StatTile label="No change" value={report.summary.skip} />
            <StatTile
              label="Rejected"
              value={report.summary.error}
              tone={report.summary.error > 0 ? 'danger' : 'neutral'}
            />
          </div>

          {(report.unknownDepartments.length > 0 ||
            report.unknownJobTitles.length > 0 ||
            report.unresolvedManagers.length > 0 ||
            report.duplicateEmailsInFile.length > 0) && (
            <Alert tone="warning" title="Worth looking at before you apply this" icon={<AlertTriangle className="h-4 w-4" />}>
              <ul className="mt-1 space-y-1">
                {report.unknownDepartments.length > 0 && (
                  <li>
                    <strong>Departments not set up yet:</strong> {report.unknownDepartments.join(', ')}.
                    Those people will be imported without a department. Create the departments first
                    if you want them matched.
                  </li>
                )}
                {report.unknownJobTitles.length > 0 && (
                  <li>
                    <strong>Job titles not set up yet:</strong> {report.unknownJobTitles.join(', ')}.
                    Those people will be imported without a job title, and so without a competency
                    library.
                  </li>
                )}
                {report.unresolvedManagers.length > 0 && (
                  <li>
                    <strong>Managers not found:</strong> {report.unresolvedManagers.join(', ')}. Those
                    reporting lines will be left unset.
                  </li>
                )}
                {report.duplicateEmailsInFile.length > 0 && (
                  <li>
                    <strong>Duplicated in the file:</strong> {report.duplicateEmailsInFile.join(', ')}.
                    Only the first occurrence of each will be applied.
                  </li>
                )}
              </ul>
            </Alert>
          )}

          <Card>
            <CardHeader
              title="Row by row"
              description="This is exactly what applying the import will do."
              actions={
                <Select
                  value={showOnly}
                  onChange={(e) => setShowOnly(e.target.value as RowOutcome | 'ALL')}
                  aria-label="Filter rows"
                >
                  <option value="ALL">All rows</option>
                  <option value="CREATE">Will be added</option>
                  <option value="UPDATE">Will be updated</option>
                  <option value="SKIP">No change</option>
                  <option value="ERROR">Rejected</option>
                </Select>
              }
            />
            <TableWrap>
              <thead>
                <tr>
                  <Th>Row</Th>
                  <Th>Person</Th>
                  <Th>Outcome</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.rows
                  .filter((r) => showOnly === 'ALL' || r.outcome === showOnly)
                  .map((r) => (
                    <tr key={r.rowNumber} className={r.outcome === 'ERROR' ? 'bg-rose-50/40' : undefined}>
                      <Td className="tabular-nums text-slate-500">{r.rowNumber}</Td>
                      <Td>
                        <span className="font-medium text-slate-900">{r.name || '—'}</span>
                        <span className="block text-xs text-slate-500">{r.email || 'no e-mail'}</span>
                      </Td>
                      <Td>
                        <Badge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {r.changes.length > 0 && (
                          <p className="mb-1">
                            <strong className="text-slate-700">Changing:</strong> {r.changes.join(', ')}
                          </p>
                        )}
                        {r.managerResolution && <p className="mb-1">Manager: {r.managerResolution}</p>}
                        {r.messages.length > 0 && (
                          <ul className="space-y-0.5">
                            {r.messages.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        )}
                      </Td>
                    </tr>
                  ))}
              </tbody>
            </TableWrap>
            <CardFooter className="space-y-3">
              <Checkbox
                label="Also create sign-in accounts for the people being added"
                description="Without an account they have a record but cannot sign in. Everyone created this way must change the password at first sign-in. No e-mail is sent."
                checked={createAccounts}
                onChange={(e) => setCreateAccounts(e.target.checked)}
              />
              {createAccounts && (
                <Input
                  label="Temporary password for everyone imported"
                  required
                  autoComplete="off"
                  value={temporaryPassword}
                  onChange={(e) => setTemporaryPassword(e.target.value)}
                  help="At least 10 characters. Distribute it in person, not by e-mail."
                  containerClassName="max-w-md"
                />
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="primary"
                  loading={loading}
                  disabled={report.summary.create + report.summary.update === 0}
                  onClick={() => void commit()}
                >
                  Apply: {report.summary.create} added, {report.summary.update} updated
                </Button>
                <Button variant="secondary" onClick={() => setStep(2)} disabled={loading}>
                  Back to column matching
                </Button>
                <Button
                  variant="ghost"
                  icon={<X className="h-4 w-4" />}
                  onClick={() => void cancel()}
                  disabled={loading}
                >
                  Discard this import
                </Button>
              </div>
              {report.summary.create + report.summary.update === 0 && (
                <p className="text-xs text-slate-500">
                  Nothing in this file would change anything, so there is nothing to apply.
                </p>
              )}
            </CardFooter>
          </Card>
        </>
      )}

      {/* ------------------------------------------------------- step 4 */}
      {step === 4 && result && (
        <Card>
          <CardBody className="py-10 text-center">
            <CheckCircle2 aria-hidden className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
            <h3 className="text-lg font-semibold text-slate-900">Import applied</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              {result.created} {result.created === 1 ? 'person was' : 'people were'} added and{' '}
              {result.updated} updated. {result.skipped} needed no change
              {result.errors > 0 ? `, and ${result.errors} were rejected` : ''}.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <ButtonLink href="/people" variant="primary">
                Go to the directory
              </ButtonLink>
              <Button
                variant="secondary"
                onClick={() => {
                  setParsed(null);
                  setReport(null);
                  setResult(null);
                  setStep(1);
                }}
              >
                Import another file
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
