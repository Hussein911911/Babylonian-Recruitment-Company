-- Office queue: authenticated replay, no browser access to the receipt ledger.
create table if not exists brc.office_receipts (
 operation_id uuid primary key, actor uuid not null, request_hash text not null,
 result jsonb not null, created_at timestamptz not null default now()
);
alter table brc.office_receipts enable row level security;
revoke all on brc.office_receipts from public,anon,authenticated;
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
    if f.status<>'active' or f.expiry_date is null or f.expiry_date<=now() then raise exception 'card_unavailable';end if;
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
