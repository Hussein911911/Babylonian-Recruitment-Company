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

/* تسجيل قرار صاحب العمل — حُذف مسار صاحب العمل من الويب (2026-10-25)، فصار
   الموظف يسجّل القرار من اللوحة. هذا تجهيز اختبار فقط: نكتب الحقول نفسها
   التي كانت تكتبها دالة القرار ثم نطلق تحديث المتجر. */
async function recordEmployerDecision(page, serial, decision, reason) {
  return page.evaluate(([serial, decision, reason]) => {
    const S = HRCStore, db = S.db();
    const t = db.attempts.filter((x) => x.serial === serial &&
      ['reserved', 'critical', 'hiring'].includes(x.slotStatus))[0];
    if (!t) return { ok: false, error: 'لا تقديم قيد القرار' };
    t.employerDecision = decision;
    t.decisionAt = new Date().toISOString();
    t.holdExpiresAt = null;
    if (decision === 'hire') { t.slotStatus = 'hiring'; t.reason = ''; t.note = 'طلب صاحب العمل: تم التوظيف — بانتظار تثبيت الشركة'; }
    else { t.slotStatus = 'critical'; t.reason = reason; t.note = 'رفض صاحب العمل — السبب: ' + reason; }
    const j = db.jobs.filter((x) => x.id === t.jobId)[0];
    if (j) { j.status = decision === 'hire' ? 'hiring' : 'reserved'; j.critical = decision !== 'hire'; j.holdExpiresAt = null; }
    db.audit.unshift({ id: 'log-fx-' + serial + '-' + t.no, ts: t.decisionAt, user: 'staff', role: 'staff', ip: '127.0.0.1',
      name: 'موظف توظيف', action: decision === 'hire' ? 'طلب توظيف من صاحب العمل' : 'رفض من صاحب العمل مع السبب',
      entity: 'applicant', entityId: serial, details: (reason || '') });
    S.emit();
    return { ok: true };
  }, [serial, decision, reason]);
}
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
  args: chromium.args.filter(s => !['--disable-web-security', '--single-process', '--in-process-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),
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
    /* قرار المالك: بطاقتان في صف على الجوال (mobile-jobs-browser.mjs يثبّته).
       فالعنوان يحصل على ~122px عند 320px و~147px عند 375px — هذا تصميم مقصود
       لا خلل. المقياس الصحيح هنا: ≥100px (نص عربي حقيقي بعرض معتبر، لا صفر
       ولا عمود منهار)، والقِصّ نفسه يكشفه contentFits أدناه. 160px كان سقفاً
       لتصميم عمود واحد لم يبقَ. */
    check(await page.locator('.job-title').first().evaluate(el => el.getBoundingClientRect().width >= 100), 'Arabic title has real width');
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
    const unread = page.locator('.notice-unread').first();
    check((await unread.locator('.sr-only').textContent()).includes('غير مقروء'), 'Unread state is available to assistive technology');
    check(await unread.locator('.notice-row').count()===1 && await unread.locator('.notice-summary').count()===1, 'Each notice is one tappable title and summary row');
    check(await page.evaluate(() => document.getElementById('app-shell').inert), 'Background is inert');
    await page.keyboard.press('Shift+Tab');
    check(await page.evaluate(() => document.querySelector('.notification-drawer').contains(document.activeElement)), 'Keyboard focus trapped');
    await page.locator('#notification-read-all').click();
    check(await page.locator('#notification-count').isHidden(), 'Read all clears counter');
    const readCard = page.locator('.notice-item').first();
    check((await readCard.locator('.sr-only').textContent()).includes('مقروء'), 'Read state is available to assistive technology');
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
    const serialNotice = await page.evaluate(() => __noticeBooking.serial);
    const decision = await recordEmployerDecision(page, serialNotice, 'reject', reason);
    check(decision.ok, 'Fixture employer decision emits a Store update');
    // Parent remains available when other vacancies exist: select this exact seat.
    await page.evaluate(() => {
      const db=HRCStore.db(), t=db.attempts.find(t=>t.serial===__noticeBooking.serial && t.employerDecision==='reject');
      const job=db.jobs.find(j=>j.id===t.jobId); t.vacancyNo=2; job.vacancies=3; job.status='available'; HRCStore.emit();
    });
    await page.waitForFunction(()=>document.getElementById('notification-count').textContent === '1');
    check(await page.locator('#notification-count').textContent() === '1', 'One new decision, no duplicate audit/decision notices');
    check(await page.evaluate(() => __noticeToasts.length === 1), 'Exactly one live employer-decision toast');
    await page.evaluate(() => { HRCStore.emit(); HRCStore.emit(); });
    check(await page.evaluate(() => __noticeToasts.length === 1), 'Repeated Store renders do not repeat the toast');
    await page.locator('#notification-toggle').click();
    await page.locator('[data-filter="decision"]').click();
    const notice = page.locator('.notice-item').filter({ hasText: 'عدم توظيف' }).first();
    check(await notice.isVisible(), 'Decision appears as a compact row');
    check(await notice.locator('.notice-reason').count()===0, 'Full details are not displayed in the list');
    check(await notice.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth && el.getBoundingClientRect().left >= 0), 'Compact row fits the viewport');
    if ([375, 1440].includes(width)) await page.screenshot({ path: join(output, `notifications-${width}.png`) });
    await notice.locator('[data-notice-open]').click();
    check(await page.locator('#notification-center').isHidden(), 'Opening the row closes the drawer');
    const modal=page.locator('.modal-backdrop').last();
    check(await modal.isVisible() && (await modal.textContent()).includes(reason), 'Case details show the exact reason');
    check(await modal.locator('img').count()===0 && !await page.evaluate(() => window.__noticeXss), 'Reason HTML is escaped');
    check(await modal.locator('#h-release').isVisible() && await modal.locator('#h-win').isVisible(), 'Company decisions are available directly from notification');
    check((await modal.textContent()).includes(serialNotice) && (await modal.textContent()).includes('الشاغر 2 من 3'), 'Decision targets the exact card and vacancy even while the job remains available');
    await modal.locator('[data-close]').first().click();
    check(await page.locator('#notification-count').isHidden(), 'Opening marks the decision read');
    check(await page.locator('[data-view="holds"].active').count()===1, 'The same case is available in the dedicated holds section');
    await page.locator('#holds-list [data-hold-serial="' + serialNotice + '"]').first().click();
    const sectionModal=page.locator('.modal-backdrop').last();
    check(await sectionModal.locator('#h-release').isVisible() && (await sectionModal.textContent()).includes(reason), 'Dedicated section opens the same case actions and details');
    await sectionModal.locator('[data-close]').first().click();
    await page.locator('#notification-toggle').click();
    await page.locator('[data-filter="decision"]').click();
    await page.locator('.notice-item').filter({hasText:'عدم توظيف'}).first().locator('[data-notice-open]').click();
    await page.locator('.modal-backdrop').last().locator('#h-release').click();
    check(await page.evaluate(serial => HRCStore.getAttempts(serial).some(t => t.vacancyNo===2 && t.slotStatus==='expired'), serialNotice), 'Decision from notification updates the exact vacancy');
    await page.locator('#notification-toggle').click();
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
    // Fresh fixture events for all four priority groups. No mutation/API calls
    // outside this isolated browser; retain the business workflows above.
    await page.evaluate(async () => {
      const db=HRCStore.db(), start=Date.UTC(2026,9,19,9);
      db.jobs=[];db.attempts=[];db.audit=[];db.applicants=[];
      for(let i=0;i<2;i++){
        for(const phase of ['alert','decision','booking']) {
          const code='PR-'+phase+'-'+i;db.jobs.push({id:code,code,title:'وظيفة متابعة',status:'reserved',vacancies:1});
          db.attempts.push({serial:'CARD-'+phase+'-'+i,no:1,jobId:code,jobCode:code,slotStatus:phase==='booking'?'reserved':phase==='decision'?'hiring':'critical',selectedAt:new Date(start+i*1000).toISOString(),employerDecision:phase==='decision'?'hire':null,decisionAt:new Date(start+10000+i*1000).toISOString()});
        }
        db.applicants.push({serial:'ACT-'+i,fullName:'بطاقة مفعلة',status:'active',issueDate:new Date(start+30000+i*1000).toISOString()});
      }
      await HRCNotifications.refresh();
    });
    await page.locator('#notification-toggle').click();
    await page.locator('[data-filter="all"]').click();
    check(JSON.stringify(await page.locator('.notice-group').evaluateAll(nodes=>nodes.map(n=>n.dataset.section)))===JSON.stringify(['alert','decision','booking','update']), 'Four groups ordered by urgency, not latest timestamp');
    check(await page.locator('.notice-item').count()===8, 'Grouping neither duplicates nor drops events');
    const palette=await page.locator('.notice-group').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).getPropertyValue('--notice-accent').trim()));
    check(new Set(palette).size===4, 'Each category has its own distinct color');
    check(await page.locator('#notification-toggle').getAttribute('data-priority')==='alert', 'Bell reflects highest unread priority');
    check((await page.locator('#notification-priority-summary').textContent()).includes('2 إشعارات حرجة'), 'Urgent unread count is explicit');
    for(const section of ['alert','decision','booking','update']){
      await page.locator(`[data-filter="${section}"]`).click();
      check(await page.locator(`[data-filter="${section}"] [data-filter-count]`).textContent()==='2', 'Category count '+section);
      check(await page.locator(`.notice-item[data-section="${section}"] .notice-row`).count()===2, 'Each priority uses a compact actionable row '+section);
      const times=await page.locator(`.notice-item[data-section="${section}"] time`).evaluateAll(nodes=>nodes.map(n=>Date.parse(n.dateTime)));
      check(times[0]>=times[1], 'Newest first within '+section);
      await page.locator(`[data-filter="${section}"]`).click();
      check(await page.locator('.notice-item').count()===2&&await page.locator('.notice-group').count()===1,'Priority filter works '+section);
      if([375,1440].includes(width))await page.locator('.notification-drawer').screenshot({path:join(output,`priority-${section}-${width}.png`)});
    }
    await page.locator('[data-filter="all"]').click();
    await page.locator('#notification-read-all').click();
    for(const section of ['alert','decision','booking','update']){
      check((await page.locator(`.notice-item[data-section="${section}"] .sr-only`).first().textContent()).includes('مقروء'),'Read state stays independent of category '+section);
    }
    check(await page.locator('#notification-toggle').getAttribute('data-priority')===null,'No stale urgency on the bell once all read');
    if(width===375){
      await page.setViewportSize({width:375,height:420});
      await page.locator('.notification-footer').scrollIntoViewIfNeeded();
      check(await page.locator('.notification-drawer').evaluate(e=>e.scrollHeight>e.clientHeight&&getComputedStyle(e).overflowY==='auto'),'Short landscape window can scroll entire drawer');
      check(await page.locator('.notification-footer').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1),'Footer remains reachable in short viewport');
      await page.setViewportSize({width:375,height:1000});
    }
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
