import { AlertCircle } from 'lucide-react';

/**
 * What to say when a Google sign-in came back refused.
 *
 * The callback redirects here with a short code and nothing else. Nothing an
 * attacker supplies is reflected onto this page: every message below is
 * written here and chosen by an exact match, so a crafted `?sso=` value can
 * only ever produce the generic fallback.
 */
const MESSAGES: Record<string, { title: string; body: string; tone: 'warn' | 'info' }> = {
  domain: {
    title: 'That account is not part of this company',
    body:
      'Sign in with your work Google account. A personal Google account, or one from another ' +
      'organization, cannot be used here even if the address looks similar.',
    tone: 'warn',
  },
  no_account: {
    title: 'No account here for that address yet',
    body:
      'Your Google sign-in worked, but nobody has set up a DB Elevate account for that address. ' +
      'Ask an HR administrator to add you.',
    tone: 'warn',
  },
  account_inactive: {
    title: 'That account is no longer active',
    body: 'Contact your HR administrator if you believe that is wrong.',
    tone: 'warn',
  },
  sso_subject_mismatch: {
    title: 'That address is linked to a different Google account',
    body:
      'If your Workspace account was deleted and recreated, a system administrator has to unlink ' +
      'the old one before you can sign in. This is deliberate: it stops a reused address from ' +
      'inheriting somebody else’s records.',
    tone: 'warn',
  },
  cancelled: {
    title: 'Sign-in cancelled',
    body: 'You can try again whenever you are ready.',
    tone: 'info',
  },
  expired: {
    title: 'That sign-in attempt timed out',
    body: 'Start again from this page. Attempts are only valid for a few minutes.',
    tone: 'info',
  },
  state: {
    title: 'That sign-in could not be verified',
    body:
      'The response did not match the attempt that started in this browser, so it was refused. ' +
      'Start again from this page.',
    tone: 'warn',
  },
  token: {
    title: 'That sign-in could not be verified',
    body: 'Google’s response did not pass verification. Start again, and tell an administrator if it keeps happening.',
    tone: 'warn',
  },
  provider_error: {
    title: 'Google could not complete the sign-in',
    body: 'Start again. If it keeps happening, tell a system administrator.',
    tone: 'warn',
  },
  unavailable: {
    title: 'Google sign-in is not configured',
    body: 'This installation has no Google Workspace connection set up yet.',
    tone: 'info',
  },
};

export function SsoNotice({ code }: { code: string | undefined }) {
  if (!code) return null;
  const message = MESSAGES[code] ?? {
    title: 'That sign-in did not complete',
    body: 'Start again from this page.',
    tone: 'warn' as const,
  };
  const warn = message.tone === 'warn';
  return (
    <div
      role="status"
      className={
        'mt-6 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ' +
        (warn
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-slate-200 bg-slate-50 text-slate-700')
      }
    >
      <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div>
        <p className="font-semibold">{message.title}</p>
        <p className="mt-1 leading-relaxed">{message.body}</p>
      </div>
    </div>
  );
}
