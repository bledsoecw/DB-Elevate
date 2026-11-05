import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { AppError, ValidationError, isAppError } from './errors';
import { requireActor, type Actor } from './authz/actor';

/**
 * Shared plumbing for REST route handlers.
 *
 * Every route goes through `handler`, so authentication, validation and error
 * mapping are identical across the API. That matters because the permission
 * rules have to hold for a direct API call, not only for a click in the UI.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorResponse(e: unknown): NextResponse<ApiErrorBody> {
  if (e instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Some of the information provided is not valid.',
          details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      { status: 422 },
    );
  }
  if (isAppError(e)) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message, details: e.details } },
      { status: e.status },
    );
  }
  // Unexpected: log the detail server-side, return something safe.
  console.error('[api] unhandled error', e);
  return NextResponse.json(
    {
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side. Your changes may not have been saved.',
      },
    },
    { status: 500 },
  );
}

type Ctx = { params: Promise<Record<string, string>> };

/** Wraps an authenticated route handler. */
export function handler<T>(
  fn: (args: { actor: Actor; request: Request; params: Record<string, string> }) => Promise<T>,
) {
  return async (request: Request, ctx?: Ctx): Promise<NextResponse> => {
    try {
      const actor = await requireActor();
      const params = ctx?.params ? await ctx.params : {};
      const result = await fn({ actor, request, params });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Wraps a route handler that must work without a session (login, health). */
export function publicHandler<T>(fn: (args: { request: Request }) => Promise<T>) {
  return async (request: Request): Promise<NextResponse> => {
    try {
      const result = await fn({ request });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function parseBody<S extends ZodType>(request: Request, schema: S): Promise<ReturnType<S['parse']>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('The request body was not valid JSON.');
  }
  return schema.parse(raw) as ReturnType<S['parse']>;
}

export function parseQuery<S extends ZodType>(request: Request, schema: S): ReturnType<S['parse']> {
  const url = new URL(request.url);
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    obj[key] = all.length > 1 ? all : (all[0] as string);
  }
  return schema.parse(obj) as ReturnType<S['parse']>;
}

export function requestMeta(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for');
  return {
    ip: forwarded ? forwarded.split(',')[0]!.trim() : request.headers.get('x-real-ip'),
    userAgent: request.headers.get('user-agent'),
  };
}

/** Builds a CSV download response. Quoting handles commas, quotes and newlines. */
export function csvResponse(filename: string, rows: (string | number | null | undefined)[][]): NextResponse {
  const escape = (cell: string | number | null | undefined): string => {
    if (cell === null || cell === undefined) return '';
    const text = String(cell);
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  // Prefixed BOM so Excel reads UTF-8 correctly.
  const body = '﻿' + rows.map((row) => row.map(escape).join(',')).join('\r\n');
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export { AppError };
