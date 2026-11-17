-- ═══════════════════════════════════════════════════════════════════════
--  schema — الجزء 04 من 05
--  يفعّل: الجداول · الفهارس · الدوال · المشغّلات · المهام المجدولة · إدخال بيانات · كتل تنفيذية (DO)
--  أسطر: 676 · حجم: 48 ك.ب
--  ---------------------------------------------------------------------
--  ⚠ لا تلصق هذا الجزء قبل تنفيذ الجزء 03 بنجاح.
--  بعد «Success» انتقل إلى الجزء 05.
-- ═══════════════════════════════════════════════════════════════════════


create or replace function brc.office_submit(p_id uuid,p_kind text,p_data jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare actor uuid:=auth.uid(); signature text; receipt record; j record; f record; slot record; result jsonb;
begin
 if actor is null or not brc.is_staff() then return jsonb_build_object('ok',false,'code','unauthorized'); end if;
 if p_id is null or p_kind is null or p_kind not in ('reserve','activate','job_note') or p_data is null or p_expected is null or jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_expected)<>'object' then
 return jsonb_build_object('ok',false,'code','invalid_request'); end if;
 signature:=encode(extensions.digest(convert_to(jsonb_build_array(p_kind,p_data,p_expected)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into receipt from brc.office_receipts where operation_id=p_id;
 if found then
  if receipt.actor<>actor or receipt.request_hash<>signature then return jsonb_build_object('ok',false,'code','operation_mismatch');end if;
  return receipt.result;
 end if;
 begin
  if length(coalesce(p_data->>'serial',''))>80 or length(coalesce(p_data->>'jobCode',''))>80 then raise exception 'invalid_request'; end if;
  -- Match existing public activation lock order: applicant, then job, then slot.
  if p_kind in ('reserve','activate') then
   select * into f from brc.applicants where serial=p_data->>'serial' for update;
   if not found then raise exception 'card_not_found'; end if;
  end if;
  select * into j from brc.jobs where code=p_data->>'jobCode' for update;
  if not found then raise exception 'job_not_found';end if;
  if p_expected->>'job_updated_at' is null or j.updated_at is distinct from (p_expected->>'job_updated_at')::timestamptz then raise exception 'job_conflict';end if;
  if p_kind='job_note' then
   if length(btrim(coalesce(p_data->>'note','')))=0 or length(p_data->>'note')>2000 then raise exception 'invalid_note';end if;
   update brc.jobs set notes=p_data->>'note',updated_at=now() where id=j.id;
   insert into brc.audit_log(username,role,action,entity,entity_id,details)
   select username,role,'تحديث ملاحظة من المكتب','job',j.code,'طلب مكتب متحقق من التعارض' from brc.staff where auth_id=actor and active;
  else
   if j.status<>'available' then raise exception 'job_unavailable';end if;
   if p_kind='activate' then
    if f.status<>'blank' or p_expected->>'app_updated_at' is null or f.updated_at is distinct from (p_expected->>'app_updated_at')::timestamptz then raise exception 'card_conflict';end if;
    result:=brc.activate_card(f.serial,p_data);
   else
    if f.status<>'active' or (f.expiry_date is not null and f.expiry_date<=now()) then raise exception 'card_unavailable';end if;
    select * into slot from brc.job_attempts where serial=f.serial and slot_status='empty' order by attempt_no limit 1 for update;
    if not found or slot.attempt_no is distinct from (p_expected->>'attempt_no')::smallint then raise exception 'chance_conflict';end if;
    result:=brc.select_attempt(f.serial,j.code);
   end if;
   if coalesce((result->>'ok')::boolean,false)=false then raise exception '%',coalesce(result->>'error','operation_rejected');end if;
  end if;
  result:=jsonb_build_object('ok',true,'operationId',p_id,'jobCode',j.code,'serial',p_data->>'serial');
 exception when others then
  -- This subtransaction rolls back all business writes on any rejection.
  result:=jsonb_build_object('ok',false,'code','conflict','message',left(sqlerrm,240));
 end;
 insert into brc.office_receipts(operation_id,actor,request_hash,result) values(p_id,actor,signature,result);
 return result;
end $$;
revoke all on function brc.office_submit(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function brc.office_submit(uuid,text,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';

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
 from information_schema.columns where table_schema='brc' and table_name in ('applicants','jobs','job_attempts','settings')
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
  return jsonb_build_object('ok',true,'scope','operational-data-v1','storage','same-project-encrypted','external','usb-manual','copies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'createdAt',created_at,'safety',safety,'counts',counts) order by created_at desc) from brc.recovery_copies),'[]'::jsonb));
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

-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — جدولة النسخ الاحتياطي يحددها المدير من الإعدادات
--  الأيام 0..6 (0 = الأحد) والوقت بتوقيت بغداد (UTC+3)، وتُترجم لتعبير cron
--  بـUTC داخل brc.recovery_cron_expr. الحفظ في brc.settings → recovery_schedule.
-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-14: نمطان — كل عدد ساعات، أو أيام محدّدة.
--   interval: كل N ساعة (1..24). 24 = مرة يومياً في الساعة المختارة.
--   days:     أيام 0..6 + ساعة (السلوك القديم).
-- التوقيت بتوقيت بغداد (UTC+3) ويُترجم إلى UTC هنا.
/* ═══════════════════════════════════════════════════════════════════════════
   جدولة النسخ — خمسة أنماط يختارها المدير (2026-11-14)
   ---------------------------------------------------------------------------
   لماذا خمستها؟ لأن التصميم الأول كان «أيام + ساعة» فقط، فطلب صاحب العمل
   خياراً دورياً. ثم اتضح أن «كل ٢٤ ساعة» و«كل يوم» ليسا الشيء نفسه في ذهنه:
     • interval / 24  ⇒ تبدأ من ساعة محددة وتتكرر كل يوم  (أوقات ثابتة)
     • daily          ⇒ كل يوم (مرادف عملي، لكن بلا حقل «كل كم»)
     • every_days N   ⇒ كل N يوم — وهذا **لا يمكن** بـcron وحده لأن كرون لا
                        يحفظ عدّاداً. لذلك نُفعّله بجدولة يومية + فحص «هل مضى N
                        يوم؟» في دالة التنفيذ (brc.recovery_due_now).
                        هذا يعني أن الكرون يعمل يومياً لكن النسخة تُؤخذ فقط
                        عند استحقاقها — لا نسخ زائدة.
     • days [..]      ⇒ أيام محدّدة من الأسبوع
   ⚠️ دروس مدفوعة الثمن مسجّلة هنا كي لا تتكرر:
   ١) الصيغة النجمية (نجمة ثم شرطة مائلة ثم N) في cron تعني — بحرفيّتها — «كل مضاعفات N من منتصف الليل UTC» — تتجاهل الساعة
      المختارة. لذلك نستخدم `h/N` («ابدأ من h ثم كل N»). اختبرناه فعلياً.
   ٢) بغداد = UTC+3 دائماً (العراق ألغى التوقيت الصيفي 2007)، فالتحويل بسيط
      وثابت — لا نستخدم جدول مناطق زمنية ولا نعتمد على قاعدة البيانات.
   ═══════════════════════════════════════════════════════════════════════════ */
create or replace function brc.recovery_cron_expr(
  p_mode text, p_hours int, p_days int[], p_time text
) returns text
language plpgsql immutable set search_path = brc, public, pg_temp
as $$
declare
  h int; m int; utc_h int; shift int; d int; dows int[] := '{}'; expr text;
  mode text := coalesce(nullif(btrim(p_mode), ''), 'days');
begin
  /* الدقائق تُؤخذ من الوقت المختار وتبقى ثابتة في كل الأنماط */
  h := split_part(coalesce(p_time, ''), ':', 1)::int;
  m := split_part(coalesce(p_time, ''), ':', 2)::int;

  /* ── النمط الدوري ─────────────────────────────────────────────────────── */
  if mode = 'interval' then
    if p_hours is null or p_hours < 1 or p_hours > 24 then return null; end if;
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    if p_hours = 24 then return m::text || ' ' || utc_h::text || ' * * *'; end if;
    if p_hours = 1  then return m::text || ' * * * *'; end if;
    /* `h/N` = ابدأ من الساعة h ثم كل N ساعة. الصيغة `*​/N` تتجاهل h —
       فيختار المدير ٦ صباحاً فينفَّذ ٣ فجراً بلا أن يعرف. */
    return m::text || ' ' || utc_h::text || '/' || p_hours::text || ' * * *';
  end if;

  /* ── كل يوم ───────────────────────────────────────────────────────────── */
  if mode = 'daily' then
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    return m::text || ' ' || utc_h::text || ' * * *';
  end if;

  /* ── كل N يوم ────────────────────────────────────────────────────────────
     كرون لا يستطيع التعبير عن «كل N يوم» بصدق (لا عدّاد فيه). نُشغّل الفحص
     يومياً، ودالة التنفيذ تسأل brc.recovery_due_now() هل مضى N يوم.
     الساعة هنا مهمة: هي لحظة الفحص اليومي. */
  if mode = 'every_days' then
    if p_hours is null or p_hours < 1 or p_hours > 365 then return null; end if;
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    return m::text || ' ' || utc_h::text || ' * * *';
  end if;

  /* ── الأيام المحددة من الأسبوع ──────────────────────────────────────────── */
  if p_days is null or coalesce(array_length(p_days,1),0) = 0 then return null; end if;
  if coalesce(p_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  utc_h := h - 3;
  shift := 0;
  if utc_h < 0 then utc_h := utc_h + 24; shift := -1; end if;
  foreach d in array p_days loop
    if d is null or d < 0 or d > 6 then return null; end if;
    /* إن نزح الوقت للخلف يوماً في UTC، ينزح اليوم كذلك */
    if shift = 0 then dows := dows || d; else dows := dows || ((d + 6) % 7); end if;
  end loop;
  select string_agg(distinct x::text, ',' order by x::text) into expr from unnest(dows) x;
  return m::text || ' ' || utc_h::text || ' * * ' || expr;
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   brc.recovery_due_now() — هل حان وقت النسخة الآن؟
   ---------------------------------------------------------------------------
   السبب: cron لا يملك عدّاداً، فلا يستطيع التعبير عن «كل ٣ أيام» بصدق.
   الحل الأمين: نُشغّل الفحص **يومياً**، وهذه الدالة تقول «نعم» أو «لا».
   ولا نسخة زائدة ولا نسخة ناقصة.

   ⚠️ الحالة تُقرأ من brc.settings، ولا تُحسب من آخر نسخة في الجدول — لأن
   نسخ الأمان اليدوية تسبّب لبساً: لو اعتمدنا على «آخر نسخة» لتأخّر النمط
   الدوري بسبب نسخة يدوية أخذها المدير بنفسه.

   الأنماط التي لا تحتاج فحصاً (interval / daily / days) ترجع دائماً true —
   لأن cron نفسه يضبط مواعيدها بدقة.
   ═══════════════════════════════════════════════════════════════════════════ */
create or replace function brc.recovery_due_now()
returns boolean
language plpgsql stable security definer set search_path = brc, public, pg_temp
as $$
declare v jsonb; mode text; n int; last_at timestamptz;
begin
  select value into v from brc.settings where key = 'recovery_schedule';
  /* لا جدولة مضبوطة ⇒ لا قيد «كل N يوم» ⇒ لا نمنع شيئاً.
     كان `return false` هنا، وهو خطأ: يمنع كل نسخة إن غاب الإعداد — مثلاً
     بعد استرجاع قاعدة قديمة أو قبل ضبط الجدولة أول مرة. */
  if v is null then return true; end if;
  mode := coalesce(v->>'mode', 'days');
  if mode <> 'every_days' then return true; end if;

  n := coalesce((v->>'hours')::int, 0);
  if n < 1 then return false; end if;

  /* آخر نسخة **مجدولة** فقط — لا نسخ الأمان اليدوية */
  select (value #>> '{}')::timestamptz into last_at
    from brc.settings where key = 'recovery_last_scheduled_at';
  if last_at is null then return true; end if;  -- أول مرة: نأخذها فوراً
  return now() >= last_at + (n || ' days')::interval;
end $$;

/* التواقيع القديمة محفوظة للتوافق — كود أو اختبار قديم يستدعيها */
create or replace function brc.recovery_cron_expr(p_days int[], p_time text)
returns text language sql immutable set search_path = brc, public, pg_temp
as $$ select brc.recovery_cron_expr('days', null, p_days, p_time) $$;

create or replace function brc.recovery_retention_keep()
returns integer language sql stable set search_path = brc, public, pg_temp
as $$
  select least(10, greatest(1, coalesce(
    (select (value->>'keep')::int from brc.settings where key = 'recovery_retention'), 3)));
$$;
revoke all on function brc.recovery_retention_keep() from public, anon, authenticated;

/* تقليم النسخ: آخر N مجدولة — نسخ الأمان (safety=true) لا تُمسّ */
create or replace function brc.recovery_prune(p_keep int)
returns integer language plpgsql security definer set search_path=brc,public as $$
declare v_keep int := coalesce(p_keep, brc.recovery_retention_keep());
        v_deleted int := 0; v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    /* الترتيب المزدوج ضروري: نسخ كثيرة قد تُنشأ في نفس الثانية، وcreated_at
       وحده لا يحدد الأقدم. id مُشتق من البيانات وقت الإدراج فيعطي ترتيباً
       ثابتاً، ومع ذلك نُبقي created_at أولاً كي يبقى المعنى الزمني. */
    select id from brc.recovery_copies where safety = false
     order by created_at desc, id desc offset greatest(1, v_keep)) old;
  if coalesce(array_length(v_ids,1), 0) > 0 then
    delete from brc.recovery_tickets where copy_id = any(v_ids);
    delete from brc.recovery_copies where id = any(v_ids);
    get diagnostics v_deleted = row_count;
  end if;
  return v_deleted;
end $$;
revoke all on function brc.recovery_prune(int) from public, anon, authenticated;

create or replace function brc.recovery_prune() returns integer
language sql security definer set search_path = brc, public, pg_temp
as $$ select brc.recovery_prune(brc.recovery_retention_keep()) $$;

revoke all on function brc.recovery_prune() from public, anon, authenticated;

/* عدد النسخ المحفوظة — قرار صاحب العمل 2026-11-14: آخر ٣ */
do $$ begin
  insert into brc.settings(key, value, updated_at)
  values ('recovery_retention', '{"keep": 3}'::jsonb, now())
  on conflict (key) do nothing;
exception when others then null; end $$;

create or replace function brc.recovery_schedule_get()
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare v jsonb; job record; last_run timestamptz;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'هذه الجدولة للمدير فقط');
  end if;
  select value into v from brc.settings where key='recovery_schedule';
  select jobid, schedule, active into job from cron.job where jobname='recovery-auto-backup';
  select max(start_time) into last_run from cron.job_run_details d where d.jobid = job.jobid and d.status='succeeded';
  return jsonb_build_object(
    'ok', true,
    'mode', coalesce(v->>'mode','days'),
    'hours', coalesce((v->>'hours')::int, 0),
    'days', coalesce(v->'days','[]'::jsonb),
    'time', coalesce(v->>'time','23:00'),
    'keep', brc.recovery_retention_keep(),
    'dueNow', brc.recovery_due_now(),
    'lastScheduled', (select value #>> '{}' from brc.settings where key='recovery_last_scheduled_at'),
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'timezone', 'Asia/Baghdad',
    'cron', job.schedule,
    'active', coalesce(job.active, false),
    'lastRun', last_run,
    'updatedAt', (select updated_at from brc.settings where key='recovery_schedule'));
end $$;

create or replace function brc.recovery_schedule_set(
  p_mode text, p_hours int, p_days int[], p_time text
) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare
  expr text; on_off boolean := true; job_id bigint; clean int[] := '{}';
  v_mode text; v_hours int; v_time text;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'تعديل الجدولة من صلاحيات المدير فقط');
  end if;

  v_mode := coalesce(nullif(btrim(p_mode), ''), 'days');
  if v_mode not in ('interval', 'daily', 'every_days', 'days') then
    return jsonb_build_object('ok', false, 'error', 'نمط جدولة غير معروف');
  end if;
  v_time := coalesce(nullif(btrim(p_time), ''), '23:00');
  v_hours := coalesce(p_hours, 0);

  if v_mode = 'interval' then
    if v_hours < 1 or v_hours > 24 then
      return jsonb_build_object('ok', false, 'error', 'عدد الساعات يجب أن يكون بين ١ و٢٤');
    end if;

  elsif v_mode = 'every_days' then
    if v_hours < 1 or v_hours > 365 then
      return jsonb_build_object('ok', false, 'error', 'عدد الأيام يجب أن يكون بين ١ و٣٦٥');
    end if;

  elsif v_mode = 'daily' then
    v_hours := 1;

  else  -- 'days'
    select coalesce(array_agg(distinct d order by d), '{}') into clean
      from unnest(coalesce(p_days, '{}')) d where d between 0 and 6;
    on_off := coalesce(array_length(clean, 1), 0) > 0;
    v_hours := 0;
    /* لا أيام = إيقاف الجدولة، وهذا سلوك مقصود لا خطأ */
    if not on_off then
      delete from cron.job where jobname = 'recovery-auto-backup';
      insert into brc.settings(key, value, updated_at, updated_by)
      values ('recovery_schedule', jsonb_build_object(
                'mode','days','hours',0,'days','[]'::jsonb,'time',v_time,
                'enabled',false,'timezone','Asia/Baghdad','cron',null,'updatedAt',now()), now(),
              (select id from brc.staff where auth_id = auth.uid()))
      on conflict (key) do update set value = excluded.value, updated_at = now(),
        updated_by = excluded.updated_by;
      return brc.recovery_schedule_get();
    end if;
  end if;

  if v_mode <> 'days' then
    expr := brc.recovery_cron_expr(v_mode, v_hours, null, v_time);
  else
    expr := brc.recovery_cron_expr('days', null, clean, v_time);
  end if;
  if expr is null then
    return jsonb_build_object('ok', false, 'error', 'وقت غير صالح — الصيغة HH:MM (24 ساعة)');
  end if;

  insert into brc.settings(key, value, updated_at, updated_by)
  values ('recovery_schedule', jsonb_build_object(
            'mode', v_mode, 'hours', v_hours,
            'days', to_jsonb(clean), 'time', v_time,
            'enabled', true, 'timezone','Asia/Baghdad',
            'cron', expr, 'updatedAt', now()), now(),
          (select id from brc.staff where auth_id = auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;

  select jobid into job_id from cron.job where jobname='recovery-auto-backup';
  if job_id is null then
    perform cron.schedule('recovery-auto-backup', expr, 'select brc.recovery_run_scheduled();');
  else
    perform cron.alter_job(job_id, schedule := expr, command := 'select brc.recovery_run_scheduled();', active := true);
  end if;

  return brc.recovery_schedule_get();
end $$;

/* التوقيع القديم محفوظ للتوافق */
create or replace function brc.recovery_schedule_set(p_days int[], p_time text)
returns jsonb language sql security definer set search_path = brc, public, pg_temp
as $$ select brc.recovery_schedule_set('days', null, p_days, p_time) $$;

create or replace function brc.recovery_run_scheduled()
returns uuid language plpgsql security definer set search_path=brc,public as $$
declare p jsonb; k text; result uuid;
begin
  /* بوابة الاستحقاق — للنمط «كل N يوم» فقط. غيره يرجع true دائماً.
     بدونها يعمل cron يومياً ويأخذ نسخة كل يوم مهما اختار المدير. */
  if not brc.recovery_due_now() then return null; end if;
  perform set_config('lock_timeout','8s',true);
  perform pg_advisory_xact_lock(8310192026);
  lock table brc.applicants,brc.jobs,brc.job_attempts,brc.settings,brc.employer_job_credentials in share mode;
  p := brc.recovery_capture();
  select secret into strict k from brc.recovery_control where singleton;
  insert into brc.recovery_copies(name,actor,safety,counts,schema_hash,data_hash,ciphertext)
  values ('نسخة مجدولة — ' || to_char(clock_timestamp() at time zone 'Asia/Baghdad','YYYY-MM-DD HH24:MI'),
          null,false,brc.recovery_counts(p),p->>'schema',
          encode(extensions.digest(p::text,'sha256'),'hex'),
          extensions.pgp_sym_encrypt(p::text,k,'cipher-algo=aes256,compress-algo=1'))
  returning id into result;
  if brc.recovery_read(result) is distinct from p then
    raise exception 'فشل التحقق من النسخة المجدولة';
  end if;
  /* 2026-11-14: آخر N نسخة (افتراضياً ٣) بدل حذف كل ما قبلها.
     كان: حذف كل النسخ عدا الجديدة ⇒ نسخة واحدة فقط في القاعدة. */
  /* نسجّل وقت آخر نسخة مجدولة — تعتمد عليه recovery_due_now للنمط «كل N يوم».
     لا نقرأه من جدول النسخ لأن نسخة أمان يدوية قد تُربك الحساب. */
  insert into brc.settings(key, value, updated_at)
  values ('recovery_last_scheduled_at', to_jsonb(now()), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform brc.recovery_prune();
  delete from brc.recovery_tickets where copy_id not in (select id from brc.recovery_copies);
  return result;
end $$;

revoke all on function brc.recovery_cron_expr(int[],text) from public,anon,authenticated;
revoke all on function brc.recovery_cron_expr(text,int,int[],text) from public,anon,authenticated;
revoke all on function brc.recovery_due_now() from public,anon,authenticated,service_role;
revoke all on function brc.recovery_schedule_get() from public,anon,authenticated,service_role;
revoke all on function brc.recovery_schedule_set(int[],text) from public,anon,authenticated,service_role;
revoke all on function brc.recovery_schedule_set(text,int,int[],text) from public,anon,authenticated,service_role;
revoke all on function brc.recovery_run_scheduled() from public,anon,authenticated,service_role;
grant execute on function brc.recovery_schedule_get() to authenticated;
grant execute on function brc.recovery_schedule_set(text,int,int[],text) to authenticated;
grant execute on function brc.recovery_schedule_set(int[],text) to authenticated;

-- نسخة أمان فورية عند تغيّر شكل المخطط (شبكة أمان: لا تُنشئ نسخة إن وُجدت صالحة)
create or replace function brc.recovery_ensure_fresh() returns uuid
language plpgsql security definer set search_path=brc,public as $$
declare last_name text; result uuid;
begin
  if exists (select 1 from brc.recovery_copies where schema_hash = brc.recovery_schema_hash()) then
    return null;
  end if;
  last_name := 'نسخة تلقائية — تغيّر شكل قاعدة البيانات ' ||
    to_char(clock_timestamp() at time zone 'Asia/Baghdad', 'YYYY-MM-DD HH24:MI');
  result := brc.recovery_save(last_name, false);
  insert into brc.audit_log(username, role, action, entity, entity_id, details)
  values ('system', 'system', 'نسخة أمان تلقائية', 'recovery', result::text,
          'شكل قاعدة البيانات تغيّر (هجرة أعمدة) ولم تبقَ نسخة صالحة — أُنشئت نسخة جديدة تلقائياً.');
  return result;
end $$;
revoke all on function brc.recovery_ensure_fresh() from public,anon,authenticated;

-- الجدولة الافتراضية: الجمعة 23:00 بغداد — قابلة للتغيير من لوحة المدير
do $$ begin
  insert into brc.settings(key,value,updated_at)
  values ('recovery_schedule', jsonb_build_object('days',to_jsonb(array[5]),'time','23:00','enabled',true,
          'timezone','Asia/Baghdad','cron','0 20 * * 5','updatedAt',now()), now())
  on conflict (key) do nothing;
exception when others then null; end $$;
do $$ begin
  if coalesce((select (value->>'enabled')::boolean from brc.settings where key='recovery_schedule'), true) then
    perform cron.schedule('recovery-auto-backup',
      coalesce((select value->>'cron' from brc.settings where key='recovery_schedule'),'0 20 * * 5'),
      'select brc.recovery_run_scheduled();');
  end if;
exception when others then
  raise notice 'pg_cron غير متاح — جدولة النسخ تُضبط لاحقاً: %', sqlerrm;
end $$;
do $$ begin
  perform cron.schedule('recovery-ensure-fresh', '10 1 * * *', 'select brc.recovery_ensure_fresh();');
exception when others then null; end $$;

notify pgrst,'reload schema';

-- 2026-10-20: independent numbered vacancies, current-case notification support.
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