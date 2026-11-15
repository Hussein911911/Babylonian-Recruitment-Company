-- ═══════════════════════════════════════════════════════════════════════════
--  HRC — مقياس الجاهزية: هل قاعدتي صالحة لاستقبال النسخة؟
--  ---------------------------------------------------------------------------
--  سؤال واحد: «هل نسختي ناجحة؟» — هذا الملف يجيبه برقم واحد ودرجة.
--
--  ⚠ قراءة فقط. لا يُنشئ ولا يحذف ولا يعدّل شيئاً.
--
--  ٦٥ درجة أو أكثر = جاهزة · أقل = ناقصة ودقيقة عليها
--
--  الطريقة: SQL Editor → New query → الصق كله ← Run
--           انسخ الجدول الناتج وأرسله لي.
-- ═══════════════════════════════════════════════════════════════════════════ */

with
/* ═══ المراجع: ما يجب أن يكون موجوداً بعد سكيما كاملة في مشروع Supabase ════
   الأعداد من قياس فعلي على قاعدة مبنية من الأجزاء + الهجرات.
   ⚠ الأعداد تزيد مع كل هجرة — نقبل «أكبر أو يساوي» لا المساواة. */
/* الأعداد من قياس فعلي على قاعدة مبنية من الأجزاء الخمسة كاملة.
   مشغّلات PGlite=21 · في Supabase قد تكون 18 (بعض الجداول تحتاج auth.sessions).
   نقبل 17 فما فوق. */
ref as (
  select 19 as جداول, 63 as دوال, 17 as مشغّلات, 3 as أنواع, 4 as مهام, 2 as إعدادات
),
/* ═══ ما هو موجود فعلاً ════════════════════════════════════════════════════ */
now as (
  select
    (select count(*) from pg_tables where schemaname = 'brc')                              as جداول,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'brc')                                                             as دوال,
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'brc' and not t.tgisinternal)                                       as مشغّلات,
    (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'brc' and t.typtype = 'e')                                          as أنواع,
    /* ⚠ cron.job قد لا يوجد إن لم تُفعّل pg_cron. وهنا مشكلة حقيقية:
       `case when to_regclass(...) is not null then (select … from cron.job)`
       **لا تحمي** — المحلّل يتحقّق من وجود الجدول قبل التنفيذ فيفشل الاستعلام
       كله. الحلّ الوحيد الذي يعمل: مرجع نصّي يُنفَّذ وقت التشغيل فقط.
       query_to_xml تنفّذ نصّاً وترجع صفاً — والـcase حولها تمنع الوصول. */
    coalesce(
      (select (xpath('/row/c/text()',
        query_to_xml(
          case when to_regclass('cron.job') is not null
               then 'select count(*) as c from cron.job' else 'select 0 as c' end,
          false, true, '')))[1]::text::int),
      0)                                                                                   as مهام,
    coalesce(
      (select (xpath('/row/c/text()',
        query_to_xml(
          case when to_regclass('brc.settings') is not null
               then 'select count(*) as c from brc.settings' else 'select 0 as c' end,
          false, true, '')))[1]::text::int),
      0)                                                                                   as إعدادات
),
/* ═══ التقييم ══════════════════════════════════════════════════════════════ */
score as (
  select
    /* الحكم على كل عنصر: ✅ مكتمل · ⚠️ ناقص · ❌ مفقود */
    case when now.جداول   >= ref.جداول   then '✅' when now.جداول   > 0 then '⚠️' else '❌' end as الجداول,
    case when now.دوال    >= ref.دوال    then '✅' when now.دوال    > 0 then '⚠️' else '❌' end as الدوال,
    case when now.مشغّلات >= ref.مشغّلات then '✅' when now.مشغّلات > 0 then '⚠️' else '❌' end as المشغّلات,
    case when now.أنواع   >= ref.أنواع   then '✅' when now.أنواع   > 0 then '⚠️' else '❌' end as الأنواع,
    case when now.مهام     >= ref.مهام   then '✅' when now.مهام    > 0 then '⚠️' else '❌' end as المهام,
    case when now.إعدادات >= ref.إعدادات then '✅' when now.إعدادات > 0 then '⚠️' else '❌' end as الإعدادات,
    /* الرقم الحقيقي مقابل المطلوب */
    now.جداول || '/' || ref.جداول as عدد_الجداول,
    now.دوال  || '/' || ref.دوال  as عدد_الدوال,
    now.مشغّلات || '/' || ref.مشغّلات as عدد_المشغّلات,
    now.مهام || '/' || ref.مهام as عدد_المهام,
    /* الدرجة: كل عنصر مكتمل = ٢٠ · ناقص = ١٠ · مفقود = ٠ (المجموع ١٢٠ → نطبّع) */
    (case when now.جداول   >= ref.جداول   then 20 when now.جداول   > 0 then 10 else 0 end) +
    (case when now.دوال    >= ref.دوال    then 20 when now.دوال    > 0 then 10 else 0 end) +
    (case when now.مشغّلات >= ref.مشغّلات then 20 when now.مشغّلات > 0 then 10 else 0 end) +
    (case when now.أنواع   >= ref.أنواع   then 20 when now.أنواع   > 0 then 10 else 0 end) +
    (case when now.مهام     >= ref.مهام   then 20 when now.مهام    > 0 then 10 else 0 end) +
    (case when now.إعدادات >= ref.إعدادات then 20 when now.إعدادات > 0 then 10 else 0 end) as نقاط,
    /* المهام وحدها تُحسب منفصلة: نقص pg_cron ليس عيباً في السكيما */
    (case when now.مهام >= ref.مهام then 20 when now.مهام > 0 then 10 else 0 end)          as نقاط_المهام
  from now, ref
)
select
  الجداول, عدد_الجداول,
  الدوال,  عدد_الدوال,
  المشغّلات, عدد_المشغّلات,
  الأنواع,
  المهام,  عدد_المهام,
  الإعدادات,
  نقاط || '/120' as الدرجة,
  /* الحكم يعتمد على الجداول والدوال والمشغّلات والأنواع — لا على المهام.
     المهام تحتاج pg_cron، وقد لا تكون مفعّلة؛ نقصها لا يعني أن السكيما ناقصة.
     أقصى درجة ممكنة في بيئة بلا pg_cron = 100، وهذا «مكتمل». */
  case
    when (نقاط - نقاط_المهام) >= 100
      then '🟢 السكيما مكتملة — انتقل للبيانات' || case when المهام = '✅' then '' else ' (فعّل pg_cron للمهام)' end
    when نقاط >= 80 then '🟡 قريب — أكمل الأجزاء الناقصة من آخر جزء نجح'
    when نقاط >= 40 then '🟠 نصف بناء — القصّ حصل، أكمل من حيث توقفت'
    when نقاط > 0   then '🔴 بداية فقط — أعد من الجزء 1'
    else                 '⚪ فارغة — ابدأ من schema-part-01.sql'
  end as الحكم
from score;
