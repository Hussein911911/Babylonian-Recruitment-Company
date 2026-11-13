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

  /* ═══ صور الوظائف: من رابط خارجي إلى بايتات داخل الملف ═══════════════════
     ⚠ عطل حقيقي: النسخة تحفظ `image_url` فقط. فإن كان الرابط يشير إلى
     مشروع Supabase القديم (`.../storage/v1/object/public/job-images/...`)،
     فمجرّد حذف ذلك المشروع — أو انتهاء صلاحيته — يجعل صور الوظائف مكسورة
     على الموقع الجديد. أي أن «نسخة كاملة» كانت تعتمد على بقاء الشيء الذي
     ننسخ منه.

     الحل: تُنزّل الصور على الجهاز وتُضمَّن في الحمولة كـ`images`:
       { "https://.../hrc-1046.jpg": "data:image/jpeg;base64,...." }
     ثم يُستبدل `image_url` عند توليد SQL بالـdata URL. فيصير الملف
     مكتفياً بذاته: لا شبكة، ولا مشروع قديم، ولا رابط ينكسر.

     ما لا نلمسه: الصور الخارجية (Unsplash مثلاً) تبقى روابطها — هي ليست
     جزءاً من ملكية الشركة، وتضمينها يضخّم الملف بلا فائدة. */

  /** يحوّل رابط صورة إلى data URL — يستدعي fetcher من الخارج (DOM/Node) */
  function imageKey(url) { return String(url || '').trim(); }

  /** يستبدل روابط الصور المضمّنة داخل صفوف الوظائف (لا يغيّر الأصل) */
  function withEmbeddedImages(jobs, images) {
    if (!images || !jobs) return jobs;
    return jobs.map(function (j) {
      if (!j || !j.image_url) return j;
      var data = images[imageKey(j.image_url)];
      if (!data) return j;
      var copy = {};
      for (var k in j) if (Object.prototype.hasOwnProperty.call(j, k)) copy[k] = j[k];
      copy.image_url = data;
      return copy;
    });
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

  /* ═══ ترتيب الإدخال: من لا يعتمد على غيره أولاً ═══════════════════════
     ⚠ عطل حقيقي كشفه ملف المالك (2026-11-13): كان `jobs` قبل `applicants`،
     لكن `jobs.reserved_by` مفتاح أجنبي إلى `applicants.serial`. فأول وظيفة
     محجوزة تُسقط الإدخال كله:

       insert or update on table "jobs" violates foreign key constraint
         "jobs_reserved_by_fkey"

     وبعدها تُرفض كل العبارات التالية لأن المعاملة أُجهضت — فيخرج الموقع
     الجديد بلا وظائف ولا بطاقات ولا فرص، رغم أن الملف «نُفِّذ».

     وعطل ثانٍ كشفه نفس الملف: `applicants.created_by` و`jobs.created_by`
     و`job_attempts.staff_id` مفاتيح أجنبية إلى `brc.staff` — وكانت تُدخل
     **آخر** شيء، فتفشل البطاقات فوراً بـ`applicants_created_by_fkey`.

     الترتيب الصحيح هو عكس ما كان:
       staff (الجذر) → applicants → jobs → job_attempts → الباقي
     لأن كل الجداول الأخرى تشير إلى الحسابات، والبطاقات تشير إليها الوظائف. */
  var TABLES = ['staff', 'applicants', 'jobs', 'job_attempts', 'settings',
    'employer_job_credentials', 'issued_serials', 'card_number_registry',
    'card_number_counter', 'audit_log'];

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
      "SET client_encoding = 'UTF8';\n" +
      /* ═══ لماذا replica mode؟ ═══════════════════════════════════════════════
         جُرّب ملف المالك الحقيقي (2026-11-13) على قاعدة مبنية من المخطط:
         ٦٦٣ بطاقة و٢٢ وظيفة و١٤١١ فرصة — وكلها فشلت، ثم رجعت صفراً.

         السبب ليس الترتيب فقط: `BEGIN` تُحيط كل الملف، فأول خطأ (مفتاح
         أجنبي أو مُشغّل إصدار) يُجهض **المعاملة كلها** وتمحو كل ما دخل.
         فيبدو الملف «نُفِّذ» بينما القاعدة فارغة — أسوأ نتيجة ممكنة.

         `pg_dump` يحلّها بـ`session_replication_role = replica`: تعطيل
         المفاتيح الأجنبية والمشغّلات أثناء التحميل، لأن البيانات قادمة من
         قاعدة صحيحة والتحقق منها أثناء التحميل يرفض حالتها التاريخية.

         ⚠ يحتاج صلاحية superuser — متوفّرة في Supabase SQL Editor، وغير
         متوفّرة في بعض البيئات المقيّدة. لذلك: إن فشل السطر لا يتوقف الملف
         (`DO` يبتلع الخطأ)، وتبقى المفاتيح مفعّلة. */
      'DO $$ BEGIN SET LOCAL session_replication_role = replica;\n' +
      'EXCEPTION WHEN insufficient_privilege OR others THEN NULL; END $$;\n\n' +
      'BEGIN;\n\n' +
      'CREATE SCHEMA IF NOT EXISTS brc;\n\n' +
      '-- إفراغ بنفس ترتيب المفاتيح الأجنبية\n' +
      '-- ⚠ brc.staff ليست هنا بقصد: تفريغها يحذف حساب المدير الذي ينفّذ هذا\n' +
      '--   السكربت، فيفقد الدخول. الحسابات تُضاف بـ ON CONFLICT DO NOTHING.\n' +
      'TRUNCATE brc.job_attempts, brc.applicants, brc.jobs, brc.employer_job_credentials, ' +
      'brc.issued_serials, brc.card_number_registry, brc.audit_log, brc.settings RESTART IDENTITY CASCADE;\n\n';

    /* ═══ عدّاد أرقام البطاقات ═══════════════════════════════════════════
       ⚠ عطل حقيقي: النسخة كانت تحفظ البطاقات ولا تحفظ أرقامها، فالعدّاد
       يبدأ من صفر على المشروع الجديد. أي بطاقة جديدة تأخذ رقماً انطبع
       سابقاً على ورق فعلي — تكرار على وثيقة رسمية.

       العدّاد جدول صف-واحد (`singleton`)، فلا يُدخل كباقي الصفوف: يُضبط
       على أكبر رقم في السجل، أو على أكبر رقم محفوظ، أيهما أعلى.
       `greatest` تحمي حالتين: نسخة قديمة بلا جدول السجل، ونسخة فيها
       أرقام أُلغيت فبقي العدّاد أعلى من كل السجل. */
    var registry = p.card_number_registry || [];
    var maxReg = registry.reduce(function (m, r) {
      var n = Number(r && r.card_number);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    var savedCounter = (p.card_number_counter || []).reduce(function (m, r) {
      var n = Number(r && r.last_number);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    var counterValue = Math.max(maxReg, savedCounter, registry.length ? 1 : 0);

    var body = '';
    TABLES.forEach(function (t) {
      /* staff لها مسار خاص (uuid + ON CONFLICT) — والباقي إدخال مباشر */
      if (t === 'staff') { body += insertStaff(p.staff); return; }
      /* العدّاد يُضبط في النهاية بعد السجل — انظر أدناه */
      if (t === 'card_number_counter') return;
      /* الوظائف: استبدل روابط الصور بالبايتات المضمّنة إن وُجدت */
      if (t === 'jobs') { body += insertRows('jobs', withEmbeddedImages(p.jobs, p.images)); return; }
      body += insertRows(t, p[t]);
    });

    /* بعد إدخال السجل: اضبط العدّاد على أعلى رقم مستخدم */
    if (registry.length || savedCounter) {
      body += '-- ⚠ عدّاد أرقام البطاقات: يبدأ من أعلى رقم مستخدم، لا من صفر.\n' +
        '--   لو تجاهلناه لأخذت أول بطاقة جديدة رقماً مطبوعاً سابقاً.\n' +
        'INSERT INTO brc.card_number_counter (singleton, last_number) VALUES (true, ' +
        counterValue + ')\n' +
        'ON CONFLICT (singleton) DO UPDATE SET last_number = GREATEST(brc.card_number_counter.last_number, EXCLUDED.last_number);\n\n';
    }

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
    withEmbeddedImages: withEmbeddedImages,
    imageKey: imageKey,
    buildSql: buildSql,
    toCsv: toCsv,
    TABLE_ORDER: TABLES.slice()
  };

  root.HRCRestoreSql = api;
  /* تصدير ESM لأداة سطر الأوامر: نفس الكود، بلا نسخة ثانية */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
