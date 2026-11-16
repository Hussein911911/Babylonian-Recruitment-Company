-- ═══════════════════════════════════════════════════════════════════════════
--  HRC — تحقّق النسخة النهائي: هل البيانات وصلت كاملة؟
--  ---------------------------------------------------------------------------
--  شغّله **بعد** لصق أجزاء البيانات كلها. يجيب: هل بياناتي كلها هنا؟
--
--  ⚠ قراءة فقط.
--
--  كيف تعرف النتيجة الصحيحة؟ افتح أعلى ملف `2-data-part-01.sql` — فيه سطر:
--      --  الأعداد   : {"jobs":47,"applicants":440,...}
--  قارن أرقام هذا الجدول بتلك. **يجب أن تتطابق حرفياً.**
-- ═══════════════════════════════════════════════════════════════════════════ */

/* ═══ ① الأعداد — قارنها بسطر «الأعداد» في نسختك ═══════════════════════════ */
select 'jobs'                as الجدول, count(*) as العدّ from brc.jobs
union all select 'applicants',         count(*) from brc.applicants
union all select 'job_attempts',       count(*) from brc.job_attempts
union all select 'audit_log',          count(*) from brc.audit_log
union all select 'issued_serials',     count(*) from brc.issued_serials
union all select 'staff',              count(*) from brc.staff
union all select 'settings',           count(*) from brc.settings
union all select 'card_number_registry', count(*) from brc.card_number_registry
union all select 'recovery_chances',   count(*) from brc.recovery_chances
union all select 'recovery_prints',    count(*) from brc.recovery_prints
order by 1;

/* ═══ ② سلامة الروابط — لا بطاقة بلا وظيفة، ولا محاولة بلا بطاقة ════════════
   كل الأرقام يجب أن تكون صفراً. أي رقم = بيانات مقطوعة (استرجاع ناقص). */
select 'محاولات بلا بطاقة' as الفحص, count(*) as المخالفات
from brc.job_attempts a
where not exists (select 1 from brc.applicants p where p.serial = a.serial)

union all
/* بطاقة لها أكثر من محاولتين — السكيما تمنح فرصتين لا أكثر */
select 'بطاقة بأكثر من محاولتين', count(*)
from (select serial from brc.job_attempts group by serial having count(*) > 2) x

union all
/* محاولة «مُستهلكة» بلا وظيفة — تناقض */
select 'محاولة مستهلكة بلا وظيفة', count(*)
from brc.job_attempts
where slot_status <> 'empty' and job_code is null

union all
/* بطاقة مطبوعة بلا رقم في السجل — وثيقة بلا رقم */
select 'بطاقة بلا رقم مطبوع', count(*)
from brc.applicants p
where p.status <> 'blank'
  and not exists (select 1 from brc.card_number_registry r where r.serial = p.serial)

union all
/* فرصة في السجل بلا محاولة مقابلة */
select 'فرصة يتيمة في سجل الفرص', count(*)
from brc.recovery_chances c
where not exists (select 1 from brc.job_attempts a
                  where a.serial = c.serial and a.attempt_no = c.attempt_no)
order by 1;

/* ═══ ③ الوظائف الأساسية تعمل؟ ═════════════════════════════════════════════
   وجود الدالة لا يعني أنها تعمل. هنا ننادي دالتين للقراءة فقط.
   ⚠ إن ظهر خطأ فمعناه أن ذلك الجزء من السكيما ناقص — أرسله لي.

   استعلام منفصل (لأن الخطأ في أحدهما قد يُفشل الآخر): */
select
  brc.card_public_name('أحمد محمد علي', false) as اسم_مقنّع,
  brc.card_public_phone('07701234567', false)  as هاتف_مقنّع;
