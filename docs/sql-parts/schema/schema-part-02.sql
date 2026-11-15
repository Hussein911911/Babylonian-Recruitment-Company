-- ═══════════════════════════════════════════════════════════════════════
--  schema — الجزء 02 من 05
--  يفعّل: الدوال · العروض · إدخال بيانات
--  أسطر: 650 · حجم: 37 ك.ب
--  ---------------------------------------------------------------------
--  ⚠ لا تلصق هذا الجزء قبل تنفيذ الجزء 01 بنجاح.
--  بعد «Success» انتقل إلى الجزء 03.
-- ═══════════════════════════════════════════════════════════════════════



-- ===========================================================================
--  6) الواجهات العامة (Views)
-- ===========================================================================

-- 6.1 وظائف العرض العام: بلا أي بيانات لصاحب العمل
create or replace view brc.public_jobs
with (security_invoker = false) as
  select code, title, category, region, governorate, shift, salary_min, salary_max, gender,
         vacancies, requirements, status,
         (status = 'reserved') as is_reserved,
         hold_expires_at,
         created_at,
         -- الوصف والصورة جزء من الإعلان نفسه فيظهران للزائر (بخلاف اسم صاحب
         -- العمل وهاتفه ومكان المقابلة التي تبقى محجوبة للداخل). بدون هذين
         -- العمودين تظهر بطاقات الوظائف في الموقع العام بلا وصف ولا صورة.
         coalesce(description, '') as description,
         coalesce(image_url, '') as image_url
    from brc.jobs
   where status <> 'closed' or created_at > now() - interval '120 days';

comment on view brc.public_jobs is 'واجهة عامة للوظائف — تُخفي اسم/هاتف/عنوان صاحب العمل ومكان المقابلة';

