-- 2026-11-15 — تصدير كامل (إصدار 3): الجداول التي كانت تُفقد عند الاسترجاع.
--
-- ⚠️ عطل حقيقي أثبتناه تنفيذياً على قاعدة مبنية من المخطط:
--    recovery_export_v2 تصدّر ١٠ جداول، والقاعدة فيها ١٩ بعد بناء السكيما
--    وحدها (و٢٢ بعد كل الهجرات). أي أن استرجاع نسخة على مشروع جديد كان
--    **يفقد** ما يلي بصمت:
--
--    • brc.recovery_chances  — هل استُهلكت الفرصة (spent) وبصمة رمزها.
--      بعد استرجاع نسخة على مشروع جديد تصبح كل الفرص «غير مستهلكة»،
--      فيستطيع حامل البطاقة إعادة استخدام فرصة استهلكها — وهذا خطأ مالي
--      وحقيقي: البطاقة تمنح فرصتين لا أكثر.
--    • brc.recovery_prints   — هل طُبعت البطاقة وبصمة رمز طباعتها.
--      التكرار يعني إمكانية طباعة بطاقة ثانية برمز جديد = وثيقة مزدوجة.
--    • brc.office_receipts   — سجل عمليات المكتب (idempotency). فقده يعني
--      إمكانية تكرار عملية بيع بعملية جديدة بدل ردّ النتيجة المحفوظة.
--    • brc.card_issue_requests — طلبات إصدار البطاقات (من طلبها وبأي معاملات).
--    • brc.recovery_control.cutoff — نقطة القطع الزمنية للنسخ التزايدي.
--
-- ⚠️ وهذا يهمّ تحديداً سؤال المالك: «خاف يكبر المشروع، النسخة تتضمن كلشي؟»
--    هذه الجداول **ليست ذاكرة مؤقتة** — تكبر مع كل بطاقة وكل عملية، ولا
--    تُبنى من جديد على مشروع فارغ.
--
-- ⛔ لا نصدّر: card_security_attempts · card_lookup_budget · employer_login_budget
--    · employer_otp — كلها نوافذ زمنية منتهية الصلاحية (محاولات فاشلة، حدود
--    طلبات، رموز OTP مؤقتة). تصديرها ينسخ «حالة حظر» قديمة إلى مشروع جديد
--    فيُقفل مستخدمون أبرياء. تُترك فارغة عمداً — وهذا موثَّق هنا لا سهواً.
-- ⛔ ولا نصدّر: jobs_image_url_rollback_20261112 — جدول تراجع مؤقت لهجرة
--    انتهت، وليس بيانات تشغيلية.
-- ⛔ ولا نصدّر: recovery_copies.recovery_payload ولا recovery_tickets —
--    لقطات نسخ سابقة ورموز استرجاع حيّة. تصديرها يضخّم النسخة أضعافاً
--    (تكرار لا نهائي) ويُسرّب رموز استرجاع.
--
-- ملاحظة: صفوف recovery_copies (البيانات الوصفية فقط) وrecovery_tickets غير
-- مشمولة لأن النسخة تُستعاد على مشروع جديد لا يحتاج تاريخ نسخه القديم.
-- الأهمّ هو **حالة البطاقات** وهي في recovery_chances/recovery_prints.

create or replace function brc.recovery_export_v3()
returns jsonb
language plpgsql
security definer
set search_path to 'brc', 'public'
as $function$
declare
  p jsonb;
begin
  if not brc.is_admin() then
    raise exception 'تصدير النسخة الكاملة صلاحية المدير العام فقط';
  end if;

  /* الأساس: الإصدار 2 كما هو — لا نكرّر منطقه، نضيف عليه. */
  p := brc.recovery_export_v2();

  p := p || jsonb_build_object(
    'format', 3,
    /* هل استُهلكت الفرص وبصمات رموزها */
    'recovery_chances', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.serial, c.attempt_no)
      from brc.recovery_chances c), '[]'::jsonb),
    /* هل طُبعت البطاقة وبصمة رمز الطباعة */
    'recovery_prints', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.serial)
      from brc.recovery_prints r), '[]'::jsonb),
    /* عمليات المكتب — لمنع تكرار البيع بعد الاسترجاع */
    'office_receipts', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.operation_id)
      from brc.office_receipts o), '[]'::jsonb),
    /* طلبات إصدار البطاقات */
    'card_issue_requests', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.id)
      from brc.card_issue_requests q), '[]'::jsonb),
    /* نقطة القطع الزمنية — لولاها يبدأ النسخ التزايدي من الصفر */
    'recovery_cutoff', coalesce((
      select to_jsonb(c) - 'secret' from brc.recovery_control c where c.singleton), '{}'::jsonb)
  );

  /* أعداد صريحة ليتحقّق المالك بعد الاسترجاع بلا تخمين */
  p := p || jsonb_build_object('counts', (p->'counts') || jsonb_build_object(
    'recovery_chances', (select count(*) from brc.recovery_chances),
    'recovery_prints', (select count(*) from brc.recovery_prints),
    'office_receipts', (select count(*) from brc.office_receipts),
    'card_issue_requests', (select count(*) from brc.card_issue_requests),
    'card_number_registry', (select count(*) from brc.card_number_registry)
  ));

  return p;
end $function$;

revoke all on function brc.recovery_export_v3() from public, anon, authenticated;
grant execute on function brc.recovery_export_v3() to authenticated;
