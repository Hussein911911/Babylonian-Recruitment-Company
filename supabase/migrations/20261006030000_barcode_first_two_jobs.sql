-- ===========================================================================
--  BRC — الباركود يكفي + الزبون يختار وظيفتَي فرصتيه + رفض صاحب العمل بالسبب
--  (طلب الإدارة 2026-10-06 / ج5)
-- ---------------------------------------------------------------------------
--  قرارات الإدارة (2026-10-06):
--    1) إلغاء رموز القراءة: قراءة باركود البطاقة لا تطلب «رمز البطاقة»
--       (٤ أرقام + حرفين) ولا يحتاج صاحبُ العمل «رمز صاحب العمل» — الباركود
--       وحده يكفي (عودة صريحة إلى القرار المقفل 5ج/2: حيازة الورقة = التحكم).
--       وتظلّ رموز الفرصتين مطبوعة على ظهر البطاقة سريّةً لإثبات الحيازة عند
--       إعادة الطباعة فقط (verify_card_code) — لم تُمسّ.
--    2) الزبون (صاحب البطاقة) يعيّن وظيفتَي الفرصتين بنفسه: بيع نقطة البيع
--       صار بلا وظيفة إلزامية (jobCode اختياري)، والزبون يختار وظيفتين من
--       صفحة باركود بطاقته كما يختار وظيفة واحدة.
--    3) رفض صاحب العمل يُسجَّل **بسبب مكتوب** (عمود employer_reason)، وتنتقل
--       الوظيفة والفرصة إلى الحالة «الحرجة» المعلّقة ليقرّر موظف الشركة:
--       إرجاعها متاحة أو حذفها (أو تثبيت التوظيف). أما «تم التوظيف» فيبقى
--       كما هو: الوظيفة «جاري التوظيف» حتى تثبيت الموظف (قرار ج4).
--
--  ⚠️ الملف **مستقلّ تماماً** ولا يعتمد على `..._original` التي أنشأتها هجرة
--     بوابة الرموز (20261006010000): فهو يحذف النسخ المشغولة بالرمز
--     والنسخ الاحتياطية القديمة ثم يُنشئ الدوال كاملة بالمنطق النهائي، فيعمل
--     على أي قاعدة — سواء طُبِّقت بوابة الرموز أم لا.
--  كل الأجزاء idempotent: إعادة التنفيذ لا تُغيّر شيئاً ولا تفشل.
-- ===========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 0/أ) ضمان وجود الأعمدة والقيم التي يحتاجها هذا التحديث على قاعدة قديمة
--      ⚠️ عطل مُشاهد (2026-10-06): ERROR 42703: column "critical" does not exist
--      السبب: هذه القاعدة لم تُطبَّق عليها الأجزاء 1–5 من صفحة التحديث، فعمدُ
--      الوظائف «الحرجة» وقيم التعداد الجديدة غائبة — وهذا الجزء يجعل التحديث
--      مستقلاً تماماً: يُنشئ ما ينقصه بنفسه ثم يكمل.
--      كل سطر if not exists ⇒ وجودُ العمود/القيمة مسبقاً لا يُغيّر شيئاً.
-- ─────────────────────────────────────────────────────────────────────────
alter table brc.jobs         add column if not exists critical boolean not null default false;
alter table brc.applicants   add column if not exists pos_name text default '';
alter table brc.applicants   add column if not exists self_application_data jsonb not null default '{}'::jsonb;
alter table brc.job_attempts add column if not exists chance_code text;
alter table brc.job_attempts add column if not exists employer_decision text;
alter table brc.job_attempts add column if not exists decision_at timestamptz;
do $$ begin alter type brc.slot_status add value if not exists 'critical';  exception when others then null; end $$;
do $$ begin alter type brc.slot_status add value if not exists 'hiring';    exception when others then null; end $$;
do $$ begin alter type brc.job_status  add value if not exists 'hiring';    exception when others then null; end $$;
do $$ begin alter type brc.form_status add value if not exists 'blank';     exception when others then null; end $$;
do $$ begin alter type brc.form_status add value if not exists 'pending';   exception when others then null; end $$;
do $$ begin alter type brc.form_status add value if not exists 'rejected';  exception when others then null; end $$;
do $$ begin alter type brc.form_status add value if not exists 'expired';   exception when others then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 0) عمود سبب رفض صاحب العمل (يُقرأ في صفحة صاحب العمل وفي لوحة الموظف)
-- ─────────────────────────────────────────────────────────────────────────
alter table brc.job_attempts add column if not exists employer_reason text;

