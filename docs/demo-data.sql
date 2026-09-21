-- ===========================================================================
--  بيانات عرض تجريبية — شركة الهدف للتوظيف
--  ---------------------------------------------------------------------------
--  الغرض: تعبئة الموقع الحي ببيانات واقعية ليراها الزبون قبل الموافقة.
--  بعد الموافقة تُحذف كلها بأمر واحد (انظر «التفريغ» في آخر الملف).
--
--  ⚠️ لماذا SQL ولا تعديل config.js؟
--     الموقع المنشور يقرأ الوظائف من brc.public_jobs في Supabase لا من بذرة
--     config.js (أُفرغت عمداً قبل التسليم). فأي بيانات تُضاف في الكود لن تظهر
--     على الموقع الحي إطلاقاً — لا بد من إدراجها في القاعدة.
--
--  ⚠️ درس مهم من محاولة سابقة فشلت (خطأ 42703: record "new" has no field "code"):
--     القاعدة تُنجز أشياء تلقائياً عبر مُشغِّلات (triggers)، ومحاولة إنجازها
--     يدوياً تصطدم بها:
--       • إدراج استمارة يُنشئ خانات المحاولات الخمس تلقائياً (trg_defaults)،
--         فلا نُدرجها نحن.
--       • تحويل خانة إلى 'reserved' يحجز الوظيفة ويضبط مهلتها تلقائياً
--         (trg_attempt_hold)، فلا نلمس brc.jobs يدوياً لذلك.
--       • أي UPDATE على job_attempts يمرّ بمُشغِّلات تتحقق من الاستمارة
--         والوظيفة، فيجب أن تكون الوظيفة 'available' لحظة الحجز.
--     هذا الملف مكتوب ليعمل **مع** المُشغِّلات لا ضدّها.
--
--  ✅ كل صف مُعلَّم DEMO (notes للوظائف · reject_reason للاستمارات) ليكون
--     الحذف لاحقاً دقيقاً ولا يمسّ بيانات حقيقية يُدخلها الموظف أثناء التجربة.
--
--  التطبيق: Supabase ← SQL Editor ← الصق الملف كاملاً ← Run
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
--  1) خمس وظائف — أحوال مختلفة ليرى الزبون النظام كله لا حالة واحدة.
--     نُدرجها كلها 'available' أولاً: مُشغِّل الحجز يشترط أن تكون الوظيفة
--     متاحة لحظة ربط المحاولة بها. الإغلاق والحجز يجريان في القسم 3.
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
   'مجموعة الفرات للإنشاءات', '07741234567', 'الحلة - حي الحسين',
   'مقر الشركة - الحلة', 'available', 'DEMO',
   'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80'),

  ('HRC-1005', 'فني كهرباء صناعية', 'تقني', 'الإسكندرية', 'صباحي', 800000, 1000000, 'ذكر',
   1, array['خبرة في اللوحات الكهربائية','شهادة مهنية','الالتزام بالسلامة'],
   'صيانة اللوحات وخطوط الإنتاج في المعمل.',
   'معمل الإسكندرية للبلاستيك', '07781234567', 'الإسكندرية - منطقة المعامل',
   'المعمل - مكتب الإدارة', 'available', 'DEMO',
   'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=800&q=80')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
--  2) ثلاث استمارات.
--     ⚠️ لا نُدرج خانات المحاولات هنا: مُشغِّل trg_defaults يُنشئ الخمس
--        تلقائياً عند إدراج كل استمارة.
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
--  3) ربط المحاولات بالوظائف.
--     الخانات موجودة أصلاً (أنشأها المُشغِّل)، فنُحدّثها فقط.
--     ترتيب الحالات مقصود: 'reserved' أولاً لأن مُشغِّل الحجز يشترط وظيفة
--     متاحة، ثم النتائج النهائية التي تُغلق الوظيفة أو تُفرجها.
-- ---------------------------------------------------------------------------

