import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton. Next.js hot-reloads modules in development, which would
 * otherwise open a new connection pool on every edit.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { emit: 'stdout', level: 'warn' },
            { emit: 'stdout', level: 'error' },
          ]
        : [{ emit: 'stdout', level: 'error' }],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** The subset of the client available inside an interactive transaction. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type Db = PrismaClient | Tx;
