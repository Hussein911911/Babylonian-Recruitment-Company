/* ===========================================================================
 *  HRC — محرّك البيانات ومنطق العمل
 *  ---------------------------------------------------------------------------
 *  نسختان في ملف واحد — والفرق بينهما فرق ثقة لا فرق شيفرة:
 *
 *   1) الوضع السحابي (الافتراضي عند وجود إعداد Supabase):
 *      • القراءة من الذاكرة فوراً (تُملأ من سوبابيس عند الإقلاع) فلا تتغيّر
 *        أي نقطة استدعاء من النقاط الـ222 — وكلها متزامنة.
 *      • الكتابة: تُحدَّث الذاكرة فوراً ثم تُدفع لسوبابيس في الخلفية عبر فرق
 *        مركزي واحد (cloud-sync.js)، ويُبلَّغ باقي الموظفين عبر Realtime.
 *      • الدخول عبر Supabase Auth والدور من brc.staff: لا كلمات مرور في كود
 *        الواجهة، ولا قاعدة بيانات منفصلة لكل متصفح.
 *      • إن تعذّر الوصول للسحابة يعمل النظام محلياً **بتنبيه صريح دائم**
 *        (وضع مؤقّت لا تُعتمد عليه البيانات المشتركة).
 *
 *   2) الوضع المحلي (بلا إعداد سحابة، أو عبر init({cloud:false})):
 *      كل شيء في localStorage — للطباعة والتشغيل بلا إنترنت والتجارب.
 *
 *  نفس المنطق مُنفّذ في PostgreSQL + Supabase (docs/schema.sql: المشغلات
 *  triggers وسياسات RLS ودوال select_attempt/set_outcome/verify_form).
 *
 *  المنطق المطبّق هنا مطابق للمواصفات:
 *   • استمارة لكل باحث عن عمل، صالحة 30 يوماً، وتحتوي 5 محاولات.
 *   • عند اختيار محاولة: تُحجز الوظيفة مؤقتاً 24 ساعة (بانتظار المقابلة).
 *   • إن لم تُثبّت النتيجة خلال 24 ساعة: تُفرج الوظيفة تلقائياً وتُوسم
 *     المحاولة بـ "انتهت المهلة / تتطلب إجراء".
 *   • عند الرفض: تُعاد الوظيفة إلى "متاحة" وتُفعّل المحاولة التالية تلقائياً.
 * =========================================================================== */
