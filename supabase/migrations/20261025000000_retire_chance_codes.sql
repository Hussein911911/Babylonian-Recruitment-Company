-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — إلغاء رموز الفرص (chance codes) نهائياً
--  ---------------------------------------------------------------------------
--  ما ينفّذه هذا الملف:
--   1) إزالة التوليد التلقائي لرمز الفرصة، وإزالة إلزامه.
--   2) تحديث brc.use_chance بحيث تُستهلك أول خانة فارغة بالباركود وحده.
--   3) إبقاء القيم التاريخية كما هي (لا تُطبع ولا تُطلب) كي لا تنكسر بصمات
--      سجلات الاسترجاع recovery_chances التي تقارن hash للرمز.
--
--  آمن للتكرار: كل الأوامر idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table if exists brc.job_attempts alter column chance_code drop default;
alter table if exists brc.job_attempts alter column chance_code drop not null;

create or replace function brc.use_chance(p_serial text, p_code text, p_job_code text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record; a record; j record; hold_hours int;
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
  if f.status = 'exhausted' then
    return jsonb_build_object('ok', false, 'error', 'استُهلكت فرص البطاقة — تشترى بطاقة جديدة من نقاط البيع');
  end if;

  -- أول فرصة فارغة بالترتيب؛ لا رمز مطلوب (p_code للتوافق فقط)
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

  update brc.job_attempts
     set slot_status = 'reserved', job_id = j.id, job_code = j.code,
         selected_at = now(), hold_expires_at = now() + make_interval(hours => hold_hours)
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

grant execute on function brc.use_chance(text, text, text) to anon, authenticated;

-- 3) إعادة الطباعة: رمز التحقق إن وُجد، وإلا الباركود وحده يكفي.
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
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.region,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at,
      'closedAt', a.closed_at, 'note', a.outcome_note) order by a.attempt_no), '[]'::jsonb)
      from brc.job_attempts a left join brc.jobs j on j.id = a.job_id where a.serial = f.serial)
  ));
end $$;

grant execute on function brc.verify_card_code(text, text) to anon, authenticated;
