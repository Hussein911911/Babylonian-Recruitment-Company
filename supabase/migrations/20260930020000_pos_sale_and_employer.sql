-- ===========================================================================
--  BRC — بيع نقطة البيع عبر الموقع + صفحة صاحب العمل (2026-10-01 / ج3)
-- ---------------------------------------------------------------------------/
--  ترقية تفاضلية idempotent لقاعدة بيانات قائمة. الموديل الجديد (قرار
--  الإدارة 2026-10-01، مقفل بأسئلة الإدارة الأربعة):
--    • نقطة البيع تمسح باركود البطاقة الفارغة بأي موبايل → يفتح الموقع
--      «استمارة الزبون»: الاسم/الهاتف (إلزامي) + العنوان + اختيار الوظيفة
--      (إلزامي) + اسم نقطة البيع → تُفعَّل البطاقة وتُستهلك الفرصة الأولى
--      بحجز 24 ساعة، ثم تُطبع استمارة A4 بنفس الباركود (من الواجهة).
--    • صاحب العمل يمسح نفس الباركود → يرى تعريف المتقدم والوظيفة وبيانات
--      التواصل → يضغط «تم التوظيف» فيُسجَّل فوراً (الباركود وحده يكفي —
--      خصوصية مقبولة من الإدارة). رموز الفرص لا تُعرض له أبداً (سرّ الزبون).
--    • البطاقة الورقية لا تحمل بيانات زبون أبداً — تبقى ورقة عامة،
--      والبيانات تعيش على استمارة A4 بنفس الباركود.
--
--  لماذا دوال بدل وصول مباشر؟ anon ممنوع تماماً من brc.applicants
--  (revoke all + لا سياسة له) — فكل مسار عام يمرّ من دالة SECURITY DEFINER
--  نتحقق داخلها من كل شرط ونسجّل التدقيق.
-- ===========================================================================

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
  if v_job = ''   then return jsonb_build_object('ok', false, 'error', 'اختيار الوظيفة إلزامي — لا يكتمل البيع بدونه'); end if;

  /* الوظيفة جزء من الاستمارة: تُقفل قبل أي كتابة (منع سباق حجز مزدوج) */
  select * into j from brc.jobs where code = v_job for update;
  if j.id is null then
    return jsonb_build_object('ok', false, 'error', 'الوظيفة المختارة غير موجودة');
  end if;
  if j.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'الوظيفة ' || j.code || ' غير متاحة حالياً — اختر وظيفة أخرى');
  end if;

  select value into rules from brc.settings where key = 'rules';

  update brc.applicants set
      full_name   = v_name,
      phone       = v_phone,
      address     = coalesce(nullif(btrim(coalesce(p_data->>'address', '')), ''), f.address),
      dob         = nullif(p_data->>'dob', '')::date,
      gender      = coalesce(nullif(p_data->>'gender', ''), 'ذكر'),
      status      = 'active',
      issue_date  = now(),
      expiry_date = now() + make_interval(days => coalesce((rules->>'validity_days')::int, 30)),
      pos_name    = v_pos,
      fee_amount  = coalesce(nullif(p_data->>'fee', '')::int, f.fee_amount),
      fee_paid    = coalesce((p_data->>'feePaid')::boolean, true),
      notes       = coalesce(nullif(p_data->>'notes', ''), f.notes)
  where serial = f.serial
  returning * into f;

  /* استهلاك الفرصة الأولى بالوظيفة المختارة: حجز 24 ساعة عبر trg_attempt_hold
     (يتحقق من توافر الوظيفة مجدداً + يقفلها + يدوّن الحجز بسجل التدقيق). */
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

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'pos', 'بيع وتعبئة بطاقة فارغة', 'applicant', f.serial,
          'بيع البطاقة ' || f.serial || ' للزبون ' || f.full_name ||
          ' — نقطة البيع: ' || v_pos ||
          ' — سعر ' || to_char(f.fee_amount, 'FM999,999,999') || ' د.ع (كاش)' ||
          ' — بدأت صلاحية ' || coalesce((rules->>'validity_days')::int, 30) || ' يوماً من الآن' ||
          ' | الوظيفة المختارة: ' || j.code || ' — ' || j.title);

  return jsonb_build_object(
    'ok', true,
    'app', jsonb_build_object(
      'serial', f.serial, 'fullName', f.full_name, 'phone', f.phone,
      'address', coalesce(f.address, ''), 'dob', f.dob, 'gender', f.gender,
      'status', f.status::text, 'issueDate', f.issue_date, 'expiryDate', f.expiry_date,
      'posName', coalesce(f.pos_name, ''), 'fee', f.fee_amount, 'feePaid', f.fee_paid),
    'attempt', jsonb_build_object(
      'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status::text,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.region,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at),
    'job', jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region));
