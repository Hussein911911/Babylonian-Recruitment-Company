#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبارات دخانية وظيفية (jsdom)
 *  ---------------------------------------------------------------------------
 *  تُشغّل الصفحات فعلياً في DOM حقيقي وتتحقق من:
 *   • عدم وجود أخطاء JavaScript
 *   • عرض الوظائف والفلاتر والبحث السريع في الموقع العام
 *   • إصدار استمارة، طباعة قالب A4، توليد الكيو آر كود
 *   • منطق الحجز 24 ساعة، الإفراج التلقائي، والتفعيل التلقائي للمحاولة التالية
 *   • صفحة التحقق (QR) والمنظومة الداخلية (دخول، جدولة، سجل تدقيق، مالية)
 *   • عمل النسخة المستقلة بالكامل عبر الرابط الهاشي
 *
 *  التشغيل:
 *      npm i jsdom            # مرة واحدة
 *      node tests/smoke.mjs
 *  أو: NODE_PATH=/path/to/node_modules node tests/smoke.mjs
 * =========================================================================== */
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const failures = [];

function ok(name) { pass++; console.log('  ✅ ' + name); }
function bad(name, detail) { fail++; failures.push(name + ' — ' + detail); console.log('  ❌ ' + name + ' :: ' + detail); }
function check(name, fn) {
  try { const r = fn(); if (r === true || r === undefined) ok(name); else bad(name, String(r)); }
  catch (e) { bad(name, e.message); }
}
function eq(actual, expected, name) {
  if (actual === expected) ok(name + ' (' + JSON.stringify(actual) + ')');
  else bad(name, 'متوقع ' + JSON.stringify(expected) + ' وحصلنا ' + JSON.stringify(actual));
}


/* أدوات مساعدة: آخر نافذة مفتوحة + إغلاق كل النوافذ */
function lastModal(doc) {
  const all = doc.querySelectorAll('.modal-backdrop .modal');
  return all.length ? all[all.length - 1] : null;
}
function closeAllModals(doc) {
  doc.querySelectorAll('.modal-backdrop').forEach((b) => {
    const c = b.querySelector('[data-close]');
    if (c) c.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    else b.remove();
  });
}

const STAFF_SESSION = { username: 'staff', name: 'موظف فحص', role: 'staff', title: 'موظف توظيف', at: new Date().toISOString() };

async function load(file, { hash = '', search = '', waitMs = 260, session = null } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    // أخطاء تحميل الموارد غير المحلية (خطوط/صور) متوقعة داخل jsdom
    if (/Could not load|Error: Not implemented/.test(String(e.message))) return;
    errors.push(e.message);
  });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const url = pathToFileURL(resolve(ROOT, file)).href + (search || '') + (hash || '');
  const dom = await JSDOM.fromFile(resolve(ROOT, file), {
    url, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    /* jsdom لا يوفّر sessionStorage لأصول file:// — نزرع جلسة الموظف عبر واجهة تخزين بديلة */
    beforeParse(window) {
      if (!session) return;
      const m = new Map([['brc_session_v2', JSON.stringify(session)]]);
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: {
          getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
          setItem: (k, v) => m.set(String(k), String(v)),
          removeItem: (k) => m.delete(String(k)),
          clear: () => m.clear(),
          key: (i) => Array.from(m.keys())[i] || null,
          get length() { return m.size; }
        }
      });
    }
  });
  const { window } = dom;
  // تضبيط ما لا توفره jsdom
  Object.defineProperty(window, 'print', {
    configurable: true, writable: true,
    value: () => { window.__printed = (window.__printed || 0) + 1; }
  });
  window.__printed = 0;
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:test';
  await new Promise((r) => setTimeout(r, waitMs));
  if (window.location.hash !== hash && hash) window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 120));
  return { dom, window, doc: window.document, errors };
}

/* ======================= 1) الموقع العام ======================= */
console.log('\n=== 1) الموقع العام (index.html) ===');
const site = await load('index.html');
check('لا أخطاء JavaScript في الصفحة العامة', () => site.errors.length === 0 || site.errors.join(' | '));
check('تم تحميل مكتبة الكيو آر كود والإعدادات والمخزن', () =>
  Boolean(site.window.BRCQR && site.window.BRC_CONFIG && site.window.BRCStore && site.window.BRCVoucher) ||
  'بعض الوحدات لم تُحمّل');
check('الوظائف التجريبية ظهرت كبطاقات', () => {
  const cards = site.doc.querySelectorAll('#jobs-grid .job-card').length;
  return cards >= 8 || 'عدد البطاقات: ' + cards;
});
check('إحصاءات الواجهة (Hero) ظهرت', () => {
  const n = site.doc.querySelectorAll('#hero-stats .hero-stat').length;
  return n === 4 || 'عدد الإحصاءات: ' + n;
});
check('أيقونة/شعار الشركة موجود داخل الرموز (Sprite)', () =>
  !!site.doc.getElementById('i-emblem') || 'رمز الشعار غير موجود');
check('صورة بوابة عشتار مربوطة بخلفية الواجهة + صورة أسد بابل', () => {
  const lion = site.doc.querySelector('.hero-figure img');
  const gate = site.doc.querySelector('.hero-bg');
  const okLion = !!lion && lion.getAttribute('src').includes('lion-of-babylon');
  return (okLion && !!gate) || 'الصور غير مربوطة';
});
check('التصفية بالحالة تعمل', () => {
  const sel = site.doc.getElementById('filter-status');
  sel.value = 'available';
  sel.dispatchEvent(new site.window.Event('change'));
  const n = site.doc.querySelectorAll('#jobs-grid .job-card').length;
  const shown = Number(site.doc.getElementById('jobs-count').textContent);
  return (n === shown && n > 0 && n < 8) || ('بطاقات ' + n + ' / عدّاد ' + shown);
});
const fq = site.doc.getElementById('filter-q');
fq.value = 'BRC-1042';
fq.dispatchEvent(new site.window.Event('input'));
await new Promise((r) => setTimeout(r, 340));
check('نتيجة البحث بالكود = وظيفة واحدة', () => {
  const n = site.doc.querySelectorAll('#jobs-grid .job-card').length;
  const codeEl = site.doc.querySelector('#jobs-grid .job-code');
  return (n === 1 && codeEl.textContent.includes('BRC-1042')) || ('عدد: ' + n);
});
check('بيانات صاحب العمل لا تظهر في بطاقة الوظيفة العامة', () => {
  const html = site.doc.getElementById('jobs-grid').innerHTML;
  return !html.includes('07701234567') || 'ظهر رقم هاتف صاحب العمل في العرض العام!';
});

