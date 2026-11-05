'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Transient confirmations and failures.
 *
 * Success toasts auto-dismiss; errors do not, because a message that explains
 * why a save failed should still be on screen when the user looks back at it.
 */

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  detail?: string;
}

interface ToastApi {
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // A component used outside the provider should not crash the page.
    return {
      success: (m) => console.info('[toast]', m),
      error: (m) => console.error('[toast]', m),
      info: (m) => console.info('[toast]', m),
    };
  }
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: ToastTone, message: string, detail?: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-3), { id, tone, message, detail }]);
    if (tone !== 'error') {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
    }
  }, []);

  const api: ToastApi = {
    success: useCallback((m, d) => push('success', m, d), [push]),
    error: useCallback((m, d) => push('error', m, d), [push]),
    info: useCallback((m, d) => push('info', m, d), [push]),
  };

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-pop',
              t.tone === 'success' && 'border-emerald-200 bg-white text-emerald-900',
              t.tone === 'error' && 'border-rose-200 bg-white text-rose-900',
              t.tone === 'info' && 'border-slate-200 bg-white text-slate-900',
            )}
          >
            <span aria-hidden className="mt-0.5 flex-shrink-0">
              {t.tone === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              {t.tone === 'error' && <AlertCircle className="h-5 w-5 text-rose-600" />}
              {t.tone === 'info' && <Info className="h-5 w-5 text-slate-500" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.message}</p>
              {t.detail && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{t.detail}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-m-1 flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Warns before leaving a page with unsaved edits. The browser controls the
 * wording; all we can do is ask for the prompt.
 */
export function useUnsavedChangesWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