-- 6.2 نتيجة التحقق من الاستمارة
-- ⚠️ أمان: هذه الواجهة تعرض اسم كل باحث ورقمه بلا أي تحقق من البصمة، فهي **للاستخدام
--    الداخلي/التشخيصي فقط ولا تُمنح لدور anon أبداً**. منحها للزائر يعني سحب أسماء كل
--    الباحثين بنداء واحد، وتصبح البصمة المطبوعة في الكيو آر كود بلا قيمة.
--    التحقق العام يتم حصراً عبر brc.verify_form(serial, token) — تُرجع استمارة واحدة.
create or replace view brc.public_verification
with (security_invoker = false) as
  select f.serial, f.full_name, f.issue_date, f.expiry_date, f.status, f.attempt_limit,
         (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status <> 'empty') as attempts_used,
         (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty') as attempts_left
    from brc.applicants f;

-- 6.3 اللوحة المالية لكل موظف
create or replace view brc.v_financials_by_staff as
  select s.id as staff_id,
         s.username,
         s.full_name,
         count(f.id)                                             as forms_issued,
         coalesce(sum(f.printed_count), 0)                       as total_prints,
         coalesce(sum(f.fee_amount), 0)                          as expected_collection,
         coalesce(sum(case when f.fee_paid then f.fee_amount end), 0) as collected,
         count(a.id) filter (where a.slot_status = 'succeeded')  as hires,
         count(a.id) filter (where a.slot_status = 'reserved')   as active_holds
    from brc.staff s
    left join brc.applicants f on f.created_by = s.id
    left join brc.job_attempts a on a.serial = f.serial
   group by s.id, s.username, s.full_name;

-- 6.4 لوحة المتابعة: إجراءات مطلوبة
-- ج5 2026-10-06: مصدران للحالة الحرجة — رفض صاحب العمل بسبب مكتوب (kind
--   'critical' وبالسبب في الوصف)، أو انتهاء مهلة 24 ساعة دون قرار
--   (kind 'critical_timeout'). كلاهما يقرّره الموظف: إرجاع متاحة أو حذف.
create or replace view brc.v_pending_actions as
  select 'hiring'::text as kind, j.code as reference, j.reserved_by as serial,
         a.decision_at as due_at, null::numeric as hours_left,
         case when a.employer_decision = 'hire'
              then 'طلب صاحب العمل: تم التوظيف — بانتظار تثبيت الشركة'
              else 'طلب صاحب العمل: لم يتم التوظيف — بانتظار قرار الشركة' end::text as description
    from brc.jobs j
    join brc.job_attempts a on a.job_id = j.id and a.slot_status = 'hiring'
   where j.status = 'hiring'
  union all
  /* رفض صاحب العمل بسبب مكتوب: الوظيفة معلّقة والقرار للشركة */
  select 'critical'::text, j.code, j.reserved_by, a.decision_at, null,
         ('رفض صاحب العمل بسبب: ' || coalesce(nullif(a.employer_reason, ''), '—') ||
          ' — القرار: إرجاع الوظيفة متاحة أو حذفها')
    from brc.jobs j
    join brc.job_attempts a on a.job_id = j.id and a.slot_status = 'critical'
   where j.status = 'reserved' and j.critical
     -- ⚠️ إصلاح 2026-10-06: بلا هذا الشرط كانت وظيفة «انتهت مهلة 24 ساعة» تظهر
     --    كأن صاحب العمل رفضها بسبب فارغ («بسبب: —») بدل «حرجة — انتهت المهلة».
     and a.employer_decision = 'reject'
  union all
  /* حرجة بانتهاء المهلة دون قرار (لا رفض مسجَّل) */
  select 'critical_timeout'::text, j.code, j.reserved_by, j.hold_expires_at, null,
         'انتهت مهلة 24 ساعة دون قرار — توظيف أو إرجاع أو حذف'::text
    from brc.jobs j
   where j.status = 'reserved' and j.critical
     and not exists (select 1 from brc.job_attempts a
                      where a.job_id = j.id and a.slot_status = 'critical'
                        and a.employer_decision = 'reject')
  union all
  select 'hold'::text, j.code, j.reserved_by,
         j.hold_expires_at,
         round(extract(epoch from (j.hold_expires_at - now())) / 3600.0, 1),
         'حجز مؤقت بانتظار نتيجة المقابلة'::text
    from brc.jobs j
   where j.status = 'reserved'
  union all
  select 'expired_attempt', a.job_code, a.serial, a.closed_at, null,
         'انتهت مهلة 24 ساعة — تتطلب إجراء'
    from brc.job_attempts a
   where a.slot_status = 'expired'
  union all
  select 'expired_form', f.serial, f.serial, f.expiry_date, null,
         'استمارة منتهية الصلاحية (30 يوماً)'
    from brc.applicants f
   where f.status = 'expired';
-- ===========================================================================
--  7) دوال RPC (تُنادى من الواجهة)
-- ===========================================================================

