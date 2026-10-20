-- Independent numbered vacancies within ONE job advertisement. Not card chances.
-- Preflight is intentionally fail-closed; never discard an existing placement.
do $$begin if not exists(select 1 from information_schema.columns where table_schema='brc' and table_name='jobs' and column_name='manual_closed') then alter table brc.jobs add column manual_closed boolean not null default false;update brc.jobs set manual_closed=true where status='closed';end if;end $$;
alter table brc.jobs add column if not exists filled_vacancy_numbers integer[] not null default '{}';
alter table brc.job_attempts add column if not exists vacancy_no integer check(vacancy_no>0);
do $$begin
 if exists(select 1 from brc.job_attempts a join brc.jobs j on j.id=a.job_id where a.slot_status in('reserved','critical','hiring','succeeded') group by j.id,j.vacancies having count(*)>j.vacancies) then raise exception 'Existing placements exceed vacancy capacity; review before migration';end if;
end $$;
with ranked as(select id,row_number() over(partition by job_id order by selected_at nulls last,id)::int n from brc.job_attempts where job_id is not null and slot_status in('reserved','critical','hiring','succeeded'))
update brc.job_attempts a set vacancy_no=r.n from ranked r where a.id=r.id and a.vacancy_no is null;
create unique index if not exists job_vacancy_occupied on brc.job_attempts(job_id,vacancy_no) where slot_status in('reserved','critical','hiring','succeeded');

create or replace function brc.trg_job_vacancies() returns trigger language plpgsql security definer set search_path=brc,public as $$
declare used int[]; pending record; filled int; held int;
begin
 -- Permanent fill numbers cannot be erased by stale browser mirrors or card deletion.
 select coalesce(array_agg(distinct n order by n),'{}') into new.filled_vacancy_numbers from(
 select unnest(old.filled_vacancy_numbers) n union select vacancy_no from brc.job_attempts where job_id=new.id and slot_status='succeeded' and vacancy_no is not null) s;
 select coalesce(array_agg(distinct n),'{}') into used from(select unnest(new.filled_vacancy_numbers) n union select vacancy_no from brc.job_attempts where job_id=new.id and slot_status in('reserved','critical','hiring') and vacancy_no is not null) s;
 if coalesce((select max(n) from unnest(used) n),0)>new.vacancies then raise exception 'لا يمكن تقليل الشواغر تحت رقم شاغر مشغول';end if;
 select * into pending from brc.job_attempts where job_id=new.id and slot_status in('reserved','critical','hiring') order by vacancy_no limit 1;
 filled:=cardinality(new.filled_vacancy_numbers);held:=cardinality(used)-filled;
 new.status:=case when new.manual_closed then 'closed'::brc.job_status when cardinality(used)<new.vacancies then 'available'::brc.job_status when filled>=new.vacancies then 'closed'::brc.job_status when exists(select 1 from brc.job_attempts where job_id=new.id and slot_status='hiring') then 'hiring'::brc.job_status else 'reserved'::brc.job_status end;
 new.reserved_by:=pending.serial;new.hold_expires_at:=pending.hold_expires_at;
 new.critical:=exists(select 1 from brc.job_attempts where job_id=new.id and slot_status='critical');
 new.closed_at:=case when new.status='closed' then coalesce(new.closed_at,now()) else null end;
 return new;
end $$;
drop trigger if exists trg_job_vacancies on brc.jobs;
create trigger trg_job_vacancies before update on brc.jobs for each row execute function brc.trg_job_vacancies();

create or replace function brc.trg_attempt_hold() returns trigger language plpgsql security definer set search_path=brc,public as $$
declare j brc.jobs; f brc.applicants; hours int; seat int;
begin
 if tg_op='UPDATE' and old.job_id is not null and new.job_id is null and old.slot_status in('reserved','critical','hiring') then new.slot_status:='expired';new.closed_at:=now();new.hold_expires_at:=null;new.outcome_note:='حذفت الشركة الإعلان — الفرصة مستهلكة';end if;
 if tg_op='UPDATE' and old.slot_status in('succeeded','rejected','expired') and new.slot_status is distinct from old.slot_status then raise exception 'الفرصة مستهلكة ولا يمكن إعادة استخدامها';end if;
 if new.slot_status='reserved' and (tg_op='INSERT' or old.slot_status is distinct from 'reserved') then
  if tg_op='UPDATE' and old.slot_status<>'empty' then raise exception 'الفرصة ليست فارغة';end if;
  select * into f from brc.applicants where serial=new.serial for update;
  if f.serial is null or f.status in('blank','pending','rejected','expired','exhausted') or f.expiry_date<now() then raise exception 'البطاقة غير صالحة للتقديم';end if;
  select * into j from brc.jobs where id=new.job_id for update;
  if j.id is null or j.manual_closed then raise exception 'الوظيفة غير متاحة';end if;
  select n into seat from generate_series(1,j.vacancies) n where not(n=any(j.filled_vacancy_numbers)) and not exists(select 1 from brc.job_attempts a where a.job_id=j.id and a.vacancy_no=n and a.slot_status in('reserved','critical','hiring','succeeded') and a.id<>new.id) order by n limit 1;
  if seat is null then raise exception 'لا يوجد شاغر متاح';end if;
  select coalesce((value->>'hold_hours')::int,24) into hours from brc.settings where key='rules';
  new.vacancy_no:=seat;new.job_code:=j.code;new.selected_at:=coalesce(new.selected_at,now());new.hold_expires_at:=coalesce(new.hold_expires_at,now()+make_interval(hours=>coalesce(hours,24)));new.closed_at:=null;
 elsif tg_op='UPDATE' and old.vacancy_no is not null and (new.vacancy_no is distinct from old.vacancy_no or (new.job_id is distinct from old.job_id and new.job_id is not null)) then raise exception 'لا يمكن نقل شاغر فرصة مستخدمة';
 end if;
 if new.slot_status in('succeeded','rejected','expired') and (tg_op='INSERT' or old.slot_status is distinct from new.slot_status) then
  if tg_op='UPDATE' and old.slot_status not in('reserved','critical','hiring') then raise exception 'لا يوجد حجز قيد القرار';end if;
  new.closed_at:=coalesce(new.closed_at,now());new.hold_expires_at:=null;
 end if;
 return new;
