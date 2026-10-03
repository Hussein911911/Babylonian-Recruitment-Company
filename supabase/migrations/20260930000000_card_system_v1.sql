-- ===========================================================================
--  شركة الهدف للتوظيف (BRC) — ترقية «نظام بطاقة التوظيف v1.0» (2026-09-30)
-- ---------------------------------------------------------------------------
--  ترقية تفاضلية (idempotent) لقاعدة بيانات قائمة على المخطط الأولي.
--  قاعدة بيانات جديدة تُنشأ كاملة من 20260915000000_brc_initial_schema.sql
--  المحدَّث (نسخة npm run schema:sync) — وهذه الهجرة للقاعدة الحيّة فقط.
--
--  التغييرات:
--   1. حالة «حرجة» جديدة (slot_status) — لا إفراج تلقائي بعد 24 ساعة.
--   2. عمود critical للوظائف المحجوزة المنتهية مهلتها.
--   3. رمز فرصة سري فريد (chance_code: NNNN-AA) لكل خانة فرصة.
--   4. البطاقات: فرصتان (لا 5) + نقطة البيع (pos_name) + بادئة HRC-BC-.
--   5. دوال «بطاقتي» العامة (lookup_card / use_chance / verify_card_code)
--      مع منحها للزائر anon — الأمان بنموذج الحيازة (رمز الفرصة).
--   6. التوظيف لا يُنهي البطاقة: لا حالة completed جديدة.
-- ===========================================================================

-- 1) قيمة التعداد الجديدة (لا حذف للقيم القديمة — سجل تاريخي)
alter type brc.slot_status add value if not exists 'critical';

-- 2) الأعمدة الجديدة
alter table brc.jobs       add column if not exists critical  boolean not null default false;
alter table brc.applicants add column if not exists pos_name   text default '';

-- 3) رمز الفرصة: الدالة أولاً ثم العمود ثم التعبئة صفاً صفاً (تفرد مضمون)
create or replace function brc.chance_code() returns text
language plpgsql
as $$
declare
  letters text[] := array['A','B','C','D','E','F','G','H','J','K','M','N','P','Q','R','S','T','U','V','W','X','Y','Z'];
  c text;
begin
  loop
    c := lpad((1000 + floor(random() * 9000))::int::text, 4, '0') || '-' ||
         letters[1 + floor(random() * array_length(letters, 1))] ||
         letters[1 + floor(random() * array_length(letters, 1))];
    exit when not exists (select 1 from brc.job_attempts where chance_code = c);
  end loop;
  -- إصلاح 2026-10-03: return كان داخل اللوب — الخروج بلا قيمة (2F005)
  return c;
end $$;
alter table brc.job_attempts add column if not exists chance_code text;

do $$
declare r record;
begin
  for r in select id from brc.job_attempts where chance_code is null order by serial, attempt_no for update
  loop
    update brc.job_attempts set chance_code = brc.chance_code() where id = r.id;
  end loop;
end $$;

alter table brc.job_attempts alter column chance_code set default brc.chance_code();
alter table brc.job_attempts alter column chance_code set not null;
create unique index if not exists attempts_chance_code_uidx on brc.job_attempts (chance_code);

-- 4) البطاقات: فرصتان لكل بطاقة (قرار مقفل) — الخانات الفارغة فوق الثانية تُحذف
alter table brc.applicants alter column attempt_limit set default 2;
alter table brc.applicants alter column fee_paid set default true;
delete from brc.job_attempts where attempt_no > 2 and slot_status = 'empty';
update brc.applicants set attempt_limit = 2 where attempt_limit <> 2;

-- 5) الإعدادات: فرصتان + لا إفراج تلقائي (الحالة الحرجة تُحسم يدوياً)
update brc.settings
   set value = jsonb_set(jsonb_set(value, '{attempt_limit}', '2'::jsonb),
                         '{auto_release}', 'false'::jsonb),
       updated_at = now()
 where key = 'rules';

-- 6) الدوال المحدَّثة (أجسامها منسوخة حرفياً من docs/schema.sql)


create or replace function brc.next_form_serial() returns text
language plpgsql as $$
declare v text;
begin
  loop
    v := 'HRC-BC-' || lpad(nextval('brc.form_serial_seq')::text, 6, '0');
    exit when not exists (select 1 from brc.applicants where serial = v);
  end loop;
  return v;
end $$;

