-- بوابة أمان بطاقة التوظيف: قابلة لإعادة التنفيذ ولا تمس البيانات.
alter table brc.applicants add column if not exists employer_access_code text;
update brc.applicants set employer_access_code=upper(substr(md5(random()::text||serial),1,8)) where employer_access_code is null;
create table if not exists brc.card_security_attempts(key text primary key, failed_count integer not null default 0, window_started_at timestamptz not null default now(), locked_until timestamptz, request_count integer not null default 0, request_window_started_at timestamptz not null default now());
create or replace function brc.normalize_card_code(p_code text) returns text language sql immutable as $$ select upper(regexp_replace(btrim(coalesce(p_code,'')),'[^A-Za-z0-9]','','g')) $$;
create or replace function brc.card_gate(p_serial text,p_code text,p_operation text,p_allow_blank boolean default false) returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare f record;x record;k text;c text;n timestamptz:=clock_timestamp();bad integer;
begin
 select * into f from brc.applicants where serial=upper(btrim(coalesce(p_serial,''))) for update;
 if f.serial is null then return jsonb_build_object('ok',false,'error','لا توجد بطاقة بهذا الباركود'); end if;
 k:=f.serial||':'||coalesce(p_operation,'card');c:=brc.normalize_card_code(p_code);
 insert into brc.card_security_attempts(key) values(k) on conflict(key) do nothing; select * into x from brc.card_security_attempts where key=k for update;
 if x.locked_until>n then return jsonb_build_object('ok',false,'error','تم إيقاف المحاولات مؤقتاً لمدة 10 دقائق بسبب تكرار الرمز الخاطئ'); end if;
 if x.request_window_started_at<n-interval '1 minute' then update brc.card_security_attempts set request_count=0,request_window_started_at=n where key=k;x.request_count:=0;end if;
 if x.request_count>=60 then return jsonb_build_object('ok',false,'error','تجاوزت حد الطلبات، حاول بعد دقيقة');end if;
 update brc.card_security_attempts set request_count=request_count+1 where key=k;
 if f.status='blank' and p_allow_blank then return jsonb_build_object('ok',true,'blank',true,'serial',f.serial);end if;
 if p_operation='employer' then
  if c='' then return jsonb_build_object('ok',false,'error','رمز صاحب العمل مطلوب'); end if;
  if c <> upper(coalesce(f.employer_access_code,'')) then
    update brc.card_security_attempts set failed_count=failed_count+1, locked_until=case when failed_count+1>=8 then n+interval '10 minutes' else locked_until end where key=k;
    return jsonb_build_object('ok',false,'error','رمز صاحب العمل غير صحيح');
  end if;
  update brc.card_security_attempts set failed_count=0,locked_until=null where key=k;
  return jsonb_build_object('ok',true,'serial',f.serial);
end if;

if c='' then return jsonb_build_object('ok',false,'error','اكتب رمز البطاقة المطبوع (٤ أرقام + حرفين)');end if;
 if c !~ '^[0-9]{4}[A-Z]{2}$' or not exists(select 1 from brc.job_attempts a where a.serial=f.serial and brc.normalize_card_code(a.chance_code)=c) then
  bad:=case when x.window_started_at<n-interval '10 minutes' then 1 else x.failed_count+1 end;
  update brc.card_security_attempts set failed_count=bad,window_started_at=case when x.window_started_at<n-interval '10 minutes' then n else window_started_at end,locked_until=case when bad>=8 then n+interval '10 minutes' else locked_until end where key=k;
  return jsonb_build_object('ok',false,'error',case when bad>=8 then 'تم إيقاف المحاولات مؤقتاً لمدة 10 دقائق بسبب تكرار الرمز الخاطئ' else 'رمز البطاقة غير صحيح' end);
 end if;
 update brc.card_security_attempts set failed_count=0,locked_until=null where key=k;return jsonb_build_object('ok',true,'serial',f.serial);
end $$;
alter function brc.self_service_card(text) rename to self_service_card_original;
alter function brc.apply_with_card(text,text,jsonb) rename to apply_with_card_original;
alter function brc.employer_decide(text,text) rename to employer_decide_original;
create or replace function brc.self_service_card(p_serial text,p_code text default null) returns jsonb language plpgsql security definer set search_path=brc,public as $$ declare g jsonb;begin g:=brc.card_gate(p_serial,p_code,'self_service',true);if not coalesce((g->>'ok')::boolean,false) then return g;end if;if coalesce((g->>'blank')::boolean,false) then return jsonb_build_object('ok',true,'card',jsonb_build_object('serial',g->>'serial','status','blank','chancesLeft',2,'profile','{}'::jsonb,'chances',jsonb_build_array(jsonb_build_object('no',1,'slotStatus','empty'),jsonb_build_object('no',2,'slotStatus','empty'))));end if;return brc.self_service_card_original(p_serial);end $$;
create or replace function brc.apply_with_card(p_serial text,p_code text,p_job_code text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=brc,public as $$ declare g jsonb;begin g:=brc.card_gate(p_serial,p_code,'apply',true);if not coalesce((g->>'ok')::boolean,false) then return g;end if;return brc.apply_with_card_original(p_serial,p_job_code,p_data);end $$;
create or replace function brc.employer_decide(p_serial text,p_code text,p_decision text) returns jsonb language plpgsql security definer set search_path=brc,public as $$ declare g jsonb;begin g:=brc.card_gate(p_serial,p_code,'employer',false);if not coalesce((g->>'ok')::boolean,false) then return g;end if;return brc.employer_decide_original(p_serial,p_decision);end $$;
create or replace function brc.apply_with_card(p_serial text,p_job_code text,p_data jsonb) returns jsonb language sql security definer set search_path=brc,public as $$ select jsonb_build_object('ok',false,'error','الطلب ناقص: اكتب رمز البطاقة أولاً') $$;
create or replace function brc.employer_decide(p_serial text,p_decision text) returns jsonb language sql security definer set search_path=brc,public as $$ select jsonb_build_object('ok',false,'error','الطلب ناقص: رمز البطاقة مطلوب لاتخاذ القرار') $$;
revoke all on function brc.self_service_card_original(text),brc.apply_with_card_original(text,text,jsonb),brc.employer_decide_original(text,text) from public;
grant execute on function brc.self_service_card(text,text),brc.apply_with_card(text,text,text,jsonb),brc.employer_decide(text,text,text),brc.apply_with_card(text,text,jsonb),brc.employer_decide(text,text) to anon,authenticated;
