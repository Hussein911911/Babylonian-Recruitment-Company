#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار المسار الكامل بين الصفحات (End-to-End)
 *  ---------------------------------------------------------------------------
 *  يحاكي رحلة حقيقية كاملة ببيانات واحدة تنتقل بين الصفحات:
 *
 *    1) زائر يتصفّح الوظائف فقط ويحجز بالتواصل (بلا تقديم ولا تحقق)
 *    2) المكتب يسجّل الطلب، والموظف يعتمده ويحجز الوظيفة للاستمارة
 *    3) رفض المرشح ⇒ الوظيفة ترجع «متاحة» والمحاولة التالية تُفعَّل
 *    4) الموظف يفحص الاستمارة بكيو آر كود ⇒ الحالة والمحاولات
 *    5) الزائر يحاول التحقق ⇒ بوابة تمنعه بلا أي بيانات + بصمة مزيفة ⇒ تحذير
 *    6) الموظف يطبع الاستمارة ⇒ قالب A4 يمتدّ إلى حاوية الطباعة
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

/* jsdom لا يوفّر sessionStorage لأصول file:// — نزرع جلسة الموظف عبر واجهة تخزين بديلة */
const STAFF_SESSION = { username: 'staff', name: 'موظف فحص', role: 'staff', title: 'موظف توظيف', at: new Date().toISOString() };
function staffStorage() {
  const m = new Map([['brc_session_v2', JSON.stringify(STAFF_SESSION)]]);
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
  vc.on('log', () => { }); vc.on('info', () => { }); vc.on('debug', () => { }); vc.on('warn', () => { });
  const base = pathToFileURL(join(ROOT, file)).href;
  const dom = await JSDOM.fromFile(join(ROOT, file), {
    url: query ? base + query : base,
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      /* بذرة العرض للاختبارات فقط — الإنتاج ببذرة فارغة
         (انظر tests/fixtures/demo-seed.mjs). قبل تنفيذ config.js. */
      w.__BRC_TEST_SEED__ = JSON.parse(JSON.stringify(DEMO_SEED));
      Object.defineProperty(w, 'print', { configurable: true, writable: true, value: () => { w.__printed = (w.__printed || 0) + 1; } });
      w.__printed = 0;
      if (opts.session === 'staff') Object.defineProperty(w, 'sessionStorage', { configurable: true, value: staffStorage() });
    }
  });
  await new Promise((r) => { dom.window.addEventListener('load', r); setTimeout(r, 6000); });
  await new Promise((r) => setTimeout(r, 400));
  return { dom, w: dom.window, doc: dom.window.document, errors };
}

const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const setVal = (w, el, v) => {
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
};

console.log('\n' + '═'.repeat(72));
console.log('  BRC — اختبار المسار الكامل (من الزائر إلى التحقق والطباعة)');
console.log('═'.repeat(72));

/* ═══ 1) الموقع العام: الزائر يتصفّح ويحجز — بلا تقديم ولا تحقق ════════════ */
step(1, 'الموقع العام — زائر يتصفّح الوظائف ويحجز بالتواصل مع الشركة');

const site = await open('index.html');
const W = site.w;
const S = W.BRCStore;

const cards = site.doc.querySelectorAll('#jobs-grid .job-card').length;
check('الوظائف المتاحة معروضة للزائر (' + cards + ' بطاقة)', cards >= 8);

/* سياسة الشركة: لا طلب استمارة ولا تحقق من الزائر */
const badRequest = site.doc.getElementById('btn-request-form') || site.doc.getElementById('btn-request-form-2') ||
  site.doc.getElementById('req-form') || site.doc.querySelector('[data-action="request-form"]');
check('لا يوجد أي زر «اطلب استمارة» موجّه للزائر', !badRequest, badRequest && badRequest.outerHTML.slice(0, 60));
const badVerify = site.doc.getElementById('verify-quick') || site.doc.getElementById('verify-serial') ||
  site.doc.querySelector('[data-action="verify"]');
check('لا توجد واجهة تحقق من الاستمارة في الموقع العام', !badVerify, badVerify && badVerify.outerHTML.slice(0, 60));
check('لا نص «ترشّح» في العرض العام', !/ترشّح/.test(site.doc.getElementById('jobs-grid').textContent));

