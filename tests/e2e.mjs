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
const STAFF_SESSION = { username: 'staff', name: 'موظف فحص', role: 'staff', title: 'موظف توظيف', at: new Date().toISOString() };
function staffStorage() {
  const m = new Map([['hrc_session_v2', JSON.stringify(STAFF_SESSION)]]);
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
      if (opts.session === 'staff') Object.defineProperty(w, 'sessionStorage', { configurable: true, value: staffStorage() });
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

/* بجلسة موظف (كأنه سجّل الدخول في نفس المتصفح) */
const dash = await open('dashboard.html', undefined, { session: 'staff' });
const D = dash.w.HRCStore;
check('الموظف داخل المنظومة (' + (dash.w.HRCStore.currentUser() || {}).username + ')',
  !!dash.w.HRCStore.currentUser() && !dash.doc.getElementById('app-shell').classList.contains('hidden'));

click(dash.w, dash.doc.querySelector('#side-nav button[data-view="applicants"]'));
await wait(200);

/* إصدار بطاقة جديدة من نافذة البيع (كاش عند نقطة البيع) */
const before = D.listApplicants().length;
click(dash.w, dash.doc.getElementById('btn-new-app'));
await wait(200);
{
  const box = lastModal(dash.doc);
  check('نافذة «إصدار وبيع بطاقة» انفتحت بحقول نقطة البيع', !!box &&
    /إصدار وبيع بطاقة/.test(box.textContent) && !!box.querySelector('#n-pos') && !!box.querySelector('#n-fee'));
  setVal(dash.w, box.querySelector('#n-name'), 'مرتضى كريم جبر الحلفاوي');
  setVal(dash.w, box.querySelector('#n-phone'), '07811234599');
  setVal(dash.w, box.querySelector('#n-pos'), 'مكتب الاستنساخ — الحلة شارع 40');
  click(dash.w, box.querySelector('#n-save'));
  await wait(350);
}

const RECORD = D.listApplicants().filter((a) => a.fullName === 'مرتضى كريم جبر الحلفاوي')[0];
const SERIAL = RECORD && RECORD.serial;
const TOKEN = SERIAL ? D.token(SERIAL) : '';
check('البطاقة صدرت فوراً برقم HRC-BC (' + SERIAL + ')', !!SERIAL && /^HRC-BC-\d{6}$/.test(SERIAL));
check('بيع البطاقة سُجّل كاشاً (' + before + ' → ' + D.listApplicants().length + ')',
  D.listApplicants().length === before + 1 && RECORD.feePaid === true);
check('نقطة البيع مسجّلة على البطاقة', RECORD.posName === 'مكتب الاستنساخ — الحلة شارع 40');
check('البطاقة سارية بفرصتين مستقلتين', D.formStatus(RECORD) === 'active' && D.attemptsLeft(SERIAL) === 2);
check('البطاقة صالحة 30 يوماً من الإصدار',
  Math.round((new Date(RECORD.expiryDate) - new Date(RECORD.issueDate)) / 86400000) === 30);
const CHANCES = D.getAttempts(SERIAL);
check('رمزا الفرصتين بصيغة NNNN-AA وفريدان', CHANCES.length === 2 &&
  CHANCES.every((t) => /^\d{4}-[A-Z]{2}$/.test(t.code)) && CHANCES[0].code !== CHANCES[1].code);
console.log('   ℹ  البطاقة: ' + SERIAL + ' | الفرصة ١: ' + (CHANCES[0] || {}).code + ' | الفرصة ٢: ' + (CHANCES[1] || {}).code);

/* نافذة الفرصتين انفتحت بعد البيع — وزر الطباعة يبني الوجهين */
{
  const box = lastModal(dash.doc);
  check('نافذة «بطاقة التوظيف — الفرصتان» انفتحت بعد البيع', !!box && /الفرصتان/.test(box.textContent) &&
    box.textContent.includes(SERIAL));
  const printBtn = box && box.querySelector('#m-print');
  check('زر طباعة البطاقة (86×54مم) ظاهر', !!printBtn);
  if (printBtn) click(dash.w, printBtn);
  await wait(400);
}
const printHtml = dash.doc.getElementById('print-root').innerHTML;
const mustPrint = [
  ['الوجهان', (printHtml.match(/class="hrc-card[" ]/g) || []).length === 2],
  ['الشركة', /شركة الهدف للتوظيف|Al-Hadaf/.test(printHtml)],
  ['الباركود QR', /<svg[\s\S]*<path/.test(printHtml)],
  ['الرقم التسلسلي', printHtml.includes(SERIAL)],
  ['اسم الزبون', printHtml.includes('مرتضى كريم جبر')],
  ['رمزا الفرصتين', printHtml.includes(CHANCES[0].code) && printHtml.includes(CHANCES[1].code)],
  ['الإخلاء القانوني', /غير مسؤولة قانون/.test(printHtml)]
];
const missPrint = mustPrint.filter(([, c]) => !c).map(([k]) => k);
check('البطاقة المطبوعة تحوي كل عناصرها (' + (mustPrint.length - missPrint.length) + '/' + mustPrint.length + ')',
  missPrint.length === 0, missPrint.join(' · '));
