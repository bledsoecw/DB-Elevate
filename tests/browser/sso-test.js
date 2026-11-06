/**
 * Google Workspace single sign-on.
 *
 * Boots its own server on port 3100 twice: once with SSO enforced, once with
 * SSO alongside passwords. Nothing here talks to Google — the redirect to
 * accounts.google.com is inspected, never followed — so this suite is
 * deterministic and costs nothing.
 *
 * WHAT THIS CANNOT COVER: the live round trip. A real Google sign-in needs a
 * real OAuth client, a real Workspace account and a public callback URL, none
 * of which exist here. The claim rules that decide who gets in are unit-tested
 * exhaustively in tests/unit/sso.test.ts against a fake Google; what follows
 * is the plumbing around them.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const PW = process.env.SEED_PASSWORD || 'ElevateDemo!2026';

const FAKE_SSO = {
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-secret-not-a-real-one',
  GOOGLE_WORKSPACE_DOMAIN: 'deitemeyerbrothers.com',
  APP_URL: BASE,
};

/** Dev compiles each route on first request; a cold compile outlasts the default timeout. */
const REQ = { maxRedirects: 0, failOnStatusCode: false, timeout: 120000 };
const POST_REQ = { failOnStatusCode: false, timeout: 120000 };

/** Touch a route so the first assertion is not also paying for its compile. */
async function warm(ctx, path, options = {}) {
  try {
    await ctx.request.fetch(`${BASE}${path}`, { failOnStatusCode: false, timeout: 120000, ...options });
  } catch {}
}

const results = [];
const check = (n, ok, d) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

