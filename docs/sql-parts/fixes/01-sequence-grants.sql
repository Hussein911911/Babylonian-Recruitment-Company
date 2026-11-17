-- ═══════════════════════════════════════════════════════════════════════════
-- إصلاح عطل «لا صلاحية كافية (RLS/منح مفقود)» قبل إنشاء النسخة
-- التاريخ: 2026-11-17 · المشروع: vqsvztudvfukyuerzcgx
--
-- الأعراض التي أبلغ عنها المالك:
--   ١. الضغط على «إنشاء نسخة الآن» يفشل دائماً
--   ٢. «هاي تروح من أسوي رفرش للموقع» — تختفي بعد التحديث ثم تعود
--
-- الخطأ الحقيقي من القاعدة:
--   ERROR: 42501: permission denied for sequence audit_log_id_seq
--
-- التشخيص (كله مُتحقَّق منه على القاعدة الحيّة):
--   ✅ منح الجدول سليم: authenticated عنده INSERT و SELECT على brc.audit_log
--   ✅ السياسات سليمة: audit_read / audit_insert / audit_no_update / audit_no_delete
--   ✅ الموظفون سليمون: admin، AliAhmed919 (مديران) و Mohammed (موظف) — كلهم active
--   ✅ is_staff() و is_admin() صحيحتان (SECURITY DEFINER)
--   ❌ **منح التسلسل مفقود**: لا USAGE لـauthenticated على أي تسلسل في brc
--
-- لماذا لم يظهر هذا عند بناء القاعدة؟
--   ملف السكيما كان يمنح audit_log_id_seq فقط — ويدوياً لم يُنفّذ، أو بُنيت
--   القاعدة من نسخة أقدم. 그리고 job_code_seq و form_serial_seq لم يكن
--   لهما منح إطلاقاً في أي نسخة.
--
-- ⚠️ هذا الملف **آمن للتكرار** (idempotent): grant لا يفشل إن كان موجوداً.
--    لا يحذف شيئاً ولا يعدّل بيانات. يُنفّذ مرة واحدة ويمكن إعادة تنفيذه.
-- ═══════════════════════════════════════════════════════════════════════════

-- ١) الأدوار تحتاج USAGE على المخطط نفسه (موجود عادةً — تأكيد فقط)
grant usage on schema brc to anon, authenticated;

-- ٢) تسلسل سجل التدقيق — هذا هو الذي كان يمنع إنشاء النسخة.
--    id من نوع bigserial، فيحتاج الإدراج nextval()، وnextval يحتاج
--    USAGE **و** UPDATE على التسلسل (يعدّل حالته الداخلية).
grant usage, select, update on sequence brc.audit_log_id_seq to authenticated;

-- ٣) تسلسل أكواد الوظائف — بدونه يفشل «إضافة وظيفة» من اللوحة.
grant usage, select, update on sequence brc.job_code_seq to authenticated;

-- ٤) تسلسل أرقام الاستمارات — بدونه يفشل إنشاء استمارة جديدة.
grant usage, select, update on sequence brc.form_serial_seq to authenticated;

-- ٥) تسلسلات أي جدول آخر يستخدم serial — نغطّيها دفعة واحدة كي لا يتكرر
--    العطل عند إضافة جدول جديد مستقبلاً. نستثني ما مُنح صراحةً أعلاه.
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
     where c.relkind = 'S'
       and c.relnamespace = 'brc'::regnamespace
  loop
    execute format('grant usage, select, update on sequence brc.%I to authenticated', r.relname);
  end loop;
end $$;

-- ٦) next_job_code كانت بلا security definer — فحتى مع منح التسلسل
--    يبقى الاعتماد على سطر منح واحد. نجعلها definer كطبقة ثانية.
--    (النسخة في docs/schema.sql أُصلحت أيضاً.)
create or replace function brc.next_job_code() returns text
language plpgsql
security definer
set search_path to 'brc', 'public'
as $fn$
declare v text;
begin
  loop
    v := 'HRC-' || nextval('brc.job_code_seq')::text;
    exit when not exists (select 1 from brc.jobs where code = v);
  end loop;
  return v;
end $fn$;

-- ═══ التحقق: يجب أن تُعيد كل الصفوف can_use = true ═══════════════════════
select c.relname as "التسلسل",
       has_sequence_privilege('authenticated', c.oid, 'USAGE')  as "USAGE",
       has_sequence_privilege('authenticated', c.oid, 'UPDATE') as "UPDATE",
       has_sequence_privilege('authenticated', c.oid, 'SELECT') as "SELECT"
  from pg_class c
 where c.relkind = 'S' and c.relnamespace = 'brc'::regnamespace
 order by 1;
