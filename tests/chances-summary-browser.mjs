#!/usr/bin/env node
/* ===========================================================================
 *  Chromium: بطاقة رصيد الفرص وملخص الوظائف المختارة في صفحة التقديم
 *  ---------------------------------------------------------------------------
 *  يعيد التحقق من التصميم الذي ظهر في معاينة الفرع القديم (الدائرة الذهبية
 *  «متبقي لك ٣ فرص» + أشرطة التقدّم + «الوظائف التي قمت باختيارها»).
 *  بيانات البطاقة والوظائف وهمية محضة، ولا يوجد أي اتصال بالإنتاج.
 *
 *  npm start ثم npm run test:chances-summary-browser
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

/* (أ) لقطة المالك: ٤ فرص، مستخدمة واحدة، متبقٍ ٣. (ب) فرصة واحدة فقط. */
const CASES = [
  {
    name: 'ثلاث فرص متبقية', serial: 'H2G86BXTDD', remaining: 3,
    chances: [
      { no: 1, slotStatus: 'reserved', jobCode: 'JOB-OLD', jobTitle: 'وظيفة سابقة' },
      { no: 2, slotStatus: 'empty' }, { no: 3, slotStatus: 'empty' }, { no: 4, slotStatus: 'empty' }
    ],
    expectTitle: '٣ فرص', expectUsed: 1, expectTotals: '٣ متبقية من ٤', usedWord: '١ مستخدمة'
  },
  {
    name: 'فرصة واحدة فقط', serial: 'K7M2XQ9T4R', remaining: 1,
    chances: [
      { no: 1, slotStatus: 'reserved', jobCode: 'JOB-OLD', jobTitle: 'وظيفة سابقة' },
      { no: 2, slotStatus: 'reserved', jobCode: 'JOB-OLD2', jobTitle: 'وظيفة ثانية' },
      { no: 3, slotStatus: 'reserved', jobCode: 'JOB-OLD3', jobTitle: 'وظيفة ثالثة' },
      { no: 4, slotStatus: 'empty' }
    ],
    expectTitle: 'فرصة واحدة فقط', expectUsed: 3, expectTotals: '١ متبقية من ٤', usedWord: '٣ مستخدمة'
  }
];