create or replace function brc.trg_defaults() returns trigger
language plpgsql as $$
declare rules jsonb;
begin
  select value into rules from brc.settings where key = 'rules';

  /* ⚠️ لا تدمج الشرطين بـ and في سطر واحد:
     PL/pgSQL يقيّم طرفَي التعبير معاً، فيقرأ new.code حتى عندما يكون
     tg_table_name = 'applicants' — وذلك الجدول بلا عمود code، فينفجر
     الإدراج بخطأ 42703: record "new" has no field "code".
     التعشيش يضمن ألا يُقرأ new.code إلا داخل فرع jobs. */
  if tg_table_name = 'jobs' then
    if coalesce(new.code, '') = '' then
      new.code := brc.next_job_code();
    end if;
  end if;

  if tg_table_name = 'applicants' then
    if coalesce(new.serial, '') = '' then
      new.serial := brc.next_form_serial();
    end if;
    if new.attempt_limit is null or new.attempt_limit = 2 then
      new.attempt_limit := coalesce((rules->>'attempt_limit')::smallint, 2);
    end if;
    if new.fee_amount is null or new.fee_amount = 10000 then
      new.fee_amount := coalesce((rules->>'form_fee')::integer, 10000);
    end if;
    if new.expiry_date is null then
      new.expiry_date := new.issue_date + make_interval(days => coalesce((rules->>'validity_days')::int, 30));
    end if;
    /* ⚠️ لا تُنشأ خانات المحاولات هنا: هذا مُشغِّل BEFORE INSERT، أي أن صف
       الاستمارة لم يُكتب في الجدول بعد. وjob_attempts.serial مفتاح أجنبي
       يشير إلى applicants(serial)، فالإدراج يفشل بـ 23503. الإنشاء نُقل إلى
       مُشغِّل AFTER INSERT منفصل (trg_applicants_attempts) أدناه. */
  end if;

  new.updated_at := now();
  return new;
end $$;

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

  -- عند تثبيت نتيجة: نجاح → إغلاق الوظيفة، رفض → إعادتها «متاحة»
  if new.slot_status in ('succeeded', 'rejected')
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
            case when new.slot_status = 'succeeded' then 'إتمام توظيف' else 'رفض مرشح' end,
            'job', new.job_code,
            case when new.slot_status = 'succeeded'
                 then 'تم التوظيف وإغلاق الوظيفة'
                 else 'أُعيدت الوظيفة إلى (متاحة) — والفرصة مستهلكة لا تعود' end
            || coalesce(' | ' || nullif(new.outcome_note, ''), ''));
  end if;

  return new;
end $$;

create or replace function brc.run_auto_release() returns table (released_job text, expired_form text)
language plpgsql as $$
declare r record;
begin
  -- (أ) حجوزات انتهت مهلتها دون قرار ← حالة «حرجة» (لا إفراج تلقائي)
  for r in
    select j.id, j.code, j.reserved_by, a.attempt_no
      from brc.jobs j
      left join brc.job_attempts a
             on a.job_id = j.id and a.slot_status = 'reserved'
     where j.status = 'reserved'
       and j.hold_expires_at is not null
       and j.hold_expires_at < now()
     for update of j
  loop
    update brc.jobs
       set critical = true, hold_expires_at = null, updated_at = now()
     where id = r.id;

    update brc.job_attempts
       set slot_status = 'critical',
           hold_expires_at = null,
           outcome_note = 'انتهت مهلة 24 ساعة دون قرار — بانتظار قرار الشركة (توظيف / إرجاع / حذف)'
     where job_id = r.id and slot_status = 'reserved';

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('system', 'system', 'حالة حرجة (انتهاء 24 ساعة)', 'job', r.code,
            'انتهت المهلة دون قرار — الوظيفة مقفلة بانتظار قرار الموظف، والفرصة #' || coalesce(r.attempt_no::text, '—') ||
            ' للبطاقة ' || coalesce(r.reserved_by, '—') || ' في حالة حرجة');

    released_job := r.code; expired_form := r.reserved_by;
    return next;
  end loop;

  -- (ب) استمارات انتهت صلاحيتها (30 يوماً)
  for r in
    select serial from brc.applicants
     where status = 'active' and now() > expiry_date
     for update
  loop
    update brc.applicants set status = 'expired', updated_at = now() where serial = r.serial;

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('system', 'system', 'انتهاء بطاقة', 'applicant', r.serial, 'انتهت صلاحية البطاقة (30 يوماً)');

    released_job := null; expired_form := r.serial;
    return next;
  end loop;

  -- (ج) بطاقات استُهلكت فرصها (لا فرصة فارغة ولا فرصة قيد اللعب)
  update brc.applicants f
     set status = 'exhausted', updated_at = now()
   where f.status = 'active'
     and not exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty')
     and not exists (select 1 from brc.job_attempts a where a.serial = f.serial
                       and a.slot_status in ('reserved', 'critical'));

  /* التوظيف لا يُنهي البطاقة (قرار مقفل 2026-09-30): لا حالة completed —
     يبقى للزبون حقه في فرصته الأخرى حتى نهاية مدة البطاقة. */

  return;
