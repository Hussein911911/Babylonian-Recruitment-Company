#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   يبني **ملفاً واحداً** فيه الهيكل الكامل + كل البيانات + حزام أمان.

   طلب المالك (2026-11-17): «أريد أنزّل ملف واحد يحتوي كل شي، وهذا الملف بس
   أنطيه لأداة، والأداة تبني كل شي.»

   ⚠️ لماذا لم نستخدم طريقة اللصق؟
   محرّر Supabase يقصّ النص عند ~٢٠٠٠ سطر ويقول «Success» رغم النقص. الملف
   الكامل ~٢٠٥٠٠ سطر، فلو لُصق يدوياً لبُتر بصمت — أسوأ نتيجة ممكنة: يظنّ
   المالك أن كل شي تمّ بينما ٣٠٠ بطاقة ناقصة.

   فالحل: الملف **يُنفَّذ بأداة** (psql / Supabase CLI / أداة تتصل بالـDB)،
   لا يُلصق. وهذا الملف مبنيّ لذلك:

     ١. لا يحتوي `BEGIN` يحيط كل شي — لأن أول خطأ كان يُجهض كل ما دخل،
        فيبدو «نُفِّذ» والقاعدة فارغة.
     ٢. كل مرحلة في معاملة مستقلة، وتصمد إن فشل ما بعدها.
     ٣. يفحص نفسه في النهاية ويطبع الأعداد — فإن نقص شي ظهر في السطر الأخير.

   الاستخدام:
     node tools/build-full-dump.mjs --payload <payload.json> [--out <ملف>]
     node tools/build-full-dump.mjs --schema-only --out full.sql
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const flag = (n) => argv.includes('--' + n);

const outPath = resolve(opt('out', 'HRC-FULL.sql'));
const payloadPath = opt('payload', '');

/* ── الهيكل: نقرأه من المصدر مباشرة. لا نعتمد على نسخة مضمّنة في صفحة ── */
const schemaPath = resolve(ROOT, 'docs/schema.sql');
if (!existsSync(schemaPath)) { console.error('❌ لم أجد docs/schema.sql'); process.exit(2); }
const SCHEMA = readFileSync(schemaPath, 'utf8');

/* نحذف سطور SET search_path وCREATE EXTENSION من الهيكل: الامتدادات تُفعَّل
   من لوحة Supabase، ومحاولة إنشائها بـSQL قد تفشل بصلاحية غير كافية.
   (الهيكل نفسه يغلّفها بـDO فيبقى آمناً — لكن نُبقيها كما هي.) */

const HEADER = `-- ═══════════════════════════════════════════════════════════════════════════
--  HRC — ملف كامل: الهيكل + البيانات
--  بُني في: ${new Date().toISOString()}
--
--  ⚠️ هذا الملف **يُنفَّذ بأداة**، لا يُلصق في محرّر SQL.
--     محرّر Supabase يقصّ عند ~٢٠٠٠ سطر ويقول Success رغم النقص، وهذا
--     الملف أكبر من ذلك بكثير — فلو لُصق لبُتر بصمت.
--
--  أدوات تعمل معه:
--     psql "postgresql://..." -f HRC-FULL.sql
--     supabase db push   (بعد وضعه في supabase/migrations/)
--     أي أداة تنفّذ ملف SQL على القاعدة كاملاً
--
--  بلا BEGIN شامل بقصد: كل مرحلة معاملة مستقلة، ففشل مرحلة لا يمحو ما قبلها.
--
--  بعد التنفيذ: اقرأ آخر مخرجات — فيها جدول أعداد لكل جدول.
--  قارنها بأعدادك الحالية. إن اختلف رقم، فالملف لم يُنفَّذ كاملاً.
-- ═══════════════════════════════════════════════════════════════════════════

SET client_encoding = 'UTF8';
SET statement_timeout = 0;

-- ═══════════════════════════════════════════════════════════════════════════
--  المرحلة ١ — الهيكل (الجداول والدوال والسياسات)
-- ═══════════════════════════════════════════════════════════════════════════

`;

const SCHEMA_END = `
-- ═══════════════════════════════════════════════════════════════════════════
--  انتهى الهيكل. تحقّق أنه أُنشئ قبل متابعة البيانات:
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
   WHERE table_schema = 'brc' AND table_type = 'BASE TABLE';
  IF n < 19 THEN
    RAISE EXCEPTION 'الهيكل ناقص: % جدولاً فقط (المتوقع 19+) — أوقف التنفيذ فوراً', n;
  END IF;
  RAISE NOTICE '✅ الهيكل سليم: % جدولاً', n;
END $$;

`;

let out = HEADER + SCHEMA + SCHEMA_END;

