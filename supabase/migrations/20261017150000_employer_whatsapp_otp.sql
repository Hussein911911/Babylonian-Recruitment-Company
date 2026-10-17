-- OTP and employer sessions are service-only. Never expose these tables/RPCs to the browser.
create table if not exists brc.employer_otp (
 id uuid primary key, attempt_id uuid not null references brc.job_attempts(id) on delete cascade,
 phone text not null, ip_hash text not null, code_hash text not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '5 minutes',
 delivered boolean not null default false, failures int not null default 0,
 used boolean not null default false, session_hash text, session_expires_at timestamptz
);
alter table brc.employer_otp enable row level security;
revoke all on brc.employer_otp from public,anon,authenticated;
create index if not exists employer_otp_phone_time on brc.employer_otp(phone,created_at);
create index if not exists employer_otp_ip_time on brc.employer_otp(ip_hash,created_at);
create unique index if not exists employer_otp_session on brc.employer_otp(session_hash) where session_hash is not null;

create or replace function brc.employer_otp_issue(p_id uuid,p_serial text,p_job text,p_hash text,p_ip text)
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare a record; destination text;
begin
 perform pg_advisory_xact_lock(17150000);
 select x.id,j.employer_phone into a from brc.job_attempts x join brc.jobs j on j.id=x.job_id
 where x.serial=upper(btrim(p_serial)) and j.code=upper(btrim(p_job))
 and x.slot_status in ('reserved','critical','hiring') order by x.attempt_no desc limit 1;
 if a.id is null then return jsonb_build_object('ok',false); end if;
 destination:=regexp_replace(coalesce(a.employer_phone,''),'[^0-9]','','g');
 if destination like '00964%' then destination:=substr(destination,3);
 elsif destination like '07%' then destination:='964'||substr(destination,2); end if;
 if destination !~ '^9647[3-9][0-9]{8}$' or p_hash !~ '^[a-f0-9]{64}$' or p_ip !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false); end if;
 if exists(select 1 from brc.employer_otp where attempt_id=a.id and created_at>now()-interval '60 seconds')
 or (select count(*) from brc.employer_otp where phone=destination and created_at>now()-interval '1 hour')>=3
 or (select count(*) from brc.employer_otp where phone=destination and created_at>now()-interval '1 day')>=10
 or (select count(*) from brc.employer_otp where ip_hash=p_ip and created_at>now()-interval '1 hour')>=10
 or (select count(*) from brc.employer_otp where created_at>now()-interval '1 day')>=200 then
 return jsonb_build_object('ok',false,'code','rate_limit'); end if;
 -- Supersede unverified codes only. A requester cannot revoke a verified owner session.
 update brc.employer_otp set used=true where attempt_id=a.id and session_hash is null;
 insert into brc.employer_otp(id,attempt_id,phone,ip_hash,code_hash) values(p_id,a.id,destination,p_ip,p_hash);
 -- Bounded retention: OTP material and sessions are short-lived, not an audit trail.
 delete from brc.employer_otp where created_at<now()-interval '2 days';
 return jsonb_build_object('ok',true,'phone',destination);
end $$;

create or replace function brc.employer_otp_delivery(p_id uuid,p_success boolean)
returns void language sql security definer set search_path=brc,public as $$
 update brc.employer_otp set delivered=p_success,used=not p_success where id=p_id and not used;
$$;

create or replace function brc.employer_otp_verify(p_id uuid,p_hash text,p_session text)
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare c record;
begin
 select * into c from brc.employer_otp where id=p_id for update;
 if c.id is null or c.used or not c.delivered or c.expires_at<=now() or c.failures>=5 then return jsonb_build_object('ok',false); end if;
 if c.code_hash<>p_hash then
 update brc.employer_otp set failures=failures+1 where id=p_id;
 return jsonb_build_object('ok',false);
 end if;
 if p_session !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false); end if;
 update brc.employer_otp set used=true,session_hash=p_session,session_expires_at=now()+interval '20 minutes',code_hash=repeat('0',64) where id=p_id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function brc.employer_otp_action(p_session text,p_decision text default '',p_reason text default '')
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare c record; a record; j record; f record; phone_now text;
begin
 select * into c from brc.employer_otp where session_hash=p_session and session_expires_at>now() for update;
 if c.id is null then return jsonb_build_object('ok',false,'code','session_expired'); end if;
 if p_decision='logout' then update brc.employer_otp set session_expires_at=now() where id=c.id;return jsonb_build_object('ok',true);end if;
 -- Lock in the same order as card application (card -> attempt -> job).
 select x.serial into a from brc.job_attempts x where x.id=c.attempt_id;
 select * into f from brc.applicants where serial=a.serial for update;
 select * into a from brc.job_attempts where id=c.attempt_id for update;
 select * into j from brc.jobs where id=a.job_id for update;
 phone_now:=regexp_replace(coalesce(j.employer_phone,''),'[^0-9]','','g');
 if phone_now like '00964%' then phone_now:=substr(phone_now,3); elsif phone_now like '07%' then phone_now:='964'||substr(phone_now,2); end if;
 if j.id is null or phone_now<>c.phone or a.slot_status not in ('reserved','critical','hiring') then return jsonb_build_object('ok',false,'code','session_expired'); end if;
 if coalesce(p_decision,'')<>'' then
 if p_decision not in ('hire','reject') or a.employer_decision is not null or a.slot_status='hiring' then return jsonb_build_object('ok',false,'code','decision_unavailable'); end if;
 if p_decision='reject' and (length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>300) then return jsonb_build_object('ok',false,'code','reason_required'); end if;
 if p_decision='hire' then
 update brc.job_attempts set slot_status='hiring',employer_decision='hire',employer_reason=null,decision_at=now(),hold_expires_at=null,outcome_note='طلب صاحب العمل — بانتظار تثبيت الشركة' where id=a.id;
 update brc.jobs set status='hiring',critical=false,hold_expires_at=null,updated_at=now() where id=j.id;
 else
 update brc.job_attempts set slot_status='critical',employer_decision='reject',employer_reason=btrim(p_reason),decision_at=now(),hold_expires_at=null,outcome_note='رفض صاحب العمل — بانتظار قرار الشركة' where id=a.id;
 update brc.jobs set critical=true,hold_expires_at=null,updated_at=now() where id=j.id;
 end if;
 insert into brc.audit_log(username,role,action,entity,entity_id,details) values('verified-employer','employer','قرار صاحب العمل بعد تحقق واتساب','applicant',f.serial,'الوظيفة '||j.code||' — '||p_decision);
 end if;
 return jsonb_build_object('ok',true,'applicant',jsonb_build_object('name',f.full_name,'phone',f.phone,'address',f.address,'gender',f.gender),
 'job',jsonb_build_object('code',j.code,'title',j.title,'region',j.region),'decision',coalesce(nullif(p_decision,''),a.employer_decision),'reason',case when p_decision='reject' then btrim(p_reason) else a.employer_reason end);
end $$;

-- Close every legacy barcode-only overload, including historical gateway backups.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='brc' and (p.proname like 'employer_view%' or p.proname like 'employer_decide%' or p.proname like 'employer_otp_%') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end $$;

notify pgrst, 'reload schema';
