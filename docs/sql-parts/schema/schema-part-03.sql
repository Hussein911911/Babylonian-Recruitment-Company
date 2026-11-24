-- ═══════════════════════════════════════════════════════════════════════
--  schema — الجزء 03 من 06
--  يفعّل: الدوال · سياسات RLS · إدخال بيانات · كتل تنفيذية (DO)
--  أسطر: 676 · حجم: 38 ك.ب
--  ---------------------------------------------------------------------
--  ⚠ لا تلصق هذا الجزء قبل تنفيذ الجزء 02 بنجاح.
--  بعد «Success» انتقل إلى الجزء 04.
-- ═══════════════════════════════════════════════════════════════════════



create or replace function brc.self_service_card(p_serial text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  v_ok boolean;
  v_stored text;
  v_code text;
begin
  select * into f
    from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  /* ترميم خانات الفرص الناقصة قبل القراءة (إصلاح 2026-10-06) — بطاقة جديدة
     فقدت خاناتها بمزامنة ناقصة تُرمَّم هنا فوراً بدل «انتهت فرصك». */
  perform brc.ensure_card_attempts(f.serial);

  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;

  /* 2026-11-13: حيث يوجد card_print_code لا يُكشف الاسم/الهاتف/العنوان/الميلاد
     بلا الرمز. البطاقات بلا رمز مطبوع (كل بطاقات اليوم) تبقى كما هي تماماً. */
  v_stored := upper(btrim(coalesce(to_jsonb(f)->>'card_print_code', '')));
  v_code   := upper(btrim(coalesce(p_code, '')));
  if v_stored = '' then
    v_ok := true;
  else
    v_ok := (v_stored = v_code)
         or (replace(replace(v_stored, 'O', '0'), 'I', '1')
             = replace(replace(v_code, 'O', '0'), 'I', '1'));
  end if;

  return jsonb_build_object(
    'ok', true,
    'card', jsonb_build_object(
      'serial', f.serial,
      'status', f.status::text,
      'chancesLeft', (select count(*) from brc.job_attempts a where a.serial=f.serial and a.slot_status='empty'),
      'requiresCode', (v_stored <> ''),
      'verified', v_ok,
      'profileLocked', (f.status <> 'blank') or (not v_ok),
      'profile', case when not v_ok then '{}'::jsonb
        when f.status = 'blank' then coalesce(f.self_application_data, '{}'::jsonb)
        else coalesce(f.self_application_data, '{}'::jsonb) || jsonb_build_object(
          'fullName', f.full_name, 'phone', f.phone, 'address', f.address,
          'dob', f.dob, 'gender', f.gender) end,
      'chances', (select coalesce(jsonb_agg(jsonb_build_object(
          'no', a.attempt_no, 'slotStatus', a.slot_status::text,
          'jobCode', a.job_code, 'jobTitle', j.title
        ) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id=a.job_id
        where a.serial=f.serial)
    )
  );
end $$;

create or replace function brc.apply_with_card(
  p_serial text,
  p_job_code text,
  p_data jsonb
) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  v_result jsonb;
  v_job jsonb;
  v_code text;
  v_name text;
  v_phone text;
  v_address text;
  v_dob date;
  v_gender text;
  v_profile jsonb;
begin
  select * into f
    from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')))
   for update;
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;

  -- The row lock above serializes first/second submissions. Once activated,
  -- identity is taken only from the stored card, never from caller p_data.
  if f.status <> 'blank' then
    v_profile := coalesce(f.self_application_data, '{}'::jsonb) || jsonb_build_object(
      'fullName', f.full_name, 'phone', f.phone, 'address', f.address,
      'dob', f.dob, 'gender', f.gender);
  else
  v_name := btrim(coalesce(p_data->>'fullName', ''));
  v_phone := btrim(coalesce(p_data->>'phone', ''));
  v_gender := btrim(coalesce(p_data->>'gender', ''));
  if array_length(regexp_split_to_array(v_name, '[[:space:]]+'), 1) < 3 then
    return jsonb_build_object('ok', false, 'error', 'يرجى إدخال الاسم الثلاثي');
  end if;
  if v_phone !~ '^07[3-9][0-9]{8}$' then
    return jsonb_build_object('ok', false, 'error', 'رقم الهاتف يجب أن يتكون من 11 رقماً ويبدأ بـ 07');
  end if;
  if coalesce(p_data->>'province', '') = '' or coalesce(p_data->>'district', '') = ''
     or coalesce(p_data->>'landmark', '') = '' then
    return jsonb_build_object('ok', false, 'error', 'جميع حقول السكن مطلوبة');
  end if;
  if v_gender not in ('ذكر', 'أنثى') then
    return jsonb_build_object('ok', false, 'error', 'يرجى اختيار نوع الجنس');
  end if;
  if coalesce(p_data->>'dob', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', 'تاريخ الميلاد غير صحيح');
  end if;
  begin
    v_dob := (p_data->>'dob')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'تاريخ الميلاد غير صحيح');
  end;

  v_address := concat_ws(' — ', p_data->>'province', p_data->>'district',
                         nullif(p_data->>'subdistrict', ''), p_data->>'landmark');
  v_profile := jsonb_build_object(
    'fullName', v_name, 'phone', v_phone, 'province', p_data->>'province',
    'district', p_data->>'district', 'subdistrict', p_data->>'subdistrict',
    'landmark', p_data->>'landmark', 'address', v_address,
    'dob', v_dob, 'gender', v_gender
  );

  end if;

  if f.status = 'blank' then
    -- أول تقديم يُفعّل البطاقة الفارغة ويستهلك فرصتها الأولى (بيع ذاتي بالباركود)
    v_result := brc.activate_card(p_serial, jsonb_build_object(
      'fullName', v_name, 'phone', v_phone, 'address', v_address,
      'dob', v_dob, 'gender', v_gender, 'posName', 'تقديم ذاتي عبر الموقع',
      'jobCode', upper(btrim(coalesce(p_job_code, '')))
    ));
  else
    -- رموز الفرص تبقى سرّية؛ الباركود نفسه هو بيان الحيازة للفرصة الثانية
    select chance_code into v_code
      from brc.job_attempts
     where serial=f.serial and slot_status='empty'
     order by attempt_no limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'لا توجد فرص متبقية في هذه البطاقة');
    end if;
    v_result := brc.use_chance(f.serial, v_code, upper(btrim(coalesce(p_job_code, ''))));
  end if;

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  -- Only a successful FIRST application persists identity. Failed requests
  -- and later applications cannot rewrite either canonical fields or metadata.
  if f.status = 'blank' then
    update brc.applicants
       set full_name=v_name, phone=v_phone, address=v_address,
           dob=v_dob, gender=v_gender, self_application_data=v_profile
     where serial=f.serial;
  end if;

  -- بيانات صاحب العمل تبقى محجوبة عن قائمة الوظائف العامة، وتُعاد فقط بعد نجاح
  -- التقديم على الوظيفة المختارة (تظهر للباحث في استمارته).
  select jsonb_build_object(
    'employer_name', employer_name, 'employer_phone', employer_phone,
    'employer_address', coalesce(employer_address, ''),
    'interview_location', coalesce(interview_location, ''),
    'salary_min', salary_min, 'salary_max', salary_max, 'shift', shift
  ) into v_job
  from brc.jobs where code=upper(btrim(coalesce(p_job_code, '')));
  v_result := v_result || jsonb_build_object(
    'job', coalesce(v_result->'job', '{}'::jsonb) || coalesce(v_job, '{}'::jsonb));

  return v_result || jsonb_build_object('app', v_profile, 'profile', v_profile);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 7.1ب طلب استمارة إلكتروني من الموقع العام (بلا حساب ولا جلسة)
-- ---------------------------------------------------------------------------
--  لماذا دالة بدل إدراج مباشر؟ لأن anon ممنوع تماماً من جدول brc.applicants
--  (revoke all + لا سياسة له). فبلا دالة لا يمكن للزائر إرسال طلب أصلاً؛ ومع
--  الدالة يبقى الجدول محجوباً ويمرّ الطلب من مسار واحد نتحكم بمحتواه:
--    • تحقق من الاسم والهاتف
--    • حدّ إغراق (3 طلبات لنفس الرقم في 24 ساعة) — الدالة مفتوحة للزوار
--    • الحالة دائماً 'pending' مهما أرسل المتصل (لا يستطيع إصدار استمارة سارية)
--    • رقم التسلسل من تسلسل القاعدة، والدور والمبلغ من إعدادات القاعدة
--  الحقول الثابتة عمداً: status · serial · fee_amount · attempt_limit · created_by
create or replace function brc.request_form(
  p_full_name     text,
  p_phone         text,
  p_address       text default '',
  p_dob           date default null,
  p_gender        text default 'ذكر',
  p_notes         text default '',
  p_requested_code text default null
) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  v_serial text;
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_code   text := nullif(upper(btrim(coalesce(p_requested_code, ''))), '');
  v_recent int;
begin
  if length(v_name) < 2 or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'الاسم غير صالح');
  end if;
  if length(v_phone) < 7 or length(v_phone) > 20 then
    return jsonb_build_object('ok', false, 'error', 'رقم الهاتف غير صالح');
  end if;

  select count(*) into v_recent from brc.applicants
   where phone = v_phone and created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'وصلت طلبات كثيرة من هذا الرقم خلال 24 ساعة — راجع المكتب');
  end if;

  /* كود وظيفة غير معروف يُهمَل بدل رفض الطلب كله (نفس سلوك الواجهة) */
  if v_code is not null and not exists (select 1 from brc.jobs where code = v_code) then
    v_code := null;
  end if;

  /* بلا serial: المشغّل brc.trg_defaults يولّده من brc.next_form_serial()
     وينشئ خانات المحاولات الخمس. وissued/expiry لهما قيم افتراضية في الجدول
     (لا يمكن أن تكونا فارغتين: NOT NULL)، والقبول لاحقاً يعيد ضبطهما. */
  insert into brc.applicants (full_name, phone, address, dob, gender, status, notes,
                              requested_code, created_by)
  values (v_name, v_phone, coalesce(nullif(btrim(coalesce(p_address, '')), ''), ''),
          p_dob, coalesce(nullif(btrim(coalesce(p_gender, '')), ''), 'ذكر'),
          'pending',
          coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'طلب إلكتروني من الموقع'),
          v_code, null)
  returning serial into v_serial;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'طلب استمارة إلكتروني', 'applicant', v_serial,
          'طلب من الموقع العام — ' || v_name || coalesce(' — الوظيفة ' || v_code, ''));

  return jsonb_build_object('ok', true, 'serial', v_serial, 'status', 'pending');