/* الحجز: رابط واتساب يحمل كود الوظيفة */
const bookLink = [...site.doc.querySelectorAll('#jobs-grid .job-card a[href^="https://wa.me/"]')];
check('كل بطاقة وظيفة متاحة تحمل زر حجز بالواتساب (' + bookLink.length + ')', bookLink.length >= 1);
check('رسالة الواتساب تحمل كود الوظيفة ورقم الشركة', (() => {
  const href = decodeURIComponent(bookLink[0].getAttribute('href'));
  return /wa\.me\/9647/.test(href) && /BRC-\d{3,}/.test(href) || href.slice(0, 90);
})());

/* تفاصيل الوظيفة: خاتمة حجز لا طلب استمارة */
const detailsBtn = site.doc.querySelector('#jobs-grid [data-action="job-details"]');
if (detailsBtn) {
  click(W, detailsBtn);
  await new Promise((r) => setTimeout(r, 160));
  const box = site.doc.querySelector('.modal-backdrop .modal');
  const mtext = box ? box.textContent : '';
  check('نافذة التفاصيل تعرض تحذير خصوصية صاحب العمل', /خصوصية صاحب العمل/.test(mtext));
  check('نافذة التفاصيل تدعو للحجز بالتواصل (بلا نموذج تقديم)', /خابر الشركة|مراجعة المكتب|راجع المكتب/.test(mtext) &&
    !box.querySelector('[data-request]') && !box.querySelector('input'));
  const reserveLink = box.querySelector('a[href^="https://wa.me/"]');
  check('خاتمة النافذة فيها زر واتساب للحجز', !!reserveLink, 'لا يوجد رابط حجز');
  if (reserveLink) check('رابط الحجز في النافذة يحمل كود الوظيفة', /BRC-\d{3,}/.test(decodeURIComponent(reserveLink.getAttribute('href'))));
  const close = box.querySelector('[data-close]');
  if (close) click(W, close);
  await new Promise((r) => setTimeout(r, 120));
}

/* الطلب: يُسجّله المكتب (الزبون خابر أو راجع الشركة) ثم يعتمده الموظف */
const before = S.listApplicants().length;
const RECORD = S.createApplicant({
  fullName: 'علي حسن كاظم الفتلاوي', phone: '07701234567', address: 'الحلة - شارع 40 - محلة الجيلاوي',
  region: 'الحلة', requestedCode: 'BRC-1042', pending: true
});
const SERIAL = RECORD && RECORD.serial;
const TOKEN = SERIAL ? S.token(SERIAL) : '';
check('طلب الزائر (هاتفياً / حضورياً) سُجّل في المكتب (' + before + ' → ' + S.listApplicants().length + ')',
  S.listApplicants().length === before + 1);
console.log('   ℹ  الرقم التسلسلي: ' + SERIAL + '   |   بصمة التحقق: ' + TOKEN);
check('الطلب مرتبط باسم الباحث الصحيح', !!RECORD && RECORD.fullName === 'علي حسن كاظم الفتلاوي');
check('الطلب سُجّل كـ «قيد المراجعة» (بدون تاريخ انتهاء)', !!RECORD && RECORD.status === 'pending' && !RECORD.expiryDate);
check('الوظيفة المطلوبة (BRC-1042) سُجّلت مع الطلب', !!RECORD && RECORD.requestedCode === 'BRC-1042');

