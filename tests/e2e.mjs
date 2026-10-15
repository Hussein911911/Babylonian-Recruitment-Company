#!/usr/bin/env node
/* ===========================================================================
 *  HRC — اختبار المسار الكامل لنظام بطاقة التوظيف (End-to-End)
 *  ---------------------------------------------------------------------------
 *  يحاكي رحلة البطاقة الحقيقية كاملة ببيانات واحدة تنتقل بين الصفحات:
 *
 *    1) زائر يتصفّح الوظائف — بلا طلب إلكتروني وبلا تحقق (سياسة البطاقة)
 *    2) المكتب يبيع بطاقة كاش عند نقطة البيع ويطبعها (86×54مم)
 *    3) الزبون يتابع بطاقته بالباركود من «بطاقتي» ويستخدم الفرصة الأولى
 *       برمزها السري ⇒ الوظيفة محجوزة 24 ساعة
 *    4) انتهاء المهلة دون قرار ⇒ حالة «حرجة» (لا إفراج تلقائي)
 *    5) قرار الموظف: تم التوظيف ⇒ الوظيفة مغلقة والبطاقة تبقى سارية
 *    6) الفرصة الثانية ثم قرار الإرجاع ⇒ الفرصة مستهلكة والبطاقة مستنفدة
 *    7) صفحة التحقق للموظف (باركود QR) + بوابة تحجب الزائر + بصمة مزيفة
 *    8) إعادة طباعة البطاقة من الموقع العام بإثبات الحيازة (رمز الفرصة)
 *    9) الملف المستقل: التحقق بالمسار الهاشي بجلسة موظف
 *
 *  ملاحظة: كل نافذة متصفح افتراضي (jsdom) لها تخزينها الخاص، فننقل قاعدة
 *  البيانات بين الصفحات عبر export/import — وهذا يحاكي «نفس المتصفح» تماماً.
 *
 *  التشغيل:  node tests/e2e.mjs
 * =========================================================================== */
import { JSDOM, VirtualConsole } from 'jsdom';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEMO_SEED } from './fixtures/demo-seed.mjs';

const ROOT = resolveRoot();
function resolveRoot() { return join(dirname(fileURLToPath(import.meta.url)), '..'); }

let pass = 0, fail = 0;
const problems = [];
const step = (n, t) => console.log('\n▌ الخطوة ' + n + ' — ' + t);
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, cond, detail) => (cond ? ok(t) : bad(t, detail));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* jsdom لا يوفّر sessionStorage لأصول file:// — نزرع جلسة الموظف عبر واجهة تخزين بديلة */
function staffStorage(role) {
  role = role || 'staff';
  const SESSION = role === 'admin'
    ? { username: 'admin', name: 'مدير فحص', role: 'admin', title: 'مدير الشركة', at: new Date().toISOString() }
    : { username: 'staff', name: 'موظف فحص', role: 'staff', title: 'موظف توظيف', at: new Date().toISOString() };
  const m = new Map([['hrc_session_v2', JSON.stringify({ ...SESSION, cloud: true })]]);
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: (k) => m.delete(String(k)),
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
}

async function open(file, query, opts = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    const m = String(e && (e.detail || e.message || e));
    if (/Not implemented|Could not load/.test(m)) return;
    errors.push(m.split('\n')[0]);
  });
  vc.on('log', () => { }); vc.on('info', () => { }); vc.on('debug', () => { }); vc.on('warn', () => { }); vc.on('error', () => { });
  const base = pathToFileURL(join(ROOT, file)).href;
  const dom = await JSDOM.fromFile(join(ROOT, file), {
    url: query ? base + query : base,
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      /* بذرة العرض للاختبارات فقط — الإنتاج ببذرة فارغة
         (انظر tests/fixtures/demo-seed.mjs). قبل تنفيذ config.js. */
      w.__HRC_TEST_SEED__ = JSON.parse(JSON.stringify(DEMO_SEED));
      Object.defineProperty(w, 'print', { configurable: true, writable: true, value: () => { w.__printed = (w.__printed || 0) + 1; } });
      w.__printed = 0;
      if (opts.session) Object.defineProperty(w, 'sessionStorage', { configurable: true, value: staffStorage(opts.session) });
      /* قاعدة جاهزة قبل إقلاع السكربتات: يلزم لمسارات ‎#card= (توجيه مسح
         الباركود يعمل عند DOMContentLoaded — أي قبل أي importJson لاحق). */
      if (opts.db) {
        const store = new Map([['hrc_db_v2', typeof opts.db === 'string' ? opts.db : JSON.stringify(opts.db)]]);
        Object.defineProperty(w, 'localStorage', { configurable: true, value: {
          getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
          setItem: (k, v) => store.set(String(k), String(v)),
          removeItem: (k) => store.delete(String(k)),
          clear: () => store.clear(),
          key: (i) => Array.from(store.keys())[i] || null,
          get length() { return store.size; }
        } });
      }
    }
  });
  await new Promise((r) => { dom.window.addEventListener('load', r); setTimeout(r, 6000); });
  await wait(400);
  return { dom, w: dom.window, doc: dom.window.document, errors };
}

const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const setVal = (w, el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
};
/* آخر نافذة منبثقة مفتوحة بالصفحة */
const lastModal = (doc) => [...doc.querySelectorAll('.modal-backdrop .modal')].pop();

console.log('\n' + '═'.repeat(72));
console.log('  HRC — اختبار المسار الكامل لنظام بطاقة التوظيف (من البيع إلى الإرجاع)');
console.log('═'.repeat(72));

/* ═══ 1) الموقع العام: الزائر يتصفّح — بلا طلب إلكتروني وبلا تحقق ═════════ */
step(1, 'الموقع العام — زائر يتصفّح الوظائف ويعرف مسار البطاقة (لا طلب إلكتروني)');

const site = await open('index.html');
const W = site.w;
const S = W.HRCStore;

const cards = site.doc.querySelectorAll('#jobs-grid .job-card').length;
check('الوظائف المتاحة معروضة للزائر (' + cards + ' بطاقة)', cards >= 8);

/* سياسة البطاقة: لا طلب إلكتروني ولا واجهة تحقق للزائر */
const badRequest = site.doc.getElementById('btn-request-form') || site.doc.getElementById('btn-request-form-2') ||
  site.doc.getElementById('req-form') || site.doc.querySelector('[data-action="request-form"]');
check('لا يوجد أي زر «اطلب استمارة» موجّه للزائر', !badRequest, badRequest && badRequest.outerHTML.slice(0, 60));
const badVerify = site.doc.getElementById('verify-quick') || site.doc.getElementById('verify-serial') ||
  site.doc.querySelector('[data-action="verify"]');
check('لا توجد واجهة تحقق للزائر بالموقع العام', !badVerify, badVerify && badVerify.outerHTML.slice(0, 60));
check('لا نص «ترشّح» في العرض العام', !/ترشّح/.test(site.doc.getElementById('jobs-grid').textContent));

/* مسار البطاقة: زر «قدّم ببطاقتك» على كل وظيفة متاحة + زر «بطاقتي» بالهيدر */
const bookBtns = [...site.doc.querySelectorAll('#jobs-grid .job-card [data-action="open-booking"]')];
check('كل وظيفة متاحة تحمل زر «قدّم ببطاقتك» (' + bookBtns.length + ')', bookBtns.length >= 1);
check('زر التقديم يحمل كود وظيفته', (() => {
  const bad = bookBtns.filter((b) => !/^HRC-\d{3,}$/.test(b.getAttribute('data-code') || ''));
  return !bad.length || 'أزرار بلا كود: ' + bad.length;
})());
check('زر «بطاقتي» موجود بالقائمة العلوية والفوتر', !!site.doc.querySelector('header [data-action="open-booking"]') &&
  !!site.doc.querySelector('footer [data-action="open-booking"]'));

/* نافذة التفاصيل: خصوصية صاحب العمل + آلية البطاقة + قناة واتساب */
{
  const detailsBtn = site.doc.querySelector('#jobs-grid [data-action="job-details"]');
  if (detailsBtn) {
    click(W, detailsBtn);
    await wait(200);
    const box = lastModal(site.doc);
    const mtext = box ? box.textContent : '';
    check('نافذة التفاصيل تعرض تحذير خصوصية صاحب العمل', /خصوصية صاحب العمل/.test(mtext));
    check('نافذة التفاصيل تشرح آلية البطاقة (فرصتان + 24 ساعة)', /فرصتي بطاقة التوظيف/.test(mtext) && /24 ساعة/.test(mtext));
    const bookBtn = box.querySelector('[data-action="open-booking"]');
    check('خاتمة النافذة فيها زر التقديم بكود الوظيفة',
      !!bookBtn && bookBtn.getAttribute('data-code') === detailsBtn.getAttribute('data-code'));
    const wa = box.querySelector('a[href^="https://wa.me/"]');
    check('قناة واتساب الثانوية موجودة في النافذة', !!wa, 'لا يوجد رابط واتساب');
    const close = box.querySelector('[data-close]');
    if (close) click(W, close);
    await wait(150);
  }
}

