const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const PASSWORD = 'ElevateDemo!2026';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.split('\n')[0]));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });

  async function signIn(email) {
    await ctx.clearCookies();
    await page.goto(BASE + '/login', { waitUntil: 'load' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    for (let i = 0; i < 4; i++) {
      await page.click('button[type="submit"]');
      try { await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 15000 }); break; } catch {}
    }
    await page.waitForSelector('[data-hydrated="true"]');
  }

  // =====================================================================
  // AI: off by default, and it says why
  // =====================================================================
  await signIn('priya.raghunathan@dreambuilder.example');

  const status = await page.evaluate(async () => {
    const res = await fetch('/api/ai/status', { credentials: 'same-origin' });
    return res.json();
  });
  check('AI reports itself disabled by default', status.enabled === false,
    `provider ${status.provider}, reason: ${String(status.reason).slice(0, 60)}`);
  check('The disabled reason is specific, not generic', /switched off|no ai provider/i.test(status.reason ?? ''));

  const refused = await page.evaluate(async () => {
    const res = await fetch('/api/ai/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ kind: 'goal_wording', contextType: 'goal', contextId: 'x', draft: 'Be better at things' }),
    });
    const body = await res.json();
    return { status: res.status, message: body?.error?.message ?? '' };
  });
  check('A suggestion request is refused while AI is off', refused.status === 409,
    `HTTP ${refused.status}`);
  check('The refusal explains why rather than failing opaquely',
    /switched off|no ai provider|not available/i.test(refused.message), refused.message.slice(0, 70));

  // =====================================================================
  // AI: mock provider works, costs nothing, is labelled
  // =====================================================================
  await signIn('terrence.okafor@dreambuilder.example');
  await page.evaluate(async () => {
    await fetch('/api/admin/ai', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ aiEnabled: true, aiProvider: 'mock', aiMonthlyCallBudget: 0 }),
    });
  });

  await signIn('priya.raghunathan@dreambuilder.example');
  const onStatus = await page.evaluate(async () =>
    (await fetch('/api/ai/status', { credentials: 'same-origin' })).json());
  check('Mock provider reports enabled and local', onStatus.enabled === true && onStatus.local === true,
    `provider ${onStatus.provider}, local ${onStatus.local}`);

  const suggestion = await page.evaluate(async () => {
    const res = await fetch('/api/ai/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        kind: 'feedback_clarity', contextType: 'feedback', contextId: 'draft',
        draft: 'Good job on the kitchen, keep it up.',
      }),
    });
    return { status: res.status, body: await res.json() };
  });
  check('Mock suggestion returned', suggestion.status === 200, `HTTP ${suggestion.status}`);
  check('Suggestion text is labelled a mock inside the text itself',
    String(suggestion.body.text).includes('[MOCK SUGGESTION'));
  check('Suggestion reports it made no network call',
    suggestion.body.local === true && /no AI service was contacted/i.test(suggestion.body.sourceLabel ?? ''));
  check('Suggestion carries a context digest, not the context',
    typeof suggestion.body.contextDigest === 'string' && suggestion.body.contextDigest.length === 32
      && !String(suggestion.body.contextDigest).includes('kitchen'));

  // Deciding on it is what gets audited.
  const decided = await page.evaluate(async (id) => {
    const res = await fetch(`/api/ai/suggestions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ decision: 'EDITED', acceptedText: 'My own edited wording.' }),
    });
    return res.status;
  }, suggestion.body.id);
  check('A human decision on the suggestion is recorded', decided === 200, `HTTP ${decided}`);

  // Somebody else cannot decide on a suggestion they did not request.
  await signIn('rosa.delgado@dreambuilder.example');
  const otherDecide = await page.evaluate(async (id) => {
    const res = await fetch(`/api/ai/suggestions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ decision: 'ACCEPTED', acceptedText: 'Not mine to accept.' }),
    });
    return res.status;
  }, suggestion.body.id);
  check('Only the requester can decide on a suggestion', otherDecide === 404, `HTTP ${otherDecide}`);

  // A manager cannot ask for review-question drafting (HR-only context).
  const mgrQuestions = await page.evaluate(async () => {
    const res = await fetch('/api/ai/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ kind: 'review_question', contextType: 'template', contextId: 'x' }),
    });
    return res.status;
  });
  check('Context assembly enforces its own permission rules', mgrQuestions === 403, `HTTP ${mgrQuestions}`);

  // A meeting summary must exclude private notes even for a participant.
  const meetingId = await page.evaluate(async () => {
    const res = await fetch('/meetings', { credentials: 'same-origin' });
    const html = await res.text();
    const m = html.match(/\/meetings\/([a-z0-9]{20,})/);
    return m ? m[1] : null;
  });
  if (meetingId) {
    const summary = await page.evaluate(async (id) => {
      const res = await fetch('/api/ai/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ kind: 'meeting_summary', contextType: 'meeting', contextId: id }),
      });
      return { status: res.status, body: await res.json() };
    }, meetingId);
    check('Meeting summary available to a participant', summary.status === 200, `HTTP ${summary.status}`);
    check('Meeting summary states private notes were excluded',
      /private notes are (deliberately )?excluded/i.test(String(summary.body.text)));
  } else {
    check('Found a meeting to summarise', false, 'none found');
  }

  // Turn AI back off.
  await signIn('terrence.okafor@dreambuilder.example');
  await page.evaluate(async () => {
    await fetch('/api/admin/ai', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ aiEnabled: false, aiProvider: 'none', aiMonthlyCallBudget: 0 }),
    });
  });
  const offAgain = await page.evaluate(async () =>
    (await fetch('/api/ai/status', { credentials: 'same-origin' })).json());
  check('AI returns to disabled', offAgain.enabled === false);

  // =====================================================================
  // Attachments: private storage, inherited permissions
  // =====================================================================
  await signIn('rosa.delgado@dreambuilder.example');

  // Find one of Rosa's own open review assignments to attach to.
  const assignmentId = await page.evaluate(async () => {
    const res = await fetch('/reviews?tab=mine', { credentials: 'same-origin' });
    const html = await res.text();
    const m = html.match(/\/reviews\/assignments\/([a-z0-9]{20,})/);
    return m ? m[1] : null;
  });
  check('Found an own review assignment', Boolean(assignmentId), assignmentId ?? 'none');

  if (assignmentId) {
    const uploaded = await page.evaluate(async (ownerId) => {
      const form = new FormData();
      form.set('ownerType', 'review_assignment');
      form.set('ownerId', ownerId);
      form.set('file', new File(['Evidence notes for the review.'], 'evidence.txt', { type: 'text/plain' }));
      const res = await fetch('/api/attachments', { method: 'POST', credentials: 'same-origin', body: form });
      return { status: res.status, body: await res.json() };
    }, assignmentId);
    check('Upload accepted for an own draft', uploaded.status === 200, `HTTP ${uploaded.status} ${JSON.stringify(uploaded.body).slice(0, 120)}`);

    const attachmentId = uploaded.body?.id;
    if (attachmentId) {
      const download = await page.evaluate(async (id) => {
        const res = await fetch(`/api/attachments/${id}`, { credentials: 'same-origin' });
        return {
          status: res.status,
          disposition: res.headers.get('content-disposition'),
          cache: res.headers.get('cache-control'),
          nosniff: res.headers.get('x-content-type-options'),
          text: await res.text(),
        };
      }, attachmentId);
      check('Owner can download it', download.status === 200 && download.text.includes('Evidence notes'));
      check('Served as an attachment, never inline', /^attachment;/.test(download.disposition ?? ''),
        download.disposition ?? '');
      check('Not cacheable by a shared cache', /no-store/.test(download.cache ?? ''), download.cache ?? '');
      check('Sent with nosniff', download.nosniff === 'nosniff');

      // A disallowed type is refused.
      const badType = await page.evaluate(async (ownerId) => {
        const form = new FormData();
        form.set('ownerType', 'review_assignment');
        form.set('ownerId', ownerId);
        form.set('file', new File(['<script>alert(1)</script>'], 'x.html', { type: 'text/html' }));
        const res = await fetch('/api/attachments', { method: 'POST', credentials: 'same-origin', body: form });
        return res.status;
      }, assignmentId);
      check('A scriptable file type is refused', badType === 422, `HTTP ${badType}`);

      // An unrelated employee cannot download it.
      await signIn('yuki.tanabe@dreambuilder.example');
      const stranger = await page.evaluate(async (id) => {
        const res = await fetch(`/api/attachments/${id}`, { credentials: 'same-origin' });
        return res.status;
      }, attachmentId);
      check('An unrelated employee cannot download it', stranger === 404, `HTTP ${stranger}`);

      // A system administrator cannot either: review content is not theirs.
      await signIn('terrence.okafor@dreambuilder.example');
      const sysAdmin = await page.evaluate(async (id) => {
        const res = await fetch(`/api/attachments/${id}`, { credentials: 'same-origin' });
        return res.status;
      }, attachmentId);
      check('A system administrator cannot download review evidence', sysAdmin === 404, `HTTP ${sysAdmin}`);

      // Clean up.
      await signIn('rosa.delgado@dreambuilder.example');
      const removed = await page.evaluate(async (id) => {
        const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE', credentials: 'same-origin' });
        return res.status;
      }, attachmentId);
      check('Owner can delete it', removed === 200, `HTTP ${removed}`);
    }
  }

  // Unauthenticated access to a download is refused.
  await ctx.clearCookies();
  const anon = await page.evaluate(async () => {
    const res = await fetch('/api/attachments/anything', { credentials: 'same-origin' });
    return res.status;
  }).catch(() => 0);
  check('Anonymous download is refused', anon === 401 || anon === 404, `HTTP ${anon}`);

  console.log('\n--- console/server errors ---');
  console.log(errors.length ? [...new Set(errors)].join('\n') : '(none)');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(2); });
