#!/usr/bin/env python3
"""يبني عبارات SQL لأربعة جداول لا تصدّرها recovery_export_v2:

  card_number_registry  <serial>:<card_number>  لكل صف
  card_issue_requests   <id>|<actor>|<params jsonb>|<serials text[]>
  card_number_counter   من max(card_number) في السجل
  office_receipts       فارغ في الإنتاج (يُبنى كتعليق صريح، لا جدول وهمي)

⚠️ office_receipts فيه 0 صف. كتابة `insert ... values` فارغة تُنتج خطأ صياغة،
   فنُخرج عبارة صريحة تُثبت أن العدد صفر ولا تُدخل شيئاً.

الاستخدام (من جذر المستودع):
    python3 tools/rescue-db/build_registry_state.py > registry_state.sql
"""
import json
import os
import sys

REG = os.environ.get('REGISTRY_MAP', 'rescue/database/registry_map.txt')
CIR = os.environ.get('ISSUE_REQUESTS', 'rescue/database/issue_requests.txt')

# ═══ سجل الأرقام ════════════════════════════════════════════════════════════
# الصيغة في الخريطة: <card_number>:<serial>  (الرقم أولاً، مثل ملف الإنتاج)
pairs = [p.strip() for p in open(REG, encoding='utf-8').read().split(',') if p.strip()]
reg = []
for p in pairs:
    num, serial = p.split(':', 1)
    reg.append((serial, int(num)))

nums = [n for _, n in reg]
assert len(reg) == len({s for s, _ in reg}), 'سيريال مكرّر في السجل'
assert len(reg) == len(set(nums)), 'رقم بطاقة مكرّر في السجل'
assert min(nums) == 1, 'السجل لا يبدأ من 1'
assert nums == list(range(1, len(nums) + 1)), 'فجوة في سلسلة الأرقام'
floor = max(nums)

# ═══ طلبات الإصدار ══════════════════════════════════════════════════════════
reqs = []
if os.path.exists(CIR):
    for line in open(CIR, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line.strip():
            continue
        rid, actor, params, serials = line.split('|', 3)
        json.loads(params)                                   # تحقّق من الصلاحية
        assert serials.startswith('{') and serials.endswith('}')
        reqs.append((rid, actor, params, serials))

out = []
out.append("""-- ═══════════════════════════════════════════════════════════════════════════
--  سجل أرقام البطاقات وطلبات الإصدار
--
--  لا يُصدَّر أيٌّ منهما في النسخة الإنتاجية (v2). بلا السجل يبدأ عدّاد
--  الأرقام من صفر بعد الاسترجاع، فيحصل أول إصدار على رقم مستخدَم سابقاً
--  ومطبوع على ورق رسمي — تكرار على وثيقة. الإصلاح: نقل السجل كاملاً،
--  ثم تثبيت العدّاد على أعلى رقم موجود.
--
--  البيانات سُحبت من الإنتاج كما هي (قراءة فقط):
--    {n} رقماً، من 1 إلى {floor} بلا فجوات، و{reqs} طلب إصدار.
--
--  الإصلاح الجذري: الهجرة portable_backup_v4_registry.
-- ═══════════════════════════════════════════════════════════════════════════
""".format(n=len(reg), floor=floor, reqs=len(reqs)))


def emit(comment, head, rows, fmt, tail):
    """يكتب عبارة إدخال واحدة.

    rows فارغة تعني «هذه العبارة مستقلة لا VALUES لها» (مثل UPDATE العدّاد):
    تُكتب كما هي مع فاصلة منقوطة. الخلل السابق: كان يُقتطع آخر حرفين من
    العبارة فيلتهم المنقوطة، فتفسد العبارة التالية بـsyntax error.
    """
    out.append(comment + '\n')
    if not rows:
        out.append(head.rstrip() + '\n\n')
        return
    out.append(head + '\n')
    for i in range(0, len(rows), 200):
        out.append(',\n'.join(fmt % r for r in rows[i:i + 200]) + ',\n')
    out[-1] = out[-1][:-2] + '\n'
    out.append(tail + '\n\n')


emit('-- سجل الأرقام (card_number_registry) — %d صفاً' % len(reg),
     'INSERT INTO brc.card_number_registry (serial, card_number) VALUES',
     reg, "  ('%s', %d)", 'ON CONFLICT (serial) DO NOTHING;')

# العدّاد: أعلى رقم + إعادة ضبط التسلسل. الصف singleton موجود من المخطط.
emit('-- العدّاد: يُثبَّت على %d (أعلى رقم مُستخدَم) لا على صفر' % floor,
     'UPDATE brc.card_number_counter SET last_number = %d WHERE singleton;' % floor,
     [], '', '')

if reqs:
    emit('-- طلبات الإصدار (card_issue_requests) — %d طلباً' % len(reqs),
         'INSERT INTO brc.card_issue_requests (id, actor, params, serials) VALUES',
         reqs, "  ('%s', '%s', '%s'::jsonb, '%s'::text[])",
         'ON CONFLICT (id) DO NOTHING;')
else:
    out.append("-- card_issue_requests: لم تُسحب (issue_requests.txt غائب)\n\n")

out.append("""-- office_receipts: 0 صف في الإنتاج. لا شيء يُدخل.
-- العبارة أدناه تُفشل الاستيراد إن ظهر صف — تثبيت للعدد لا تخمين.
DO $$ BEGIN
  IF (SELECT count(*) FROM brc.office_receipts) <> 0 THEN
    RAISE EXCEPTION 'office_receipts يحمل صفوفاً بعد الاستيراد، والمتوقع صفر';
  END IF;
END $$;
""")

sys.stdout.write(''.join(out))
