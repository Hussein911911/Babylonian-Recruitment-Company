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

-- 2.7 أسرار التشغيل (2026-11-20)
--     ---------------------------------------------------------------------
--     لماذا جدول وليس إعداد قاعدة فقط؟ لأن `app.brc_secret` إعداد مخصّص
--     (custom GUC)، وضبطه بـ`ALTER DATABASE … SET` يحتاج **superuser**.
--     ودور `postgres` في مشاريع Supabase الحديثة **ليس superuser** — أثبتنا
--     ذلك تنفيذاً: `ERROR 42501: permission denied to set parameter`.
--     النتيجة كانت أن `verify_token` تبقى معطّلة (‏22023) على أي مشروع جديد
--     لا يملك خيار Custom Postgres Config.
--
--     الحل: مصدر ثانٍ داخل القاعدة نفسها، محميٌّ تماماً:
--       • RLS مفعّلة وبلا أي سياسة ⇒ لا قراءة لأي دور عميل
--       • REVOKE صريح من public/anon/authenticated/service_role
--       • القراءة تحدث **داخل** `verify_token` وهي SECURITY DEFINER (بصلاحية المالك)
--     ولا يوجد هنا أي سرّ مكتوب: الصف يُدخل يدوياً مرة واحدة بعد النشر.
--     ترتيب الأولوية في الدالة: إعداد القاعدة أولاً، ثم هذا الجدول.
create table if not exists brc.app_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table brc.app_secrets enable row level security;
revoke all on brc.app_secrets from public, anon, authenticated, service_role;

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
declare v_secret text;
begin
  -- المصدر ١: إعداد القاعدة app.brc_secret (الطريقة الأصلية).
  -- يحتاج superuser لضبطه، وليس متاحاً على كل مشاريع Supabase.
  v_secret := nullif(current_setting('app.brc_secret', true), '');

  -- المصدر ٢ (2026-11-20): جدول brc.app_secrets — يُستخدم حين لا يتوفّر الإعداد،
  -- أو حين لا يملك دور النشر صلاحية ضبطه. نفس البصمة، بلا تغيير في السلوك.
  if v_secret is null or length(v_secret) < 16 then
    select s.value into v_secret from brc.app_secrets s where s.name = 'brc_secret';
  end if;

  -- إن لم يُضبط المفتاح بأي مصدر نتوقف بخطأ واضح بدل استخدام سرّ مكشوف في المستودع
  if v_secret is null or length(v_secret) < 16 then
    raise exception 'مفتاح البصمة غير مضبوط أو أقصر من 16 حرفاً — اضبط app.brc_secret أو أدخل صفاً في brc.app_secrets باسم brc_secret (تعليمات أعلى الدالة في docs/schema.sql)'
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

-- ===========================================================================
--  6) الواجهات العامة (Views)
-- ===========================================================================

-- 6.1 وظائف العرض العام: بلا أي بيانات لصاحب العمل
create or replace view brc.public_jobs
with (security_invoker = false) as
  select code, title, category, region, governorate, shift, salary_min, salary_max, gender,
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
-- ج5 2026-10-06: مصدران للحالة الحرجة — رفض صاحب العمل بسبب مكتوب (kind
--   'critical' وبالسبب في الوصف)، أو انتهاء مهلة 24 ساعة دون قرار
--   (kind 'critical_timeout'). كلاهما يقرّره الموظف: إرجاع متاحة أو حذف.
create or replace view brc.v_pending_actions as
  select 'hiring'::text as kind, j.code as reference, j.reserved_by as serial,
         a.decision_at as due_at, null::numeric as hours_left,
         case when a.employer_decision = 'hire'
              then 'طلب صاحب العمل: تم التوظيف — بانتظار تثبيت الشركة'
              else 'طلب صاحب العمل: لم يتم التوظيف — بانتظار قرار الشركة' end::text as description
    from brc.jobs j
    join brc.job_attempts a on a.job_id = j.id and a.slot_status = 'hiring'
   where j.status = 'hiring'
  union all
  /* رفض صاحب العمل بسبب مكتوب: الوظيفة معلّقة والقرار للشركة */
  select 'critical'::text, j.code, j.reserved_by, a.decision_at, null,
         ('رفض صاحب العمل بسبب: ' || coalesce(nullif(a.employer_reason, ''), '—') ||
          ' — القرار: إرجاع الوظيفة متاحة أو حذفها')
    from brc.jobs j
    join brc.job_attempts a on a.job_id = j.id and a.slot_status = 'critical'
   where j.status = 'reserved' and j.critical
     -- ⚠️ إصلاح 2026-10-06: بلا هذا الشرط كانت وظيفة «انتهت مهلة 24 ساعة» تظهر
     --    كأن صاحب العمل رفضها بسبب فارغ («بسبب: —») بدل «حرجة — انتهت المهلة».
     and a.employer_decision = 'reject'
  union all
  /* حرجة بانتهاء المهلة دون قرار (لا رفض مسجَّل) */
  select 'critical_timeout'::text, j.code, j.reserved_by, j.hold_expires_at, null,
         'انتهت مهلة 24 ساعة دون قرار — توظيف أو إرجاع أو حذف'::text
    from brc.jobs j
   where j.status = 'reserved' and j.critical
     and not exists (select 1 from brc.job_attempts a
                      where a.job_id = j.id and a.slot_status = 'critical'
                        and a.employer_decision = 'reject')
  union all
  select 'hold'::text, j.code, j.reserved_by,
         j.hold_expires_at,
         round(extract(epoch from (j.hold_expires_at - now())) / 3600.0, 1),
         'حجز مؤقت بانتظار نتيجة المقابلة'::text
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

-- 7.1 التحقق من استمارة عبر الكيو آر كود (للموظفين والإدارة فقط)
-- ⚠️ سياسة الشركة: الزائر لا يتحقق من أي استمارة — التحقق للموظفين والإدارة.
--    لذلك لا تُمنح هذه الدالة لـ anon (انظر قسم الصلاحيات أسفل الملف)، وصفحة
--    verify.html تحجب الزائر قبل أي عرض بيانات (assets/js/verify.js).
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
               'location', coalesce(j.governorate, '—'),
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

-- 7.1ج ‎«بطاقتي» — الدوال العامة الآمنة لنظام بطاقة التوظيف (2026-09-30)
-- ---------------------------------------------------------------------------
--  المسار العام الجديد: الزبون يشتري بطاقة (كاش عند نقطة بيع) ويتبعها بنفسه
--  بالباركود المطبوع عليها. الأمان قائم على نموذج الحيازة:
--    • lookup_card: عرض البطاقة بالباركود فقط — بيانات مقنّنة وبلا رموز
--      الفرص وبلا بيانات صاحب العمل.
--    • use_chance: استهلاك فرصة يتطلب رمز الفرصة السري (ظهر البطاقة).
--    • verify_card_code: إعادة الطباعة تتطلب رمز فرصة (إثبات الحيازة) وتُرجع
--      الحمولة الكاملة للطباعة.
--  كلها security definer بلا كشف لأي جدول: anon ممنوع من brc.applicants
--  وbrc.job_attempts وbrc.jobs (البيانات الداخلية).
create or replace function brc.lookup_card(p_serial text, p_code text) returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f record;
  v_ok boolean;
  v_stored text;
  v_code text;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على بطاقتك');
  end if;

  /* 2026-11-13: حيث يوجد card_print_code لا يُكشف الاسم/الهاتف كاملاً بلا
     الرمز. البطاقات بلا رمز مطبوع (كل بطاقات اليوم) تبقى كما هي. */
  v_stored := upper(btrim(coalesce(to_jsonb(f)->>'card_print_code', '')));
  v_code   := upper(btrim(coalesce(p_code, '')));
  if v_stored = '' then
    v_ok := true;
  else
    v_ok := (v_stored = v_code)
         or (replace(replace(v_stored, 'O', '0'), 'I', '1')
             = replace(replace(v_code, 'O', '0'), 'I', '1'));
  end if;
  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;
  if f.status = 'blank' then
    -- البطاقة موجودة لكنها لم تُستخدم بعد. لا نكشف أي بيانات شخصية أو تفاصيل
    -- تقديم محتملة، ولا نغيّر الصلاحية أو نُنشئ فرصاً عند مجرد عرضها.
    return jsonb_build_object('ok', true, 'serial', f.serial, 'status', 'blank',
      'fullName', '', 'phone', '', 'issueDate', null, 'expiryDate', null,
      'usesCardPrintCode', false, 'succeeded', false,
      'chancesLeft', (select count(*) from brc.job_attempts a where a.serial=f.serial and a.slot_status='empty'),
      'chances', (select coalesce(jsonb_agg(jsonb_build_object('no', a.attempt_no, 'slotStatus', 'empty') order by a.attempt_no), '[]'::jsonb)
                  from brc.job_attempts a where a.serial=f.serial and a.slot_status='empty'));
  end if;

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  values ('public', 'public', 'متابعة بطاقة (بطاقتي)', 'applicant', f.serial, 'عرض الحالة بالباركود — بيانات مقنّنة');

  return jsonb_build_object(
    'ok', true,
    'serial', f.serial,
    'usesCardPrintCode', (to_jsonb(f)->>'card_print_code') is not null,
    'requiresCode', (v_stored <> ''),
    'verified', v_ok,
    'fullName', case when v_ok then f.full_name else brc.mask_name(f.full_name) end,
    'phone',    case when v_ok then f.phone    else brc.mask_phone(f.phone) end,
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
               'jobTitle', coalesce(a.job_snapshot->>'title', j.title),
               'location', coalesce(a.job_snapshot->>'governorate', j.governorate),
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

  -- ⛔ أُلغيت رموز الفرص (2026-10-25): تُستهلك أول خانة فارغة بالترتيب.
  --    يُقبل p_code للتوافق مع نسخ قديمة، ويُتجاهل إن كان فارغاً.
  select * into a from brc.job_attempts
   where serial = f.serial and slot_status = 'empty'
     and (coalesce(btrim(p_code), '') = '' or chance_code = upper(btrim(p_code)))
   order by attempt_no limit 1;
  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد فرصة متاحة في هذه البطاقة');
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-25 — إلغاء رموز الفرص نهائياً
-- ---------------------------------------------------------------------------
--  • لم تعد البطاقة تحمل أي رمز على ظهرها، ولا يُطبع أي رمز فرصة.
--  • لا يُولَّد رمز لفرصة جديدة: أُزيل default العمود وأُزيل شرط not null.
--  • استخدام الفرصة صار بالباركود وحده (حيازة البطاقة = التحكم) — نفس سياسة
--    صفحة التقديم والتحقق منذ 2026-10-06.
--  • الصفوف القديمة تحتفظ بقيمها التاريخية (لا تُطبع ولا تُطلب)، حفاظاً على
--    بصمات سجلات الاسترجاع recovery_chances التي تُقارن hash للرمز.
-- ═══════════════════════════════════════════════════════════════════════════
alter table brc.job_attempts alter column chance_code drop default;
alter table brc.job_attempts alter column chance_code drop not null;

create or replace function brc.new_card_print_code() returns text
language sql volatile set search_path = pg_catalog
as $$ select upper(substr(u, 1, 12) || substr(u, 21, 4))
      from (select replace(gen_random_uuid()::text, '-', '') as u) s $$;

alter table brc.applicants add column if not exists card_print_code text;
alter table brc.applicants alter column card_print_code drop default;

-- Remove only secret keys from existing before/after diffs; preserve all other evidence.
update brc.audit_log
   set diff = diff #- '{before,card_print_code}' #- '{after,card_print_code}'
                   #- '{before,chance_code}' #- '{after,chance_code}'
 where (diff->'before') ?| array['card_print_code','chance_code']
    or (diff->'after') ?| array['card_print_code','chance_code'];


create or replace function brc.verify_card_code(p_serial text, p_code text) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, brc, public
as $$
declare
  f record;
  -- رمز التحقق يُقرأ عبر to_jsonb: بعض قواعد الإنتاج أُنشئت قبل إضافة العمود
  -- (card_print_code)، وقراءته مباشرةً تُفشل الدالة كلها بـ42703.
  print_code text;
  supplied text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  valid boolean := false;
  failures integer;
begin
  -- Serialize attempts for this card, including concurrent wrong requests.
  select * into f from brc.applicants
   where serial = upper(btrim(coalesce(p_serial, ''))) for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'الباركود أو رمز التحقق غير صحيح');
  end if;
  select count(*) into failures from brc.audit_log
   where entity_id = f.serial and action = 'فشل تحقق إعادة الطباعة'
     and ts > clock_timestamp() - interval '10 minutes';
  if failures >= 8 then
    return jsonb_build_object('ok', false, 'error', 'محاولات كثيرة — حاول بعد 10 دقائق');
  end if;
  print_code := to_jsonb(f)->>'card_print_code';
  if print_code is not null then
    -- بطاقة لها رمز تحقق مطبوع: لا تُطبع إلا به.
    valid := supplied = upper(print_code);
  else
    -- بطاقة بلا رمز (بعد إلغاء رموز الفرص 2026-10-25): الحيازة هي الإثبات،
    -- ويُقبل أيضاً أي رمز فرصة قديم مطبوع على بطاقة سبق طبعها.
    valid := supplied = '' or exists(
      select 1 from brc.job_attempts a where a.serial = f.serial
        and supplied = upper(regexp_replace(coalesce(a.chance_code, ''), '[^A-Za-z0-9]', '', 'g')));
  end if;
  if not valid then
    insert into brc.audit_log(username, role, action, entity, entity_id, details)
    values ('public', 'public', 'فشل تحقق إعادة الطباعة', 'applicant', f.serial, 'رمز تحقق غير صحيح');
    return jsonb_build_object('ok', false, 'error', 'رمز التحقق غير صحيح — انسخه من ظهر البطاقة');
  end if;
  insert into brc.audit_log(username, role, action, entity, entity_id, details)
  values ('public', 'public', 'إعادة طباعة بطاقة', 'applicant', f.serial, 'تم إثبات الحيازة — دون تسجيل الرمز');
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', f.id, 'serial', f.serial, 'fullName', f.full_name, 'phone', f.phone,
    'address', f.address, 'dob', f.dob, 'gender', f.gender, 'nationality', f.nationality,
    'status', f.status, 'issueDate', f.issue_date, 'expiryDate', f.expiry_date,
    'posName', coalesce(f.pos_name, ''), 'cardPrintCode', print_code,
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object(
      'no', a.attempt_no, 'code', a.chance_code, 'slotStatus', a.slot_status,
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.governorate,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at,
      'closedAt', a.closed_at, 'note', a.outcome_note) order by a.attempt_no), '[]'::jsonb)
      from brc.job_attempts a left join brc.jobs j on j.id = a.job_id where a.serial = f.serial)
  ));
end $$;
revoke all on function brc.verify_card_code(text, text) from public;
grant execute on function brc.verify_card_code(text, text) to anon, authenticated;

-- 7.1ج بيع نقطة البيع عبر الموقع (قرار الإدارة 2026-10-01)
-- ---------------------------------------------------------------------------/
--  activate_card: نقطة البيع تمسح باركود البطاقة الفارغة فتُعبّأ بيانات الزبون
--                 مع اختيار الوظيفة (اختياري) وتُستهلك الفرصة الأولى بحجز 24 ساعة.
--  ⚠️ 2026-10-25: حُذف مسار صاحب العمل من الويب، فحُذفت دالتاه employer_view
--     وemployer_decide (وemployer_decide_original) من هنا ومن القاعدة —
--     طلب صاحب العمل يُسجَّل من لوحة الموظفين.
-- 1) بيع وتعبئة بطاقة فارغة من نقطة البيع عبر الموقع العام
--    p_data: { fullName, phone, address, dob, gender, posName, fee?, feePaid?, notes?, jobCode }
create or replace function brc.activate_card(p_serial text, p_data jsonb)
returns jsonb
language plpgsql security definer
set search_path = brc, public
as $$
declare
  f        record;
  j        record;
  a        record;
  rules    jsonb;
  v_name   text;
  v_phone  text;
  v_pos    text;
  v_job    text;
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
  /* ج5 2026-10-06: اختيار الوظيفة عند البيع صار اختيارياً — إمّا يختارها موظف
     النقطة للزبون فتُستهلك الفرصة الأولى بحجز 24 ساعة، وإمّا يُباع بلا وظيفة
     فيختار صاحب البطاقة وظيفتَي فرصتيه بنفسه من صفحة باركود بطاقته. */
  if v_job <> '' then
    /* الوظيفة جزء من الاستمارة: تُقفل قبل أي كتابة (منع سباق حجز مزدوج) */
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
      issue_date  = case when v_job <> '' then now() else null end,
      expiry_date = case when v_job <> '' then now() + make_interval(days => coalesce((rules->>'validity_days')::int, 30)) else null end,
      pos_name    = v_pos,
      fee_amount  = coalesce(nullif(p_data->>'fee', '')::int, f.fee_amount),
      fee_paid    = coalesce((p_data->>'feePaid')::boolean, true),
      notes       = coalesce(nullif(p_data->>'notes', ''), f.notes)
  where serial = f.serial
  returning * into f;

  /* مع وظيفة مختارة: تُستهلك الفرصة الأولى بحجز 24 ساعة عبر trg_attempt_hold
     (يتحقق من توافر الوظيفة مجدداً + يقفلها + يدوّن الحجز بسجل التدقيق). */
  if v_job <> '' then
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
          ' — الصلاحية تبدأ عند أول تقديم ناجح' ||
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
      'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.governorate,
      'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at) end,
    'job', case when a.id is null then null
                else jsonb_build_object('code', j.code, 'title', j.title, 'region', j.region) end,
    'chancesLeft', (select count(*) from brc.job_attempts x
                     where x.serial = f.serial and x.slot_status = 'empty'));
