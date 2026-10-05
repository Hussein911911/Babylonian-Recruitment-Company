-- Self-service applications from the card QR: persist applicant profile on the
-- first successful application, then let the same card submit its second chance
-- without re-entering the personal information.

alter table brc.applicants
  add column if not exists self_application_data jsonb not null default '{}'::jsonb;

create or replace function brc.self_service_card(p_serial text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare f record;
begin
  select * into f
    from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;

  return jsonb_build_object(
    'ok', true,
    'card', jsonb_build_object(
      'serial', f.serial,
      'status', f.status::text,
      'chancesLeft', (select count(*) from brc.job_attempts a where a.serial=f.serial and a.slot_status='empty'),
      'profile', coalesce(f.self_application_data, '{}'::jsonb),
      'chances', (select coalesce(jsonb_agg(jsonb_build_object(
          'no', a.attempt_no, 'slotStatus', a.slot_status::text,
          'jobCode', a.job_code, 'jobTitle', j.title
        ) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id=a.job_id
        where a.serial=f.serial)
    )
  );
end $$;

revoke all on function brc.self_service_card(text) from public;
grant execute on function brc.self_service_card(text) to anon, authenticated;

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
     or coalesce(p_data->>'subdistrict', '') = '' or coalesce(p_data->>'landmark', '') = '' then
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
                         p_data->>'subdistrict', p_data->>'landmark');
  v_profile := jsonb_build_object(
    'fullName', v_name, 'phone', v_phone, 'province', p_data->>'province',
    'district', p_data->>'district', 'subdistrict', p_data->>'subdistrict',
    'landmark', p_data->>'landmark', 'address', v_address,
    'dob', v_dob, 'gender', v_gender
  );

  if f.status = 'blank' then
    -- First application activates a blank card and reserves its first slot.
    v_result := brc.activate_card(p_serial, jsonb_build_object(
      'fullName', v_name, 'phone', v_phone, 'address', v_address,
      'dob', v_dob, 'gender', v_gender, 'posName', 'تقديم ذاتي عبر الموقع',
      'jobCode', upper(btrim(coalesce(p_job_code, '')))
    ));
  else
    -- Chance codes remain secret; the QR serial is the self-service credential.
    select chance_code into v_code
      from brc.job_attempts
     where serial=f.serial and slot_status='empty'
     order by attempt_no limit 1;
    if v_code is null then
      return jsonb_build_object('ok', false, 'error', 'لا توجد فرص متبقية في هذه البطاقة');
    end if;
    v_result := brc.use_chance(f.serial, v_code, upper(btrim(coalesce(p_job_code, ''))));
  end if;

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  update brc.applicants
     set full_name=v_name, phone=v_phone, address=v_address,
         dob=v_dob, gender=v_gender, self_application_data=v_profile
   where serial=f.serial;

  -- Employer details stay private in the public jobs list and are returned only
  -- after a successful application for the selected job.
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

revoke all on function brc.apply_with_card(text, text, jsonb) from public;
grant execute on function brc.apply_with_card(text, text, jsonb) to anon, authenticated;
