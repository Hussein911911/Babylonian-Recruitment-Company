-- ===========================================================================
--  شركة بابل للتوظيف (BRC) — مخطط قاعدة البيانات الكامل لـ PostgreSQL / Supabase
--  ---------------------------------------------------------------------------
--  يتضمّن:
--   • الجداول والقيود والفهارس (وظائف، باحثون/استمارات، محاولات، تدقيق، إعدادات)
--   • مشغّلات (Triggers) للحجز المؤقت 24 ساعة، الإفراج التلقائي، وإعادة التفعيل
--   • توليد الأكواد: BRC-1042 للوظائف و BRC-NO-000120 للاستمارات
--   • سجل تدقيق لحظي (بالثانية + المستخدم + IP + التفاصيل)
--   • سياسات RLS: الزائر يرى البيانات العامة فقط، الموظف يدير، المدير يرى المالية
--   • دوال RPC للتحقق بالكيو آر كود وللترشيح وتثبيت النتائج
--
--  طريقتان للتشغيل على Supabase (اختر واحدة):
--   1) تلقائي (موصى به): نفس الملف منسوخ في
--      supabase/migrations/20260915000000_brc_initial_schema.sql
--      وتكاملة GitHub في Supabase تُطبّقه تلقائياً عند الدمج في main.
--   2) يدوي: SQL Editor → الصق الملف → Run
--
--  ⚠️ الملفان يجب أن يبقيا متطابقين حرفياً. عند أي تعديل:
--        npm run schema:sync      (ينسخ docs/schema.sql → ملف الـ migration)
--     و npm run test:schema يفشل إذا انحرفا.
--  ⚠️ لا تضع أي سرّ في هذا الملف — المستودع عام. المفتاح app.brc_secret يُضبط يدوياً.
-- ===========================================================================

-- ⚠️ على Supabase: pgcrypto و pg_cron تُفعَّلان من اللوحة (Database → Extensions)،
--    ومحاولة إنشائهما بـ SQL قد تفشل بصلاحية غير كافية — وحينها يتوقف الملف كله
--    عند هذا السطر ولا يُنشأ أي جدول. لذلك نغلّفهما بحيث لا يُسقطان السكربت،
--    مع تنبيه واضح بأي امتداد ينقص.
do $$ begin
  create extension if not exists "pgcrypto" with schema extensions;
exception when others then
  begin
    create extension if not exists "pgcrypto";
  exception when others then
    raise notice 'pgcrypto غير مفعّل — فعّله من Database → Extensions قبل التشغيل (التفاصيل: %)', sqlerrm;
  end;
end $$;

do $$ begin
  create extension if not exists "pg_cron" with schema pg_catalog;
exception when others then
  begin
    create extension if not exists "pg_cron";
  exception when others then
    raise notice 'pg_cron غير مفعّل — فعّله من Database → Extensions (بدونه لن يعمل الإفراج التلقائي كل دقيقة) — التفاصيل: %', sqlerrm;
  end;
end $$;

create schema if not exists brc;
set search_path = brc, public;

