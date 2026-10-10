-- =====================================================================
-- حذف البطاقات بالصيغة القديمة (HRC-BC-######) — تشغيل يدوي في Supabase
-- =====================================================================
-- ⚠️ الحذف نهائي. شغّل الخطوات بالترتيب، وراجع العدد في كل خطوة قبل التالية.
-- الأرقام القديمة تبقى محجوزة في brc.issued_serials فلا يُعاد استخدامها.
-- سجلات المحاولات (job_attempts) تُحذف تلقائياً مع البطاقة (cascade).
-- الحجوزات المرتبطة تُفكّ (set null) ولا تُحذف.

-- ---------- 1) معاينة: كم بطاقة قديمة وكم منها مبيعة/فيها بيانات ----------
select status, count(*) as cnt
from brc.applicants
where serial ~ '^HRC-BC-'
group by status
order by status;

-- ---------- 2) نسخة احتياطية قبل أي حذف ----------
create table if not exists brc.applicants_legacy_backup_20261010 as
select * from brc.applicants where serial ~ '^HRC-BC-';

select count(*) as backup_rows from brc.applicants_legacy_backup_20261010;
-- لازم يطلع backup_rows مطابق لعدد الخطوة 1

-- ---------- 3) الحذف (شغّله بعد ما تتأكد من الخطوتين السابقتين) ----------
begin;
delete from brc.applicants where serial ~ '^HRC-BC-';
-- راجع الرقم هنا. إذا مو متوقع: اكتب rollback; بدل commit;
commit;

-- ---------- 4) تحقق نهائي ----------
select count(*) as legacy_left from brc.applicants where serial ~ '^HRC-BC-';   -- لازم 0
select count(*) as total_left from brc.applicants;
