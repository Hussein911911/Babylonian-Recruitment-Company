-- ===========================================================================
--  BRC — طلب صاحب العمل بقرار الشركة + بوابة بيانات صاحب العمل (2026-10-01 / ج4)
-- ---------------------------------------------------------------------------/
--  ترقية تفاضلية idempotent. قرارات الإدارة المقفلة (ج4):
--    • الزبون يضغط «إتمام» بنفسه بعد مراجعة استمارته — وقبل ضغطته لا تظهر
--      بيانات صاحب العمل (اسم/هاتف/عنوان/مكان المقابلة) في أي مكان. تُطبَّق
--      بالواجهة (شاشة المراجعة بلا بيانات صاحب عمل) — القاعدة لا تتغير هنا.
--    • زرّا صاحب العمل الاثنان (تم التوظيف / لم يتم) لا يحسمان شيئاً فوراً:
--      الوظيفة والفرصة تنتقلان لحالة «hiring» (جاري التوظيف) مجمّدة بلا مهلة
--      24 ساعة، حتى يقرر موظفو الشركة: تثبيت التوظيف (تُغلق الوظيفة) أو
--      الإلغاء (تعود الوظيفة متاحة والفرصة مستهلكة).
-- ===========================================================================

-- 1) حالة «جاري التوظيف» بتعدادَي الوظيفة والفرصة
alter type brc.job_status  add value if not exists 'hiring';
alter type brc.slot_status add value if not exists 'hiring';

-- 2) حقلا طلب صاحب العمل على فرصة البطاقة
alter table brc.job_attempts add column if not exists employer_decision text;
alter table brc.job_attempts add column if not exists decision_at timestamptz;

-- 3) طلب صاحب العمل: reserved/critical ← hiring (لا حسم فوري — القرار للشركة)
create or replace function brc.employer_decide(p_serial text, p_decision text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f       record;
  a       record;
  j       record;
begin
  if p_decision not in ('hire', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'قرار غير صحيح — hire أو reject فقط');
  end if;

  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  if f.status = 'blank' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة فارغة ولم تُبع بعد');
  end if;

  /* أحدث تقديم قيد اللعب (قد تكون الفرصتان محجوزتين معاً) — وإن كان الطلب
     مسجَّلاً بالفعل (hiring) نرفض التكرار */
  select * into a from brc.job_attempts
   where serial = f.serial and slot_status in ('reserved', 'critical', 'hiring')
   order by selected_at desc nulls last, attempt_no desc limit 1 for update;
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'لا يوجد تقديم قيد القرار على هذه البطاقة — راجع الشركة');
  end if;
  if a.slot_status = 'hiring' then
    return jsonb_build_object('ok', false, 'error', 'طلبك مسجَّل بالفعل — الوظيفة بانتظار قرار الشركة');
  end if;

  select * into j from brc.jobs where id = a.job_id for update;

  update brc.job_attempts
     set slot_status = 'hiring',
         employer_decision = p_decision,
         decision_at = now(),
         hold_expires_at = null,               /* تجميد المهلة: القرار بيد الشركة */
         outcome_note = case when p_decision = 'hire'
                             then 'طلب صاحب العمل: تم التوظيف — بانتظار تثبيت الشركة'
                             else 'طلب صاحب العمل: لم يتم التوظيف — بانتظار قرار الشركة' end
   where id = a.id
  returning * into a;

  update brc.jobs
     set status = 'hiring',
         critical = false,
         hold_expires_at = null,
         updated_at = now()
   where id = j.id
  returning * into j;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'employer',
          case when p_decision = 'hire' then 'طلب توظيف من صاحب العمل' else 'طلب رفض من صاحب العمل' end,
          'applicant', f.serial,
          'صاحب العمل طلب عبر صفحة الباركود ' ||
          case when p_decision = 'hire' then 'التوظيف' else 'عدم التوظيف' end ||
          ' على الوظيفة ' || coalesce(a.job_code, '—') || ' — الفرصة #' || a.attempt_no ||
          ' — الزبون ' || f.full_name ||
          ' | الوظيفة «جاري التوظيف» بانتظار قرار الشركة (تثبيت/إلغاء)');

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'no', a.attempt_no, 'slotStatus', a.slot_status::text,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.region,
      'selectedAt', a.selected_at, 'decisionAt', a.decision_at,
      'employerDecision', a.employer_decision),
    'job', jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region,
                              'status', j.status::text),
    'decision', p_decision, 'pending', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 4) عرض صاحب العمل: التقديم الجاري يشمل hiring ويكشف اتجاه الطلب
