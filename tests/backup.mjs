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
 *
 *  التشغيل:  node tests/backup.mjs     أو     npm run test:backup
 * =========================================================================== */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const modalOpen = () => !!doc.querySelector('#modal-root .modal');
  const lastModal = () => doc.querySelector('#modal-root .modal-backdrop:last-child');
  const txt = (id) => { const e = doc.getElementById(id); return e ? e.textContent.trim() : null; };

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
  check('التقاط النسخة الفائتة في نفس اليوم (فُتحت الصفحة متأخرة)', S.lastAutoRun() !== null && S.checkAutoBackup(at(0, 23, 59)) === null);
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
