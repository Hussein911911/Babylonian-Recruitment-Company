-- ===========================================================================
--  شركة الهدف للتوظيف (HRC) — تحديث 2026-10-06
--  «التقديم الذاتي من باركود البطاقة» — الدالتان الناقصتان في القاعدة الحيّة
-- ---------------------------------------------------------------------------
--  لماذا هذا الملف؟
--  ------------------------------------------------------------------------
--  الإصدار الذي أضاف صفحة التقديم الذاتي (apply.html) وربط باركود البطاقة بها
--  جاء معه ملف هجرة داخل supabase/migrations/ فقط، ولم يُضَف إلى مسار التحديث
--  الذي تستعمله الإدارة (db-update.html و docs/UPDATE-*.sql و docs/schema.sql).
--  النتيجة العملية: زبون يمسح باركود بطاقته فيفتح عليه الخطأ الإنكليزي الخام
--
--      تعذّر الاتصال: Could not find the function
--      brc.self_service_card(p_serial) in the schema cache
--
--  لأن الصفحة تنادي دالة غير مثبّتة على القاعدة. هذا الملف يُثبّتها.
--
--  ماذا يفعل بالضبط؟
--  ------------------------------------------------------------------------
--    1. يضيف عمود brc.applicants.self_application_data — تخزين بيانات
--       المتقدّم مرة واحدة، فتعود معبّأة في الفرصة الثانية بلا إعادة إدخال.
--    2. يُنشئ brc.self_service_card : تُنادى بمجرد فتح رابط الباركود، تُرجع
--       حالة البطاقة والفرص المتبقية بدون كشف أي بيانات حساسة.
--    3. يُنشئ brc.apply_with_card : تقديم فعلي — تُفعَّل البطاقة الفارغة
--       (بيع ذاتي) وتُستهلك الفرصة وتُحجز الوظيفة 24 ساعة.
--    4. يمنحهما للزائر (anon) لأن المسار عام بلا جلسة موظف (نموذج الحيازة:
--       الباركود نفسه هو الإثبات)، ويُنزعهما من دور public أولاً.
--    5. يُعيد تحميل ذاكرة مخطط PostgREST — بدونها يبقى الرد «in the schema
--       cache» حتى بعد نجاح التنفيذ (أشهر سبب لظهور الخطأ مرة ثانية).
--
--  التنفيذ: Supabase → SQL Editor → New query → الصق الملف كاملاً → Run.
--  آمن للإعادة أي عدد من المرات (كل الأوامر idempotent) ولا يمس أي بيانات.
--  نفس النص موجود بالضبط في: supabase/migrations/20261006000000_self_service_card_application.sql
-- ===========================================================================

-- ── 1) عمود بيانات التقديم الذاتي ─────────────────────────────────────────
alter table brc.applicants
  add column if not exists self_application_data jsonb not null default '{}'::jsonb;

-- ── 2) قراءة البطاقة من باركودها (بلا كشف بيانات) ─────────────────────────
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

-- ── 3) التقديم الفعلي بالبطاقة (تفعيل الفارغة + استهلاك الفرصة) ───────────
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
    -- أول تقديم يُفعّل البطاقة الفارغة ويستهلك فرصتها الأولى (بيع ذاتي من الباركود).
    v_result := brc.activate_card(p_serial, jsonb_build_object(
      'fullName', v_name, 'phone', v_phone, 'address', v_address,
      'dob', v_dob, 'gender', v_gender, 'posName', 'تقديم ذاتي عبر الموقع',
      'jobCode', upper(btrim(coalesce(p_job_code, '')))
    ));
  else
    -- رموز الفرص تبقى سرّية؛ الباركود نفسه هو بيان الحيازة للفرصة الثانية.
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

  -- بيانات صاحب العمل تبقى محجوبة عن قائمة الوظائف العامة، وتُعاد فقط بعد
  -- نجاح التقديم على الوظيفة المختارة (يظهرها للباحث في استمارته).
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

-- ── 4) إعادة تحميل ذاكرة مخطط PostgREST ───────────────────────────────────
--  ⚠️ لا تحذف هذا السطر: بدونه يبقى PostgREST يرد «Could not find the function
--     … in the schema cache» دقائق أو ساعات رغم أن الدالتين أُنشئتا فعلاً.
notify pgrst, 'reload schema';

-- ── 5) التحقق: يجب أن يعرض هذا الاستعلام سطرين ────────────────────────────
select p.proname as "الدالة",
       pg_get_function_identity_arguments(p.oid) as "الوسائط"
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'brc'
   and p.proname in ('self_service_card', 'apply_with_card')
 order by p.proname;

-- ===========================================================================
--  كيف تتأكد أن كل شي صار تمام؟
--    • حدّث صفحة اللوحة (لو كانت مفتوحة) ثم امسح باركود أي بطاقة: لازم تفتح
--      صفحة «أهلاً بك في منصة الهدف» بلا أي خطأ.
--    • أو من المتصفح: /supabase-check.html — صفحة فحص الاتصال.
--    • وإن بقي الخطأ نفسه: نفّذ سطر إعادة التحميل وحده ثم انظر النتيجة:
--         notify pgrst, 'reload schema';
-- ===========================================================================