-- ─────────────────────────────────────────────────────────────────────────
-- 0/ب) ثلاث إصلاحات لازمة ليعمل التحديث فعلاً على قاعدة قائمة:
--   • القيمتان الغائبتان 'pending' و'rejected' من نوع brc.form_status —
--     تستعملهما دوال المراجعة والتقديم الذاتي وصفحة صاحب العمل، وأي استعمال
--     لهما كان يفشل بـ invalid input value for enum form_status.
--   • قيد jobs_hold_consistency كان يمنع الوظيفة «الحرجة» (محجوزة بلا مهلة)،
--     فيفشل مسار انتهاء 24 ساعة ومسار رفض صاحب العمل بخرق القيد.
--   • مشغّل trg_attempt_hold كان يحرّر الوظيفة عند succeeded/rejected فقط،
--     فكان «إرجاع الوظيفة متاحة» (release_hold ⇒ expired) يتركها محجوزة.
-- ─────────────────────────────────────────────────────────────────────────
do $$ begin
  alter type brc.form_status add value if not exists 'pending';
exception when others then null; end $$;
do $$ begin
  alter type brc.form_status add value if not exists 'rejected';
exception when others then null; end $$;

alter table brc.jobs drop constraint if exists jobs_hold_consistency;
/* status::text لتفادي خطأ «unsafe use of new value of enum type» داخل نفس المعاملة */
alter table brc.jobs add constraint jobs_hold_consistency
  check (status::text <> 'reserved' or hold_expires_at is not null or critical);

create or replace function brc.trg_attempt_hold() returns trigger
language plpgsql as $$
declare
  rules jsonb;
  hold_hours int;
  job_row brc.jobs;
  form_row brc.applicants;
begin
  select value into rules from brc.settings where key = 'rules';
  hold_hours := coalesce((rules->>'hold_hours')::int, 24);

  -- عند تحويل الخانة إلى "محجوزة" (اختيار وظيفة)
  if new.slot_status = 'reserved' and (tg_op = 'INSERT' or old.slot_status is distinct from 'reserved') then

    select * into form_row from brc.applicants where serial = new.serial for update;
    if form_row.serial is null then
      raise exception 'البطاقة % غير موجودة', new.serial;
    end if;
    if now() > form_row.expiry_date then
      raise exception 'انتهت صلاحية البطاقة % (30 يوماً)', new.serial using errcode = 'P0001';
    end if;

    select * into job_row from brc.jobs where id = new.job_id for update;
    if job_row.id is null then
      raise exception 'الوظيفة غير موجودة';
    end if;
    if job_row.status <> 'available' then
      raise exception 'الوظيفة % غير متاحة حالياً (%)', job_row.code, job_row.status using errcode = 'P0001';
    end if;

    new.selected_at     := coalesce(new.selected_at, now());
    new.hold_expires_at := coalesce(new.hold_expires_at, now() + make_interval(hours => hold_hours));
    new.job_code        := coalesce(new.job_code, job_row.code);
    new.closed_at       := null;

    update brc.jobs
       set status = 'reserved',
           reserved_by = new.serial,
           hold_expires_at = new.hold_expires_at,
           updated_at = now()
     where id = new.job_id;

    insert into brc.audit_log (username, role, ip, action, entity, entity_id, details)
    values (coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'sub', 'staff',
            coalesce(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''),
            'حجز مؤقت لوظيفة (24 ساعة)', 'job', job_row.code,
            'البطاقة ' || new.serial || ' — الفرصة #' || new.attempt_no);
  end if;

  -- عند تثبيت نتيجة أو إرجاع الوظيفة: نجاح → إغلاقها، رفض أو إرجاع → «متاحة»
  -- ⚠️ إصلاح 2026-10-06: كان الشرط succeeded/rejected فقط، فكان «إرجاع الوظيفة
  --    متاحة» من الحالة الحرجة (release_hold ⇒ expired) يتركها محجوزة للأبد.
  if new.slot_status in ('succeeded', 'rejected', 'expired')
     and (tg_op = 'INSERT' or old.slot_status is distinct from new.slot_status) then
    new.closed_at := coalesce(new.closed_at, now());
    new.hold_expires_at := null;

    update brc.jobs
       set status = case when new.slot_status = 'succeeded' then 'closed'::brc.job_status
                         else 'available'::brc.job_status end,
           reserved_by = null,
           hold_expires_at = null,
           critical = false,
           closed_at = case when new.slot_status = 'succeeded' then now() else null end,
           updated_at = now()
     where id = new.job_id;

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values (coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'sub', 'staff',
            case when new.slot_status = 'succeeded' then 'إتمام توظيف'
                 when new.slot_status = 'rejected' then 'رفض مرشح'
                 else 'إرجاع وظيفة متاحة بقرار الشركة' end,
            'job', new.job_code,
            case when new.slot_status = 'succeeded'
                 then 'تم التوظيف وإغلاق الوظيفة'
                 when new.slot_status = 'rejected'
                 then 'أُعيدت الوظيفة إلى (متاحة) — والفرصة مستهلكة لا تعود'
                 else 'أُعيدت الوظيفة إلى (متاحة) بقرار الشركة من الحالة الحرجة — والفرصة مستهلكة لا تعود' end
            || coalesce(' | ' || nullif(new.outcome_note, ''), ''));
  end if;

  return new;
