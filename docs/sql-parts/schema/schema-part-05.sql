-- ═══════════════════════════════════════════════════════════════════════
--  schema — الجزء 05 من 05
--  يفعّل: الفهارس · الدوال · العروض · المشغّلات · المهام المجدولة · إدخال بيانات · كتل تنفيذية (DO)
--  أسطر: 371 · حجم: 24 ك.ب
--  ---------------------------------------------------------------------
--  ⚠ لا تلصق هذا الجزء قبل تنفيذ الجزء 04 بنجاح.
--  هذا آخر جزء. بعد «Success» تحقّق من الأعداد في INDEX.md.
-- ═══════════════════════════════════════════════════════════════════════


-- Recompute existing jobs; preserve explicitly closed advertisements.
update brc.jobs set updated_at=updated_at;
revoke all on function brc.trg_job_vacancies(),brc.trg_sync_vacancies() from public,anon,authenticated;

create or replace function brc.run_auto_release() returns table (released_job text, expired_form text)
language plpgsql security definer
set search_path = brc, public
as $$
declare r record;
begin
  for r in select a.id,a.job_code,a.serial from brc.job_attempts a where a.slot_status='reserved' and a.hold_expires_at<now() for update loop
    update brc.job_attempts set slot_status='critical',hold_expires_at=null,outcome_note='انتهت مهلة الشاغر — بانتظار قرار الشركة' where id=r.id;
    released_job:=r.job_code;expired_form:=r.serial;return next;
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
         coalesce(image_url, '') as image_url,
         case when j.manual_closed then 0 else greatest(j.vacancies-cardinality(j.filled_vacancy_numbers)-(select count(*)::int from brc.job_attempts a where a.job_id=j.id and a.slot_status in('reserved','critical','hiring')),0) end as available_vacancies
    from brc.jobs j
   where status <> 'closed' or created_at > now() - interval '120 days';

-- 2026-10-20: 60-day retention and bounded historical reads.
-- Retain every card and opportunity. Archive only resolved/expired cards after
-- 60 days; never archive a pending application or replenish a printed chance.
alter table brc.applicants add column if not exists archived_at timestamptz;
create index if not exists applicants_working_idx on brc.applicants(serial) where archived_at is null;
create index if not exists applicants_history_idx on brc.applicants(created_at desc,serial);

create or replace function brc.card_finished_at(p_serial text) returns timestamptz
language sql stable security invoker set search_path=brc,public as $$
 select case
 when a.status in ('blank','pending','rejected') then null
 when exists(select 1 from brc.job_attempts t where t.serial=a.serial and t.slot_status in ('reserved','critical','hiring')) then null
 when exists(select 1 from brc.job_attempts t where t.serial=a.serial and t.slot_status in ('succeeded','rejected','expired') and t.closed_at is null) then null
 when (select count(*) from brc.job_attempts t where t.serial=a.serial and t.slot_status in ('succeeded','rejected','expired'))>=coalesce(a.attempt_limit,2)
 then (select max(t.closed_at) from brc.job_attempts t where t.serial=a.serial)
 when a.expiry_date<=now() then greatest(a.expiry_date,(select max(t.closed_at) from brc.job_attempts t where t.serial=a.serial))
 else null end from brc.applicants a where a.serial=p_serial
$$;
revoke all on function brc.card_finished_at(text) from public,anon,authenticated;

create or replace function brc.archive_finished_cards() returns integer
language plpgsql security definer set search_path=brc,public as $$
declare affected integer;
begin
 with candidates as materialized (
 select a.serial from brc.applicants a where a.archived_at is null
 and brc.card_finished_at(a.serial)<=now()-interval '60 days'
 for update of a skip locked
 ) update brc.applicants a set archived_at=now(),updated_at=now()
 from candidates c where a.serial=c.serial;
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function brc.archive_finished_cards() from public,anon,authenticated;

-- Authenticated staff cannot clear/change archive stamps or edit archived cards.
-- Owner-run recovery still uses its existing transaction/fences and trigger rules.
create or replace function brc.trg_archive_readonly() returns trigger
language plpgsql security invoker set search_path=brc,public as $$
begin
 if current_user not in ('postgres','service_role') and
 ((tg_op='INSERT' and new.archived_at is not null) or (tg_op='UPDATE' and (old.archived_at is not null or new.archived_at is distinct from old.archived_at))) then
 raise exception 'البطاقة مؤرشفة للمراجعة فقط؛ لا يمكن إعادة فرصها أو تغيير أرشفتها';
 end if;
 return new;