/* فتح تفاصيل الوظيفة */
check('نافذة تفاصيل الوظيفة تُفتح وتعرض تحذير الخصوصية', () => {
  const btn = site.doc.querySelector('[data-action="job-details"]');
  btn.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  const modal = lastModal(site.doc);
  return (modal && modal.textContent.includes('خصوصية صاحب العمل')) || 'لم تُفتح النافذة أو لا تحذير خصوصية';
});
check('إغلاق النافذة يعمل', () => {
  const close = lastModal(site.doc).querySelector('[data-close]');
  close.dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  return site.doc.querySelector('.modal-backdrop') === null || 'النافذة لم تُغلق';
});

/* ═══ سياسة الشركة: الزائر لا يقدّم طلباً ولا يتحقق — للعرض والتواصل فقط ═══ */
check('الموقع العام بلا أي زر تقديم أو طلب استمارة', () => {
  const bad = site.doc.getElementById('btn-request-form') || site.doc.getElementById('btn-request-form-2') ||
    site.doc.getElementById('req-form') || site.doc.querySelector('[data-action="request-form"]');
  return !bad || 'ما زال هناك عنصر طلب استمارة موجّه للزائر';
});
check('الموقع العام بلا واجهة تحقق للزائر', () => {
  const bad = site.doc.getElementById('verify-quick') || site.doc.getElementById('verify-serial') ||
    site.doc.querySelector('[data-action="verify"]');
  return !bad || 'ما زالت واجهة التحقق ظاهرة للزائر';
});
check('بطاقة الوظيفة تعرض «احجز» برابط واتساب يحمل كود الوظيفة', () => {
  site.doc.getElementById('filter-reset') && site.doc.getElementById('filter-reset')
    .dispatchEvent(new site.window.MouseEvent('click', { bubbles: true }));
  const a = site.doc.querySelector('#jobs-grid .job-card a[href^="https://wa.me/"]');
  if (!a) return 'لا يوجد زر حجز بالواتساب في بطاقة الوظيفة';
  const href = a.getAttribute('href');
  const codeOk = /BRC-\d{3,}/.test(decodeURIComponent(href)) || 'الرسالة لا تحمل كود الوظيفة';
  return (codeOk === true && /9647/.test(href)) || String(codeOk);
});
check('لا يوجد أي زر «ترشّح» في العرض العام', () => {
  const t = site.doc.getElementById('jobs-grid').textContent;
  return (!/ترشّح/.test(t) && !/اطلب استمارة/.test(t)) || 'ما زال نص الترشح/الطلب ظاهراً للزائر';
});

/* مسار الطلب يبقى داخلياً: الموظف يسجّل الطلب (كما لو استقبله المكتب) ثم يعتمده */
check('تسجيل طلب قيد المراجعة من المنظومة الداخلية', () => {
  const before = site.window.BRCStore.stats().pendingForms;
  const app = site.window.BRCStore.createApplicant({
    fullName: 'اختبار آلي', phone: '07700000000', address: 'الحلة - بابل',
    requestedCode: 'BRC-1043', pending: true
  });
  const after = site.window.BRCStore.stats().pendingForms;
  const valid = app && app.status === 'pending' && !app.expiryDate && app.requestedCode === 'BRC-1043';
  return (after === before + 1 && valid) || 'لم يُسجَّل الطلب: ' + JSON.stringify(app);
});
check('قبول طلب قيد المراجعة يحوّله لاستمارة سارية بخمس محاولات', () => {
  const apps = site.window.BRCStore.listApplicants({ q: 'اختبار آلي' });
  if (!apps.length) return 'لا يوجد طلب للاختبار';
  const serial = apps[0].serial;
  const res = site.window.BRCStore.approveApplicant(serial);
  const app = site.window.BRCStore.getApplicant(serial);
  const valid = res.ok === true && app.status === 'active' && !!app.expiryDate && site.window.BRCStore.attemptsLeft(serial) === 5;
  return valid || 'فشل القبول: ' + JSON.stringify({ res: res, app: app && { status: app.status, expiry: app.expiryDate } });
});
check('رفض طلب قيد المراجعة يعلّم الطلب كمرفوض', () => {
  const r = site.window.BRCStore.createApplicant({ fullName: 'رفض آلي', phone: '07700000009', pending: true });
  const res = site.window.BRCStore.rejectApplicant(r.serial, 'بيانات ناقصة');
  const app = site.window.BRCStore.getApplicant(r.serial);
  const valid = res.ok === true && app.status === 'rejected' && app.rejectReason === 'بيانات ناقصة';
  return valid || 'فشل الرفض: ' + JSON.stringify({ res: res, app: app && app.status });
});