end $$;


-- ─────────────────────────────────────────────────────────────────────────
-- 1) حذف النسخ المشغولة بالرمز (بوابة 2026-10-06) والنسخ القديمة المتعارضة
--    بعد هذه الأسطر يبقى اسم واحد لكل دالة: النسخة التي لا تطلب رمزاً.
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists brc.self_service_card(text, text);
drop function if exists brc.apply_with_card(text, text, text, jsonb);
drop function if exists brc.employer_view(text, text);
drop function if exists brc.employer_decide(text, text, text);
drop function if exists brc.employer_decide(text, text);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) تفعيل البطاقة: اختيار الوظيفة صار اختيارياً (بيع بلا وظيفة)
--    • بلا jobCode ⇒ تُفعَّل البطاقة بفرصتين فارغتين ويختار الزبون بنفسه.
--    • مع jobCode ⇒ نفس السلوك القديم: حجز 24 ساعة يستهلك الفرصة الأولى.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function brc.activate_card(p_serial text, p_data jsonb)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f       record;
  j       record;
  a       record;
  rules   jsonb;
  v_name  text;
  v_phone text;
  v_pos   text;
  v_job   text;
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

  /* وظيفة مختارة؟ تُقفل قبل أي كتابة (منع سباق حجز مزدوج) */
  if v_job <> '' then
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
      issue_date  = now(),
      expiry_date = now() + make_interval(days => coalesce((rules->>'validity_days')::int, 30)),
      pos_name    = v_pos,
      fee_amount  = coalesce(nullif(p_data->>'fee', '')::int, f.fee_amount),
      fee_paid    = coalesce((p_data->>'feePaid')::boolean, true),
      notes       = coalesce(nullif(p_data->>'notes', ''), f.notes)
  where serial = f.serial
  returning * into f;

  /* الفرصتان تُنشَأ مع البطاقة الفارغة عبر trg_applicants_attempts — لا نُنشئها هنا */
  if v_job <> '' then
    /* استهلاك الفرصة الأولى بالوظيفة المختارة: حجز 24 ساعة عبر trg_attempt_hold */
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
          ' — بدأت صلاحية ' || coalesce((rules->>'validity_days')::int, 30) || ' يوماً من الآن' ||
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
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.region,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at) end,
    'job', case when a.id is null then null
                else jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region) end,
    'chancesLeft', (select count(*) from brc.job_attempts x
                     where x.serial = f.serial and x.slot_status = 'empty'));
