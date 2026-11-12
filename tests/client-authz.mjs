#!/usr/bin/env node
/* ===========================================================================
 *  HRC — فحص حدود الصلاحيات في المتصفح (Client-Side Authorization)
 *  ---------------------------------------------------------------------------
 *  لماذا هذا الملف؟
 *  الصفحة العامة تحمّل store.js كاملاً لأنها تحتاجه للعرض. وهذا يعني أن أي
 *  زائر يقدر يفتح وحدة التحكم وينادي أي دالة في HRCStore. الحماية الحقيقية
 *  في القاعدة (RLS)، لكن الواجهة يجب ألا تُنتج آثاراً محلية تُضلّل من يراها:
 *
 *    • وظيفة مزروعة تظهر في البحث وعدّاد «متاحة الآن» → دليل مصوّر كاذب.
 *    • تعديل/حذف إعلان في جلسة الزائر → شاشة تعرض بيانات غير صحيحة.
 *
 *  هذا الفحص يُشغّل index.html فعلياً بـjsdom ثم يحاول الاستغلال، ويتأكد من
 *  أن الحارس على مستوى الدالة (لا الزر) يرفض — وأن المدير ما زال يقدر.
 *
 *  التشغيل: node tests/client-authz.mjs
 * =========================================================================== */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let pass = 0, fail = 0;
const problems = [];
const ok = (t) => { pass++; console.log('   ✅ ' + t); };
const bad = (t, d) => { fail++; problems.push(t + (d ? ' — ' + d : '')); console.log('   ❌ ' + t + (d ? '  → ' + d : '')); };
const check = (t, c, d) => (c ? ok(t) : bad(t, d));
const step = (n, t) => console.log('\n▌ ' + n + ' — ' + t);

console.log('\n' + '═'.repeat(74));
console.log('  HRC — حدود الصلاحيات في المتصفح');
console.log('═'.repeat(74));

const html = resolve('index.html');
const dom = await JSDOM.fromFile(html, {
  url: 'file://' + html,
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true
});
await new Promise((r) => setTimeout(r, 2500));
const w = dom.window;
const S = w.HRCStore;

step(1, 'الصفحة العامة تحمّل المتجر (واقع لا يُغيَّر) لكن الدوال محمية');
{
  check('HRCStore مكشوف في الصفحة العامة (تحتاجه للعرض)', !!S);
  check('createJob موجودة كدالة (لا يُعتمد على إخفائها)', typeof S.createJob === 'function');
  check('deleteJob موجودة كدالة', typeof S.deleteJob === 'function');
  check('setJobStatus موجودة كدالة', typeof S.setJobStatus === 'function');
}

step(2, 'الاستغلال: زائر مجهول يحاول زرع/تعديل/حذف وظيفة');
{
  const job = { code: 'X', title: 'وظيفة مزورة بالكامل', category: 'c', shift: 's',
    employerName: 'e', requirements: [], gender: 'لا فرق', region: 'بابل',
    governorate: 'بابل', salaryMin: 1, salaryMax: 2, vacancies: 1 };

  const before = S.db().jobs.length;
  const created = S.createJob(job);
  const after = S.db().jobs.length;

  check('createJob بلا تسجيل دخول يُرجع null', created === null, JSON.stringify(created));
  check('عدد الوظائف لم يتغيّر', before === after, before + ' → ' + after);
  check('لا وظيفة مزوّرة في بيانات الجلسة', !S.db().jobs.some((j) => /مزورة/.test(j.title)));

  /* لا شيء يظهر في الواجهة أيضاً */
  check('لا عنوان مزوّر في الصفحة', ![...w.document.querySelectorAll('.job-title')].some((e) => /مزورة/.test(e.textContent)));

  check('setJobStatus يُرجع false', S.setJobStatus('HRC-1', 'closed', 'x') === false);
  check('deleteJob يُرجع false', S.deleteJob('HRC-1') === false);
}

