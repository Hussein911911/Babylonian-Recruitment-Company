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

  /* ═══ عمود jsonb يحمل نصاً — لا رقم ولا كائن ═════════════════════════════
     ⚠️ عطل حقيقي (2026-11-18) أوقف استرجاع الإنتاج بالكامل:

     `brc.settings.value` عمود **jsonb**، ويسكنه نوعان مختلفان:
       • كائنات — `company`, `rules`, `recovery_retention`, `recovery_schedule`
       • نصّ صريح — `recovery_last_scheduled_at` = `"2026-11-17T20:00:00…"`
         (الترميز: jsonb_typeof = string، لا object)

     `lit()` رأت `typeof v === 'string'` فكتبت `'2026-11-17…'` بلا `::jsonb`.
     وعند الإدخال يتحوّل النص إلى jsonb بـcast ضمني — فيفشل:
         ERROR 22P02: invalid input syntax for type json
     لأن المحرّك يقرأ طابع الزمن كنص JSON مجرّد، لا كنصّ داخل علامتي اقتباس.

     الحلّ: نُعلن مسبقاً أي أعمدة نوعها jsonb، ويُكتب نصّها مُقتبساً داخلياً
     (`'"…"'::jsonb`) — وهو التمثيل الصحيح لقيمة jsonb من نوع string. */
  var JSONB_COLUMNS = {
    settings: ['value'],
    applicants: ['self_application_data'],
    jobs: ['requirements_snapshot']
  };

  function jsonbFix(table, col, v) {
    var list = JSONB_COLUMNS[table];
    return !!(list && list.indexOf(col) >= 0 && typeof v === 'string');
  }

  function lit(v, asJsonbString) {
    if (v === null || v === undefined) return 'NULL';
    if (Array.isArray(v)) return arrayLit(v);
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
    var s = String(v).replace(/'/g, "''");
    /* نصّ داخل عمود jsonb = قيمة JSON من نوع string: تُحاط بعلامتي اقتباس */
    if (asJsonbString) return "'" + '"' + s + '"' + "'::jsonb";
    return "'" + s + "'";
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

  /* ═══ أعمدة NOT NULL لا تُصدَّر (سرّية) — تُملأ عند الاسترجاع ══════════
     ⚠️ عطل حقيقي أُصلح 2026-11-15، اكتُشف بدورة كاملة (تصدير → تشفير → فك
     → استرجاع على قاعدة فاضية):

       brc.recovery_chances.code_hash  و  brc.recovery_prints.code_hash
       عمودان NOT NULL يحملان بصمة رمز سرّية. فلا يجوز تصديرهما، ولا يجوز
       تركهما فارغين — والنتيجة كانت فشل الاسترجاع كله على أول صفّ:
         ERROR 23502: null value in column "code_hash"

       ولا بديل عن قيمة: القاعدة ترفض NULL. فتُكتب بصمة حتمية **غير سرّية**
       مشتقّة من الرقم التسلسلي — دورها الوحيد أن تمنع تكرار الصفّ، ولا
       يتحقق منها أي مسار في الموقع (التحقق يحتاج الرمز الأصلي وهو غير منقول).
       أي أن قيمتها هنا **شكلية لكن ضرورية**، والتوثيق يقول ذلك بصراحة. */
  /* ⚠️ تُبنى **في JavaScript** لا في SQL: القيمة تُكتب حرفياً في الملف.
     المحاولة الأولى كتبت تعبير SQL (`'x' || r.serial`) فخرج في الملف نصّ
     يشير إلى عمود `r` غير موجود → 42P01 عند التنفيذ. */
  function derivedCodeHash(table, r) {
    if (table === 'recovery_chances') return 'restored:' + r.serial + ':' + r.attempt_no;
    if (table === 'recovery_prints') return 'restored:' + r.serial;
    return 'restored';
  }

  var DERIVED = { recovery_chances: ['code_hash'], recovery_prints: ['code_hash'] };

  function insertRows(table, rows, allow) {
    if (!rows || !rows.length) return '';
    var derived = DERIVED[table];
    if (derived) {
      /* نضمن وجود الأعمدة المشتقّة حتى لو لم تأت في النسخة (نسخة v1/v2) */
      rows = rows.map(function (r) {
        var out = Object.assign({}, r);
        derived.forEach(function (k) { if (out[k] == null) out[k] = '__DERIVED__'; });
        return out;
      });
    }
    var cols = columnsOf(rows, allow);
    if (!cols.length) return '-- ⚠ ' + table + ': لا أعمدة صالحة — تم تخطّي ' + rows.length + ' صفاً\n\n';
    var values = rows.map(function (r) {
      return '  (' + cols.map(function (c) {
        if (derived && derived.indexOf(c) >= 0 && r[c] === '__DERIVED__') return lit(derivedCodeHash(table, r));
        return lit(r[c], jsonbFix(table, c, r[c]));
      }).join(', ') + ')';
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
  /* ═══ ترتيب الإدخال — يحترم المفاتيح الأجنبية ═══════════════════════════
     ⚠️ إضافة 2026-11-15: كان التصدير والاسترجاع يتجاهلان أربعة جداول حقيقية
     (ليست ذاكرة مؤقتة) فيُفقد محتواها بصمت عند الاسترجاع على مشروع جديد:

       • recovery_chances — هل استُهلكت الفرصة وبصمة رمزها. بدونها تصبح كل
         الفرص «غير مستهلكة» بعد الاسترجاع، فيُعيد حامل البطاقة استخدام فرصة
         استهلكها. خطأ مالي مباشر: البطاقة تمنح فرصتين.
       • recovery_prints  — هل طُبعت البطاقة. بدونها يمكن طباعة بطاقة ثانية.
       • office_receipts  — سجل عمليات المكتب. بدونه تتكرر عمليات البيع.
       • card_issue_requests — طلبات الإصدار.

     ⚠️ ولا نضيف عمداً: card_security_attempts · card_lookup_budget ·
     employer_login_budget · employer_otp — نوافذ حظر مؤقتة، ونسخها يُقفل
     مستخدمين أبرياء على المشروع الجديد. ولا recovery_tickets/recovery_copies
     (رموز استرجاع حيّة ولقطات سابقة → تسريب وتضخيم بلا فائدة). */
  var TABLES = ['staff', 'applicants', 'jobs', 'job_attempts', 'settings',
    'employer_job_credentials', 'issued_serials', 'card_number_registry',
    'card_number_counter', 'audit_log', 'card_issue_requests',
    'recovery_chances', 'recovery_prints', 'office_receipts'];

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
      /* ⚠️ شبكة أمان ثانية (2026-11-18): في مشروع Supabase جديد قد لا تعمل
         `session_replication_role` (تحتاج superuser)، وحينها تُدخل كل بطاقة
         في `applicants` مشغّل `trg_applicants_attempts` فيُنشئ فرصها فوراً.
         ثم يصل الإدخال الصريح لـ job_attempts فيصطدم بـ
         `duplicate key value violates unique constraint`. أوقفنا المشغّلات
         صراحةً — وهذا ما يفعله pg_dump. لا يُفشل الملف إن مُنع: المشغّل
         يُترك مفعّلاً، ويكفي بعدها أن تعيد ترتيب الإدخال.
         وكذلك `trg_audit_*` تضيف صفوف تدقيق برقم تسلسلي، فتصطدم بـ audit_log
         الصريح. تعطيلها أثناء التحميل هو الصواب. */
      /* ⚠️ كتلة تجهيز — أُضيفت 2026-11-18 بعد فحص ملف إنتاج حقيقي أوقفه
         خطأ duplicate key ثلاث مرات. السبب: مشغّلات الهيكل تُنشئ صفوفاً
         (فرص، أرقام بطاقات، تدقيق) فتصطدم بالإدخال الصريح، وترتيب الإدخال
         ليس ترتيب تبعية (job_attempts قبل applicants). pg_dump يحلّها
         بـ session_replication_role — وهو غير مضمون على Supabase.
         الحل هنا لا يعتمد على صلاحيات: تعطيل صريح لكل مشغّلات brc
         (بيانات وفواصل أجنبية) ثم تفريغ جداول البيانات. تُعاد في النهاية. */
      'BEGIN;\n\n' +
      'CREATE SCHEMA IF NOT EXISTS brc;\n\n' +
      /* ═══ كتلة التجهيز — داخل المعاملة، قبل أول صف بيانات ═══════════════
         ⚠️ عطل حقيقي في ملف إنتاج (2026-11-18) أوقفه `duplicate key` ثلاث
         مرات. السبب مزدوج:
           (١) مشغّلات الهيكل تُنشئ صفوفاً من تلقاء نفسها: إدخال بطاقة في
               `applicants` يُنشئ فرصها في `job_attempts`، ومشغّل التدقيق
               يُدرج في `audit_log` برقم تسلسلي — فتصطدم بالإدخال الصريح.
           (٢) ترتيب الإدخال ليس ترتيب تبعية: `job_attempts` يأتي قبل
               `applicants`، و`employer_job_credentials` قبل `jobs` — فتفشل
               الفواصل الأجنبية.
         `session_replication_role = replica` تحلّها لكنها تحتاج superuser
         وغير مضمونة على Supabase. البديل المضمون: تعطيل صريح لكل مشغّل
         في `brc`، **بالاسم** — لا `… TRIGGER ALL` ولا USER:
           • `ALL` يمسّ مشغّلات القيود الداخلية ⇒ يحتاج superuser، ودور
             `postgres` في مشاريع Supabase الحديثة **ليس** superuser. كانت
             كتلة التعطيل تُهمَل بصمت (ملفوفة بـ`EXCEPTION … NULL`)، ثم
             تُجهض كتلة الإعادة معاملة البيانات كلها بـ42501 — وهو سبب
             فشل الملف المُنزَّل من صفحة النسخ الاحتياطي عند العبارة 397.
           • USER يُبقي مشغّلات فحص الفواصل الأجنبية فعّالة فتظل المشكلة (٢).
         التفريغ ديناميكي من الكتالوج: كتابة أسماء جداول صريحة كانت تُفشل
         الملف كله على أي مخطط ناقص بـ `relation … does not exist`.
         `staff` مستثناة بقصد: تفريغها يحذف حساب المدير فيفقد الدخول.
         تُعاد كلها قبل COMMIT في `tail` — وإلا بقي التدقيق وإصدار الأرقام
         معطّلاً إلى الأبد على قاعدة الإنتاج. */
      'DO $$ DECLARE t record; BEGIN\n' +
      "  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace\n" +
      "            WHERE n.nspname = 'brc' AND c.relkind = 'r' AND c.relname <> 'staff' LOOP\n" +
      "    EXECUTE format('TRUNCATE brc.%I RESTART IDENTITY CASCADE', t.relname);\n" +
      '  END LOOP;\n' +
      'END $$;\n\n' +
      'DO $$ DECLARE t record; BEGIN\n' +
      "  FOR t IN SELECT c.relname AS tbl, g.tgname AS trg\n" +
      "             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace\n" +
      "             JOIN pg_trigger g ON g.tgrelid = c.oid AND NOT g.tgisinternal\n" +
      "            WHERE n.nspname = 'brc' AND c.relkind = 'r' LOOP\n" +
      "    EXECUTE format('ALTER TABLE brc.%I DISABLE TRIGGER %I', t.tbl, t.trg);\n" +
      '  END LOOP;\n' +
      'EXCEPTION WHEN insufficient_privilege OR others THEN NULL; END $$;\n\n';

    /* ═══ عدّاد أرقام البطاقات ═══════════════════════════════════════════
       ⚠ عطل حقيقي: النسخة كانت تحفظ البطاقات ولا تحفظ أرقامها، فالعدّاد
       يبدأ من صفر على المشروع الجديد. أي بطاقة جديدة تأخذ رقماً انطبع
       سابقاً على ورق فعلي — تكرار على وثيقة رسمية.

       العدّاد جدول صف-واحد (`singleton`)، فلا يُدخل كباقي الصفوف: يُضبط
       على أكبر رقم في السجل، أو على أكبر رقم محفوظ، أيهما أعلى.
       `greatest` تحمي حالتين: نسخة قديمة بلا جدول السجل، ونسخة فيها
       أرقام أُلغيت فبقي العدّاد أعلى من كل السجل. */
    /* ⚠️ 2026-11-18 — عطل حقيقي في الإنتاج، ليس في هذا الملف:
       `recovery_export_v2` (النسخة المطبَّقة الوحيدة) **لا تصدّر**
       card_number_registry إطلاقاً، ولا v3 مطبَّقة. فالحمولة تصل بلا سجل
       الأرقام، والعدّاد يهبط إلى صفر — أي أن أول بطاقة بعد الاسترجاع
       تحمل رقماً انطبع سابقاً على ورق رسمي.

       لا يمكن اختراع الأرقام. لكن يمكن اشتقاق حدّ أدنى صحيح منها:
       أكبر رقم ظهر فعلاً في `serial` أو في `card_print_code` أو في سجل
       المحاولات. العدّاد لا ينخفض عن ذلك أبداً — وهذا يمنع التكرار حتى
       لو غاب السجل الحقيقي.

       الاشتقاق هنا من الحمولة وحدها (لا نستدعي دالة في القاعدة: الملف
       يجب أن يعمل على قاعدة جديدة لم تُهاجَر). وحين تُطبَّق v4 يصبح
       السجل كاملاً و`card_number_floor` صريحاً، فيغلب على الاشتقاق. */
    var registry = p.card_number_registry || [];
    var maxReg = registry.reduce(function (m, r) {
      var n = Number(r && r.card_number);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    var savedCounter = (p.card_number_counter || []).reduce(function (m, r) {
      var n = Number(r && r.last_number);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    var derived = Number(p.card_number_floor || 0);
    /* ⚠️ الحدّ الأخير — والحالة الواقعية اليوم: v2 المطبَّقة لا تصدّر السجل
       ولا العدّاد، فأرقام البطاقات الـ175 المطبوعة **غير موجودة في النسخة
       إطلاقاً**. ولا يمكن اشتقاقها: `serial` عشوائي (‎'2272MECVFZ') وليس
       رقماً متسلسلاً، والرقم يُسنَد من العدّاد وحده عند الإدخال.
       إذن أي محاولة «اشتقاق دقيق» وهم. البديل الصادق: حدّ أعلى آمن.
       نأخذ أكبر عدد ممكن من البطاقات التي مرّت بالنظام — عدد السيريالات
       المُصدَرة وعدد البطاقات — كأرضية. النتيجة تجاوز (يقفز الترقيم من
       175 إلى 726 مثلاً) بدل تكرار رقم على وثيقة رسمية. التجاوز مرئي
       وغير ضار؛ التكرار كارثة. ويُصلح جذرياً بتطبيق v4 التي تصدّر
       `card_number_floor` الصريح. */
    /* لكنه لا يُطبَّق إلا حين لا توجد أي بيانات حقيقية. لو طُبِّق دائماً
       لأفسد الحالة السليمة: مشروع فيه ٧٢٥ بطاقة و٥ أرقام مسجّلة يقفز
       عدّاده إلى ٧٢٥ بلا سبب. البيانات الحقيقية تُقدَّم دائماً. */
    var hasReal = !!(registry.length || savedCounter || derived);
    var safeFloor = hasReal ? 0 : Math.max(
      (p.issued_serials || []).length,
      (p.applicants || []).length
    );
    var counterValue = Math.max(maxReg, savedCounter, registry.length ? 1 : 0, derived, safeFloor);

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

    /* بعد إدخال السجل: اضبط العدّاد على أعلى رقم مستخدم.
       ⚠️ 2026-11-18 — شرط `registry.length || savedCounter` كان يترك
       العدّاد **بلا ضبط إطلاقاً** حين لا تحمل الحمولة السجل ولا العدّاد —
       وهي حالة الإنتاج اليوم بالضبط (v2 المطبَّقة لا تصدّر أياً منهما).
       النتيجة: العدّاد يبقى على قيمته الافتراضية، وأول بطاقة بعد الاسترجاع
       تأخذ رقماً موجوداً على ورق. نضبطه دائماً، و`EXCLUDED` مع GREATEST
       تجعل ذلك آمناً حتى لو كان أعلى من اللازم. */
    if (!hasReal) {
      body += '-- ═══════════════════════════════════════════════════════════════\n' +
        '--  ⚠⚠ تحذير: النسخة لا تحمل سجل أرقام البطاقات ولا العدّاد.\n' +
        '--  أرقام البطاقات المطبوعة على ورق رسمي غير معروفة لهذا الملف.\n' +
        '--  ضبطنا العدّاد على ' + counterValue + ' (حدّ أعلى آمن) كي لا تتكرّر\n' +
        '--  الأرقام. الترقيم سيقفز، وهذا مقبول؛ التكرار ليس مقبولاً.\n' +
        '--  الإصلاح الجذري: طبّق الهجرة portable_backup_v4_registry.\n' +
        '-- ═══════════════════════════════════════════════════════════════\n';
    }
    body += '-- ⚠ عدّاد أرقام البطاقات: لا يبدأ من صفر أبداً.\n' +
      '--   اشتُقّ من أكبر رقم ظاهر في الحمولة (سجل الأرقام، أو العدّاد\n' +
      '--   المحفوظ، أو card_number_floor من v4). لو بدأ من صفر لأخذت أول\n' +
      '--   بطاقة جديدة رقماً انطبع سابقاً على وثيقة رسمية.\n' +
      'INSERT INTO brc.card_number_counter (singleton, last_number) VALUES (true, ' +
      counterValue + ')\n' +
      'ON CONFLICT (singleton) DO UPDATE SET last_number = GREATEST(brc.card_number_counter.last_number, EXCLUDED.last_number);\n\n';

    /* ⛔ إعادة تفعيل المشغّلات — ليس تكميلاً بل شرط سلامة.
       عطّلناها في `head` ليمرّ التحميل. لو خرج الملف بلا هذه الكتلة،
       تبقى قاعدة المشروع الجديد **بلا مشغّلات**: لا تدقيق (trg_audit_*)،
       ولا إسناد رقم بطاقة (trg_assign_card_number)، ولا فرص تلقائية.
       أي أن الموقع يعمل ويبدو سليماً، ثم يمنح بطاقة بلا فرص وبلا سجل —
       والعطل لا يظهر إلا بعد أسابيع. لهذا تُعاد هنا، داخل نفس المعاملة،
       فإما تُكتب البيانات وتُعاد المشغّلات معاً، أو لا شيء. */
    var reenable = '\n-- إعادة تفعيل المشغّلات التي أُوقفت أثناء التحميل\n' +
      'DO $$ DECLARE t record; BEGIN\n' +
      "  FOR t IN SELECT c.relname AS tbl, g.tgname AS trg\n" +
      "             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace\n" +
      "             JOIN pg_trigger g ON g.tgrelid = c.oid AND NOT g.tgisinternal\n" +
      "            WHERE n.nspname = 'brc' AND c.relkind = 'r' AND g.tgenabled <> 'O' LOOP\n" +
      "    EXECUTE format('ALTER TABLE brc.%I ENABLE TRIGGER %I', t.tbl, t.trg);\n" +
      '  END LOOP;\n' +
      'END $$;\n\n';

    var tail = reenable + '\n-- إعادة ضبط التسلسلات بعد الإدخال بأرقام صريحة\n' +
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