create or replace function brc.employer_view(p_serial text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f    record;
  a    record;
  j    record;
  v_st text;
begin
  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  if f.status = 'blank' then
    return jsonb_build_object('ok', false, 'code', 'blank', 'error', 'هذه البطاقة فارغة ولم تُبع بعد');
  end if;
  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'code', 'pending', 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;

  select * into a from brc.job_attempts
   where serial = f.serial and slot_status in ('reserved', 'critical', 'hiring')
   order by selected_at desc nulls last, attempt_no desc limit 1;
  if a.id is not null then
    select * into j from brc.jobs where id = a.job_id;
  end if;

  v_st := case
    when f.status in ('pending', 'rejected') then f.status::text
    when f.expiry_date is not null and now() > f.expiry_date then 'expired'
    when (select count(*) from brc.job_attempts x where x.serial = f.serial and x.slot_status = 'empty') = 0
         and not exists (select 1 from brc.job_attempts x
                          where x.serial = f.serial and x.slot_status in ('reserved', 'critical', 'hiring'))
      then 'exhausted'
    else 'active' end;

  if a.id is not null then
    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('public', 'employer', 'صاحب العمل شاهد تعريف المتقدم', 'applicant', f.serial,
            'فتح صفحة الباركود — التقديم الجاري على ' || coalesce(a.job_code, '—') ||
            ' — الزبون ' || f.full_name);
  end if;

  return jsonb_build_object(
    'ok', true,
    'card', jsonb_build_object(
      'serial', f.serial, 'fullName', f.full_name, 'phone', f.phone,
      'address', coalesce(f.address, ''), 'gender', coalesce(f.gender, ''), 'dob', f.dob,
      'status', v_st, 'issueDate', f.issue_date, 'expiryDate', f.expiry_date,
      'posName', coalesce(f.pos_name, ''),
      'chancesLeft', (select count(*) from brc.job_attempts x where x.serial = f.serial and x.slot_status = 'empty'),
      'succeeded', exists (select 1 from brc.job_attempts x where x.serial = f.serial and x.slot_status = 'succeeded'),
      'applied', case when a.id is null then null else jsonb_build_object(
        'no', a.attempt_no, 'jobCode', a.job_code, 'jobTitle', j.title, 'region', j.region,
        'appliedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at,
        'slotStatus', a.slot_status::text,
        'employerDecision', a.employer_decision,
        'decisionAt', a.decision_at,
        'employer', jsonb_build_object(
          'name', j.employer_name, 'phone', j.employer_phone,
          'address', j.employer_address, 'interviewLocation', j.interview_location)
      ) end));
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 5) قرار الشركة يشمل الحجز الحرج و«جاري التوظيف» (كان reserved فقط)
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

-- 6) إلغاء/إرجاع يشمل «جاري التوظيف»: الوظيفة تعود متاحة والفرصة مستهلكة
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

-- 7) الإفراج التلقائي: «جاري التوظيف» ليست حجزاً ينتفي — تُستثنى من الحرجة،
--    والبطاقة التي فرصتها الوحيدة «hiring» ليست مستهلكة
create or replace function brc.run_auto_release() returns table (released_job text, expired_form text)
language plpgsql security definer
set search_path = brc, public
as $$
declare r record;
begin
  -- (أ) حجوزات انتهت مهلتها دون قرار ← حالة «حرجة» (لا إفراج تلقائي)
  for r in
    select j.id, j.code, j.reserved_by, a.attempt_no
      from brc.jobs j
      left join brc.job_attempts a
             on a.job_id = j.id and a.slot_status = 'reserved'
     where j.status = 'reserved'
       and j.hold_expires_at is not null
       and j.hold_expires_at < now()
     for update of j
  loop
    update brc.jobs
       set critical = true, hold_expires_at = null, updated_at = now()
     where id = r.id;

    update brc.job_attempts
       set slot_status = 'critical',
           hold_expires_at = null,
           outcome_note = 'انتهت مهلة 24 ساعة دون قرار — بانتظار قرار الشركة (توظيف / إرجاع / حذف)'
     where job_id = r.id and slot_status = 'reserved';

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('system', 'system', 'حالة حرجة (انتهاء 24 ساعة)', 'job', r.code,
            'انتهت المهلة دون قرار — الوظيفة مقفلة بانتظار قرار الموظف، والفرصة #' || coalesce(r.attempt_no::text, '—') ||
            ' للبطاقة ' || coalesce(r.reserved_by, '—') || ' في حالة حرجة');

    released_job := r.code; expired_form := r.reserved_by;
    return next;
  end loop;

  -- (ب) استمارات انتهت صلاحيتها (30 يوماً)
  for r in
    select serial from brc.applicants
     where status = 'active' and now() > expiry_date
     for update
  loop
    update brc.applicants set status = 'expired', updated_at = now() where serial = r.serial;

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('system', 'system', 'انتهاء بطاقة', 'applicant', r.serial, 'انتهت صلاحية البطاقة (30 يوماً)');

    released_job := null; expired_form := r.serial;
    return next;
  end loop;

  -- (ج) بطاقات استُهلكت فرصها (لا فرصة فارغة ولا فرصة قيد اللعب — hiring ضمنها)
  update brc.applicants f
     set status = 'exhausted', updated_at = now()
   where f.status = 'active'
     and not exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty')
     and not exists (select 1 from brc.job_attempts a where a.serial = f.serial
                       and a.slot_status in ('reserved', 'critical', 'hiring'));

  return;
end $$;

-- 8) إجراءات مطلوبة: طلبات صاحب العمل بانتظار قرار الشركة
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
