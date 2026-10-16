-- One independent reprint secret per NEW card. Existing cards retain their
-- printed legacy codes; never backfill/rotate those secrets behind the holder.
begin;

create or replace function brc.new_card_print_code() returns text
language sql volatile set search_path = pg_catalog
as $$ select upper(substr(u, 1, 12) || substr(u, 21, 4))
      from (select replace(gen_random_uuid()::text, '-', '') as u) s $$;

alter table brc.applicants add column if not exists card_print_code text;
alter table brc.applicants alter column card_print_code set default brc.new_card_print_code();

create or replace function brc.verify_card_code(p_serial text, p_code text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, brc, public
as $$
declare
  f record;
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
  if supplied <> '' then
    if f.card_print_code is not null then
      valid := supplied = upper(f.card_print_code);
    else
      -- Compatibility ONLY for cards issued before this migration.
      select exists(select 1 from brc.job_attempts a where a.serial = f.serial
        and supplied = upper(regexp_replace(coalesce(a.chance_code, ''), '[^A-Za-z0-9]', '', 'g')))
        into valid;
    end if;
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
    'posName', coalesce(f.pos_name, ''), 'cardPrintCode', f.card_print_code,
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object(
      'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.region,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at,
      'closedAt', a.closed_at, 'note', a.outcome_note) order by a.attempt_no), '[]'::jsonb)
      from brc.job_attempts a left join brc.jobs j on j.id = a.job_id where a.serial = f.serial)
  ));
end $$;
revoke all on function brc.verify_card_code(text, text) from public;
grant execute on function brc.verify_card_code(text, text) to anon, authenticated;
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
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة فارغة ولم تُبع بعد — إذا عُرضت لك للبيع فخابر الشركة فوراً لتفادي التزوير');
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
               'jobTitle', j.title,
               'location', j.region,
               'selectedAt', a.selected_at,
               'holdExpiresAt', a.hold_expires_at,
               'note', case when a.slot_status in ('rejected', 'expired') then a.outcome_note else '' end
             ) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
       where a.serial = f.serial)
  );
end $$;


notify pgrst, 'reload schema';
commit;