/* فتح نافذة «بطاقتي» من زر وظيفة: خطوة إدخال الباركود */
check('زر التقديم يفتح نافذة «بطاقتي» على خطوة إدخال الباركود', (() => {
  click(W, bookBtns[0]);
  const box = lastModal(site.doc);
  return (box && box.querySelector('#bk-serial') && box.querySelector('#bk-lookup') &&
    /بطاقتي/.test(box.textContent)) || 'النافذة لم تُفتح كما يجب';
})());
{
  const closeB = lastModal(site.doc).querySelector('[data-close]');
  if (closeB) click(W, closeB);
  await wait(150);
}

/* ═══ 2) المنظومة الداخلية: بيع بطاقة كاش عند نقطة البيع ═════════════════ */
step(2, 'المنظومة الداخلية — بيع بطاقة كاش عند نقطة البيع وطباعتها');

/* بلا جلسة: المنظومة لا تُفتح إطلاقاً */
const anon = await open('dashboard.html');
check('بلا جلسة موظف: شاشة الدخول تحجب المنظومة', !!anon.doc.getElementById('login-wrap') &&
  !anon.doc.getElementById('login-wrap').classList.contains('hidden') &&
  anon.doc.getElementById('app-shell').classList.contains('hidden'));

/* بجلسة الإدارة: إصدار دفعة بطاقات فارغة (باركودات عشوائية فريدة) */
const dash = await open('dashboard.html', undefined, { session: 'admin' });
const D = dash.w.HRCStore;
check('المدير داخل المنظومة', !!D.currentUser() && D.currentUser().role === 'admin' &&
  !dash.doc.getElementById('app-shell').classList.contains('hidden'));

click(dash.w, dash.doc.querySelector('#side-nav button[data-view="applicants"]'));
await wait(200);

const stockBefore = D.listBlankCards().length;
check('زر «إصدار دفعة فارغة» ظاهر للإدارة', !dash.doc.getElementById('btn-new-batch').classList.contains('hidden'));
click(dash.w, dash.doc.getElementById('btn-new-batch'));
await wait(200);
{
  const box = lastModal(dash.doc);
  check('نافذة الدفعة: عدد + ملاحظة + تحذير التزوير', !!box.querySelector('#b-count') &&
    /عشوائي فريد/.test(box.textContent) && /لا يتشابه/.test(box.textContent));
  setVal(dash.w, box.querySelector('#b-count'), '3');
  setVal(dash.w, box.querySelector('#b-notes'), 'دفعة اختبار المسار');
  click(dash.w, box.querySelector('#b-save'));
  await wait(300);
}
{
  const box = lastModal(dash.doc);
  check('صدرت الدفعة (3 بطاقات) ونتيجة الدفعة معروضة', !!box && /3 بطاقة فارغة/.test(box.textContent));
  /* طباعة الدفعة: 3 بطاقات فارغة بوجهيها — بلا أسماء زبائن */
  const printBtn = box.querySelector('#b-print');
  check('زر طباعة الدفعة ظاهر', !!printBtn);
  if (printBtn) click(dash.w, printBtn);
  await wait(450);
}
const BLANKS = D.listBlankCards().slice(0, 3);
check('المخزون الفارغ زاد (' + stockBefore + ' → ' + D.listBlankCards().length + ')',
  D.listBlankCards().length === stockBefore + 3);
check('البطاقات الفارغة بلا اسم وبلا تواريخ (بانتظار التعبئة)',
  BLANKS.every((b) => b.status === 'blank' && !b.fullName && !b.phone && !b.issueDate && !b.expiryDate));
const blankSerials = BLANKS.map((b) => b.serial);
check('الباركودات بصيغة 10 خانات (حروف وأرقام) وفريدة', blankSerials.every((x) => /^[2-9A-HJKMNP-Z]{10}$/.test(x)) &&
  new Set(blankSerials).size === 3, blankSerials.join('،'));
{
  const nums = blankSerials.map((x) => Number(x.slice(7))).sort((a, b) => a - b);
  check('الباركودات عشوائية غير متسلسلة (لا تُخمَّن)', !(nums[1] - nums[0] === 1 && nums[2] - nums[1] === 1),
    blankSerials.join('،'));
}
const blankCodes = BLANKS.flatMap((b) => D.getAttempts(b.serial).map((t) => t.code));
check('رموز الفرص الستة (بطاقتان × فرصتان × 3) فريدة بصيغة NNNN-AA',
  blankCodes.length === 6 && new Set(blankCodes).size === 6 && blankCodes.every((c) => /^\d{4}-[A-HJ-NP-Z]{2}$/.test(c)));
const batchPrintHtml = dash.doc.getElementById('print-root').innerHTML;
check('ورق الدفعة المطبوع: 3 بطاقات بوجهيها (6 أوجه) بلا أسماء زبائن',
  (batchPrintHtml.match(/class="hrc-card[" ]/g) || []).length === 6 &&
  blankSerials.every((x) => batchPrintHtml.includes(x)) &&
  !/مرتضى|باحث/.test(batchPrintHtml),
  'أوجه ' + (batchPrintHtml.match(/class="hrc-card[" ]/g) || []).length);
check('ورق الدفعة يوضّح أن الصلاحية تبدأ عند التعبئة', /تبدأ من التعبئة|تُعبّأ بيانات الزبون عند البيع/.test(batchPrintHtml));
{
  const closeB = lastModal(dash.doc).querySelector('[data-close]');
  if (closeB) click(dash.w, closeB);
  await wait(150);
}

/* إضافة بطاقة مفردة بكودها (الإدارة): بطاقة واحدة فورية بلا دفعة كاملة */
check('زر «إضافة بطاقة» ظاهر للإدارة', !dash.doc.getElementById('btn-new-card').classList.contains('hidden'));
click(dash.w, dash.doc.getElementById('btn-new-card'));
await wait(200);
{
  const box = lastModal(dash.doc);
  check('نافذة «إضافة بطاقة بكودها»: كود مقترح + زر توليد + ملاحظة',
    !!box.querySelector('#c-code') && !!box.querySelector('#c-gen') && !!box.querySelector('#c-notes') &&
    /^[2-9A-HJKMNP-Z]{10}$/.test(box.querySelector('#c-code').value));
  /* صيغة خاطئة ثم كود مكرر: يُرفضان برسالة داخل النافذة */
  setVal(dash.w, box.querySelector('#c-code'), 'A1B2C3');
  click(dash.w, box.querySelector('#c-save'));
  await wait(120);
  check('الصيغة الخاطئة مرفوضة داخل النافذة', box.querySelector('#c-err').style.display !== 'none' &&
    /صيغة الباركود غير صحيحة/.test(box.querySelector('#c-err').textContent));
  setVal(dash.w, box.querySelector('#c-code'), blankSerials[0]);   /* باركود بطاقة الدفعة */
  click(dash.w, box.querySelector('#c-save'));
  await wait(120);
  check('الكود المكرر (بطاقة موجودة) مرفوض', box.querySelector('#c-err').style.display !== 'none' &&
    /مسجَّل لبطاقة موجودة/.test(box.querySelector('#c-err').textContent));
  /* 6 أرقام تُسبَق تلقائياً بـ HRC-BC */
  setVal(dash.w, box.querySelector('#c-code'), '777777');
  setVal(dash.w, box.querySelector('#c-notes'), 'بطاقة اختبار الزر');
  click(dash.w, box.querySelector('#c-save'));
  await wait(250);
}
{
  const box = lastModal(dash.doc);
  check('نافذة النتيجة تعرض البطاقة المضافة وزر الطباعة',
    !!box && /أُضيفت البطاقة HRC-BC-777777/.test(box.textContent) && !!box.querySelector('#c-print'));
  const CARD1 = D.getApplicant('HRC-BC-777777');
  check('البطاقة المضافة فارغة بفرصتين فارغتين وجاهزة للبيع',
    CARD1 && CARD1.status === 'blank' &&
    D.getAttempts('HRC-BC-777777').length === 2 &&
    D.getAttempts('HRC-BC-777777').every((t) => t.slotStatus === 'empty') &&
    D.listBlankCards().some((b) => b.serial === 'HRC-BC-777777'));
  check('إضافة البطاقة بكودها موثّقة بسجل التدقيق',
    D.listAudit().some((l) => l.action === 'إضافة بطاقة بكودها' && String(l.entityId || '').includes('HRC-BC-777777')));
  const closeC = box.querySelector('[data-close]');
  if (closeC) click(dash.w, closeC);
  await wait(150);
}

/* بيع وتعبئة بطاقة فارغة: البيانات تُسجَّل على نفس الباركود */
click(dash.w, dash.doc.getElementById('btn-new-app'));
await wait(200);
const SERIAL = blankSerials[0];
{
  const box = lastModal(dash.doc);
  check('نافذة البيع تعرض مخزون البطاقات الفارغة وتطلب اختيار الباركود', !!box.querySelector('#n-card') &&
    new RegExp(SERIAL).test(box.querySelector('#n-card').innerHTML));
  setVal(dash.w, box.querySelector('#n-card'), SERIAL);
  setVal(dash.w, box.querySelector('#n-name'), 'مرتضى كريم جبر الحلفاوي');
  setVal(dash.w, box.querySelector('#n-phone'), '07811234599');
  setVal(dash.w, box.querySelector('#n-pos'), 'مكتب الاستنساخ — الحلة شارع 40');
  /* موديل 2026-10-01: اختيار الوظيفة جزء من عملية البيع — يستهلك الفرصة الأولى */
  check('نافذة البيع تطلب اختيار الوظيفة (إلزامي) قبل الإتمام', !!box.querySelector('#n-job'));
  setVal(dash.w, box.querySelector('#n-job'), 'HRC-1043');
  click(dash.w, box.querySelector('#n-save'));
  await wait(350);
}
const RECORD = D.getApplicant(SERIAL);
const TOKEN = D.token(SERIAL);
/* المخزون: 2 قبل الدفعة + 3 دفعة + 1 بطاقة الزر اليدوية − 1 المبيعة = +3 */
check('البيع نجح على نفس الباركود المطبوع (' + SERIAL + ')', !!RECORD && RECORD.status === 'active' &&
  RECORD.serial === SERIAL && D.listBlankCards().length === stockBefore + 3);