-- 7.1 التحقق من استمارة عبر الكيو آر كود (للموظفين والإدارة فقط)
-- ⚠️ سياسة الشركة: الزائر لا يتحقق من أي استمارة — التحقق للموظفين والإدارة.
--    لذلك لا تُمنح هذه الدالة لـ anon (انظر قسم الصلاحيات أسفل الملف)، وصفحة
--    verify.html تحجب الزائر قبل أي عرض بيانات (assets/js/verify.js).
-- ⚠️ لا تُضِف stable/immutable هنا: الدالة تُسجّل سطر تدقيق (INSERT) في آخرها،
--    وPostgreSQL يرفض الكتابة داخل دالة غير volatile بـ:
--    «INSERT is not allowed in a non-volatile function» → كل فحص كيو آر كود يفشل.
create or replace function brc.verify_form(p_serial text, p_token text default null)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare v jsonb; f record; v_ok boolean;
begin
  select * into f from brc.applicants where serial = p_serial;
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الرقم');
  end if;

  v_ok := (p_token is not null
           and (p_token = left(brc.verify_token(f.serial), 8) or p_token = brc.verify_token(f.serial)));

  select jsonb_build_object(
    'ok', true,
    'serial', f.serial,
    'fullName', f.full_name,
    'phone', f.phone,
    'issueDate', f.issue_date,
    'expiryDate', f.expiry_date,
    'status', f.status,
    'daysLeft', ceil(extract(epoch from (f.expiry_date - now())) / 86400.0),
    'attemptLimit', f.attempt_limit,
    'posName', coalesce(f.pos_name, ''),
    'requestedCode', f.requested_code,
    'rejectReason', coalesce(f.reject_reason, ''),
    'createdAt', f.created_at,
    'attemptsUsed', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status <> 'empty'),
    'attemptsLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
    'tokenOk', v_ok,
    /* ⚠️ خصوصية: بلا بصمة مطابقة تُقنَّع بيانات الباحث (الاسم والهاتف).
       السبب: الأرقام التسلسلية تُطلق تتابعاً (HRC-NO-000120, 121, …) فيستطيع
       أي زائر سحب أسماء وهواتف كل الباحثين بنداءات متتابعة — وهي بيانات أشخاص
       حقيقيين. البصمة المطبوعة في الكيو آر كود هي المفتاح، ومن يُدخل الرقم
       يدوياً يحصل على تأكيد صحة الاستمارة وحالتها بلا بيانات شخصية. */
    'fullName', case when v_ok then f.full_name else brc.mask_name(f.full_name) end,
    'phone',    case when v_ok then f.phone     else brc.mask_phone(f.phone)    end,
    'masked',   not v_ok,
    'attempts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'no', a.attempt_no,
               'jobCode', coalesce(a.job_code, '—'),
               'jobTitle', coalesce(j.title, '—'),
               'location', coalesce(j.governorate, '—'),
               'slotStatus', a.slot_status,
               /* رمز الفرصة سرّي: يُكشف فقط للبصمة الصحيحة (الموظف/الإدارة) */
               'code', case when v_ok then a.chance_code else null end,
               'selectedAt', a.selected_at,
               'holdExpiresAt', a.hold_expires_at,
               'closedAt', a.closed_at,
               'note', a.outcome_note) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
       where a.serial = f.serial)
  ) into v;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'تحقق من بطاقة (باركود)', 'applicant', f.serial, 'فحص عبر رابط التحقق');

  return v;
end $$;

