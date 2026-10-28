-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — إصلاح brc.verify_card_code على قاعدةٍ بلا عمود card_print_code
--  ---------------------------------------------------------------------------
--  قاعدة الإنتاج الحيّة أُنشئت قبل إضافة العمود card_print_code (الهجرة
--  20261016090000 لم تُطبَّق عليها)، والدالة كانت تقرأه مباشرةً:
--      if f.card_print_code is not null then ...
--  فتفشل **كل** نداءات إعادة الطباعة بـ 42703: record "f" has no field
--  "card_print_code" — أي أن مسار «إعادة طباعة البطاقة» معطّل في الإنتاج.
--
--  الحل: قراءة الحقل عبر to_jsonb(f)->>'card_print_code' وهو يعيد NULL
--  بلا خطأ إن غاب العمود، ويعمل كما هو إن وُجد. **لا نضيف العمود** هنا لأن
--  تغيير مخطّط brc يغيّر recovery_schema_hash() فيُبطل نسخ الاسترجاع القديمة.
--
--  آمن للتكرار (idempotent) — استبدال دالة فقط.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function brc.verify_card_code(p_serial text, p_code text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, brc, public
as $$
declare
  f record;
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

notify pgrst, 'reload schema';
