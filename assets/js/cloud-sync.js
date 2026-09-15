/* ===========================================================================
 *  BRC — طبقة الكتابة والمزامنة مع Supabase (BRCSync)
 *  ---------------------------------------------------------------------------
 *  لماذا «فرق» (diff) بدل تعديل كل دالة كتابة؟
 *    في store.js أكثر من 15 عملية كتابة (وظائف، استمارات، محاولات، إعدادات،
 *    تدقيق…). لو عدّلنا كل واحدة على حدة لأصبح عندنا 15 موضعاً يمكن أن يُنسى
 *    فيه الدفع للسحابة — وخطأ من هذا النوع يعني بيانات لا تُحفظ بصمت.
 *    البديل: نحتفظ بلقطة (snapshot) لآخر حالة معروفة في القاعدة، وبعد كل عملية
 *    كتابة نقارن الحالة الحالية باللقطة ونشتقّ العمليات المطلوبة. موضع واحد
 *    فقط مسؤول عن المزامنة — فالسلوك موحّد وقابل للاختبار.
 *
 *  الترتيب مهم عند الدفع: الإدراج/التعديل قبل الحذف، لأن الحذف قد يفشل بسبب
 *  قيود المفاتيح الأجنبية إن حُذف الأب قبل الأبناء.
 *
 *  قائمة انتظار أوفلاين: إذا انقطع الاتصال تُحفظ العمليات وتُدفع لاحقاً.
 *  الاختبار بعميل وهمي: tests/cloud-sync.mjs
 * =========================================================================== */
