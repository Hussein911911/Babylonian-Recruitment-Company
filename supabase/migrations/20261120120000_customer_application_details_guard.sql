-- ===========================================================================
--  ثغرة تعداد في تفاصيل التقديم — إغلاق نهائي (2026-11-20)
--  ---------------------------------------------------------------------------
--  brc.customer_application_details(p_serial, p_attempt_no) كانت ممنوحة للزائر
--  وتُرجع الاسم الكامل والهاتف والعنوان وتاريخ الميلاد والجنسية لصاحب البطاقة،
--  بلا أي رمز سرّي وبلا أي حدّ للطلبات. والباركود المطبوع HRC-BC-NNNNNN ستّ
--  خانات فقط، فمن يجرّب أرقاماً متتابعة يجمع بيانات الباحثين آلياً.
--
--  كانت lookup_card و self_service_card محروستين بـ brc.card_lookup_guard
--  (15 عرضاً/ساعة للبطاقة، 40/ساعة للمصدر) — وهذه الدالة كانت الباب الجانبي
--  المفتوح على البيانات نفسها.
--
--  الإصلاح: استدعاء الحارس نفسه في أول الدالة، قبل قراءة أي صف. لا يتغيّر
--  التوقيع ولا الصلاحيات ⇒ لا حاجة لتحديث الواجهة ولا لمسح كاش الأجهزة.
--
--  ملاحظة: الترحيلان 20261030110000 و 20261030120000 يعيدان تعريف الدالة
--  بلا حارس، لذلك يلزم هذا الترحيل المتأخّر ليثبت النسخة المحروسة في أي قاعدة
--  تُبنى من الصفر (ومنها قاعدة الاختبار PGlite).
-- ===========================================================================

create or replace function brc.customer_application_details(p_serial text, p_attempt_no integer)
returns jsonb language plpgsql security definer set search_path = brc, public as $$
declare f record; a record; v_job jsonb; v_guard jsonb;
begin
  /* ⚠️ 2026-11-20 — ثغرة تعداد (enumeration) أُغلقت:
     كانت هذه الدالة مفتوحة للزائر بلا أي حراسة، وتُرجع الاسم والهاتف والعنوان
     وتاريخ الميلاد لكل بطاقة قدّمت. والباركود HRC-BC-NNNNNN عشوائي من ستّ
     خانات = مليون احتمال فقط، وبلا حدّ للطلبات يجمع المهاجم بيانات الباحثين
     بمسح آلي. الحارس هو نفسه المستخدم في lookup_card/self_service_card:
     ١٥ عرضاً للبطاقة الواحدة في الساعة، و٤٠ من المصدر (IP) نفسه — فلا يتأثّر
     صاحب البطاقة الذي يفتح تفاصيله مرة أو مرتين.
     p_source = null عمداً ليُشتق IP الزائر من ترويسات الطلب
     (brc.card_request_source) فيعمل الحدّ لكل مصدر على حدة.
     لا يتغيّر توقيع الدالة ⇒ لا حاجة لتحديث الواجهة ولا لمسح كاش الأجهزة. */
  v_guard := brc.card_lookup_guard(p_serial);
  if coalesce((v_guard->>'ok')::boolean, false) is not true then
    return v_guard;
  end if;

  select * into f from brc.applicants where serial=upper(btrim(coalesce(p_serial,'')));
  if f.serial is null or f.status in ('blank','pending','rejected') then
    return jsonb_build_object('ok',false,'error','لا تتوفر تفاصيل تقديم لهذه البطاقة');
  end if;
  select * into a from brc.job_attempts where serial=f.serial and attempt_no=p_attempt_no
    and slot_status <> 'empty' and selected_at is not null and job_code is not null;
  if a.id is null then
    return jsonb_build_object('ok',false,'error','لا يوجد تقديم مسجل لهذه الفرصة');
  end if;
  -- A matching application snapshot is authoritative, including after deletion.
  -- Legacy linked rows may use the exact job ID, never a reused code alone.
  if a.job_snapshot->>'code'=a.job_code then v_job := a.job_snapshot; end if;
  if v_job is null then
    select to_jsonb(j) into v_job from brc.jobs j where j.id=a.job_id and j.code=a.job_code;
  end if;
  if v_job is null then
    return jsonb_build_object('ok',false,'error','تفاصيل الوظيفة غير متوفرة، تواصل مع الشركة');
  end if;
  return jsonb_build_object('ok',true,
    'app',jsonb_build_object('serial',f.serial,'fullName',f.full_name,'phone',f.phone,
      'address',f.address,'dob',f.dob,'gender',f.gender,'nationality',f.nationality,
      'status',f.status,'issueDate',f.issue_date,'expiryDate',f.expiry_date),
    'attempt',jsonb_build_object('no',a.attempt_no,'slotStatus',a.slot_status,'jobCode',a.job_code,
      'jobTitle',v_job->>'title','location',v_job->>'governorate','selectedAt',a.selected_at,'holdExpiresAt',a.hold_expires_at,
      'employerName',v_job->>'employer_name','employerPhone',v_job->>'employer_phone',
      'employerAddress',v_job->>'employer_address','interviewLocation',v_job->>'interview_location',
      'shift',v_job->>'shift','salaryMin',v_job->'salary_min','salaryMax',v_job->'salary_max'));
end $$;

-- الصلاحيات كما هي في الإنتاج: الزائر يستطيع المناداة، والحارس هو ما يحدّها.
grant execute on function brc.customer_application_details(text, integer) to anon, authenticated;
