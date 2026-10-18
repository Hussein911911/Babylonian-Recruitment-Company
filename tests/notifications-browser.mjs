/* Optional, isolated Chromium layout checks (no production credentials/data).
 * npm install --no-save --package-lock=false playwright-core @sparticuz/chromium
 * Start `node tools/serve.mjs 4173` separately; then:
 * node tests/notifications-browser.mjs
 * Screenshots/libraries stay under ignored tests/.tmp/layout-review/.
 * All non-local requests are blocked; service workers are disabled. The staff
 * session is a synthetic DOM fixture, NOT an authentication/security test.
 */
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DEMO_SEED } from './fixtures/demo-seed.mjs';

const base = 'http://127.0.0.1:4173/';
const output = fileURLToPath(new URL('./.tmp/layout-review/', import.meta.url));
mkdirSync(output, { recursive: true });
// Supply Chromium's packaged Linux libraries in minimal preview containers.
const libs = join(output, 'libraries');
const archive = new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url);
if (process.platform === 'linux' && existsSync(archive) && !existsSync(join(libs, 'lib'))) {
  mkdirSync(libs, { recursive: true });
  const tar = join(libs, 'libraries.tar');
  writeFileSync(tar, brotliDecompressSync(readFileSync(archive)));
  execFileSync('tar', ['xf', tar, '-C', libs]);
}
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(s => !['--single-process', '--in-process-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),
  env: { ...process.env, LD_LIBRARY_PATH: [join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  headless: true
});
let checks = 0;
function check(value, label) { assert.ok(value, label); checks++; }
async function contentFits(page, targets) {
  const bad = await page.locator(targets).evaluateAll(elements => elements.flatMap(el => {
    if (!el.getClientRects().length) return [];
    const card = el.closest('.job-card,.ov-stat,.jobs-stat,.cards-stat,.notice-item') || el;
    const bounds = card.getBoundingClientRect(), own = el.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(el);
    return [...range.getClientRects()].filter(r => r.width && (r.left < bounds.left + 2 || r.right > bounds.right - 2))
      .map(r => ({ class: el.className, text: el.textContent.slice(0, 100), bounds: [bounds.left, bounds.right], textBounds: [r.left, r.right], width: own.width }));
  }));
  assert.deepEqual(bad, [], 'Text/numbers must fit actual cards, not just a clipped document'); checks++;
}
try {
  for (const width of (process.env.HRC_VISUAL_WIDTHS ? process.env.HRC_VISUAL_WIDTHS.split(',').map(Number) : [320, 375, 768, 1440])) {
    console.log('Reviewing viewport', width);
    const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(seed => {
      window.__HRC_TEST_SEED__ = seed;
      sessionStorage.setItem('hrc_session_v2', JSON.stringify({ username: 'visual-fixture', name: 'موظف اختبار', role: 'admin', cloud: true }));
    }, DEMO_SEED);
    await page.route('**/*', r => {
      const url = r.request().url();
      if (url.startsWith(base) && url.includes('/assets/js/supabase-config.js')) return r.fulfill({ contentType: 'application/javascript', body: 'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};' });
      return url.startsWith(base) && r.request().method() === 'GET' ? r.continue() : r.abort();
    });
    await page.goto(base + 'index.html');
    await page.locator('.job-title').first().waitFor();
    await page.evaluate(() => {
      const job = HRCStore.db().jobs[0];
      job.title = 'مهندس تشغيل وصيانة مخازن قطع الغيار والأجهزة الكهربائية';
      job.category = 'وظائف الإدارة والخدمات المساندة';
      job.salaryMin = 1500000000; job.salaryMax = 2500000000;
      HRCStore.emit();
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
    });
    await page.waitForTimeout(400);
    check(await page.locator('.job-title').first().evaluate(el => el.getBoundingClientRect().width >= 160), 'Arabic title has real width');
    await contentFits(page, '.job-title,.job-meta .mi span,.job-code,.job-foot .salary,.job-statuses .badge,.job-statuses .chip');
    if ([375, 1440].includes(width)) await page.locator('.job-card').first().screenshot({ path: join(output, `job-stress-${width}.png`) });

    await page.goto(base + 'dashboard.html');
    await page.locator('#ov-stats .ov-stat').first().waitFor({ state: 'visible' });
    await page.evaluate(() => {
      window.__noticeToasts = [];
      const toast = HRCUI.toast;
      HRCUI.toast = function (...args) { __noticeToasts.push(args); return toast.apply(this, args); };
    });
    await page.locator('#notification-toggle').click();
    check(await page.locator('#notification-center').isVisible(), 'Drawer opens');
    check(await page.evaluate(() => document.getElementById('app-shell').inert), 'Background is inert');
    await page.keyboard.press('Shift+Tab');
    check(await page.evaluate(() => document.querySelector('.notification-drawer').contains(document.activeElement)), 'Keyboard focus trapped');
    await page.locator('#notification-read-all').click();
    check(await page.locator('#notification-count').isHidden(), 'Read all clears counter');
    await page.keyboard.press('Escape');
    check(await page.locator('#notification-toggle').evaluate(el => el === document.activeElement), 'Escape restores trigger focus');
    check(!await page.evaluate(() => document.getElementById('app-shell').inert), 'Background restored');

    const booking = await page.evaluate(() => {
      const S = HRCStore, db = S.db();
      const a = db.applicants.find(a => a.status === 'active' && S.attemptsLeft(a.serial) > 0 && !S.getAttempts(a.serial).some(t => ['reserved', 'hiring', 'critical'].includes(t.slotStatus)));
      const j = db.jobs.find(j => j.status === 'available');
      window.__noticeBooking = { serial: a.serial, jobCode: j.code };
      return S.selectAttempt(a.serial, j.code);
    });
    check(booking.ok, 'Fixture reservation emits a real Store update');
    check(!await page.locator('#notification-count').isHidden(), 'Reservation updates bell');
    await page.locator('#notification-toggle').click();
    await page.locator('[data-filter="booking"]').click();
    check(await page.locator('.notice-item').count() > 0, 'Booking filter works');
    await page.locator('#notification-read-all').click();
    await page.keyboard.press('Escape');
    const reason = 'الدوام غير مناسب <img src=x onerror=window.__noticeXss=1> — نحتاج خبرة بمخزن المواد الكهربائية';
    const decision = await page.evaluate(reason => HRCStore.employerDecide(__noticeBooking.serial, 'reject', reason), reason);
    check(decision.ok, 'Fixture employer decision emits a Store update');
    await page.waitForFunction(()=>document.getElementById('notification-count').textContent === '1');
    check(await page.locator('#notification-count').textContent() === '1', 'One new decision, no duplicate audit/decision notices');
    check(await page.evaluate(() => __noticeToasts.length === 1), 'Exactly one live employer-decision toast');
    await page.evaluate(() => { HRCStore.emit(); HRCStore.emit(); });
    check(await page.evaluate(() => __noticeToasts.length === 1), 'Repeated Store renders do not repeat the toast');
    await page.locator('#notification-toggle').click();
    await page.locator('[data-filter="decision"]').click();
    const notice = page.locator('.notice-item').filter({ hasText: reason }).first();
    check(await notice.isVisible(), 'Employer rejection and exact reason visible');
    check(await notice.locator('img').count() === 0 && !await page.evaluate(() => window.__noticeXss), 'Reason HTML is escaped');
    await contentFits(page, '.notice-heading h3,.notice-content>p,.notice-content time');
    if ([375, 1440].includes(width)) await page.screenshot({ path: join(output, `notifications-${width}.png`) });
    await notice.locator('[data-notice-read]').click();
    check(await page.locator('#notification-count').isHidden(), 'Mark individual decision read');
    await page.locator('[data-filter="unread"]').click();
    check(await page.locator('.notice-empty').isVisible(), 'Unread empty state');
    const ids = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('hrc-notifications-read:')).map(k => localStorage.getItem(k)).join(''));
    check(!ids.includes(await page.evaluate(()=>__noticeBooking.serial)) && !ids.includes(reason) && !ids.includes('موظف اختبار') && !ids.includes('SECRET'), 'Only read IDs persisted, no payload/secret');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('#ov-stats .ov-stat').first().waitFor({ state: 'visible' });
    await page.evaluate(()=>HRCNotifications.refresh());
    check(await page.locator('#notification-count').isHidden(), 'Read state persists across reload');
    await page.evaluate(async () => {
      sessionStorage.setItem('hrc_session_v2', JSON.stringify({ username: 'different-fixture', role: 'admin', cloud: true }));
      await HRCNotifications.refresh();
    });
    check(!await page.locator('#notification-count').isHidden(), 'Other account has separate unread state');
    await page.evaluate(async () => {
      sessionStorage.setItem('hrc_session_v2', JSON.stringify({ username: 'visual-fixture', role: 'admin', cloud: true }));
      await HRCNotifications.refresh();
    });
    check(await page.locator('#notification-count').isHidden(), 'Original account read state restored');
    await page.locator('#notification-toggle').click();
    await page.locator('[data-filter="decision"]').click();
    await page.locator('.notice-item').filter({ hasText: reason }).first().locator('[data-notice-open]').click();
    check(await page.locator('#notification-center').isHidden(), 'Details closes drawer');
    check(await page.locator('.modal-backdrop').isVisible(), 'Details opens existing authorized company workflow');
    await page.locator('.modal-backdrop [data-close]').first().click();

    // Large real numbers must remain legible even when clipping hides overflow.
    await page.evaluate(() => {
      document.querySelector('[data-view="overview"]').click();
      document.querySelectorAll('.ov-stat:not(:last-child) .ov-val').forEach(el => { el.textContent = '987654321'; });
      document.querySelector('.ov-stat:last-child .ov-val').textContent = '9,876,543,210,000 د.ع';
    });
    await contentFits(page, '.ov-val,.ov-lbl,.ov-hint');
    for (const view of ['jobs', 'applicants']) {
      await page.locator(`[data-view="${view}"]`).evaluate(el => el.click());
      await page.evaluate(() => document.querySelectorAll('.js-val,.cs-val').forEach(el => { el.textContent = '987654321'; }));
      await contentFits(page, '.js-val,.cs-val,.js-lbl,.cs-lbl');
    }
    await page.locator('#notification-toggle').click();
    await page.emulateMedia({ media: 'print' });
    check(await page.locator('#notification-center').isHidden(), 'Notifications never print');
    await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' });
    check(await page.locator('.notification-drawer').evaluate(el => getComputedStyle(el).animationName === 'none'), 'Reduced motion honored');
    await page.evaluate(() => HRCStore.logout());
    await page.locator('#login-wrap').waitFor({ state: 'visible' });
    check(await page.locator('#notification-center').isHidden() && await page.locator('#notification-list').textContent() === '', 'Logout closes drawer and clears private content');
    check(await page.locator('#notification-live').textContent() === '', 'Logout clears live announcement');
    assert.deepEqual(errors, [], 'No JS page errors'); checks++;
    await page.close();
  }
  console.log(`PASS ${checks} isolated notification/layout browser checks. No live backend requests.`);
} finally { await browser.close(); }
