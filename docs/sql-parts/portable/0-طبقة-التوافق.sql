-- ═══════════════════════════════════════════════════════════════════════════
--  طبقة توافق — تُلصق أولاً على أي PostgreSQL ليس فيه Supabase
--  ---------------------------------------------------------------------------
--  لماذا نحتاجها؟
--  السكيما تعتمد على أربعة أشياء يوفّرها Supabase مجاناً ولا توجد في
--  PostgreSQL العادي: auth.uid() · auth.jwt() · auth.sessions · auth.users
--  بدونها يفشل `create policy` ويفشل المفتاح الأجنبي في brc.staff.
--
--  ⚠️ هذه ليست بديلاً عن Supabase Auth. هي فقط تجعل المخطط قابلاً للتنصيب
--     والقراءة. تسجيل الدخول سيبقى معطّلاً حتى تبني نظام حساب خاصاً بك.
--  ⚠️ لا تلصقها على مشروع Supabase — ستحاول إنشاء auth.users الموجود.
--     على Supabase ابدأ من الجزء ١ مباشرة.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists auth;

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  encrypted_password text,
  created_at    timestamptz not null default now()
);

create table if not exists auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- لا جلسة ولا رمز: كل الدوال ترى «زائراً غير مسجّل».
-- على Supabase تنشئ هاتان الدالتان القيمتين من الرمز الموقّع.
create or replace function auth.uid() returns uuid
  language sql stable as $$ select null::uuid $$;

create or replace function auth.jwt() returns jsonb
  language sql stable as $$ select '{}'::jsonb $$;

-- الأمان الحقيقي عند عدم وجود Auth: أوقف الوصول للجداول، واترك الدوال
-- التي تحتاج صلاحية المدير صريحة. يُدار عبر الأدوار لاحقاً.
comment on schema auth is 'طبقة توافق — للترحيل فقط، ليست مصادقة حقيقية';

-- ── ٢) الأدوار التي تفترضها السكيما ────────────────────────────────────────
-- Supabase ينشئها تلقائياً. PostgreSQL العادي لا.
do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin') then
    create role supabase_admin nologin;
  end if;
end $$;

-- ── ٣) سكيما extensions (Supabase يضع فيها pgcrypto) ───────────────────────
create schema if not exists extensions;

do $$
begin
  begin
    create extension if not exists pgcrypto with schema extensions;
  exception when others then
    raise notice 'pgcrypto غير متاح — التشفير معطّل: %', sqlerrm;
  end;
end $$;

-- بديلات احتياطية لو pgcrypto مفقود (التصدير المشفّر يحتاجها)
do $guard$
begin
  if to_regprocedure('extensions.digest(text,text)') is null then
    execute 'create function extensions.digest(text,text) returns bytea
               language sql immutable as $fn$ select decode(md5($1),''hex'') $fn$';
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    execute 'create function extensions.digest(bytea,text) returns bytea
               language sql immutable as $fn$ select decode(md5($1::text),''hex'') $fn$';
  end if;
end $guard$;

-- بدائل دوال الصدفة العشوائية (pgcrypto يوفّرها؛ لو غاب نستخدم md5 للعشوائية)
do $guard2$
begin
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    execute 'create function extensions.gen_random_bytes(integer) returns bytea
               language sql volatile as $fn$ select decode(md5(random()::text || clock_timestamp()::text),''hex'') $fn$';
  end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null then
    execute 'create function extensions.gen_random_uuid() returns uuid
               language sql volatile as $fn$ select (md5(random()::text || clock_timestamp()::text))::uuid $fn$';
  end if;
  if to_regprocedure('extensions.gen_salt(text)') is null then
    execute 'create function extensions.gen_salt(text) returns text
               language sql volatile as $fn$ select substr(md5(random()::text),1,16) $fn$';
  end if;
  if to_regprocedure('extensions.crypt(text,text)') is null then
    execute '
      create function extensions.crypt(text,text) returns text
        language sql immutable as $fn$ select ''md5'' || md5($1 || $2) $fn$';
  end if;
end $guard2$;

-- ── ٤) ما لا تستطيع هذه الطبقة تعويضه ─────────────────────────────────────
--   • تسجيل الدخول (Supabase Auth)
--   • تخزين صور الوظائف (Supabase Storage)
--   • المهام المجدولة pg_cron — أجزاء السكيما تتخطاها تلقائياً إن غابت،
--     لكن الإفراج التلقائي عن الحجوزات لن يعمل بلا مجدول.
