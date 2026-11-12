#!/usr/bin/env node
// Synthetic cross-device transfer: inject fixtures in test memory, NOT through
// the restore API (now admin-only). Production Auth/security checks stay intact.
function injectFixture(store,json){const db=store.db();for(const k of Object.keys(db))delete db[k];Object.assign(db,JSON.parse(json));store.emit();}
/* ===========================================================================
 * Local integration/regression suite. Application UI and database permissions
 * are tested by the focused suites below; the jsdom journey uses synthetic
 * historical card fixtures for staff decisions, printing and verification.
 * No production data, network, real purchase or browser camera is involved.
 * =========================================================================== */
import { spawnSync } from 'node:child_process';
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

// Cover the current customer application and security-definer SQL paths rather
// than reviving the removed POS wizard. Fail the suite if any subprocess fails.
for (const file of ['apply-flow.mjs', 'card-validity.mjs', 'card-identity.mjs', 'customer-application-sql.mjs', 'customer-snapshot-local.mjs', 'office-sql.mjs']) {
  console.log('\n▌ فحص المسار الحالي: ' + file);
  const run = spawnSync(process.execPath, [join(ROOT, 'tests', file)], { stdio: 'inherit' });
  if (run.error || run.status !== 0) {
    console.error('فشل الاختبار: ' + file, run.error || ('exit ' + run.status));
    process.exit(run.status || 1);
  }
}


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
  // Historical end-to-end fixture is intentionally local; cloud suites stay enabled.
  if (dom.window.HRCSupabaseConfig) dom.window.HRCSupabaseConfig.enabled = false;
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
console.log('  HRC — اختبار التقديم ومسارات البطاقة والموظف ببيانات تجريبية');
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