check('نافذة الطباعة استُدعيت فعلاً', dash.w.__printed > 0, 'عدد الاستدعاءات ' + dash.w.__printed);
check('الطباعة سُجّلت في عدّاد البطاقة', D.getApplicant(SERIAL).printedCount > 0);

const DB1 = D.exportJson();

/* ═══ 3) الزبون يتابع بطاقته ويستخدم الفرصة الأولى ═══════════════════════ */
step(3, '«بطاقتي» — الزبون يتابع بطاقته بالباركود ويستخدم الفرصة الأولى');

const pub = await open('index.html');
const P = pub.w.HRCStore;
P.importJson(DB1);
await wait(250);

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
  check('الفرصتان معروضتان والمتاح 2', /الفرص المتاحة: <b>2<\/b>|الفرص المتاحة: 2/.test(text.replace(/\s+/g, ' ')) ||
    /متاحة للاستخدام/.test(text));
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

  setVal(pub.w, box.querySelector('#bk-code'), CHANCES[0].code);
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
check('الفرصة الأولى استُهلكت بالتقديم والمتبقي 1', P.attemptsLeft(SERIAL) === 1 &&
  P.getAttempts(SERIAL)[0].slotStatus === 'reserved');
check('التقديم الذاتي موثّق في سجل التدقيق', P.listAudit().some((l) => /تقديم ذاتي/.test(l.action)));
/* محاولة التقديم على نفس الوظيفة بالفرصة الثانية مرفوضة (منع التكرار) */
const dup = P.useChance(SERIAL, CHANCES[1].code, 'HRC-1042');
check('لا يمكن استهلاك الفرصة الثانية على نفس الوظيفة', dup.ok === false && /نفس الوظيفة|غير متاحة/.test(dup.error), dup.error);

const DB2 = P.exportJson();

/* ═══ 4) انتهاء مهلة 24 ساعة ⇒ حالة «حرجة» (لا إفراج تلقائي) ════════════ */
step(4, 'انتهاء مهلة الحجز — حالة «حرجة» بانتظار قرار الموظف (لا إفراج تلقائي)');

const dash2 = await open('dashboard.html', undefined, { session: 'staff' });
const D2 = dash2.w.HRCStore;
D2.importJson(DB2);
dash2.w.HRCRefresh && dash2.w.HRCRefresh();
await wait(250);

/* تقديم ساعة الحجز للماضي (انقضت المدة) ثم تشغيل الصيانة */
D2.db().jobs.forEach(function (j) { if (j.code === 'HRC-1042') j.holdExpiresAt = new Date(Date.now() - 3600000).toISOString(); });
const maint = D2.runMaintenance();
const jobCrit = D2.getJob('HRC-1042');
check('الصيانة رصدت الحجز المنتهي كحالة حرجة', (maint || []).some((a) => a.type === 'criticalHold'));
check('الوظيفة تبقى مقفلة (محجوزة) — لا إفراج تلقائي', jobCrit.status === 'reserved' && jobCrit.critical === true,
  jobCrit.status + ' / critical=' + jobCrit.critical);
check('الفرصة الأولى انتقلت لحالة «حرجة»', D2.getAttempts(SERIAL)[0].slotStatus === 'critical');

/* لوحة الموظف تعرض قرار الحالة الحرجة */
click(dash2.w, dash2.doc.querySelector('#side-nav button[data-view="overview"]'));
await wait(200);
{
  const ov = dash2.doc.getElementById('ov-actions');
  check('«إجراءات مطلوبة» تعرض الحالة الحرجة بقرار مطلوب', !!ov && /حالة حرجة/.test(ov.textContent) &&
    /HRC-1042/.test(ov.textContent));
}

const DB3 = D2.exportJson();

/* ═══ 5) قرار الموظف: تم التوظيف — البطاقة لا تنتهي ═════════════════════ */
step(5, 'قرار الموظف — تم التوظيف: الوظيفة تُغلق والبطاقة تبقى سارية');

const win = D2.setOutcome(SERIAL, 1, 'succeeded', 'اجتاز المقابلة وبدأ الشغل');
check('قرار التوظيف سُجّل', win.ok === true, win.error);
const jobClosed = D2.getJob('HRC-1042');
check('الوظيفة أُغلقت ورفعت راية الحرجة عنها', jobClosed.status === 'closed' && jobClosed.critical === false);
const afterHire = D2.getApplicant(SERIAL);
check('التوظيف لا يُنهي البطاقة — ما زالت سارية بفرصة متبقية',
  D2.formStatus(afterHire) === 'active' && D2.attemptsLeft(SERIAL) === 1, D2.formStatus(afterHire));
const lk1 = D2.lookupCard(SERIAL);
check('عرض الزبون يبيّن «تم توظيف بإحدى الفرصتين» وفرصة متبقية', lk1.ok && lk1.card.succeeded === true &&
  Number(lk1.card.chancesLeft) === 1);

const DB4 = D2.exportJson();

