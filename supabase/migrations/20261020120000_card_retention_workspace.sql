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
--
-- ⚠️ عطل حقيقي أُصلح 2026-11-17 — وهذا أصل عطل المالك «لا صلاحية كافية».
--
--    هنا `select *` (بلا عمود card_number)، بينما 20261105120000 يعرّف
--    الـview نفسه **بعدّه** card_number. و`create or replace view` لا
--    يستطيع حذف عمود قائم:
--        ERROR: cannot change name of view column "card_number" to
--               "employer_access_code"   /   cannot drop columns from view
--
--    فيتوقف التشغيل عند هذا الملف، وكل ترحيلٍ بعده لا يُطبَّق أبداً.
--
--    الإصلاح: drop ثم create. الـview ليس جدولاً فلا بيانات تُفقد،
--    والمنح تُعاد في الأسطر التالية أصلاً. والترتيب: المعتمدون أولاً.
drop view if exists brc.working_jobs;
drop view if exists brc.working_job_attempts;
drop view if exists brc.working_applicants;
create view brc.working_applicants with(security_invoker=true) as
 select * from brc.applicants where archived_at is null;
create view brc.working_job_attempts with(security_invoker=true) as
 select t.* from brc.job_attempts t join brc.working_applicants a on a.serial=t.serial;
create view brc.working_jobs with(security_invoker=true) as
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
 when a.expiry_date is null or a.expiry_date<now() then 'expired'
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