-- ===========================================================================
--  1) الأنواع (Enums)
-- ===========================================================================
do $$ begin
  create type brc.job_status  as enum ('available', 'reserved', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type brc.slot_status as enum ('empty', 'reserved', 'succeeded', 'rejected', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type brc.form_status as enum ('active', 'expired', 'exhausted', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type brc.user_role   as enum ('admin', 'staff');
exception when duplicate_object then null; end $$;

-- ===========================================================================
--  2) الجداول الأساسية
-- ===========================================================================

-- 2.1 الموظفون (مرتبطون بـ auth.users في Supabase)
create table if not exists brc.staff (
  id           uuid primary key default gen_random_uuid(),
  auth_id      uuid unique references auth.users (id) on delete set null,
  username     text not null unique,
  full_name    text not null,
  role         brc.user_role not null default 'staff',
  job_title    text default '',
  phone        text default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- 2.3 الاستمارات (الباحثون عن عمل) — صالحة 30 يوماً، 5 محاولات
create table if not exists brc.applicants (
  id            uuid primary key default gen_random_uuid(),
  serial        text not null unique,                            -- BRC-NO-000120
  full_name     text not null,
  phone         text not null,
  address       text default '',
  dob           date,
  gender        text default 'ذكر',
  nationality   text default 'عراقي',
  issue_date    timestamptz not null default now(),
  expiry_date   timestamptz not null default (now() + interval '30 days'),
  attempt_limit smallint not null default 5 check (attempt_limit between 1 and 10),
  status        brc.form_status not null default 'active',
  fee_amount    integer not null default 10000,
  fee_paid      boolean not null default false,
  printed_count integer not null default 0,
  requested_code text,                                           -- الوظيفة المطلوبة من الموقع العام
  reject_reason text default '',                                 -- سبب الرفض (يظهر للباحث في صفحة التحقق)
  created_by    uuid references brc.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  notes         text default ''
);
create index if not exists applicants_status_idx on brc.applicants (status);
create index if not exists applicants_expiry_idx on brc.applicants (expiry_date);
create index if not exists applicants_created_by_idx on brc.applicants (created_by);

-- 2.2 الوظائف (بيانات صاحب العمل داخلية ولا تُعرض للعامة)
create table if not exists brc.jobs (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,                      -- BRC-1042
  title               text not null,
  category            text not null default 'خدمات',
  region              text not null,                             -- منطقة بابل
  shift               text not null default 'صباحي',
  salary_min          integer not null default 0 check (salary_min >= 0),
  salary_max          integer not null default 0 check (salary_max >= salary_min),
  gender              text not null default 'لا فرق',
  vacancies           integer not null default 1 check (vacancies >= 1),
  requirements        text[] not null default '{}',
  description         text default '',

  -- بيانات محجوبة عن العرض العام (RLS/View)
  employer_name       text not null,
  employer_phone      text not null,
  employer_address    text default '',
  interview_location  text default '',

  status              brc.job_status not null default 'available',
  reserved_by         text references brc.applicants (serial) on delete set null,  -- استمارة الحجز الحالي
  hold_expires_at     timestamptz,                               -- مهلة 24 ساعة
  closed_at           timestamptz,
  notes               text default '',                           -- ملاحظات داخلية على الوظيفة
  image_url           text default '',                           -- صورة بطاقة الوظيفة
  created_by          uuid references brc.staff (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint jobs_hold_consistency check (
    (status = 'reserved' and hold_expires_at is not null) or status <> 'reserved'
  )
);

-- 2.4 المحاولات (5 خانات لكل استمارة)
create table if not exists brc.job_attempts (
  id                uuid primary key default gen_random_uuid(),
  serial            text not null references brc.applicants (serial) on delete cascade,
  attempt_no        smallint not null check (attempt_no between 1 and 10),
  job_id            uuid references brc.jobs (id) on delete set null,
  job_code          text,
  slot_status       brc.slot_status not null default 'empty',
  selected_at       timestamptz,
  hold_expires_at   timestamptz,
  closed_at         timestamptz,
  outcome_note      text default '',
  staff_id          uuid references brc.staff (id) on delete set null,
  unique (serial, attempt_no)
);
create index if not exists attempts_serial_idx on brc.job_attempts (serial);
create index if not exists attempts_job_idx on brc.job_attempts (job_id);
create index if not exists attempts_hold_idx on brc.job_attempts (hold_expires_at)
  where slot_status = 'reserved';

-- 2.5 سجل التدقيق اللحظي
create table if not exists brc.audit_log (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  user_id     uuid references brc.staff (id) on delete set null,
  username    text default 'system',
  role        text default 'system',
  ip          text default '',
  action      text not null,
  entity      text default '',
  entity_id   text default '',
  details     text default '',
  diff        jsonb
);
create index if not exists audit_ts_idx on brc.audit_log (ts desc);
create index if not exists audit_user_idx on brc.audit_log (username);

-- 2.6 الإعدادات العامة
create table if not exists brc.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references brc.staff (id) on delete set null
);

insert into brc.settings (key, value) values
  ('rules', jsonb_build_object(
      'attempt_limit', 5,
      'validity_days', 30,
      'hold_hours', 24,
      'form_fee', 10000,
      'auto_release', true)),
  ('company', jsonb_build_object(
      'nameAr',      'شركة بابل للتوظيف',
      'nameEn',      'Babylonian Recruitment Company',
      'legalName',   'شركة بابل للتوظيف',
      'slogan',      'نوفّر الأيادي العاملة الفنية والتخصصية في بابل والفرات الأوسط',
      'phones',      jsonb_build_array('07760058007', '07715993271'),
      'address',     'حلة - شارع 60 - قرب مدينة حمورابي - قرب مجمع الكرعاوي',
      'addressShort','الحلة – بابل، العراق',
      'email',       'contact@brc-babil.com',
      'hours',       'السبت – الخميس: 9:00 صباحاً – 5:00 مساءً',
      'holiday',     'الجمعة: عطلة رسمية',
      'license',     'إجازة عمل رسمية / وزارة العمل والشؤون الاجتماعية',
      'branch',      'بابل – الحلة',
      'verify_base', 'https://brc-babil.com/verify',
      'disclaimer',  'ملاحظات مهمة: خدمات الشركة تنحصر في توفير الأيادي العاملة من الناحية الفنية والتخصصية فقط وليس الأمنية. الشركة غير مسؤولة قانونياً وعشائياً عن الشخص المرسل وصاحب العمل.'))
on conflict (key) do nothing;

-- ===========================================================================
--  3) توليد الأكواد التسلسلية
-- ===========================================================================
create sequence if not exists brc.job_code_seq  start 1042;
create sequence if not exists brc.form_serial_seq start 120;

create or replace function brc.next_job_code() returns text
language plpgsql as $$
declare v text;
begin
  loop
    v := 'BRC-' || nextval('brc.job_code_seq')::text;
    exit when not exists (select 1 from brc.jobs where code = v);
  end loop;
  return v;
end $$;

create or replace function brc.next_form_serial() returns text
language plpgsql as $$
declare v text;
begin
  loop
    v := 'BRC-NO-' || lpad(nextval('brc.form_serial_seq')::text, 6, '0');
    exit when not exists (select 1 from brc.applicants where serial = v);
  end loop;
  return v;
end $$;

-- بصمة التحقق المطبوعة داخل الكيو آر كود (توقيع HMAC عبر مفتاح الخادم)
-- ⚠️ لا تضع سرّاً افتراضياً مكتوباً في الملف: هذا الملف منشور في المستودع، فأي سرّ مكتوب
--    هنا يصبح معروفاً للجميع ويصير تزوير البصمة ممكناً. يجب ضبط المفتاح قبل الاستخدام:
--      alter database postgres set app.brc_secret = '<مفتاح عشوائي 32+ حرفاً>';
--      -- ثم أعد الاتصال (أو: select pg_reload_conf();)
--    أو من Supabase: Project Settings → Database → Configuration → Custom settings.
--    توليد مفتاح قوي:  openssl rand -hex 32
-- ملاحظة: أُضيف extensions للمسار لأن Supabase يثبّت pgcrypto (دالة hmac) في سكيما
-- extensions وليس public، فبدونها يفشل النداء بـ «function hmac(...) does not exist».
create or replace function brc.verify_token(p_serial text) returns text
language plpgsql stable
set search_path = brc, public, extensions
as $$
declare v_secret text := nullif(current_setting('app.brc_secret', true), '');
begin
  -- إن لم يُضبط المفتاح نتوقف بخطأ واضح بدل استخدام سرّ مكشوف في المستودع
  if v_secret is null or length(v_secret) < 16 then
    raise exception 'app.brc_secret غير مضبوط أو أقصر من 16 حرفاً — راجع تعليمات ضبط المفتاح أعلى الدالة في docs/schema.sql'
      using errcode = '22023';
  end if;
  return encode(hmac(p_serial, v_secret, 'sha256'), 'hex');
end $$;

-- ===========================================================================
--  4) المشغّلات (Triggers)
-- ===========================================================================

-- 4.1 توليد الكود/الرقم التسلسلي تلقائياً + ضبط تواريخ الصلاحية
create or replace function brc.trg_defaults() returns trigger
language plpgsql as $$
declare rules jsonb;
begin
  select value into rules from brc.settings where key = 'rules';

  if tg_table_name = 'jobs' and coalesce(new.code, '') = '' then
    new.code := brc.next_job_code();
  end if;

  if tg_table_name = 'applicants' then
    if coalesce(new.serial, '') = '' then
      new.serial := brc.next_form_serial();
    end if;
    if new.attempt_limit is null or new.attempt_limit = 5 then
      new.attempt_limit := coalesce((rules->>'attempt_limit')::smallint, 5);
    end if;
    if new.fee_amount is null or new.fee_amount = 10000 then
      new.fee_amount := coalesce((rules->>'form_fee')::integer, 10000);
    end if;
    if new.expiry_date is null then
      new.expiry_date := new.issue_date + make_interval(days => coalesce((rules->>'validity_days')::int, 30));
    end if;
    -- إنشاء خانات المحاولات الخمس تلقائياً
    insert into brc.job_attempts (serial, attempt_no)
    select new.serial, gs from generate_series(1, new.attempt_limit) gs
    on conflict (serial, attempt_no) do nothing;
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_jobs_defaults on brc.jobs;
create trigger trg_jobs_defaults before insert or update on brc.jobs
  for each row execute function brc.trg_defaults();

drop trigger if exists trg_applicants_defaults on brc.applicants;
create trigger trg_applicants_defaults before insert on brc.applicants
  for each row execute function brc.trg_defaults();

-- 4.2 حجز الوظيفة مؤقتاً 24 ساعة عند اختيار محاولة + منع الحجز المزدوج
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
      raise exception 'الاستمارة % غير موجودة', new.serial;
    end if;
    if now() > form_row.expiry_date then
      raise exception 'انتهت صلاحية الاستمارة % (30 يوماً)', new.serial using errcode = 'P0001';
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
            'الاستمارة ' || new.serial || ' — المحاولة #' || new.attempt_no);
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
           closed_at = case when new.slot_status = 'succeeded' then now() else null end,
           updated_at = now()
     where id = new.job_id;

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values (coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb->>'sub', 'staff',
            case when new.slot_status = 'succeeded' then 'إتمام توظيف' else 'رفض مرشح' end,
            'job', new.job_code,
            case when new.slot_status = 'succeeded'
                 then 'تم التوظيف وإغلاق الوظيفة'
                 else 'أُعيدت الوظيفة إلى (متاحة) وتُفعَّل المحاولة التالية تلقائياً' end
            || coalesce(' | ' || nullif(new.outcome_note, ''), ''));
  end if;

  return new;
