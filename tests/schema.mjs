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
import vm from 'node:vm';
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

/* ── كل جدول في brc عليه RLS — من **ملفات الهجرة**.
   يتجاهل الجداول المحذوفة صراحةً (drop table) والجداول المؤقتة. */
{
  const dir = 'supabase/migrations';
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const created = new Map();
  const enabled = new Set();
  const dropped = new Set();

  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?brc\.([a-z0-9_]+)/gi)) {
      created.set(m[1], f);
    }
    for (const m of sql.matchAll(/alter\s+table\s+brc\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi)) {
      enabled.add(m[1]);
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?brc\.([a-z0-9_]+)/gi)) {
      dropped.add(m[1]);
    }
  }

  const live = [...created.keys()].filter(t => !dropped.has(t));
  const missing = live.filter(t => !enabled.has(t));
  check('كل جدول brc حيّ له enable row level security', missing.length === 0,
    missing.length ? 'بلا RLS: ' + missing.join(', ') : '');
  console.log(`   · أُنشئ: ${created.size} · محذوف: ${dropped.size} · حيّ: ${live.length} · عليه RLS: ${enabled.size}`);
}

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

/* 17 = الستة عشر + card_lookup_budget المضافة في 2026-11-17 ضمن سدّ فرق
   الاسترجاع (كانت في الإنتاج وغير موجودة في المخطط، فكان أي استرجاع يُسقط
   حراسة تعداد البطاقات بصمت). العدد مقصود ومُوثَّق هنا لا مُرخَّى. */
check('المخطط يعرّف 18 جدولاً بما فيها النسخ الخاصة وأسرار التشغيل', tables.length === 18,
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
/* 2026-11-13: +2 دالتا تقنين البيانات العامة (card_public_name · card_public_phone)
   ⇒ 59 تعريفاً و57 دالة فعلية. أُضيفتا لإغلاق تعداد البطاقات (انظر
   tests/card-enumeration.mjs) وليستا مجرّد عدّ: بدونهما يُرجَع الاسم والهاتف
   كاملين لأي حامل باركود. */
/* 2026-11-14: +4 تعريفات لدعم الجدولة المرنة والاحتفاظ بآخر ٣ نسخ:
     recovery_cron_expr(text,int,int[],text)         — نمط «كل N ساعة»
     recovery_schedule_set(text,int,int[],text)      — حفظ النمط
     recovery_retention_keep()                       — عدد النسخ المحفوظة
     recovery_prune(int)                             — التقليم الآمن
   ⇒ 65 تعريفاً و60 دالة فعلية (٥ توقيعات توافق + recovery_due_now الجديدة). */
/* 2026-11-15: +3 تعريفات لتصدير النسخة الكاملة:
     recovery_export_v3()   — يضيف الجداول الأربعة التي كان v2 يُسقطها
   والكتلة المدمجة من ترحيل 2026-11-05 (أرقام البطاقات):
     card_number_for(text) · assign_card_number() · issue_numbered_cards(...)
   ⇒ 68 تعريفاً و63 دالة فعلية.
   2026-11-17: +8 تعريفات لسدّ فرق الاسترجاع مقابل الإنتاج:
     card_request_source() · card_lookup_guard(text,text) ·
     lookup_card_unguarded(text,text) · self_service_card_unguarded(text,text) ·
     trg_block_fingerprint_audit() · relocate_job_images(text,boolean) ·
     recovery_export_full() · recovery_export_v2()
   ⇒ 76 تعريفاً و71 دالة فعلية.
   2026-11-17 (تكملة): +2 تعريفان — غلافا lookup_card و self_service_card
   بلا تقنين (كانا ما زالا يُقنّعان، والإنتاج لا يُقنّع).
   ⇒ 78 تعريفاً و71 دالة فعلية. */
check('تعريفات الدوال: 78 تعريفاً، 71 دالة فعلية (توقيعات توافق مقصودة)',
  funcs.length === 78 && new Set(funcs.map(x=>x.name)).size === 71,
  funcs.length + ' تعريفاً · ' + new Set(funcs.map(x=>x.name)).size + ' دالة');
check('دوال الجدولة المرنة والتقليم موجودة',
  ['brc.recovery_retention_keep','brc.recovery_prune','brc.recovery_cron_expr','brc.recovery_schedule_set']
    .every(n=>funcs.some(x=>x.name===n)));
check('التقليم لا يمسّ نسخ الأمان (safety=true)',
  /recovery_prune[\s\S]{0,700}safety\s*=\s*false/i.test(RAW));
check('النسخة المجدولة تُبقي آخر N ولا تحذف كل ما قبلها',
  !/delete from brc\.recovery_copies where id<>result/.test(RAW) &&
  /perform brc\.recovery_prune\(\)/.test(RAW));
check('دالتا التقنين موجودتان (شرط إغلاق تعداد البطاقات)',
  funcs.some(x=>x.name==='brc.card_public_name') && funcs.some(x=>x.name==='brc.card_public_phone'),
  funcs.length + ' — ' + funcs.map((x) => x.name).join(', '));
/* كل دالة جديدة تُذكر هنا بالاسم: العدد وحده لا يكشف خطأً في الاسم أو حذفاً
   لدالة قديمة، والأسماء هي ما يُنادى فعلاً من الواجهة. */
const EXPECTED_FUNCS = ['brc.card_public_name', 'brc.card_public_phone', 'brc.recovery_manage', 'brc.office_submit', 'brc.next_job_code', 'brc.next_form_serial', 'brc.verify_token',
  'brc.trg_defaults', 'brc.trg_attempt_hold', 'brc.trg_no_duplicate_job', 'brc.trg_audit',
  'brc.run_auto_release', 'brc.is_staff', 'brc.is_admin', 'brc.current_staff_id',
  'brc.verify_form', 'brc.request_form', 'brc.mask_name', 'brc.mask_phone',
  'brc.select_attempt', 'brc.set_outcome', 'brc.release_hold',
  'brc.activate_card', 'brc.customer_application_details', 'brc.application_job_snapshot', 'brc.capture_application_job_snapshot',
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
/* التفعيل المباشر ليس واجهة عامة؛ التقديم الذاتي يستخدم الدالة كمساعد داخلي. */
check('الزائر لا يستطيع نداء brc.activate_card مباشرة', !/activate_card/i.test(anonTargets) && /revoke all on function brc\.activate_card\(text,\s*jsonb\) from public,\s*anon,\s*authenticated/i.test(stripped(RAW)));
check('الزائر لا يستطيع تجاوز OTP عبر employer_view القديم', !/employer_view/i.test(anonTargets));
check('الزائر لا يستطيع تجاوز OTP عبر employer_decide القديم', !/employer_decide/i.test(anonTargets));
/* موديل 2026-10-06: مسار باركود البطاقة (apply.html) — بلا جلسة، ومن دونه يصير
   مسح باركود كل بطاقة خطأً على الزبون. */
check('الزائر يستطيع نداء brc.self_service_card (باركود البطاقة يقرأ حالته)', /self_service_card/i.test(anonTargets));
check('الزائر يستطيع نداء brc.apply_with_card (تقديم ذاتي بلا جلسة موظف)', /apply_with_card/i.test(anonTargets));
/* الباركود بيان الحيازة، ومع ذلك: لا تُمنح هاتان الدالتان لـ public تلقائياً.
   ⚠️ 2026-11-13: كانت التوقيعات المفحوصة هنا **غير موجودة** في المخطط
   (self_service_card(text) وapply_with_card(text,text,jsonb))، والتوقيعان
   الفعليان هما self_service_card(text,text) وapply_with_card(text,text,text,jsonb).
   فكان الفحص يمرّ على نصوص لا تطابق أي دالة بينما يظل apply_with_card
   القديم قابلاً للنداء من الزائر بـ EXECUTE الافتراضي على PUBLIC.
   صار النمط يغطي أي توقيع للدالتين، وأُضيف فحص السحب الشامل. */
const SELF_SVC_REVOKE = /revoke\s+all\s+on\s+function\s+brc\.self_service_card\s*\([^)]*\)\s+from\s+public/i;
const APPLY_REVOKE = /revoke\s+all\s+on\s+function\s+brc\.apply_with_card\s*\([^)]*\)\s+from\s+public/i;
check('دالتا التقديم الذاتي مُبطَلتان من public قبل المنح',
  SELF_SVC_REVOKE.test(stripped(RAW)) && APPLY_REVOKE.test(stripped(RAW)));
/* ⚠️ بلا `in schema`: النسخة المحدودة بالمخطط لا تُسجّل شيئاً في PostgreSQL
   (الافتراضي المدمج PUBLIC ليس ضمن ACL المخطط) — تحقّقنا منها عملياً. فالسطر
   الصحيح هو افتراضي الدور الحالي، والفحص يمنع عودة الصيغة العاطلة. */
check('سحب شامل من public: لا دالة brc تُنشأ بصلاحية افتراضية',
  /alter\s+default\s+privileges\s+revoke\s+execute\s+on\s+functions\s+from\s+public/i.test(stripped(RAW)));
check('سحب الافتراضيات ليس بالصيغة العاطلة (in schema … revoke — بلا أثر)',
  !/alter\s+default\s+privileges\s+in\s+schema[^;]*revoke\s+execute\s+on\s+functions\s+from\s+public/i.test(stripped(RAW)));
check('السحب الشامل يمرّ على كل دوال brc لا على قائمة يدوية',
  /for\s+r\s+in[\s\S]{0,300}?pg_proc[\s\S]{0,300}?revoke\s+all\s+on\s+function/i.test(stripped(RAW)));
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
for (const key of ['nameAr', 'nameEn', 'legalName', 'email']) {
  check(`حقل «${key}» متطابق بين الواجهة والقاعدة`, cfgCompany[key] === schemaCompany[key],
    `config="${cfgCompany[key]}" ← → schema="${schemaCompany[key]}"`);
}
check('أرقام الهاتف متطابقة بين الواجهة والقاعدة',
  Array.isArray(cfgCompany.phones) && Array.isArray(schemaCompany.phones) &&
  cfgCompany.phones.join('|') === schemaCompany.phones.join('|'),
  `config=[${(cfgCompany.phones || []).join(', ')}] ← → schema=[${(schemaCompany.phones || []).join(', ')}]`);
check('اسم الشركة القانوني متطابق (كان مختلفاً: «(شركة الهدف)» في القاعدة فقط)',
  cfgCompany.legalName === schemaCompany.legalName);
