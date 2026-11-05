'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { api, errorMessage } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { FormError, Input } from '@/components/ui/form';

function useSignIn(nextPath: string) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function signIn(email: string, password: string, key: string) {
    setError(null);
    setPending(key);
    try {
      await api.post('/api/auth/login', { email, password });
      // A full navigation, so the server re-reads the session cookie.
      router.replace(nextPath.startsWith('/') ? nextPath : '/');
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setPending(null);
    }
  }

  return { signIn, error, pending, setError };
}

export function LoginForm({ nextPath }: { nextPath: string }) {
  const { signIn, error, pending } = useSignIn(nextPath);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void signIn(email.trim(), password, 'form');
      }}
    >
      <FormError message={error} />
      <Input
        label="Work e-mail address"
        type="email"
        name="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
      />
      <Input
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={pending === 'form'}
        loadingLabel="Signing in…"
      >
        Sign in
      </Button>
    </form>
  );
}

/**
 * Development-only shortcut. It submits the real credentials to the real
 * endpoint; there is no separate code path in the authentication logic.
 *
 * Exported on its own rather than hung off LoginForm as a static property.
 * A server component importing from a 'use client' module receives a client
 * reference proxy, not the function object, so `LoginForm.DemoButton` is
 * undefined at render time and React fails with "Element type is invalid".
 * TypeScript cannot see it, because the assignment makes the property look
 * real.
 */
export function DemoButton({
  email,
  password,
  name,
  title,
  roleLabel,
  nextPath,
}: {
  email: string;
  password: string;
  name: string;
  title: string;
  roleLabel: string;
  nextPath: string;
}) {
  const { signIn, pending, error } = useSignIn(nextPath);
  return (
    <>
      <button
        type="button"
        onClick={() => void signIn(email, password, email)}
        disabled={pending !== null}
        className="group flex w-full items-center justify-between gap-3 py-2.5 text-left transition disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">{name}</span>
          <span className="block truncate text-xs text-slate-600">
            {title ? `${title} · ` : ''}
            {roleLabel}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="h-4 w-4 flex-shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
        />
      </button>
      {error && <p className="pb-2 text-xs text-rose-700">{error}</p>}
    </>
  );
}