-- 7.1ج ‎«بطاقتي» — الدوال العامة الآمنة لنظام بطاقة التوظيف (2026-09-30)
-- ---------------------------------------------------------------------------
--  المسار العام الجديد: الزبون يشتري بطاقة (كاش عند نقطة بيع) ويتبعها بنفسه
--  بالباركود المطبوع عليها. الأمان قائم على نموذج الحيازة:
--    • lookup_card: عرض البطاقة بالباركود فقط — بيانات مقنّنة وبلا رموز
--      الفرص وبلا بيانات صاحب العمل.
--    • use_chance: استهلاك فرصة يتطلب رمز الفرصة السري (ظهر البطاقة).
--    • verify_card_code: إعادة الطباعة تتطلب رمز فرصة (إثبات الحيازة) وتُرجع
--      الحمولة الكاملة للطباعة.
--  كلها security definer بلا كشف لأي جدول: anon ممنوع من brc.applicants
--  وbrc.job_attempts وbrc.jobs (البيانات الداخلية).
create or replace function brc.lookup_card(p_serial text, p_code text) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  v_ok boolean;
  v_stored text;
  v_code text;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على بطاقتك');
  end if;

  /* 2026-11-13: حيث يوجد card_print_code لا يُكشف الاسم/الهاتف كاملاً بلا
     الرمز. البطاقات بلا رمز مطبوع (كل بطاقات اليوم) تبقى كما هي. */
  v_stored := upper(btrim(coalesce(to_jsonb(f)->>'card_print_code', '')));
  v_code   := upper(btrim(coalesce(p_code, '')));
  if v_stored = '' then
    v_ok := true;
  else
    v_ok := (v_stored = v_code)
         or (replace(replace(v_stored, 'O', '0'), 'I', '1')
             = replace(replace(v_code, 'O', '0'), 'I', '1'));
  end if;
  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;
  if f.status = 'blank' then
    -- البطاقة موجودة لكنها لم تُستخدم بعد. لا نكشف أي بيانات شخصية أو تفاصيل
    -- تقديم محتملة، ولا نغيّر الصلاحية أو نُنشئ فرصاً عند مجرد عرضها.
    return jsonb_build_object('ok', true, 'serial', f.serial, 'status', 'blank',
      'fullName', '', 'phone', '', 'issueDate', null, 'expiryDate', null,
      'usesCardPrintCode', false, 'succeeded', false,
      'chancesLeft', (select count(*) from brc.job_attempts a where a.serial=f.serial and a.slot_status='empty'),
      'chances', (select coalesce(jsonb_agg(jsonb_build_object('no', a.attempt_no, 'slotStatus', 'empty') order by a.attempt_no), '[]'::jsonb)
                  from brc.job_attempts a where a.serial=f.serial and a.slot_status='empty'));
  end if;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'متابعة بطاقة (بطاقتي)', 'applicant', f.serial, 'عرض الحالة بالباركود — بيانات مقنّنة');

  return jsonb_build_object(
    'ok', true,
    'serial', f.serial,
    'usesCardPrintCode', (to_jsonb(f)->>'card_print_code') is not null,
    'requiresCode', (v_stored <> ''),
    'verified', v_ok,
    'fullName', case when v_ok then f.full_name else brc.mask_name(f.full_name) end,
    'phone',    case when v_ok then f.phone    else brc.mask_phone(f.phone) end,
    'status', f.status,
    'issueDate', f.issue_date,
    'expiryDate', f.expiry_date,
    'chancesLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
    'succeeded', exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'succeeded'),
    'chances', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'no', a.attempt_no,
               'slotStatus', a.slot_status,
               'jobCode', a.job_code,
               'jobTitle', coalesce(a.job_snapshot->>'title', j.title),
               'location', coalesce(a.job_snapshot->>'governorate', j.governorate),
               'selectedAt', a.selected_at,
               'holdExpiresAt', a.hold_expires_at,
               'note', case when a.slot_status in ('rejected', 'expired') then a.outcome_note else '' end
             ) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
       where a.serial = f.serial)
  );
end $$;

