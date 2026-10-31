-- Start validity only at the first successful application. Existing card dates are preserved.
begin;

create or replace function brc.activate_card(p_serial text, p_data jsonb)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f        record;
  j        record;
  a        record;
  rules    jsonb;
  v_name   text;
  v_phone  text;
  v_pos    text;
  v_job    text;
begin
  /* ⚠️ إصلاح 2026-10-06: تهيئة سجلَّي الفرصة والوظيفة — مسار «البيع بلا وظيفة»
     لا يمرّ على select into a/j، فكان أي استعمال لاحق لهما يفشل بـ
     «record "j" is not assigned yet» ويسقط البيع بلا وظيفة كاملاً. */
  select * into a from brc.job_attempts where false;
  select * into j from brc.jobs where false;

  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, ''))) for update;
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على البطاقة الفارغة');
  end if;
  if f.status <> 'blank' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة ليست فارغة — حالتها: ' || f.status::text);
  end if;

  v_name  := btrim(coalesce(p_data->>'fullName', ''));
  v_phone := btrim(coalesce(p_data->>'phone', ''));
  v_pos   := btrim(coalesce(p_data->>'posName', ''));
  v_job   := upper(btrim(coalesce(p_data->>'jobCode', '')));
  if v_name = ''  then return jsonb_build_object('ok', false, 'error', 'اسم الزبون مطلوب'); end if;
  if v_phone = '' then return jsonb_build_object('ok', false, 'error', 'هاتف الزبون مطلوب'); end if;
  if v_pos = ''   then return jsonb_build_object('ok', false, 'error', 'اسم نقطة البيع مطلوب'); end if;
  /* ج5 2026-10-06: اختيار الوظيفة عند البيع صار اختيارياً — إمّا يختارها موظف
     النقطة للزبون فتُستهلك الفرصة الأولى بحجز 24 ساعة، وإمّا يُباع بلا وظيفة
     فيختار صاحب البطاقة وظيفتَي فرصتيه بنفسه من صفحة باركود بطاقته. */
  if v_job <> '' then
    /* الوظيفة جزء من الاستمارة: تُقفل قبل أي كتابة (منع سباق حجز مزدوج) */
    select * into j from brc.jobs where code = v_job for update;
    if j.id is null then
      return jsonb_build_object('ok', false, 'error', 'الوظيفة المختارة غير موجودة');
    end if;
    if j.status <> 'available' then
      return jsonb_build_object('ok', false, 'error', 'الوظيفة ' || j.code || ' غير متاحة حالياً — اختر وظيفة أخرى');
    end if;
  end if;

  select value into rules from brc.settings where key = 'rules';

  update brc.applicants set
      full_name   = v_name,
      phone       = v_phone,
      address     = coalesce(nullif(btrim(coalesce(p_data->>'address', '')), ''), f.address),
      dob         = nullif(p_data->>'dob', '')::date,
      gender      = coalesce(nullif(p_data->>'gender', ''), 'ذكر'),
      status      = 'active',
      issue_date  = case when v_job <> '' then now() else null end,
      expiry_date = case when v_job <> '' then now() + make_interval(days => coalesce((rules->>'validity_days')::int, 30)) else null end,
      pos_name    = v_pos,
      fee_amount  = coalesce(nullif(p_data->>'fee', '')::int, f.fee_amount),
      fee_paid    = coalesce((p_data->>'feePaid')::boolean, true),
      notes       = coalesce(nullif(p_data->>'notes', ''), f.notes)
  where serial = f.serial
  returning * into f;

  /* مع وظيفة مختارة: تُستهلك الفرصة الأولى بحجز 24 ساعة عبر trg_attempt_hold
     (يتحقق من توافر الوظيفة مجدداً + يقفلها + يدوّن الحجز بسجل التدقيق). */
  if v_job <> '' then
    select id into a from brc.job_attempts
     where serial = f.serial and slot_status = 'empty'
     order by attempt_no limit 1 for update;
    if a.id is null then
      raise exception 'لا توجد فرصة متاحة على البطاقة %', f.serial using errcode = 'P0001';
    end if;

    update brc.job_attempts
       set slot_status     = 'reserved',
           job_id          = j.id,
           job_code        = j.code,
           selected_at     = now(),
           hold_expires_at = now() + make_interval(hours => coalesce((rules->>'hold_hours')::int, 24))
     where id = a.id
    returning * into a;
  end if;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'pos', 'بيع وتعبئة بطاقة فارغة', 'applicant', f.serial,
          'بيع البطاقة ' || f.serial || ' للزبون ' || f.full_name ||
          ' — نقطة البيع: ' || v_pos ||
          ' — سعر ' || to_char(f.fee_amount, 'FM999,999,999') || ' د.ع (كاش)' ||
          ' — الصلاحية تبدأ عند أول تقديم ناجح' ||
          case when v_job <> '' then ' | الوظيفة المختارة: ' || j.code || ' — ' || j.title
               else ' | بلا اختيار وظيفة — الفرصتان بانتظار اختيار الزبون بنفسه' end);

  return jsonb_build_object(
    'ok', true,
    'app', jsonb_build_object(
      'serial', f.serial, 'fullName', f.full_name, 'phone', f.phone,
      'address', coalesce(f.address, ''), 'dob', f.dob, 'gender', f.gender,
      'status', f.status::text, 'issueDate', f.issue_date, 'expiryDate', f.expiry_date,
      'posName', coalesce(f.pos_name, ''), 'fee', f.fee_amount, 'feePaid', f.fee_paid),
    'attempt', case when a.id is null then null else jsonb_build_object(
      'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status::text,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.governorate,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at) end,
    'job', case when a.id is null then null
                else jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region) end,
    'chancesLeft', (select count(*) from brc.job_attempts x
                     where x.serial = f.serial and x.slot_status = 'empty'));