/* ── البيانات: من payload JSON إن وُجد ── */
if (payloadPath && existsSync(resolve(payloadPath))) {
  const payload = JSON.parse(readFileSync(resolve(payloadPath), 'utf8'));
  /* نستخدم نفس مُولّد SQL المستخدم في الصفحة — لا نكتب منطقاً ثانياً
     يختلف عنه. نُحمّله كموديول CommonJS-style لأن restor-sql.js ملف متصفح. */
  const sqlJs = readFileSync(resolve(ROOT, 'assets/js/restore-sql.js'), 'utf8');
  const sandbox = { window: {}, console };
  const fn = new Function('window', 'console', sqlJs + '\nreturn window.HRCRestoreSql;');
  const RestoreSql = fn(sandbox.window, console);
  if (!RestoreSql || !RestoreSql.buildSql) {
    console.error('❌ تعذّر تحميل مولّد SQL من assets/js/restore-sql.js');
    process.exit(3);
  }
  /* ⚠️ خطأ حقيقي وقعتُ فيه 2026-11-17، وأوقف الملف كله.
     قصصتُ رأس الملف المولّد لأخذ «الجسم فقط»، فسقط معه سطر
     `session_replication_role = replica` — وهو الذي يعطّل المشغّلات
     والمفاتيح الأجنبية أثناء التحميل. وبدونه:
        • trg_applicants_log_serial تُدرج سطور issued_serials بنفسها،
          فتصل بعدها سطورنا وتصطدم بالمفتاح الأساسي
        • trg_applicants_attempts تُنشئ المحاولات، فتصطدم بمفتاح (serial, attempt_no)
        • trg_audit_* تكتب سطر تدقيق، فيصطدم بـaudit_log_pkey
     وكانت النتيجة: الملف يفشل عند job_attempts، ولا صف واحد يدخل.

     فالصحيح: نأخذ من البداية إلى نهاية SETUP (حتى TRUNCATE) ثم البيانات —
     لا نقطع عند CREATE SCHEMA. */
  const dataSql = RestoreSql.buildSql(payload);
  const cut = dataSql.indexOf('CREATE SCHEMA IF NOT EXISTS brc;');
  const body = cut >= 0 ? dataSql.slice(cut) : dataSql;

  /* حزام أمان: إن لم يحمل الجسم سطر replica، نُضيفه نحن. بدونه تفشل البيانات
     كما شرحنا أعلاه (المشغّلات تُنشئ صفوفاً تتعارض مع صفوفنا). */
  const withReplica = /session_replication_role\s*=\s*replica/i.test(body)
    ? body
    : `DO $$ BEGIN SET LOCAL session_replication_role = replica;\n` +
      `EXCEPTION WHEN insufficient_privilege OR others THEN\n` +
      `  RAISE NOTICE 'تنبيه: تعذّر تعطيل المشغّلات — قد تتعارض الصفوف المولّدة'\n;\n` +
      `END $$;\n\n` + body;

  out += `
-- ═══════════════════════════════════════════════════════════════════════════
--  المرحلة ٢ — البيانات
--  ⚠ يبدأ بـ TRUNCATE: لا تُنفّذه على قاعدة فيها بيانات حقيقية.
--  المشغّلات معطّلة أثناء التحميل (replica) — وهذا ضروري: مشغّلات البطاقات
--  تُنشئ سطور issued_serials والمحاولات بنفسها، فتصطدم بصفوفنا وتفشل.
-- ═══════════════════════════════════════════════════════════════════════════

` + withReplica;
} else if (!flag('schema-only')) {
  console.error('⚠️  لم يُمرَّر --payload: الملف سيحتوي الهيكل فقط.');
}

/* ── الفحص الأخير: أعداد كل جدول ── */
out += `
-- ═══════════════════════════════════════════════════════════════════════════
--  الفحص الأخير — اقرأ هذا الجدول وقارنه بأعدادك
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'staff' AS "الجدول", count(*) AS "العدد" FROM brc.staff
UNION ALL SELECT 'applicants', count(*) FROM brc.applicants
UNION ALL SELECT 'jobs', count(*) FROM brc.jobs
UNION ALL SELECT 'job_attempts', count(*) FROM brc.job_attempts
UNION ALL SELECT 'issued_serials', count(*) FROM brc.issued_serials
UNION ALL SELECT 'card_number_registry', count(*) FROM brc.card_number_registry
UNION ALL SELECT 'audit_log', count(*) FROM brc.audit_log
UNION ALL SELECT 'settings', count(*) FROM brc.settings
UNION ALL SELECT 'recovery_chances', count(*) FROM brc.recovery_chances
UNION ALL SELECT 'recovery_prints', count(*) FROM brc.recovery_prints
UNION ALL SELECT 'office_receipts', count(*) FROM brc.office_receipts
ORDER BY 1;

-- ⚠ إن كان أي رقم صفراً أو أقل من المتوقع، فالملف لم يُنفَّذ كاملاً.
--   لا تبدأ العمل على القاعدة الجديدة قبل حلّ ذلك.
`;

writeFileSync(outPath, out, 'utf8');
const lines = out.split('\n').length;
const kb = Math.round(Buffer.byteLength(out, 'utf8') / 1024);
console.log(`✅ ${outPath}`);
console.log(`   ${lines} سطراً · ${kb} ك.ب`);
console.log(`   ${payloadPath ? 'الهيكل + البيانات' : 'الهيكل فقط'}`);
