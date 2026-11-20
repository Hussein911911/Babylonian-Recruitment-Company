-- ═══════════════════════════════════════════════════════════════════════════
--  إصلاح 2026-11-20 — بديل `app.brc_secret` على مشاريع Supabase بلا superuser
--  ---------------------------------------------------------------------------
--  المشكلة (مُثبتة تنفيذاً على tkxbmopxcftxpcoczweq):
--    `app.brc_secret` إعداد مخصّص (custom GUC). ضبطه بـ
--        ALTER DATABASE postgres SET app.brc_secret = '…'
--    يفشل بـ  42501: permission denied to set parameter
--    لأن دور `postgres` في مشاريع Supabase الحديثة **ليس superuser**
--    (‏rolsuper = false). وصفحة Custom Postgres Config لا تتوفّر في كل الخطط.
--    الأثر: `brc.verify_token` ترمي 22023 دائماً ⇒ `verify_form` وبصمة الكيو آر
--    معطّلتان، رغم أن البيانات مسترجعة سليمة.

--  الحل: مصدر ثانٍ داخل القاعدة، بنفس البصمة وبنفس السلوك:
--    • جدول `brc.app_secrets` محمي بـRLS بلا سياسات + REVOKE صريح من كل أدوار API.
--    • `verify_token` تقرأ الإعداد أولاً (كما في الإنتاج)، ثم الجدول.
--    • القراءة داخل الدالة فقط، وهي SECURITY DEFINER بصلاحية المالك.
--  ⚠️ لا سرّ مكتوب في هذا الملف. الصف يُدخل يدوياً مرة واحدة (انظر آخر الملف).

-- ١) الجدول
create table if not exists brc.app_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table brc.app_secrets enable row level security;
revoke all on brc.app_secrets from public, anon, authenticated, service_role;

-- ٢) الدالة: نفس التوقيع والنتيجة، مع مصدر احتياطي
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

-- ٣) الصلاحيات: تبقى مبطَلة عن الجميع كما في المخطط الأصلي
revoke all on function brc.verify_token(text) from public, anon, authenticated;
grant execute on function brc.verify_token(text) to service_role;

-- ٤) تحقّق سريع (لا يطبع أي قيمة سرّية)
select
  (select count(*) from brc.app_secrets)                    as secret_rows,
  (select relrowsecurity from pg_class where oid='brc.app_secrets'::regclass) as rls_on,
  (select length(nullif(current_setting('app.brc_secret', true), '')) is not null) as guc_set;

-- ═══════════════════════════════════════════════════════════════════════════
--  كيف تُدخل المفتاح (مرة واحدة، من جهازك، ولا يمرّ في أي محادثة)
--  ---------------------------------------------------------------------------
--  على **مشروع الإنتاج** (قراءة فقط — لا تعدّل شيئاً هناك):
--      select current_setting('app.brc_secret');          -- انسخ القيمة
--
--  على **مشروع الهدف**: SQL Editor → الصق (بعد تعويض <القيمة>):
--      insert into brc.app_secrets (name, value)
--      values ('brc_secret', '<القيمة>')
--      on conflict (name) do update
--        set value = excluded.value, updated_at = now();
--
--  تحقّق أنها صارت تعمل:
--      select length(brc.verify_token('HRC-BC-000120'));   -- 64 (بصمة SHA-256 hex)
--      -- وللمقارنة مع الإنتاج (نفس المفتاح ⇒ نفس البصمة):
--      select brc.verify_token('HRC-BC-000120');
-- ═══════════════════════════════════════════════════════════════════════════