check('بيع البطاقة سُجّل كاشاً مع نقطة البيع', RECORD.feePaid === true &&
  RECORD.posName === 'مكتب الاستنساخ — الحلة شارع 40');
check('الصلاحية (30 يوماً) بدأت من لحظة التعبئة لا من إصدار الدفعة',
  Math.round((new Date(RECORD.expiryDate) - new Date(RECORD.issueDate)) / 86400000) === 30 &&
  Math.abs(Date.now() - new Date(RECORD.issueDate).getTime()) < 60000);
check('البطاقة سارية والفرصة الأولى استُهلكت بوظيفة نقطة البيع (HRC-1043)',
  D.formStatus(RECORD) === 'active' && D.attemptsLeft(SERIAL) === 1 &&
  D.getAttempts(SERIAL)[0].slotStatus === 'reserved' && D.getAttempts(SERIAL)[0].jobCode === 'HRC-1043' &&
  D.getJob('HRC-1043').status === 'reserved',
  'المتبقي ' + D.attemptsLeft(SERIAL) + ' / ' + (D.getAttempts(SERIAL)[0] || {}).slotStatus);
const CHANCES = D.getAttempts(SERIAL);
check('رمزا فرصتي البطاقة هما نفسيهما المطبوعين على الورقة الفارغة',
  CHANCES.every((t) => blankCodes.indexOf(t.code) >= 0));
console.log('   ℹ  البطاقة: ' + SERIAL + ' | الفرصة ١: ' + (CHANCES[0] || {}).code + ' | الفرصة ٢: ' + (CHANCES[1] || {}).code);

/* موديل 2026-10-01: استمارة التوظيف A4 تُطبع تلقائياً جزءاً من عملية البيع —
   هي الوثيقة التي تحمل بيانات الزبون والوظيفة وبيانات صاحب العمل.
   (تُقرأ حاوية الطباعة قبل النقر على طباعة البطاقة الورقية بعدها) */
const formHtmlPrinted = dash.doc.getElementById('print-root').innerHTML;

/* نافذة الفرصتين + طباعة البطاقة الورقية */
{
  const box = lastModal(dash.doc);
  check('نافذة «بطاقة التوظيف — الفرصتان» انفتحت بعد البيع', !!box && /الفرصتان/.test(box.textContent) &&
    box.textContent.includes(SERIAL));
  check('زر طباعة استمارة A4 ظاهر بنافذة الفرصتين', !!box.querySelector('#m-print-form'));
  const printBtn = box && box.querySelector('#m-print');
  check('زر طباعة البطاقة (86×54مم) ظاهر', !!printBtn);
  if (printBtn) click(dash.w, printBtn);
  await wait(400);
}
const mustForm = [
  ['عنوان الاستمارة', /استمارة توظيف/.test(formHtmlPrinted)],
  ['نفس باركود البطاقة', formHtmlPrinted.includes(SERIAL)],
  ['اسم الزبون', formHtmlPrinted.includes('مرتضى كريم جبر')],
  ['الوظيفة المختارة', formHtmlPrinted.includes('HRC-1043')],
  ['بيانات صاحب العمل', /بيانات التواصل بصاحب العمل/.test(formHtmlPrinted) && formHtmlPrinted.includes('07811234567')],
  ['باركود QR', /<svg[\s\S]*<path/.test(formHtmlPrinted)]
];
const missForm = mustForm.filter(([, c]) => !c).map(([k]) => k);
check('استمارة A4 طُبعت تلقائياً بعد البيع ببيانات كاملة (' + (mustForm.length - missForm.length) + '/' + mustForm.length + ')',
  missForm.length === 0, missForm.join(' · '));
check('نافذة الطباعة استُدعيت فعلاً', dash.w.__printed > 0, 'عدد الاستدعاءات ' + dash.w.__printed);
check('طباعة الاستمارة موثّقة بسجل التدقيق', D.listAudit().some((l) => /طباعة استمارة توظيف/.test(l.action)));

/* ثم البطاقة الورقية: وجهان بلا أي بيانات زبون (قرار الإدارة — ورقة عامة) */
const printHtml = dash.doc.getElementById('print-root').innerHTML;
const mustPrint = [
  ['الوجهان', (printHtml.match(/class="hrc-card[" ]/g) || []).length === 2],
  ['الشركة', /شركة الهدف للتوظيف|Al-Hadaf/.test(printHtml)],
  ['الباركود QR', /<svg[\s\S]*<path/.test(printHtml)],
  ['الرقم التسلسلي', printHtml.includes(SERIAL)],
  ['رمزا الفرصتين', printHtml.includes(CHANCES[0].code) && printHtml.includes(CHANCES[1].code)],
  ['الإخلاء القانوني', /غير مسؤولة قانون/.test(printHtml)]
];
const missPrint = mustPrint.filter(([, c]) => !c).map(([k]) => k);
check('البطاقة المطبوعة تحوي كل عناصرها (' + (mustPrint.length - missPrint.length) + '/' + mustPrint.length + ')',
  missPrint.length === 0, missPrint.join(' · '));
check('البطاقة الورقية بلا اسم الزبون (البيانات على استمارة A4 فقط)', !printHtml.includes('مرتضى كريم جبر'));
check('الطباعة سُجّلت في عدّاد البطاقة', D.getApplicant(SERIAL).printedCount > 0);

const DB1 = D.exportJson();

/* ═══ 3) الزبون يتابع بطاقته ويستخدم الفرصة الأولى ═══════════════════════ */
step(3, '«بطاقتي» — الزبون يتابع بطاقته بالباركود ويستخدم الفرصة الأولى');

const pub = await open('index.html');
const P = pub.w.HRCStore;
P.importJson(DB1);
await wait(250);

/* بطاقة فارغة لم تُبع بعد: عرض الزبون يرفضها (منع التزوير ببيع ورق المخزون) */
{
  const blankLookup = P.lookupCard(blankSerials[1]);
  check('بطاقة فارغة لم تُبع: عرض الزبون يرفضها برسالة واضحة', blankLookup.ok === false &&
    /لم تُبع بعد/.test(blankLookup.error), blankLookup.error);
}

/* فتح «بطاقتي» من الهيدر وإدخال الباركود */
click(pub.w, pub.doc.querySelector('header [data-action="open-booking"]'));
await wait(150);
{
  const box = lastModal(pub.doc);
  setVal(pub.w, box.querySelector('#bk-serial'), SERIAL);
  click(pub.w, box.querySelector('#bk-lookup'));
  await wait(350);
}
{
  const box = lastModal(pub.doc);
  const text = box ? box.textContent : '';
  check('عرض البطاقة نجح بالباركود وحده', !!box && box.textContent.includes(SERIAL));
  check('اسم الزبون مقنّع للعرض العام (لا تسريب)', text.includes('م⚫') || text.includes('م*') ||
    (!text.includes('مرتضى كريم جبر') && /الاسم:/.test(text)), 'الاسم الكامل ظهر للعرض العام');
  /* الفرصة الأولى استُهلكت بوظيفة نقطة البيع عند البيع — المتبقية للزبون واحدة */
  check('الفرصتان معروضتان: الأولى محجوزة بوظيفة نقطة البيع والمتاح 1',
    /الفرص المتاحة: <b>1<\/b>|الفرص المتاحة: 1/.test(text.replace(/\s+/g, ' ')) &&
    text.includes('HRC-1043') && /متاحة للاستخدام/.test(text));
  const useBtn = box.querySelector('#bk-use');
  check('زر «استخدم فرصة على وظيفة» ظاهر للبطاقة السارية', !!useBtn);
  if (useBtn) { click(pub.w, useBtn); await wait(250); }
}