exception when others then
  /* أخطاء المشغّلات (P0001) نصوص عربية نظيفة تمر كما هي للواجهة */
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

-- 4) التقديم الذاتي من باركود البطاقة (2026-10-06) — دالتان تناديهما صفحة
--    apply.html بلا جلسة موظف. سبب وجودهما أن جدول brc.applicants محجوب تماماً
--    عن الزائر (revoke all + لا سياسة له)، فالقراءة والكتابة تمرّان من مسار واحد
--    نتحكم بمحتواه: الباركود نفسه بيان الحيازة، والرموز السرّية تبقى في القاعدة.
--    ⚠️ الدرس المستفاد: الإصدار الذي أضاف صفحة التقديم الذاتي أضاف الدالتين في
--       ملف هجرة وحده دون مسار التحديث (db-update.html و docs/UPDATE-*.sql
--       وهذا الملف)، فصار مسح باركود أي بطاقة يفتح على الزبون خطأ PostgREST
--       خاماً: Could not find the function … in the schema cache. أُدرجتا هنا
--       ليكتمل «المصدر الوحيد للحقيقة» ولا تتكرّر الحالة.
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
     and slot_status in ('reserved', 'critical', 'hiring');

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
         outcome_note = coalesce(nullif(p_reason, ''),
           case when employer_decision is not null
                then 'إلغاء توظيف صاحب العمل بقرار الشركة — الفرصة مستهلكة'
                else 'إفراج يدوي عن الحجز' end)
   where serial = p_serial and attempt_no = p_attempt_no
     and slot_status in ('reserved', 'critical', 'hiring');

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
--  ومطبوعة على الاستمارات (HRC-NO-000120، 121، …). فمن يناديها يحسب البصمة
--  الصحيحة لأي استمارة ويصوغ رابط كيو آر كود مزيّفاً — فتفقد البصمة المطبوعة
--  قيمتها الأمنية بالكامل.
--
--  لا تتأثر الأدوار التالية: مالك الدالة (له كل الصلاحيات) · وbrc.verify_form
--  SECURITY DEFINER فهي تنادي verify_token بصلاحية المالك لا بصلاحية الزائر.
--
--  ⚠️ ولا يكفي إبطال verify_form/request_form من anon: anon يورث من PUBLIC —
--     لذلك تُبطَلان من public أولاً ثم تُمنحان للدور authenticated وحده (أسفل).
-- ---------------------------------------------------------------------------
-- ⚠️ 2026-11-13: سحب شامل بدل قائمة يدوية.
--    القائمة اليدوية أعلاه هي ما سبّب الثغرة: دالة تُضاف لاحقاً وتُنسى فيبقى
--    EXECUTE لها على PUBLIC. القياس على مخطط نظيف أثبت **17 دالة** يناديها
--    anon، منها select_attempt/set_outcome/release_hold و6 دوال مشغّلات
--    ومولّدا الرموز chance_code/new_card_print_code.
--    السحب التالي يغطي كل دوال brc بلا استثناء، ثم تُعاد المنح صراحةً أسفل.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'brc'
  loop
    execute format('revoke all on function %s from public', r.sig);
  end loop;
end $$;
-- ويمنع تكرارها: أي دالة تُنشأ لاحقاً في brc تبدأ بلا صلاحية لأحد.
-- ⚠️ بلا `in schema`: النسخة المحدودة بالمخطط لا تُسجّل شيئاً في PostgreSQL
--    (الافتراضي المدمج PUBLIC ليس ضمن ACL المخطط) — مجرَّب، ويشهد له الفحص
--    tests/function-acl-audit.mjs.
alter default privileges revoke execute on functions from public;

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
-- الزائر لا يقدّم ولا يتحقق: الدالتان تُنزعان من PUBLIC ثم تُمنحان للموظفين فقط
revoke execute on function brc.verify_form(text, text) from public;
revoke execute on function brc.request_form(text, text, text, date, text, text, text) from public;

-- إعادة المنح لمن يحتاجها فعلاً (بعد الإبطال أعلاه):
--   • is_staff/is_admin/current_staff_id → تُنادى داخل سياسات RLS الخاصة
--     بالموظفين، فبدونها يفشل كل وصول للموظف بـ permission denied.
--   • next_job_code/next_form_serial → يناديها المشغّل brc.trg_defaults عند الإدراج.
grant execute on function brc.is_staff()            to authenticated, service_role;
grant execute on function brc.is_admin()            to authenticated, service_role;
grant execute on function brc.current_staff_id()    to authenticated, service_role;
grant execute on function brc.next_job_code()       to authenticated, service_role;
grant execute on function brc.next_form_serial()    to authenticated, service_role;
-- «بطاقتي» للزائر العام: متابعة بطاقته واستخدام فرصته وإعادة طباعتها
-- (أُعيد كتابة سياسة الزائر 2026-09-30: لا طلب إلكتروني — بطاقة تُشترى كاشاً)
grant execute on function brc.lookup_card(text, text)           to anon, authenticated;
grant execute on function brc.use_chance(text, text, text)      to anon, authenticated;
grant execute on function brc.verify_card_code(text, text)      to anon, authenticated;
/* موديل 2026-10-01: مسح نقطة البيع وصاحب العمل من الموقع العام — بلا جلسة */
-- Internal helper only: self-service and office security-definer functions call it.
revoke all on function brc.activate_card(text, jsonb) from public, anon, authenticated;
/* موديل 2026-10-06: التقديم الذاتي من باركود البطاقة (apply.html) — مسار عام
   بلا جلسة: الباركود بيان الحيازة، والدالتان لا تكشفان اسماً ولا هاتفاً ولا
   رموز فرص. تُنزعان من PUBLIC أولاً (PostgreSQL يمنح EXECUTE لـ PUBLIC تلقائياً
   لكل دالة جديدة) ثم تُمنحان صراحةً للزائر والموظف. */
revoke all on function brc.self_service_card(text, text) from public;
revoke all on function brc.apply_with_card(text, text, jsonb) from public;
grant execute on function brc.self_service_card(text, text)    to anon, authenticated;
grant execute on function brc.apply_with_card(text, text, jsonb) to anon, authenticated;

-- الزائر العام: يتصفّح الوظائف ويتابع بطاقته — بلا تحقق داخلي وبلا طلب إلكتروني
-- ⚠️ سياسة الشركة (قرار الإدارة 2026-09-30 — نظام بطاقة التوظيف): الزائر يشتري
--    بطاقة التوظيف كاشاً من نقطة بيع معتمدة ويتابعها بنفسه بالباركود، ولا يُقدّم
--    طلباً إلكترونياً ولا يتحقق من بطاقات غيره. لذلك:
--      • تُمنح للزائر دوال «بطاقتي» الثلاث فقط: lookup_card (بيانات مقنّنة بلا
--        رموز) وuse_chance وverify_card_code (تتطلبان رمز الفرصة السري).
--      • لا تُمنح brc.verify_form للزائر (anon): التحقق الداخلي يتم بجلسة موظف
--        مصادَق عليها (authenticated) من صفحة verify.html — محجوبة عن الزائر.
--      • لا تُمنح brc.request_form للزائر: مسار الطلب الإلكتروني أُلغي نهائياً.
-- ⚠️ ولا تُمنح brc.public_verification أصلاً: تلك الواجهة تكشف serial + full_name
--    + status لكل البطاقات بلا تحقق من البصمة، فيسحب أي حامل لـ anon key أسماء
--    كل الباحثين بنداء واحد.
grant select on brc.public_jobs to anon, authenticated;
grant execute on function brc.verify_form(text, text) to authenticated, service_role;
grant execute on function brc.request_form(text, text, text, date, text, text, text) to authenticated, service_role;

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
-- ⚠️ عطل حقيقي أُصلح 2026-11-17 (بلاغ المالك: «قبل لا أنسخ أي نسخة يكلّي
--    لا صلاحية كافية (RLS/منح مفقود) … وهاي تروح من أسوي رفرش»).
--
--    السبب لم يكن سياسة ولا منحاً على الجدول — بل **التسلسلات**:
--    `audit_log.id` من نوع bigserial يولّد رقمه من `audit_log_id_seq`.
--    وكان المنح على التسلسل لـ`authenticated` مفقوداً على القواعد التي
--    بُنيت من أجزاء السكيما (الجزء ٣ فيه المنح، لكن الملف الكامل لم يكن
--    يعيده). فأي `insert into brc.audit_log` يفشل بـ:
--        ERROR 42501: permission denied for sequence audit_log_id_seq
--
--    و`job_code_seq` و`form_serial_seq` لم يكن لهما منح إطلاقاً — فإضافة
--    وظيفة أو استمارة من اللوحة تفشل بالخطأ نفسه، ويظهر للموظف
--    «لا صلاحية كافية» وهو ليس السبب.
--
--    والمنح على UPDATE مطلوب أيضاً لأن `nextval` يُحدّث حالة التسلسل.
grant usage, select, update on sequence brc.audit_log_id_seq to authenticated;
grant usage, select, update on sequence brc.job_code_seq    to authenticated;
grant usage, select, update on sequence brc.form_serial_seq to authenticated;
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
-- إصدار استمارة (يُولَّد الرقم HRC-NO-000121 وتُنشأ 5 محاولات)
-- insert into brc.applicants (full_name, phone, address, dob)
-- values ('حسين كاظم عبد الله', '07704445566', 'الحلة - شارع 40', '1997-11-30');
--
-- ترشيح وظيفة لمحاولة (يحجز الوظيفة 24 ساعة تلقائياً)
-- select brc.select_attempt('HRC-NO-000121', 'HRC-1042');
--
-- تثبيت نتيجة المقابلة
-- select brc.set_outcome('HRC-NO-000121', 1, 'rejected', 'عدم توفر سكن قريب');
--
-- التحقق عبر الكيو آر كود
-- select brc.verify_form('HRC-NO-000120', left(brc.verify_token('HRC-NO-000120'), 8));
--
-- تشغيل الإفراج التلقائي يدوياً (يعمل تلقائياً كل دقيقة عبر pg_cron)
-- select * from brc.run_auto_release();


-- Employer WhatsApp OTP gateway (2026-10-17).
-- OTP and employer sessions are service-only. Never expose these tables/RPCs to the browser.
create table if not exists brc.employer_otp (
 id uuid primary key, attempt_id uuid not null references brc.job_attempts(id) on delete cascade,
 phone text not null, ip_hash text not null, code_hash text not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '5 minutes',
 delivered boolean not null default false, failures int not null default 0,
 used boolean not null default false, session_hash text, session_expires_at timestamptz
);
alter table brc.employer_otp enable row level security;
revoke all on brc.employer_otp from public,anon,authenticated;
create index if not exists employer_otp_phone_time on brc.employer_otp(phone,created_at);
create index if not exists employer_otp_ip_time on brc.employer_otp(ip_hash,created_at);
create unique index if not exists employer_otp_session on brc.employer_otp(session_hash) where session_hash is not null;

-- 2026-10-25: حُذفت دوال بوابة الواتساب (employer_otp_issue/delivery/verify/action)
-- ومعها employer_view/employer_decide — لا واجهة تنادي عليها بعد حذف مسار صاحب
-- العمل. الجداول تبقى فارغة لأن دوال الاسترجاع التشغيلي تلتقط لقطاتها.
-- 2026-10-25: حُذفت دوال صاحب العمل نهائياً (employer_view · employer_decide ·
-- employer_decide_original) ودوال employer_otp_%، فلا شيء تسحبه هذه الحلقة.
-- تُبقى شبكة أمان لأي قاعدة قديمة ما زالت تحمل نسخة مشغولة بالرمز:
do $$ declare r record; begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='brc' and (p.proname like 'employer\_pin%' or p.proname like 'employer\_otp\_%' or p.proname = 'staff_save_job_pin') loop
 execute format('drop function if exists %s',r.signature);
 end loop;
end $$;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-10-25 — حُذف رمز صاحب العمل (employer PIN) نهائياً
-- ---------------------------------------------------------------------------
--  بعد حذف بوابة صاحب العمل من الموقع لم يبقَ مستخدم للرمز: لا واجهة ولا دالة
--  تنادي عليه. حُذفت staff_save_job_pin · employer_pin_login · employer_pin_action
--  وعمود jobs.employer_pin_set. وأُبقيت **جداول الاعتماد القديمة مفرغة** لأن دوال
--  الاسترجاع التشغيلي تلتقط لقطاتها؛ لا تُستخدم لأي رمز بعد اليوم.
create table if not exists brc.employer_job_credentials (
 job_id uuid primary key references brc.jobs(id) on delete cascade,
 pin_hash text not null, failures integer not null default 0,
 window_start timestamptz not null default now(), changed_at timestamptz not null default now()
);
create table if not exists brc.employer_login_budget (
 id boolean primary key default true check(id), window_start timestamptz not null default now(), requests integer not null default 0
);
alter table brc.employer_job_credentials enable row level security;
alter table brc.employer_login_budget enable row level security;
revoke all on brc.employer_job_credentials,brc.employer_login_budget from public,anon,authenticated;

