-- ═══════════════════════════════════════════════════════════════════════════
--  تقوية صلاحيات الدوال + الافتراضيات — مراجعة أمنية 2026-11-13
--  ---------------------------------------------------------------------------
--  ⚠️ المشكلة **مقيسة** لا مفترضة. نفّذنا المخطط على قاعدة نظيفة (PGlite) ثم
--  سألنا PostgreSQL: has_function_privilege('anon', oid, 'EXECUTE').
--  النتيجة: **17 دالة** يستطيع الزائر نداءها، منها ما لا يجوز أن يكون عاماً:
--
--    select_attempt / set_outcome / release_hold   ← قرارات الموظف على الفرص
--    trg_* (6 دوال مشغّلات)                         ← لا تُنادى من RPC إطلاقاً
--    chance_code / new_card_print_code              ← مولّدا رموز سرية
--    apply_with_card(text,text,jsonb)               ← توقيع قديم، ومع ذلك حيّ
--    lookup_card(text) / self_service_card(text)    ← توقيعان **غير موجودين**
--                                                     أصلاً في المخطط (بقايا
--                                                     توقيع قديم)، فلا يغطيان
--                                                     الدالتين الحقيقيتين
--
--  السبب الجذري واحد: PostgreSQL يمنح EXECUTE على كل دالة جديدة لدور PUBLIC
--  تلقائياً، وكل الأدوار أعضاء في PUBLIC. والمخطط كان يعتمد **قائمة يدوية**
--  من REVOKE — فكل دالة تُضاف لاحقاً وتُنسى في القائمة تبقى مفتوحة للزائر.
--
--  ⚠️ ولا يكفي الإبطال من anon: anon **يورث** من PUBLIC فيبقى قادراً.
--     الإبطال الصحيح من public أولاً، ثم منح صريح لمن يحتاج فقط.
--
--  ⚠️⚠️ وخطأ شائع يجب تجنّبه (تحققنا منه عملياً):
--      ALTER DEFAULT PRIVILEGES **IN SCHEMA** brc REVOKE EXECUTE ON FUNCTIONS
--      FROM PUBLIC;  ← لا تفعل شيئاً. PostgreSQL يُسقط السطر بلا أثر لأن
--      الافتراضي المدمج (PUBLIC) ليس ضمن الـ ACL المخزَّن للمخطط.
--      والنسخة الصحيحة هي **بلا IN SCHEMA** (افتراضي الدور الحالي) — وهي
--      المجرَّبة أدناه، ويشهد لها الفحص في tests/function-acl-audit.mjs.
--
--  لا حذف بيانات · لا تغيير سلوك لأي مسار مستخدم · المنح الصريحة القائمة
--  لـ anon/authenticated على مسارات الزبون والبطاقة وapply.html تبقى كما هي.
-- ═══════════════════════════════════════════════════════════════════════════

set search_path = brc, public;

/* ── 1) سحب EXECUTE من PUBLIC عن **كل** دوال brc ───────────────────────────
   نهج سحب شامل بدل قائمة يدوية: القائمة اليدوية هي الثغرة نفسها. هذا يغطي
   الدوال المساعدة والمشغّلات والتوقيعات القديمة بلا استثناء. */
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'brc'
  loop
    execute format('revoke all on function %s from public', r.sig);
  end loop;
end $$;

/* ── 2) منع التكرار: لا دالة جديدة تُمنح لـ PUBLIC تلقائياً ───────────────
   ⚠️ بلا `in schema`: النسخة المحدودة بالمخطط لا تُسجّل شيئاً أصلاً (مجرَّب). */
alter default privileges revoke execute on functions from public;

/* ── 3) إعادة المنح الصريحة لمسارات الزبون (كما كانت بالضبط) ──────────────
   هذه هي الدوال التي تناديها فعلاً apply.html و«بطاقتي» عبر
   POST /rest/v1/rpc/<name>. نسردها صراحةً لأن السحب الشامل أعلاه شملها.
   ⚠️ التوقيعات مأخوذة من **آخر تعريف في سلسلة الترحيلات**، لا من الذاكرة:
      apply_with_card هو (text, text, jsonb) — أي (serial, job_code, data).
      النسخة الرباعية (serial, code, job_code, data) حُذفت في 20261006030000. */
do $$
declare sig text;
begin
  foreach sig in array array[
    'brc.lookup_card(text, text)',
    'brc.use_chance(text, text, text)',
    'brc.verify_card_code(text, text)',
    'brc.self_service_card(text, text)',
    'brc.apply_with_card(text, text, jsonb)',
    'brc.customer_application_details(text, integer)'
  ]
  loop
    if to_regprocedure(sig) is not null then
      execute format('grant execute on function %s to anon, authenticated', sig);
    end if;
  end loop;
end $$;

/* ── 4) إعادة منح ما ينادي به الموظف (authenticated) ──────────────────────
   is_staff/is_admin/current_staff_id تُنادى داخل سياسات RLS: بلاها يفشل كل
   وصول للموظف بـ «permission denied» حتى لو وُجدت السياسة. */
do $$
declare sig text;
begin
  foreach sig in array array[
    'brc.is_staff()',
    'brc.is_admin()',
    'brc.current_staff_id()',
    'brc.next_job_code()',
    'brc.next_form_serial()',
    'brc.ensure_card_attempts(text)',
    'brc.run_auto_release()',
    'brc.verify_form(text, text)',
    'brc.request_form(text, text, text, date, text, text, text)',
    'brc.select_attempt(text, text)',
    'brc.set_outcome(text, smallint, text, text)',
    'brc.release_hold(text, smallint, text)',
    'brc.office_submit(uuid, text, jsonb, jsonb)',
    'brc.staff_card_history(text, integer)',
    'brc.staff_card_report(date, date)',
    'brc.staff_issuance_registry(text)',
    'brc.recovery_manage(text, uuid, text, text)',
    'brc.recovery_schedule_get()',
    'brc.recovery_schedule_set(int[], text)'
  ]
  loop
    if to_regprocedure(sig) is not null then
      execute format('grant execute on function %s to authenticated', sig);
    end if;
  end loop;
end $$;

/* ── 5) service_role: كل الدوال ───────────────────────────────────────────
   المفتاح الخادمي يفوّض كل شيء (نسخ احتياطي · استرجاع · دوال الحافة). لا خطر
   هنا: هذا المفتاح لا يُنشر في المتصفح، وتقييده لا يحمي شيئاً بل يعطّل
   الاسترجاع عند الحاجة إليه — وهو وقت لا يُحتمل فيه فشل.
   ⚠️ لا يُمنح لـ anon ولا لـ authenticated. */
grant execute on all functions in schema brc to service_role;

/* ── 6) تقوية إضافية: تثبيت search_path على مولّد رموز الفرص ───────────────
   chance_code() هي الدالة الوحيدة بلا search_path ثابت (بقية المولّدات
   والمشغّلات كلها مثبّتة). pg_temp في الآخر: قاعدة PostgreSQL المعروفة لمنع
   تزييف الجداول المؤقتة عبر search_path. */
alter function brc.chance_code() set search_path = brc, public, pg_temp;

notify pgrst, 'reload schema';
