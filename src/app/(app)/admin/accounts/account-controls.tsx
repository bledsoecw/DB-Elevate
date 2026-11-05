'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Settings2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, FormError, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/client-api';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@/lib/enums';

/**
 * Per-account administration: role grants, suspension, password reset.
 *
 * A temporary password is generated in the browser, shown once, and sent to the
 * server to be hashed. It is never stored in plain text and never written to
 * the audit log — the log records that a reset happened, not what it was.
 */

export interface AccountSummary {
  id: string;
  email: string;
  status: string;
  roles: Role[];
  personName: string;
}

export function AccountControls({
  account,
  isSelf,
  lastActiveSysAdmin,
}: {
  account: AccountSummary;
  isSelf: boolean;
  lastActiveSysAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<Settings2 className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Manage
      </Button>
      {open && (
        <ManageDialog
          account={account}
          isSelf={isSelf}
          lastActiveSysAdmin={lastActiveSysAdmin}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ManageDialog({
  account,
  isSelf,
  lastActiveSysAdmin,
  onClose,
}: {
  account: AccountSummary;
  isSelf: boolean;
  lastActiveSysAdmin: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [roles, setRoles] = useState<Role[]>(account.roles);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState<string | null>(null);

  async function toggleRole(role: Role, granted: boolean) {
    setBusy(role);
    setError(null);
    try {
      await api.post(`/api/admin/accounts/${account.id}/role`, { role, granted });
      setRoles((current) => (granted ? [...current, role] : current.filter((r) => r !== role)));
      toast.success(`${ROLE_LABELS[role]} ${granted ? 'granted' : 'revoked'}.`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: 'active' | 'suspended') {
    setBusy('status');
    setError(null);
    try {
      await api.post(`/api/admin/accounts/${account.id}/status`, { status });
      toast.success(status === 'suspended' ? 'Account suspended.' : 'Account reactivated.');
      onClose();
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword() {
    setBusy('password');
    setError(null);
    const temporary = generatePassword();
    try {
      await api.post(`/api/admin/accounts/${account.id}/password`, {
        temporaryPassword: temporary,
      });
      // Shown once, here, for the administrator to hand over out of band.
      setResetValue(temporary);
      toast.success('Password reset. Copy the temporary password now.');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={account.personName}
      description={account.email}
      footer={
        <Button onClick={onClose} disabled={busy !== null}>
          Done
        </Button>
      }
    >
      <div className="space-y-5">
        <FormError message={error} />

        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Roles</h3>
          <div className="space-y-2">
            {ROLES.map((role) => {
              const held = roles.includes(role);
              const immovable =
                role === 'EMPLOYEE' ||
                (role === 'SYS_ADMIN' && held && lastActiveSysAdmin);
              return (
                <div key={role} className="flex items-start gap-2">
                  <Checkbox
                    className="flex-1"
                    label={ROLE_LABELS[role]}
                    description={
                      role === 'EMPLOYEE'
                        ? 'Always held. It is what grants access to a person’s own records.'
                        : role === 'SYS_ADMIN' && held && lastActiveSysAdmin
                          ? 'This is the last active system administrator, so it cannot be revoked. Grant the role to someone else first.'
                          : ROLE_DESCRIPTIONS[role]
                    }
                    checked={held}
                    disabled={immovable || busy === role}
                    onChange={(e) => toggleRole(role, e.target.checked)}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Access</h3>
          {resetValue ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-medium text-emerald-900">
                Temporary password — shown once. Hand it over in person or by phone, not by e-mail.
              </p>
              <code className="mt-1.5 block select-all break-all rounded bg-white px-2 py-1.5 font-mono text-sm text-slate-900">
                {resetValue}
              </code>
              <p className="mt-1.5 text-xs leading-relaxed text-emerald-900">
                {account.personName} must change it at next sign-in. Every existing session was ended.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<KeyRound className="h-3.5 w-3.5" />}
                loading={busy === 'password'}
                onClick={resetPassword}
              >
                Reset password
              </Button>
              {account.status === 'active' ? (
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === 'status'}
                  disabled={isSelf}
                  title={isSelf ? 'You cannot suspend your own account.' : undefined}
                  onClick={() => setStatus('suspended')}
                >
                  Suspend
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === 'status'}
                  onClick={() => setStatus('active')}
                >
                  Reactivate
                </Button>
              )}
            </div>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Suspending stops sign-in immediately and ends live sessions. It keeps the person&rsquo;s
            records and their review history — deactivating the <em>employee</em> record is a separate,
            deliberate act on their profile.
          </p>
        </section>
      </div>
    </Dialog>
  );
}

export function CreateAccountButton({
  employeeId,
  personName,
  email,
}: {
  employeeId: string;
  personName: string;
  email: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const temporary = generatePassword();
    try {
      await api.post('/api/admin/accounts/create', {
        employeeId,
        temporaryPassword: temporary,
      });
      setCreated(temporary);
      toast.success('Account created.');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Create account
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          size="md"
          title={`Create an account for ${personName}`}
          description={`They will sign in with ${email}.`}
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>
                {created ? 'Done' : 'Cancel'}
              </Button>
              {!created && (
                <Button variant="primary" loading={busy} loadingLabel="Creating…" onClick={create}>
                  Create account
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-3">
            <FormError message={error} />
            {created ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-medium text-emerald-900">
                  Temporary password — shown once.
                </p>
                <code className="mt-1.5 block select-all break-all rounded bg-white px-2 py-1.5 font-mono text-sm text-slate-900">
                  {created}
                </code>
                <p className="mt-1.5 text-xs leading-relaxed text-emerald-900">
                  {personName} must change it at first sign-in.
                </p>
              </div>
            ) : (
              <>
                <Input
                  label="Sign-in e-mail"
                  value={email}
                  readOnly
                  help="Taken from the employee record. Change it there if it is wrong."
                />
                <p className="text-xs leading-relaxed text-slate-600">
                  The account starts with the Employee role only, and a temporary password you will see
                  once and hand over yourself. Nothing is e-mailed.
                </p>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * A readable temporary password: three words and digits, long enough to satisfy
 * the policy and short enough to read down a phone line.
 */
function generatePassword(): string {
  const words = [
    'cedar', 'gravel', 'rafter', 'mortar', 'shingle', 'trowel', 'joist', 'lintel',
    'granite', 'copper', 'willow', 'basalt', 'conduit', 'anvil', 'bramble', 'quarry',
  ];
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  const pick = (i: number) => words[bytes[i]! % words.length] as string;
  const digits = String(bytes[3]! % 10000).padStart(4, '0');
  return `${capitalize(pick(0))}-${pick(1)}-${pick(2)}-${digits}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