-- Office queue: authenticated replay, no browser access to the receipt ledger.
create table if not exists brc.office_receipts (
 operation_id uuid primary key, actor uuid not null, request_hash text not null,
 result jsonb not null, created_at timestamptz not null default now()
);
alter table brc.office_receipts enable row level security;
revoke all on brc.office_receipts from public,anon,authenticated;
create or replace function brc.office_submit(p_id uuid,p_kind text,p_data jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare actor uuid:=auth.uid(); signature text; receipt record; j record; f record; slot record; result jsonb;
begin
 if actor is null or not brc.is_staff() then return jsonb_build_object('ok',false,'code','unauthorized'); end if;
 if p_id is null or p_kind is null or p_kind not in ('reserve','activate','job_note') or p_data is null or p_expected is null or jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_expected)<>'object' then
 return jsonb_build_object('ok',false,'code','invalid_request'); end if;
 signature:=encode(extensions.digest(convert_to(jsonb_build_array(p_kind,p_data,p_expected)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into receipt from brc.office_receipts where operation_id=p_id;
 if found then
  if receipt.actor<>actor or receipt.request_hash<>signature then return jsonb_build_object('ok',false,'code','operation_mismatch');end if;
  return receipt.result;
 end if;
 begin
  if length(coalesce(p_data->>'serial',''))>80 or length(coalesce(p_data->>'jobCode',''))>80 then raise exception 'invalid_request'; end if;
  -- Match existing public activation lock order: applicant, then job, then slot.
  if p_kind in ('reserve','activate') then
   select * into f from brc.applicants where serial=p_data->>'serial' for update;
   if not found then raise exception 'card_not_found'; end if;
  end if;
  select * into j from brc.jobs where code=p_data->>'jobCode' for update;
  if not found then raise exception 'job_not_found';end if;
  if p_expected->>'job_updated_at' is null or j.updated_at is distinct from (p_expected->>'job_updated_at')::timestamptz then raise exception 'job_conflict';end if;
  if p_kind='job_note' then
   if length(btrim(coalesce(p_data->>'note','')))=0 or length(p_data->>'note')>2000 then raise exception 'invalid_note';end if;
   update brc.jobs set notes=p_data->>'note',updated_at=now() where id=j.id;
   insert into brc.audit_log(username,role,action,entity,entity_id,details)
   select username,role,'تحديث ملاحظة من المكتب','job',j.code,'طلب مكتب متحقق من التعارض' from brc.staff where auth_id=actor and active;
  else
   if j.status<>'available' then raise exception 'job_unavailable';end if;
   if p_kind='activate' then
    if f.status<>'blank' or p_expected->>'app_updated_at' is null or f.updated_at is distinct from (p_expected->>'app_updated_at')::timestamptz then raise exception 'card_conflict';end if;
    result:=brc.activate_card(f.serial,p_data);
   else
    if f.status<>'active' or (f.expiry_date is not null and f.expiry_date<=now()) then raise exception 'card_unavailable';end if;
    select * into slot from brc.job_attempts where serial=f.serial and slot_status='empty' order by attempt_no limit 1 for update;
    if not found or slot.attempt_no is distinct from (p_expected->>'attempt_no')::smallint then raise exception 'chance_conflict';end if;
    result:=brc.select_attempt(f.serial,j.code);
   end if;
   if coalesce((result->>'ok')::boolean,false)=false then raise exception '%',coalesce(result->>'error','operation_rejected');end if;
  end if;
  result:=jsonb_build_object('ok',true,'operationId',p_id,'jobCode',j.code,'serial',p_data->>'serial');
 exception when others then
  -- This subtransaction rolls back all business writes on any rejection.
  result:=jsonb_build_object('ok',false,'code','conflict','message',left(sqlerrm,240));
 end;
 insert into brc.office_receipts(operation_id,actor,request_hash,result) values(p_id,actor,signature,result);
 return result;
end $$;
revoke all on function brc.office_submit(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function brc.office_submit(uuid,text,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';


-- Operational recovery, NOT browser snapshots / Auth rollback / full project DR.
-- Private key, ciphertext and tickets are never selectable by API roles.
create table if not exists brc.recovery_control (
 singleton boolean primary key default true check(singleton),
 secret text not null, cutoff bigint not null default 0
);
insert into brc.recovery_control(singleton,secret)
values(true,encode(extensions.gen_random_bytes(32),'hex')) on conflict do nothing;
create table if not exists brc.recovery_copies (
 id uuid primary key default gen_random_uuid(), name text not null,
 created_at timestamptz not null default clock_timestamp(), actor uuid,
 safety boolean not null default false, counts jsonb not null,
 schema_hash text not null, data_hash text not null, ciphertext bytea not null
);
create table if not exists brc.recovery_tickets (
 token_hash text primary key, actor uuid not null, copy_id uuid not null references brc.recovery_copies(id),
 live_hash text not null, expires_at timestamptz not null, used boolean not null default false
);
alter table brc.recovery_control enable row level security;
alter table brc.recovery_copies enable row level security;
alter table brc.recovery_tickets enable row level security;
revoke all on brc.recovery_control,brc.recovery_copies,brc.recovery_tickets from public,anon,authenticated;

create or replace function brc.recovery_schema_hash() returns text
language sql stable security definer set search_path=brc,public as $$
 select encode(extensions.digest(coalesce(string_agg(table_name||':'||column_name||':'||udt_schema||'.'||udt_name,',' order by table_name,ordinal_position),''),'sha256'),'hex')
 from information_schema.columns where table_schema='brc' and table_name in ('applicants','jobs','job_attempts','settings')
$$;
create or replace function brc.recovery_capture() returns jsonb
language sql volatile security definer set search_path=brc,public as $$
 select jsonb_build_object('format',1,'schema',brc.recovery_schema_hash(),
 'applicants',coalesce((select jsonb_agg(to_jsonb(a) order by serial) from brc.applicants a),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by id) from brc.jobs j),'[]'::jsonb),
 'job_attempts',coalesce((select jsonb_agg(to_jsonb(t) order by serial,attempt_no) from brc.job_attempts t),'[]'::jsonb),
 'settings',coalesce((select jsonb_agg(to_jsonb(s) order by key) from brc.settings s where key='rules'),'[]'::jsonb),
 'employer_job_credentials',coalesce((select jsonb_agg(to_jsonb(c) order by job_id) from brc.employer_job_credentials c),'[]'::jsonb))
$$;
create or replace function brc.recovery_counts(p jsonb) returns jsonb
language sql immutable set search_path=brc,public as $$
 select jsonb_build_object('jobs',jsonb_array_length(p->'jobs'),'applicants',jsonb_array_length(p->'applicants'),'attempts',jsonb_array_length(p->'job_attempts'))
$$;
create or replace function brc.recovery_save(p_name text,p_safety boolean) returns uuid
language plpgsql security definer set search_path=brc,public as $$
declare p jsonb; k text; result uuid;
begin
 if (select count(*) from brc.recovery_copies)>=100 then raise exception 'بلغ عدد النسخ 100؛ يلزم إدارة الاحتفاظ قبل إنشاء نسخة جديدة';end if;
 p:=brc.recovery_capture();select secret into strict k from brc.recovery_control where singleton;
 insert into brc.recovery_copies(name,actor,safety,counts,schema_hash,data_hash,ciphertext)
 values(left(coalesce(nullif(btrim(p_name),''),'نسخة بيانات الموقع'),100),auth.uid(),p_safety,brc.recovery_counts(p),p->>'schema',encode(extensions.digest(p::text,'sha256'),'hex'),extensions.pgp_sym_encrypt(p::text,k,'cipher-algo=aes256,compress-algo=1')) returning id into result;
 return result;
end $$;
create or replace function brc.recovery_read(p_id uuid) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare r brc.recovery_copies; p jsonb; k text;
begin
 select * into strict r from brc.recovery_copies where id=p_id;
 select secret into strict k from brc.recovery_control where singleton;
 p:=extensions.pgp_sym_decrypt(r.ciphertext,k)::jsonb;
 if p->>'format'<>'1' or p->>'schema'<>brc.recovery_schema_hash() or r.schema_hash<>p->>'schema' or encode(extensions.digest(p::text,'sha256'),'hex')<>r.data_hash then raise exception 'نسخة تالفة أو غير متوافقة مع إصدار القاعدة الحالي';end if;
 return p;
end $$;
-- Monotonic usage/identifier history survives deletion of operational records.
create table if not exists brc.recovery_chances (
 serial text not null, attempt_no smallint not null, spent boolean not null,
 code_hash text not null, primary key(serial,attempt_no)
);
create table if not exists brc.recovery_prints (
 serial text primary key, printed boolean not null, code_hash text
);
alter table brc.recovery_chances enable row level security;
alter table brc.recovery_prints enable row level security;
revoke all on brc.recovery_chances,brc.recovery_prints from public,anon,authenticated;
insert into brc.recovery_chances(serial,attempt_no,spent,code_hash)
 select serial,attempt_no,slot_status<>'empty',encode(extensions.digest(coalesce(chance_code,''),'sha256'),'hex') from brc.job_attempts
 on conflict(serial,attempt_no) do update set spent=brc.recovery_chances.spent or excluded.spent;
insert into brc.recovery_prints(serial,printed,code_hash)
 select serial,coalesce((to_jsonb(a)->>'printed_count')::int,0)>0 or to_jsonb(a)->>'card_print_code' is not null,case when to_jsonb(a)->>'card_print_code' is not null then encode(extensions.digest(to_jsonb(a)->>'card_print_code','sha256'),'hex') end from brc.applicants a on conflict do nothing;
create or replace function brc.recovery_remember() returns trigger
language plpgsql security definer set search_path=brc,public as $$
declare p jsonb;
begin
 if TG_OP='DELETE' then p:=to_jsonb(old);else p:=to_jsonb(new);end if;
 if TG_TABLE_NAME='job_attempts' then
  insert into brc.recovery_chances(serial,attempt_no,spent,code_hash)
  values(p->>'serial',(p->>'attempt_no')::smallint,p->>'slot_status'<>'empty',encode(extensions.digest(coalesce(p->>'chance_code',''),'sha256'),'hex'))
  on conflict(serial,attempt_no) do update set spent=brc.recovery_chances.spent or excluded.spent,code_hash=excluded.code_hash;
 else
  insert into brc.recovery_prints(serial,printed,code_hash)
  values(p->>'serial',coalesce((p->>'printed_count')::int,0)>0 or p->>'card_print_code' is not null,case when p->>'card_print_code' is not null then encode(extensions.digest(p->>'card_print_code','sha256'),'hex') end)
  on conflict(serial) do update set printed=brc.recovery_prints.printed or excluded.printed,code_hash=coalesce(excluded.code_hash,brc.recovery_prints.code_hash);
 end if;
 return null;
end $$;
drop trigger if exists recovery_remember_chances on brc.job_attempts;
create trigger recovery_remember_chances after insert or update or delete on brc.job_attempts for each row execute function brc.recovery_remember();
drop trigger if exists recovery_remember_prints on brc.applicants;
create trigger recovery_remember_prints after insert or update or delete on brc.applicants for each row execute function brc.recovery_remember();
revoke all on function brc.recovery_remember() from public,anon,authenticated;

create or replace function brc.recovery_risks(p jsonb) returns jsonb
language sql volatile security definer set search_path=brc,public as $$
 select jsonb_build_object(
 'newJobs',(select count(*) from brc.jobs j where not exists(select 1 from jsonb_array_elements(p->'jobs') x where x->>'id'=j.id::text)),
 'missingJobs',(select count(*) from jsonb_array_elements(p->'jobs') x where not exists(select 1 from brc.jobs j where j.id::text=x->>'id')),
 'changedJobs',(select count(*) from brc.jobs j join jsonb_array_elements(p->'jobs') x on x->>'id'=j.id::text where to_jsonb(j)<>x),
 'newCards',(select count(*) from brc.applicants a where not exists(select 1 from jsonb_array_elements(p->'applicants') x where x->>'serial'=a.serial)),
 'changedCards',(select count(*) from brc.applicants a join jsonb_array_elements(p->'applicants') x on x->>'serial'=a.serial where to_jsonb(a)<>x),
 'changedAttempts',(select count(*) from brc.job_attempts t full join jsonb_array_elements(p->'job_attempts') x on x->>'serial'=t.serial and (x->>'attempt_no')::int=t.attempt_no where to_jsonb(t) is distinct from x),
 -- Refuse (never auto-replenish) any spent slot that would vanish or turn empty.
 'spentChanceConflicts',(select count(*) from brc.recovery_chances h where h.spent and exists(select 1 from jsonb_array_elements(p->'applicants') a where a->>'serial'=h.serial) and not exists(select 1 from jsonb_array_elements(p->'job_attempts') x where x->>'serial'=h.serial and (x->>'attempt_no')::int=h.attempt_no and x->>'slot_status'<>'empty')),
 'printedCodeConflicts',(
  (select count(*) from brc.recovery_chances h where exists(select 1 from jsonb_array_elements(p->'applicants') a where a->>'serial'=h.serial) and h.code_hash is distinct from (select encode(extensions.digest(coalesce(x->>'chance_code',''),'sha256'),'hex') from jsonb_array_elements(p->'job_attempts') x where x->>'serial'=h.serial and (x->>'attempt_no')::int=h.attempt_no))+
  (select count(*) from brc.recovery_prints h join brc.applicants a on a.serial=h.serial where h.printed and not exists(select 1 from jsonb_array_elements(p->'applicants') x where x->>'serial'=h.serial))+
  (select count(*) from brc.recovery_prints h join jsonb_array_elements(p->'applicants') x on x->>'serial'=h.serial where h.code_hash is not null and h.code_hash is distinct from case when x->>'card_print_code' is not null then encode(extensions.digest(x->>'card_print_code','sha256'),'hex') end)))
$$;
-- Old staff sessions must never write their pre-restore cached snapshots back.
create or replace function brc.recovery_write_fence() returns trigger
language plpgsql security definer set search_path=brc,public as $$
declare c bigint;
begin
 if current_setting('brc.recovery_running',true)='yes' then return null;end if;
 select cutoff into c from brc.recovery_control where singleton;
 if c>0 and auth.uid() is not null and (coalesce((auth.jwt()->>'iat')::bigint,0)<=c or not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=auth.uid())) then
  raise exception 'تم استرجاع نسخة؛ أعد تسجيل الدخول قبل تعديل البيانات' using errcode='42501';
 end if;
 return null;
end $$;
do $$declare t text;begin
 foreach t in array array['applicants','jobs','job_attempts','settings','employer_job_credentials'] loop
 execute format('drop trigger if exists recovery_write_fence on brc.%I',t);
 execute format('create trigger recovery_write_fence before insert or update or delete on brc.%I for each statement execute function brc.recovery_write_fence()',t);
 end loop;
end $$;

create or replace function brc.recovery_manage(p_action text,p_id uuid default null,p_name text default '',p_token text default '') returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare actor uuid:=auth.uid(); cutoff_value bigint; r record; p jsonb; live jsonb; risks jsonb; token text; result_id uuid; safety_id uuid; item jsonb; t text; creds jsonb; trigger_states jsonb; tr record;
begin
 if actor is null or not brc.is_admin() then raise exception 'النسخ والاسترجاع للمدير الفعال فقط' using errcode='42501';end if;
 if not exists(select 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid and user_id=actor) then raise exception 'يلزم تسجيل دخول رسمي جديد؛ الجلسة غير فعالة' using errcode='42501';end if;
 select cutoff into cutoff_value from brc.recovery_control where singleton;
 if cutoff_value>0 and coalesce((auth.jwt()->>'iat')::bigint,0)<=cutoff_value then raise exception 'أعد تسجيل الدخول بعد الاسترجاع' using errcode='42501';end if;
 if p_action='list' then
  return jsonb_build_object('ok',true,'scope','operational-data-v1','storage','same-project-encrypted','external','usb-manual','copies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'createdAt',created_at,'safety',safety,'counts',counts) order by created_at desc) from brc.recovery_copies),'[]'::jsonb));
 end if;
 if p_action not in ('create','preview','restore','remove') or p_action is null then raise exception 'إجراء غير مدعوم';end if;
 perform set_config('lock_timeout','8s',true);
 -- Serialize backup/restore metadata; table locks coordinate ALL current writers,
 -- including public business RPCs, not only this management endpoint.
 perform pg_advisory_xact_lock(8310192026);
 if p_action='restore' then
  lock table brc.applicants,brc.jobs,brc.job_attempts,brc.settings,brc.employer_job_credentials in access exclusive mode;
  lock table brc.staff in share mode;
 else
  lock table brc.applicants,brc.jobs,brc.job_attempts,brc.settings,brc.employer_job_credentials in share mode;
 end if;
 if not brc.is_admin() then raise exception 'تغيرت صلاحية الحساب أثناء الانتظار' using errcode='42501';end if;
 if p_action='remove' then
  if (select count(*) from brc.recovery_copies)<=1 then raise exception 'لا يمكن حذف آخر نسخة محفوظة';end if;
  if not exists(select 1 from brc.recovery_copies where id=p_id) then raise exception 'النسخة غير موجودة';end if;
  delete from brc.recovery_tickets where copy_id=p_id;
  delete from brc.recovery_copies where id=p_id;
  insert into brc.audit_log(username,role,action,entity,entity_id,details) select username,role,'حذف نسخة محفوظة','backup',p_id::text,'لم تتغير بيانات التشغيل' from brc.staff where auth_id=actor;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='create' then
  result_id:=brc.recovery_save(p_name,false);
  insert into brc.audit_log(username,role,action,entity,entity_id,details) select username,role,'إنشاء نسخة تشغيل مشفرة','backup',result_id::text,'نسخة من القاعدة الفعلية، لا من المتصفح' from brc.staff where auth_id=actor;
  return jsonb_build_object('ok',true,'id',result_id);
 end if;
 p:=brc.recovery_read(p_id); live:=brc.recovery_capture(); risks:=brc.recovery_risks(p);
 if p_action='preview' then
  token:=encode(extensions.gen_random_bytes(32),'hex');
  delete from brc.recovery_tickets where expires_at<clock_timestamp();
  insert into brc.recovery_tickets(token_hash,actor,copy_id,live_hash,expires_at) values(encode(extensions.digest(token,'sha256'),'hex'),actor,p_id,encode(extensions.digest(live::text,'sha256'),'hex'),clock_timestamp()+interval '5 minutes');
  return jsonb_build_object('ok',true,'token',token,'expiresIn',300,'current',brc.recovery_counts(live),'target',brc.recovery_counts(p),'risks',risks,'canRestore',(risks->>'spentChanceConflicts')::int=0 and (risks->>'printedCodeConflicts')::int=0);
 end if;
 -- Recent official login plus a one-use, actor/copy/live-state-bound ticket.
 if coalesce((auth.jwt()->>'iat')::bigint,0)<extract(epoch from clock_timestamp())::bigint-900 then raise exception 'الاسترجاع يحتاج تسجيل دخول حديث خلال 15 دقيقة';end if;
 select * into r from brc.recovery_tickets where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if not found or r.actor<>actor or r.copy_id<>p_id or r.used or r.expires_at<=clock_timestamp() then raise exception 'انتهت المعاينة أو رمز التأكيد غير صالح';end if;
 if r.live_hash<>encode(extensions.digest(live::text,'sha256'),'hex') then raise exception 'تغيرت البيانات بعد المعاينة؛ أعد المعاينة قبل الاسترجاع';end if;
 if (risks->>'spentChanceConflicts')::int>0 or (risks->>'printedCodeConflicts')::int>0 then raise exception 'النسخة تتعارض مع فرص مستهلكة أو رموز مطبوعة؛ يلزم معالجة مستقلة ولا استرجاع تلقائي';end if;
 -- Must succeed BEFORE any destructive write, in the same atomic transaction.
 safety_id:=brc.recovery_save('نسخة أمان قبل الاسترجاع',true);
 -- Preserve current PIN changes for jobs that still exist; restore missing job
 -- credentials from the backup. Never resurrect old employer sessions.
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into creds from brc.employer_job_credentials c;
 select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',g.tgname,'state',g.tgenabled)),'[]'::jsonb) into trigger_states from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='brc' and c.relname in ('applicants','jobs','job_attempts','settings','employer_job_credentials') and not g.tgisinternal;
 perform set_config('brc.recovery_running','yes',true);
 foreach t in array array['applicants','jobs','job_attempts','settings','employer_job_credentials'] loop
  execute format('alter table brc.%I disable trigger user',t);
 end loop;
 alter table brc.applicants enable trigger recovery_remember_prints;
 alter table brc.job_attempts enable trigger recovery_remember_chances;
 delete from brc.employer_otp;
 delete from brc.employer_job_credentials;
 delete from brc.job_attempts;
 delete from brc.jobs;
 delete from brc.applicants;
 -- Missing staff links become NULL; staff/Auth/accounts are NEVER rolled back.
 foreach t in array array['applicants','jobs','job_attempts'] loop
  for item in select value from jsonb_array_elements(p->t) loop
   if item ? 'created_by' and not exists(select 1 from brc.staff where id::text=item->>'created_by') then item:=jsonb_set(item,'{created_by}','null');end if;
   if item ? 'staff_id' and not exists(select 1 from brc.staff where id::text=item->>'staff_id') then item:=jsonb_set(item,'{staff_id}','null');end if;
   execute format('insert into brc.%I select * from jsonb_populate_record(null::brc.%I,$1)',t,t) using item;
  end loop;
 end loop;
 delete from brc.settings where key='rules';
 for item in select value from jsonb_array_elements(p->'settings') loop
  if item ? 'updated_by' and not exists(select 1 from brc.staff where id::text=item->>'updated_by') then item:=jsonb_set(item,'{updated_by}','null');end if;
  insert into brc.settings select * from jsonb_populate_record(null::brc.settings,item);
 end loop;
 for item in select value from jsonb_array_elements(p->'jobs') loop
  select value into live from jsonb_array_elements(creds) where value->>'job_id'=item->>'id';
  if live is null then select value into live from jsonb_array_elements(p->'employer_job_credentials') where value->>'job_id'=item->>'id';end if;
  if live is not null then insert into brc.employer_job_credentials select * from jsonb_populate_record(null::brc.employer_job_credentials,live);end if;
 end loop;
 if exists(select 1 from information_schema.columns where table_schema='brc' and table_name='jobs' and column_name='employer_pin_set') then
  execute 'update brc.jobs j set employer_pin_set=exists(select 1 from brc.employer_job_credentials c where c.job_id=j.id)';
 end if;
 -- Issued serial history is append-only, not rolled back/reused after restore.
 insert into brc.issued_serials(serial) select serial from brc.applicants on conflict do nothing;
 for tr in select value as v from jsonb_array_elements(trigger_states) loop
  execute format('alter table brc.%I %s trigger %I',tr.v->>'table',case tr.v->>'state' when 'D' then 'disable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,tr.v->>'name');
 end loop;
 -- Keep audit history and office receipts. End staff refresh sessions and fence
 -- still-valid access JWTs so stale clients cannot undo the restored database.
 update brc.recovery_control set cutoff=floor(extract(epoch from clock_timestamp()))::bigint where singleton;
 if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id in (select auth_id::text from brc.staff where auth_id is not null)';end if;
 delete from auth.sessions where user_id in (select auth_id from brc.staff where auth_id is not null);
 update brc.recovery_tickets set used=true where token_hash=r.token_hash;
 insert into brc.audit_log(username,role,action,entity,entity_id,details) select username,role,'استرجاع بيانات الموقع','backup',p_id::text,'نسخة الأمان: '||safety_id::text||'؛ انتهت الجلسات القديمة، ولم تُرجع فرصة مستهلكة' from brc.staff where auth_id=actor;
 perform set_config('brc.recovery_running','no',true);
 return jsonb_build_object('ok',true,'safetyId',safety_id,'requiresLogin',true);
end $$;
revoke all on function brc.recovery_schema_hash(),brc.recovery_capture(),brc.recovery_counts(jsonb),brc.recovery_save(text,boolean),brc.recovery_read(uuid),brc.recovery_risks(jsonb),brc.recovery_write_fence(),brc.recovery_manage(text,uuid,text,text) from public,anon,authenticated;
grant execute on function brc.recovery_manage(text,uuid,text,text) to authenticated;
notify pgrst,'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — جدولة النسخ الاحتياطي يحددها المدير من الإعدادات
--  الأيام 0..6 (0 = الأحد) والوقت بتوقيت بغداد (UTC+3)، وتُترجم لتعبير cron
--  بـUTC داخل brc.recovery_cron_expr. الحفظ في brc.settings → recovery_schedule.
-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-11-14: نمطان — كل عدد ساعات، أو أيام محدّدة.
--   interval: كل N ساعة (1..24). 24 = مرة يومياً في الساعة المختارة.
--   days:     أيام 0..6 + ساعة (السلوك القديم).
-- التوقيت بتوقيت بغداد (UTC+3) ويُترجم إلى UTC هنا.
/* ═══════════════════════════════════════════════════════════════════════════
   جدولة النسخ — خمسة أنماط يختارها المدير (2026-11-14)
   ---------------------------------------------------------------------------
   لماذا خمستها؟ لأن التصميم الأول كان «أيام + ساعة» فقط، فطلب صاحب العمل
   خياراً دورياً. ثم اتضح أن «كل ٢٤ ساعة» و«كل يوم» ليسا الشيء نفسه في ذهنه:
     • interval / 24  ⇒ تبدأ من ساعة محددة وتتكرر كل يوم  (أوقات ثابتة)
     • daily          ⇒ كل يوم (مرادف عملي، لكن بلا حقل «كل كم»)
     • every_days N   ⇒ كل N يوم — وهذا **لا يمكن** بـcron وحده لأن كرون لا
                        يحفظ عدّاداً. لذلك نُفعّله بجدولة يومية + فحص «هل مضى N
                        يوم؟» في دالة التنفيذ (brc.recovery_due_now).
                        هذا يعني أن الكرون يعمل يومياً لكن النسخة تُؤخذ فقط
                        عند استحقاقها — لا نسخ زائدة.
     • days [..]      ⇒ أيام محدّدة من الأسبوع
   ⚠️ دروس مدفوعة الثمن مسجّلة هنا كي لا تتكرر:
   ١) الصيغة النجمية (نجمة ثم شرطة مائلة ثم N) في cron تعني — بحرفيّتها — «كل مضاعفات N من منتصف الليل UTC» — تتجاهل الساعة
      المختارة. لذلك نستخدم `h/N` («ابدأ من h ثم كل N»). اختبرناه فعلياً.
   ٢) بغداد = UTC+3 دائماً (العراق ألغى التوقيت الصيفي 2007)، فالتحويل بسيط
      وثابت — لا نستخدم جدول مناطق زمنية ولا نعتمد على قاعدة البيانات.
   ═══════════════════════════════════════════════════════════════════════════ */
create or replace function brc.recovery_cron_expr(
  p_mode text, p_hours int, p_days int[], p_time text
) returns text
language plpgsql immutable set search_path = brc, public, pg_temp
as $$
declare
  h int; m int; utc_h int; shift int; d int; dows int[] := '{}'; expr text;
  mode text := coalesce(nullif(btrim(p_mode), ''), 'days');
begin
  /* الدقائق تُؤخذ من الوقت المختار وتبقى ثابتة في كل الأنماط */
  h := split_part(coalesce(p_time, ''), ':', 1)::int;
  m := split_part(coalesce(p_time, ''), ':', 2)::int;

  /* ── النمط الدوري ─────────────────────────────────────────────────────── */
  if mode = 'interval' then
    if p_hours is null or p_hours < 1 or p_hours > 24 then return null; end if;
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    if p_hours = 24 then return m::text || ' ' || utc_h::text || ' * * *'; end if;
    if p_hours = 1  then return m::text || ' * * * *'; end if;
    /* `h/N` = ابدأ من الساعة h ثم كل N ساعة. الصيغة `*​/N` تتجاهل h —
       فيختار المدير ٦ صباحاً فينفَّذ ٣ فجراً بلا أن يعرف. */
    return m::text || ' ' || utc_h::text || '/' || p_hours::text || ' * * *';
  end if;

  /* ── كل يوم ───────────────────────────────────────────────────────────── */
  if mode = 'daily' then
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    return m::text || ' ' || utc_h::text || ' * * *';
  end if;

  /* ── كل N يوم ────────────────────────────────────────────────────────────
     كرون لا يستطيع التعبير عن «كل N يوم» بصدق (لا عدّاد فيه). نُشغّل الفحص
     يومياً، ودالة التنفيذ تسأل brc.recovery_due_now() هل مضى N يوم.
     الساعة هنا مهمة: هي لحظة الفحص اليومي. */
  if mode = 'every_days' then
    if p_hours is null or p_hours < 1 or p_hours > 365 then return null; end if;
    if coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
    utc_h := h - 3;
    if utc_h < 0 then utc_h := utc_h + 24; end if;
    return m::text || ' ' || utc_h::text || ' * * *';
  end if;

  /* ── الأيام المحددة من الأسبوع ──────────────────────────────────────────── */
  if p_days is null or coalesce(array_length(p_days,1),0) = 0 then return null; end if;
  if coalesce(p_time,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  utc_h := h - 3;
  shift := 0;
  if utc_h < 0 then utc_h := utc_h + 24; shift := -1; end if;
  foreach d in array p_days loop
    if d is null or d < 0 or d > 6 then return null; end if;
    /* إن نزح الوقت للخلف يوماً في UTC، ينزح اليوم كذلك */
    if shift = 0 then dows := dows || d; else dows := dows || ((d + 6) % 7); end if;
  end loop;
  select string_agg(distinct x::text, ',' order by x::text) into expr from unnest(dows) x;
  return m::text || ' ' || utc_h::text || ' * * ' || expr;
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   brc.recovery_due_now() — هل حان وقت النسخة الآن؟
   ---------------------------------------------------------------------------
   السبب: cron لا يملك عدّاداً، فلا يستطيع التعبير عن «كل ٣ أيام» بصدق.
   الحل الأمين: نُشغّل الفحص **يومياً**، وهذه الدالة تقول «نعم» أو «لا».
   ولا نسخة زائدة ولا نسخة ناقصة.

   ⚠️ الحالة تُقرأ من brc.settings، ولا تُحسب من آخر نسخة في الجدول — لأن
   نسخ الأمان اليدوية تسبّب لبساً: لو اعتمدنا على «آخر نسخة» لتأخّر النمط
   الدوري بسبب نسخة يدوية أخذها المدير بنفسه.

   الأنماط التي لا تحتاج فحصاً (interval / daily / days) ترجع دائماً true —
   لأن cron نفسه يضبط مواعيدها بدقة.
   ═══════════════════════════════════════════════════════════════════════════ */
create or replace function brc.recovery_due_now()
returns boolean
language plpgsql stable security definer set search_path = brc, public, pg_temp
as $$
declare v jsonb; mode text; n int; last_at timestamptz;
begin
  select value into v from brc.settings where key = 'recovery_schedule';
  /* لا جدولة مضبوطة ⇒ لا قيد «كل N يوم» ⇒ لا نمنع شيئاً.
     كان `return false` هنا، وهو خطأ: يمنع كل نسخة إن غاب الإعداد — مثلاً
     بعد استرجاع قاعدة قديمة أو قبل ضبط الجدولة أول مرة. */
  if v is null then return true; end if;
  mode := coalesce(v->>'mode', 'days');
  if mode <> 'every_days' then return true; end if;

  n := coalesce((v->>'hours')::int, 0);
  if n < 1 then return false; end if;

  /* آخر نسخة **مجدولة** فقط — لا نسخ الأمان اليدوية */
  select (value #>> '{}')::timestamptz into last_at
    from brc.settings where key = 'recovery_last_scheduled_at';
  if last_at is null then return true; end if;  -- أول مرة: نأخذها فوراً
  return now() >= last_at + (n || ' days')::interval;
end $$;

/* التواقيع القديمة محفوظة للتوافق — كود أو اختبار قديم يستدعيها */
create or replace function brc.recovery_cron_expr(p_days int[], p_time text)
returns text language sql immutable set search_path = brc, public, pg_temp
as $$ select brc.recovery_cron_expr('days', null, p_days, p_time) $$;

create or replace function brc.recovery_retention_keep()
returns integer language sql stable set search_path = brc, public, pg_temp
as $$
  select least(10, greatest(1, coalesce(
    (select (value->>'keep')::int from brc.settings where key = 'recovery_retention'), 3)));
$$;
revoke all on function brc.recovery_retention_keep() from public, anon, authenticated;

/* تقليم النسخ: آخر N مجدولة — نسخ الأمان (safety=true) لا تُمسّ */
create or replace function brc.recovery_prune(p_keep int)
returns integer language plpgsql security definer set search_path=brc,public as $$
declare v_keep int := coalesce(p_keep, brc.recovery_retention_keep());
        v_deleted int := 0; v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    /* الترتيب المزدوج ضروري: نسخ كثيرة قد تُنشأ في نفس الثانية، وcreated_at
       وحده لا يحدد الأقدم. id مُشتق من البيانات وقت الإدراج فيعطي ترتيباً
       ثابتاً، ومع ذلك نُبقي created_at أولاً كي يبقى المعنى الزمني. */
    select id from brc.recovery_copies where safety = false
     order by created_at desc, id desc offset greatest(1, v_keep)) old;
  if coalesce(array_length(v_ids,1), 0) > 0 then
    delete from brc.recovery_tickets where copy_id = any(v_ids);
    delete from brc.recovery_copies where id = any(v_ids);
    get diagnostics v_deleted = row_count;
  end if;
  return v_deleted;
end $$;
revoke all on function brc.recovery_prune(int) from public, anon, authenticated;

create or replace function brc.recovery_prune() returns integer
language sql security definer set search_path = brc, public, pg_temp
as $$ select brc.recovery_prune(brc.recovery_retention_keep()) $$;

revoke all on function brc.recovery_prune() from public, anon, authenticated;

/* عدد النسخ المحفوظة — قرار صاحب العمل 2026-11-14: آخر ٣ */
do $$ begin
  insert into brc.settings(key, value, updated_at)
  values ('recovery_retention', '{"keep": 3}'::jsonb, now())
  on conflict (key) do nothing;
exception when others then null; end $$;

create or replace function brc.recovery_schedule_get()
returns jsonb language plpgsql security definer set search_path=brc,public as $$
declare v jsonb; job record; last_run timestamptz;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'هذه الجدولة للمدير فقط');
  end if;
  select value into v from brc.settings where key='recovery_schedule';
  select jobid, schedule, active into job from cron.job where jobname='recovery-auto-backup';
  select max(start_time) into last_run from cron.job_run_details d where d.jobid = job.jobid and d.status='succeeded';
  return jsonb_build_object(
    'ok', true,
    'mode', coalesce(v->>'mode','days'),
    'hours', coalesce((v->>'hours')::int, 0),
    'days', coalesce(v->'days','[]'::jsonb),
    'time', coalesce(v->>'time','23:00'),
    'keep', brc.recovery_retention_keep(),
    'dueNow', brc.recovery_due_now(),
    'lastScheduled', (select value #>> '{}' from brc.settings where key='recovery_last_scheduled_at'),
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'timezone', 'Asia/Baghdad',
    'cron', job.schedule,
    'active', coalesce(job.active, false),
    'lastRun', last_run,
    'updatedAt', (select updated_at from brc.settings where key='recovery_schedule'));
end $$;

create or replace function brc.recovery_schedule_set(
  p_mode text, p_hours int, p_days int[], p_time text
) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare
  expr text; on_off boolean := true; job_id bigint; clean int[] := '{}';
  v_mode text; v_hours int; v_time text;
begin
  if not brc.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'تعديل الجدولة من صلاحيات المدير فقط');
  end if;

  v_mode := coalesce(nullif(btrim(p_mode), ''), 'days');
  if v_mode not in ('interval', 'daily', 'every_days', 'days') then
    return jsonb_build_object('ok', false, 'error', 'نمط جدولة غير معروف');
  end if;
  v_time := coalesce(nullif(btrim(p_time), ''), '23:00');
  v_hours := coalesce(p_hours, 0);

  if v_mode = 'interval' then
    if v_hours < 1 or v_hours > 24 then
      return jsonb_build_object('ok', false, 'error', 'عدد الساعات يجب أن يكون بين ١ و٢٤');
    end if;

  elsif v_mode = 'every_days' then
    if v_hours < 1 or v_hours > 365 then
      return jsonb_build_object('ok', false, 'error', 'عدد الأيام يجب أن يكون بين ١ و٣٦٥');
    end if;

  elsif v_mode = 'daily' then
    v_hours := 1;

  else  -- 'days'
    select coalesce(array_agg(distinct d order by d), '{}') into clean
      from unnest(coalesce(p_days, '{}')) d where d between 0 and 6;
    on_off := coalesce(array_length(clean, 1), 0) > 0;
    v_hours := 0;
    /* لا أيام = إيقاف الجدولة، وهذا سلوك مقصود لا خطأ */
    if not on_off then
      delete from cron.job where jobname = 'recovery-auto-backup';
      insert into brc.settings(key, value, updated_at, updated_by)
      values ('recovery_schedule', jsonb_build_object(
                'mode','days','hours',0,'days','[]'::jsonb,'time',v_time,
                'enabled',false,'timezone','Asia/Baghdad','cron',null,'updatedAt',now()), now(),
              (select id from brc.staff where auth_id = auth.uid()))
      on conflict (key) do update set value = excluded.value, updated_at = now(),
        updated_by = excluded.updated_by;
      return brc.recovery_schedule_get();
    end if;
  end if;

  if v_mode <> 'days' then
    expr := brc.recovery_cron_expr(v_mode, v_hours, null, v_time);
  else
    expr := brc.recovery_cron_expr('days', null, clean, v_time);
  end if;
  if expr is null then
    return jsonb_build_object('ok', false, 'error', 'وقت غير صالح — الصيغة HH:MM (24 ساعة)');
  end if;

  insert into brc.settings(key, value, updated_at, updated_by)
  values ('recovery_schedule', jsonb_build_object(
            'mode', v_mode, 'hours', v_hours,
            'days', to_jsonb(clean), 'time', v_time,
            'enabled', true, 'timezone','Asia/Baghdad',
            'cron', expr, 'updatedAt', now()), now(),
          (select id from brc.staff where auth_id = auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;

  select jobid into job_id from cron.job where jobname='recovery-auto-backup';
  if job_id is null then
    perform cron.schedule('recovery-auto-backup', expr, 'select brc.recovery_run_scheduled();');
  else
    perform cron.alter_job(job_id, schedule := expr, command := 'select brc.recovery_run_scheduled();', active := true);
  end if;

  return brc.recovery_schedule_get();
end $$;

/* التوقيع القديم محفوظ للتوافق */
create or replace function brc.recovery_schedule_set(p_days int[], p_time text)
returns jsonb language sql security definer set search_path = brc, public, pg_temp
as $$ select brc.recovery_schedule_set('days', null, p_days, p_time) $$;

create or replace function brc.recovery_run_scheduled()
returns uuid language plpgsql security definer set search_path=brc,public as $$
declare p jsonb; k text; result uuid;
begin
  /* بوابة الاستحقاق — للنمط «كل N يوم» فقط. غيره يرجع true دائماً.
     بدونها يعمل cron يومياً ويأخذ نسخة كل يوم مهما اختار المدير. */
  if not brc.recovery_due_now() then return null; end if;
  perform set_config('lock_timeout','8s',true);
  perform pg_advisory_xact_lock(8310192026);
  lock table brc.applicants,brc.jobs,brc.job_attempts,brc.settings,brc.employer_job_credentials in share mode;
  p := brc.recovery_capture();
  select secret into strict k from brc.recovery_control where singleton;
  insert into brc.recovery_copies(name,actor,safety,counts,schema_hash,data_hash,ciphertext)
  values ('نسخة مجدولة — ' || to_char(clock_timestamp() at time zone 'Asia/Baghdad','YYYY-MM-DD HH24:MI'),
          null,false,brc.recovery_counts(p),p->>'schema',
          encode(extensions.digest(p::text,'sha256'),'hex'),
          extensions.pgp_sym_encrypt(p::text,k,'cipher-algo=aes256,compress-algo=1'))
  returning id into result;
  if brc.recovery_read(result) is distinct from p then
    raise exception 'فشل التحقق من النسخة المجدولة';
  end if;
  /* 2026-11-14: آخر N نسخة (افتراضياً ٣) بدل حذف كل ما قبلها.
     كان: حذف كل النسخ عدا الجديدة ⇒ نسخة واحدة فقط في القاعدة. */
  /* نسجّل وقت آخر نسخة مجدولة — تعتمد عليه recovery_due_now للنمط «كل N يوم».
     لا نقرأه من جدول النسخ لأن نسخة أمان يدوية قد تُربك الحساب. */
  insert into brc.settings(key, value, updated_at)
  values ('recovery_last_scheduled_at', to_jsonb(now()), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform brc.recovery_prune();
  delete from brc.recovery_tickets where copy_id not in (select id from brc.recovery_copies);
  return result;
end $$;

revoke all on function brc.recovery_cron_expr(int[],text) from public,anon,authenticated;
revoke all on function brc.recovery_cron_expr(text,int,int[],text) from public,anon,authenticated;
revoke all on function brc.recovery_due_now() from public,anon,authenticated,service_role;
revoke all on function brc.recovery_schedule_get() from public,anon,authenticated,service_role;
revoke all on function brc.recovery_schedule_set(int[],text) from public,anon,authenticated,service_role;
revoke all on function brc.recovery_schedule_set(text,int,int[],text) from public,anon,authenticated,service_role;
revoke all on function brc.recovery_run_scheduled() from public,anon,authenticated,service_role;
grant execute on function brc.recovery_schedule_get() to authenticated;
grant execute on function brc.recovery_schedule_set(text,int,int[],text) to authenticated;
grant execute on function brc.recovery_schedule_set(int[],text) to authenticated;

-- نسخة أمان فورية عند تغيّر شكل المخطط (شبكة أمان: لا تُنشئ نسخة إن وُجدت صالحة)
create or replace function brc.recovery_ensure_fresh() returns uuid
language plpgsql security definer set search_path=brc,public as $$
declare last_name text; result uuid;
begin
  if exists (select 1 from brc.recovery_copies where schema_hash = brc.recovery_schema_hash()) then
    return null;
  end if;
  last_name := 'نسخة تلقائية — تغيّر شكل قاعدة البيانات ' ||
    to_char(clock_timestamp() at time zone 'Asia/Baghdad', 'YYYY-MM-DD HH24:MI');
  result := brc.recovery_save(last_name, false);
  insert into brc.audit_log(username, role, action, entity, entity_id, details)
  values ('system', 'system', 'نسخة أمان تلقائية', 'recovery', result::text,
          'شكل قاعدة البيانات تغيّر (هجرة أعمدة) ولم تبقَ نسخة صالحة — أُنشئت نسخة جديدة تلقائياً.');
  return result;
end $$;
revoke all on function brc.recovery_ensure_fresh() from public,anon,authenticated;

-- الجدولة الافتراضية: الجمعة 23:00 بغداد — قابلة للتغيير من لوحة المدير
do $$ begin
  insert into brc.settings(key,value,updated_at)
  values ('recovery_schedule', jsonb_build_object('days',to_jsonb(array[5]),'time','23:00','enabled',true,
          'timezone','Asia/Baghdad','cron','0 20 * * 5','updatedAt',now()), now())
  on conflict (key) do nothing;
exception when others then null; end $$;
do $$ begin
  if coalesce((select (value->>'enabled')::boolean from brc.settings where key='recovery_schedule'), true) then
    perform cron.schedule('recovery-auto-backup',
      coalesce((select value->>'cron' from brc.settings where key='recovery_schedule'),'0 20 * * 5'),
      'select brc.recovery_run_scheduled();');
  end if;
exception when others then
  raise notice 'pg_cron غير متاح — جدولة النسخ تُضبط لاحقاً: %', sqlerrm;
end $$;
do $$ begin
  perform cron.schedule('recovery-ensure-fresh', '10 1 * * *', 'select brc.recovery_ensure_fresh();');
exception when others then null; end $$;

notify pgrst,'reload schema';


-- 2026-10-20: independent numbered vacancies, current-case notification support.
-- Independent numbered vacancies within ONE job advertisement. Not card chances.
-- Preflight is intentionally fail-closed; never discard an existing placement.
do $$begin if not exists(select 1 from information_schema.columns where table_schema='brc' and table_name='jobs' and column_name='manual_closed') then alter table brc.jobs add column manual_closed boolean not null default false;update brc.jobs set manual_closed=true where status='closed';end if;end $$;
alter table brc.jobs add column if not exists filled_vacancy_numbers integer[] not null default '{}';
alter table brc.job_attempts add column if not exists vacancy_no integer check(vacancy_no>0);
do $$begin
 if exists(select 1 from brc.job_attempts a join brc.jobs j on j.id=a.job_id where a.slot_status in('reserved','critical','hiring','succeeded') group by j.id,j.vacancies having count(*)>j.vacancies) then raise exception 'Existing placements exceed vacancy capacity; review before migration';end if;
end $$;
with ranked as(select id,row_number() over(partition by job_id order by selected_at nulls last,id)::int n from brc.job_attempts where job_id is not null and slot_status in('reserved','critical','hiring','succeeded'))
update brc.job_attempts a set vacancy_no=r.n from ranked r where a.id=r.id and a.vacancy_no is null;
create unique index if not exists job_vacancy_occupied on brc.job_attempts(job_id,vacancy_no) where slot_status in('reserved','critical','hiring','succeeded');

create or replace function brc.trg_job_vacancies() returns trigger language plpgsql security definer set search_path=brc,public as $$
declare used int[]; pending record; filled int; held int;
begin
 -- Permanent fill numbers cannot be erased by stale browser mirrors or card deletion.
 select coalesce(array_agg(distinct n order by n),'{}') into new.filled_vacancy_numbers from(
 select unnest(old.filled_vacancy_numbers) n union select vacancy_no from brc.job_attempts where job_id=new.id and slot_status='succeeded' and vacancy_no is not null) s;
 select coalesce(array_agg(distinct n),'{}') into used from(select unnest(new.filled_vacancy_numbers) n union select vacancy_no from brc.job_attempts where job_id=new.id and slot_status in('reserved','critical','hiring') and vacancy_no is not null) s;
 if coalesce((select max(n) from unnest(used) n),0)>new.vacancies then raise exception 'لا يمكن تقليل الشواغر تحت رقم شاغر مشغول';end if;
 select * into pending from brc.job_attempts where job_id=new.id and slot_status in('reserved','critical','hiring') order by vacancy_no limit 1;
 filled:=cardinality(new.filled_vacancy_numbers);held:=cardinality(used)-filled;
 new.status:=case when new.manual_closed then 'closed'::brc.job_status when cardinality(used)<new.vacancies then 'available'::brc.job_status when filled>=new.vacancies then 'closed'::brc.job_status when exists(select 1 from brc.job_attempts where job_id=new.id and slot_status='hiring') then 'hiring'::brc.job_status else 'reserved'::brc.job_status end;
 new.reserved_by:=pending.serial;new.hold_expires_at:=pending.hold_expires_at;
 new.critical:=exists(select 1 from brc.job_attempts where job_id=new.id and slot_status='critical');
 new.closed_at:=case when new.status='closed' then coalesce(new.closed_at,now()) else null end;
 return new;
end $$;
drop trigger if exists trg_job_vacancies on brc.jobs;
create trigger trg_job_vacancies before update on brc.jobs for each row execute function brc.trg_job_vacancies();

create or replace function brc.trg_attempt_hold() returns trigger language plpgsql security definer set search_path=brc,public as $$
declare j brc.jobs; f brc.applicants; hours int; seat int;
begin
 if tg_op='UPDATE' and old.job_id is not null and new.job_id is null and old.slot_status in('reserved','critical','hiring') then new.slot_status:='expired';new.closed_at:=now();new.hold_expires_at:=null;new.outcome_note:='حذفت الشركة الإعلان — الفرصة مستهلكة';end if;
 if tg_op='UPDATE' and old.slot_status in('succeeded','rejected','expired') and new.slot_status is distinct from old.slot_status then raise exception 'الفرصة مستهلكة ولا يمكن إعادة استخدامها';end if;
 if new.slot_status='reserved' and (tg_op='INSERT' or old.slot_status is distinct from 'reserved') then
  if tg_op='UPDATE' and old.slot_status<>'empty' then raise exception 'الفرصة ليست فارغة';end if;
  select * into f from brc.applicants where serial=new.serial for update;
  if f.serial is null or f.status in('blank','pending','rejected','expired','exhausted') or f.expiry_date<now() then raise exception 'البطاقة غير صالحة للتقديم';end if;
  select * into j from brc.jobs where id=new.job_id for update;
  if j.id is null or j.manual_closed then raise exception 'الوظيفة غير متاحة';end if;
  select n into seat from generate_series(1,j.vacancies) n where not(n=any(j.filled_vacancy_numbers)) and not exists(select 1 from brc.job_attempts a where a.job_id=j.id and a.vacancy_no=n and a.slot_status in('reserved','critical','hiring','succeeded') and a.id<>new.id) order by n limit 1;
  if seat is null then raise exception 'لا يوجد شاغر متاح';end if;
  -- Start validity atomically only on the first successful reservation.
  if f.issue_date is null and f.expiry_date is null then
   update brc.applicants set issue_date=now(), expiry_date=now()+make_interval(days=>coalesce((select (value->>'validity_days')::int from brc.settings where key='rules'),30)) where serial=f.serial;
  end if;
  select coalesce((value->>'hold_hours')::int,24) into hours from brc.settings where key='rules';
  new.vacancy_no:=seat;new.job_code:=j.code;new.selected_at:=coalesce(new.selected_at,now());new.hold_expires_at:=coalesce(new.hold_expires_at,now()+make_interval(hours=>coalesce(hours,24)));new.closed_at:=null;
 elsif tg_op='UPDATE' and old.vacancy_no is not null and (new.vacancy_no is distinct from old.vacancy_no or (new.job_id is distinct from old.job_id and new.job_id is not null)) then raise exception 'لا يمكن نقل شاغر فرصة مستخدمة';
 end if;
 if new.slot_status in('succeeded','rejected','expired') and (tg_op='INSERT' or old.slot_status is distinct from new.slot_status) then
  if tg_op='UPDATE' and old.slot_status not in('reserved','critical','hiring') then raise exception 'لا يوجد حجز قيد القرار';end if;
  new.closed_at:=coalesce(new.closed_at,now());new.hold_expires_at:=null;
 end if;
 return new;
end $$;
drop trigger if exists trg_attempt_hold on brc.job_attempts;
create trigger trg_attempt_hold before insert or update on brc.job_attempts for each row execute function brc.trg_attempt_hold();
create or replace function brc.trg_sync_vacancies() returns trigger language plpgsql security definer set search_path=brc,public as $$begin
 update brc.jobs set updated_at=now() where id=coalesce(new.job_id,old.job_id);return coalesce(new,old);
end $$;
drop trigger if exists trg_sync_vacancies on brc.job_attempts;
create trigger trg_sync_vacancies after insert or update or delete on brc.job_attempts for each row execute function brc.trg_sync_vacancies();
-- Recompute existing jobs; preserve explicitly closed advertisements.
update brc.jobs set updated_at=updated_at;
revoke all on function brc.trg_job_vacancies(),brc.trg_sync_vacancies() from public,anon,authenticated;




create or replace function brc.run_auto_release() returns table (released_job text, expired_form text)
language plpgsql security definer
set search_path = brc, public
as $$
declare r record;
begin
  for r in select a.id,a.job_code,a.serial from brc.job_attempts a where a.slot_status='reserved' and a.hold_expires_at<now() for update loop
    update brc.job_attempts set slot_status='critical',hold_expires_at=null,outcome_note='انتهت مهلة الشاغر — بانتظار قرار الشركة' where id=r.id;
    released_job:=r.job_code;expired_form:=r.serial;return next;
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



create or replace view brc.public_jobs
with (security_invoker = false) as
  select code, title, category, region, governorate, shift, salary_min, salary_max, gender,
         vacancies, requirements, status,
         (status = 'reserved') as is_reserved,
         hold_expires_at,
         created_at,
         -- الوصف والصورة جزء من الإعلان نفسه فيظهران للزائر (بخلاف اسم صاحب
         -- العمل وهاتفه ومكان المقابلة التي تبقى محجوبة للداخل). بدون هذين
         -- العمودين تظهر بطاقات الوظائف في الموقع العام بلا وصف ولا صورة.
         coalesce(description, '') as description,
         coalesce(image_url, '') as image_url,
         case when j.manual_closed then 0 else greatest(j.vacancies-cardinality(j.filled_vacancy_numbers)-(select count(*)::int from brc.job_attempts a where a.job_id=j.id and a.slot_status in('reserved','critical','hiring')),0) end as available_vacancies
    from brc.jobs j
   where status <> 'closed' or created_at > now() - interval '120 days';

-- 2026-10-20: 60-day retention and bounded historical reads.
-- Retain every card and opportunity. Archive only resolved/expired cards after
-- 60 days; never archive a pending application or replenish a printed chance.
alter table brc.applicants add column if not exists archived_at timestamptz;
create index if not exists applicants_working_idx on brc.applicants(serial) where archived_at is null;
create index if not exists applicants_history_idx on brc.applicants(created_at desc,serial);

create or replace function brc.card_finished_at(p_serial text) returns timestamptz
language sql stable security invoker set search_path=brc,public as $$
 select case
 when a.status in ('blank','pending','rejected') then null
 when exists(select 1 from brc.job_attempts t where t.serial=a.serial and t.slot_status in ('reserved','critical','hiring')) then null
 when exists(select 1 from brc.job_attempts t where t.serial=a.serial and t.slot_status in ('succeeded','rejected','expired') and t.closed_at is null) then null
 when (select count(*) from brc.job_attempts t where t.serial=a.serial and t.slot_status in ('succeeded','rejected','expired'))>=coalesce(a.attempt_limit,2)
 then (select max(t.closed_at) from brc.job_attempts t where t.serial=a.serial)
 when a.expiry_date<=now() then greatest(a.expiry_date,(select max(t.closed_at) from brc.job_attempts t where t.serial=a.serial))
 else null end from brc.applicants a where a.serial=p_serial
$$;
revoke all on function brc.card_finished_at(text) from public,anon,authenticated;

create or replace function brc.archive_finished_cards() returns integer
language plpgsql security definer set search_path=brc,public as $$
declare affected integer;
begin
 with candidates as materialized (
 select a.serial from brc.applicants a where a.archived_at is null
 and brc.card_finished_at(a.serial)<=now()-interval '60 days'
 for update of a skip locked
 ) update brc.applicants a set archived_at=now(),updated_at=now()
 from candidates c where a.serial=c.serial;
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function brc.archive_finished_cards() from public,anon,authenticated;

-- Authenticated staff cannot clear/change archive stamps or edit archived cards.
-- Owner-run recovery still uses its existing transaction/fences and trigger rules.
create or replace function brc.trg_archive_readonly() returns trigger
language plpgsql security invoker set search_path=brc,public as $$
begin
 if current_user not in ('postgres','service_role') and
 ((tg_op='INSERT' and new.archived_at is not null) or (tg_op='UPDATE' and (old.archived_at is not null or new.archived_at is distinct from old.archived_at))) then
 raise exception 'البطاقة مؤرشفة للمراجعة فقط؛ لا يمكن إعادة فرصها أو تغيير أرشفتها';
 end if;
 return new;
end $$;
drop trigger if exists trg_archive_readonly on brc.applicants;
create trigger trg_archive_readonly before insert or update on brc.applicants for each row execute function brc.trg_archive_readonly();
revoke all on function brc.trg_archive_readonly() from public,anon,authenticated;

-- Invoker views retain existing staff RLS. Omitted rows are NOT deleted rows.
create or replace view brc.working_applicants with(security_invoker=true) as
 select * from brc.applicants where archived_at is null;
create or replace view brc.working_job_attempts with(security_invoker=true) as
 select t.* from brc.job_attempts t join brc.working_applicants a on a.serial=t.serial;
create or replace view brc.working_jobs with(security_invoker=true) as
 select j.* from brc.jobs j where j.status<>'closed'
 or coalesce(j.closed_at,j.created_at)>now()-interval '60 days'
 or exists(select 1 from brc.working_job_attempts t where t.job_id=j.id);
revoke all on brc.working_applicants,brc.working_job_attempts,brc.working_jobs from public,anon;
grant select on brc.working_applicants,brc.working_job_attempts,brc.working_jobs to authenticated;

-- Fixed-size server-side historical search, including archived AND current cards.
-- Curated fields only: no chance codes, print verification codes, PINs or tokens.
create or replace function brc.staff_card_history(p_query text default '',p_page integer default 0) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare result jsonb; q text:=btrim(coalesce(p_query,''));
begin
 if not brc.is_staff() then raise exception 'غير مخول' using errcode='42501'; end if;
 if length(q)>120 or p_page is null or p_page<0 or p_page>100000 then raise exception 'بحث غير صالح';end if;
 with matches as materialized (
 select a.* from brc.applicants a where q=''
 or position(lower(q) in lower(a.serial))>0
 or position(lower(q) in lower(a.full_name))>0
 or position(q in a.phone)>0
 order by a.created_at desc,a.serial offset p_page*50 limit 51
 ), page as (select * from matches order by created_at desc,serial limit 50)
 select jsonb_build_object('page',p_page,'hasMore',(select count(*)>50 from matches),
 'cards',coalesce(jsonb_agg(jsonb_build_object(
 'serial',a.serial,'fullName',a.full_name,'phone',a.phone,'address',a.address,'status',a.status,
 'issueDate',a.issue_date,'expiryDate',a.expiry_date,'archivedAt',a.archived_at,'finishedAt',brc.card_finished_at(a.serial),
 'attemptLimit',a.attempt_limit,'notes',a.notes,
 'attempts',coalesce((select jsonb_agg(jsonb_build_object('no',t.attempt_no,'jobCode',t.job_code,'jobTitle',j.title,
 'vacancyNo',t.vacancy_no,'slotStatus',t.slot_status,'selectedAt',t.selected_at,'closedAt',t.closed_at,
 'employerDecision',t.employer_decision,'reason',t.employer_reason,'note',t.outcome_note) order by t.attempt_no)
 from brc.job_attempts t left join brc.jobs j on j.id=t.job_id where t.serial=a.serial),'[]'::jsonb))
 order by a.created_at desc,a.serial),'[]'::jsonb)) into result from page a;
 return result;
end $$;
revoke all on function brc.staff_card_history(text,integer) from public,anon;
grant execute on function brc.staff_card_history(text,integer) to authenticated;


-- Lifetime accounting remains server-side: archival must not reduce totals.
create or replace function brc.staff_card_report(p_from date default null,p_to date default null) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare result jsonb;
begin
 if not brc.is_staff() then raise exception 'غير مخول' using errcode='42501';end if;
 if p_from>p_to then raise exception 'الفترة غير صالحة';end if;
 with attempts as materialized (
 select serial,count(*) filter(where slot_status='empty') empty_count,
 count(*) filter(where slot_status in('reserved','critical','hiring')) in_play,
 count(*) filter(where slot_status='succeeded') hires,count(*) filter(where slot_status='reserved') holds
 from brc.job_attempts group by serial
 ), cards as materialized (
 select a.*,coalesce(t.hires,0) hires,coalesce(t.holds,0) holds,
 case when a.status in('blank','pending','rejected') then a.status::text
 when a.expiry_date is not null and a.expiry_date<now() then 'expired'
 when coalesce(t.empty_count,0)=0 and coalesce(t.in_play,0)=0 then 'exhausted' else 'active' end effective_status,
 coalesce((to_jsonb(a)->>'paid_amount')::numeric,0) paid_amount
 from brc.applicants a left join attempts t on t.serial=a.serial
 ), financial as (
 select coalesce(a.created_by::text,'system') "user",coalesce(s.full_name,a.created_by::text,'system') name,
 count(*) forms,sum(coalesce(a.printed_count,0)) printed,sum(a.fee_amount) expected,
 sum(case when a.paid_amount>0 then least(a.paid_amount,a.fee_amount) when a.fee_paid then a.fee_amount else 0 end) collected,
 sum(a.hires) hires,sum(a.holds) holds,
 count(*) filter(where a.paid_amount>=a.fee_amount or (a.paid_amount<=0 and a.fee_paid)) paid,
 count(*) filter(where a.paid_amount>0 and a.paid_amount<a.fee_amount) partial,
 count(*) filter(where a.paid_amount<=0 and not a.fee_paid) unpaid
 from cards a left join brc.staff s on s.id=a.created_by
 where (p_from is null or (a.issue_date at time zone 'Asia/Baghdad')::date>=p_from)
 and (p_to is null or (a.issue_date at time zone 'Asia/Baghdad')::date<=p_to)
 group by a.created_by,s.full_name
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(f) order by expected desc) from financial f),'[]'::jsonb),
 'stats',jsonb_build_object('forms',(select count(*) from cards),'activeForms',(select count(*) from cards where effective_status='active'),
 'blankForms',(select count(*) from cards where effective_status='blank'),'pendingForms',(select count(*) from cards where effective_status='pending'),
 'expiredForms',(select count(*) from cards where effective_status='expired'),'hires',(select count(*) from brc.job_attempts where slot_status='succeeded'),
 'totalJobs',(select count(*) from brc.jobs),'available',(select count(*) from brc.jobs where status='available'),
 'reserved',(select count(*) from brc.jobs where status='reserved'),'closed',(select count(*) from brc.jobs where status='closed'))) into result;
 return result;
end $$;
revoke all on function brc.staff_card_report(date,date) from public,anon;
grant execute on function brc.staff_card_report(date,date) to authenticated;


-- Compact exact occupancy map for the ORIGINAL 9000 x 23 x 23 printed chance
-- codes. Omitting archived attempts must never permit reissuing their codes.
-- 595125 bytes regardless of history size; staff-only, held in memory, not cache.
create or replace function brc.staff_issuance_registry(p_serial text default null) returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare packed text;
begin
 if not brc.is_staff() then raise exception 'غير مخول' using errcode='42501';end if;
 if p_serial is not null then
 if length(p_serial)>128 then raise exception 'كود غير صالح';end if;
 return jsonb_build_object('used',exists(select 1 from brc.issued_serials where serial=upper(btrim(p_serial))) or exists(select 1 from brc.applicants where serial=upper(btrim(p_serial))));
 end if;
 with valid as materialized(select chance_code c from brc.job_attempts where chance_code ~ '^[1-9][0-9]{3}-[A-HJKMNP-Z]{2}$'),
 indices as(select (substring(c,1,4)::int-1000)*529+(strpos('ABCDEFGHJKMNPQRSTUVWXYZ',substring(c,6,1))-1)*23+strpos('ABCDEFGHJKMNPQRSTUVWXYZ',substring(c,7,1))-1 n from valid),
 bytes as(select n/8 pos,bit_or(1<<(n%8)) mask from indices group by n/8)
 select encode(decode(string_agg(lpad(to_hex(coalesce(b.mask,0)),2,'0'),'' order by p.n),'hex'),'base64') into packed
 from generate_series(0,595124) p(n) left join bytes b on b.pos=p.n;
 return jsonb_build_object('version',1,'bitmap',packed);
end $$;
revoke all on function brc.staff_issuance_registry(text) from public,anon;
grant execute on function brc.staff_issuance_registry(text) to authenticated;

-- Initial metadata-only sweep; no DELETE, no opportunity/job outcome changes.
select brc.archive_finished_cards();
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
 perform cron.schedule('hrc-card-archive-daily','15 0 * * *','select brc.archive_finished_cards();');
 end if;
end $$;
notify pgrst,'reload schema';

-- Customer access is by card barcode alone (owner-approved). Limit every result
-- to the exact card and selected opportunity; never expose unused/other jobs.
create or replace function brc.customer_application_details(p_serial text, p_attempt_no integer)
returns jsonb language plpgsql security definer set search_path = brc, public as $$
declare f record; a record; v_job jsonb;
begin
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
revoke all on function brc.customer_application_details(text,integer) from public;
grant execute on function brc.customer_application_details(text,integer) to anon,authenticated;
notify pgrst, 'reload schema';

-- Snapshot only information needed for the issued application, on the
-- opportunity itself so ordinary backup/restore includes it. Historical
-- opportunities with a still-linked job are backfilled without inventing data.
alter table brc.job_attempts add column if not exists job_snapshot jsonb;
-- A PostgreSQL SELECT * view does not automatically include newly added columns.
create or replace view brc.working_job_attempts with(security_invoker=true) as
 select t.* from brc.job_attempts t join brc.working_applicants a on a.serial=t.serial;
create or replace function brc.application_job_snapshot(j brc.jobs) returns jsonb
language sql stable set search_path=brc,public as $$
  select jsonb_build_object('code',j.code,'title',j.title,'governorate',j.governorate,
    'employer_name',j.employer_name,'employer_phone',j.employer_phone,'employer_address',j.employer_address,
    'interview_location',j.interview_location,'shift',j.shift,'salary_min',j.salary_min,'salary_max',j.salary_max)
$$;
revoke all on function brc.application_job_snapshot(brc.jobs) from public,anon,authenticated;
-- Backfill runs under the table DDL lock. Suppress the audit, recovery registry and job
-- recomputation side effects; preserve their previous enabled states exactly.
-- Recovery fences and all integrity triggers stay enabled.
do $$
declare t record; saved jsonb;
begin
 select coalesce(jsonb_object_agg(tgname,tgenabled::text),'{}'::jsonb) into saved
 from pg_trigger where tgrelid='brc.job_attempts'::regclass and not tgisinternal
   and tgname in ('trg_sync_vacancies','trg_audit_attempts','recovery_remember_chances');
 for t in select key as name,value as state from jsonb_each_text(saved) where value<>'D' loop
   execute format('alter table brc.job_attempts disable trigger %I',t.name);
 end loop;
 update brc.job_attempts a set job_snapshot=brc.application_job_snapshot(j)
  from brc.jobs j where a.job_id=j.id and a.job_code=j.code and a.selected_at is not null
  and a.slot_status<>'empty' and a.job_snapshot is null;
 for t in select key as name,value as state from jsonb_each_text(saved) where value<>'D' loop
   execute format('alter table brc.job_attempts %s trigger %I',
     case t.state when 'R' then 'enable replica' when 'A' then 'enable always' else 'enable' end,t.name);
 end loop;
end $$;
create or replace function brc.capture_application_job_snapshot() returns trigger
language plpgsql security definer set search_path=brc,public as $$
begin
  if tg_op='UPDATE' and old.job_snapshot is not null and new.job_code is not distinct from old.job_code then
    -- Stale client upserts must not erase the archived details, including on FK SET NULL.
    new.job_snapshot:=old.job_snapshot;
  elsif new.slot_status<>'empty' and new.selected_at is not null and new.job_snapshot->>'code'=new.job_code then
    -- Retain an archived snapshot from a legitimate backup restore.
    null;
  elsif new.job_id is not null and new.selected_at is not null and new.slot_status<>'empty' then
    select brc.application_job_snapshot(j) into new.job_snapshot
      from brc.jobs j where j.id=new.job_id and j.code=new.job_code;
  else
    new.job_snapshot:=null;
  end if;
  return new;
end $$;
drop trigger if exists zz_capture_application_job_snapshot on brc.job_attempts;
create trigger zz_capture_application_job_snapshot before insert or update on brc.job_attempts
 for each row execute function brc.capture_application_job_snapshot();
revoke all on function brc.capture_application_job_snapshot() from public,anon,authenticated;

-- ===========================================================================
--  11) service_role — منح صريح في **آخر** الملف (2026-11-13)
-- ===========================================================================
-- ⚠️ كان service_role يعتمد على **وراثة PUBLIC** (Grant تلقائي لكل دالة جديدة).
--    بعد سحب EXECUTE من PUBLIC صار محروماً — وهذا يكسر النسخ الاحتياطي
--    والاسترجاع ودوال الحافة، وكلها تعمل بمفتاح الخادم.
--    ⚠️ موضع السطر مهم: `grant execute on all functions` يشمل ما هو مُعرَّف
--    **حتى لحظة تنفيذه** فقط. وُضع هنا (آخر الملف) كي يغطي كل الدوال؛ ونسخته
--    السابقة في قسم الصلاحيات كانت تغطي أول 5 دوال فقط.
grant usage on schema brc to service_role;
grant execute on all functions in schema brc to service_role;
-- وللدوال التي تُنشأ لاحقاً في ترحيلات مستقبلية:
alter default privileges grant execute on functions to service_role;

-- ===========================================================================
--  12.٥) أرقام البطاقات المطبوعة (2026-11-05) — أُدمجت هنا 2026-11-15
-- ===========================================================================
--  ⚠️ كانت هذه الكتلة في ترحيل منفصل فقط، فبقي docs/schema.sql ينشئ ١٦
--     جدولاً بينما ملف البيانات يحتاج ١٨. ومن يبني قاعدة من هذا الملف
--     وحده كان يفشل عند أول بطاقة:
--        ERROR: relation "brc.card_number_registry" does not exist
--     وهي أيضاً أساس منع تكرار أرقام البطاقات على ورق مطبوع فعلاً.
-- ===========================================================================

-- Permanent mapping is separate from operational backups: restoring an old
-- snapshot never rewinds the counter or changes a card's printed identity.
create table if not exists brc.card_number_counter (singleton boolean primary key default true check (singleton), last_number bigint not null check (last_number >= 0));
insert into brc.card_number_counter values (true,0) on conflict do nothing;
create table if not exists brc.card_number_registry (serial text primary key, card_number bigint not null unique check (card_number > 0));
create table if not exists brc.card_issue_requests (id uuid primary key, actor uuid not null, params jsonb not null, serials text[] not null);
alter table brc.card_number_counter enable row level security;
alter table brc.card_number_registry enable row level security;
alter table brc.card_issue_requests enable row level security;
revoke all on brc.card_number_counter, brc.card_number_registry, brc.card_issue_requests from public, anon, authenticated;

create or replace function brc.card_number_for(p_serial text) returns bigint
language sql stable security definer set search_path=brc,public as $$
 select r.card_number from brc.card_number_registry r where r.serial=p_serial and brc.is_staff()
$$;
revoke all on function brc.card_number_for(text) from public,anon;
grant execute on function brc.card_number_for(text) to authenticated;
-- select * is deliberate: no applicants column is added, keeping old backups compatible.
create or replace view brc.working_applicants with(security_invoker=true) as
 select a.*, brc.card_number_for(a.serial) as card_number from brc.applicants a where a.archived_at is null;

-- Also protects concurrent/older clients. Number allocation and insertion share
-- one transaction and row lock; a failed insert rolls the counter back.
create or replace function brc.assign_card_number() returns trigger
language plpgsql security definer set search_path=brc,public as $$
declare n bigint;
begin
 if new.status <> 'blank' then return new; end if;
 update brc.card_number_counter set last_number=last_number+1 where singleton returning last_number into n;
 if exists(select 1 from brc.issued_serials where serial=new.serial) or exists(select 1 from brc.card_number_registry where serial=new.serial) then
  raise exception 'كود البطاقة مستخدم سابقاً' using errcode='23505';
 end if;
 insert into brc.card_number_registry(serial,card_number) values(new.serial,n);
 return new;
end $$;
revoke all on function brc.assign_card_number() from public,anon,authenticated;
drop trigger if exists trg_assign_card_number on brc.applicants;
create trigger trg_assign_card_number before insert on brc.applicants for each row execute function brc.assign_card_number();

create or replace function brc.issue_numbered_cards(p_request uuid,p_count integer,p_serial text default null,p_notes text default '') returns jsonb
language plpgsql security definer set search_path=brc,public as $$
declare actor uuid:=auth.uid(); old_request brc.card_issue_requests%rowtype; args jsonb; codes text[]:='{}'; code text; n integer; j integer; bytes bytea; alphabet constant text:='23456789ABCDEFGHJKMNPQRSTUVWXYZ'; results jsonb;
begin
 if actor is null or not brc.is_admin() then raise exception 'الإصدار للمدير الفعال فقط' using errcode='42501'; end if;
 -- قرار 2026-11-11: أي عدد من 1 إلى 60 مسموح في الدفعات (لا قيد المضاعفات).
 -- القيد السابق (مضاعفات 4 فقط) كان يرفض أعداداً يطلبها العمل اليومي.
 -- البطاقات يتيمة آخر ورقة تُطبع كما هي؛ التقسيم إلى أوراق في الواجهة.
 -- استثناء قائم: إصدار بطاقة واحدة بكود محدَّد (p_serial) يبقى p_count=1.
 if p_request is null or p_count is null or length(coalesce(p_notes,''))>1000
    or p_count<1 or p_count>60
    or (p_serial is not null and p_count<>1)
 then raise exception 'بيانات الإصدار غير صالحة'; end if;
 p_serial:=nullif(upper(btrim(coalesce(p_serial,''))),'');
 if p_serial is not null and p_serial !~ '^([2-9A-HJKMNP-Z]{10}|HRC-BC-[0-9]{6})$' then raise exception 'كود البطاقة غير صالح'; end if;
 args:=jsonb_build_object('count',p_count,'serial',p_serial,'notes',coalesce(p_notes,''));
 -- Same lock as recovery: neither an issuance nor its retry can overlap restore.
 perform pg_advisory_xact_lock(8310192026);
 if not brc.is_admin() then raise exception 'تغيرت صلاحية الحساب' using errcode='42501'; end if;
 select * into old_request from brc.card_issue_requests where id=p_request;
 if found then
  if old_request.actor<>actor or old_request.params<>args then raise exception 'طلب الإصدار لا يطابق الطلب الأصلي' using errcode='42501'; end if;
  codes:=old_request.serials;
 else
  for n in 1..p_count loop
   if p_serial is not null then code:=p_serial;
   else
    loop
     bytes:=extensions.gen_random_bytes(10); code:='';
     for j in 0..9 loop code:=code||substr(alphabet,1+(get_byte(bytes,j)%length(alphabet)),1); end loop;
     exit when code ~ '[2-9].*[2-9].*[2-9]' and length(regexp_replace(code,'[2-9]','','g'))>=3
       and not exists(select 1 from brc.issued_serials where serial=code) and not exists(select 1 from brc.applicants where serial=code);
    end loop;
   end if;
   insert into brc.applicants(serial,full_name,phone,address,status,fee_paid,notes,created_by)
   values(code,'','','','blank',false,coalesce(p_notes,''),(select id from brc.staff where auth_id=actor limit 1));
   codes:=array_append(codes,code);
  end loop;
  insert into brc.card_issue_requests(id,actor,params,serials) values(p_request,actor,args,codes);
 end if;
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('card_number',r.card_number) order by x.ordinality),'[]'::jsonb)
 into results from unnest(codes) with ordinality x(serial,ordinality)
 join brc.applicants a on a.serial=x.serial join brc.card_number_registry r on r.serial=x.serial;
 if jsonb_array_length(results)<>cardinality(codes) then raise exception 'البطاقات الصادرة غير موجودة حالياً؛ راجع السجل ولا تعيد الإصدار'; end if;
 return jsonb_build_object('cards',results,'attempts',coalesce((select jsonb_agg(to_jsonb(t) order by t.serial,t.attempt_no) from brc.job_attempts t where t.serial=any(codes)),'[]'::jsonb));
