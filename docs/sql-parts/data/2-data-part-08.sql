-- ═══════════════════════════════════════════════════════════════════════
--  2-data — الجزء 08 من 08
--  يفعّل: إدخال بيانات · بداية معاملة · إغلاق معاملة · ضبط التسلسلات · كتل تنفيذية (DO)
--  أسطر: 25 · حجم: 1 ك.ب
--  ---------------------------------------------------------------------
--  ⚠ لا تلصق هذا الجزء قبل تنفيذ الجزء 07 بنجاح.
--  هذا آخر جزء. بعد «Success» تحقّق من الأعداد في INDEX.md.
-- ═══════════════════════════════════════════════════════════════════════


BEGIN;

-- تعطيل المشغّلات داخل هذه المعاملة (كما في الملف الأصلي)
DO $$ BEGIN SET LOCAL session_replication_role = replica;
EXCEPTION WHEN insufficient_privilege OR others THEN NULL; END $$;

-- ⚠ عدّاد أرقام البطاقات: يبدأ من أعلى رقم مستخدم، لا من صفر.
--   لو تجاهلناه لأخذت أول بطاقة جديدة رقماً مطبوعاً سابقاً.
INSERT INTO brc.card_number_counter (singleton, last_number) VALUES (true, 1339)
ON CONFLICT (singleton) DO UPDATE SET last_number = GREATEST(brc.card_number_counter.last_number, EXCLUDED.last_number);

-- إعادة ضبط التسلسلات بعد الإدخال بأرقام صريحة
SELECT setval(pg_get_serial_sequence('brc.audit_log', 'id'),
              COALESCE((SELECT MAX(id) FROM brc.audit_log), 1), true);

COMMIT;

-- تحقّق
SELECT 'jobs' AS tbl, count(*) FROM brc.jobs
UNION ALL SELECT 'applicants', count(*) FROM brc.applicants
UNION ALL SELECT 'job_attempts', count(*) FROM brc.job_attempts
UNION ALL SELECT 'audit_log', count(*) FROM brc.audit_log
UNION ALL SELECT 'issued_serials', count(*) FROM brc.issued_serials
UNION ALL SELECT 'staff', count(*) FROM brc.staff
ORDER BY tbl;