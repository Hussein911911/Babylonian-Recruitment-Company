#!/usr/bin/env bash
# يُعيد بناء الملف المُصلَح من الأصل الإنتاجي بخطوات حتمية.
# التشغيل من جذر المستودع:
#   ORIG="/tmp/arena-coding-uploads/HRC-FULL-2026-11-18 (1).sql" \
#     tools/rescue-db/assemble.sh
set -euo pipefail
ORIG="${ORIG:?مرّر مسار النسخة الأصلية في ORIG}"
OUT=rescue/database/HRC-FULL-2026-11-18-REPAIRED.sql

python3 tools/rescue-db/repair_dump.py "$ORIG" "$OUT"
python3 tools/rescue-db/build_cards_state.py   > /tmp/cards_state.sql
python3 tools/rescue-db/build_registry_state.py > /tmp/registry_state.sql

python3 - "$OUT" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
i = s.index('--  الفحص الأخير')
blocks = ''.join(open(f, encoding='utf-8').read().rstrip() + '\n\n'
                 for f in ('/tmp/cards_state.sql', '/tmp/registry_state.sql'))
open(p, 'w', encoding='utf-8').write(s[:i] + blocks + s[i:])
print('حُقنت الكتل قبل قسم الفحص')
PY
echo "✓ $OUT"