end $$;

drop trigger if exists trg_attempt_hold on brc.job_attempts;
create trigger trg_attempt_hold before insert or update on brc.job_attempts
  for each row execute function brc.trg_attempt_hold();

-- 4.3 منع ترشيح نفس الوظيفة أكثر من مرة للاستمارة نفسها
create or replace function brc.trg_no_duplicate_job() returns trigger
language plpgsql as $$
begin
  if new.job_id is not null and exists (
    select 1 from brc.job_attempts a
     where a.serial = new.serial and a.job_id = new.job_id
       and a.attempt_no <> new.attempt_no
       and a.slot_status in ('reserved', 'succeeded')
  ) then
    raise exception 'الوظيفة مرشّحة مسبقاً على هذه الاستمارة' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_no_duplicate_job on brc.job_attempts;
create trigger trg_no_duplicate_job before insert or update on brc.job_attempts
  for each row execute function brc.trg_no_duplicate_job();

-- 4.4 تدقيق تلقائي على كل تغيير (بالثانية + المستخدم + IP + الفروق)
create or replace function brc.trg_audit() returns trigger
language plpgsql security definer
set search_path = brc, public
as $$
declare
  claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  hdrs   jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  uname  text  := coalesce(claims->>'email', claims->>'sub', 'system');
  rname  text  := coalesce(nullif(current_setting('app.brc_role', true), ''), 'staff');
  before_row jsonb;
  after_row  jsonb;
begin
  if tg_op = 'INSERT' then before_row := null; after_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then before_row := to_jsonb(old); after_row := to_jsonb(new);
  else before_row := to_jsonb(old); after_row := null;
  end if;

  insert into brc.audit_log (username, role, ip, action, entity, entity_id, details, diff)
  values (
    uname, rname,
    coalesce(split_part(coalesce(hdrs->>'x-forwarded-for', hdrs->>'x-real-ip', ''), ',', 1), ''),
    case tg_op when 'INSERT' then 'إضافة' when 'UPDATE' then 'تعديل' else 'حذف' end || ' ' || tg_table_name,
    tg_table_name,
    coalesce(after_row->>'code', after_row->>'serial', before_row->>'code', before_row->>'serial', ''),
    'تغيير في ' || tg_table_name,
    jsonb_build_object('before', before_row, 'after', after_row)
  );
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit_jobs on brc.jobs;
create trigger trg_audit_jobs after insert or update or delete on brc.jobs
  for each row execute function brc.trg_audit();