end $$;
drop trigger if exists trg_archive_readonly on brc.applicants;
create trigger trg_archive_readonly before insert or update on brc.applicants for each row execute function brc.trg_archive_readonly();
revoke all on function brc.trg_archive_readonly() from public,anon,authenticated;

-- Invoker views retain existing staff RLS. Omitted rows are NOT deleted rows.
create or replace view brc.working_applicants with(security_invoker=true) as
 select * from brc.applicants where archived_at is null;
create or replace view brc.working_job_attempts with(security_invoker=true) as
 select t.* from brc.job_attempts t join brc.working_applicants a on a.serial=t.serial;
create or replace view brc.working_jobs with(security_invoker=true) as
 select j.* from brc.jobs j where j.status<>'closed'
 or coalesce(j.closed_at,j.created_at)>now()-interval '60 days'
 or exists(select 1 from brc.working_job_attempts t where t.job_id=j.id);
revoke all on brc.working_applicants,brc.working_job_attempts,brc.working_jobs from public,anon;
grant select on brc.working_applicants,brc.working_job_attempts,brc.working_jobs to authenticated;

-- Fixed-size server-side historical search, including archived AND current cards.
-- Curated fields only: no chance codes, print verification codes, PINs or tokens.
create or replace function brc.staff_card_history(p_query text default '',p_page integer default 0) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare result jsonb; q text:=btrim(coalesce(p_query,''));
begin
 if not brc.is_staff() then raise exception 'غير مخول' using errcode='42501'; end if;
 if length(q)>120 or p_page is null or p_page<0 or p_page>100000 then raise exception 'بحث غير صالح';end if;
 with matches as materialized (
 select a.* from brc.applicants a where q=''
 or position(lower(q) in lower(a.serial))>0
 or position(lower(q) in lower(a.full_name))>0
 or position(q in a.phone)>0
 order by a.created_at desc,a.serial offset p_page*50 limit 51
 ), page as (select * from matches order by created_at desc,serial limit 50)
 select jsonb_build_object('page',p_page,'hasMore',(select count(*)>50 from matches),
 'cards',coalesce(jsonb_agg(jsonb_build_object(
 'serial',a.serial,'fullName',a.full_name,'phone',a.phone,'address',a.address,'status',a.status,
 'issueDate',a.issue_date,'expiryDate',a.expiry_date,'archivedAt',a.archived_at,'finishedAt',brc.card_finished_at(a.serial),
 'attemptLimit',a.attempt_limit,'notes',a.notes,
 'attempts',coalesce((select jsonb_agg(jsonb_build_object('no',t.attempt_no,'jobCode',t.job_code,'jobTitle',j.title,
 'vacancyNo',t.vacancy_no,'slotStatus',t.slot_status,'selectedAt',t.selected_at,'closedAt',t.closed_at,
 'employerDecision',t.employer_decision,'reason',t.employer_reason,'note',t.outcome_note) order by t.attempt_no)
 from brc.job_attempts t left join brc.jobs j on j.id=t.job_id where t.serial=a.serial),'[]'::jsonb))
 order by a.created_at desc,a.serial),'[]'::jsonb)) into result from page a;
 return result;
end $$;
revoke all on function brc.staff_card_history(text,integer) from public,anon;
grant execute on function brc.staff_card_history(text,integer) to authenticated;