/* استخدام الفرصة: رمز غلط يُرفض، ثم الرمز الصحيح يثبّت التقديم */
{
  const box = lastModal(pub.doc);
  check('خطوة الاستخدام تعرض الوظائف المتاحة وخانة رمز الفرصة', !!box.querySelector('#bk-job') && !!box.querySelector('#bk-code'));
  setVal(pub.w, box.querySelector('#bk-job'), 'HRC-1042');
  setVal(pub.w, box.querySelector('#bk-code'), '0000-ZZ');
  click(pub.w, box.querySelector('#bk-confirm'));
  await wait(300);
  const errHost = pub.doc.querySelector('[data-bk-err="code"]');
  check('رمز الفرصة الخاطئ يُرفض برسالة واضحة', !!errHost && /رمز الفرصة/.test(errHost.textContent) &&
    errHost.style.display !== 'none', 'لم يظهر خطأ الرمز');

  /* رمز الفرصة الأولى (المستهلكة بوظيفة نقطة البيع) لا يُقبل أيضاً */
  setVal(pub.w, box.querySelector('#bk-code'), CHANCES[0].code);
  click(pub.w, box.querySelector('#bk-confirm'));
  await wait(300);
  check('رمز فرصة مستهلكة لا يُقبل (الفرصة تُستهلك بالتقديم)', !!errHost && /رمز الفرصة/.test(errHost.textContent));

  /* الرمز الصحيح: رمز الفرصة الثانية */
  setVal(pub.w, box.querySelector('#bk-code'), CHANCES[1].code);
  click(pub.w, box.querySelector('#bk-confirm'));
  await wait(400);
}
{
  const box = lastModal(pub.doc);
  check('شاشة النجاح: «تم تثبيت تقديمك» بالوظيفة ومدة الحجز', !!box && /تم تثبيت تقديمك/.test(box.textContent) &&
    box.textContent.includes('HRC-1042') && /24 ساعة/.test(box.textContent));
}
const jobA = P.getJob('HRC-1042');
check('الوظيفة HRC-1042 محجوزة مؤقتاً بمهلة 24 ساعة', jobA.status === 'reserved' &&
  Math.round((new Date(jobA.holdExpiresAt) - Date.now()) / 3600000) === 24,
  jobA.status + ' / ' + jobA.holdExpiresAt);
check('الفرصة الثانية استُهلكت بالتقديم الذاتي ولا فرص متبقية', P.attemptsLeft(SERIAL) === 0 &&
  P.getAttempts(SERIAL)[1].slotStatus === 'reserved' && P.getAttempts(SERIAL)[1].jobCode === 'HRC-1042');
check('التقديم الذاتي موثّق في سجل التدقيق', P.listAudit().some((l) => /تقديم ذاتي/.test(l.action)));

const DB2 = P.exportJson();

/* ═══ 3ب) صاحب العمل: يمسح الباركود ويسجّل طلبه — والقرار للشركة ═══════ */
step('3ب', 'صاحب العمل — يمسح الباركود ويسجّل طلب توظيف (الوظيفة «جاري التوظيف» حتى قرار الشركة)');

const emp = await open('index.html', '?role=employer#card=' + encodeURIComponent(SERIAL), { db: DB2 });
await wait(900);
{
  const box = lastModal(emp.doc);
  /* قرار 2026-10-06: رابط «صاحب العمل؟» يفتح صفحته مباشرة — بلا بوابة دور وبلا رمز */
  check('رابط صاحب العمل (role=employer) يفتح صفحة صاحب العمل مباشرة بلا بوابة ولا رمز',
    !!box && /تعريف المتقدم/.test(box.textContent) && !box.querySelector('#bk-gate-emp') &&
    !/اكتب رمز|رمز صاحب العمل/.test(box.textContent));
  await wait(50);
}
{
  const box = lastModal(emp.doc);
  const text = box ? box.textContent : '';
  check('صفحة صاحب العمل تعرض تعريف المتقدم وبياناته', /تعريف المتقدم/.test(text) &&
    text.includes('مرتضى كريم جبر') && text.includes('07811234599'));
  check('التقديم الجاري (HRC-1042) وبيانات صاحب العمل ظاهرة', text.includes('HRC-1042') &&
    /مكان المقابلة/.test(text) && text.includes('07701234567'));
  check('صفحة صاحب العمل لا تكشف رموز الفرص (سرّ الزبون)',
    !CHANCES.some((c) => c && text.includes(c.code)));
  const hire = box.querySelector('#bk-emp-hire');
  check('زر «تم التوظيف» ظاهر', !!hire);
  if (hire) click(emp.w, hire);
  await wait(350);
}
{
  const box = lastModal(emp.doc);
  const yes = box && box.querySelector('[data-ok]');
  check('نافذة تسجيل طلب التوظيف توضّح أن القرار بيد الشركة', !!yes &&
    /سجّل طلب التوظيف|بانتظار تثبيت/.test(box.textContent));
  if (yes) click(emp.w, yes);
  await wait(450);
}
{
  const box = lastModal(emp.doc);
  check('شاشة «سُجّل طلب التوظيف» تبيّن انتظار قرار الشركة', !!box &&
    /سُجّل طلب التوظيف/.test(box.textContent) && /جاري التوظيف/.test(box.textContent));
}
{
  const E = emp.w.HRCStore;
  check('الوظيفة HRC-1042 تحولت لـ«جاري التوظيف» — لم تُغلق فوراً',
    E.getJob('HRC-1042').status === 'hiring' && E.getJob('HRC-1042').critical === false,
    E.getJob('HRC-1042').status);
  check('الفرصة الثانية «جاري التوظيف» بطلب صاحب العمل — والبطاقة سارية',
    E.getAttempts(SERIAL)[1].slotStatus === 'hiring' &&
    E.getAttempts(SERIAL)[1].employerDecision === 'hire' &&
    E.getAttempts(SERIAL)[0].slotStatus === 'reserved' &&
    E.formStatus(E.getApplicant(SERIAL)) === 'active');
  check('طلب صاحب العمل موثّق بسجل التدقيق', E.listAudit().some((l) => /طلب توظيف من صاحب العمل/.test(l.action)));
}
/* الطلب مسجَّل: صفحة صاحب العمل تعرض بانتظار الشركة — بلا أزرار قرار */
{
  const box = lastModal(emp.doc);
  const again = box.querySelector('#bk-empd-close');
  if (again) { click(emp.w, again); await wait(250); }
  const emp2 = await open('index.html', '?role=employer#card=' + encodeURIComponent(SERIAL), { db: emp.w.HRCStore.exportJson() });
  await wait(900);
  {
    const b2 = lastModal(emp2.doc);
    const g = b2 && b2.querySelector('#bk-gate-emp');
    if (g) { click(emp2.w, g); await wait(350); }
    const b3 = b2 && /تعريف المتقدم/.test(b2.textContent) ? b2 : lastModal(emp2.doc);
    const t3 = b3 ? b3.textContent : '';
    check('صفحة صاحب العمل بعد الطلب: «بانتظار تثبيت الشركة» وبلا أزرار قرار',
      /بانتظار تثبيت الشركة/.test(t3) && !b3.querySelector('#bk-emp-hire') && !b3.querySelector('#bk-emp-reject'));
  }
}
const DB2B = emp.w.HRCStore.exportJson();

/* ═══ 4) انتهاء مهلة 24 ساعة ⇒ حالة «حرجة» (لا إفراج تلقائي) ════════════ */
step(4, 'انتهاء مهلة الحجز — حالة «حرجة» بانتظار قرار الموظف (لا إفراج تلقائي)');

const dash2 = await open('dashboard.html', undefined, { session: 'staff' });
const D2 = dash2.w.HRCStore;
D2.importJson(DB2B);
dash2.w.HRCRefresh && dash2.w.HRCRefresh();
await wait(250);
check('زرا «إضافة بطاقة» و«إصدار دفعة» مخفيان عن الموظف (للمدير وحده)',
  dash2.doc.getElementById('btn-new-card').classList.contains('hidden') &&
  dash2.doc.getElementById('btn-new-batch').classList.contains('hidden'));

/* تقديم ساعة حجز وظيفة نقطة البيع (الفرصة الأولى) للماضي ثم تشغيل الصيانة */
D2.db().jobs.forEach(function (j) { if (j.code === 'HRC-1043') j.holdExpiresAt = new Date(Date.now() - 3600000).toISOString(); });
D2.db().attempts.forEach(function (t) { if (t.serial === SERIAL && t.no === 1) t.holdExpiresAt = new Date(Date.now() - 3600000).toISOString(); });
const maint = D2.runMaintenance();
const jobCrit = D2.getJob('HRC-1043');
check('الصيانة رصدت الحجز المنتهي كحالة حرجة', (maint || []).some((a) => a.type === 'criticalHold'));
check('الوظيفة تبقى مقفلة (محجوزة) — لا إفراج تلقائي', jobCrit.status === 'reserved' && jobCrit.critical === true,
  jobCrit.status + ' / critical=' + jobCrit.critical);
check('الفرصة الأولى انتقلت لحالة «حرجة»', D2.getAttempts(SERIAL)[0].slotStatus === 'critical');

/* لوحة الموظف تعرض قرار الحالة الحرجة */
click(dash2.w, dash2.doc.querySelector('#side-nav button[data-view="overview"]'));
await wait(200);
{
  const ov = dash2.doc.getElementById('ov-actions');
  check('«إجراءات مطلوبة» تعرض طلب التوظيف المعلّق والحالة الحرجة معاً', !!ov &&
    /جاري التوظيف/.test(ov.textContent) && /HRC-1042/.test(ov.textContent) &&
    /حالة حرجة/.test(ov.textContent) && /HRC-1043/.test(ov.textContent));
}

const DB3 = D2.exportJson();

/* ═══ 5) قرار الشركة: تثبيت طلب صاحب العمل + حسم الحالة الحرجة ═════════ */
step(5, 'قرار الشركة — تثبيت طلب صاحب العمل («ثنينهم») ثم حسم الحالة الحرجة');