drop trigger if exists trg_audit_applicants on brc.applicants;
create trigger trg_audit_applicants after insert or update or delete on brc.applicants
  for each row execute function brc.trg_audit();

drop trigger if exists trg_audit_attempts on brc.job_attempts;
create trigger trg_audit_attempts after insert or update or delete on brc.job_attempts
  for each row execute function brc.trg_audit();

-- ===========================================================================
--  5) الإفراج التلقائي بعد 24 ساعة + انتهاء صلاحية الاستمارات (30 يوماً)
--     تُنفَّذ دورياً عبر pg_cron (كل دقيقة) أو عبر Edge Function.
-- ===========================================================================
create or replace function brc.run_auto_release() returns table (released_job text, expired_form text)
language plpgsql as $$
declare r record;
begin
  -- (أ) حجوزات انتهت مهلتها دون تثبيت النتيجة
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
       set status = 'available', reserved_by = null, hold_expires_at = null, updated_at = now()
     where id = r.id;

    update brc.job_attempts
       set slot_status = 'expired',
           closed_at = now(),
           hold_expires_at = null,
           outcome_note = 'انتهت مهلة 24 ساعة دون تثبيت نتيجة المقابلة — تتطلب إجراء'
     where job_id = r.id and slot_status = 'reserved';

    insert into brc.audit_log (username, role, action, entity, entity_id, details)
    values ('system', 'system', 'إفراج تلقائي (24 ساعة)', 'job', r.code,
            'انتهت المهلة — أُعيدت الوظيفة إلى (متاحة) ووُسمت المحاولة #' || coalesce(r.attempt_no::text, '—') ||
            ' للاستمارة ' || coalesce(r.reserved_by, '—') || ' بـ (انتهت المهلة)');

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
    values ('system', 'system', 'انتهاء استمارة', 'applicant', r.serial, 'انتهت صلاحية الاستمارة (30 يوماً)');

    released_job := null; expired_form := r.serial;
    return next;
  end loop;

  -- (ج) استمارات استُهلكت محاولاتها
  update brc.applicants f
     set status = 'exhausted', updated_at = now()
   where f.status = 'active'
     and not exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty')
     and not exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'succeeded');

  update brc.applicants f
     set status = 'completed', updated_at = now()
   where f.status <> 'completed'
     and exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'succeeded');

  return;
end $$;

-- جدولة التنفيذ كل دقيقة (Supabase: pg_cron)
do $$ begin
  perform cron.schedule('brc-auto-release', '* * * * *', $cron$ select * from brc.run_auto_release(); $cron$);
exception when others then
  raise notice 'pg_cron غير متاح — يمكن جدولة brc.run_auto_release() عبر Edge Function/Scheduler: %', sqlerrm;
end $$;

-- ===========================================================================
--  6) الواجهات العامة (Views)
-- ===========================================================================

-- 6.1 وظائف العرض العام: بلا أي بيانات لصاحب العمل
create or replace view brc.public_jobs
with (security_invoker = false) as
  select code, title, category, region, shift, salary_min, salary_max, gender,
         vacancies, requirements, status,
         (status = 'reserved') as is_reserved,
         hold_expires_at,
         created_at,
         -- الوصف والصورة جزء من الإعلان نفسه فيظهران للزائر (بخلاف اسم صاحب
         -- العمل وهاتفه ومكان المقابلة التي تبقى محجوبة للداخل). بدون هذين
         -- العمودين تظهر بطاقات الوظائف في الموقع العام بلا وصف ولا صورة.
         coalesce(description, '') as description,
         coalesce(image_url, '') as image_url
    from brc.jobs
   where status <> 'closed' or created_at > now() - interval '120 days';

comment on view brc.public_jobs is 'واجهة عامة للوظائف — تُخفي اسم/هاتف/عنوان صاحب العمل ومكان المقابلة';