end $$;
revoke all on function brc.issue_numbered_cards(uuid,integer,text,text) from public,anon;
grant execute on function brc.issue_numbered_cards(uuid,integer,text,text) to authenticated;
notify pgrst,'reload schema';

-- ===========================================================================
--  12) مساعدا العرض العام + إغلاق تعداد البطاقات (2026-11-13)
-- ===========================================================================
--  أرقام البطاقات تُطبع على ورق، والمفتاح العام منشور — فأي زائر يستطيع
--  تعداد البطاقات. الحماية **ميزانية طلبات** في card_lookup_guard (١٥ عرضاً/
--  ساعة لكل بطاقة، ٤٠ بطاقة مختلفة/ساعة لكل مصدر) — لا تقنين شخصي.
--
--  ⚠️ التقنين أُلغي 2026-11-13 بعد توضيح صاحب العمل لدورة العمل: المكتب
--     يُصدر بطاقات **فارغة** ويبيعها كاشاً، والمفعّلة بياناتها كتبها صاحبها.
--     و`card_print_code` غير مستعمل فيها (فارغ في 723/723 بطاقة)، فاشتراطه
--     كان يُقنّع كل زبون عن نفسه ويقفل حقوله بلا مقابل.
--     ما يحمي فعلاً: من يقدّم ببطاقة غيره **يكتب اسمه فوقها** (apply_with_card)،
--     فيقارن صاحب العمل الاسم بالهوية الوطنية ويكشفه.
--
--  الدالتان أدناه باقيتان للاستخدام الداخلي/المستقبلي، ولا يُنادى بهما من
--  lookup_card بعد الآن.
--  (التفاصيل والقياس في supabase/migrations/20261113170000_card_enumeration_guard.sql)
create or replace function brc.card_public_name(p_name text, p_verified boolean)
returns text language sql immutable set search_path = brc, public, pg_temp
as $$
  select case
    when p_verified then coalesce(p_name, '')
    when coalesce(btrim(p_name), '') = '' then ''
    else (regexp_split_to_array(btrim(p_name), '\s+'))[1]
         || coalesce(' ' || left((regexp_split_to_array(btrim(p_name), '\s+'))[2], 1) || '.', '')
  end
