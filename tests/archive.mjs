#!/usr/bin/env node
/* ===========================================================================
 *  BRC — اختبار «أرشيف التلكرام»
 *  ---------------------------------------------------------------------------
 *  الميزة: ملف HTML واحد يُرسل بتلكرام، ومن يضغط عليه يفتح الموقع كاملاً
 *  بلا إنترنت — ليطمئن الزبون أن الشركة مستمرة حتى لو تعطّل الموقع.
 *
 *  لماذا هذا الاختبار مهم أكثر من غيره؟
 *    لأن الخطأ هنا **تسريب بيانات**، لا خلل تجميلي. الأرشيف الكامل يحمل أسماء
 *    المتقدمين وأرقام هواتفهم وعناوينهم وبيانات أصحاب العمل. لو تسرّب أيٌّ من
 *    ذلك إلى النسخة «العامة» المعدّة للزبائن، فالضرر قانوني وأخلاقي لا يُرمَّم.
 *    لذلك نفحص التنقية بقيم فريدة (ZZ…) لا توجد في بيانات البذرة — لأن الفحص
 *    ببيانات البذرة يعطي نتيجة كاذبة: النص موجود في القالب أصلاً.
 *
 *  ماذا يفحص؟
 *    1) الأرشيف العام لا يحتوي أي بيان شخصي (10 حقول حسّاسة)
 *    2) الأرشيف العام يحتفظ بالوظائف المعلنة (وإلا فالأرشيف بلا فائدة)
 *    3) الأرشيف الكامل يحتفظ بكل شيء + شريط تحذير أحمر
 *    4) الأرشيف يفتح فعلاً ويقرأ بياناته المحقونة (محاكاة فتحه من تلكرام)
 *    5) أسماء الملفات تميّز العام من الخاص
 *    6) إعداد تلكرام لا يُكتب في الكود المصدري أبداً
 *
 *  التشغيل:  node tests/archive.mjs   أو   npm run test:archive
 * =========================================================================== */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const { JSDOM, VirtualConsole } = require('jsdom');

let pass = 0, fail = 0;
const problems = [];
const ok  = (m) => { pass++; console.log('  ✅ ' + m); };
const bad = (m, d) => { fail++; problems.push(m + (d ? ' — ' + d : '')); console.log('  ❌ ' + m + (d ? '  → ' + d : '')); };

console.log('\n' + '═'.repeat(74));
console.log('  أرشيف التلكرام — تنقية البيانات وصلاحية الملف');
console.log('═'.repeat(74) + '\n');

/* قيم فريدة لا توجد في بيانات البذرة داخل config.js — شرط أساسي لصدق الفحص */
const SENSITIVE = {
  'اسم المتقدم': 'ZZAPPLICANT9001',
  'هاتف المتقدم': '07999222333',
  'عنوان المتقدم': 'ZZHOME',
  'تاريخ الميلاد': '1990-01-01',
  'اسم صاحب العمل': 'ZZEMPLOYER9001',
  'هاتف صاحب العمل': '07999000111',
  'عنوان صاحب العمل': 'ZZADDR',
  'مكان المقابلة': 'ZZINTERVIEW',
  'مستخدم في السجل': 'ZZAUDITUSER',
  'كلمة مرور': 'ZZSECRET9001'
};

const db = {
  jobs: [{
    code: 'ZZQ-9001', title: 'وظيفة اختبار', status: 'متاحة', region: 'الحلة',
    employer: { name: 'ZZEMPLOYER9001', phone: '07999000111', address: 'ZZADDR' },
    interviewLocation: 'ZZINTERVIEW'
  }],
  applicants: [{ serial: 'ZZ-NO-9001', fullName: 'ZZAPPLICANT9001', phone: '07999222333', address: 'ZZHOME', dob: '1990-01-01' }],
  attempts: [{ serial: 'ZZ-NO-9001', code: 'ZZQ-9001' }],
  audit: [{ ts: '2026-09-19T10:00:00Z', user: 'ZZAUDITUSER', action: 'إصدار' }],
  users: [{ user: 'admin', pass: 'ZZSECRET9001' }],
  settings: { attemptLimit: 5 }, counters: { serial: 120 }
};