/* «ثنينهم» (ج4): طلب صاحب العمل لا يُحسم فوراً — الموظف يثبّته من المنظومة */
const confirmHire = D2.setOutcome(SERIAL, 2, 'succeeded', 'تثبيت طلب صاحب العمل: تم التوظيف — أقرّته الشركة');
check('الموظف ثبتّ طلب توظيف صاحب العمل', confirmHire.ok === true, confirmHire.error);
const jobEmp = D2.getJob('HRC-1042');
check('الوظيفة HRC-1042 أُغلقت بالتثبيت', jobEmp.status === 'closed');
check('الفرصة الثانية «تم التوظيف» بعد التثبيت', D2.getAttempts(SERIAL)[1].slotStatus === 'succeeded');

/* ثم دور الموظف على الفرصة الأولى الحرجة (HRC-1043) */
const win = D2.setOutcome(SERIAL, 1, 'succeeded', 'اجتاز المقابلة وبدأ الشغل');
check('قرار توظيف الموظف سُجّل', win.ok === true, win.error);
const jobClosed = D2.getJob('HRC-1043');
check('الوظيفة أُغلقت ورفعت راية الحرجة عنها', jobClosed.status === 'closed' && jobClosed.critical === false);
const afterHire = D2.getApplicant(SERIAL);
check('الفرصتان انتهتا بنتيجة نهائية — البطاقة «استُهلكت الفرصتان» وتُشترى بطاقة جديدة',
  D2.formStatus(afterHire) === 'exhausted' && D2.attemptsLeft(SERIAL) === 0, D2.formStatus(afterHire));
const lk1 = D2.lookupCard(SERIAL);
check('عرض الزبون يبيّن «تم توظيف بإحدى الفرصتين» ولا فرص متبقية', lk1.ok && lk1.card.succeeded === true &&
  Number(lk1.card.chancesLeft) === 0);

const DB4 = D2.exportJson();

/* ═══ 6) نقطة البيع عبر الموقع + طلب صاحب العمل وإلغاء الشركة ══════════ */
step(6, 'نقطة البيع عبر الموقع — تعبئة بطاقة فارغة بخطوتين ثم طلب «لم يتم التوظيف» وإلغاء الشركة للتوظيف');

/* بطاقة ثانية من دفعة الجلسة لا تزال فارغة: نقطة البيع تمسح باركودها بأي
   موبايل فيفتح الموقع «استمارة الزبون» مباشرة (موديل 2026-10-01). */
const SERIAL2 = blankSerials[1];
const pub2 = await open('index.html', '?role=pos#card=' + encodeURIComponent(SERIAL2), { db: DB4 });
await wait(900);
{
  const box = lastModal(pub2.doc);
  check('مسح باركود بطاقة فارغة يفتح «استمارة الزبون» لنقطة البيع',
    !!box && /استمارة الزبون|الخطوة 1 من 6/.test(box.textContent) && !!box.querySelector('#bk-posName'));
  check('المعالج الخطوي: الخطوة الأولى تعرض معلومة واحدة فقط (نقطة البيع) وبلا بقية الحقول',
    !!box.querySelector('#bk-posName') && !box.querySelector('#bk-fullName') &&
    !box.querySelector('#bk-phone') && !box.querySelector('#bk-job') &&
    /الخطوة 1 من 6/.test(box.textContent));
  /* إلزامي الاسم: «التالي» بحقل فاضغ يوقف ويظهر الخطأ */
  click(pub2.w, box.querySelector('#bk-pos-next'));
  await wait(150);
  check('«التالي» بحقل إلزامي فاضغ يوقف مع رسالة خطأ واضحة',
    pub2.w.HRCBooking.state().posStep === 1 &&
    box.querySelector('[data-bk-err="posName"]').style.display !== 'none');
  setVal(pub2.w, box.querySelector('#bk-posName'), 'مكتب الرافدين — المحاويل');
  click(pub2.w, box.querySelector('#bk-pos-next'));
  await wait(250);
}
{
  const box = lastModal(pub2.doc);
  check('خطوة 2: الاسم الكامل بمعلومة واحدة وزر «التالي»',
    pub2.w.HRCBooking.state().posStep === 2 && !!box.querySelector('#bk-fullName') &&
    !box.querySelector('#bk-phone') && /الخطوة 2 من 6/.test(box.textContent));
  setVal(pub2.w, box.querySelector('#bk-fullName'), 'سجاد حسن الموسوي');
  click(pub2.w, box.querySelector('#bk-pos-next'));
  await wait(250);
}
{
  const box = lastModal(pub2.doc);
  check('خطوة 3: رقم الهاتف', pub2.w.HRCBooking.state().posStep === 3 && !!box.querySelector('#bk-phone'));
  setVal(pub2.w, box.querySelector('#bk-phone'), '07709876543');
  click(pub2.w, box.querySelector('#bk-pos-next'));
  await wait(250);
}
{
  const box = lastModal(pub2.doc);
  check('خطوة 4: العنوان (اختياري — يمشي فاضغاً)', pub2.w.HRCBooking.state().posStep === 4 && !!box.querySelector('#bk-address'));
  setVal(pub2.w, box.querySelector('#bk-address'), 'المحاويل - المركز');
  click(pub2.w, box.querySelector('#bk-pos-next'));
  await wait(250);
}
{
  const box = lastModal(pub2.doc);
  check('خطوة 5: الجنس وتاريخ الميلاد (اختيارية)', pub2.w.HRCBooking.state().posStep === 5 &&
    !!box.querySelector('#bk-gender') && !!box.querySelector('#bk-dob'));
  click(pub2.w, box.querySelector('#bk-pos-next'));
  await wait(250);
}
{
  const box = lastModal(pub2.doc);
  check('خطوة 6: متصفح وظائف ببطاقات وفلاتر (بحث + منطقة + دوام) — بلا قائمة منسدلة',
    pub2.w.HRCBooking.state().posStep === 6 && !!box.querySelector('#bk-jlist') &&
    !!box.querySelector('#bk-jq') && !!box.querySelector('#bk-jr') && !!box.querySelector('#bk-js') &&
    box.querySelectorAll('[data-bk-pick]').length >= 3 && !box.querySelector('#bk-fullName'));
  check('بطاقات الوظائف المتاحة تعرض العنوان والكود والمنطقة والأجر — بلا بيانات صاحب عمل',
    (() => { const c = box.querySelector('[data-bk-pick]'); const t = c.textContent;
      return /HRC-10\d\d/.test(c.getAttribute('data-bk-pick')) && /\d{3}.\d{3}/.test(t) && !t.includes('07701234567'); })());
  click(pub2.w, box.querySelector('#bk-pos-next'));
  await wait(150);
  check('«التالي» بلا وظيفة مختارة يوقف مع خطأ', pub2.w.HRCBooking.state().posStep === 6 &&
    box.querySelector('[data-bk-err="job"]').style.display !== 'none');
  /* الفلترة الحية: البحث يقصّر القائمة فورياً */
  setVal(pub2.w, box.querySelector('#bk-jq'), 'باريستا');
  await wait(200);
  check('البحث يفلتر البطاقات فورياً (باريستا وحدها)',
    box.querySelectorAll('[data-bk-pick]').length === 1 &&
    !!box.querySelector('[data-bk-pick="HRC-1046"]'));
  setVal(pub2.w, box.querySelector('#bk-jq'), '');
  await wait(200);
  check('تصفير البحث يعيد كل الوظائف المتاحة', box.querySelectorAll('[data-bk-pick]').length >= 3);
  /* الاختيار بالضغط على البطاقة */
  click(pub2.w, box.querySelector('[data-bk-pick="HRC-1046"]'));
  await wait(200);
  check('اختيار البطاقة يميزها بالذهبي مع ملخص فوري (الأجر والمنطقة والدوام)',
    box.querySelector('[data-bk-pick="HRC-1046"]').classList.contains('is-picked') &&
    /باريستا/.test(box.querySelector('#bk-job-sum').textContent) &&
    /الهاشمية/.test(box.querySelector('#bk-job-sum').textContent));
  click(pub2.w, box.querySelector('#bk-pos-next'));
  await wait(350);
}
{
  /* رجوع من المراجعة → خطوة الوظيفة → رجوع خطوة خطوة → تقدم ثانية */
  const box = lastModal(pub2.doc);
  check('زر «رجوع للتعديل» يعيد لآخر خطوة (الوظيفة)', !!box.querySelector('#bk-pos-back'));
  click(pub2.w, box.querySelector('#bk-pos-back'));
  await wait(200);
  check('الرجوع من المراجعة يفتح متصفح الوظائف والاختيار محفوظ (بطاقة مميزة)',
    pub2.w.HRCBooking.state().view === 'posfill' &&
    pub2.w.HRCBooking.state().posStep === 6 &&
    lastModal(pub2.doc).querySelector('[data-bk-pick="HRC-1046"]').classList.contains('is-picked'));
  click(pub2.w, lastModal(pub2.doc).querySelector('#bk-pos-back'));
  await wait(200);
  check('«رجوع» داخل المعالج يرجع خطوة ويحفظ المسوّدة',
    pub2.w.HRCBooking.state().posStep === 5 &&
    lastModal(pub2.doc).querySelector('#bk-gender').value === 'ذكر');
  click(pub2.w, lastModal(pub2.doc).querySelector('#bk-pos-next'));
  await wait(200);
  click(pub2.w, lastModal(pub2.doc).querySelector('#bk-pos-next'));
  await wait(350);
}
{
  const box = lastModal(pub2.doc);
  const text = box ? box.textContent : '';
  check('شاشة «مراجعة الزبون» تعرض بياناته ووظيفته المختارة',
    /مراجعة الزبون/.test(text) && text.includes('سجاد حسن الموسوي') &&
    text.includes('07709876543') && text.includes('HRC-1046'));
  check('المراجعة لا تكشف أي بيانات لصاحب العمل قبل ضغطة «إتمام»',
    !/مكان المقابلة/.test(text) && !text.includes('07751234567') && !text.includes('كافيه دجلة'));
  const confirmBtn = box.querySelector('#bk-pos-confirm');
  check('زر «إتمام» بيد الزبون نفسه', !!confirmBtn && /إتمام/.test(confirmBtn.textContent));
  if (confirmBtn) click(pub2.w, confirmBtn);
  await wait(1000);   /* يشمل الطباعة التلقائية لاستمارة A4 ببيانات صاحب العمل */
}
{
  const P2 = pub2.w.HRCStore;
  const a2 = P2.getApplicant(SERIAL2);
  check('تفعيل البطاقة من الموقع نجح على نفس الباركود المطبوع', a2 && a2.status === 'active' &&
    a2.fullName === 'سجاد حسن الموسوي' && a2.posName === 'مكتب الرافدين — المحاويل');
  check('اختيار الوظيفة استهلك الفرصة الأولى بحجز 24 ساعة', P2.getAttempts(SERIAL2)[0].slotStatus === 'reserved' &&
    P2.getAttempts(SERIAL2)[0].jobCode === 'HRC-1046' && P2.getJob('HRC-1046').status === 'reserved');
  check('استمارة A4 طُبعت تلقائياً بنفس باركود البطاقة', pub2.w.__printed > 0 &&
    pub2.doc.getElementById('print-root').innerHTML.includes(SERIAL2) &&
    /استمارة توظيف/.test(pub2.doc.getElementById('print-root').innerHTML));
  check('شاشة النجاح تعرض الاستمارة نفسها للعين — ببيانات صاحب العمل كاملة',
    !!lastModal(pub2.doc).querySelector('.hrc-form') &&
    lastModal(pub2.doc).textContent.includes('سجاد حسن الموسوي') &&
    lastModal(pub2.doc).textContent.includes('كافيه دجلة') &&
    /مكان المقابلة/.test(lastModal(pub2.doc).textContent));
  check('بيع نقطة البيع من الموقع موثّق بسجل التدقيق',
    P2.listAudit().some((l) => /بيع وتعبئة بطاقة فارغة/.test(l.action)));
}
const DB5 = pub2.w.HRCStore.exportJson();