/* نافذة التفاصيل: خصوصية البيانات + آلية البطاقة + قناة واتساب */
{
  const detailsBtn = site.doc.querySelector('#jobs-grid [data-action="job-details"]');
  if (detailsBtn) {
    click(W, detailsBtn);
    await wait(200);
    const box = lastModal(site.doc);
    const mtext = box ? box.textContent : '';
    check('نافذة التفاصيل تعرض خصوصية البيانات دون نص موجّه لصاحب العمل', /خصوصية البيانات/.test(mtext) && !/صاحب العمل/.test(mtext));
    /* 2026-10-25: صياغة النافذة الجديدة تشرح الآلية في خطوات «كيف تُقدّم عليها؟» */
    check('نافذة التفاصيل تشرح آلية البطاقة (باركود + حجز 24 ساعة)',
      /بطاقة التوظيف/.test(mtext) && /24 ساعة/.test(mtext) && /كيف تُقدّم عليها/.test(mtext));
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
/* Fake confirmed server result for this local print-flow fixture; real RPC and
   idempotent retry are separately exercised by store-cloud/card-number-sql. */
D.issueNumberedCards = async (count, serial, notes) => {
  if (serial) { const r=D.createCardWithSerial(serial,notes); if(!r.ok) throw new Error(r.error); return [Object.assign(r.card,{cardNumber:6})]; }
  return D.createCardBatch(count, notes).map((card, i) => Object.assign(card, {cardNumber:i+1}));
};
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
  /* قرار 2026-11-10: الدفعات مضاعفات ٤ (4..60) لأن الورقة صارت 4 بطاقات.
     العدد 5 كان يُرفض فتفشل الدفعة كلها. 8 يغطي ورقتين كاملتين. */
  setVal(dash.w, box.querySelector('#b-count'), '8');
  setVal(dash.w, box.querySelector('#b-notes'), 'دفعة اختبار المسار');
  click(dash.w, box.querySelector('#b-save'));
  await wait(300);
}
{
  const box = lastModal(dash.doc);
  check('صدرت الدفعة (8 بطاقات) ونتيجة الدفعة معروضة', !!box && /8 بطاقة فارغة/.test(box.textContent));
  /* طباعة الدفعة: 8 بطاقات فارغة بوجهيها — بلا أسماء زبائن */
  const printBtn = box.querySelector('#b-print');
  check('زر طباعة الدفعة ظاهر', !!printBtn);
  if (printBtn) click(dash.w, printBtn);
  await wait(450);
}
const BLANKS = D.listBlankCards().slice(0, 5);
check('المخزون الفارغ زاد (' + stockBefore + ' → ' + D.listBlankCards().length + ')',
  D.listBlankCards().length === stockBefore + 8);
check('البطاقات الفارغة بلا اسم وبلا تواريخ (بانتظار التعبئة)',
  BLANKS.every((b) => b.status === 'blank' && !b.fullName && !b.phone && !b.issueDate && !b.expiryDate));
const blankSerials = BLANKS.map((b) => b.serial);
check('الباركودات بصيغة 10 خانات (حروف وأرقام) وفريدة', blankSerials.every((x) => /^[2-9A-HJKMNP-Z]{10}$/.test(x)) &&
  new Set(blankSerials).size === 5, blankSerials.join('،'));
{
  const nums = blankSerials.map((x) => Number(x.slice(7))).sort((a, b) => a - b);
  check('الباركودات عشوائية غير متسلسلة (لا تُخمَّن)', !(nums[1] - nums[0] === 1 && nums[2] - nums[1] === 1),
    blankSerials.join('،'));
}
const blankCodes = BLANKS.flatMap((b) => D.getAttempts(b.serial).map((t) => t.code)).filter(Boolean);
check('البطاقات الجديدة لا تحمل أي رمز فرصة (أُلغيت نهائياً 2026-10-25)',
  blankCodes.length === 0, 'رموز مولّدة: ' + blankCodes.join(','));
const batchPrintHtml = dash.doc.getElementById('print-root').innerHTML;
const sheetPrintStyle = dash.doc.getElementById('hrc-sheet-style').textContent;
/* قرار 2026-11-10 (تكبير البطاقة 70.2×111.8مم + الإطار الذهبي المزدوج):
   الورقة صارت 2×2 لا 3×3، والزوم 1 لا 1.1، والحشو صفراً بعمود واحد متمركز. */
check('مقاس الدفعة موحّد مع البطاقة المفردة واستغلال ورقة A4',
  /repeat\(2,70\.2mm\)/.test(sheetPrintStyle) &&
  /grid-auto-rows:111\.8mm/.test(sheetPrintStyle) &&
  /zoom:1(?![.\d])/.test(sheetPrintStyle));
check('ورق الدفعة المطبوع: 8 بطاقات بوجهيها (16 وجهاً) بلا أسماء زبائن',
  (batchPrintHtml.match(/class="hrc-card[" ]/g) || []).length === 16 &&
  blankSerials.every((x) => batchPrintHtml.includes(x)) &&
  !/مرتضى|باحث/.test(batchPrintHtml),
  'أوجه ' + (batchPrintHtml.match(/class="hrc-card[" ]/g) || []).length);
check('ورق الدفعة يوضّح أن الصلاحية تبدأ عند أول تقديم', /30 يوماً<\/b> من أول تقديم/.test(batchPrintHtml));
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

/* Historical activated card fixture for the staff/printing journey. The real
   first application is exercised separately by apply-flow and card-validity. */
const SERIAL = blankSerials[0];
check('زر البيع المحذوف غير موجود ولا يظهر إجراء تعبئة للبطاقات',
  !dash.doc.getElementById('btn-new-app') && !dash.doc.querySelector('[data-app-fill]'));
const fixtureActivation = D.activateCard(SERIAL, {fullName:'مرتضى كريم جبر الحلفاوي', phone:'07811234599', posName:'مكتب الاستنساخ — الحلة شارع 40', jobCode:'HRC-1043', feePaid:true});
if (!fixtureActivation.ok) throw new Error('إعداد بيانات الرحلة: ' + fixtureActivation.error);
dash.w.HRCRefresh && dash.w.HRCRefresh();
click(dash.w, dash.doc.querySelector('#side-nav button[data-view="applicants"]'));
await wait(200);
const attemptsButton = dash.doc.querySelector('[data-app-attempts="' + SERIAL + '"]');
if (!attemptsButton) throw new Error('تعذر فتح فرص بطاقة الاختبار');
click(dash.w, attemptsButton); await wait(150);
const initialModal = lastModal(dash.doc);
click(dash.w, initialModal.querySelector('#m-print-form')); await wait(200);
const RECORD = D.getApplicant(SERIAL);
const TOKEN = D.token(SERIAL);
/* المخزون: 2 قبل الدفعة + 8 دفعة + 1 بطاقة الزر اليدوية − 1 المبيعة = +8 */
check('بيانات الاختبار محفوظة على نفس الباركود (' + SERIAL + ')', !!RECORD && RECORD.status === 'active' &&
  RECORD.serial === SERIAL && D.listBlankCards().length === stockBefore + 8);
