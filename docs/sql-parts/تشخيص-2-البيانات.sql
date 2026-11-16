-- ═══════════════════════════════════════════════════════════════════════════
--  HRC — تشخيص البيانات (قراءة فقط)
--  ---------------------------------------------------------------------------
--  شغّله **بعد** تشخيص-1. إن كان صفر جداول فلا معنى لهذا الملف — تخطّاه.
--
--  ⚠ إن ظهر `relation ... does not exist` فمعناه أن ذلك الجدول غير موجود،
--    وهذا في نفسه جواب مفيد. احذف ذلك السطر وأعد التشغيل.
-- ═══════════════════════════════════════════════════════════════════════════ */

/* ═══ ② هل دخلت بيانات؟ ═════════════════════════════════════════════════════
   كل صفر = القاعدة جديدة نظيفة.
   فيها أرقام = لُصقت بيانات (حقيقية أو تجريبية).
   ⚠ مؤشر خطر: إن رأيت أرقاماً هنا **ولم تلصق بياناتك بعد**، فالأغلب أن بياناتي
     التجريبية دخلت («باحث عن عمل ١») — أرسل النتيجة لي قبل أي تنظيف. */
select 'jobs'           as الجدول, count(*) as العدد from brc.jobs
union all select 'applicants',     count(*) from brc.applicants
union all select 'job_attempts',   count(*) from brc.job_attempts
union all select 'audit_log',      count(*) from brc.audit_log
union all select 'issued_serials', count(*) from brc.issued_serials
union all select 'staff',          count(*) from brc.staff
union all select 'settings',       count(*) from brc.settings
order by 1;
