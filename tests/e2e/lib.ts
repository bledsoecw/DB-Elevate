/* eslint-disable no-console */
import { createRequire } from 'node:module';
import type { Browser, BrowserContext, Page } from 'playwright-core';

/**
 * Browser-test helpers.
 *
 * Playwright and a matching Chromium are provided by the environment, so this
 * resolves them from the global install rather than adding a second copy as a
 * project dependency. If you run these on a machine without that global
 * install, `npm i -D playwright` and the same code works.
 */
const require_ = createRequire(import.meta.url);

/**
 * Types come from `playwright-core` (a devDependency that ships no browsers);
 * the runtime comes from whichever full Playwright install has a browser. The
 * environment this was built in provides one globally, so a second copy is
 * neither downloaded nor needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightModule = { chromium: { launch: (opts?: any) => Promise<Browser> } };

function loadPlaywright(): PlaywrightModule {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/node-tools/node_modules/playwright',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      return require_(candidate) as PlaywrightModule;
    } catch {
      continue;
    }
  }
  throw new Error(
    'Playwright could not be loaded. Install it with "npm i -D playwright && npx playwright install chromium", or set PLAYWRIGHT_MODULE to an existing install.',
  );
}

const playwright = loadPlaywright();

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
export const PASSWORD = process.env.SEED_PASSWORD || 'ElevateDemo!2026';
export const NAV_TIMEOUT = Number(process.env.E2E_TIMEOUT_MS || 90000);

export const PEOPLE = {
  hr: 'priya.raghunathan@deitemeyerbrothers.example',
  sysadmin: 'terrence.okafor@deitemeyerbrothers.example',
  crewLead: 'rosa.delgado@deitemeyerbrothers.example',
  superintendent: 'grant.whitfield@deitemeyerbrothers.example',
  gm: 'marcus.villanueva@deitemeyerbrothers.example',
  apprentice: 'casey.lindgren@deitemeyerbrothers.example',
  carpenter: 'jamal.freeman@deitemeyerbrothers.example',
  otherLead: 'abebe.tesfaye@deitemeyerbrothers.example',
  office: 'yuki.tanabe@deitemeyerbrothers.example',
  deactivated: 'vince.trujillo@deitemeyerbrothers.example',
} as const;

export interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export class Runner {
  readonly results: TestResult[] = [];
  private currentGroup = '';

  group(name: string): void {
    this.currentGroup = name;
    console.log(`\n${name}`);
    console.log('-'.repeat(Math.min(name.length, 70)));
  }

  record(name: string, passed: boolean, detail?: string): void {
    const full = this.currentGroup ? `${this.currentGroup} :: ${name}` : name;
    this.results.push({ name: full, passed, detail });
    const mark = passed ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
  }

  check(name: string, condition: boolean, detail?: string): boolean {
    this.record(name, condition, condition ? undefined : detail);
    return condition;
  }

  async step(name: string, fn: () => Promise<string | void>): Promise<boolean> {
    try {
      const detail = await fn();
      this.record(name, true, detail || undefined);
      return true;
    } catch (e) {
      this.record(name, false, e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  summary(): boolean {
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.length - passed;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${passed} passed, ${failed} failed, ${this.results.length} total`);
    if (failed > 0) {
      console.log('\nFailures:');
      for (const r of this.results.filter((x) => !x.passed)) {
        console.log(`  - ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
      }
    }
    console.log('='.repeat(70));
    return failed === 0;
  }
}

export async function launch(): Promise<Browser> {
  return playwright.chromium.launch();
}

export async function newSession(
  browser: Browser,
  email: string,
  opts: { viewport?: { width: number; height: number } } = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  if (process.env.E2E_TRACE === '1') {
    const who = email.split('@')[0];
    page.on('response', (r) => {
      if (r.url().includes('/api/')) {
        console.log(`    [trace ${who}] ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
      }
    });
    page.on('pageerror', (e) => console.log(`    [trace ${who}] pageerror: ${e.message}`));
  }
  await signIn(page, email);
  return { ctx, page };
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'load', timeout: NAV_TIMEOUT });
  await page.waitForSelector('input[name="email"]', { timeout: NAV_TIMEOUT });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);

  // The form is a client component. A click that lands before React hydrates
  // does nothing at all, so submit and confirm, retrying rather than hanging.
  let signedIn = false;
  for (let attempt = 0; attempt < 4 && !signedIn; attempt += 1) {
    await page.click('button[type="submit"]');
    try {
      await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), undefined, {
        timeout: 15000,
      });
      signedIn = true;
    } catch {
      const message = await page
        .locator('[role="alert"]')
        .first()
        .innerText()
        .catch(() => '');
      // A real credential failure should fail immediately, not be retried.
      if (message && /do not match|no longer active|too many/i.test(message)) {
        throw new Error(`sign-in refused for ${email}: ${message}`);
      }
    }
  }
  if (!signedIn) throw new Error(`sign-in did not complete for ${email}`);

  await page.waitForSelector('[data-hydrated="true"]', { timeout: NAV_TIMEOUT });
}

/**
 * Navigates within the authenticated app and waits for the shell to render AND
 * for the client bundle to finish loading. Interacting before the bundle has
 * run sets DOM state that React never sees, which produces failures that look
 * like application bugs but are not.
 */
export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForSelector('#main-content', { timeout: NAV_TIMEOUT });
  // The shell sets data-hydrated once React has mounted. Waiting for it means
  // a click in a test can never land on markup with no handler attached.
  await page.waitForSelector('[data-hydrated="true"]', { timeout: NAV_TIMEOUT });
}

/**
 * Compiles the routes the tests touch before the clock starts, so a slow first
 * compile in development mode does not read as a test failure.
 */
export async function warmUp(page: Page, paths: string[]): Promise<void> {
  for (const p of paths) {
    await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => undefined);
  }
}

/**
 * Calls the REST API from inside the signed-in browser context, which is how
 * the permission tests reach the API with a real session cookie.
 */
export async function apiCall(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ method, path, body }: { method: string; path: string; body?: unknown }) => {
      const res = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json: Record<string, unknown> = {};
      try {
        json = await res.json();
      } catch {
        json = {};
      }
      return { status: res.status, json };
    },
    { method, path, body },
  );
}

/** Fetches a page and returns its status, for authorization checks. */
export async function pageStatus(page: Page, path: string): Promise<number> {
  const result = await page.evaluate(async (p: string) => {
    const res = await fetch(p, { redirect: 'manual' });
    return res.status;
  }, path);
  return result;
}

export async function textOf(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_SHOT_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
