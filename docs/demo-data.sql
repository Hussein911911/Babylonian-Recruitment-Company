-- ===========================================================================
--  بيانات عرض تجريبية — شركة الهدف للتوظيف
--  ---------------------------------------------------------------------------
--  الغرض: تعبئة الموقع الحي ببيانات واقعية ليراها الزبون قبل الموافقة.
--  بعد الموافقة تُحذف كلها بأمر واحد (انظر «التفريغ» في آخر الملف).
--
--  ⚠️ لماذا SQL ولا تعديل config.js؟
--     الموقع المنشور يقرأ الوظائف من brc.public_jobs في Supabase لا من بذرة
--     config.js (البذرة أُفرغت عمداً قبل التسليم). فأي بيانات تُضاف في الكود
--     لن تظهر على الموقع الحي إطلاقاً — لا بد من إدراجها في القاعدة.
--
--  ✅ كل صف هنا مُعلَّم بـ notes = 'DEMO' (الوظائف) أو reject_reason = 'DEMO'
--     (الاستمارات) ليكون الحذف لاحقاً دقيقاً ولا يمسّ أي بيانات حقيقية
--     يُدخلها الموظف أثناء التجربة.
--
--  التطبيق: Supabase ← SQL Editor ← الصق ← Run
--  ⚠️ نفّذ ترحيل HRC أولاً (20260919120000_rename_code_prefix_to_hrc.sql)
--     وإلا ولّدت القاعدة أكواداً بالرمز القديم.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
--  1) خمس وظائف — أحوال مختلفة ليرى الزبون النظام كله لا حالة واحدة:
--     3 متاحة · 1 محجوزة مؤقتاً (عدّاد 24 ساعة) · 1 مغلقة (توظيف ناجح)
-- ---------------------------------------------------------------------------
insert into brc.jobs
  (code, title, category, region, shift, salary_min, salary_max, gender,
   vacancies, requirements, description,
   employer_name, employer_phone, employer_address, interview_location,
   status, notes, image_url)
values
  ('HRC-1001', 'عامل مخزن', 'صناعي', 'الحلة', 'صباحي', 600000, 750000, 'لا فرق',
   2, array['لياقة بدنية جيدة','خبرة سنة على الأقل','شهادة جنسية + بطاقة سكن'],
   'تنظيم المخزن وإدخال وإخراج البضاعة مع جرد أسبوعي.',
   'مخازن الفرات للتبريد', '07701234567', 'الحلة - المنطقة الصناعية',
   'مقر الشركة - الحلة', 'available', 'DEMO',
   'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&q=80'),

  ('HRC-1002', 'سائق حمل (فئة ثالثة)', 'خدمات', 'المحاويل', 'دوام كامل', 750000, 900000, 'ذكر',
   1, array['إجازة سوق فئة ثالثة','خبرة 3 سنوات','عدم وجود تسجيل جنائي'],
   'نقل البضاعة بين المخازن والمنافذ داخل بابل وبغداد.',
   'شركة آفاق النقل', '07811234567', 'المحاويل - الطريق العام',
   'المحاويل - مقابل مديرية النقل', 'available', 'DEMO',
   'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=800&q=80'),

  ('HRC-1003', 'ممرضة/ممرض (مناوبة)', 'صحي', 'الكفل', 'نوبات', 900000, 1200000, 'لا فرق',
   3, array['شهادة تمريض معتمدة','خبرة سنة','الالتزام بنظام النوبات'],
   'العناية بالمرضى ضمن نوبات صباحية ومسائية وليلية.',
   'مستشفى الكفل الأهلي', '07731234567', 'الكفل - قرب المستشفى القديم',
   'مستشفى الكفل الأهلي - الإدارة', 'available', 'DEMO',
   'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&q=80'),

  ('HRC-1004', 'مهندس مدني (تنفيذ)', 'هندسي', 'الحلة', 'صباحي', 1500000, 2200000, 'لا فرق',
   1, array['شهادة هندسة مدنية','خبرة 4 سنوات في المشاريع','إجادة AutoCAD'],
   'الإشراف على تنفيذ المشاريع السكنية ومتابعة الكميات.',
   'مجموعة بابل للإنشاءات', '07741234567', 'الحلة - حي الحسين',
   'مقر الشركة - الحلة', 'available', 'DEMO',
   'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80'),

  ('HRC-1005', 'فني كهرباء صناعية', 'تقني', 'الإسكندرية', 'صباحي', 800000, 1000000, 'ذكر',
   1, array['خبرة في اللوحات الكهربائية','شهادة مهنية','الالتزام بالسلامة'],
   'صيانة اللوحات وخطوط الإنتاج في المعمل.',
   'معمل الإسكندرية للبلاستيك', '07781234567', 'الإسكندرية - منطقة المعامل',
   'المعمل - مكتب الإدارة', 'closed', 'DEMO',
   'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=800&q=80')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
--  2) ثلاث استمارات: سارية · محجوزة جارية · مكتملة (توظيف ناجح)
--     reject_reason = 'DEMO' علامة الحذف، لا سبب رفض حقيقي.
-- ---------------------------------------------------------------------------
insert into brc.applicants
  (serial, full_name, phone, address, dob, gender,
   issue_date, expiry_date, attempt_limit, status,
   fee_amount, fee_paid, printed_count, reject_reason)
