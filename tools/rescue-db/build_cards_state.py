#!/usr/bin/env python3
"""يبني عبارات SQL لجدولي recovery_prints وrecovery_chances من خرائط الإنتاج.

الخريطتان تُسحبان من الإنتاج بـ**قراءة فقط** (انظر RESCUE-DB.md):
  chances_map.txt : <serial>:<mask>:<count>
                    mask حرف لكل محاولة: '1' مستهلكة، '0' متاحة
  printed_map.txt : <serial> — سطر لكل بطاقة طُبعت فعلاً

الاستخدام (من جذر المستودع):
    python3 tools/rescue-db/build_cards_state.py > cards_state.sql

⚠️ لماذا ملفان لا واحد؟ لأن `printed` مستقل تماماً عن `spent`. بطاقة قد
   تُطبع ولا تُستخدم، وأخرى تُستهلك فرصتها دون طباعة. استنتاج أحدهما من
   الآخر خطأ وقعتُ فيه فعلاً: أعطى 30 مطبوعة بدل 422 الحقيقية.

⚠️ ما لا يمكن استرجاعه: `code_hash` — بصمة رمز الاسترجاع لكل محاولة.
   النسخة لا تحملها. تُكتب البصمة الفارغة العرفية (SHA-256 لسلسلة فارغة)،
   وهي تعني «لا رمز». الأثر: رمز استرجاع قديم لا يعمل بعد الاسترجاع —
   وهو سلوك آمن (لا يُقبل رمز مُخمَّن). الحالة نفسها (مستهلك/متاح،
   مطبوع/غير مطبوع) محفوظة كاملة، وهي ما يهمّ مالياً وأمنياً.
"""
import hashlib
import os
import sys

SRC = os.environ.get('CHANCES_MAP', 'rescue/database/chances_map.txt')
PRINTED = os.environ.get('PRINTED_MAP', 'rescue/database/printed_map.txt')

EMPTY = hashlib.sha256(b'').hexdigest()          # e3b0c442…
assert EMPTY.startswith('e3b0c442')

rows = [l.strip() for l in open(SRC, encoding='utf-8') if l.strip()]
printed_set = {l.strip() for l in open(PRINTED, encoding='utf-8') if l.strip()}

prints, chances = [], []
for line in rows:
    serial, mask, count = line.rsplit(':', 2)
    assert len(mask) == int(count), 'قناع لا يطابق العدد: ' + line
    prints.append((serial, 'true' if serial in printed_set else 'false', EMPTY))
    for i, flag in enumerate(mask, 1):
        chances.append((serial, i, 'true' if flag == '1' else 'false', EMPTY))

assert printed_set <= {r[0] for r in prints}, 'سيريال مطبوع غير موجود في الفرص'
assert sum(int(l.rsplit(':', 2)[2]) for l in rows) == len(chances)

HEADER = """-- ═══════════════════════════════════════════════════════════════════════════
--  حالة البطاقات: هل استُهلكت الفرصة، وهل طُبعت البطاقة
--
--  النسخة التي أنتجها الإنتاج (recovery_export_v2) **لا تصدّر**
--  recovery_chances ولا recovery_prints. بلا هذين الجدولين تصبح كل فرصة
--  «غير مستهلكة» بعد الاسترجاع، فيستطيع حامل البطاقة استخدام فرصة
--  استهلكها فعلاً — البطاقة تمنح فرصتين لا أكثر. خطأ مالي مباشر.
--
--  البيانات أدناه سُحبت من الإنتاج كما هي (قراءة فقط، لا تعديل):
--    {chances} فرصة على {prints} بطاقة، منها {spent} مستهلكة،
--    و{printed} بطاقة مطبوعة.
--
--  ⚠️ ما لم يُنقل: code_hash (بصمة رمز الاسترجاع). وُضعت البصمة الفارغة
--  العرفية بدلاً منها. الأثر: رمز استرجاع قديم لا يعمل — وهو سلوك آمن
--  (لا يُقبل رمز مُخمَّن). الحالة نفسها محفوظة كاملة.
--
--  الإصلاح الجذري: طبّق الهجرة portable_backup_v4_registry (v3 تصدّر هذين
--  الجدولين). بعدها لا نحتاج حقناً يدوياً.
-- ═══════════════════════════════════════════════════════════════════════════
"""


def chunks(seq, n=200):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def emit(header, cols, rows_, fmt, conflict):
    out.append(header)
    out.append('INSERT INTO brc.%s VALUES\n' % cols)
    for g in chunks(rows_):
        out.append(',\n'.join(fmt % r for r in g) + ',\n')
    out[-1] = out[-1][:-2] + '\n'          # حذف الفاصلة الذيلية
    out.append(conflict + '\n\n')


out = [HEADER.format(chances=len(chances), prints=len(prints),
                     spent=sum(1 for c in chances if c[2] == 'true'),
                     printed=sum(1 for p in prints if p[1] == 'true'))]

emit('-- هل طُبعت البطاقة (recovery_prints) — %d صفاً\n' % len(prints),
     'recovery_prints (serial, printed, code_hash)', prints,
     "  ('%s', %s, '%s')", 'ON CONFLICT (serial) DO NOTHING;')
emit('-- هل استُهلكت الفرصة (recovery_chances) — %d صفاً\n' % len(chances),
     'recovery_chances (serial, attempt_no, spent, code_hash)', chances,
     "  ('%s', %d, %s, '%s')", 'ON CONFLICT (serial, attempt_no) DO NOTHING;')

sys.stdout.write(''.join(out))