function buildBoth() {
  const archiveSrc = readFileSync(join(ROOT, 'assets/js/archive.js'), 'utf8');
  const template = readFileSync(join(ROOT, 'brc-standalone.html'), 'utf8');
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { url: 'https://brc.dev/dashboard', runScripts: 'outside-only' });
  const w = dom.window;
  /* ⚠️ الاسم الحقيقي في الإنتاج هو BRCStore لا Store — استعمال الاسم الخطأ
     هنا أخفى عطلاً حقيقياً: الزر كان يقول «لم تتوفر البيانات» في اللوحة
     الفعلية بينما الاختبار أخضر. لا تضع w.Store هنا أبداً. */
  w.BRCStore = { exportJson: () => JSON.stringify(db) };
  w.fetch = () => Promise.resolve({ ok: true, status: 200, text: async () => template });
  w.File = class { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = (o || {}).type; } };
  w.eval(archiveSrc);
  return Promise.all([w.BRCArchive.build({ full: false }), w.BRCArchive.build({ full: true })])
    .then(([pub, full]) => ({ pub, full, api: w.BRCArchive }));
}

try {
  const { pub, full, api } = await buildBoth();

  /* 1) التنقية — الفحص الأهم */
  console.log('  1) الأرشيف العام: تنقية البيانات الشخصية');
  const leaked = Object.keys(SENSITIVE).filter((k) => pub.html.includes(SENSITIVE[k]));
  if (leaked.length) bad('الأرشيف العام خالٍ من كل بيان شخصي', 'سرّب: ' + leaked.join(' · '));
  else ok('الأرشيف العام خالٍ من كل بيان شخصي (' + Object.keys(SENSITIVE).length + ' حقلاً حسّاساً مفحوصاً)');

  /* 2) ومع ذلك يبقى مفيداً */
  if (pub.html.includes('ZZQ-9001')) ok('الأرشيف العام يحتفظ بالوظائف المعلنة (يبقى ذا فائدة للزبون)');
  else bad('الأرشيف العام يحتفظ بالوظائف المعلنة', 'الوظيفة غير موجودة — الأرشيف بلا فائدة');

  /* 3) الأرشيف الكامل */
  console.log('\n  2) الأرشيف الكامل: للإدارة وحدها');
  const missing = Object.keys(SENSITIVE).filter((k) => !full.html.includes(SENSITIVE[k]));
  if (missing.length) bad('الأرشيف الكامل يحفظ كل البيانات', 'ناقص: ' + missing.join(' · '));
  else ok('الأرشيف الكامل يحفظ كل البيانات (نسخة استرجاع حقيقية)');

  const warn = 'يُمنع تحويله';
  if (full.html.includes(warn)) ok('الأرشيف الكامل يحمل شريط تحذير ظاهراً بأنه يحوي بيانات شخصية');
  else bad('الأرشيف الكامل يحمل شريط تحذير', 'لا شريط — قد يُحوَّل لزبون بالخطأ');
  if (!pub.html.includes(warn)) ok('الأرشيف العام بلا شريط تحذير (لا داعي لإخافة الزبون)');
  else bad('الأرشيف العام بلا شريط تحذير', 'ظهر التحذير في النسخة العامة');

  /* 4) أسماء الملفات تميّز الواحد من الآخر */
  console.log('\n  3) أسماء الملفات');
  if (/خاص|للإدارة/.test(full.name)) ok('اسم الأرشيف الكامل يُنذر بخصوصيته: ' + full.name);
  else bad('اسم الأرشيف الكامل يُنذر بخصوصيته', full.name);
  if (!/خاص|للإدارة/.test(pub.name) && /بابل/.test(pub.name)) ok('اسم الأرشيف العام مناسب للزبون: ' + pub.name);
  else bad('اسم الأرشيف العام مناسب للزبون', pub.name);

  /* 5) هل يفتح فعلاً؟ — لا قيمة لأرشيف لا يعمل */
  console.log('\n  4) فتح الأرشيف (محاكاة الضغط عليه في تلكرام)');
  const vc = new VirtualConsole();          // نكتم ضجيج الموارد الخارجية
  const dom2 = new JSDOM(pub.html, {
    url: 'https://offline.local/arc.html', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc
  });
  await new Promise((r) => setTimeout(r, 1500));
  const w2 = dom2.window;
  let stored = {}, meta = {};
  try {
    stored = JSON.parse(w2.localStorage.getItem('brc_db_v2') || '{}');
    meta = JSON.parse(w2.localStorage.getItem('brc_archive_meta') || '{}');
  } catch (e) { /* يُبلَّغ أدناه */ }

  if (stored.jobs && stored.jobs.length) ok('الأرشيف يفتح ويحمّل بياناته المحقونة (' + stored.jobs.length + ' وظيفة)');
  else bad('الأرشيف يفتح ويحمّل بياناته', 'لم تُقرأ أي وظيفة من التخزين');
  if (stored.jobs && stored.jobs[0] && !stored.jobs[0].employer) ok('بيانات صاحب العمل محذوفة من الأرشيف المفتوح فعلياً');
  else bad('بيانات صاحب العمل محذوفة من الأرشيف المفتوح', 'ما زالت موجودة بعد التحميل');
  if ((stored.applicants || []).length === 0) ok('قائمة المتقدمين فارغة في الأرشيف العام المفتوح');
  else bad('قائمة المتقدمين فارغة في الأرشيف العام', (stored.applicants || []).length + ' متقدم');
  if (meta.mode === 'public') ok('الأرشيف موسوم بنوعه وتاريخه (' + (meta.createdAt || '').slice(0, 10) + ')');
  else bad('الأرشيف موسوم بنوعه', 'mode=' + meta.mode);
  w2.close && w2.close();

  /* 5.5) أسماء العوالم الحقيقية — هذا الفحص وُلد من عطلين فعليين:
         archive.js كان يقرأ root.Store و root.UI، والاسمان الصحيحان
         BRCStore و BRCUI. النتيجة كانت: «لم تتوفر البيانات»، ثم أسوأ —
         بلاغ نجاح بلا تنزيل فعلي (الحارس `if (root.UI && …)` تخطّى بصمت). */
  console.log('\n  5) أسماء العوالم (مصدر عطلين سابقين)');
  const arcSrc = readFileSync(join(ROOT, 'assets/js/archive.js'), 'utf8');
  if (/root\.BRCStore/.test(arcSrc)) ok('archive.js يقرأ المتجر باسمه الصحيح BRCStore');
  else bad('archive.js يقرأ المتجر باسمه الصحيح', 'لا ذكر لـ root.BRCStore');
  if (/root\.BRCUI/.test(arcSrc)) ok('archive.js يستعمل BRCUI الصحيح للتنزيل');
  else bad('archive.js يستعمل BRCUI للتنزيل', 'لا ذكر لـ root.BRCUI');
  /* لا حارس صامت حول التنزيل: الفشل يجب أن يُرى لا أن يُبلَّغ كنجاح */
  if (/throw new Error\([^)]*\)[\s;]*\n\s*U\.download/.test(arcSrc) || /if \(!U \|\| !U\.download\) throw/.test(arcSrc)) {
    ok('فشل التنزيل يرمي خطأً صريحاً (لا بلاغ نجاح كاذب)');
  } else bad('فشل التنزيل يرمي خطأً صريحاً', 'قد يُبلّغ بالنجاح بلا تنزيل');

  /* 6) لا مفاتيح في الكود — الموقع ثابت بلا خادم، وأي توكن فيه يقرأه الزائر */
  console.log('\n  6) أمان إعداد تلكرام');
  const archiveSrc = readFileSync(join(ROOT, 'assets/js/archive.js'), 'utf8');
  const hardcoded = /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/.test(archiveSrc);
  if (hardcoded) bad('لا توكن بوت مكتوب في الكود', 'وُجد ما يشبه توكناً حقيقياً');
  else ok('لا توكن بوت مكتوب في الكود (يُحفظ في جهاز الإدارة وحده)');
  if (typeof api.getTelegram === 'function' && typeof api.setTelegram === 'function') {
    ok('إعداد تلكرام يُدار وقت التشغيل عبر getTelegram/setTelegram');
  } else bad('إعداد تلكرام يُدار وقت التشغيل', 'الدوال غير مُصدَّرة');

  /* 7) توزيع archive.js: في اللوحة نعم، وفي الملف المستقل لا.
        نفحص **تعريف الوحدة** (root.BRCArchive = {…}) لا مجرد ذكر الاسم، لأن
        dashboard.js يذكره في تعليق وفي حارس `if (!window.BRCArchive)` وهما
        يُدمجان في المستقل بطبيعة الحال. */
  console.log('\n  7) توزيع الوحدة على المخرجات');
  const DEF = /root\.BRCArchive\s*=/;
  const standalone = readFileSync(join(ROOT, 'brc-standalone.html'), 'utf8');
  if (!DEF.test(standalone)) ok('archive.js مُستثنى من الملف المستقل (لا أرشفة ذاتية ولا حجم زائد)');
  else bad('archive.js مُستثنى من الملف المستقل', 'تعريف BRCArchive مدموج في brc-standalone.html');

  /* اللوحة تحمّله **عند الطلب** لا في الترويسة: 13KB لا يدفعها كل فتح للوحة
     (ميزانية الأداء 700KB رفضت الإدراج المباشر). نتأكد أن اللودر موجود وأن
     الملف نفسه منشور فعلاً — وإلا فشل التحميل عند أول ضغطة. */
  /* dashboard.html يربط dashboard.js كملف خارجي، فاللودر يُفحص في المصدر */
  const dashJs = readFileSync(join(ROOT, 'assets/js/dashboard.js'), 'utf8');
  if (/function loadArchive/.test(dashJs) && /assets\/js\/archive\.js/.test(dashJs)) {
    ok('اللوحة تحمّل archive.js عند الطلب (لا وزن زائد على كل فتح)');
  } else bad('اللوحة تحمّل archive.js عند الطلب', 'لم يُعثر على loadArchive أو مسار الملف');
  const dash = readFileSync(join(ROOT, 'dashboard.html'), 'utf8');
  if (!/src="[^"]*archive\.js/.test(dash)) ok('archive.js ليس في ترويسة اللوحة (يبقى داخل ميزانية الأداء)');
  else bad('archive.js ليس في ترويسة اللوحة', 'مُدرج مباشرة — يزيد وزن كل فتح');
  if (existsSync(join(ROOT, 'assets/js/archive.js'))) ok('ملف archive.js منشور ومتاح للتحميل');
  else bad('ملف archive.js منشور', 'غير موجود — سيفشل التحميل عند الضغط');

  /* الزر نفسه موجود في اللوحة ومحجوب في المستقل */
  if (/id="btn-archive-share"/.test(dash)) ok('زر «أرشيف للتلكرام» موجود في اللوحة');
  else bad('زر «أرشيف للتلكرام» موجود في اللوحة', 'لم يُعثر على الزر');
  if (/arcBtn && isStandaloneBuild\(\)/.test(standalone) && /#route-site/.test(standalone)) ok('الزر يُخفى تلقائياً في الملف المستقل (حيث لا يمكن أن يعمل)');
  else bad('الزر يُخفى في الملف المستقل', 'سيظهر زر يفشل عند الضغط');

} catch (e) {
  bad('خطأ غير متوقع في الاختبار', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