--  (أ) علي — حجز جارٍ على المهندس المدني: يُظهر عدّاد 24 ساعة في اللوحة.
--      المُشغِّل سيضبط hold_expires_at ويحوّل الوظيفة إلى 'reserved' تلقائياً.
update brc.job_attempts
   set job_id      = (select id from brc.jobs where code = 'HRC-1004'),
       job_code    = 'HRC-1004',
       slot_status = 'reserved',
       selected_at = now(),
       outcome_note = 'مقابلة مجدولة'
 where serial = 'HRC-NO-000001' and attempt_no = 1;

--  (ب) زهراء — محاولة مرفوضة على وظيفة التمريض: تُظهر أن المحاولة التالية
--      تبقى متاحة وأن الوظيفة عادت 'available'.
update brc.job_attempts
   set job_id      = (select id from brc.jobs where code = 'HRC-1003'),
       job_code    = 'HRC-1003',
       slot_status = 'rejected',
       selected_at = now() - interval '5 days',
       closed_at   = now() - interval '4 days',
       outcome_note = 'عدم توفر سكن قريب'
 where serial = 'HRC-NO-000002' and attempt_no = 1;

--  (ج) مصطفى — توظيف ناجح على فني الكهرباء.
update brc.job_attempts
   set job_id      = (select id from brc.jobs where code = 'HRC-1005'),
       job_code    = 'HRC-1005',
       slot_status = 'succeeded',
       selected_at = now() - interval '12 days',
       closed_at   = now() - interval '10 days',
       outcome_note = 'تم التوظيف فعلياً'
 where serial = 'HRC-NO-000003' and attempt_no = 1;

--  إغلاق وظيفة التوظيف الناجح (إن لم يفعلها المُشغِّل).
update brc.jobs
   set status = 'closed', closed_at = now() - interval '10 days'
 where code = 'HRC-1005' and status <> 'closed';

-- ---------------------------------------------------------------------------
--  4) مزامنة العدّادات: حتى لا يولّد النظام كوداً مستعمَلاً بعد هذا الإدراج.
--     نأخذ أكبر رقم مستعمَل فعلاً أياً كانت بادئته (HRC أو BRC).
-- ---------------------------------------------------------------------------
select setval('brc.job_code_seq', (
  select greatest(coalesce(max((regexp_replace(code, '[^0-9]', '', 'g'))::bigint), 0), 1005)
    from brc.jobs
));

select setval('brc.form_serial_seq', (
  select greatest(coalesce(max((regexp_replace(serial, '[^0-9]', '', 'g'))::bigint), 0), 3)
    from brc.applicants
));

commit;

--  تحقّق سريع — المتوقع: 5 وظائف و3 استمارات و15 خانة محاولات
select 'وظائف'    as البند, count(*) as العدد from brc.jobs       where notes = 'DEMO'
union all
select 'استمارات', count(*) from brc.applicants where reject_reason = 'DEMO'
union all
select 'محاولات',  count(*) from brc.job_attempts
 where serial in (select serial from brc.applicants where reject_reason = 'DEMO');


-- ===========================================================================
--  🗑️ التفريغ بعد موافقة الزبون — نفّذ هذا الجزء وحده
--  ---------------------------------------------------------------------------
--  يحذف بيانات العرض فقط (المعلَّمة DEMO) ولا يمسّ أي سجل حقيقي أدخله
--  الموظف أثناء التجربة. أزل التعليق عن الأسطر ثم شغّلها.
-- ===========================================================================
-- begin;
--   -- نُفرِج الحجوزات أولاً حتى لا يمنع قيد reserved_by حذف الاستمارات
--   update brc.job_attempts set slot_status = 'empty', job_id = null,
--          job_code = null, selected_at = null, hold_expires_at = null
--    where serial in (select serial from brc.applicants where reject_reason = 'DEMO');
--   update brc.jobs set status = 'available', reserved_by = null,
--          hold_expires_at = null, closed_at = null
--    where notes = 'DEMO';
--   delete from brc.job_attempts
--    where serial in (select serial from brc.applicants where reject_reason = 'DEMO');
--   delete from brc.applicants where reject_reason = 'DEMO';
--   delete from brc.jobs where notes = 'DEMO';
-- commit;