-- Lifetime accounting remains server-side: archival must not reduce totals.
create or replace function brc.staff_card_report(p_from date default null,p_to date default null) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare result jsonb;
begin
 if not brc.is_staff() then raise exception 'غير مخول' using errcode='42501';end if;
 if p_from>p_to then raise exception 'الفترة غير صالحة';end if;
 with attempts as materialized (
 select serial,count(*) filter(where slot_status='empty') empty_count,
 count(*) filter(where slot_status in('reserved','critical','hiring')) in_play,
 count(*) filter(where slot_status='succeeded') hires,count(*) filter(where slot_status='reserved') holds
 from brc.job_attempts group by serial
 ), cards as materialized (
 select a.*,coalesce(t.hires,0) hires,coalesce(t.holds,0) holds,
 case when a.status in('blank','pending','rejected') then a.status::text
 when a.expiry_date is not null and a.expiry_date<now() then 'expired'
 when coalesce(t.empty_count,0)=0 and coalesce(t.in_play,0)=0 then 'exhausted' else 'active' end effective_status,
 coalesce((to_jsonb(a)->>'paid_amount')::numeric,0) paid_amount
 from brc.applicants a left join attempts t on t.serial=a.serial
 ), financial as (
 select coalesce(a.created_by::text,'system') "user",coalesce(s.full_name,a.created_by::text,'system') name,
 count(*) forms,sum(coalesce(a.printed_count,0)) printed,sum(a.fee_amount) expected,
 sum(case when a.paid_amount>0 then least(a.paid_amount,a.fee_amount) when a.fee_paid then a.fee_amount else 0 end) collected,
 sum(a.hires) hires,sum(a.holds) holds,
 count(*) filter(where a.paid_amount>=a.fee_amount or (a.paid_amount<=0 and a.fee_paid)) paid,
 count(*) filter(where a.paid_amount>0 and a.paid_amount<a.fee_amount) partial,
 count(*) filter(where a.paid_amount<=0 and not a.fee_paid) unpaid
 from cards a left join brc.staff s on s.id=a.created_by
 where (p_from is null or (a.issue_date at time zone 'Asia/Baghdad')::date>=p_from)
 and (p_to is null or (a.issue_date at time zone 'Asia/Baghdad')::date<=p_to)
 group by a.created_by,s.full_name
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(f) order by expected desc) from financial f),'[]'::jsonb),
 'stats',jsonb_build_object('forms',(select count(*) from cards),'activeForms',(select count(*) from cards where effective_status='active'),
 'blankForms',(select count(*) from cards where effective_status='blank'),'pendingForms',(select count(*) from cards where effective_status='pending'),
 'expiredForms',(select count(*) from cards where effective_status='expired'),'hires',(select count(*) from brc.job_attempts where slot_status='succeeded'),
 'totalJobs',(select count(*) from brc.jobs),'available',(select count(*) from brc.jobs where status='available'),
 'reserved',(select count(*) from brc.jobs where status='reserved'),'closed',(select count(*) from brc.jobs where status='closed'))) into result;
 return result;
end $$;
revoke all on function brc.staff_card_report(date,date) from public,anon;
grant execute on function brc.staff_card_report(date,date) to authenticated;

-- Compact exact occupancy map for the ORIGINAL 9000 x 23 x 23 printed chance
-- codes. Omitting archived attempts must never permit reissuing their codes.
-- 595125 bytes regardless of history size; staff-only, held in memory, not cache.
create or replace function brc.staff_issuance_registry(p_serial text default null) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare packed text;
begin
 if not brc.is_staff() then raise exception 'غير مخول' using errcode='42501';end if;
 if p_serial is not null then
 if length(p_serial)>128 then raise exception 'كود غير صالح';end if;
 return jsonb_build_object('used',exists(select 1 from brc.issued_serials where serial=upper(btrim(p_serial))) or exists(select 1 from brc.applicants where serial=upper(btrim(p_serial))));
 end if;
 with valid as materialized(select chance_code c from brc.job_attempts where chance_code ~ '^[1-9][0-9]{3}-[A-HJKMNP-Z]{2}$'),
 indices as(select (substring(c,1,4)::int-1000)*529+(strpos('ABCDEFGHJKMNPQRSTUVWXYZ',substring(c,6,1))-1)*23+strpos('ABCDEFGHJKMNPQRSTUVWXYZ',substring(c,7,1))-1 n from valid),
 bytes as(select n/8 pos,bit_or(1<<(n%8)) mask from indices group by n/8)
 select encode(decode(string_agg(lpad(to_hex(coalesce(b.mask,0)),2,'0'),'' order by p.n),'hex'),'base64') into packed
 from generate_series(0,595124) p(n) left join bytes b on b.pos=p.n;
 return jsonb_build_object('version',1,'bitmap',packed);