(function (root) {
  'use strict';

  var CFG = root.HRC_CONFIG;
  var STORAGE_KEY = 'hrc_db_v2';
  var SESSION_KEY = 'hrc_session_v2';
  var sub = { listeners: [], version: 0 };

  /* ======================= أدوات عامة ======================= */

  function pad(n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; }

  function nowISO() { return new Date().toISOString(); }

  /* طابع زمني بالصيغة المطلوبة في سجل التدقيق: YYYY-MM-DD HH:mm:ss */
  function fmtDateTime(d) {
    d = d instanceof Date ? d : new Date(d);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2) + ' ' +
      pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2);
  }

  function fmtDate(d) {
    d = d instanceof Date ? d : new Date(d);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }

  function addDays(date, days) { var d = new Date(date.getTime()); d.setDate(d.getDate() + days); return d; }
  function addHours(date, hours) { var d = new Date(date.getTime()); d.setHours(d.getHours() + hours); return d; }

  function money(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US') + ' د.ع';
  }

  function diffDays(a, b) { return Math.ceil((new Date(a).getTime() - new Date(b).getTime()) / 86400000); }
  function diffHours(a, b) { return (new Date(a).getTime() - new Date(b).getTime()) / 3600000; }

  /* بصمة تحقق قصيرة (للنسخة المحلية). في الإنتاج: توقيع HMAC من الخادم. */
  function token(serial) {
    var s = String(serial) + '|' + CFG.verifySecret, h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  /* ======================= التهيئة والتخزين ======================= */

  var db = null;

  function blankDb() {
    return {
      meta: { createdAt: nowISO(), version: 2 },
      counters: { formSerial: 120, jobCode: 1049 },   // أعلى تسلسل مُزرَع — تتجنّب تكرار الأرقام
      /* سجل دائم لكل باركود صُدر يوماً — لا يعود رقم أبداً ولو حُذفت بطاقته.
         الباركودات العشوائية (قرار 2026-09-30) تعتمد عليه لضمان الفردية. */
      usedSerials: [],
      jobs: [], applicants: [], attempts: [], audit: [], settings: {}
    };
  }

  function seedDb() {
    var d = blankDb();
    d.settings = {
      attemptLimit: CFG.rules.attemptLimit,
      validityDays: CFG.rules.validityDays,
      holdHours: CFG.rules.holdHours,
      formFee: CFG.rules.formFee
    };
    // الوظائف
    CFG.seed.jobs.forEach(function (j, idx) {
      var extra = CFG.seed.jobsExtras[j.code] || {};
      var created = addDays(new Date(), -(idx + 3));
      d.jobs.push({
        id: uid('job'), code: j.code, title: j.title, category: j.category, region: j.region,
        salaryMin: j.salaryMin, salaryMax: j.salaryMax, shift: j.shift, gender: j.gender || 'لا فرق',
        description: j.description || '', requirements: j.requirements || [],
        employer: j.employer, interviewLocation: j.interviewLocation,
        status: extra.status || 'available',
        reservedBy: null,
        holdExpiresAt: null,
        createdAt: created.toISOString(), createdBy: idx % 2 ? 'staff2' : 'staff',
        closedAt: extra.status === 'closed' ? addDays(new Date(), -1).toISOString() : null,
        notes: '', vacancies: 1, imageUrl: j.imageUrl || ''
      });
    });
    // الباحثون عن عمل + الاستمارات
    CFG.seed.applicants.forEach(function (a, idx) {
      /* بطاقات فارغة بالمخزن (d.blank): تُصدر من الشركة دفعات وتنتظر التعبئة
         عند البيع — لا تواريخ لها والصلاحية تبدأ عند التعبئة. */
      if (a.blank) {
        d.applicants.push({
          id: uid('app'), serial: a.serial, fullName: '', phone: '', address: '',
          dob: '', gender: 'ذكر', nationality: 'عراقي',
          issueDate: null, expiryDate: null, status: 'blank',
          createdBy: a.createdBy || 'admin', createdAt: addDays(new Date(), -(idx)).toISOString(), notes: '',
          fee: CFG.rules.formFee, feePaid: false, printedCount: 0
        });
        return;
      }
      var issue = addDays(new Date(), -(idx * 5 + 2));
      d.applicants.push({
        id: uid('app'), serial: a.serial, fullName: a.fullName, phone: a.phone, address: a.address,
        dob: a.dob, gender: idx % 2 ? 'أنثى' : 'ذكر', nationality: 'عراقي',
        issueDate: issue.toISOString(), expiryDate: addDays(issue, CFG.rules.validityDays).toISOString(),
        status: 'active', createdBy: a.createdBy, createdAt: issue.toISOString(), notes: '',
        fee: CFG.rules.formFee, feePaid: true, printedCount: 1
      });
    });
    // سجل الباركودات: كل باركود مزرع يُسجَّل حتى لا يعود
    d.applicants.forEach(function (a) { d.usedSerials.push(a.serial); });
    // الفرص: خانتان لكل بطاقة (منها المُستخدم في البيانات التجريبية)
    var limit = Number(d.settings.attemptLimit || 2);
    d.applicants.forEach(function (app) {
      for (var i = 1; i <= limit; i++) {
        var t = CFG.seed.attempts.filter(function (x) { return x.serial === app.serial && x.no === i; })[0];
        var job = t ? d.jobs.filter(function (j) { return j.code === t.jobCode; })[0] : null;
        var isHold = t && t.slotStatus === 'reserved';
        // الحجز الجاري: بدأ قبل 3 ساعات وتنتهي مهلته بعد نحو 21 ساعة (لعرض العدّاد التنازلي)
        var selected = isHold ? addHours(new Date(), -3) : addDays(new Date(), -2 - i);
        d.attempts.push({
          id: uid('att'), serial: app.serial, no: i, code: chanceCode(d.attempts),
          jobId: job ? job.id : null,
          jobCode: job ? job.code : null, jobTitle: job ? job.title : null,
          location: job ? job.region : null,
          employerName: job ? job.employer.name : null, employerPhone: job ? job.employer.phone : null,
          slotStatus: t ? t.slotStatus : 'empty',
          selectedAt: t ? selected.toISOString() : null,
          holdExpiresAt: isHold ? addHours(selected, Number(d.settings.holdHours || 24)).toISOString() : null,
          closedAt: (t && (t.slotStatus === 'rejected' || t.slotStatus === 'succeeded')) ? addDays(selected, 1).toISOString() : null,
          note: t ? (t.note || '') : '', staff: t ? 'staff' : null
        });
      }
    });
    // مزامنة الوظائف المحجوزة مع المحاولات (ضمان تناسق الحالة)
    d.attempts.forEach(function (t) {
      if (t.slotStatus !== 'reserved' || !t.jobId) return;
      var job = d.jobs.filter(function (j) { return j.id === t.jobId; })[0];
      if (!job) return;
      job.status = 'reserved';
      job.reservedBy = t.serial;
      job.holdExpiresAt = t.holdExpiresAt;
    });

    // سجل تدقيق أولي
    d.audit.push({
      id: uid('log'), ts: nowISO(), user: 'system', role: 'system', ip: localIp(),
      action: 'تهيئة النظام', entity: 'system', entityId: '—',
      details: 'زرع البيانات التجريبية وتشغيل قواعد الحجز التلقائي'
    });
    return d;
  }

  /* عنوان IP لجلسة العمل المحلية (في النسخة السحابية يأتي من الخادم) */
  var _ip = null;
  function localIp() {
    if (_ip) return _ip;
    try {
      var k = 'brc_ip';
      _ip = localStorage.getItem(k);
      if (!_ip) {
        _ip = '10.24.' + (10 + Math.floor(Math.random() * 240)) + '.' + (2 + Math.floor(Math.random() * 250)) + ' (جلسة محلية)';
        localStorage.setItem(k, _ip);
      }
    } catch (e) { _ip = '127.0.0.1 (محلي)'; }
    return _ip;
  }

  /* تنظيف مخلفات المؤقّت القديم للنسخ التلقائي (مفاتيح يومية كانت تتراكم
     بلا نهاية: hrc-last-auto-backup-YYYY-MM-DD) — المحرّك الجديد يستخدم
     مفتاحاً واحداً AUTO_RUN_KEY. */
  function cleanupLegacyKeys() {
    try {
      var drop = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('hrc-last-auto-backup-') === 0) drop.push(k);
      }
      drop.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* لا تخزين متاح */ }
  }

  /* ---------------------------------------------------------------------------
   *  ترحيل مفاتيح التخزين من البادئة القديمة brc إلى hrc — مرة واحدة.
   *  ---------------------------------------------------------------------------
   *  توحيد الرمز (2026-09-26) غيّر أسماء مفاتيح localStorage، وبدون هذا الترحيل
   *  تختفي بيانات الأجهزة التي كانت تعمل قبل التحديث (ومعها النسخ الاحتياطية
   *  المحفوظة) بلا أي رسالة — تبدو كأن النظام مسح كل شيء.
   *
   *  ينسخ القديم إلى الجديد **فقط** إذا لم يكن الجديد موجوداً، ثم يحذف القديم.
   *  هذه ليست «توافقية دائمة»: بعد أن تُحدَّث أجهزة الموظفين يمكن حذف الدالة
   *  واستدعاءها بأمان.
   * ------------------------------------------------------------------------- */
  function migrateLegacyPrefix() {
    try {
      if (localStorage.getItem('hrc-prefix-migrated')) return;
      var moved = 0;
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (!k) continue;
        var nk = null;
        if (k.indexOf('brc-') === 0) nk = 'hrc-' + k.slice(4);
        else if (k === 'brc_db_v2') nk = 'hrc_db_v2';
        else if (k === 'brc_session_v2') nk = 'hrc_session_v2';
        if (!nk) continue;
        if (localStorage.getItem(nk) === null) {
          localStorage.setItem(nk, localStorage.getItem(k));
          moved++;
        }
        localStorage.removeItem(k);
      }
      localStorage.setItem('hrc-prefix-migrated', String(moved));
    } catch (e) { /* لا تخزين متاح — لا شيء يُرحَّل */ }
  }

  function load() {
    migrateLegacyPrefix();
    cleanupLegacyKeys();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { db = seedDb(); save(); return db; }
      db = JSON.parse(raw);
      if (!db.jobs) throw new Error('bad db');
    } catch (e) { db = seedDb(); save(); }
    normalizeSerialLog();
    // ترحيل بسيط للإعدادات
    ['attemptLimit', 'validityDays', 'holdHours', 'formFee'].forEach(function (k) {
      if (db.settings[k] == null) db.settings[k] = CFG.rules[k];
    });
    // ترحيل الصور للوظائف القديمة
    var needsMigration = false;
    if (db.jobs && db.jobs.length > 0) {
      var seedJobs = CFG.seed.jobs;
      db.jobs.forEach(function(job) {
        if (!job.imageUrl) {
          var seedJob = seedJobs.find(function(sj) { return sj.code === job.code; });
          if (seedJob && seedJob.imageUrl) {
            job.imageUrl = seedJob.imageUrl;
            needsMigration = true;
            console.log('[HRC] ✓ تم إضافة صورة للوظيفة ' + job.code);
          }
        }
      });
      if (needsMigration) {
        save();
        console.log('[HRC] ✓ تم تحديث الصور لجميع الوظائف القديمة');
        // Trigger re-render for all subscribers
        setTimeout(function() { emit(); }, 100);
      }
    }
    return db;
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      // حفظ في قائمة التغييرات الأوفلاين
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        var queue = [];
        try { queue = JSON.parse(localStorage.getItem('hrc-offline-queue') || '[]'); } catch(e) {}
        queue.push({ ts: nowISO(), data: JSON.parse(JSON.stringify(db)) });
        // احتفظ بآخر 50 نسخة فقط
        if (queue.length > 50) queue = queue.slice(-50);
        try { localStorage.setItem('hrc-offline-queue', JSON.stringify(queue)); } catch(e) {}
      }
    } catch (e) { /* لا تخزين متاح أو المساحة ممتلئة — البيانات تبقى في الذاكرة */ }
  }

  /* كل حفظ محلي يتبعه دفع للسحابة — نقطة واحدة، فلا تُنسى عملية كتابة.
     الدفع مؤجَّل (debounce): العملية الواحدة قد تستدعي save() مرتين، ولا معنى
     لرحلتين إلى القاعدة لنفس التغيير. */
  function save() {
    saveLocal();
    schedulePush();
  }

  function syncOfflineChanges() {
    // مزامنة التغييرات عند العودة للاتصال
    var queue = [];
    try { queue = JSON.parse(localStorage.getItem('hrc-offline-queue') || '[]'); } catch(e) {}
    if (queue.length > 0) {
      audit('مزامنة أوفلاين', 'system', '—', 'تم استعادة الاتصال — تم حفظ ' + queue.length + ' نسخة من التغييرات');
      // حفظ آخر نسخة كاحتياط
      try {
        var lastSync = queue[queue.length - 1];
        localStorage.setItem('hrc-last-offline-sync', JSON.stringify({
          ts: nowISO(),
          data: lastSync.data
        }));
      } catch(e) {}
      // مسح قائمة الانتظار
      try { localStorage.removeItem('hrc-offline-queue'); } catch(e) {}
      save();
    }
    return queue.length;
  }

  function emit() { sub.version++; sub.listeners.forEach(function (fn) { try { fn(db, sub.version); } catch (e) { } }); }

  function subscribe(fn) { sub.listeners.push(fn); return function () { var i = sub.listeners.indexOf(fn); if (i >= 0) sub.listeners.splice(i, 1); }; }

  /* ======================= الجلسة والصلاحيات ======================= */

  var memSession = null;   // جلسة احتياطية في الذاكرة عند تعذّر sessionStorage

  function login(username, password, opts) {
    /* الوضع السحابي: كلمات المرور المحلية (المنشورة في config.js) ليست باباً
       للدخول. الدخول الفعلي: signIn ← Supabase Auth ← جدول brc.staff.
       ⚠️ الاستثناء الوحيد مُعلَن في الإعداد لا مُستنتَج: متى أنشأ المسؤول حسابات
       الموظفين ووضع enforceAuth=true في supabase-config.js يُغلق هذا الباب في
       طبقة البيانات نفسها — لا في الواجهة فقط (لو كان الإغلاق في الواجهة وحدها
       لكفى نداء واحد من طرف ثالث لتجاوزه). ما دام المفتاح false فالنظام في وضع
       انتقالي معلوم، وتُعرض حالة الوضع بوضوح في أعلى الشاشة. */
    if (cloud.state === 'on' && enforceAuth() && !(opts && opts.forceLocal)) {
      audit('محاولة دخول محلي مرفوضة', 'auth', username || '—',
        'النظام في الوضع السحابي — الدخول عبر Supabase Auth فقط');
      saveLocal(); emit();
      return null;
    }
    var u = (db.settings.users || CFG.users).filter(function (x) {
      return x.username === username && x.password === password;
    })[0];
    if (!u) { audit('محاولة دخول فاشلة', 'auth', username, 'اسم مستخدم أو كلمة مرور غير صحيحة'); save(); emit(); return null; }
    var session = { username: u.username, name: u.name, role: u.role, title: u.title, at: nowISO() };
    memSession = session;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { }
    audit('تسجيل دخول', 'auth', username, 'دخول ناجح إلى المنظومة (' + (u.role === 'admin' ? 'مدير عام' : 'موظف') + ')');
    /* ⚠️ خطر حقيقي في الوضع الانتقالي: لو كان في هذا المتصفح توكن جلسة سحابية
       لموظف آخر، ثم دخل شخص بكلمة المرور المحلية، لصارت كل كتاباته تُنسب إلى
       **ذلك الموظف** في القاعدة (التوكن هو من يكتب لا الشاشة). القاعدة هنا
       صريحة: إمّا أنت المستخدم السحابي، وإمّا وضع محلي بلا أي كتابة سحابية —
       لذلك نفصل الجلسة السحابية عند الدخول المحلي. */
    if (cloud.state === 'on' && cloud.role === 'staff') {
      console.warn('[HRC] دخول محلي مع جلسة سحابية قائمة — تُفصل الجلسة السحابية حتى لا تُنسب الكتابات لصاحبها');
      saveLocal(); emit();
      signOutCloud();
      return session;
    }
    save(); emit();
    return session;
  }

  function logout() {
    var s = currentUser();
    if (s) audit('تسجيل خروج', 'auth', s.username, 'إنهاء الجلسة');
    memSession = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { }
    saveLocal(); emit();
    /* الجلسة السحابية تُنهى فعلاً (signOut) — وإلا بقي التوكن صالحاً في
       المتصفح ولو ظهرت الواجهة كأنها خرجت. signOutCloud يمسح الكاش أيضاً. */
    if (s && s.cloud) signOutCloud();
  }

  function currentUser() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* لا جلسة تخزين متاحة */ }
    return memSession;
  }

  function isAdmin() { var u = currentUser(); return !!(u && u.role === 'admin'); }

  /* ======================= التدقيق ======================= */

  function audit(action, entity, entityId, details) {
    var u = currentUser();
    db = db || blankDb();
    db.audit.unshift({
      id: uid('log'), ts: nowISO(),
      user: u ? u.username : 'system', role: u ? u.role : 'system',
      name: u ? u.name : 'النظام',
      ip: localIp(), action: action, entity: entity, entityId: entityId || '—',
      details: details || ''
    });
    if (db.audit.length > 2000) db.audit.length = 2000;
  }

  function listAudit(f) {
    f = f || {};
    var rows = db.audit.slice();
    if (f.role && f.role !== 'all') rows = rows.filter(function (r) { return r.role === f.role; });
    if (f.user && f.user !== 'all') rows = rows.filter(function (r) { return r.user === f.user; });
    if (f.q) {
      var q = f.q.toLowerCase();
      rows = rows.filter(function (r) {
        return (r.action + ' ' + r.details + ' ' + r.entityId + ' ' + r.user).toLowerCase().indexOf(q) >= 0;
      });
    }
    if (f.from) rows = rows.filter(function (r) { return r.ts >= f.from; });
    if (f.to) rows = rows.filter(function (r) { return r.ts <= f.to + 'T23:59:59'; });
    return rows;
  }

  /* ======================= الوظائف ======================= */

  function nextJobCode() {
    var code;
    do { db.counters.jobCode++; code = 'HRC-' + db.counters.jobCode; }
    while (db.jobs.some(function (j) { return j.code === code; }));
    return code;
  }

  function listJobs(f) {
    f = f || {};
    var rows = db.jobs.slice();
    if (f.status && f.status !== 'all') rows = rows.filter(function (j) { return j.status === f.status; });
    if (f.region && f.region !== 'all') rows = rows.filter(function (j) { return j.region === f.region; });
    if (f.shift && f.shift !== 'all') rows = rows.filter(function (j) { return j.shift === f.shift; });
    if (f.category && f.category !== 'all') rows = rows.filter(function (j) { return j.category === f.category; });
    if (f.q) {
      var q = f.q.trim().toLowerCase();
      rows = rows.filter(function (j) {
        return (j.code + ' ' + j.title + ' ' + j.region + ' ' + j.category + ' ' + (j.employer ? j.employer.name : ''))
          .toLowerCase().indexOf(q) >= 0;
      });
    }
    rows.sort(function (a, b) {
      var rank = { available: 0, reserved: 1, closed: 2 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return rows;
  }

  function getJob(codeOrId) {
    return db.jobs.filter(function (j) { return j.code === codeOrId || j.id === codeOrId; })[0] || null;
  }

  function createJob(data) {
    var job = {
      id: uid('job'), code: nextJobCode(), title: data.title, category: data.category || 'خدمات',
      region: data.region, salaryMin: data.salaryMin, salaryMax: data.salaryMax, shift: data.shift,
      gender: data.gender || 'لا فرق', description: data.description || '',
      requirements: (data.requirements || []).filter(Boolean),
      employer: { name: data.employerName, phone: data.employerPhone, address: data.employerAddress },
      interviewLocation: data.interviewLocation || 'مقر الشركة - الحلة',
      status: 'available', reservedBy: null, holdExpiresAt: null,
      createdAt: nowISO(), createdBy: currentUser() ? currentUser().username : 'system',
      closedAt: null, notes: '', vacancies: Number(data.vacancies || 1),
      imageUrl: data.imageUrl || ''
    };
    db.jobs.unshift(job);
    audit('إضافة وظيفة', 'job', job.code, job.title + ' — ' + job.region + ' — الأجر ' + money(job.salaryMin) + ' إلى ' + money(job.salaryMax));
    save(); emit();
    return job;
  }

  function updateJob(code, patch) {
    var job = getJob(code); if (!job) return null;
    var before = JSON.stringify({ t: job.title, r: job.region, s: job.status });
    Object.keys(patch).forEach(function (k) { if (patch[k] !== undefined) job[k] = patch[k]; });
    audit('تعديل وظيفة', 'job', job.code, 'تحديث بيانات الوظيفة (' + before + ' ← ' + JSON.stringify({ t: job.title, r: job.region, s: job.status }) + ')');
    save(); emit();
    return job;
  }

  function setJobStatus(code, status, reason) {
    var job = getJob(code); if (!job) return null;
    var old = job.status;
    job.status = status;
    if (status === 'available') { job.reservedBy = null; job.holdExpiresAt = null; }
    if (status === 'closed') { job.closedAt = nowISO(); job.reservedBy = null; job.holdExpiresAt = null; }
    audit('تغيير حالة وظيفة', 'job', job.code, 'الحالة: ' + CFG.jobStatus[old].ar + ' ← ' + CFG.jobStatus[status].ar + (reason ? ' | السبب: ' + reason : ''));
    save(); emit();
    return job;
  }

  function deleteJob(code) {
    var job = getJob(code); if (!job) return false;
    /* حذف وظيفة عليها حجز/حرجة يغلق فرصة البطاقة المرتبطة (الفرصة مستهلكة —
       قرار معتمد: لا تعود الفرصة بأي نتيجة) */
    db.attempts.forEach(function (t) {
      if (t.jobId === job.id && (t.slotStatus === 'reserved' || t.slotStatus === 'critical')) {
        t.slotStatus = 'expired';
        t.closedAt = nowISO();
        t.holdExpiresAt = null;
        t.note = 'حذفت الشركة الوظيفة ' + job.code + ' — استُهلكت الفرصة';
      }
    });
    db.jobs = db.jobs.filter(function (j) { return j.code !== code; });
    audit('حذف وظيفة', 'job', code, job.title + ' — ' + job.region);
    save(); emit();
    return true;
  }

  /* ======================= الباحثون عن العمل والبطاقات ======================= */

  /* بادئة البطاقة: HRC-BC-###### (BC = بطاقة توظيف) — الباركود هو هوية البطاقة.
     ⚠️ قرار مقفل (2026-09-30): الباركود **عشوائي غير متسلسل** — لا نمط يُخمَّن
     ولا رقمين متجاورين يتشابهان، لتفادي التزوير. كل باركود يُسجَّل بسجل دائم
     (usedSerials) حتى لا يعود أبداً ولو حُذفت بطاقته. */
  function randomSerial() {
    if (!db.usedSerials) db.usedSerials = [];
    var exists = {};
    db.applicants.forEach(function (a) { exists[a.serial] = 1; });
    for (var guard = 0; guard < 500; guard++) {
      var serial = 'HRC-BC-' + String(100000 + Math.floor(Math.random() * 900000));
      if (!exists[serial] && db.usedSerials.indexOf(serial) < 0) {
        db.usedSerials.push(serial);
        return serial;
      }
    }
    return null; /* مستحيل عملياً: 900 ألف احتمال */
  }

  function nextSerial() { return randomSerial(); }

  /* استرجاع سجل الباركودات: يُضمَّن كل باركود موجود فعلاً — حتى الملفات
     القديمة والنسخ المستوردة — فلا يعود رقم مستعمل أبداً. */
  function normalizeSerialLog() {
    if (!db.usedSerials || !Array.isArray(db.usedSerials)) db.usedSerials = [];
    db.applicants.forEach(function (a) {
      if (a.serial && db.usedSerials.indexOf(a.serial) < 0) db.usedSerials.push(a.serial);
    });
  }

  /* رمز خاص لكل فرصة داخل البطاقة (4 أرقام + شرطة + حرفان) — يستخدمه الزبون
     للتقديم الذاتي أونلاين: الباركود وحده لا يكفي لاستهلاك فرصة. */
  function chanceCode(pool) {
    var letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    /* pool اختياري: يُمرَّر أثناء seedDb لأن المتغير العام db ما زال null حينها */
    var attempts = pool || (db ? db.attempts : []);
    for (var guard = 0; guard < 50; guard++) {
      var code = pad(Math.floor(1000 + Math.random() * 9000), 4) + '-' +
        letters[Math.floor(Math.random() * letters.length)] +
        letters[Math.floor(Math.random() * letters.length)];
      var taken = attempts.some(function (t) { return t.code === code; });
      if (!taken) return code;
    }
    return pad(Math.floor(1000 + Math.random() * 9000), 4) + '-XX';
  }

  function createApplicant(data) {
    var issue = new Date();
    var pending = !!data.pending;
    var app = {
      id: uid('app'), serial: nextSerial(), fullName: data.fullName, phone: data.phone,
      address: data.address, dob: data.dob || '', gender: data.gender || 'ذكر', nationality: data.nationality || 'عراقي',
      issueDate: pending ? null : issue.toISOString(),
      expiryDate: pending ? null : addDays(issue, Number(db.settings.validityDays || 30)).toISOString(),
      status: pending ? 'pending' : 'active',
      createdBy: currentUser() ? currentUser().username : 'system',
      createdAt: issue.toISOString(), notes: data.notes || '',
      posName: data.posName || '',
      requestedCode: data.requestedCode || null,
      requestedAt: data.requestedCode ? issue.toISOString() : null,
      fee: Number(data.fee != null ? data.fee : db.settings.formFee),
      /* البطاقة تُباع كاشاً عند الإصدار (لا دفع إلكتروني) — الافتراضي مدفوع */
      feePaid: data.feePaid != null ? !!data.feePaid : true, printedCount: 0,
      rejectReason: ''
    };
    db.applicants.unshift(app);
    if (!pending) createAttempts(app.serial);
    audit(pending ? 'طلب بطاقة جديد' : 'إصدار بطاقة توظيف', 'applicant', app.serial,
      (pending ? 'طلب إلكتروني قيد المراجعة من الباحث ' : 'بيع/إصدار بطاقة توظيف للباحث ') + app.fullName +
      (app.posName ? ' — نقطة البيع: ' + app.posName : '') + ' — سعر ' + money(app.fee) + ' (كاش)');
    save(); emit();
    return app;
  }

  /* إصدار دفعة بطاقات فارغة (الشركة/الإدارة): بطاقات بباركود عشوائي فريد
     ورمزي فرصتين — بلا اسم وبلا هاتف. تُطبع فارغة وتوزَّع على نقاط البيع،
     والصلاحية (30 يوماً) لا تبدأ إلا عند تعبئة بيانات الزبون عند البيع. */
  function createCardBatch(count, notes) {
    count = Math.max(1, Math.min(500, Number(count) || 0));
    var made = [];
    for (var i = 0; i < count; i++) {
      var serial = randomSerial();
      if (!serial) break;
      var card = {
        id: uid('app'), serial: serial, fullName: '', phone: '', address: '',
        dob: '', gender: 'ذكر', nationality: 'عراقي',
        issueDate: null, expiryDate: null, status: 'blank',
        createdBy: currentUser() ? currentUser().username : 'system',
        createdAt: nowISO(), notes: notes || '', posName: '',
        requestedCode: null, requestedAt: null,
        fee: Number(db.settings.formFee || 10000), feePaid: false, printedCount: 0, rejectReason: ''
      };
      db.applicants.unshift(card);
      createAttempts(serial);
      made.push(card);
    }
    if (made.length) audit('إصدار دفعة بطاقات فارغة', 'applicant', made[0].serial,
      'دفعة ' + made.length + ' بطاقة فارغة بباركودات عشوائية فريدة — تبدأ من ' + made[0].serial +
      ' — الصلاحية تبدأ عند التعبئة عند البيع' + (notes ? ' | ' + notes : ''));
    save(); emit();
    return made;
  }

  /* إضافة بطاقة مفردة بكودها (الإدارة): بطاقة واحدة فارغة بباركود يكتبه
     المستخدم أو يولّده — لطباعة بطاقة خاصة فوراً دون إصدار دفعة كاملة.
     الكود بصيغة HRC-BC-###### (أو 6 أرقام فتُسبَق تلقائياً) ويجب أن يكون
     فريداً ولم يُستعمل أبداً — سجل usedSerials يمنع عودة أي باركود. */
  function createCardWithSerial(serial, notes) {
    serial = String(serial || '').trim().toUpperCase();
    if (/^\d{6}$/.test(serial)) serial = 'HRC-BC-' + serial;
    if (!/^HRC-BC-\d{6}$/.test(serial))
      return { ok: false, error: 'صيغة الكود غير صحيحة — اكتب 6 أرقام، أو الكود كاملاً بصيغة HRC-BC-######' };
    if (!db.usedSerials || !Array.isArray(db.usedSerials)) db.usedSerials = [];
    if (getApplicant(serial))
      return { ok: false, error: 'هذا الباركود مسجَّل لبطاقة موجودة أصلاً — اختر كوداً آخر' };
    if (db.usedSerials.indexOf(serial) >= 0)
      return { ok: false, error: 'هذا الباركود استُعمل سابقاً لبطاقة حُذفت ولا يعود أبداً (منع التزوير) — اختر كوداً آخر' };
    var card = {
      id: uid('app'), serial: serial, fullName: '', phone: '', address: '',
      dob: '', gender: 'ذكر', nationality: 'عراقي',
      issueDate: null, expiryDate: null, status: 'blank',
      createdBy: currentUser() ? currentUser().username : 'system',
      createdAt: nowISO(), notes: notes || '', posName: '',
      requestedCode: null, requestedAt: null,
      fee: Number(db.settings.formFee || 10000), feePaid: false, printedCount: 0, rejectReason: ''
    };
    db.applicants.unshift(card);
    createAttempts(serial);
    db.usedSerials.push(serial);
    audit('إضافة بطاقة بكودها', 'applicant', serial,
      'بطاقة فارغة واحدة بكود يدوي مختار — فرصتان برمزين — تُطبع الآن وتُعبّأ عند البيع' +
      (notes ? ' | ' + notes : ''));
    save(); emit();
    return { ok: true, card: card };
  }

  /* اقتراح كود عشوائي متاح لبطاقة مفردة — للعرض بالنافذة فقط ولا يُحرق
     بسجل usedSerials إلا عند الإضافة الفعلية (createCardWithSerial). */
  function suggestSerial() {
    if (!db.usedSerials || !Array.isArray(db.usedSerials)) db.usedSerials = [];
    var exists = {};
    db.applicants.forEach(function (a) { exists[a.serial] = 1; });
    for (var guard = 0; guard < 500; guard++) {
      var s = 'HRC-BC-' + String(100000 + Math.floor(Math.random() * 900000));
      if (!exists[s] && db.usedSerials.indexOf(s) < 0) return s;
    }
    return '';
  }

  /* تعبئة بطاقة فارغة عند البيع (نقطة البيع): بيانات الزبون تُسجَّل على نفس
     الباركود المطبوع على الورقة، والصلاحية (30 يوماً) تبدأ من هذه اللحظة. */
  function activateCard(serial, data) {
    serial = String(serial || '').trim().toUpperCase();
    data = data || {};
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على البطاقة الفارغة' };
    if (app.status !== 'blank') {
      return { ok: false, error: 'هذه البطاقة ليست فارغة — حالتها: ' + ((CFG.formStatus[formStatus(app)] || {}).ar || formStatus(app)) };
    }
    if (!data.fullName || !String(data.fullName).trim()) return { ok: false, error: 'اسم الزبون مطلوب' };
    if (!data.phone || !String(data.phone).trim()) return { ok: false, error: 'هاتف الزبون مطلوب' };
    /* اختيار الوظيفة عند البيع صار **اختيارياً** (قرار الإدارة 2026-10-06):
       إمّا يختارها موظف النقطة للزبون فتُستهلك الفرصة الأولى بحجز 24 ساعة،
       وإمّا يُباع بلا وظيفة فيختار صاحب البطاقة وظيفتَي فرصتيه بنفسه من
       صفحة باركود بطاقته. */
    var preJob = null;
    if (data.jobCode) {
      preJob = getJob(String(data.jobCode).trim().toUpperCase());
      if (!preJob) return { ok: false, error: 'الوظيفة المختارة غير موجودة' };
      if (preJob.status !== 'available') return { ok: false, error: 'الوظيفة ' + preJob.code + ' غير متاحة حالياً — اختر وظيفة أخرى' };
    }
    var issue = new Date();
    app.fullName = String(data.fullName).trim();
    app.phone = String(data.phone).trim();
    app.address = data.address || '';
    app.dob = data.dob || '';
    app.gender = data.gender || 'ذكر';
    app.status = 'active';
    app.issueDate = issue.toISOString();
    app.expiryDate = addDays(issue, Number(db.settings.validityDays || 30)).toISOString();
    app.posName = data.posName || '';
    app.fee = Number(data.fee != null ? data.fee : app.fee);
    app.feePaid = data.feePaid != null ? !!data.feePaid : true;   /* بيع كاش */
    if (data.notes) app.notes = data.notes;
    if (!getAttempts(serial).length) createAttempts(serial);
    audit('بيع وتعبئة بطاقة فارغة', 'applicant', app.serial,
      'بيع البطاقة ' + app.serial + ' للزبون ' + app.fullName +
      (app.posName ? ' — نقطة البيع: ' + app.posName : '') +
      ' — سعر ' + money(app.fee) + ' (كاش) — بدأت صلاحية 30 يوماً من الآن' +
      (preJob ? ' | الوظيفة المختارة: ' + preJob.code + ' — ' + preJob.title
              : ' | بلا اختيار وظيفة — الفرصتان بانتظار اختيار الزبون بنفسه'));
    var applied = null;
    if (preJob) {
      applied = selectAttempt(serial, preJob.code, { byPos: true });
      if (!applied.ok) applied = null;   /* البطاقة تفعّلت والاختيار فشل (سباق) */
    }
    save(); emit();
    return { ok: true, app: app, attempt: applied ? applied.attempt : null, job: applied ? applied.job : null };
  }

  /* أحدث تقديم قيد اللعب: قد تكون الفرصتان محجوزتين معاً (وظيفة نقطة البيع
     + تقديم الزبون الذاتي) — الاستمارة A4 وصفحة صاحب العمل تعرضان الأحدث،
     فهو التقديم الذي يلاحقه الزبون الآن ويحمله لصاحب العمل. */
  function latestInPlay(serial) {
    var list = getAttempts(serial).filter(function (t) {
      return t.slotStatus === 'reserved' || t.slotStatus === 'critical' || t.slotStatus === 'hiring';
    });
    list.sort(function (a, b) {
      var da = new Date(a.selectedAt || 0).getTime();
      var db = new Date(b.selectedAt || 0).getTime();
      if (db !== da) return db - da;
      return (b.no || 0) - (a.no || 0);
    });
    return list[0] || null;
  }

  /* عرض صاحب العمل (قرار الإدارة: الباركود وحده يكفي — الورقة بيد صاحب
     العمل): تفاصيل الزبون والتقديم الجاري وبيانات التواصل بصاحب العمل،
     وبلا رموز الفرص (سرّ الزبون لفرصته الثانية). */
  function employerView(serial) {
    serial = String(serial || '').trim().toUpperCase();
    var app = getApplicant(serial);
    if (!app) return { ok: false, code: 'not_found', error: 'لا توجد بطاقة بهذا الباركود' };
    if (app.status === 'blank') return { ok: false, code: 'blank', error: 'هذه البطاقة فارغة ولم تُبع بعد' };
    if (app.status === 'pending') return { ok: false, code: 'pending', error: 'هذه البطاقة قيد المراجعة لدى الشركة' };
    var attempts = getAttempts(app.serial);
    var current = latestInPlay(app.serial);
    var job = current && current.jobId
      ? db.jobs.filter(function (j) { return j.id === current.jobId; })[0] : null;
    return {
      ok: true,
      card: {
        serial: app.serial,
        fullName: app.fullName,
        phone: app.phone,
        address: app.address || '',
        gender: app.gender || '',
        dob: app.dob || '',
        status: formStatus(app),
        issueDate: app.issueDate,
        expiryDate: app.expiryDate,
        posName: app.posName || '',
        chancesLeft: attemptsLeft(app.serial),
        succeeded: attempts.some(function (t) { return t.slotStatus === 'succeeded'; }),
        applied: current ? {
          no: current.no,
          jobCode: current.jobCode,
          jobTitle: current.jobTitle,
          region: current.location,
          appliedAt: current.selectedAt,
          holdExpiresAt: current.holdExpiresAt,
          slotStatus: current.slotStatus,
          employerDecision: current.employerDecision || null,
          decisionAt: current.decisionAt || null,
          reason: current.reason || '',
          note: current.note || '',
          employer: job ? {
            name: job.employer.name,
            phone: job.employer.phone,
            address: job.employer.address,
            interviewLocation: job.interviewLocation
          } : null
        } : null
      }
    };
  }

  /* طلب صاحب العمل من صفحة الباركود (توظيف / رفض بالسبب) — قرار 2026-10-06:
     • «تم التوظيف»: الوظيفة والفرصة «جاري التوظيف» (مجمّدة بلا مهلة) حتى
       يثبّت موظفو الشركة القرار النهائي.
     • «رفض التوظيف» بسبب مكتوب: الوظيفة والفرصة إلى الحالة «الحرجة» المعلّقة،
       ويقرّر موظف الشركة: إرجاع الوظيفة متاحة أو حذفها (أو التوظيف).
     لا رمز مطلوب: الباركود وحده يكفي (حيازة الورقة). */
  function employerDecide(serial, decision, reason) {
    serial = String(serial || '').trim().toUpperCase();
    if (decision !== 'hire' && decision !== 'reject')
      return { ok: false, error: 'قرار غير صحيح — hire أو reject فقط' };
    var why = String(reason || '').trim();
    if (decision === 'reject' && !why)
      return { ok: false, error: 'سبب عدم التوظيف مطلوب — اكتب سبباً واضحاً للشركة وللمتقدم' };
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الباركود' };
    if (app.status === 'blank') return { ok: false, error: 'هذه البطاقة فارغة ولم تُبع بعد' };
    var slot = latestInPlay(app.serial);
    if (!slot) return { ok: false, error: 'لا يوجد تقديم قيد القرار على هذه البطاقة — راجع الشركة' };
    if (slot.slotStatus === 'hiring' || slot.employerDecision)
      return { ok: false, error: 'طلبك مسجَّل بالفعل — الوظيفة بانتظار قرار الشركة' };
    var job = slot.jobId ? db.jobs.filter(function (j) { return j.id === slot.jobId; })[0] : null;

    slot.employerDecision = decision;
    slot.decisionAt = nowISO();
    slot.holdExpiresAt = null;   /* لا مهلة بعد قرار صاحب العمل: القرار بيد الشركة */

    if (decision === 'hire') {
      slot.slotStatus = 'hiring';
      slot.reason = '';
      slot.note = 'طلب صاحب العمل: تم التوظيف — بانتظار تثبيت الشركة';
      if (job) { job.status = 'hiring'; job.critical = false; job.holdExpiresAt = null; }
    } else {
      slot.slotStatus = 'critical';
      slot.reason = why;
      slot.note = 'رفض صاحب العمل — السبب: ' + why + ' | القرار الآن بيد الشركة: إرجاع الوظيفة متاحة أو حذفها';
      if (job) { job.status = 'reserved'; job.critical = true; job.holdExpiresAt = null; }
    }

    audit(decision === 'hire' ? 'طلب توظيف من صاحب العمل' : 'رفض من صاحب العمل مع السبب',
      'applicant', app.serial,
      'صاحب العمل سجّل عبر صفحة الباركود ' +
      (decision === 'hire' ? 'طلب التوظيف' : 'رفض التوظيف') +
      ' على الوظيفة ' + slot.jobCode + ' — الفرصة #' + slot.no + ' — الزبون ' + app.fullName +
      (decision === 'hire'
        ? ' | الوظيفة «جاري التوظيف» بانتظار قرار الشركة (تثبيت/إلغاء)'
        : ' | السبب: ' + why + ' | الوظيفة «حرجة — معلّقة» بانتظار قرار الشركة: إرجاع متاحة أو حذف'));
    save(); emit();
    return { ok: true, attempt: slot, job: job, decision: decision, reason: why, pending: true };
  }

  function listBlankCards() {
    return db.applicants.filter(function (a) { return a.status === 'blank'; })
      .sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  }

  function createAttempts(serial) {
    for (var i = 1; i <= Number(db.settings.attemptLimit || 2); i++) {
      db.attempts.push({
        id: uid('att'), serial: serial, no: i, code: chanceCode(),
        jobId: null, jobCode: null, jobTitle: null,
        location: null, employerName: null, employerPhone: null, slotStatus: 'empty',
        selectedAt: null, holdExpiresAt: null, closedAt: null, note: '', staff: null,
        employerDecision: null, decisionAt: null
      });
    }
  }

  /* قبول طلب بطاقة قيد المراجعة ⇒ تتحول لبطاقة رسمية سارية */
  function approveApplicant(serial) {
    var app = getApplicant(serial);
    if (!app || app.status !== 'pending') return { ok: false, error: 'الطلب غير موجود أو ليس قيد المراجعة' };
    var issue = new Date();
    app.status = 'active';
    app.issueDate = issue.toISOString();
    app.expiryDate = addDays(issue, Number(db.settings.validityDays || 30)).toISOString();
    if (!getAttempts(serial).length) createAttempts(serial);
    audit('قبول طلب بطاقة', 'applicant', serial, 'قبول طلب الباحث ' + app.fullName + ' — صدرت البطاقة رسمياً برقم ' + serial);
    save(); emit();
    return { ok: true, app: app };
  }

  /* رفض طلب بطاقة قيد المراجعة */
  function rejectApplicant(serial, reason) {
    var app = getApplicant(serial);
    if (!app || app.status !== 'pending') return { ok: false, error: 'الطلب غير موجود أو ليس قيد المراجعة' };
    app.status = 'rejected';
    app.rejectReason = reason || '';
    audit('رفض طلب بطاقة', 'applicant', serial, 'رفض طلب الباحث ' + app.fullName + (reason ? ' — السبب: ' + reason : ''));
    save(); emit();
    return { ok: true, app: app };
  }

  function getApplicant(serial) {
    return db.applicants.filter(function (a) { return a.serial === serial || a.id === serial; })[0] || null;
  }

  function listApplicants(f) {
    f = f || {};
    var rows = db.applicants.map(function (a) {
      var copy = Object.assign({}, a);
      copy.attempts = getAttempts(a.serial);
      copy.attemptsUsed = copy.attempts.filter(function (t) { return t.slotStatus !== 'empty'; }).length;
      copy.daysLeft = a.expiryDate ? diffDays(a.expiryDate, new Date()) : null;
      copy.holds = copy.attempts.filter(function (t) { return t.slotStatus === 'reserved'; }).length;
      return copy;
    });
    if (f.status && f.status !== 'all') rows = rows.filter(function (a) { return a.status === f.status; });
    if (f.user && f.user !== 'all') rows = rows.filter(function (a) { return a.createdBy === f.user; });
    if (f.q) {
      var q = f.q.trim().toLowerCase();
      rows = rows.filter(function (a) {
        return (a.serial + ' ' + a.fullName + ' ' + a.phone + ' ' + a.address).toLowerCase().indexOf(q) >= 0;
      });
    }
    return rows.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  }

  function getAttempts(serial) {
    return db.attempts.filter(function (t) { return t.serial === serial; })
      .sort(function (a, b) { return a.no - b.no; });
  }

  /* الخانة الفعّالة: أول فرصة فارغة — كل فرصة (1..2) تُستخدم مرة واحدة فقط،
     والمرفوضة/المنتهية تبقى مسجّلة في تاريخ البطاقة دون إعادة استخدام. */
  function activeAttempt(serial) {
    return getAttempts(serial).filter(function (t) { return t.slotStatus === 'empty'; })[0] || null;
  }

  function attemptsLeft(serial) {
    return getAttempts(serial).filter(function (t) { return t.slotStatus === 'empty'; }).length;
  }

  /* حالة البطاقة — التوظيف لا ينهي البطاقة (يبقى للزبون حقه في فرصته
     الثانية حتى نهاية المدة): تنتهي البطاقة بانتهاء 30 يوماً أو استنفاد الفرصتين. */
  function formStatus(app) {
    if (!app) return 'active';
    /* بطاقة فارغة بالمخزن: لم تُبع بعد — لا تواريخ ولا فرص مستخدمة.
       (يجب أن يسبق فحص الانتهاء: الفارغة بلا تاريخ انتهاء أصلاً) */
    if (app.status === 'blank') return 'blank';
    if (app.status === 'pending') return 'pending';
    if (app.status === 'rejected') return 'rejected';
    if (new Date(app.expiryDate).getTime() < Date.now()) return 'expired';
    /* «سارية» ما دامت فرصة قيد اللعب (حجز جارٍ أو حالة حرجة بانتظار قرار) —
       أما «استُهلكت الفرصتان» فتعني انتهاء كل الفرص بنتيجة نهائية. */
    var inPlay = getAttempts(app.serial).some(function (t) {
      return t.slotStatus === 'reserved' || t.slotStatus === 'critical' || t.slotStatus === 'hiring';
    });
    if (attemptsLeft(app.serial) === 0 && !inPlay) return 'exhausted';
    return 'active';
  }

  /* ======================= الفرص: الاختيار والنتائج ======================= */

  function selectAttempt(serial, jobCode, opts) {
    opts = opts || {};
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'البطاقة غير موجودة' };
    var st = formStatus(app);
    if (st === 'pending') return { ok: false, error: 'الطلب قيد المراجعة — اقبل الطلب أولاً قبل الترشيح' };
    if (st === 'rejected') return { ok: false, error: 'الطلب مرفوض — لا يمكن الترشيح عليه' };
    if (st === 'expired') return { ok: false, error: 'انتهت صلاحية البطاقة (30 يوماً)' };
    var job = getJob(jobCode);
    if (!job) return { ok: false, error: 'الوظيفة غير موجودة' };
    if (job.status !== 'available') return { ok: false, error: 'الوظيفة غير متاحة حالياً (' + CFG.jobStatus[job.status].ar + ')' };
    /* منع استهلاك الفرصتين على نفس الوظيفة */
    if (getAttempts(serial).some(function (t) { return t.jobId === job.id && t.slotStatus !== 'empty'; }))
      return { ok: false, error: 'هذه البطاقة قُدِّمت على هذه الوظيفة من قبل — اختر وظيفة أخرى' };
    var slot = activeAttempt(serial);
    if (!slot) return { ok: false, error: 'لا توجد فرص متاحة — استُهلكت فرص البطاقة (' + (db.settings.attemptLimit || 2) + ')' };

    var hours = Number(db.settings.holdHours || 24);
    slot.jobId = job.id; slot.jobCode = job.code; slot.jobTitle = job.title;
    slot.location = job.region; slot.employerName = job.employer.name; slot.employerPhone = job.employer.phone;
    slot.slotStatus = 'reserved';
    slot.selectedAt = nowISO();
    slot.holdExpiresAt = addHours(new Date(), hours).toISOString();
    slot.staff = currentUser() ? currentUser().username : 'system';

    job.status = 'reserved';
    job.reservedBy = serial;
    job.holdExpiresAt = slot.holdExpiresAt;

    audit('حجز مؤقت لوظيفة', 'job', job.code,
      'الفرصة #' + slot.no + ' للبطاقة ' + serial + ' — تعليق الوظيفة ' + hours + ' ساعة حتى ' + fmtDateTime(slot.holdExpiresAt) +
      (opts.byCustomer ? ' | تقديم ذاتي من الزبون برمز الفرصة' : ''));
    save(); emit();
    return { ok: true, attempt: slot, job: job };
  }

  /* ======================= بطاقتي: واجهة الزبون العامة ======================= */
  /* إثبات حيازة البطاقة: الباركود + رمز إحدى الفرصتين — يُرجع الحمولة
     الكاملة للطباعة (الاسم والهاتف ورمزا الفرصتين). الرمز سرّي على ظهر
     الورقة، فمن يملكه يملك البطاقة (نموذج الحيازة المعتمد). */
  function cardVerifyCode(serial, code) {
    serial = String(serial || '').trim().toUpperCase();
    code = String(code || '').trim().toUpperCase();
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الباركود' };
    var slot = getAttempts(serial).filter(function (t) {
      return String(t.code || '').toUpperCase() === code;
    })[0];
    if (!slot) return { ok: false, error: 'رمز الفرصة غير صحيح — انسخه كما هو من ظهر بطاقتك' };
    return { ok: true, app: app, attempts: getAttempts(serial) };
  }



  /* عرض آمن للبطاقة للزبون نفسه (بالباركود): بلا رموز الفرص وبلا بيانات صاحب
     العمل — هذه أصول الشركة. الرمز سرّي يدخله الزبون من ورقته عند التقديم. */
  function lookupCard(serial) {
    var app = getApplicant(String(serial || '').trim().toUpperCase());
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على بطاقتك' };
    if (app.status === 'pending') return { ok: false, error: 'هذه البطاقة قيد المراجعة لدى الشركة' };
    if (app.status === 'blank') return { ok: false, error: 'هذه البطاقة فارغة ولم تُبع بعد — إذا عُرضت لك للبيع فخابر الشركة فوراً لتفادي التزوير' };
    var attempts = getAttempts(app.serial).map(function (t) {
      return {
        no: t.no, slotStatus: t.slotStatus,
        jobCode: t.jobCode, jobTitle: t.jobTitle, location: t.location,
        selectedAt: t.selectedAt, holdExpiresAt: t.holdExpiresAt,
        note: t.slotStatus === 'rejected' || t.slotStatus === 'expired' ? (t.note || '') : ''
      };
    });
    return {
      ok: true,
      card: {
        serial: app.serial,
        fullName: maskName(app.fullName),
        phone: maskPhone(app.phone),
        status: formStatus(app),
        issueDate: app.issueDate,
        expiryDate: app.expiryDate,
        chancesLeft: attemptsLeft(app.serial),
        chances: attempts,
        succeeded: attempts.some(function (t) { return t.slotStatus === 'succeeded'; })
      }
    };
  }

  /* التقديم الذاتي من الزبون: الباركود + رمز الفرصة + الوظيفة.
     الرمز سرّ مطبوع على ظهر بطاقته — لا تُستهلك فرصة بدونه. */
  function useChance(serial, code, jobCode) {
    serial = String(serial || '').trim().toUpperCase();
    code = String(code || '').trim().toUpperCase();
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الباركود' };
    var st = formStatus(app);
    if (st === 'blank') return { ok: false, error: 'هذه البطاقة فارغة ولم تُبع بعد' };
    if (st === 'expired') return { ok: false, error: 'انتهت صلاحية البطاقة (30 يوماً)' };
    if (st === 'exhausted') return { ok: false, error: 'استُهلكت فرص البطاقة — تشترى بطاقة جديدة من نقاط البيع' };
    var slot = getAttempts(serial).filter(function (t) {
      return t.slotStatus === 'empty' && String(t.code || '').toUpperCase() === code;
    })[0];
    if (!slot) return { ok: false, error: 'رمز الفرصة غير صحيح — انسخ الرمز المطبوع على ظهر بطاقتك كما هو' };
    var res = selectAttempt(serial, jobCode, { byCustomer: true });
    if (!res.ok) return res;
    audit('تقديم ذاتي ببطاقة', 'applicant', serial,
      'الزبون ' + app.fullName + ' استخدم الفرصة #' + slot.no + ' بنفسه من الموقع على الوظيفة ' + jobCode);
    save();
    return res;
  }


  /* توجيه موحّد «بطاقتي»: سحابة إن كانت مفعّلة (RPC عامة آمنة)، وإلا محلياً */
  function cardLookup(serial) {
    var st = cloudStatus();
    if (st.configured && st.state === 'on' && root.HRCCloud && root.HRCCloud.lookupCard && cloud.client) {
      return root.HRCCloud.lookupCard(cloud.client, serial);
    }
    return Promise.resolve(lookupCard(serial));
  }

  function cardUseChance(serial, code, jobCode) {
    var st = cloudStatus();
    if (st.configured && st.state === 'on' && root.HRCCloud && root.HRCCloud.useChance && cloud.client) {
      return root.HRCCloud.useChance(cloud.client, serial, code, jobCode);
    }
    return Promise.resolve(useChance(serial, code, jobCode));
  }

  /* تفعيل من نقطة البيع عبر الموقع العام: سحابة إن فُعّلت وإلا محلياً */
  function cardActivate(serial, data) {
    var st = cloudStatus();
    if (st.configured && st.state === 'on' && root.HRCCloud && root.HRCCloud.activateCard && cloud.client) {
      return root.HRCCloud.activateCard(cloud.client, serial, data);
    }
    return Promise.resolve(activateCard(serial, data));
  }

  /* صفحة صاحب العمل: الباركود وحده يكفي — بلا أي رمز وبلا نافذة prompt
     (قرار الإدارة 2026-10-06: حيازة الورقة = التحكم). */
  function cardEmployerView(serial) {
    var st = cloudStatus();
    if (st.configured && st.state === 'on' && root.HRCCloud && root.HRCCloud.employerView && cloud.client) {
      return root.HRCCloud.employerView(cloud.client, serial);
    }
    return Promise.resolve(employerView(serial));
  }

  /* قرار صاحب العمل (توظيف / رفض بالسبب) من صفحة الباركود — بلا رمز */
  function cardEmployerDecide(serial, decision, reason) {
    var st = cloudStatus();
    if (st.configured && st.state === 'on' && root.HRCCloud && root.HRCCloud.employerDecide && cloud.client) {
      return root.HRCCloud.employerDecide(cloud.client, serial, decision, reason);
    }
    return Promise.resolve(employerDecide(serial, decision, reason));
  }

  function cardVerify(serial, code) {
    var st = cloudStatus();
    if (st.configured && st.state === 'on' && root.HRCCloud && root.HRCCloud.verifyCardCode && cloud.client) {
      return root.HRCCloud.verifyCardCode(cloud.client, serial, code).then(function (r) {
        if (!r || !r.ok) return r || { ok: false, error: 'تعذّر التحقق' };
        /* نحوّل حمولة القاعدة إلى شكل app/attempts الذي يفهمه قالب الطباعة */
        var d = r.data || {};
        return {
          ok: true,
          app: {
            id: d.id || null, serial: d.serial, fullName: d.fullName, phone: d.phone,
            issueDate: d.issueDate, expiryDate: d.expiryDate, posName: d.posName || ''
          },
          attempts: (d.attempts || []).map(function (a) {
            return {
              no: a.no, code: a.code, slotStatus: a.slotStatus, jobCode: a.jobCode,
              jobTitle: a.jobTitle, location: a.location, selectedAt: a.selectedAt,
              holdExpiresAt: a.holdExpiresAt, closedAt: a.closedAt, note: a.note || ''
            };
          })
        };
      });
    }
    return Promise.resolve(cardVerifyCode(serial, code));
  }

  /* ======================= النتائج ======================= */
  /* نتيجة المقابلة: succeeded | rejected — كلتاهما تستهلك الفرصة ولا تعود،
     لكن التوظيف لا يُنهي البطاقة: يبقى للزبون حقه في فرصته الأخرى حتى
     نهاية مدة البطاقة (30 يوماً). */
  function setOutcome(serial, no, outcome, note) {
    var slot = getAttempts(serial).filter(function (t) { return t.no === Number(no); })[0];
    if (!slot) return { ok: false, error: 'الفرصة غير موجودة' };
    var job = slot.jobId ? db.jobs.filter(function (j) { return j.id === slot.jobId; })[0] : null;
    slot.slotStatus = outcome;
    slot.closedAt = nowISO();
    slot.note = note || slot.note;
    slot.holdExpiresAt = null;

    if (job) {
      if (outcome === 'succeeded') { job.status = 'closed'; job.reservedBy = null; job.holdExpiresAt = null; job.critical = false; job.closedAt = nowISO(); }
      else { job.status = 'available'; job.reservedBy = null; job.holdExpiresAt = null; job.critical = false; }
    }
    // تفعيل الفرصة التالية تلقائياً (أول خانة فارغة متبقية على البطاقة)
    var next = null;
    if (outcome === 'rejected') next = activeAttempt(serial);
    audit(outcome === 'succeeded' ? 'إتمام توظيف' : 'رفض مرشح',
      'attempt', serial + ' / #' + no,
      (job ? job.code + ' — ' + job.title : '') + ' | ' +
      (outcome === 'succeeded'
        ? 'تم التوظيف وإغلاق الوظيفة — وتبقى فرصة الزبون الأخرى محفوظة حتى نهاية مدة البطاقة'
        : 'إعادة الوظيفة إلى (متاحة) وتفعيل الفرصة #' + (next ? next.no : '—') + ' تلقائياً') +
      (note ? ' | ملاحظة: ' + note : ''));
    save(); emit();
    return { ok: true, attempt: slot, job: job, nextAttempt: next };
  }

  /* إقرار الموظف بعد الحالة الحرجة: إرجاع الوظيفة متوفرة — الفرصة تبقى
     مستهلكة (قرار معتمد: لا تعود الفرصة بأي نتيجة). */
  function releaseHold(serial, no, reason) {
    var slot = getAttempts(serial).filter(function (t) { return t.no === Number(no); })[0];
    if (!slot) return { ok: false, error: 'الفرصة غير موجودة' };
    var job = slot.jobId ? db.jobs.filter(function (j) { return j.id === slot.jobId; })[0] : null;
    slot.slotStatus = 'expired';
    slot.closedAt = nowISO();
    slot.holdExpiresAt = null;
    slot.note = reason || 'قرار الشركة بعد انتهاء مهلة الحجز — استُهلكت الفرصة وأُعيدت الوظيفة متوفرة';
    if (job) { job.status = 'available'; job.reservedBy = null; job.holdExpiresAt = null; job.critical = false; }
    audit('إرجاع وظيفة بعد حرجة', 'job', job ? job.code : '—',
      'الفرصة #' + no + ' للبطاقة ' + serial + ' — أُعيدت الوظيفة إلى (متاحة) | ' + slot.note);
    save(); emit();
    return { ok: true, attempt: slot, job: job };
  }

  /* ======================= الصيانة التلقائية ======================= */

  /* تُنفّذ عند تحميل الصفحة وكل 30 ثانية وكل دقيقة على الواجهة.
     نظام البطاقات (2026-09-30): لا إفراج تلقائي — الوظيفة التي تنتهي مهلة
     حجزها (24 ساعة) دون قرار تنتقل هي وفرصة الزبون إلى حالة «حرجة»
     بانتظار قرار الموظف: تم التوظيف / إرجاعها متوفرة / حذفها. */
  function runMaintenance() {
    /* في الوضع السحابي بلا جلسة موظف: لا كتابة إطلاقاً. أي تعديل هنا يُرفض من
       RLS (42501) ويبقى في قائمة انتظار الدفع يعيد المحاولة بلا نهاية — والصيانة
       الحقيقية تجري في القاعدة نفسها (pg_cron → brc.run_auto_release). */
    if (cloud.state === 'on' && cloud.role !== 'staff') return [];
    var actions = [];
    var now = new Date();

    // 1) الحجوزات المنتهية (24 ساعة) ← حالة «حرجة» بانتظار قرار الموظف
    db.jobs.forEach(function (job) {
      if (job.status !== 'reserved' || !job.holdExpiresAt) return;
      if (new Date(job.holdExpiresAt).getTime() > now.getTime()) return;
      var slot = db.attempts.filter(function (t) {
        return t.serial === job.reservedBy && t.jobId === job.id && t.slotStatus === 'reserved';
      })[0];
      /* الوظيفة تبقى مقفلة (محجوزة) حتى القرار — لا يقدم عليها غيره */
      job.holdExpiresAt = null;
      job.critical = true;
      if (slot) {
        slot.slotStatus = 'critical';
        slot.holdExpiresAt = null;
        slot.note = 'انتهت مهلة 24 ساعة دون قرار — بانتظار قرار الشركة (توظيف / إرجاع / حذف)';
      }
      db.audit.unshift({
        id: uid('log'), ts: now.toISOString(), user: 'system', role: 'system', name: 'النظام (تلقائي)',
        ip: localIp(), action: 'حالة حرجة (انتهاء 24 ساعة)', entity: 'job', entityId: job.code,
        details: 'انتهت مهلة الحجز دون قرار — الوظيفة بانتظار قرار الموظف: تم التوظيف أو إرجاعها متوفرة أو حذفها' +
          (slot ? ' | الفرصة #' + slot.no + ' للبطاقة ' + slot.serial : '')
      });
      actions.push({ type: 'criticalHold', job: job.code, serial: job.reservedBy });
    });

    // 2) انتهاء صلاحية البطاقات (30 يوماً)
    db.applicants.forEach(function (app) {
      if (app.status === 'active' && new Date(app.expiryDate).getTime() < now.getTime()) {
        app.status = 'expired';
        db.audit.unshift({
          id: uid('log'), ts: now.toISOString(), user: 'system', role: 'system', name: 'النظام (تلقائي)',
          ip: localIp(), action: 'انتهاء بطاقة', entity: 'applicant', entityId: app.serial,
          details: 'انتهت صلاحية البطاقة (30 يوماً) بتاريخ ' + fmtDate(app.expiryDate)
        });
        actions.push({ type: 'formExpired', serial: app.serial });
      }
    });
    if (actions.length) { save(); emit(); }
    return actions;
  }

  /* ======================= التحقق (QR) ======================= */

  /* رابط التحقق المطبوع في الكيو آر كود.
     يتبع نطاق الموقع المنشور تلقائياً (مثل *.pages.dev أو النطاق الرسمي)،
     ويرجع إلى الرابط الرسمي عند العمل محلياً (ملف على الجهاز أو نسخة مستقلة). */
  function verifyBaseUrl() {
    if (CFG.autoVerifyBase !== false && typeof location !== 'undefined' && location &&
        /^https?:$/.test(location.protocol) && location.origin) {
      return location.origin + location.pathname.replace(/[^/]*$/, '') + 'verify';
    }
    return CFG.verifyBase;
  }

  function verifyUrl(serial) { return verifyBaseUrl() + '?form=' + encodeURIComponent(serial) + '&t=' + token(serial); }
  function verifyLocalUrl(serial) { return CFG.verifyLocal + '?form=' + encodeURIComponent(serial) + '&t=' + token(serial); }

  /* QR بطاقة التوظيف يفتح رحلة التقديم الذاتية مباشرةً على صفحة الترحيب؛
     صفحة التقديم تقرأ رقم البطاقة من الرابط وتعرض البيانات بعد ضغط «ابدأ الآن». */
  function cardUrl(serial) {
    var base;
    if (CFG.autoVerifyBase !== false && typeof location !== 'undefined' && location &&
        /^https?:$/.test(location.protocol) && location.origin) {
      base = location.origin + location.pathname.replace(/[^/]*$/, '');
    } else {
      base = String(CFG.verifyBase || '').replace(/verify\/?$/, '');
    }
    return base + 'apply.html?form=' + encodeURIComponent(serial);
  }

  /* تقنيع للعرض العام بلا بصمة مطابقة — مطابق لدالتي brc.mask_name/mask_phone
     في القاعدة حتى يكون سلوك الوضعين واحداً (المحلي والسحابي). */
  function maskName(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (s.length <= 2) return s.slice(0, 1) + '…';
    return s.slice(0, 1) + new Array(Math.min(s.length - 1, 12) + 1).join('•');
  }
  function maskPhone(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (s.length <= 5) return s.slice(0, 2) + '•••';
    return s.slice(0, 4) + new Array(Math.max(s.length - 6, 1) + 1).join('•') + s.slice(-2);
  }

  function verify(serial, t) {
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الرقم', serial: serial };
    var validToken = token(serial);
    var tokenOk = !!t && t === validToken;
    /* ⚠️ بلا بصمة مطابقة تُقنَّع بيانات الباحث في الرد نفسه (لا في العرض فقط):
       الأرقام التسلسلية متتابعة، فلو أظهرنا الاسم والهاتف لكل من يُدخل رقماً
       لتساءل أي زائر أسماء وهواتف كل الباحثين بنداءات متسلسلة. البصمة المطبوعة
       في الكيو آر كود هي المفتاح؛ ومن يُدخل الرقم يدوياً يراه مقنّعاً. */
    var masked = !tokenOk;
    var payload = {
      ok: true,
      serial: app.serial,
      fullName: masked ? maskName(app.fullName) : app.fullName,
      phone: masked ? maskPhone(app.phone) : app.phone,
      masked: masked,
      issueDate: app.issueDate,
      expiryDate: app.expiryDate,
      createdAt: app.createdAt,
      status: formStatus(app),
      rejectReason: app.rejectReason || '',
      requestedCode: app.requestedCode || null,
      daysLeft: app.expiryDate ? diffDays(app.expiryDate, new Date()) : null,
      attemptsLeft: attemptsLeft(app.serial),
      attemptsUsed: getAttempts(app.serial).filter(function (x) { return x.slotStatus !== 'empty'; }).length,
      attemptLimit: Number(db.settings.attemptLimit || 2),
      createdBy: app.createdBy,
      attempts: getAttempts(app.serial).map(function (x) {
        return {
          no: x.no, jobCode: x.jobCode || '—', jobTitle: x.jobTitle || '—', location: x.location || '—',
          employerPhone: x.employerPhone || '—', slotStatus: x.slotStatus, note: x.note || '',
          selectedAt: x.selectedAt, holdExpiresAt: x.holdExpiresAt, closedAt: x.closedAt
        };
      }),
      tokenOk: tokenOk,
      verifiedAt: nowISO()
    };
    audit('تحقق من بطاقة (QR)', 'applicant', app.serial,
      'فحص عبر رابط التحقق' + (!t ? ' — بلا بصمة (عرض مقنّع)' : (tokenOk ? ' — بصمة صحيحة' : ' — تحذير: بصمة غير مطابقة')));
    save();
    return payload;
  }

  /* ======================= الإحصاءات والمالية ======================= */

  function stats() {
    return {
      totalJobs: db.jobs.length,
      available: db.jobs.filter(function (j) { return j.status === 'available'; }).length,
      reserved: db.jobs.filter(function (j) { return j.status === 'reserved'; }).length,
      closed: db.jobs.filter(function (j) { return j.status === 'closed'; }).length,
      forms: db.applicants.length,
      activeForms: db.applicants.filter(function (a) { return formStatus(a) === 'active'; }).length,
      pendingForms: db.applicants.filter(function (a) { return formStatus(a) === 'pending'; }).length,
      blankForms: db.applicants.filter(function (a) { return formStatus(a) === 'blank'; }).length,
      expiredForms: db.applicants.filter(function (a) { return formStatus(a) === 'expired'; }).length,
      hires: db.attempts.filter(function (t) { return t.slotStatus === 'succeeded'; }).length
    };
  }

  /* لوحة مالية: عدد البطاقات المطبوعة والمبالغ المتوقعة لكل موظف */
  function financials(from, to) {
    var rows = {};
    db.applicants.forEach(function (a) {
      /* استمارة قيد الطلب (issueDate = null) لا تنتمي لأي يوم: كانت تُقارَن
         بـ null فتمرّ في كل نطاق — وهذا يُفسد فلتر «اليوم/أمس». */
      if ((from || to) && !a.issueDate) return;
      if (from && a.issueDate < from) return;
      if (to && a.issueDate > to + 'T23:59:59') return;
      var key = a.createdBy || 'system';
      rows[key] = rows[key] || { user: key, forms: 0, printed: 0, expected: 0, collected: 0, hires: 0, holds: 0, paid: 0, unpaid: 0, partial: 0 };
      rows[key].forms++;
      var fee = Number(a.fee != null ? a.fee : db.settings.formFee);
      rows[key].printed += Number(a.printedCount || 0);
      rows[key].expected += fee;
      
      // Track payment status
      var paidAmount = Number(a.paidAmount || 0);
      if (paidAmount >= fee) {
        rows[key].collected += fee;
        rows[key].paid++;
      } else if (paidAmount > 0) {
        rows[key].collected += paidAmount;
        rows[key].partial++;
      } else if (a.feePaid) {
        rows[key].collected += fee;
        rows[key].paid++;
      } else {
        rows[key].unpaid++;
      }
      
      rows[key].hires += getAttempts(a.serial).filter(function (t) { return t.slotStatus === 'succeeded'; }).length;
      rows[key].holds += getAttempts(a.serial).filter(function (t) { return t.slotStatus === 'reserved'; }).length;
    });
    var out = Object.keys(rows).map(function (k) { return rows[k]; });
    out.forEach(function (r) {
      var u = CFG.users.filter(function (x) { return x.username === r.user; })[0];
      r.name = u ? u.name : r.user;
    });
    return out.sort(function (a, b) { return b.expected - a.expected; });
  }

  function financialTotals(from, to) {
    var rows = financials(from, to);
    return rows.reduce(function (t, r) {
      t.forms += r.forms; t.printed += r.printed; t.expected += r.expected;
      t.collected += r.collected; t.hires += r.hires; t.holds += r.holds;
      return t;
    }, { forms: 0, printed: 0, expected: 0, collected: 0, hires: 0, holds: 0 });
  }

  function pendingActions() {
    var out = { holds: [], critical: [], hiring: [], expired: [], exhausted: [], rejected: [], requests: [] };
    db.jobs.forEach(function (j) {
      if (j.status === 'reserved' && j.holdExpiresAt) {
        var h = diffHours(j.holdExpiresAt, new Date());
        out.holds.push({ job: j, hoursLeft: h, serial: j.reservedBy });
      }
      /* الحالة الحرجة: انتهت مهلة 24 ساعة دون قرار **أو** رفض صاحب العمل
         بسبب مكتوب — الوظيفة معلّقة بانتظار الموظف: إرجاع متاحة أو حذف */
      if (j.status === 'reserved' && !j.holdExpiresAt && j.critical) {
        var ct = db.attempts.filter(function (x) {
          return x.jobId === j.id && x.slotStatus === 'critical';
        })[0];
        out.critical.push({
          job: j, serial: j.reservedBy, attempt: ct || null,
          decidedBy: ct && ct.employerDecision === 'reject' ? 'employer' : 'hold',
          reason: (ct && ct.reason) || '', at: ct ? ct.decisionAt : null
        });
      }
      /* جاري التوظيف: طلب صاحب العمل بانتظار تثبيت الشركة (ج4 — 2026-10-01) */
      if (j.status === 'hiring') {
        var t = db.attempts.filter(function (x) {
          return x.jobId === j.id && x.slotStatus === 'hiring';
        })[0];
        out.hiring.push({ job: j, serial: j.reservedBy, decision: t ? t.employerDecision : null, at: t ? t.decisionAt : null });
      }
    });
    db.applicants.forEach(function (a) {
      var st = formStatus(a);
      if (st === 'pending') { out.requests.push(a); return; }
      if (st === 'rejected') return;
      var used = getAttempts(a.serial).filter(function (t) { return t.slotStatus !== 'empty'; }).length;
      if (st === 'expired') out.expired.push(a);
      else if (used >= Number(db.settings.attemptLimit || 2)) out.exhausted.push(a);
      var rej = getAttempts(a.serial).filter(function (t) { return t.slotStatus === 'rejected'; });
      if (rej.length) out.rejected.push({ applicant: a, count: rej.length });
    });
    return out;
  }

  function markPrinted(serial) {
    var app = getApplicant(serial); if (!app) return;
    app.printedCount = Number(app.printedCount || 0) + 1;
    audit('طباعة بطاقة', 'applicant', serial, 'طباعة بطاقة التوظيف 86×54مم مع باركود QR — العدد الكلي ' + app.printedCount);
    save(); emit();
  }

  function setFeePaid(serial, paid, amount) {
    var app = getApplicant(serial); if (!app) return;
    var fee = Number(app.fee != null ? app.fee : db.settings.formFee);
    
    if (amount !== undefined) {
      // Partial or full payment with specific amount
      var paidAmount = Number(amount) || 0;
      app.paidAmount = paidAmount;
      app.feePaid = paidAmount >= fee;
      
      if (paidAmount >= fee) {
        audit('تسجيل استلام رسم كامل', 'applicant', serial, 'المبلغ: ' + money(paidAmount) + ' من ' + money(fee));
      } else if (paidAmount > 0) {
        audit('تسجيل دفعة جزئية', 'applicant', serial, 'المبلغ: ' + money(paidAmount) + ' من ' + money(fee) + ' — المتبقي: ' + money(fee - paidAmount));
      } else {
        audit('إلغاء تسجيل الرسم', 'applicant', serial, 'رسم الاستمارة: ' + money(fee));
      }
    } else {
      // Legacy behavior: mark as fully paid or unpaid
      app.feePaid = !!paid;
      app.paidAmount = paid ? fee : 0;
      audit(paid ? 'تسجيل استلام رسم' : 'إلغاء تسجيل الرسم', 'applicant', serial, 'رسم الاستمارة: ' + money(fee));
    }
    
    save(); emit();
  }

  function resetDemo() {
    /* ⚠️ في الوضع السحابي «إعادة الضبط» تعني: حذف كل وظائف القاعدة واستماراتها
       وإدراج البيانات التجريبية مكانها — عملية تدميرية للمشروع كله. ممنوعة هنا
       بحسم؛ من يحتاجها فعلاً يُفرغ الجداول من Supabase مباشرةً. */
    if (cloud.state === 'on' && cloud.role === 'staff') {
      console.warn('[HRC] إعادة الضبط مرفوضة في الوضع السحابي');
      return false;
    }
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
    db = seedDb(); save();
    audit('إعادة ضبط البيانات', 'system', '—', 'إعادة تهيئة قاعدة البيانات المحلية إلى البيانات التجريبية');
    save(); emit();
  }

  function exportJson() { return JSON.stringify(db, null, 2); }

  function importJson(text) {
    /* نفس منطق إعادة الضبط: الاستيراد يستبدل كل البيانات، ولو مرّ في الوضع
       السحابي لمحا ما في القاعدة ودفع الملف المحلي مكانه. */
    if (cloud.state === 'on' && cloud.role === 'staff') {
      throw new Error('الاستيراد مرفوض في الوضع السحابي — البيانات مرجعها القاعدة');
    }
    var parsed = JSON.parse(text);
    if (!parsed.jobs || !parsed.applicants) throw new Error('ملف غير صالح');
    db = parsed; save();
    normalizeSerialLog();
    audit('استيراد بيانات', 'system', '—', 'استيراد نسخة احتياطية تحتوي ' + parsed.jobs.length + ' وظيفة و' + parsed.applicants.length + ' استمارة');
    save(); emit();
  }

  /* ======================= النسخ الاحتياطي المجدول =======================
   *  ⚠ هذه الدوال يجب أن تبقى *داخل* نطاق الوحدة (IIFE) لأنها تستخدم
   *    db / save / emit / audit / nowISO. وضعها بعد قوس الإغلاق يجعل كل
   *    أزرار النسخ الاحتياطي والجدولة تفشل بصمت في المتصفح
   *    (ReferenceError: nowISO is not defined) — وهذا ما حدث سابقاً.
   * ===================================================================== */

  var BACKUP_KEY = 'hrc-scheduled-backups';
  var SCHEDULE_KEY = 'hrc-auto-backup-schedule';
  var AUTO_RUN_KEY = 'hrc-auto-backup-last-run';
  var MAX_BACKUPS = 20;              // نحتفظ بآخر 20 نسخة حمايةً لمساحة المتصفح
  var lastBackupError = null;

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function getScheduledBackups() {
    var list = readJson(BACKUP_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  /* قراءة/حذف "بصمة" النسخة بدون بياناتها الضخمة (للعرض في الواجهة) */
  function listBackupMeta() {
    return getScheduledBackups().map(function (b) {
      return { id: b.id, name: b.name, createdAt: b.createdAt, dateRange: b.dateRange || null, auto: !!b.auto, partial: !!b.partial, size: b.size || 0, records: b.records || null };
    });
  }

  /* كتابة آمنة: عند امتلاء مساحة localStorage نُسقِط الأقدم ونعيد المحاولة
     بدل أن يفشل الحفظ بصمت (وهو سبب آخر محتمل لتعطّل الأزرار). */
  function writeBackups(list) {
    var out = list.slice();
    for (var guard = 0; guard <= list.length; guard++) {
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify(out)); lastBackupError = null; return true; }
      catch (e) {
        if (out.length > 1) { out.shift(); continue; }   // احذف الأقدم واعد المحاولة
        lastBackupError = 'مساحة التخزين في المتصفح ممتلئة — لم يمكن حفظ النسخة.';
        return false;
      }
    }
    lastBackupError = 'مساحة التخزين في المتصفح ممتلئة — لم يمكن حفظ النسخة.';
    return false;
  }

  /* نطاق مخصص: نُبقى الوظائف والإعدادات والعدّادات كاملة (حتى تبقى النسخة
     صالحة للاستعادة) ونُصفّي الاستمارات والمحاولات وسجل التدقيق بالتاريخ. */
  function sliceByRange(snapshot, range) {
    if (!range || (!range.from && !range.to)) return null;
    var from = range.from ? range.from + 'T00:00:00.000Z' : null;
    var to = range.to ? range.to + 'T23:59:59.999Z' : null;
    var inRange = function (ts) {
      if (!ts) return false;
      if (from && ts < from) return false;
      if (to && ts > to) return false;
      return true;
    };
    var out = JSON.parse(JSON.stringify(snapshot));
    var apps = (out.applicants || []).filter(function (a) { return inRange(a.createdAt); });
    var serials = {};
    apps.forEach(function (a) { serials[a.serial] = true; });
    out.applicants = apps;
    out.attempts = (out.attempts || []).filter(function (t) { return serials[t.serial]; });
    out.audit = (out.audit || []).filter(function (l) { return inRange(l.ts); });
    return {
      data: out,
      records: { applicants: apps.length, attempts: out.attempts.length, audit: out.audit.length, jobs: (out.jobs || []).length }
    };
  }

  function saveScheduledBackup(name, dateRange, opts) {
    opts = opts || {};
    if (!db) load();
    var snapshot = JSON.parse(JSON.stringify(db));
    var partial = false, records = null;
    var sliced = sliceByRange(snapshot, dateRange);
    if (sliced) { snapshot = sliced.data; records = sliced.records; partial = true; }

    var backup = {
      id: 'backup-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: (name && String(name).trim()) || ('نسخة ' + fmtDateTime(new Date())),
      createdAt: nowISO(),
      dateRange: dateRange || null,
      auto: !!opts.auto,
      partial: partial,
      records: records,
      size: JSON.stringify(snapshot).length,
      data: snapshot
    };

    var backups = getScheduledBackups();
    backups.push(backup);
    if (backups.length > MAX_BACKUPS) backups = backups.slice(-MAX_BACKUPS);
    if (!writeBackups(backups)) return null;

    audit(opts.auto ? 'نسخة احتياطية تلقائية' : 'نسخة احتياطية', 'backup', backup.id,
      backup.name + ' — ' + (partial ? 'نطاق ' + dateRange.from + ' إلى ' + dateRange.to : 'كل البيانات') +
      ' (' + (backup.size / 1024).toFixed(1) + ' ك.ب)');
    save();
    return backup;
  }

  function deleteScheduledBackup(id) {
    var backups = getScheduledBackups();
    var next = backups.filter(function (b) { return b.id !== id; });
    if (next.length === backups.length) return false;
    if (!writeBackups(next)) return false;
    audit('حذف نسخة احتياطية', 'backup', id, 'تم حذف النسخة الاحتياطية');
    save();
    return true;
  }

  /* استعادة: النسخة الكاملة تُستبدل بالكامل، والنسخة الجزئية (نطاق مخصص)
     تُدمَج حتى لا نفقد الوظائف أو الاستمارات الأخرى الموجودة حالياً. */
  function restoreScheduledBackup(id) {
    var backup = getScheduledBackups().filter(function (b) { return b.id === id; })[0];
    if (!backup || !backup.data) return false;
    try {
      saveScheduledBackup('قبل الاستعادة - ' + fmtDateTime(new Date()), null);
      if (backup.partial) {
        var cur = JSON.parse(JSON.stringify(db));
        var have = {};
        cur.applicants.forEach(function (a) { have[a.serial] = true; });
        (backup.data.applicants || []).forEach(function (a) { if (!have[a.serial]) cur.applicants.push(a); });
        var haveT = {};
        cur.attempts.forEach(function (t) { haveT[t.serial + ':' + t.no] = true; });
        (backup.data.attempts || []).forEach(function (t) { if (!haveT[t.serial + ':' + t.no]) cur.attempts.push(t); });
        var haveL = {};
        cur.audit.forEach(function (l) { haveL[l.id] = true; });
        (backup.data.audit || []).forEach(function (l) { if (!haveL[l.id]) cur.audit.push(l); });
        db = cur;
      } else {
        db = JSON.parse(JSON.stringify(backup.data));
      }
      save();
      audit('استعادة نسخة احتياطية', 'backup', id,
        'تم استعادة النسخة: ' + backup.name + (backup.partial ? ' (دمج نطاق مخصص)' : ' (استبدال كامل)'));
      save(); emit();
      return true;
    } catch (e) { lastBackupError = 'فشل الاستعادة: ' + e.message; return false; }
  }

  function exportScheduledBackup(id) {
    var backup = getScheduledBackups().filter(function (b) { return b.id === id; })[0];
    if (!backup || !backup.data) return null;
    return JSON.stringify(backup.data, null, 2);
  }

  function lastBackupErrorMessage() { return lastBackupError; }

  /* ------------------------- الجدولة التلقائية ------------------------- */
  function getAutoSchedule() {
    var s = readJson(SCHEDULE_KEY, null);
    if (!s || !Array.isArray(s.days) || !s.days.length) return null;
    return { days: s.days, time: s.time || '23:00', createdAt: s.createdAt || null, lastRun: readJson(AUTO_RUN_KEY, null) };
  }

  function saveAutoSchedule(days, time) {
    var s = { days: (days || []).map(Number).filter(function (n) { return n >= 0 && n <= 6; }), time: time || '23:00', createdAt: nowISO() };
    if (!s.days.length) return null;
    if (!writeJson(SCHEDULE_KEY, s)) { lastBackupError = 'تعذّر حفظ الجدولة — مساحة التخزين ممتلئة.'; return null; }
    audit('تفعيل النسخ الاحتياطي المجدول', 'backup', '—', 'الأيام: ' + s.days.join(',') + ' الساعة ' + s.time);
    save();
    return getAutoSchedule();
  }

  function clearAutoSchedule() {
    try { localStorage.removeItem(SCHEDULE_KEY); localStorage.removeItem(AUTO_RUN_KEY); } catch (e) { }
    audit('إيقاف النسخ الاحتياطي المجدول', 'backup', '—', 'أُوقفت الجدولة التلقائية');
    save();
    return true;
  }

  function lastAutoRun() { return readJson(AUTO_RUN_KEY, null); }

  /* محرّك الجدولة: يُستدعى عند تحميل الصفحة وكل 30 ثانية.
     يُنشئ نسخة واحدة فقط لكل "خانة زمنية" (يوم + وقت) حتى لو فُتحت الصفحة
     عدة مرات، ويلتقط النسخة الفائتة في نفس اليوم إذا كان المتصفح مغلقاً. */
  function checkAutoBackup(now) {
    var s = getAutoSchedule();
    if (!s) return null;
    var d = now ? new Date(now) : new Date();
    if (s.days.indexOf(d.getDay()) < 0) return null;
    var parts = String(s.time).split(':');
    var slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
    if (d.getTime() < slot.getTime()) return null;             // لم يحن الوقت بعد
    var slotKey = fmtDate(d) + 'T' + s.time;
    if (readJson(AUTO_RUN_KEY, null) === slotKey) return null;  // نُفّذت مسبقاً
    var backup = saveScheduledBackup('نسخة تلقائية — ' + fmtDateTime(d), null, { auto: true });
    if (!backup) return null;
    writeJson(AUTO_RUN_KEY, slotKey);
    emit();
    return backup;
  }
  /* =========================================================================
   *  طبقة السحابة (Supabase) — الإقلاع، والدفع، والجلسة
   *  -------------------------------------------------------------------------
   *  ثلاث مسؤوليات فقط، وكلها في هذا الموضع وحده:
   *    1) الإقلاع: نجلب الحالة من القاعدة و«نتبنّاها» — نستبدل محتوى كائن db
   *       نفسه (لا نُعيد إسناده) فتبقى كل المراجع في الواجهة صالحة، ثم emit()
   *       ليُعاد الرسم. القراءة بعدها كلها من الذاكرة وبلا انتظار.
   *    2) الدفع: كل save() تُجدول دفعة واحدة مؤجَّلة (debounce) تستدعي
   *       HRCSync.push(db) الذي يشتقّ الفرق المركزي ويرسله.
   *    3) الجلسة: الدخول عبر Supabase Auth والدور من brc.staff، مع استعادة
   *       الجلسة عند تحديث الصفحة.
   *
   *  لماذا لا نمنع العمل عند تعذّر الاتصال؟ لأن المنع يعني «المنظومة متوقفة»
   *  عند أي انقطاع. لذلك نعمل محلياً **بتنبيه صريح** (بانر أحمر دائم يخبر
   *  الموظف أن البيانات غير مشتركة وأن هذا وضع مؤقّت) — والفرق بين وضعين
   *  معروضين بوضوح خير من صمت يظنّ الموظف معه أن عمله محفوظ للجميع.
   * ======================================================================= */

  var CORE_TABLES = ['jobs', 'applicants', 'job_attempts'];
  var PUSH_DELAY = 700;   // تجميع الحفظ المتلاحق في دفعة واحدة

  var cloud = {
    client: null, sync: null, auth: null,
    state: 'off',          // off | connecting | on | degraded
    role: 'guest',         // staff | public | guest
    error: null, detail: null, failedTables: [],
    readOnly: false, applying: false, needsReload: false,
    timer: null, pushing: false,
    lastPushAt: null, lastPush: null, lastError: null,
    unsubscribe: null, bootPromise: null, listeners: []
  };

  function cloudCfg() { return root.HRCSupabaseConfig || null; }

  function cloudConfigured() {
    var c = cloudCfg();
    return !!(c && c.enabled && c.url && c.publishableKey);
  }

  /* هل يمكن الإقلاع فعلاً؟ لا يكفي وجود الإعداد: بلا مكتبة سوبابيس أو بلا
     fetch لا معنى للمحاولة — نُعلن الوضع المحلي صراحةً بدل انتظار طويل صامت. */
  function hasFetch() {
    var f = root.fetch || (typeof globalThis !== 'undefined' && globalThis.fetch);
    return typeof f === 'function';
  }
  /* أي عميل متاح؟ مكتبة سوبابيس الكاملة (لوحة الموظفين: دخول + لحظي) أو العميل
     المصغّر (الصفحات العامة: قراءة الواجهة العامة ودالتان). */
  function cloudLib() {
    if (root.supabase && root.supabase.createClient) return 'supabase';
    if (root.HRCHttp && root.HRCHttp.createClient) return 'mini';
    return null;
  }

  function cloudWillBoot(opts) {
    if (opts && opts.cloud === false) return false;
    if (!cloudConfigured() || !hasFetch()) return false;
    return !!(cloudLib() && root.HRCCloud && root.HRCSync);
  }

  function pendingQueueLength() {
    if (cloud.sync) return cloud.sync.queueLength();
    try { return (JSON.parse(localStorage.getItem('hrc-cloud-queue') || '[]') || []).length; } catch (e) { return 0; }
  }

  /* هل الدخول من القاعدة حصراً؟ مفتاح صريح في supabase-config.js يملكه المسؤول،
     لأن التحوّل من «كلمات مرور في الكود» إلى «حسابات رسمية» يحتاج لحظة يضبطها
     هو بعد إنشاء الحسابات — لا لحظة يقررها الكود عنه. */
  function enforceAuth() {
    var c = cloudCfg();
    return !!(c && c.enforceAuth);
  }

  /* هل حسابات المطوّر (المكتوبة في config.js) ما زالت فعّالة؟
     تُستخدم لتذكير الظاهر في اللوحة حتى لا تُنسى قبل التسليم: الباب الخلفي
     يبقى ما دام enforceAuth=false وكلمات المرور في الكود. التذكير يختفي
     تلقائياً في اللحظة التي يُغلق فيها الباب. */
  function devAccountsActive() {
    if (enforceAuth()) return false;
    var users = (db && db.settings && db.settings.users) || CFG.users || [];
    return users.length > 0;
  }

  function cloudStatus() {
    return {
      configured: cloudConfigured(), enforceAuth: enforceAuth(), devAccountsActive: devAccountsActive(),
      /* هل سيُقلع الاتصال بالقاعدة فعلاً؟ (الإعداد مفعّل + المتصفح يوفر fetch +
         مكتبة عميل محمّلة). الصفحة العامة تعتمد عليه لقرار مهم: مع willBoot=true
         لا تُعرض للزائر أي بيانات متصفح (seed/كاش) إطلاقاً — بل هيكل تحميل ثم
         بيانات القاعدة أو رسالة فشل. أما بلا fetch (متصفح قديم جداً أو بيئة
         اختبار محلية) فلا معنى لإخفاء البيانات المحلية عن نسخة لا تملك غيرها. */
      willBoot: cloudWillBoot(),
      state: cloud.state, role: cloud.role,
      readOnly: cloud.readOnly, error: cloud.error, detail: cloud.detail,
      failedTables: cloud.failedTables.slice(), pending: pendingQueueLength(),
      lastPushAt: cloud.lastPushAt, lastError: cloud.lastError
    };
  }

  function onCloudStatus(fn) {
    if (typeof fn !== 'function') return function () {};
    cloud.listeners.push(fn);
    return function () { var i = cloud.listeners.indexOf(fn); if (i >= 0) cloud.listeners.splice(i, 1); };
  }
  function notifyCloudStatus() {
    var st = cloudStatus();
    cloud.listeners.forEach(function (fn) { try { fn(st); } catch (e) { } });
  }

  /* رسائل الأخطاء: ترجمة أكواد PostgREST إلى جملة يقولها الموظف للمسؤول
     مباشرةً، مع خطوة الإصلاح — بدل «خطأ غير معروف» في سجل المتصفح. */
  function describeError(err) {
    var e = err || {};
    var code = e.code || (e.error && e.error.code) || '';
    var msg = String(e.message || (e.error && e.error.message) || e || '');
    if (code === 'PGRST205' || /schema cache|does not exist/i.test(msg)) {
      return { text: 'المخطط غير مطبَّق على القاعدة (جدول مفقود)', hint: 'طبّق docs/schema.sql على المشروع' };
    }
    if (code === 'PGRST106' || /exposed|Invalid schema/i.test(msg)) {
      return { text: 'سكيما brc غير مُعرَّضة للمشروع', hint: 'Settings → API → Exposed schemas: أضف brc' };
    }
    if (code === '42501' || /permission denied/i.test(msg)) {
      return { text: 'لا صلاحية كافية (RLS/منح مفقود)', hint: 'راجع سياسات ومنح §8 و§9 في docs/schema.sql' };
    }
    if (code === 'PGRST301' || /JWT|token/i.test(msg)) {
      return { text: 'الجلسة منتهية — أعد الدخول', hint: '' };
    }
    if (/Failed to fetch|NetworkError|fetch failed|load failed/i.test(msg)) {
      return { text: 'تعذّر الوصول إلى سوبابيس (شبكة أو حجب)', hint: 'تحقق من الاتصال ثم أعد التحميل' };
    }
    return { text: msg ? ('خطأ من القاعدة: ' + msg) : 'خطأ غير معروف', hint: '' };
  }
  function setCloudError(err) {
    var d = describeError(err);
    cloud.error = d.text; cloud.detail = d.hint || '';
  }

  function createCloudClient() {
    var c = cloudCfg();
    if (cloudLib() === 'mini') {
      /* صفحات الزوار: عميل بلا مصادقة ولا اتصال لحظي — وهذا حدّها الصحيح */
      return root.HRCHttp.createClient(c.url, c.publishableKey, { schema: c.schema || 'brc' });
    }
    return root.supabase.createClient(c.url, c.publishableKey, {
      /* ⚠️ السكيما تُوضع تحت db لا في الجذر: supabase-js يتجاهل الجذر ويحذّر */
      db: { schema: c.schema || 'brc' },
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'hrc-auth' }
    });
  }

  /* ---------------------------- الإقلاع ---------------------------- */
  function bootCloud(opts) {
    if (opts && opts.cloud === false) { cloud.state = 'off'; cloud.role = 'guest'; return Promise.resolve(cloudStatus()); }
    if (!cloudConfigured()) { cloud.state = 'off'; cloud.role = 'guest'; return Promise.resolve(cloudStatus()); }
    if (cloud.bootPromise) return cloud.bootPromise;

    if (!cloudWillBoot(opts)) {
      cloud.state = 'degraded';
      cloud.role = 'guest';
      cloud.error = 'النظام يعمل محلياً — البيانات غير مشتركة';
      cloud.detail = !hasFetch()
        ? 'المتصفح لا يوفر fetch (أو يعمل في بيئة اختبار)'
        : 'مكتبة سوبابيس غير محمّلة (assets/vendor/supabase.js أو assets/js/cloud-http.js)';
      notifyCloudStatus();
      return Promise.resolve(cloudStatus());
    }

    cloud.state = 'connecting';
    try { cloud.client = createCloudClient(); }
    catch (e) { cloud.state = 'degraded'; cloud.role = 'guest'; setCloudError(e); notifyCloudStatus(); return Promise.resolve(cloudStatus()); }

    if (root.HRCCloudAuth) { try { cloud.auth = root.HRCCloudAuth.create(cloud.client); } catch (e) { cloud.auth = null; } }

    cloud.bootPromise = restoreThenLoad()
      .catch(function (e) { cloud.state = 'degraded'; cloud.role = 'guest'; setCloudError(e); return cloudStatus(); })
      .then(function (st) {
        cloud.bootPromise = null;
        notifyCloudStatus();
        return st;
      });
    return cloud.bootPromise;
  }

  /* هل نستطيع قراءة جداول الموظفين؟ بلا عميل يدير الجلسة لا — وفي الصفحات
     العامة نتجه لمسار الزائر مباشرة. بلا هذا يطلب كل زائر ستة جداول مرفوضة
     (ضجيج في الشبكة وسجل المشروع، وبطء في أول رسم بلا أي فائدة). */
  function canReadStaffTables() {
    return cloudLib() === 'supabase' && !!root.HRCCloudAuth;
  }

  function restoreThenLoad() {
    /* استعادة الجلسة قبل القراءة: بدونها يقرأ الموظف كزائر فيرى الوظائف العامة
       فقط، فيبدو أن بياناته «ضاعت» بعد تحديث الصفحة. */
    if (!canReadStaffTables()) return publicBoot(null);
    if (!cloud.auth) return loadFromCloud();
    return cloud.auth.restore().then(function (r) {
      if (r && r.ok) { applyStaffSession(r.profile); return loadFromCloud(); }
      /* بلا جلسة موظف: لا معنى لمحاولة قراءة brc.jobs/applicants — anon ممنوع
         منها فتُرفض كلها (6 طلبات فاشلة في كل تحميل صفحة، وفي سجل المشروع ضجيج
         «permission denied» لا يدلّ على خلل حقيقي). نبدأ من الواجهة العامة
         مباشرةً، وهي أيضاً ما يراه الزائر في الموقع. */
      return publicBoot(null);
    }).catch(function () { return loadFromCloud(); });
  }

  function loadFromCloud() {
    return root.HRCCloud.fetchAll(cloud.client).then(function (cdb) {
      var failed = (cdb.meta && cdb.meta.failedTables) || [];
      cloud.failedTables = failed;
      var coreFailed = failed.filter(function (t) { return CORE_TABLES.indexOf(t) >= 0; });
      if (coreFailed.length) {
        /* الجداول الأساسية محجوبة: إمّا زائر بلا جلسة (وهذا هو المتوقّع في
           الموقع العام وقبل الدخول) أو المخطط/الصلاحيات ناقصة. نجرب المسار
           العام قبل إعلان التعذّر — لأن anon ممنوع من brc.jobs أصلاً. */
        var errs = (cdb.meta && cdb.meta.errors) || [];
        var first = null;
        for (var i = 0; i < errs.length; i++) {
          if (CORE_TABLES.indexOf(errs[i].table) >= 0) { first = errs[i].error; break; }
        }
        return publicBoot(first);
      }
      adoptCloudDb(cdb);
      cloud.role = 'staff'; cloud.readOnly = false;
      cloud.state = 'on'; cloud.error = null; cloud.detail = null;
      startSync(); startRealtime();
      return cloudStatus();
    });
  }

  function publicBoot(coreError) {
    if (!root.HRCCloud.fetchPublicJobs) { cloud.state = 'degraded'; setCloudError(coreError); return cloudStatus(); }
    return root.HRCCloud.fetchPublicJobs(cloud.client).then(function (res) {
      if (!res || !res.ok) {
        cloud.state = 'degraded'; cloud.role = 'guest';
        setCloudError((res && res.error) || coreError);
        return cloudStatus();
      }
      adoptPublicJobs(res.jobs || []);
      cloud.role = 'public'; cloud.readOnly = true;
      cloud.state = 'on'; cloud.error = null; cloud.detail = null;
      /* رسالة الحالة هنا مقصودة: «متصل» + «بلا صلاحية كتابة» لأن ما نراه هو
         الواجهة العامة. الموظف غير المسجَّل يرى هذا تماماً كما يراه الزائر. */
      return cloudStatus();
    }).catch(function (e) {
      cloud.state = 'degraded'; cloud.role = 'guest'; setCloudError(e); return cloudStatus();
    });
  }

  /* تبنّي بيانات القاعدة في كائن db **نفسه** — لا إعادة إسناد: الواجهة تحمل
     مراجع كثيرة إلى db، وإعادة الإسناد تكسرها بصمت. */
  function adoptCloudDb(cdb) {
    cloud.applying = true;
    try {
      db.meta = cdb.meta || db.meta;
      db.counters = cdb.counters || db.counters;
      db.settings = cdb.settings || {};
      db.jobs = cdb.jobs || [];
      db.applicants = cdb.applicants || [];
      db.attempts = cdb.attempts || [];
      db.audit = cdb.audit || [];
      db.staff = cdb.staff || [];
      normalizeSerialLog();
    } finally { cloud.applying = false; }
    saveLocal();
    emit();
  }

  /* للزائر: الوظائف العامة فقط. لا نلمس بقية الجداول (لا نُفرغها) لأن الموظف
     غير المسجَّل قد يكون على نفس المتصفح ولديه كاش سابق. */
  function adoptPublicJobs(jobs) {
    cloud.applying = true;
    try {
      db.jobs = jobs || [];
      var maxJob = db.counters && db.counters.jobCode ? db.counters.jobCode : 1041;
      (jobs || []).forEach(function (j) {
        var m = /^HRC-(\d+)$/.exec(j.code || '');
        if (m) maxJob = Math.max(maxJob, Number(m[1]));
      });
      if (!db.counters) db.counters = { jobCode: maxJob, formSerial: 119 };
      else db.counters.jobCode = maxJob;
    } finally { cloud.applying = false; }
    saveLocal();
    emit();
  }

  /* ---------------------------- الدفع ---------------------------- */
  function startSync() {
    cloud.sync = root.HRCSync.create(cloud.client, {
      snapshot: root.HRCSync.snapshotOf(db),
      log: function (m) { console.log('[HRC/sync] ' + m); },
      hooks: {
        onKeyRegenerated: function (op, res) {
          /* القاعدة ولّدت مفتاحاً بديلاً (تصادم من موظف آخر في نفس اللحظة).
             لا نُصلح المفتاح محلياً: تغيير كود وظيفة أو رقم استمارة يستوجب
             تحديث كل المحاولات المرتبطة — والقاعدة هي المرجع. نُعيد القراءة. */
          console.warn('[HRC/sync] أُعيد توليد المفتاح في القاعدة — نُعيد القراءة لتصحيح الأرقام');
          cloud.needsReload = true;
        }
      },
      onError: function (err, op) {
        var d = describeError(err);
        cloud.lastError = d.text + ' — ' + op.op + ' ' + op.table + ' (' + op.key + ')';
        console.warn('[HRC/sync] فشلت ' + op.op + ' ' + op.table + ': ' + cloud.lastError);
      },
      onFatal: function (err) {
        setCloudError(err);
        cloud.lastError = cloud.error;
        console.error('[HRC/sync] توقف الدفع: ' + cloud.error);
        notifyCloudStatus();
      }
    });
  }

  function schedulePush() {
    if (cloud.state !== 'on' || cloud.role !== 'staff' || !cloud.sync) return;
    if (cloud.timer) clearTimeout(cloud.timer);
    cloud.timer = setTimeout(function () { pushCloud(); }, PUSH_DELAY);
  }

  function pushCloud() {
    if (cloud.timer) { clearTimeout(cloud.timer); cloud.timer = null; }
    if (cloud.state !== 'on' || cloud.role !== 'staff' || !cloud.sync) return Promise.resolve({ skipped: true });
    if (cloud.pushing) return Promise.resolve({ skipped: true });
    cloud.pushing = true;
    return cloud.sync.push(db).then(function (res) {
      cloud.pushing = false;
      cloud.lastPushAt = nowISO();
      cloud.lastPush = res;
      if (res && res.failed) {
        /* العملية الفاشلة تبقى معلّقة (لا تُوسم كمُزامَنة) وتُعاد في الدفعة
           التالية — انظر advanceSnapshot في cloud-sync.js. */
        cloud.lastError = 'تعذّر دفع ' + res.failed + ' عملية — ستُعاد تلقائياً';
        console.warn('[HRC/sync] ' + cloud.lastError + ': ' + (res.pending || []).join(', '));
      }
      if (cloud.needsReload) { cloud.needsReload = false; return reloadFromCloud(); }
      return res;
    }).catch(function (e) {
      cloud.pushing = false;
      setCloudError(e);
      cloud.lastError = cloud.error;
      return { error: e };
    });
  }

  /* إعادة قراءة كاملة — بعد تغيير من موظف آخر أو بعد استعادة الاتصال */
  function reloadFromCloud() {
    if (cloud.state !== 'on' || cloud.role !== 'staff' || !cloud.client) return Promise.resolve(cloudStatus());
    return root.HRCCloud.fetchAll(cloud.client).then(function (cdb) {
      if (((cdb.meta && cdb.meta.failedTables) || []).length) return cloudStatus();
      adoptCloudDb(cdb);
      if (cloud.sync) cloud.sync.setSnapshot(db);
      return cloudStatus();
    }).catch(function (e) { setCloudError(e); return cloudStatus(); });
  }

  /* --------------------------- Realtime ---------------------------
   *  تغيير من موظف آخر: نُطبّقه على الذاكرة ونُبلّغ الواجهة. المهم بعد
   *  التطبيق أن نُقدّم لقطة المزامنة للسطر المتغيّر وحده، وإلا أعاد الدفع
   *  إدراج سطر أدرجه غيرنا (تصادم مفتاح ← صف مكرر برقم جديد!) أو حذف سطر
   *  حُذف مسبقاً. نُقدّم السطر وحده لا اللقطة كلها، حتى لا نُوسم تعديلاً
   *  محلياً معلّقاً بأنه مُزامَن فيضيع.
   * ---------------------------------------------------------------- */
  function absorbRealtime(table, payload) {
    if (!cloud.sync) return;
    var type = payload.eventType || payload.type;
    var row = payload.new || payload.record || null;
    var old = payload.old || payload.old_record || null;
    var snap = cloud.sync.getSnapshot();
    var op = { table: table, op: type === 'DELETE' ? 'delete' : 'update', key: null, local: null };

    if (table === 'jobs') {
      op.key = (row && row.code) || (old && old.code);
      op.local = findLocal(db.jobs, function (x) { return x.code === op.key; });
    } else if (table === 'applicants') {
      op.key = (row && row.serial) || (old && old.serial);
      op.local = findLocal(db.applicants, function (x) { return x.serial === op.key; });
    } else if (table === 'job_attempts') {
      var r = row || old || {};
      op.key = String(r.serial) + ':' + String(r.attempt_no);
      op.local = findLocal(db.attempts, function (x) { return (x.serial + ':' + x.no) === op.key; });
    } else if (table === 'audit_log') {
      op.key = (row && row.id) || (old && old.id);
      op.local = findLocal(db.audit, function (x) { return String(x.id) === String(op.key); });
    } else if (table === 'settings') {
      if (row) root.HRCSync.advanceSnapshot(snap, { table: 'settings', op: 'update', key: row.key, local: { key: row.key, value: row.value } });
      return;
    } else if (table === 'staff') {
      return;   // الموظفون لا يُدفعون من الواجهة
    } else { return; }

    if (op.key == null) return;
    if (op.op === 'delete') { root.HRCSync.advanceSnapshot(snap, { table: table, op: 'delete', key: op.key, local: null }); return; }
    if (!op.local) return;   // لم يصلنا السطر بعد (ترتيب الأحداث) — لا نُقدّم شيئاً
    root.HRCSync.advanceSnapshot(snap, op);
  }

  function findLocal(list, pred) {
    list = list || [];
    for (var i = 0; i < list.length; i++) if (pred(list[i])) return list[i];
    return null;
  }

  function startRealtime() {
    if (cloud.unsubscribe || !root.HRCCloud.subscribeAll) return;
    cloud.unsubscribe = root.HRCCloud.subscribeAll(cloud.client, db, function (table, payload) {
      try { absorbRealtime(table, payload); } catch (e) { console.warn('[HRC/realtime] ' + (e && e.message || e)); }
      saveLocal();   // الكاش المحلي يبقى مطابقاً لما نعرضه
      emit();
    }, function (e) {
      console.warn('[HRC/realtime] ' + ((e && e.message) || e));
    });
  }

  /* --------------------------- الجلسة --------------------------- */
  function applyStaffSession(profile) {
    if (!profile) return null;
    var session = {
      username: profile.username, name: profile.name, role: profile.role || 'staff',
      title: profile.title || '', at: nowISO(), authId: profile.authId || null, cloud: true
    };
    memSession = session;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { }
    return session;
  }

  /* الدخول السحابي: غير متزامن بطبيعته. كل الأخطاء تُعاد ككائن {ok:false}
     مع جملة عربية مفهومة — لا استثناءات تصل إلى الواجهة. */
  function signIn(username, password) {
    if (!cloudConfigured()) return Promise.resolve({ ok: false, code: 'no_cloud', error: 'لا يوجد إعداد سحابة' });
    /* صفحات الزوار تستخدم العميل المصغّر (بلا مصادقة عن قصد): الدخول من اللوحة */
    if (!canReadStaffTables()) {
      return Promise.resolve({ ok: false, code: 'no_auth', error: 'الدخول متاح من لوحة الموظفين: /dashboard' });
    }
    if (!cloudWillBoot()) {
      return Promise.resolve({ ok: false, code: 'offline', error: cloud.error || 'النظام في الوضع المحلي' });
    }
    if (cloud.state === 'connecting') {
      return (cloud.bootPromise || Promise.resolve()).then(function () { return signIn(username, password); });
    }
    if (!cloud.client || !root.HRCCloudAuth) {
      return Promise.resolve({ ok: false, code: 'offline', error: 'مكتبة الدخول غير محمّلة' });
    }
    var auth = cloud.auth || (cloud.auth = root.HRCCloudAuth.create(cloud.client));
    return auth.login(username, password).then(function (r) {
      if (!r || !r.ok) return r || { ok: false, code: 'auth_failed', error: 'فشل الدخول' };
      applyStaffSession(r.profile);
      saveLocal();
      emit();
      /* كان الإقلاع السابق كزائر (الوظائف العامة فقط). بعد الدخول نُعيد الإقلاع
         لنجلب جداول الموظفين كاملة — وإلا بقي الموظف يرى نصف البيانات.
         ⚠️ ترتيب مقصود: التدقيق **بعد** تبني بيانات القاعدة، لأن التبنّي يستبدل
         db.audit بما في القاعدة فيضيع السطر المكتوب قبله. */
      cloud.bootPromise = null;
      return bootCloud().then(function () {
        audit('تسجيل دخول', 'auth', r.profile.username,
          'دخول عبر Supabase Auth (' + (r.profile.role === 'admin' ? 'مدير عام' : 'موظف') + ')');
        save();
        emit();
        return { ok: true, session: currentUser(), profile: r.profile };
      });
    });
  }

  function signOutCloud() {
    var out = (cloud.auth && cloud.auth.logout) ? cloud.auth.logout() : Promise.resolve({ ok: true });
    var unsub = cloud.unsubscribe;
    return out.catch(function () { return { ok: true }; }).then(function () {
      /* بعد الخروج نُفرغ ما لا يجوز أن يبقى على الجهاز (بيانات الباحثين كانت
         كلها في الذاكرة والكاش)، ثم نُعيد الإقلاع كزائر فتبقى الواجهة العامة. */
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
      db = blankDb();
      saveLocal();
      /* نُلغي الاشتراك اللحظي فعلاً: قناة قديمة تبقى تستقبل أحداثاً بعد الخروج
         تعني مصفوفة ذاكرة تُحدَّث ببيانات لا يحق لصاحب الجلسة الجديد رؤيتها. */
      if (unsub) { try { unsub(); } catch (e) { } }
      cloud.unsubscribe = null;
      cloud.sync = null;
      cloud.role = 'guest'; cloud.state = 'off';
      cloud.bootPromise = null;
      return bootCloud();
    });
  }

  function changeCloudPassword(newPassword) {
    if (!cloud.client || !root.HRCCloudAuth) return Promise.resolve({ ok: false, error: 'غير متاح في الوضع المحلي' });
    var auth = cloud.auth || root.HRCCloudAuth.create(cloud.client);
    return auth.changePassword(newPassword);
  }

  /* ---------------------------------------------------------------------------
   *  تسجيل طلب استمارة — لم يبقَ له مستدعٍ من الموقع العام
   *  ---------------------------------------------------------------------------
   *  ⚠️ سياسة الشركة: الزائر لا يقدّم طلباً من الموقع — يتصفّح الوظائف ثم يخابر
   *  المكتب أو يراجعه، والموظف يسجّل الطلب من المنظومة الداخلية. لذلك أُزيل نموذج
   *  الطلب من الموقع العام نهائياً. هذه الدالة تبقى للمسار الداخلي/الاختبارات،
   *  ودالة القاعدة brc.request_form تضع الحالة 'pending' دائماً — فلا يستطيع
   *  أي مسار إصدار استمارة سارية من خارج المنظومة.
   *  الزائر لا يملك — ولا يجب أن يملك — صلاحية إدراج في brc.applicants. لذلك
   *  الطلب يمرّ عبر دالة القاعدة brc.request_form التي تتحقق من المدخلات وتضع
   *  الحالة 'pending' دائماً. الإدراج المباشر من الواجهة كان يعني: إمّا منح
   *  anon صلاحية كتابة على جدول الاستمارات (مرفوض)، أو طلب يُرفض بـ 42501
   *  ويبقى في قائمة الانتظار يحاول بلا نهاية.
   *  في الوضع المحلي (بلا سحابة) نُكمل بالمسار المحلي كما كان تماماً.
   * ------------------------------------------------------------------------- */
  /* التحقق السحابي (صفحة التحقق للزائر): دالة القاعدة تتحقق من البصمة
     وتُرجع استمارة واحدة — بخلاف قراءة الجدول الذي يسحب بيانات الجميع. */
  function verifyCloud(serial, t) {
    if (cloud.state !== 'on' || !cloud.client || !root.HRCCloud.verifyForm) {
      return Promise.resolve({ ok: false, code: 'offline', error: cloud.error || 'لا اتصال بالسحابة' });
    }
    return root.HRCCloud.verifyForm(cloud.client, serial, t);
  }

  /* استعادة الاتصال: إقلاع كامل إن كنا في الوضع المحلي، وإلا دفع ما تبقّى */
  function onOnline() {
    if (cloudConfigured() && cloud.state === 'degraded') {
      cloud.bootPromise = null;
      bootCloud().then(function () { if (cloud.role === 'staff') runMaintenance(); });
    } else if (cloud.state === 'on' && cloud.role === 'staff') {
      pushCloud();
    }
  }
  if (root.addEventListener) root.addEventListener('online', onOnline);



  /* نقاط البيع المعتمدة المسجلة في البطاقات — لقائمة الإكمال التلقائي عند الإصدار */
  function listPosNames() {
    var seen = {}, out = [];
    (db && db.applicants ? db.applicants : []).forEach(function (a) {
      if (a && a.posName && !seen[a.posName]) { seen[a.posName] = 1; out.push(a.posName); }
    });
    return out;
  }

  /* ======================= تصدير ======================= */

  var API = {
    // بنية
    init: function (opts) {
      load();
      /* في الوضع السحابي لا تُجرَ صيانة على كاش محلّي قد يمثّل حالة قديمة
         (قد تُفرج عن حجز تغيّر في القاعدة منذ ساعات) — نؤجّلها حتى تُتبنّى
         بيانات السحابة، ثم تُجرى على الحالة الصحيحة. */
      if (!cloudWillBoot(opts)) runMaintenance();
      startTicker();
      bootCloud(opts).then(function () { if (cloud.role === 'staff') runMaintenance(); });
      return db;
    },
    subscribe: subscribe, emit: emit,   // emit مكشوفة للاختبارات وأدوات المزامنة الخارجية
    db: function () { return db; },
    settings: function () { return db.settings; },
    updateSettings: function (patch) {
      Object.keys(patch).forEach(function (k) { db.settings[k] = patch[k]; });
      audit('تعديل إعدادات', 'settings', '—', JSON.stringify(patch));
      save(); emit();
    },
    // جلسة
    login: login, logout: logout, currentUser: currentUser, isAdmin: isAdmin,
    // سحابة
    signIn: signIn, signOutCloud: signOutCloud, changeCloudPassword: changeCloudPassword,
    cloudStatus: cloudStatus, onCloudStatus: onCloudStatus, pushCloud: pushCloud,
    reloadCloud: reloadFromCloud, verifyCloud: verifyCloud,
    cloudQueueLength: pendingQueueLength,
    waitForCloud: function () { return cloud.bootPromise || Promise.resolve(cloudStatus()); },
    /* العمليات المعلّقة الآن (للتشخيص والعرض) — لا تُرسل شيئاً */
    diffCloud: function () { return (cloud.sync && cloud.state === 'on') ? cloud.sync.diff(db) : []; },
    // وظائف
    listJobs: listJobs, getJob: getJob, createJob: createJob, updateJob: updateJob,
    setJobStatus: setJobStatus, deleteJob: deleteJob, nextJobCode: function () { return 'HRC-' + (db.counters.jobCode + 1); },
    // باحثون
    listApplicants: listApplicants, getApplicant: getApplicant, createApplicant: createApplicant,
    createCardBatch: createCardBatch, createCardWithSerial: createCardWithSerial, suggestSerial: suggestSerial,
    activateCard: activateCard, listBlankCards: listBlankCards, randomSerial: randomSerial,
    approveApplicant: approveApplicant, rejectApplicant: rejectApplicant,
    getAttempts: getAttempts, attemptsLeft: attemptsLeft, formStatus: formStatus, activeAttempt: activeAttempt,
    // محاولات
    selectAttempt: selectAttempt, setOutcome: setOutcome, releaseHold: releaseHold,
    // صيانة
    runMaintenance: runMaintenance, pendingActions: pendingActions,
    // تحقق
    verify: verify, verifyUrl: verifyUrl, verifyBaseUrl: verifyBaseUrl, verifyLocalUrl: verifyLocalUrl, cardUrl: cardUrl, token: token,
    maskName: maskName, maskPhone: maskPhone,
    // بطاقتي (الزبون)
    lookupCard: lookupCard, useChance: useChance,
    cardLookup: cardLookup, cardUseChance: cardUseChance, cardVerify: cardVerify, cardVerifyCode: cardVerifyCode, listPosNames: listPosNames,
    activateCard: activateCard, employerView: employerView, employerDecide: employerDecide,
    cardActivate: cardActivate, cardEmployerView: cardEmployerView, cardEmployerDecide: cardEmployerDecide,
    // مالية
    stats: stats, financials: financials, financialTotals: financialTotals,
    markPrinted: markPrinted, setFeePaid: setFeePaid,
    // تدقيق
    audit: audit, listAudit: listAudit, syncOfflineChanges: syncOfflineChanges,
    getScheduledBackups: getScheduledBackups, listBackupMeta: listBackupMeta,
    saveScheduledBackup: saveScheduledBackup, deleteScheduledBackup: deleteScheduledBackup,
    restoreScheduledBackup: restoreScheduledBackup, exportScheduledBackup: exportScheduledBackup,
    lastBackupErrorMessage: lastBackupErrorMessage,
    // الجدولة التلقائية
    getAutoSchedule: getAutoSchedule, saveAutoSchedule: saveAutoSchedule,
    clearAutoSchedule: clearAutoSchedule, lastAutoRun: lastAutoRun, checkAutoBackup: checkAutoBackup,
    // أدوات
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, money: money, diffDays: diffDays, diffHours: diffHours,
    addDays: addDays, addHours: addHours, resetDemo: resetDemo, exportJson: exportJson, importJson: importJson,
    token_for: token, uid: uid
  };

  /* مؤقّت الصيانة: كل 30 ثانية */
  var ticker = null;
  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () { runMaintenance(); }, 30000);
  }

  root.HRCStore = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