-- 6.2 نتيجة التحقق من الاستمارة
-- ⚠️ أمان: هذه الواجهة تعرض اسم كل باحث ورقمه بلا أي تحقق من البصمة، فهي **للاستخدام
--    الداخلي/التشخيصي فقط ولا تُمنح لدور anon أبداً**. منحها للزائر يعني سحب أسماء كل
--    الباحثين بنداء واحد، وتصبح البصمة المطبوعة في الكيو آر كود بلا قيمة.
--    التحقق العام يتم حصراً عبر brc.verify_form(serial, token) — تُرجع استمارة واحدة.
create or replace view brc.public_verification
with (security_invoker = false) as
  select f.serial, f.full_name, f.issue_date, f.expiry_date, f.status, f.attempt_limit,
         (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status <> 'empty') as attempts_used,
         (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty') as attempts_left
    from brc.applicants f;

-- 6.3 اللوحة المالية لكل موظف
create or replace view brc.v_financials_by_staff as
  select s.id as staff_id,
         s.username,
         s.full_name,
         count(f.id)                                             as forms_issued,
         coalesce(sum(f.printed_count), 0)                       as total_prints,
         coalesce(sum(f.fee_amount), 0)                          as expected_collection,
         coalesce(sum(case when f.fee_paid then f.fee_amount end), 0) as collected,
         count(a.id) filter (where a.slot_status = 'succeeded')  as hires,
         count(a.id) filter (where a.slot_status = 'reserved')   as active_holds
    from brc.staff s
    left join brc.applicants f on f.created_by = s.id
    left join brc.job_attempts a on a.serial = f.serial
   group by s.id, s.username, s.full_name;

-- 6.4 لوحة المتابعة: إجراءات مطلوبة
create or replace view brc.v_pending_actions as
  select 'hold'::text as kind, j.code as reference, j.reserved_by as serial,
         j.hold_expires_at as due_at,
         round(extract(epoch from (j.hold_expires_at - now())) / 3600.0, 1) as hours_left,
         'حجز مؤقت بانتظار نتيجة المقابلة'::text as description
    from brc.jobs j
   where j.status = 'reserved'
  union all
  select 'expired_attempt', a.job_code, a.serial, a.closed_at, null,
         'انتهت مهلة 24 ساعة — تتطلب إجراء'
    from brc.job_attempts a
   where a.slot_status = 'expired'
  union all
  select 'expired_form', f.serial, f.serial, f.expiry_date, null,
         'استمارة منتهية الصلاحية (30 يوماً)'
    from brc.applicants f
   where f.status = 'expired';

-- ===========================================================================
--  7) دوال RPC (تُنادى من الواجهة)
-- ===========================================================================

-- 7.1 التحقق من استمارة عبر الكيو آر كود (عام — يتطلب بصمة صحيحة)
-- 7.1 التحقق من استمارة عبر الكيو آر كود (متاح للزائر)
-- ⚠️ لا تُضِف stable/immutable هنا: الدالة تُسجّل سطر تدقيق (INSERT) في آخرها،
--    وPostgreSQL يرفض الكتابة داخل دالة غير volatile بـ:
--    «INSERT is not allowed in a non-volatile function» → كل فحص كيو آر كود يفشل.
create or replace function brc.verify_form(p_serial text, p_token text default null)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare v jsonb; f record; v_ok boolean;
begin
  select * into f from brc.applicants where serial = p_serial;
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد استمارة بهذا الرقم');
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
    'requestedCode', f.requested_code,
    'rejectReason', coalesce(f.reject_reason, ''),
    'createdAt', f.created_at,
    'attemptsUsed', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status <> 'empty'),
    'attemptsLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
    'tokenOk', v_ok,
    /* ⚠️ خصوصية: بلا بصمة مطابقة تُقنَّع بيانات الباحث (الاسم والهاتف).
       السبب: الأرقام التسلسلية تُطلق تتابعاً (BRC-NO-000120, 121, …) فيستطيع
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
               'selectedAt', a.selected_at,
               'holdExpiresAt', a.hold_expires_at,
               'closedAt', a.closed_at,
               'note', a.outcome_note) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
       where a.serial = f.serial)
  ) into v;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'تحقق من استمارة (QR)', 'applicant', f.serial, 'فحص عبر رابط التحقق');

  return v;
end $$;

-- 7.1ب طلب استمارة إلكتروني من الموقع العام (بلا حساب ولا جلسة)
-- ---------------------------------------------------------------------------
--  لماذا دالة بدل إدراج مباشر؟ لأن anon ممنوع تماماً من جدول brc.applicants
--  (revoke all + لا سياسة له). فبلا دالة لا يمكن للزائر إرسال طلب أصلاً؛ ومع
--  الدالة يبقى الجدول محجوباً ويمرّ الطلب من مسار واحد نتحكم بمحتواه:
--    • تحقق من الاسم والهاتف
--    • حدّ إغراق (3 طلبات لنفس الرقم في 24 ساعة) — الدالة مفتوحة للزوار
--    • الحالة دائماً 'pending' مهما أرسل المتصل (لا يستطيع إصدار استمارة سارية)
--    • رقم التسلسل من تسلسل القاعدة، والدور والمبلغ من إعدادات القاعدة
--  الحقول الثابتة عمداً: status · serial · fee_amount · attempt_limit · created_by
create or replace function brc.request_form(
  p_full_name     text,
  p_phone         text,
  p_address       text default '',
  p_dob           date default null,
  p_gender        text default 'ذكر',
  p_notes         text default '',
  p_requested_code text default null
) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  v_serial text;
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_code   text := nullif(upper(btrim(coalesce(p_requested_code, ''))), '');
  v_recent int;
begin
  if length(v_name) < 2 or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'الاسم غير صالح');
  end if;
  if length(v_phone) < 7 or length(v_phone) > 20 then
    return jsonb_build_object('ok', false, 'error', 'رقم الهاتف غير صالح');
  end if;

  select count(*) into v_recent from brc.applicants
   where phone = v_phone and created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'وصلت طلبات كثيرة من هذا الرقم خلال 24 ساعة — راجع المكتب');
  end if;

  /* كود وظيفة غير معروف يُهمَل بدل رفض الطلب كله (نفس سلوك الواجهة) */
  if v_code is not null and not exists (select 1 from brc.jobs where code = v_code) then
    v_code := null;
  end if;

  /* بلا serial: المشغّل brc.trg_defaults يولّده من brc.next_form_serial()
     وينشئ خانات المحاولات الخمس. وissued/expiry لهما قيم افتراضية في الجدول
     (لا يمكن أن تكونا فارغتين: NOT NULL)، والقبول لاحقاً يعيد ضبطهما. */
  insert into brc.applicants (full_name, phone, address, dob, gender, status, notes,
                              requested_code, created_by)
  values (v_name, v_phone, coalesce(nullif(btrim(coalesce(p_address, '')), ''), ''),
          p_dob, coalesce(nullif(btrim(coalesce(p_gender, '')), ''), 'ذكر'),
          'pending',
          coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'طلب إلكتروني من الموقع'),
          v_code, null)
  returning serial into v_serial;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'طلب استمارة إلكتروني', 'applicant', v_serial,
          'طلب من الموقع العام — ' || v_name || coalesce(' — الوظيفة ' || v_code, ''));

  return jsonb_build_object('ok', true, 'serial', v_serial, 'status', 'pending');
