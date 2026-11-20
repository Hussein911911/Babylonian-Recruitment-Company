/* ═══════════════════════════════════════════════════════════════════════════
   HRC — مُولّد «الملف الواحد» (الهيكل + البيانات)

   طلب المالك (2026-11-17): «أريد أنزّل ملف واحد يحتوي كل شي، وهذا الملف بس
   أنطيه لأداة، والأداة تبني كل شي.»

   ⚠️ لماذا هذا الملف موجود بدل أن يُبنى المنطق في مكانين؟
   لأن منطقين لا بدّ أن ينحرفا. `assets/js/restore-sql.js` هو المصدر الوحيد
   لتوليد صفوف البيانات، وهذا الملف يلفّه ويضيف الهيكل وحزام الأمان. فيستعمله
   المتصفح (restore.html) والأداة (tools/build-full-dump.mjs) بالتساوي —
   فما يجرّبه المالك في المتصفح هو حرفياً ما تنفّذه الأداة.

   ⚠️ ولا `BEGIN` شامل: كل مرحلة معاملة مستقلة. الملف القديم كان `BEGIN`
   واحداً، فأول خطأ يُجهض كل ما دخل — فتبدو العملية «نجحت» والقاعدة فارغة،
   وهي أسوأ نتيجة ممكنة.

   ⚠️ ولا يُلصق هذا الملف في محرّر Supabase: المحرّر يقصّ عند ~٢٠٠٠ سطر
   ويقول Success رغم النقص. الملف أكبر من ذلك بكثير — فالحقّ أنه يُنفَّذ
   بأداة (psql / Supabase CLI / أي أداة تتصل بالقاعدة).

   الواجهة العامة:
     window.HRCFullDump.build({ schema, payload })  →  نص SQL كامل
     window.HRCFullDump.SUMMARY(payload)            →  ملخّص الأعداد
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── الأعداد المتوقّعة من payload — تُطبع في الرأس كي يتحقّق القارئ ── */
  function SUMMARY(payload) {
    payload = payload || {};
    /* العدّاد يُشتق من السجل كما في restore-sql.js، لا من عدّاد محفوظ فقط */
    var reg = payload.card_number_registry || [];
    var maxReg = reg.reduce(function (m, r) {
      var n = Number(r && r.card_number);
      return isFinite(n) && n > m ? n : m;
    }, 0);
    var saved = (payload.card_number_counter || []).reduce(function (m, r) {
      var n = Number(r && r.last_number);
      return isFinite(n) && n > m ? n : m;
    }, 0);
    return {
      exportedAt: payload.exportedAt || '—',
      fingerprint: payload.schema || '—',
      cardNumberCounter: Math.max(maxReg, saved),
      counts: {
        staff: (payload.staff || []).length,
        applicants: (payload.applicants || []).length,
        jobs: (payload.jobs || []).length,
        job_attempts: (payload.job_attempts || []).length,
        issued_serials: (payload.issued_serials || []).length,
        card_number_registry: reg.length,
        audit_log: (payload.audit_log || []).length,
        settings: (payload.settings || []).length,
        recovery_chances: (payload.recovery_chances || []).length,
        recovery_prints: (payload.recovery_prints || []).length,
        office_receipts: (payload.office_receipts || []).length
      }
    };
  }

  /* جدول الأعداد في نهاية الملف — الفحص الذي يكشف النقص */
  function countReport() {
    return "-- ═══════════════════════════════════════════════════════════════════\n" +
      "--  الفحص الأخير — اقرأ هذا الجدول وقارنه بأعدادك في النسخة\n" +
      "-- ═══════════════════════════════════════════════════════════════════\n" +
      "SELECT 'staff' AS \"الجدول\", count(*) AS \"العدد\" FROM brc.staff\n" +
      "UNION ALL SELECT 'applicants', count(*) FROM brc.applicants\n" +
      "UNION ALL SELECT 'jobs', count(*) FROM brc.jobs\n" +
      "UNION ALL SELECT 'job_attempts', count(*) FROM brc.job_attempts\n" +
      "UNION ALL SELECT 'issued_serials', count(*) FROM brc.issued_serials\n" +
      "UNION ALL SELECT 'card_number_registry', count(*) FROM brc.card_number_registry\n" +
      "UNION ALL SELECT 'audit_log', count(*) FROM brc.audit_log\n" +
      "UNION ALL SELECT 'settings', count(*) FROM brc.settings\n" +
      "UNION ALL SELECT 'recovery_chances', count(*) FROM brc.recovery_chances\n" +
      "UNION ALL SELECT 'recovery_prints', count(*) FROM brc.recovery_prints\n" +
      "UNION ALL SELECT 'office_receipts', count(*) FROM brc.office_receipts\n" +
      "ORDER BY 1;\n\n" +
      "-- ⚠ إن كان أي رقم صفراً أو أقل من المتوقع، فالملف لم يُنفَّذ كاملاً.\n" +
      "--   لا تبدأ العمل على القاعدة الجديدة قبل حلّ ذلك.\n";
  }

  /* ── الهيكل: يُفحص بعد تنفيذه، فيتوقف إن كان ناقصاً ── */
  function schemaGate() {
    return "\n-- ═══════════════════════════════════════════════════════════════════════\n" +
      "--  انتهى الهيكل. تحقّق أنه أُنشئ قبل متابعة البيانات:\n" +
      "-- ═══════════════════════════════════════════════════════════════════════\n" +
      "DO $$\nDECLARE n int;\nBEGIN\n" +
      "  SELECT count(*) INTO n FROM information_schema.tables\n" +
      "   WHERE table_schema = 'brc' AND table_type = 'BASE TABLE';\n" +
      "  IF n < 19 THEN\n" +
      "    RAISE EXCEPTION 'الهيكل ناقص: % جدولاً فقط (المتوقع 19+) — أوقف التنفيذ فوراً', n;\n" +
      "  END IF;\n" +
      "  RAISE NOTICE '✅ الهيكل سليم: % جدولاً', n;\n" +
      "END $$;\n\n";
  }

  /* ── الحزام: تعطيل المشغّلات أثناء التحميل ──
     بدونه تُنشئ مشغّلات البطاقات صفوف issued_serials والمحاولات بنفسها،
     فتصطدم بصفوفنا وتفشل بـ «duplicate key value violates unique constraint»
     — ويسقط الملف كله بلا صف واحد. (عطل حقيقي وقع 2026-11-17 وكشفه الاختبار.) */
  function replicaGuard() {
    return "DO $$ BEGIN SET LOCAL session_replication_role = replica;\n" +
      "EXCEPTION WHEN insufficient_privilege OR others THEN\n" +
      "  RAISE NOTICE 'تنبيه: تعذّر تعطيل المشغّلات — قد تتعارض الصفوف المولّدة';\n" +
      "END $$;\n\n";
  }

  /* ═══ البناء ═══════════════════════════════════════════════════════════
     opts: { schema: نص الهيكل, payload: البيانات, schemaOnly: bool } */
  function build(opts) {
    opts = opts || {};
    var schema = opts.schema || '';
    var payload = opts.payload || null;
    if (!schema) throw new Error('لا يوجد هيكل — مُرّر opts.schema');

    var sum = SUMMARY(payload || {});
    var countsLine = Object.keys(sum.counts).map(function (k) {
      return sum.counts[k] + ' ' + k;
    }).join(' · ');

    var out = "-- ═══════════════════════════════════════════════════════════════════════\n" +
      "--  HRC — ملف كامل: الهيكل + البيانات\n" +
      "--  بُني في : " + new Date().toISOString() + "\n" +
      "--  النسخة  : " + sum.exportedAt + "\n" +
      "--  البصمة  : " + sum.fingerprint + "\n" +
      "--  الأعداد : " + (payload ? countsLine : '— (هيكل فقط)') + "\n" +
      "--            عدّاد البطاقات: " + sum.cardNumberCounter + "\n" +
      "--\n" +
      "--  ⚠️ هذا الملف **يُنفَّذ بأداة**، لا يُلصق في محرّر SQL.\n" +
      "--     محرّر Supabase يقصّ عند ~2000 سطر ويقول Success رغم النقص،\n" +
      "--     وهذا الملف أكبر من ذلك بكثير — فلو لُصق لبُتر بصمت.\n" +
      "--\n" +
      "--  أدوات تعمل معه:\n" +
      "--     psql \"postgresql://...\" -f HRC-FULL.sql\n" +
      "--     supabase db push\n" +
      "--     أي أداة تنفّذ ملف SQL على القاعدة كاملاً\n" +
      "--\n" +
      "--  بلا BEGIN شامل بقصد: كل مرحلة معاملة مستقلة، ففشل مرحلة لا يمحو\n" +
      "--  ما قبلها. وبعد التنفيذ اقرأ آخر مخرجات — فيها أعداد كل جدول.\n" +
      "-- ═══════════════════════════════════════════════════════════════════════\n\n" +
      "SET client_encoding = 'UTF8';\n" +
      "SET statement_timeout = 0;\n\n" +
      "-- ═══════════════════════════════════════════════════════════════════════\n" +
      "--  المرحلة ١ — الهيكل (الجداول والدوال والسياسات)\n" +
      "-- ═══════════════════════════════════════════════════════════════════════\n\n" +
      schema + "\n" + schemaGate();

    /* ── المرحلة ٢: البيانات ── */
    if (payload && !opts.schemaOnly) {
      if (!root.HRCRestoreSql || !root.HRCRestoreSql.buildSql) {
        throw new Error('مولّد SQL غير محمّل (assets/js/restore-sql.js)');
      }
      var dataSql = root.HRCRestoreSql.buildSql(payload);
      /* نأخذ من `BEGIN;` حتى النهاية، ونستبدل ذيله (تحقّقه الخاص) بجدول
         الأعداد الكامل أدناه.

         ⚠️ كان القصّ عند `CREATE SCHEMA IF NOT EXISTS brc;` — وهذا خطأ حقيقي
         (2026-11-18): كتلة التجهيز (تعطيل المشغّلات + التفريغ) تقع **قبل**
         `BEGIN;`، فكان القصّ يرميها كلها ويُبقي التفريغ الثابت القديم الذي
         يذكر جداول قد لا توجد. النتيجة على مشروع جديد: الملف يفشل فوراً
         بـ `relation ... does not exist` أو تصطدم المشغّلات بالصفوف
         المُدخلة فيسقط التحميل بـ `duplicate key`. القصّ من `BEGIN;`
         يحفظ كتلة التجهيز كما هي، ويجعل ما يجرّبه المالك في المتصفح
         هو نفسه ما تنتجه هذه الأداة حرفياً. */
      var cut = dataSql.indexOf('BEGIN;');
      var body = cut >= 0 ? dataSql.slice(cut) : dataSql;
      /* نُزيل التحقّق الصغير في ذيل المولّد — عندنا جدول أعداد أشمل */
      var tailCut = body.lastIndexOf('-- تحقّق');
      if (tailCut > 0) body = body.slice(0, tailCut);
      /* حزام أمان: لا نُدخل `session_replication_role` من هنا أبداً —
         التجهيز الصريح (تعطيل المشغّلات بالمشغّل، واحداً واحداً) في `begin`
         هو المسار المضمون، وهو لا يحتاج superuser. إضافته فوقه تُوهم بأن
         التعطيل قد نجح حين يفشل.

         ⚠️ 2026-11-20: كان `DISABLE TRIGGER ALL` — وهو **يتطلب superuser**
         لأن «ALL» يمسّ مشغّلات القيود الداخلية، ودور postgres في مشاريع
         Supabase الحديثة ليس superuser. فكانت كتلة التعطيل تُهمَل بصمت،
         وكتلة `ENABLE TRIGGER ALL` تُجهض معاملة البيانات كاملة (42501).
         الآن كل مشغّل يُسمّى صراحةً، والمشغّلات الداخلية تبقى فعّالة (أفضل). */
      if (!/DISABLE TRIGGER %I/i.test(body)) {
        throw new Error('كتلة تجهيز المشغّلات غائبة من مولّد SQL — أُوقف البناء');
      }
      void replicaGuard;

      out += "-- ═══════════════════════════════════════════════════════════════════════\n" +
        "--  المرحلة ٢ — البيانات\n" +
        "--  ⚠ يبدأ بـ TRUNCATE: لا تُنفّذه على قاعدة فيها بيانات حقيقية.\n" +
        "--  المشغّلات معطّلة أثناء التحميل (كل مشغّل بالاسم — بلا TRIGGER ALL)\n" +
        "--  ثم تُعاد قبل COMMIT — وهذا ضروري: مشغّلات البطاقات تُنشئ سطور\n" +
        "--  issued_serials والمحاولات بنفسها فتصطدم بصفوفنا.\n" +
        "-- ═══════════════════════════════════════════════════════════════════════\n\n" +
        body + "\n";
    }

    out += countReport();
    return out;
  }

  var api = { build: build, SUMMARY: SUMMARY, countReport: countReport };
  root.HRCFullDump = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
