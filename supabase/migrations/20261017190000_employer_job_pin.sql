-- Fixed employer PINs: private bcrypt credentials, no WhatsApp/provider dependency.
-- pgcrypto must be enabled in the Supabase extensions schema.
alter table brc.jobs add column if not exists employer_pin_set boolean not null default false;
create table if not exists brc.employer_job_credentials (
 job_id uuid primary key references brc.jobs(id) on delete cascade,
 pin_hash text not null, failures integer not null default 0,
 window_start timestamptz not null default now(), changed_at timestamptz not null default now()
);
create table if not exists brc.employer_login_budget (
 id boolean primary key default true check(id), window_start timestamptz not null default now(), requests integer not null default 0
);
alter table brc.employer_job_credentials enable row level security;
alter table brc.employer_login_budget enable row level security;
revoke all on brc.employer_job_credentials,brc.employer_login_budget from public,anon,authenticated;
insert into brc.employer_login_budget(id) values(true) on conflict do nothing;

-- Atomic job save + PIN setup/reset; active staff only, never generic public job data.
create or replace function brc.staff_save_job_pin(p_code text,p_data jsonb,p_pin text default '')
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare j brc.jobs; k text; s record;
begin
 if not coalesce(brc.is_staff(),false) then return jsonb_build_object('ok',false,'error','غير مصرّح'); end if;
 perform pg_advisory_xact_lock(18190000);
 if p_pin is null or (p_pin<>'' and p_pin !~ '^[0-9]{6}$') or length(btrim(coalesce(p_data->>'title','')))<2 then
 return jsonb_build_object('ok',false,'error','تحقق من العنوان والرمز المكوّن من ٦ أرقام'); end if;
 if coalesce(p_code,'')='' then
 if p_pin='' then return jsonb_build_object('ok',false,'error','أدخل الرمز السري لصاحب العمل'); end if;
 k:=brc.next_job_code();
 insert into brc.jobs(code,title,region,employer_name,employer_phone) values(k,p_data->>'title',coalesce(p_data->>'region',''),coalesce(p_data->>'employerName',''),coalesce(p_data->>'employerPhone','')) returning * into j;
 else
 select * into j from brc.jobs where code=p_code for update;
 if j.id is null then return jsonb_build_object('ok',false,'error','الوظيفة غير موجودة'); end if;
 if p_pin='' and not exists(select 1 from brc.employer_job_credentials where job_id=j.id) then
 return jsonb_build_object('ok',false,'error','هذه الوظيفة تحتاج تعيين رمز صاحب العمل لأول مرة'); end if;
 end if;
 update brc.jobs set title=p_data->>'title',category=coalesce(p_data->>'category','خدمات'),region=coalesce(p_data->>'region',''),
 governorate=coalesce(p_data->>'governorate','بابل'),shift=coalesce(p_data->>'shift','صباحي'),
 salary_min=greatest(0,coalesce((p_data->>'salaryMin')::int,0)),salary_max=greatest(0,coalesce((p_data->>'salaryMax')::int,0)),
 gender=coalesce(p_data->>'gender','لا فرق'),vacancies=greatest(1,coalesce((p_data->>'vacancies')::int,1)),
 requirements=array(select jsonb_array_elements_text(coalesce(p_data->'requirements','[]'::jsonb))),
 employer_name=coalesce(p_data->>'employerName',''),employer_phone=coalesce(p_data->>'employerPhone',''),employer_address=coalesce(p_data->>'employerAddress',''),
 interview_location=coalesce(p_data->>'interviewLocation',''),image_url=coalesce(p_data->>'imageUrl',''),updated_at=now() where id=j.id;
 if p_pin<>'' then
 insert into brc.employer_job_credentials(job_id,pin_hash) values(j.id,extensions.crypt(p_pin,extensions.gen_salt('bf',10)))
 on conflict(job_id) do update set pin_hash=excluded.pin_hash,failures=0,window_start=now(),changed_at=now();
 -- Changing the PIN immediately revokes every session for this job, not other jobs.
 delete from brc.employer_otp where attempt_id in(select id from brc.job_attempts where job_id=j.id);
 update brc.jobs set employer_pin_set=true where id=j.id;
 end if;
 select username,role into s from brc.staff where id=brc.current_staff_id();
 insert into brc.audit_log(username,role,action,entity,entity_id,details) values(s.username,s.role,'حفظ وظيفة ورمز صاحب العمل','job',j.code,case when p_pin<>'' then 'تم تعيين/تغيير الرمز السري دون تسجيل قيمته' else 'تحديث بيانات الوظيفة دون تغيير الرمز' end);
 select * into j from brc.jobs where id=j.id;
 return jsonb_build_object('ok',true,'job',to_jsonb(j));