create or replace function brc.use_chance(p_serial text, p_code text, p_job_code text) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  a record;
  j record;
  hold_hours int;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  if f.status = 'blank' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة فارغة ولم تُبع بعد');
  end if;
  if f.status = 'expired' or (f.expiry_date is not null and now() > f.expiry_date) then
    return jsonb_build_object('ok', false, 'error', 'انتهت صلاحية البطاقة (30 يوماً)');
  end if;
  if f.status in ('exhausted') then
    return jsonb_build_object('ok', false, 'error', 'استُهلكت فرص البطاقة — تشترى بطاقة جديدة من نقاط البيع');
  end if;

  -- ⛔ أُلغيت رموز الفرص (2026-10-25): تُستهلك أول خانة فارغة بالترتيب.
  --    يُقبل p_code للتوافق مع نسخ قديمة، ويُتجاهل إن كان فارغاً.
  select * into a from brc.job_attempts
   where serial = f.serial and slot_status = 'empty'
     and (coalesce(btrim(p_code), '') = '' or chance_code = upper(btrim(p_code)))
   order by attempt_no limit 1;
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد فرصة متاحة في هذه البطاقة');
  end if;

  select * into j from brc.jobs where code = upper(btrim(coalesce(p_job_code, ''))) for update;
  if j.id is null then
    return jsonb_build_object('ok', false, 'error', 'الوظيفة غير موجودة');
  end if;
  if j.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'الوظيفة غير متاحة حالياً (' || j.status || ')');
  end if;

  select coalesce((value->>'hold_hours')::int, 24) into hold_hours from brc.settings where key = 'rules';

  -- الحجز عبر المشغّل trg_attempt_hold (تحقق الشروط + قفل الوظيفة + تدقيق)
  update brc.job_attempts
     set slot_status = 'reserved',
         job_id = j.id,
         job_code = j.code,
         selected_at = now(),
         hold_expires_at = now() + make_interval(hours => hold_hours)
   where id = a.id
  returning * into a;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'تقديم ذاتي ببطاقة', 'applicant', f.serial,
          'الزبون ' || brc.mask_name(f.full_name) || ' استخدم الفرصة #' || a.attempt_no ||
          ' بنفسه من الموقع على الوظيفة ' || j.code);

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status,
      'jobCode', a.job_code, 'jobTitle', j.title,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at),
    'job', jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region)
  );
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-25 — إلغاء رموز الفرص نهائياً
-- ---------------------------------------------------------------------------
--  • لم تعد البطاقة تحمل أي رمز على ظهرها، ولا يُطبع أي رمز فرصة.
--  • لا يُولَّد رمز لفرصة جديدة: أُزيل default العمود وأُزيل شرط not null.
--  • استخدام الفرصة صار بالباركود وحده (حيازة البطاقة = التحكم) — نفس سياسة
--    صفحة التقديم والتحقق منذ 2026-10-06.
--  • الصفوف القديمة تحتفظ بقيمها التاريخية (لا تُطبع ولا تُطلب)، حفاظاً على
--    بصمات سجلات الاسترجاع recovery_chances التي تُقارن hash للرمز.
-- ═══════════════════════════════════════════════════════════════════════════
alter table brc.job_attempts alter column chance_code drop default;
alter table brc.job_attempts alter column chance_code drop not null;

create or replace function brc.new_card_print_code() returns text
language sql volatile set search_path = pg_catalog
as $$ select upper(substr(u, 1, 12) || substr(u, 21, 4))
      from (select replace(gen_random_uuid()::text, '-', '') as u) s $$;

alter table brc.applicants add column if not exists card_print_code text;
alter table brc.applicants alter column card_print_code drop default;

-- Remove only secret keys from existing before/after diffs; preserve all other evidence.
update brc.audit_log
   set diff = diff #- '{before,card_print_code}' #- '{after,card_print_code}'
                   #- '{before,chance_code}' #- '{after,chance_code}'
 where (diff->'before') ?| array['card_print_code','chance_code']
    or (diff->'after') ?| array['card_print_code','chance_code'];

