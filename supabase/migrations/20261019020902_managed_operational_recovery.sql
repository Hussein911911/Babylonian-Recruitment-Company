-- Operational recovery, NOT browser snapshots / Auth rollback / full project DR.
-- Private key, ciphertext and tickets are never selectable by API roles.
create table if not exists brc.recovery_control (
 singleton boolean primary key default true check(singleton),
 secret text not null, cutoff bigint not null default 0
);
insert into brc.recovery_control(singleton,secret)
values(true,encode(extensions.gen_random_bytes(32),'hex')) on conflict do nothing;
create table if not exists brc.recovery_copies (
 id uuid primary key default gen_random_uuid(), name text not null,
 created_at timestamptz not null default clock_timestamp(), actor uuid,
 safety boolean not null default false, counts jsonb not null,
 schema_hash text not null, data_hash text not null, ciphertext bytea not null
);
create table if not exists brc.recovery_tickets (
 token_hash text primary key, actor uuid not null, copy_id uuid not null references brc.recovery_copies(id),
 live_hash text not null, expires_at timestamptz not null, used boolean not null default false
);
alter table brc.recovery_control enable row level security;
alter table brc.recovery_copies enable row level security;
alter table brc.recovery_tickets enable row level security;
revoke all on brc.recovery_control,brc.recovery_copies,brc.recovery_tickets from public,anon,authenticated;

create or replace function brc.recovery_schema_hash() returns text
language sql stable security definer set search_path=brc,public as $$
 select encode(extensions.digest(coalesce(string_agg(table_name||':'||column_name||':'||udt_schema||'.'||udt_name,',' order by table_name,ordinal_position),''),'sha256'),'hex')
 from information_schema.columns where table_schema='brc' and table_name in ('applicants','jobs','job_attempts','settings','employer_job_credentials')
$$;
create or replace function brc.recovery_capture() returns jsonb
language sql volatile security definer set search_path=brc,public as $$
 select jsonb_build_object('format',1,'schema',brc.recovery_schema_hash(),
 'applicants',coalesce((select jsonb_agg(to_jsonb(a) order by serial) from brc.applicants a),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by id) from brc.jobs j),'[]'::jsonb),
 'job_attempts',coalesce((select jsonb_agg(to_jsonb(t) order by serial,attempt_no) from brc.job_attempts t),'[]'::jsonb),
 'settings',coalesce((select jsonb_agg(to_jsonb(s) order by key) from brc.settings s where key='rules'),'[]'::jsonb),
 'employer_job_credentials',coalesce((select jsonb_agg(to_jsonb(c) order by job_id) from brc.employer_job_credentials c),'[]'::jsonb))
$$;
create or replace function brc.recovery_counts(p jsonb) returns jsonb
language sql immutable set search_path=brc,public as $$
 select jsonb_build_object('jobs',jsonb_array_length(p->'jobs'),'applicants',jsonb_array_length(p->'applicants'),'attempts',jsonb_array_length(p->'job_attempts'))
$$;
create or replace function brc.recovery_save(p_name text,p_safety boolean) returns uuid
language plpgsql security definer set search_path=brc,public as $$
declare p jsonb; k text; result uuid;
begin
 if (select count(*) from brc.recovery_copies)>=100 then raise exception 'بلغ عدد النسخ 100؛ يلزم إدارة الاحتفاظ قبل إنشاء نسخة جديدة';end if;
 p:=brc.recovery_capture();select secret into strict k from brc.recovery_control where singleton;
 insert into brc.recovery_copies(name,actor,safety,counts,schema_hash,data_hash,ciphertext)
 values(left(coalesce(nullif(btrim(p_name),''),'نسخة بيانات الموقع'),100),auth.uid(),p_safety,brc.recovery_counts(p),p->>'schema',encode(extensions.digest(p::text,'sha256'),'hex'),extensions.pgp_sym_encrypt(p::text,k,'cipher-algo=aes256,compress-algo=1')) returning id into result;
 return result;
