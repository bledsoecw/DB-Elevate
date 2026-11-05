const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const BASE = 'http://localhost:3000';
const PASSWORD = 'ElevateDemo!2026';
const OUT = process.argv[2] || '/tmp/shots';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 950, scale: 2 },
  { name: 'phone', width: 390, height: 844, scale: 2, mobile: true },
];

// Pages chosen to cover every layout pattern: dashboards, tables, forms,
// charts, the review form, and the printable results page.
const PAGES = [
  ['priya.raghunathan@dreambuilder.example', '/', 'home-hr'],
  ['priya.raghunathan@dreambuilder.example', '/admin', 'admin-hub'],
  ['priya.raghunathan@dreambuilder.example', '/admin/competencies', 'competencies'],
  ['priya.raghunathan@dreambuilder.example', '/admin/scales', 'scales'],
  ['priya.raghunathan@dreambuilder.example', '/admin/calibration', 'calibration'],
  ['priya.raghunathan@dreambuilder.example', '/reports', 'reports'],
  ['priya.raghunathan@dreambuilder.example', '/people', 'people'],
  ['terrence.okafor@dreambuilder.example', '/admin/accounts', 'accounts'],
  ['terrence.okafor@dreambuilder.example', '/admin/audit', 'audit'],
  ['terrence.okafor@dreambuilder.example', '/admin/system', 'system-settings'],
  ['terrence.okafor@dreambuilder.example', '/admin/ai', 'ai-settings'],
  ['rosa.delgado@dreambuilder.example', '/', 'home-manager'],
  ['rosa.delgado@dreambuilder.example', '/development', 'development'],
  ['rosa.delgado@dreambuilder.example', '/meetings', 'meetings'],
  ['rosa.delgado@dreambuilder.example', '/goals', 'goals'],
  ['yuki.tanabe@dreambuilder.example', '/', 'home-employee'],
  ['yuki.tanabe@dreambuilder.example', '/tasks', 'tasks'],
  ['yuki.tanabe@dreambuilder.example', '/feedback', 'feedback'],
  ['yuki.tanabe@dreambuilder.example', '/account', 'account'],
  ['yuki.tanabe@dreambuilder.example', '/help/privacy', 'privacy-notes'],
];

const problems = [];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.scale,
      isMobile: Boolean(vp.mobile),
      hasTouch: Boolean(vp.mobile),
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    let signedInAs = null;

    for (const [email, route, label] of PAGES) {
      if (signedInAs !== email) {
        await ctx.clearCookies();
        await page.goto(BASE + '/login', { waitUntil: 'load' });
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', PASSWORD);
        for (let i = 0; i < 4; i++) {
          await page.click('button[type="submit"]');
          try {
            await page.waitForFunction(() => !location.pathname.startsWith('/login'), undefined, { timeout: 15000 });
            break;
          } catch {}
        }
        await page.waitForSelector('[data-hydrated="true"]');
        signedInAs = email;
      }

      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#main-content', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(500);

      // Horizontal overflow is the classic responsive failure: a table or a
      // wide chart pushing the whole page sideways.
      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowing = Array.from(document.querySelectorAll('body *'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > window.innerWidth + 2;
          })
          .slice(0, 4)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] ?? ''}`);
        // Smallest interactive target, for touch reachability.
        //
        // Inline links inside a sentence are excluded: they are text-height by
        // convention and are explicitly exempt from the 24px minimum-target
        // rule (WCAG 2.5.8, "in-line" exception). Counting them flagged every
        // page in the application for a link in a paragraph, which is noise
        // that hides a real undersized button.
        let minTarget = 9999;
        let minTargetWhat = null;
        for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const display = getComputedStyle(el).display;
          const isInlineLink = el.tagName === 'A' && display === 'inline';
          if (isInlineLink) continue;

          // A checkbox or radio is tapped via its label as much as its box, so
          // measure the two together — that is the area a thumb can actually
          // hit. Measuring the 16px box alone flagged every form in the app for
          // a control that is comfortable to use.
          let height = r.height;
          const type = el.getAttribute('type');
          if (el.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
            const labels = el.labels ? Array.from(el.labels) : [];
            for (const label of labels) {
              const lr = label.getBoundingClientRect();
              if (lr.height > height) height = lr.height;
            }
          }

          if (Math.round(height) < minTarget) {
            minTarget = Math.round(height);
            minTargetWhat = `${el.tagName.toLowerCase()}${type ? `[${type}]` : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
          }
        }
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          overflowing,
          minTarget: minTarget === 9999 ? null : minTarget,
          minTargetWhat,
          h1: document.querySelector('h1')?.textContent?.trim().slice(0, 40) ?? '(no h1)',
        };
      });

      const overflow = metrics.scrollWidth - metrics.clientWidth;
      if (overflow > 2) {
        problems.push(
          `${vp.name} ${route}: horizontal overflow of ${overflow}px${metrics.overflowing.length ? ' — ' + metrics.overflowing.join(', ') : ''}`,
        );
      }
      if (vp.mobile && metrics.minTarget !== null && metrics.minTarget < 24) {
        problems.push(
          `${vp.name} ${route}: smallest tap target is only ${metrics.minTarget}px tall — ${metrics.minTargetWhat}`,
        );
      }

      await page.screenshot({
        path: path.join(OUT, `${vp.name}-${label}.png`),
        fullPage: false,
      });
      console.log(
        `${vp.name.padEnd(8)} ${route.padEnd(26)} overflow ${String(overflow).padStart(4)}px  minTap ${String(metrics.minTarget).padStart(3)}  ${metrics.h1}`,
      );
    }
    await ctx.close();
  }

  await browser.close();
  console.log('\n--- layout problems ---');
  console.log(problems.length ? problems.join('\n') : '(none)');
  console.log(`\nscreenshots in ${OUT}`);
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(2); });
