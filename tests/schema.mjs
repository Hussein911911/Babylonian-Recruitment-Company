#!/usr/bin/env node
/* ===========================================================================
 *  BRC — فحص سلامة مخطط قاعدة البيانات (docs/schema.sql)
 *  ---------------------------------------------------------------------------
 *  لماذا هذا الملف؟ لأن أخطاء المخطط لا تظهر في أي اختبار آخر:
 *  الملف لم يكن يُنفَّذ قطّ في CI، فبقيت أخطاء تمنع تشغيله على Supabase دون
 *  أن يلاحظها أحد (مرجع أمامي + تكرار RLS لانهائي + كتابة داخل دالة STABLE
 *  + سياسة بلا drop + منح واجهة حسّاسة للزائر).
 *  هذا الفحص يحوّل كل واحدة منها إلى اختبار يفشل إذا عادت.
 *
 *  التشغيل:  node tests/schema.mjs     أو     npm run test:schema
 *
 *  لا يحتاج قاعدة بيانات ولا حزماً خارجية — تحليل نصي دقيق مع تجريد كتل
 *  الاقتباس الدولاري ($$…$$) حتى لا تتشوّش الأجساد الداخلية للدوال.
 * =========================================================================== */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = readFileSync(join(ROOT, 'docs', 'schema.sql'), 'utf8');

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, cond, detail) => (cond ? ok(t) : bad(t, detail));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

/* تجريد الاقتباس الدولاري: نُبقي الأجساد منفصلة كي لا تُشوّش على تحليل البنية */
const DOLLAR = /\$([a-zA-Z_]*)\$([\s\S]*?)\$\1\$/g;
const BODIES = [];
const STRUCTURE = RAW.replace(DOLLAR, (m, tag, body) => { BODIES.push(body); return ' §BODY' + (BODIES.length - 1) + ' '; });
const ALL_BODIES = BODIES.join('\n');
const stripped = (s) => s.replace(/--[^\n]*/g, '');

console.log('\n' + '═'.repeat(74));
console.log('  BRC — فحص سلامة مخطط قاعدة البيانات (docs/schema.sql)');
console.log('═'.repeat(74));

/* ------------------------- 1) ترتيب الجداول والمراجع الأمامية ------------------------- */
step(1, 'ترتيب إنشاء الجداول — لا مرجع أمامي');

const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)\s*\(([\s\S]*?)\n\);/gi;
const tables = [];
let m;
while ((m = tableRe.exec(stripped(STRUCTURE)))) tables.push({ name: m[1].toLowerCase(), body: m[2] });
const order = {};
tables.forEach((t, i) => { if (!(t.name in order)) order[t.name] = i; });

check('المخطط يعرّف الجداول الستة المتوقّعة', tables.length === 6,
  tables.length + ': ' + tables.map((t) => t.name).join(', '));

const SYSTEM = new Set(['auth.users', 'auth.identities', 'storage.objects']);
const forward = [];
for (const t of tables) {
  const refs = [...stripped(t.body).matchAll(/references\s+([\w.]+)\s*\(/gi)].map((x) => x[1].toLowerCase());
  for (const r of new Set(refs)) {
    if (SYSTEM.has(r)) continue;
    if (!(r in order)) { forward.push(`${t.name} → ${r} (غير معرّف)`); continue; }
    if (order[r] > order[t.name]) forward.push(`${t.name} (جدول ${order[t.name] + 1}) → ${r} (جدول ${order[r] + 1})`);
  }
}
check('كل مرجع لجدول يشير إلى جدول مُنشأ قبله', forward.length === 0, forward.join(' | '));
check('brc.applicants يُنشأ قبل brc.jobs (كان المرجع أمامياً معطِّلاً)', order['brc.applicants'] < order['brc.jobs'],
  `applicants=${order['brc.applicants']} jobs=${order['brc.jobs']}`);

/* ------------------------- 2) تصنيف الدوال مقابل الكتابة ------------------------- */
step(2, 'الدوال — لا كتابة داخل دالة غير volatile');

const funcRe = /create\s+or\s+replace\s+function\s+([\w.]+)\s*\([^)]*\)\s*returns[\s\S]*?(?=create\s+or\s+replace\s+function|create\s+trigger|create\s+policy|create\s+or\s+replace\s+view|alter\s+table|$)/gi;
const funcs = [];
let f;
while ((f = funcRe.exec(stripped(RAW)))) funcs.push({ name: f[1], text: f[0] });