/* ═══ ج10) سباق الوظيفة: حُجزت من لحظة اختيارها حتى «إتمام» ═══════════════
   بيع متزامن (صفحة بقيت مفتوحة أو تبويب ثانٍ) يفوز بالوظيفة — وفشل «إتمام»
   يجب أن يشرح سببه داخل الشاشة لا بتوست يختفي، وينظف الاختيار العالق،
   ويتعافى الزبون باختيار وظيفة أخرى فوراً. */
{
  const P2 = pub2.w.HRCStore, B2 = pub2.w.HRCBooking;
  /* إنشاء البطاقات تجهيزاً للاختبار يتطلب جلسة مدير (قرار 2026-10-10) */
  Object.defineProperty(pub2.w, 'sessionStorage', { configurable: true, value: staffStorage('admin') });
  const dbgR = P2.createCardWithSerial(P2.suggestSerial(), '');
  if (!dbgR.ok) throw new Error('إعداد الاختبار: ' + dbgR.error);
  const sRace = dbgR.card.serial;
  const sOther = P2.createCardWithSerial(P2.suggestSerial(), '').card.serial;
  const sThird = P2.createCardWithSerial(P2.suggestSerial(), '').card.serial;
  delete pub2.w.sessionStorage;   /* إعادة الزائر إلى حالته الطبيعية */
  B2.open({ serial: sRace, fromHash: true });
  await wait(350);
  const bx = () => lastModal(pub2.doc);
  for (const [id, v] of [['bk-posName', 'نقطة السباق'], ['bk-fullName', 'زبون السباق'], ['bk-phone', '07812121212']]) {
    setVal(pub2.w, bx().querySelector('#' + id), v);
    click(pub2.w, bx().querySelector('#bk-pos-next'));
    await wait(220);
  }
  for (let i = 0; i < 2; i++) { click(pub2.w, bx().querySelector('#bk-pos-next')); await wait(220); }
  check('رحلة السباق وصلت خطوة الوظيفة', B2.state().posStep === 6 && !!bx().querySelector('[data-bk-pick="HRC-1047"]'));
  click(pub2.w, bx().querySelector('[data-bk-pick="HRC-1047"]'));
  await wait(250);
  click(pub2.w, bx().querySelector('#bk-pos-next'));
  await wait(250);
  check('وصل المراجعة بوظيفة مختارة', B2.state().view === 'posreview');
  /* «تبويب آخر» يبيع نفس الوظيفة أولاً — الزبون الأول لا يعلم */
  const rOther = P2.activateCard(sOther, { posName: 'نقطة أخرى', fullName: 'زبون آخر', phone: '07813131313', jobCode: 'HRC-1047' });
  check('بيع متزامن على HRC-1047 ينجح للبطاقة الأخرى أولاً', rOther && rOther.ok === true, rOther && rOther.error);
  click(pub2.w, bx().querySelector('#bk-pos-confirm'));
  await wait(550);
  check('فشل «إتمام» لوظيفة محجوزة يعيد لخطوة الوظيفة والسبب داخل الشاشة — لا توستاً عابراً',
    B2.state().view === 'posfill' && B2.state().posStep === 6 &&
    bx().textContent.includes('تعذّر إتمام البيع') && bx().textContent.includes('غير متاحة'));
  check('الوظيفة المحجوزة انحذفت من الاختيار — بلا بطاقة مختارة وبلا ملخص',
    !bx().querySelector('[data-bk-pick].is-picked') && !bx().querySelector('#bk-job-sum').textContent.trim());
  /* التعافي: يختار وظيفة متاحة أخرى فيصل المراجعة من جديد */
  click(pub2.w, bx().querySelector('[data-bk-pick="HRC-1048"]'));
  await wait(250);
  click(pub2.w, bx().querySelector('#bk-pos-next'));
  await wait(250);
  check('التعافي: اختيار وظيفة أخرى يوصل المراجعة ويختفي خطأ السباق',
    B2.state().view === 'posreview' && !bx().textContent.includes('تعذّر إتمام البيع'));
  /* حارس «التالي»: وظيفة حُجزت بعد الاختيار لا تمر للمراجعة أصلاً */
  click(pub2.w, bx().querySelector('#bk-pos-back'));
  await wait(250);
  check('«رجوع» أعاده لخطوة الوظيفة والاختيار محفوظ',
    B2.state().posStep === 6 && !!bx().querySelector('[data-bk-pick].is-picked'));
  const rThird = P2.activateCard(sThird, { posName: 'نقطة ثالثة', fullName: 'زبون ثالث', phone: '07814141414', jobCode: 'HRC-1048' });
  check('حجز HRC-1048 من بطاقة ثالثة ينجح', rThird && rThird.ok === true, rThird && rThird.error);
  click(pub2.w, bx().querySelector('#bk-pos-next'));
  await wait(300);
  const errJob = bx().querySelector('[data-bk-err="job"]');
  /* عنصر خطأ الوظيفة يوجد فقط حين تُرسم قائمة الوظائف — فإن نفدت كل الوظائف
     فصندوق السبب أعلى الشاشة هو الرسالة (لا قائمة كي يحملها خطأ الوظيفة) */
  const pickerShown = !!bx().querySelector('#bk-jlist');
  check('حارس «التالي» يوقف وظيفة حُجزت بعد الاختيار — والسبب داخل الشاشة',
    B2.state().posStep === 6 && B2.state().view === 'posfill' &&
    bx().textContent.includes('لم تعد متاحة') &&
    (!pickerShown || (errJob && errJob.style.display !== 'none')));
  B2.close();
}

