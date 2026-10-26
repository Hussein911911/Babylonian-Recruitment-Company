#!/usr/bin/env node
/* ===========================================================================
 *  HRC — فحص سلامة مخطط قاعدة البيانات (docs/schema.sql)
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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
console.log('  HRC — فحص سلامة مخطط قاعدة البيانات (docs/schema.sql)');
console.log('═'.repeat(74));

/* ------------------------- 1) ترتيب الجداول والمراجع الأمامية ------------------------- */
step(1, 'ترتيب إنشاء الجداول — لا مرجع أمامي');

const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)\s*\(([\s\S]*?)\n\);/gi;
const tables = [];
let m;
while ((m = tableRe.exec(stripped(STRUCTURE)))) tables.push({ name: m[1].toLowerCase(), body: m[2] });
const order = {};
tables.forEach((t, i) => { if (!(t.name in order)) order[t.name] = i; });

/* 8 = الستة + سجل الباركودات issued_serials + جدول التحقق الخاص employer_otp. */
check('المخطط يعرّف 16 جدولاً بما فيها النسخ الخاصة', tables.length === 16,
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

/* 30 = 29 السابقة + إصلاح 2026-10-06: ترميم خانات الفرص الناقصة
   (ensure_card_attempts) — بطاقة جديدة كانت تظهر «انتهت فرصك» بلا أي تقديم
   لأن مزامنة لوحة الموظفين كانت تحذف خاناتها من القاعدة. */
/* 2026-10-25: حُذفت 6 دوال ميتة بلا أي مستخدم — employer_view · employer_decide
   (ومعهما employer_decide_original على القاعدة) وemployer_otp_issue/delivery/
   verify/action — بعد حذف مسار صاحب العمل من الويب. فصار العدد 49 تعريفاً
   و47 دالة فعلية (trg_attempt_hold وrun_auto_release معرَّفتان مرتين). */
/* 2026-10-25 (لاحقاً): +5 دوال لجدولة النسخ التي يضبطها المدير
   (recovery_cron_expr · _schedule_get · _schedule_set · _run_scheduled ·
   recovery_ensure_fresh) ⇒ 54 تعريفاً و52 دالة فعلية. */
check('تعريفات الدوال: 54 تعريفاً، 52 دالة فعلية (تحديثان مقصودان)',
  funcs.length === 54 && new Set(funcs.map(x=>x.name)).size === 52,
  funcs.length + ' — ' + funcs.map((x) => x.name).join(', '));
/* كل دالة جديدة تُذكر هنا بالاسم: العدد وحده لا يكشف خطأً في الاسم أو حذفاً
   لدالة قديمة، والأسماء هي ما يُنادى فعلاً من الواجهة. */
const EXPECTED_FUNCS = ['brc.recovery_manage', 'brc.office_submit', 'brc.next_job_code', 'brc.next_form_serial', 'brc.verify_token',
  'brc.trg_defaults', 'brc.trg_attempt_hold', 'brc.trg_no_duplicate_job', 'brc.trg_audit',
  'brc.run_auto_release', 'brc.is_staff', 'brc.is_admin', 'brc.current_staff_id',
  'brc.verify_form', 'brc.request_form', 'brc.mask_name', 'brc.mask_phone',
  'brc.select_attempt', 'brc.set_outcome', 'brc.release_hold',
  'brc.activate_card',
  'brc.self_service_card', 'brc.apply_with_card', 'brc.ensure_card_attempts',
  'brc.recovery_cron_expr', 'brc.recovery_schedule_get', 'brc.recovery_schedule_set',
  'brc.recovery_run_scheduled', 'brc.recovery_ensure_fresh'];
/* 2026-10-25: حُذف رمز صاحب العمل — لا دوال OTP ولا PIN ولا employer_view/
   employer_decide تُتوقَّع بعد اليوم. */
check('كل الدوال المتوقّعة موجودة بالاسم', EXPECTED_FUNCS.every((n) => funcs.some((x) => x.name === n)),
  'المفقود: ' + EXPECTED_FUNCS.filter((n) => !funcs.some((x) => x.name === n)).join(', '));

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
/* سياسة الشركة: الزائر يتصفّح الوظائف فقط — لا يقدّم استمارة ولا يتحقق من أي واحدة.
   الفحص هنا يقرأ سطور GRANT (لا REVOKE) فلا يُخدع بإبطال لاحق. */
check('الزائر لا يستطيع نداء brc.verify_form (التحقق للموظفين والإدارة)', !/verify_form/i.test(anonTargets), anonTargets.slice(0, 160));
check('الزائر لا يستطيع نداء brc.request_form (لا تقديم استمارة من الموقع)', !/request_form/i.test(anonTargets), anonTargets.slice(0, 160));
/* نقطة البيع عامة؛ صلاحيات صاحب العمل القديمة مغلقة بعد إضافة تحقق واتساب. */
check('الزائر يستطيع نداء brc.activate_card (بيع نقطة البيع عبر الموقع)', /activate_card/i.test(anonTargets));
check('الزائر لا يستطيع تجاوز OTP عبر employer_view القديم', !/employer_view/i.test(anonTargets));
check('الزائر لا يستطيع تجاوز OTP عبر employer_decide القديم', !/employer_decide/i.test(anonTargets));
/* موديل 2026-10-06: مسار باركود البطاقة (apply.html) — بلا جلسة، ومن دونه يصير
   مسح باركود كل بطاقة خطأً على الزبون. */
check('الزائر يستطيع نداء brc.self_service_card (باركود البطاقة يقرأ حالته)', /self_service_card/i.test(anonTargets));
check('الزائر يستطيع نداء brc.apply_with_card (تقديم ذاتي بلا جلسة موظف)', /apply_with_card/i.test(anonTargets));
/* الباركود بيان الحيازة، ومع ذلك: لا تُمنح هاتان الدالتان لـ public تلقائياً */
check('دالتا التقديم الذاتي مُبطَلتان من public قبل المنح',
  /revoke\s+all\s+on\s+function\s+brc\.self_service_card\(text\)\s+from\s+public/i.test(stripped(RAW)) &&
  /revoke\s+all\s+on\s+function\s+brc\.apply_with_card\(text,\s*text,\s*jsonb\)\s+from\s+public/i.test(stripped(RAW)));
check('لا منح لمسار المكتب إلى الزائر', !/office_submit/.test(anonTargets));
check('سجل إيصالات المكتب معزول بـRLS وسحب المنح', /alter table brc\.office_receipts enable row level security/.test(RAW) && /revoke all on brc\.office_receipts from public,anon,authenticated/.test(RAW));
const authGrants = grantLines.filter((l) => /\bauthenticated\b/i.test(l)).join(' ');
check('الموظف المسجَّل يستطيع نداء brc.verify_form', /verify_form/i.test(authGrants));
check('لا جدول حساس ممنوح للزائر مباشرة',
  !/\b(applicants|audit_log|staff|settings)\b/i.test(grantLines.filter((l) => /\banon\b/i.test(l) && !/revoke/i.test(l)).join(' ')));

/* ------------------------- 10) تطابق بيانات الشركة ------------------------- */
step(10, 'بيانات الشركة — لا تناقض بين config.js و schema.sql');

/* بيانات الشركة تظهر على الاستمارات المطبوعة وأكواد الكيو آر كود، فاختلافها
   بين الواجهة وقاعدة البيانات يعني استمارة مطبوعة بعنوان أو هاتف مختلفين. */
const cfgSrc = readFileSync(join(ROOT, 'assets', 'js', 'config.js'), 'utf8');
const cfgCompany = {};
{
  const block = cfgSrc.slice(cfgSrc.indexOf('company: {'), cfgSrc.indexOf('/* --------------------------------------------------------------', cfgSrc.indexOf('company: {')));
  for (const m of block.matchAll(/(\w+):\s*'([^']*)'/g)) cfgCompany[m[1]] = m[2];
  const ph = block.match(/phones:\s*\[([^\]]*)\]/);
  if (ph) cfgCompany.phones = ph[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
}
check('قراءة بيانات الشركة من config.js', Object.keys(cfgCompany).length > 5, Object.keys(cfgCompany).join(','));

const schemaCompany = {};
{
  const start = RAW.indexOf("('company', jsonb_build_object(");
  const block = RAW.slice(start, RAW.indexOf('on conflict (key) do nothing', start));
  for (const m of block.matchAll(/'(\w+)',\s*'([^']*)'/g)) schemaCompany[m[1]] = m[2];
  const ph = block.match(/'phones',\s*jsonb_build_array\(([^)]*)\)/);
  if (ph) schemaCompany.phones = ph[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
}
check('قراءة بيانات الشركة من schema.sql', Object.keys(schemaCompany).length > 5, Object.keys(schemaCompany).join(','));

/* الحقول الحرجة: تظهر مطبوعة على الاستمارة */
for (const key of ['nameAr', 'nameEn', 'legalName', 'address', 'email']) {
  check(`حقل «${key}» متطابق بين الواجهة والقاعدة`, cfgCompany[key] === schemaCompany[key],
    `config="${cfgCompany[key]}" ← → schema="${schemaCompany[key]}"`);
}
check('أرقام الهاتف متطابقة (كانت مختلفة: 07715993271 مقابل 07863148999)',
  Array.isArray(cfgCompany.phones) && Array.isArray(schemaCompany.phones) &&
  cfgCompany.phones.join('|') === schemaCompany.phones.join('|'),
  `config=[${(cfgCompany.phones || []).join(', ')}] ← → schema=[${(schemaCompany.phones || []).join(', ')}]`);
check('اسم الشركة القانوني متطابق (كان مختلفاً: «(شركة الهدف)» في القاعدة فقط)',
  cfgCompany.legalName === schemaCompany.legalName);
check('العنوان متطابق', cfgCompany.address === schemaCompany.address);
check('لا حقل في الواجهة ناقص في القاعدة',
  Object.keys(cfgCompany).filter((k) => k !== 'phones').every((k) => schemaCompany[k] !== undefined),
  Object.keys(cfgCompany).filter((k) => k !== 'phones' && schemaCompany[k] === undefined).join(', '));

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
  ['تسلسل أكواد الوظائف (HRC-####)', /create\s+sequence\s+if\s+not\s+exists\s+brc\.job_code_seq/i],
  ['تسلسل أرقام الاستمارات (HRC-NO-######)', /create\s+sequence\s+if\s+not\s+exists\s+brc\.form_serial_seq/i],
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
check('تعريفات المشغّلات بما فيها حاجز الاسترجاع موجودة (توليد الأكواد/المحاولات/الحجز/التدقيق/سجل الباركودات)', trigCount === 16, trigCount + '');

/* ------------------------- 9) مزامنة ملف الـ migration ------------------------- */
step(9, 'ملف الـ migration — متطابق مع المصدر (تكاملة GitHub في Supabase)');

const MIG_DIR = join(ROOT, 'supabase', 'migrations');
/* الهجرات التي يجب أن تكون موجودة على كل قاعدة قائمة (2026-10-25) */
const REQUIRED_MIGRATIONS = [
  '20261025000000_retire_chance_codes.sql',
  '20261026000000_remove_employer_pin_and_region.sql',
  '20261026100000_fix_verify_card_code_print_column.sql',
  '20261026110000_drop_dormant_employer_functions.sql',
  '20261026120000_prune_legacy_card_functions.sql',
  '20261026130000_add_card_print_code_column.sql',
  '20261026140000_recovery_always_restorable.sql',
  '20261026150000_recovery_admin_schedule.sql',
  '20261026160000_drop_recovery_weekly.sql'
];
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

/* ── 2026-10-03: خطأ 2F005 على القاعدة الحية ──
   كانت chance_code() و next_form_serial() تعيدان القيمة من داخل اللوب
   بعد exit: عند التفرد يخرج التنفيذ من اللوب ويصل نهاية الدالة بلا RETURN
   (2F005: control reached end of function without RETURN) وعند التصادم
   تعيد قيمة مكررة. النمط السليم: exit when … ; ثم end loop ثم return. */
step(11, 'اللوبات — لا return داخل اللوب بعد exit (نمط 2F005)');
{
  const INVERTED = /exit\s+when[^;]+;\s*\n\s*return\s+\w+\s*;\s*\n\s*end\s+loop\b/;
  const SRC = [join(ROOT, 'docs', 'schema.sql')]
    .concat(readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).map((f) => join(MIG_DIR, f)));
  const hits = SRC.filter((f) => INVERTED.test(readFileSync(f, 'utf8')));
  check('لا نمط معكوس في schema.sql وكل ملفات migrations', hits.length === 0,
        'الملفات: ' + hits.map((f) => f.split('/').pop()).join(', '));
}