exception when others then
  /* أخطاء المشغّلات (P0001) نصوص عربية نظيفة تمر كما هي للواجهة */
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

revoke all on function brc.activate_card(text, jsonb) from public;
grant execute on function brc.activate_card(text, jsonb) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) قراءة بطاقة الباركود: بلا «رمز البطاقة» إطلاقاً (الباركود وحده)
-- ─────────────────────────────────────────────────────────────────────────
-- ---------------------------------------------------------------------------
-- ترميم خانات الفرص الناقصة (إصلاح 2026-10-06)
--   عطل حقيقي مُشاهد: مزامنة لوحة الموظفين كانت **تحذف** خانات فرص بطاقة
--   موجودة محلياً بلا خانات (سحب ناقص أو جهاز جديد) — فتُصبح البطاقة الجديدة
--   بلا أي فرصة في القاعدة، وتقول صفحة التقديم «لا توجد فرصة متاحة — انتهت
--   فرصك» بلا أي تقديم. هذه الدالة تُنشئ الخانات **الناقصة فقط** حتى
--   attempt_limit، فلا تُمنح فرصة إضافية لبطاقة مستهلكة أبداً، وتُسجَّل العملية
--   في التدقيق. آمنة للنداء المتكرر.
-- ---------------------------------------------------------------------------
create or replace function brc.ensure_card_attempts(p_serial text) returns integer
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  v_added integer := 0;
begin
  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, ''))) for update;
  if f.serial is null then return 0; end if;

  insert into brc.job_attempts (serial, attempt_no)
  select f.serial, gs
    from generate_series(1, greatest(coalesce(f.attempt_limit, 2), 1)) gs
   where not exists (select 1 from brc.job_attempts a
                      where a.serial = f.serial and a.attempt_no = gs);
  get diagnostics v_added = row_count;

  if v_added > 0 then
    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('system', 'system', 'ترميم خانات فرص ناقصة', 'applicant', f.serial,
            'البطاقة كانت بلا خانات فرص كافية — أُنشئت ' || v_added ||
            ' خانة (تُرمَّم الخانات الناقصة فقط؛ لا فرصة إضافية لبطاقة مستهلكة)');
  end if;
  return v_added;
end $$;

revoke all on function brc.ensure_card_attempts(text) from public;
grant execute on function brc.ensure_card_attempts(text) to authenticated, service_role;

-- ترميم جماعي فوري: كل بطاقة في القاعدة خاناتها أقل من حدّها تُرمَّم الآن
-- (نفس نمط ترميم 2026-09-20) — فلا تبقى بطاقة «انتهت فرصك» بلا تقديم.
insert into brc.job_attempts (serial, attempt_no)
select a.serial, gs
  from brc.applicants a
  cross join generate_series(1, greatest(coalesce(a.attempt_limit, 2), 1)) gs
 where not exists (select 1 from brc.job_attempts x
                    where x.serial = a.serial and x.attempt_no = gs);
/* ⚠️ لا on conflict هنا: job_attempts بلا قيد فريد على (serial, attempt_no) —
   الوجود مُمنَع بشرط not exists نفسه، فلا تكرار. */

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
  /* ترميم خانات الفرص الناقصة قبل القراءة (إصلاح 2026-10-06) — بطاقة جديدة
     فقدت خاناتها بمزامنة ناقصة تُرمَّم هنا فوراً بدل «انتهت فرصك». */
  perform brc.ensure_card_attempts(f.serial);

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

-- ─────────────────────────────────────────────────────────────────────────
-- 4) التقديم الذاتي من الموقع: الباركود + الوظيفة (رمز الفرصة تختاره القاعدة
--    من أول فرصة فارغة — لم يُمسّ منطق الاستهلاك في use_chance).
-- ─────────────────────────────────────────────────────────────────────────
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
  v_jobcode text;