end $$;

-- 7.1ج تقنيع بيانات الباحث للعرض العام بلا بصمة
--   الاسم: أول حرف + نقاط  ·  الهاتف: أول 4 وأخر 2 مع إخفاء الوسط
create or replace function brc.mask_name(p text) returns text
language sql immutable as $$
  select case
    when coalesce(p, '') = '' then ''
    when length(btrim(p)) <= 2 then left(btrim(p), 1) || '…'
    else left(btrim(p), 1) || repeat('•', least(length(btrim(p)) - 1, 12))
  end
$$;

create or replace function brc.mask_phone(p text) returns text
language sql immutable as $$
  select case
    when coalesce(p, '') = '' then ''
    when length(btrim(p)) <= 5 then left(btrim(p), 2) || '•••'
    else left(btrim(p), 4) || repeat('•', greatest(length(btrim(p)) - 6, 1)) || right(btrim(p), 2)
  end
$$;

-- 7.2 ترشيح وظيفة لمحاولة (موظف/مدير)
create or replace function brc.select_attempt(p_serial text, p_job_code text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare slot record; job_row record;
begin
  if not brc.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'غير مصرّح');
  end if;

  select * into job_row from brc.jobs where code = p_job_code;
  if job_row.id is null then return jsonb_build_object('ok', false, 'error', 'الوظيفة غير موجودة'); end if;

  select * into slot from brc.job_attempts
   where serial = p_serial and slot_status = 'empty'
   order by attempt_no limit 1;
  if slot.id is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد محاولات متاحة على هذه الاستمارة');
  end if;

  update brc.job_attempts
     set job_id = job_row.id, job_code = job_row.code, slot_status = 'reserved',
         selected_at = now(), hold_expires_at = now() + interval '24 hours',
         staff_id = brc.current_staff_id()
   where id = slot.id;

  return jsonb_build_object('ok', true, 'attemptNo', slot.attempt_no, 'jobCode', job_row.code);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 7.3 تثبيت نتيجة المقابلة
