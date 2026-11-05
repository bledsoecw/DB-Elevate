'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Monitor, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, CardBody } from '@/components/ui/primitives';
import { FormActions, FormError, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage, ApiError } from '@/lib/client-api';

/** Mirrors passwordProblems() on the server so the rules are visible while typing. */
const MIN_LENGTH = 10;
function localProblems(value: string): string[] {
  const problems: string[] = [];
  if (value.length < MIN_LENGTH) problems.push(`Use at least ${MIN_LENGTH} characters.`);
  if (!/[a-zA-Z]/.test(value)) problems.push('Include at least one letter.');
  if (!/[0-9]/.test(value)) problems.push('Include at least one number.');
  if (/^\s|\s$/.test(value)) problems.push('Remove leading or trailing spaces.');
  return problems;
}

export function PasswordForm() {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<number | null>(null);

  const problems = next.length > 0 ? localProblems(next) : [];
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = current.length > 0 && next.length > 0 && problems.length === 0 && !mismatch && confirm === next;

  async function submit() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await api.post<{ otherSessionsEnded: number }>('/api/account/password', {
        currentPassword: current,
        newPassword: next,
      });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(result.otherSessionsEnded);
      toast.success('Password changed.');
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length) {
        const map: Record<string, string> = {};
        for (const f of e.fieldErrors) map[f.path] = f.message;
        setFieldErrors(map);
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-sm font-medium text-emerald-900">Your password has been changed.</p>
        <p className="mt-1 text-xs leading-relaxed text-emerald-900">
          {done === 0
            ? 'You were not signed in anywhere else, so nothing was ended.'
            : `${done} other session${done === 1 ? '' : 's'} ${done === 1 ? 'was' : 'were'} ended. You are still signed in here.`}
        </p>
        <Button size="sm" className="mt-2" onClick={() => setDone(null)}>
          Change it again
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <FormError message={error} />

      <Input
        type="password"
        label="Current password"
        required
        autoComplete="current-password"
        value={current}
        error={fieldErrors.currentPassword}
        onChange={(e) => setCurrent(e.target.value)}
        help="Asked for even though you are signed in, so that somebody at your unlocked screen cannot lock you out of your own account."
      />

      <Input
        type="password"
        label="New password"
        required
        autoComplete="new-password"
        value={next}
        error={fieldErrors.newPassword ?? (problems.length > 0 ? problems.join(' ') : undefined)}
        onChange={(e) => setNext(e.target.value)}
        help={`At least ${MIN_LENGTH} characters, with a letter and a number.`}
      />

      <Input
        type="password"
        label="New password again"
        required
        autoComplete="new-password"
        value={confirm}
        error={mismatch ? 'These do not match.' : undefined}
        onChange={(e) => setConfirm(e.target.value)}
      />

      <FormActions>
        <Button
          variant="primary"
          icon={<KeyRound className="h-4 w-4" />}
          loading={busy}
          loadingLabel="Changing…"
          disabled={!ready}
          onClick={submit}
        >
          Change password
        </Button>
      </FormActions>

      <p className="text-xs leading-relaxed text-slate-500">
        Changing your password ends every other session you have open, since that is also how you
        would respond to suspecting one is not yours. This session stays signed in.
      </p>
    </div>
  );
}

export interface SessionRow {
  id: string;
  device: string;
  ip: string | null;
  isCurrent: boolean;
  lastSeen: string;
  started: string;
  expires: string;
}

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function end(sessionId?: string) {
    setBusy(sessionId ?? 'all');
    try {
      const result = await api.del<{ ended: number }>(
        '/api/account/sessions',
        sessionId ? { sessionId } : {},
      );
      toast.success(
        result.ended === 0
          ? 'Nothing to end — you are only signed in here.'
          : `Ended ${result.ended} session${result.ended === 1 ? '' : 's'}.`,
      );
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const others = sessions.filter((s) => !s.isCurrent);

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="flex min-w-0 gap-3">
              <span aria-hidden className="mt-0.5 text-slate-400">
                <Monitor className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  {s.device}
                  {s.isCurrent && <Badge tone="success">This device</Badge>}
                </p>
                <p className="text-xs text-slate-500">
                  Active {s.lastSeen} · started {s.started}
                  {s.ip && <> · {s.ip}</>}
                </p>
                <p className="text-xs text-slate-400">Expires {s.expires}</p>
              </div>
            </div>
            {!s.isCurrent && (
              <Button size="sm" loading={busy === s.id} onClick={() => end(s.id)}>
                End
              </Button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <CardBody className="border-t border-slate-100">
          <Button loading={busy === 'all'} onClick={() => end()}>
            End all {others.length} other session{others.length === 1 ? '' : 's'}
          </Button>
        </CardBody>
      )}
    </>
  );
}

export function ContactForm({
  preferredName,
  workPhone,
  firstName,
}: {
  preferredName: string | null;
  workPhone: string | null;
  firstName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(preferredName ?? '');
  const [phone, setPhone] = useState(workPhone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== (preferredName ?? '') || phone !== (workPhone ?? '');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch('/api/account', {
        preferredName: name.trim() || null,
        workPhone: phone.trim() || null,
      });
      toast.success('Saved.');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <FormError message={error} />
      <Input
        label="What you would like to be called"
        required={false}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={firstName}
        help={`Used everywhere your name appears. Leave blank to use ${firstName}.`}
      />
      <Input
        type="tel"
        label="Work phone"
        required={false}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <FormActions>
        <Button
          variant="primary"
          icon={<Save className="h-4 w-4" />}
          loading={busy}
          loadingLabel="Saving…"
          disabled={!dirty}
          onClick={save}
        >
          Save
        </Button>
        {dirty && <span className="text-xs font-medium text-amber-700">Unsaved changes</span>}
      </FormActions>
    </div>
  );
}