end $$;

-- 7.1ج تقنيع بيانات الباحث للعرض العام بلا بصمة
--   الاسم: أول حرف + نقاط  ·  الهاتف: أول 4 وأخر 2 مع إخفاء الوسط
create or replace function brc.mask_name(p text) returns text
language sql immutable as $$
  select case
    when coalesce(p, '') = '' then ''
    when length(btrim(p)) <= 2 then left(btrim(p), 1) || '…'
    else left(btrim(p), 1) || repeat('•', least(length(btrim(p)) - 1, 12))
  end
$$;

create or replace function brc.mask_phone(p text) returns text
language sql immutable as $$
  select case
    when coalesce(p, '') = '' then ''
    when length(btrim(p)) <= 5 then left(btrim(p), 2) || '•••'
    else left(btrim(p), 4) || repeat('•', greatest(length(btrim(p)) - 6, 1)) || right(btrim(p), 2)
  end
$$;

-- 7.2 ترشيح وظيفة لمحاولة (موظف/مدير)
create or replace function brc.select_attempt(p_serial text, p_job_code text)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare slot record; job_row record;
begin
  if not brc.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'غير مصرّح');
  end if;

  select * into job_row from brc.jobs where code = p_job_code;
  if job_row.id is null then return jsonb_build_object('ok', false, 'error', 'الوظيفة غير موجودة'); end if;

  select * into slot from brc.job_attempts
   where serial = p_serial and slot_status = 'empty'
   order by attempt_no limit 1;
  if slot.id is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد محاولات متاحة على هذه الاستمارة');
  end if;

  update brc.job_attempts
     set job_id = job_row.id, job_code = job_row.code, slot_status = 'reserved',
         selected_at = now(), hold_expires_at = now() + interval '24 hours',
         staff_id = brc.current_staff_id()
   where id = slot.id;

  return jsonb_build_object('ok', true, 'attemptNo', slot.attempt_no, 'jobCode', job_row.code);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 7.3 تثبيت نتيجة المقابلة
create or replace function brc.set_outcome(p_serial text, p_attempt_no smallint, p_outcome text, p_note text default '')
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
begin
  if not brc.is_staff() then return jsonb_build_object('ok', false, 'error', 'غير مصرّح'); end if;
  if p_outcome not in ('succeeded', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'نتيجة غير صحيحة');
  end if;

  update brc.job_attempts
     set slot_status = p_outcome::brc.slot_status,
         outcome_note = coalesce(nullif(p_note, ''), outcome_note),
         staff_id = brc.current_staff_id()
   where serial = p_serial and attempt_no = p_attempt_no
     and slot_status = 'reserved';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'لا يوجد حجز جارٍ لهذه المحاولة');
  end if;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 7.4 إفراج يدوي عن حجز
create or replace function brc.release_hold(p_serial text, p_attempt_no smallint, p_reason text default '')
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
begin
  if not brc.is_staff() then return jsonb_build_object('ok', false, 'error', 'غير مصرّح'); end if;

  update brc.job_attempts
     set slot_status = 'expired',
         closed_at = now(),
         hold_expires_at = null,
         outcome_note = coalesce(nullif(p_reason, ''), 'إفراج يدوي عن الحجز')
   where serial = p_serial and attempt_no = p_attempt_no and slot_status = 'reserved';

  return jsonb_build_object('ok', found);
end $$;

-- 7.5 أدوات الصلاحية
-- ⚠️ حرجة: هذه الدوال تقرأ من brc.staff المُفعَّل عليه RLS، وسياسات brc.staff نفسها
--    تنادي هذه الدوال → حلقة مغلقة. لذلك يجب أن تكون SECURITY DEFINER (تعمل بصلاحية
--    مالك الدالة فتتجاوز RLS على brc.staff وتكسر الحلقة)، مع تثبيت search_path
--    لمنع اختطاف المسار (security definer بلا search_path ثابت = ثغرة حقن).
--    بدون security definer يفشل كل وصول بـ:
--    «infinite recursion detected in policy for relation "staff"»
create or replace function brc.current_staff_id() returns uuid
language sql stable security definer
set search_path = brc, public
as $$
  select id from brc.staff where auth_id = auth.uid() limit 1
$$;

create or replace function brc.is_staff() returns boolean
language sql stable security definer
set search_path = brc, public
as $$
  select exists (select 1 from brc.staff where auth_id = auth.uid() and active)
$$;

create or replace function brc.is_admin() returns boolean
language sql stable security definer
set search_path = brc, public
as $$
  select exists (select 1 from brc.staff where auth_id = auth.uid() and role = 'admin' and active)
$$;

-- ===========================================================================
--  8) سياسات أمان الصفوف (Row Level Security)
-- ===========================================================================
alter table brc.jobs         enable row level security;
alter table brc.applicants   enable row level security;
alter table brc.job_attempts enable row level security;
alter table brc.audit_log    enable row level security;
alter table brc.settings     enable row level security;
alter table brc.staff        enable row level security;

-- 8.1 الموظفون
drop policy if exists staff_self_read on brc.staff;
create policy staff_self_read on brc.staff for select
  using (brc.is_staff() and (auth_id = auth.uid() or brc.is_admin()));