exception when others then
  /* أخطاء المشغّلات (P0001) نصوص عربية نظيفة تمر كما هي للواجهة */
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 2) صفحة صاحب العمل: الباركود وحده يكفي — تعريف المتقدم والتقديم الجاري
--    وبيانات التواصل. لا رموز فرص إطلاقاً (سرّ الزبون لفرصته الثانية).
create or replace function brc.employer_view(p_serial text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f     record;
  a     record;
  j     record;
  v_st  text;
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

  /* أحدث تقديم قيد اللعب (قد تكون الفرصتان محجوزتين معاً: وظيفة نقطة البيع
     + تقديم الزبون) — هو المطبوع على استمارة A4 الذي يحمله الزبون لصاحب العمل */
  select * into a from brc.job_attempts
   where serial = f.serial and slot_status in ('reserved', 'critical')
   order by selected_at desc nulls last, attempt_no desc limit 1;
  if a.id is not null then
    select * into j from brc.jobs where id = a.job_id;
  end if;

  /* نفس منطق حالة البطاقة في الواجهة (formStatus): منتهية/مستهلكة محسوبتان */
  v_st := case
    when f.status in ('pending', 'rejected') then f.status::text
    when f.expiry_date is not null and now() > f.expiry_date then 'expired'
    when (select count(*) from brc.job_attempts x where x.serial = f.serial and x.slot_status = 'empty') = 0
         and not exists (select 1 from brc.job_attempts x
                          where x.serial = f.serial and x.slot_status in ('reserved', 'critical'))
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
        'employer', jsonb_build_object(
          'name', j.employer_name, 'phone', j.employer_phone,
          'address', j.employer_address, 'interviewLocation', j.interview_location)
      ) end));
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 3) قرار صاحب العمل من صفحة الباركود مباشرة: توظيف/رفض — يُسجَّل فوراً
--    لدى الشركة ويوثّق بسجل التدقيق. الفرصة مستهلكة بالتقديم ولا تعود.
create or replace function brc.employer_decide(p_serial text, p_decision text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f        record;
  a        record;
  j        record;
  outcome  brc.slot_status;
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

  select * into a from brc.job_attempts
   where serial = f.serial and slot_status in ('reserved', 'critical')
   order by selected_at desc nulls last, attempt_no desc limit 1 for update;
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'لا يوجد تقديم قيد القرار على هذه البطاقة — راجع الشركة');
  end if;

  outcome := case when p_decision = 'hire' then 'succeeded'::brc.slot_status
                  else 'rejected'::brc.slot_status end;

  /* trg_attempt_hold يُغلق الوظيفة عند النجاح أو يعيدها متاحة عند الرفض */
  update brc.job_attempts
     set slot_status = outcome,
         outcome_note = case when p_decision = 'hire'
                             then 'قرار صاحب العمل: تم التوظيف — سُجّل من صفحة الباركود'
                             else 'قرار صاحب العمل: لم يتم التوظيف — سُجّل من صفحة الباركود' end
   where id = a.id
  returning * into a;

  select * into j from brc.jobs where id = a.job_id;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'employer',
          case when p_decision = 'hire' then 'توظيف من صاحب العمل' else 'رفض من صاحب العمل' end,
          'applicant', f.serial,
          'صاحب العمل قرر عبر صفحة الباركود على الوظيفة ' || coalesce(a.job_code, '—') ||
          ' — الفرصة #' || a.attempt_no || ' — الزبون ' || f.full_name);

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'no', a.attempt_no, 'slotStatus', a.slot_status::text,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.region,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at, 'closedAt', a.closed_at),
    'job', jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region,
                              'status', j.status::text),
    'decision', p_decision);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 4) المنح: هذه الثلاث مسارات عامة مقصودة (المسح من الموقع بلا جلسة)
grant execute on function brc.activate_card(text, jsonb) to anon, authenticated;
grant execute on function brc.employer_view(text)            to anon, authenticated;
grant execute on function brc.employer_decide(text, text)    to anon, authenticated;
