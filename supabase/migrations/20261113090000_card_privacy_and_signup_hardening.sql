-- ═══════════════════════════════════════════════════════════════════════════
--  تشديد خصوصية البطاقة — مراجعة أمنية 2026-11-13
--  ---------------------------------------------------------------------------
--  نتيجة الفحص الفعلي بأدوار anon/authenticated على القاعدة الحيّة:
--  ✅ RLS على 21/21 جدولاً · revoke all from anon · لا سياسة `true` مطلقاً
--  ✅ recovery_export_v2 ترفض غير المدير (اختُبر: P0001)
--  ✅ anon لا يقرأ applicants/staff (اختُبر: 42501 permission denied)
--  ✅ public_verification محجوب عن anon (اختُبر: 42501)
--  ✅ use_chance بلا رمز = قرار مقفل 2026-10-25 لا ثغرة (cloud.js + المخطط)
--
--  ⚠️ الثغرة الحقيقية: self_service_card/lookup_card كانتا تُرجعان الاسم الكامل
--     والهاتف والعنوان وتاريخ الميلاد لأي حامل للباركود، بلا أي إثبات.
--
--  الإصلاح — بلا تعطيل أحد:
--    العمود card_print_code يحمل رمز الطباعة (نصّي، غير مجزّأ).
--    • بطاقة **بلا** رمز (كل الـ723 الحالية — العمود لم يُملأ قط):
--      تُرجع البيانات كاملة كما كانت تماماً. لا يتغيّر شيء للمستخدم.
--    • بطاقة **لها** رمز: لا اسم كامل ولا هاتف كامل ولا عنوان ولا ميلاد
--      إلا بتقديم الرمز الصحيح. مغطّى بـ: maskedName · maskedPhone ·
--      profile:{} · verified:false · requiresCode:true · profileLocked:true
--    الحماية تُفعَّل تلقائياً لحظة كتابة رمز لأي بطاقة.
--
--  التوقيع صار (text, text) والدالتان تتطلّبان الوسيطين: يمنع ذلك وجود
--  توقيعين متعارضين (function is not unique) ويعطّل المسار القديم.
--  لا حذف بيانات في هذا الملف — استبدال دوال + حذف توقيع قديم فقط.
-- ═══════════════════════════════════════════════════════════════════════════

set search_path = brc, public;

/* التوقيع القديم (text) يُحذف **قبل** الإنشاء: بقاؤه يخلق نداءً غامضاً
   (function is not unique) فيتعطّل التقديم الذاتي بالكامل. */
drop function if exists brc.self_service_card(text);

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

revoke all on function brc.self_service_card(text, text) from public;
grant execute on function brc.self_service_card(text, text) to anon, authenticated;

/* lookup_card: كانت لا تزال تُرجع الاسم والهاتف بلا رمز — صُحّحت بنفس المنطق. */
drop function if exists brc.lookup_card(text);

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

revoke all on function brc.lookup_card(text, text) from public;
grant execute on function brc.lookup_card(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
