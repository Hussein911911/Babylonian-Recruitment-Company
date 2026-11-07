#!/usr/bin/env node
/* ===========================================================================
 *  Chromium: «العملية» و«التفاصيل» عربية على الجوال وسطح المكتب
 *  يحقن سجلاً يحاكي صفوف القاعدة (applicants / jobs / job_attempts) في
 *  تخزين محلي معزول، ثم يفتح لوحة السجل الحقيقية بلا اتصال بالإنتاج.
 *  npm start ثم npm run test:audit-arabic-browser
 * =========================================================================== */
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';

const libs = new URL('./.tmp/horizontal/libraries/', import.meta.url);
const packed = new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url);
if (existsSync(packed) && !existsSync(new URL('lib/', libs))) {
  mkdirSync(libs, { recursive: true });
  const tar = new URL('libs.tar', libs);
  writeFileSync(tar, brotliDecompressSync(readFileSync(packed)));
  execFileSync('tar', ['xf', tar.pathname, '-C', libs.pathname]);
}
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(s => !['--disable-web-security', '--single-process', '--in-process-gpu',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),
  env: { ...process.env, LD_LIBRARY_PATH: [new URL('lib/', libs).pathname, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  headless: true
});
const base = 'http://127.0.0.1:4173/';
const FIXTURE = [
  { id: 1, ts: '2026-11-07T08:00:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'تعديل applicants', entity: 'applicants', entityId: '4SC', details: 'تغيير في applicants' },
  { id: 2, ts: '2026-11-07T08:01:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'إضافة jobs', entity: 'jobs', entityId: 'D2S', details: 'تغيير في jobs' },
  { id: 3, ts: '2026-11-07T08:02:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'حذف job_attempts', entity: 'job_attempts', entityId: 'XS8', details: 'تغيير في job_attempts' },
  { id: 4, ts: '2026-11-07T08:03:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'تعديل مستخدم', entity: 'user', entityId: '2ED', details: '{"name":"أحمد","role":"admin","password":"s3cr3t"}' },
  { id: 5, ts: '2026-11-07T08:04:00.000Z', user: 'manager', name: 'مدير الاختبار', role: 'admin', ip: '',
    action: 'طباعة بطاقة', entity: 'applicant', entityId: '87Y', details: 'طباعة بطاقة التوظيف' }
];
let checks = 0;
const check = (label, condition, detail) => {
  assert.ok(condition, label + (detail ? ' — ' + detail : ''));
  checks++;
};
try {
  for (const width of [375, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(base) && u.includes('/assets/js/supabase-config.js')) {
        return r.fulfill({ contentType: 'application/javascript',
          body: 'window.HRCSupabaseConfig={enabled:false,enforceAuth:false};' });
      }
      return u.startsWith(base) && r.request().method() === 'GET' ? r.continue() : r.abort();
    });
    await page.addInitScript((rows) => {
      Object.defineProperty(window, 'HRCSupabaseConfig', {
        configurable: true, get: () => ({ enabled: false, enforceAuth: false }), set() {}
      });
      sessionStorage.setItem('hrc_session_v2', JSON.stringify({
        username: 'manager', role: 'admin', name: 'مدير الاختبار', cloud: true
      }));
      localStorage.setItem('hrc_db_v2', JSON.stringify({
        meta: { createdAt: new Date().toISOString(), version: 2 },
        counters: { formSerial: 120, jobCode: 1049 }, usedSerials: [],
        jobs: [], applicants: [], attempts: [],
        settings: { attemptLimit: 2, validityDays: 30, holdHours: 24, formFee: 10000 },
        audit: rows
      }));
    }, FIXTURE);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e).split('\n')[0]));
    page.on('console', m => {
      const t = m.text().split('\n')[0];
      if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_BLOCKED/.test(t)) errors.push(t);
    });
    await page.goto(base + 'dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(450);
    /* الشريط الجانبي خارج الشاشة على الجوال (خلف زر الهامبرغر) — النقر
       البرمجي يصل إليه دون الاعتماد على موضعه المرئي. */
    await page.evaluate(() => {
      const link = document.querySelector('#side-nav [data-view="audit"]');
      if (!link) throw new Error('رابط السجل غير موجود');
      link.click();
    });
    await page.waitForFunction(() => document.querySelectorAll('#audit-table-body tr').length === 5);

    const state = await page.evaluate(() => {
      const cells = (i) => [...document.querySelectorAll('#audit-table-body tr')]
        .filter(r => !r.querySelector('.table-empty')).map(r => r.children[i].textContent.trim());
      const opts = (id) => [...document.getElementById(id).options].map(o => o.textContent.trim());
      return {
        action: cells(4), details: cells(5), entity: cells(3),
        actionOptions: opts('log-action'), entityOptions: opts('log-entity'),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        codes: cells(3).every(t => t.length > 0)
      };
    });
    const latin = (arr) => arr.flatMap(s => String(s).match(/[A-Za-z][A-Za-z0-9_]*/g) || []);
    const at = width + 'px';
    check(at + ': صفر أخطاء JavaScript', errors.length === 0, errors.join(' | '));
    check(at + ': لا كلمة إنكليزية في «العملية»', latin(state.action).length === 0, JSON.stringify(state.action));
    check(at + ': لا كلمة إنكليزية في «التفاصيل»', latin(state.details).length === 0, JSON.stringify(state.details));
    check(at + ': الفلاتر عربية', latin(state.actionOptions).length === 0 && latin(state.entityOptions).length === 0,
      JSON.stringify([state.actionOptions, state.entityOptions]));
    check(at + ': الجمل المعرّبة الصحيحة',
      state.action.includes('تعديل بطاقة') && state.action.includes('إضافة وظيفة') &&
      state.details.includes('تعديل بيانات البطاقة') && state.details.includes('تعديل بيانات الفرصة'),
      JSON.stringify([state.action, state.details]));
    check(at + ': الأكواد المطبوعة باقية', state.entity.some(t => t.includes('4SC')) && state.codes);
    check(at + ': بلا تمرير أفقي للصفحة', state.overflow === false);

    if (width === 375) {
      /* نُمرّر الجدول إلى آخر الأعمدة (RTL) لالتقاط «العملية/التفاصيل» كما في لقطة المالك */
      await page.locator('#audit-table-body').scrollIntoViewIfNeeded();
      const scroll = await page.evaluate(() => {
        const el = document.querySelector('.audit-scroll');
        el.scrollLeft = -el.scrollWidth;
        if (!el.scrollLeft) el.scrollLeft = el.scrollWidth;
        return { scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
      });
      await page.waitForTimeout(150);
      await page.screenshot({ path: 'tests/.tmp/audit-arabic-375.png' });
      console.log('  (لقطة مراجعة: tests/.tmp/audit-arabic-375.png)', JSON.stringify(scroll));
    }
    if (width === 1440) {
      await page.locator('#audit-table-body').scrollIntoViewIfNeeded();
      await page.waitForTimeout(120);
      await page.screenshot({ path: 'tests/.tmp/audit-arabic-1440.png' });
    }
    await ctx.close();
    console.log(`PASS ${at} — ${checks} فحص تراكمي`);
  }
} finally {
  await browser.close();
}
console.log(`\nسجل التدقيق بالعربية في Chromium: ${checks} فحصاً ناجحاً.`);
