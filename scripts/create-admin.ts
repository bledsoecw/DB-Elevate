/**
 * First-run bootstrap: creates an organization and its first administrator.
 *
 *   npm run create-admin -- --email you@company.com --name "Ada Lovelace" --org "Your Company"
 *
 * Why this exists as a command-line script rather than a screen: every
 * account-creating route in the application requires an authorized actor, and
 * on an empty database no actor can exist. Without this, a real organization
 * is locked out of its own installation and the only way in is seeding 27
 * fictional employees. Authorization here is shell access to the server, which
 * is the right gate for a step that happens exactly once.
 *
 * It refuses to run if an administrator already exists, so it cannot be used
 * to quietly mint a second one on a live system.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword, passwordProblems } from '../src/server/auth/password';

const prisma = new PrismaClient();

interface Args {
  email?: string;
  name?: string;
  org?: string;
  password?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--email') args.email = argv[++i];
    else if (arg === '--name') args.name = argv[++i];
    else if (arg === '--org') args.org = argv[++i];
    else if (arg === '--password') args.password = argv[++i];
  }
  return args;
}

const USAGE = `
  Create the first organization and administrator.

    npm run create-admin -- --email <address> --name "<first last>" [options]

  Options
    --email     <address>    Required. The sign-in address.
    --name      "First Last" Required. The person's name.
    --org       "<name>"     Company name. Default: "Your Company".
                             Ignored if an organization already exists.
    --password  <value>      Optional. One is generated if omitted.

  The password is printed once and never stored in plain text. If an
  administrator already exists this refuses to run; use Administration ->
  Accounts to create further accounts.
`;

/** Readable but not guessable: four words and four digits. */
function generatePassword(): string {
  const words = [
    'cedar', 'gravel', 'rafter', 'mortar', 'shingle', 'trowel', 'joist', 'lintel',
    'granite', 'copper', 'willow', 'basalt', 'conduit', 'anvil', 'bramble', 'quarry',
  ];
  const bytes = randomBytes(4);
  const pick = (i: number) => words[bytes[i]! % words.length] as string;
  const digits = String(((bytes[3]! << 8) | bytes[0]!) % 10000).padStart(4, '0');
  const first = pick(0);
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}-${pick(1)}-${pick(2)}-${digits}`;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'organization'
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const email = args.email?.trim().toLowerCase();
  const name = args.name?.trim();

  if (!email || !name) {
    console.error('\n  --email and --name are both required.');
    console.log(USAGE);
    return 1;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`\n  "${email}" does not look like an e-mail address.\n`);
    return 1;
  }

  const parts = name.split(/\s+/);
  const firstName = parts[0] as string;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
  if (!lastName) {
    console.error('\n  Give a first and last name, e.g. --name "Ada Lovelace".\n');
    return 1;
  }

  // Refuse on a system that already has an administrator. Minting a second one
  // from a shell, bypassing the audited grant flow, is not this script's job.
  const existingAdmin = await prisma.userRole.findFirst({
    where: { role: { in: ['SYS_ADMIN', 'HR_ADMIN'] } },
    select: { user: { select: { email: true } } },
  });
  if (existingAdmin) {
    console.error(
      `\n  An administrator already exists (${existingAdmin.user.email}).\n` +
        '  Sign in and use Administration -> Accounts to create further accounts, so the\n' +
        '  grant is recorded against whoever made it.\n',
    );
    return 1;
  }

  const password = args.password ?? generatePassword();
  const problems = passwordProblems(password);
  if (problems.length > 0) {
    console.error(`\n  That password is not acceptable: ${problems.join(' ')}\n`);
    return 1;
  }

  const org =
    (await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } })) ??
    (await prisma.organization.create({
      data: {
        slug: slugify(args.org ?? 'Your Company'),
        name: args.org ?? 'Your Company',
      },
    }));

  const clash = await prisma.user.findFirst({
    where: { orgId: org.id, email },
    select: { id: true },
  });
  if (clash) {
    console.error(`\n  An account already uses ${email}.\n`);
    return 1;
  }

  const passwordHash = await hashPassword(password);

  const { employee } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        orgId: org.id,
        email,
        passwordHash,
        status: 'active',
        // Chosen on the command line and printed to a terminal, so it should
        // be replaced with something only this person knows.
        mustChangePassword: true,
        roles: {
          create: [
            // Both administrative roles, deliberately. The split matters, but
            // granting only one would lock the first person out of half the
            // application with nobody able to grant them the other.
            { role: 'SYS_ADMIN' },
            { role: 'HR_ADMIN' },
            { role: 'EMPLOYEE' },
          ],
        },
      },
    });

    const created = await tx.employee.create({
      data: {
        orgId: org.id,
        firstName,
        lastName,
        workEmail: email,
        userId: user.id,
        employmentStatus: 'active',
        // Not demonstration data, so "remove the demonstration data" leaves it.
        isDemoData: false,
      },
    });

    await tx.auditEvent.create({
      data: {
        orgId: org.id,
        actorUserId: user.id,
        actorEmployeeId: created.id,
        actorLabel: `${firstName} ${lastName}`,
        action: 'org.bootstrapped',
        entityType: 'organization',
        entityId: org.id,
        summary:
          `First-run bootstrap: created the organization and its first administrator (${email}), ` +
          'granted SYS_ADMIN, HR_ADMIN and EMPLOYEE from the command line.',
      },
    });

    return { user, employee: created };
  });

  const line = '='.repeat(62);
  console.log(`\n${line}`);
  console.log('  Administrator created.');
  console.log(line);
  console.log(`  Organization  ${org.name}`);
  console.log(`  Name          ${firstName} ${lastName}`);
  console.log(`  Sign in with  ${email}`);
  if (!args.password) {
    console.log(`  Password      ${password}`);
    console.log('                Shown once. It is stored only as a hash.');
  }
  console.log(`  Employee id   ${employee.id}`);
  console.log(line);
  console.log('\n  Next:');
  console.log('    1. npm run dev, then sign in. You will be asked to change the password.');
  console.log('    2. Administration -> Organization: set the company and product name,');
  console.log('       colours, time zone and privacy thresholds.');
  console.log('    3. People -> Import: bring in your employees from a CSV.');
  console.log('    4. Administration -> Accounts: create a second administrator, then');
  console.log('       consider dropping one of your two administrative roles. This account');
  console.log('       holds both because somebody had to start; that is not a good');
  console.log('       permanent arrangement. See docs/PERMISSIONS.md.\n');

  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error('\n  Bootstrap failed:', error instanceof Error ? error.message : error, '\n');
    await prisma.$disconnect();
    process.exit(1);
  });
