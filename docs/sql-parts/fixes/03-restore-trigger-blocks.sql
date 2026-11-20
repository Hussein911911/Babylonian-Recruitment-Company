-- ═══════════════════════════════════════════════════════════════════════════
--  إصلاح 2026-11-20 — كتلتا تعطيل/إعادة تفعيل المشغّلات في ملف الاسترجاع
--  ---------------------------------------------------------------------------
--  المشكلة (مُثبتة تنفيذاً على مشروع الهدف tkxbmopxcftxpcoczweq):
--    الملف الكامل HRC-FULL-2026-11-19.sql يعطّل كل المشغّلات بـ
--        ALTER TABLE brc.<t> DISABLE TRIGGER ALL
--    ثم يعيدها بـ ENABLE TRIGGER ALL.
--    في مشروع Supabase الحالي دور `postgres` **ليس superuser**
--    (‏rolsuper = false، وهو أمر طبيعي في مشاريع Supabase الحديثة).
--    و ALTER TABLE … {DISABLE,ENABLE} TRIGGER ALL **يتطلب superuser** لأن
--    «ALL» يمسّ مشغّلات القيود الداخلية (RI_ConstraintTrigger…). النتيجة:
--
--      • كتلة التعطيل: تفشل بـ 42501 لكنها ملفوفة بـ EXCEPTION → تُهمَل بصمت
--        (المشغّلات تبقى فعّالة أثناء التحميل).
--      • كتلة إعادة التفعيل: تفشل بـ 42501 **بلا** معالج استثناء → تُجهض
--        معاملة البيانات كاملة → لا يُثبَّت COMMIT → الاسترجاع يفشل كله.
--
--    أي: الملف كما هو **لا يمكن أن يكتمل** على مشروع Supabase حديث.
--
--  الحل: استبدال الكتلتين بنسخة تسمّي كل مشغّل صراحةً
--        (‏ALTER TABLE … DISABLE TRIGGER <name>)، وهذا مسموح لمالك الجدول
--        بلا superuser، ويكافئ «ALL» لكل المشغّلات غير الداخلية.
--    مشغّلات القيود الداخلية (المفاتيح الأجنبية) تبقى فعّالة — وهذا أفضل:
--    الاسترجاع يتحقّق من سلامة المراجع أثناء التحميل بدل تجاوزها.
--
--  يُطبَّق آلياً بـ:  npm run restore:patch -- <الملف> <الإخراج>
--  ويُستخدم تلقائياً داخل: npm run restore:file
--  اختبار: node tests/patch-restore-triggers.mjs
-- ═══════════════════════════════════════════════════════════════════════════

-- @block disable
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname AS tbl, g.tgname AS trg
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_trigger g ON g.tgrelid = c.oid AND NOT g.tgisinternal
            WHERE n.nspname = 'brc' AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE brc.%I DISABLE TRIGGER %I', t.tbl, t.trg);
  END LOOP;
EXCEPTION WHEN insufficient_privilege OR others THEN NULL; END $$;
-- @end

-- @block enable
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname AS tbl, g.tgname AS trg
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_trigger g ON g.tgrelid = c.oid AND NOT g.tgisinternal
            WHERE n.nspname = 'brc' AND c.relkind = 'r'
              AND g.tgenabled <> 'O' LOOP
    EXECUTE format('ALTER TABLE brc.%I ENABLE TRIGGER %I', t.tbl, t.trg);
  END LOOP;
END $$;
-- @end