/* صاحب العمل يرفض التوظيف بسبب مكتوب — الوظيفة «معلّقة/حرجة» والقرار للشركة */
const emp2 = await open('index.html', '?role=employer#card=' + encodeURIComponent(SERIAL2), { db: DB5 });
await wait(900);
{
  const b = lastModal(emp2.doc);
  const g = b && b.querySelector('#bk-gate-emp');
  if (g) { click(emp2.w, g); await wait(350); }
  const b2 = lastModal(emp2.doc);
  const reject = b2 && b2.querySelector('#bk-emp-reject');
  check('زر «لم يتم التوظيف» ظاهر لصاحب العمل', !!reject);
  if (reject) { click(emp2.w, reject); await wait(300); }
  /* السبب إلزامي: الضغط بلا سبب يوقف مع رسالة ولا يسجّل شيئاً */
  const b3 = lastModal(emp2.doc);
  check('نافذة الرفض تطلب سبباً مكتوباً (إلزامي)',
    !!b3 && !!b3.querySelector('#bk-reason') && /السبب إلزامي/.test(b3.textContent));
  const okNoReason = b3.querySelector('#bk-reason-ok');
  if (okNoReason) { click(emp2.w, okNoReason); await wait(250); }
  const b4 = lastModal(emp2.doc);
  const E2Sx = emp2.w.HRCStore;
  check('الرفض بلا سبب مرفوض ولا يُسجَّل أي قرار',
    !!b4 && b4.querySelector('#bk-reason-err').style.display !== 'none' &&
    !E2Sx.getAttempts(SERIAL2)[0].employerDecision,
    E2Sx.getAttempts(SERIAL2)[0].employerDecision || 'بلا قرار');
  /* السبب مكتوباً: يُحفظ ويُنقل الوظيفة والفرصة إلى «حرجة / معلّقة» */
  setVal(emp2.w, b4.querySelector('#bk-reason'), 'العدد مكتمل ولا حاجة لمزيد من العاملين');
  click(emp2.w, b4.querySelector('#bk-reason-ok'));
  await wait(500);
  const E2S = emp2.w.HRCStore;
  const att2 = E2S.getAttempts(SERIAL2)[0];
  const job2 = E2S.getJob('HRC-1046');
  check('الفرصة انتقلت لحالة «حرجة» مع قرار الرفض وسببه',
    att2.slotStatus === 'critical' && att2.employerDecision === 'reject' &&
    /العدد مكتمل/.test(att2.reason || ''), att2.slotStatus + ' / ' + att2.reason);
  check('الوظيفة HRC-1046 رجعت «معلّقة/حرجة» — لا إغلاق ولا حجز مؤقت',
    job2.status === 'reserved' && job2.critical === true && !job2.holdExpiresAt,
    job2.status + ' / critical=' + job2.critical);
  check('طلبه لم يُحسم معه شيء: لا «جاري توظيف» على الوظيفة',
    E2S.pendingActions().hiring.every((h) => h.job.code !== 'HRC-1046'));
  check('طلب الرفض موثّق بسجل التدقيق مع السبب',
    E2S.listAudit().some((l) => /رفض من صاحب العمل مع السبب/.test(l.action) && /العدد مكتمل/.test(l.details || '')));
  /* شاشة صاحب العمل بعد الرفض: «حرجة/معلّقة» + السبب المسجَّل + بلا أزرار قرار */
  const b5 = lastModal(emp2.doc);
  const t5 = b5 ? b5.textContent : '';
  check('شاشة صاحب العمل بعد الرفض تُظهر «حرجة — معلّقة» والسبب المسجَّل وبلا أزرار قرار',
    /سُجّل رفض التوظيف/.test(t5) && /حرجة — معلّقة/.test(t5) && /العدد مكتمل/.test(t5) &&
    !b5.querySelector('#bk-emp-hire') && !b5.querySelector('#bk-emp-reject'));
}

/* موظف الشركة يرى «إجراءات مطلوبة» بالسبب، وقراره: إرجاع متاحة أو حذف */
const dash3 = await open('dashboard.html', undefined, { session: 'staff' });
const D3 = dash3.w.HRCStore;
D3.importJson(emp2.w.HRCStore.exportJson());
dash3.w.HRCRefresh && dash3.w.HRCRefresh();
await wait(250);
click(dash3.w, dash3.doc.querySelector('#side-nav button[data-view="overview"]'));
await wait(250);
{
  const ov = dash3.doc.getElementById('ov-actions');
  check('«إجراءات مطلوبة» تعرض رفض صاحب العمل وسببه ورقم الوظيفة',
    !!ov && /رفض صاحب العمل/.test(ov.textContent) && /HRC-1046/.test(ov.textContent) &&
    /العدد مكتمل/.test(ov.textContent), ov ? ov.textContent.slice(0, 160) : 'لا قائمة');
}
click(dash3.w, dash3.doc.querySelector('#side-nav button[data-view="jobs"]'));
await wait(250);
{
  const critBtn = dash3.doc.querySelector('[data-job-critical="HRC-1046"]');
  check('جدول الوظائف يوفّر زر قرار للحالة المعلّقة', !!critBtn);
  if (critBtn) { click(dash3.w, critBtn); await wait(300); }
  const box = lastModal(dash3.doc);
  check('نافذة القرار تعرض سبب الرفض المسجَّل من صاحب العمل',
    !!box && /سبب عدم التوظيف المسجَّل/.test(box.textContent) && /العدد مكتمل/.test(box.textContent));
  check('نافذة القرار توفّر الخيارين المطلوبين: إرجاع الوظيفة متاحة أو حذفها',
    !!box && !!box.querySelector('#h-release') && !!box.querySelector('#h-del') &&
    /إرجاع الوظيفة/.test(box.textContent) && /حذف الوظيفة/.test(box.textContent));
  /* الخيار الأول: إرجاع الوظيفة متاحة — والفرصة مستهلكة لا تعود */
  if (box.querySelector('#h-release')) { click(dash3.w, box.querySelector('#h-release')); await wait(350); }
}
check('الوظيفة HRC-1046 رجعت «متاحة» لغيره بقرار الموظف', D3.getJob('HRC-1046').status === 'available',
  D3.getJob('HRC-1046').status);
check('فرصة البطاقة التي رُفضت لا تعود (بقيت فرصة واحدة)', D3.attemptsLeft(SERIAL2) === 1 &&
  D3.getAttempts(SERIAL2)[0].slotStatus === 'expired', D3.getAttempts(SERIAL2)[0].slotStatus);
check('قرار الموظف موثّق بالسبب في سجل التدقيق',
  D3.listAudit().some((l) => /إرجاع الوظيفة متاحة/.test(l.details || '')));
/* الخيار الثاني متاح أيضاً: حذف الوظيفة نهائياً من نفس النافذة (يُختبر على وظيفة ثالثة) */
check('حذف الوظيفة متاح كخيار ثانٍ للموظف', typeof D3.deleteJob === 'function' && D3.deleteJob('HRC-1047') === true);
check('الوظيفة HRC-1047 حُذفت نهائياً بقرار الموظف', !D3.getJob('HRC-1047'));
check('كل قرارات الرحلة موثقة بسجل التدقيق (' + D3.listAudit().length + ' قيداً)',
  D3.listAudit().some((l) => /توظيف/.test(l.action)) && D3.listAudit().some((l) => /رفض|إرجاع|حذف/.test(l.action)));

/* ── 6ب) بيع بلا وظيفة: البطاقة تُباع بفرصتين فارغتين والزبون يختار وظيفتَيه ──
   قرار 2026-10-06: اختيار الوظيفة عند البيع صار اختيارياً — من تخطّاها يعيّن
   صاحبُ البطاقة وظيفتَي فرصتيه بنفسه من صفحة باركود بطاقته (apply.html). */
step('6ب', 'بيع بطاقة بلا وظيفة — فرصتان فارغتان يختارهما صاحب البطاقة بنفسه');
const SERIAL_SKIP = blankSerials[2];
const pubSkip = await open('index.html', '?role=pos#card=' + encodeURIComponent(SERIAL_SKIP), { db: D3.exportJson() });
await wait(900);
{
  const box = lastModal(pubSkip.doc);
  check('مسح باركود بطاقة فارغة ثالثة يفتح استمارة نقطة البيع', !!box && !!box.querySelector('#bk-posName'));
  setVal(pubSkip.w, box.querySelector('#bk-posName'), 'مكتب بابل — المركز');
  click(pubSkip.w, box.querySelector('#bk-pos-next')); await wait(200);
  setVal(pubSkip.w, lastModal(pubSkip.doc).querySelector('#bk-fullName'), 'ليلى عبد الأمير حسن');
  click(pubSkip.w, lastModal(pubSkip.doc).querySelector('#bk-pos-next')); await wait(200);
  setVal(pubSkip.w, lastModal(pubSkip.doc).querySelector('#bk-phone'), '07711223344');
  click(pubSkip.w, lastModal(pubSkip.doc).querySelector('#bk-pos-next')); await wait(200);
  click(pubSkip.w, lastModal(pubSkip.doc).querySelector('#bk-pos-next')); await wait(200);  /* العنوان اختياري */
  click(pubSkip.w, lastModal(pubSkip.doc).querySelector('#bk-pos-next')); await wait(250);  /* الجنس والميلاد */
}
{
  const box = lastModal(pubSkip.doc);
  check('خطوة الوظيفة صارت اختيارية بعنوان واضح وخيار تخطٍّ ظاهر',
    /اختيار الوظيفة \(اختياري\)/.test(box.textContent) && !!box.querySelector('#bk-pos-skip') &&
    /تخطّي/.test(box.querySelector('#bk-pos-skip').textContent));
  click(pubSkip.w, box.querySelector('#bk-pos-skip'));
  await wait(300);
}
{
  const box = lastModal(pubSkip.doc);
  check('التخطّي ينقل لمراجعة الزبون بلا وظيفة مع توضيح المصير (فرصتان فارغتان)',
    !!box && /بلا اختيار وظيفة/.test(box.textContent) && /فرصتين فارغتين/.test(box.textContent) &&
    !/HRC-1046/.test(box.textContent));
  check('المراجعة لا تطالب بوظيفة ولا تعرض بيانات صاحب عمل', !/مكان المقابلة/.test(box.textContent));
  click(pubSkip.w, box.querySelector('#bk-pos-confirm'));
  await wait(600);
}
{
  const P3 = pubSkip.w.HRCStore;
  const a3 = P3.getApplicant(SERIAL_SKIP);
  const att3 = P3.getAttempts(SERIAL_SKIP);
  check('البطاقة فُعّلت بيعاً وبلا وظيفة (الحالة active)', !!a3 && a3.status === 'active', a3 && a3.status);
  check('الفرصتان بقيتا فارغتين — لم تُستهلك أي فرصة عند البيع',
    att3.length === 2 && att3.every((t) => t.slotStatus === 'empty') && P3.attemptsLeft(SERIAL_SKIP) === 2,
    att3.map((t) => t.slotStatus).join(','));
  check('لا وظيفة محجوزة من هذا البيع', P3.pendingActions().holds.every((h) => h.serial !== SERIAL_SKIP));
  check('البيع بلا وظيفة موثّق بسجل التدقيق كما هو (بلا اختيار وظيفة)',
    P3.listAudit().some((l) => /بيع وتعبئة بطاقة فارغة/.test(l.action) && /السERIAL|ليلى عبد الأمير/.test(l.details || '') &&
      /بلا اختيار وظيفة/.test(l.details || '')));
  const box = lastModal(pubSkip.doc);
  check('شاشة البيع تُخبر نقطة البيع أن الزبون يختار وظيفتَيه بنفسه',
    !!box && /البطاقة صارت نشطة بفرصتين فارغتين/.test(box.textContent) && /يختار وظيفتَيه/.test(box.textContent),
    box ? box.textContent.slice(0, 160) : '');
  check('بلا زر طباعة استمارة A4 — لا وظيفة بعد', !box.querySelector('#bk-pos-print'));
  const closeBtn = box.querySelector('#bk-pos-close');
  if (closeBtn) { click(pubSkip.w, closeBtn); await wait(200); }
}