$$;

create or replace function brc.card_public_phone(p_phone text, p_verified boolean)
returns text language sql immutable set search_path = brc, public, pg_temp
as $$
  select case
    when p_verified then coalesce(p_phone, '')
    when coalesce(btrim(p_phone), '') = '' then ''
    else left(btrim(p_phone), 4) || '••••' || right(btrim(p_phone), 2)
  end
$$;

revoke all on function brc.card_public_name(text, boolean) from public, anon, authenticated;
revoke all on function brc.card_public_phone(text, boolean) from public, anon, authenticated;
grant execute on function brc.card_public_name(text, boolean) to service_role;
grant execute on function brc.card_public_phone(text, boolean) to service_role;


-- ===========================================================================
--  13) سدّ فرق الاسترجاع مقابل الإنتاج (2026-11-17)
-- ===========================================================================
--  ⚠️ أول خطوة: إعادة تسمية الجسمين القديمين قبل إنشاء الأغلفة — بترتيب
--     الإنتاج نفسه بالضبط (ترحيل 2026-11-13):
--        lookup_card(text,text)  →  lookup_card_unguarded
--        self_service_card       →  self_service_card_unguarded
--        ثم يُنشأ غلاف بكل اسم.
--
--  ولماذا إعادة التسمية لا مجرّد إنشاء غلاف؟ لأن الجسم الذي يجب أن يبقى هو
--  **ما قبل التقنين**، والجسم الموجود في نهاية هذا الملف هو **المقنَّع**.
--  وفي الإنتاج أُعيدت تسمية النسخة السابقة للتقييد إلى `_unguarded`، ثم
--  صار الغلاف يفتح البيانات صراحةً. فبدون هذه الخطوة يبقى ملف صاحب البطاقة
--  مقفلاً ومقنّعاً — وهو ما رفضه صاحب العمل.
--
--  ⚠️ وبلا `default null`: في الإنتاج توقيع الدالتين بلا قيمة افتراضية،
--  وإضافة `default` إلى توقيع قائم تفشل بـ«cannot remove parameter defaults».
do $$
begin
  if to_regprocedure('brc.lookup_card_unguarded(text, text)') is null
     and to_regprocedure('brc.lookup_card(text, text)') is not null then
    alter function brc.lookup_card(text, text) rename to lookup_card_unguarded;
  end if;
  if to_regprocedure('brc.self_service_card_unguarded(text, text)') is null
     and to_regprocedure('brc.self_service_card(text, text)') is not null then
    alter function brc.self_service_card(text, text) rename to self_service_card_unguarded;
  end if;
