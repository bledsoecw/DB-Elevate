import type { Prisma } from '@prisma/client';

/**
 * Case-insensitive text matching, spelled the same way everywhere.
 *
 * This exists because of a genuine difference between the two databases this
 * schema runs on, and because the difference is silent:
 *
 *  - On SQLite, `LIKE` is case-insensitive for ASCII by default, so
 *    `{ contains: 'rosa' }` finds "Rosa".
 *  - On PostgreSQL, `LIKE` is case-sensitive, so the same query finds nothing.
 *
 * Nothing errors. Every search box just quietly stops matching anything the
 * user did not capitalise exactly, which is the kind of regression that
 * survives a deployment and gets reported weeks later as "search is broken".
 *
 * `mode: 'insensitive'` makes Postgres use ILIKE and is ignored by SQLite,
 * which is already insensitive — so one spelling is correct on both.
 */
export function containsInsensitive(value: string): Prisma.StringFilter {
  return { contains: value, mode: 'insensitive' };
}

export function startsWithInsensitive(value: string): Prisma.StringFilter {
  return { startsWith: value, mode: 'insensitive' };
}

/** The nullable-column form, for `String?` fields. */
export function containsInsensitiveNullable(value: string): Prisma.StringNullableFilter {
  return { contains: value, mode: 'insensitive' };
}
