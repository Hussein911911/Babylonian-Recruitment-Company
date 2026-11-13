#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  HRC — فحص أمني يومي (security-audit.sh)
#  ---------------------------------------------------------------------------
#  ⚠ لماذا سكربت منفصل عن ملف الـ workflow؟
#
#  GitHub يرفض رفع أي ملف تحت .github/workflows/ إذا لم يكن لتكامل GitHub
#  صلاحية `workflows`. وهذا الرفض **من مستوى المنصة**، ولا يُتجاوز بإعادة
#  ربط أو برمز وصول. فالمنطق كله هنا — قابل للتشغيل يدوياً الآن، وللربط
#  بالـ workflow فور منح الصلاحية (انظر docs/security-audit-setup.md).
#
#  ما يفعله:
#    1. فحص صلاحيات الدوال على قاعدة حقيقية (49 فحصاً).
#    2. مقارنة بصمة السياسة بالـ baseline (يكشف أي دالة جديدة مفتوحة).
#    3. فحص مخطط القاعدة النصي (331+ فحصاً).
#    4. بناء الموقع (يتأكد أن التعديلات لا تكسر مساراً).
#
#  التشغيل:  bash tools/security-audit.sh
#  الخروج:   0 = سليم · 1 = انحراف حرج · 2 = خطأ بيئة
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
step() { printf '\n\033[1m▌ %s\033[0m\n' "$1"; }
pass() { printf '  \033[32m✅ %s\033[0m\n' "$1"; }
fail() { printf '  \033[31m⛔ %s\033[0m\n' "$1"; FAILED=1; }

if [ ! -d node_modules ]; then
  fail "node_modules غائب — شغّل: npm ci"
  exit 2
fi

step "1 — صلاحيات الدوال على قاعدة حقيقية (PGlite)"
if node tests/function-acl-audit.mjs; then
  pass "سياسة الصلاحيات مطابقة"
else
  fail "انحراف في صلاحيات الدوال"
fi

step "2 — مراقبة السياسة مقابل الـ baseline"
if node tools/security-monitor.mjs --compare | tee /tmp/hrc-acl-compare.log | tail -20; then
  pass "لا انحراف عن docs/security-baseline.json"
else
  fail "انحراف عن الـ baseline (اقرأ التفاصيل أعلاه)"
fi

step "3 — سلامة مخطط القاعدة"
if node tests/schema.mjs | tail -6; then
  pass "مخطط القاعدة سليم"
else
  fail "خلل في مخطط القاعدة"
fi

step "4 — بناء الموقع"
if npm run build --silent > /tmp/hrc-build.log 2>&1; then
  pass "البناء نجح"
else
  fail "البناء فشل — آخر سطور:"; tail -15 /tmp/hrc-build.log
fi

printf '\n%s\n' "═══════════════════════════════════════════════════════════════════════"
if [ "$FAILED" -eq 0 ]; then
  printf '  \033[32mالنتيجة: ✅ لا انحراف أمني\033[0m\n'
else
  printf '  \033[31mالنتيجة: ⛔ يوجد انحراف — عالجه قبل الدمج\033[0m\n'
fi
printf '%s\n\n' "═══════════════════════════════════════════════════════════════════════"
exit "$FAILED"
