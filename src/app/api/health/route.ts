import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';

/**
 * Liveness and readiness probe. Reports whether the database is reachable
 * without disclosing any configuration detail.
 */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      database: 'reachable',
      latencyMs: Date.now() - started,
    });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503 });
  }
}