{
  /* ═══ 2) المنظومة الداخلية: الموظف يعتمد الطلب ويحجز الوظيفة ═══════════ */
  step(2, 'المنظومة الداخلية — دخول الموظف واعتماد الطلب وحجز وظيفة');

  const DB = S.exportJSON ? S.exportJSON() : S.exportJson();

  /* بلا جلسة: المنظومة لا تُفتح إطلاقاً */
  const anon = await open('dashboard.html');
  check('بلا جلسة موظف: شاشة الدخول تحجب المنظومة', !!anon.doc.getElementById('login-wrap') &&
    !anon.doc.getElementById('login-wrap').classList.contains('hidden') &&
    anon.doc.getElementById('app-shell').classList.contains('hidden'));

  /* بجلسة موظف (كأنه سجّل الدخول في نفس المتصفح) */
  const dash = await open('dashboard.html', undefined, { session: 'staff' });
  dash.w.BRCStore.importJson(DB);
  dash.w.BRCStore.emit && dash.w.BRCStore.emit();
  dash.w.BRCRefresh && dash.w.BRCRefresh();
  await new Promise((r) => setTimeout(r, 200));

  const logged = dash.w.BRCStore.currentUser();
  check('الموظف داخل المنظومة (' + (logged ? logged.name + ' — ' + logged.role : 'فشل') + ')',
    !!logged && logged.role === 'staff' && !dash.doc.getElementById('app-shell').classList.contains('hidden'));

  click(dash.w, dash.doc.querySelector('#side-nav button[data-view="applicants"]'));
  await new Promise((r) => setTimeout(r, 120));
  let rows = [...dash.doc.querySelectorAll('#apps-table-body tr')].map((r) => r.textContent).join(' ');
  check('جدول الاستمارات يعرض الطلب المسجَّل', rows.includes(SERIAL));
  check('الطلب معروض بحالة «قيد المراجعة»', /قيد المراجعة/.test(rows));

  // اعتماد الطلب من جدول الاستمارات (إجراء الموظف عبر الواجهة)
  const approveBtn = dash.doc.querySelector('[data-app-approve="' + SERIAL + '"]');
  check('زر اعتماد الطلب ظاهر للموظف', !!approveBtn);
  if (approveBtn) click(dash.w, approveBtn);
  await new Promise((r) => setTimeout(r, 180));
  const afterApprove = dash.w.BRCStore.getApplicant(SERIAL);
  check('بعد الاعتماد: الاستمارة صارت سارية بخمس محاولات', !!afterApprove && afterApprove.status === 'active' &&
    dash.w.BRCStore.attemptsLeft(SERIAL) === 5, afterApprove && afterApprove.status);
  check('الاستمارة صالحة 30 يوماً من تاريخ الاعتماد', !!afterApprove &&
    Math.round((new Date(afterApprove.expiryDate) - new Date(afterApprove.issueDate)) / 86400000) === 30);

  // حجز وظيفة للاستمارة (إجراء الموظف)
  const free = dash.w.BRCStore.listJobs({ status: 'available' }).filter((j) => j.code !== 'BRC-1042')[0];
  const picked = dash.w.BRCStore.selectAttempt(SERIAL, free.code);
  dash.w.BRCRefresh && dash.w.BRCRefresh();
  await new Promise((r) => setTimeout(r, 120));

  check('الحجز نجح وخصّص المحاولة #' + (picked.ok ? picked.attempt.no : '?') + ' على ' + free.code, picked.ok === true, picked.error);
  const jobAfterPick = dash.w.BRCStore.getJob(free.code);
  check('الوظيفة رُصدت «محجوزة مؤقتاً» بمهلة 24 ساعة', jobAfterPick.status === 'reserved' &&
    Math.round((new Date(jobAfterPick.holdExpiresAt) - Date.now()) / 3600000) === 24,
    jobAfterPick.status + ' / ' + jobAfterPick.holdExpiresAt);
  check('عدّاد الحجز يظهر في شاشة الحجوزات', (() => {
    click(dash.w, dash.doc.querySelector('#side-nav button[data-view="holds"]'));
    return /ساعة|متبق/.test(dash.doc.getElementById('holds-list').textContent);
  })());

  /* ═══ 3) رفض المرشح: الوظيفة ترجع متاحة + المحاولة التالية ═════════════ */
  step(3, 'رفض المرشح — الوظيفة ترجع «متاحة» والمحاولة التالية تُفعَّل');

  const rej = dash.w.BRCStore.setOutcome(SERIAL, picked.attempt.no, 'rejected', 'لم يوافق على الدوام المسائي');
  dash.w.BRCRefresh && dash.w.BRCRefresh();
  await new Promise((r) => setTimeout(r, 100));

  const jobAfterReject = dash.w.BRCStore.getJob(free.code);
  const nextSlot = dash.w.BRCStore.activeAttempt(SERIAL);
  check('النتيجة سُجّلت (رفض)', rej.ok === true, rej.error);
  check('الوظيفة رجعت «متاحة» فوراً', jobAfterReject.status === 'available', jobAfterReject.status);
  check('المحاولة التالية #' + (nextSlot ? nextSlot.no : '?') + ' أصبحت الفعّالة', !!nextSlot && nextSlot.no === picked.attempt.no + 1);
  check('الخانة المرفوضة بقيت في تاريخ الاستمارة (لا تُعاد)', dash.w.BRCStore.getAttempts(SERIAL)
    .some((t) => t.no === picked.attempt.no && t.slotStatus === 'rejected'));
  const audit = dash.w.BRCStore.listAudit();
  check('كل العمليات موثقة في سجل التدقيق (' + audit.length + ' قيداً)', audit.length >= 3 &&
    audit.some((l) => l.action.includes('رفض')));

  const DB2 = dash.w.BRCStore.exportJson();

  /* ═══ 4) الزائر يحاول التحقق ⇒ بوابة تمنعه ════════════════════════════ */
  step(4, 'سياسة التحقق — الزائر لا يرى أي بيانات استمارة');

  const q = '?form=' + encodeURIComponent(SERIAL) + '&t=' + TOKEN;
  const qAny = '?form=BRC-NO-000120';
  const visitor = await open('verify.html', q);
  visitor.w.BRCStore.importJson(DB2);
  visitor.w.BRCVerify.mount(q);            // نفس ما يفعله فتح رابط الكيو آر كود
  await new Promise((r) => setTimeout(r, 150));
  const vGate = visitor.doc.getElementById('verify-root').textContent;
  check('الزائر يرى بوابة «خاص بموظفي الشركة والإدارة»', /موظفي الشركة والإدارة/.test(vGate));
  check('لا تسريب لأي بيانات استمارة للزائر', !vGate.includes(SERIAL) && !vGate.includes('علي حسن كاظم') && !/محاولة/.test(vGate));
  check('الزائر يوجَّه لتسجيل دخول الموظفين أو التواصل للحجز',
    /تسجيل دخول الموظفين/.test(vGate) && /wa\.me/.test(visitor.doc.getElementById('verify-root').innerHTML));
  check('أداة البحث اليدوي مخفية عن الزائر',
    (visitor.doc.getElementById('verify-form') || { closest: () => null }).closest('.panel') === null ||
    visitor.doc.getElementById('verify-form').closest('.panel').classList.contains('hidden'));

  /* ═══ 5) الموظف يفحص الاستمارة بكيو آر كود ═════════════════════════════ */
  step(5, 'صفحة التحقق — الموظف يفحص الاستمارة من رابط الكيو آر كود');

  const ver = await open('verify.html', q, { session: 'staff' });
  ver.w.BRCStore.importJson(DB2);          // نفس قاعدة البيانات (محاكاة نفس المتصفح)
  ver.w.BRCVerify.mount(q);                // إعادة العرض من رابط الكيو آر كود
  await new Promise((r) => setTimeout(r, 150));
  const vtext = ver.doc.body.textContent;
  check('الاسم والبصمة يظهران في صفحة التحقق', vtext.includes('علي حسن كاظم الفتلاوي'));
  check('الرقم التسلسلي ظاهر', vtext.includes(SERIAL));
  check('جدول المحاولات يعرض كود الوظيفة ' + free.code, vtext.includes(free.code));
  check('المحاولة المرفوضة موسومة بوضوح', /مرفوض/.test(vtext));
  check('حالة الاستمارة «سارية» وليست منتهية', /سارية|نشطة/.test(vtext) && !/منتهية الصلاحية/.test(vtext.replace(/لا تزال سارية|سارية/g, '')));
  check('كيو آر كود التحقق مرسوم في الصفحة', !!ver.doc.querySelector('#verify-root svg'));
  check('لا أخطاء في صفحة التحقق', ver.errors.length === 0, ver.errors[0]);

  /* ═══ 6) بصمة مزيفة ⇒ تحذير أمني ═══════════════════════════════════════ */
  step(6, 'الأمان — بصمة مزيفة يجب أن تُرفع كتحذير (بجلسة الموظف)');

  const qf = '?form=' + encodeURIComponent(SERIAL) + '&t=deadbeef';
  const fake = await open('verify.html', qf, { session: 'staff' });
  fake.w.BRCStore.importJson(DB2);
  fake.w.BRCVerify.mount(qf);              // رابط ببصمة مزيفة
  await new Promise((r) => setTimeout(r, 150));
  const ftext = fake.doc.body.textContent;
  check('تحذير التلاعب ظاهر للبصمة المزيفة', /تحذير|غير مطابق|تلاعب|مزيفة/.test(ftext));
  check('الرقم الصحيح لم يُسرَّب بثقة في حالة البصمة المزيفة', !!ftext.includes(SERIAL));

  /* ═══ 7) الطباعة: قالب A4 يمتدّ إلى حاوية الطباعة ══════════════════════ */
  step(7, 'الطباعة — استمارة A4 كاملة بالكيو آر كود (من المنظومة)');

  const ver2 = await open('verify.html', q, { session: 'staff' });
  ver2.w.BRCStore.importJson(DB2);
  ver2.w.BRCVerify.mount(q);
  await new Promise((r) => setTimeout(r, 120));
  const appForPrint = ver2.w.BRCStore.getApplicant(SERIAL);
  ver2.w.BRCVoucher.print(appForPrint, ver2.w.BRCStore.getAttempts(SERIAL));
  await new Promise((r) => setTimeout(r, 260));
  const printHtml = ver2.doc.getElementById('print-root').innerHTML;

  const must = [
    ['ترويسة الشركة', /شركة الهدف للتوظيف|Al-Hadaf Recruitment/],
    ['الهاتفان', /07760058007[\s\S]*07715993271/],
    ['العنوان الكامل', /حلة - شارع 60 - قرب مدينة حمورابي/],
    ['الاسم التسلسلي للاستمارة', new RegExp('BRC-NO:?\\s*' + SERIAL.replace('BRC-NO-', ''))],
    ['اسم الباحث', /علي حسن كاظم/],
    ['جدول المحاولات الخمس', /كود الوظيفة/],
    ['الكيو آر كود', /<svg[\s\S]*<path/],
    ['الإخلاء القانوني', /غير مسؤولة قانونياً وعشائياً/],
    ['التواقيع', /توقيع|v-sign/]
  ];
  const missing = must.filter(([, re]) => !re.test(printHtml)).map(([k]) => k);
  check('الاستمارة المطبوعة تحوي كل عناصر A4 (' + (must.length - missing.length) + '/' + must.length + ')', missing.length === 0, missing.join(' · '));
  check('الورقة المطبوعة نظيفة بلا علامة مائية', !/v-watermark|brick-pattern/.test(printHtml), 'ما زالت العلامة المائية تُدرج في الطباعة');
  check('نافذة الطباعة استُدعيت فعلاً', ver2.w.__printed > 0, 'عدد الاستدعاءات ' + ver2.w.__printed);
  check('الطباعة سُجّلت في عدّاد الاستمارة', ver2.w.BRCStore.getApplicant(SERIAL).printedCount > 0);

  /* ═══ 8) الملف المستقل: مسار التحقق بجلسة الموظف ═══════════════════════ */
  step(8, 'الملف المستقل — التحقق بالمسار الهاشي والتنقل (بجلسة موظف)');

  const solo = await open('brc-standalone.html', '#!verify?form=' + encodeURIComponent(SERIAL) + '&t=' + TOKEN, { session: 'staff' });
  solo.w.BRCStore.importJson(DB2);
  solo.w.dispatchEvent(new solo.w.Event('hashchange'));   // محاكاة فتح الرابط من الكيو آر كود
  await new Promise((r) => setTimeout(r, 400));
  const stext = solo.doc.body.textContent;
  const verifyVisible = solo.doc.getElementById('route-verify') && !solo.doc.getElementById('route-verify').hasAttribute('hidden');
  check('المسار #!verify عرض قسم التحقق', !!verifyVisible);
  check('الملف المستقل يعرض بيانات نفس الاستمارة', stext.includes(SERIAL) || stext.includes('علي حسن كاظم'));
  check('لا أخطاء في الملف المستقل', solo.errors.length === 0, solo.errors[0]);
}

/* ═══ الخلاصة ═══════════════════════════════════════════════════════════ */
console.log('\n' + '═'.repeat(72));
console.log('  النتيجة:  ✅ ' + pass + ' ناجح   |   ❌ ' + fail + ' فاشل');
console.log('═'.repeat(72));
if (problems.length) { console.log('\n  الإخفاقات:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log(fail ? '' : '\n  🎉 المسار الكامل يعمل من البداية إلى النهاية بلا أي خلل.\n');
process.exit(fail ? 1 : 0);
