-- BRC — ربط مستخدمي Supabase Auth بجدول brc.staff
--
-- قبل التشغيل:
-- 1) أنشئ المستخدمين من Authentication → Users.
-- 2) فعّل Auto Confirm User.
-- 3) استبدل القيم بين علامات الاقتباس أدناه بالإيميلات الحقيقية.
--
-- لا تضع كلمات المرور أو service_role key في هذا الملف.

begin;

do $$
declare
  missing_emails text;
begin
  -- فحص أن كل حسابات Auth موجودة قبل أي تعديل
  select string_agg(x.email, ', ' order by x.email)
    into missing_emails
  from (
    select 'manager@gmail.com'::text as email
    union all select 'staff1@gmail.com'::text
    union all select 'staff2@gmail.com'::text
  ) x
  left join auth.users u on lower(u.email) = lower(x.email)
  where u.id is null;

  if missing_emails is not null then
    raise exception 'حسابات Auth غير موجودة: %', missing_emails;
  end if;

  insert into brc.staff
    (auth_id, username, full_name, role, job_title, phone, active)
  select
    u.id, wanted.username, wanted.full_name, wanted.role::brc.user_role,
    wanted.job_title, wanted.phone, wanted.active
  from (
    values
      ('manager@gmail.com'::text, 'admin'::text, 'المدير العام'::text,
       'admin'::text, 'الإدارة العامة'::text, '07760058007'::text, true),
      ('staff1@gmail.com'::text, 'staff'::text, 'أحمد الموسوي'::text,
       'staff'::text, 'موظف توظيف'::text, '07715993271'::text, true),
      ('staff2@gmail.com'::text, 'staff2'::text, 'زينب الحسيني'::text,
       'staff'::text, 'موظفة توظيف'::text, '07760058007'::text, true)
  ) as wanted(email, username, full_name, role, job_title, phone, active)
  join auth.users u on lower(u.email) = lower(wanted.email)
  on conflict (username) do update set
    auth_id = excluded.auth_id,
    full_name = excluded.full_name,
    role = excluded.role,
    job_title = excluded.job_title,
    phone = excluded.phone,
    active = excluded.active;
end
$$;

commit;

-- تحقق بعد التنفيذ:
select username, full_name, role, active, auth_id
from brc.staff
where username in ('admin', 'staff', 'staff2')
order by username;
