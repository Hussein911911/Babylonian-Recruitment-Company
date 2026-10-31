-- Snapshot only information needed for the issued application, on the
-- opportunity itself so ordinary backup/restore includes it. Historical
-- opportunities with a still-linked job are backfilled without inventing data.
alter table brc.job_attempts add column if not exists job_snapshot jsonb;
-- A PostgreSQL SELECT * view does not automatically include newly added columns.
create or replace view brc.working_job_attempts with(security_invoker=true) as
 select t.* from brc.job_attempts t join brc.working_applicants a on a.serial=t.serial;
create or replace function brc.application_job_snapshot(j brc.jobs) returns jsonb
language sql stable set search_path=brc,public as $$
  select jsonb_build_object('code',j.code,'title',j.title,'governorate',j.governorate,
    'employer_name',j.employer_name,'employer_phone',j.employer_phone,'employer_address',j.employer_address,
    'interview_location',j.interview_location,'shift',j.shift,'salary_min',j.salary_min,'salary_max',j.salary_max)
$$;
revoke all on function brc.application_job_snapshot(brc.jobs) from public,anon,authenticated;
-- Backfill runs under the table DDL lock. Suppress the audit, recovery registry and job
-- recomputation side effects; preserve their previous enabled states exactly.
-- Recovery fences and all integrity triggers stay enabled.
do $$
declare t record; saved jsonb;
begin
 select coalesce(jsonb_object_agg(tgname,tgenabled::text),'{}'::jsonb) into saved
 from pg_trigger where tgrelid='brc.job_attempts'::regclass and not tgisinternal
   and tgname in ('trg_sync_vacancies','trg_audit_attempts','recovery_remember_chances');
 for t in select key as name,value as state from jsonb_each_text(saved) where value<>'D' loop
   execute format('alter table brc.job_attempts disable trigger %I',t.name);
 end loop;
 update brc.job_attempts a set job_snapshot=brc.application_job_snapshot(j)
  from brc.jobs j where a.job_id=j.id and a.job_code=j.code and a.selected_at is not null
  and a.slot_status<>'empty' and a.job_snapshot is null;
 for t in select key as name,value as state from jsonb_each_text(saved) where value<>'D' loop
   execute format('alter table brc.job_attempts %s trigger %I',
     case t.state when 'R' then 'enable replica' when 'A' then 'enable always' else 'enable' end,t.name);
 end loop;
end $$;
create or replace function brc.capture_application_job_snapshot() returns trigger
language plpgsql security definer set search_path=brc,public as $$
begin
  if tg_op='UPDATE' and old.job_snapshot is not null and new.job_code is not distinct from old.job_code then
    -- Stale client upserts must not erase the archived details, including on FK SET NULL.
    new.job_snapshot:=old.job_snapshot;
  elsif new.slot_status<>'empty' and new.selected_at is not null and new.job_snapshot->>'code'=new.job_code then
    -- Retain an archived snapshot from a legitimate backup restore.
    null;
  elsif new.job_id is not null and new.selected_at is not null and new.slot_status<>'empty' then
    select brc.application_job_snapshot(j) into new.job_snapshot
      from brc.jobs j where j.id=new.job_id and j.code=new.job_code;
  else
    new.job_snapshot:=null;
  end if;
  return new;
end $$;
drop trigger if exists zz_capture_application_job_snapshot on brc.job_attempts;
create trigger zz_capture_application_job_snapshot before insert or update on brc.job_attempts
 for each row execute function brc.capture_application_job_snapshot();
revoke all on function brc.capture_application_job_snapshot() from public,anon,authenticated;

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

create or replace function brc.customer_application_details(p_serial text, p_attempt_no integer)
returns jsonb language plpgsql security definer set search_path = brc, public as $$
declare f record; a record; v_job jsonb;
begin
  select * into f from brc.applicants where serial=upper(btrim(coalesce(p_serial,'')));
  if f.serial is null or f.status in ('blank','pending','rejected') then
    return jsonb_build_object('ok',false,'error','لا تتوفر تفاصيل تقديم لهذه البطاقة');
  end if;
  select * into a from brc.job_attempts where serial=f.serial and attempt_no=p_attempt_no
    and slot_status <> 'empty' and selected_at is not null and job_code is not null;
  if a.id is null then
    return jsonb_build_object('ok',false,'error','لا يوجد تقديم مسجل لهذه الفرصة');
  end if;
  -- A matching application snapshot is authoritative, including after deletion.
  -- Legacy linked rows may use the exact job ID, never a reused code alone.
  if a.job_snapshot->>'code'=a.job_code then v_job := a.job_snapshot; end if;
  if v_job is null then
    select to_jsonb(j) into v_job from brc.jobs j where j.id=a.job_id and j.code=a.job_code;
  end if;
  if v_job is null then
    return jsonb_build_object('ok',false,'error','تفاصيل الوظيفة غير متوفرة، تواصل مع الشركة');
  end if;
  return jsonb_build_object('ok',true,
    'app',jsonb_build_object('serial',f.serial,'fullName',f.full_name,'phone',f.phone,
      'address',f.address,'dob',f.dob,'gender',f.gender,'nationality',f.nationality,
      'status',f.status,'issueDate',f.issue_date,'expiryDate',f.expiry_date),
    'attempt',jsonb_build_object('no',a.attempt_no,'slotStatus',a.slot_status,'jobCode',a.job_code,
      'jobTitle',v_job->>'title','location',v_job->>'governorate','selectedAt',a.selected_at,'holdExpiresAt',a.hold_expires_at,
      'employerName',v_job->>'employer_name','employerPhone',v_job->>'employer_phone',
      'employerAddress',v_job->>'employer_address','interviewLocation',v_job->>'interview_location',
      'shift',v_job->>'shift','salaryMin',v_job->'salary_min','salaryMax',v_job->'salary_max'));
end $$;
revoke all on function brc.customer_application_details(text,integer) from public;
grant execute on function brc.customer_application_details(text,integer) to anon,authenticated;
notify pgrst, 'reload schema';