/* config.address نصّ تسويقي قصير يظهر في الموقع، وschema.address العنوان
   البريدي الكامل المطبوع على الاستمارة — ليسا نفس الحقل، فلا تُقارنان.
   العنوان البريدي له فحص مستقل أدناه. */
check('العنوان التسويقي في الواجهة غير فارغ',
  typeof cfgCompany.address === 'string' && cfgCompany.address.trim().length > 10);
check('العنوان البريدي الكامل محفوظ في القاعدة (يُطبع على الاستمارة)',
  typeof schemaCompany.address === 'string' && schemaCompany.address.includes('حلة'));
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
/* 2026-11-15: 18 مشغّلاً — أُضيف trg_assign_card_number مع كتلة أرقام البطاقات.
   2026-11-17: 19 — أُضيف trg_block_fingerprint_audit مع سدّ فرق الاسترجاع. */
check('تعريفات المشغّلات بما فيها حاجز الاسترجاع موجودة (توليد الأكواد/المحاولات/الحجز/التدقيق/سجل الباركودات)', trigCount === 19 && /create\s+trigger\s+zz_capture_application_job_snapshot/i.test(stripped(RAW)), trigCount + '');

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
  '20261026160000_drop_recovery_weekly.sql',
  '20261101170000_makseb_display_name.sql',      /* هوية مكسب — الاسم القانوني يبقى */
  '20261101180000_update_daily_opening_to_eight.sql',
  '20261105120000_card_issue_numbers.sql',
  '20261110150000_company_phone_numbers.sql'      /* أرقام خدمة العملاء الجديدة */,
  '20261111120000_jobs_staff_delete.sql',
  '20261111235000_cards_insert_admin_only.sql'
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
  /* مخطط SQL المضمَّن في restore.html يذكر الاسم داخل تعليق تاريخي — نبني
     الحكم على ما يُعرَض فعلاً: نجرّد كتلة التضمين ثم نبحث عن أي إشارة
     (href/src أو نص) إلى الصفحة المحذوفة. */
  const stripEmbed = (html) => html.replace(
    /<!-- SCHEMA-EMBED:START -->[\s\S]*?<!-- SCHEMA-EMBED:END -->/g, '');
  check('لا صفحة منشورة تشير إلى db-update.html', readdirSync(ROOT)
    .filter((f) => f.endsWith('.html'))
    .every((f) => !/db-update\.html/.test(stripEmbed(readFileSync(join(ROOT, f), 'utf8')))));
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
  const imgs = ['hero-skyline', 'jobs/job-truck', 'jobs/job-cashier', 'jobs/job-chef',
    'jobs/job-electrician', 'jobs/job-engineer', 'jobs/job-nurse', 'jobs/job-sales', 'jobs/job-warehouse'];
  const missing = imgs.filter((n) => !existsSync(join(ROOT, 'assets', 'img', n + '.webp')));
  check('كل صور الهوية الجديدة موجودة محلياً بصيغة webp', missing.length === 0, missing.join(', '));
  const big = imgs.map((n) => join(ROOT, 'assets', 'img', n + '.webp')).filter((f) => {
    try { return readFileSync(f).length > 150 * 1024; } catch { return false; }
  });
  check('لا صورة تتجاوز 150KB (سرعة على الجوال)', big.length === 0, big.map((f) => f.split('/').pop()).join(', '));

  /* 2026-10-25 (بعد طلب المالك): لا يُعرض أي شكل/صورة للبطاقة على الموقع.
     صفحة «بطاقتي» = إدخال رقم/مسح ثم تفاصيل حقيقية من القاعدة. */
  check('لا شكل بطاقة معروض في الموقع (حُذف عرض الوجهين)',
    !/id="card-showcase"/.test(pub) && !/card-showcase/.test(js) &&
    !/cs-front|cs-badge|cs-cards/.test(app));
  check('صفحة «بطاقتي»: حقل إدخال الرقم + زر مسح + منطقة تفاصيل',
    /id="cp-serial"/.test(pub) && /id="cp-scan"/.test(pub) &&
    /id="cp-result"/.test(pub) && /id="cp-again"/.test(js));
  check('البحث يستعمل Store.cardLookup ويشرح الخطأ داخل الشاشة',
    /Store\.cardLookup\(serial\)/.test(js) && /function cpSay/.test(js) &&
    /id="cp-err"/.test(pub));
  check('التفاصيل تعرض الصلاحية والمتبقي والفرص ووظائفها وتواريخها',
    /بداية الصلاحية/.test(js) && /تنتهي في/.test(js) && /الفرص المتبقية/.test(js) &&
    /cp-chance/.test(js) && /selectedAt/.test(js));
  check('المسح الحقيقي مربوط (HRCQRScan) ويقبل باركود البطاقة فقط',
    /root\.HRCQRScan/.test(js) && /validate: function/.test(js));
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
  /* «الكريمي» لون **دافئ** فاتح: أحمره أعلى من أزرقِه بوضوح (وهو الأكثر
     سطوعاً). الاعتماد على أعلى سطوع فقط كان يُصنّف الأزرق الفاتح
     (#f1f5fa · #f7f9fd · #f5f7fa) كريمياً — وهو خطأ في الفحص لا في التصميم. */
  const near = (hex) => {
    const h = hex.replace('#', '');
    if (h.length !== 6) return false;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (Math.min(r, g, b) < 236) return false;   // ليس فاتحاً أصلاً
    return r > b + 6 && r >= g;                  // دافئ: أحمره يتقدّم أزرقَه
  };
  const offenders = [];
  /* الاستثناء المقصود: خلفيات شارات الحالة الدلالية (نجاح/خطأ/معلّق) — لون
     أخضر/أحمر/أصفر قريب من الأبيض مقصود ليُقرأ كشارة، وليس درجة كريمية. */
  /* شارات الحالة + هيكل التحميل (رمادي محايد بلا دفء) */
  const STATUS_TINTS = new Set(['#eefaf3', '#fdeeee', '#f7f9fc', '#fff8ea', '#f2fbfa', '#f4f8ff', '#fffaf2', '#f4fcf7',
    '#f5f7fa', '#f1f5fa', '#f7f9fd', '#e2e8f0']);
  for (const f of ['style.css', 'app-shell.css', 'public-polish.css']) {
    const css = readFileSync(join(ROOT, 'assets', 'css', f), 'utf8');
    for (const m of css.matchAll(/background(?:-color)?\s*:\s*([^;}]+)/g)) {
      for (const hex of m[1].matchAll(/#[0-9a-fA-F]{6}/g)) {
        if (near(hex[0]) && !STATUS_TINTS.has(hex[0].toLowerCase())) offenders.push(f + ':' + hex[0]);
      }
    }
  }
  check('لا خلفيات كريمية متبقية (خلفيات شارات الحالة الدلالية مستثناة وعياً)', offenders.length === 0,
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
  check('صفحة البطاقة تعرض تفاصيل حقيقية من القاعدة لا شكلاً مرسوماً',
    /id="cp-result"/.test(pub) && /Store\.cardLookup/.test(js));
}

