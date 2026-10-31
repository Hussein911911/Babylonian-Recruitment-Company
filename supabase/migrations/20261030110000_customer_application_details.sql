-- Customer access is by card barcode alone (owner-approved). Limit every result
-- to the exact card and selected opportunity; never expose unused/other jobs.
create or replace function brc.customer_application_details(p_serial text, p_attempt_no integer)
returns jsonb language plpgsql security definer set search_path = brc, public as $$
declare f record; a record; j record;
begin
  select * into f from brc.applicants where serial=upper(btrim(coalesce(p_serial,'')));
  if f.serial is null or f.status in ('blank','pending','rejected') then
    return jsonb_build_object('ok',false,'error','لا تتوفر تفاصيل تقديم لهذه البطاقة');
  end if;
  select * into a from brc.job_attempts where serial=f.serial and attempt_no=p_attempt_no
    and slot_status <> 'empty' and selected_at is not null and job_id is not null;
  if a.id is null then
    return jsonb_build_object('ok',false,'error','لا يوجد تقديم مسجل لهذه الفرصة');
  end if;
  select * into j from brc.jobs where id=a.job_id and code=a.job_code;
  if j.id is null then
    return jsonb_build_object('ok',false,'error','تفاصيل الوظيفة لم تعد متاحة، تواصل مع الشركة');
  end if;
  return jsonb_build_object('ok',true,
    'app',jsonb_build_object('serial',f.serial,'fullName',f.full_name,'phone',f.phone,
      'address',f.address,'dob',f.dob,'gender',f.gender,'nationality',f.nationality,
      'status',f.status,'issueDate',f.issue_date,'expiryDate',f.expiry_date),
    'attempt',jsonb_build_object('no',a.attempt_no,'slotStatus',a.slot_status,'jobCode',a.job_code,
      'jobTitle',j.title,'location',j.governorate,'selectedAt',a.selected_at,'holdExpiresAt',a.hold_expires_at,
      'employerName',j.employer_name,'employerPhone',j.employer_phone,
      'employerAddress',j.employer_address,'interviewLocation',j.interview_location,
      'shift',j.shift,'salaryMin',j.salary_min,'salaryMax',j.salary_max));
end $$;
revoke all on function brc.customer_application_details(text,integer) from public;
grant execute on function brc.customer_application_details(text,integer) to anon,authenticated;
notify pgrst, 'reload schema';
