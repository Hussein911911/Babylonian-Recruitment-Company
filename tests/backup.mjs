#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار النسخ الاحتياطي المجدول وأزراره (End-to-End عبر HTTP)
 *  ---------------------------------------------------------------------------
 *  لماذا عبر خادم HTTP وليس fromFile؟
 *    النسخ الاحتياطي يعتمد على localStorage، والمتصفح (و jsdom) لا يوفّران
 *    localStorage لأصل file:// — فالاختبارFromFile يمرّر الأكاذيب. لذلك نُشغّل
 *    خادم المعاينة نفسه (tools/serve.mjs) ونفتح الصفحة من http://localhost.
 *
 *  ماذا يفحص؟
 *    1) مستوى المتجر: saveScheduledBackup / getScheduledBackups / delete /
 *       export / restore (كامل وجزئي) + أمان مساحة التخزين
 *    2) محرّك الجدولة: checkAutoBackup يُنشئ نسخة واحدة لكل (يوم + وقت)
 *       ويلتقط النسخة الفائتة في نفس اليوم
 *    3) مستوى الواجهة: كل أزرار «الإعدادات والنسخ» تعمل فعلاً بالنقر
 *       (سريعة / جدولة / عرض / تعديل / نفّذ الآن / إيقاف) + عدّادات الواجهة
 *    4) نافذة التأكيد: «تأكيد» = نعم (كانت ترجع false دائماً بسبب onClose)
 *    5) الأزرار المكمّلة في لوحة «النسخ الاحتياطي والصيانة»: تصدير JSON /
 *       استيراد نسخة (صالحة وتالفة) / تشغيل قواعد الحجز / نسخ رابط التحقق
 *
 *  التشغيل:  node tests/backup.mjs     أو     npm run test:backup
 * =========================================================================== */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SEED } from './fixtures/demo-seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const { JSDOM, VirtualConsole } = require('jsdom');

const PORT = Number(process.env.BRC_TEST_PORT || 4319);
const BASE = 'http://localhost:' + PORT;

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, cond, detail) => (cond ? ok(t) : bad(t, detail));
const step = (n, t) => console.log('\n▌ الخطوة ' + n + ' — ' + t);
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/* ------------------------- تشغيل خادم المعاينة ------------------------- */
const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(BASE + '/dashboard.html');
      if (res.ok) return true;
    } catch { /* ليس جاهزاً بعد */ }
    await wait(150);
  }
  throw new Error('لم يُقلع خادم المعاينة على المنفذ ' + PORT + '\n' + serverLog);
}

async function openDashboard() {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => {
    const m = String(e && (e.detail || e.message || e));
    if (/Not implemented|Could not load/.test(m)) return;
    errors.push(m.split('\n')[0]);
  });
  const dom = await JSDOM.fromURL(BASE + '/dashboard.html', {
    beforeParse(window) {
      /* بذرة العرض للاختبارات فقط — الإنتاج ببذرة فارغة
         (انظر tests/fixtures/demo-seed.mjs). قبل تنفيذ config.js. */
      window.__BRC_TEST_SEED__ = JSON.parse(JSON.stringify(DEMO_SEED));
    },
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc
  });
  await new Promise((r) => { dom.window.addEventListener('load', r); setTimeout(r, 8000); });
  await wait(500);
  const w = dom.window;
  return { dom, w, doc: w.document, errors, click: (el) => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })) };
}

console.log('\n' + '═'.repeat(74));
console.log('  BRC — اختبار النسخ الاحتياطي المجدول (المتجر + الواجهة + الجدولة)');
console.log('═'.repeat(74));

