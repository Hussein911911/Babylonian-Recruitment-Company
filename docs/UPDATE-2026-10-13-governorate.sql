-- ===========================================================================
--  تحديث 2026-10-13 — عمود brc.jobs.governorate (إصلاح عطل حفظ الوظائف)
--  ---------------------------------------------------------------------------
--  إن كنت أنشأت قاعدة الشركة عبر تكاملة Supabase (ملفات supabase/migrations)
--  قبل هذا التاريخ، فعمود governorate **مفقود** من جدول brc.jobs — والواجهة
--  تكتبه في كل إدراج/تعديل وظيفة، فيُرفض الحفظ بـ:
--      column "governorate" of relation "jobs" does not exist
--  (القراءة تعمل لأنها select * — فالخلل يظهر عند «إضافة وظيفة» فقط).
--
--  التشغيل: الصقه في SQL Editor ثم نفّذه مرة واحدة. آمن للتكرار.
--  ثم نفّذ:  notify pgrst, 'reload schema';
-- ===========================================================================

alter table brc.jobs
  add column if not exists governorate text not null default 'بابل';

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