let checks = 0;
const check = (label, condition, detail) => {
  assert.ok(condition, label + (detail ? ' — ' + detail : ''));
  checks++;
};
try {
  for (const width of [320, 375, 1440]) {
    for (const spec of CASES) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      await page.route('**/*', r => {
        const u = r.request().url();
        if (u.includes('/rest/v1/rpc/self_service_card')) {
          return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
            ok: true, card: { serial: spec.serial, status: 'active', profileLocked: true,
              profile: { fullName: 'زبون اختبار' }, chancesLeft: spec.remaining, chances: spec.chances }
          }) });
        }
        if (u.includes('/rest/v1/public_jobs')) {
          return r.fulfill({ contentType: 'application/json', body: JSON.stringify([
            { code: 'JOB-NEW', title: 'وظيفة جديدة', status: 'available', requirements: [], vacancies: 1 }
          ]) });
        }
        return u.startsWith(base) && r.request().method() === 'GET' ? r.continue() : r.abort();
      });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e.message || e).split('\n')[0]));
      page.on('console', m => {
        const t = m.text().split('\n')[0];
        if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_BLOCKED/.test(t)) errors.push(t);
      });
      await page.goto(base + 'apply.html?form=' + spec.serial, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((s) => document.querySelector('#btn-card-details')?.getAttribute('aria-label')?.includes(s), spec.serial);
      await page.waitForFunction(() => window.G.currentJobs().length === 1);
      await page.evaluate(() => window.G.start());
      await page.waitForFunction(() => document.body.dataset.step === '6');

      const at = `${width}px · ${spec.name}`;
      const bar = page.locator('#chances-bar');
      const text = await bar.innerText();
      check(at + ': الدائرة والعنوان («متبقي لك ' + spec.expectTitle + '»)',
        text.includes('متبقي لك') && text.includes(spec.expectTitle) &&
        text.includes('اختر وظيفة لكل فرصة'), JSON.stringify(text));
      check(at + ': إحصاء الفرص', text.includes(spec.usedWord) && text.includes(spec.expectTotals), JSON.stringify(text));
      check(at + ': أشرطة التقدّم بعدد الفرص الفعلي',
        await page.locator('.chance-segment').count() === 4 &&
        await page.locator('.chance-segment.is-used').count() === spec.expectUsed);
      check(at + ': الدائرة الذهبية مرئية', await page.locator('.chance-count').isVisible());
      const badgeText = await page.locator('#chosen-jobs-count').evaluate(el => el.hidden ? '' : el.textContent.trim());
      check(at + ': عدّاد اللوحة يعرض عدد الوظائف المُقدَّم عليها فقط قبل الاختيار',
        badgeText === ['٠', '١', '٢', '٣'].map(d => d.replace(/\d/g, c => '٠١٢٣٤٥٦٧٨٩'[c]))[spec.expectUsed],
        JSON.stringify(badgeText) + ' / used=' + spec.expectUsed);
      check(at + ': لا صندوق فارغ داخل البطاقة',
        await page.evaluate(() => {
          const bar = document.getElementById('chances-bar');
          const segments = bar.querySelectorAll('.chance-segment').length;
          return bar.querySelector('.chance-count').textContent.trim() !== '' &&
            bar.querySelector('.chance-heading').textContent.trim() !== '' &&
            bar.querySelector('.chance-totals').textContent.trim() !== '' &&
            segments > 0;
        }));
      check(at + ': أشرطة الفرص لا تخرج عن البطاقة',
        await page.evaluate(() => {
          const bar = document.getElementById('chances-bar').getBoundingClientRect();
          return [...document.querySelectorAll('.chance-segment')].every(s => {
            const r = s.getBoundingClientRect();
            return r.left >= bar.left - 1 && r.right <= bar.right + 1;
          });
        }));

      const summary = page.locator('#chosen-jobs summary');
      check(at + ': ملخص «الوظائف التي قمت باختيارها» موجود',
        (await summary.innerText()).includes('الوظائف التي قمت باختيارها'));
      await summary.click();
      const list = page.locator('#chosen-jobs-list');
      check(at + ': الوظائف المُقدَّم عليها تظهر بوضوح',
        (await list.innerText()).includes('JOB-OLD') && (await list.innerText()).includes('تم التقديم'));

      await page.evaluate(() => window.G.pickJob('JOB-NEW'));
      check(at + ': الاختيار للمراجعة لا يستهلك فرصة',
        (await list.innerText()).includes('مختارة للمراجعة') &&
        (await bar.innerText()).includes(spec.expectTotals));
      await page.locator('.chosen-remove').click();
      check(at + ': إلغاء الاختيار يعيد القائمة دون مسح السابق',
        !(await list.innerText()).includes('JOB-NEW') && (await list.innerText()).includes('JOB-OLD'));

      const geom = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        barVisible: getComputedStyle(document.getElementById('chances-bar')).display !== 'none'
      }));
      check(at + ': بلا تمرير أفقي والبطاقة ظاهرة', !geom.overflow && geom.barVisible);
      check(at + ': صفر أخطاء JavaScript', errors.length === 0, errors.join(' | '));

      if (width === 375 && spec.remaining === 3) {
        await page.locator('#chances-bar').scrollIntoViewIfNeeded();
        await page.waitForTimeout(120);
        await page.screenshot({ path: 'tests/.tmp/chances-summary-375.png' });
      }
      await ctx.close();
      console.log(`PASS ${at} — ${checks} فحص تراكمي`);
    }
  }
  /* (ج) مسار المراجعة البصرية /demo-card: بطاقة وهمية ووظائف وهمية، بلا أي
     اتصال بقاعدة. يتحقّق أنّ المعاينة التي يفتحها المالك تعمل فعلاً. */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e).split('\n')[0]));
    await page.goto(base + 'demo-card', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.G && document.querySelector('#btn-start'), { timeout: 15000 });
    await page.evaluate(() => window.G.start());
    await page.waitForFunction(() => document.body.dataset.step === '6');
    check('/demo-card: بطاقة وهمية بأربع فرص وثلاثة متبقية',
      (await page.locator('#chances-bar').innerText()).includes('٣ متبقية من ٤') &&
      await page.locator('.chance-segment').count() === 4);
    check('/demo-card: الوظائف الوهمية تظهر', await page.locator('.job-card').count() === 4);
    await page.evaluate(() => window.G.pickJob('HRC-9001'));
    check('/demo-card: الاختيار يُعلَّم بلا استهلاك',
      await page.locator('.chance-segment.is-picked').count() === 1 &&
      (await page.locator('#chances-bar').innerText()).includes('٣ متبقية من ٤'));
    check('/demo-card: صفر أخطاء', errors.length === 0, errors.join(' | '));
    await ctx.close();
    console.log('PASS /demo-card — معاينة بصرية ببيانات وهمية');
  }
} finally {
  await browser.close();
}
console.log(`\nبطاقة الفرص والوظائف المختارة: ${checks} فحصاً ناجحاً.`);