end $$;

create or replace function brc.employer_pin_login(p_serial text,p_job text,p_pin text)
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare j record; c record; a record; token text; b record;
begin
 -- Global budget also counts unknown jobs/cards. No IP header can bypass this limit.
 perform pg_advisory_xact_lock(18190000);
 select * into b from brc.employer_login_budget where id=true for update;
 if b.window_start<=now()-interval '1 hour' then update brc.employer_login_budget set window_start=now(),requests=0 where id=true; b.requests:=0; end if;
 if b.requests>=300 then return jsonb_build_object('ok',false,'code','rate_limit','error','توقفت محاولات الدخول مؤقتاً. حاول لاحقاً أو راجع الشركة.'); end if;
 update brc.employer_login_budget set requests=requests+1 where id=true;
 select * into j from brc.jobs where code=upper(btrim(p_job));
 select * into c from brc.employer_job_credentials where job_id=j.id for update;
 if c.job_id is null then return jsonb_build_object('ok',false,'code','denied','error','تحقق من البطاقة وكود الوظيفة والرمز السري، أو راجع الشركة لتعيين رمز الوظيفة.'); end if;
 if c.window_start<=now()-interval '15 minutes' then update brc.employer_job_credentials set failures=0,window_start=now() where job_id=j.id; c.failures:=0; end if;
 if c.failures>=5 then return jsonb_build_object('ok',false,'code','rate_limit','error','توقف الدخول لهذه الوظيفة مؤقتاً بعد محاولات غير صحيحة. انتظر ١٥ دقيقة أو راجع الشركة.'); end if;
 select * into a from brc.job_attempts where serial=upper(btrim(p_serial)) and job_id=j.id and slot_status in('reserved','critical','hiring') order by attempt_no desc limit 1;
 if p_pin is null or p_pin !~ '^[0-9]{6}$' or a.id is null then
 update brc.employer_job_credentials set failures=failures+1 where job_id=j.id;
 return jsonb_build_object('ok',false,'code','denied','error','بيانات الدخول غير صحيحة أو الوظيفة غير مرتبطة بهذه البطاقة.'); end if;
 if extensions.crypt(p_pin,c.pin_hash)<>c.pin_hash then
 update brc.employer_job_credentials set failures=failures+1 where job_id=j.id;
 return jsonb_build_object('ok',false,'code','denied','error','بيانات الدخول غير صحيحة أو الوظيفة غير مرتبطة بهذه البطاقة.'); end if;
 update brc.employer_job_credentials set failures=0 where job_id=j.id;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into brc.employer_otp(id,attempt_id,phone,ip_hash,code_hash,delivered,used,session_hash,session_expires_at)
 values(gen_random_uuid(),a.id,'pin',repeat('0',64),repeat('0',64),true,true,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '20 minutes');
 delete from brc.employer_otp where created_at<now()-interval '2 days';
 return jsonb_build_object('ok',true,'token',token,'expiresIn',1200);
end $$;

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
 if j.id is null or j.status not in ('reserved','hiring') or a.slot_status not in ('reserved','critical','hiring') then return jsonb_build_object('ok',false,'code','session_expired'); end if;
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
 insert into brc.audit_log(username,role,action,entity,entity_id,details) values('verified-employer','employer','قرار صاحب العمل بعد تحقق الرمز السري','applicant',f.serial,'الوظيفة '||j.code||' — '||p_decision);
 end if;
 return jsonb_build_object('ok',true,'applicant',jsonb_build_object('name',f.full_name,'phone',f.phone,'address',f.address,'gender',f.gender),
 'job',jsonb_build_object('code',j.code,'title',j.title,'region',j.region),'decision',coalesce(nullif(p_decision,''),a.employer_decision),'reason',case when p_decision='reject' then btrim(p_reason) else a.employer_reason end);
end $$;


revoke all on function brc.staff_save_job_pin(text,jsonb,text) from public,anon,authenticated;
grant execute on function brc.staff_save_job_pin(text,jsonb,text) to authenticated;
revoke all on function brc.employer_pin_login(text,text,text),brc.employer_pin_action(text,text,text) from public;
grant execute on function brc.employer_pin_login(text,text,text),brc.employer_pin_action(text,text,text) to anon,authenticated;
-- Disable live/cached WhatsApp gateways at the database boundary as well.
-- The PIN path uses its own RPCs and the shared session table, never these functions.
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='brc' and p.proname like 'employer_otp_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
 end loop;
end $$;
notify pgrst, 'reload schema';
