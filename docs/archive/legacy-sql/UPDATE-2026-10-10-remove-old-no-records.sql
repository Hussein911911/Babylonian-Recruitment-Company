-- =====================================================================
-- حذف سجلات الاستمارات القديمة HRC-NO-… و BRC-NO-… (بيانات تجريبية)
-- =====================================================================
-- النطاق: فقط السجلات اللي تبدأ بـ HRC-NO- أو BRC-NO-.
-- لا يمسّ البطاقات الجديدة (10 خانات) ولا البطاقات الفارغة.
-- سجلات job_attempts المرتبطة تُحذف تلقائياً (cascade).
-- نسخة احتياطية قبل الحذف في brc.applicants_no_backup_20261011.
-- =====================================================================

-- 1) معاينة
select serial, status from brc.applicants
where serial ~ '^(HRC|BRC)-NO-'
order by serial;

-- 2) نسخة احتياطية
create table if not exists brc.applicants_no_backup_20261011 as
select * from brc.applicants where serial ~ '^(HRC|BRC)-NO-';

select count(*) as backup_rows from brc.applicants_no_backup_20261011;

-- 3) الحذف
delete from brc.applicants where serial ~ '^(HRC|BRC)-NO-';

-- 4) تحقق: لازم يطلع 0
select count(*) as no_left from brc.applicants where serial ~ '^(HRC|BRC)-NO-';
