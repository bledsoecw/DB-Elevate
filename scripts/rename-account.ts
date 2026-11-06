/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { parseDomains } from '../src/server/auth/sso-config';

/**
 * Change the address and name on an existing account.
 *
 * This exists for one situation: the bootstrap account was created with the
 * wrong address, and nobody can sign in to fix it from inside the application
 * because signing in is exactly what is broken. Every other rename belongs in
 * Administration -> Accounts, where it is audited against whoever did it.
 *
 *   npm run rename-account -- --from old@company.com --to new@company.com \
 *     --name "First Last"
 *
 * What it will not do:
 *  - Move an address onto an account when another account already uses it.
 *  - Leave a stale single-sign-on link behind. The link is cleared, so the
 *    next Google sign-in for the new address claims the account afresh.
 *  - Touch anything if the new address is outside GOOGLE_WORKSPACE_DOMAIN
 *    while single sign-on is configured, because the result would be an
 *    account nobody can sign in to.
 */

const prisma = new PrismaClient();

interface Args {
  from?: string;
  to?: string;
  name?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--from') args.from = argv[++i];
    else if (arg === '--to') args.to = argv[++i];
    else if (arg === '--name') args.name = argv[++i];
  }
  return args;
}

const USAGE = `
  Change the address and name on an account.

    npm run rename-account -- --from <address> --to <address> [--name "First Last"]

  Use this only to repair a bootstrap account created with the wrong address.
  Any other rename belongs in Administration -> Accounts, where it is audited.
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const from = args.from?.trim().toLowerCase();
  const to = args.to?.trim().toLowerCase();

  if (!from || !to) {
    console.error(USAGE);
    return 1;
  }
  if (!to.includes('@') || to.startsWith('@') || to.endsWith('@')) {
    console.error(`\n  "${to}" is not an e-mail address.\n`);
    return 1;
  }

  const user = await prisma.user.findFirst({
    where: { email: from },
    include: { employee: true, roles: true },
  });
  if (!user) {
    console.error(`\n  No account uses ${from}.\n`);
    return 1;
  }

  if (from !== to) {
    const clash = await prisma.user.findFirst({ where: { email: to }, select: { id: true } });
    if (clash) {
      console.error(`\n  ${to} is already used by another account. Nothing was changed.\n`);
      return 1;
    }
  }

  // With single sign-on configured, an address outside the Workspace domain
  // produces an account that cannot be signed in to at all. Refuse rather than
  // hand somebody a second broken account to repair.
  const domains = parseDomains(process.env.GOOGLE_WORKSPACE_DOMAIN);
  if (domains.length > 0) {
    const domain = to.slice(to.lastIndexOf('@') + 1);
    if (!domains.includes(domain)) {
      console.error(
        `\n  ${to} is not in ${domains.join(' or ')}, so single sign-on would refuse it.\n` +
          '  Nothing was changed.\n',
      );
      return 1;
    }
  }

  const [firstName, ...rest] = (args.name ?? '').trim().split(/\s+/).filter(Boolean);
  const lastName = rest.join(' ');
  const renaming = Boolean(args.name && firstName);
  if (args.name && !lastName) {
    console.error('\n  --name needs a first and a last name, e.g. --name "Operations Account".\n');
    return 1;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        email: to,
        // Any existing link belongs to the OLD address. Clearing it means the
        // next successful Google sign-in for the new address claims the
        // account, rather than the account being stuck on a dead identity.
        externalIdpSubject: null,
      },
    });

    if (user.employee) {
      await tx.employee.update({
        where: { id: user.employee.id },
        data: {
          workEmail: to,
          ...(renaming ? { firstName: firstName as string, lastName } : {}),
        },
      });
    }

    // Every session was issued to the old identity.
    await tx.session.deleteMany({ where: { userId: user.id } });
  });

  const line = '='.repeat(62);
  console.log(`\n${line}`);
  console.log('  Account updated.');
  console.log(line);
  console.log(`  Was           ${from}`);
  console.log(`  Now           ${to}`);
  if (renaming) console.log(`  Name          ${firstName} ${lastName}`);
  console.log(`  Roles         ${user.roles.map((r) => r.role).join(', ')}`);
  console.log(`  Sign-in       ${user.passwordHash === null ? 'Google Workspace (no password)' : 'Password'}`);
  console.log('  Sessions      ended; any existing single sign-on link cleared');
  console.log(`${line}\n`);
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error('\n  Rename failed:', error instanceof Error ? error.message : error, '\n');
    await prisma.$disconnect();
    process.exit(1);
  });
