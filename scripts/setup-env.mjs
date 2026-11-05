#!/usr/bin/env node
/**
 * Creates .env from .env.example on a fresh checkout.
 *
 * Without this, `npm run setup` fails on a clean clone: Prisma needs
 * DATABASE_URL before it can read the schema, and a clone has only
 * .env.example because .env is gitignored. That failure is the first thing
 * anybody following the README would hit.
 *
 * Two rules:
 *  - An existing .env is never touched. Someone's real configuration is not
 *    this script's to overwrite, and a setup step that clobbers credentials
 *    is worse than one that does nothing.
 *  - The placeholder SESSION_SECRET is replaced with a real random value, so a
 *    local installation does not quietly run on a secret that is published in
 *    the repository and identical for every reader.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (existsSync(envPath)) {
  console.log('  .env already exists — leaving it exactly as it is.');
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error('  .env.example is missing, so .env cannot be created from it.');
  process.exit(1);
}

const secret = randomBytes(48).toString('base64');
const contents = readFileSync(examplePath, 'utf8').replace(
  /^SESSION_SECRET=.*$/m,
  `SESSION_SECRET="${secret}"`,
);

writeFileSync(envPath, contents, { mode: 0o600 });

console.log('  Created .env from .env.example with a freshly generated SESSION_SECRET.');
console.log('  It is gitignored. Review it before deploying anywhere real.');