end $$;

create or replace function brc.verify_form(p_serial text, p_token text default null)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare v jsonb; f record; v_ok boolean;
begin
  select * into f from brc.applicants where serial = p_serial;
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الرقم');
  end if;

  v_ok := (p_token is not null
           and (p_token = left(brc.verify_token(f.serial), 8) or p_token = brc.verify_token(f.serial)));

  select jsonb_build_object(
    'ok', true,
    'serial', f.serial,
    'fullName', f.full_name,
    'phone', f.phone,
    'issueDate', f.issue_date,
    'expiryDate', f.expiry_date,
    'status', f.status,
    'daysLeft', ceil(extract(epoch from (f.expiry_date - now())) / 86400.0),
    'attemptLimit', f.attempt_limit,
    'posName', coalesce(f.pos_name, ''),
    'requestedCode', f.requested_code,
    'rejectReason', coalesce(f.reject_reason, ''),
    'createdAt', f.created_at,
    'attemptsUsed', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status <> 'empty'),
    'attemptsLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
    'tokenOk', v_ok,
    /* ⚠️ خصوصية: بلا بصمة مطابقة تُقنَّع بيانات الباحث (الاسم والهاتف).
       السبب: الأرقام التسلسلية تُطلق تتابعاً (HRC-NO-000120, 121, …) فيستطيع
       أي زائر سحب أسماء وهواتف كل الباحثين بنداءات متتابعة — وهي بيانات أشخاص
       حقيقيين. البصمة المطبوعة في الكيو آر كود هي المفتاح، ومن يُدخل الرقم
       يدوياً يحصل على تأكيد صحة الاستمارة وحالتها بلا بيانات شخصية. */
    'fullName', case when v_ok then f.full_name else brc.mask_name(f.full_name) end,
    'phone',    case when v_ok then f.phone     else brc.mask_phone(f.phone)    end,
    'masked',   not v_ok,
    'attempts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'no', a.attempt_no,
               'jobCode', coalesce(a.job_code, '—'),
               'jobTitle', coalesce(j.title, '—'),
               'location', coalesce(j.region, '—'),
               'slotStatus', a.slot_status,
               /* رمز الفرصة سرّي: يُكشف فقط للبصمة الصحيحة (الموظف/الإدارة) */
               'code', case when v_ok then a.chance_code else null end,
               'selectedAt', a.selected_at,
               'holdExpiresAt', a.hold_expires_at,
               'closedAt', a.closed_at,
               'note', a.outcome_note) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
       where a.serial = f.serial)
  ) into v;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'تحقق من بطاقة (باركود)', 'applicant', f.serial, 'فحص عبر رابط التحقق');

  return v;
end $$;

create or replace function brc.lookup_card(p_serial text) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare f record;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على بطاقتك');
  end if;
  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'متابعة بطاقة (بطاقتي)', 'applicant', f.serial, 'عرض الحالة بالباركود — بيانات مقنّنة');

  return jsonb_build_object(
    'ok', true,
    'serial', f.serial,
    'fullName', brc.mask_name(f.full_name),
    'phone', brc.mask_phone(f.phone),
    'status', f.status,
    'issueDate', f.issue_date,
    'expiryDate', f.expiry_date,
    'chancesLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
    'succeeded', exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'succeeded'),
    'chances', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'no', a.attempt_no,
               'slotStatus', a.slot_status,
               'jobCode', a.job_code,
               'jobTitle', j.title,
               'location', j.region,
               'selectedAt', a.selected_at,
               'holdExpiresAt', a.hold_expires_at,
               'note', case when a.slot_status in ('rejected', 'expired') then a.outcome_note else '' end
             ) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
       where a.serial = f.serial)
  );
end $$;

