/* جولة المتصفح الحقيقي: حذف الوظيفة بيد الموظف — مع نقرة زر فعلية.
   يثبت أن الواجهة والقاعدة متطابقتان: الموظف يحذف، والزائر لا. */
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';

const libs = new URL('./.tmp/horizontal/libraries/', import.meta.url);
const packed = new URL('../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url);
if (existsSync(packed) && !existsSync(new URL('lib/', libs))) {
  mkdirSync(libs, { recursive: true });
  const tar = new URL('libs.tar', libs);
  writeFileSync(tar, brotliDecompressSync(readFileSync(packed)));
  execFileSync('tar', ['xf', tar.pathname, '-C', libs.pathname]);
}

const BASE = process.env.HRC_BASE || 'http://127.0.0.1:4173';
const b = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter((s) => !['--disable-web-security', '--single-process', '--in-process-gpu',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'].includes(s)).concat('--disable-gpu'),
  env: { ...process.env, LD_LIBRARY_PATH: [new URL('lib/', libs).pathname, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  headless: true
});
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (d ? ' :: ' + d : '')); } };

async function rolePage(role) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/demo', { waitUntil: 'domcontentloaded' });
  if (role) {
    await p.evaluate((r) => {
      /* شكل جلسة الإنتاج الحقيقي: cloud:true مطلوب وإلا مسحها currentUser()
         بسبب enforceAuth. (نفس ما يكتبه applyStaffSession بعد تسجيل الدخول.) */
      const u = r === 'admin'
        ? { username: 'admin', name: 'مدير', role: 'admin', cloud: true }
        : { username: 'staff', name: 'موظف', role: 'staff', cloud: true };
      sessionStorage.setItem('hrc_session_v2', JSON.stringify(u));
    }, role);
    await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1200);
  }
  return { ctx, p };
}

console.log('\n=== المتصفح: حذف الوظيفة للموظف والمدير ===');

/* 1) الموظف: الواجهة تعرض زر الحذف */
{
  const { ctx, p } = await rolePage('staff');
  const api = await p.evaluate(() => {
    const S = window.HRCStore;
    if (!S) return { err: 'no store' };
    const jobs = (S.db() && S.db().jobs) || [];
    const job = jobs[jobs.length - 1];
    if (!job) return { err: 'no job' };
    const before = jobs.length;
    const ok = S.deleteJob(job.code);
    const after = ((S.db() && S.db().jobs) || []).length;
    return { ok, before, after, code: job.code };
  });
  check('الموظف يحذف وظيفة فعلياً في المتصفح', api.ok === true && api.after === api.before - 1, JSON.stringify(api));
  await ctx.close();
}

/* 2) الزائر المجهول: مرفوض */
{
  const { ctx, p } = await rolePage(null);
  const api = await p.evaluate(() => {
    const S = window.HRCStore;
    if (!S) return { err: 'no store' };
    const jobs = (S.db() && S.db().jobs) || [];
    const job = jobs[jobs.length - 1];
    if (!job) return { err: 'no job' };
    const before = jobs.length;
    const ok = S.deleteJob(job.code);
    const after = ((S.db() && S.db().jobs) || []).length;
    return { ok, before, after };
  });
  check('الزائر المجهول لا يحذف', api.ok === false && api.after === api.before, JSON.stringify(api));
  await ctx.close();
}

/* 3) المدير يحذف */
{
  const { ctx, p } = await rolePage('admin');
  const api = await p.evaluate(() => {
    const S = window.HRCStore;
    const jobs = (S.db() && S.db().jobs) || [];
    const job = jobs[jobs.length - 1];
    if (!job) return { err: 'no job' };
    const before = jobs.length;
    const ok = S.deleteJob(job.code);
    return { ok, before, after: ((S.db() && S.db().jobs) || []).length };
  });
  check('المدير يحذف وظيفة فعلياً', api.ok === true && api.after === api.before - 1, JSON.stringify(api));
  await ctx.close();
}

/* 4) نقرة زر حقيقية على شاشة الوظائف — لا استدعاء دالة فقط */
{
  const { ctx, p } = await rolePage('staff');
  /* ننتقل إلى شاشة الوظائف داخل اللوحة */
  /* نفتح شاشة الوظائف عبر زرها في القائمة الجانبية (نفس مسار الموظف) */
  const nav = await p.evaluate(() => {
    const link = document.querySelector("#side-nav button[data-view=\"jobs\"]") || document.querySelector("[data-view=\"jobs\"]");
    if (!link) return false;
    link.click();
    return true;
  });
  await p.waitForTimeout(1500);
  const btnCount = await p.locator('[data-job-del]').count();
  check('زر حذف الوظيفة ظاهر للموظف في الشاشة', nav && btnCount > 0, 'nav=' + nav + ' buttons=' + btnCount);
  if (btnCount > 0) {
    const before = await p.evaluate(() => (window.HRCStore.db().jobs || []).length);
    const code = await p.locator('[data-job-del]').first().getAttribute('data-job-del');
    await p.locator('[data-job-del]').first().click();
    await p.waitForTimeout(400);
    /* نافذة التأكيد */
    const confirmed = await p.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((el) => /حذف نهائي/.test(el.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => (window.HRCStore.db().jobs || []).length);
    const gone = await p.evaluate((c) => !(window.HRCStore.db().jobs || []).some((j) => j.code === c), code);
    check('الموظف يحذف وظيفة بنقرة زر بعد التأكيد', confirmed && after === before - 1 && gone,
      JSON.stringify({ confirmed, before, after, gone, code }));
  }
  await ctx.close();
}

await b.close();
console.log(`\n  النتيجة: ✅ ${pass} ناجح | ❌ ${fail} فاشل\n`);
process.exit(fail ? 1 : 0);
