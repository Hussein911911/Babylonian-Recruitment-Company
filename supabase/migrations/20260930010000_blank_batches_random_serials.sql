-- ===========================================================================
--  BRC — الدفعات الفارغة + الباركود العشوائي الفريد (2026-09-30 / ج2)
-- ---------------------------------------------------------------------------
--  ترقية تفاضلية idempotent لقاعدة بيانات قائمة. النموذج الجديد:
--    • الشركة تصدر دفعات بطاقات **فارغة** (بلا اسم/هاتف) بباركود عشوائي
--      فريد لا يتشابه مع أي بطاقة أخرى — يُطبع وتوزَّع على نقاط البيع.
--    • التعبئة عند البيع: بيانات الزبون تُسجَّل على نفس الباركود، وصلاحية
--      30 يوماً تبدأ من التعبئة (issue_date/expiry_date تصبحان قابلتين للفراغ).
--    • سجل issued_serials يضمن ألا يعود باركود أبداً ولو حُذفت بطاقته.
-- ===========================================================================

-- 1) حالة «فارغة» بالتعداد
alter type brc.form_status add value if not exists 'blank';

-- 2) التاريخان يقبلان الفراغ (البطاقة الفارغة بلا صلاحية بعد)
alter table brc.applicants alter column issue_date  drop not null;
alter table brc.applicants alter column expiry_date drop not null;

-- 3) سجل الباركودات الدائم + التعبئة الرجعية
create table if not exists brc.issued_serials (
  serial    text primary key,
  issued_at timestamptz not null default now(),
  note      text default ''
);
alter table brc.issued_serials enable row level security;
create index if not exists issued_serials_serial_idx on brc.issued_serials (serial);
insert into brc.issued_serials (serial)
  select serial from brc.applicants on conflict (serial) do nothing;



-- 4) مشغّل تسجيل كل باركود جديد (حتى المسار اليدوي/الاستيراد)
drop trigger if exists trg_applicants_log_serial on brc.applicants;
create trigger trg_applicants_log_serial after insert or update of serial on brc.applicants
  for each row execute function brc.trg_log_issued_serial();

-- 5) الدوال المحدَّثة (منسوخة حرفياً من docs/schema.sql)
create or replace function brc.next_form_serial() returns text
language plpgsql
as $$
declare v text;
begin
  loop
    v := 'HRC-BC-' || lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
    exit when not exists (select 1 from brc.issued_serials where serial = v)
           and not exists (select 1 from brc.applicants where serial = v);
  end loop;
  insert into brc.issued_serials (serial) values (v)
    on conflict (serial) do nothing;
  -- إصلاح 2026-10-03: return كان داخل اللوب — الخروج بلا قيمة (2F005)
  return v;
end $$;

create or replace function brc.trg_log_issued_serial() returns trigger
language plpgsql security definer
set search_path = brc, public
as $$
begin
  insert into brc.issued_serials (serial) values (new.serial)
    on conflict (serial) do nothing;
  return new;
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
    /* الصلاحية تبدأ عند البيع (التعبئة) لا عند إصدار الدفعة الفارغة:
       البطاقة الفارغة (blank) بلا issue_date وتبقى expiry_date فارغة. */
    if new.expiry_date is null and new.issue_date is not null then
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
  if f.status = 'blank' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة فارغة ولم تُبع بعد — إذا عُرضت لك للبيع فخابر الشركة فوراً لتفادي التزوير');
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
  if f.status = 'blank' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة فارغة ولم تُبع بعد');
  end if;
  if f.status = 'expired' or (f.expiry_date is not null and now() > f.expiry_date) then
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

-- 6) ملاحظة: لا ترحيل بيانات — البطاقات الموجودة تبقى بحالتها؛ الدفعات
--    الفارغة الجديدة تُدرج بـ status='blank' و issue_date=null من الواجهة.
