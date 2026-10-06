-- ===========================================================================
--  BRC — فحص التثبيت بعد الجزء 6 (تاريخ 2026-10-06)
--  ---------------------------------------------------------------------------
--  كيف تستعمله: Supabase → SQL Editor → New query → الصق هذا كله → Run
--  القراءة: كل سطر لازم يطلع «✅ تمام».
--           أي سطر «❌ ناقص» = أعد تنفيذ الجزء 6 من صفحة التحديث.
--  ✅ لا يغيّر هذا الفحص أي شي إطلاقاً — قراءة فقط.
-- ===========================================================================
select ord as "#",
       item  as "الفحص",
       case when ok then '✅ تمام' else '❌ ناقص' end as "النتيجة",
       detail as "التفاصيل"
from (
  select 1 ord, 'عمود brc.jobs.critical (الوظيفة الحرجة)' item,
         (select count(*) from information_schema.columns
           where table_schema='brc' and table_name='jobs' and column_name='critical') = 1 ok,
         'يلزم لمسارَي «رفض صاحب العمل» و«انتهت مهلة 24 ساعة»' detail
  union all
  select 2, 'أعمدة job_attempts الثلاثة: chance_code + employer_decision + decision_at',
         (select count(*) from information_schema.columns
           where table_schema='brc' and table_name='job_attempts'
             and column_name in ('chance_code','employer_decision','decision_at')) = 3,
         'رمز الفرصة السري + قرار صاحب العمل ووقته'
  union all
  select 3, 'عمود job_attempts.employer_reason (سبب الرفض)',
         (select count(*) from information_schema.columns
           where table_schema='brc' and table_name='job_attempts' and column_name='employer_reason') = 1,
         'سبب عدم التوظيف الإلزامي'
  union all
  select 4, 'عمودا applicants: pos_name + self_application_data',
         (select count(*) from information_schema.columns
           where table_schema='brc' and table_name='applicants'
             and column_name in ('pos_name','self_application_data')) = 2,
         'نقطة البيع + بيانات التقديم الذاتي'
  union all
  select 5, 'قيم slot_status: critical + hiring',
         (select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid
           where t.typname='slot_status' and e.enumlabel in ('critical','hiring')) = 2,
         'حالة الخانة عند الرفض/التوظيف'
  union all
  select 6, 'قيمة job_status: hiring',
         (select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid
           where t.typname='job_status' and e.enumlabel = 'hiring') = 1,
         'حالة الوظيفة «جاري التوظيف»'
  union all
  select 7, 'قيم form_status: blank + pending + rejected + expired',
         (select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid
           where t.typname='form_status' and e.enumlabel in ('blank','pending','rejected','expired')) = 4,
         'حالات البطاقة'
  union all
  select 8, 'دالة brc.ensure_card_attempts(text)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='brc' and p.proname='ensure_card_attempts') = 1,
         'الترميم التلقائي لخانات الفرص الناقصة'
  union all
  select 9, 'دالة brc.self_service_card(text) — بلا رمز',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='brc' and p.proname='self_service_card'
             and pg_get_function_identity_arguments(p.oid) = 'p_serial text') = 1,
         'قراءة البطاقة بالباركود وحده'
  union all
  select 10, 'دالة brc.apply_with_card(text, text, jsonb)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='brc' and p.proname='apply_with_card') = 1,
         'التقديم الذاتي من الموقع'
  union all
  select 11, 'دالة brc.employer_view(text) — بلا رمز',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='brc' and p.proname='employer_view') = 1,
         'صفحة صاحب العمل بالباركود وحده'
  union all
  select 12, 'دالة brc.employer_decide(text, text, text)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='brc' and p.proname='employer_decide'
             and pg_get_function_identity_arguments(p.oid) = 'p_serial text, p_decision text, p_reason text') = 1,
         'قرار التوظيف/الرفض مع السبب'
  union all
  select 13, 'دالة brc.use_chance(text, text, text) — تحقّق من الاعتماد القديم',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='brc' and p.proname='use_chance') >= 1,
         'استهلاك الفرصة عند التقديم (تستدعيها apply_with_card)'
  union all
  select 14, 'لا وجود لنسخ «مشغولة برمز» (وإلا الباركود يطلب رمزاً)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='brc'
             and (   (p.proname='self_service_card' and pg_get_function_identity_arguments(p.oid) = 'p_serial text, p_code text')
                  or (p.proname='employer_view'    and array_length(p.proargtypes, 1) >= 2)
                  or (p.proname='employer_decide'  and array_length(p.proargtypes, 1) = 2))) = 0,
         'المطلوب: صفر نسخ'
  union all
  select 15, 'العرض brc.v_pending_actions',
         (select count(*) from pg_views v where v.schemaname='brc' and v.viewname='v_pending_actions') = 1,
         'لوحة «الإجراءات المطلوبة» في لوحة الموظفين'
  union all
  select 16, 'مشغّل إنشاء فرصتين لكل بطاقة جديدة (brc.trg_make_attempts)',
         (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='brc' and p.proname='trg_make_attempts'
             and exists (select 1 from pg_trigger tg
                           join pg_class c  on c.oid = tg.tgrelid
                           join pg_namespace cn on cn.oid = c.relnamespace
                          where cn.nspname='brc' and c.relname='applicants'
                            and tg.tgfoid = p.oid and not tg.tgisinternal)) = 1,
         'بدونه لا تُنشأ الفرصتان عند بيع بطاقة فارغة'
  union all
  select 17, 'بطاقات خاناتها أقل من حدّها',
         (select count(*) from brc.applicants a
           where (select count(*) from brc.job_attempts x where x.serial = a.serial)
                 < greatest(coalesce(a.attempt_limit, 2), 1)) = 0,
         (select count(*)::text || ' بطاقة (المتوقع 0 — الجزء 6 يرمّمها جماعياً)'
            from brc.applicants a
           where (select count(*) from brc.job_attempts x where x.serial = a.serial)
                 < greatest(coalesce(a.attempt_limit, 2), 1))
  union all
  select 18, 'بطاقات بلا أي خانة فرص إطلاقاً (عطل المزامنة)',
         (select count(*) from brc.applicants a
           where a.status::text not in ('blank')
             and not exists (select 1 from brc.job_attempts x where x.serial = a.serial)) = 0,
         (select count(*)::text || ' بطاقة (المتوقع 0 — تُرمَّم عند أول قراءة)'
            from brc.applicants a
           where a.status::text not in ('blank')
             and not exists (select 1 from brc.job_attempts x where x.serial = a.serial))
  union all
  select 19, 'معلومات: حجم القاعدة',
         true,
         (select count(*)::text from brc.applicants) || ' بطاقة · ' ||
         (select count(*)::text from brc.job_attempts where slot_status::text = 'empty') || ' فرصة متاحة · ' ||
         (select count(*)::text from brc.jobs where status::text = 'available') || ' وظيفة متاحة'
) t
order by ord;