step(2.5, 'كل دوال الكتابة التشغيلية محمية (جولة تدقيق 2026-11-11)');
{
  const src = readFileSync('assets/js/store.js', 'utf8');
  /* دوال تكتب بيانات تشغيلية/مالية — يجب أن تحمل حارساً في أول سطورها. */
  const guarded = {
    createJob: /function createJob\(data\) \{[\s\S]{0,900}if \(!isStaffSession\(\)\) return null;/,
    setJobStatus: /function setJobStatus\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    deleteJob: /function deleteJob\(code\) \{[\s\S]{0,900}if \(!isStaffSession\(\)\)/,
    updateJob: /function updateJob\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    approveApplicant: /function approveApplicant\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    rejectApplicant: /function rejectApplicant\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    setFeePaid: /function setFeePaid\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    releaseHold: /function releaseHold\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    setOutcome: /function setOutcome\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    markPrinted: /function markPrinted\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    importJson: /function importJson\([^)]*\) \{[\s\S]{0,700}if \(!isAdmin\(\)\) throw new Error/
  };
  for (const [fn, re] of Object.entries(guarded)) {
    check(fn + ' محمية بحارس صلاحية', re.test(src));
  }

  /* الاستغلال الفعلي: كلها تُرفض بلا جلسة */
  const job = { code: 'X', title: 't', category: 'c', shift: 's', employerName: 'e',
    requirements: [], gender: 'لا فرق', region: 'بابل', governorate: 'بابل',
    salaryMin: 1, salaryMax: 2, vacancies: 1 };
  check('approveApplicant مرفوضة للزائر', S.approveApplicant('HRC-BC-000120').ok === false);
  check('rejectApplicant مرفوضة للزائر', S.rejectApplicant('HRC-BC-000120', 'x').ok === false);
  check('releaseHold مرفوضة للزائر', S.releaseHold('HRC-BC-000120', 1, 'x').ok === false);
  check('setOutcome مرفوضة للزائر', S.setOutcome('HRC-BC-000120', 1, 'succeeded').ok === false);
  let importBlocked = false;
  try { S.importJson('{}'); } catch (e) { importBlocked = /مدير/.test(e.message); }
  check('importJson مرفوض للزائر', importBlocked);
  /* setFeePaid و markPrinted تُرجع undefined بلا جلسة (بلا أثر) */
  const beforeFee = JSON.stringify(S.getApplicant('HRC-BC-000120') || {});
  S.setFeePaid('HRC-BC-000120', true, 1000);
  check('setFeePaid بلا أثر على الزائر', JSON.stringify(S.getApplicant('HRC-BC-000120') || {}) === beforeFee);
  const beforePrint = (S.getApplicant('HRC-BC-000120') || {}).printedCount;
  S.markPrinted('HRC-BC-000120');
  check('markPrinted بلا أثر على الزائر', ((S.getApplicant('HRC-BC-000120') || {}).printedCount) === beforePrint);

  /* useChance مقصودة للزائر: تمرّ إلى RPC القاعدة التي تتحقق من الرمز */
  check('useChance تبقى متاحة (التحقق في القاعدة لا الواجهة)',
    /function useChance\([^)]*\) \{[\s\S]{0,400}rpcCall\(client, 'apply_with_card'|function useChance\([^)]*\) \{(?![\s\S]{0,700}isStaffSession)/.test(src) ||
    /apply_with_card/.test(readFileSync('assets/js/cloud.js', 'utf8')));
}

step(2.9, 'كل دالة إنشاء/تعديل بيانات لها حارس (جرد 2026-11-11)');
{
  const src = readFileSync('assets/js/store.js', 'utf8');
  /* الدوال التي تنشئ أو تعدّل بيانات تشغيلية — يجب أن تحمل حارساً.
     الاختبار الفعلي للرفض أدناه؛ هذا فحص مصدري يمنع العودة للثغرة. */
  const writers = {
    createJob: /function createJob\(data\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    updateJob: /function updateJob\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    deleteJob: /function deleteJob\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    setJobStatus: /function setJobStatus\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    createApplicant: /function createApplicant\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    createCardBatch: /function createCardBatch\([^)]*\) \{[\s\S]{0,700}if \(!isAdmin\(\)\) return \[\];/,
    createCardWithSerial: /function createCardWithSerial\([^)]*\) \{[\s\S]{0,700}if \(!isAdmin\(\)\)/,
    activateCard: /function activateCard\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    approveApplicant: /function approveApplicant\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    rejectApplicant: /function rejectApplicant\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    setFeePaid: /function setFeePaid\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    markPrinted: /function markPrinted\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    releaseHold: /function releaseHold\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    setOutcome: /function setOutcome\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\)/,
    importJson: /function importJson\([^)]*\) \{[\s\S]{0,700}if \(!isAdmin\(\)\) throw/
  };
  for (const [fn, re] of Object.entries(writers)) {
    check(fn + ' محمية بحارس صلاحية', re.test(src));
  }

  /* والاختبار الفعلي: كلها تُرفض بزائر مجهول */
  check('createApplicant مرفوضة للزائر', !(S.createApplicant({ fullName: 'زائر', phone: '07700000000' }).ok));
  check('activateCard مرفوضة للزائر', !(S.activateCard('HRC-BC-000120', {}).ok));
}

step(3, 'الحارس على مستوى الدالة لا الزر (ضد الاستدعاء المباشر)');
{
  const src = readFileSync('assets/js/store.js', 'utf8');
  /* قرار المالك 2026-11-11: إدارة الوظائف والبطاقات للموظف والمدير معاً،
     مطابقةً لسياسات القاعدة (كلها is_staff). الزائر يبقى مرفوضاً. */
  check('createJob يبدأ بفحص جلسة الموظف', /function createJob\(data\) \{[\s\S]{0,900}if \(!isStaffSession\(\)\) return null;/.test(src));
  check('setJobStatus يبدأ بفحص جلسة الموظف', /function setJobStatus\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\) return false;/.test(src));
  check('updateJob محمية بحارس جلسة الموظف', /function updateJob\([^)]*\) \{[\s\S]{0,700}if \(!isStaffSession\(\)\) return null;/.test(src));
  /* إصدار البطاقات حصرياً للمدير (قرار المالك 2026-11-11) — الفحص في writers أعلاه. */
  /* الحذف: مدير وموظف (jobs_staff_delete) — لكن ليس زائراً مجهولاً. */
  check('deleteJob يبدأ بفحص جلسة الموظف', /function deleteJob\(code\) \{[\s\S]{0,900}if \(!isStaffSession\(\)\) return false;/.test(src));
  check('isStaffSession تعرّف المدير والموظف لا الزائر', /function isStaffSession\(\) \{ var u = currentUser\(\); return !!\(u && \(u\.role === 'admin' \|\| u\.role === 'staff'\)\); \}/.test(src));
}

step(4, 'عدّاد «وظيفة متاحة الآن» لا يُقرأ من بيانات قابلة للتزوير');
{
  const pub = readFileSync('assets/js/public.js', 'utf8');
  check('العدّاد العام لا يستخدم listJobs (مصدره القاعدة)', !/jobsAll = Store\.listJobs\(\{\}\)/.test(pub));
  check('العدّاد يقرأ من بيانات القاعدة في الجلسة', /jobsAll = \(Store\.db\(\) && Store\.db\(\)\.jobs\) \|\| \[\]/.test(pub));
}

step(5, 'مسارات الكتابة في القاعدة محمية على الخادم (RLS)');
{
  const schema = readFileSync('supabase/migrations/20260915000000_brc_initial_schema.sql', 'utf8');
  check('jobs عليها RLS', /alter table brc\.jobs\s+enable row level security/.test(schema));
  check('applicants عليها RLS', /alter table brc\.applicants\s+enable row level security/.test(schema));
  check('staff عليها RLS', /alter table brc\.staff\s+enable row level security/.test(schema));

  /* anon لا يملك كتابة على الجداول الحساسة */
  const grants = (schema.match(/grant [^;]*to [^;]*anon[^;]*;/g) || []).join('\n');
  const anonWritesJobs = /grant (insert|update|delete|all)[^;]*on brc\.jobs[^;]*to[^;]*anon/i.test(grants);
  check('anon لا يملك كتابة على jobs', !anonWritesJobs, grants.slice(0, 100));

  /* الإدراج العام للاستمارة يمّر عبر دالة لا إدراجاً مباشراً */
  check('إدراج الزائر يمرّ عبر request_form لا إدراجاً مباشراً',
    /function requestForm[\s\S]{0,200}rpcCall\(client, 'request_form'/.test(readFileSync('assets/js/cloud.js', 'utf8')));
}

step(6, 'الموظف المسجَّل: صلاحياته محدودة بدوره');
{
  const src = readFileSync('assets/js/store.js', 'utf8');
  check('isAdmin منفصلة عن isStaff', /function isAdmin\(\)/.test(src) && /function isStaff\(\)/.test(src) || /function isAdmin\(\)[\s\S]{0,200}role === 'admin'/.test(src));
  check('الدور يُقرأ من جلسة المتجر لا من مدخل خارجي', /function isAdmin\(\) \{ var u = currentUser\(\);[\s\S]{0,120}role === 'admin'/.test(src));
}

step(7, 'إعادة التحقق لا تُستدعى من صفحة الزائر');
{
  const build = readFileSync('tools/build.mjs', 'utf8');
  check('revalidate غير محمّلة في public', !/public: \['config', 'revalidate'/.test(build));
  check('revalidate محمّلة في dashboard', /dashboard: \['config', 'revalidate'/.test(build));
}

console.log('\n' + '═'.repeat(74));
console.log('  النتيجة: ' + (fail === 0 ? '✅ ' : '❌ ') + pass + ' ناجح | ' + fail + ' فاشل');
if (problems.length) { console.log('\n  المشاكل:'); problems.forEach((p) => console.log('   • ' + p)); }
console.log('═'.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