create or replace function brc.use_chance(p_serial text, p_code text, p_job_code text) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  a record;
  j record;
  hold_hours int;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;
  if f.status = 'expired' or now() > f.expiry_date then
    return jsonb_build_object('ok', false, 'error', 'انتهت صلاحية البطاقة (30 يوماً)');
  end if;
  if f.status in ('exhausted') then
    return jsonb_build_object('ok', false, 'error', 'استُهلكت فرص البطاقة — تشترى بطاقة جديدة من نقاط البيع');
  end if;

  -- الفرصة: خانة فارغة رمزها هو المُرسل (الرمز سرّي على ظهر البطاقة)
  select * into a from brc.job_attempts
   where serial = f.serial and slot_status = 'empty' and chance_code = upper(btrim(coalesce(p_code, '')))
   order by attempt_no limit 1;
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'رمز الفرصة غير صحيح — انسخ الرمز المطبوع على ظهر بطاقتك كما هو');
  end if;

  select * into j from brc.jobs where code = upper(btrim(coalesce(p_job_code, ''))) for update;
  if j.id is null then
    return jsonb_build_object('ok', false, 'error', 'الوظيفة غير موجودة');
  end if;
  if j.status <> 'available' then
    return jsonb_build_object('ok', false, 'error', 'الوظيفة غير متاحة حالياً (' || j.status || ')');
  end if;

  select coalesce((value->>'hold_hours')::int, 24) into hold_hours from brc.settings where key = 'rules';

  -- الحجز عبر المشغّل trg_attempt_hold (تحقق الشروط + قفل الوظيفة + تدقيق)
  update brc.job_attempts
     set slot_status = 'reserved',
         job_id = j.id,
         job_code = j.code,
         selected_at = now(),
         hold_expires_at = now() + make_interval(hours => hold_hours)
   where id = a.id
  returning * into a;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'تقديم ذاتي ببطاقة', 'applicant', f.serial,
          'الزبون ' || brc.mask_name(f.full_name) || ' استخدم الفرصة #' || a.attempt_no ||
          ' بنفسه من الموقع على الوظيفة ' || j.code);

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status,
      'jobCode', a.job_code, 'jobTitle', j.title,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at),
    'job', jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region)
  );
end $$;

create or replace function brc.verify_card_code(p_serial text, p_code text) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  hit record;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;

  -- إثبات الحيازة: رمز إحدى الفرصتين (المطبوع على ظهر البطاقة)
  select * into hit from brc.job_attempts
   where serial = f.serial and chance_code = upper(btrim(coalesce(p_code, '')))
   limit 1;
  if hit.id is null then
    return jsonb_build_object('ok', false, 'error', 'رمز الفرصة غير صحيح — انسخه كما هو من ظهر بطاقتك');
  end if;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'إعادة طباعة بطاقة', 'applicant', f.serial,
          'إثبات حيازة برمز الفرصة #' || hit.attempt_no || ' — حُملت الحمولة الكاملة للطباعة');

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'id', f.id, 'serial', f.serial, 'fullName', f.full_name, 'phone', f.phone,
      'issueDate', f.issue_date, 'expiryDate', f.expiry_date, 'posName', coalesce(f.pos_name, ''),
      'attempts', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status,
                 'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.region,
                 'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at,
                 'closedAt', a.closed_at, 'note', a.outcome_note
               ) order by a.attempt_no), '[]'::jsonb)
          from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
         where a.serial = f.serial)
    )
  );
end $$;
-- 7) المنح: دوال «بطاقتي» للزائر العام (أُعيدت كتابة سياسة الزائر)
grant execute on function brc.lookup_card(text)           to anon, authenticated;
grant execute on function brc.use_chance(text, text, text) to anon, authenticated;
grant execute on function brc.verify_card_code(text, text) to anon, authenticated;

-- 8) تنظيف حالات قديمة: لا completed بعد الآن (التوظيف لا يُنهي البطاقة)
update brc.applicants set status = 'active', updated_at = now()
 where status = 'completed'
   and (expiry_date is null or expiry_date > now());
update brc.applicants f
   set status = 'exhausted', updated_at = now()
 where f.status = 'active'
   and not exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty')
   and not exists (select 1 from brc.job_attempts a where a.serial = f.serial
                     and a.slot_status in ('reserved', 'critical'));

-- ملاحظة: الحجوزات المنتهية مهلتها قبل الترقية (expired قديمة) تُترك كما هي
-- سجلاً تاريخياً؛ الجديدة تُعالج بـ brc.run_auto_release() المحذَّثة (حالة حرجة).