try {
  await waitForServer();
  const { w, doc, errors, click } = await openDashboard();
  const S = w.BRCStore;
  const UI = w.BRCUI;
  /* حساب مدير fixture محلي: الإنتاج أغلق الدخول المحلي نهائياً (users: [] و
     enforceAuth: true — وهذا صحيح ولا يُخفض). jsdom بلا fetch فالوضع هنا محلي
     بحت، والاختبار يختبر النسخ الاحتياطي لا المصادقة — فنزرع حسابه الخاص. */
  w.BRC_CONFIG.users = [
    { username: 'admin', password: 'admin123', name: 'مدير الفحص', role: 'admin', title: 'مدير عام' }
  ];
  const modalOpen = () => !!doc.querySelector('#modal-root .modal');
  const lastModal = () => doc.querySelector('#modal-root .modal-backdrop:last-child');
  const txt = (id) => { const e = doc.getElementById(id); return e ? e.textContent.trim() : null; };

  /* جسر التنزيل: jsdom لا ينفّذ URL.createObjectURL — بدونه يرمي UI.download
     استثناءً يُسكته مرشّح «Not implemented» فلا نكتشف تعطّل زر التصدير.
     نلتقط التنزيلات هنا لنتحقق من الأزرار التي تُنتج ملفات فعلاً. */
  const downloads = [];
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  const nativeCreate = doc.createElement.bind(doc);
  doc.createElement = function (tag) {
    var el = nativeCreate(tag);
    if (String(tag).toLowerCase() === 'a') {
      el.click = function () { downloads.push({ name: el.download, href: el.href }); };
    }
    return el;
  };
  /* جسر الحافظة: نتحقق أن «نسخ الرابط» استُدعي فعلاً */
  const copied = [];
  Object.defineProperty(w.navigator, 'clipboard', {
    value: { writeText: function (t) { copied.push(t); return Promise.resolve(); } },
    configurable: true
  });
  /* محاكاة اختيار ملف لزر «استيراد نسخة» */
  const setFile = function (input, name, content) {
    var f = new w.File([content], name, { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [f], configurable: true, writable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
  };

  step(1, 'سلامة التحميل والدخول بصلاحية المدير');
  check('لا أخطاء JavaScript عند تحميل dashboard.html', errors.length === 0, errors.join(' | '));
  check('BRCStore يوفّر دوال النسخ الاحتياطي', ['getScheduledBackups', 'saveScheduledBackup', 'deleteScheduledBackup',
    'restoreScheduledBackup', 'exportScheduledBackup', 'getAutoSchedule', 'saveAutoSchedule',
    'clearAutoSchedule', 'checkAutoBackup'].every((k) => typeof S[k] === 'function'));
  check('localStorage متاح (أصل http حقيقي — شرط عمل النسخ الاحتياطي)', !!w.localStorage);

  doc.getElementById('login-user').value = 'admin';
  doc.getElementById('login-pass').value = 'admin123';
  doc.getElementById('login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(300);
  check('دخول المدير نجح', !!S.currentUser() && S.currentUser().role === 'admin');
  click(doc.querySelector('#side-nav button[data-view="settings"]'));
  await wait(250);
  check('عرض «الإعدادات والنسخ» نشِط', doc.getElementById('view-settings').classList.contains('active'));

  step(2, 'مستوى المتجر — الحفظ والقراءة والحذف والتصدير والاستعادة');
  w.localStorage.removeItem('brc-scheduled-backups');
  const b1 = S.saveScheduledBackup('نسخة الفحص الأولى', null);
  check('saveScheduledBackup يُرجع نسخة بمعرّف وبيانات', !!b1 && !!b1.id && !!b1.data && b1.data.jobs.length > 0, JSON.stringify(b1 && Object.keys(b1)));
  check('النسخة حُفظت في localStorage فعلاً', S.getScheduledBackups().length === 1);
  check('النسخة سجّلت حجماً ووقت إنشاء صحيحاً', b1.size > 1000 && !!b1.createdAt);
  check('العملية سُجّلت في سجل التدقيق', S.listAudit({}).some((l) => /نسخة احتياطية/.test(l.action)));

  const b2 = S.saveScheduledBackup('نسخة بنطاق مخصص', { from: '2020-01-01', to: '2030-12-31' });
  check('النسخة ذات النطاق المخصص تُعلَّم كجزئية مع عدّاد سجلات', !!b2 && b2.partial === true && b2.records.applicants > 0, b2 && JSON.stringify(b2.records));
  check('exportScheduledBackup يُنتج JSON صالحاً', (() => { try { return JSON.parse(S.exportScheduledBackup(b1.id)).jobs.length > 0; } catch { return false; } })());
  check('exportScheduledBackup لمعرّف غير موجود يُرجع null', S.exportScheduledBackup('backup-لا-يوجد') === null);

  const jobsBefore = S.db().jobs.length;
  check('restoreScheduledBackup (كاملة) نجحت', S.restoreScheduledBackup(b1.id) === true);
  check('الاستعادة الكاملة أبقت عدد الوظائف', S.db().jobs.length === jobsBefore, S.db().jobs.length + ' ≠ ' + jobsBefore);
  check('الاستعادة أنشأت نسخة أمان «قبل الاستعادة»', S.getScheduledBackups().some((b) => /قبل الاستعادة/.test(b.name)));
  check('restoreScheduledBackup لمعرّف غير موجود تُرجع false', S.restoreScheduledBackup('backup-لا-يوجد') === false);

  const nBefore = S.getScheduledBackups().length;
  check('deleteScheduledBackup يحذف النسخة', S.deleteScheduledBackup(b2.id) === true && S.getScheduledBackups().length === nBefore - 1);
  check('deleteScheduledBackup لمعرّف غير موجود تُرجع false', S.deleteScheduledBackup('backup-لا-يوجد') === false);

  /* دورة كاملة: تصدير ← استيراد — يجب أن تنجو كل المفاتيح حرفياً.
     (سجل التدقيق وحده يزيد سطراً مقصوداً: «استيراد بيانات».) */
  const rt = S.saveScheduledBackup('نسخة الدورة الكاملة', null);
  const exportedRaw = S.exportScheduledBackup(rt.id);
  const beforeKeys = JSON.parse(exportedRaw);
  S.importJson(exportedRaw);
  const afterDb = S.db();
  const survived = ['meta', 'counters', 'jobs', 'applicants', 'attempts', 'settings']
    .every((k) => JSON.stringify(afterDb[k]) === JSON.stringify(beforeKeys[k]));
  check('دورة تصدير←استيراد تحفظ كل البيانات حرفياً (jobs/applicants/attempts/settings)', survived);
  check('الاستيراد يضيف سطر تدقيق مقصوداً فقط', afterDb.audit.length === beforeKeys.audit.length + 1,
    afterDb.audit.length + ' مقابل ' + (beforeKeys.audit.length + 1));

  /* الدمج الجزئي يجب ألا يكرّر السجلات */
  const partial2 = S.saveScheduledBackup('دمج جزئي', { from: '2020-01-01', to: '2030-12-31' });
  const appsBeforeMerge = S.db().applicants.length;
  S.restoreScheduledBackup(partial2.id);
  const serials = S.db().applicants.map((a) => a.serial);
  const attemptKeys = S.db().attempts.map((t) => t.serial + ':' + t.no);
  check('الاستعادة الجزئية لا تكرّر الاستمارات', S.db().applicants.length === appsBeforeMerge && new Set(serials).size === serials.length,
    S.db().applicants.length + ' مقابل ' + appsBeforeMerge);
  check('الاستعادة الجزئية لا تكرّر المحاولات', new Set(attemptKeys).size === attemptKeys.length);

  step(3, 'أمان مساحة التخزين — الحد الأقصى 20 نسخة');
  w.localStorage.removeItem('brc-scheduled-backups');
  for (let i = 0; i < 25; i++) S.saveScheduledBackup('نسخة ' + i, null);
  const kept = S.getScheduledBackups();
  check('لا يُحتفظ بأكثر من 20 نسخة (حماية localStorage)', kept.length === 20, kept.length + ' نسخة');
  check('الأقدم هي التي تُسقَط والأحدث تبقى', /نسخة 24/.test(kept[kept.length - 1].name), kept[kept.length - 1].name);
  check('listBackupMeta تُرجع بيانات وصفية بلا حمولة ثقيلة', S.listBackupMeta().every((m) => m.data === undefined && m.size > 0));

  step(4, 'محرّك الجدولة التلقائية — نسخة واحدة لكل (يوم + وقت)');
  w.localStorage.removeItem('brc-scheduled-backups');
  w.localStorage.removeItem('brc-auto-backup-schedule');
  w.localStorage.removeItem('brc-auto-backup-last-run');
  check('checkAutoBackup بلا جدولة = null', S.checkAutoBackup() === null);
  const now = new Date();
  /* وقت ثابت (12:30) حتى تكون النتيجة مستقلة عن ساعة تشغيل الاختبار */
  const SLOT_H = 12, SLOT_M = 30;
  const at = (dayOffset, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m, 0, 0);
  const saved = S.saveAutoSchedule([now.getDay()], '12:30');
  check('saveAutoSchedule يحفظ الجدولة', !!saved && saved.days.length === 1 && saved.time === '12:30');
  check('getAutoSchedule يقرأ الجدولة المحفوظة', !!S.getAutoSchedule() && S.getAutoSchedule().time === '12:30');
  check('saveAutoSchedule بلا أيام مرفوض', S.saveAutoSchedule([], '12:30') === null);
  check('قبل وقت الجدولة لا تُنشأ نسخة', S.checkAutoBackup(at(0, SLOT_H, SLOT_M - 1)) === null);
  const auto1 = S.checkAutoBackup(at(0, SLOT_H, SLOT_M));
  check('عند وقت الجدولة تُنشأ نسخة تلقائية', !!auto1 && auto1.auto === true && /نسخة تلقائية/.test(auto1.name));
  check('آخر تنفيذ سُجّل بمفتاح الخانة الزمنية (يوم+وقت)', S.lastAutoRun() === S.fmtDate(at(0, SLOT_H, SLOT_M)) + 'T12:30', S.lastAutoRun());
  check('إعادة الفحص في نفس الخانة لا تُنشئ نسخة مكرّرة', S.checkAutoBackup(at(0, SLOT_H, SLOT_M + 5)) === null && S.getScheduledBackups().length === 1);
  /* سيناريو الالتقاط الفائت الحقيقي: جدولة جديدة لم تُنفَّذ قط (08:00)
     ثم تُفتح اللوحة متأخرة (23:59) — يجب أن تُنشأ النسخة الفائتة مرة واحدة.
     (الفحص السابق كان يتحقق فقط من «عدم التكرار» ولا يثبت الالتقاط.) */
  w.localStorage.removeItem('brc-scheduled-backups');
  w.localStorage.removeItem('brc-auto-backup-last-run');
  S.saveAutoSchedule([now.getDay()], '08:00');
  check('قبل وقت الجدولة (07:59) لا نسخة', S.checkAutoBackup(at(0, 7, 59)) === null);
  const late = S.checkAutoBackup(at(0, 23, 59));
  check('التقاط النسخة الفائتة في نفس اليوم (فُتحت الصفحة متأخرة)', !!late && late.auto === true, late ? late.name : 'null');
  check('الالتقاط يُنتج نسخة واحدة ولا يكرّرها', S.getScheduledBackups().length === 1 && S.checkAutoBackup(at(0, 23, 59)) === null,
    S.getScheduledBackups().length + '');
  check('يوم غير مجدول لا يُنشئ نسخة', S.checkAutoBackup(at(1, SLOT_H, SLOT_M)) === null);
  const day2 = (now.getDay() + 1) % 7;
  check('إضافة يوم ثانٍ للجدولة تُنفَّذ في يومه (خانة زمنية جديدة)',
    !!S.saveAutoSchedule([now.getDay(), day2], '12:30') && !!S.checkAutoBackup(at(1, SLOT_H, SLOT_M)));
  check('اليوم غير المجدول لا يُنشئ نسخة', S.checkAutoBackup(at(2, SLOT_H, SLOT_M)) === null);
  check('clearAutoSchedule يمسح الجدولة وآخر تنفيذ', S.clearAutoSchedule() === true && !S.getAutoSchedule() && !S.lastAutoRun());

  step(5, 'الواجهة — كل أزرار النسخ الاحتياطي تعمل بالنقر');
  w.localStorage.removeItem('brc-scheduled-backups');
  w.localStorage.removeItem('brc-auto-backup-schedule');
  w.localStorage.removeItem('brc-auto-backup-last-run');
  S.emit(); await wait(200);

  click(doc.getElementById('btn-quick-backup')); await wait(300);
  check('زر «نسخة احتياطية سريعة» حفظ نسخة', S.getScheduledBackups().length === 1, S.getScheduledBackups().length + '');
  check('عدّاد «النسخ الاحتياطية» في الواجهة تحدّث إلى 1', txt('db-backups') === '1', txt('db-backups'));
  check('عدّادات قاعدة البيانات في الواجهة تعرض أرقاماً حقيقية', Number(txt('db-jobs')) > 0 && Number(txt('db-apps')) > 0 && Number(txt('db-audit')) > 0,
    'jobs=' + txt('db-jobs') + ' apps=' + txt('db-apps') + ' audit=' + txt('db-audit'));

  click(doc.getElementById('btn-schedule-backup')); await wait(300);
  check('زر «جدولة النسخ التلقائي» فتح نافذة النموذج', modalOpen() && !!doc.getElementById('backup-form'));
  doc.getElementById('backup-name').value = 'نسخة الواجهة المجدولة';
  const dayBoxes = doc.querySelectorAll('input[name="backup-days"]');
  check('سبعة أيام متاحة للاختيار', dayBoxes.length === 7, dayBoxes.length + '');
  dayBoxes[now.getDay()].checked = true;
  const autoBox = doc.getElementById('backup-auto');
  autoBox.checked = true;
  autoBox.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(150);
  check('تفعيل الجدولة يُظهر خيارات الأيام والوقت', doc.getElementById('schedule-options').style.display === 'block');
  doc.getElementById('backup-time').value = '23:59';   // وقت لاحق اليوم: لا يُنفَّذ أثناء الاختبار
  const cntBefore = S.getScheduledBackups().length;
  click(doc.getElementById('backup-save')); await wait(400);
  check('حفظ النافذة أنشأ نسخة جديدة', S.getScheduledBackups().length === cntBefore + 1);
  check('حفظ النافذة فعّل الجدولة التلقائية', !!S.getAutoSchedule() && S.getAutoSchedule().days.indexOf(now.getDay()) >= 0);
  check('حالة الجدولة في اللوحة تعرض «مفعّل» والأيام', /مفعّل/.test(txt('schedule-status')), txt('schedule-status'));
  check('الجدولة المحفوظة من الواجهة لا تُنفَّذ قبل وقتها',
    S.checkAutoBackup(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0)) === null);
  check('النافذة أُغلقت بعد الحفظ', !modalOpen());

  click(doc.getElementById('btn-view-backups')); await wait(300);
  check('زر «عرض النسخ الاحتياطية» فتح قائمة النسخ', modalOpen() && doc.querySelectorAll('[data-backup-export]').length === S.getScheduledBackups().length);
  check('القائمة تعرض الحجم وشارة «تلقائية»', /ك\.ب/.test(lastModal().textContent));
  const delTarget = S.getScheduledBackups().length;
  click(doc.querySelector('[data-backup-delete]')); await wait(250);
  const okBtn = lastModal().querySelector('[data-ok]');
  check('نافذة تأكيد الحذف ظهرت', !!okBtn);
  click(okBtn); await wait(400);
  check('تأكيد الحذف حذف النسخة فعلاً (كان «تأكيد» يرجع إلغاء)', S.getScheduledBackups().length === delTarget - 1,
    S.getScheduledBackups().length + ' من ' + delTarget);

  click(doc.getElementById('btn-edit-schedule')); await wait(300);
  check('زر «تعديل الجدولة» يفتح النافذة مع القيم المحفوظة', modalOpen() && doc.getElementById('backup-auto').checked === true);
  click(lastModal().querySelector('[data-close]')); await wait(250);

  click(doc.getElementById('btn-run-auto-backup')); await wait(300);
  check('زر «نفّذ نسخة الآن» أنشأ نسخة تلقائية', S.getScheduledBackups().some((b) => b.auto && /تلقائية يدوية/.test(b.name)));

  click(doc.getElementById('btn-disable-schedule')); await wait(250);
  click(lastModal().querySelector('[data-ok]')); await wait(350);
  check('زر «إيقاف الجدولة» أوقف الجدولة', !S.getAutoSchedule() && !w.localStorage.getItem('brc-auto-backup-schedule'));
  check('حالة اللوحة رجعت «لم يتم تفعيل الجدولة بعد»', /لم يتم تفعيل/.test(txt('schedule-status')), txt('schedule-status'));

  step(6, 'ثبات الربط — الأزرار تعمل بعد إعادة الرسم والتنقل');
  click(doc.querySelector('#side-nav button[data-view="overview"]')); await wait(250);
  click(doc.querySelector('#side-nav button[data-view="finance"]')); await wait(250);
  click(doc.querySelector('#side-nav button[data-view="settings"]')); await wait(250);
  const n0 = S.getScheduledBackups().length;
  click(doc.getElementById('btn-quick-backup')); await wait(300);
  check('الزر ما زال يعمل بعد التنقل بين الصفحات', S.getScheduledBackups().length === n0 + 1);
  const n1 = S.getScheduledBackups().length;
  S.emit(); await wait(250);                       // إعادة رسم قسرية (كما يفعل المؤقّت)
  click(doc.getElementById('btn-quick-backup')); await wait(300);
  check('لا ربط مكرّراً: نقرة واحدة = نسخة واحدة بعد إعادة الرسم', S.getScheduledBackups().length === n1 + 1,
    S.getScheduledBackups().length + ' مقابل متوقع ' + (n1 + 1));

  step(7, 'نوافذ التأكيد الأخرى (إعادة الضبط) — لم تنكسر بعد إصلاح UI.confirm');
  doc.querySelectorAll('#modal-root [data-close]').forEach((b) => click(b));   // إغلاق أي نافذة متبقية
  await wait(250);
  check('لا نوافذ مفتوحة قبل اختبار إعادة الضبط', !modalOpen(), doc.querySelectorAll('#modal-root .modal').length + ' نافذة');
  click(doc.getElementById('btn-reset')); await wait(300);
  const cancelBtn = lastModal() && lastModal().querySelector('[data-cancel]');
  check('نافذة تأكيد إعادة الضبط ظهرت', !!cancelBtn);
  click(cancelBtn); await wait(300);
  check('«إلغاء» يُلغي فعلاً (البيانات لم تُمسح)', S.db().jobs.length > 0 && !modalOpen());

  step(8, 'الأزرار المكمّلة — تصدير JSON / استيراد نسخة / صيانة / نسخ الرابط');
  click(doc.querySelector('#side-nav button[data-view="settings"]')); await wait(250);
  const jobsNow = S.db().jobs.length;

  // (أ) تصدير JSON الكامل
  click(doc.getElementById('btn-export')); await wait(300);
  check('زر «تصدير JSON» أنتج ملف تنزيل فعلاً', downloads.length === 1, downloads.length + ' تنزيل');
  check('اسم ملف التصدير بالصيغة brc-backup-YYYY-MM-DD.json',
    /^brc-backup-\d{4}-\d{2}-\d{2}\.json$/.test(downloads[0] ? downloads[0].name : ''), downloads[0] && downloads[0].name);

  // (ب) استيراد نسخة صالحة
  const imf = doc.getElementById('import-file');
  check('عنصر اختيار ملف الاستيراد موجود', !!imf);
  const snapshot = S.exportJson();
  const trimmed = JSON.parse(snapshot); trimmed.jobs = trimmed.jobs.slice(0, 2);
  setFile(imf, 'brc-backup.json', JSON.stringify(trimmed)); await wait(600);
  check('زر «استيراد نسخة» استورد البيانات فعلاً', S.db().jobs.length === 2, S.db().jobs.length + ' مقابل 2');
  check('الاستيراد سُجّل في سجل التدقيق', S.listAudit({}).some((l) => /استيراد/.test(l.action)));

  // (ج) ملف تالف = فشل آمن (لا مسح للبيانات)
  const beforeBad = JSON.stringify(S.db());
  setFile(imf, 'bad.json', '{"لا":"صالح"}'); await wait(500);
  check('ملف غير صالح لا يمسح البيانات (فشل آمن)', JSON.stringify(S.db()) === beforeBad);

  // (د) استعادة البيانات الأصلية عبر الاستيراد
  setFile(imf, 'brc-backup.json', snapshot); await wait(600);
  check('استعادة البيانات الأصلية عبر الاستيراد نجحت', S.db().jobs.length === jobsNow, S.db().jobs.length + ' مقابل ' + jobsNow);

  // (هـ) تشغيل قواعد الحجز التلقائي
  click(doc.getElementById('btn-maintenance')); await wait(300);
  check('زر «تشغيل قواعد الحجز التلقائي» نُفّذ بلا أخطاء JS', errors.length === 0, errors.join(' | '));

  // (و) نسخ رابط التحقق من بطاقة الاستمارة
  click(doc.querySelector('#side-nav button[data-view="applicants"]')); await wait(400);
  const openBtn = doc.querySelector('#view-applicants tbody [data-app-verify]');
  check('صفوف الاستمارات متاحة', !!openBtn);
  if (openBtn) {
    click(openBtn); await wait(400);
    const copyBtn = doc.getElementById('copy-url');
    check('زر «نسخ الرابط» موجود في بطاقة الاستمارة', !!copyBtn);
    if (copyBtn) {
      click(copyBtn); await wait(400);
      check('النسخ استُدعي عبر الحافظة', copied.length === 1, JSON.stringify(copied));
      check('الرابط منسوخ بالمسار النظيف /verify?form=..&t=..',
        /\/verify\?form=[A-Za-z0-9-]+&t=[a-z0-9]+$/.test(copied[0] || ''), copied[0]);
    }
    const cl = lastModal() && lastModal().querySelector('[data-close]');
    if (cl) { click(cl); await wait(250); }
  }

  // (ز) زر «تأكيد» في إعادة الضبط يعمل (عكس «إلغاء» في الخطوة 7)
  const seedCount = S.db().jobs.length;
  S.createJob({ title: 'وظيفة اختبار إعادة الضبط', region: 'الحلة', salaryMin: 1, salaryMax: 2, shift: 'صباحي' });
  await wait(200);
  check('أُضيفت وظيفة للتحقق من أثر إعادة الضبط', S.db().jobs.length === seedCount + 1, S.db().jobs.length + '');
  click(doc.getElementById('btn-reset')); await wait(300);
  const okReset = lastModal() && lastModal().querySelector('[data-ok]');
  check('نافذة تأكيد إعادة الضبط ظهرت مرة أخرى', !!okReset);
  if (okReset) {
    click(okReset); await wait(700);
    check('«تأكيد» حذف الوظيفة المضافة وأعاد البيانات التجريبية', S.db().jobs.length === seedCount,
      S.db().jobs.length + ' مقابل ' + seedCount);
    check('«تأكيد» سُجّل في سجل التدقيق', S.listAudit({}).some((l) => /إعادة ضبط/.test(l.action)));
    check('النافذة أُغلقت بعد التأكيد', !modalOpen());
  }
  check('لا أخطاء JavaScript في كل خطوات الأزرار المكمّلة', errors.length === 0, errors.join(' | '));

  w.close && w.close();
} catch (e) {
  bad('خطأ غير متوقع في الاختبار', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
} finally {
  server.kill('SIGTERM');
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