values
  ('HRC-NO-000001', 'علي حسين محمد', '07701112233', 'الحلة - حي الجامعة',
   '1996-04-12', 'ذكر', now() - interval '3 days', now() + interval '27 days',
   5, 'active', 10000, true, 1, 'DEMO'),

  ('HRC-NO-000002', 'زهراء عبد الكريم', '07702223344', 'المحاويل - حي الحسين',
   '1999-08-02', 'أنثى', now() - interval '8 days', now() + interval '22 days',
   5, 'active', 10000, true, 1, 'DEMO'),

  ('HRC-NO-000003', 'مصطفى جبار عليوي', '07703334455', 'المسيب - حي العسكري',
   '1994-01-20', 'ذكر', now() - interval '15 days', now() + interval '15 days',
   5, 'completed', 10000, true, 2, 'DEMO')
on conflict (serial) do nothing;

-- ---------------------------------------------------------------------------
--  3) المحاولات: خمس خانات لكل استمارة (هكذا يعمل النظام فعلاً)
--     المستعملة منها تُربط بوظيفة، والباقي 'empty'.
-- ---------------------------------------------------------------------------
insert into brc.job_attempts (serial, attempt_no, job_id, job_code, slot_status,
                              selected_at, hold_expires_at, closed_at, outcome_note)
select a.serial, n.i, null, null, 'empty', null, null, null, ''
  from brc.applicants a
 cross join generate_series(1, a.attempt_limit) as n(i)
 where a.reject_reason = 'DEMO'
on conflict (serial, attempt_no) do nothing;

--  المحاولة 1 لعلي: حجز جارٍ على المهندس المدني — يُظهر عدّاد 24 ساعة
update brc.job_attempts
   set job_id = j.id, job_code = j.code, slot_status = 'reserved',
       selected_at = now() - interval '3 hours',
       hold_expires_at = now() + interval '21 hours',
       outcome_note = 'مقابلة مجدولة'
  from brc.jobs j
 where j.code = 'HRC-1004'
   and brc.job_attempts.serial = 'HRC-NO-000001'
   and brc.job_attempts.attempt_no = 1;

update brc.jobs
   set status = 'reserved', reserved_by = 'HRC-NO-000001',
       hold_expires_at = now() + interval '21 hours'
 where code = 'HRC-1004';

--  المحاولة 1 لزهراء: رُفضت — يُظهر أن المحاولة التالية تُفعَّل تلقائياً
update brc.job_attempts
   set job_id = j.id, job_code = j.code, slot_status = 'rejected',
       selected_at = now() - interval '5 days',
       closed_at = now() - interval '4 days',
       outcome_note = 'عدم توفر سكن قريب'
  from brc.jobs j
 where j.code = 'HRC-1003'
   and brc.job_attempts.serial = 'HRC-NO-000002'
   and brc.job_attempts.attempt_no = 1;

--  المحاولة 1 لمصطفى: توظيف ناجح — الوظيفة مغلقة
update brc.job_attempts
   set job_id = j.id, job_code = j.code, slot_status = 'succeeded',
       selected_at = now() - interval '12 days',
       closed_at = now() - interval '10 days',
       outcome_note = 'تم التوظيف فعلياً'
  from brc.jobs j
 where j.code = 'HRC-1005'
   and brc.job_attempts.serial = 'HRC-NO-000003'
   and brc.job_attempts.attempt_no = 1;

update brc.jobs
   set closed_at = now() - interval '10 days'
 where code = 'HRC-1005';

-- ---------------------------------------------------------------------------
--  4) مزامنة العدّادات: حتى لا يولّد النظام كوداً مستعمَلاً بعد الإدراج
-- ---------------------------------------------------------------------------
--  نأخذ أكبر رقم مستعمَل فعلاً في الجدول (أياً كانت بادئته HRC أو BRC)
--  ونضبط التتابع عليه، فلا يولّد النظام كوداً مكرّراً بعد هذا الإدراج.
select setval('brc.job_code_seq', (
  select greatest(coalesce(max((regexp_replace(code, '[^0-9]', '', 'g'))::bigint), 0), 1005)
    from brc.jobs
));

select setval('brc.form_serial_seq', (
  select greatest(coalesce(max((regexp_replace(serial, '[^0-9]', '', 'g'))::bigint), 0), 3)
    from brc.applicants
));

commit;

--  تحقّق سريع
select 'وظائف'   as ما, count(*) from brc.jobs       where notes = 'DEMO'
union all
select 'استمارات', count(*)      from brc.applicants where reject_reason = 'DEMO';


-- ===========================================================================
--  🗑️ التفريغ بعد موافقة الزبون — نفّذ هذا الجزء وحده
--  ---------------------------------------------------------------------------
--  يحذف بيانات العرض فقط (المعلَّمة DEMO) ولا يمسّ أي سجل حقيقي أدخله
--  الموظف أثناء التجربة. أزل التعليق عن الأسطر ثم شغّلها.
-- ===========================================================================
-- begin;
--   delete from brc.job_attempts
--    where serial in (select serial from brc.applicants where reject_reason = 'DEMO');
--   delete from brc.applicants where reject_reason = 'DEMO';
--   update brc.jobs set reserved_by = null, hold_expires_at = null
--    where notes = 'DEMO';
--   delete from brc.jobs where notes = 'DEMO';
-- commit;
