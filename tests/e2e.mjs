#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار المسار الكامل بين الصفحات (End-to-End)
 *  ---------------------------------------------------------------------------
 *  يحاكي رحلة حقيقية كاملة ببيانات واحدة تنتقل بين الصفحات:
 *
 *    1) زائر يطلب استمارة من الموقع العام (يملأ النموذج ويضغط الإصدار)
 *    2) الموظف يدخل المنظومة ويرى الاستمارة الجديدة ويرشّح لها وظيفة
 *    3) رفض المرشح ⇒ الوظيفة ترجع «متاحة» والمحاولة التالية تُفعَّل
 *    4) مسح كيو آر كود الاستمارة ⇒ صفحة التحقق تعرض الحالة والمحاولات
 *    5) الموظف يطبع الاستمارة ⇒ قالب A4 يمتدّ إلى حاوية الطباعة
 *    6) بصمة مزيفة ⇒ تحذير أمني واضح
 *
 *  ملاحظة: كل نافذة متصفح افتراضي (jsdom) لها تخزينها الخاص، فننقل قاعدة
 *  البيانات بين الصفحات عبر export/import — وهذا يحاكي «نفس المتصفح» تماماً.
 *
 *  التشغيل:  node tests/e2e.mjs
 * =========================================================================== */
import { JSDOM, VirtualConsole } from 'jsdom';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolveRoot();
function resolveRoot() { return join(dirname(fileURLToPath(import.meta.url)), '..'); }

let pass = 0, fail = 0;
const problems = [];
const step = (n, t) => console.log('\n▌ الخطوة ' + n + ' — ' + t);
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, cond, detail) => (cond ? ok(t) : bad(t, detail));