create or replace function brc.set_outcome(p_serial text, p_attempt_no smallint, p_outcome text, p_note text default '')
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
begin
  if not brc.is_staff() then return jsonb_build_object('ok', false, 'error', 'غير مصرّح'); end if;
  if p_outcome not in ('succeeded', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'نتيجة غير صحيحة');
  end if;

  update brc.job_attempts
     set slot_status = p_outcome::brc.slot_status,
         outcome_note = coalesce(nullif(p_note, ''), outcome_note),
         staff_id = brc.current_staff_id()
   where serial = p_serial and attempt_no = p_attempt_no
     and slot_status in ('reserved', 'critical', 'hiring');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'لا يوجد حجز جارٍ لهذه المحاولة');
  end if;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 7.4 إفراج يدوي عن حجز
create or replace function brc.release_hold(p_serial text, p_attempt_no smallint, p_reason text default '')
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
begin
  if not brc.is_staff() then return jsonb_build_object('ok', false, 'error', 'غير مصرّح'); end if;

  update brc.job_attempts
     set slot_status = 'expired',
         closed_at = now(),
         hold_expires_at = null,
         outcome_note = coalesce(nullif(p_reason, ''),
           case when employer_decision is not null
                then 'إلغاء توظيف صاحب العمل بقرار الشركة — الفرصة مستهلكة'
                else 'إفراج يدوي عن الحجز' end)
   where serial = p_serial and attempt_no = p_attempt_no
     and slot_status in ('reserved', 'critical', 'hiring');

  return jsonb_build_object('ok', found);
