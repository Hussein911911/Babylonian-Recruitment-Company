-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — تنظيف سكيما brc: نسخ قديمة مكرّرة + بوابة ميتة مكشوفة
--  ---------------------------------------------------------------------------
--  1) نسختان قديمتان من دوال البطاقة بقيتا **ممنوحتين للزائر (anon)**:
--       brc.apply_with_card_original(text,text,jsonb)
--       brc.self_service_card_original(text)
--     لا واجهة تنادي عليهما (فحص assets/js + الصفحات) ولا دالة/عرض يعتمد
--     عليهما (pg_depend فارغ). وجود نسختين لمسار واحد يعني احتمال تنفيذ منطق
--     قديم بلا الترقيعات اللاحقة (ترميم خانات الفرص، فحص الحالة…).
--
--  2) brc.card_gate(text,text,text,boolean) بوابة أمان من تصميم سابق:
--     لا يناديها أي كود، لكنها **SECURITY DEFINER وممنوحة لـPUBLIC**، وكل
--     نداء منها يُدرج صفاً في brc.card_security_attempts — أي أن أي زائر
--     يستطيع تكبير الجدول بلا حد. تُحذف هي وجدولها ودالة تطبيعها.
--
--  ⚠️ لماذا لا نضيف/نحذف أعمدة هنا: recovery_schema_hash() يحسب بصمة أعمدة
--     (applicants · jobs · job_attempts · settings · employer_job_credentials)
--     فقط. حذف **دوال وجداول خارج القائمة** لا يبطل نسخ الاسترجاع القائمة.
--
--  ⚠️ ما لا يُمسّ: جداول employer_otp · employer_job_credentials ·
--     employer_login_budget (تلتقطها نسخ الاسترجاع) وbrc.applicants_no_backup_20261011
--     (نسخة يدوية قديمة يحتفظ بها المالك).
--
--  آمن للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) النسخ القديمة المكرّرة للدوال
drop function if exists brc.apply_with_card_original(text, text, jsonb);
drop function if exists brc.self_service_card_original(text);

-- 2) البوابة الميتة وجدولها ودالة تطبيعها (لا شيء يعتمد عليها)
drop function if exists brc.card_gate(text, text, text, boolean);
drop function if exists brc.normalize_card_code(text);
drop table  if exists brc.card_security_attempts;

-- 3) مولّد رموز الفرص لم يبقَ له مستخدم (العمود بلا default منذ 2026-10-25)،
--    فنمنع نداءه من المتصفح ونُبقيه للتوافق التاريخي فقط.
revoke all on function brc.chance_code() from public, anon, authenticated;

-- 4) شبكة أمان: أي نسخة مشغولة من الدوال القديمة تُسحَب صلاحيتها مهما كان توقيعها
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'brc'
              and (p.proname like '%\_original' or p.proname like 'card\_gate%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