end $$;
drop trigger if exists trg_attempt_hold on brc.job_attempts;
create trigger trg_attempt_hold before insert or update on brc.job_attempts for each row execute function brc.trg_attempt_hold();
create or replace function brc.trg_sync_vacancies() returns trigger language plpgsql security definer set search_path=brc,public as $$begin
 update brc.jobs set updated_at=now() where id=coalesce(new.job_id,old.job_id);return coalesce(new,old);
end $$;
drop trigger if exists trg_sync_vacancies on brc.job_attempts;
create trigger trg_sync_vacancies after insert or update or delete on brc.job_attempts for each row execute function brc.trg_sync_vacancies();
-- Recompute existing jobs; preserve explicitly closed advertisements.
update brc.jobs set updated_at=updated_at;
revoke all on function brc.trg_job_vacancies(),brc.trg_sync_vacancies() from public,anon,authenticated;

create or replace function brc.employer_pin_action(p_session text,p_decision text default '',p_reason text default '')
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare c record; a record; j record; f record; phone_now text;
begin
 perform pg_advisory_xact_lock(18190000);
 select * into c from brc.employer_otp where session_hash=encode(extensions.digest(p_session,'sha256'),'hex') and session_expires_at>now() for update;
 if c.id is null then return jsonb_build_object('ok',false,'code','session_expired'); end if;
 if p_decision='logout' then update brc.employer_otp set session_expires_at=now() where id=c.id;return jsonb_build_object('ok',true);end if;
 -- Lock in the same order as card application (card -> attempt -> job).
 select x.serial into a from brc.job_attempts x where x.id=c.attempt_id;
 select * into f from brc.applicants where serial=a.serial for update;
 select * into a from brc.job_attempts where id=c.attempt_id for update;
 select * into j from brc.jobs where id=a.job_id for update;
 if j.id is null or a.slot_status not in ('reserved','critical','hiring') then return jsonb_build_object('ok',false,'code','session_expired'); end if;
 if coalesce(p_decision,'')<>'' then
 if p_decision not in ('hire','reject') or a.employer_decision is not null or a.slot_status='hiring' then return jsonb_build_object('ok',false,'code','decision_unavailable'); end if;
 if p_decision='reject' and (length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>300) then return jsonb_build_object('ok',false,'code','reason_required'); end if;
 if p_decision='hire' then
 update brc.job_attempts set slot_status='hiring',employer_decision='hire',employer_reason=null,decision_at=now(),hold_expires_at=null,outcome_note='طلب صاحب العمل — بانتظار تثبيت الشركة' where id=a.id;

 else
 update brc.job_attempts set slot_status='critical',employer_decision='reject',employer_reason=btrim(p_reason),decision_at=now(),hold_expires_at=null,outcome_note='رفض صاحب العمل — بانتظار قرار الشركة' where id=a.id;

 end if;
 insert into brc.audit_log(username,role,action,entity,entity_id,details) values('verified-employer','employer','قرار صاحب العمل بعد تحقق الرمز السري','applicant',f.serial,'الوظيفة '||j.code||' — '||p_decision);
 end if;
 return jsonb_build_object('ok',true,'applicant',jsonb_build_object('name',f.full_name,'phone',f.phone,'address',f.address,'gender',f.gender),
 'job',jsonb_build_object('code',j.code,'title',j.title,'region',j.region,'vacancyNo',a.vacancy_no),'decision',coalesce(nullif(p_decision,''),a.employer_decision),'reason',case when p_decision='reject' then btrim(p_reason) else a.employer_reason end);
end $$;


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



-- CREATE OR REPLACE must preserve the live view's existing column order.
-- Older installations have no governorate column; append it rather than
-- inserting it ahead of shift. Fresh canonical schemas already have it fifth.
do $upgrade_view$
begin
 if exists(select 1 from information_schema.columns where table_schema='brc' and table_name='public_jobs' and column_name='governorate' and ordinal_position=5) then
 execute $view$
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
$view$;
 else
 execute $view$
create or replace view brc.public_jobs
with (security_invoker = false) as
  select code, title, category, region, shift, salary_min, salary_max, gender,
         vacancies, requirements, status,
         (status = 'reserved') as is_reserved,
         hold_expires_at,
         created_at,
         -- الوصف والصورة جزء من الإعلان نفسه فيظهران للزائر (بخلاف اسم صاحب
         -- العمل وهاتفه ومكان المقابلة التي تبقى محجوبة للداخل). بدون هذين
         -- العمودين تظهر بطاقات الوظائف في الموقع العام بلا وصف ولا صورة.
         coalesce(description, '') as description,
         coalesce(image_url, '') as image_url,
         case when j.manual_closed then 0 else greatest(j.vacancies-cardinality(j.filled_vacancy_numbers)-(select count(*)::int from brc.job_attempts a where a.job_id=j.id and a.slot_status in('reserved','critical','hiring')),0) end as available_vacancies,
         governorate
    from brc.jobs j
   where status <> 'closed' or created_at > now() - interval '120 days';
$view$;
 end if;
end $upgrade_view$;
