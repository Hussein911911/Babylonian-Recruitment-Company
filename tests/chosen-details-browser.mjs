#!/usr/bin/env node
/* ===========================================================================
 *  Chromium: نافذة «تفاصيل الوظيفة وصاحب العمل»
 *  ---------------------------------------------------------------------------
 *  الضغط على أي صف في لوحة «الوظائف التي قمت باختيارها» يفتح نافذة فيها:
 *    • تفاصيل الوظيفة (المحافظة · الدوام · الأجر · الوصف · المتطلبات)
 *    • تفاصيل صاحب العمل — للفرصة المُقدَّم عليها فقط، من دالة القاعدة
 *      customer_application_details (لا من قائمة الوظائف العامة المحجوبة).
 *    • «مختارة للمراجعة»: لا صاحب عمل بعد ⇒ رسالة صريحة، وصفر اختلاق بيانات.
 *  كل النداءات وهمية ومحجوبة داخل المتصفح؛ لا اتصال بأي قاعدة حقيقية.
 *
 *  npm start ثم npm run test:chosen-details-browser
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
const serial = 'K7M2XQ9T4R';

let checks = 0;
const check = (label, condition, detail) => {
  assert.ok(condition, label + (detail ? ' — ' + detail : ''));
  checks++;
};

/* بطاقة فيها فرصة مقدَّم عليها (١) وفرصة متاحة (٢) ووظيفة يمكن اختيارها */
const CARD = {
  ok: true, card: {
    serial, status: 'active', profileLocked: true, chancesLeft: 1,
    profile: { fullName: 'زبون الاختبار', phone: '07700000000' },
    chances: [
      { no: 1, slotStatus: 'reserved', jobCode: 'JOB-OLD', jobTitle: 'سائق توصيل' },
      { no: 2, slotStatus: 'empty' }
    ]
  }
};
const JOBS = [
  { code: 'JOB-OLD', title: 'سائق توصيل', status: 'available', governorate: 'بابل', shift: 'صباحي',
    salary_min: 600000, salary_max: 750000, description: 'توصيل الطلبات داخل الحلة', requirements: ['رخصة قيادة سارية'], vacancies: 1, gender: 'ذكر' },
  { code: 'JOB-NEW', title: 'محاسب', status: 'available', governorate: 'بغداد', shift: 'صباحي',
    salary_min: 900000, salary_max: 1100000, requirements: [], vacancies: 1 }
];
const rpcAttempt = (n) => ({
  ok: true,
  app: { serial, fullName: 'زبون الاختبار' },
  attempt: {
    no: n, slotStatus: 'reserved', jobCode: 'JOB-OLD', jobTitle: 'سائق توصيل',
    location: 'بابل', shift: 'مسائي', salaryMin: 640000, salaryMax: 780000,
    employerName: 'شركة الرافدين للنقل', employerPhone: '07801112233',
    employerAddress: 'بابل — الحلة — شارع ٤٠', interviewLocation: 'مقر الشركة — الطابق الأول'
  }
});

async function open({ width = 390, employer = 'ok', reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion });
  const page = await ctx.newPage();
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(String(e.message || e).split('\n')[0]));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.includes('/rest/v1/rpc/self_service_card')) {
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(CARD) });
    }
    if (u.includes('/rest/v1/rpc/customer_application_details')) {
      calls.push(r.request().postDataJSON());
      if (employer === 'fail') {
        return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'offline' }) });
      }
      if (employer === 'wrong-card') {
        const d = rpcAttempt(1); d.app.serial = 'OTHER-CARD';
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify(d) });
      }
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(rpcAttempt(r.request().postDataJSON().p_attempt_no)) });
    }
    if (u.includes('/rest/v1/public_jobs')) {
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(JOBS) });
    }
    return u.startsWith(base) && r.request().method() === 'GET' ? r.continue() : r.abort();
  });
  await page.goto(base + 'apply.html?form=' + serial, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(s => document.querySelector('#btn-card-details')?.getAttribute('aria-label')?.includes(s), serial);
  await page.waitForFunction(() => window.G.currentJobs().length === 2);
  await page.evaluate(() => window.G.start());
  await page.waitForFunction(() => document.body.dataset.step === '6');
  await page.locator('#chosen-jobs summary').click();
  return { ctx, page, errors, calls };
}

