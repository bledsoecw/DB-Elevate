import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>;

// scrypt parameters. N = 2^15 with r = 8 is a reasonable interactive-login cost
// and needs no native dependency, which keeps the container reproducible.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function maxmemFor(n: number, r: number): number {
  return 256 * n * r;
}

export const PASSWORD_MIN_LENGTH = 10;

/** Returns a self-describing hash string: scrypt$N$r$p$salt$key (base64 parts). */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain.normalize('NFKC'), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmemFor(SCRYPT_N, SCRYPT_R),
  });
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (n < 1024 || r < 1 || p < 1) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(parts[5] as string, 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const actual = await scrypt(plain.normalize('NFKC'), Buffer.from(parts[4] as string, 'base64'), expected.length, {
    N: n,
    r,
    p,
    maxmem: maxmemFor(n, r),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Human-readable password rules, surfaced directly in the UI. */
export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (!/[a-zA-Z]/.test(plain)) problems.push('Include at least one letter.');
  if (!/[0-9]/.test(plain)) problems.push('Include at least one number.');
  if (/^\s|\s$/.test(plain)) problems.push('Remove leading or trailing spaces.');
  return problems;
}