/* ── 2026-10-06: الدرس الأهم من عطل «باركود البطاقة يفتح خطأً» ──
   الدالتان كانتا مكتوبتين في ملف هجرة داخل supabase/migrations/ وحده، ولم
   تُضافا إلى مسار التحديث الذي كانت تستعمله الإدارة آنذاك (صفحة اللصق
   اليدوي، المحذوفة الآن) ولا إلى المصدر docs/schema.sql. النتيجة: الكود ينادي
   دالة غير موجودة على القاعدة ⇒ خطأ PostgREST إنكليزي خام عند الزبون.
   هذا الفحص يمنع تكرار النمط: كل دالة يناديها باركود البطاقة يجب أن تكون
   معرَّفة في المصدر، وممنوحة للزائر، وموجودة في مسار التحديث. */
step(12, 'مسار التحديث — كل دالة يناديها باركود البطاقة تصل للإدارة فعلاً');
{
  const applySrc = readFileSync(join(ROOT, 'apply.html'), 'utf8');
  const called = [...new Set([...applySrc.matchAll(/rpc\('(\w+)'/g)].map((m) => m[1]))];
  /* دالتان الآن بدل ثلاث: التصميم الجديد لصفحة الباركود يستعمل self_service_card
     لقراءة البطاقة وapply_with_card للتقديم، والوظائف تُقرأ مباشرة من جدول
     public_jobs — أما activate_card (نقطة البيع) فصارت في صفحة نقطة البيع وحدها.
     المهم ألا يقلّ العدد عن اثنتين، وهو ما يعني أن المسح وجد النداءات فعلاً. */
  check('قراءة الدوال التي تناديها صفحة الباركود', called.length >= 2, called.join(', '));

  const notDefined = called.filter((n) => !new RegExp('function\\s+brc\\.' + n + '\\s*\\(', 'i').test(RAW));
  check('كل دالة يناديها الباركود مُعرَّفة في docs/schema.sql', notDefined.length === 0,
    'غير معرَّفة: ' + notDefined.join(', '));

  const notGranted = called.filter((n) =>
    !new RegExp('grant\\s+execute\\s+on\\s+function\\s+brc\\.' + n + '\\s*\\([^)]*\\)\\s+to\\s+[^;]*anon', 'i')
      .test(stripped(RAW)));
  check('كل دالة يناديها الباركود ممنوحة للزائر (anon) في المخطط', notGranted.length === 0,
    'بلا منح للزائر: ' + notGranted.join(', '));

  /* الدوال الجديدة تحديداً = ما تُنشئه هجرة التقديم الذاتي (2026-10-06).
     نفحصها هي وحدها: activate_card أقدم وتُثبّتها الأجزاء السابقة (لا تُكرَّر). */
  const selfMigName = '20261006000000_self_service_card_application.sql';
  let selfMig = '';
  try { selfMig = readFileSync(join(MIG_DIR, selfMigName), 'utf8'); } catch { selfMig = ''; }
  const newFns = [...new Set([...selfMig.matchAll(/create\s+or\s+replace\s+function\s+brc\.(\w+)/gi)].map((m) => m[1]))];
  check('قراءة دالتَي هجرة التقديم الذاتي من ملف الهجرة', newFns.length >= 2, newFns.join(', '));
  const defined = (src) => newFns.filter((n) => !new RegExp('function\\s+brc\\.' + n + '\\s*\\(', 'i').test(src));
  check('دوال التقديم الذاتي مُدرجة في docs/schema.sql (المصدر الوحيد)', defined(RAW).length === 0,
    'ناقص: ' + defined(RAW).join(', '));

  /* مسار التحديث الفعلي (2026-10-25): الهجرات وحدها.
     حُذفت صفحة اللصق اليدوي db-update.html وأُرشفت ملفات docs/UPDATE-*.sql في
     docs/archive/legacy-sql/ لأنها كانت تُعيد دوال صاحب العمل ورموز الفرص
     المحذوفة (نصها منسوخ من مخطّط قديم). */
  check('صفحة اللصق اليدوي db-update.html محذوفة', !existsSync(join(ROOT, 'db-update.html')));
  check('ملفات التحديث القديمة أُرشفت ولا تُنفَّذ', !existsSync(join(ROOT, 'docs', 'UPDATE-2026-10-06.sql')) &&
    existsSync(join(ROOT, 'docs', 'archive', 'legacy-sql', 'README.md')));
  check('لا صفحة منشورة تشير إلى db-update.html', readdirSync(ROOT)
    .filter((f) => f.endsWith('.html'))
    .every((f) => !/db-update\.html/.test(readFileSync(join(ROOT, f), 'utf8'))));
  check('كل دوال مسار البطاقة موجودة كهجرات قابلة للتطبيق', REQUIRED_MIGRATIONS
    .every((f) => existsSync(join(MIG_DIR, f))), REQUIRED_MIGRATIONS.filter((f) => !existsSync(join(MIG_DIR, f))).join(', '));

  /* الواجهة: لا CDN خارجي — العميل المصغّر المحلي يعلن السكيما في الترويستين */
  check('صفحة الباركود تستعمل عميل الاتصال المحلي (cloud-http.js)',
    /assets\/js\/cloud-http\.js/.test(applySrc) && !/cdn\.jsdelivr|unpkg\.com|esm\.sh/i.test(applySrc));
  check('صفحة الباركود تشرح للمستخدم العربي سبب الخطأ بدل رسالة الخادم الخام',
    /isMissingFunction/.test(applySrc) && /docs\/schema\.sql/.test(applySrc) && /الهجرات الحديثة/.test(applySrc));
}

/* ── 2026-10-25: عطل حيّ في الإنتاج — verify_card_code وعمود غائب ──
   قاعدة الإنتاج أُنشئت قبل الهجرة 20261016090000 فليس فيها العمود
   card_print_code، وكانت الدالة تقرأه مباشرةً (f.card_print_code) فتفشل كل
   نداءات إعادة الطباعة بـ42703. القراءة عبر to_jsonb لا تفشل عند غياب العمود.
   هذا الفحص يمنع عودة القراءة المباشرة في المصدر أو في أي هجرة. */
step(13, 'إعادة الطباعة — لا قراءة مباشرة لعمود قد يكون غائباً (42703)');
{
  const SRC = [join(ROOT, 'docs', 'schema.sql')]
    .concat(readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).map((f) => join(MIG_DIR, f)));
  /* الهجرة التاريخية 20261016090000 تضيف العمود بنفسها فقراءتها المباشرة سليمة
     هناك ولا تُعدَّل (ملفات الهجرات لا تُحرَّر بعد تطبيقها). الفحص على غيرها. */
  const direct = SRC.filter((f) => {
    const body = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
    return /\bf\.card_print_code\b/.test(body) && !/add column if not exists card_print_code/i.test(body);
  });
  check('لا قراءة مباشرة لـ f.card_print_code في المصدر أو الهجرات (عدا التي تُنشئ العمود)',
    direct.length === 0, direct.map((f) => f.split('/').pop()).join(', '));
  check('verify_card_code يقرأ رمز التحقق عبر to_jsonb(f)', /to_jsonb\(f\)->>'card_print_code'/.test(RAW));
  const fix = '20261026100000_fix_verify_card_code_print_column.sql';
  check('هجرة إصلاح verify_card_code موجودة وتُبقي المخطط كما هو (بلا إضافة عمود)',
    migNames.includes(fix) &&
    !/alter\s+table[^;]*add\s+column[^;]*card_print_code/i.test(readFileSync(join(MIG_DIR, fix), 'utf8')),
    fix);
}