/* ── 2026-10-25: فلترة موحّدة + طبقات نظيفة + بطاقة فخمة + تفاصيل حيّة ── */
step(21, 'الوظائف — فلترة موحّدة، طبقات فوق بعضها، وتفاصيل حيّة');
{
  const pub = readFileSync(join(ROOT, 'src', 'partials', 'public.html'), 'utf8');
  const js = readFileSync(join(ROOT, 'assets', 'js', 'public.js'), 'utf8');
  const app = readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8');
  const ui = readFileSync(join(ROOT, 'assets', 'js', 'ui.js'), 'utf8');
  const vou = readFileSync(join(ROOT, 'assets', 'js', 'voucher.js'), 'utf8');
  const dash = readFileSync(join(ROOT, 'assets', 'js', 'dashboard.js'), 'utf8');
  const mig = readFileSync(join(ROOT, 'supabase', 'migrations', '20261105120000_card_issue_numbers.sql'), 'utf8');

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
  /* البطاقة أُعيد تصميمها بنظام mk / mb (نقوش SVG داخليّة + خطوط ذهبية)
     بدل أصناف hc-guilloche/hc-holo القديمة. الفحص يطابق الزخرفة الحيّة. */
  check('البطاقة فيها زخرفة وفخامة (نقش SVG + خطوط ذهبية + شعار + شريط)',
    /class=\\?"mk-art\\?"/.test(vou) && /stroke="#?c7a255|stroke=\\?"#c7a255/.test(vou) &&
    /mk-ribbon/.test(vou) && /mksebLogo/.test(vou));
  check('الوجه الخلفي يحمل نفس الزخرفة (لا وجه فقير ووجه غني)',
    /class=\\?"mb-art\\?"/.test(vou) && /stroke="#?d4ab51|stroke=\\?"#d4ab51/.test(vou) &&
    /mb-logo/.test(vou));
  /* 2026-11-07 (طلب الإدارة): 4 بطاقات بالصفحة، موسّطة، وبينها 20مم مساحة
     قصّ — لا 9 بطاقات بفراغ 3مم يمرّ عليها المقص. */
  check('ورقة الدفعة: 4 بطاقات (2×2) لا 9 — مساحة قصّ كافية للمقص',
    /var SHEET_COLS = 2, SHEET_ROWS = 2, SHEET_PER = SHEET_COLS \* SHEET_ROWS;/.test(vou) &&
    /SHEET_GUTTER = 20/.test(vou), 'SHEET_PER ≠ 4 أو الفراغ ≠ 20مم');
  /* 2026-11-10 (طلب الإدارة): البطاقة كُبّرت 30% ⇒ 70.2×111.8مم، مع إطار
     ذهبي مزدوج. الورقة تحمل 4 فيها، موسّطة، وبفراغ 20مم للقصّ. */
  check('ورقة الدفعة موسّطة في الصفحة بفراغ 20مم بين البطاقات',
    /column-gap:20mm;row-gap:20mm;/.test(vou) &&
    /align-content:center;justify-content:safe center/.test(vou) &&
    /grid-template-columns:repeat\(2,70\.2mm\);grid-auto-rows:111\.8mm/.test(vou));
  check('البطاقة 70.2×111.8مم (تكبير 30%) بإطار ذهبي مزدوج 2.6مم من الحافة',
    /width:70\.2mm;height:111\.8mm/.test(vou) &&
    /\.hrc-card \.frame\{position:absolute;inset:2\.6mm/.test(vou) &&
    /class="frame"/.test(vou));
  /* 2026-11-11 (طلب المالك): أي عدد من ١ إلى ٦٠ — رُفع قيد المضاعفات الذي
     كان يمنع أعداداً يحتاجها العمل اليومي. أزرار المضاعفات باقية اختصاراً.
     البطاقات اليتيمة في آخر ورقة تُطبع كما هي. */
  check('أعداد الدفعة من ١ إلى ٦٠ بلا قيد مضاعفات (واجهة وقاعدة معاً)',
    /BATCH_MIN = 1, BATCH_MAX = 60/.test(dash) &&
    /min="1" max="60" step="1"/.test(dash) &&
    /p_count<1 or p_count>60/.test(mig) &&
    !/p_count%4/.test(mig),
    'أحد الطرفين ما زال يقيّد بالمضاعفات أو خارج النطاق ١..٦٠');
  check('الدفعة تعرض «4 بطاقات» للموظف لا «9»',
    /4 بطاقات بالصفحة/.test(readFileSync(join(ROOT, 'assets', 'js', 'dashboard.js'), 'utf8')) &&
    !/9 بطاقات بالصفحة/.test(readFileSync(join(ROOT, 'assets', 'js', 'dashboard.js'), 'utf8')));
  /* نجرّد التعليقات: الصيغة القديمة مذكورة في تعليق توضيحي مقصود */
  const jsCode = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('لا أرقام بطاقات وهمية في الواجهة (الصيغة القديمة محذوفة)',
    !/HRC-BC-000000/.test(jsCode) &&
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
    /\.app-stat:nth-child\(1\) > \.ic \{ background: linear-gradient\(140deg, var\(--lapis-3\)/.test(app));

  /* 2) لغة موحّدة: لا «خابرنا» في أي نص عام */
  const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  check('لا كلمة «خابرنا» في الصفحة العامة أو كودها (اتصل بنا بدلاً منها)',
    !/خابرنا/.test(pub) && !/خابرنا/.test(codeOnly(js)) && /اتصل بنا/.test(pub));

  /* 3) البطاقة ككارت حقيقي: ميل ثلاثي الأبعاد + ظلّ + واجهة برمجية للوجهين */
  check('لا عرض لكارت البطاقة على الموقع ولا واجهة عرض له في القالب',
    !/perspective: 1200px/.test(app) && !/frontHtml: function/.test(vou) &&
    !/backHtml: function/.test(vou));
  check('صفحة البطاقة تعرض بطاقة تفاصيل مرتّبة (شبكة قيم + فرص)',
    /\.cp-grid \{/.test(app) && /\.cp-kv \{/.test(app) &&
    /\.cp-chance \{/.test(app) && /\.cp-badge\.ok/.test(app));
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

/* ── 2026-10-25: سجل التدقيق قائمة عربية + فلاتر الموقع بسيطة ── */
step(25, 'اللوحة — سجل مرتّب بلا كلمات إنجليزية، وفلاتر موحّدة');
{
  const dash = readFileSync(join(ROOT, 'src', 'partials', 'dashboard.html'), 'utf8');
  const djs = readFileSync(join(ROOT, 'assets', 'js', 'dashboard.js'), 'utf8');
  const css = readFileSync(join(ROOT, 'assets', 'css', 'style.css'), 'utf8');

  /* 2026-10-25 (نهائي): السجل جدول مرتّب ستة أعمدة بعرض كافٍ ومنع التفاف
     في الأعمدة القصيرة، وعمود التفاصيل وحده يلتف. */
  check('السجل جدول مرتّب بأعمدة واضحة (لا كسر نص عمودياً)',
    /class="data audit-table"/.test(dash) && /at-time/.test(djs) && /at-details/.test(djs) &&
    /table\.data\.audit-table \.at-time \{[\s\S]{0,120}white-space: nowrap/.test(css) &&
    /min-width: 980px/.test(css));
  check('رأس الجدول عربي بالكامل وبلا أعمدة إنجليزية',
    ['الوقت', 'المستخدم', 'الرتبة', 'القسم', 'العملية', 'التفاصيل']
      .every((h) => new RegExp('<th scope="col">' + h + '</th>').test(dash)) &&
    !/IP الجلسة|<th>السجل<\/th>/.test(dash));
  check('لا كلمات إنجليزية في واجهة السجل (CSV/IP/UTC/YYYY-MM-DD)',
    !/CSV/.test(dash) && !/IP الجلسة/.test(dash) && !/UTC\+3/.test(dash) &&
    !/YYYY-MM-DD/.test(dash));
  check('أقسام السجل والرتب تُعرض عربية من قاموس صريح',
    /AUDIT_ENTITY = \{/.test(djs) && /AUDIT_ACTION = \{/.test(djs) &&
    /applicant: 'بطاقة'/.test(djs) && /auditEntityLabel/.test(djs));
  check('فلاتر السجل تُبنى بتسميات عربية (القسم/العملية/المستخدم)',
    /label\(v\)/.test(djs) && /كل الأقسام/.test(dash));
  /* المتصفح يفرض صيغة نظامه (mm/dd/yyyy) ولا تُغيَّر بـCSS؛ نعرض نحن تنسيقاً
     عربياً فوق منتقي التاريخ الحقيقي (‎.date-ar‎ + arabicDateText). */
  check('حقول التاريخ تُعرض عربية (يوم/شهر/سنة) فوق منتقي التاريخ الحقيقي',
    /\.date-ar \{/.test(css) && /\.date-ar input\[type="date"\]/.test(css) &&
    /function arabicDateText/.test(readFileSync(join(ROOT, 'assets', 'js', 'dashboard.js'), 'utf8')) &&
    /data-da-text="log-from"/.test(dash));

  /* فلاتر الموقع: عمود واحد على الجوال، وأربعة متساوية على الكمبيوتر */
  const app = readFileSync(join(ROOT, 'assets', 'css', 'app-shell.css'), 'utf8');
  check('فلاتر الموقع شبكة موحّدة: بحث بعرض كامل + ٣ اختيارات + تصفير',
    /#jobs \.f-row \{ display: grid; grid-template-columns: repeat\(4/.test(app) &&
    /#jobs \.f-row > \.f-field\.f-search \{ grid-column: 1 \/ -1/.test(app) &&
    /@media \(max-width: 860px\)[\s\S]{0,200}grid-template-columns: repeat\(2/.test(app));
}

/* ── 2026-10-25: لا كلمات إنجليزية في واجهة السجل (job/application…) ── */
step(26, 'السجل — كل التسميات عربية بلا كلمات أجنبية');
{
  const djs = readFileSync(join(ROOT, 'assets', 'js', 'dashboard.js'), 'utf8');
  const maps = djs.slice(djs.indexOf('var AUDIT_ENTITY'), djs.indexOf('function auditEntityLabel'));
  /* كل قيمة معروضة في القواميس يجب أن تكون عربية (لا job/application/… ) */
  const latinValues = [...maps.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1])
    .filter((v) => /^[A-Za-z][A-Za-z \-]*$/.test(v) && !['login', 'logout', 'sign in', 'sign out',
      'create', 'update', 'delete', 'insert', 'add', 'edit', 'remove', 'restore', 'backup',
      'export', 'print', 'view', 'read', 'log in', 'log out'].includes(v));
  check('قواميس السجل لا تحتوي قيماً إنجليزية تُعرض للمستخدم', latinValues.length === 0,
    latinValues.join(', '));
  check('أي قيمة إنجليزية غير معروفة تُعرض بوصف عربي (لا تُسرَّب)',
    /LATIN_ONLY/.test(djs) && /\? 'سجل'/.test(djs) && /\? 'عملية'/.test(djs));
}

/* ── 2026-10-27: هوية فاتحة كريمية لصفحات التقديم (apply.html) ── */
step(27, 'صفحات التقديم — هوية فاتحة (كريمي/كحلي/ذهب) بلا مساس بالطباعة');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  /* 2026-10-27: ألغى المالك الكريمي نهائياً → الهوية: أبيض · كحلي · ذهبي نيون */
  /* 2026-10-28: الهوية النهائية = هوية الملصق (كحلي · ذهبي · أبيض) */
  check('لوحة الهوية معرّفة (كحلي #16304F · ذهبي #C8A24A · أبيض)',
    /--ps-navy:#16304F/.test(ap) && /--ps-gold:#C8A24A/.test(ap) &&
    /--ps-line:#E6DCC6/.test(ap) && !/--ap-cream:#fbf7ec/.test(ap));
  check('خلفية الترحيب بيضاء بموجات زخرفية أعلى وأسفل (بلا كريمي)',
    /body\{background-color:#ffffff!important\}/.test(ap) &&
    /body::before/.test(ap) && /body::after/.test(ap) &&
    /preserveAspectRatio='none'/.test(ap));
  check('البطاقة بيضاء والحقول بيضاء والنص كحلي',
    /\.profile-card\{[\s\S]{0,260}background:#ffffff/.test(ap) &&
    /--ui-field:#ffffff/.test(ap) && /--ui-ink:#0d2f3d/.test(ap));
  check('الأزرار: أساسي كحلي بحدود ذهبية (زر الملصق) وثانوي أبيض',
    /\.btn-primary,body\[data-step\] \.btn-primary,#btn-finish\{[\s\S]{0,200}linear-gradient\(135deg,#1E4270,#16304F 52%,#0D2247\)/.test(ap) &&
    /border:1\.5px solid rgba\(227,196,121,\.85\)/.test(ap) &&
    /\.btn-outline,body\[data-step\] \.btn-outline\{[\s\S]{0,200}background:#FFFFFF!important/.test(ap));
  check('كروت الوظائف فاتحة بنصوص كحلية (لا نص أبيض على أبيض)',
    /#jobs-list \.title[\s\S]{0,120}--ap-navy/.test(ap) &&
    /\.job-tags \.job-code\{[\s\S]{0,160}#0f6d63/.test(ap));
  check('شريط التقدم يعرض النسبة داخل كبسولة فاتحة',
    /\.step-label \.pct\{[\s\S]{0,260}--ap-field/.test(ap));
  check('الهوية داخل @media screen فقط (الطباعة A4 لم تتغيّر)',
    ap.indexOf('@media screen {\n  :root{\n    --ap-cream') > 0 &&
    (ap.match(/@media print/g) || []).length >= 3);
}

/* ── 2026-10-27 (ب): شاشة ترحيب «منصة مكسب» مطابقة للملصق (موبايل أولاً) ── */
step(28, 'شاشة الترحيب «منصة مكسب» — مطابقة الملصق + حركة وضغط أزرار');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('اسم المنصة صار «منصة مكسب» في العنوان والشاشة والترحيب والتذييل',
    /<title>[^<]*منصة مكسب للتوظيف/.test(ap) &&
    /id="welcome-title"[^>]*>منصة <b>مكسب<\/b>/.test(ap) &&
    /منصة مكسب للتوظيف — بابل، العراق/.test(ap) &&
    /<div class="mk-top-t">[\s\S]{0,120}منصة مكسب/.test(ap));
  check('شريط علوي كحلي خاص بالترحيب: «منصة مكسب» + «فرصتك لمستقبل أفضل»',
    /class="mk-top"/.test(ap) && /<b>منصة مكسب<\/b>/.test(ap) &&
    /<span>فرصتك لمستقبل أفضل<\/span>/.test(ap));
  check('الشريط العلوي العام مخفي في الترحيب ويظهر من الخطوة ١',
    /<div class="topbar" id="topbar" style="display:none">/.test(ap) &&
    /\$\('topbar'\)\.style\.display=showBar\?'flex':'none'/.test(ap));
  check('الشعار الصحيح (حرف مكسب + سهم ذهبي) معرّف كرمز SVG مقتفى من الصورة',
    /<symbol id="i-mkseb" viewBox="0 0 \d+ \d+">/.test(ap) &&
    (ap.match(/#i-mkseb(-dark)?/g) || []).length >= 4 &&
    /fill="#C8A24A"/.test(ap) && /fill="#fff"/.test(ap) &&
    /i-mkseb-dark/.test(ap));
  check('بلاطة الأيقونة (كحلي #012F3E وزوايا مستديرة) للشعار في الشريط والواجهة',
    /\.mk-tile\{/.test(ap) && /background:#16304F/.test(ap) &&
    /--ps-gold:#C8A24A/.test(ap) && /--ps-navy:#16304F/.test(ap));
  check('نفس الشعار في صفحة التقديم والموقع والترويسة والتذييل (رمز واحد)',
    /id="i-mkseb"/.test(ap) &&
    /<symbol id="i-mkseb" viewBox="0 0 \d+ \d+">/.test(readFileSync(join(ROOT, 'src/partials/sprite.html'), 'utf8')) &&
    /#i-mkseb/.test(readFileSync(join(ROOT, 'src/partials/header.html'), 'utf8')) &&
    /#i-mkseb/.test(readFileSync(join(ROOT, 'src/partials/footer.html'), 'utf8')) &&
    /#i-mkseb/.test(readFileSync(join(ROOT, 'src/partials/public.html'), 'utf8')));
  check('شاشة الترحيب تحمل الشعار في الشريط العلوي وفي وسط الواجهة',
    /class="mk-top-logo[^"]*"/.test(ap) && /class="mk-logo anim-zoom anim-glow"/.test(ap));
  check('بطاقات المزايا تظهر متتالية عند الوصول (IntersectionObserver + شبكة أمان)',
    /mk-wait/.test(ap) && /IntersectionObserver/.test(ap) &&
    /setTimeout\(function\(\)\{[\s\S]{0,120}mk-in/.test(ap));
  check('الوعد والوصف كما في الملصق (فرصتك لمستقبل أفضل + منصة توظيف تربط…)',
    /class="mk-tag[^"]*">فرصتك لمستقبل أفضل</.test(ap) &&
    /id="welcome-intro"[^>]*>منصة توظيف تربط الباحثين عن عمل مع أصحاب العمل بكل سهولة وموثوقية</.test(ap));
  check('زر البدء كبسولة كحلية بحدود ذهبية (زر الملصق)',
    /class="mk-cta[^"]*"[\s\S]{0,300}id="btn-start"/.test(ap) &&
    /\.mk-cta \.btn\{[\s\S]{0,600}border-radius:999px/.test(ap) &&
    /\.mk-cta \.btn\{[\s\S]{0,400}linear-gradient\(160deg,#1E4270,#16304F 52%,#0D2247\)/.test(ap));
  check('صورة واجهة بغداد محليّة (بلا طلب خارجي) مع تعتيم للقراءة',
    /background-image:url\("assets\/img\/mkseb-hero-m\.webp"\)/.test(ap) &&
    /assets\/img\/mkseb-hero\.webp/.test(ap) && /class="mk-hero-veil"/.test(ap) &&
    !/mkseb-hero[^"']*\.(jpg|png)/.test(ap));
  check('موجة بيضاء أسفل الصورة وموجة كحلية ذهبية في الخاتمة',
    /class="mk-sweep"/.test(ap) && /class="mk-end-wave"/.test(ap) &&
    /fill="#ffffff"/.test(ap) && /fill="#0d2247"/.test(ap));
  check('فاصل «خطوة بسيطة .. وباب جديد لفرصك» بين الزر وقسم المزايا',
    /class="mk-sep"><span>خطوة بسيطة \.\. وباب جديد لفرصك<\/span>/.test(ap));
  check('قسم «لماذا مكسب؟» + سطر «لأن مستقبلك يستحق الأفضل» + أربع مزايا بنصوص الملصق',
    /class="mk-why-t">لماذا مكسب؟</.test(ap) &&
    /class="mk-why-s">لأن مستقبلك يستحق الأفضل</.test(ap) &&
    (ap.match(/class="mk-feat"/g) || []).length === 4 &&
    /تطوير مستقبلك/.test(ap) && /دعم مستمر/.test(ap) &&
    /فرص متنوعة/.test(ap) && /موثوق وآمن/.test(ap) &&
    /نساعدك على بناء مسارك المهني/.test(ap) && /فريقنا معك في كل خطوة/.test(ap) &&
    /وظائف تناسب جميع المؤهلات والخبرات والتخصصات/.test(ap) &&
    /نتعامل مع جهات معتمدة/.test(ap));
  check('تركيب الشاشة موبايل أولاً: عمود بعرض الجوال على الهاتف وبطاقة متمركزة على الكمبيوتر',
    /\.mk-screen\{[\s\S]{0,220}max-width:640px/.test(ap) &&
    /@media\(min-width:641px\)\{[\s\S]{0,220}\.mk-screen\{[\s\S]{0,220}border-radius:28px/.test(ap));
  check('الشريط العلوي العام (خطوات الإدخال) يستخدم شعار مكسب أيضاً',
    /<div class="topbar" id="topbar"[\s\S]{0,200}#i-mkseb/.test(ap) &&
    /<div class="t1">منصة مكسب<\/div>/.test(ap));
  check('الاستمارة المطبوعة تحمل اسم «منصة مكسب للتوظيف» بلا سطر إنجليزي',
    /n1">منصة مكسب للتوظيف/.test(ap) && !/AL-HADAF RECRUITMENT/.test(ap));
  check('الأيقونات داخل الحقول (اسم · محافظة · قضاء · ناحية · نقطة دالة · هاتف) سليمة',
    (ap.match(/class="fld-ic"/g) || []).length === 6 &&
    /id="f-name"/.test(ap) && /id="f-lm"/.test(ap) && /id="f-phone"/.test(ap));
  check('الخلفية الموجية العامة تختفي في شاشة الترحيب (تركيبها الخاص)',
    /body\[data-step="0"\]::before,body\[data-step="0"\]::after\{display:none/.test(ap));
  check('خلفية موجية للخطوات تتنفّس ببطء مع احترام تقليل الحركة',
    /@keyframes apWaveTop/.test(ap) && /@keyframes apWaveBottom/.test(ap) &&
    /@media\(prefers-reduced-motion:reduce\)\{\s*body::before,body::after[\s\S]{0,120}animation:none/.test(ap));
  check('ضغط الأزرار محسوس (translate + scale) مع موجة لمس',
    /\.btn:not\(:disabled\):active\{[\s\S]{0,160}scale\(\.98/.test(ap) &&
    /@keyframes apRipple/.test(ap) && /className='ap-rp'/.test(ap));
  check('انتقال الصفحات ناعم وبلا كسر لقفل الانتقال',
    /transform \.46s cubic-bezier\(\.16,1,\.3,1\)/.test(ap) && /\},420\);/.test(ap));
  check('الصفحة الحالية معلنة على <body> لعرض شريط التقدم بعرض البطاقة',
    /setAttribute\('data-step'/.test(ap) && /body\[data-step="6"\] \.steps-bar/.test(ap));
}

/* ── 2026-10-27 (ج): حيوية الصفحات · إطارات ملوّنة · كيبورد بلا قفز ── */
step(29, 'حيوية شاشتَي الترحيب والإدخال + لوحة أزرار لا تقفز مع الكيبورد');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('خلفية حيّة: هالتان ملوّنتان تسبحان ببطء خلف صفحات الإدخال',
    /body\[data-step\]:not\(\[data-step="0"\]\) \.app::before/.test(ap) &&
    /@keyframes apFloat/.test(ap));
  check('بطاقة الخطوة بإطار متدرّج وشريط ألوان متحرك أعلاها',
    /padding-box/.test(ap) &&
    /@keyframes apRibbon/.test(ap) &&
    /#B08D3C,#E3C479 42%,#F7ECC8 70%,#C8A24A/.test(ap));
  check('الحقول: أيقونة داخل كبسولة تتحول للكحلي/الذهبي عند التركيز + رفع خفيف',
    /\.fld:focus-within \.fld-ic\{[\s\S]{0,160}background:#16304F!important/.test(ap) &&
    /\.fld:focus-within \.fld-ic\{[\s\S]{0,200}color:#E3C479!important/.test(ap));
  check('الأزرار: لمعة تمرّ على الزر الأساسي وحدود فاتحة ورفع/ضغط محسوس',
    /\.btn-primary::before\{[\s\S]{0,240}animation:apShine/.test(ap) &&
    /@keyframes apShine/.test(ap));
  check('الجنس: بطاقتان ملوّنتان بعلامة اختيار وأيقونات SVG (لا إيموجي)',
    /\.gender-opt\.selected::after\{[\s\S]{0,120}content:'✓'/.test(ap) &&
    /<span class="icon"><svg viewBox="0 0 24 24"/.test(ap) &&
    !/👨|👩/.test(ap));
  check('المزايا الأربع بأربعة ألوان من هوية الشعار',
    /\.mk-feat:nth-child\(1\) \.mk-feat-ic/.test(ap) &&
    /\.mk-feat:nth-child\(4\) \.mk-feat-ic/.test(ap) &&
    /rgba\(148,209,131/.test(ap) && /rgba\(63,177,144/.test(ap));
  check('شعار الترحيب يطفو ببطء وزر «ابدأ الآن» يتنفّس بحدود ذهبية',
    /\.mk-logo\{animation:mkFloat/.test(ap) && /@keyframes mkBreath/.test(ap));
  check('لوحة الأزرار مع الكيبورد: شريط سفلي ثابت بلا قفزة وبترتيب الصفحة',
    /animation:apDockUp/.test(ap) && /inset-inline:0!important/.test(ap) &&
    /#keyboard-navigation \.btn-row\{[\s\S]{0,200}flex-direction:column-reverse!important/.test(ap) &&
    /\.page\.active\{min-height:0!important\}/.test(ap));
  check('لا يفتح الكيبورد تلقائياً على الجوال (لا قفزة عند الوصول لخطوة)',
    /pointer:fine/.test(ap) && /preventScroll:true/.test(ap));
  check('كل الحركات الجديدة تتوقف عند prefers-reduced-motion',
    /@media\(prefers-reduced-motion:reduce\)\{[\s\S]{0,320}apShine|mkFloat|apFloat/.test(ap) ||
    /preters/.test(ap) === false && /prefers-reduced-motion:reduce/.test(ap));
}

/* ── 2026-10-27 (د): خطوة السكن — محافظة · قضاء · ناحية (تقسيم العراق كامل) ── */
step(30, 'السكن: محافظة ← قضاء ← ناحية بلا خطأ + نقطة دالة');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');
  const admin = readFileSync(join(ROOT, 'assets/js/iraq-admin.js'), 'utf8');
  const sandbox = {window: {}};
  vm.runInNewContext(admin, sandbox);
  const IRAQ = sandbox.window.HRC_IRAQ;
  const ORDER = sandbox.window.HRC_IRAQ_ORDER;
  const COUNT = sandbox.window.HRC_IRAQ_COUNT;

  check('ملف التقسيم الإداري مستقل ومربوط بالصفحة قبل السكربت المضمّن',
    /<script src="assets\/js\/iraq-admin.js"><\/script>/.test(ap) &&
    /var IRAQ=\(window\.HRC_IRAQ\)\|\|\{\}/.test(ap));
  check('١٩ محافظة كاملة بالترتيب المعتمد (منها حلبجة)',
    COUNT.governorates === 19 && ORDER.length === 19 && ORDER.indexOf('حلبجة') >= 0,
    JSON.stringify(COUNT));
  check('كل محافظة في البيانات لها أقضية ونواحٍ (لا محافظة فارغة)',
    ORDER.every((p) => IRAQ[p] && Object.keys(IRAQ[p]).length > 0 &&
      Object.keys(IRAQ[p]).every((q) => Array.isArray(IRAQ[p][q]) && IRAQ[p][q].length > 0)));
  check('التغطية: ١٣٠ قضاءً و٤٢٧ ناحية (يشمل مراكز الأقضية)',
    COUNT.districts === 130 && COUNT.subdistricts === 427, JSON.stringify(COUNT));
  check('نماذج محافظات حقيقية: بابل ٧ أقضية · بغداد ١٠ · الأنبار ١٠ · البصرة ٧',
    Object.keys(IRAQ['بابل']).length === 7 && Object.keys(IRAQ['بغداد']).length === 10 &&
    Object.keys(IRAQ['الأنبار']).length === 10 && Object.keys(IRAQ['البصرة']).length === 7);
  check('كل قضاء بابل موجود بأسمائه الرسمية (الحلة · المحاويل · كوثى · الهاشمية · الحمزة الغربي · المسيب · الكفل)',
    ['قضاء الحلة', 'قضاء المحاويل', 'قضاء كوثى', 'قضاء الهاشمية', 'قضاء الحمزة الغربي', 'قضاء المسيب', 'قضاء الكفل']
      .every((d) => !!IRAQ['بابل'][d]));
  check('لا ناحية مكرّرة داخل المحافظة نفسها (يفسد الاختيار)',
    ORDER.every((p) => {
      const seen = new Set();
      return Object.keys(IRAQ[p]).every((q) => IRAQ[p][q].every((n) => (seen.has(n) ? false : (seen.add(n), true))));
    }));
  check('الحقول الأربعة موجودة: المحافظة · القضاء · الناحية · أقرب نقطة دالة',
    /id="f-prov"/.test(ap) && /id="f-qada"/.test(ap) && /id="f-nah"/.test(ap) && /id="f-lm"/.test(ap));
  check('القضاء والناحية معطّلان حتى يُختار ما قبلهما، ويُعاد بناؤهما عند كل تغيير',
    /sel\.disabled=!province/.test(ap) && /sel\.disabled=!list\.length/.test(ap) &&
    /provSel\.addEventListener\('change',function\(\)\{fillQada\(provSel\.value,'',''\);\}\)/.test(ap) &&
    /qadaSel\.addEventListener\('change',function\(\)\{fillNahiya\(\$\('f-prov'\)\.value,qadaSel\.value,''\);\}\)/.test(ap));
  check('التحقق يطالب بالقضاء ثم الناحية برسائل عربية واضحة',
    /اختر القضاء التابع لمحافظتك/.test(ap) && /اختر الناحية التابعة لقضائك/.test(ap));
  check('العنوان المرسل للقاعدة: محافظة — قضاء — ناحية — نقطة دالة',
    /\[province,qada,nah,\$\('f-lm'\)\.value\.trim\(\)\]\.filter\(Boolean\)\.join\(' — '\)/.test(ap) &&
    /district:qada,subdistrict:nah/.test(ap));
}

/* ── 2026-10-27 (هـ): تناسق صفحات المعلومات + كارت الوظيفة المختارة الكحلي ── */
step(31, 'تناسق صفحات المعلومات + بطاقة الوظيفة المختارة كحلية بإطار ذهبي');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('نظام ألوان موحّد معلن مرة واحدة (كحلي · ذهبي · أبيض · أحمر)',
    /--ps-ink:#16294A/.test(ap) && /--ps-gold:#C8A24A/.test(ap) &&
    /--ps-line:#E6DCC6/.test(ap) && /--ps-gold-2:#E3C479/.test(ap) && /--ui-red:#b3392b/.test(ap));
  check('الحقول بيضاء بحدّ ذهبي عند التركيز',
    /\.form-group input,\.form-group select\{[\s\S]{0,160}background:#FFFFFF!important/.test(ap) &&
    /\.form-group input:focus,\.form-group select:focus\{[\s\S]{0,200}border-color:#C8A24A!important/.test(ap));
  check('كل التنبيهات بشكل واحد: حد جانبي ملوّن + أيقونة SVG (لا إيموجي)',
    /\.alert-error\{[\s\S]{0,200}border-inline-start-color:var\(--ui-red\)/.test(ap) &&
    /\.alert-info\{[\s\S]{0,200}border-inline-start-color:#2d7fa8/.test(ap) &&
    /var AICO=\{/.test(ap) && /function aico\(name,cls\)/.test(ap));
  check('لا إيموجي في واجهة الزبون (📅 ⚠️ 🧾 👤 🖨 🔗 📷 🔄 ✅)',
    !/[📅⚠🧾👤🖨🔗📷🔄✅]/u.test(ap));
  check('صفحة المراجعة بنفس اللغة: بطاقة بيضاء + صفوف منقّطة + أزرار «تعديل» كبسولية',
    /\.rv-card\{[\s\S]{0,220}var\(--ui-cream\)/.test(ap) &&
    /border-bottom:1px dashed #EFE7D6!important/.test(ap) &&
    /\.rv-edit\{[\s\S]{0,220}border-radius:999px/.test(ap) &&
    /\.rv-sub\{[\s\S]{0,260}background:#ffffff/.test(ap));
  check('الكارت المختار: إطار ذهبي واضح على بطاقة بيضاء',
    /body\[data-step="6"\] #jobs-list \.job-card\.selected\{[\s\S]{0,160}border:2px solid #C8A24A!important/.test(ap));
  check('نصوص/خلايا/أزرار الكارت المختار كلها مقروءة (نص كحلي على أبيض)',
    /body\[data-step="6"\] #jobs-list \.jm \.jm-k\{color:#8A7B5C!important\}/.test(ap) &&
    /body\[data-step="6"\] #jobs-list \.job-pay \*,[\s\S]{0,240}color:#7A5F21!important/.test(ap) &&
    /#jobs-list \.job-card\.selected \.job-actions \.btn-primary\{[\s\S]{0,240}linear-gradient\(135deg,#E8D089,#C8A24A 55%,#B08D3C\)/.test(ap));
  check('شارة الاختيار المكرّرة أُزيلت (بقيت شارة واحدة داخل الرأس)',
    /#jobs-list \.job-card\.selected \.job-head::before,[\s\S]{0,140}content:none!important/.test(ap));
  check('بقية البطاقات تُخفَّف قليلاً ليبقى الكحلي هو البطل (بلا تغبيش يمنع النقر)',
    /#jobs-list\.has-focus \.job-card:not\(\.selected\):not\(\.is-done\)\{opacity:\.78\}/.test(ap) &&
    !/pointer-events:none/.test(ap.split('#jobs-list.has-focus .job-card:not(.selected):not(.is-done)')[1]?.slice(0, 120) || ''));
}

/* ── 2026-10-27 (و): واجهة كحلية + تفاصيل بيضاء + كروت وظائف بيضاء ── */
step(32, 'الواجهة كحلية · التفاصيل بيضاء · الوظائف في كروت بيضاء · «اختر الوظيفة»');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('صفحات البيانات والقائمة والنتيجة كحلية الملصق (1..8)',
    /body\[data-step="1"\][\s\S]{0,520}background-color:#0F2444!important/.test(ap) &&
    /body\[data-step="8"\]/.test(ap));
  check('شريط التقدّم زجاج كحلي بنص أبيض على هذه الصفحات',
    /body\[data-step="1"\] \.steps-bar[\s\S]{0,420}rgba\(255,255,255,\.07\)/.test(ap) &&
    /body\[data-step="1"\] \.step-label[\s\S]{0,220}rgba\(234,243,246,\.82\)/.test(ap));
  check('بطاقة البيانات بيضاء نظيفة (لا كريمي) والحقول بيضاء',
    /body\[data-step="1"\] \.profile-card[\s\S]{0,260}background:#fff!important/.test(ap) &&
    /--ui-field:#ffffff/.test(ap) && /--ui-cream:#ffffff/.test(ap));
  check('لوحة الفلاتر زجاج كحلي بحقول بيضاء ونصوص فاتحة',
    /body\[data-step="6"\] \.job-filters\{[\s\S]{0,320}rgba\(255,255,255,\.10\)/.test(ap) &&
    /body\[data-step="6"\] \.job-filters input:not\(\[type=checkbox\]\)[\s\S]{0,200}background:#fff!important/.test(ap));
  check('كل وظيفة في كارت أبيض بنصوص كحلية وأجر بحدّ أخضر نيون (بلا كريمي)',
    /body\[data-step="6"\] #jobs-list \.job-card\{[\s\S]{0,120}background:#fff!important/.test(ap) &&
    /body\[data-step="6"\] #jobs-list \.jm\{[\s\S]{0,200}background:#f7f9fa/.test(ap) &&
    /body\[data-step="6"\] #jobs-list \.job-card\{[\s\S]{0,200}color:#0d2f3d/.test(ap));
  check('الكارت المختار: حدّ ذهبي 2px بظل — والنصوص تبقى كحلية (لا أبيض على أبيض)',
    /body\[data-step="6"\] #jobs-list \.job-card\.selected\{[\s\S]{0,200}border:2px solid #C8A24A/.test(ap) &&
    /body\[data-step="6"\] #jobs-list \.jm \.jm-k\{color:#8A7B5C!important\}/.test(ap));
  check('المراجعة: بطاقة بيضاء + كارت كحلي للوظائف المختارة',
    /body\[data-step="7"\] \.rv-card\{[\s\S]{0,200}background:#FFFFFF!important/.test(ap) &&
    /\.rv-jobs\{[\s\S]{0,300}linear-gradient\(165deg,#1E4270,#16304F 58%,#0D2247\)/.test(ap) &&
    /h\+='<div class="rv-jobs">'/.test(ap));
  check('زر الوظائف في المراجعة اسمه «اختر الوظيفة» (لا «تعديل»)',
    /var label=\(step===6\)\?'اختر الوظيفة':'تعديل'/.test(ap) &&
    !/onclick="G.editStep\(6\)">تعديل</.test(ap));
  check('زر الإتمام ذهبي بلمعة (نقطة القرار)',
    /#btn-finish\{[\s\S]{0,240}linear-gradient\(135deg,#E8D089,#C8A24A 55%,#B08D3C\)/.test(ap));
  check('شرائح المراجعة سطر واحد بلا التفاف داخل الكارت الكحلي',
    /body\[data-step="7"\] \.rv-jobs \.rv-chip\{[\s\S]{0,200}white-space:nowrap/.test(ap));
}

/* ── 2026-10-27 (ز): كارت الوظيفة المرتّب · البورتريه · «اختيار الوظيفة» ── */
step(33, 'كارت الوظيفة: ترتيب وأيقونات أصغر · بورتريه · «اختيار الوظيفة»');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('زر التعيين صار «اختيار الوظيفة» (لا «تعيين للفرصة»)',
    /\">اختيار الوظيفة<\/button>/.test(ap) && /G\.pickJob\(/.test(ap) &&
    !/تعيين للفرصة/.test(ap));
  check('المختارة: «متابعة للطلب» + «إلغاء الاختيار» (بلا تكرار رقم الفرصة)',
    /متابعة للطلب<\/button>/.test(ap) && /إلغاء الاختيار<\/button>/.test(ap) &&
    !/مختارة \(فرصة /.test(ap));
  check('«البورتريه»: المختارة تبرز (زوم إن) والبقية تُغبَّش وتُعتَّم',
    /#jobs-list\.has-focus \.job-card:not\(\.selected\)\{[\s\S]{0,220}blur\(2\.6px\)[\s\S]{0,120}opacity:\.5/.test(ap) &&
    /#jobs-list\.has-focus \.job-card\.selected\{[\s\S]{0,220}scale\(1\.03\)/.test(ap));
  check('شبكة كل معلومة: أيقونة + تسمية صغيرة + قيمة (لا صفوف طويلة)',
    /<div class="jm">'\+G\.jobIcon\('pin'\)\+'<span class="jm-k">المحافظة<\/span><span class="jm-v">/.test(ap) &&
    /#jobs-list \.jm\{[\s\S]{0,320}grid-template-columns:22px 1fr/.test(ap) &&
    /#jobs-list \.jm \.jm-k\{[\s\S]{0,120}font-size:10px/.test(ap));
  check('كارت أصغر ومرتّب: حشوة 14px وشبكة عمودين وأزرار صفّ واحد',
    /#jobs-list \.job-card\{[\s\S]{0,200}padding:14px 14px 0!important/.test(ap) &&
    /#jobs-list \.job-meta\{[\s\S]{0,120}grid-template-columns:1fr 1fr/.test(ap));
  check('المختارة لها تمييز واضح: حدّ ذهبي خارجي + شريط علوي + شارة داخلية',
    /#jobs-list \.job-card\.selected\{[\s\S]{0,400}outline:2px solid #C8A24A/.test(ap) &&
    /#jobs-list \.job-card\.selected \.job-head::after\{/.test(ap) &&
    /'★ الفرصة '\s*\+/.test(ap));
  check('حركة دخول الكروت متتالية مع تقليل الحركة',
    /@keyframes jobCardIn/.test(ap) && /job-card:nth-child\(n\+4\)\{animation-delay/.test(ap) &&
    /prefers-reduced-motion:reduce\)\{\s*#jobs-list \.job-card[\s\S]{0,160}filter:none!important/.test(ap));
}

/* ── 2026-10-27 (ح): لا كريمي · أزرار الإتمام والنتيجة ─────────────────── */
step(34, 'الألوان: أبيض · كحلي · ذهبي نيون فقط — وأزرار الإتمام والنتيجة');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('لا خلفيات كريمية كبيرة (الأسطح بيضاء · الذهب الفاتح للشرائح فقط)',
    !/#fbf7ec|#fbf4e4|#fdf9ef|#f7f0df|#f9f5ea|#fff8e4|#fff6dc|#fdf8ec|#fff7e2|#fffaeb/i.test(ap) &&
    /background:#FFFFFF!important/.test(ap));
  check('متغيّرات الهوية: كريمي = أبيض صريح، النص كحلي',
    /--ap-cream:#ffffff/.test(ap) && /--ui-cream:#ffffff/.test(ap) &&
    /--ui-ink:#0d2f3d/.test(ap));
  check('الأسطح كلها بيضاء صريحة (بطاقات · كروت · فلاتر · شرائح)',
    /\.profile-card,\.rv-card,\.job-filters,\.job-card,\.card-sheet-box,#jobs-empty\{background:#ffffff!important\}/.test(ap) &&
    /\.rv-chip,\.jf-chip,\.step-eyebrow,\.rv-note,\.identity-notice/.test(ap));
  check('الذهبي هو زر الإتمام وزر الرئيسي كحلي بحدوده (هوية الملصق)',
    /#btn-finish\{[\s\S]{0,260}linear-gradient\(135deg,#E8D089,#C8A24A 55%,#B08D3C\)/.test(ap) &&
    /\.btn-primary,body\[data-step\] \.btn-primary,#btn-finish\{[\s\S]{0,200}#1E4270/.test(ap) &&
    !/#41DE93/.test(ap));
  check('مقاس الأزرار موحّد: ٥٠px عام · ٤٤px صغير · ٥٢px في صفحات الإدخال (بدل ٦٤)',
    /\.btn\{\s*min-height:50px!important/.test(ap) &&
    /\.btn-sm\{min-height:44px!important/.test(ap) &&
    /\.btn,\.jobs-foot > \.btn-row \.btn,#pg-review > \.btn-row \.btn\{[\s\S]{0,120}min-height:52px!important/.test(ap) &&
    !/min-height:64px;font-size:20px/.test(ap));
  check('شريط المراجعة: زر رجوع صغير + «إتمام التقديم» ذهبي بارز بلمعة',
    /#pg-review > \.review-bar\{[\s\S]{0,400}position:sticky/.test(ap) &&
    /#pg-review \.review-back\{[\s\S]{0,240}min-width:104px/.test(ap) &&
    /#btn-finish\{[\s\S]{0,260}linear-gradient\(135deg,#E8D089,#C8A24A 55%,#B08D3C\)/.test(ap) &&
    /@keyframes goShine/.test(ap));
  check('أزرار صفحة النتيجة شبكة مرتّبة: طباعة ذهبية + باركود كحلي + رابط هادئ',
    /\.result-actions\{[\s\S]{0,160}grid-template-columns:1fr 1fr/.test(ap) &&
    /body\[data-step="8"\] \.result-actions \.btn-primary\{[\s\S]{0,240}linear-gradient\(135deg,#E8D089/.test(ap) &&
    /\.btn-quiet\{[\s\S]{0,200}background:transparent/.test(ap));
  check('صفحة النتيجة داخل الواجهة الكحلية والاستمارة تبقى بيضاء',
    /body\[data-step="8"\]\{color:#eaf3f6!important\}/.test(ap) &&
    /body\[data-step="8"\] #result-content \.ok-hero\{[\s\S]{0,200}background:#ffffff/.test(ap));
}

/* ── 2026-10-28 (ط): هوية الملصق (كحلي · ذهبي · أبيض) على كل صفحات التقديم ── */
step(35, 'صفحات البطاقة: كحلي + ذهبي + أبيض (هوية الملصق)');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('لوحة الملصق معلنة (#16304F كحلي · #C8A24A ذهبي · #E6DCC6 حدود)',
    /--ps-navy:#16304F/.test(ap) && /--ps-gold:#C8A24A/.test(ap) &&
    /--ps-gold-2:#E3C479/.test(ap) && /--ps-line:#E6DCC6/.test(ap));
  check('خلفية صفحات التقديم كحلي الملصق بهالتين ذهبيتين',
    /body\[data-step="1"\],body\[data-step="2"\],body\[data-step="3"\],body\[data-step="4"\],/.test(ap) &&
    /background-color:#0F2444!important/.test(ap) &&
    /rgba\(200,162,74,\.26\)/.test(ap));
  check('بطاقة البيانات بيضاء بحدود ذهبية رقيقة',
    /\.profile-card,\.rv-card,\.job-filters,\.job-card,\.card-sheet-box,#jobs-empty\{[\s\S]{0,160}border:1px solid var\(--ps-line\)/.test(ap));
  check('الحقول بيضاء وتتوهّج ذهبياً عند التركيز',
    /\.form-group input:focus,\.form-group select:focus\{[\s\S]{0,200}border-color:#C8A24A!important/.test(ap));
  check('زر «التالي» كحلي بحدود ذهبية (زر الملصق)',
    /\.btn-primary,body\[data-step\] \.btn-primary,#btn-finish\{[\s\S]{0,220}linear-gradient\(135deg,#1E4270,#16304F 52%,#0D2247\)/.test(ap));
  check('نقاط التقدّم ذهبية والكبسولة ذهبية شفافة',
    /\.step-dot\.done\{background:linear-gradient\(90deg,#B08D3C,#E3C479\)/.test(ap) &&
    /\.step-dot\.active\{[\s\S]{0,180}linear-gradient\(90deg,#E8D089,#C8A24A\)/.test(ap) &&
    /rgba\(200,162,74,\.18\)!important/.test(ap));
  check('الجنس: المختارة ذهبية وأيقونتها كحلية بذهبي',
    /\.gender-opt\.selected\{[\s\S]{0,240}border-color:#C8A24A!important/.test(ap) &&
    /\.gender-opt\.selected \.icon\{background:#16304F!important/.test(ap));
  check('خطوات الوظائف والمراجعة والنتيجة ذهبية/كحلية (٦ · ٧ · ٨)',
    /body\[data-step="6"\] \.jf-more\{[\s\S]{0,220}rgba\(200,162,74,\.22\)/.test(ap) &&
    /body\[data-step="7"\] \.rv-jobs\{[\s\S]{0,260}linear-gradient\(165deg,#1E4270,#16304F 58%,#0D2247\)/.test(ap) &&
    /body\[data-step="8"\] \.result-actions \.btn-ghost-gold\{[\s\S]{0,240}linear-gradient\(135deg,#1E4270,#16304F\)/.test(ap));
  check('زر «إتمام التقديم» ذهبي بارز بلمعة',
    /#btn-finish\{[\s\S]{0,260}linear-gradient\(135deg,#E8D089,#C8A24A 55%,#B08D3C\)/.test(ap) &&
    /@keyframes goShine/.test(ap));
  check('الكلمات المميّزة في ملاحظة المراجعة مقروءة (كحلي على ذهبي فاتح)',
    /\.rv-note b,\.rv-note strong\{color:#0D2247!important;background:#FDF3D8!important/.test(ap));
  check('لا أخضر نيون ولا نيلي في صفحة التقديم (هوية واحدة فقط)',
    !/#22C55E|#6EE7A8|#1B4C8F|#2F6FD0|#60AAFF/.test(ap) &&
    !/%2360AAFF/.test(ap));
}

/* ── 2026-10-28 (ي): نافذة الوظيفة المنبثقة وتغبيش ما وراءها ───────────── */
step(36, 'نافذة الوظيفة: صفحة منبثقة وكل ما وراءها يُغبَّش');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('نافذة الوظيفة موجودة داخل الصفحة (role=dialog + aria-modal)',
    /<div class="job-modal" id="job-modal" hidden role="dialog" aria-modal="true"/.test(ap) &&
    /id="jm-title"/.test(ap) && /id="job-modal-body"/.test(ap) && /id="job-modal-foot"/.test(ap));
  check('الضغط على أي كارت وظيفة يفتح النافذة (لا يعيّن مباشرة)',
    /onclick="G\.openJob\(/.test(ap) && !/article class="job-card[\s\S]{0,200}G\.pickJob\(/.test(ap) &&
    /tabindex="0" role="button"/.test(ap));
  check('كل ما وراء النافذة يُغبَّش ويُعتَّم ويمتنع عن التفاعل',
    /body\.job-modal-open \.app\{[\s\S]{0,220}filter:blur\(7px\)/.test(ap) &&
    /pointer-events:none/.test(ap) &&
    /html:has\(body\.job-modal-open\)\{overflow-x:clip\}/.test(ap));
  check('النافذة بيضاء بحدود ذهبية ورأس كحلي (ورقة سفلية على الجوال، وسط على الكمبيوتر)',
    /\.job-modal-box\{[\s\S]{0,260}background:#fff/.test(ap) &&
    /@media\(min-width:761px\)\{[\s\S]{0,160}align-items:center/.test(ap));
  check('داخل النافذة: المحافظة · الدوام · الجنس · الشواغر · الأجر · الوصف · المتطلبات',
    /jm-cell[\s\S]{0,120}المحافظة/.test(ap) && /الجنس المطلوب/.test(ap) &&
    /الشواغر/.test(ap) && /الأجر الشهري/.test(ap) &&
    /وصف الوظيفة/.test(ap) && /المتطلبات/.test(ap));
  check('أزرار النافذة: «اختيار الوظيفة» أو «متابعة للطلب» + «إغلاق»',
    /G\.pickFromModal\(/.test(ap) && /G\.modalNext\(\)/.test(ap) &&
    /class="btn btn-outline" onclick="G\.closeJob\(\)">إغلاق/.test(ap));
  check('الإغلاق بالضغط على الخلفية أو زر الإغلاق أو مفتاح ESC',
    /class="job-modal-veil" onclick="G\.closeJob\(\)"/.test(ap) &&
    /id="jm-close" onclick="G\.closeJob\(\)"/.test(ap) &&
    /Escape'\|\|key===27/.test(ap));
  check('فتح الكارت بلوحة المفاتيح (Enter / Space)',
    /key==='Enter'\|\|key===' '\|\|key==='Spacebar'/.test(ap) && /G\.openJob\(code\)/.test(ap));
  check('النافذة خارج .app حتى لا تتأثر بالتغبيش',
    !/job-modal" id="job-modal"[\s\S]{0,50}<\/div>\s*<div class="app"/.test(ap) &&
    /<div class="job-modal" id="job-modal"/.test(ap));
  check('تفاصيل الوظيفة لم تبقَ مكرّرة داخل الكارت',
    !/id="details-'\+esc\(j\.code\)/.test(ap));
}

/* ── 2026-10-28 (ك): كروت وظائف البطاقة بنفس شكل كروت الموقع ─────────────── */
step(37, 'كروت الوظائف في البطاقة: نفس شكل كروت الموقع الرئيسي');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('الكارت يبدأ بمساحة صورة (job-media) وشارة الحالة فوقها',
    /<div class="job-media'\+\(j\.imageUrl\?' has-img':''\)\+'">/.test(ap) &&
    /body\[data-step="6"\] #jobs-list \.job-media\{[\s\S]{0,220}aspect-ratio:16\/9/.test(ap));
  check('الصورة تُعرض كاملة ووسط تعبئة ضبابية (contain + blur)',
    /#jobs-list \.job-thumb img\{[\s\S]{0,160}object-fit:contain!important/.test(ap) &&
    /#jobs-list \.job-thumb::before\{[\s\S]{0,160}blur\(14px\)/.test(ap));
  check('شارة «متاحة» ذهبية فاتحة (هوية الملصق) لا خضراء',
    /body\[data-step="6"\] #jobs-list \.job-state\.is-open\{[\s\S]{0,200}linear-gradient\(135deg,#FFF4D6,#EFDDA8\)/.test(ap));
  check('العنوان ثم شريحتا الكود والتخصص داخل المتن',
    /<h4 class="title">'\+esc\(j\.title\)/.test(ap) &&
    /<span class="job-code">'\+esc\(j\.code\)/.test(ap) &&
    /<span class="job-cat">'\+esc\(j\.category\|\|'—'\)/.test(ap));
  check('صفوف المعلومات: أيقونة + تسمية صغيرة + قيمة في كل صف',
    /body\[data-step="6"\] #jobs-list \.jm\{[\s\S]{0,260}flex-direction:row-reverse/.test(ap) &&
    /\.jm \.jm-k\{[\s\S]{0,120}font-size:10\.5px/.test(ap) &&
    /\.jm \.jm-v\{[\s\S]{0,160}margin-inline-start:auto/.test(ap));
  check('سطر الأجر شريط ذهبي فاتح واضح',
    /body\[data-step="6"\] #jobs-list \.job-pay\{[\s\S]{0,240}background:#FDF6E4!important/.test(ap));
  check('زرّا الكارت جنباً إلى جنب: «اختيار الوظيفة» كحلي + «تفاصيل الوظيفة» أبيض',
    /body\[data-step="6"\] #jobs-list \.job-actions\{[\s\S]{0,220}grid-template-columns:1\.15fr \.95fr/.test(ap) &&
    /onclick="event\.stopPropagation\(\);G\.pickJob\([\s\S]{0,80}>اختيار الوظيفة/.test(ap) &&
    /job-details-btn" onclick="event\.stopPropagation\(\);G\.openJob\(/.test(ap));
  check('الضغط على الكارت يفتح النافذة ويُغبّش المحيط (كما هو)',
    /onclick="G\.openJob\(/.test(ap) && /body\.job-modal-open \.app\{[\s\S]{0,160}blur\(7px\)/.test(ap));
  check('الكارت المختار: إطار ذهبي ونصوصه تبقى كحلية',
    /body\[data-step="6"\] #jobs-list \.job-card\.selected\{[\s\S]{0,200}border:2px solid #C8A24A/.test(ap) &&
    /\.job-card\.selected \.jm \.jm-v,[\s\S]{0,140}color:#16294A!important/.test(ap));
}

/* ── 2026-10-28 (ل): أزرار ما بعد الاستمارة: صغيرة ومرتّبة وحركة ظهور ────── */
step(38, 'أزرار صفحة الاستمارة: مقاسات صغيرة · ألوان الهوية · ظهور متتالٍ');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');
  const shell = readFileSync(join(ROOT, 'assets/css/app-shell.css'), 'utf8');

  check('أزرار النتيجة ٤٢px (والطباعة ٤٤px) لا ٥٤px',
    /\.result-actions \.btn\{[\s\S]{0,260}height:42px!important/.test(ap) &&
    /\.ra-print,[\s\S]{0,160}height:44px!important/.test(ap));
  check('النصوص مختصرة: «طباعة الاستمارة» · «وظيفة ثانية» · «نسخ الرابط»',
    /rar-print/.test(ap) === false &&
    /طباعة الاستمارة<\/button>/.test(ap) &&
    /وظيفة أخرى<\/button>/.test(ap) &&
    /نسخ الرابط<\/button>/.test(ap));
  check('التفاصيل الكاملة في aria-label (وصولية بلا نص طويل)',
    /aria-label="طباعة الاستمارة على ورقة A4"/.test(ap) &&
    /aria-label="استخدام باركود البطاقة لاختيار وظيفة أخرى"/.test(ap));
  check('الألوان: طباعة ذهبية · وظيفة ثانية كحلية بحدود ذهبية · نسخ أبيض',
    /\.result-actions \.ra-print\{[\s\S]{0,300}linear-gradient\(135deg,#E8D089,#C8A24A 58%,#B08D3C\)/.test(ap) &&
    /\.result-actions \.ra-second\{[\s\S]{0,220}linear-gradient\(140deg,#1E4270,#16304F 60%,#0D2247\)/.test(ap) &&
    /\.result-actions \.ra-copy\{[\s\S]{0,160}background:#fff!important/.test(ap));
  check('ظهور متتالٍ هادئ للأزرار + احترام تقليل الحركة',
    /@keyframes raIn/.test(ap) && /animation-delay:\.16s/.test(ap) &&
    /prefers-reduced-motion:reduce\)\{\s*\.result-actions \.btn\{animation:none!important\}/.test(ap));
  check('زر «العودة للوظائف» رابط هادئ صغير (٣٤px)',
    /\.result-back \.btn-quiet\{[\s\S]{0,200}height:34px!important/.test(ap));
  check('شريط الأزرار لا يمتدّ بعرض الصفحة على الكمبيوتر (٤٦٠px)',
    /\.result-actions\{[\s\S]{0,260}max-width:460px/.test(ap));
  check('ألوان الموقع العام كلها من كحلي/ذهبي (لا أخضر/بنفسجي/تركوازي)',
    /--v-teal: #1E4270/.test(shell) && /--v-amber: #C8A24A/.test(shell) &&
    !/#0f9c94|#2563d9|#7c4ddb|#d98324|#16a34a/.test(shell) &&
    /\.ac-badge\.is-vacant \{[\s\S]{0,140}#1E4270/.test(shell));
}

/* ── 2026-10-29 (م): نافذة «تفاصيل البطاقة»: تباين قوي ونصوص واضحة ───────── */
step(39, 'تفاصيل البطاقة: نص داكن على أبيض · تاريخ عربي · تفاصيل كل فرصة');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('خلفية النافذة بيضاء وحدودها ذهبية',
    /\.card-sheet-box\{[\s\S]{0,300}background:#FFFFFF!important;color:var\(--cs-value\)/.test(ap) &&
    /border:1px solid #E6DCC6!important;border-radius:20px!important/.test(ap));
  check('تسميات الحقول دافئة واضحة والقيم كحلية غامقة (لا #93a3bf الباهت)',
    /--cs-label:#6F6152/.test(ap) && /--cs-value:#16294A/.test(ap) &&
    /\.cs-f span\{[\s\S]{0,220}color:var\(--cs-label\)!important/.test(ap) &&
    /\.cs-f b\{[\s\S]{0,220}color:var\(--cs-value\)!important/.test(ap));
  check('حقول التفاصيل على خلفية عاجية فاتحة بحدود ناعمة',
    /\.cs-f\{[\s\S]{0,200}background:var\(--cs-card\)!important/.test(ap));
  check('تاريخ الميلاد يُعرض عربياً (يوم شهر سنة)',
    /function arabicDate\(iso\)/.test(ap) &&
    /var months=\['كانون الثاني','شباط','آذار','نيسان','أيار','حزيران'/.test(ap) &&
    /var dob=p\.dob\?G\.arabicDate/.test(ap));
  check('كل فرصة تعرض تفاصيل وظيفتها (المحافظة · الدوام · الأجر)',
    /cs-chance-meta/.test(ap) && /detail\.location,detail\.shift/.test(ap) && /detail\.salaryMin/.test(ap));
  check('حالات الفرص بألوان واضحة (ذهبي/أزرق/أخضر/أحمر) بنص داكن',
    /\.cs-chance\.is-open \.cs-chance-state\{[\s\S]{0,160}#FFF1CB/.test(ap) &&
    /\.cs-chance\.is-closed \.cs-chance-state\{[\s\S]{0,160}#FDECEA/.test(ap));
  check('أزرار النافذة بمقاس طبيعي ٤٤px وبلون الهوية',
    /\.card-sheet-foot \.btn\{[\s\S]{0,260}height:44px!important/.test(ap) &&
    /\.btn-sheet-close\{[\s\S]{0,220}background:#fff!important/.test(ap));
  check('النافذة متجاوبة: عمودان على الجوال وعمود واحد تحت ٣٦٠px',
    /@media\(max-width:560px\)\{[\s\S]{0,200}\.cs-grid\{grid-template-columns:1fr 1fr/.test(ap) &&
    /@media\(max-width:360px\)\{\s*\.cs-grid\{grid-template-columns:1fr!important\}/.test(ap));
}

/* ── 2026-11-07 (ن): «الوظائف التي قمت باختيارها» — تفاصيل الوظيفة وصاحب العمل ── */
step(40, 'اللوحة: كل صف يفتح تفاصيل الوظيفة وصاحب العمل · بلا اختلاق بيانات');
{
  const ap = readFileSync(join(ROOT, 'apply.html'), 'utf8');

  check('كل صف في اللوحة قابل للفتح (role=button + data-chosen-kind)',
    /data-chosen-kind="applied"/.test(ap) && /data-chosen-kind="picked"/.test(ap) &&
    /role="button" tabindex="0"/.test(ap) && /chosen-item is-tappable is-applied/.test(ap) &&
    /chosen-item is-tappable is-picked-row/.test(ap));
  check('تمييز الصفوف: شريط أخضر لـ«تم التقديم» وذهبي لـ«مختارة»',
    /\.chosen-item\.is-applied\{[^}]*border-inline-start:3px solid #4bc08d/.test(ap) &&
    /\.chosen-item\.is-picked-row\{[^}]*border-inline-start:3px solid #e8c56d/.test(ap));
  /* عطل 2026-11-08: كارت صاحب العمل كان 29px لمحتوى 304px لأن overflow:hidden
     داخل شبكة يجعل العنصر «حاوية تمرير» بارتفاع صفر في Chromium. */
  check('أقسام النافذة بلا overflow:hidden (حرس ضد انكماش الكارت)',
    !/\.cdt-emp\{[^}]*overflow:hidden/.test(ap) && !/\.cdt-hero\{[^}]*overflow:hidden/.test(ap));
  check('أبناء عمود النافذة: رأس ومراحل وقدم flex:none والجسم وحده يتمرّر',
    /\.cdt-head\{[\s\S]{0,160}flex:none/.test(ap) && /\.cdt-steps\{[\s\S]{0,80}flex:none/.test(ap) &&
    /\.cdt-foot\{[\s\S]{0,120}flex:none/.test(ap) && /\.cdt-body\{[\s\S]{0,60}flex:1 1 auto;min-height:0/.test(ap));
  check('نافذة الوظيفة القديمة أُصلحت من نفس العلّة (رأس/قدم ثابتان)',
    /\.job-modal-head\{[\s\S]{0,140}flex:none/.test(ap) &&
    /\.job-modal-foot\{[\s\S]{0,120}flex:none/.test(ap) &&
    /\.job-modal-body\{[\s\S]{0,60}flex:1 1 auto;min-height:0/.test(ap));
  check('زر داخل الصف (إلغاء الاختيار) لا يفتح النافذة',
    /closest\('button,a'\)\)return/.test(ap));
  check('لوحة المفاتيح: Enter/المسافة على الصف يفتحان النافذة',
    /chosenRowKey:function\(ev,kind,key\)/.test(ap) && /onkeydown="G\.chosenRowKey\(/.test(ap));
  check('نافذة مستقلة بمعرّف chosen-modal وأربعة أجزاء (رأس · مراحل · جسم · أزرار)',
    /id="chosen-modal"/.test(ap) && /id="cdt-steps"/.test(ap) &&
    /id="chosen-modal-body"/.test(ap) && /id="chosen-modal-foot"/.test(ap));
  check('بيانات صاحب العمل تُجلب من customer_application_details وحدها',
    /client\.rpc\('customer_application_details',\{p_serial:cardSerial,p_attempt_no:no\}\)/.test(ap) &&
    !/public_jobs[\s\S]{0,200}employer_name/.test(ap.split('loadChosenEmployer')[1]?.slice(0, 1200) || ''));
  check('تحقق صارم: رقم البطاقة + رقم الفرصة + كود الوظيفة قبل العرض',
    /String\(d\.app\.serial\)\.toUpperCase\(\)!==String\(cardSerial\)\.toUpperCase\(\)/.test(ap) &&
    /Number\(d\.attempt\.no\)!==no/.test(ap) && /d\.attempt\.jobCode!==st\.code/.test(ap));
  check('«مختارة للمراجعة»: لا يُختلق صاحب عمل — رسالة صريحة بدلاً منه',
    /is-locked/.test(ap) && /تظهر بعد التقديم/.test(ap) && /لا تعرض الشركة اسم صاحب العمل/.test(ap));
  check('بلا نداء تفاصيل لصف لم يُقدَّم (loadChosenEmployer للصفوف المقدَّمة فقط)',
    /if\(st\.loading\)G\.loadChosenEmployer\(st,seq\)/.test(ap) && /st\.loading=!!\(st\.slotNo&&!st\.attempt\)/.test(ap));
  check('تعذّر التحميل: رسالة + إعادة محاولة (لا بيانات وهمية)',
    /تعذّر تحميل بيانات صاحب العمل/.test(ap) && /retryChosenEmployer:function\(\)/.test(ap));
  check('حركة دخول احترافية: صندوق · ستارة · أقسام متتالية (--i) · لمعة الرأس',
    /@keyframes cdtSheetIn/.test(ap) && /@keyframes cdtVeilIn/.test(ap) &&
    /@keyframes cdtUp/.test(ap) && /@keyframes cdtSheen/.test(ap) &&
    /animation-delay:calc\(var\(--i,0\) \* 55ms\)/.test(ap));
  check('تغبيش ما وراء النافذة وESC يغلقها',
    /body\.chosen-modal-open \.app\{[\s\S]{0,120}filter:blur\(7px\)/.test(ap) &&
    /key==='Escape'\|\|key===27\)&&document\.body\.classList\.contains\('chosen-modal-open'\)/.test(ap));
  check('كل الحركات تتوقف عند prefers-reduced-motion',
    /prefers-reduced-motion:reduce\)\{[\s\S]{0,260}\.chosen-modal-box,\.chosen-modal-veil,\.cdt-anim/.test(ap));
  check('تصميم ٣٢٠px: أزرار بعرض كامل وخطوط أصغر',
    /@media\(max-width:360px\)\{[\s\S]{0,400}\.cdt-foot \.btn\{flex:1 1 100%!important\}/.test(ap));
}

/* ---------------------------------- الخلاصة ---------------------------------- */
console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