end $$;

-- 7.5 أدوات الصلاحية
-- ⚠️ حرجة: هذه الدوال تقرأ من brc.staff المُفعَّل عليه RLS، وسياسات brc.staff نفسها
--    تنادي هذه الدوال → حلقة مغلقة. لذلك يجب أن تكون SECURITY DEFINER (تعمل بصلاحية
--    مالك الدالة فتتجاوز RLS على brc.staff وتكسر الحلقة)، مع تثبيت search_path
--    لمنع اختطاف المسار (security definer بلا search_path ثابت = ثغرة حقن).
--    بدون security definer يفشل كل وصول بـ:
--    «infinite recursion detected in policy for relation "staff"»
create or replace function brc.current_staff_id() returns uuid
language sql stable security definer
set search_path = brc, public
as $$
  select id from brc.staff where auth_id = auth.uid() limit 1
$$;

create or replace function brc.is_staff() returns boolean
language sql stable security definer
set search_path = brc, public
as $$
  select exists (select 1 from brc.staff where auth_id = auth.uid() and active)
$$;

create or replace function brc.is_admin() returns boolean
language sql stable security definer
set search_path = brc, public
as $$
  select exists (select 1 from brc.staff where auth_id = auth.uid() and role = 'admin' and active)
$$;

-- ===========================================================================
--  8) سياسات أمان الصفوف (Row Level Security)
-- ===========================================================================
alter table brc.jobs         enable row level security;
alter table brc.applicants   enable row level security;
alter table brc.job_attempts enable row level security;
alter table brc.audit_log    enable row level security;
alter table brc.settings     enable row level security;
alter table brc.staff        enable row level security;

-- 8.1 الموظفون
drop policy if exists staff_self_read on brc.staff;
create policy staff_self_read on brc.staff for select
  using (brc.is_staff() and (auth_id = auth.uid() or brc.is_admin()));

drop policy if exists staff_admin_write on brc.staff;
create policy staff_admin_write on brc.staff for all
  using (brc.is_admin()) with check (brc.is_admin());

-- 8.2 الوظائف: لا وصول عام للجدول (العام يقرأ من brc.public_jobs)
drop policy if exists jobs_staff_all on brc.jobs;
create policy jobs_staff_all on brc.jobs for select using (brc.is_staff());

drop policy if exists jobs_staff_write on brc.jobs;
create policy jobs_staff_write on brc.jobs for insert with check (brc.is_staff());

drop policy if exists jobs_staff_update on brc.jobs;
create policy jobs_staff_update on brc.jobs for update using (brc.is_staff());

/* ⚠️ 2026-11-20 — قرار المالك (2026-11-11) كان نافذاً في الإنتاج عبر الترحيل
   `supabase/migrations/20261111120000_jobs_staff_delete.sql` وحده، ولم يُدمج
   في هذا الملف. فكل قاعدة تُبنى من هنا (ومنها حزمة الاسترجاع) كانت ترجع إلى
   «المدير فقط» بينما الواجهة تسمح للموظف → الموظف يرى «تم الحذف» ولا يُحذف
   شيء. الفحص `tests/jobs-delete-policy.mjs` يكشف هذا الانحراف. */
drop policy if exists jobs_admin_delete on brc.jobs;
drop policy if exists jobs_staff_delete on brc.jobs;
create policy jobs_staff_delete on brc.jobs for delete using (brc.is_staff());

-- 8.3 الاستمارات: الموظف يدير كل الاستمارات، والمدير يحذف
drop policy if exists applicants_staff_read on brc.applicants;
create policy applicants_staff_read on brc.applicants for select using (brc.is_staff());

