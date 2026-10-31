-- Allow a blank issued card to be recognised without revealing profile data or changing it.
create or replace function brc.lookup_card(p_serial text) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare f record;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على بطاقتك');
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
    'serial', f.serial, 'usesCardPrintCode', to_jsonb(f)->>'card_print_code' is not null,
    'fullName', brc.mask_name(f.full_name),
    'phone', brc.mask_phone(f.phone),
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

notify pgrst, 'reload schema';