check('عدد الدوال المتوقّع (15)', funcs.length === 15, funcs.length + '');

const badVol = funcs.filter((fn) =>
  /\b(stable|immutable)\b/i.test(fn.text) && /\binsert\s+into\b|\bupdate\s+[\w.]+\s+set\b|\bdelete\s+from\b/i.test(fn.text));
check('لا دالة تكتب (insert/update/delete) وهي مصنّفة stable/immutable', badVol.length === 0,
  badVol.map((x) => x.name).join(', '));

const vf = funcs.find((x) => /brc\.verify_form/.test(x.name));
check('brc.verify_form ليست stable (تكتب سطر تدقيق)', !!vf && !/\bstable\b/i.test(vf.text.slice(0, 400)),
  vf ? 'تجد stable' : 'الدالة غير موجودة');

/* ------------------------- 3) أمان دوال security definer ------------------------- */
step(3, 'دوال security definer — search_path ثابت');

const secdef = funcs.filter((fn) => /security\s+definer/i.test(fn.text.slice(0, 700)));
check('توجد دوال security definer', secdef.length > 0, secdef.length + '');
const noPath = secdef.filter((fn) => !/set\s+search_path/i.test(fn.text.slice(0, 700)));
check('كل دوال security definer تثبّت search_path (منع اختطاف المسار)', noPath.length === 0,
  noPath.map((x) => x.name).join(', '));

for (const need of ['brc.is_staff', 'brc.is_admin', 'brc.current_staff_id']) {
  const fn = funcs.find((x) => x.name.toLowerCase() === need);
  const head = fn ? fn.text.slice(0, 700) : '';
  check(`${need} هي security definer (وإلا: infinite recursion في سياسات brc.staff)`,
    /security\s+definer/i.test(head), fn ? 'ليست security definer' : 'غير موجودة');
}

/* ------------------------- 4) السياسات — drop قبل create ------------------------- */
step(4, 'سياسات RLS — كل create له drop مطابق (قابل لإعادة التشغيل)');

const polCreates = [...stripped(RAW).matchAll(/create\s+policy\s+(\w+)\s+on\s+([\w.]+)/gi)].map((x) => `${x[1].toLowerCase()}@${x[2].toLowerCase()}`);
const polDrops = new Set([...stripped(RAW).matchAll(/drop\s+policy\s+if\s+exists\s+(\w+)\s+on\s+([\w.]+)/gi)].map((x) => `${x[1].toLowerCase()}@${x[2].toLowerCase()}`));
const missingDrop = polCreates.filter((p) => !polDrops.has(p));
check('لا سياسة تُنشأ بلا drop مطابق', missingDrop.length === 0, missingDrop.join(', '));

const rlsTables = [...stripped(RAW).matchAll(/alter\s+table\s+([\w.]+)\s+enable\s+row\s+level\s+security/gi)].map((x) => x[1].toLowerCase());
check('RLS مُفعَّل على كل جداول البيانات', ['brc.staff', 'brc.jobs', 'brc.applicants', 'brc.job_attempts', 'brc.audit_log', 'brc.settings']
  .every((t) => rlsTables.includes(t)), rlsTables.join(', '));

/* ------------------------- 5) المنح — لا كشف للزائر ------------------------- */
step(5, 'الصلاحيات — لا واجهة حسّاسة ممنوحة للزائر');

const grantLines = stripped(RAW).split('\n').filter((l) => /^\s*grant\s/i.test(l));
const anonGrants = grantLines.filter((l) => /\bto\b[^;]*\banon\b/i.test(l));
const anonTargets = anonGrants.join(' ');
check('brc.public_verification ليست ممنوحة لدور anon (منع تسريب أسماء الباحثين)',
  !/public_verification/i.test(anonTargets), anonTargets.slice(0, 160));
check('الزائر يستطيع قراءة brc.public_jobs فقط', /public_jobs/i.test(anonTargets));
check('الزائر يستطيع نداء brc.verify_form', /verify_form/i.test(anonTargets));
check('لا جدول حساس ممنوح للزائر مباشرة',
  !/\b(applicants|audit_log|staff|settings)\b/i.test(grantLines.filter((l) => /\banon\b/i.test(l) && !/revoke/i.test(l)).join(' ')));