function startServer(env) {
  // Detached, and the binary directly rather than through npx: killing npx
  // leaves the real server holding the port, and the next server then fails to
  // bind while the test happily re-tests the old one. That cost four
  // mystifying failures before it was spotted.
  const child = spawn('node_modules/.bin/next', ['dev', '--turbopack', '-p', String(PORT)], {
    env: { ...process.env, ...env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  // Kept so a server that never comes up can say why, instead of the harness
  // reporting a bare "never came up" and leaving somebody to guess.
  child.log = '';
  const collect = (buf) => {
    child.log = (child.log + buf.toString()).slice(-4000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  return child;
}

/** True once nothing answers on the port, so the next server can bind. */
async function waitForPortFree(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await fetch(`${BASE}/login`, { redirect: 'manual' });
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function waitForServer(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/login`, { redirect: 'manual' });
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function stopServer(child) {
  if (!child || child.killed) return;
  // The whole process group: next spawns workers that would otherwise survive.
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  if (!(await waitForPortFree(10000))) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    await waitForPortFree(10000);
  }
}

async function run() {
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- enforced
  let server = startServer(FAKE_SSO);
  if (!(await waitForServer())) {
    console.error('Server with SSO enforced never came up. Its output:\n' + server.log);
    await stopServer(server);
    process.exit(2);
  }

  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);

    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await warm(ctx, '/api/auth/login', { method: 'POST', data: {} });
    await warm(ctx, '/api/auth/sso/start');
    await warm(ctx, '/api/auth/sso/callback');
    const body = await page.locator('body').innerText();

    check(
      'The Google button is offered when SSO is configured',
      (await page.locator('a[href^="/api/auth/sso/start"]').count()) > 0,
    );
    check(
      'The page names the Workspace domain sign-in is restricted to',
      /deitemeyerbrothers\.com/i.test(body),
    );
    check(
      'The password form is not shown when passwords are refused',
      (await page.locator('input[name="password"]').count()) === 0,
    );
    check(
      'The demonstration panel is not offered either, since it signs in with a password',
      !/Demonstration accounts/i.test(body),
    );

    // The one that matters: the endpoint, not the page.
    const refused = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: { email: 'gloria.mbeki@deitemeyerbrothers.example', password: PW },
      ...POST_REQ,
    });
    check(
      'The password endpoint refuses even a correct password',
      refused.status() === 403,
      `HTTP ${refused.status()}`,
    );
    const refusedBody = await refused.text();
    check(
      'The refusal names the reason rather than implying a wrong password',
      /password_login_disabled/.test(refusedBody),
      refusedBody.slice(0, 120),
    );

    // The redirect out to Google, inspected but never followed.
    const start = await ctx.request.get(`${BASE}/api/auth/sso/start`, REQ);
    const location = start.headers()['location'] ?? '';
    check('Starting a sign-in redirects to Google', /^https:\/\/accounts\.google\.com\//.test(location), location.slice(0, 60));

    const authUrl = location ? new URL(location) : null;
    check(
      'The redirect carries PKCE, a state and a nonce',
      Boolean(
        authUrl &&
          authUrl.searchParams.get('code_challenge_method') === 'S256' &&
          authUrl.searchParams.get('code_challenge') &&
          authUrl.searchParams.get('state') &&
          authUrl.searchParams.get('nonce'),
      ),
    );
    check(
      'The redirect asks Google for this Workspace only',
      authUrl?.searchParams.get('hd') === 'deitemeyerbrothers.com',
    );
    check(
      'The client secret never appears in the redirect',
      !location.includes(FAKE_SSO.GOOGLE_CLIENT_SECRET),
    );

    const setCookie = String(start.headers()['set-cookie'] ?? '');
    check(
      'The state, nonce and verifier are set as httpOnly cookies',
      /dbe_sso_state/.test(setCookie) &&
        /dbe_sso_nonce/.test(setCookie) &&
        /dbe_sso_verifier/.test(setCookie) &&
        /HttpOnly/i.test(setCookie),
    );

    // A callback with no sign-in in progress. A context of its own, because
    // the one above has already started a sign-in and therefore HAS the
    // cookies — testing it there would prove the wrong thing.
    const cold = await browser.newContext();
    const stale = await cold.request.get(`${BASE}/api/auth/sso/callback?code=x&state=y`, REQ);
    check(
      'A callback with no sign-in in progress is refused',
      /\/login\?sso=expired/.test(stale.headers()['location'] ?? ''),
      stale.headers()['location'] ?? `HTTP ${stale.status()}`,
    );
    await cold.close();

    // A callback whose state does not match the cookie.
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await freshPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await fresh.request.get(`${BASE}/api/auth/sso/start`, REQ);
    const wrongState = await fresh.request.get(
      `${BASE}/api/auth/sso/callback?code=abc&state=not-the-right-state`,
      REQ,
    );
    check(
      'A callback whose state does not match the browser is refused',
      /\/login\?sso=state/.test(wrongState.headers()['location'] ?? ''),
      wrongState.headers()['location'] ?? `HTTP ${wrongState.status()}`,
    );
    await fresh.close();

    // A cancelled consent screen is reported as a cancellation, not a failure.
    const cancelled = await ctx.request.get(
      `${BASE}/api/auth/sso/callback?error=access_denied`,
      REQ,
    );
    check(
      'A cancelled sign-in comes back as cancelled, not as an error',
      /\/login\?sso=cancelled/.test(cancelled.headers()['location'] ?? ''),
      cancelled.headers()['location'] ?? '',
    );

    // Nothing an attacker puts in the URL becomes markup. Asserted on the
    // rendered DOM and on whether any script ran, not on the page source:
    // React's serialized props legitimately contain the raw query string as
    // escaped JSON, and a string search would fail on that while proving
    // nothing either way.
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss();
    });
    await page.goto(`${BASE}/login?sso=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(800);
    const injected = await page.locator('img[onerror], img[src="x"]').count();
    const noticeText = await page.locator('[role="status"]').first().innerText().catch(() => '');
    check(
      'A crafted sso code becomes no markup and runs no script',
      injected === 0 && !dialogFired,
      `${injected} injected element(s), dialog ${dialogFired}`,
    );
    check(
      'An unknown sso code falls back to a message written here',
      /did not complete/i.test(noticeText),
      noticeText.split('\n')[0],
    );

    await ctx.close();
  }

  await stopServer(server);

  // ------------------------------------------------- SSO alongside passwords
  server = startServer({ ...FAKE_SSO, ALLOW_PASSWORD_LOGIN: 'true' });
  if (!(await waitForServer())) {
    console.error('Server with SSO and passwords never came up. Its output:\n' + server.log);
    await stopServer(server);
    process.exit(2);
  }

  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    await warm(ctx, '/api/auth/login', { method: 'POST', data: {} });

    check(
      'With passwords kept, both ways in are offered',
      (await page.locator('a[href^="/api/auth/sso/start"]').count()) > 0 &&
        (await page.locator('input[name="password"]').count()) > 0,
    );

    const ok = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: { email: 'gloria.mbeki@deitemeyerbrothers.example', password: PW },
      ...POST_REQ,
    });
    check(
      'A password sign-in still works when it is deliberately kept',
      ok.status() === 200,
      `HTTP ${ok.status()}`,
    );

    // An account with no password must not be distinguishable from one that
    // does not exist. Both get the same generic refusal.
    // The rule that outlives ALLOW_PASSWORD_LOGIN: a Workspace address signs
    // in with Google whatever else is configured. This server HAS passwords
    // enabled, and the company address is still refused.
    const workspaceAddress = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: { email: 'someone@deitemeyerbrothers.com', password: PW },
      ...POST_REQ,
    });
    check(
      'A Workspace address is refused a password even with passwords enabled',
      workspaceAddress.status() === 403 && /sso_required/.test(await workspaceAddress.text()),
      `HTTP ${workspaceAddress.status()}`,
    );

    const outsideAddress = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: { email: 'contractor@elsewhere.example', password: 'not-the-password' },
      ...POST_REQ,
    });
    check(
      'An address outside the Workspace still gets the ordinary password path',
      outsideAddress.status() === 401,
      `HTTP ${outsideAddress.status()}`,
    );

    const unknown = await ctx.request.post(`${BASE}/api/auth/login`, {
      data: { email: 'nobody.at.all@deitemeyerbrothers.example', password: 'whatever-it-is' },
      ...POST_REQ,
    });
    check(
      'An unknown address gets a generic refusal',
      unknown.status() === 401 && /invalid_credentials/.test(await unknown.text()),
      `HTTP ${unknown.status()}`,
    );

    await ctx.close();
  }

  await stopServer(server);
  await browser.close();

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

run().catch(async (e) => {
  console.error('FAILED:', e.message);
  process.exit(2);
});
