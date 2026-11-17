-- ═══════════════════════════════════════════════════════════════════════
--  schema — الجزء 01 من 05
--  يفعّل: إنشاء السكيما · الإضافات · الأنواع · الجداول · الفهارس · الدوال · المشغّلات · المهام المجدولة · إدخال بيانات · كتل تنفيذية (DO)
--  أسطر: 671 · حجم: 36 ك.ب
--  ---------------------------------------------------------------------
--  ابدأ من هنا. هذا أول جزء.
--  بعد «Success» انتقل إلى الجزء 02.
-- ═══════════════════════════════════════════════════════════════════════

-- ===========================================================================
--  شركة الهدف للتوظيف (BRC) — مخطط قاعدة البيانات الكامل لـ PostgreSQL / Supabase
--  ---------------------------------------------------------------------------
--  نظام بطاقة التوظيف (v1.0 — 2026-09-30):
--   • بطاقة تُشترى كاشاً عند نقاط البيع — لا دفع إلكتروني نهائياً
--   • باركود HRC-BC-000123 + رمز فرصة سري (NNNN-AA) لكل خانة من فرصتي البطاقة
--   • الفرصة تُستهلك بالتقديم ولا تعود؛ التوظيف لا يُنهي البطاقة؛ المدة 30 يوماً
--   • انتهاء مهلة الحجز (24 ساعة) ← حالة «حرجة» بقرار يدوي (توظيف/إرجاع/حذف)
--
--  يتضمّن:
--   • الجداول والقيود والفهارس (وظائف، بطاقات، فرص، تدقيق، إعدادات)
--   • مشغّلات (Triggers) للحجز المؤقت 24 ساعة، الحالة الحرجة، وتثبيت النتائج
--   • توليد الأكواد: HRC-1042 للوظائف و HRC-BC-000123 للبطاقات و NNNN-AA للفرص
--   • سجل تدقيق لحظي (بالثانية + المستخدم + IP + التفاصيل)
--   • سياسات RLS: الزائر يتابع بطاقته عبر دوال آمنة فقط، الموظف يدير، المدير يرى المالية
--   • دوال RPC: بطاقتي (lookup_card/use_chance/verify_card_code) + التحقق الداخلي
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
  create type brc.job_status  as enum ('available', 'reserved', 'hiring', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type brc.slot_status as enum ('empty', 'reserved', 'critical', 'hiring', 'succeeded', 'rejected', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type brc.form_status as enum ('blank', 'pending', 'active', 'expired', 'exhausted', 'completed', 'rejected');
exception when duplicate_object then null; end $$;

-- ⚠️ إصلاح 2026-10-06: حالة «قيد المراجعة» (pending) مستعملة في brc.request_form
--    وفي مقارنات self_service_card/employer_view/lookup_card، لكنها لم تكن
--    مُعرَّفة في النوع إطلاقاً — فكان أي استعمال لها يفشل بـ
--    invalid input value for enum form_status: "pending". وكذلك 'rejected'
--    (طلب مرفوض) تستعملها employer_view/المنظومة. الإضافتان idempotent
--    وآمنتان على قاعدة قائمة (نوع موجود بلا هاتين القيمتين).
do $$ begin
  alter type brc.form_status add value if not exists 'pending';
exception when others then null; end $$;
do $$ begin
  alter type brc.form_status add value if not exists 'rejected';
exception when others then null; end $$;

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

-- 2.2ب سجل الباركودات الصادرة — لا يعود باركود أبداً ولو حُذفت بطاقته.
--     الباركودات عشوائية (قرار مقفل 2026-09-30): لا تسلسل يُخمَّن ولا رقمين
--     متجاورين يتشابهان — وهذا أساس منع التزوير.
create table if not exists brc.issued_serials (
  serial    text primary key,
  issued_at timestamptz not null default now(),
  note      text default ''
);
alter table brc.issued_serials enable row level security;
create index if not exists issued_serials_serial_idx on brc.issued_serials (serial);

-- باركود عشوائي فريد: 6 خانات (100000–999999) لا تتشابه مع أي بطاقة أخرى
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

-- كل بطاقة تُدرج تُسجَّل بسجل الباركودات (حتى المسار اليدوي/الاستيراد)
create or replace function brc.trg_log_issued_serial() returns trigger
language plpgsql security definer
set search_path = brc, public
as $$
begin
  insert into brc.issued_serials (serial) values (new.serial)
    on conflict (serial) do nothing;
  return new;
end $$;

-- 2.3 بطاقات التوظيف (الباحثون عن عمل) — صالحة 30 يوماً، فرصتان مستقلتان
create table if not exists brc.applicants (
  id            uuid primary key default gen_random_uuid(),
  serial        text not null unique,                            -- HRC-BC-000120
  full_name     text not null,
  phone         text not null,
  address       text default '',
  dob           date,
  gender        text default 'ذكر',
  nationality   text default 'عراقي',
  issue_date    timestamptz,                                   -- تُملأ عند نجاح أول تقديم
  expiry_date   timestamptz,                                   -- تبدأ 30 يوماً من التعبئة لا من إصدار الدفعة
  attempt_limit smallint not null default 2 check (attempt_limit between 1 and 10),   -- مقفلة: فرصتان
  status        brc.form_status not null default 'active',
  fee_amount    integer not null default 10000,   -- سعر البطاقة (كاش عند نقطة البيع)
  fee_paid      boolean not null default true,    -- البطاقة تُباع كاشاً عند الإصدار
  pos_name      text default '',                 -- نقطة البيع التي باعت البطاقة (مكتب الاستنساخ)
  printed_count integer not null default 0,
  requested_code text,                                           -- الوظيفة المطلوبة من الموقع العام
  reject_reason text default '',                                 -- سبب الرفض (يظهر للباحث في صفحة التحقق)
  created_by    uuid references brc.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  notes         text default '',
  /* التقديم الذاتي من باركود البطاقة (2026-10-06): بيانات المتقدّم تُحفظ هنا
     مرة واحدة، فتعود معبّأة تلقائياً في الفرصة الثانية بلا إعادة إدخال. */
  self_application_data jsonb not null default '{}'::jsonb
);
create index if not exists applicants_status_idx on brc.applicants (status);
create index if not exists applicants_expiry_idx on brc.applicants (expiry_date);
create index if not exists applicants_created_by_idx on brc.applicants (created_by);

-- ⚠️ إصلاح 2026-10-06: كان إنشاء المشغّل موضوعاً **قبل** إنشاء جدول brc.applicants
--    نفسه، فيفشل الملف كله على أي قاعدة جديدة (relation "brc.applicants" does not exist)
--    — نُقل إلى ما بعد الجدول وفهارسه.

drop trigger if exists trg_applicants_log_serial on brc.applicants;
create trigger trg_applicants_log_serial after insert or update of serial on brc.applicants
  for each row execute function brc.trg_log_issued_serial();

-- 2.2 الوظائف (بيانات صاحب العمل داخلية ولا تُعرض للعامة)
--     critical: انتهت مهلة الحجز (24 ساعة) دون قرار — الوظيفة مقفلة بانتظار
--     قرار الموظف (توظيف/إرجاع/حذف) ولا يُفرج عنها تلقائياً (قرار مقفل).
create table if not exists brc.jobs (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,                      -- HRC-1042
  title               text not null,
  category            text not null default 'خدمات',
  region              text default '',                           -- تاريخي: حُذف من الواجهة 2026-10-25
  governorate         text not null default 'بابل',             -- المحافظة
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
  reserved_by         text references brc.applicants (serial) on delete set null,  -- بطاقة الحجز الحالي
  hold_expires_at     timestamptz,                               -- مهلة 24 ساعة
  critical            boolean not null default false,            -- انتهت المهلة دون قرار — بانتظار قرار الموظف
  closed_at           timestamptz,
  notes               text default '',                           -- ملاحظات داخلية على الوظيفة
  image_url           text default '',                           -- صورة بطاقة الوظيفة
  created_by          uuid references brc.staff (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  /* ⚠️ إصلاح 2026-10-06: كان القيد يمنع أي وظيفة «حرجة» (محجوزة بلا مهلة)،
     فكان مسار انتهاء 24 ساعة ومسار رفض صاحب العمل يفشلان بخرق القيد.
     الحالة المقصودة: reserved + critical = معلّقة بانتظار قرار الموظف بلا مهلة. */
  constraint jobs_hold_consistency check (
    status <> 'reserved' or hold_expires_at is not null or critical
  )
);

-- رمز فرصة فريد: 4 أرقام + شرطة + حرفان (بلا I/L/O للالتباس البصري)
create or replace function brc.chance_code() returns text
language plpgsql
set search_path = brc, public, pg_temp
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

-- 2.4 فرص البطاقة (خانتان لكل بطاقة) — chance_code: رمز الفرصة السري
--     المطبوع على ظهر البطاقة، يستخدمه الزبون للتقديم الذاتي وإعادة الطباعة.
create table if not exists brc.job_attempts (
  id                uuid primary key default gen_random_uuid(),
  serial            text not null references brc.applicants (serial) on delete cascade,
  attempt_no        smallint not null check (attempt_no between 1 and 10),
  job_id            uuid references brc.jobs (id) on delete set null,
  job_code          text,
  job_snapshot      jsonb,                  -- نسخة الفرصة للحفاظ على تفاصيلها بعد حذف الوظيفة
  slot_status       brc.slot_status not null default 'empty',
  chance_code       text,                    -- تاريخي فقط: أُلغيت رموز الفرص 2026-10-25
  selected_at       timestamptz,
  hold_expires_at   timestamptz,
  closed_at         timestamptz,
  outcome_note      text default '',
  staff_id          uuid references brc.staff (id) on delete set null,
  /* ج4 2026-10-01: طلب صاحب العمل (توظيف/عدم توظيف) — القرار النهائي للشركة */
  employer_decision text,                                          -- hire | reject
  decision_at       timestamptz,
  /* ج5 2026-10-06: سبب عدم التوظيف المكتوب من صاحب العمل (إلزامي عند الرفض) */
  employer_reason   text,
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
      'attempt_limit', 2,        -- فرصتان لكل بطاقة (مقفل بقرار الشركة)
      'validity_days', 30,
      'hold_hours', 24,
      'form_fee', 10000,
      'auto_release', false)),   -- لا إفراج تلقائي: الحالة الحرجة تُحسم بقرار يدوي
  ('company', jsonb_build_object(
      'nameAr',      'منصة مكسب للتوظيف',
      'nameEn',      'Makseb Employment Platform',
      'legalName',   'شركة الهدف للتوظيف',
      'slogan',      'نوفّر الأيادي العاملة الفنية والتخصصية في بابل والفرات الأوسط',
      'phones',      jsonb_build_array('07763999907', '07863999907'),
      'address',     'حلة - شارع 60 - قرب مدينة حمورابي - قرب مجمع الكرعاوي',
      'addressShort','الحلة – بابل، العراق',
      'email',       'contact@hrc-babil.com',
      'hours',       'السبت – الخميس: 9:00 صباحاً – 5:00 مساءً',
      'holiday',     'الجمعة: عطلة رسمية',
      'license',     'إجازة عمل رسمية / وزارة العمل والشؤون الاجتماعية',
      'branch',      'بابل – الحلة',
      'verify_base', 'https://hrc-babil.com/verify',
      'disclaimer',  'ملاحظات مهمة: خدمات الشركة تنحصر في توفير الأيادي العاملة من الناحية الفنية والتخصصية فقط وليس الأمنية. الشركة غير مسؤولة قانونياً وعشائياً عن الشخص المرسل وصاحب العمل.'))
on conflict (key) do nothing;

-- ===========================================================================
--  3) توليد الأكواد التسلسلية
-- ===========================================================================
create sequence if not exists brc.job_code_seq  start 1042;
create sequence if not exists brc.form_serial_seq start 120;

/* ⚠️ security definer: بدونه يستدعي الموظف `nextval` على تسلسل لا يملك
   عليه USAGE فيفشل بـ42501 عند إضافة وظيفة من اللوحة — ويظهر له
   «لا صلاحية كافية» وهو ليس السبب. (أُصلح 2026-11-17.)
   والمنح على التسلسل أُضيف أدناه كطبقة ثانية — لا نعتمد على واحدة. */
create or replace function brc.next_job_code() returns text
language plpgsql
security definer
set search_path to 'brc', 'public'
as $$
declare v text;
begin
  loop
    v := 'HRC-' || nextval('brc.job_code_seq')::text;
    exit when not exists (select 1 from brc.jobs where code = v);
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
    /* الصلاحية تبدأ عند نجاح أول تقديم لا عند إصدار الدفعة أو بيعها فارغة:
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

drop trigger if exists trg_jobs_defaults on brc.jobs;
create trigger trg_jobs_defaults before insert or update on brc.jobs
  for each row execute function brc.trg_defaults();

drop trigger if exists trg_applicants_defaults on brc.applicants;
create trigger trg_applicants_defaults before insert on brc.applicants
  for each row execute function brc.trg_defaults();

/* خانات المحاولات تُنشأ بعد كتابة الاستمارة فعلاً — انظر التحذير أعلاه. */
create or replace function brc.trg_make_attempts() returns trigger
language plpgsql as $$
begin
  insert into brc.job_attempts (serial, attempt_no)
  select new.serial, gs from generate_series(1, new.attempt_limit) gs
  on conflict (serial, attempt_no) do nothing;
  return null;
end $$;

drop trigger if exists trg_applicants_attempts on brc.applicants;
create trigger trg_applicants_attempts after insert on brc.applicants
  for each row execute function brc.trg_make_attempts();

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

    if form_row.issue_date is null and form_row.expiry_date is null then
      update brc.applicants set issue_date=now(), expiry_date=now()+make_interval(days=>coalesce((rules->>'validity_days')::int,30)) where serial=new.serial;
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

  -- Reprint secrets must never become exportable audit history.
  before_row := before_row - 'card_print_code' - 'chance_code';
  after_row := after_row - 'card_print_code' - 'chance_code';

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
--  5) الحالة الحرجة بعد 24 ساعة + انتهاء صلاحية البطاقات (30 يوماً)
--     تُنفَّذ دورياً عبر pg_cron (كل دقيقة) أو عبر Edge Function.
--     نظام البطاقات (2026-09-30): لا إفراج تلقائي — الوظيفة التي تنتهي مهلة
--     حجزها دون قرار تبقى مقفلة وتنتقل مع فرصة الزبون إلى حالة «حرجة»
--     بانتظار قرار الموظف: تم التوظيف / إرجاعها متوفرة / حذفها.
-- ===========================================================================
create or replace function brc.run_auto_release() returns table (released_job text, expired_form text)
language plpgsql security definer
set search_path = brc, public
as $$
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

  -- (ج) بطاقات استُهلكت فرصها (لا فرصة فارغة ولا فرصة قيد اللعب — hiring ضمنها)
  update brc.applicants f
     set status = 'exhausted', updated_at = now()
   where f.status = 'active'
     and not exists (select 1 from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty')
     and not exists (select 1 from brc.job_attempts a where a.serial = f.serial
                       and a.slot_status in ('reserved', 'critical', 'hiring'));

  return;
end $$;

-- جدولة التنفيذ كل دقيقة (Supabase: pg_cron)
do $$ begin
  perform cron.schedule('brc-auto-release', '* * * * *', $cron$ select * from brc.run_auto_release(); $cron$);
exception when others then
  raise notice 'pg_cron غير متاح — يمكن جدولة brc.run_auto_release() عبر Edge Function/Scheduler: %', sqlerrm;
end $$;