end $$;
create or replace function brc.recovery_read(p_id uuid) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare r brc.recovery_copies; p jsonb; k text;
begin
 select * into strict r from brc.recovery_copies where id=p_id;
 select secret into strict k from brc.recovery_control where singleton;
 p:=extensions.pgp_sym_decrypt(r.ciphertext,k)::jsonb;
 if p->>'format'<>'1' or p->>'schema'<>brc.recovery_schema_hash() or r.schema_hash<>p->>'schema' or encode(extensions.digest(p::text,'sha256'),'hex')<>r.data_hash then raise exception 'نسخة تالفة أو غير متوافقة مع إصدار القاعدة الحالي';end if;
 return p;
end $$;
-- Monotonic usage/identifier history survives deletion of operational records.
create table if not exists brc.recovery_chances (
 serial text not null, attempt_no smallint not null, spent boolean not null,
 code_hash text not null, primary key(serial,attempt_no)
);
create table if not exists brc.recovery_prints (
 serial text primary key, printed boolean not null, code_hash text
);
alter table brc.recovery_chances enable row level security;
alter table brc.recovery_prints enable row level security;
revoke all on brc.recovery_chances,brc.recovery_prints from public,anon,authenticated;
insert into brc.recovery_chances(serial,attempt_no,spent,code_hash)
 select serial,attempt_no,slot_status<>'empty',encode(extensions.digest(coalesce(chance_code,''),'sha256'),'hex') from brc.job_attempts
 on conflict(serial,attempt_no) do update set spent=brc.recovery_chances.spent or excluded.spent;
insert into brc.recovery_prints(serial,printed,code_hash)
 select serial,coalesce((to_jsonb(a)->>'printed_count')::int,0)>0 or to_jsonb(a)->>'card_print_code' is not null,case when to_jsonb(a)->>'card_print_code' is not null then encode(extensions.digest(to_jsonb(a)->>'card_print_code','sha256'),'hex') end from brc.applicants a on conflict do nothing;
create or replace function brc.recovery_remember() returns trigger
language plpgsql security definer set search_path=brc,public as $$
declare p jsonb;
begin
 if TG_OP='DELETE' then p:=to_jsonb(old);else p:=to_jsonb(new);end if;
 if TG_TABLE_NAME='job_attempts' then
  insert into brc.recovery_chances(serial,attempt_no,spent,code_hash)
  values(p->>'serial',(p->>'attempt_no')::smallint,p->>'slot_status'<>'empty',encode(extensions.digest(coalesce(p->>'chance_code',''),'sha256'),'hex'))
  on conflict(serial,attempt_no) do update set spent=brc.recovery_chances.spent or excluded.spent,code_hash=excluded.code_hash;
 else
  insert into brc.recovery_prints(serial,printed,code_hash)
  values(p->>'serial',coalesce((p->>'printed_count')::int,0)>0 or p->>'card_print_code' is not null,case when p->>'card_print_code' is not null then encode(extensions.digest(p->>'card_print_code','sha256'),'hex') end)
  on conflict(serial) do update set printed=brc.recovery_prints.printed or excluded.printed,code_hash=coalesce(excluded.code_hash,brc.recovery_prints.code_hash);
 end if;
 return null;
end $$;
drop trigger if exists recovery_remember_chances on brc.job_attempts;
create trigger recovery_remember_chances after insert or update or delete on brc.job_attempts for each row execute function brc.recovery_remember();
drop trigger if exists recovery_remember_prints on brc.applicants;
create trigger recovery_remember_prints after insert or update or delete on brc.applicants for each row execute function brc.recovery_remember();
revoke all on function brc.recovery_remember() from public,anon,authenticated;