check('بيانات البطاقة التجريبية تتضمن نقطة البيع', RECORD.feePaid === true &&
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
check('تعبئة البطاقة القديمة لا تُنشئ أي رمز فرصة',
  D.getAttempts(SERIAL).every((t) => !t.code) &&
  D.getAttempts(SERIAL).length === 2,
  'رموز: ' + D.getAttempts(SERIAL).map((t) => t.code).join(','));
console.log('   ℹ  البطاقة: ' + SERIAL + ' | الفرصتان بلا رموز (الباركود وحده)');

/* موديل 2026-10-01: استمارة التوظيف A4 طُبعت من نافذة الفرص —
   هي الوثيقة التي تحمل بيانات الزبون والوظيفة وبيانات صاحب العمل.
   (تُقرأ حاوية الطباعة قبل النقر على طباعة البطاقة الورقية بعدها) */
const formHtmlPrinted = dash.doc.getElementById('print-root').innerHTML;

/* نافذة الفرصتين + طباعة البطاقة الورقية */
{
  const box = lastModal(dash.doc);
  check('نافذة «بطاقة التوظيف — الفرصتان» انفتحت من جدول البطاقات', !!box && /الفرص/.test(box.textContent) &&
    box.textContent.includes(SERIAL));
  check('زر طباعة استمارة A4 ظاهر بنافذة الفرصتين', !!box.querySelector('#m-print-form'));
  const printBtn = box && box.querySelector('#m-print');
  check('زر طباعة البطاقة ظاهر', !!printBtn);
  if (printBtn) click(dash.w, printBtn);
  await wait(400);
}
const mustForm = [
  ['عنوان الاستمارة', /استمارة توظيف/.test(formHtmlPrinted)],
  ['نفس باركود البطاقة', formHtmlPrinted.includes(SERIAL)],
  ['اسم الزبون', formHtmlPrinted.includes('مرتضى كريم جبر')],
  ['الوظيفة المختارة', formHtmlPrinted.includes('HRC-1043')],
  ['بيانات صاحب العمل', /بيانات صاحب العمل/.test(formHtmlPrinted) && formHtmlPrinted.includes('07811234567')],
  ['باركود QR', /<svg[\s\S]*<path/.test(formHtmlPrinted)]
];
const missForm = mustForm.filter(([, c]) => !c).map(([k]) => k);
check('استمارة A4 طُبعت من نافذة الفرص ببيانات كاملة (' + (mustForm.length - missForm.length) + '/' + mustForm.length + ')',
  missForm.length === 0, missForm.join(' · '));
check('نافذة الطباعة استُدعيت فعلاً', dash.w.__printed > 0, 'عدد الاستدعاءات ' + dash.w.__printed);
check('طباعة الاستمارة موثّقة بسجل التدقيق', D.listAudit().some((l) => /طباعة استمارة توظيف/.test(l.action)));

/* ثم البطاقة الورقية: وجهان بلا أي بيانات زبون (قرار الإدارة — ورقة عامة) */
const printHtml = dash.doc.getElementById('print-root').innerHTML;
const mustPrint = [
  ['الوجهان', (printHtml.match(/class="hrc-card[" ]/g) || []).length === 2],
  ['الشركة', /منصة مكسب/.test(printHtml)],
  ['الباركود QR', /<svg[\s\S]*<path/.test(printHtml)],
  ['الرقم التسلسلي', printHtml.includes(SERIAL)],
  ['رمزا الفرصتين الأصليان', printHtml.includes(CHANCES[0].code) && printHtml.includes(CHANCES[1].code)],
  ['الإخلاء القانوني', /غير مسؤولة قانون/.test(printHtml)]
];
const missPrint = mustPrint.filter(([, c]) => !c).map(([k]) => k);
check('البطاقة المطبوعة تحوي كل عناصرها (' + (mustPrint.length - missPrint.length) + '/' + mustPrint.length + ')',
  missPrint.length === 0, missPrint.join(' · '));
