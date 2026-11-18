-- 2026-11-18 — تصدير كامل (إصدار 4): إضافة brc.card_number_registry.
--
-- ⚠️ ثغرة أثبتناها قراءةً في تعريف الدالة على الإنتاج، لا تخميناً:
--    recovery_export_v3 يضع `card_number_registry` في `counts` (عدد الصفوف)
--    لكنه **لا يصدّر صفوفه**. فالمالك يرى «175» في الأعداد ويظنّ السجل
--    وصل، بينما المفتاح غير موجود في الحمولة أصلاً. عدٌّ بلا بيانات أسوأ
--    من غياب العدد: يُطمئن كذباً.
--
--    وهذا ليس جدولاً تجميلياً. `card_number_registry` هو مطابقة
--    (serial ← card_number) التي انطبع الرقم على ورق رسمي. بدونها:
--      • العدّاد لا يمكن اشتقاقه إلا من issued_serials، وهو تقريب لا مطابقة؛
--      • بطاقة جديدة قد تأخذ رقماً موجوداً على بطاقة مطبوعة فعلية — تكرار
--        على وثيقة رسمية. هذا أخطر ما في الاسترجاع كله.
--
--    المتصفح (assets/js/restore-sql.js) صار يشتقّ «أرضية» من السجل إن وصل،
--    لكنه لا يستطيع اختراعه. الإصلاح الجذري هنا.
--
-- ⛔ لا نصدّر (كما في v3، بقصد): card_security_attempts · card_lookup_budget
--    · employer_login_budget · employer_otp (نوافذ مؤقتة → نسخ حظر قديم)
--    ولا recovery_copies.recovery_payload ولا recovery_tickets (لقطات
--    متكرّرة ورموز استرجاع حيّة) ولا jobs_image_url_rollback_20261112.
--
-- ملاحظة تشغيلية: هذه الهجرة **لم تُطبَّق على الإنتاج** وقت كتابتها.
-- تحقّق قبل الاعتماد عليها:
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'brc' and proname like 'recovery_export%';
-- المتوقّع بعد التطبيق: recovery_export_full, recovery_export_v2,
--                       recovery_export_v3, recovery_export_v4.

create or replace function brc.recovery_export_v4()
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

  /* الأساس: الإصدار 3 كما هو — لا نكرّر منطقه، نضيف عليه.
     وإن لم تكن v3 مطبَّقة بعد، نفشل صراحةً بدل أن نُصدر نسخة ناقصة بصمت:
     الملف الذي ينادي v4 يتوقّع chances/prints/receipts/requests موجودة. */
  if to_regprocedure('brc.recovery_export_v3()') is null then
    raise exception 'recovery_export_v3 غير موجودة — طبّق هجرة portable_backup_v3 أولاً';
  end if;
  p := brc.recovery_export_v3();

  p := p || jsonb_build_object(
    'format', 4,
    /* مطابقة الرقم المطبوع: serial ← card_number */
    'card_number_registry', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.card_number)
      from brc.card_number_registry r), '[]'::jsonb),
    /* أعلى رقم في السجل صراحةً — حتى لا يعتمد المستقبِل على اشتقاق.
       GREATEST يحمي حالة سجل فيه أرقام أُلغيت فبقي العدّاد أعلى. */
    'card_number_floor', coalesce((
      select greatest(coalesce(max(r.card_number), 0),
                      coalesce((select c.last_number from brc.card_number_counter c
                                 where c.singleton), 0))
      from brc.card_number_registry r), 0)
  );

  return p;
end $function$;

revoke all on function brc.recovery_export_v4() from public, anon, authenticated;
grant execute on function brc.recovery_export_v4() to authenticated;