create or replace function brc.recovery_risks(p jsonb) returns jsonb
language sql volatile security definer set search_path=brc,public as $$
 select jsonb_build_object(
 'newJobs',(select count(*) from brc.jobs j where not exists(select 1 from jsonb_array_elements(p->'jobs') x where x->>'id'=j.id::text)),
 'missingJobs',(select count(*) from jsonb_array_elements(p->'jobs') x where not exists(select 1 from brc.jobs j where j.id::text=x->>'id')),
 'changedJobs',(select count(*) from brc.jobs j join jsonb_array_elements(p->'jobs') x on x->>'id'=j.id::text where to_jsonb(j)<>x),
 'newCards',(select count(*) from brc.applicants a where not exists(select 1 from jsonb_array_elements(p->'applicants') x where x->>'serial'=a.serial)),
 'changedCards',(select count(*) from brc.applicants a join jsonb_array_elements(p->'applicants') x on x->>'serial'=a.serial where to_jsonb(a)<>x),
 'changedAttempts',(select count(*) from brc.job_attempts t full join jsonb_array_elements(p->'job_attempts') x on x->>'serial'=t.serial and (x->>'attempt_no')::int=t.attempt_no where to_jsonb(t) is distinct from x),
 -- Refuse (never auto-replenish) any spent slot that would vanish or turn empty.
 'spentChanceConflicts',(select count(*) from brc.recovery_chances h where h.spent and exists(select 1 from jsonb_array_elements(p->'applicants') a where a->>'serial'=h.serial) and not exists(select 1 from jsonb_array_elements(p->'job_attempts') x where x->>'serial'=h.serial and (x->>'attempt_no')::int=h.attempt_no and x->>'slot_status'<>'empty')),
 'printedCodeConflicts',(
  (select count(*) from brc.recovery_chances h where exists(select 1 from jsonb_array_elements(p->'applicants') a where a->>'serial'=h.serial) and h.code_hash is distinct from (select encode(extensions.digest(coalesce(x->>'chance_code',''),'sha256'),'hex') from jsonb_array_elements(p->'job_attempts') x where x->>'serial'=h.serial and (x->>'attempt_no')::int=h.attempt_no))+
  (select count(*) from brc.recovery_prints h join brc.applicants a on a.serial=h.serial where h.printed and not exists(select 1 from jsonb_array_elements(p->'applicants') x where x->>'serial'=h.serial))+
  (select count(*) from brc.recovery_prints h join jsonb_array_elements(p->'applicants') x on x->>'serial'=h.serial where h.code_hash is not null and h.code_hash is distinct from case when x->>'card_print_code' is not null then encode(extensions.digest(x->>'card_print_code','sha256'),'hex') end)))
$$;
-- Old staff sessions must never write their pre-restore cached snapshots back.
create or replace function brc.recovery_write_fence() returns trigger
language plpgsql security definer set search_path=brc,public as $$
declare c bigint;
begin
 if current_setting('brc.recovery_running',true)='yes' then return null;end if;
 select cutoff into c from brc.recovery_control where singleton;
 if c>0 and auth.uid() is not null and (coalesce((auth.jwt()->>'iat')::bigint,0)<=c or not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=auth.uid())) then
  raise exception 'تم استرجاع نسخة؛ أعد تسجيل الدخول قبل تعديل البيانات' using errcode='42501';
 end if;
 return null;
end $$;
do $$declare t text;begin
 foreach t in array array['applicants','jobs','job_attempts','settings','employer_job_credentials'] loop
 execute format('drop trigger if exists recovery_write_fence on brc.%I',t);
 execute format('create trigger recovery_write_fence before insert or update or delete on brc.%I for each statement execute function brc.recovery_write_fence()',t);
 end loop;
end $$;

