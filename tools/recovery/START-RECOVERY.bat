@echo off
chcp 65001 >nul
title أداة استرجاع قاعدة الشركة
cd /d "%~dp0.."

echo.
echo   ==========================================================
echo    أداة استرجاع قاعدة الشركة
echo   ==========================================================
echo.

rem ── ١) هل Node مثبّت؟ ───────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
  echo   [x] Node.js غير مثبّت على هذا الجهاز.
  echo.
  echo   نزّله من: https://nodejs.org  ^(زر LTS^)
  echo   ثم ثبّته كالعادة، وأعد فتح هذا الملف.
  echo.
  pause
  exit /b 1
)

rem ── ٢) هل الحزم مثبّتة؟ ─────────────────────────────────────
if not exist "node_modules\pg" (
  echo   [1/2] تثبيت الأدوات مرة واحدة — يحتاج إنترنت دقيقة...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [x] فشل التثبيت. تحقق من الإنترنت ثم أعد المحاولة.
    pause
    exit /b 1
  )
)

rem ── ٣) التشغيل ──────────────────────────────────────────────
echo   [2/2] تشغيل الأداة... المتصفح سيفتح تلقائياً.
echo.
node tools\recovery-server.mjs

echo.
echo   توقّفت الأداة. إن ظهر خطأ أعلاه، انسخه وأرسله.
pause
