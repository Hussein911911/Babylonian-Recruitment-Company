/* ===========================================================================
 *  BRC — محرّك البيانات ومنطق العمل
 *  ---------------------------------------------------------------------------
 *  نسخة تعمل بالكامل داخل المتصفح (localStorage) — تُسهّل الحفظ والتشغيل
 *  بلا إنترنت. نفس المنطق مُنفّذ في النسخة السحابية عبر PostgreSQL + Supabase
 *  (انظر مجلد docs/schema.sql: المشغلات triggers وسياسات RLS).
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

  var CFG = root.BRC_CONFIG;
  var STORAGE_KEY = 'brc_db_v2';
  var SESSION_KEY = 'brc_session_v2';
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
        notes: '', vacancies: 1
      });
    });
    // الباحثون عن عمل + الاستمارات
    CFG.seed.applicants.forEach(function (a, idx) {
      var issue = addDays(new Date(), -(idx * 5 + 2));
      d.applicants.push({
        id: uid('app'), serial: a.serial, fullName: a.fullName, phone: a.phone, address: a.address,
        dob: a.dob, gender: idx % 2 ? 'أنثى' : 'ذكر', nationality: 'عراقي',
        issueDate: issue.toISOString(), expiryDate: addDays(issue, CFG.rules.validityDays).toISOString(),
        status: 'active', createdBy: a.createdBy, createdAt: issue.toISOString(), notes: '',
        fee: CFG.rules.formFee, feePaid: true, printedCount: 1
      });
    });
    // المحاولات: خمس خانات لكل استمارة (منها المُستخدم في البيانات التجريبية)
    var limit = Number(d.settings.attemptLimit || 5);
    d.applicants.forEach(function (app) {
      for (var i = 1; i <= limit; i++) {
        var t = CFG.seed.attempts.filter(function (x) { return x.serial === app.serial && x.no === i; })[0];
        var job = t ? d.jobs.filter(function (j) { return j.code === t.jobCode; })[0] : null;
        var isHold = t && t.slotStatus === 'reserved';
        // الحجز الجاري: بدأ قبل 3 ساعات وتنتهي مهلته بعد نحو 21 ساعة (لعرض العدّاد التنازلي)
        var selected = isHold ? addHours(new Date(), -3) : addDays(new Date(), -2 - i);
        d.attempts.push({
          id: uid('att'), serial: app.serial, no: i,
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

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { db = seedDb(); save(); return db; }
      db = JSON.parse(raw);
      if (!db.jobs) throw new Error('bad db');
    } catch (e) { db = seedDb(); save(); }
    // ترحيل بسيط للإعدادات
    ['attemptLimit', 'validityDays', 'holdHours', 'formFee'].forEach(function (k) {
      if (db.settings[k] == null) db.settings[k] = CFG.rules[k];
    });
    return db;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* لا تخزين متاح أو المساحة ممتلئة — البيانات تبقى في الذاكرة */ }
  }

  function emit() { sub.version++; sub.listeners.forEach(function (fn) { try { fn(db, sub.version); } catch (e) { } }); }

  function subscribe(fn) { sub.listeners.push(fn); return function () { var i = sub.listeners.indexOf(fn); if (i >= 0) sub.listeners.splice(i, 1); }; }

  /* ======================= الجلسة والصلاحيات ======================= */

  var memSession = null;   // جلسة احتياطية في الذاكرة عند تعذّر sessionStorage

  function login(username, password) {
    var u = (db.settings.users || CFG.users).filter(function (x) {
      return x.username === username && x.password === password;
    })[0];
    if (!u) { audit('محاولة دخول فاشلة', 'auth', username, 'اسم مستخدم أو كلمة مرور غير صحيحة'); save(); emit(); return null; }
    var session = { username: u.username, name: u.name, role: u.role, title: u.title, at: nowISO() };
    memSession = session;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { }
    audit('تسجيل دخول', 'auth', username, 'دخول ناجح إلى المنظومة (' + (u.role === 'admin' ? 'مدير عام' : 'موظف') + ')');
    save(); emit();
    return session;
  }

  function logout() {
    var s = currentUser();
    if (s) audit('تسجيل خروج', 'auth', s.username, 'إنهاء الجلسة');
    memSession = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { }
    save(); emit();
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
    do { db.counters.jobCode++; code = 'BRC-' + db.counters.jobCode; }
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
      closedAt: null, notes: '', vacancies: Number(data.vacancies || 1)
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
    db.jobs = db.jobs.filter(function (j) { return j.code !== code; });
    audit('حذف وظيفة', 'job', code, job.title + ' — ' + job.region);
    save(); emit();
    return true;
  }

  /* ======================= الباحثون عن العمل والاستمارات ======================= */

  function nextSerial() {
    db.counters.formSerial++;
    return 'BRC-NO-' + pad(db.counters.formSerial, 6);
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
      requestedCode: data.requestedCode || null,
      requestedAt: data.requestedCode ? issue.toISOString() : null,
      fee: Number(data.fee != null ? data.fee : db.settings.formFee),
      feePaid: !!data.feePaid, printedCount: 0,
      rejectReason: ''
    };
    db.applicants.unshift(app);
    if (!pending) createAttempts(app.serial);
    audit(pending ? 'طلب استمارة جديد' : 'إصدار استمارة', 'applicant', app.serial,
      (pending ? 'طلب إلكتروني قيد المراجعة من الباحث ' : 'إصدار استمارة للباحث ') + app.fullName + ' — رسم ' + money(app.fee));
    save(); emit();
    return app;
  }

  function createAttempts(serial) {
    for (var i = 1; i <= Number(db.settings.attemptLimit || 5); i++) {
      db.attempts.push({
        id: uid('att'), serial: serial, no: i, jobId: null, jobCode: null, jobTitle: null,
        location: null, employerName: null, employerPhone: null, slotStatus: 'empty',
        selectedAt: null, holdExpiresAt: null, closedAt: null, note: '', staff: null
      });
    }
  }

  /* قبول طلب استمارة قيد المراجعة ⇒ تتحول لاستمارة رسمية سارية */
  function approveApplicant(serial) {
    var app = getApplicant(serial);
    if (!app || app.status !== 'pending') return { ok: false, error: 'الطلب غير موجود أو ليس قيد المراجعة' };
    var issue = new Date();
    app.status = 'active';
    app.issueDate = issue.toISOString();
    app.expiryDate = addDays(issue, Number(db.settings.validityDays || 30)).toISOString();
    if (!getAttempts(serial).length) createAttempts(serial);
    audit('قبول طلب استمارة', 'applicant', serial, 'قبول طلب الباحث ' + app.fullName + ' — صدرت الاستمارة رسمياً برقم ' + serial);
    save(); emit();
    return { ok: true, app: app };
  }

  /* رفض طلب استمارة قيد المراجعة */
  function rejectApplicant(serial, reason) {
    var app = getApplicant(serial);
    if (!app || app.status !== 'pending') return { ok: false, error: 'الطلب غير موجود أو ليس قيد المراجعة' };
    app.status = 'rejected';
    app.rejectReason = reason || '';
    audit('رفض طلب استمارة', 'applicant', serial, 'رفض طلب الباحث ' + app.fullName + (reason ? ' — السبب: ' + reason : ''));
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

  /* الخانة الفعّالة: أول محاولة فارغة — كل خانة (1..5) تُستخدم مرة واحدة فقط،
     والمرفوضة/المنتهية تبقى مسجّلة في تاريخ الاستمارة دون إعادة استخدام. */
  function activeAttempt(serial) {
    return getAttempts(serial).filter(function (t) { return t.slotStatus === 'empty'; })[0] || null;
  }

  function attemptsLeft(serial) {
    return getAttempts(serial).filter(function (t) { return t.slotStatus === 'empty'; }).length;
  }

  function formStatus(app) {
    if (!app) return 'active';
    if (app.status === 'pending') return 'pending';
    if (app.status === 'rejected') return 'rejected';
    if (getAttempts(app.serial).some(function (t) { return t.slotStatus === 'succeeded'; })) return 'completed';
    if (new Date(app.expiryDate).getTime() < Date.now()) return 'expired';
    if (attemptsLeft(app.serial) === 0) return 'exhausted';
    return 'active';
  }

  /* ======================= المحاولات: الاختيار والنتائج ======================= */

  function selectAttempt(serial, jobCode) {
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'الاستمارة غير موجودة' };
    var st = formStatus(app);
    if (st === 'pending') return { ok: false, error: 'الطلب قيد المراجعة — اقبل الطلب أولاً قبل الترشيح' };
    if (st === 'rejected') return { ok: false, error: 'الطلب مرفوض — لا يمكن الترشيح عليه' };
    if (st === 'expired') return { ok: false, error: 'انتهت صلاحية الاستمارة (30 يوماً)' };
    var job = getJob(jobCode);
    if (!job) return { ok: false, error: 'الوظيفة غير موجودة' };
    if (job.status !== 'available') return { ok: false, error: 'الوظيفة غير متاحة حالياً (' + CFG.jobStatus[job.status].ar + ')' };
    var slot = activeAttempt(serial);
    if (!slot) return { ok: false, error: 'لا توجد محاولات متاحة — استُهلكت محاولات الاستمارة (' + (db.settings.attemptLimit || 5) + ')' };

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
      'المحاولة #' + slot.no + ' للاستمارة ' + serial + ' — تعليق الوظيفة ' + hours + ' ساعة حتى ' + fmtDateTime(slot.holdExpiresAt));
    save(); emit();
    return { ok: true, attempt: slot, job: job };
  }

  /* نتيجة المقابلة: succeeded | rejected */
  function setOutcome(serial, no, outcome, note) {
    var slot = getAttempts(serial).filter(function (t) { return t.no === Number(no); })[0];
    if (!slot) return { ok: false, error: 'المحاولة غير موجودة' };
    var job = slot.jobId ? db.jobs.filter(function (j) { return j.id === slot.jobId; })[0] : null;
    slot.slotStatus = outcome;
    slot.closedAt = nowISO();
    slot.note = note || slot.note;
    slot.holdExpiresAt = null;

    if (job) {
      if (outcome === 'succeeded') { job.status = 'closed'; job.reservedBy = null; job.holdExpiresAt = null; job.closedAt = nowISO(); }
      else { job.status = 'available'; job.reservedBy = null; job.holdExpiresAt = null; }
    }
    // تفعيل المحاولة التالية تلقائياً (أول خانة فارغة متبقية على الاستمارة)
    var next = null;
    if (outcome === 'rejected') next = activeAttempt(serial);
    audit(outcome === 'succeeded' ? 'إتمام توظيف' : 'رفض مرشح',
      'attempt', serial + ' / #' + no,
      (job ? job.code + ' — ' + job.title : '') + ' | ' +
      (outcome === 'succeeded'
        ? 'تم التوظيف وإغلاق الوظيفة'
        : 'إعادة الوظيفة إلى (متاحة) وتفعيل المحاولة #' + (next ? next.no : '—') + ' تلقائياً') +
      (note ? ' | ملاحظة: ' + note : ''));
    save(); emit();
    return { ok: true, attempt: slot, job: job, nextAttempt: next };
  }

  /* إفراج يدوي عن الحجز مع وسم "انتهت المهلة / تتطلب إجراء" */
  function releaseHold(serial, no, reason) {
    var slot = getAttempts(serial).filter(function (t) { return t.no === Number(no); })[0];
    if (!slot) return { ok: false, error: 'المحاولة غير موجودة' };
    var job = slot.jobId ? db.jobs.filter(function (j) { return j.id === slot.jobId; })[0] : null;
    slot.slotStatus = 'expired';
    slot.closedAt = nowISO();
    slot.holdExpiresAt = null;
    slot.note = reason || 'انتهت مهلة 24 ساعة دون تثبيت النتيجة';
    if (job) { job.status = 'available'; job.reservedBy = null; job.holdExpiresAt = null; }
    audit('إفراج عن حجز', 'job', job ? job.code : '—',
      'المحاولة #' + no + ' للاستمارة ' + serial + ' — أُعيدت الوظيفة إلى (متاحة) | ' + slot.note);
    save(); emit();
    return { ok: true, attempt: slot, job: job };
  }

  /* ======================= الصيانة التلقائية ======================= */

  /* تُنفّذ عند تحميل الصفحة وكل 30 ثانية وكل دقيقة على الواجهة */
  function runMaintenance() {
    var actions = [];
    var now = new Date();
    if (!db.settings || db.settings.autoReleaseEnabled === false) { /* معطّل من الإعدادات */ }

    // 1) إفراج تلقائي عن الحجوزات المنتهية (24 ساعة)
    if (db.settings.autoReleaseEnabled !== false && CFG.rules.autoReleaseEnabled) {
      db.jobs.forEach(function (job) {
        if (job.status !== 'reserved' || !job.holdExpiresAt) return;
        if (new Date(job.holdExpiresAt).getTime() > now.getTime()) return;
        var slot = db.attempts.filter(function (t) {
          return t.serial === job.reservedBy && t.jobId === job.id && t.slotStatus === 'reserved';
        })[0];
        job.status = 'available';
        job.reservedBy = null;
        job.holdExpiresAt = null;
        if (slot) {
          slot.slotStatus = 'expired';
          slot.closedAt = now.toISOString();
          slot.holdExpiresAt = null;
          slot.note = 'انتهت مهلة 24 ساعة دون تثبيت نتيجة المقابلة — تتطلب إجراء';
        }
        db.audit.unshift({
          id: uid('log'), ts: now.toISOString(), user: 'system', role: 'system', name: 'النظام (تلقائي)',
          ip: localIp(), action: 'إفراج تلقائي (24 ساعة)', entity: 'job', entityId: job.code,
          details: 'انتهت مهلة الحجز دون تثبيت النتيجة — أُعيدت الوظيفة إلى (متاحة) ووُسمت المحاولة #' +
            (slot ? slot.no : '—') + ' للاستمارة ' + (job.reservedBy || '—') + ' بـ (انتهت المهلة)'
        });
        actions.push({ type: 'autoRelease', job: job.code, serial: job.reservedBy });
      });
    }

    // 2) انتهاء صلاحية الاستمارات (30 يوماً)
    db.applicants.forEach(function (app) {
      if (app.status === 'active' && new Date(app.expiryDate).getTime() < now.getTime()) {
        app.status = 'expired';
        db.audit.unshift({
          id: uid('log'), ts: now.toISOString(), user: 'system', role: 'system', name: 'النظام (تلقائي)',
          ip: localIp(), action: 'انتهاء استمارة', entity: 'applicant', entityId: app.serial,
          details: 'انتهت صلاحية الاستمارة (30 يوماً) بتاريخ ' + fmtDate(app.expiryDate)
        });
        actions.push({ type: 'formExpired', serial: app.serial });
      }
    });
    if (actions.length) { save(); emit(); }
    return actions;
  }

  /* ======================= التحقق (QR) ======================= */

  /* رابط التحقق المطبوع في الكيو آر كود.
     يتبع نطاق الموقع المنشور تلقائياً (مثل *.onrender.com أو النطاق الرسمي)،
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

  function verify(serial, t) {
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'لا توجد استمارة بهذا الرقم', serial: serial };
    var validToken = token(serial);
    var payload = {
      ok: true,
      serial: app.serial,
      fullName: app.fullName,
      phone: app.phone,
      issueDate: app.issueDate,
      expiryDate: app.expiryDate,
      createdAt: app.createdAt,
      status: formStatus(app),
      rejectReason: app.rejectReason || '',
      requestedCode: app.requestedCode || null,
      daysLeft: app.expiryDate ? diffDays(app.expiryDate, new Date()) : null,
      attemptsLeft: attemptsLeft(app.serial),
      attemptsUsed: getAttempts(app.serial).filter(function (x) { return x.slotStatus !== 'empty'; }).length,
      attemptLimit: Number(db.settings.attemptLimit || 5),
      createdBy: app.createdBy,
      attempts: getAttempts(app.serial).map(function (x) {
        return {
          no: x.no, jobCode: x.jobCode || '—', jobTitle: x.jobTitle || '—', location: x.location || '—',
          employerPhone: x.employerPhone || '—', slotStatus: x.slotStatus, note: x.note || '',
          selectedAt: x.selectedAt, holdExpiresAt: x.holdExpiresAt, closedAt: x.closedAt
        };
      }),
      tokenOk: !t || t === validToken,
      verifiedAt: nowISO()
    };
    audit('تحقق من استمارة (QR)', 'applicant', app.serial,
      'فحص عبر رابط التحقق' + (t && t !== validToken ? ' — تحذير: بصمة غير مطابقة' : ' — بصمة صحيحة'));
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
      expiredForms: db.applicants.filter(function (a) { return formStatus(a) === 'expired'; }).length,
      hires: db.attempts.filter(function (t) { return t.slotStatus === 'succeeded'; }).length
    };
  }

  /* لوحة مالية: عدد الاستمارات المطبوعة والمبالغ المتوقعة لكل موظف */
  function financials(from, to) {
    var rows = {};
    db.applicants.forEach(function (a) {
      if (from && a.issueDate < from) return;
      if (to && a.issueDate > to + 'T23:59:59') return;
      var key = a.createdBy || 'system';
      rows[key] = rows[key] || { user: key, forms: 0, printed: 0, expected: 0, collected: 0, hires: 0, holds: 0 };
      rows[key].forms++;
      var fee = Number(a.fee != null ? a.fee : db.settings.formFee);
      rows[key].printed += Number(a.printedCount || 0);
      rows[key].expected += fee;
      if (a.feePaid) rows[key].collected += fee;
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
    var out = { holds: [], expired: [], exhausted: [], rejected: [], requests: [] };
    db.jobs.forEach(function (j) {
      if (j.status === 'reserved' && j.holdExpiresAt) {
        var h = diffHours(j.holdExpiresAt, new Date());
        out.holds.push({ job: j, hoursLeft: h, serial: j.reservedBy });
      }
    });
    db.applicants.forEach(function (a) {
      var st = formStatus(a);
      if (st === 'pending') { out.requests.push(a); return; }
      if (st === 'rejected') return;
      var used = getAttempts(a.serial).filter(function (t) { return t.slotStatus !== 'empty'; }).length;
      if (st === 'expired') out.expired.push(a);
      else if (used >= Number(db.settings.attemptLimit || 5)) out.exhausted.push(a);
      var rej = getAttempts(a.serial).filter(function (t) { return t.slotStatus === 'rejected'; });
      if (rej.length) out.rejected.push({ applicant: a, count: rej.length });
    });
    return out;
  }

  function markPrinted(serial) {
    var app = getApplicant(serial); if (!app) return;
    app.printedCount = Number(app.printedCount || 0) + 1;
    audit('طباعة استمارة', 'applicant', serial, 'طباعة نموذج A4 مع كيو آر كود — العدد الكلي ' + app.printedCount);
    save(); emit();
  }

  function setFeePaid(serial, paid) {
    var app = getApplicant(serial); if (!app) return;
    app.feePaid = !!paid;
    audit(paid ? 'تسجيل استلام رسم' : 'إلغاء تسجيل الرسم', 'applicant', serial, 'رسم الاستمارة: ' + money(app.fee));
    save(); emit();
  }

  function resetDemo() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
    db = seedDb(); save();
    audit('إعادة ضبط البيانات', 'system', '—', 'إعادة تهيئة قاعدة البيانات المحلية إلى البيانات التجريبية');
    save(); emit();
  }

  function exportJson() { return JSON.stringify(db, null, 2); }

  function importJson(text) {
    var parsed = JSON.parse(text);
    if (!parsed.jobs || !parsed.applicants) throw new Error('ملف غير صالح');
    db = parsed; save();
    audit('استيراد بيانات', 'system', '—', 'استيراد نسخة احتياطية تحتوي ' + parsed.jobs.length + ' وظيفة و' + parsed.applicants.length + ' استمارة');
    save(); emit();
  }

  /* ======================= تصدير ======================= */

  var API = {
    // بنية
    init: function () { load(); runMaintenance(); startTicker(); return db; },
    subscribe: subscribe,
    db: function () { return db; },
    settings: function () { return db.settings; },
    updateSettings: function (patch) {
      Object.keys(patch).forEach(function (k) { db.settings[k] = patch[k]; });
      audit('تعديل إعدادات', 'settings', '—', JSON.stringify(patch));
      save(); emit();
    },
    // جلسة
    login: login, logout: logout, currentUser: currentUser, isAdmin: isAdmin,
    // وظائف
    listJobs: listJobs, getJob: getJob, createJob: createJob, updateJob: updateJob,
    setJobStatus: setJobStatus, deleteJob: deleteJob, nextJobCode: function () { return 'BRC-' + (db.counters.jobCode + 1); },
    // باحثون
    listApplicants: listApplicants, getApplicant: getApplicant, createApplicant: createApplicant,
    approveApplicant: approveApplicant, rejectApplicant: rejectApplicant,
    getAttempts: getAttempts, attemptsLeft: attemptsLeft, formStatus: formStatus, activeAttempt: activeAttempt,
    // محاولات
    selectAttempt: selectAttempt, setOutcome: setOutcome, releaseHold: releaseHold,
    // صيانة
    runMaintenance: runMaintenance, pendingActions: pendingActions,
    // تحقق
    verify: verify, verifyUrl: verifyUrl, verifyBaseUrl: verifyBaseUrl, verifyLocalUrl: verifyLocalUrl, token: token,
    // مالية
    stats: stats, financials: financials, financialTotals: financialTotals,
    markPrinted: markPrinted, setFeePaid: setFeePaid,
    // تدقيق
    audit: audit, listAudit: listAudit,
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

  root.BRCStore = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