/* ======================= 2) قالب الاستمارة المطبوعة ======================= */
console.log('\n=== 2) قالب الاستمارة A4 + الكيو آر كود ===');
check('قالب الاستمارة يحتوي كل الأقسام المطلوبة', () => {
  const app = site.window.BRCStore.getApplicant('BRC-NO-000120');
  const html = site.window.BRCVoucher.buildHtml(app);
  const needed = [
    'شركة الهدف للتوظيف', 'Al-Hadaf Recruitment Company',
    '07760058007', '07715993271',
    'حلة - شارع 60 - قرب مدينة حمورابي - قرب مجمع الكرعاوي',
    'BRC-NO: 000120', 'الاسم الكامل', 'تاريخ الإصدار', 'تاريخ الانتهاء',
    'جدول المحاولات', 'كود الوظيفة', 'هاتف جهة الاتصال', 'حالة المهلة',
    'خدمات الشركة تنحصر في توفير الأيادي العاملة', 'الشركة غير مسؤولة قانونياً وعشائياً',
    '<svg', 'توقيع الموظف'
  ];
  const missing = needed.filter((x) => !html.includes(x));
  return missing.length === 0 || 'ناقص: ' + missing.join(' , ');
});
check('الاستمارة تعرض 5 صفوف محاولات بالضبط', () => {
  const app = site.window.BRCStore.getApplicant('BRC-NO-000120');
  const html = site.window.BRCVoucher.buildHtml(app);
  const rows = (html.match(/<tr>/g) || []).length - 1; // ناقص صف الترويسة
  return rows === 5 || 'عدد الصفوف: ' + rows;
});
check('رابط التحقق في الكيو آر كود بالصيغة المطلوبة', () => {
  const url = site.window.BRCStore.verifyUrl('BRC-NO-000120');
  // الرابط يتبع نطاق النشر، أو الرابط الرسمي عند العمل من ملف محلي
  return /^https?:\/\/[^/]+\/verify\?form=BRC-NO-000120&t=[0-9a-f]{8}$/.test(url) ||
    /^https:\/\/brc-babil\.com\/verify\?form=BRC-NO-000120&t=[0-9a-f]{8}$/.test(url) || url;
});
{
  const app = site.window.BRCStore.getApplicant('BRC-NO-000119');
  const before = app.printedCount;
  site.window.BRCVoucher.print(app);
  await new Promise((r) => setTimeout(r, 260));
  const after = site.window.BRCStore.getApplicant('BRC-NO-000119').printedCount;
  const rootHtml = site.doc.getElementById('print-root').innerHTML;
  if (after === before + 1 && site.window.__printed > 0 && rootHtml.includes('BRC-NO-000119')) {
    ok('الطباعة تستدعي نافذة الطباعة وتزيد عدّاد الطباعة');
  } else {
    bad('الطباعة تستدعي نافذة الطباعة وتزيد عدّاد الطباعة',
      'قبل ' + before + ' بعد ' + after + ' | استدعاءات الطباعة ' + site.window.__printed + ' | حاوية الطباعة ' + rootHtml.length);
  }
}
check('الاختبارات الذاتية لمولّد الكيو آر كود تنجح بالكامل', () => {
  const r = site.window.BRCQR.selfTest();
  return r.failed === 0 || (r.failed + ' اختبار فاشل: ' + JSON.stringify(r.results.filter((x) => !x.pass)));
});

/* ======================= 3) منطق العمل ======================= */
console.log('\n=== 3) منطق المحاولات والحجز 24 ساعة ===');
const S = site.window.BRCStore;
check('الحجز المؤقت يضبط الوظيفة على «محجوزة» ويحدد مهلة 24 ساعة', () => {
  const res = S.selectAttempt('BRC-NO-000118', 'BRC-1046');
  if (!res.ok) return res.error;
  const job = S.getJob('BRC-1046');
  const hours = S.diffHours(job.holdExpiresAt, new Date());
  return (job.status === 'reserved' && hours > 23 && hours <= 24) || ('الحالة ' + job.status + ' والمهلة ' + hours);
});
check('رقم هاتف صاحب العمل محفوظ داخلياً ويظهر في الاستمارة المطبوعة', () => {
  const app = S.getApplicant('BRC-NO-000118');
  const html = site.window.BRCVoucher.buildHtml(app);
  return html.includes(S.getJob('BRC-1046').employer.phone) || 'هاتف صاحب العمل غير ظاهر في الاستمارة';
});
check('رفض المرشح يعيد الوظيفة «متاحة» ويفعّل المحاولة التالية تلقائياً', () => {
  const pick = S.selectAttempt('BRC-NO-000119', S.listJobs({ status: 'available' })[0].code);
  if (!pick.ok) return 'تعذّر الترشيح: ' + pick.error;
  const usedNo = pick.attempt.no;
  const jobCode = pick.job.code;
  const res = S.setOutcome('BRC-NO-000119', usedNo, 'rejected', 'لم يجتز المقابلة');
  const job = S.getJob(jobCode);
  const next = S.activeAttempt('BRC-NO-000119');
  const nextExpected = usedNo + 1;
  return (res.ok && job.status === 'available' && next && next.no === nextExpected) ||
    ('الوظيفة: ' + job.status + ' — المحاولة المستخدمة #' + usedNo + ' — التالية: ' + (next ? next.no : 'لا يوجد'));
});
check('الإفراج التلقائي عند انتهاء المهلة يعيد الوظيفة ويوسم المحاولة «انتهت المهلة»', () => {
  const r = S.selectAttempt('BRC-NO-000119', 'BRC-1047');
  if (!r.ok) return r.error;
  // إرجاع المهلة إلى الماضي لمحاكاة انتهاء الـ 24 ساعة
  const job = S.getJob('BRC-1047');
  job.holdExpiresAt = new Date(Date.now() - 60000).toISOString();
  S.db().attempts.filter((t) => t.jobId === job.id && t.slotStatus === 'reserved')
    .forEach((t) => { t.holdExpiresAt = job.holdExpiresAt; });
  const actions = S.runMaintenance();
  const slot = S.getAttempts('BRC-NO-000119').find((t) => t.jobId === job.id);
  return (job.status === 'available' && slot.slotStatus === 'expired' && actions.length > 0) ||
    ('الحالة ' + job.status + ' / المحاولة ' + slot.slotStatus + ' / إجراءات ' + actions.length);
});
check('توثيق العملية التلقائية في سجل التدقيق باسم النظام', () => {
  const logs = S.listAudit({ q: 'إفراج تلقائي' });
  return logs.length > 0 || 'لا سجل إفراج تلقائي';
});
check('الاستمارة المنتهية (30 يوماً) تتوقف عن قبول محاولات جديدة', () => {
  const app = S.getApplicant('BRC-NO-000120');
  app.expiryDate = new Date(Date.now() - 86400000).toISOString();
  app.status = 'active';
  S.runMaintenance();
  const st = S.formStatus(S.getApplicant('BRC-NO-000120'));
  const res = S.selectAttempt('BRC-NO-000120', 'BRC-1048');
  return (st === 'expired' && res.ok === false && /صلاحية/.test(res.error)) || ('الحالة ' + st + ' / النتيجة ' + JSON.stringify(res));
});
check('حد المحاولات الخمس مُطبّق', () => {
  const app = S.createApplicant({ fullName: 'فحص المحاولات', phone: '07711111111', address: 'الحلة' });
  let count = 0;
  // نستهلك 5 محاولات على وظائف متاحة ثم نحاول السادسة
  const codes = S.listJobs({ status: 'available' }).map((j) => j.code);
  for (let i = 0; i < 6; i++) {
    const res = S.selectAttempt(app.serial, codes[i % codes.length]);
    if (res.ok) { count++; S.setOutcome(app.serial, res.attempt.no, 'rejected', 'فحص'); }
  }
  const sixth = S.selectAttempt(app.serial, codes[0]);
  return (count === 5 && sixth.ok === false) || ('نجح ' + count + ' محاولة، والمحاولة السادسة: ' + JSON.stringify(sixth));
});