/* ⚠️ 2026-11-20 — إصدار البطاقات للمدير حصراً (قرار المالك 2026-11-11).
   كان هنا `applicants_staff_insert using brc.is_staff()` أي أن أي موظف يستطيع
   إدراج بطاقة فارغة مباشرة عبر PostgREST. التشديد كان في الترحيل
   `20261111235000_cards_insert_admin_only.sql` وحده، فكان يضيع عند إعادة البناء.
   ما يبقى للموظف: القراءة والتعديل والحذف. وطلب الزائر يمرّ عبر request_form. */
drop policy if exists applicants_staff_insert on brc.applicants;
drop policy if exists applicants_admin_insert on brc.applicants;
create policy applicants_admin_insert on brc.applicants for insert with check (brc.is_admin());

drop policy if exists applicants_staff_update on brc.applicants;
create policy applicants_staff_update on brc.applicants for update using (brc.is_staff());

/* ⚠️ 2026-11-20 — الإنتاج يمنح الحذف للموظف والمدير (سياسة
   applicants_staff_delete)، وهذا ملف سياسات موحّد صادر عن تدقيق 2026-11-11
   («٨ سياسات من ٨ على is_staff()»)، لكن المخطط بقي على مدير فقط. الترحيل الذي
   نفّذ التغيير (staff_full_operations) غير موجود في supabase/migrations، فكان
   التغيير يضيع عند أي إعادة بناء. أُعيد الآن ليطابق الإنتاج حرفاً بحرف. */
drop policy if exists applicants_admin_delete on brc.applicants;
drop policy if exists applicants_staff_delete on brc.applicants;
create policy applicants_staff_delete on brc.applicants for delete using (brc.is_staff());

-- 8.4 المحاولات
drop policy if exists attempts_staff_read on brc.job_attempts;
create policy attempts_staff_read on brc.job_attempts for select using (brc.is_staff());

drop policy if exists attempts_staff_write on brc.job_attempts;
create policy attempts_staff_write on brc.job_attempts for all
  using (brc.is_staff()) with check (brc.is_staff());

-- 8.5 سجل التدقيق: المدير يرى الكل، الموظف يرى عملياته فقط، والإضافة للنظام فقط
drop policy if exists audit_read on brc.audit_log;
create policy audit_read on brc.audit_log for select
  using (brc.is_admin() or (brc.is_staff() and username = (select username from brc.staff where auth_id = auth.uid())));

--  الإضافة من الواجهة تكون باسم صاحب الجلسة أو باسم النظام؛ المشغّلات نفسها
--  security definer فتتجاوز هذه السياسة. بلا هذا القيد يستطيع أي موظف تزوير
--  سطر تدقيق باسم غيره (السجل هو دليل المراجعة، فقيمته في صدق النسبة).
drop policy if exists audit_insert on brc.audit_log;
create policy audit_insert on brc.audit_log for insert
  with check (
    brc.is_staff() and (
      username = (select username from brc.staff where auth_id = auth.uid())
      or username = 'system'
    )
  );

drop policy if exists audit_no_update on brc.audit_log;
create policy audit_no_update on brc.audit_log for update using (false);

drop policy if exists audit_no_delete on brc.audit_log;
create policy audit_no_delete on brc.audit_log for delete using (false);

-- 8.6 الإعدادات: قراءة للجميع داخل النظام، تعديل للمدير
drop policy if exists settings_read on brc.settings;
create policy settings_read on brc.settings for select using (brc.is_staff());

drop policy if exists settings_admin_write on brc.settings;
create policy settings_admin_write on brc.settings for all using (brc.is_admin()) with check (brc.is_admin());

