-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — حذف دوال صاحب العمل الميتة نهائياً
--  ---------------------------------------------------------------------------
--  الدوال التالية بقيت على القاعدة بعد حذف مسار صاحب العمل من الويب، وتحقّقنا
--  أنها **بلا أي مستخدم**:
--    • لا واجهة تنادي عليها (لا في assets/js ولا في أي صفحة).
--    • لا دالة أخرى ولا عرض يعتمد عليها (فحص pg_depend + مسح نصوص الدوال).
--    • لا مهمة pg_cron تلمسها.
--    • صلاحيتها مسحوبة من anon وauthenticated وservice_role (postgres وحده)،
--      أي أنها غير قابلة للنداء من المتصفح ولا من طبقة الخدمة.
--
--  المحذوفة:
--    brc.employer_view(text)                  — عرض صفحة صاحب العمل
--    brc.employer_decide(text, text)          — النسخة القديمة (بلا سبب)
--    brc.employer_decide(text, text, text)    — النسخة التي تسجّل السبب
--    brc.employer_decide_original(text, text) — نسخة احتياطية منسية
--    brc.employer_otp_issue / _delivery / _verify / _action — بوابة واتساب
--
--  ⚠️ الجداول لا تُمسّ: brc.employer_otp · brc.employer_job_credentials ·
--     brc.employer_login_budget تلتقطها دوال الاسترجاع التشغيلي
--     (recovery_save / recovery_restore) في نسخها، وإسقاطها يكسر نسخاً قائمة.
--     وهي فارغة ومسحوبة الصلاحيات، فلا تحمل أي رمز.
--
--  آمن للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists brc.employer_view(text);
drop function if exists brc.employer_decide(text, text);
drop function if exists brc.employer_decide(text, text, text);
drop function if exists brc.employer_decide_original(text, text);
drop function if exists brc.employer_otp_issue(uuid, text, text, text, text);
drop function if exists brc.employer_otp_delivery(uuid, boolean);
drop function if exists brc.employer_otp_verify(uuid, text, text);
drop function if exists brc.employer_otp_action(text, text, text);

-- أي نسخة أخرى (زيادة وسائط أو نسخة احتياطية) تُسقَط بالاسم لا بالتوقيع.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'brc'
              and (p.proname like 'employer\_view%'
                   or p.proname like 'employer\_decide%'
                   or p.proname like 'employer\_otp\_%'
                   or p.proname like 'employer\_pin%'
                   or p.proname = 'staff_save_job_pin')
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