begin
  select * into f
    from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')))
   for update;
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;

  v_jobcode := upper(btrim(coalesce(p_job_code, '')));
  if v_jobcode = '' then
    return jsonb_build_object('ok', false, 'error', 'اختر وظيفة أولاً — لا يوجد تقديم بلا وظيفة');
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
    -- أول تقديم يُفعّل البطاقة الفارغة ويحجز فرصتها الأولى
    v_result := brc.activate_card(p_serial, jsonb_build_object(
      'fullName', v_name, 'phone', v_phone, 'address', v_address,
      'dob', v_dob, 'gender', v_gender, 'posName', 'تقديم ذاتي عبر الموقع',
      'jobCode', v_jobcode
    ));
  else
    -- رمز الفرصة يبقى سرّاً على ظهر البطاقة؛ الباركود هو إثبات الحيازة للقراءة
    select chance_code into v_code
      from brc.job_attempts
     where serial=f.serial and slot_status='empty'
     order by attempt_no limit 1;
    if v_code is null then
      return jsonb_build_object('ok', false, 'error', 'لا توجد فرص متبقية في هذه البطاقة');
    end if;
    v_result := brc.use_chance(f.serial, v_code, v_jobcode);
  end if;

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  update brc.applicants
     set full_name=v_name, phone=v_phone, address=v_address,
         dob=v_dob, gender=v_gender, self_application_data=v_profile
   where serial=f.serial;

  -- بيانات صاحب العمل تبقى خاصة في قائمة الوظائف العامة وتُعاد بعد نجاح التقديم فقط
  select jsonb_build_object(
    'employer_name', employer_name, 'employer_phone', employer_phone,
    'employer_address', coalesce(employer_address, ''),
    'interview_location', coalesce(interview_location, ''),
    'salary_min', salary_min, 'salary_max', salary_max, 'shift', shift
  ) into v_job
  from brc.jobs where code=v_jobcode;
  v_result := v_result || jsonb_build_object(
    'job', coalesce(v_result->'job', '{}'::jsonb) || coalesce(v_job, '{}'::jsonb));

  return v_result || jsonb_build_object('app', v_profile, 'profile', v_profile);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

