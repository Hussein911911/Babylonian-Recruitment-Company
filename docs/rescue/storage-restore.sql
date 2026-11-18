-- ═══════════════════════════════════════════════════════════════════════════
--  إعادة إنشاء مخزن الصور — يُنفَّذ بعد الاسترجاع
--
--  ⚠️ SQL لا يحمل الملفات. هذا الملف يعيد **الوعاء** فقط (bucket + سياساته)،
--  ثم ترفع الملفات من مجلد storage/ في هذه الحزمة.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-images', 'job-images', true, 2097152,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- قراءة عامة (الصور تُعرض لزوار الموقع)
drop policy if exists "job images public read" on storage.objects;
create policy "job images public read" on storage.objects
  for select using (bucket_id = 'job-images');

-- الرفع والتعديل والحذف للموظفين المسجلين فقط
drop policy if exists "job images staff write" on storage.objects;
create policy "job images staff write" on storage.objects
  for all to authenticated using (bucket_id = 'job-images') with check (bucket_id = 'job-images');

select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'job-images';
