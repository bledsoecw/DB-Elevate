import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runJobs } from '@/server/jobs/runner';

/**
 * HTTP trigger for the scheduled runner, for platforms that offer a cron-style
 * webhook rather than a shell.
 *
 *   curl -X POST https://host/api/jobs/run -H "Authorization: Bearer $JOBS_TOKEN"

 * Vercel Cron calls the same route with GET and its own CRON_SECRET; see
 * vercel.json.
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
  return runFromRequest(request);
}

async function runFromRequest(request: Request): Promise<NextResponse> {
  // Either secret is accepted: JOBS_TOKEN for an external scheduler, and
  // CRON_SECRET for Vercel's, which the platform injects itself.
  const expected = process.env.JOBS_TOKEN || process.env.CRON_SECRET;
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

/**
 * Vercel Cron, which can only issue a GET.
 *
 * Held to the same standard as POST rather than being a softer way in: it
 * requires the same Bearer token, compared the same way, and returns the same
 * 404 when no token is configured. The one difference is that it also accepts
 * Vercel's own CRON_SECRET, which the platform sets on scheduled invocations.
 *
 * A GET that changes things is normally a mistake — it can be prefetched or
 * cached. Neither applies to an authenticated endpoint that no browser ever
 * links to, and the response is marked no-store regardless. The alternative
 * was a second route doing the same work, which is worse.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return runFromRequest(request);
}

export const dynamic = 'force-dynamic';