/* ── 2026-10-25: دوال صاحب العمل الميتة لا تعود ──
   employer_view · employer_decide · employer_decide_original · employer_otp_* ‎
   بلا أي مستخدم: لا واجهة تنادي عليها، ولا دالة/عرض يعتمد عليها، وصلاحيتها
   مسحوبة من anon/authenticated/service_role. حُذفت من المصدر والقاعدة. */
step(14, 'دوال صاحب العمل القديمة — محذوفة ولا تُعاد إلى المصدر');
{
  const DEAD = /create\s+or\s+replace\s+function\s+brc\.(employer_view|employer_decide|employer_decide_original|employer_otp_\w+)/i;
  check('المصدر (schema.sql) لا يعرّف أي دالة employer_* ميتة', !DEAD.test(RAW));
  const guarded = readFileSync(join(MIG_DIR, '20261026110000_drop_dormant_employer_functions.sql'), 'utf8');
  check('هجرة الحذف تستعمل drop function if exists (آمنة للتكرار)',
    /drop\s+function\s+if\s+exists\s+brc\.employer_view/i.test(guarded) &&
    /drop\s+function\s+if\s+exists\s+brc\.employer_decide/i.test(guarded));
  check('هجرة الحذف لا تمسّ الجداول التي تلتقطها نسخ الاسترجاع',
    !/drop\s+table/i.test(guarded));
}

