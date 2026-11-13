-- Keep original card identity after activation. No data rewrite or new privileges.
-- Residence validation matches the actual UI: province, district and landmark.
begin;

create or replace function brc.self_service_card(p_serial text, p_code text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  v_ok boolean;
  v_stored text;
  v_code text;
begin
  select * into f
    from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  /* ترميم خانات الفرص الناقصة قبل القراءة (إصلاح 2026-10-06) — بطاقة جديدة
     فقدت خاناتها بمزامنة ناقصة تُرمَّم هنا فوراً بدل «انتهت فرصك». */
  perform brc.ensure_card_attempts(f.serial);

  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;

  /* 2026-11-13: حيث يوجد card_print_code لا يُكشف الاسم/الهاتف/العنوان/الميلاد
     بلا الرمز. البطاقات بلا رمز مطبوع (كل بطاقات اليوم) تبقى كما هي تماماً. */
  v_stored := upper(btrim(coalesce(to_jsonb(f)->>'card_print_code', '')));
  v_code   := upper(btrim(coalesce(p_code, '')));
  if v_stored = '' then
    v_ok := true;
  else
    v_ok := (v_stored = v_code)
         or (replace(replace(v_stored, 'O', '0'), 'I', '1')
             = replace(replace(v_code, 'O', '0'), 'I', '1'));
  end if;

  return jsonb_build_object(
    'ok', true,
    'card', jsonb_build_object(
      'serial', f.serial,
      'status', f.status::text,
      'chancesLeft', (select count(*) from brc.job_attempts a where a.serial=f.serial and a.slot_status='empty'),
      'requiresCode', (v_stored <> ''),
      'verified', v_ok,
      'profileLocked', (f.status <> 'blank') or (not v_ok),
      'profile', case when not v_ok then '{}'::jsonb
        when f.status = 'blank' then coalesce(f.self_application_data, '{}'::jsonb)
        else coalesce(f.self_application_data, '{}'::jsonb) || jsonb_build_object(
          'fullName', f.full_name, 'phone', f.phone, 'address', f.address,
          'dob', f.dob, 'gender', f.gender) end,
      'chances', (select coalesce(jsonb_agg(jsonb_build_object(
          'no', a.attempt_no, 'slotStatus', a.slot_status::text,
          'jobCode', a.job_code, 'jobTitle', j.title
        ) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id=a.job_id
        where a.serial=f.serial)
    )
  );
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

commit;