/* ── 8.7 صور الوظائف (Storage) ──────────────────────────────────────────────
   ⚠️ 2026-11-20: هذه السياسات كانت تعيش في الترحيل
   `20261112080000_relocate_job_images.sql` وحده، فلا تُنشأ على أي قاعدة تُبنى
   من هذا الملف. الأثر العملي: الموظف في القاعدة المسترجعة يستطيع قراءة الصور
   لكن **لا يستطيع رفع صورة وظيفة** (رفض صامت من Storage)، والمدير لا يستطيع
   حذفها. الكتلة محروسة بـ to_regclass كي تعمل على PostgreSQL عادي (اختبارات)
   وعلى Supabase حيث يوجد مخطط storage — بلا أي خطأ. */
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'تخطّي سياسات storage.objects — لا يوجد مخطط storage على هذه القاعدة';
    return;
  end if;

  /* قراءة عامة: صور الوظائف تُعرض للزوار على الموقع العام */
  execute 'drop policy if exists job_images_public_read on storage.objects';
  execute $p$create policy job_images_public_read on storage.objects
    for select to anon, authenticated using (bucket_id = 'job-images')$p$;

  /* رفع وتعديل: الموظف والمدير فقط */
  execute 'drop policy if exists job_images_staff_write on storage.objects';
  execute $p$create policy job_images_staff_write on storage.objects
    for insert to authenticated with check (bucket_id = 'job-images' and brc.is_staff())$p$;

  execute 'drop policy if exists job_images_staff_update on storage.objects';
  execute $p$create policy job_images_staff_update on storage.objects
    for update to authenticated
    using (bucket_id = 'job-images' and brc.is_staff())
    with check (bucket_id = 'job-images' and brc.is_staff())$p$;

  /* حذف: المدير فقط */
  execute 'drop policy if exists job_images_admin_delete on storage.objects';
  execute $p$create policy job_images_admin_delete on storage.objects
    for delete to authenticated using (bucket_id = 'job-images' and brc.is_admin())$p$;
end $$;

-- ===========================================================================
--  9) الصلاحيات (Grants)
-- ===========================================================================
grant usage on schema brc to anon, authenticated;

-- ---------------------------------------------------------------------------
--  ⚠️ إبطال المنح الافتراضي — كان ثغرة أمنية حقيقية:
--
--  PostgreSQL يمنح EXECUTE على كل دالة جديدة لدور PUBLIC **تلقائياً**، وكل
--  الأدوار (بما فيها anon) أعضاء في PUBLIC. فكل دالة لم نذكرها كانت قابلة
--  للنداء من الزائر عبر:
--      POST /rest/v1/rpc/<اسم الدالة>
--
--  ⚠️ وإبطالها من anon وحده لا يكفي: anon يورث الصلاحية من PUBLIC فيبقى
--     قادراً. الإبطال الصحيح يكون **من public**، ثم نُعيد المنح لمن يحتاجه.
--
--  أخطرها brc.verify_token: تُرجع توقيع HMAC لأي رقم تسلسلي، والأرقام متسلسلة
--  ومطبوعة على الاستمارات (HRC-NO-000120، 121، …). فمن يناديها يحسب البصمة
--  الصحيحة لأي استمارة ويصوغ رابط كيو آر كود مزيّفاً — فتفقد البصمة المطبوعة
--  قيمتها الأمنية بالكامل.
--
--  لا تتأثر الأدوار التالية: مالك الدالة (له كل الصلاحيات) · وbrc.verify_form
--  SECURITY DEFINER فهي تنادي verify_token بصلاحية المالك لا بصلاحية الزائر.
--
--  ⚠️ ولا يكفي إبطال verify_form/request_form من anon: anon يورث من PUBLIC —
--     لذلك تُبطَلان من public أولاً ثم تُمنحان للدور authenticated وحده (أسفل).
-- ---------------------------------------------------------------------------
-- ⚠️ 2026-11-13: سحب شامل بدل قائمة يدوية.
--    القائمة اليدوية أعلاه هي ما سبّب الثغرة: دالة تُضاف لاحقاً وتُنسى فيبقى
--    EXECUTE لها على PUBLIC. القياس على مخطط نظيف أثبت **17 دالة** يناديها
--    anon، منها select_attempt/set_outcome/release_hold و6 دوال مشغّلات
--    ومولّدا الرموز chance_code/new_card_print_code.
--    السحب التالي يغطي كل دوال brc بلا استثناء، ثم تُعاد المنح صراحةً أسفل.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'brc'
  loop
    execute format('revoke all on function %s from public', r.sig);
  end loop;
end $$;
-- ويمنع تكرارها: أي دالة تُنشأ لاحقاً في brc تبدأ بلا صلاحية لأحد.
-- ⚠️ بلا `in schema`: النسخة المحدودة بالمخطط لا تُسجّل شيئاً في PostgreSQL
--    (الافتراضي المدمج PUBLIC ليس ضمن ACL المخطط) — مجرَّب، ويشهد له الفحص
--    tests/function-acl-audit.mjs.
alter default privileges revoke execute on functions from public;

