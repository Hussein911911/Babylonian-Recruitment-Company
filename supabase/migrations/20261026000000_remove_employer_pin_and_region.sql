-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-25 — حذف رمز صاحب العمل (employer PIN) + إلغاء إلزام المنطقة
--  ---------------------------------------------------------------------------
--  بعد حذف بوابة صاحب العمل من الموقع، لم يبقَ أي مستخدم للرمز السري:
--    • لا صفحة employer.html ولا assets/js/employer.js
--    • لا حقلَي «الرمز السري» و«تأكيده» في لوحة الموظفين
--    • لا نداءات staff_save_job_pin في المتصفح
--  فتُسقط هنا دوال الرمز وعمود jobs.employer_pin_set.
--
--  ⚠️ تُبقى **الجداول** (employer_job_credentials · employer_login_budget ·
--     employer_otp) فارغةً لأن دوال الاسترجاع التشغيلي تلتقط لقطاتها؛ إسقاطها
--     يكسر نسخ الاسترجاع. ولا تُستخدم لأي رمز بعد اليوم.
--
--  كذلك: «المنطقة» أُلغيت من كل الواجهات وبقيت المحافظة وحدها، فصار العمود
--  اختيارياً بقيمة افتراضية فارغة بدل NOT NULL (منع فشل إضافة وظيفة بلا منطقة)،
--  وصار «مكان العمل» في ردود الدوال هو المحافظة.
--
--  آمن للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) دوال رمز صاحب العمل
drop function if exists brc.staff_save_job_pin(text, jsonb, text);
drop function if exists brc.employer_pin_login(text, text, text);
drop function if exists brc.employer_pin_action(text, text, text);

-- 2) دوال بوابة الواتساب القديمة (كانت معطّلة سابقاً؛ تُحذف نهائياً)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'brc' and p.proname like 'employer_otp_%'
  loop
    execute format('drop function if exists %s', r.sig);
  end loop;
end $$;

-- 3) عمود إشارة الرمز في جدول الوظائف
--    العرض brc.working_jobs يعتمد عليه (select j.* تتحوّل لقائمة أعمدة مُثبَّتة)
--    فيُسقَط العرض ويُعاد إنشاؤه بالتعريف نفسه وبلا العمود.
drop view if exists brc.working_jobs;
alter table if exists brc.jobs drop column if exists employer_pin_set;
create or replace view brc.working_jobs with(security_invoker=true) as
 select j.* from brc.jobs j where j.status<>'closed'
 or coalesce(j.closed_at,j.created_at)>now()-interval '60 days'
 or exists(select 1 from brc.working_job_attempts t where t.job_id=j.id);
revoke all on brc.working_jobs from public,anon;
grant select on brc.working_jobs to authenticated;

-- 4) المنطقة اختيارية — المحافظة هي المرجع الجغرافي
alter table if exists brc.jobs alter column region drop not null;
alter table if exists brc.jobs alter column region set default '';

-- 5) «مكان العمل» في ردود الدوال صار المحافظة لا المنطقة المحذوفة
--    (lookup_card · verify_form · verify_card_code · activate_card)
--    نُعدّل نص الدالة القائمة نفسها بدل إعادة كتابة مئات الأسطر — idempotent:
--    بعد أول تشغيل لا يبقى j.region في مفتاح location فلا يُعاد أي شيء.
do $$
declare r record; src text; fixed text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'brc'
       and p.proname in ('lookup_card', 'verify_form', 'verify_card_code', 'activate_card')
  loop
    src := pg_get_functiondef(r.oid);
    fixed := replace(src, '''location'', coalesce(j.region, ''—'')', '''location'', coalesce(j.governorate, ''—'')');
    fixed := replace(fixed, '''location'', j.region', '''location'', j.governorate');
    if fixed <> src then execute fixed; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