drop policy if exists staff_admin_write on brc.staff;
create policy staff_admin_write on brc.staff for all
  using (brc.is_admin()) with check (brc.is_admin());

-- 8.2 الوظائف: لا وصول عام للجدول (العام يقرأ من brc.public_jobs)
drop policy if exists jobs_staff_all on brc.jobs;
create policy jobs_staff_all on brc.jobs for select using (brc.is_staff());

drop policy if exists jobs_staff_write on brc.jobs;
create policy jobs_staff_write on brc.jobs for insert with check (brc.is_staff());

drop policy if exists jobs_staff_update on brc.jobs;
create policy jobs_staff_update on brc.jobs for update using (brc.is_staff());

drop policy if exists jobs_admin_delete on brc.jobs;
create policy jobs_admin_delete on brc.jobs for delete using (brc.is_admin());

-- 8.3 الاستمارات: الموظف يدير كل الاستمارات، والمدير يحذف
drop policy if exists applicants_staff_read on brc.applicants;
create policy applicants_staff_read on brc.applicants for select using (brc.is_staff());

drop policy if exists applicants_staff_insert on brc.applicants;
create policy applicants_staff_insert on brc.applicants for insert with check (brc.is_staff());

drop policy if exists applicants_staff_update on brc.applicants;
create policy applicants_staff_update on brc.applicants for update using (brc.is_staff());

drop policy if exists applicants_admin_delete on brc.applicants;
create policy applicants_admin_delete on brc.applicants for delete using (brc.is_admin());

-- 8.4 المحاولات
drop policy if exists attempts_staff_read on brc.job_attempts;
create policy attempts_staff_read on brc.job_attempts for select using (brc.is_staff());

drop policy if exists attempts_staff_write on brc.job_attempts;
create policy attempts_staff_write on brc.job_attempts for all
  using (brc.is_staff()) with check (brc.is_staff());

-- 8.5 سجل التدقيق: المدير يرى الكل، الموظف يرى عملياته فقط، والإضافة للنظام فقط
drop policy if exists audit_read on brc.audit_log;
create policy audit_read on brc.audit_log for select
  using (brc.is_admin() or (brc.is_staff() and username = (select username from brc.staff where auth_id = auth.uid())));

--  الإضافة من الواجهة تكون باسم صاحب الجلسة أو باسم النظام؛ المشغّلات نفسها
--  security definer فتتجاوز هذه السياسة. بلا هذا القيد يستطيع أي موظف تزوير
--  سطر تدقيق باسم غيره (السجل هو دليل المراجعة، فقيمته في صدق النسبة).
drop policy if exists audit_insert on brc.audit_log;
create policy audit_insert on brc.audit_log for insert
  with check (
    brc.is_staff() and (
      username = (select username from brc.staff where auth_id = auth.uid())
      or username = 'system'
    )
  );

drop policy if exists audit_no_update on brc.audit_log;
create policy audit_no_update on brc.audit_log for update using (false);

drop policy if exists audit_no_delete on brc.audit_log;
create policy audit_no_delete on brc.audit_log for delete using (false);

-- 8.6 الإعدادات: قراءة للجميع داخل النظام، تعديل للمدير
drop policy if exists settings_read on brc.settings;
create policy settings_read on brc.settings for select using (brc.is_staff());

drop policy if exists settings_admin_write on brc.settings;
create policy settings_admin_write on brc.settings for all using (brc.is_admin()) with check (brc.is_admin());

-- ===========================================================================
--  9) الصلاحيات (Grants)
-- ===========================================================================
grant usage on schema brc to anon, authenticated;

-- ---------------------------------------------------------------------------
--  ⚠️ إبطال المنح الافتراضي — كان ثغرة أمنية حقيقية:
--
--  PostgreSQL يمنح EXECUTE على كل دالة جديدة لدور PUBLIC **تلقائياً**، وكل
--  الأدوار (بما فيها anon) أعضاء في PUBLIC. فكل دالة لم نذكرها كانت قابلة
--  للنداء من الزائر عبر:
--      POST /rest/v1/rpc/<اسم الدالة>
--
--  ⚠️ وإبطالها من anon وحده لا يكفي: anon يورث الصلاحية من PUBLIC فيبقى
--     قادراً. الإبطال الصحيح يكون **من public**، ثم نُعيد المنح لمن يحتاجه.
--
--  أخطرها brc.verify_token: تُرجع توقيع HMAC لأي رقم تسلسلي، والأرقام متسلسلة
--  ومطبوعة على الاستمارات (BRC-NO-000120، 121، …). فمن يناديها يحسب البصمة
--  الصحيحة لأي استمارة ويصوغ رابط كيو آر كود مزيّفاً — فتفقد البصمة المطبوعة
--  قيمتها الأمنية بالكامل.
--
--  لا تتأثر الأدوار التالية: مالك الدالة (له كل الصلاحيات) · وbrc.verify_form
--  SECURITY DEFINER فهي تنادي verify_token بصلاحية المالك لا بصلاحية الزائر.
-- ---------------------------------------------------------------------------
revoke execute on function brc.verify_token(text)    from public;
revoke execute on function brc.next_job_code()       from public;
revoke execute on function brc.next_form_serial()    from public;
revoke execute on function brc.request_form(text, text, text, date, text, text, text) from public;
revoke execute on function brc.mask_name(text)       from public;
revoke execute on function brc.mask_phone(text)      from public;
revoke execute on function brc.run_auto_release()    from public;
revoke execute on function brc.is_staff()            from public;
revoke execute on function brc.is_admin()            from public;
revoke execute on function brc.current_staff_id()    from public;