revoke execute on function brc.verify_token(text)    from public;
revoke execute on function brc.next_job_code()       from public;
revoke execute on function brc.next_form_serial()    from public;
revoke execute on function brc.request_form(text, text, text, date, text, text, text) from public;
revoke execute on function brc.mask_name(text)       from public;
revoke execute on function brc.mask_phone(text)      from public;
revoke execute on function brc.run_auto_release()    from public;
revoke execute on function brc.is_staff()            from public;
revoke execute on function brc.is_admin()            from public;
revoke execute on function brc.current_staff_id()    from public;
-- الزائر لا يقدّم ولا يتحقق: الدالتان تُنزعان من PUBLIC ثم تُمنحان للموظفين فقط
revoke execute on function brc.verify_form(text, text) from public;
revoke execute on function brc.request_form(text, text, text, date, text, text, text) from public;

-- إعادة المنح لمن يحتاجها فعلاً (بعد الإبطال أعلاه):
--   • is_staff/is_admin/current_staff_id → تُنادى داخل سياسات RLS الخاصة
--     بالموظفين، فبدونها يفشل كل وصول للموظف بـ permission denied.
--   • next_job_code/next_form_serial → يناديها المشغّل brc.trg_defaults عند الإدراج.
grant execute on function brc.is_staff()            to authenticated, service_role;
grant execute on function brc.is_admin()            to authenticated, service_role;
grant execute on function brc.current_staff_id()    to authenticated, service_role;
grant execute on function brc.next_job_code()       to authenticated, service_role;
grant execute on function brc.next_form_serial()    to authenticated, service_role;
-- «بطاقتي» للزائر العام: متابعة بطاقته واستخدام فرصته وإعادة طباعتها
-- (أُعيد كتابة سياسة الزائر 2026-09-30: لا طلب إلكتروني — بطاقة تُشترى كاشاً)
grant execute on function brc.lookup_card(text, text)           to anon, authenticated;
grant execute on function brc.use_chance(text, text, text)      to anon, authenticated;
grant execute on function brc.verify_card_code(text, text)      to anon, authenticated;
/* موديل 2026-10-01: مسح نقطة البيع وصاحب العمل من الموقع العام — بلا جلسة */
-- Internal helper only: self-service and office security-definer functions call it.
revoke all on function brc.activate_card(text, jsonb) from public, anon, authenticated;
/* موديل 2026-10-06: التقديم الذاتي من باركود البطاقة (apply.html) — مسار عام
   بلا جلسة: الباركود بيان الحيازة، والدالتان لا تكشفان اسماً ولا هاتفاً ولا
   رموز فرص. تُنزعان من PUBLIC أولاً (PostgreSQL يمنح EXECUTE لـ PUBLIC تلقائياً
   لكل دالة جديدة) ثم تُمنحان صراحةً للزائر والموظف. */
revoke all on function brc.self_service_card(text, text) from public;
revoke all on function brc.apply_with_card(text, text, jsonb) from public;
grant execute on function brc.self_service_card(text, text)    to anon, authenticated;
grant execute on function brc.apply_with_card(text, text, jsonb) to anon, authenticated;

-- الزائر العام: يتصفّح الوظائف ويتابع بطاقته — بلا تحقق داخلي وبلا طلب إلكتروني
-- ⚠️ سياسة الشركة (قرار الإدارة 2026-09-30 — نظام بطاقة التوظيف): الزائر يشتري
--    بطاقة التوظيف كاشاً من نقطة بيع معتمدة ويتابعها بنفسه بالباركود، ولا يُقدّم
--    طلباً إلكترونياً ولا يتحقق من بطاقات غيره. لذلك:
--      • تُمنح للزائر دوال «بطاقتي» الثلاث فقط: lookup_card (بيانات مقنّنة بلا
--        رموز) وuse_chance وverify_card_code (تتطلبان رمز الفرصة السري).
--      • verify_form و request_form: **تُمنحان لـ anon** — انظر التصحيح
--        المؤرّخ 2026-11-20 في قسم المنح أدناه. هذا التعليق كان يخالف الإنتاج
--        والكود معاً (cloud.js ينادي الدالتين بلا جلسة).
-- ⚠️ ولا تُمنح brc.public_verification أصلاً: تلك الواجهة تكشف serial + full_name
--    + status لكل البطاقات بلا تحقق من البصمة، فيسحب أي حامل لـ anon key أسماء
--    كل الباحثين بنداء واحد.
/* ⚠️ 2026-11-20 — تصحيح انحراف حقيقي بين المخطط والإنتاج:
   المخطط كان ينزع verify_form وrequest_form من anon ويعلّق «الزائر لا يتحقق
   ولا يقدّم»، لكن **الإنتاج يمنحهما لـ anon فعلاً**، والكود يناديهما بلا جلسة:
     • assets/js/cloud.js:651  → request_form (نموذج طلب الزائر)
     • assets/js/cloud.js:680  → verify_form (التحقق بالباركود)
     • supabase-check.html     → يفحص request_form كمسار زائر
   فكانت أي قاعدة مُعادة البناء تُعطّل التحقق العام والطلب الإلكتروني بصمت.
   المعالجة: مواءمة المخطط مع الإنتاج (لا العكس) — الدالتان مقنّعتان
   (verify_form تُقنّع الاسم والهاتف) وتتحققان من المدخلات داخلياً. */