end $$;
revoke all on function brc.staff_issuance_registry(text) from public,anon;
grant execute on function brc.staff_issuance_registry(text) to authenticated;

-- Initial metadata-only sweep; no DELETE, no opportunity/job outcome changes.
select brc.archive_finished_cards();
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
 perform cron.schedule('hrc-card-archive-daily','15 0 * * *','select brc.archive_finished_cards();');
 end if;
end $$;
notify pgrst,'reload schema';

-- Customer access is by card barcode alone (owner-approved). Limit every result
-- to the exact card and selected opportunity; never expose unused/other jobs.
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

-- ===========================================================================
--  11) service_role — منح صريح في **آخر** الملف (2026-11-13)
-- ===========================================================================
-- ⚠️ كان service_role يعتمد على **وراثة PUBLIC** (Grant تلقائي لكل دالة جديدة).
--    بعد سحب EXECUTE من PUBLIC صار محروماً — وهذا يكسر النسخ الاحتياطي
--    والاسترجاع ودوال الحافة، وكلها تعمل بمفتاح الخادم.
--    ⚠️ موضع السطر مهم: `grant execute on all functions` يشمل ما هو مُعرَّف
--    **حتى لحظة تنفيذه** فقط. وُضع هنا (آخر الملف) كي يغطي كل الدوال؛ ونسخته
--    السابقة في قسم الصلاحيات كانت تغطي أول 5 دوال فقط.
grant usage on schema brc to service_role;
grant execute on all functions in schema brc to service_role;
-- وللدوال التي تُنشأ لاحقاً في ترحيلات مستقبلية:
alter default privileges grant execute on functions to service_role;

-- ===========================================================================
--  12) مساعدا العرض العام + إغلاق تعداد البطاقات (2026-11-13)
-- ===========================================================================
--  أرقام البطاقات تُطبع على ورق، والمفتاح العام منشور — فأي زائر يستطيع
--  تعداد البطاقات. الحماية **ميزانية طلبات** في card_lookup_guard (١٥ عرضاً/
--  ساعة لكل بطاقة، ٤٠ بطاقة مختلفة/ساعة لكل مصدر) — لا تقنين شخصي.
--
--  ⚠️ التقنين أُلغي 2026-11-13 بعد توضيح صاحب العمل لدورة العمل: المكتب
--     يُصدر بطاقات **فارغة** ويبيعها كاشاً، والمفعّلة بياناتها كتبها صاحبها.
--     و`card_print_code` غير مستعمل فيها (فارغ في 723/723 بطاقة)، فاشتراطه
--     كان يُقنّع كل زبون عن نفسه ويقفل حقوله بلا مقابل.
--     ما يحمي فعلاً: من يقدّم ببطاقة غيره **يكتب اسمه فوقها** (apply_with_card)،
--     فيقارن صاحب العمل الاسم بالهوية الوطنية ويكشفه.
--
--  الدالتان أدناه باقيتان للاستخدام الداخلي/المستقبلي، ولا يُنادى بهما من
--  lookup_card بعد الآن.
--  (التفاصيل والقياس في supabase/migrations/20261113170000_card_enumeration_guard.sql)
create or replace function brc.card_public_name(p_name text, p_verified boolean)
returns text language sql immutable set search_path = brc, public, pg_temp
as $$
  select case
    when p_verified then coalesce(p_name, '')
    when coalesce(btrim(p_name), '') = '' then ''
    else (regexp_split_to_array(btrim(p_name), '\s+'))[1]
         || coalesce(' ' || left((regexp_split_to_array(btrim(p_name), '\s+'))[2], 1) || '.', '')
  end
$$;

create or replace function brc.card_public_phone(p_phone text, p_verified boolean)
returns text language sql immutable set search_path = brc, public, pg_temp
as $$
  select case
    when p_verified then coalesce(p_phone, '')
    when coalesce(btrim(p_phone), '') = '' then ''
    else left(btrim(p_phone), 4) || '••••' || right(btrim(p_phone), 2)
  end
$$;

revoke all on function brc.card_public_name(text, boolean) from public, anon, authenticated;
revoke all on function brc.card_public_phone(text, boolean) from public, anon, authenticated;
grant execute on function brc.card_public_name(text, boolean) to service_role;
grant execute on function brc.card_public_phone(text, boolean) to service_role;