/* ======================= 4) صفحة التحقق ======================= */
console.log('\n=== 4) صفحة التحقق (verify.html) ===');
/* الزائر: بوابة تسدّ التحقق كلياً (بلا أي بيانات) */
const gate = await load('verify.html', { search: '?form=BRC-NO-000120' });
check('صفحة التحقق للزائر تعرض بوابة «للموظفين والإدارة فقط»', () => {
  const t = gate.doc.getElementById('verify-root').textContent;
  return /موظفي الشركة والإدارة|تسجيل دخول الموظفين/.test(t) || 'لا توجد بوابة للزائر';
});
check('الزائر لا يرى أي بيانات استمارة (لا رقم ولا اسم ولا محاولات)', () => {
  const t = gate.doc.getElementById('verify-root').textContent;
  const leak = t.includes('BRC-NO-000120') || t.includes('حسين') || /محاولة/.test(t);
  return !leak || 'تسريب بيانات للزائر في صفحة التحقق';
});
check('لا يمكن للزائر تشغيل التحقق من رابط الكيو آر كود (يبقى محجوباً)', () => {
  gate.window.BRCVerify.mount('?form=BRC-NO-000120&t=deadbeef');
  const t = gate.doc.getElementById('verify-root').textContent;
  return (/موظفي الشركة والإدارة/.test(t) && !t.includes('BRC-NO-000120')) || 'البوابة لا تحمي mount()';
});

/* الموظف: التحقق يعمل كما كان */
const verify = await load('verify.html', { search: '?form=BRC-NO-000120', session: STAFF_SESSION });
check('بجلسة موظف: صفحة التحقق تُحمّل بدون أخطاء', () => verify.errors.length === 0 || verify.errors.join(' | '));
check('بلا بصمة: تُظهر الرقم والحالة مع تقنيع اسم الباحث وهاتفه', () => {
  const t = verify.doc.getElementById('verify-root').textContent;
  const masked = !t.includes('حسين كاظم عبد الله');
  return (t.includes('BRC-NO-000120') && masked &&
    (t.includes('سارية') || t.includes('منتهية') || t.includes('استُهلكت') || t.includes('مكتملة'))) ||
    ('الاسم ظاهر بلا بصمة؟ ' + !masked);
});
check('بالنمط: الاسم مقنّع في الرد نفسه لا في العرض فقط', () => {
  const r = verify.window.BRCStore.verify('BRC-NO-000120');
  return (r.masked === true && !r.fullName.includes('حسين') && /•/.test(r.fullName) && /•/.test(r.phone)) ||
    JSON.stringify({ masked: r.masked, fullName: r.fullName, phone: r.phone });
});
/* بالبصمة الصحيحة (كما في رابط الكيو آر كود) تظهر البيانات كاملة */
const vTok = verify.window.BRCStore.token('BRC-NO-000120');
const verifyTok = await load('verify.html', { search: '?form=BRC-NO-000120&t=' + vTok, session: STAFF_SESSION });
check('بالبصمة الصحيحة: اسم الباحث يظهر كاملاً', () => {
  const t = verifyTok.doc.getElementById('verify-root').textContent;
  return t.includes('حسين كاظم عبد الله') || 'الاسم غير ظاهر مع بصمة صحيحة';
});

check('تعرض جدول المحاولات مع أكواد الوظائف', () => {
  const rows = verify.doc.querySelectorAll('#verify-root table.data tbody tr').length;
  const hasCode = verify.doc.getElementById('verify-root').textContent.includes('BRC-1042');
  return (rows === 5 && hasCode) || ('صفوف: ' + rows + ' / كود: ' + hasCode);
});
check('تعرض كيو آر كود التحقق (SVG)', () => {
  const svg = verify.doc.querySelector('#verify-root .verify-qr svg path');
  return !!svg || 'لا يوجد SVG للكيو آر كود';
});
check('رقم غير موجود يعطي رسالة واضحة', () => {
  const s2 = verify.window.BRCStore.verify('BRC-NO-999999');
  return (s2.ok === false && /لا توجد استمارة/.test(s2.error)) || JSON.stringify(s2);
});
check('بصمة تحقق غير مطابقة تُرفع كتحذير', () => {
  const res = verify.window.BRCStore.verify('BRC-NO-000120', 'deadbeef');
  return res.tokenOk === false || 'لم يتم كشف البصمة المزيفة';
});

/* ======================= 5) المنظومة الداخلية ======================= */
console.log('\n=== 5) المنظومة الداخلية (dashboard.html) ===');
const dash = await load('dashboard.html');
/* حسابات فحص محلية (fixtures): الإنتاج أغلق باب الدخول المحلي نهائياً
   (users: [] و enforceAuth: true في supabase-config.js) — وهذا هو الصحيح
   أمنياً ولا يُخفض للاختبارات. فاختبارات الواجهة الداخلية تزرع حساباتها في
   هذا المتصفح الافتراضي وحده (كما تُزرع جلسة الموظف أعلاه)، والدخول هنا
   محلي بحت لأن jsdom بلا fetch فلا سحابة أصلاً. */
