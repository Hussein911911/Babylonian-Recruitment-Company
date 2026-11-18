#!/usr/bin/env python3
"""يُصلح ملف نسخة أنتجه الإنتاج (recovery_export_v2) ليعمل فعلاً.

الملف الأصلي **لا يُستَرجع**: شغّلناه عبارةً عبارة على قاعدة مبنية من
المخطط ففشل بثلاثة أخطاء قاتلة. هذا السكربت يعالج الأسباب الثلاثة:

  ١) `settings.value` عمود jsonb. المولّد يكتب قيمة نصّية بلا اقتباس داخلي،
     فتُقرأ كـ jsonb غير صالح → `22P02: invalid input syntax for type json`.
  ٢) الإدخال يأتي قبل المشغّلات معطّلة: مشغّل البطاقات يُنشئ `job_attempts`
     بنفسه، ومشغّل التدقيق يُدرج في `audit_log` → `duplicate key`.
  ٣) ترتيب الإدخال ليس ترتيب تبعية (`job_attempts` قبل `applicants`)،
     فتفشل الفواصل الأجنبية.

المعالجة: كتلة تجهيز داخل المعاملة (تفريغ ديناميكي + DISABLE TRIGGER ALL)
قبل أول إدخال، وإعادة تفعيل قبل COMMIT.

الاستخدام:
    python3 tools/rescue-db/repair_dump.py <الأصلي> <الناتج>
"""
import re
import sys

src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
orig_len = len(s)

# ═══ ١) قيمة jsonb النصية ═══════════════════════════════════════════════════
# المتوقّع:  ('recovery_last_scheduled_at', '<ts>', NULL, '<ts>'),
# المطلوب:   ('recovery_last_scheduled_at', '<ts>', NULL, '"<ts>"'::jsonb),
pattern = re.compile(
    r"\('recovery_last_scheduled_at',\s*'([^']*)',\s*(NULL|'[^']*'|[\w-]+),\s*'([^']*)'\)"
)


def fix_settings(m):
    return "('recovery_last_scheduled_at', '%s', %s, '\"%s\"'::jsonb)" % (
        m.group(1), m.group(2), m.group(3))


s, nfix = pattern.subn(fix_settings, s)
if nfix != 1:
    sys.exit('توقّفت: وجدت %d مطابقة لقيمة recovery_last_scheduled_at، والمتوقع 1' % nfix)

# ═══ ٢) كتلة التجهيز قبل أول إدخال بيانات ══════════════════════════════════
PREP = """-- ═══════════════════════════════════════════════════════════════════════════
--  كتلة تجهيز — أُضيفت عند الإصلاح (2026-11-18)
--
--  الملف الأصلي لم يكن يُستَرجع: شغّلناه فعلياً ففشل بـ22P02 في settings،
--  ثم بمفتاح مكرّر في job_attempts وaudit_log وissued_serials.
--
--  السبب: مشغّلات الهيكل تُنشئ صفوفاً من تلقاء نفسها (فرص، أرقام بطاقات،
--  تدقيق) فتصطدم بالإدخال الصريح. وترتيب الإدخال ليس ترتيب تبعية:
--  job_attempts يأتي قبل applicants، وemployer_job_credentials قبل jobs.
--
--  الحل: تعطيل كل مشغّلات brc (ALL لا USER — لأن USER يُبقي فحص الفواصل
--  الأجنبية فعّالاً) ثم تفريغ ديناميكي من الكتالوج. تُعاد قبل COMMIT.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'brc' AND c.relkind = 'r' AND c.relname <> 'staff' LOOP
    EXECUTE format('TRUNCATE brc.%I RESTART IDENTITY CASCADE', t.relname);
  END LOOP;
END $$;

-- إعادة زرع صف العدّاد الذي يزرعه المخطط أصلاً: التفريغ أعلاه يمحوه،
-- وبلا هذا السطر يفشل UPDATE العدّاد لاحقاً بصمت (0 صف) ويبقى الرقم صفراً.
INSERT INTO brc.card_number_counter (singleton, last_number) VALUES (true, 0)
  ON CONFLICT (singleton) DO NOTHING;

DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'brc' AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE brc.%I DISABLE TRIGGER ALL', t.relname);
  END LOOP;
EXCEPTION WHEN insufficient_privilege OR others THEN NULL; END $$;

"""

# أول عبارة بيانات: تعليق العدد ثم INSERT
m = re.search(r"--\s*\d+\s+صفاً في applicants", s)
if not m:
    sys.exit('توقّفت: لم أجد أول عبارة بيانات (تعليق applicants)')
s = s[:m.start()] + PREP + s[m.start():]

# ═══ ٣) إعادة تفعيل المشغّلات داخل المعاملة قبل COMMIT ══════════════════════
REENABLE = """-- إعادة تفعيل المشغّلات — داخل نفس المعاملة، قبل COMMIT.
-- بلا هذه الكتلة يبقى التدقيق وإصدار أرقام البطاقات معطّلاً على القاعدة
-- المسترجعة إلى الأبد، وهو أسوأ من الفشل الصريح.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'brc' AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE brc.%I ENABLE TRIGGER ALL', t.relname);
  END LOOP;
END $$;

"""
m2 = re.search(r"--\s*الفحص الأخير", s)
if not m2:
    sys.exit('توقّفت: لم أجد قسم الفحص الأخير')
s = s[:m2.start()] + REENABLE + s[m2.start():]

open(dst, 'w', encoding='utf-8').write(s)
print('✓ %s → %s' % (src, dst))
print('  إصلاح jsonb: %d موضعاً' % nfix)
print('  الحجم: %.2f م.ب → %.2f م.ب' % (orig_len / 1048576, len(s) / 1048576))