end $$;

-- ===========================================================================
--  ١) جدول ميزانية عرض البطاقات — تعتمد عليه card_lookup_guard
-- ===========================================================================
create table if not exists brc.card_lookup_budget (
  budget_key   text primary key,
  window_start timestamptz not null default now(),
  used         integer not null default 0
);
alter table brc.card_lookup_budget enable row level security;
revoke all on brc.card_lookup_budget from public, anon, authenticated;

-- ===========================================================================
--  ٢) مصدر الطلب (بصمة IP) — يقرأ ترويسات PostgREST
-- ===========================================================================
create or replace function brc.card_request_source()
returns text language plpgsql stable
set search_path = brc, public, pg_temp
as $function$
declare h jsonb; raw text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then h := null;
  end;
  if h is null then return null; end if;
  raw := coalesce(
    nullif(btrim(split_part(coalesce(h->>'cf-connecting-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(h->>'x-real-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), '')
  );
  if raw is null then return null; end if;
  return 'src:' || md5(raw);
end $function$;

-- ===========================================================================
--  ٣) حراسة تعداد البطاقات (١٥ عرضاً/ساعة لكل بطاقة، ٤٠ بطاقة/ساعة لكل مصدر)
--     ⚠️ لا تُنادى من lookup_card بعد الآن (قرار 2026-11-13) لكنها موجودة
--     في الإنتاج وتُستعمل داخلياً.
-- ===========================================================================
create or replace function brc.card_lookup_guard(p_serial text, p_source text default null::text)
returns jsonb language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
declare
  v_card_key text;
  v_src_key  text;
  v_used     integer;
  v_src_used integer;
  v_serial   text := upper(btrim(coalesce(p_serial, '')));
  v_src      text := nullif(btrim(coalesce(p_source, brc.card_request_source(), '')), '');
  c_card     constant integer := 15;
  c_source   constant integer := 40;
begin
  if v_serial = '' then
    return jsonb_build_object('ok', false, 'error', 'أدخل رقم البطاقة');
  end if;

  v_card_key := 'card:' || md5(v_serial);
  insert into brc.card_lookup_budget (budget_key) values (v_card_key)
    on conflict (budget_key) do nothing;
  update brc.card_lookup_budget
     set window_start = case when window_start < now() - interval '1 hour' then now() else window_start end,
         used         = case when window_start < now() - interval '1 hour' then 1 else used + 1 end
   where budget_key = v_card_key
  returning used into v_used;

  if v_used > c_card then
    return jsonb_build_object('ok', false,
      'error', 'عُرضت هذه البطاقة مرات كثيرة خلال ساعة. انتظر قليلاً ثم أعد المحاولة.');
  end if;

  if v_src is not null then
    v_src_key := 'source:' || md5(v_src);
    insert into brc.card_lookup_budget (budget_key) values (v_src_key)
      on conflict (budget_key) do nothing;
    update brc.card_lookup_budget
       set window_start = case when window_start < now() - interval '1 hour' then now() else window_start end,
           used         = case when window_start < now() - interval '1 hour' then 1 else used + 1 end
     where budget_key = v_src_key
    returning used into v_src_used;

    if v_src_used > c_source then
      return jsonb_build_object('ok', false,
        'error', 'تم عرض بطاقات كثيرة من هذا الجهاز خلال ساعة. توقّف قليلاً — البطاقة تخصّك وحدك.');
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $function$;

-- ===========================================================================
--  ٤) نسختا العرض بلا حراسة — تستدعيهما الدوال المُحصّنة أعلاه/أدناه
-- ===========================================================================
create or replace function brc.lookup_card_unguarded(p_serial text, p_code text)
returns jsonb language plpgsql security definer
set search_path = brc, public
as $function$
declare
  f record; v_ok boolean; v_stored text; v_code text;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;

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
    'serial', f.serial,
    'status', f.status::text,
    'issueDate', f.issue_date,
    'expiryDate', f.expiry_date,
    'succeeded', f.status = 'completed',
    'chancesLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
    'usesCardPrintCode', (v_stored <> ''),
    'requiresCode', (v_stored <> ''),
    'fullName', case when v_ok then f.full_name else brc.mask_name(f.full_name) end,
    'phone',    case when v_ok then f.phone else left(f.phone, 4) || '••••' || right(f.phone, 2) end,
    'verified', v_ok,
    'chances', (select coalesce(jsonb_agg(jsonb_build_object(
        'no', a.attempt_no, 'slotStatus', a.slot_status::text, 'note', coalesce(a.outcome_note, ''),
        'jobCode', a.job_code, 'jobTitle', j.title, 'location', j.governorate,
        'selectedAt', a.selected_at, 'holdExpiresAt', a.hold_expires_at
      ) order by a.attempt_no), '[]'::jsonb)
      from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
      where a.serial = f.serial)
  );
