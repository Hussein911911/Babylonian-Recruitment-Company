-- ═══════════════════════════════════════════════════════════════════════════
--  HRC — تدقيق أمني يدوي لقاعدة Supabase الحيّة
--  ---------------------------------------------------------------------------
--  يُنفَّذ في: Supabase Dashboard → SQL Editor (أو psql بصلاحية المالك).
--  **للقراءة فقط**: لا INSERT ولا UPDATE ولا DELETE ولا DDL. آمن على الإنتاج.
--
--  لماذا ملف منفصل عن الترحيلات؟
--    الترحيل يُثبّت الحالة المطلوبة. هذا الملف **يقيس** الحالة القائمة ويسأل
--    PostgreSQL نفسه: من يستطيع نداء ماذا؟ الفرق بين «نظنّ» و«نقيس».
--
--  الاستعمال:
--    1) نفّذ الكتلة (أ) — تُرجع جدولاً بكل دوال brc وحالة كل دور.
--    2) نفّذ الكتلة (ب) — تُرجع ملخّصاً: عدد الثغرات ومسمّاها.
--    3) نفّذ الكتلة (ج) — تُخرج JSON جاهزاً لـ:
--         node tools/security-monitor.mjs --verify live.json
-- ═══════════════════════════════════════════════════════════════════════════

-- ── الكتلة (أ): جرد كامل لكل دالة وكل دور ────────────────────────────────
--   publicExecute: هل يرث EXECUTE افتراضياً من PUBLIC؟ (العمود `=X/` في ACL)
--   anon / authenticated / service_role: الجواب النهائي من PostgreSQL نفسه.
select
  p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function_signature,
  p.prosecdef                                                        as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '')                    as config,
  (p.proacl is null or p.proacl::text ~ '(^|,)=X/')                   as public_execute,
  has_function_privilege('anon',          p.oid, 'EXECUTE')           as anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')           as authenticated,
  has_function_privilege('service_role',  p.oid, 'EXECUTE')           as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'brc'
order by public_execute desc, anon desc, p.proname;

-- ── الكتلة (ب): ملخّص الثغرات — كل سطر إما «سليم» أو اسم مشكلة ───────────
with f as (
  select p.oid, p.proname,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
         /* أنواع الوسائط بلا أسماء — الشكل القانوني الذي تُسجّله PostgreSQL */
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig_full,
         p.proname || '(' || regexp_replace(pg_get_function_identity_arguments(p.oid),
           '(^|,)\s*[a-z_][a-z0-9_]*\s+', '\1', 'g') || ')' as types,
         p.prosecdef, p.proconfig, p.proacl,
         has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'brc'
),
allowed_anon as (
  select unnest(array[
    'lookup_card(text,text)', 'use_chance(text,text,text)', 'verify_card_code(text,text)',
    'self_service_card(text,text)', 'apply_with_card(text,text,jsonb)',
    'customer_application_details(text,integer)'
  ]) as s
)
select '1. PUBLIC الموروث (يجب أن يكون 0)' as check_name,
       count(*)::text as value,
       case when count(*) = 0 then '✅' else '⛔ ثغرة: ' || string_agg(sig, ' · ') end as verdict
  from f where (proacl is null or proacl::text ~ '(^|,)=X/')
union all
/* ⚠️ المطابقة على **النوع** لا على اسم الوسيط: الواجهة تنادي
   lookup_card(p_serial, p_code) عبر PostgREST بالاسم، لكن التوقيع القانوني
   هو (text, text). فالمقارنة تتم على (الاسم + أنواع الوسائط) بلا أسماء. */
select '2. دوال تصلها anon خارج مسارات الزبون',
       count(*)::text,
       case when count(*) = 0 then '✅' else '⛔ ' || string_agg(sig, ' · ') end
  from f
 where anon and types not in (select s from allowed_anon)
union all
select '3. مسارات الزبون الستة تعمل',
       (count(*) filter (where anon))::text || '/6',
       case when count(*) filter (where anon) = 6 then '✅ كلها متاحة للزائر'
            else '⛔ ناقص: ' || coalesce(string_agg(sig, ' · ') filter (where not anon), '') end
  from f
 where types in (select s from allowed_anon)
union all
select '4. SECURITY DEFINER بلا search_path ثابت',
       count(*)::text,
       case when count(*) = 0 then '✅' else '⚠️ ' || string_agg(sig, ' · ') end
  from f
 where prosecdef
   and not (coalesce(array_to_string(proconfig, ','), '') like '%search_path%')
   and proname not like 'trg\_%'
union all
select '5. دوال المشغّلات مكشوفة للعميل',
       count(*)::text,
       case when count(*) = 0 then '✅' else '⛔ ' || string_agg(sig, ' · ') end
  from f where (proname like 'trg\_%' or proname like 'capture\_%') and (anon or authed)
union all
select '6. جداول brc بلا RLS',
       count(*)::text,
       case when count(*) = 0 then '✅ كل الجداول محمية'
            else '⛔ ' || string_agg(c.relname, ' · ') end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'brc' and c.relkind = 'r' and not c.relrowsecurity
union all
select '7. سياسات RLS تسمح للجميع (using true)',
       count(*)::text,
       case when count(*) = 0 then '✅ لا سياسة مفتوحة'
            else '⛔ ' || string_agg(p.polname, ' · ') end
  from pg_policy p join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'brc' and pg_get_expr(p.polqual, p.polrelid) = 'true'
union all
select '8. views بلا security_invoker (تتجاوز RLS)',
       count(*)::text,
       case when count(*) = 0 then '✅'
            else '⚠️ ' || string_agg(c.relname, ' · ') end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'brc' and c.relkind = 'v'
   and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker%'
order by check_name;

-- ── الكتلة (ج): JSON جاهز لأداة المراقبة ─────────────────────────────────
--   انسخ الخلية الناتجة كاملة إلى ملف live.json ثم:
--     node tools/security-monitor.mjs --verify live.json
select json_build_object(
  'capturedAt', now(),
  'database', current_database(),
  'functions', coalesce(json_agg(json_build_object(
      'name', sig,
      'publicExecute', public_execute,
      'anon', anon,
      'authenticated', authenticated,
      'serviceRole', service_role,
      'securityDefiner', security_definer,
      'searchPath', (config like '%search_path%')
    ) order by sig), '[]'::json)
) as baseline_json
from (
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
         (p.proacl is null or p.proacl::text ~ '(^|,)=X/')             as public_execute,
         has_function_privilege('anon',          p.oid, 'EXECUTE')     as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE')     as authenticated,
         has_function_privilege('service_role',  p.oid, 'EXECUTE')     as service_role,
         p.prosecdef                                                   as security_definer,
         coalesce(array_to_string(p.proconfig, ','), '')               as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'brc'
) t;