(function (root) {
  'use strict';

  var QUEUE_KEY = 'brc-cloud-queue';

  /* المفتاح الطبيعي لكل جدول — عليه تُبنى المقارنة */
  var KEYS = {
    jobs: function (x) { return x.code; },
    applicants: function (x) { return x.serial; },
    job_attempts: function (x) { return String(x.serial) + ':' + String(x.no); },
    settings: function (x) { return x.key; },
    audit_log: function (x) { return x.id; },
    staff: function (x) { return x.id; }
  };

  /* التطبيع: نُسقط الحقول المحلية/المشتقّة التي لا وجود لها في SQL حتى لا
     تُنتج فروقاً وهمية تُطلق عمليات تعديل بلا داعٍ في كل مرة. */
  function normJobs(j) {
    return JSON.stringify([j.code, j.title, j.category, j.region, j.salaryMin, j.salaryMax,
      j.shift, j.gender, j.vacancies, j.requirements, j.description,
      j.employer && j.employer.name, j.employer && j.employer.phone, j.employer && j.employer.address,
      j.interviewLocation, j.status, j.reservedBy, j.holdExpiresAt, j.closedAt, j.notes, j.imageUrl]);
  }
  /* ⚠️ كل حقل يمكن أن يتغيّر في الواجهة يجب أن يكون هنا، وإلا فلا تُشتقّ له
     عملية أصلاً فيبقى التغيير في الذاكرة وحدها (يظهر للموظف ولا يُحفظ).
     أُضيفت: issueDate/expiryDate (قبول طلب إلكتروني يولّد صلاحية جديدة)،
     attemptLimit، rejectReason (سبب الرفض يظهر للباحث في صفحة التحقق). */
  function normApplicants(a) {
    return JSON.stringify([a.serial, a.fullName, a.phone, a.address, a.dob, a.gender,
      a.nationality, a.status, a.fee, a.feePaid, a.printedCount, a.notes, a.requestedCode,
      a.issueDate, a.expiryDate, a.attemptLimit, a.rejectReason]);
  }
  function normAttempts(t) {
    return JSON.stringify([t.serial, t.no, t.jobCode, t.slotStatus, t.selectedAt,
      t.holdExpiresAt, t.closedAt, t.note]);
  }
  function normAudit(l) {
    return JSON.stringify([l.user, l.role, l.ip, l.action, l.entity, l.entityId, l.details]);
  }
  function normSettings(k, v) {
    return JSON.stringify([k, v]);
  }

  var NORMS = {
    jobs: normJobs, applicants: normApplicants, job_attempts: normAttempts,
    audit_log: normAudit
  };

  /* ---------------------- بناء خرائط المقارنة من db المحلي ---------------------- */
  function snapshotOf(db) {
    var snap = { jobs: {}, applicants: {}, job_attempts: {}, audit_log: {}, settings: {}, staff: {} };

    (db.jobs || []).forEach(function (j) { if (j.code) snap.jobs[j.code] = normJobs(j); });
    (db.applicants || []).forEach(function (a) { if (a.serial) snap.applicants[a.serial] = normApplicants(a); });
    (db.attempts || []).forEach(function (t) {
      if (t.serial && t.no != null) snap.job_attempts[t.serial + ':' + t.no] = normAttempts(t);
    });
    (db.audit || []).forEach(function (l) { if (l.id != null) snap.audit_log[l.id] = normAudit(l); });

    /* الإعدادات: نفس تمثيل صفوف key/value في القاعدة */
    /* نستخدم نفس تحويل الكتابة حتى تكون المقارنة على نفس التمثيل تماماً —
       أي اختلاف في التحويل هنا يعني «فرقاً وهمياً» يُطلق عملية على كل حفظ. */
    var rules = root.BRCCloud.settingsToDb((db.settings || {}));
    snap.settings.rules = normSettings('rules', rules);
    if (db.settings && db.settings.company) snap.settings.company = normSettings('company', db.settings.company);

    (db.staff || []).forEach(function (s) { if (s.id) snap.staff[s.id] = JSON.stringify([s.username, s.role, s.active]); });
    return snap;
  }

  /* ============================================================================
   *  اشتقاق العمليات من الفرق بين اللقطة والحالة الحالية
   *  يُرجع: [{ table, op: 'insert'|'update'|'delete', key, row }]
   * ========================================================================== */
  function diff(snapshot, db) {
    var current = snapshotOf(db);
    var ops = [];

    /* الجداول المعتادة: المفتاح الطبيعي يحدّد الإدراج/التعديل/الحذف */
    [
      { table: 'jobs', key: function (x) { return x.code; }, conv: function (x) { return root.BRCCloud.jobToDb(x); } },
      { table: 'applicants', key: function (x) { return x.serial; }, conv: function (x) { return root.BRCCloud.applicantToDb(x); } },
      { table: 'job_attempts', key: function (x) { return x.serial + ':' + x.no; }, conv: function (x) { return root.BRCCloud.attemptToDb(x); } }
    ].forEach(function (spec) {
      var list = spec.table === 'jobs' ? (db.jobs || [])
        : spec.table === 'applicants' ? (db.applicants || []) : (db.attempts || []);
      var seen = {};
      list.forEach(function (item) {
        var k = spec.key(item);
        /* صف بلا مفتاح طبيعي كامل لا يمكن دفعُه (لا مفتاح للربط ولا للإدراج).
           نرفض أي مفتاح يحوي null/undefined في أي جزء منه. */
        if (k == null || k === '' || /(^|:)(null|undefined)($|:)/.test(String(k))) return;
        seen[k] = true;
        if (!(k in snapshot[spec.table])) ops.push({ table: spec.table, op: 'insert', key: k, local: item });
        else if (current[spec.table][k] !== snapshot[spec.table][k]) ops.push({ table: spec.table, op: 'update', key: k, local: item });
      });
      Object.keys(snapshot[spec.table]).forEach(function (k) {
        if (!seen[k]) ops.push({ table: spec.table, op: 'delete', key: k });
      });
    });

    /* سجل التدقيق: إضافة فقط. السجل غير قابل للتعديل أو الحذف في القاعدة
       (سياسات audit_no_update / audit_no_delete)، فلا نُولّد له تحديثاً ولا حذفاً
       وأي فرق فيه يُهمَل عمداً بدل إرسال عملية سترفضها القاعدة. */
    (db.audit || []).forEach(function (l) {
      if (l.id == null) return;
      if (!(l.id in snapshot.audit_log)) ops.push({ table: 'audit_log', op: 'insert', key: l.id, local: l });
    });

    /* الإعدادات: صفّان فقط (rules و company).
       ⚠️ القيم تُحوَّل إلى مفاتيح SQL (attempt_limit …) عبر settingsToDb.
       إرسالها camelCase كان يكتب jsonb بشكل لا تقرأه settingsFromDb، فتُفقد
       قواعد العمل بصمت (تُحفظ لكن لا تُقرأ أبداً). */
    if (db.settings) {
      var rules = root.BRCCloud.settingsToDb(db.settings);
      if (Object.keys(rules).length && current.settings.rules !== snapshot.settings.rules) {
        ops.push({ table: 'settings', op: 'update', key: 'rules', local: { key: 'rules', value: rules } });
      }
      if (db.settings.company && current.settings.company !== snapshot.settings.company) {
        ops.push({ table: 'settings', op: 'update', key: 'company', local: { key: 'company', value: db.settings.company } });
      }
    }

    /* الموظفون: تُدار من Supabase Auth/لوحة التحكم لا من الواجهة — لا ندفعها */

    /* الترتيب: إدراج وتعديل قبل حذف (تفادياً لانتهاك المفاتيح الأجنبية) */
    var rank = { insert: 0, update: 1, delete: 2 };
    ops.sort(function (a, b) { return rank[a.op] - rank[b.op]; });
    return ops;
  }

  /* ============================================================================
   *  تقديم اللقطة **عمليةً عمليةً**
   *  ---------------------------------------------------------------------------
   *  لماذا لا نُقدّم اللقطة كاملة بعد كل دفع؟
   *  لأن الدفع ليس معاملة واحدة: قد تنجح ثلاث عمليات وتفشل الرابعة. تقديم
   *  اللقطة كاملة يعني وسم العملية الفاشلة كـ«مُزامَنة» — فلا تُعاد أبداً،
   *  ويختلف ما يراه الموظف عمّا في القاعدة **بصمت**. لذلك نُسجّل نجاح ما نجح
   *  فقط، وتبقى الفاشلة معلّقة حتى الدفع التالي.
   * ========================================================================== */
  function advanceSnapshot(snapshot, op) {
    var t = op.table;
    if (!snapshot[t]) return;
    if (op.op === 'delete') { delete snapshot[t][op.key]; return; }
    var one = normOne(t, op.local);
    if (one) snapshot[t][op.key] = one;
  }

  /* تمثيل صف واحد بنفس تطبيع snapshotOf بالضبط (نفس الدوال حتى لا يظهر
     «فرق وهمي» بعد نجاح العملية). */
  function normOne(table, local) {
    if (local == null) return null;
    if (table === 'jobs') return normJobs(local);
    if (table === 'applicants') return normApplicants(local);
    if (table === 'job_attempts') return normAttempts(local);
    if (table === 'audit_log') return normAudit(local);
    if (table === 'staff') return JSON.stringify([local.username, local.role, local.active]);
    if (table === 'settings') {
      /* rules تُخزَّن بمفاتيح SQL: نُمرّها على نفس التحويل المستخدم في snapshotOf */
      if (local.key === 'rules') {
        var back = root.BRCCloud.settingsFromDb([{ key: 'rules', value: local.value }]);
        return normSettings('rules', root.BRCCloud.settingsToDb(back));
      }
      return normSettings(local.key, local.value);
    }
    return null;
  }

  /* ------------------- تحويل عملية إلى صف قاعدة البيانات ------------------- */
  function toRow(op) {
    var C = root.BRCCloud;
    /* حصانة: الحذف لا يحمل صفاً، وأي عملية بلا local خطأ برمجي — نُبلّغ عنه
       بخطأ صريح بدل انهيار يُبتلع في مسار الخطأ فيبدو التنفيذ ناجحاً. */
    if (op.op !== 'delete' && !op.local) {
      throw Object.assign(new Error('عملية ' + op.op + ' على ' + op.table + ' بلا صف'),
        { __brc: { op: op.op, table: op.table, code: 'BRC_NO_ROW' } });
    }
    if (op.table === 'jobs') return C.jobToDb(op.local);
    if (op.table === 'applicants') return C.applicantToDb(op.local);
    if (op.table === 'job_attempts') return C.attemptToDb(op.local);
    if (op.table === 'audit_log') return C.auditToDb(op.local);
    if (op.table === 'settings') return { key: op.local.key, value: op.local.value };
    return op.local;
  }

  /* ------------------- معرّف الصف في القاعدة (للتحديث والحذف) -------------------
   *  jobs: code (فريد) · applicants: serial (فريد) · attempts: serial+attempt_no
   *  settings: key · audit_log: id
   * ------------------------------------------------------------------------- */
  function whereFor(op) {
    if (op.table === 'jobs') return { column: 'code', value: op.local ? op.local.code : String(op.key) };
    if (op.table === 'applicants') return { column: 'serial', value: op.local ? op.local.serial : String(op.key) };
    if (op.table === 'job_attempts') {
      var parts = String(op.key).split(':');
      return { composite: [{ column: 'serial', value: parts[0] }, { column: 'attempt_no', value: Number(parts[1]) }] };
    }
    if (op.table === 'settings') return { column: 'key', value: op.local ? op.local.key : String(op.key) };
    if (op.table === 'audit_log') return { column: 'id', value: op.local ? op.local.id : op.key };
    return null;
  }

  /* ============================================================================
   *  تنفيذ عملية واحدة — مع إعادة محاولة ذكية عند تصادم المفاتيح الفريدة
   *
   *  لماذا؟ الأكواد والأرقام التسلسلية تُولَّد محلياً من العدّاد، فلو أنشأ
   *  موظفان في نفس اللحظة قد يتصادم الرقم. عند التصادم نُعيد المحاولة **بلا**
   *  المفتاح ليولّده الخادم من تسلسله (وهو المصدر الموثوق)، ثم نُصحّح القيمة
   *  محلياً. بدون هذا يفشل الإدراج نهائياً ويضيع عمل الموظف.
   * ========================================================================== */
  function executeOne(client, op, hooks) {
    var table = client.from(op.table);
    /* ⚠️ لا تُحسب row إلا للعمليات التي تحتاجها: عمليات الحذف بلا local،
       وتمرير undefined إلى محوّل مثل jobToDb يرمي استثناءً يُبتلع في مسار
       الخطأ — فتظهر العملية «ناجحة» بينما **الحذف لا ينفَّذ إطلاقاً**.
       لذلك: الطلب عند الحاجة، لا مسبقاً. */
    var row = op.op === 'delete' ? null : toRow(op);

    if (op.op === 'insert') {
      /* audit_log معرّفه bigserial — نُسقطه ليتولّاه الخادم */
      if (op.table === 'audit_log' && row.id != null) delete row.id;
      return finish(table.insert(row).select(), op, hooks)
        .catch(function (err) {
          if (!isUniqueViolation(err)) throw err;
          /* تصادم مفتاح فريد: أعد المحاولة بلا المفتاح الطبيعي */
          var retry = Object.assign({}, row);
          delete retry.code; delete retry.serial;
          return finish(client.from(op.table).insert(retry).select(), op, hooks)
            .then(function (res) { if (hooks && hooks.onKeyRegenerated) hooks.onKeyRegenerated(op, res); return res; });
        });
    }

    if (op.op === 'update') {
      var w = whereFor(op);
      var q = table.update(row);
      if (w.composite) w.composite.forEach(function (c) { q = q.eq(c.column, c.value); });
      else q = q.eq(w.column, w.value);
      /* لا نسمح بتعديل المعرّفات الطبيعية */
      delete row.code; delete row.serial; delete row.attempt_no; delete row.key;
      return finish(q, op, hooks);
    }

    if (op.op === 'delete') {
      var wd = whereFor(op);
      var qd = table.delete();
      if (wd.composite) wd.composite.forEach(function (c) { qd = qd.eq(c.column, c.value); });
      else qd = qd.eq(wd.column, wd.value);
      return finish(qd, op, hooks);
    }

    return Promise.resolve(null);
  }

  /* انتظار نهاية السلسلة والتحقق من الخطأ */
  function finish(query, op, hooks) {
    if (!query || typeof query.then !== 'function') {
      return Promise.reject(Object.assign(new Error('استعلام غير صالح'), { __brc: { op: op.op, table: op.table } }));
    }
    return query.then(function (res) {
      if (res && res.error) {
        throw Object.assign(new Error(res.error.message || 'خطأ قاعدة بيانات'),
          { __brc: { op: op.op, table: op.table, code: res.error.code, detail: res.error } });
      }
      if (hooks && hooks.onOp) hooks.onOp(op, res);
      return res;
    });
  }

  function isUniqueViolation(err) {
    var c = err && err.__brc && err.__brc.code;
    return c === '23505' || (err && /duplicate key|unique constraint/i.test(String(err.message || '')));
  }

  /* ============================================================================
   *  دفع كل الفروق — يُستدعى بعد كل عملية كتابة محلية
   *  لا يرمي استثناءً أبداً: أي فشل يُسجَّل ويدخل قائمة الانتظار، لأن فقدان
   *  المزامنة يجب ألا يُسقط الواجهة أو يمنع الموظف من العمل.
   * ========================================================================== */
  /* نسخ اللقطة: create() يتعامل الآن مع لقطته **عمليةً عمليةً** (advanceSnapshot)
     فلو تبنّى كائن الطرف الخارجي لأفسده — وحالة واقعية: نسختان (تبويبان) تتشاركان
     اللقطة نفسها فيرى الثاني صفوفاً مهاجَرة فلا يُرسل شيئاً. النسخ يفصل المسؤولية. */
  function cloneSnapshot(snap) {
    var out = {};
    Object.keys(snap || {}).forEach(function (t) { out[t] = Object.assign({}, snap[t]); });
    return out;
  }

  function create(client, opts) {
    opts = opts || {};
    var log = opts.log || function () {};
    var snapshot = cloneSnapshot(opts.snapshot || snapshotOf({}));
    var pushing = false;
    var pendingAgain = false;

    function setSnapshot(db) { snapshot = snapshotOf(db); }
    function getSnapshot() { return snapshot; }

    /* حفظ العمليات في قائمة الانتظار عند تعذّر الدفع */
    function queueOps(ops) {
      if (!ops.length) return;
      try {
        var q = [];
        try { q = JSON.parse(root.localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { }
        q = q.concat(ops.map(function (o) { return { ts: new Date().toISOString(), op: o.op, table: o.table, key: o.key }; }));
        if (q.length > 300) q = q.slice(-300);
        root.localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
      } catch (e) { /* لا تخزين متاح */ }
    }

    function readQueue() {
      try { return JSON.parse(root.localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
    }
    function clearQueue() {
      try { root.localStorage.removeItem(QUEUE_KEY); } catch (e) { }
    }
    function queueLength() { return readQueue().length; }

    /* -------------------------------- الدفع -------------------------------- */
    function push(db) {
      /* منع التداخل: لو وصلت عملية جديدة أثناء الدفع نُعيد الدفع بعده مرة واحدة
         (وليس مرة لكل عملية) حتى لا تتزاحم الطلبات على القاعدة. */
      if (pushing) { pendingAgain = true; return Promise.resolve({ skipped: true }); }
      pushing = true;

      var ops = diff(snapshot, db);
      if (!ops.length) { pushing = false; return Promise.resolve({ ops: 0 }); }

      log('مزامنة: ' + ops.length + ' عملية');

      /* الإعدادات أولاً حتى تكون قواعد العمل على الخادم صحيحة قبل أي رحلة
         كتابة أخرى، ثم بقية الجداول بالترتيب الذي يرتّبه diff(). */
      var ordered = ops.slice().sort(function (a, b) {
        if (a.table === 'settings' && b.table !== 'settings') return -1;
        if (b.table === 'settings' && a.table !== 'settings') return 1;
        return 0;
      });

      var done = 0;
      var failedOps = [];

      return ordered.reduce(function (chain, op) {
        return chain.then(function () {
          return executeOne(client, op, opts.hooks).then(function () {
            /* نجحت: نُقدّم اللقطة لهذه العملية وحدها */
            advanceSnapshot(snapshot, op);
            done++;
          });
        }).catch(function (err) {
          /* عملية فاشلة لا توقف البقية — لكنها **تبقى معلّقة** حتى تُعاد */
          var info = (err && err.__brc) || {};
          failedOps.push(op);
          log('فشل ' + op.op + ' على ' + op.table + ' (' + op.key + '): ' + (err && err.message || err));
          if (opts.onError) opts.onError(err, op);
          if (info.code === '42P01' || info.code === 'PGRST205') {
            /* الجدول غير موجود: كل العمليات ستتفشل — نوقف بدل إغراق الطلبات */
            throw Object.assign(new Error('جدول مفقود: ' + op.table), { __halt: true });
          }
        });
      }, Promise.resolve())
        .then(function () {
          pushing = false;
          if (pendingAgain) { pendingAgain = false; return push(db); }
          return { ops: done, failed: failedOps.length, pending: failedOps.map(function (o) { return o.table + ':' + o.key; }) };
        })
        .catch(function (err) {
          pushing = false;
          queueOps(ops);
          if (opts.onFatal) opts.onFatal(err);
          return { ops: done, error: err, queued: true };
        });
    }

    /* --------------------------- إعادة دفع الانتظار --------------------------- */
    function flushQueue() {
      if (!queueLength()) return Promise.resolve({ flushed: true, pending: 0 });
      /* القائمة لا تحمل البيانات نفسها (بل وصف العملية) — لذلك إعادة الدفع
         تتمّ بمزامنة الحالة الحالية كاملة، وهي الأصح في كل الحالات. */
      clearQueue();
      return Promise.resolve({ flushed: true, pending: 0 });
    }

    return {
      push: push, setSnapshot: setSnapshot, getSnapshot: getSnapshot,
      diff: function (db) { return diff(snapshot, db); },
      queueLength: queueLength, flushQueue: flushQueue, readQueue: readQueue, queueOps: queueOps
    };
  }

  root.BRCSync = {
    create: create,
    diff: diff,
    snapshotOf: snapshotOf,
    executeOne: executeOne,
    toRow: toRow,
    whereFor: whereFor,
    isUniqueViolation: isUniqueViolation,
    advanceSnapshot: advanceSnapshot,
    cloneSnapshot: cloneSnapshot,
    normOne: normOne,
    QUEUE_KEY: QUEUE_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
