-- ===========================================================================
--  BRC — فحص وظيفي آمن (تاريخ 2026-10-06)
--  ---------------------------------------------------------------------------
--  ماذا يفعل: يُنشئ بطاقة وهمية برقم HRC-TEST-CHECK-0001، يتأكد أنها تُنشأ
--  بفرصتين، يحذف خاناتها (نحاكي عطل المزامنة)، يقرأها ثانية ويتأكد أن الترميم
--  التلقائي أعاد الفرصتين، ثم **يتراجع عن كل شي** (ROLLBACK) — فلا تبقى البطاقة
--  الوهمية ولا أي أثر في القاعدة.
--  كيف تستعمله: Supabase → SQL Editor → New query → الصق كله → Run
--  القراءة: كل سطر لازم يطلع «✅ تمام».
--  ⚠️ إن ظهر تحذير «there is already a transaction in progress» فهو طبيعي.
-- ===========================================================================
begin;

create temp table _brc_res (ord int, item text, val text) on commit drop;

insert into brc.applicants
  (serial, full_name, phone, address, gender, status, issue_date, expiry_date)
values
  ('HRC-TEST-CHECK-0001', 'فحص تقني — يُحذف تلقائياً', '07700000000', 'بابل', 'ذكر',
   'active', now(), now() + interval '30 days');

insert into _brc_res values (1, '١) بطاقة جديدة: قراءة الباركود ⇒ عدد الفرص',
  brc.self_service_card('HRC-TEST-CHECK-0001') #>> '{card,chancesLeft}');

delete from brc.job_attempts where serial = 'HRC-TEST-CHECK-0001';

insert into _brc_res values (2, '٢) بعد حذف الخانات (عطل المزامنة): قراءة الباركود ⇒ عدد الفرص',
  brc.self_service_card('HRC-TEST-CHECK-0001') #>> '{card,chancesLeft}');

insert into _brc_res values (3, '٣) أثر الترميم في سجل التدقيق',
  (select count(*)::text from brc.audit_log
    where action = 'ترميم خانات فرص ناقصة' and entity_id = 'HRC-TEST-CHECK-0001'));

insert into _brc_res values (4, '٤) الخانات الموجودة فعلاً للبطاقة بعد الفحص',
  (select count(*)::text from brc.job_attempts where serial = 'HRC-TEST-CHECK-0001'));

select ord as "#", item as "الفحص", val as "القيمة",
       case
         when ord in (1, 2) and val = '2' then '✅ تمام (المتوقع 2)'
         when ord = 3 and val::int > 0      then '✅ مُسجَّل'
         when ord = 4 and val::int = 2      then '✅ تمام (المتوقع 2)'
         when ord in (1, 2)                 then '❌ خطأ — أعد تنفيذ الجزء 6'
         when ord = 3                       then '⚠️ لا سجل تدقيق'
         else '❌ خطأ'
       end as "النتيجة"
  from _brc_res
 order by ord;

rollback;