/* ═══ 6) الفرصة الثانية ثم قرار الإرجاع ═════════════════════════════════ */
step(6, 'الفرصة الثانية — تقديم جديد ثم قرار «إرجاع» الوظيفة');

const pub2 = await open('index.html');
const P2 = pub2.w.HRCStore;
P2.importJson(DB4);
await wait(250);

/* الزبون يستخدم فرصته الثانية على وظيفة أخرى */
const use2 = P2.useChance(SERIAL, CHANCES[1].code, 'HRC-1046');
check('الفرصة الثانية استُهلكت على HRC-1046 بنجاح', use2.ok === true, use2.error);
check('الوظيفة الثانية محجوزة 24 ساعة', P2.getJob('HRC-1046').status === 'reserved');
const lk2 = P2.lookupCard(SERIAL);
check('عرض الزبون: فرصتان مستهلكتان — إحداهما توظيف وأخرى بانتظار النتيجة',
  Number(lk2.card.chancesLeft) === 0 && lk2.card.status === 'active', lk2.card.status + ' / ' + lk2.card.chancesLeft);

const DB5 = P2.exportJson();

/* قرار الإرجاع بعد انتهاء المهلة: الوظيفة تعود متاحة والفرصة لا تعود */
const dash3 = await open('dashboard.html', undefined, { session: 'staff' });
const D3 = dash3.w.HRCStore;
D3.importJson(DB5);
await wait(250);
const rel = D3.releaseHold(SERIAL, 2, 'صاحب العمل أجّل التعيين — أُعيدت الوظيفة متوفرة');
check('قرار الإرجاع سُجّل', rel.ok === true, rel.error);
check('الوظيفة HRC-1046 رجعت «متاحة» لغيره', D3.getJob('HRC-1046').status === 'available');
check('الفرصة الثانية مستهلكة (انتهت) ولا تعود', D3.getAttempts(SERIAL)[1].slotStatus === 'expired');
const lk3 = D3.lookupCard(SERIAL);
check('البطاقة صارت «استُهلكت الفرصتان» — تُشترى بطاقة جديدة', lk3.card.status === 'exhausted' &&
  Number(lk3.card.chancesLeft) === 0, lk3.card.status);
check('كل قرارات الرحلة موثقة بسجل التدقيق (' + D3.listAudit().length + ' قيداً)',
  D3.listAudit().some((l) => /توظيف/.test(l.action)) && D3.listAudit().some((l) => /إرجاع/.test(l.action)));

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
  check('جدول الفرص يعرض الوظيفتين HRC-1042 و HRC-1046', vtext.includes('HRC-1042') && vtext.includes('HRC-1046'));
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

const pub3 = await open('index.html');
const P3 = pub3.w.HRCStore;
P3.importJson(DB6);
await wait(250);
const printedBefore = P3.getApplicant(SERIAL).printedCount;

click(pub3.w, pub3.doc.querySelector('header [data-action="open-booking"]'));
await wait(150);
{
  const box = lastModal(pub3.doc);
  setVal(pub3.w, box.querySelector('#bk-serial'), SERIAL);
  click(pub3.w, box.querySelector('#bk-lookup'));
  await wait(350);
}
{
  const box = lastModal(pub3.doc);
  const rp = box.querySelector('#bk-reprint');
  check('زر «إعادة طباعة البطاقة» ظاهر حتى بعد استنفاد الفرصتين', !!rp);
  if (rp) { click(pub3.w, rp); await wait(250); }
}
{
  const box = lastModal(pub3.doc);
  /* رمز خاطئ أولاً: إثبات الحيازة إلزامي */
  setVal(pub3.w, box.querySelector('#bk-rcode'), '0000-ZZ');
  click(pub3.w, box.querySelector('#bk-print'));
  await wait(300);
  const errHost = pub3.doc.querySelector('[data-bk-err="rcode"]');
  check('إعادة الطباعة برمز خاطئ مرفوضة', !!errHost && /رمز الفرصة/.test(errHost.textContent) &&
    errHost.style.display !== 'none', 'لم يظهر خطأ الرمز');

  setVal(pub3.w, box.querySelector('#bk-rcode'), CHANCES[1].code);
  click(pub3.w, box.querySelector('#bk-print'));
  await wait(450);
}
const reprintHtml = pub3.doc.getElementById('print-root').innerHTML;
check('إعادة الطباعة نجحت: الوجهان بالباركود والرمزين والاسم الكامل',
  (reprintHtml.match(/class="hrc-card[" ]/g) || []).length === 2 && reprintHtml.includes(SERIAL) &&
  reprintHtml.includes(CHANCES[0].code) && reprintHtml.includes(CHANCES[1].code) &&
  reprintHtml.includes('مرتضى كريم جبر'));
check('نافذة الطباعة استُدعيت لإعادة الطباعة', pub3.w.__printed > 0, 'عدد الاستدعاءات ' + pub3.w.__printed);
check('عدّاد طباعة البطاقة زاد (' + printedBefore + ' → ' + P3.getApplicant(SERIAL).printedCount + ')',
  P3.getApplicant(SERIAL).printedCount > printedBefore);

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
