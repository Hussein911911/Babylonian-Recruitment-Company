-- ===========================================================================
--  تحديث 2026-10-13 — عمود brc.jobs.governorate المفقود من القواعد القائمة
--  ---------------------------------------------------------------------------
--  العطل: ملف المخطط الأول (20260915000000_brc_initial_schema.sql) كان
--  متخلفاً عن المصدر docs/schema.sql بنسختين:
--    1) سطر عمود governorate في تعريف جدول brc.jobs
--    2) ذِكره في واجهة brc.public_jobs
--  فأي قاعدة أُنشئت عبر تكاملة Supabase (التي تُطبّق supabase/migrations/ فقط)
--  لا تحتوي العمود — بينما الواجهة تكتبه في **كل** إدراج أو تعديل وظيفة
--  (assets/js/cloud.js → jobToDb)، فيُرفض الحفظ بـ42703:
--      column "governorate" of relation "jobs" does not exist
--  أي أن «إضافة وظيفة» و«تعديل وظيفة» من الداشبورد يفشلان على القاعدة الحية،
--  والقراءة تنجح (select *) فيبدو الخلل جزئياً وغامضاً.
--
--  هذا الملف: إصلاح آمن للتكرار. عمود + إعادة بناء الواجهة + إعادة المنح.
--  ⚠️ الواجهة تُسقَط ثم تُبنى من جديد (create or replace لا يقبل تغيير ترتيب
--     الأعمدة)، ولذلك يُعاد منح anon بعدها صراحةً — بدونه يفقد الزائر الوظائف
--     المعلنة ويظهر الموقع بلا وظائف بلا أي رسالة خطأ.
--
--  التشغيل: يُطبَّق تلقائياً عند الدمج في main (تكاملة Supabase)،
--  أو الصقه في SQL Editor ونفّذه مرة واحدة. ثم:  notify pgrst, 'reload schema';
-- ===========================================================================

alter table brc.jobs
  add column if not exists governorate text not null default 'بابل';

comment on column brc.jobs.governorate is 'المحافظة — بابل افتراضاً (تُعرض للزائر وتُفلتر بها الصفحة العامة)';

-- إعادة بناء واجهة العرض العام بالترتيب نفسه الذي في docs/schema.sql
drop view if exists brc.public_jobs;

create view brc.public_jobs
with (security_invoker = false) as
  select code, title, category, region, governorate, shift, salary_min, salary_max, gender,
         vacancies, requirements, status,
         (status = 'reserved') as is_reserved,
         hold_expires_at,
         created_at,
         coalesce(description, '') as description,
         coalesce(image_url, '') as image_url
    from brc.jobs
   where status <> 'closed' or created_at > now() - interval '120 days';

comment on view brc.public_jobs is 'واجهة عامة للوظائف — تُخفي اسم/هاتف/عنوان صاحب العمل ومكان المقابلة';

grant select on brc.public_jobs to anon, authenticated;