create or replace function brc.recovery_manage(p_action text,p_id uuid default null,p_name text default '',p_token text default '') returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare actor uuid:=auth.uid(); cutoff_value bigint; r record; p jsonb; live jsonb; risks jsonb; token text; result_id uuid; safety_id uuid; item jsonb; t text; creds jsonb; trigger_states jsonb; tr record;
begin
 if actor is null or not brc.is_admin() then raise exception 'النسخ والاسترجاع للمدير الفعال فقط' using errcode='42501';end if;
 if not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=actor) then raise exception 'يلزم تسجيل دخول رسمي جديد؛ الجلسة غير فعالة' using errcode='42501';end if;
 select cutoff into cutoff_value from brc.recovery_control where singleton;
 if cutoff_value>0 and coalesce((auth.jwt()->>'iat')::bigint,0)<=cutoff_value then raise exception 'أعد تسجيل الدخول بعد الاسترجاع' using errcode='42501';end if;
 if p_action='list' then
  return jsonb_build_object('ok',true,'scope','operational-data-v1','storage','same-project-encrypted','driveConnected',false,'copies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'createdAt',created_at,'safety',safety,'counts',counts) order by created_at desc) from brc.recovery_copies),'[]'::jsonb));
 end if;
 if p_action not in ('create','preview','restore','remove') or p_action is null then raise exception 'إجراء غير مدعوم';end if;
 perform set_config('lock_timeout','8s',true);
 -- Serialize backup/restore metadata; table locks coordinate ALL current writers,
 -- including public business RPCs, not only this management endpoint.
 perform pg_advisory_xact_lock(8310192026);
 if p_action='restore' then
  lock table brc.applicants,brc.jobs,brc.job_attempts,brc.settings,brc.employer_job_credentials in access exclusive mode;
  lock table brc.staff in share mode;
 else
  lock table brc.applicants,brc.jobs,brc.job_attempts,brc.settings,brc.employer_job_credentials in share mode;
 end if;
 if not brc.is_admin() then raise exception 'تغيرت صلاحية الحساب أثناء الانتظار' using errcode='42501';end if;
 if p_action='remove' then
  if (select count(*) from brc.recovery_copies)<=1 then raise exception 'لا يمكن حذف آخر نسخة محفوظة';end if;
  if not exists(select 1 from brc.recovery_copies where id=p_id) then raise exception 'النسخة غير موجودة';end if;
  delete from brc.recovery_tickets where copy_id=p_id;
  delete from brc.recovery_copies where id=p_id;
  insert into brc.audit_log(username,role,action,entity,entity_id,details) select username,role,'حذف نسخة محفوظة','backup',p_id::text,'لم تتغير بيانات التشغيل' from brc.staff where auth_id=actor;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='create' then
  result_id:=brc.recovery_save(p_name,false);
  insert into brc.audit_log(username,role,action,entity,entity_id,details) select username,role,'إنشاء نسخة تشغيل مشفرة','backup',result_id::text,'نسخة من القاعدة الفعلية، لا من المتصفح' from brc.staff where auth_id=actor;
  return jsonb_build_object('ok',true,'id',result_id);
 end if;
 p:=brc.recovery_read(p_id); live:=brc.recovery_capture(); risks:=brc.recovery_risks(p);
 if p_action='preview' then
  token:=encode(extensions.gen_random_bytes(32),'hex');
  delete from brc.recovery_tickets where expires_at<clock_timestamp();
  insert into brc.recovery_tickets(token_hash,actor,copy_id,live_hash,expires_at) values(encode(extensions.digest(token,'sha256'),'hex'),actor,p_id,encode(extensions.digest(live::text,'sha256'),'hex'),clock_timestamp()+interval '5 minutes');
  return jsonb_build_object('ok',true,'token',token,'expiresIn',300,'current',brc.recovery_counts(live),'target',brc.recovery_counts(p),'risks',risks,'canRestore',(risks->>'spentChanceConflicts')::int=0 and (risks->>'printedCodeConflicts')::int=0);
 end if;
 -- Recent official login plus a one-use, actor/copy/live-state-bound ticket.
 if coalesce((auth.jwt()->>'iat')::bigint,0)<extract(epoch from clock_timestamp())::bigint-900 then raise exception 'الاسترجاع يحتاج تسجيل دخول حديث خلال 15 دقيقة';end if;
 select * into r from brc.recovery_tickets where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if not found or r.actor<>actor or r.copy_id<>p_id or r.used or r.expires_at<=clock_timestamp() then raise exception 'انتهت المعاينة أو رمز التأكيد غير صالح';end if;
 if r.live_hash<>encode(extensions.digest(live::text,'sha256'),'hex') then raise exception 'تغيرت البيانات بعد المعاينة؛ أعد المعاينة قبل الاسترجاع';end if;
 if (risks->>'spentChanceConflicts')::int>0 or (risks->>'printedCodeConflicts')::int>0 then raise exception 'النسخة تتعارض مع فرص مستهلكة أو رموز مطبوعة؛ يلزم معالجة مستقلة ولا استرجاع تلقائي';end if;
 -- Must succeed BEFORE any destructive write, in the same atomic transaction.
 safety_id:=brc.recovery_save('نسخة أمان قبل الاسترجاع',true);
 -- Preserve current PIN changes for jobs that still exist; restore missing job
 -- credentials from the backup. Never resurrect old employer sessions.
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into creds from brc.employer_job_credentials c;
 select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',g.tgname,'state',g.tgenabled)),'[]'::jsonb) into trigger_states from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='brc' and c.relname in ('applicants','jobs','job_attempts','settings','employer_job_credentials') and not g.tgisinternal;
 perform set_config('brc.recovery_running','yes',true);
 foreach t in array array['applicants','jobs','job_attempts','settings','employer_job_credentials'] loop
  execute format('alter table brc.%I disable trigger user',t);
 end loop;
 alter table brc.applicants enable trigger recovery_remember_prints;
 alter table brc.job_attempts enable trigger recovery_remember_chances;
 delete from brc.employer_otp;
 delete from brc.employer_job_credentials;
 delete from brc.job_attempts;
 delete from brc.jobs;
 delete from brc.applicants;
 -- Missing staff links become NULL; staff/Auth/accounts are NEVER rolled back.
 foreach t in array array['applicants','jobs','job_attempts'] loop
  for item in select value from jsonb_array_elements(p->t) loop
   if item ? 'created_by' and not exists(select 1 from brc.staff where id::text=item->>'created_by') then item:=jsonb_set(item,'{created_by}','null');end if;
   if item ? 'staff_id' and not exists(select 1 from brc.staff where id::text=item->>'staff_id') then item:=jsonb_set(item,'{staff_id}','null');end if;
   execute format('insert into brc.%I select * from jsonb_populate_record(null::brc.%I,$1)',t,t) using item;
  end loop;
 end loop;
 delete from brc.settings where key='rules';
 for item in select value from jsonb_array_elements(p->'settings') loop
  if item ? 'updated_by' and not exists(select 1 from brc.staff where id::text=item->>'updated_by') then item:=jsonb_set(item,'{updated_by}','null');end if;
  insert into brc.settings select * from jsonb_populate_record(null::brc.settings,item);
 end loop;
 for item in select value from jsonb_array_elements(p->'jobs') loop
  select value into live from jsonb_array_elements(creds) where value->>'job_id'=item->>'id';
  if live is null then select value into live from jsonb_array_elements(p->'employer_job_credentials') where value->>'job_id'=item->>'id';end if;
  if live is not null then insert into brc.employer_job_credentials select * from jsonb_populate_record(null::brc.employer_job_credentials,live);end if;
 end loop;
 if exists(select 1 from information_schema.columns where table_schema='brc' and table_name='jobs' and column_name='employer_pin_set') then
  execute 'update brc.jobs j set employer_pin_set=exists(select 1 from brc.employer_job_credentials c where c.job_id=j.id)';
 end if;
 -- Issued serial history is append-only, not rolled back/reused after restore.
 insert into brc.issued_serials(serial) select serial from brc.applicants on conflict do nothing;
 for tr in select value as v from jsonb_array_elements(trigger_states) loop
  execute format('alter table brc.%I %s trigger %I',tr.v->>'table',case tr.v->>'state' when 'D' then 'disable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,tr.v->>'name');
 end loop;
 -- Keep audit history and office receipts. End staff refresh sessions and fence
 -- still-valid access JWTs so stale clients cannot undo the restored database.
 update brc.recovery_control set cutoff=floor(extract(epoch from clock_timestamp()))::bigint where singleton;
 if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id in (select auth_id::text from brc.staff where auth_id is not null)';end if;
 delete from auth.sessions where user_id in (select auth_id from brc.staff where auth_id is not null);
 update brc.recovery_tickets set used=true where token_hash=r.token_hash;
 insert into brc.audit_log(username,role,action,entity,entity_id,details) select username,role,'استرجاع بيانات الموقع','backup',p_id::text,'نسخة الأمان: '||safety_id::text||'؛ انتهت الجلسات القديمة، ولم تُرجع فرصة مستهلكة' from brc.staff where auth_id=actor;
 perform set_config('brc.recovery_running','no',true);
 return jsonb_build_object('ok',true,'safetyId',safety_id,'requiresLogin',true);
end $$;
revoke all on function brc.recovery_schema_hash(),brc.recovery_capture(),brc.recovery_counts(jsonb),brc.recovery_save(text,boolean),brc.recovery_read(uuid),brc.recovery_risks(jsonb),brc.recovery_write_fence(),brc.recovery_manage(text,uuid,text,text) from public,anon,authenticated;
grant execute on function brc.recovery_manage(text,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