/* ------------------------- 5ب) منح الدوال للزائر ------------------------- */
step('5ب', 'منح الدوال — لا دالة حسّاسة قابلة للنداء من الزائر');

/* PostgreSQL يمنح EXECUTE لدور PUBLIC تلقائياً على كل دالة جديدة، وكل الأدوار
   أعضاء في PUBLIC. فكل دالة لا يُبطَل منحها صراحةً **قابلة للنداء من anon** عبر
   /rest/v1/rpc/<name>. هذا الفحص يمنع عودة تلك الثغرة. */
const ALL_FUNCS = [
  'brc.verify_token(text)', 'brc.next_job_code()', 'brc.next_form_serial()',
  'brc.run_auto_release()', 'brc.is_staff()', 'brc.is_admin()', 'brc.current_staff_id()'
];
const revokedFromPublic = [...stripped(RAW).matchAll(/revoke\s+execute\s+on\s+function\s+([\w.]+\([^)]*\))\s+from\s+public/gi)]
  .map((x) => x[1].replace(/\s+/g, '').toLowerCase());
const notRevoked = ALL_FUNCS.filter((f) => !revokedFromPublic.includes(f.replace(/\s+/g, '').toLowerCase()));

check('كل دالة حسّاسة مُبطَلة من دور public (وإلا يصلها الزائر عبر RPC)', notRevoked.length === 0,
  'غير مُبطَلة: ' + notRevoked.join(', '));
check('brc.verify_token مُبطَلة تحديداً (من يملكها يصوغ كيو آر كود مزيّفاً)',
  revokedFromPublic.includes('brc.verify_token(text)'));
check('الإبطال من public وليس من anon فقط (anon يورث من public فلا يكفي)',
  revokedFromPublic.length > 0 && !/revoke\s+execute[\s\S]{0,80}?from\s+anon\s*;/i.test(stripped(RAW)));

/* الدوال التي يناديها الموظف عبر RLS/المشغّلات يجب أن تُعاد له صراحةً */
const grantedAuth = [...stripped(RAW).matchAll(/grant\s+execute\s+on\s+function\s+([\w.]+\([^)]*\))\s+to\s+([^;]+);/gi)]
  .map((x) => ({ fn: x[1].replace(/\s+/g, '').toLowerCase(), to: x[2] }));
for (const need of ['brc.is_staff()', 'brc.is_admin()', 'brc.current_staff_id()', 'brc.next_job_code()', 'brc.next_form_serial()']) {
  const g = grantedAuth.find((x) => x.fn === need.replace(/\s+/g, '').toLowerCase());
  check(`${need} مُعاد منحها لـ authenticated بعد الإبطال (وإلا يفشل وصول الموظف)`,
    !!g && /authenticated/i.test(g.to), g ? g.to.trim() : 'لا منح');
}
check('brc.verify_token غير ممنوحة لأي دور (تُنادى داخلياً من دالة SECURITY DEFINER)',
  !grantedAuth.some((x) => x.fn === 'brc.verify_token(text)'),
  grantedAuth.filter((x) => x.fn === 'brc.verify_token(text)').map((x) => x.to).join(', '));

/* ------------------------- 6) الأسرار المكشوفة ------------------------- */
step(6, 'الأسرار — لا مفتاح مكتوب في المستودع');

const secretDefaults = [...RAW.matchAll(/coalesce\s*\(\s*current_setting\(\s*'app\.brc_secret'[^)]*\)\s*,\s*'([^']+)'/gi)];
check('لا سرّ افتراضي مكتوب في ملف المخطط', secretDefaults.length === 0,
  secretDefaults.map((x) => x[1]).join(', '));
const tokenFn = RAW.slice(RAW.indexOf('function brc.verify_token'));
check('verify_token ترفض العمل بلا مفتاح مضبوط (بدل استخدام سرّ مكشوف)',
  /raise\s+exception/i.test(tokenFn.slice(0, 1800)));
check('verify_token تشمل سكيما extensions في search_path (pgcrypto في Supabase)',
  /set\s+search_path\s*=\s*brc,\s*public,\s*extensions/i.test(tokenFn.slice(0, 1200)));

/* ------------------------- 7) الامتدادات ------------------------- */
step(7, 'الامتدادات — فشلها لا يُسقط السكربت');

