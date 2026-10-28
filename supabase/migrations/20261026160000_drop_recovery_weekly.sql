-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — حذف brc.recovery_weekly() (بلا أي مستخدم)
--  ---------------------------------------------------------------------------
--  بعد أن صارت جدولة النسخ يضبطها المدير، صار المنفّذ الوحيد هو
--  brc.recovery_run_scheduled() (تسميه مهمة recovery-auto-backup).
--  بقيت recovery_weekly() نسخةً ثانية من نفس المنطق، وبالتحقق على القاعدة:
--
--    • مهمات pg_cron التي تناديها: **0**
--    • دوال أخرى تناديها: **0**
--    • صلاحيتها: postgres وحده (غير قابلة للنداء من المتصفح)
--    • غير مذكورة في المصدر docs/schema.sql
--
--  وجود نسختين من نفس منطق النسخ خطر حقيقي: أي تعديل مستقبلي في واحدة يترك
--  الأخرى تُنتج نسخاً بسلوك قديم. تُحذف هنا، ويبقى المنطق في
--  recovery_run_scheduled() وحدها.
--
--  (ملف الهجرة التاريخي 20261019210230_weekly_recovery_retention.sql يبقى كما
--   هو كسجل تاريخي — ملفات الهجرات لا تُحرَّر، ولا يُعاد إنشاء الدالة منه لأن
--   التطبيق لا يعيد تشغيل الهجرات القديمة.)
--
--  آمن للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) أي مهمة متبقية على القاعدة القديمة تُزال أولاً (الشبكة القديمة)
do $$
declare r record;
begin
  for r in select j.jobid from cron.job j
            where j.jobname = 'hrc-weekly-recovery'
               or j.command ilike '%recovery_weekly%'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
exception when others then
  raise notice 'تعذّر فحص مهمات pg_cron: %', sqlerrm;   -- لا يوقف الحذف
end $$;

-- 2) حذف الدالة نفسها
drop function if exists brc.recovery_weekly();

notify pgrst, 'reload schema';
