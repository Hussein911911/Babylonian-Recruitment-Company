-- ===========================================================================
--  BRC — الفحص السريع (تاريخ 2026-10-06) — النتيجة في سطرين فقط
--  ---------------------------------------------------------------------------
--  كيف تستعمله: Supabase → SQL Editor → New query → الصق كله → Run
--  القراءة: يطلع جدول بسطرين — الأول لفحص التثبيت والثاني للفحص الوظيفي.
--           إذا الاثنان «✅ كلشي تمام» فالتحديث مثبَّت وشغّال.
--           إذا طلع «❌ ...» معه تفاصيل الناقص — أرسل صورة السطرين لنا.
--  ✅ آمن تماماً: يُنشئ بطاقة وهمية برقم HRC-TEST-CHECK-0001 ثم يتراجع عنها
--     كاملة (ROLLBACK) فلا يبقى أي أثر.
--  ⚠️ إن ظهر تحذير «there is already a transaction in progress» فهو طبيعي.
-- ===========================================================================
begin;

create temp table _brc_m (ord int, val text) on commit drop;

insert into brc.applicants
  (serial, full_name, phone, address, gender, status, issue_date, expiry_date)
values
  ('HRC-TEST-CHECK-0001', 'فحص تقني — يُحذف تلقائياً', '07700000000', 'بابل', 'ذكر',
   'active', now(), now() + interval '30 days');

insert into _brc_m values (1, brc.self_service_card('HRC-TEST-CHECK-0001') #>> '{card,chancesLeft}');
delete from brc.job_attempts where serial = 'HRC-TEST-CHECK-0001';
insert into _brc_m values (2, brc.self_service_card('HRC-TEST-CHECK-0001') #>> '{card,chancesLeft}');
insert into _brc_m values (3, (select count(*)::text from brc.audit_log
   where action = 'ترميم خانات فرص ناقصة' and entity_id = 'HRC-TEST-CHECK-0001'));
insert into _brc_m values (4, (select count(*)::text from brc.job_attempts
   where serial = 'HRC-TEST-CHECK-0001'));

-- ── النتيجة النهائية: سطران — ① فحص التثبيت و ② الفحص الوظيفي ────────────
with c as (
  select 1 ord, (select count(*) from information_schema.columns
     where table_schema='brc' and table_name='jobs' and column_name='critical') = 1 ok
  union all select 2, (select count(*) from information_schema.columns
     where table_schema='brc' and table_name='job_attempts'
       and column_name in ('chance_code','employer_decision','decision_at')) = 3
  union all select 3, (select count(*) from information_schema.columns
     where table_schema='brc' and table_name='job_attempts' and column_name='employer_reason') = 1
  union all select 4, (select count(*) from information_schema.columns
     where table_schema='brc' and table_name='applicants'
       and column_name in ('pos_name','self_application_data')) = 2
  union all select 5, (select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid
     where t.typname='slot_status' and e.enumlabel in ('critical','hiring')) = 2
  union all select 6, (select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid
     where t.typname='job_status' and e.enumlabel = 'hiring') = 1
  union all select 7, (select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid
     where t.typname='form_status' and e.enumlabel in ('blank','pending','rejected','expired')) = 4
  union all select 8, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='brc' and p.proname='ensure_card_attempts') = 1
  union all select 9, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='brc' and p.proname='self_service_card'
       and pg_get_function_identity_arguments(p.oid) = 'p_serial text') = 1
  union all select 10, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='brc' and p.proname='apply_with_card') = 1
  union all select 11, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='brc' and p.proname='employer_view') = 1
  union all select 12, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='brc' and p.proname='employer_decide'
       and pg_get_function_identity_arguments(p.oid) = 'p_serial text, p_decision text, p_reason text') = 1
  union all select 13, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='brc' and p.proname='use_chance') >= 1
  union all select 14, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='brc'
       and (   (p.proname='self_service_card' and pg_get_function_identity_arguments(p.oid) = 'p_serial text, p_code text')
            or (p.proname='employer_view'    and array_length(p.proargtypes, 1) >= 2)
            or (p.proname='employer_decide'  and array_length(p.proargtypes, 1) = 2))) = 0
  union all select 15, (select count(*) from pg_views v
     where v.schemaname='brc' and v.viewname='v_pending_actions') = 1
  union all select 16, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='brc' and p.proname='trg_make_attempts'
       and exists (select 1 from pg_trigger tg
                     join pg_class cl on cl.oid = tg.tgrelid
                     join pg_namespace cn on cn.oid = cl.relnamespace
                    where cn.nspname='brc' and cl.relname='applicants'
                      and tg.tgfoid = p.oid and not tg.tgisinternal)) = 1
  union all select 17, (select count(*) from brc.applicants a
     where (select count(*) from brc.job_attempts x where x.serial = a.serial)
           < greatest(coalesce(a.attempt_limit, 2), 1)) = 0
  union all select 18, (select count(*) from brc.applicants a
     where a.status::text not in ('blank')
       and not exists (select 1 from brc.job_attempts x where x.serial = a.serial)) = 0
  union all select 19, true
),
v_install as (
  select case when count(*) filter (where not ok) = 0
              then '① فحص التثبيت: ✅ كلشي تمام — ' || count(*) || ' من ' || count(*) || ' فحص'
              else '① فحص التثبيت: ❌ ناقص ' || count(*) filter (where not ok) || ' من ' || count(*) ||
                   ' — أرقام الفحوص الناقصة: ' || string_agg(ord::text, ', ' order by ord) filter (where not ok)
         end as txt
    from c
),
v_func as (
  select case when (select val from _brc_m where ord = 1) = '2'
               and (select val from _brc_m where ord = 2) = '2'
               and (select val::int from _brc_m where ord = 3) > 0
               and (select val::int from _brc_m where ord = 4) = 2
              then '② الفحص الوظيفي: ✅ كلشي تمام — بطاقة جديدة بفرصتين، وبعد حذف خاناتها رجعت فرصتان (الترميم شغال)'
              else '② الفحص الوظيفي: ❌ خطأ — القيم: ' ||
                   (select string_agg('فحص' || ord || '=' || val, ' · ' order by ord) from _brc_m) ||
                   ' — أرسل صورة هذا السطر'
         end as txt
)
select 1 as "#", (select txt from v_install) as "النتيجة"
union all
select 2, (select txt from v_func)
order by 1;

rollback;
