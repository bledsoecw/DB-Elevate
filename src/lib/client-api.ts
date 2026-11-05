'use client';

/**
 * Single client-side entry point for calling the REST API.
 *
 * Centralising it means every form reports failures the same way, and no
 * component silently swallows an error and leaves the user believing their
 * edit was saved.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Normalized field errors from a schema failure. */
  readonly fieldErrors: { path: string; message: string }[];
  /**
   * The raw `details` payload, untouched. Validation failures raised by a
   * service carry their own shape (review submission, for instance, returns
   * one entry per unanswered question) and normalizing it away would lose the
   * information the form needs to point at the right field.
   */
  readonly details: unknown;

  constructor(
    message: string,
    status: number,
    code: string,
    fieldErrors: { path: string; message: string }[] = [],
    details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.details = details;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    // A dropped connection must not look like a successful save.
    throw new ApiError(
      'Could not reach the server. Your change has not been saved — check your connection and try again.',
      0,
      'network_error',
    );
  }

  if (response.status === 401) {
    throw new ApiError('Your session has expired. Sign in again to continue.', 401, 'auth_required');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const details = Array.isArray(err?.details)
      ? (err?.details as { path?: string; message?: string }[]).map((d) => ({
          path: String(d.path ?? ''),
          message: String(d.message ?? ''),
        }))
      : [];
    throw new ApiError(
      err?.message ?? `The request failed (${response.status}).`,
      response.status,
      err?.code ?? 'request_failed',
      details,
      err?.details ?? null,
    );
  }

  return (payload ?? {}) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