end $function$;

create or replace function brc.self_service_card_unguarded(p_serial text, p_code text)
returns jsonb language plpgsql security definer
set search_path = brc, public
as $function$
declare
  f record; v_ok boolean; v_stored text; v_code text;
begin
  select * into f from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));
  if f.serial is null then
    return jsonb_build_object('ok', false, 'error', 'لا توجد بطاقة بهذا الباركود');
  end if;

  perform brc.ensure_card_attempts(f.serial);

  if f.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'هذه البطاقة قيد المراجعة لدى الشركة');
  end if;

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
      'chancesLeft', (select count(*) from brc.job_attempts a where a.serial = f.serial and a.slot_status = 'empty'),
      'profile', case when v_ok then coalesce(f.self_application_data, '{}'::jsonb) else '{}'::jsonb end,
      'profileLocked', not v_ok,
      'requiresCode', (v_stored <> ''),
      'maskedName', case when v_ok then null else brc.mask_name(f.full_name) end,
      'maskedPhone', case when v_ok then null else left(f.phone, 4) || '••••' || right(f.phone, 2) end,
      'verified', v_ok,
      'chances', (select coalesce(jsonb_agg(jsonb_build_object(
          'no', a.attempt_no, 'slotStatus', a.slot_status::text,
          'jobCode', a.job_code, 'jobTitle', j.title
        ) order by a.attempt_no), '[]'::jsonb)
        from brc.job_attempts a left join brc.jobs j on j.id = a.job_id
        where a.serial = f.serial)
    )
  );