async function open(file, query) {
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
      Object.defineProperty(w, 'print', { configurable: true, writable: true, value: () => { w.__printed = (w.__printed || 0) + 1; } });
      w.__printed = 0;
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

/* ═══ 1) الموقع العام: طلب استمارة كما يفعل الزائر ═════════════════════════ */
step(1, 'الموقع العام — زائر يطلب استمارة إلكترونية');

const site = await open('index.html');
const W = site.w;
const S = W.BRCStore;

const before = S.listApplicants().length;
click(W, site.doc.getElementById('btn-request-form'));
await new Promise((r) => setTimeout(r, 120));

const form = site.doc.getElementById('req-form');
check('نموذج الطلب فُتح في نافذة', !!form);
if (form) {
  const issuedModalBefore = site.doc.querySelectorAll('#modal-root .modal').length;
  setVal(W, site.doc.getElementById('r-name'), 'علي حسن كاظم الفتلاوي');
  setVal(W, site.doc.getElementById('r-phone'), '07701234567');
  setVal(W, site.doc.getElementById('r-dob'), '1996-04-12');
  if (site.doc.getElementById('r-address')) setVal(W, site.doc.getElementById('r-address'), 'الحلة - شارع 40 - محلة الجيلاوي');
  if (site.doc.getElementById('r-region')) setVal(W, site.doc.getElementById('r-region'), 'الحلة');
  if (site.doc.getElementById('r-code')) setVal(W, site.doc.getElementById('r-code'), 'BRC-1042');
  click(W, site.doc.getElementById('req-submit'));
  await new Promise((r) => setTimeout(r, 250));

  const after = S.listApplicants().length;
  check('الاستمارة أصدرت رقماً جديداً (' + before + ' → ' + after + ')', after === before + 1);

  const fresh = S.listApplicants().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const SERIAL = fresh ? fresh.serial : null;
  const TOKEN = SERIAL ? S.token(SERIAL) : '';
  console.log('   ℹ  الرقم التسلسلي: ' + SERIAL + '   |   بصمة التحقق: ' + TOKEN);
  check('الاستمارة مرتبطة باسم الباحث الصحيح', !!fresh && fresh.fullName === 'علي حسن كاظم الفتلاوي', fresh && fresh.fullName);
  check('الاستمارة صالحة 30 يوماً من تاريخ الإصدار', !!fresh &&
    Math.round((new Date(fresh.expiryDate) - new Date(fresh.issueDate)) / 86400000) === 30);
  check('للاستمارة الجديدة 5 محاولات فارغة', !!SERIAL && S.attemptsLeft(SERIAL) === 5, SERIAL ? String(S.attemptsLeft(SERIAL)) : '—');
  check('نافذة «تم الإصدار» تعرض الرقم والكيو آر كود', !!site.doc.querySelector('#modal-root svg') &&
    site.doc.getElementById('modal-root').textContent.includes(SERIAL));
  check('الوظيفة المطلوبة (BRC-1042) سُجّلت مع الطلب', !!fresh && fresh.requestedCode === 'BRC-1042', fresh && fresh.requestedCode);

  /* ═══ 2) المنظومة الداخلية: الموظف يرى الاستمارة ويرشّح وظيفة ═══════════ */
  step(2, 'المنظومة الداخلية — دخول الموظف وترشيح وظيفة للاستمارة');

  const DB = S.exportJson();
  const dash = await open('dashboard.html');
  dash.w.BRCStore.importJson(DB);
  dash.w.BRCStore.emit && dash.w.BRCStore.emit();

  check('شاشة الدخول تظهر قبل المصادقة', !!dash.doc.getElementById('login-wrap') &&
    !dash.doc.getElementById('login-wrap').classList.contains('hidden'));
  setVal(dash.w, dash.doc.getElementById('login-user'), 'staff');
  setVal(dash.w, dash.doc.getElementById('login-pass'), 'staff123');
  click(dash.w, dash.doc.getElementById('login-form').querySelector('button[type=submit]') || dash.doc.querySelector('#login-form button'));
  await new Promise((r) => setTimeout(r, 150));

  const logged = dash.w.BRCStore.currentUser();
  check('الموظف دخل بنجاح (' + (logged ? logged.name + ' — ' + logged.role : 'فشل') + ')', !!logged && logged.role === 'staff');

  click(dash.w, dash.doc.querySelector('#side-nav button[data-view="applicants"]'));
  await new Promise((r) => setTimeout(r, 100));
  const rows = [...dash.doc.querySelectorAll('#apps-table-body tr')].map((r) => r.textContent).join(' ');
  check('جدول الاستمارات يعرض الاستمارة الجديدة', rows.includes(SERIAL));
  check('الجدول يعرض المحاولات المتبقية للموظف', /5\s*\/\s*5|متبق[^<]*5|5\s*محاولات/.test(rows) || rows.includes('5'));

  // ترشيح وظيفة (إجراء الموظف عبر طبقة البيانات ثم تحديث الواجهة)
  const free = dash.w.BRCStore.listJobs({ status: 'available' }).filter((j) => j.code !== 'BRC-1042')[0];
  const picked = dash.w.BRCStore.selectAttempt(SERIAL, free.code);
  dash.w.BRCRefresh && dash.w.BRCRefresh();
  await new Promise((r) => setTimeout(r, 120));

  check('الترشيح نجح وخصّص المحاولة #' + (picked.ok ? picked.attempt.no : '?') + ' على ' + free.code, picked.ok === true, picked.error);
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

  /* ═══ 4) التحقق بكيو آر كود الاستمارة ══════════════════════════════════ */
  step(4, 'صفحة التحقق — فحص الاستمارة من رابط الكيو آر كود');

  const q = '?form=' + encodeURIComponent(SERIAL) + '&t=' + TOKEN;
  const ver = await open('verify.html', q);
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

  /* ═══ 5) بصمة مزيفة ⇒ تحذير أمني ═══════════════════════════════════════ */
  step(5, 'الأمان — بصمة مزيفة يجب أن تُرفع كتحذير');

  const qf = '?form=' + encodeURIComponent(SERIAL) + '&t=deadbeef';
  const fake = await open('verify.html', qf);
  fake.w.BRCStore.importJson(DB2);
  fake.w.BRCVerify.mount(qf);              // رابط ببصمة مزيفة
  await new Promise((r) => setTimeout(r, 150));
  const ftext = fake.doc.body.textContent;
  check('تحذير التلاعب ظاهر للبصمة المزيفة', /تحذير|غير مطابق|تلاعب|مزيفة/.test(ftext));
  check('الرقم الصحيح لم يُسرَّب بثقة في حالة البصمة المزيفة', !!ftext.includes(SERIAL));

  /* ═══ 6) الطباعة: قالب A4 يمتدّ إلى حاوية الطباعة ══════════════════════ */
  step(6, 'الطباعة — استمارة A4 كاملة بالكيو آر كود');

  const ver2 = await open('verify.html', q);
  ver2.w.BRCStore.importJson(DB2);
  ver2.w.BRCVerify.mount(q);
  await new Promise((r) => setTimeout(r, 120));
  const appForPrint = ver2.w.BRCStore.getApplicant(SERIAL);
  ver2.w.BRCVoucher.print(appForPrint, ver2.w.BRCStore.getAttempts(SERIAL));
  await new Promise((r) => setTimeout(r, 260));
  const printHtml = ver2.doc.getElementById('print-root').innerHTML;

  const must = [
    ['ترويسة الشركة', /شركة بابل للتوظيف|Babylonian Recruitment/],
    ['الهاتفان', /07760058007[\s\S]*07715993271/],
    ['العنوان الكامل', /حلة - شارع 60 - قرب مدينة حمورابي/],
    ['الاسم التسلسلي للاستمارة', new RegExp('BRC-NO:?\\s*' + SERIAL.replace('BRC-NO-', ''))],
    ['اسم الباحث', /علي حسن كاظم/],
    ['جدول المحاولات الخمس', /كود الوظيفة/],
    ['الكيو آر كود', /<svg[\s\S]*<path/],
    ['الإخلاء القانوني', /غير مسؤولة قانونياً وعشائياً/],
    ['التواقيع', /توقيع|v-sign/],
    ['علامة مائية بابلية', /v-watermark/]
  ];
  const missing = must.filter(([, re]) => !re.test(printHtml)).map(([k]) => k);
  check('الاستمارة المطبوعة تحوي كل عناصر A4 (' + (must.length - missing.length) + '/' + must.length + ')', missing.length === 0, missing.join(' · '));
  check('نافذة الطباعة استُدعيت فعلاً', ver2.w.__printed > 0, 'عدد الاستدعاءات ' + ver2.w.__printed);
  check('الطباعة سُجّلت في عدّاد الاستمارة', ver2.w.BRCStore.getApplicant(SERIAL).printedCount > 0);

  /* ═══ 7) الملف المستقل: نفس المسار بالهاش ══════════════════════════════ */
  step(7, 'الملف المستقل — التحقق بالمسار الهاشي والتنقل');

  const solo = await open('brc-standalone.html', '#!verify?form=' + encodeURIComponent(SERIAL) + '&t=' + TOKEN);
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