revoke all on function brc.apply_with_card(text, text, jsonb) from public;
grant execute on function brc.apply_with_card(text, text, jsonb) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) صفحة صاحب العمل: الباركود وحده يكفي — لا رمز صاحب عمل،
--    مع كشف سبب رفضه المسجَّل (employer_reason) ليقرأه هو نفسه.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function brc.employer_view(p_serial text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f    record;
  a    record;
  j    record;
  v_st text;
begin
  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  if f.status = 'blank' then
    return jsonb_build_object('ok', false, 'code', 'blank', 'error', 'هذه البطاقة فارغة ولم تُبع بعد');
  end if;
  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'code', 'pending', 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;

  select * into a from brc.job_attempts
   where serial = f.serial and slot_status in ('reserved', 'critical', 'hiring')
   order by selected_at desc nulls last, attempt_no desc limit 1;
  if a.id is not null then
    select * into j from brc.jobs where id = a.job_id;
  end if;

  v_st := case
    when f.status in ('pending', 'rejected') then f.status::text
    when f.expiry_date is not null and now() > f.expiry_date then 'expired'
    when (select count(*) from brc.job_attempts x where x.serial = f.serial and x.slot_status = 'empty') = 0
         and not exists (select 1 from brc.job_attempts x
                          where x.serial = f.serial and x.slot_status in ('reserved', 'critical', 'hiring'))
      then 'exhausted'
    else 'active' end;

  if a.id is not null then
    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('public', 'employer', 'صاحب العمل شاهد تعريف المتقدم', 'applicant', f.serial,
            'فتح صفحة الباركود — التقديم الجاري على ' || coalesce(a.job_code, '—') ||
            ' — الزبون ' || f.full_name);
  end if;

  return jsonb_build_object(
    'ok', true,
    'card', jsonb_build_object(
      'serial', f.serial, 'fullName', f.full_name, 'phone', f.phone,
      'address', coalesce(f.address, ''), 'gender', coalesce(f.gender, ''), 'dob', f.dob,
      'status', v_st, 'issueDate', f.issue_date, 'expiryDate', f.expiry_date,
      'posName', coalesce(f.pos_name, ''),
      'chancesLeft', (select count(*) from brc.job_attempts x where x.serial = f.serial and x.slot_status = 'empty'),
      'succeeded', exists (select 1 from brc.job_attempts x where x.serial = f.serial and x.slot_status = 'succeeded'),
      'applied', case when a.id is null then null else jsonb_build_object(
        'no', a.attempt_no, 'jobCode', a.job_code, 'jobTitle', j.title, 'region', j.region,
        'appliedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at,
        'slotStatus', a.slot_status::text,
        'employerDecision', a.employer_decision,
        'decisionAt', a.decision_at,
        'reason', coalesce(a.employer_reason, ''),
        'employer', jsonb_build_object(
          'name', j.employer_name, 'phone', j.employer_phone,
          'address', j.employer_address, 'interviewLocation', j.interview_location)
      ) end));
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

revoke all on function brc.employer_view(text) from public;
grant execute on function brc.employer_view(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) قرار صاحب العمل: توظيف ⇒ «جاري التوظيف» بانتظار الشركة،
--    ورفض ⇒ «حرجة / معلّقة» + السبب، والشركة تقرر: إرجاع متاحة أو حذف.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function brc.employer_decide(
  p_serial   text,
  p_decision text,
  p_reason   text default ''
) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f   record;
  a   record;
  j   record;
  v_reason text;
begin
  if p_decision not in ('hire', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'قرار غير صحيح — hire أو reject فقط');
  end if;

  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  if f.status = 'blank' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة فارغة ولم تُبَع بعد');
  end if;

  /* أحدث تقديم قيد اللعب (قد تكون الفرصتان محجوزتين معاً) — والطلب المسجَّل
     سابقاً (توظيف أو رفض) لا يُكرَّر: القرار التالي للشركة */
  select * into a from brc.job_attempts
   where serial = f.serial and slot_status in ('reserved', 'critical', 'hiring')
   order by selected_at desc nulls last, attempt_no desc limit 1 for update;
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'لا يوجد تقديم قيد القرار على هذه البطاقة — راجع الشركة');
  end if;
  if a.slot_status = 'hiring' or a.employer_decision is not null then
    return jsonb_build_object('ok', false, 'error', 'طلبك مسجَّل بالفعل — الوظيفة بانتظار قرار الشركة');
  end if;

  select * into j from brc.jobs where id = a.job_id for update;

  v_reason := btrim(coalesce(p_reason, ''));
  if p_decision = 'reject' and v_reason = '' then
    return jsonb_build_object('ok', false, 'error', 'سبب عدم التوظيف مطلوب — اكتب سبباً واضحاً للشركة وللمتقدم');
  end if;

  if p_decision = 'hire' then
    /* توظيف: تجميد كامل بلا مهلة — بانتظار تثبيت موظفي الشركة */
    update brc.job_attempts
       set slot_status = 'hiring',
           employer_decision = 'hire',
           employer_reason = null,
           decision_at = now(),
           hold_expires_at = null,
           outcome_note = 'طلب صاحب العمل: تم التوظيف — بانتظار تثبيت الشركة'
     where id = a.id
    returning * into a;

    update brc.jobs
       set status = 'hiring', critical = false, hold_expires_at = null, updated_at = now()
     where id = j.id
    returning * into j;

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('public', 'employer', 'طلب توظيف من صاحب العمل', 'applicant', f.serial,
            'صاحب العمل طلب التوظيف على الوظيفة ' || coalesce(a.job_code, '—') ||
            ' — الفرصة #' || a.attempt_no || ' — الزبون ' || f.full_name ||
            ' | الوظيفة «جاري التوظيف» بانتظار قرار الشركة (تثبيت/إلغاء)');
  else
    /* رفض بالسبب: الوظيفة والفرصة إلى «حرجة» — والشركة تقرر: إرجاع أو حذف */
    update brc.job_attempts
       set slot_status = 'critical',
           employer_decision = 'reject',
           employer_reason = v_reason,
           decision_at = now(),
           hold_expires_at = null,
           outcome_note = 'رفض صاحب العمل — السبب: ' || v_reason || ' | القرار الآن بيد الشركة: إرجاع الوظيفة متاحة أو حذفها'
     where id = a.id
    returning * into a;

    update brc.jobs
       set status = 'reserved',
           critical = true,
           hold_expires_at = null,
           updated_at = now()
     where id = j.id
    returning * into j;

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('public', 'employer', 'رفض من صاحب العمل مع السبب', 'applicant', f.serial,
            'صاحب العمل رفض التوظيف على الوظيفة ' || coalesce(a.job_code, '—') ||
            ' — الفرصة #' || a.attempt_no || ' — الزبون ' || f.full_name ||
            ' | السبب: ' || v_reason ||
            ' | الوظيفة «حرجة — معلّقة» بانتظار قرار الشركة: إرجاع متاحة أو حذف');
  end if;

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'no', a.attempt_no, 'slotStatus', a.slot_status::text,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.region,
      'selectedAt', a.selected_at, 'decisionAt', a.decision_at,
      'employerDecision', a.employer_decision, 'reason', v_reason),
    'job', jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region,
                              'status', j.status::text),
    'decision', p_decision, 'reason', v_reason);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