revoke execute on function brc.verify_form(text, text) from public;
revoke execute on function brc.request_form(text, text, text, date, text, text, text) from public;
grant execute on function brc.verify_form(text, text) to anon, authenticated;
grant execute on function brc.request_form(text, text, text, date, text, text, text) to anon, authenticated;

grant select on brc.public_jobs to anon, authenticated;
grant execute on function brc.verify_form(text, text) to authenticated, service_role;
grant execute on function brc.request_form(text, text, text, date, text, text, text) to authenticated, service_role;

-- الموظفون (authenticated): كل عمليات الإدارة
grant select, insert, update on brc.jobs, brc.applicants, brc.job_attempts to authenticated;
grant select on brc.audit_log, brc.settings, brc.staff, brc.v_financials_by_staff, brc.v_pending_actions to authenticated;

--  ⚠️ الدرس المستفاد: سياسة RLS **لا تمنح** صلاحية، بل تقيّد صلاحية قائمة.
--     فكل جدول تحتاجه الواجهة كتابةً يجب أن يكون له GRANT صريح، وإلا فالطلب
--     يُرفض بـ 42501 «permission denied» **حتى لو وُجدت السياسة**. الأعمدة
--     التالية أُضيفت لأن الواجهة تكتبها فعلاً (تعديل إعدادات، إدراج سطور تدقيق،
--     حذف وظيفة/استمارة) — وكلها تبقى مقيّدة بالسياسات أعلاه:
--       • settings:     التعديل للمدير فقط (settings_admin_write)
--       • audit_log:    الإضافة باسم صاحب الجلسة أو 'system' (audit_insert)
--       • delete jobs: للموظف والمدير (jobs_staff_delete) · delete applicants: للمدير فقط
--       • insert applicants: للمدير فقط (applicants_admin_insert — إصدار البطاقات)
grant insert on brc.audit_log to authenticated;
-- ⚠️ عطل حقيقي أُصلح 2026-11-17 (بلاغ المالك: «قبل لا أنسخ أي نسخة يكلّي
--    لا صلاحية كافية (RLS/منح مفقود) … وهاي تروح من أسوي رفرش»).
--
--    السبب لم يكن سياسة ولا منحاً على الجدول — بل **التسلسلات**:
--    `audit_log.id` من نوع bigserial يولّد رقمه من `audit_log_id_seq`.
--    وكان المنح على التسلسل لـ`authenticated` مفقوداً على القواعد التي
--    بُنيت من أجزاء السكيما (الجزء ٣ فيه المنح، لكن الملف الكامل لم يكن
--    يعيده). فأي `insert into brc.audit_log` يفشل بـ:
--        ERROR 42501: permission denied for sequence audit_log_id_seq
--
--    و`job_code_seq` و`form_serial_seq` لم يكن لهما منح إطلاقاً — فإضافة
--    وظيفة أو استمارة من اللوحة تفشل بالخطأ نفسه، ويظهر للموظف
--    «لا صلاحية كافية» وهو ليس السبب.
--
--    والمنح على UPDATE مطلوب أيضاً لأن `nextval` يُحدّث حالة التسلسل.
grant usage, select, update on sequence brc.audit_log_id_seq to authenticated;
grant usage, select, update on sequence brc.job_code_seq    to authenticated;
grant usage, select, update on sequence brc.form_serial_seq to authenticated;
grant insert, update on brc.settings to authenticated;
grant delete on brc.jobs, brc.applicants to authenticated;
grant execute on function brc.select_attempt(text, text) to authenticated;
grant execute on function brc.set_outcome(text, smallint, text, text) to authenticated;
grant execute on function brc.release_hold(text, smallint, text) to authenticated;
grant execute on function brc.run_auto_release() to authenticated, service_role;

-- منع الوصول المباشر للجداول الحساسة من الزائر
revoke all on brc.jobs, brc.applicants, brc.job_attempts, brc.audit_log, brc.staff, brc.settings from anon;