/* ── 2026-10-25: مراجعة شاملة — لا تكرار ولا تداخل في الواجهة ──
   نتيجة مراجعة الموقع: نافذة «بطاقتي» كان عرضها معرَّفاً مرتين بقيمتين
   مختلفتين (680px في style.css و600px في card-entry.css) فتختلف بين الصفحة
   الرئيسية واللوحة؛ وصفحة التقديم كان فيها ستة <h1> (عنوان لكل خطوة). */
step(15, 'الواجهة — مصدر واحد لكل قيمة، وعنوان رئيسي واحد للصفحة');
{
  const cssFiles = readdirSync(join(ROOT, 'assets', 'css')).filter((f) => f.endsWith('.css'));
  const widthOwners = cssFiles.filter((f) =>
    /\.modal-booking\s*\{[^}]*\bwidth\s*:/.test(readFileSync(join(ROOT, 'assets', 'css', f), 'utf8')));
  check('عرض نافذة «بطاقتي» معرَّف في ملف واحد فقط', widthOwners.length === 1, widthOwners.join(', '));

  const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html') &&
    !/^hrc-(standalone|light)\.html$/.test(f));   /* الحزمتان تجمعان صفحات كاملة */
  const multiH1 = pages.filter((f) => (readFileSync(join(ROOT, f), 'utf8').match(/<h1[\s>]/g) || []).length > 1);
  check('كل صفحة فيها عنوان h1 واحد على الأكثر', multiH1.length === 0, multiH1.join(', '));

  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const cacheName = (sw.match(/CACHE_NAME = '([^']+)'/) || [])[1] || '';
  check('تعليق رأس sw.js يطابق اسم الكاش الفعلي',
    new RegExp(cacheName).test(sw.split('\n')[0]), sw.split('\n')[0]);
  const precache = [...((sw.match(/const urlsToCache = \[([\s\S]*?)\];/) || [])[1] || '').matchAll(/'([^']+)'/g)]
    .map((m) => m[1]).filter((u) => u !== '/');
  const gone = precache.filter((u) => !existsSync(join(ROOT, u.replace(/^\//, ''))));
  check('كل ملف في قائمة التخزين المسبق موجود فعلاً', gone.length === 0, gone.join(', '));
  check('أنماط «بطاقتي» المطلوبة مخزَّنة مسبقاً (تعمل أوفلاين من أول زيارة)',
    precache.includes('/assets/css/card-entry.css') && precache.includes('/assets/js/qr-scan.js'));

  const publicHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
  check('الموقع العام لا يَعِد بخدمة صاحب عمل محذوفة (مسح الاستمارة وتسجيل القرار)',
    !/امسح باركود استمارة المتقدم/.test(publicHtml));
}

/* ── 2026-10-25: نسخة الاسترجاع لا تبقى «غير قابلة للاسترجاع» بصمت ──
   بصمة المخطط تتبع أعمدة 5 جداول، فأي هجرة أعمدة تُبطل النسخ الأقدم،
   وrecovery_weekly يحتفظ بنسخة واحدة فقط. النتيجة: فجوة تصل أسبوعاً بلا نسخة
   صالحة (حدثت فعلاً: نسخة 2026-10-23 صارت غير قابلة للاسترجاع). */
step(16, 'الاسترجاع — نسخة صالحة دائماً وحالة واضحة في اللوحة');
{
  const up = readFileSync(join(MIG_DIR, '20261026140000_recovery_always_restorable.sql'), 'utf8');
  check('هجرة ضمان النسخة الصالحة موجودة وتُشغَّل دورياً',
    /create or replace function brc\.recovery_ensure_fresh/.test(up) &&
    /cron\.schedule/.test(up) && /recovery_ensure_fresh\(\)/.test(up));
  check('الدالة لا تُنشئ نسخة إن وُجدت نسخة صالحة (لا تستهلك قرصاً بلا داعٍ)',
    /if exists \(select 1 from brc\.recovery_copies where schema_hash = brc\.recovery_schema_hash\(\)\)/.test(up));
  check('الدالة مسحوبة الصلاحيات عن المتصفح',
    /revoke all on function brc\.recovery_ensure_fresh\(\) from public, anon, authenticated/.test(up));

  const ui = readFileSync(join(ROOT, 'assets', 'js', 'recovery.js'), 'utf8');
  check('اللوحة تُميّز النسخة غير القابلة للاسترجاع وتُعطّل زرها',
    /recovery-stale/.test(ui) && /button\.disabled=true/.test(ui) && /restorable===false/.test(ui));
  check('اللوحة تحذّر بوضوح إن لم تبقَ أي نسخة صالحة',
    /لا توجد نسخة قابلة للاسترجاع/.test(ui));
  check('نمط الشارة موجود في الأنماط', /\.recovery-stale\{/.test(readFileSync(join(ROOT, 'assets', 'css', 'backup.css'), 'utf8')));
}

/* ── 2026-10-25: جدولة النسخ يحددها المدير (لا موعد ثابت في cron) ── */
step(17, 'جدولة النسخ الاحتياطي — يضبطها المدير من الإعدادات');
{
  check('دوال الجدولة موجودة في المصدر',
    ['recovery_schedule_get','recovery_schedule_set','recovery_run_scheduled','recovery_cron_expr']
      .every((n) => new RegExp('function\\s+brc\\.' + n + '\\s*\\(').test(RAW)));
  check('الجدولة محفوظة في إعدادات القاعدة لا في المتصفح',
    /'recovery_schedule'/.test(RAW) && /insert into brc\.settings/.test(RAW));
  check('تعديل الجدولة محصور بالمدير',
    /function brc\.recovery_schedule_set[\s\S]{0,400}if not brc\.is_admin\(\)/.test(RAW));
  check('الجدولة مسحوبة الصلاحيات عن المتصفح وتمنح للموظف المُصدَّق فقط',
    /revoke all on function brc\.recovery_cron_expr\(int\[\],text\)[^;]*from public,anon,authenticated/.test(RAW) &&
    /grant execute on function brc\.recovery_schedule_set\(int\[\],text\) to authenticated/.test(RAW));
  check('التحويل من توقيت بغداد إلى UTC داخل القاعدة',
    /utc_h := h - 3/.test(RAW) && /Asia\/Baghdad/.test(RAW));
  check('المهمة الثابتة القديمة لم تعد تُنشأ في المصدر',
    !/cron\.schedule\('hrc-weekly-recovery'/.test(RAW) && /cron\.schedule\('recovery-auto-backup'/.test(RAW));

  const ui = readFileSync(join(ROOT, 'assets', 'js', 'recovery.js'), 'utf8');
  check('لوحة النسخ فيها اختيار الأيام والساعة وحفظها',
    /recovery-sched-save/.test(ui) && /recovery-days/.test(ui) && /type="time"/.test(ui));
  check('فيها زر إيقاف التلقائي وخيار الحفظ بلا أيام',
    /recovery-sched-off/.test(ui) && /saveSchedule\(true\)/.test(ui));
  check('المتجر يمرّر الجدولة إلى القاعدة (لا تخزين محلي)',
    /recoveryScheduleSet/.test(readFileSync(join(ROOT, 'assets', 'js', 'store.js'), 'utf8')) &&
    /rpc\('recovery_schedule_set'/.test(readFileSync(join(ROOT, 'assets', 'js', 'store.js'), 'utf8')));
  check('نمط بطاقة الجدولة موجود في الأنماط',
    /\.recovery-schedule\{/.test(readFileSync(join(ROOT, 'assets', 'css', 'backup.css'), 'utf8')));
}

/* ── 2026-10-25: منفّذ نسخ واحد فقط (لا نسختان من نفس المنطق) ──
   recovery_weekly بقيت بلا مستخدم بعد أن صارت الجدولة بيد المدير: صفر مهمة
   cron تناديها، صفر دالة، وصلاحيتها postgres وحده. حُذفت من القاعدة. */
step(18, 'النسخ المجدول — منفّذ واحد لا اثنان');
{
  check('المصدر لا يعرّف recovery_weekly', !/function brc\.recovery_weekly/.test(RAW));
  check('المنفّذ الوحيد هو recovery_run_scheduled',
    /function brc\.recovery_run_scheduled/.test(RAW) &&
    /cron\.schedule\('recovery-auto-backup'/.test(RAW));
  const drop = readFileSync(join(MIG_DIR, '20261026160000_drop_recovery_weekly.sql'), 'utf8');
  check('هجرة الحذف آمنة للتكرار وتزيل أي مهمة قديمة تشير إليها',
    /drop function if exists brc\.recovery_weekly\(\)/.test(drop) &&
    /cron\.unschedule/.test(drop) && /recovery_weekly%/.test(drop));
  check('هجرة الحذف لا تلمس recovery_run_scheduled',
    !/drop function if exists brc\.recovery_run_scheduled/.test(drop));
  const recTest = readFileSync(join(ROOT, 'tests', 'recovery-sql.mjs'), 'utf8');
  check('فحوص الأمان تُجرى على المنفّذ المجدول الفعلي',
    /brc\.recovery_run_scheduled\(\)/.test(recTest) &&
    !/select brc\.recovery_weekly\(\)/.test(recTest));
}

/* ── 2026-10-25: الهوية الجديدة — ترتيب التطبيق بألوان الشركة والصور ── */
step(19, 'الواجهة العامة — ترتيب تطبيق بهوية الشركة وصور محلية');
{
  const app = readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8');
  const pub = readFileSync(join(ROOT, 'src', 'partials', 'public.html'), 'utf8');
  const js = readFileSync(join(ROOT, 'assets', 'js', 'public.js'), 'utf8');

  /* الترتيب الاحترافي (2026-10-25 بعد طلب المالك): واجهة ← بحث ← تصنيفات ←
     الوظائف (أهم شيء أولاً) ← بطاقة التوظيف ← الأرقام ← آلية العمل … */
  /* 2026-10-25 (نهائي): التصنيفات عادت قسماً مستقلاً بشبكة مربّعات ملوّنة،
     وصندوق الفلترة صار مدمجاً صغيراً في قسم الوظائف. */
  check('ترتيب الأقسام: واجهة · بحث · تصنيفات · وظائف(بفلترتها) · بطاقة · أرقام',
    pub.indexOf('id="home"') < pub.indexOf('app-search') &&
    pub.indexOf('app-search') < pub.indexOf('id="categories"') &&
    pub.indexOf('id="categories"') < pub.indexOf('id="cat-rail"') &&
    pub.indexOf('id="cat-rail"') < pub.indexOf('id="jobs"') &&
    pub.indexOf('id="jobs"') < pub.indexOf('id="jobs-grid"') &&
    pub.indexOf('id="jobs-grid"') < pub.indexOf('id="card"') &&
    pub.indexOf('id="card"') < pub.indexOf('id="hero-stats"') &&
    pub.indexOf('id="hero-stats"') < pub.indexOf('id="how"'));
  check('التصنيفات شبكة مربّعات ملوّنة مستقلة (بطيّة)، والفلترة صندوق مدمج منفصل',
    (pub.match(/id="cat-rail"/g) || []).length === 1 &&
    /class="cat-grid/.test(pub) &&
    !/cats-row/.test(pub) &&
    /--cat/.test(readFileSync(join(ROOT, 'assets', 'js', 'public.js'), 'utf8')));
  check('لا شريط علوي (نجمة/حسابي/موقع) — أُزيل بطلب المالك',
    !/app-topbar/.test(pub) && !/i-star8/.test(pub) && !/حسابي/.test(pub) &&
    !/class="app-loc"/.test(pub));
  const tabFlat = pub.replace(/\s+/g, ' ');
  /* خمسة عناصر كما في الموك-أب: الوظائف · خدماتنا · الرئيسية (وسط بارز) · بطاقتي · تواصل */
  /* 2026-10-25: التبويبات صارت تفتح **صفحات** (data-page-tab) لا مراسي تمرير. */
  check('شريط تنقل سفلي: الوظائف · المفضلة · الرئيسية (بارز) · بطاقتي · تواصل',
    /class="tabbar"/.test(tabFlat) &&
    (tabFlat.match(/data-page-tab="/g) || []).length === 5 &&
    /data-page-tab="jobs"/.test(tabFlat) && /data-page-tab="favorites"/.test(tabFlat) &&
    /data-page-tab="card"/.test(tabFlat) && /data-page-tab="contact"/.test(tabFlat) &&
    /<button[^>]*class="tab-center"[^>]*data-page-tab="home"/.test(tabFlat) &&
    !/data-tab="services"/.test(tabFlat));

  /* الهوية: ألوان الشركة فقط — لا لون أزرق/بنفسجي جديد من الموك-أب */
  const vars = readFileSync(join(ROOT, 'assets', 'css', 'style.css'), 'utf8');
  check('الأنماط الجديدة تستعمل متغيّرات الشركة (--lapis/--gold) لا ألواناً جديدة',
    /var\(--gold\)/.test(app) && /var\(--lapis-2\)/.test(app) && /--gold:/.test(vars));

  /* الصور: محلية + بصيغة webp + بلا نص عربي داخل الصورة */
  const imgs = ['hero-skyline', 'card-banner', 'jobs/job-truck', 'jobs/job-cashier', 'jobs/job-chef',
    'jobs/job-electrician', 'jobs/job-engineer', 'jobs/job-nurse', 'jobs/job-sales', 'jobs/job-warehouse'];
  const missing = imgs.filter((n) => !existsSync(join(ROOT, 'assets', 'img', n + '.webp')));
  check('كل صور الهوية الجديدة موجودة محلياً بصيغة webp', missing.length === 0, missing.join(', '));
  const big = imgs.map((n) => join(ROOT, 'assets', 'img', n + '.webp')).filter((f) => {
    try { return readFileSync(f).length > 150 * 1024; } catch { return false; }
  });
  check('لا صورة تتجاوز 150KB (سرعة على الجوال)', big.length === 0, big.map((f) => f.split('/').pop()).join(', '));

  /* تصميم بطاقتنا الحقيقي على الموقع: يُرسم بنفس قالب الطباعة (voucher). */
  check('شكل البطاقة الحقيقي (وجهان) يُرسم على الموقع من نفس قالب الطباعة',
    /id="card-showcase"/.test(pub) && /HRCVoucher\.buildHtml/.test(js) &&
    /hero-skyline\.webp/.test(app));
  check('كل وظيفة بلا صورة تحصل على صورة تخصص محلية (لا أيقونة مكسورة)',
    /function defaultJobImage/.test(js) && /assets\/img\/jobs\//.test(js));
  check('المفضلة تُحفظ على جهاز الزائر وحده ولا تُرسل للشركة',
    /hrc_fav_jobs_v1/.test(js) && /localStorage/.test(js));
  check('شريط التنقل السفلي لا يظهر على الكمبيوتر (جوال فقط)',
    /\.tabbar\s*\{[^}]*display:\s*none/.test(app) && /@media \(max-width: 860px\)/.test(app));
}

/* ── 2026-10-25: جولة المالك الأخيرة — نظافة بصرية وبوابة موظفين فعّالة ── */
step(20, 'الواجهة العامة — أبيض نقيّ، بوابة الموظفين، ولا كود ميت');
{
  const pub = readFileSync(join(ROOT, 'src', 'partials', 'public.html'), 'utf8');
  const nav = readFileSync(join(ROOT, 'assets', 'js', 'nav.js'), 'utf8');
  const js = readFileSync(join(ROOT, 'assets', 'js', 'public.js'), 'utf8');

  /* 1) كل خلفية قريبة من الأبيض صارت أبيض نقيّاً (لا درجات كريمية متبقّية) */
  const near = (hex) => {
    const h = hex.replace('#', '');
    if (h.length !== 6) return false;
    return Math.min(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)) >= 236;
  };
  const offenders = [];
  for (const f of ['style.css', 'app-shell.css', 'public-polish.css']) {
    const css = readFileSync(join(ROOT, 'assets', 'css', f), 'utf8');
    for (const m of css.matchAll(/background(?:-color)?\s*:\s*([^;}]+)/g)) {
      for (const hex of m[1].matchAll(/#[0-9a-fA-F]{6}/g)) if (near(hex[0])) offenders.push(f + ':' + hex[0]);
    }
  }
  check('كل خلفية قريبة من الأبيض صارت #fff (لا درجات كريمية)', offenders.length === 0,
    [...new Set(offenders)].slice(0, 6).join(', '));

  /* 2) بوابة الموظفين: الضغطة المطوّلة تعمل على **كل** أسماء الشركة،
        لأن شعار الواجهة هو الظاهر على الجوال (الترويسة مخفية). */
  check('بوابة الموظفين تُربط على كل عناصر اسم الشركة لا أولها فقط',
    /querySelectorAll\('\.brand\[data-staff-gate\], \[data-staff-gate\]'\)/.test(nav) &&
    /function bindOneGate/.test(nav));
  check('شعار الواجهة معلَّم كبوابة موظفين', /app-brand brand" data-staff-gate/.test(pub));
  check('اسم الشركة بلا تحديد نص/قائمة سياق تقطع الإيماءة',
    /user-select: none/.test(readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8')));

  /* 3) لا كود ميت: بقايا الشريط العلوي والبانر الوهمي أُزيلت */
  check('لا بقايا للشريط العلوي المحذوف في الكود',
    !/app-topbar|app-alerts|renderAlerts|app-loc/.test(pub + js));
  check('لا بقايا للبانر الوهمي (promo-*) في الكود',
    !/promo-banner|promo-qr|renderPromoQr|promo-dots/.test(pub + js));

  /* 4) تصميم بطاقتنا الحقيقي معروض على الموقع من نفس قالب الطباعة */
  check('قسم البطاقة يعرض الوجهين من قالب الطباعة نفسه (لا صورة بديلة)',
    /id="card-showcase"/.test(pub) && /HRCVoucher\.buildHtml/.test(js) &&
    /cs-cards/.test(readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8')));
}

/* ── 2026-10-25: فلترة موحّدة + طبقات نظيفة + بطاقة فخمة + تفاصيل حيّة ── */
step(21, 'الوظائف — فلترة موحّدة، طبقات فوق بعضها، وتفاصيل حيّة');
{
  const pub = readFileSync(join(ROOT, 'src', 'partials', 'public.html'), 'utf8');
  const js = readFileSync(join(ROOT, 'assets', 'js', 'public.js'), 'utf8');
  const app = readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8');
  const ui = readFileSync(join(ROOT, 'assets', 'js', 'ui.js'), 'utf8');
  const vou = readFileSync(join(ROOT, 'assets', 'js', 'voucher.js'), 'utf8');

  /* 1) الفلترة والتصنيفات في صندوق واحد + شرائح تصفية نشطة */
  check('صندوق الفلترة مدمج (صفّ واحد) بلا تكرار للتصنيفات داخله',
    /class="filters"[\s\S]*?id="filter-q"[\s\S]*?id="filter-status"/.test(pub) &&
    !/class="filters"[\s\S]*?id="cat-rail"/.test(pub));
  check('شرائح «مطبَّق» تُظهر ما تمت تصفيته ويُزال بزر',
    /id="f-active"/.test(pub) && /function renderActiveChips/.test(js) && /data-clear=/.test(js));
  check('التصفير يشمل التصنيف أيضاً', /category: 'all' \}/.test(js));

  /* 2) الطبقات: لا شريط سفلي يغطّي أزرار النافذة */
  check('النافذة فوق الشريط السفلي وقفل تمرير الصفحة أثناء فتحها',
    /\.modal-backdrop \{ z-index: 400 !important; \}/.test(app) &&
    /body\.modal-open \{ overflow: hidden; \}/.test(app) &&
    /body\.modal-open \.tabbar \{ display: none !important; \}/.test(app) &&
    /classList\.add\('modal-open'\)/.test(ui));
  check('روابط السكرول لها هامش سفلي (لا تختفي تحت الترويسة)',
    /scroll-margin-block-start/.test(app) && /scroll-padding-block-start/.test(app));

  /* 3) البطاقة: وجهان فخمان + صيغة الباركود الحالية */
  check('البطاقة فيها زخرفة وفخامة (نقش + هولوغرام + إطار مزدوج + شريط)',
    /\.hc-guilloche/.test(vou) && /\.hc-holo/.test(vou) &&
    /\.hc-ribbon/.test(vou) && /inset 0 0 0 \.78mm/.test(vou));
  check('الوجه الخلفي يحمل نفس الزخرفة (لا وجه فقير ووجه غني)',
    (vou.match(/hc-guilloche/g) || []).length >= 3);
  /* نجرّد التعليقات: الصيغة القديمة مذكورة في تعليق توضيحي مقصود */
  const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('الرقم المعروض بصيغة الباركود الحقيقية لا الصيغة القديمة',
    !/HRC-BC-000000/.test(jsCode) && /serial: '[A-Z0-9]{10}'/.test(jsCode) &&
    /function randomCardCode/.test(readFileSync(join(ROOT, 'assets', 'js', 'store.js'), 'utf8')));

  /* 4) تفاصيل الوظيفة: نافذة حيّة بعناصر واضحة */
  check('تفاصيل الوظيفة: غلاف صورة + شريط أرقام + متطلبات + خطوات + خصوصية',
    /jd-hero/.test(js) && /jd-stats/.test(js) && /jd-reqs/.test(js) &&
    /jd-steps/.test(js) && /jd-privacy/.test(js));
  check('أنماط تفاصيل الوظيفة موجودة ومتجاوبة',
    /\.jd-hero \{/.test(app) && /\.jd-steps li::before/.test(app) &&
    /@media \(max-width: 620px\) \{\s*\.jd-stats/.test(app));
  check('زر «قدّم» داخل النافذة يغلقها ثم يفتح «بطاقتي» (لا نوافذ متراكبة)',
    /b\.closest\('\.modal-backdrop'\)/.test(js) && /HRCBooking\.open/.test(js));
}

/* ── 2026-10-25: ألوان حيّة + «اتصل بنا» + بطاقة ككارت حقيقي ── */
step(22, 'الواجهة — ألوان حيّة، لغة موحّدة، وكارت البطاقة');
{
  const pub = readFileSync(join(ROOT, 'src', 'partials', 'public.html'), 'utf8');
  const js = readFileSync(join(ROOT, 'assets', 'js', 'public.js'), 'utf8');
  const app = readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8');
  const vou = readFileSync(join(ROOT, 'assets', 'js', 'voucher.js'), 'utf8');

  /* 1) ألوان حيّة: لوحة متغيّرات + لون لكل تخصص + أيقونات أرقام ملوّنة */
  check('لوحة ألوان حيّة معرَّفة (teal/blue/violet/amber/green… )',
    /--v-teal:/.test(app) && /--v-violet:/.test(app) && /--v-amber:/.test(app));
  check('كل تخصص له لون ثابت في التصنيفات والشرائح',
    /PALETTE = \['#0f9c94'/.test(js) && /--cat:' \+ catColor\[c\]/.test(js));
  check('أيقونات شريط الأرقام ملوّنة (لا رمادي باهت)',
    /\.app-stat:nth-child\(1\) > \.ic \{ background: var\(--v-teal\)/.test(app));

  /* 2) لغة موحّدة: لا «خابرنا» في أي نص عام */
  const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  check('لا كلمة «خابرنا» في الصفحة العامة أو كودها (اتصل بنا بدلاً منها)',
    !/خابرنا/.test(pub) && !/خابرنا/.test(codeOnly(js)) && /اتصل بنا/.test(pub));

  /* 3) البطاقة ككارت حقيقي: ميل ثلاثي الأبعاد + ظلّ + واجهة برمجية للوجهين */
  check('البطاقة تُعرض ككارت بميل وظلّ (perspective + rotate + shadow)',
    /perspective: 1200px/.test(app) && /rotateX\(9deg\) rotateZ\(-3\.5deg\)/.test(app));
  check('الوجهان يُرسمان من قالب الطباعة عبر واجهة صريحة (لا قصّ HTML)',
    /frontHtml: function \(app, attempts\)/.test(vou) &&
    /backHtml: function \(app, attempts\)/.test(vou) &&
    /V\.frontHtml\(sample\)/.test(js) && /V\.backHtml\(sample\)/.test(js));
  check('إزاحة البطاقة داخل الإطار فيزيائية (top/left) لتعمل في RTL',
    /position: absolute; top: 0; left: 0; right: auto/.test(app));
  check('قائمة ميزات البطاقة ظاهرة (أيقونة مربّعة + عنوان + وصف، بلا نقاط)',
    /\.cs-ic \{[\s\S]{0,200}place-items: center/.test(app) &&
    /\.cs-features b \{/.test(app) &&
    /\.cs-features li \{[\s\S]{0,200}list-style: none/.test(app));
}

/* ── 2026-10-25: تصنيفات بطيّة + قسم المفضلة ── */
step(23, 'الوظائف — تصنيفات تُفتح بضغطة وقسم مفضلة يعمل فعلاً');
{
  const pub = readFileSync(join(ROOT, 'src', 'partials', 'public.html'), 'utf8');
  const js = readFileSync(join(ROOT, 'assets', 'js', 'public.js'), 'utf8');
  const app = readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8');

  /* 1) التصنيفات مخفيّة حتى تُضغط */
  check('شبكة التصنيفات مخفيّة افتراضياً مع زر إظهار/إخفاء',
    /id="cat-rail"[^>]*hidden/.test(pub) && /id="cats-toggle"/.test(pub) &&
    /function bindCatsToggle/.test(js) && /grid\.hidden = !open/.test(js));
  check('زر التصنيفات يعلن حالته للقارئ الشاشي (aria-expanded)',
    /aria-expanded="false"[^>]*aria-controls="cat-rail"/.test(pub) &&
    /setAttribute\('aria-expanded'/.test(js));

  /* 2) المفضلة: قسم + تبويب + شارة عدد + مسح */
  check('قسم «المفضلة» موجود بعد الوظائف بشبكة كروت حالته الفارغة واضحة',
    /id="favorites"/.test(pub) && /id="fav-grid"/.test(pub) &&
    /id="fav-empty"/.test(pub) && /function renderFavorites/.test(js));
  check('تبويب الشريط السفلي صار «المفضلة» بشارة عدد (لا «خدماتنا»)',
    /data-page-tab="favorites"/.test(pub) && /id="fav-count"/.test(pub) &&
    !/<span>خدماتنا<\/span>/.test(pub));
  check('إضافة/إزالة تعمل من أي كرت وتُحدّث القسم والعدّاد فوراً',
    /favToggle\(code\)/.test(js) && /renderFavorites\(\)/.test(js) &&
    /document\.addEventListener\('click'/.test(js));
  check('المفضلة محفوظة على جهاز الزائر فقط + زر مسح الكل',
    /localStorage\.setItem\(FAV_KEY/.test(js) && /id="fav-clear"/.test(pub) &&
    /removeItem\(FAV_KEY\)/.test(js));
  check('أنماط المفضلة والتصنيفات البطيّة موجودة',
    /\.cats-toggle \{/.test(app) && /\.cat-grid\[hidden\]/.test(app) &&
    /\.fav-empty \{/.test(app) && /\.tab-badge \{/.test(app));
}

/* ── 2026-10-25: تبويبات تفتح صفحات كاملة (نمط التطبيقات) ── */
step(24, 'التنقل — كل تبويب صفحة كاملة بمعلوماتها');
{
  const pub = readFileSync(join(ROOT, 'src', 'partials', 'public.html'), 'utf8');
  const js = readFileSync(join(ROOT, 'assets', 'js', 'public.js'), 'utf8');
  const app = readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8');

  check('شريط صفحة بعنوان ووصف وزر رجوع وشارة عدد',
    /id="page-bar"/.test(pub) && /id="pb-back"/.test(pub) &&
    /id="pb-title"/.test(pub) && /id="pb-badge"/.test(pub));
  check('كل قسم موسوم بالصفحة التي ينتمي إليها (data-page)',
    (pub.match(/data-page="/g) || []).length >= 10 &&
    /id="jobs"[^>]*data-page="jobs"/.test(pub.replace(/\n/g, ' ')) &&
    /id="favorites"[^>]*data-page="favorites"/.test(pub.replace(/\n/g, ' ')) &&
    /id="card"[^>]*data-page="card"/.test(pub.replace(/\n/g, ' ')) &&
    /id="contact"[^>]*data-page="contact"/.test(pub.replace(/\n/g, ' ')));
  check('موجّه الصفحات: openPage + حالة في الرابط + دعم زر الرجوع',
    /function openPage\(page, opts\)/.test(js) &&
    /history\.pushState/.test(js) &&
    /addEventListener\('popstate'/.test(js) &&
    /#!\//.test(js));
  check('صفحة واحدة ظاهرة فقط في نمط الصفحات، والرئيسية تُعيد الكل',
    /body\.app-focus \[data-page\] \{ display: none !important; \}/.test(app) &&
    /body\.app-focus\[data-app-page="jobs"\] \[data-page="jobs"\]/.test(app));
  check('المفضلة لا تظهر في الرئيسية الطويلة (صفحة مستقلة)',
    /class="[^"]*app-only[^"]*"[^>]*id="favorites"/.test(pub) &&
    /body:not\(\.app-focus\) \.app-only/.test(app));
  check('الشريط السفلي ظاهر على الكمبيوتر أيضاً (تنقّل تطبيق)',
    /\.tabbar \{[\s\S]{0,200}display: flex;/.test(app));
}

/* ---------------------------------- الخلاصة ---------------------------------- */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