const extIdx = stripped(RAW).indexOf('create extension');
const firstExt = stripped(RAW).slice(extIdx, extIdx + 400);
check('إنشاء الامتدادات مُغلَّف بحيث لا يُسقط الملف كله', /do\s+\$\$/i.test(firstExt) || /exception\s+when/i.test(firstExt),
  firstExt.slice(0, 120));
check('pg_cron مُعالَج (الإفراج التلقائي كل دقيقة)', /pg_cron/i.test(RAW));
check('جدولة cron.schedule محمية بـ exception', /cron\.schedule[\s\S]{0,600}?exception\s+when/i.test(RAW));

/* ------------------------- 8) الاكتمال الوظيفي ------------------------- */
step(8, 'الاكتمال — كل ما وعد به المخطط موجود فعلاً');

for (const [label, re] of [
  ['تسلسل أكواد الوظائف (BRC-####)', /create\s+sequence\s+if\s+not\s+exists\s+brc\.job_code_seq/i],
  ['تسلسل أرقام الاستمارات (BRC-NO-######)', /create\s+sequence\s+if\s+not\s+exists\s+brc\.form_serial_seq/i],
  ['دالة ترشيح وظيفة (منع الحجز المزدوج)', /function\s+brc\.select_attempt/i],
  ['دالة تثبيت نتيجة المقابلة', /function\s+brc\.set_outcome/i],
  ['دالة إفراج يدوي عن حجز', /function\s+brc\.release_hold/i],
  ['دالة إفراج تلقائي مجدول', /function\s+brc\.run_auto_release/i],
  ['دالة التحقق بالكيو آر كود', /function\s+brc\.verify_form/i],
  ['واجهة اللوحة المالية', /view\s+brc\.v_financials_by_staff/i],
  ['واجهة الإجراءات المطلوبة', /view\s+brc\.v_pending_actions/i],
  ['عمود IP في سجل التدقيق', /brc\.audit_log[\s\S]*?\bip\s+text/i],
  ['Realtime على الجداول الحيّة', /alter\s+publication\s+supabase_realtime/i]
]) check(label, re.test(RAW));

const trigCount = [...stripped(RAW).matchAll(/create\s+trigger\s+\w+/gi)].length;
check('المشغّلات السبعة موجودة (توليد الأكواد/الحجز/التدقيق)', trigCount === 7, trigCount + '');

/* ------------------------- 9) مزامنة ملف الـ migration ------------------------- */
step(9, 'ملف الـ migration — متطابق مع المصدر (تكاملة GitHub في Supabase)');

const MIG_DIR = join(ROOT, 'supabase', 'migrations');
const MIG_NAME = '20260915000000_brc_initial_schema.sql';
let migNames = [];
try { migNames = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')); } catch { migNames = []; }

check('مجلد supabase/migrations موجود وفيه ملف', migNames.length > 0, 'الموجود: ' + (migNames.join(', ') || 'لا شيء'));
check('اسم ملف الـ migration ثابت ومعروف', migNames.includes(MIG_NAME), migNames.join(', '));

if (migNames.includes(MIG_NAME)) {
  const migSql = readFileSync(join(MIG_DIR, MIG_NAME), 'utf8');
  check('ملف الـ migration مطابق حرفياً لـ docs/schema.sql (لا انحراف)',
    migSql === RAW,
    'حجم المصدر ' + RAW.length + ' مقابل ' + migSql.length +
    ' — شغّل npm run schema:sync');
  check('ملف الـ migration صالح نحوياً', /create\s+table\s+if\s+not\s+exists\s+brc\.staff/i.test(migSql));
  /* نجرّد التعليقات أولاً: الملف يشرح كيفية ضبط السرّ داخل تعليق (وهذا مقصود
     وليس سرّاً). الفحص يهدف إلى كشف سرّ **فعلي** في كود قابل للتنفيذ. */
  const migBare = migSql.replace(/--[^\n]*/g, '');
  check('ملف الـ migration لا يحوي سرّاً فعلياً (المستودع عام)',
    !/app\.brc_secret\s*=\s*'[^']+'/i.test(migBare) && !/sb_secret_[A-Za-z0-9]/i.test(migBare),
    'وُجد تعيين سرّ في كود قابل للتنفيذ');
} else {
  bad('ملف الـ migration مطابق', 'غير موجود');
}

/* ---------------------------------- الخلاصة ---------------------------------- */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