check('البطاقة الورقية بلا اسم الزبون (البيانات على استمارة A4 فقط)', !printHtml.includes('مرتضى كريم جبر'));
check('الطباعة سُجّلت في عدّاد البطاقة', D.getApplicant(SERIAL).printedCount > 0);

const DB1 = JSON.stringify(D.db());

/* ═══ 3) الزبون يتابع بطاقته ويستخدم الفرصة الأولى ═══════════════════════ */
step(3, '«بطاقتي» — الزبون يتابع بطاقته بالباركود ويستخدم الفرصة الأولى');

const pub = await open('index.html');
const P = pub.w.HRCStore;
injectFixture(P,DB1);
await wait(250);

/* البطاقة غير المستخدمة تُعرض دون بيانات شخصية أو بدء للصلاحية. */
{
  const blankLookup = P.lookupCard(blankSerials[1]);
  const caseCode = blankSerials[1];
  check('بحث البطاقات بالحروف الكبيرة والصغيرة يعيد نفس النتائج', P.listApplicants({q:caseCode.toLowerCase()}).some(a=>a.serial===caseCode) && P.listApplicants({q:caseCode.toUpperCase()}).some(a=>a.serial===caseCode));
  check('البطاقة الفارغة معروفة دون بيانات شخصية أو بدء صلاحية', blankLookup.ok === true &&
    blankLookup.card.status === 'blank' && !blankLookup.card.fullName && !blankLookup.card.issueDate, JSON.stringify(blankLookup));
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

/* استخدام الفرصة: الباركود وحده — بلا أي رمز (قرار 2026-10-25) */
{
  const box = lastModal(pub.doc);
  check('خطوة الاستخدام تعرض الوظائف المتاحة بلا خانة رمز',
    !!box.querySelector('#bk-job') && !box.querySelector('#bk-code') &&
    /لا حاجة لأي رمز/.test(box.textContent));
  setVal(pub.w, box.querySelector('#bk-job'), 'HRC-1042');
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

const DB2 = JSON.stringify(P.db());

/* ═══ 3ب) صاحب العمل — مساره أُزيل نهائياً (2026-10-25) ═══════════════════ */
step('3ب', 'بوابة صاحب العمل — محذوفة: لا صفحة ولا رمز سري ولا قرار من الويب');
{
  const src = await (await import('node:fs/promises')).readFile(new URL('../assets/js/booking.js', import.meta.url), 'utf8');
  check('نافذة «بطاقتي» بلا أي زر أو مسار لصاحب العمل',
    !/bk-emp-open|employerRoute|renderEmployer/.test(src) && !/أنا صاحب العمل/.test(src));
  /* jsdom does not implement navigation; verify the actual route in the
     source, with browser navigation exercised in home-startup-browser. */
  const route = src.slice(src.indexOf('function openFromHash()'), src.indexOf('/* التقاط أزرار', src.indexOf('function openFromHash()')));
  check('روابط البطاقات القديمة تتجه لصفحة التقديم وليس بوابة صاحب العمل',
    /location\.replace\('apply\.html\?form='/.test(route) && !/role === 'employer'|role === 'pos'/.test(route));
}

/* حالة «طلب توظيف من صاحب العمل» صارت تُسجَّل من لوحة الموظفين (حُذف مسار
   صاحب العمل من الويب 2026-10-25) — نجهّز الحالة نفسها لتستمر بقية الرحلة. */
const DB2B = (function () {
  const snapshot = JSON.parse(DB2);
  const at = snapshot.attempts.find((t) => t.serial === SERIAL && t.no === 2);
  if (at) {
    at.slotStatus = 'hiring';
    at.employerDecision = 'hire';
    at.decisionAt = new Date().toISOString();
    at.outcomeNote = 'طلب توظيف — بانتظار تثبيت الشركة';
    at.holdExpiresAt = null;
    const job = snapshot.jobs.find((j) => j.id === at.jobId);
    if (job) { job.status = 'hiring'; job.critical = false; job.holdExpiresAt = null; }
  }
  return JSON.stringify(snapshot);
})();

step(4, 'انتهاء مهلة الحجز — حالة «حرجة» بانتظار قرار الموظف (لا إفراج تلقائي)');

const dash2 = await open('dashboard.html', undefined, { session: 'staff' });
const D2 = dash2.w.HRCStore;
injectFixture(D2,DB2B);
dash2.w.HRCRefresh && dash2.w.HRCRefresh();
await wait(250);
/* قرار المالك 2026-11-11 (نهائي): إصدار البطاقات حصرياً للمدير العام.
   الموظف يرى شاشة البطاقات ويعمل عليها، لكن لا زر إصدار لديه. */
check('زرا «إضافة بطاقة» و«إصدار دفعة» مخفيان عن الموظف (إصدار حصري للمدير)',
  dash2.doc.getElementById('btn-new-card').classList.contains('hidden') &&
  dash2.doc.getElementById('btn-new-batch').classList.contains('hidden'));
check('شاشة البطاقات ظاهرة للموظف',
  !dash2.doc.querySelector('#side-nav button[data-view="applicants"]').classList.contains('hidden'));
/* ما يبقى للمدير وحده: سجل التدقيق والمالية والإعدادات */
check('سجل التدقيق والمالية والإعدادات تبقى للمدير وحده',
  dash2.doc.querySelector('#side-nav button[data-view="audit"]').classList.contains('hidden') &&
  dash2.doc.querySelector('#side-nav button[data-view="finance"]').classList.contains('hidden') &&
  dash2.doc.querySelector('#side-nav button[data-view="settings"]').classList.contains('hidden'));

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

const DB3 = JSON.stringify(D2.db());

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

const DB4 = JSON.stringify(D2.db());

/* Prepare a second historical active card fixture for the staff decision flow.
   This is not an assertion that the deleted sale interface still exists. */
step(6, 'متابعة قرار الموظف على بطاقة تجريبية');
const SERIAL2 = blankSerials[1];
/* تفعيل البطاقة صار محمياً بجلسة موظف (2026-11-11) — نفتح بجلسة موظف
   كما يفعل الموظف على جهازه. رفض الزائر يُثبته client-authz. */
const pub2 = await open('index.html', null, { session: { username: 'staff', name: 'موظف', role: 'staff' } });
injectFixture(pub2.w.HRCStore, DB4);
const secondFixture = pub2.w.HRCStore.activateCard(SERIAL2, {fullName:'سجاد حسن الموسوي', phone:'07709876543', posName:'بيانات اختبار', jobCode:'HRC-1046'});
if (!secondFixture.ok) throw new Error('إعداد البطاقة الثانية: ' + secondFixture.error);
const DB5 = JSON.stringify(pub2.w.HRCStore.db());
const DB5R = (function () {
  const snapshot = JSON.parse(JSON.stringify(pub2.w.HRCStore.db()));
  const REASON = 'العدد مكتمل ولا حاجة لمزيد من العاملين';
  const at = snapshot.attempts.find((t) => t.serial === SERIAL2 && t.no === 1);
  if (at) {
    at.slotStatus = 'critical';
    at.employerDecision = 'reject';
    at.decisionAt = new Date().toISOString();
    at.holdExpiresAt = null;
    at.reason = REASON;
    at.note = 'رفض صاحب العمل — السبب: ' + REASON + ' | القرار الآن بيد الشركة: إرجاع الوظيفة متاحة أو حذفها';
    const job = snapshot.jobs.find((j) => j.id === at.jobId);
    if (job) { job.status = 'reserved'; job.critical = true; job.holdExpiresAt = null; }
  }
  snapshot.audit.unshift({
    id: 'log-e2e-reject', ts: new Date().toISOString(), user: 'staff', role: 'staff', name: 'موظف توظيف',
    ip: '127.0.0.1', action: 'رفض من صاحب العمل مع السبب', entity: 'applicant', entityId: SERIAL2,
    details: 'سجّل الموظف رفض صاحب العمل على الوظيفة HRC-1046 — الفرصة #1 | السبب: ' + REASON
  });
  return JSON.stringify(snapshot);
})();
{
  const S5 = JSON.parse(DB5R);
  const att2 = S5.attempts.find((t) => t.serial === SERIAL2 && t.no === 1);
  const job2 = S5.jobs.find((j) => j.id === att2.jobId);
  check('رفض صاحب العمل مسجَّل على الفرصة بحالتها الحرجة والسبب',
    att2.slotStatus === 'critical' && att2.employerDecision === 'reject' && /العدد مكتمل/.test(att2.reason || ''),
    att2.slotStatus + ' / ' + att2.reason);
  check('الوظيفة HRC-1046 رجعت «معلّقة/حرجة» — لا إغلاق ولا حجز مؤقت',
    job2.status === 'reserved' && job2.critical === true && !job2.holdExpiresAt,
    job2.status + ' / critical=' + job2.critical);
}

/* موظف الشركة يرى «إجراءات مطلوبة» بالسبب، وقراره: إرجاع متاحة أو حذف */
const dash3 = await open('dashboard.html', undefined, { session: 'staff' });
const D3 = dash3.w.HRCStore;
injectFixture(D3,DB5R);
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
/* الحذف للمدير فقط — مطابقةً لسياسة jobs_admin_delete في القاعدة. الموظف
   يعدّل ويغلق ويحجز، لكن لا يحذف (وإلا يفشل الإرسال على الخادم بصمت). */
{
  /* الجلسة تُضبط مباشرة: login() مغلق بـenforceAuth في هذه البيئة، والفحص
     يحتاج اختبار الدورين. هذا تعديل حالة اختبار، لا مسار مستخدم. */
  const jobExists = !!D3.getJob('HRC-1047');
  function actAs(role) {
    dash3.w.sessionStorage.setItem('hrc_session_v2', JSON.stringify({ username: role, name: role, role: role, cloud: true }));
    try { D3.logout(); } catch (e) { }
    dash3.w.sessionStorage.setItem('hrc_session_v2', JSON.stringify({ username: role, name: role, role: role, cloud: true }));
    D3.reload && D3.reload();
  }
  /* قرار المالك 2026-11-11: الحذف للمدير **وللموظف** — مطابقةً لسياسة
     jobs_staff_delete. الزائر المجهول يبقى مرفوضاً (tests/client-authz.mjs). */
  actAs('staff');
  const staffTry = jobExists ? D3.deleteJob('HRC-1047') : 'no-job';
  check('حذف الوظيفة متاح للموظف (قرار المالك)',
    typeof D3.deleteJob === 'function' && jobExists && staffTry === true,
    JSON.stringify({ jobExists, staffTry }));
}
check('الوظيفة HRC-1047 حُذفت نهائياً بقرار الموظف', !D3.getJob('HRC-1047'));
check('كل قرارات الرحلة موثقة بسجل التدقيق (' + D3.listAudit().length + ' قيداً)',
  D3.listAudit().some((l) => /توظيف/.test(l.action)) && D3.listAudit().some((l) => /رفض|إرجاع|حذف/.test(l.action)));

/* The removed sale wizard is not part of the current customer journey.
   Blank-card first application and failures are tested against SQL in
   card-validity.mjs and the real application UI in apply-flow.mjs. */
const DB6 = JSON.stringify(D3.db());

/* ═══ 7) صفحة التحقق: الموظف يفحص البطاقة — والزائر محجوب ═══════════════ */
step(7, 'صفحة التحقق — الموظف يفحص البطاقة من باركود QR والزائر محجوب');

const q = '?form=' + encodeURIComponent(SERIAL) + '&t=' + TOKEN;
const ver = await open('verify.html', q, { session: 'staff' });
injectFixture(ver.w.HRCStore,DB6);
ver.w.HRCVerify.mount(q);
await wait(250);
{
  const vtext = ver.doc.body.textContent;
  check('الاسم الكامل يظهر للموظف (بلا تقنيع)', vtext.includes('مرتضى كريم جبر الحلفاوي'));
  check('الرقم التسلسلي وحالة البطاقة ظاهران', vtext.includes(SERIAL) && /استُهلكت فرص البطاقة/.test(vtext));
  check('جدول الفرص يعرض وظيفتي البطاقة HRC-1043 و HRC-1042', vtext.includes('HRC-1043') && vtext.includes('HRC-1042'));
  check('باركود QR التحقق مرسوم في الصفحة', !!ver.doc.querySelector('#verify-root svg'));
  check('لا أخطاء في صفحة التحقق', ver.errors.length === 0, ver.errors[0]);
}

/* بصمة مزيفة: تحذير أمني */
const qf = '?form=' + encodeURIComponent(SERIAL) + '&t=deadbeef';
const fake = await open('verify.html', qf, { session: 'staff' });
injectFixture(fake.w.HRCStore,DB6);
fake.w.HRCVerify.mount(qf);
await wait(250);
check('تحذير التلاعب ظاهر للبصمة المزيفة', /تحذير أمني|غير مطابق/.test(fake.doc.body.textContent));

/* الزائر: بوابة تحجب أي بيانات */
const visitor = await open('verify.html', q);
injectFixture(visitor.w.HRCStore,DB6);
visitor.w.HRCVerify.mount(q);
await wait(250);
{
  const gate = visitor.doc.getElementById('verify-root').textContent;
  check('الزائر يرى بوابة «خاص بموظفي الشركة والإدارة»', /موظفي الشركة والإدارة/.test(gate));
  check('لا تسريب لأي بيانات بطاقة للزائر', !gate.includes(SERIAL) && !gate.includes('مرتضى كريم جبر') && !/الفرصة/.test(gate));
}

/* ═══ 8) إعادة طباعة البطاقة من الموقع العام (إثبات الحيازة) ═════════════ */
step(8, 'إعادة الطباعة — الزبون يعيد طباعة بطاقته بالباركود');

const pubCard = await open('index.html');
const P3C = pubCard.w.HRCStore;
injectFixture(P3C,DB6);
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
  check('زر إعادة طباعة الاستمارة ظاهر حتى بعد استنفاد الفرصتين', !!rp);
  if (rp) { click(pubCard.w, rp); await wait(250); }
}
{
  const box = lastModal(pubCard.doc);
  /* بعد إلغاء رموز الفرص: البطاقة بلا رمز تحقق → الطباعة بالباركود مباشرة */
  check('بطاقة بلا رمز تحقق: لا تطلب شاشة إعادة الطباعة أي رمز',
    !box.querySelector('#bk-rcode') && /لا حاجة لأي رمز/.test(box.textContent));
  check('لا يوجد زر طباعة البطاقة للزبون', !box.querySelector('#bk-print'));
}
check('عداد طباعة البطاقة لم يتغير', P3C.getApplicant(SERIAL).printedCount === printedBefore);

/* إعادة طباعة استمارة التوظيف A4 بنفس إثبات الحيازة (رمز الفرصة) */
{
  const box = lastModal(pubCard.doc);
  const pf = box.querySelector('#bk-print-form');
  check('زر «تحقق واطبع استمارة A4» ظاهر بإعادة الطباعة', !!pf);
  if (pf) click(pubCard.w, pf);
  await wait(450);
}
const formReprint = pubCard.doc.getElementById('print-root').innerHTML;
/* الاستمارة تعرض آخر تقديم (الفرصة الثانية على HRC-1042 هي الأحدث) */
check('إعادة طباعة استمارة A4 نجحت: الاسم وآخر وظيفة مقدَّم عليها',
  /استمارة توظيف/.test(formReprint) && formReprint.includes(SERIAL) &&
  formReprint.includes('مرتضى كريم جبر') && formReprint.includes('HRC-1042'));
check('استمارة A4 المعاد طباعتها لا تحمل أي رمز فرصة',
  !/رمز الفرصة/.test(formReprint) &&
  !CHANCES.map((c) => c && c.code).filter(Boolean).some((c) => formReprint.includes(c)));

/* ═══ 9) الملف المستقل: التحقق بالمسار الهاشي بجلسة موظف ═════════════════ */
step(9, 'الملف المستقل — التحقق بالمسار الهاشي والتنقل (بجلسة موظف)');

const solo = await open('hrc-standalone.html', '#!verify?form=' + encodeURIComponent(SERIAL) + '&t=' + TOKEN, { session: 'staff' });
injectFixture(solo.w.HRCStore,DB6);
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
console.log(fail ? '' : '\n  اكتملت فحوص رحلة الموظف والبطاقة ببيانات اختبار محلية.\n');
process.exit(fail ? 1 : 0);
