-- ═══════════════════════════════════════════════════════════════════════════
--  إعادة إنشاء المهام المجدولة — تُنفَّذ بعد الاسترجاع
--
--  ⚠️ لماذا هذا الملف منفصل؟
--  وظائف pg_cron تعيش في مخطط `cron` الذي تديره Supabase، ولا يدخل في
--  أي تفريغ لهيكل `brc`. من يسترجع القاعدة من SQL فقط يحصل على قاعدة
--  «تعمل» لكن بلا أتمتة: لا إفراج تلقائي عن الحجوزات، ولا أرشفة يومية،
--  ولا نسخة احتياطية ليلية. هذا الملف يعيدها.
--
--  الشروط: امتداد pg_cron مفعّل من Database → Extensions.
--  التنفيذ مرة واحدة بعد أن تنتهي الأداة من الاسترجاع.
-- ═══════════════════════════════════════════════════════════════════════════

-- وكيل الجداول الليلية — بدون هذا لا تتجدد recovery_chances تلقائياً
select cron.unschedule(jobname) from cron.job
 where jobname in ('brc-auto-release','hrc-card-archive-daily','recovery-ensure-fresh','recovery-auto-backup');

select cron.schedule('brc-auto-release',        '* * * * *',  $$select * from brc.run_auto_release();$$);
select cron.schedule('hrc-card-archive-daily',  '15 0 * * *', $$select brc.archive_finished_cards();$$);
select cron.schedule('recovery-ensure-fresh',   '10 1 * * *', $$select brc.recovery_ensure_fresh();$$);
select cron.schedule('recovery-auto-backup',    '0 20 * * *', $$select brc.recovery_run_scheduled();$$);

-- تحقّق: يجب أن ترى ٤ صفوف كلها active = true
select jobid, jobname, schedule, active from cron.job order by jobid;