dash.window.BRC_CONFIG.users = [
  { username: 'admin', password: 'admin123', name: 'مدير الفحص', role: 'admin', title: 'مدير عام' },
  { username: 'staff', password: 'staff123', name: 'موظف فحص', role: 'staff', title: 'موظف توظيف' }
];
check('شاشة الدخول تظهر في البداية', () =>
  (!dash.doc.getElementById('login-wrap').classList.contains('hidden') &&
    dash.doc.getElementById('app-shell').classList.contains('hidden')) || 'الحالة الابتدائية خاطئة');
check('دخول موظف ببيانات صحيحة', () => {
  dash.doc.getElementById('login-user').value = 'staff';
  dash.doc.getElementById('login-pass').value = 'staff123';
  dash.doc.getElementById('login-form').dispatchEvent(new dash.window.Event('submit', { bubbles: true, cancelable: true }));
  const hidden = dash.doc.getElementById('app-shell').classList.contains('hidden');
  const user = dash.window.BRCStore.currentUser();
  return (!hidden && user && user.role === 'staff') || 'لم يتم الدخول';
});
check('كلمة مرور خاطئة تُرفض', () => {
  const s = dash.window.BRCStore.login('staff', 'wrong');
  dash.window.BRCStore.logout && dash.window.BRCStore.login('staff', 'staff123');
  return s === null || 'قبل كلمة مرور خاطئة';
});
check('اللوحة المالية وسجل التدقيق مخفيان للموظف', () => {
  const fin = dash.doc.querySelector('[data-view="finance"]');
  return fin.classList.contains('hidden') || 'زر اللوحة المالية ظاهر للموظف';
});
check('جدول الوظائف يعرض بيانات صاحب العمل (للموظف)', () => {
  dash.doc.querySelector('#side-nav button[data-view="jobs"]').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const t = dash.doc.getElementById('jobs-table-body').textContent;
  return (t.includes('07701234567') && t.includes('BRC-1042')) || 'البيانات الداخلية غير ظاهرة';
});
check('جدول الاستمارات يعرض المحاولات المتبقية', () => {
  dash.doc.querySelector('#side-nav button[data-view="applicants"]').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const rows = dash.doc.querySelectorAll('#apps-table-body tr').length;
  return rows >= 4 || 'عدد الصفوف: ' + rows;
});
check('إصدار استمارة من اللوحة', () => {
  closeAllModals(dash.doc);
  const before = dash.window.BRCStore.stats().forms;
  dash.doc.getElementById('btn-new-app').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const box = lastModal(dash.doc);
  if (!box) return 'لم تُفتح النافذة';
  box.querySelector('#n-name').value = 'باحث من اللوحة';
  box.querySelector('#n-phone').value = '07722222222';
  box.querySelector('#n-address').value = 'المحاويل';
  box.querySelector('#n-save').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const after = dash.window.BRCStore.stats().forms;
  return after === before + 1 || ('قبل ' + before + ' بعد ' + after);
});
check('نموذج إضافة وظيفة يُنتج كود BRC-#### جديداً', () => {
  closeAllModals(dash.doc);
  const before = dash.window.BRCStore.stats().totalJobs;
  dash.doc.getElementById('btn-new-job').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const box = lastModal(dash.doc);
  box.querySelector('#f-title').value = 'فني تبريد';
  box.querySelector('#f-ename').value = 'شركة تبريد الفرات';
  box.querySelector('#f-ephone').value = '07733333333';
  box.querySelector('#f-eaddr').value = 'الحلة - الصناعية';
  box.querySelector('#f-min').value = '600000';
  box.querySelector('#f-max').value = '800000';
  box.querySelector('#job-save').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const after = dash.window.BRCStore.stats().totalJobs;
  const newJob = dash.window.BRCStore.listJobs({}).find((j) => j.title === 'فني تبريد');
  return (after === before + 1 && newJob && /^BRC-\d{4}$/.test(newJob.code)) || ('عدد ' + after + ' / كود ' + (newJob && newJob.code));
});
check('شاشة الحجوزات تعرض الحجوزات الجارية مع العدّاد التنازلي', () => {
  const r = dash.window.BRCStore.selectAttempt('BRC-NO-000117', 'BRC-1049') ;
  // BRC-1049 مغلقة → نتوقع فشلاً، ثم نجرّب وظيفة متاحة
  const avail = dash.window.BRCStore.listJobs({ status: 'available' })[0];
  const ok = dash.window.BRCStore.selectAttempt('BRC-NO-000117', avail.code);
  dash.doc.querySelector('#side-nav button[data-view="holds"]').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const list = dash.doc.getElementById('holds-list').textContent;
  const timer = dash.doc.querySelector('#holds-list [data-expiry]');
  return (ok.ok && list.includes(avail.code) && !!timer) || ('نتيجة الحجز ' + JSON.stringify(ok.error || 'ok') + ' / عدّاد ' + !!timer);
});
check('تثبيت نتيجة المقابلة (نجاح) يغلق الوظيفة', () => {
  const holds = dash.window.BRCStore.pendingActions().holds;
  if (!holds.length) return 'لا حجوزات لاختبارها';
  const h = holds[holds.length - 1];
  const before = dash.window.BRCStore.getJob(h.job.code).status;
  dash.doc.querySelector('#side-nav button[data-view="overview"]').dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const res = dash.window.BRCStore.setOutcome(h.serial, dash.window.BRCStore.getAttempts(h.serial).find((t) => t.jobId === h.job.id).no, 'succeeded', 'اختبار آلي');
  const after = dash.window.BRCStore.getJob(h.job.code).status;
  return (before === 'reserved' && res.ok && after === 'closed') || ('قبل ' + before + ' بعد ' + after);
});
check('سجل التدقيق يرصد كل العمليات بالثانية', () => {
  const logs = dash.window.BRCStore.listAudit({});
  const shaped = logs.filter((l) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(l.ts) && l.user && l.ip && l.action);
  return (logs.length >= 5 && shaped.length === logs.length) || ('عدد السجلات ' + logs.length + ' / مطابقة ' + shaped.length);
});
check('البحث السريع بالكود يفتح بطاقة الوظيفة', () => {
  closeAllModals(dash.doc);
  const q = dash.doc.getElementById('quick-code');
  q.value = 'BRC-1045';
  dash.doc.getElementById('quick-code-form').dispatchEvent(new dash.window.Event('submit', { bubbles: true, cancelable: true }));
  const modal = lastModal(dash.doc);
  return (modal && modal.textContent.includes('BRC-1045') && modal.textContent.includes('بطاقة الوظيفة الداخلية')) || 'لم تُفتح البطاقة';
});
check('صلاحية المدير تُظهر اللوحة المالية وسجل التدقيق الكامل', () => {
  closeAllModals(dash.doc);
  dash.window.BRCStore.logout();
  dash.window.BRCStore.login('admin', 'admin123');
  dash.window.BRCRefresh();
  const fin = dash.doc.querySelector('[data-view="finance"]');
  const navVisible = !fin.classList.contains('hidden');
  fin.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  const view = dash.doc.getElementById('view-finance');
  const bars = dash.doc.querySelectorAll('#fin-bars .bar-row').length;
  const stats = dash.doc.querySelectorAll('#fin-stats .stat-card').length;
  const auditRows = dash.doc.querySelectorAll('#audit-table-body tr').length;
  return (navVisible && view.classList.contains('active') && bars > 0 && stats === 4) ||
    ('ظاهر: ' + navVisible + ' / نشط: ' + view.classList.contains('active') + ' / أعمدة: ' + bars + ' / بطاقات: ' + stats + ' / سجل: ' + auditRows);
});
check('اللوحة المالية تحسب المتوقع تحصيله = الاستمارات × الرسم', () => {
  const fee = dash.window.BRCStore.settings().formFee;
  const rows = dash.window.BRCStore.financials('', '');
  return rows.every((r) => r.expected === r.forms * fee) || JSON.stringify(rows.map((r) => [r.forms, r.expected, fee]));
});