const DB6 = D3.exportJson();

/* ═══ 7) صفحة التحقق: الموظف يفحص البطاقة — والزائر محجوب ═══════════════ */
step(7, 'صفحة التحقق — الموظف يفحص البطاقة من باركود QR والزائر محجوب');

const q = '?form=' + encodeURIComponent(SERIAL) + '&t=' + TOKEN;
const ver = await open('verify.html', q, { session: 'staff' });
ver.w.HRCStore.importJson(DB6);
ver.w.HRCVerify.mount(q);
await wait(250);
{
  const vtext = ver.doc.body.textContent;
  check('الاسم الكامل يظهر للموظف (بلا تقنيع)', vtext.includes('مرتضى كريم جبر الحلفاوي'));
  check('الرقم التسلسلي وحالة البطاقة ظاهران', vtext.includes(SERIAL) && /استُهلكت الفرصتان/.test(vtext));
  check('جدول الفرص يعرض وظيفتي البطاقة HRC-1043 و HRC-1042', vtext.includes('HRC-1043') && vtext.includes('HRC-1042'));
  check('باركود QR التحقق مرسوم في الصفحة', !!ver.doc.querySelector('#verify-root svg'));
  check('لا أخطاء في صفحة التحقق', ver.errors.length === 0, ver.errors[0]);
}

/* بصمة مزيفة: تحذير أمني */
const qf = '?form=' + encodeURIComponent(SERIAL) + '&t=deadbeef';
const fake = await open('verify.html', qf, { session: 'staff' });
fake.w.HRCStore.importJson(DB6);
fake.w.HRCVerify.mount(qf);
await wait(250);
check('تحذير التلاعب ظاهر للبصمة المزيفة', /تحذير أمني|غير مطابق/.test(fake.doc.body.textContent));

/* الزائر: بوابة تحجب أي بيانات */
const visitor = await open('verify.html', q);
visitor.w.HRCStore.importJson(DB6);
visitor.w.HRCVerify.mount(q);
await wait(250);
{
  const gate = visitor.doc.getElementById('verify-root').textContent;
  check('الزائر يرى بوابة «خاص بموظفي الشركة والإدارة»', /موظفي الشركة والإدارة/.test(gate));
  check('لا تسريب لأي بيانات بطاقة للزائر', !gate.includes(SERIAL) && !gate.includes('مرتضى كريم جبر') && !/الفرصة/.test(gate));
}

/* ═══ 8) إعادة طباعة البطاقة من الموقع العام (إثبات الحيازة) ═════════════ */
step(8, 'إعادة الطباعة — الزبون يعيد طباعة بطاقته برمز الفرصة (إثبات الحيازة)');

const pubCard = await open('index.html');
const P3C = pubCard.w.HRCStore;
P3C.importJson(DB6);
await wait(250);
const printedBefore = P3C.getApplicant(SERIAL).printedCount;

click(pubCard.w, pubCard.doc.querySelector('header [data-action="open-booking"]'));
await wait(150);
{
  const box = lastModal(pubCard.doc);
  setVal(pubCard.w, box.querySelector('#bk-serial'), SERIAL);
  click(pubCard.w, box.querySelector('#bk-lookup'));
  await wait(350);
}
{
  const box = lastModal(pubCard.doc);
  const rp = box.querySelector('#bk-reprint');
  check('زر «إعادة طباعة البطاقة» ظاهر حتى بعد استنفاد الفرصتين', !!rp);
  if (rp) { click(pubCard.w, rp); await wait(250); }
}
{
  const box = lastModal(pubCard.doc);
  /* رمز خاطئ أولاً: إثبات الحيازة إلزامي */
  setVal(pubCard.w, box.querySelector('#bk-rcode'), '0000-ZZ');
  click(pubCard.w, box.querySelector('#bk-print'));
  await wait(300);
  const errHost = pubCard.doc.querySelector('[data-bk-err="rcode"]');
  check('إعادة الطباعة برمز خاطئ مرفوضة', !!errHost && /رمز الفرصة/.test(errHost.textContent) &&
    errHost.style.display !== 'none', 'لم يظهر خطأ الرمز');

  setVal(pubCard.w, box.querySelector('#bk-rcode'), CHANCES[1].code);
  click(pubCard.w, box.querySelector('#bk-print'));
  await wait(450);
}
const reprintHtml = pubCard.doc.getElementById('print-root').innerHTML;
check('إعادة طباعة البطاقة نجحت: الوجهان بالباركود والرمزين — وبلا اسم زبون',
  (reprintHtml.match(/class="hrc-card[" ]/g) || []).length === 2 && reprintHtml.includes(SERIAL) &&
  reprintHtml.includes(CHANCES[0].code) && reprintHtml.includes(CHANCES[1].code) &&
  !reprintHtml.includes('مرتضى كريم جبر'));
check('نافذة الطباعة استُدعيت لإعادة الطباعة', pubCard.w.__printed > 0, 'عدد الاستدعاءات ' + pubCard.w.__printed);
check('عدّاد طباعة البطاقة زاد (' + printedBefore + ' → ' + P3C.getApplicant(SERIAL).printedCount + ')',
  P3C.getApplicant(SERIAL).printedCount > printedBefore);

/* إعادة طباعة استمارة التوظيف A4 بنفس إثبات الحيازة (رمز الفرصة) */
{
  const box = lastModal(pubCard.doc);
  const pf = box.querySelector('#bk-print-form');
  check('زر «تحقق واطبع استمارة A4» ظاهر بإعادة الطباعة', !!pf);
  setVal(pubCard.w, box.querySelector('#bk-rcode'), CHANCES[1].code);
  if (pf) click(pubCard.w, pf);
  await wait(450);
}
const formReprint = pubCard.doc.getElementById('print-root').innerHTML;
/* الاستمارة تعرض آخر تقديم (الفرصة الثانية على HRC-1042 هي الأحدث) */
check('إعادة طباعة استمارة A4 نجحت: الاسم وآخر وظيفة مقدَّم عليها',
  /استمارة توظيف/.test(formReprint) && formReprint.includes(SERIAL) &&
  formReprint.includes('مرتضى كريم جبر') && formReprint.includes('HRC-1042'));
check('استمارة A4 المعاد طباعتها لا تكشف رموز الفرص',
  !CHANCES.some((c) => c && formReprint.includes(c.code)));

/* ═══ 9) الملف المستقل: التحقق بالمسار الهاشي بجلسة موظف ═════════════════ */
step(9, 'الملف المستقل — التحقق بالمسار الهاشي والتنقل (بجلسة موظف)');

const solo = await open('hrc-standalone.html', '#!verify?form=' + encodeURIComponent(SERIAL) + '&t=' + TOKEN, { session: 'staff' });
solo.w.HRCStore.importJson(DB6);
solo.w.dispatchEvent(new solo.w.Event('hashchange'));
await wait(450);
{
  const stext = solo.doc.body.textContent;
  const verifyVisible = solo.doc.getElementById('route-verify') && !solo.doc.getElementById('route-verify').hasAttribute('hidden');
  check('المسار #!verify عرض قسم التحقق', !!verifyVisible);
  check('الملف المستقل يعرض بيانات نفس البطاقة', stext.includes(SERIAL) || stext.includes('مرتضى كريم جبر'));
  check('لا أخطاء في الملف المستقل', solo.errors.length === 0, solo.errors[0]);
}

/* ═══ الخلاصة ═══════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(72));
console.log('  النتيجة:  ✅ ' + pass + ' ناجح   |   ❌ ' + fail + ' فاشل');
console.log('═'.repeat(72));
if (problems.length) { console.log('\n  الإخفاقات:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log(fail ? '' : '\n  🎉 رحلة بطاقة التوظيف كاملة تعمل من البيع حتى الإرجاع بلا أي خلل.\n');
process.exit(fail ? 1 : 0);
