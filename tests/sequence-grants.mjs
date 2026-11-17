/* ═══════════════════════════════════════════════════════════════════════════
   عطل «لا صلاحية كافية» قبل إنشاء النسخة — والسبب لم يكن الصلاحيات.

   بلاغ المالك (2026-11-17): صورة تُظهر
     «تعذّر إكمال المزامنة قبل النسخ: لا صلاحية كافية (RLS/منح مفقود) …
      راجع سياسات ومنح §8 و§9 في docs/schema.sql»
   و«هاي تروح من أسوي رفرش للموقع» أي أنها تختفي بعد التحديث ثم تعود.

   التشخيص على القاعدة الحقيقية (vqsvztudvfukyuerzcgx):
     ١. منح الجدول سليم: authenticated عنده INSERT على brc.audit_log ✅
     ٢. السياسة سليمة: audit_insert تقبل المدير ✅
     ٣. is_staff() و is_admin() صحيحتان ✅
     ٤. **الإدراج يفشل فعلاً**: permission denied for sequence audit_log_id_seq
     ٥. المنح على التسلسل أُعطي لـpostgres وservice_role — **لا authenticated**
     ٦. وjob_code_seq وform_serial_seq بلا أي منح إطلاقاً
     ٧. وnext_job_code ليست security definer — فتسلسل وظيفة جديد سيفشل

   هذا الفحص يمنع تكرار العطل: يتحقق أن السكيما تمنح كل التسلسلات للدور
   الصحيح، وأن رسالة الخطأ تدلّ على الحلّ الدقيق لا على «راجع §8 و§9».
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';

let ok = 0, bad = 0;
const check = (l, c, e) => { c ? ok++ : bad++; console.log(`  ${c ? '✅' : '❌'} ${l}` + (c ? '' : ' — ' + (e || ''))); };

const schema = readFileSync('docs/schema.sql', 'utf8');
const store = readFileSync('assets/js/store.js', 'utf8');

console.log('\n═══ ١) كل تسلسل في السكيما له منح ═══');
/* نستخرج كل تسلسل معرَّف، ونتأكد أن له grant على authenticated */
/* ⚠ التسلسلات الضمنية أيضاً: `bigserial`/`serial` تُنشئ تسلسلاً تلقائياً
   باسم `<table>_<column>_seq` — وهو سبب العطل الأصلي (audit_log_id_seq).
   فحص التسلسلات المعرَّفة صراحةً وحدها كان سيُفوّته تماماً. */
const explicit = [...schema.matchAll(/create\s+sequence\s+if\s+not\s+exists\s+brc\.(\w+)/gi)].map(m => m[1]);
/* اسم التسلسل الضمني = <الجدول>_<العمود>_seq — لا <العمود>_seq.
   في `audit_log` العمود `id` من نوع bigserial ← التسلسل `audit_log_id_seq`.
   فنجد الجدول الحالي، ثم العمود، ثم نُنشئ الاسم. التعبير السابق أعطى
   `id_id_seq` وهو خطأ. */
const implicit = [];
{
  /* ⚠️ لا نقرأ نصّ الملف كما هو: التعليقات العربية تذكر `select`/`where`
     فيُلتقط `settings_select_seq` وهو خيال. فنُزيل التعليقات أولاً
     (`--` إلى آخر السطر) ثم نقرأ. */
  const clean = schema.split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .filter((l) => !/^\s*$/.test(l))
    .join('\n');
  let table = null;
  for (const line of clean.split('\n')) {
    const t = /^create\s+table\s+(?:if\s+not\s+exists\s+)?brc\.(\w+)/i.exec(line);
    if (t) { table = t[1]; continue; }
    /* نُطابق بداية تعريف عمود: مسافة ثم اسم من say ٣٠ محرفاً ثم serial */
    const c = /^\s{2,}([a-z_][a-z0-9_]{0,30})\s+(?:big)?serial\s*(?:primary\s+key)?\s*,?\s*$/im.exec(line);
    if (c && table) implicit.push(`${table}_${c[1]}_seq`);
  }
}
const seqs = [...new Set([...explicit, ...implicit])];
check('وُجدت تسلسلات في السكيما', seqs.length > 0, 'لا شيء');
console.log('     التسلسلات: ' + seqs.join(' · '));

for (const s of seqs) {
  const granted = new RegExp(
    `grant[^;]*on\\s+sequence\\s+brc\\.${s}\\s+to[^;]*authenticated`, 'i').test(schema);
  check(`التسلسل ${s} ممنوح لـauthenticated`, granted,
    'لا يوجد grant — الإدراج سيفشل بـ42501');
}

console.log('\n═══ ٢) المنح يشمل USAGE و UPDATE ═══');
/* nextval يُحدّث حالة التسلسل، فلا بدّ من UPDATE لا USAGE وحده */
for (const s of seqs) {
  const line = (schema.match(new RegExp(`grant[^;]*on\\s+sequence\\s+brc\\.${s}[^;]*;`, 'i')) || [''])[0];
  check(`${s}: فيه USAGE`, /usage/i.test(line), line.slice(0, 80));
  check(`${s}: فيه UPDATE`, /update/i.test(line), line.slice(0, 80));
}

console.log('\n═══ ٣) السبب مذكور في السكيما (لئلا يُحذف) ═══');
check('السكيما تشرح عطل التسلسل', /permission denied for sequence/.test(schema));

console.log('\n═══ ٤) رسالة الخطأ تدلّ على الحلّ الدقيق ═══');
check('تستخرج اسم التسلسل من الرسالة', /sequence\\s\+\(\[a-z0-9_\.\]\+\)/i.test(store) ||
  /\/sequence\\s\+/.test(store), 'لا تستخرج الاسم');
check('تذكر grant usage, select, update', /grant usage, select, update on sequence/.test(store));
check('لا تكتفي بـ«راجع §8 و§9»', !/hint: 'راجع سياسات ومنح §8 و§9 في docs\/schema\.sql' \}/.test(store),
  'الرسالة القديمة المضلّلة ما زالت');

console.log('\n═══ ٥) الخطأ الكاذب يُمحى بعد النجاح ═══');
check('النجاح يمحو lastError', /cloud\.lastError = null;/.test(store));
check('يمحو قبل الحالة المشروطة', /else if \(res && !res\.error\)/.test(store),
  'لا يوجد فرع للنجاح');
check('يشرح السبب في تعليق', /خطأ كاذب|النجاح يمحو/.test(store));

console.log('\n' + '─'.repeat(62));
console.log(bad === 0 ? `✅ ${ok} فحصاً` : `❌ ${bad} فشل من ${ok + bad}`);
process.exit(bad === 0 ? 0 : 1);