revoke all on function brc.employer_decide(text, text, text) from public;
grant execute on function brc.employer_decide(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) لوحة المتابعة: إضافة الحالة الحرجة (رفض صاحب العمل بالسبب + انتهاء المهلة)
--    إلى واجهة الإجراءات المطلوبة — القرار في الحالتين: إرجاع متاحة أو حذف.
-- ─────────────────────────────────────────────────────────────────────────
create or replace view brc.v_pending_actions as
  select 'hiring'::text as kind, j.code as reference, j.reserved_by as serial,
         a.decision_at as due_at, null::numeric as hours_left,
         case when a.employer_decision = 'hire'
              then 'طلب صاحب العمل: تم التوظيف — بانتظار تثبيت الشركة'
              else 'طلب صاحب العمل: لم يتم التوظيف — بانتظار قرار الشركة' end::text as description
    from brc.jobs j
    join brc.job_attempts a on a.job_id = j.id and a.slot_status::text = 'hiring'
   where j.status::text = 'hiring'
  union all
  select 'critical'::text, j.code, j.reserved_by, a.decision_at, null,
         ('رفض صاحب العمل بسبب: ' || coalesce(nullif(a.employer_reason, ''), '—') ||
          ' — القرار: إرجاع الوظيفة متاحة أو حذفها')
    from brc.jobs j
    join brc.job_attempts a on a.job_id = j.id and a.slot_status::text = 'critical'
   where j.status::text = 'reserved' and j.critical
     -- ⚠️ إصلاح 2026-10-06: بلا هذا الشرط كانت وظيفة «انتهت مهلة 24 ساعة» تظهر
     --    كأن صاحب العمل رفضها بسبب فارغ («بسبب: —») بدل «حرجة — انتهت المهلة».
     and a.employer_decision = 'reject'
  union all
  select 'critical_timeout'::text, j.code, j.reserved_by, j.hold_expires_at, null,
         'انتهت مهلة 24 ساعة دون قرار — توظيف أو إرجاع أو حذف'::text
    from brc.jobs j
   where j.status::text = 'reserved' and j.critical
     and not exists (select 1 from brc.job_attempts a
                      where a.job_id = j.id and a.slot_status::text = 'critical'
                        and a.employer_decision = 'reject')
  union all
  select 'hold'::text, j.code, j.reserved_by,
         j.hold_expires_at,
         round(extract(epoch from (j.hold_expires_at - now())) / 3600.0, 1),
         'حجز مؤقت بانتظار نتيجة المقابلة'::text
    from brc.jobs j
   where j.status::text = 'reserved'
  union all
  select 'expired_attempt', a.job_code, a.serial, a.closed_at, null,
         'انتهت مهلة 24 ساعة — تتطلب إجراء'
    from brc.job_attempts a
   where a.slot_status::text = 'expired'
  union all
  select 'expired_form', f.serial, f.serial, f.expiry_date, null,
         'استمارة منتهية الصلاحية (30 يوماً)'
    from brc.applicants f
   where f.status::text = 'expired';

-- ─────────────────────────────────────────────────────────────────────────
-- 8) إعادة تحميل ذاكرة المخطط في PostgREST فوراً (تُطبَّق الدوال الجديدة بلا انتظار)
-- ─────────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