create or replace function brc.verify_card_code(p_serial text, p_code text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, brc, public
as $$
declare
  f record;
  -- رمز التحقق يُقرأ عبر to_jsonb: بعض قواعد الإنتاج أُنشئت قبل إضافة العمود
  -- (card_print_code)، وقراءته مباشرةً تُفشل الدالة كلها بـ42703.
  print_code text;
  supplied text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  valid boolean := false;
  failures integer;
begin
  -- Serialize attempts for this card, including concurrent wrong requests.
  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, ''))) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'الباركود أو رمز التحقق غير صحيح');
  end if;
  select count(*) into failures from brc.audit_log
   where entity_id = f.serial and action = 'فشل تحقق إعادة الطباعة'
     and ts > clock_timestamp() - interval '10 minutes';
  if failures >= 8 then
    return jsonb_build_object('ok', false, 'error', 'محاولات كثيرة — حاول بعد 10 دقائق');
  end if;
  print_code := to_jsonb(f)->>'card_print_code';
  if print_code is not null then
    -- بطاقة لها رمز تحقق مطبوع: لا تُطبع إلا به.
    valid := supplied = upper(print_code);
  else
    -- بطاقة بلا رمز (بعد إلغاء رموز الفرص 2026-10-25): الحيازة هي الإثبات،
    -- ويُقبل أيضاً أي رمز فرصة قديم مطبوع على بطاقة سبق طبعها.
    valid := supplied = '' or exists(
      select 1 from brc.job_attempts a where a.serial = f.serial
        and supplied = upper(regexp_replace(coalesce(a.chance_code, ''), '[^A-Za-z0-9]', '', 'g')));
  end if;
  if not valid then
    insert into brc.audit_log(username, role, action, entity, entity_id, details)
    values ('public', 'public', 'فشل تحقق إعادة الطباعة', 'applicant', f.serial, 'رمز تحقق غير صحيح');
    return jsonb_build_object('ok', false, 'error', 'رمز التحقق غير صحيح — انسخه من ظهر البطاقة');
  end if;
  insert into brc.audit_log(username, role, action, entity, entity_id, details)
  values ('public', 'public', 'إعادة طباعة بطاقة', 'applicant', f.serial, 'تم إثبات الحيازة — دون تسجيل الرمز');
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', f.id, 'serial', f.serial, 'fullName', f.full_name, 'phone', f.phone,
    'address', f.address, 'dob', f.dob, 'gender', f.gender, 'nationality', f.nationality,
    'status', f.status, 'issueDate', f.issue_date, 'expiryDate', f.expiry_date,
    'posName', coalesce(f.pos_name, ''), 'cardPrintCode', print_code,
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object(
      'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.governorate,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at,
      'closedAt', a.closed_at, 'note', a.outcome_note) order by a.attempt_no), '[]'::jsonb)
      from brc.job_attempts a left join brc.jobs j on j.id = a.job_id where a.serial = f.serial)
  ));
end $$;
revoke all on function brc.verify_card_code(text, text) from public;
grant execute on function brc.verify_card_code(text, text) to anon, authenticated;

-- 7.1ج بيع نقطة البيع عبر الموقع (قرار الإدارة 2026-10-01)
-- ---------------------------------------------------------------------------/
--  activate_card: نقطة البيع تمسح باركود البطاقة الفارغة فتُعبّأ بيانات الزبون
--                 مع اختيار الوظيفة (اختياري) وتُستهلك الفرصة الأولى بحجز 24 ساعة.
--  ⚠️ 2026-10-25: حُذف مسار صاحب العمل من الويب، فحُذفت دالتاه employer_view
--     وemployer_decide (وemployer_decide_original) من هنا ومن القاعدة —
--     طلب صاحب العمل يُسجَّل من لوحة الموظفين.
-- 1) بيع وتعبئة بطاقة فارغة من نقطة البيع عبر الموقع العام
--    p_data: { fullName, phone, address, dob, gender, posName, fee?, feePaid?, notes?, jobCode }
create or replace function brc.activate_card(p_serial text, p_data jsonb)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f        record;
  j        record;
  a        record;
  rules    jsonb;
  v_name   text;
  v_phone  text;
  v_pos    text;
  v_job    text;
