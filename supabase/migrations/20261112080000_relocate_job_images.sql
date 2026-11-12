-- ═══════════════════════════════════════════════════════════════════════════
--  2026-11-12 (ج) — نقل صور الوظائف من data: إلى Storage
--  ---------------------------------------------------------------------------
--  المشكلة: كل تعديل على وظيفة ينسخ صفّها كاملاً — والصورة جزء منه — إلى
--  audit_log.diff. صورة واحدة (542 ك.ب) تكرّرت في 38 تعديلاً = 20 م.ب من
--  أصل 24 م.ب في جدول التدقيق، أي 36% من قاعدة الشركة.
--
--  الحل: bucket عام للقراءة + سياسات RLS + نقل الصور مرة واحدة.
--  الصف يحمل رابطاً (94 بايت) بدل 542 ك.ب base64.
--
--  ⛔ لا استبدال قبل تحققين: بصمة الصورة + كتابة الصف في storage.objects.
--  ⛔ لا حذف لأي سجل تدقيق قديم — يتوقف النمو فقط.
--  المطبَّق فعلياً على brc في 2026-11-12: 4 صور، صفر أخطاء.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ١) الخزنة: عامة للقراءة، بحد ٢ م.ب، صور فقط ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-images', 'job-images', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── ٢) سياسات RLS على storage.objects ─────────────────────────────────────
-- قراءة عامة: الصور تُعرض للزوار على الموقع العام.
drop policy if exists job_images_public_read on storage.objects;
create policy job_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'job-images');

-- كتابة وتعديل: الموظف والمدير فقط (نفس نمط بقية الجداول).
drop policy if exists job_images_staff_write on storage.objects;
create policy job_images_staff_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'job-images' and brc.is_staff());

drop policy if exists job_images_staff_update on storage.objects;
create policy job_images_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'job-images' and brc.is_staff())
  with check (bucket_id = 'job-images' and brc.is_staff());

-- حذف: المدير فقط.
drop policy if exists job_images_admin_delete on storage.objects;
create policy job_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'job-images' and brc.is_admin());

-- ── ٣) جدول رجوع: نسخة من الروابط الأصلية قبل التحويل ────────────────────
create table if not exists brc.jobs_image_url_rollback_20261112 as
  select id, code, image_url, updated_at
    from brc.jobs
   where image_url like 'data:image/%';

comment on table brc.jobs_image_url_rollback_20261112 is
  'نسخة الروابط المضمّنة قبل نقلها إلى Storage — للرجوع لو فشل أي رابط.';

-- ── ٤) تأمين جدول الرجوع (أُضيف بعد فحص الجاهزية 2026-11-12) ─────────────
-- وُجد بلا RLS عند الجولة النهائية. الزائر كان محجوباً بالصلاحيات فقط
-- (طبقة واحدة)، والمطلوب طبقتان: صلاحيات + RLS.
alter table brc.jobs_image_url_rollback_20261112 enable row level security;
revoke all on brc.jobs_image_url_rollback_20261112 from anon, authenticated;