exception when others then
  /* أخطاء المشغّلات (P0001) نصوص عربية نظيفة تمر كما هي للواجهة */
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

create or replace function brc.apply_with_card(
  p_serial text,
  p_job_code text,
  p_data jsonb
) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  v_result jsonb;
  v_job jsonb;
  v_code text;
  v_name text;
  v_phone text;
  v_address text;
  v_dob date;
  v_gender text;
  v_profile jsonb;
begin
  select * into f
    from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')))
   for update;
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;

  -- The row lock above serializes first/second submissions. Once activated,
  -- identity is taken only from the stored card, never from caller p_data.
  if f.status <> 'blank' then
    v_profile := coalesce(f.self_application_data, '{}'::jsonb) || jsonb_build_object(
      'fullName', f.full_name, 'phone', f.phone, 'address', f.address,
      'dob', f.dob, 'gender', f.gender);
  else
  v_name := btrim(coalesce(p_data->>'fullName', ''));
  v_phone := btrim(coalesce(p_data->>'phone', ''));
  v_gender := btrim(coalesce(p_data->>'gender', ''));
  if array_length(regexp_split_to_array(v_name, '[[:space:]]+'), 1) < 3 then
    return jsonb_build_object('ok', false, 'error', 'يرجى إدخال الاسم الثلاثي');
  end if;
  if v_phone !~ '^07[3-9][0-9]{8}$' then
    return jsonb_build_object('ok', false, 'error', 'رقم الهاتف يجب أن يتكون من 11 رقماً ويبدأ بـ 07');
  end if;
  if coalesce(p_data->>'province', '') = '' or coalesce(p_data->>'district', '') = ''
     or coalesce(p_data->>'landmark', '') = '' then
    return jsonb_build_object('ok', false, 'error', 'جميع حقول السكن مطلوبة');
  end if;
  if v_gender not in ('ذكر', 'أنثى') then
    return jsonb_build_object('ok', false, 'error', 'يرجى اختيار نوع الجنس');
  end if;
  if coalesce(p_data->>'dob', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', 'تاريخ الميلاد غير صحيح');
  end if;
  begin
    v_dob := (p_data->>'dob')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'تاريخ الميلاد غير صحيح');
  end;

  v_address := concat_ws(' — ', p_data->>'province', p_data->>'district',
                         nullif(p_data->>'subdistrict', ''), p_data->>'landmark');
  v_profile := jsonb_build_object(
    'fullName', v_name, 'phone', v_phone, 'province', p_data->>'province',
    'district', p_data->>'district', 'subdistrict', p_data->>'subdistrict',
    'landmark', p_data->>'landmark', 'address', v_address,
    'dob', v_dob, 'gender', v_gender
  );

  end if;

  if f.status = 'blank' then
    -- أول تقديم يُفعّل البطاقة الفارغة ويستهلك فرصتها الأولى (بيع ذاتي بالباركود)
    v_result := brc.activate_card(p_serial, jsonb_build_object(
      'fullName', v_name, 'phone', v_phone, 'address', v_address,
      'dob', v_dob, 'gender', v_gender, 'posName', 'تقديم ذاتي عبر الموقع',
      'jobCode', upper(btrim(coalesce(p_job_code, '')))
    ));
  else
    -- رموز الفرص تبقى سرّية؛ الباركود نفسه هو بيان الحيازة للفرصة الثانية
    select chance_code into v_code
      from brc.job_attempts
     where serial=f.serial and slot_status='empty'
     order by attempt_no limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'لا توجد فرص متبقية في هذه البطاقة');
    end if;
    v_result := brc.use_chance(f.serial, v_code, upper(btrim(coalesce(p_job_code, ''))));
  end if;

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  -- Only a successful FIRST application persists identity. Failed requests
  -- and later applications cannot rewrite either canonical fields or metadata.
  if f.status = 'blank' then
    update brc.applicants
       set full_name=v_name, phone=v_phone, address=v_address,
           dob=v_dob, gender=v_gender, self_application_data=v_profile
     where serial=f.serial;
  end if;

  -- بيانات صاحب العمل تبقى محجوبة عن قائمة الوظائف العامة، وتُعاد فقط بعد نجاح
  -- التقديم على الوظيفة المختارة (تظهر للباحث في استمارته).
  select jsonb_build_object(
    'employer_name', employer_name, 'employer_phone', employer_phone,
    'employer_address', coalesce(employer_address, ''),
    'interview_location', coalesce(interview_location, ''),
    'salary_min', salary_min, 'salary_max', salary_max, 'shift', shift
  ) into v_job
  from brc.jobs where code=upper(btrim(coalesce(p_job_code, '')));
  v_result := v_result || jsonb_build_object(
    'job', coalesce(v_result->'job', '{}'::jsonb) || coalesce(v_job, '{}'::jsonb));

  return v_result || jsonb_build_object('app', v_profile, 'profile', v_profile);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

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
  -- Start validity atomically only on the first successful reservation.
  if f.issue_date is null and f.expiry_date is null then
   update brc.applicants set issue_date=now(), expiry_date=now()+make_interval(days=>coalesce((select (value->>'validity_days')::int from brc.settings where key='rules'),30)) where serial=f.serial;
  end if;
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

notify pgrst, 'reload schema';
commit;