begin
  /* ⚠️ إصلاح 2026-10-06: تهيئة سجلَّي الفرصة والوظيفة — مسار «البيع بلا وظيفة»
     لا يمرّ على select into a/j، فكان أي استعمال لاحق لهما يفشل بـ
     «record "j" is not assigned yet» ويسقط البيع بلا وظيفة كاملاً. */
  select * into a from brc.job_attempts where false;
  select * into j from brc.jobs where false;

  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, ''))) for update;
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على البطاقة الفارغة');
  end if;
  if f.status <> 'blank' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة ليست فارغة — حالتها: ' || f.status::text);
  end if;

  v_name  := btrim(coalesce(p_data->>'fullName', ''));
  v_phone := btrim(coalesce(p_data->>'phone', ''));
  v_pos   := btrim(coalesce(p_data->>'posName', ''));
  v_job   := upper(btrim(coalesce(p_data->>'jobCode', '')));
  if v_name = ''  then return jsonb_build_object('ok', false, 'error', 'اسم الزبون مطلوب'); end if;
  if v_phone = '' then return jsonb_build_object('ok', false, 'error', 'هاتف الزبون مطلوب'); end if;
  if v_pos = ''   then return jsonb_build_object('ok', false, 'error', 'اسم نقطة البيع مطلوب'); end if;
  /* ج5 2026-10-06: اختيار الوظيفة عند البيع صار اختيارياً — إمّا يختارها موظف
     النقطة للزبون فتُستهلك الفرصة الأولى بحجز 24 ساعة، وإمّا يُباع بلا وظيفة
     فيختار صاحب البطاقة وظيفتَي فرصتيه بنفسه من صفحة باركود بطاقته. */
  if v_job <> '' then
    /* الوظيفة جزء من الاستمارة: تُقفل قبل أي كتابة (منع سباق حجز مزدوج) */
    select * into j from brc.jobs where code = v_job for update;
    if j.id is null then
      return jsonb_build_object('ok', false, 'error', 'الوظيفة المختارة غير موجودة');
    end if;
    if j.status <> 'available' then
      return jsonb_build_object('ok', false, 'error', 'الوظيفة ' || j.code || ' غير متاحة حالياً — اختر وظيفة أخرى');
    end if;
  end if;

  select value into rules from brc.settings where key = 'rules';

  update brc.applicants set
      full_name   = v_name,
      phone       = v_phone,
      address     = coalesce(nullif(btrim(coalesce(p_data->>'address', '')), ''), f.address),
      dob         = nullif(p_data->>'dob', '')::date,
      gender      = coalesce(nullif(p_data->>'gender', ''), 'ذكر'),
      status      = 'active',
      issue_date  = case when v_job <> '' then now() else null end,
      expiry_date = case when v_job <> '' then now() + make_interval(days => coalesce((rules->>'validity_days')::int, 30)) else null end,
      pos_name    = v_pos,
      fee_amount  = coalesce(nullif(p_data->>'fee', '')::int, f.fee_amount),
      fee_paid    = coalesce((p_data->>'feePaid')::boolean, true),
      notes       = coalesce(nullif(p_data->>'notes', ''), f.notes)
  where serial = f.serial
  returning * into f;

  /* مع وظيفة مختارة: تُستهلك الفرصة الأولى بحجز 24 ساعة عبر trg_attempt_hold
     (يتحقق من توافر الوظيفة مجدداً + يقفلها + يدوّن الحجز بسجل التدقيق). */
  if v_job <> '' then
    select id into a from brc.job_attempts
     where serial = f.serial and slot_status = 'empty'
     order by attempt_no limit 1 for update;
    if a.id is null then
      raise exception 'لا توجد فرصة متاحة على البطاقة %', f.serial using errcode = 'P0001';
    end if;

    update brc.job_attempts
       set slot_status     = 'reserved',
           job_id          = j.id,
           job_code        = j.code,
           selected_at     = now(),
           hold_expires_at = now() + make_interval(hours => coalesce((rules->>'hold_hours')::int, 24))
     where id = a.id
    returning * into a;
  end if;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'pos', 'بيع وتعبئة بطاقة فارغة', 'applicant', f.serial,
          'بيع البطاقة ' || f.serial || ' للزبون ' || f.full_name ||
          ' — نقطة البيع: ' || v_pos ||
          ' — سعر ' || to_char(f.fee_amount, 'FM999,999,999') || ' د.ع (كاش)' ||
          ' — الصلاحية تبدأ عند أول تقديم ناجح' ||
          case when v_job <> '' then ' | الوظيفة المختارة: ' || j.code || ' — ' || j.title
               else ' | بلا اختيار وظيفة — الفرصتان بانتظار اختيار الزبون بنفسه' end);

  return jsonb_build_object(
    'ok', true,
    'app', jsonb_build_object(
      'serial', f.serial, 'fullName', f.full_name, 'phone', f.phone,
      'address', coalesce(f.address, ''), 'dob', f.dob, 'gender', f.gender,
      'status', f.status::text, 'issueDate', f.issue_date, 'expiryDate', f.expiry_date,
      'posName', coalesce(f.pos_name, ''), 'fee', f.fee_amount, 'feePaid', f.fee_paid),
    'attempt', case when a.id is null then null else jsonb_build_object(
      'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status::text,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.governorate,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at) end,
    'job', case when a.id is null then null
                else jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region) end,
    'chancesLeft', (select count(*) from brc.job_attempts x
                     where x.serial = f.serial and x.slot_status = 'empty'));