-- إعادة المنح لمن يحتاجها فعلاً (بعد الإبطال أعلاه):
--   • is_staff/is_admin/current_staff_id → تُنادى داخل سياسات RLS الخاصة
--     بالموظفين، فبدونها يفشل كل وصول للموظف بـ permission denied.
--   • next_job_code/next_form_serial → يناديها المشغّل brc.trg_defaults عند الإدراج.
grant execute on function brc.is_staff()            to authenticated, service_role;
grant execute on function brc.is_admin()            to authenticated, service_role;
grant execute on function brc.current_staff_id()    to authenticated, service_role;
grant execute on function brc.next_job_code()       to authenticated, service_role;
grant execute on function brc.next_form_serial()    to authenticated, service_role;

-- الزائر العام: يقرأ الواجهة العامة فقط + يستدعي التحقق
-- ⚠️ لا تُمنح brc.public_verification للزائر: تلك الواجهة تكشف serial + full_name + status
--    لكل الاستمارات بلا أي تحقق من البصمة t=، فيصير أي شخص يملك anon key قادراً على
--    سحب أسماء كل الباحثين بنداء واحد، وتصبح حماية البصمة في الكيو آر كود بلا معنى.
--    التحقق يتم حصراً عبر brc.verify_form (تتحقق من البصمة وتُرجع استمارة واحدة،
--    وتُقنّع الاسم والهاتف إن لم تكن البصمة مطابقة).
--    والطلب الإلكتروني يمرّ عبر brc.request_form التي تتحقق من المدخلات وتضع
--    الحالة 'pending' دائماً — فالزائر لا يستطيع إصدار استمارة سارية.
grant select on brc.public_jobs to anon, authenticated;
grant execute on function brc.verify_form(text, text) to anon, authenticated;
grant execute on function brc.request_form(text, text, text, date, text, text, text) to anon, authenticated;

-- الموظفون (authenticated): كل عمليات الإدارة
grant select, insert, update on brc.jobs, brc.applicants, brc.job_attempts to authenticated;
grant select on brc.audit_log, brc.settings, brc.staff, brc.v_financials_by_staff, brc.v_pending_actions to authenticated;

--  ⚠️ الدرس المستفاد: سياسة RLS **لا تمنح** صلاحية، بل تقيّد صلاحية قائمة.
--     فكل جدول تحتاجه الواجهة كتابةً يجب أن يكون له GRANT صريح، وإلا فالطلب
--     يُرفض بـ 42501 «permission denied» **حتى لو وُجدت السياسة**. الأعمدة
--     التالية أُضيفت لأن الواجهة تكتبها فعلاً (تعديل إعدادات، إدراج سطور تدقيق،
--     حذف وظيفة/استمارة) — وكلها تبقى مقيّدة بالسياسات أعلاه:
--       • settings:     التعديل للمدير فقط (settings_admin_write)
--       • audit_log:    الإضافة باسم صاحب الجلسة أو 'system' (audit_insert)
--       • delete jobs/applicants: للمدير فقط (jobs_admin_delete …)
grant insert on brc.audit_log to authenticated;
grant insert, update on brc.settings to authenticated;
grant delete on brc.jobs, brc.applicants to authenticated;
grant execute on function brc.select_attempt(text, text) to authenticated;
grant execute on function brc.set_outcome(text, smallint, text, text) to authenticated;
grant execute on function brc.release_hold(text, smallint, text) to authenticated;
grant execute on function brc.run_auto_release() to authenticated, service_role;

-- منع الوصول المباشر للجداول الحساسة من الزائر
revoke all on brc.jobs, brc.applicants, brc.job_attempts, brc.audit_log, brc.staff, brc.settings from anon;

-- ===========================================================================
--  10) سجل التغيير اللحظي (Realtime)
-- ===========================================================================
do $$ begin
  alter publication supabase_realtime add table brc.jobs;
  alter publication supabase_realtime add table brc.job_attempts;
  alter publication supabase_realtime add table brc.audit_log;
exception when others then
  raise notice 'Realtime غير متاح في هذه البيئة: %', sqlerrm;
end $$;

-- ===========================================================================
--  11) أمثلة استخدام سريعة
-- ===========================================================================
-- إضافة وظيفة (يُولَّد الكود تلقائياً BRC-####)
-- insert into brc.jobs (title, region, salary_min, salary_max, shift,
--                       employer_name, employer_phone, employer_address)
-- values ('عامل مخزن', 'الحلة', 600000, 750000, 'صباحي',
--         'مخازن الفرات للتبريد', '07701234567', 'الحلة - المنطقة الصناعية');
--
-- إصدار استمارة (يُولَّد الرقم BRC-NO-000121 وتُنشأ 5 محاولات)
-- insert into brc.applicants (full_name, phone, address, dob)
-- values ('حسين كاظم عبد الله', '07704445566', 'الحلة - شارع 40', '1997-11-30');
--
-- ترشيح وظيفة لمحاولة (يحجز الوظيفة 24 ساعة تلقائياً)
-- select brc.select_attempt('BRC-NO-000121', 'BRC-1042');
--
-- تثبيت نتيجة المقابلة
-- select brc.set_outcome('BRC-NO-000121', 1, 'rejected', 'عدم توفر سكن قريب');
--
-- التحقق عبر الكيو آر كود
-- select brc.verify_form('BRC-NO-000120', left(brc.verify_token('BRC-NO-000120'), 8));
--
-- تشغيل الإفراج التلقائي يدوياً (يعمل تلقائياً كل دقيقة عبر pg_cron)
-- select * from brc.run_auto_release();
