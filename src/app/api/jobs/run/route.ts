import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runJobs } from '@/server/jobs/runner';

/**
 * HTTP trigger for the scheduled runner, for platforms that offer a cron-style
 * webhook rather than a shell.
 *
 *   curl -X POST https://host/api/jobs/run -H "Authorization: Bearer $JOBS_TOKEN"
 *
 * Three deliberate properties:
 *
 *  - It is disabled unless JOBS_TOKEN is set. An unset secret means the route
 *    returns 404, not 401 — an endpoint nobody configured should not advertise
 *    that it exists.
 *  - The comparison is constant-time, so the response time cannot be used to
 *    guess the token a character at a time.
 *  - It takes no session and belongs to no user. It is machine-to-machine, so
 *    it is outside the normal `handler` wrapper on purpose: there is no actor
 *    to authorize and nothing here is scoped to one.
 */

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare a fixed-size digest of each instead.
  if (a.length !== b.length) {
    // Still do the work, to keep the timing flat.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.JOBS_TOKEN;
  if (!expected || expected.trim().length === 0) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!provided || !tokenMatches(provided, expected)) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Invalid or missing job token.' } },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === 'true';

  try {
    const summary = await runJobs({ deliverEmail: !dryRun });
    return NextResponse.json(summary, {
      status: summary.errors.length > 0 ? 207 : 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error('[jobs] HTTP run failed', e);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'The job run failed. Check the server logs.' } },
      { status: 500 },
    );
  }
}

/** A GET would be cached and pre-fetched; only POST runs anything. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: { code: 'method_not_allowed', message: 'Use POST.' } },
    { status: 405 },
  );
}
