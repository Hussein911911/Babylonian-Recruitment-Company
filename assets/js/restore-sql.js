/* ═══════════════════════════════════════════════════════════════════════════
   HRC — مولّد SQL للاسترجاع (وحدة مشتركة)
   ---------------------------------------------------------------------------
   ⚠ لماذا وحدة مشتركة ولماذا ملف واحد؟

   كانت أداة الاسترجاع في `tools/restore-portable.mjs` تحمل نسخة من هذا
   المنطق، وأي وظيفة جديدة تحتاجه (كصفحة الاسترجاع في المتصفح) كانت ستنسخه.
   ونسختان من منطق واحد تتفرّعان بصمت — وقد حدث ذلك بالفعل: قائمة أعمدة
   يدوية تقادمت وأسقطت `card_print_code` و`archived_at` و`employer_decision`،
   فكان الاسترجاع يفشل أو يُنقص بيانات أمنية بلا تحذير.

   الحل: هذا الملف هو المصدر الوحيد. يُحمَّل مباشرة في المتصفح
   (`<script src>`)، ويستورده `tools/restore-portable.mjs` عبر
   `import('./x.js')` — نفس الكود بالحرف في البيئتين.

   لا يعتمد على DOM ولا على Node: دوال نقية فقط. لذلك يصلح للاثنين.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var IDENT = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };

  /* ═══ تمثيل القيم ═══════════════════════════════════════════════════════
     ⚠ عطل حقيقي وجده الفحص على قاعدة PGlite:
     المصفوفة كانت تُرسل كـ `'[...]'::jsonb`، فترفضها القاعدة:
     «column "filled_vacancy_numbers" is of type integer[] but expression
      is of type jsonb»
     فتسقط عملية الاسترجاع كلها. المصفوفات الآن بصيغة PostgreSQL الحقيقية:
     `{1,2}` أو `{"نص"}` — بلا ::jsonb. */

  function arrayLit(arr) {
    var parts = arr.map(function (x) {
      if (x === null || x === undefined) return 'NULL';
      if (typeof x === 'number') return String(x);
      if (typeof x === 'boolean') return x ? 'true' : 'false';
      /* العناصر النصية تُحاط بتنصيص دائماً، ونُهرّب \ و " */
      var t = String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return '"' + t + '"';
    });
    return "'{" + parts.join(',') + "}'";
  }

  function lit(v) {
    if (v === null || v === undefined) return 'NULL';
    if (Array.isArray(v)) return arrayLit(v);
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  /* ═══ اختيار الأعمدة: من الصف نفسه، لا قائمة يدوية ═══════════════════════
     كانت قائمة مكتوبة يدوياً لكل جدول، وتقادمت بصمت:
       أعمدة ترسل ولا وجود لها  → SQL يفشل
       أعمدة موجودة ولا تُرسل   → بيانات ناقصة بلا تحذير
     الآن نأخذ مفاتيح الصف الفعلية، ونرشّحها بأسماء صالحة فقط. */
  var SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

  function columnsOf(rows, allow) {
    var seen = Object.create(null);
    (rows || []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      Object.keys(r).forEach(function (k) { if (SAFE_IDENT.test(k)) seen[k] = true; });
    });
    var cols = Object.keys(seen);
    if (allow && allow.length) cols = cols.filter(function (c) { return allow.indexOf(c) >= 0; });
    /* ترتيب ثابت كي يكون الناتج قابلاً للمقارنة بين تشغيلين */
    return cols.sort();
  }

  function insertRows(table, rows, allow) {
    if (!rows || !rows.length) return '';
    var cols = columnsOf(rows, allow);
    if (!cols.length) return '-- ⚠ ' + table + ': لا أعمدة صالحة — تم تخطّي ' + rows.length + ' صفاً\n\n';
    var values = rows.map(function (r) {
      return '  (' + cols.map(function (c) { return lit(r[c]); }).join(', ') + ')';
    }).join(',\n');
    return '-- ' + rows.length + ' صفاً في ' + table + ' (' + cols.length + ' عموداً)\n' +
      'INSERT INTO brc.' + IDENT(table) + ' (' + cols.map(IDENT).join(', ') + ')\nVALUES\n' +
      values + ';\n\n';
  }

  /* ═══ الحسابات: قائمة فقط، بلا كلمات مرور ═══════════════════════════════
     ⚠ عطل حقيقي وجده فحص PGlite: `staff` كانت تُصدَّر في النسخة ولا تُسترجع
     أبداً — فموقع جديد يُبنى من النسخة يخرج **بلا مستخدمين** (لا مدير، لا
     موظفين، لا أسماء في سجل التدقيق).

     لكن نقلها ليس إدخالاً عادياً:
       • `staff.id` من نوع uuid (لا serial) → يُترك للقاعدة
       • `staff.auth_id` يشير إلى `auth.users` في المشروع القديم — لا وجود
         له في الجديد، وإدخاله يكسر المفتاح الأجنبي
       • كلمات المرور نفسها في `auth.users` ولا تُصدَّر أصلاً (وهذا صحيح أمنياً)

     فالنقل هنا: صفوف الدليل (اسم، دور، هاتف، نشاط) تُضاف، والربط بالمصادقة
     يعيد المالك إنشاءه. و`ON CONFLICT (username) DO NOTHING` كي لا نطمس
     حساب المدير الذي أنشأه المالك على المشروع الجديد — وإلا فقد الدخول. */
  var STAFF_SKIP = ['auth_id'];

  function insertStaff(rows) {
    if (!rows || !rows.length) return '';
    var cols = columnsOf(rows, null).filter(function (c) { return STAFF_SKIP.indexOf(c) < 0; });
    if (!cols.length) return '';
    var values = rows.map(function (r) {
      return '  (' + cols.map(function (c) { return lit(r[c]); }).join(', ') + ')';
    }).join(',\n');
    return '-- ' + rows.length + ' حساباً في brc.staff (بلا كلمات مرور — تُنشأ في Authentication)\n' +
      '-- ON CONFLICT: لا نطمس حساباً موجوداً على المشروع الجديد\n' +
      'INSERT INTO brc."staff" (' + cols.map(IDENT).join(', ') + ')\nVALUES\n' +
      values + '\nON CONFLICT ("username") DO NOTHING;\n\n';
  }

  /* ترتيب الإدخال: الأب قبل الابن، كي لا تُنتهك المفاتيح الأجنبية */
  var TABLES = ['jobs', 'applicants', 'job_attempts', 'settings',
    'employer_job_credentials', 'issued_serials', 'audit_log', 'staff'];

  function buildSql(p) {
    p = p || {};
    var counts = JSON.stringify(p.counts || {});
    var head = '-- ═══════════════════════════════════════════════════════════════════════════\n' +
      '--  HRC — استرجاع نسخة محمولة\n' +
      '--  أُنشئت في : ' + (p.exportedAt || '—') + '\n' +
      '--  البصمة    : ' + (p.schema || '—') + '\n' +
      '--  الأعداد   : ' + counts + '\n' +
      '--\n' +
      '--  ⚠ لا تُشغّل هذا الملف على قاعدة فيها بيانات — يبدأ بـ TRUNCATE.\n' +
      '--  ⚠ استرجعه على قاعدة جديدة أولاً، وتحقّق من الأعداد قبل نقلها للإنتاج.\n' +
      '--  ⚠ يجب أن يكون مخطط brc منشأً قبل التنفيذ (docs/schema.sql أو الهجرات).\n' +
      '-- ═══════════════════════════════════════════════════════════════════════════\n\n' +
      "SET client_encoding = 'UTF8';\nBEGIN;\n\n" +
      'CREATE SCHEMA IF NOT EXISTS brc;\n\n' +
      '-- إفراغ بنفس ترتيب المفاتيح الأجنبية\n' +
      '-- ⚠ brc.staff ليست هنا بقصد: تفريغها يحذف حساب المدير الذي ينفّذ هذا\n' +
      '--   السكربت، فيفقد الدخول. الحسابات تُضاف بـ ON CONFLICT DO NOTHING.\n' +
      'TRUNCATE brc.job_attempts, brc.applicants, brc.jobs, brc.employer_job_credentials, ' +
      'brc.issued_serials, brc.audit_log, brc.settings RESTART IDENTITY CASCADE;\n\n';

    var body = '';
    TABLES.forEach(function (t) {
      /* staff لها مسار خاص (uuid + ON CONFLICT) — والباقي إدخال مباشر */
      body += (t === 'staff') ? insertStaff(p.staff) : insertRows(t, p[t]);
    });

    var tail = '\n-- إعادة ضبط التسلسلات بعد الإدخال بأرقام صريحة\n' +
      "SELECT setval(pg_get_serial_sequence('brc.audit_log', 'id'),\n" +
      '              COALESCE((SELECT MAX(id) FROM brc.audit_log), 1), true);\n\n' +
      'COMMIT;\n\n' +
      '-- تحقّق\n' +
      "SELECT 'jobs' AS tbl, count(*) FROM brc.jobs\n" +
      "UNION ALL SELECT 'applicants', count(*) FROM brc.applicants\n" +
      "UNION ALL SELECT 'job_attempts', count(*) FROM brc.job_attempts\n" +
      "UNION ALL SELECT 'audit_log', count(*) FROM brc.audit_log\n" +
      "UNION ALL SELECT 'issued_serials', count(*) FROM brc.issued_serials\n" +
      "UNION ALL SELECT 'staff', count(*) FROM brc.staff\n" +
      'ORDER BY tbl;\n';

    return head + body + tail;
  }

  /* ═══ CSV لكل جدول — لبرنامج الجداول ═══════════════════════════════════ */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    /* الخلايا التي فيها فاصلة أو تنصيص أو سطر جديد تُحاط بتنصيص */
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    if (!rows || !rows.length) return '\ufeff';
    var cols = columnsOf(rows, null);
    var lines = [cols.join(',')];
    rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvCell(r[c]); }).join(',')); });
    /* BOM كي يقرأ Excel العربية بشكل صحيح */
    return '\ufeff' + lines.join('\r\n');
  }

  var api = {
    IDENT: IDENT,
    arrayLit: arrayLit,
    lit: lit,
    columnsOf: columnsOf,
    insertRows: insertRows,
    insertStaff: insertStaff,
    buildSql: buildSql,
    toCsv: toCsv,
    TABLE_ORDER: TABLES.slice()
  };

  root.HRCRestoreSql = api;
  /* تصدير ESM لأداة سطر الأوامر: نفس الكود، بلا نسخة ثانية */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