exception when others then
  /* أخطاء المشغّلات (P0001) نصوص عربية نظيفة تمر كما هي للواجهة */
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 4) التقديم الذاتي من باركود البطاقة (2026-10-06) — دالتان تناديهما صفحة
--    apply.html بلا جلسة موظف. سبب وجودهما أن جدول brc.applicants محجوب تماماً
--    عن الزائر (revoke all + لا سياسة له)، فالقراءة والكتابة تمرّان من مسار واحد
--    نتحكم بمحتواه: الباركود نفسه بيان الحيازة، والرموز السرّية تبقى في القاعدة.
--    ⚠️ الدرس المستفاد: الإصدار الذي أضاف صفحة التقديم الذاتي أضاف الدالتين في
--       ملف هجرة وحده دون مسار التحديث (db-update.html و docs/UPDATE-*.sql
--       وهذا الملف)، فصار مسح باركود أي بطاقة يفتح على الزبون خطأ PostgREST
--       خاماً: Could not find the function … in the schema cache. أُدرجتا هنا
--       ليكتمل «المصدر الوحيد للحقيقة» ولا تتكرّر الحالة.
-- ---------------------------------------------------------------------------
-- ترميم خانات الفرص الناقصة (إصلاح 2026-10-06)
--   عطل حقيقي مُشاهد: مزامنة لوحة الموظفين كانت **تحذف** خانات فرص بطاقة
--   موجودة محلياً بلا خانات (سحب ناقص أو جهاز جديد) — فتُصبح البطاقة الجديدة
--   بلا أي فرصة في القاعدة، وتقول صفحة التقديم «لا توجد فرصة متاحة — انتهت
--   فرصك» بلا أي تقديم. هذه الدالة تُنشئ الخانات **الناقصة فقط** حتى
--   attempt_limit، فلا تُمنح فرصة إضافية لبطاقة مستهلكة أبداً، وتُسجَّل العملية
--   في التدقيق. آمنة للنداء المتكرر.
-- ---------------------------------------------------------------------------
create or replace function brc.ensure_card_attempts(p_serial text) returns integer
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  v_added integer := 0;
begin
  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, ''))) for update;
  if f.serial is null then return 0; end if;

  insert into brc.job_attempts (serial, attempt_no)
  select f.serial, gs
    from generate_series(1, greatest(coalesce(f.attempt_limit, 2), 1)) gs
   where not exists (select 1 from brc.job_attempts a
                      where a.serial = f.serial and a.attempt_no = gs);
  get diagnostics v_added = row_count;

  if v_added > 0 then
    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('system', 'system', 'ترميم خانات فرص ناقصة', 'applicant', f.serial,
            'البطاقة كانت بلا خانات فرص كافية — أُنشئت ' || v_added ||
            ' خانة (تُرمَّم الخانات الناقصة فقط؛ لا فرصة إضافية لبطاقة مستهلكة)');
  end if;
  return v_added;
end $$;

revoke all on function brc.ensure_card_attempts(text) from public;
grant execute on function brc.ensure_card_attempts(text) to authenticated, service_role;

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