end $function$;

-- ===========================================================================
--  ٥) مشغّل منع بصمات التدقيق الحسّاسة (src/md5/fingerprint/lookup/budget)
-- ===========================================================================
create or replace function brc.trg_block_fingerprint_audit()
returns trigger language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
begin
  if coalesce(new.details, '') ~* '(src|md5|fingerprint|lookup:|budget:)' then
    return null;
  end if;
  return new;
end $function$;

drop trigger if exists trg_block_fingerprint_audit on brc.audit_log;
create trigger trg_block_fingerprint_audit
  before insert on brc.audit_log
  for each row execute function brc.trg_block_fingerprint_audit();

-- ===========================================================================
--  ٦) نقل صور الوظائف من data:URL إلى Storage
--     ⚠️ الرابط الأساسي مثبّت على المشروع الحالي بقصد في الإنتاج. هنا نجعله
--     يقرأ من إعداد المشروع إن وُجد، وإلا يبقى كسلاً — لأن قاعدة جديدة تعني
--     معرّف مشروع جديد.
-- ===========================================================================
create or replace function brc.relocate_job_images(p_bucket text default 'job-images'::text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer
set search_path = brc, public
as $function$
declare
  j record; raw bytea; b64 text; mime text; ext text; object_path text; public_url text; obj_id uuid;
  moved int := 0; failed int := 0; errs jsonb := '[]'::jsonb; ok_list jsonb := '[]'::jsonb;
  base_url text := coalesce(
    nullif(coalesce(current_setting('app.supabase_url', true), ''), ''),
    'https://vqsvztudvfukyuerzcgx.supabase.co');
begin
  if not brc.is_admin() then raise exception 'نقل صور الوظائف صلاحية المدير العام فقط'; end if;
  if to_regclass('storage.buckets') is null then
    raise exception 'مخطط التخزين storage غير موجود على هذه القاعدة';
  end if;
  if not exists (select 1 from storage.buckets where id = p_bucket) then
    raise exception 'الخزنة % غير موجودة', p_bucket;
  end if;

  for j in select id, code, image_url from brc.jobs where image_url like 'data:image/%' order by length(image_url) desc loop
    begin
      mime := substring(j.image_url from 'data:(image/[a-z+]+);base64,');
      b64  := substring(j.image_url from 'base64,(.*)$');
      if mime is null or b64 is null then raise exception 'صيغة data URL غير مفهومة'; end if;
      ext := case mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' when 'image/gif' then 'gif' else null end;
      if ext is null then raise exception 'صيغة صورة غير مدعومة: %', mime; end if;
      raw := decode(b64, 'base64');
      if raw is null then raise exception 'فك الترميز أعطى نتيجة فارغة'; end if;
      if length(raw) < 512 then raise exception 'الصورة صغيرة جداً (% بايت)', length(raw); end if;
      if not (
           (ext='jpg'  and substring(raw from 1 for 3) = '\xFFD8FF'::bytea)
        or (ext='png'  and substring(raw from 1 for 8) = '\x89504E470D0A1A0A'::bytea)
        or (ext='webp' and substring(raw from 1 for 4) = 'RIFF'::bytea and substring(raw from 9 for 4) = 'WEBP'::bytea)
        or (ext='gif'  and substring(raw from 1 for 3) = 'GIF'::bytea)
      ) then raise exception 'البايتات لا تطابق بصمة %', ext; end if;

      object_path := 'jobs/' || lower(j.code) || '.' || ext;
      public_url  := base_url || '/storage/v1/object/public/' || p_bucket || '/' || object_path;

      if p_dry_run then
        ok_list := ok_list || jsonb_build_object('code', j.code, 'path', object_path, 'bytes', length(raw), 'url', public_url);
        moved := moved + 1; continue;
      end if;

      select id into obj_id from storage.objects where bucket_id = p_bucket and name = object_path limit 1;
      if obj_id is null then
        insert into storage.objects (bucket_id, name, owner, metadata, created_at, updated_at)
        values (p_bucket, object_path, auth.uid(),
                jsonb_build_object('mimetype', mime, 'size', length(raw), 'cacheControl','31536000'), now(), now())
        returning id into obj_id;
      else
        update storage.objects
           set metadata = jsonb_build_object('mimetype', mime, 'size', length(raw), 'cacheControl','31536000'),
               updated_at = now()
         where id = obj_id;
      end if;

      if obj_id is null then raise exception 'لم يُكتب الملف في الخزنة'; end if;

      update brc.jobs set image_url = public_url, updated_at = now() where id = j.id;
      insert into brc.audit_log (username, role, action, entity, entity_id, details)
      select s.username, 'staff', 'نقل صورة الوظيفة إلى التخزين', 'job', j.code,
             'حُوِّلت الصورة المضمّنة (' || pg_size_pretty(length(raw)::bigint) || ') إلى ' || object_path
        from brc.staff s where s.auth_id = auth.uid();
      moved := moved + 1;
    exception when others then
      failed := failed + 1; errs := errs || jsonb_build_object('code', j.code, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('ok', failed = 0, 'dryRun', p_dry_run, 'moved', moved,
                            'failed', failed, 'errors', errs, 'plan', ok_list);
end $function$;

revoke all on function brc.relocate_job_images(text, boolean) from public, anon;
grant execute on function brc.relocate_job_images(text, boolean) to authenticated;

-- ===========================================================================
--  ٧) تصديرا النسخة الكاملة (v1 و v2) — يعتمدان على recovery_schema_hash
-- ===========================================================================
create or replace function brc.recovery_export_full()
returns jsonb language plpgsql security definer
set search_path = brc, public
as $function$
declare
  actor uuid := auth.uid();
  payload jsonb;
begin
  if not brc.is_admin() then
    raise exception 'تصدير النسخة الكاملة صلاحية المدير العام فقط';
  end if;

  payload := jsonb_build_object(
    'format', 1,
    'schema', brc.recovery_schema_hash(),
    'exportedAt', clock_timestamp(),
    'counts', jsonb_build_object(
      'jobs', (select count(*) from brc.jobs),
      'applicants', (select count(*) from brc.applicants),
      'attempts', (select count(*) from brc.job_attempts),
      'audit', (select count(*) from brc.audit_log),
      'serials', (select count(*) from brc.issued_serials)
    ),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) order by j.id) from brc.jobs j), '[]'::jsonb),
    'applicants', coalesce((select jsonb_agg(to_jsonb(a) order by a.serial) from brc.applicants a), '[]'::jsonb),
    'job_attempts', coalesce((select jsonb_agg(to_jsonb(t) order by t.serial, t.attempt_no) from brc.job_attempts t), '[]'::jsonb),
    'settings', coalesce((select jsonb_agg(to_jsonb(s) order by s.key) from brc.settings s), '[]'::jsonb),
    'employer_job_credentials', coalesce((select jsonb_agg(to_jsonb(c) order by c.job_id) from brc.employer_job_credentials c), '[]'::jsonb),
    'issued_serials', coalesce((select jsonb_agg(to_jsonb(i) order by i.serial) from brc.issued_serials i), '[]'::jsonb),
    'audit_log', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from brc.audit_log l), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'username', s.username, 'full_name', s.full_name,
        'role', s.role, 'job_title', s.job_title, 'phone', s.phone,
        'active', s.active, 'created_at', s.created_at
      ) order by s.username)
      from brc.staff s
    ), '[]'::jsonb)
  );

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  select s.username, 'staff', 'تصدير نسخة كاملة للجهاز', 'backup', payload->>'schema',
         'تصدير كل البيانات التشغيلية وسجل التدقيق — ' ||
         (payload->'counts'->>'applicants') || ' بطاقة و' ||
         (payload->'counts'->>'audit') || ' سجل تدقيق'
    from brc.staff s where s.auth_id = actor;

  return payload;
end $function$;

create or replace function brc.recovery_export_v2()
returns jsonb language plpgsql security definer
set search_path = brc, public
as $function$
declare
  actor uuid := auth.uid();
  payload jsonb;
  trimmed int;
begin
  if not brc.is_admin() then
    raise exception 'تصدير النسخة الكاملة صلاحية المدير العام فقط';
  end if;

  select count(*) into trimmed
    from brc.audit_log
   where diff is not null and pg_column_size(diff) > 16384;

  payload := jsonb_build_object(
    'format', 2,
    'schema', brc.recovery_schema_hash(),
    'exportedAt', clock_timestamp(),
    'counts', jsonb_build_object(
      'jobs', (select count(*) from brc.jobs),
      'applicants', (select count(*) from brc.applicants),
      'attempts', (select count(*) from brc.job_attempts),
      'audit', (select count(*) from brc.audit_log),
      'serials', (select count(*) from brc.issued_serials),
      'diffTrimmed', trimmed
    ),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) order by j.id) from brc.jobs j), '[]'::jsonb),
    'applicants', coalesce((select jsonb_agg(to_jsonb(a) order by a.serial) from brc.applicants a), '[]'::jsonb),
    'job_attempts', coalesce((select jsonb_agg(to_jsonb(t) order by t.serial, t.attempt_no) from brc.job_attempts t), '[]'::jsonb),
    'settings', coalesce((select jsonb_agg(to_jsonb(s) order by s.key) from brc.settings s), '[]'::jsonb),
    'employer_job_credentials', coalesce((select jsonb_agg(to_jsonb(c) order by c.job_id) from brc.employer_job_credentials c), '[]'::jsonb),
    'issued_serials', coalesce((select jsonb_agg(to_jsonb(i) order by i.serial) from brc.issued_serials i), '[]'::jsonb),
    'audit_log', coalesce((
      select jsonb_agg(
        case when l.diff is not null and pg_column_size(l.diff) > 16384
             then (to_jsonb(l) - 'diff') || jsonb_build_object('diffTrimmed', true)
             else to_jsonb(l)
        end order by l.id)
      from brc.audit_log l
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'username', s.username, 'full_name', s.full_name,
        'role', s.role, 'job_title', s.job_title, 'phone', s.phone,
        'active', s.active, 'created_at', s.created_at
      ) order by s.username)
      from brc.staff s
    ), '[]'::jsonb)
  );

  insert into brc.audit_log (username, role, action, entity, entity_id, details)
  select s.username, 'staff', 'تصدير نسخة كاملة للجهاز', 'backup', payload->>'schema',
         'تصدير تشغيلي + سجل تدقيق — ' ||
         (payload->'counts'->>'applicants') || ' بطاقة و' ||
         (payload->'counts'->>'audit') || ' سجل؛ استُبعد diff من ' ||
         trimmed || ' سجلاً لاحتوائه صوراً مضمّنة'
    from brc.staff s where s.auth_id = actor;

  return payload;
end $function$;

-- ===========================================================================
--  ٨) الفهرسة الفريدة على رمز الفرصة
--     ⚠️ تُنشأ فقط إن كان الجدول خالياً من التكرار — وإلا تُترك مع تنبيه، لأن
--     الفشل هنا يجب ألا يُسقط الملف كله.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from brc.job_attempts
                  where chance_code is not null
                  group by chance_code having count(*) > 1) then
    execute 'create unique index if not exists attempts_chance_code_uidx on brc.job_attempts (chance_code)';
  else
    raise notice 'تخطّي attempts_chance_code_uidx — يوجد رمز فرصة مكرّر في البيانات';
  end if;
end $$;

-- ===========================================================================
--  13.٥) إلغاء التقنين في البطاقة الذاتية (قرار المالك — موجود في الإنتاج)
-- ===========================================================================
--  ⚠️ هذا القسم أُضيف 2026-11-17 بعد مقارنة تعريفات الدوال بالإنتاج الحيّ:
--     الإنتاج **لا يُقنّع** ولا يقفل ملف صاحب البطاقة، أما هذا الملف فكان
--     ما زال يُقنّع ويقفل. أي أن بناء قاعدة من هذا الملف كان **يُعيد سلوكاً
--     رفضه صاحب العمل صراحةً** — وهذا أخطر من نقص جدول.
--
--  البنية في الإنتاج (كما هي، بلا إعادة كتابة):
--     lookup_card        = card_lookup_guard ← lookup_card_unguarded + فتح الاسم/الهاتف
--     self_service_card  = card_lookup_guard ← self_service_card_unguarded + فتح الملف
--  ويبقى `verify_form` يُقنّع بلا بصمة — لأن رابطه العام يمكن تخمينه بالتسلسل.

create or replace function brc.lookup_card(p_serial text, p_code text)
returns jsonb language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
declare
  v_guard jsonb; v_body jsonb; v_name text; v_phone text;
begin
  v_guard := brc.card_lookup_guard(p_serial, null);
  if coalesce((v_guard->>'ok')::boolean, false) is not true then return v_guard; end if;

  v_body := brc.lookup_card_unguarded(p_serial, p_code);
  if v_body is null or coalesce((v_body->>'ok')::boolean, false) is not true then
    return v_body;
  end if;
  if (v_body->>'status') = 'blank' then return v_body; end if;

  select full_name, phone into v_name, v_phone
    from brc.applicants where serial = upper(btrim(coalesce(p_serial, '')));

  v_body := jsonb_set(v_body, '{fullName}', to_jsonb(coalesce(v_name, '')),   true);
  v_body := jsonb_set(v_body, '{phone}',    to_jsonb(coalesce(v_phone, '')),  true);
  v_body := jsonb_set(v_body, '{masked}',   'false'::jsonb, true);
  v_body := jsonb_set(v_body, '{verified}', 'true'::jsonb,  true);
  return v_body;
end $function$;

create or replace function brc.self_service_card(p_serial text, p_code text)
returns jsonb language plpgsql security definer
set search_path = brc, public, pg_temp
as $function$
declare
  v_guard jsonb; v_body jsonb;
begin
  v_guard := brc.card_lookup_guard(p_serial, null);
  if coalesce((v_guard->>'ok')::boolean, false) is not true then return v_guard; end if;

  v_body := brc.self_service_card_unguarded(p_serial, p_code);
  if v_body is null or coalesce((v_body->>'ok')::boolean, false) is not true then
    return v_body;
  end if;

  v_body := jsonb_set(v_body, '{card,masked}',        'false'::jsonb, true);
  v_body := jsonb_set(v_body, '{card,verified}',      'true'::jsonb,  true);
  v_body := jsonb_set(v_body, '{card,profileLocked}', 'false'::jsonb, true);
  return v_body;
end $function$;

-- ⚠️ الجسمان القديمان بعد إعادة التسمية يرثان صلاحية PUBLIC — وهذا هو
-- جذر الثغرة الأصلي. الإنتاج يسحبها صراحةً على `_unguarded`، ولا يجوز أن
-- يبقى مسار مباشر إلى الدالة الداخلية من الزائر.
revoke all on function brc.lookup_card_unguarded(text, text) from public, anon, authenticated;
revoke all on function brc.self_service_card_unguarded(text, text) from public, anon, authenticated;

revoke all on function brc.lookup_card(text, text) from public;
revoke all on function brc.self_service_card(text, text) from public;
grant execute on function brc.lookup_card(text, text) to anon, authenticated;
grant execute on function brc.self_service_card(text, text) to anon, authenticated;