try {
  /* ─────────── (أ) صف «تم التقديم»: وظيفة + صاحب عمل ─────────── */
  for (const width of [320, 390, 768]) {
    const { ctx, page, errors, calls } = await open({ width });
    const at = width + 'px';

    check(at + ': الصف يحمل زر «التفاصيل وصاحب العمل»',
      (await page.locator('.chosen-item[data-chosen-kind="applied"] .chosen-cta').innerText()).includes('التفاصيل وصاحب العمل'));
    await page.locator('.chosen-item[data-chosen-kind="applied"]').click();
    await page.waitForFunction(() => !document.getElementById('chosen-modal').hidden);
    await page.waitForFunction(() => /الرافدين/.test(document.querySelector('#cdt-emp-box')?.textContent || ''));

    const head = await page.locator('#chosen-modal .cdt-head').innerText();
    check(at + ': الرأس يعرض عنوان الوظيفة وكودها',
      head.includes('سائق توصيل') && head.includes('JOB-OLD'), head.replace(/\n/g, ' | '));
    check(at + ': النافذة تغبّش ما وراءها (chosen-modal-open)',
      await page.evaluate(() => document.body.classList.contains('chosen-modal-open')));
    check(at + ': مسار الطلب يعرض المراحل الثلاث',
      (/اختيار الوظيفة/.test(await page.locator('#cdt-steps').innerText()) &&
       /تم التقديم/.test(await page.locator('#cdt-steps').innerText())));

    const body = await page.locator('#chosen-modal-body').innerText();
    check(at + ': تفاصيل الوظيفة ظاهرة (المحافظة · الدوام · الأجر)',
      body.includes('بابل') && body.includes('مسائي') && /640,000/.test(body), body.slice(0, 120));
    check(at + ': الأجر يأتي من التفاصيل المسجَّلة لا من بيانات الوظيفة العامة',
      body.includes('780,000') && !body.includes('750,000'));
    check(at + ': وصف الوظيفة والمتطلبات معروضان',
      body.includes('توصيل الطلبات') && body.includes('رخصة قيادة'));
    const emp = await page.locator('#cdt-emp-box').innerText();
    check(at + ': صاحب العمل: الاسم والهاتف والعنوان ومكان المقابلة',
      emp.includes('شركة الرافدين للنقل') && emp.includes('07801112233') &&
      emp.includes('شارع ٤٠') && emp.includes('الطابق الأول'), emp.replace(/\n/g, ' | ').slice(0, 160));
    check(at + ': الهاتف زر اتصال فعلي (tel:)',
      /^tel:/i.test(await page.locator('#cdt-emp-box .cdt-tel').getAttribute('href')));
    check(at + ': نداء واحد فقط لتفاصيل الفرصة بالبطاقة والفرصة الصحيحة',
      calls.length === 1 && calls[0].p_serial === serial && Number(calls[0].p_attempt_no) === 1,
      JSON.stringify(calls));
    check(at + ': أزرار «طباعة استمارة الفرصة» و«إغلاق»',
      (await page.locator('#chosen-modal-foot').innerText()).includes('طباعة استمارة الفرصة') &&
      (await page.locator('#chosen-modal-foot').innerText()).includes('إغلاق'));
    /* حرس ضد عطل 2026-11-08: قسم بصندوق تمرير داخل شبكة كان ينكمش إلى
       حشوته فيُقتطع محتواه (29px لمحتوى 304px) — نقيس كل قسم مقابل محتواه. */
    const sections = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#chosen-modal-body > *, #cdt-steps, .cdt-head').forEach(el => {
        const cs = getComputedStyle(el);
        const hides = /hidden|clip/.test(cs.overflowY) || /hidden|clip/.test(cs.overflow);
        out.push({
          tag: (el.className || el.tagName).toString().split(' ')[0],
          clientH: Math.round(el.clientHeight), scrollH: Math.round(el.scrollHeight),
          hides, h: Math.round(el.getBoundingClientRect().height)
        });
      });
      return out;
    });
    const crushed = sections.filter(s => s.hides && s.scrollH - s.clientH > 2);
    check(at + ': لا قسم مقتصّ داخل النافذة (لا محتوى مخفيّ بقصّ)',
      crushed.length === 0, JSON.stringify(crushed));
    check(at + ': كارت صاحب العمل يحمل محتواه كاملاً (ارتفاع ≥ ٢٥٠px)',
      (sections.find(s => s.tag === 'cdt-emp') || {}).h >= 250,
      JSON.stringify(sections.find(s => s.tag === 'cdt-emp')));
    check(at + ': رأس النافذة لا ينضغط (≥ ٦٠px مع الشعار والعنوان)',
      (await page.evaluate(() => Math.round(document.querySelector('.cdt-head').getBoundingClientRect().height))) >= 60);
    check(at + ': بلا تمرير أفقي داخل النافذة',
      await page.evaluate(() => {
        const box = document.querySelector('.chosen-modal-box');
        const body = document.querySelector('#chosen-modal-body');
        return document.documentElement.scrollWidth <= window.innerWidth + 1 &&
          body.scrollWidth <= body.clientWidth + 1 && box.getBoundingClientRect().right <= window.innerWidth + 1;
      }));

    /* الإغلاق بـ ESC ثم إعادة الفتح بلا نداء ثانٍ (من الكاش) */
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('chosen-modal').hidden);
    check(at + ': ESC يُغلق النافذة ويرفع التغبيش',
      await page.evaluate(() => !document.body.classList.contains('chosen-modal-open')));
    await page.locator('.chosen-item[data-chosen-kind="applied"]').click();
    await page.waitForFunction(() => !document.getElementById('chosen-modal').hidden);
    await page.waitForTimeout(120);
    check(at + ': إعادة الفتح تستخدم التفاصيل المحفوظة (بلا نداء مكرر)', calls.length === 1, String(calls.length));
    /* فتحة أخرى بلا انتظار: النافذة تُرسم مباشرة من الكاش */
    check(at + ': بيانات صاحب العمل تظهر فوراً من الكاش',
      /الرافدين/.test(await page.locator('#cdt-emp-box').innerText()));

    check(at + ': صفر أخطاء JavaScript', errors.length === 0, errors.join(' | '));
    await ctx.close();
    console.log('PASS مُقدَّم عليها / ' + width + 'px');
  }

  /* ─────────── (ب) صف «مختارة للمراجعة»: لا اختلاق لصاحب العمل ─────────── */
  {
    const { ctx, page, errors, calls } = await open({ width: 390 });
    await page.evaluate(() => window.G.pickJob('JOB-NEW'));
    await page.locator('.chosen-item[data-chosen-kind="picked"]').first().click();
    await page.waitForFunction(() => !document.getElementById('chosen-modal').hidden);
    const emp = await page.locator('#cdt-emp-box').innerText();
    check('مختارة: النافذة تشرح أن بيانات صاحب العمل تظهر بعد التقديم',
      emp.includes('بيانات صاحب العمل') && /تظهر بعد التقديم/.test(emp), emp.replace(/\n/g, ' | ').slice(0, 120));
    check('مختارة: لا يُعرض أي اسم/هاتف صاحب عمل مخترع',
      !/07\d{9}/.test(emp) && !emp.includes('الرافدين'));
    check('مختارة: زر «متابعة للطلب» موجود', (await page.locator('#chosen-modal-foot').innerText()).includes('متابعة للطلب'));
    check('مختارة: لا نداء لتفاصيل الفرصة قبل وجود تقديم', calls.length === 0, JSON.stringify(calls));
    const body = await page.locator('#chosen-modal-body').innerText();
    check('مختارة: تفاصيل الوظيفة ظاهرة رغم غياب صاحب العمل',
      body.includes('محاسب') && body.includes('بغداد') && /900,000/.test(body), body.slice(0, 120));
    check('مختارة: شريط المراحل يبيّن «بانتظار التقديم»',
      /بانتظار التقديم/.test(await page.locator('#cdt-steps').innerText()));
    check('مختارة: بطاقة «تظهر بعد التقديم» غير مقتصّة',
      await page.evaluate(() => {
        const el = document.getElementById('cdt-emp-box');
        return el.getBoundingClientRect().height >= 150 && el.scrollHeight - el.clientHeight <= 2;
      }));

    /* «متابعة للطلب» يغلق النافذة ويذهب لخطوة البيانات */
    await page.locator('#chosen-modal-foot .btn-primary').click();
    await page.waitForFunction(() => document.getElementById('chosen-modal').hidden);
    check('مختارة: «متابعة للطلب» يُغلق النافذة وينتقل للتقديم',
      await page.evaluate(() => document.body.dataset.step === '7' || document.body.classList.contains('job-modal-open') === false));
    check('مختارة: صفر أخطاء JavaScript', errors.length === 0, errors.join(' | '));
    await ctx.close();
    console.log('PASS مختارة للمراجعة / 390px');
  }

  /* ─────────── (ج) زر «إلغاء الاختيار» لا يفتح النافذة ─────────── */
  {
    const { ctx, page, errors } = await open({ width: 390 });
    await page.evaluate(() => window.G.pickJob('JOB-NEW'));
    await page.locator('.chosen-item[data-chosen-kind="picked"] .chosen-remove').click();
    await page.waitForTimeout(150);
    check('زر «إلغاء الاختيار» يُلغي الاختيار ولا يفتح نافذة التفاصيل',
      await page.evaluate(() => document.getElementById('chosen-modal').hidden) &&
      await page.locator('.chosen-item[data-chosen-kind="picked"]').count() === 0);
    check('إلغاء: صفر أخطاء JavaScript', errors.length === 0, errors.join(' | '));
    await ctx.close();
    console.log('PASS إلغاء الاختيار لا يفتح النافذة');
  }

  /* ─────────── (د) تعذّر الاتصال: رسالة + إعادة محاولة، بلا بيانات مخترعة ─────────── */
  {
    const { ctx, page, errors } = await open({ width: 390, employer: 'fail' });
    await page.locator('.chosen-item[data-chosen-kind="applied"]').click();
    await page.waitForFunction(() => /تعذّر تحميل/.test(document.querySelector('#cdt-emp-box')?.textContent || ''));
    const emp = await page.locator('#cdt-emp-box').innerText();
    check('تعذّر الاتصال: رسالة واضحة بلا بيانات وهمية', /تعذّر تحميل/.test(emp) && !/07\d{9}/.test(emp));
    check('تعذّر الاتصال: زر «إعادة المحاولة» ظاهر',
      await page.locator('#cdt-emp-box .cdt-retry').isVisible());
    check('تعذّر الاتصال: صفر أخطاء JavaScript', errors.length === 0, errors.join(' | '));
    await ctx.close();
    console.log('PASS تعذّر تحميل بيانات صاحب العمل');
  }

  /* ─────────── (هـ) حماية البيانات: ردّ بطاقة أخرى لا يُعرض ─────────── */
  {
    const { ctx, page } = await open({ width: 390, employer: 'wrong-card' });
    await page.locator('.chosen-item[data-chosen-kind="applied"]').click();
    await page.waitForFunction(() => !/جارٍ التحميل/.test(document.querySelector('#cdt-emp-box')?.textContent || ''));
    const emp = await page.locator('#cdt-emp-box').innerText();
    check('حماية: ردّ يخصّ بطاقة أخرى يُرفض ولا يُعرض',
      !emp.includes('الرافدين') && !emp.includes('07801112233'), emp.replace(/\n/g, ' | ').slice(0, 120));
    await ctx.close();
    console.log('PASS رفض ردّ بطاقة أخرى');
  }

  /* ─────────── (و) لوحة المفاتيح + تقليل الحركة ─────────── */
  {
    const { ctx, page, errors } = await open({ width: 390, reducedMotion: 'reduce' });
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.chosen-modal-box')).animationName);
    check('تقليل الحركة: لا حركة على صندوق النافذة', anim === 'none', anim);
    await page.locator('.chosen-item[data-chosen-kind="applied"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('chosen-modal').hidden);
    check('لوحة المفاتيح: Enter على الصف يفتح التفاصيل',
      await page.evaluate(() => !document.getElementById('chosen-modal').hidden));
    const focusClose = await page.evaluate(() => document.activeElement?.id);
    check('لوحة المفاتيح: التركيز ينتقل إلى زر الإغلاق', focusClose === 'cdt-close', String(focusClose));
    await page.keyboard.press('Escape');
    check('لوحة المفاتيح: التركيز يعود إلى الصف بعد الإغلاق',
      await page.evaluate(() => document.activeElement?.classList?.contains('chosen-item')));
    check('لوحة المفاتيح: صفر أخطاء JavaScript', errors.length === 0, errors.join(' | '));
    await ctx.close();
    console.log('PASS لوحة المفاتيح وتقليل الحركة');
  }
} finally {
  await browser.close();
}
console.log('\nنافذة تفاصيل الوظيفة وصاحب العمل: ' + checks + ' فحصاً ناجحاً.');