/* ======================= 6) النسخة المستقلة ======================= */
console.log('\n=== 6) الملف المستقل (brc-standalone.html) ===');
const st = await load('brc-standalone.html');
check('الملف المستقل يُحمّل بدون أخطاء', () => st.errors.length === 0 || st.errors.join(' | '));
check('لا مسارات ملفات خارجية (كل شيء مدمج)', () => {
  const html = readFileSync(resolve(ROOT, 'brc-standalone.html'), 'utf8');
  const bads = [];
  if (/<link[^>]+href="assets\//.test(html)) bads.push('css');
  if (/<script[^>]+src="/.test(html)) bads.push('js');
  if (/url\(['"]?\.\.\//.test(html)) bads.push('font/img url');
  return bads.length === 0 || bads.join(',');
});
/* نسخة ثانية بجلسة موظف: التحقق يفتح داخل الملف المستقل */
const stStaff = await load('brc-standalone.html', { hash: '#!verify?form=BRC-NO-000120', session: STAFF_SESSION });

check('القسم العام يعرض الوظائف داخل الملف المستقل', () => {
  const n = st.doc.querySelectorAll('#jobs-grid .job-card').length;
  return n >= 8 || 'عدد البطاقات ' + n;
});
check('مسار التحقق بالملف المستقل محجوب عن الزائر', () => {
  st.window.location.hash = '#!verify?form=BRC-NO-000120';
  st.window.dispatchEvent(new st.window.Event('hashchange'));
  const root = st.doc.getElementById('verify-root').textContent;
  const routeHidden = st.doc.getElementById('route-verify').hidden;
  const siteHidden = st.doc.getElementById('route-site').hidden;
  const blocked = /موظفي الشركة والإدارة/.test(root) && !root.includes('BRC-NO-000120');
  return (!routeHidden && siteHidden && blocked) ||
    ('مخفي التحقق: ' + routeHidden + ' / النص: ' + root.slice(0, 60));
});
check('مسار التحقق بالملف المستقل يعمل بجلسة موظف', () => {
  const root = stStaff.doc.getElementById('verify-root').textContent;
  return root.includes('BRC-NO-000120') || ('النص: ' + root.slice(0, 90));
});
check('المسار الهاشي يعرض المنظومة الداخلية', () => {
  st.window.location.hash = '#!dashboard';
  st.window.dispatchEvent(new st.window.Event('hashchange'));
  const hidden = st.doc.getElementById('route-dashboard').hidden;
  return (!hidden && !!st.doc.getElementById('login-wrap')) || 'لم يُعرض مسار اللوحة';
});
check('الملف المستقل بلا زر تقديم أو طلب استمارة للزائر', () => {
  const bad = st.doc.getElementById('btn-request-form') || st.doc.getElementById('btn-request-form-2') ||
    st.doc.querySelector('[data-action="request-form"]') || st.doc.getElementById('verify-quick');
  return !bad || 'ما زال عنصر طلب/تحقق ظاهراً في الملف المستقل';
});
check('العودة إلى الموقع العام تعمل', () => {
  st.window.location.hash = '#jobs';
  st.window.dispatchEvent(new st.window.Event('hashchange'));
  return (!st.doc.getElementById('route-site').hidden && st.doc.getElementById('route-verify').hidden) || 'فشل الرجوع';
});

/* ======================= 7) الموقع العام في وضع قاعدة الشركة =======================
 * المحاكاة: نفس index.html المنشورة، مع window.fetch وهمي يُحقن عبر ملف
 * supabase-config.js (يُحمَّل قبل store.js) يجيب عن public_jobs فقط — تماماً
 * كعميل REST الحقيقي. هكذا نتحقق من سلوك الزائر الحقيقي على النسخة المنشورة:
 * لا بيانات متصفح (seed/كاش) إطلاقاً، بل هيكل تحميل ثم المعلن من القاعدة،
 * أو «لا توجد وظائف معروضة حالياً»، أو «تعذّر الاتصال بقاعدة الشركة». */
console.log('\n=== 7) الموقع العام في وضع قاعدة الشركة (Supabase مفعّل) ===');
{
  const REST = 'https://vqsvztudvfukyuerzcgx.supabase.co/rest/v1/';
  const CLOUD_JOBS = [
    { code: 'BRC-9001', title: 'فني تشغيل من القاعدة', category: 'تقني', region: 'الحلة', shift: 'صباحي',
      salary_min: 700000, salary_max: 900000, gender: 'لا فرق', vacancies: 2, requirements: ['خبرة سنتين'],
      status: 'available', is_reserved: false, hold_expires_at: null,
      created_at: '2026-09-01T00:00:00.000Z', description: 'وصف معلن', image_url: '' },
    { code: 'BRC-9002', title: 'محاسب من القاعدة', category: 'إداري', region: 'المسيب', shift: 'دوام كامل',
      salary_min: 900000, salary_max: 1200000, gender: 'لا فرق', vacancies: 1, requirements: [],
      status: 'available', is_reserved: false, hold_expires_at: null,
      created_at: '2026-09-02T00:00:00.000Z', description: '', image_url: '' }
  ];

  function cloudMockScript(scenario) {
    return `
;(function () {
  var REST = ${JSON.stringify(REST)};
  var ROWS = ${JSON.stringify(scenario.fail ? [] : (scenario.jobs || []))};
  var FAIL = ${scenario.fail ? 'true' : 'false'};
  var DELAY = ${scenario.delay || 400};
  window.__brcMockFetchCalls = 0;
  window.fetch = function (url) {
    window.__brcMockFetchCalls++;
    var u = String(url);
    var out;
    if (u.indexOf(REST + 'public_jobs') === 0) {
      out = FAIL
        ? Promise.reject(new Error('mock: network down'))
        : Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify(ROWS)); } });
    } else {
      out = Promise.reject(new Error('unexpected fetch: ' + u));
    }
    /* معالج فوري حتى لا يصبح الوعد المرفوض unhandledRejection قبل انقضاء المهلة */
    out.catch(function () {});
    return new Promise(function (res, rej) { setTimeout(function () { out.then(res, rej); }, DELAY); });
  };
})();`;
  }

  class CloudMockLoader extends ResourceLoader {
    constructor(scenario) { super(); this.scenario = scenario; }
    fetch(url, options) {
      if (String(url).includes('/assets/js/supabase-config.js')) {
        return super.fetch(url, options)
          .then((buf) => Buffer.from(String(buf) + '\n' + cloudMockScript(this.scenario), 'utf8'));
      }
      return super.fetch(url, options);
    }
  }

  async function loadCloudIndex(scenario) {
    const vc = new VirtualConsole();
    const errors = [];
    vc.on('jsdomError', (e) => {
      if (/Could not load|Error: Not implemented/.test(String(e.message))) return;
      errors.push(e.message);
    });
    vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
    const dom = await JSDOM.fromFile(resolve(ROOT, 'index.html'), {
      url: pathToFileURL(resolve(ROOT, 'index.html')).href,
      runScripts: 'dangerously', resources: new CloudMockLoader(scenario),
      pretendToBeVisual: true, virtualConsole: vc
    });
    return { dom, window: dom.window, doc: dom.window.document, errors };
  }

  async function pollUntil(fn, timeoutMs, label) {
    const t0 = Date.now();
    for (;;) {
      if (fn()) return true;
      if (Date.now() - t0 > timeoutMs) throw new Error('انتهت مهلة الانتظار: ' + label);
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  /* نسخة await من check (الفحوص هنا تنتظر رد القاعدة الوهمي) */
  async function acheck(name, fn) {
    try {
      const r = await fn();
      if (r === true || r === undefined) ok(name);
      else bad(name, String(r));
    } catch (e) { bad(name, e.message); }
  }

  /* (أ) النجاح: هيكل تحميل ثم المعلن من القاعدة — ولا أثر للبيانات التجريبية */
  const okPage = await loadCloudIndex({ jobs: CLOUD_JOBS, delay: 400 });
  check('الصفحة العامة لا أخطاء JavaScript في الوضع السحابي', () => okPage.errors.length === 0 || okPage.errors.join(' | '));
  await acheck('هيكل التحميل يظهر أثناء قراءة public_jobs (لا بيانات متصفح)', async () => {
    await pollUntil(() => okPage.doc.querySelectorAll('#jobs-grid .job-card.skeleton').length > 0, 4000, 'ظهور الهيكل');
    const grid = okPage.doc.getElementById('jobs-grid').textContent;
    return (!grid.includes('BRC-1042') && okPage.doc.querySelectorAll('#hero-stats .hero-stat.skeleton').length === 4) ||
      'ظهرت بيانات المتصفح أثناء التحميل أو الهيكل ناقص';
  });
  await acheck('بعد الرد: الوظائف المعلنة من القاعدة (لا التجريبية)', async () => {
    await pollUntil(() => okPage.doc.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length > 0, 5000, 'وصول الوظائف');
    const grid = okPage.doc.getElementById('jobs-grid').textContent;
    return (grid.includes('BRC-9001') && grid.includes('BRC-9002') && !grid.includes('BRC-1042')) ||
      'البطاقات ليست من القاعدة: ' + grid.slice(0, 80);
  });
  await acheck('إحصاءات الزائر من المعلن فقط (لا أعداد استمارات داخلية)', async () => {
    const stats = [...okPage.doc.querySelectorAll('#hero-stats .hero-stat')].map((s) => s.textContent);
    return (stats.length === 2 && /متاحة/.test(stats[0]) && /معروضة/.test(stats[1])) ||
      'الإحصاءات: ' + JSON.stringify(stats);
  });
  await acheck('الزائر = طلب واحد فقط (public_jobs) ولا صلاحية كتابة', async () => {
    const st = okPage.window.BRCStore.cloudStatus();
    return (okPage.window.__brcMockFetchCalls === 1 && st.state === 'on' && st.role === 'public' && st.readOnly === true) ||
      JSON.stringify({ calls: okPage.window.__brcMockFetchCalls, state: st.state, role: st.role });
  });
  await acheck('بطاقة الوظيفة تعرض «احجز» بواتساب يحمل كود الوظيفة المعلنة', async () => {
    const a = okPage.doc.querySelector('#jobs-grid .job-card a[href^="https://wa.me/"]');
    return (a && /BRC-9001|BRC-9002/.test(decodeURIComponent(a.getAttribute('href')))) || 'لا زر حجز واتساب';
  });
  okPage.dom.window.close();

  /* (ب) قاعدة متصلة لكن لا وظائف معلنة */
  const emptyPage = await loadCloudIndex({ jobs: [], delay: 200 });
  await acheck('قاعدة بلا وظائف معلنة: رسالة «لا توجد وظائف معروضة حالياً»', async () => {
    await pollUntil(() => {
      const e = emptyPage.doc.getElementById('jobs-empty');
      return e && !e.classList.contains('hidden');
    }, 5000, 'رسالة الفراغ');
    const e = emptyPage.doc.getElementById('jobs-empty');
    const h = e.querySelector('h3');
    const cards = emptyPage.doc.querySelectorAll('#jobs-grid .job-card:not(.skeleton)').length;
    return (h && h.textContent.includes('لا توجد وظائف معروضة حالياً') && cards === 0) ||
      ('العنوان: ' + (h && h.textContent) + ' / بطاقات: ' + cards);
  });
  await acheck('حالة الفراغ لا تعرض البيانات التجريبية إطلاقاً', async () => {
    const body = emptyPage.doc.getElementById('jobs-grid').textContent + emptyPage.doc.getElementById('hero-stats').textContent;
    return !body.includes('BRC-1042') || 'ظهرت بيانات seed مع قاعدة فارغة';
  });
  emptyPage.dom.window.close();

  /* (ج) فشل الاتصال: رسالة فشل صريحة + إعادة محاولة — لا سقوط لبيانات المتصفح */
  const failPage = await loadCloudIndex({ fail: true, delay: 200 });
  await acheck('فشل الاتصال: «تعذّر الاتصال بقاعدة الشركة» + زر إعادة المحاولة', async () => {
    await pollUntil(() => /تعذّر الاتصال بقاعدة الشركة/.test(failPage.doc.getElementById('jobs-grid').textContent), 5000, 'رسالة الفشل');
    const retry = failPage.doc.querySelector('#jobs-grid [data-action="retry-cloud"]');
    const st = failPage.window.BRCStore.cloudStatus();
    return (!!retry && st.state === 'degraded') || JSON.stringify({ retry: !!retry, state: st.state });
  });
  await acheck('عند الفشل لا تُعرض وظائف المتصفح التجريبية', async () => {
    const grid = failPage.doc.getElementById('jobs-grid').textContent;
    return (!grid.includes('BRC-1042') && !grid.includes('عامل مخزن')) || 'سقط العرض إلى بيانات seed عند الفشل';
  });
  failPage.dom.window.close();
}

/* ═══════════ 8) أدوات الموظف والمدير: التحقق يبقى داخل المنظومة ═══════════ */
console.log('\n=== 8) أدوات الموظف — التحقق من المنظومة الداخلية (بجلسة موظف) ===');
{
  const dash = await load('dashboard.html', { session: STAFF_SESSION });
  const DB = site.window.BRCStore.exportJson();
  dash.window.BRCStore.importJson(DB);
  dash.window.BRCStore.emit && dash.window.BRCStore.emit();
  dash.window.BRCRefresh && dash.window.BRCRefresh();
  await new Promise((r) => setTimeout(r, 200));

  check('المنظومة تُفتح بجلسة الموظف مباشرة', () => !dash.doc.getElementById('app-shell').classList.contains('hidden'));

  const viewBtn = dash.doc.querySelector('#side-nav button[data-view="applicants"]');
  if (viewBtn) viewBtn.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));

  const verifyBtn = dash.doc.querySelector('[data-app-verify="BRC-NO-000120"]');
  check('زر التحقق من الاستمارة موجود في جدول الموظف',
    () => !!verifyBtn || ('الأزرار الموجودة: ' + dash.doc.querySelectorAll('[data-app-verify]').length));

  if (verifyBtn) {
    verifyBtn.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const box = lastModal(dash.doc);
    const bt = box ? box.textContent : '';
    check('نافذة التحقق تعرض الرقم ورابط التحقق المطبوع',
      () => (/BRC-NO-000120/.test(bt) && /\/verify(\.html)?\?form=/.test(bt)) || bt.slice(0, 120));
    check('كيو آر كود الاستمارة مرسوم داخل النافذة', () => !!(box && box.querySelector('svg')));
    check('زر «فتح صفحة التحقق» موجود للموظف', () => !!(box && box.querySelector('#go-verify')));
    check('رابط التحقق المحلي صالح',
      () => /verify\.html\?form=BRC-NO-000120/.test(dash.window.BRCStore.verifyLocalUrl('BRC-NO-000120')),
      dash.window.BRCStore.verifyLocalUrl('BRC-NO-000120'));
    const close = box && box.querySelector('[data-close]');
    if (close) close.dispatchEvent(new dash.window.MouseEvent('click', { bubbles: true }));
  }

  /* المدير: نفس الأدوات + الصلاحيات الإدارية قائمة */
  const admin = await load('dashboard.html', { session: { username: 'admin', name: 'مدير فحص', role: 'admin', title: 'مدير عام', at: new Date().toISOString() } });
  admin.window.BRCStore.importJson(DB);
  admin.window.BRCStore.emit && admin.window.BRCStore.emit();
  await new Promise((r) => setTimeout(r, 150));
  check('لوحة المدير تفتح وتُظهر أدوات الإدارة (اللوحة المالية)', () => {
    const fin = admin.doc.querySelector('[data-view="finance"]');
    return (!!fin && !fin.classList.contains('hidden')) || 'زر اللوحة المالية غير ظاهر للمدير';
  });
  check('المدير يرى صفحة التحقق كموظف (نفس البوابة تُجيزه)', () => {
    const u = admin.window.BRCStore.currentUser();
    return !!u && (u.role === 'admin' || u.role === 'staff');
  });
}

/* ======================= النتيجة ======================= */
console.log('\n' + '='.repeat(58));
console.log(`النتيجة: ✅ ${pass} ناجح | ❌ ${fail} فاشل`);
if (failures.length) { console.log('\nالإخفاقات:'); failures.forEach((f) => console.log('  • ' + f)); }
console.log('='.repeat(58));
process.exit(fail ? 1 : 0);
