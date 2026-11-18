/* HRC data engine. Cloud: official Auth + RLS; office offline drafts use office/.
 * Cards default to two configurable chances; 24h expiry is critical, never
 * automatic release. Company confirmation remains authoritative.
 */
(function (root) {
  'use strict';

  var CFG = root.HRC_CONFIG;
  var STORAGE_KEY = 'hrc_db_v2';
  var SESSION_KEY = 'hrc_session_v2';
  var sub = { listeners: [], version: 0 };

  /* ======================= أدوات عامة ======================= */

  function pad(n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; }

  function nowISO() { return new Date().toISOString(); }

  // Gregorian Baghdad display; persisted instants remain UTC, never +3 twice.
  var iraqFormat = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  function iraqParts(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) value = value.replace(' ','T') + '+03:00';
    var d = value instanceof Date ? value : new Date(value), p = {};
    if (isNaN(d.getTime())) return null;
    iraqFormat.formatToParts(d).forEach(function (v) { p[v.type] = v.value; });
    return p;
  }
  function fmtDateTime(d) {
    var p = iraqParts(d);
    return p ? p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute+':'+p.second : '—';
  }
  function fmtDate(d) {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      var v = new Date(d+'T00:00:00Z');
      return !isNaN(v.getTime()) && v.toISOString().slice(0,10) === d ? d : '—';
    }
    return fmtDateTime(d).slice(0,10);
  }
  function dayOffset(n, at) {
    var d = new Date(fmtDate(at == null ? new Date() : at)+'T12:00:00Z');
    d.setUTCDate(d.getUTCDate()+n);
    return isNaN(d.getTime()) ? '—' : d.toISOString().slice(0,10);
  }
  function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }
  function addHours(date, hours) { return new Date(date.getTime() + hours * 3600000); }

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
        id: uid('job'), code: j.code, title: j.title, category: j.category, region: j.region || '',
        governorate: j.governorate || 'بابل',
        salaryMin: j.salaryMin, salaryMax: j.salaryMax, shift: j.shift, gender: j.gender || 'لا فرق',
        description: j.description || '', requirements: j.requirements || [],
        employer: j.employer, interviewLocation: j.interviewLocation,
        status: extra.status || 'available',
        reservedBy: null,
        holdExpiresAt: null,
        createdAt: created.toISOString(), createdBy: idx % 2 ? 'staff2' : 'staff',
        closedAt: extra.status === 'closed' ? addDays(new Date(), -1).toISOString() : null,
        notes: '', vacancies: Number(j.vacancies||1), imageUrl: j.imageUrl || ''
      });
    });
    // الباحثون عن عمل + الاستمارات
    CFG.seed.applicants.forEach(function (a, idx) {
      /* بطاقات فارغة بالمخزن (d.blank): تُصدر من الشركة دفعات وتنتظر التعبئة
         عند البيع — لا تواريخ لها والصلاحية تبدأ عند أول تقديم ناجح. */
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
          location: job ? (job.governorate || '') : null,
          employerName: job ? (job.employer || {}).name : null, employerPhone: job ? (job.employer || {}).phone : null,
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

  // Migrate old local prefixes once without overwriting an existing new key.
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

    } catch (e) { /* لا تخزين متاح أو المساحة ممتلئة — البيانات تبقى في الذاكرة */ }
  }

  /* كل حفظ محلي يتبعه دفع للسحابة — نقطة واحدة، فلا تُنسى عملية كتابة.
     الدفع مؤجَّل (debounce): العملية الواحدة قد تستدعي save() مرتين، ولا معنى
     لرحلتين إلى القاعدة لنفس التغيير. */
  function save() {
    saveLocal();
    schedulePush();
  }

  /* إبلاغ حافة Cloudflare أن إعلانات الوظائف تغيّرت (On-Demand Revalidation).
     يُستدعى فقط عند كتابة وظيفة — لا عند كل حفظ، كي لا نُغرق الحافة.
     غياب الوحدة أو تعطيلها لا يغيّر أي سلوك: الكاش يسقط وحده بعد 30 ثانية. */
  function revalidateJobs(reason) {
    try { if (root.HRCRevalidate) root.HRCRevalidate.afterJobChange(reason || 'job-change'); } catch (e) { }
  }

  // Legacy browser snapshots are NOT an operational outbox. Preserve them for
  // review, never clear/replay a stale snapshot as proof of synchronization.
  function syncOfflineChanges() { return pendingQueueLength(); }

  function emit() { sub.version++; sub.listeners.forEach(function (fn) { try { fn(db, sub.version); } catch (e) { } }); }

  function subscribe(fn) { sub.listeners.push(fn); return function () { var i = sub.listeners.indexOf(fn); if (i >= 0) sub.listeners.splice(i, 1); }; }

  /* ======================= الجلسة والصلاحيات ======================= */

  var memSession = null;   // جلسة احتياطية في الذاكرة عند تعذّر sessionStorage

  function login(username, password, opts) {
    /* الإنتاج مغلق: Supabase Auth + موظف فعّال في brc.staff حصراً.
       القفل مستقل عن حالة الشبكة/العميل ولا يتجاوزه forceLocal.
       المسار المحلي أدناه لمحاكاة fixtures التاريخية عند تعطيل القفل صراحةً
       في بيئة الاختبار فقط، وليس خياراً لانقطاع الاتصال في الإنتاج. */
    if (enforceAuth()) {
      audit('محاولة دخول محلي مرفوضة', 'auth', username || '—',
        'النظام في الوضع السحابي — الدخول عبر Supabase Auth فقط');
      saveLocal(); emit();
      return null;
    }
    var allUsers = (db.settings.users || []).concat(CFG.users || []);
    /* إزالة المكررات: db.settings.users لها الأسبقية */
    var seen = {};
    var merged = [];
    allUsers.forEach(function (u) {
      if (!seen[u.username]) { seen[u.username] = true; merged.push(u); }
    });
    var u = merged.filter(function (x) {
      return x.username === username && x.password === password && x.active !== false;
    })[0];
    if (!u) { audit('محاولة دخول فاشلة', 'auth', username, 'اسم مستخدم أو كلمة مرور غير صحيحة'); save(); emit(); return null; }
    var session = { username: u.username, name: u.name, role: u.role, title: u.title, at: nowISO() };
    memSession = session;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { }
    audit('تسجيل دخول', 'auth', username, 'دخول ناجح إلى المنظومة (' + (u.role === 'admin' ? 'مدير عام' : 'موظف') + ')');

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
    cloud.knownProfile = null;   /* ملف الدخول المعلوم لا يُعاد استخدامه بعد الخروج */
    if (s) audit('تسجيل خروج', 'auth', s.username, 'إنهاء الجلسة');
    if(root.HRCCloud&&root.HRCCloud.clearChanceRegistry)root.HRCCloud.clearChanceRegistry();
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
      if (raw) {
        var session = JSON.parse(raw);
        if (!enforceAuth() || (session && session.cloud)) return session;
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (e) { /* لا جلسة تخزين متاحة */ }
    return enforceAuth() && memSession && !memSession.cloud ? null : memSession;
  }

  function isAdmin() { var u = currentUser(); return !!(u && u.role === 'admin'); }
  /* جلسة موظف صالحة (مدير أو موظف) — للحالات التي تُتاح للدورين معاً. */
  function isStaffSession() { var u = currentUser(); return !!(u && (u.role === 'admin' || u.role === 'staff')); }

  /* ======================= إدارة المستخدمين ======================= */

  /* جلب قائمة المستخدمين: السحابيين + المحليين + الافتراضيين */
  function listUsers() {
    var cloudStaff = (db.staff || []);
    var localUsers = (db.settings.users || []).concat(CFG.users || []);
    /* دمج: السحابي أولاً ثم المحلي (الأسبقية للمحلي) */
    var map = {};
    cloudStaff.forEach(function (s) {
      /* id و authId يُحفظان مع العرض: بلا معرّف موظف القاعدة لا يمكن تعديله
         ولا تعطيله ولا حذفه من اللوحة (تُنادى به دوال إدارة الحساب). */
      map[s.username] = {
        username: s.username, name: s.name, role: s.role || 'staff', title: s.title || '',
        active: s.active !== false, source: 'cloud', id: s.id || null, authId: s.authId || null
      };
    });
    var seen = {};
    localUsers.forEach(function (u) {
      if (!seen[u.username]) {
        seen[u.username] = true;
        if (!map[u.username]) {
          map[u.username] = { username: u.username, name: u.name, role: u.role || 'staff', title: u.title || '', active: u.active !== false, source: 'local' };
        }
      }
    });
    return Object.values(map);
  }

  /* سطر الموظف السحابي (brc.staff) بالاسم — أو null */
  function staffRowOf(username) {
    var staff = db.staff || [];
    for (var i = 0; i < staff.length; i++) if (staff[i].username === username) return staff[i];
    return null;
  }


  function addUser(data) {
    if (!isAdmin()) return { ok: false, error: 'هذه الصلاحية للمدير العام فقط' };
    if (!data.username || !data.password || !data.name) return { ok: false, error: 'الاسم واسم المستخدم وكلمة المرور مطلوبة' };
    var dup = listUsers().filter(function (u) { return u.username === data.username; })[0];
    var sameCloudAccount = !!(dup && dup.source === 'cloud' && data.cloudLinked);
    if (dup && !sameCloudAccount) return { ok: false, error: 'اسم المستخدم «' + data.username + '» موجود مسبقاً' };
    if (sameCloudAccount) {
      /* الاسم موجود في القاعدة: نحدّث السطر المحلي إن وُجد بدل إضافة ثانٍ */
      var locals = db.settings.users || [];
      var li = -1;
      for (var k = 0; k < locals.length; k++) if (locals[k].username === data.username) { li = k; break; }
      if (li >= 0) {
        locals[li].password = data.password;
        locals[li].name = data.name;
        locals[li].role = data.role || 'staff';
        locals[li].title = data.title || '';
        locals[li].active = true;
        audit('إضافة مستخدم', 'user', data.username, 'ربط دخول محلي بحساب القاعدة: ' + data.name);
        save(); emit();
        return { ok: true, user: locals[li] };
      }
    }
    if (!db.settings.users) db.settings.users = [];
    var newUser = {
      username: data.username,
      password: data.password,
      name: data.name,
      role: data.role || 'staff',
      title: data.title || '',
      active: data.active !== false
    };
    db.settings.users.push(newUser);
    audit('إضافة مستخدم', 'user', data.username, 'الاسم: ' + data.name + ' — الدور: ' + (data.role === 'admin' ? 'مدير عام' : 'موظف'));
    save(); emit();
    return { ok: true, user: newUser };
  }


  function updateUser(username, data) {
    if (!isAdmin()) return { ok: false, error: 'هذه الصلاحية للمدير العام فقط' };
    var users = db.settings.users || [];
    var idx = -1;
    for (var i = 0; i < users.length; i++) { if (users[i].username === username) { idx = i; break; } }
    var row = staffRowOf(username);

    if (idx < 0 && !row) return { ok: false, error: 'الموظف غير موجود — لا محلياً ولا في القاعدة' };

    if (idx >= 0) {
      if (data.name) users[idx].name = data.name;
      if (data.role) users[idx].role = data.role;
      if (data.title !== undefined) users[idx].title = data.title;
      if (data.password) users[idx].password = data.password;
      if (data.active !== undefined) users[idx].active = data.active;
    }
    if (row) {
      if (data.name) row.name = data.name;
      if (data.role) row.role = data.role;
      if (data.title !== undefined) row.title = data.title;
      if (data.active !== undefined) row.active = data.active;
      /* كلمة مرور سطر القاعدة لا تُحفظ هنا: كلمة مروره الحقيقية في Supabase Auth
         وتُغيَّر بدالة إدارة الحساب بمفتاح الخدمة (setCloudUserPassword). */
    }
    audit('تعديل مستخدم', 'user', username, JSON.stringify(data));
    save(); emit();
    return { ok: true, cloud: !!row, local: idx >= 0 };
  }

  /* حذف مستخدم (المصدران معاً) */
  function deleteUser(username) {
    if (!isAdmin()) return { ok: false, error: 'هذه الصلاحية للمدير العام فقط' };
    var cur = currentUser();
    if (cur && cur.username === username) return { ok: false, error: 'لا يمكنك حذف حسابك الحالي' };
    var users = db.settings.users || [];
    var before = users.length;
    db.settings.users = users.filter(function (u) { return u.username !== username; });
    var localGone = db.settings.users.length !== before;

    var row = staffRowOf(username);
    if (row) db.staff = (db.staff || []).filter(function (s) { return s.username !== username; });

    if (!localGone && !row) return { ok: false, error: 'الموظف غير موجود — لا محلياً ولا في القاعدة' };
    audit('حذف مستخدم', 'user', username, 'تم حذف الحساب' + (row ? ' (مع سطر القاعدة)' : ''));
    save(); emit();
    return { ok: true, local: localGone, cloud: !!row };
  }

  /* تبديل حالة التنشيط (المصدران معاً) */
  function toggleUserActive(username) {
    if (!isAdmin()) return { ok: false, error: 'هذه الصلاحية للمدير العام فقط' };
    var users = db.settings.users || [];
    var out = { ok: false };
    for (var i = 0; i < users.length; i++) {
      if (users[i].username === username) {
        users[i].active = !users[i].active;
        out = { ok: true, active: users[i].active, local: true };
        break;
      }
    }
    var row = staffRowOf(username);
    if (row) {
      row.active = !(row.active !== false);
      out = { ok: true, active: row.active, cloud: true, local: out.local === true };
    }
    if (!out.ok) return { ok: false, error: 'الموظف غير موجود — لا محلياً ولا في القاعدة' };
    /* ⚠️ تنبيه: التنشيط/التعطيل محلياً وحده **لا يمنع الدخول** — المنع الحقيقي
       في القاعدة (brc.staff.active). اللوحة تُنجز ذلك بنداء صريح بمفتاح الخدمة
       أو بجلسة المدير، وهذا ما يمنع حالة «موظف معطَّل في الشاشة وداخل فعلاً». */
    audit(out.active ? 'تنشيط مستخدم' : 'تعطيل مستخدم', 'user', username, row ? 'سطر القاعدة + محلي' : 'محلي');
    save(); emit();
    return out;
  }

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

  /* تسميات العرض المعرَّبة (تُسجَّلها لوحة الموظفين) تُضاف إلى نص البحث فقط،
     كي يجد الباحث بـ«بطاقة» سطراً خاماً فيه «applicants». القيم الأصلية لا
     تُمسّ: لا في القاعدة ولا في التصدير ولا في الفلاتر. */
  var auditDisplayLabels = null;
  function setAuditDisplayLabels(fn) {
    auditDisplayLabels = typeof fn === 'function' ? fn : null;
  }

  // Arabic-friendly search without changing the original audit evidence.
  function auditSearchText(value) {
    return String(value == null ? '' : value).toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
      .replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 1632); })
      .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 1776); });
  }

  function listAudit(f) {
    f = f || {};
    var rows = db.audit.slice();
    var viewer = currentUser();
    // A staff member cannot widen their own audit view with a filter or export.
    if (viewer && viewer.role !== 'admin') rows = rows.filter(function (r) { return r.user === viewer.username; });
    if (f.role && f.role !== 'all') rows = rows.filter(function (r) { return r.role === f.role; });
    if (f.user && f.user !== 'all') rows = rows.filter(function (r) { return r.user === f.user; });
    if (f.action && f.action !== 'all') rows = rows.filter(function (r) { return r.action === f.action; });
    if (f.entity && f.entity !== 'all') rows = rows.filter(function (r) { return r.entity === f.entity; });
    var words = auditSearchText(f.q || '').trim().split(/\s+/).filter(Boolean);
    if (words.length) rows = rows.filter(function (r) {
      var display = '';
      if (auditDisplayLabels) {
        try { display = auditDisplayLabels(r) || ''; } catch (e) { display = ''; }
      }
      var text = auditSearchText([r.action, r.details, r.entityId, r.entity,
        r.user, r.name, r.ip, display].join(' '));
      return words.every(function (word) { return text.indexOf(word) >= 0; });
    });
    // Inclusive calendar-day filters use Baghdad, independent of device zone.
    var from = f.from || '', to = f.to || '';
    if ((from && fmtDate(from) !== from) || (to && fmtDate(to) !== to) || (from && to && from > to)) return [];
    if (from || to) rows = rows.filter(function (r) {
      var day = fmtDate(r.ts); return day !== '—' && (!from || day >= from) && (!to || day <= to);
    });
    return rows.sort(function (a, b) {
      var delta = new Date(b.ts).getTime() - new Date(a.ts).getTime();
      return f.sort === 'oldest' ? -delta : delta;
    });
  }

  /* ======================= الوظائف ======================= */

  function nextJobCode() {
    var code;
    do { db.counters.jobCode++; code = 'HRC-' + db.counters.jobCode; }
    while (db.jobs.some(function (j) { return j.code === code; }));
    return code;
  }

  /* تطبيع اسم المحافظة: همزات/تاء مربوطة/ياء ومسافات، مع أسماء بديلة شائعة
     (الديوانية = القادسية · اربيل = أربيل · حلبجه = حلبجة …) — كي يطابق فلتر
     المحافظة الصفوفَ القادمة من القاعدة بأي كتابة. */
  var GOV_ALIASES = {
    'الديوانية': 'القادسية', 'الديوانيه': 'القادسية', 'الديوانة': 'القادسية',
    'قادسية': 'القادسية', 'ديوانية': 'القادسية',
    'اربيل': 'أربيل', 'اربیل': 'أربيل', 'هولير': 'أربيل',
    'الانبار': 'الأنبار', 'انبار': 'الأنبار',
    'سليمانية': 'السليمانية', 'السليمانيه': 'السليمانية',
    'دهوك': 'دهوك', 'حلبجه': 'حلبجة',
    'ذي قار': 'ذي قار', 'ذيقار': 'ذي قار', 'الناصرية': 'ذي قار',
    'ميسان': 'ميسان', 'العمارة': 'ميسان',
    'المثنى': 'المثنى', 'السماوة': 'المثنى',
    'واسط': 'واسط', 'الكوت': 'واسط',
    'نينوى': 'نينوى', 'الموصل': 'نينوى',
    'كربلاء': 'كربلاء', 'كربلاء المقدسة': 'كربلاء'
  };
  function govNorm(v) {
    var t = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    t = t.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ًٌٍَُِّْـ]/g, '');
    return t;
  }
  function govKey(v) {
    var raw = String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
    var norm = govNorm(raw);
    /* ابحث في الأسماء البديلة بمقارنة مُطبَّعة */
    for (var k in GOV_ALIASES) {
      if (!Object.prototype.hasOwnProperty.call(GOV_ALIASES, k)) continue;
      if (govNorm(k) === norm) return govNorm(GOV_ALIASES[k]);
    }
    return norm;
  }

  function listJobs(f) {
    f = f || {};
    var rows = db.jobs.slice();
    if (f.status && f.status !== 'all') rows = rows.filter(function (j) { return j.status === f.status; });
    if (f.governorate && f.governorate !== 'all') {
      var want = govKey(f.governorate);
      rows = rows.filter(function (j) { return govKey(j.governorate) === want; });
    }
    if (f.shift && f.shift !== 'all') rows = rows.filter(function (j) { return j.shift === f.shift; });
    if (f.category && f.category !== 'all') rows = rows.filter(function (j) { return j.category === f.category; });
    if (f.q) {
      var q = f.q.trim().toLowerCase();
      rows = rows.filter(function (j) {
        return (j.code + ' ' + j.title + ' ' + (j.governorate || '') + ' ' + j.category + ' ' + (j.employer ? (j.employer || {}).name : ''))
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
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return null;
    var job = {
      id: uid('job'), code: nextJobCode(), title: data.title, category: data.category || 'خدمات',
      region: data.region || '', governorate: data.governorate || 'بابل', salaryMin: data.salaryMin, salaryMax: data.salaryMax, shift: data.shift,
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
    audit('إضافة وظيفة', 'job', job.code, job.title + ' — ' + (job.governorate || '—') + ' — الأجر ' + money(job.salaryMin) + ' إلى ' + money(job.salaryMax));
    save(); emit(); revalidateJobs('job-create');
    return job;
  }

  function updateJob(code, patch) {
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return null;
    var job = getJob(code); if (!job) return null;
    var before = JSON.stringify({ t: job.title, g: job.governorate, s: job.status });
    Object.keys(patch).forEach(function (k) { if (patch[k] !== undefined) job[k] = patch[k]; });
    audit('تعديل وظيفة', 'job', job.code, 'تحديث بيانات الوظيفة (' + before + ' ← ' + JSON.stringify({ t: job.title, g: job.governorate, s: job.status }) + ')');
    save(); emit();
    return job;
  }

  function setJobStatus(code, status, reason) {
        /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return false;
    var job = getJob(code); if (!job) return null;
    var old = job.status;
    job.status = status; job.manualClosed=status==='closed';
    if (status === 'available') { job.reservedBy = null; job.holdExpiresAt = null; }
    if (status === 'closed') { job.closedAt = nowISO(); job.reservedBy = null; job.holdExpiresAt = null; }
    refreshVacancies(job);
    audit('تغيير حالة وظيفة', 'job', job.code, 'الحالة: ' + CFG.jobStatus[old].ar + ' ← ' + CFG.jobStatus[job.status].ar + (reason ? ' | السبب: ' + reason : ''));
    save(); emit(); revalidateJobs('job-status');
    return job;
  }

  function snapshotJob(job) {
    if (!job) return null;
    return {code:job.code,title:job.title,governorate:job.governorate || '',
      employer_name:(job.employer || {}).name || '', employer_phone:(job.employer || {}).phone || '',
      employer_address:(job.employer || {}).address || '', interview_location:job.interviewLocation || '',
      shift:job.shift || '', salary_min:job.salaryMin, salary_max:job.salaryMax};
  }

  function deleteJob(code) {
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return false;
    var job = getJob(code); if (!job) return false;
    /* حذف وظيفة عليها حجز/حرجة يغلق فرصة البطاقة المرتبطة (الفرصة مستهلكة —
       قرار معتمد: لا تعود الفرصة بأي نتيجة) */
    db.attempts.forEach(function (t) {
      if (t.jobId === job.id && (t.slotStatus === 'reserved' || t.slotStatus === 'critical' || t.slotStatus === 'hiring')) {
        t.slotStatus = 'expired';
        t.closedAt = nowISO();
        t.holdExpiresAt = null;
        t.note = 'حذفت الشركة الوظيفة ' + job.code + ' — استُهلكت الفرصة';
      }
      if(t.jobId===job.id) { if (!t.jobSnapshot && t.selectedAt) t.jobSnapshot=snapshotJob(job); t.jobId=null; }
    });
    if(db.meta&&db.meta.workspace){db.meta.explicitDeletes=db.meta.explicitDeletes||{};db.meta.explicitDeletes.jobs=(db.meta.explicitDeletes.jobs||[]).concat(code);}
    db.jobs = db.jobs.filter(function (j) { return j.code !== code; });
    audit('حذف وظيفة', 'job', code, job.title + ' — ' + (job.governorate || '—'));
    save(); emit(); revalidateJobs('job-delete');
    return true;
  }

  /* ======================= الباحثون عن العمل والبطاقات ======================= */


  var CARD_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var CARD_LEN = 10;
  var CARD_RE = /^[2-9A-HJKMNP-Z]{10}$/;
  var LEGACY_CARD_RE = /^HRC-BC-\d{6}$/;

  /* توحيد الإدخال: حروف كبيرة وبلا مسافات؛ والرقم القديم المجرّد (6 خانات) يُكمَّل بـ HRC-BC */
  function normalizeCardSerial(v) {
    var s = String(v == null ? '' : v).replace(/[٠-٩۰-۹]/g, function (n) { var c = n.charCodeAt(0); return String(c - (c >= 0x6f0 ? 0x6f0 : 0x660)); }).trim().toUpperCase().replace(/\s+/g, '');
    var m = /^(?:HRC-?BC-?)?(\d{6})$/.exec(s);
    if (m) return 'HRC-BC-' + m[1];
    return s;
  }

  function isCardSerial(v) {
    var s = normalizeCardSerial(v);
    return CARD_RE.test(s) || LEGACY_CARD_RE.test(s);
  }

  function randomIndex(n) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  /* كود عشوائي من 10 خانات مختلطة (3 أرقام على الأقل و3 أحرف على الأقل) */
  function randomCardCode() {
    for (var g = 0; g < 200; g++) {
      var s = '';
      for (var i = 0; i < CARD_LEN; i++) s += CARD_ALPHABET.charAt(randomIndex(CARD_ALPHABET.length));
      var digits = (s.match(/[2-9]/g) || []).length;
      if (digits >= 3 && CARD_LEN - digits >= 3) return s;
    }
    return null;
  }

  function randomSerial() {
    if (!db.usedSerials) db.usedSerials = [];
    var exists = {};
    db.applicants.forEach(function (a) { exists[a.serial] = 1; });
    for (var guard = 0; guard < 500; guard++) {
      var serial = randomCardCode();
      if (serial && !exists[serial] && db.usedSerials.indexOf(serial) < 0) {
        db.usedSerials.push(serial);
        return serial;
      }
    }
    return null; /* مستحيل عملياً: 31^10 احتمال */
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

  /* ⛔ أُلغي توليد رموز الفرص نهائياً (قرار 2026-10-25).
     لم تعد البطاقة تحمل أي رمز على ظهرها، ولا تُطبع رموز في أي مكان.
     الاستخدام صار بالباركود وحده: حيازة البطاقة = التحكم (نفس سياسة صفحة
     التقديم والتحقق منذ 2026-10-06). تُترك هذه الدالة لإرجاع نص فارغ كي تبقى
     بنية سجل الفرصة كما هي في القاعدة ولا تنكسر المزامنة. */
  function chanceCode() { return ''; }

  function createApplicant(data) {
    /* ⛔ حارس: كانت بلا حارس — زائر أنشأ استمارة كاملة. */
    if (!isStaffSession()) return { ok: false, error: 'إنشاء الاستمارات يتطلب حساب موظف' };
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
     والصلاحية (30 يوماً) لا تبدأ إلا عند أول تقديم ناجح. */
  function createCardBatch(count, notes) {
    /* ⛔ الإصدار للمدير فقط. */
    if (!isAdmin()) return [];
    count = Math.max(1, Math.min(1000, Number(count) || 0));
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
      ' — الصلاحية تبدأ عند أول تقديم ناجح' + (notes ? ' | ' + notes : ''));
    save(); emit();
    return made;
  }


  function createCardWithSerial(serial, notes) {
    /* ⛔ الإصدار للمدير فقط. */
    if (!isAdmin()) return { ok: false, error: 'إصدار البطاقات صلاحية المدير العام فقط' };
    serial = normalizeCardSerial(serial);
    if (!isCardSerial(serial))
      return { ok: false, error: 'صيغة الباركود غير صحيحة — 10 خانات من حروف وأرقام بلا شرطة (مثال: 7KQ4M9TR2X)، أو اتركه فارغاً ليُولَّد تلقائياً' };
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
      'بطاقة فارغة واحدة بكود يدوي مختار — فرص حسب إعداد البطاقة — تُطبع الآن وتُعبّأ عند البيع' +
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
      var s = randomCardCode();
      if (s && !exists[s] && db.usedSerials.indexOf(s) < 0) return s;
    }
    return '';
  }

  /* تعبئة بطاقة فارغة عند البيع (نقطة البيع): بيانات الزبون تُسجَّل على نفس
     الباركود المطبوع على الورقة، والصلاحية تبدأ عند أول تقديم ناجح. */
  function activateCard(serial, data) {
    /* ⛔ حارس احتياطي: التفعيل الحقيقي عبر apply_with_card في القاعدة. */
    if (!isStaffSession()) return { ok: false, error: 'تفعيل البطاقات يتطلب حساب موظف' };
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
    app.fullName = String(data.fullName).trim();
    app.phone = String(data.phone).trim();
    app.address = data.address || '';
    app.dob = data.dob || '';
    app.gender = data.gender || 'ذكر';
    app.status = 'active';
    app.issueDate = null;
    app.expiryDate = null;
    app.posName = data.posName || '';
    app.fee = Number(data.fee != null ? data.fee : app.fee);
    app.feePaid = data.feePaid != null ? !!data.feePaid : true;   /* بيع كاش */
    if (data.notes) app.notes = data.notes;
    if (!getAttempts(serial).length) createAttempts(serial);
    audit('بيع وتعبئة بطاقة فارغة', 'applicant', app.serial,
      'بيع البطاقة ' + app.serial + ' للزبون ' + app.fullName +
      (app.posName ? ' — نقطة البيع: ' + app.posName : '') +
      ' — سعر ' + money(app.fee) + ' (كاش) — تبدأ الصلاحية عند أول تقديم ناجح' +
      (preJob ? ' | الوظيفة المختارة: ' + preJob.code + ' — ' + preJob.title
              : ' | بلا اختيار وظيفة — الفرص بانتظار اختيار الزبون بنفسه'));
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

  /* البطاقات الفارغة المتاحة للبيع عند نقطة البيع */
  function listBlankCards() {
    return db.applicants.filter(function (a) { return a.status === 'blank'; })
      .sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
  }

  // Freeze each card's entitlement at issuance, independent of later settings.
  function cardAttemptLimit(app) {
    return Number(app.attemptLimit || getAttempts(app.serial).length || 2);
  }

  function createAttempts(serial) {
    var app = getApplicant(serial);
    var limit = Number((app && app.attemptLimit) || db.settings.attemptLimit || 2);
    if (app) app.attemptLimit = limit;
    for (var i = 1; i <= limit; i++) {
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
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return { ok: false, error: 'يتطلب حساب موظف' };
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
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return { ok: false, error: 'يتطلب حساب موظف' };
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
      copy.attemptLimit = cardAttemptLimit(a);
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
    if (app.status === 'expired') return 'expired';
    if (app.expiryDate && new Date(app.expiryDate).getTime() < Date.now()) return 'expired';
    /* «سارية» ما دامت فرصة قيد اللعب (حجز جارٍ أو حالة حرجة بانتظار قرار) —
       أما «استُهلكت الفرصتان» فتعني انتهاء كل الفرص بنتيجة نهائية. */
    var inPlay = getAttempts(app.serial).some(function (t) {
      return t.slotStatus === 'reserved' || t.slotStatus === 'critical' || t.slotStatus === 'hiring';
    });
    if (attemptsLeft(app.serial) === 0 && !inPlay) return 'exhausted';
    return 'active';
  }

  /* ======================= الفرص: الاختيار والنتائج ======================= */

  // A vacancy is not a card chance: filled seats remain occupied permanently.
  function vacancySummary(job) {
    var total=Math.max(1,Number(job.vacancies||1)),occupied={},held=0,filled=0;
    (job.filledVacancyNumbers||[]).forEach(function(n){occupied[n]=true;});
    db.attempts.filter(function(t){return t.jobId===job.id && ['reserved','critical','hiring','succeeded'].indexOf(t.slotStatus)>=0;}).forEach(function(t){
      var n=Number(t.vacancyNo||1);occupied[n]=true;if(t.slotStatus!=='succeeded')held++;
    });
    filled=Object.keys(occupied).length-held;
    var free=[];for(var i=1;i<=total;i++)if(!occupied[i])free.push(i);
    return {total:total,filled:filled,held:held,available:job.manualClosed?0:free.length,free:job.manualClosed?[]:free};
  }
  function refreshVacancies(job) {
    if(!job)return;
    var v=vacancySummary(job),active=db.attempts.filter(function(t){return t.jobId===job.id&&['reserved','critical','hiring'].indexOf(t.slotStatus)>=0;});
    job.status=job.manualClosed?'closed':v.available?'available':v.filled>=v.total?'closed':active.some(function(t){return t.slotStatus==='hiring';})?'hiring':'reserved';
    job.reservedBy=active.length?active[0].serial:null;job.holdExpiresAt=active.length?active[0].holdExpiresAt:null;
    job.critical=active.some(function(t){return t.slotStatus==='critical';});job.updatedAt=nowISO();
    job.closedAt=job.status==='closed'?nowISO():null;
  }

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
    var freeSeat=vacancySummary(job).free[0];
    if(!freeSeat)return {ok:false,error:'لا يوجد شاغر متاح'};
    slot.vacancyNo=freeSeat;
    slot.jobId = job.id; slot.jobCode = job.code; slot.jobTitle = job.title; slot.jobSnapshot = snapshotJob(job);
    slot.location = job.governorate || ''; slot.employerName = (job.employer || {}).name; slot.employerPhone = (job.employer || {}).phone;
    slot.slotStatus = 'reserved';
    slot.selectedAt = nowISO();
    if (!app.issueDate && !app.expiryDate) {
      app.issueDate = slot.selectedAt;
      app.expiryDate = addDays(new Date(slot.selectedAt), Number(db.settings.validityDays || 30)).toISOString();
    }
    slot.holdExpiresAt = addHours(new Date(), hours).toISOString();
    slot.staff = currentUser() ? currentUser().username : 'system';

    refreshVacancies(job);

    audit('حجز مؤقت لوظيفة', 'job', job.code,
      'الفرصة #' + slot.no + ' للبطاقة ' + serial + ' — تعليق الوظيفة ' + hours + ' ساعة حتى ' + fmtDateTime(slot.holdExpiresAt) +
      (opts.byCustomer ? ' | تقديم ذاتي من الزبون بالباركود' : ''));
    save(); emit();
    return { ok: true, attempt: slot, job: job };
  }

  /* ======================= بطاقتي: واجهة الزبون العامة ======================= */
  /* إثبات الحيازة للطباعة: رمز مستقل للبطاقات الجديدة، ورمز فرصة للقديمة فقط. */
  function cardVerifyCode(serial, code) {
    serial = String(serial || '').trim().toUpperCase();
    code = String(code || '').trim().toUpperCase();
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الباركود' };
    var normalized = code.replace(/[^A-Z0-9]/g, '');
    /* بطاقة بلا رمز تحقق مطبوع (جديدة أو قديمة بعد إلغاء رموز الفرص):
       الحيازة نفسها هي الإثبات — يكفي الباركود. */
    if (!app.cardPrintCode) return { ok: true, app: app, attempts: getAttempts(serial) };
    var valid = !!normalized && (app.cardPrintCode
      ? normalized === app.cardPrintCode
      : getAttempts(serial).some(function (t) { return String(t.code || '').replace(/[^A-Z0-9]/g, '') === normalized; }));
    if (!valid) return { ok: false, error: 'رمز التحقق غير صحيح — انسخه من ظهر البطاقة' };
    return { ok: true, app: app, attempts: getAttempts(serial) };
  }



  /* عرض آمن للبطاقة للزبون نفسه (بالباركود): بلا رموز الفرص وبلا بيانات صاحب
     العمل — هذه أصول الشركة. الرمز سرّي يدخله الزبون من ورقته عند التقديم. */
  function lookupCard(serial) {
    var app = getApplicant(String(serial || '').trim().toUpperCase());
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الباركود — تأكد من الرقم المطبوع على بطاقتك' };
    if (app.status === 'pending') return { ok: false, error: 'هذه البطاقة قيد المراجعة لدى الشركة' };
    if (app.status === 'blank') {
      var empty = getAttempts(app.serial).filter(function (t) { return t.slotStatus === 'empty'; });
      return {ok:true, card:{serial:app.serial, status:'blank', fullName:'', phone:'', issueDate:null, expiryDate:null,
        chancesLeft:empty.length, usesCardPrintCode:false, succeeded:false,
        chances:empty.map(function (t) { return {no:t.no, slotStatus:'empty'}; })}};
    }
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
        usesCardPrintCode: !!app.cardPrintCode,
        chances: attempts,
        succeeded: attempts.some(function (t) { return t.slotStatus === 'succeeded'; })
      }
    };
  }

  /* استخدام فرصة من الزبون: الباركود وحده كافٍ — أُلغيت رموز الفرص 2026-10-25.
     تُستهلك أول فرصة فارغة بالترتيب. */
  function useChance(serial, code, jobCode) {
    /* توافق: كانت البصمة (serial, code, jobCode) — نقبل الآن (serial, jobCode) */
    if (jobCode === undefined && code) { jobCode = code; code = ''; }
    serial = String(serial || '').trim().toUpperCase();
    var app = getApplicant(serial);
    if (!app) return { ok: false, error: 'لا توجد بطاقة بهذا الباركود' };
    var st = formStatus(app);
    if (st === 'blank') return { ok: false, error: 'هذه البطاقة فارغة ولم تُبع بعد' };
    if (st === 'expired') return { ok: false, error: 'انتهت صلاحية البطاقة (30 يوماً)' };
    if (st === 'exhausted') return { ok: false, error: 'استُهلكت فرص البطاقة — تشترى بطاقة جديدة من نقاط البيع' };
    var slot = getAttempts(serial).filter(function (t) { return t.slotStatus === 'empty'; })[0];
    if (!slot) return { ok: false, error: 'لا توجد فرصة متاحة في هذه البطاقة' };
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
    if (st.configured && st.willBoot) {
      if (st.state === 'connecting' && cloud.bootPromise) return cloud.bootPromise.then(function () { return cardLookup(serial); });
      if (st.state === 'on' && root.HRCCloud && root.HRCCloud.lookupCard && cloud.client)
        return root.HRCCloud.lookupCard(cloud.client, serial);
      return Promise.resolve({ok:false, error:'تعذّر الاتصال بقاعدة الشركة — تحقّق من الإنترنت وأعد المحاولة.'});
    }
    return Promise.resolve(lookupCard(serial));
  }

  function customerApplication(serial, no) {
    var st = cloudStatus();
    if (st.configured) {
      if (st.state === 'on' && cloud.client && root.HRCCloud && root.HRCCloud.customerApplication)
        return root.HRCCloud.customerApplication(cloud.client, serial, no);
      return Promise.resolve({ok:false, error:'تعذّر الاتصال لتحميل تفاصيل التقديم'});
    }
    var app = getApplicant(String(serial || '').trim().toUpperCase());
    var t = app && getAttempts(app.serial).filter(function (a) { return Number(a.no) === Number(no) && a.slotStatus !== 'empty' && a.selectedAt && a.jobCode; })[0];
    var j = t && t.jobId && getJob(t.jobCode);
    if (j && j.id !== t.jobId) j = null;
    var snap = (t && t.jobSnapshot && t.jobSnapshot.code === t.jobCode) ? t.jobSnapshot : j ? snapshotJob(j) : null;
    if (!app || ['blank','pending','rejected'].indexOf(app.status) >= 0 || !t || !snap || snap.code !== t.jobCode)
      return Promise.resolve({ok:false,error:'تفاصيل هذا التقديم غير متاحة، تواصل مع الشركة'});
    return Promise.resolve({ok:true, app:app, attempt:Object.assign({}, t, {
      jobTitle:snap.title, location:snap.governorate,
      employerName:snap.employer_name, employerPhone:snap.employer_phone,
      employerAddress:snap.employer_address, interviewLocation:snap.interview_location,
      shift:snap.shift, salaryMin:snap.salary_min, salaryMax:snap.salary_max
    })});
  }

  function cardUseChance(serial, code, jobCode) {
    if (jobCode === undefined && code) { jobCode = code; code = ''; }
    var st = cloudStatus();
    if (st.configured && st.state === 'on' && root.HRCCloud && root.HRCCloud.useChance && cloud.client) {
      return root.HRCCloud.useChance(cloud.client, serial, code, jobCode);
    }
    return Promise.resolve(useChance(serial, code, jobCode));
  }

  /* تفعيل من نقطة البيع (تعبئة بطاقة فارغة عند البيع).
     ⚠️ محلي دائماً — عمداً (2026-11-13):
     `brc.activate_card` منزوعة من anon و authenticated منذ
     20261030100000_remove_direct_card_sale.sql، فكان هذا الفرع يحاول نداءً
     مرفوضاً في كل مرة ثم يسقط للمسار المحلي. والنتيجة أن الموظف يرى نجاحاً
     بعد محاولة فاشلة، والبيع يُسجَّل على جهازه لا في القاعدة.
     والمسار الحقيقي في السحابة هو إدخال الموظف من اللوحة (apply_with_card
     للتقديم لا للبيع). لذلك لا نحاول ما نعرف أنه مرفوض. */
  function cardActivate(serial, data) {
    return Promise.resolve(activateCard(serial, data));
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
            address: d.address || '', dob: d.dob || '', gender: d.gender || '', nationality: d.nationality || '',
            issueDate: d.issueDate, expiryDate: d.expiryDate, posName: d.posName || '', status: d.status || 'active', cardPrintCode: d.cardPrintCode || null
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
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return { ok: false, error: 'يتطلب حساب موظف' };
    if(['succeeded','rejected'].indexOf(outcome)<0)return {ok:false,error:'قرار غير صالح'};
    var slot = getAttempts(serial).filter(function (t) { return t.no === Number(no); })[0];
    if (!slot) return { ok: false, error: 'الفرصة غير موجودة' };
    if(['reserved','critical','hiring'].indexOf(slot.slotStatus)<0)return {ok:false,error:'انحسمت هذه الفرصة أو تغيرت؛ حدّث التفاصيل'};
    var job = slot.jobId ? db.jobs.filter(function (j) { return j.id === slot.jobId; })[0] : null;
    slot.slotStatus = outcome;
    slot.closedAt = nowISO();
    slot.note = note || slot.note;
    slot.holdExpiresAt = null;

    refreshVacancies(job);
    // تفعيل الفرصة التالية تلقائياً (أول خانة فارغة متبقية على البطاقة)
    var next = null;
    if (outcome === 'rejected') next = activeAttempt(serial);
    audit(outcome === 'succeeded' ? 'إتمام توظيف' : 'رفض مرشح',
      'attempt', serial + ' / #' + no,
      (job ? job.code + ' — ' + job.title : '') + ' | ' +
      (outcome === 'succeeded'
        ? 'تم ملء الشاغر المعني فقط — وتبقى بقية الشواغر وفرصة الزبون الأخرى حسب حالتها'
        : 'إعادة الشاغر المعني إلى (متاح) وتفعيل الفرصة #' + (next ? next.no : '—') + ' تلقائياً') +
      (note ? ' | ملاحظة: ' + note : ''));
    save(); emit();
    return { ok: true, attempt: slot, job: job, nextAttempt: next };
  }

  /* إقرار الموظف بعد الحالة الحرجة: إرجاع الوظيفة متوفرة — الفرصة تبقى
     مستهلكة (قرار معتمد: لا تعود الفرصة بأي نتيجة). */
  function releaseHold(serial, no, reason) {
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return { ok: false, error: 'يتطلب حساب موظف' };
    var slot = getAttempts(serial).filter(function (t) { return t.no === Number(no); })[0];
    if (!slot) return { ok: false, error: 'الفرصة غير موجودة' };
    if(['reserved','critical','hiring'].indexOf(slot.slotStatus)<0)return {ok:false,error:'انحسمت هذه الفرصة أو تغيرت؛ حدّث التفاصيل'};
    var job = slot.jobId ? db.jobs.filter(function (j) { return j.id === slot.jobId; })[0] : null;
    slot.slotStatus = 'expired';
    slot.closedAt = nowISO();
    slot.holdExpiresAt = null;
    slot.note = reason || 'قرار الشركة بعد انتهاء مهلة الحجز — استُهلكت الفرصة وأُعيدت الوظيفة متوفرة';
    refreshVacancies(job);
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

    db.attempts.forEach(function(t){
      if(t.slotStatus!=='reserved'||!t.holdExpiresAt||new Date(t.holdExpiresAt)>now)return;
      t.slotStatus='critical';t.holdExpiresAt=null;t.note='انتهت مهلة 24 ساعة — بانتظار قرار الشركة';
      refreshVacancies(db.jobs.filter(function(j){return j.id===t.jobId;})[0]);
      actions.push({type:'criticalHold',job:t.jobCode,serial:t.serial});
    });

    // 2) انتهاء صلاحية البطاقات (30 يوماً)
    db.applicants.forEach(function (app) {
      if (app.status === 'active' && app.expiryDate && new Date(app.expiryDate).getTime() < now.getTime()) {
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
      attemptLimit: cardAttemptLimit(app),
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
    if(db.meta&&db.meta.workspace&&db.meta.serverReport)return Object.assign({},db.meta.serverReport.stats,{available:db.jobs.filter(function(j){return j.status==='available';}).length,reserved:db.jobs.filter(function(j){return j.status==='reserved';}).length});
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
    if(db.meta&&db.meta.workspace){var cached=db.meta.financialReport;if(cached&&cached.key===String(from||'')+'|'+String(to||''))return cached.data.rows;if(!from&&!to&&db.meta.serverReport)return db.meta.serverReport.rows;return [];}
    var rows = {};
    db.applicants.forEach(function (a) {
      /* استمارة قيد الطلب (issueDate = null) لا تنتمي لأي يوم: كانت تُقارَن
         بـ null فتمرّ في كل نطاق — وهذا يُفسد فلتر «اليوم/أمس». */
      if ((from || to) && !a.issueDate) return;
      var day = fmtDate(a.issueDate);
      if ((from || to) && day === '—') return;
      if (from && day < from) return;
      if (to && day > to) return;
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
    db.attempts.forEach(function(t){
      var j=db.jobs.filter(function(j){return j.id===t.jobId;})[0];
      if(!j||['reserved','critical','hiring'].indexOf(t.slotStatus)<0)return;
      var row={job:Object.assign({},j,{holdExpiresAt:t.holdExpiresAt}),serial:t.serial,attempt:t,vacancyNo:t.vacancyNo||1,decision:t.employerDecision,at:t.decisionAt,reason:t.reason||'',decidedBy:t.employerDecision==='reject'?'employer':'hold'};
      if(t.slotStatus==='reserved'){row.hoursLeft=diffHours(t.holdExpiresAt,new Date());out.holds.push(row);}
      if(t.slotStatus==='critical')out.critical.push(row);
      if(t.slotStatus==='hiring')out.hiring.push(row);
    });
    db.applicants.forEach(function (a) {
      var st = formStatus(a);
      if (st === 'pending') { out.requests.push(a); return; }
      if (st === 'rejected') return;
      var used = getAttempts(a.serial).filter(function (t) { return t.slotStatus !== 'empty'; }).length;
      if (st === 'expired') out.expired.push(a);
      else if (used >= cardAttemptLimit(a)) out.exhausted.push(a);
      var rej = getAttempts(a.serial).filter(function (t) { return t.slotStatus === 'rejected'; });
      if (rej.length) out.rejected.push({ applicant: a, count: rej.length });
    });
    return out;
  }

  function markPrinted(serial) {
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return;
    var app = getApplicant(serial); if (!app) return;
    app.printedCount = Number(app.printedCount || 0) + 1;
    audit('طباعة بطاقة', 'applicant', serial, 'طباعة بطاقة التوظيف 59.4×94.6مم مع باركود QR — العدد الكلي ' + app.printedCount);
    save(); emit();
  }

  function setFeePaid(serial, paid, amount) {
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isStaffSession()) return;
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
    if (enforceAuth() || !isAdmin() || (cloud.state === 'on' && cloud.role === 'staff')) {
      console.warn('[HRC] إعادة الضبط مرفوضة في الوضع السحابي');
      return false;
    }
    if (!saveScheduledBackup('قبل إعادة ضبط التجربة', null)) return false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
    db = seedDb(); save();
    audit('إعادة ضبط البيانات', 'system', '—', 'إعادة تهيئة قاعدة البيانات المحلية إلى البيانات التجريبية');
    save(); emit(); return true;
  }

  function exportJson() {
    if(db.meta&&db.meta.workspace)throw new Error('هذه بيانات العمل فقط؛ استخدم النسخة الكاملة من إدارة الاسترجاع');
    if (enforceAuth() && !isAdmin()) throw new Error('التصدير السحابي للمدير فقط');
    return JSON.stringify(db, null, 2);
  }

  function previewBackup(text) {
    if (typeof text !== 'string' || text.length > 32 * 1024 * 1024) throw new Error('حجم النسخة غير صالح');
    var p = JSON.parse(text);
    if(p&&p.meta&&p.meta.partialTables&&p.meta.partialTables.length)throw new Error('نسخة عمل جزئية وليست نسخة استرجاع كاملة');
    if (!p || !p.meta || p.meta.version !== 2 || !p.settings || !p.counters) throw new Error('إصدار نسخة غير مدعوم');
    ['jobs', 'applicants', 'attempts', 'audit'].forEach(function (k) {
      if (!Array.isArray(p[k]) || p[k].length > 100000) throw new Error('جدول غير صالح: ' + k);
    });
    var jobs = Object.create(null), apps = Object.create(null), slots = Object.create(null);
    p.jobs.forEach(function (j) { if (!j || typeof j.code !== 'string' || !j.code || jobs[j.code]) throw new Error('وظائف مكررة أو غير صالحة'); jobs[j.code] = true; });
    p.applicants.forEach(function (a) { if (!a || typeof a.serial !== 'string' || !a.serial || apps[a.serial]) throw new Error('بطاقات مكررة أو غير صالحة'); apps[a.serial] = true; });
    p.attempts.forEach(function (t) {
      var key = t && (t.serial + ':' + t.no);
      if (!t || !apps[t.serial] || !Number.isInteger(t.no) || t.no < 1 || slots[key] ||
          (['reserved', 'critical'].indexOf(t.slotStatus) >= 0 && !jobs[t.jobCode])) throw new Error('علاقات الفرص غير صالحة');
      slots[key] = true;
    });
    return { jobs: p.jobs.length, applicants: p.applicants.length, attempts: p.attempts.length, version: 2 };
  }

  function assertLocalRestore() {
    if (enforceAuth() || (cloud.state === 'on' && cloud.role === 'staff')) throw new Error('الاستعادة مرفوضة في الموقع السحابي؛ استخدم بيئة اختبار معزولة');
    if (!isAdmin()) throw new Error('الاستعادة للمدير فقط');
  }

  function importJson(text) {
    /* ⛔ حارس صلاحية (الفحص هنا لا في الزر) */
    if (!isAdmin()) throw new Error('الاستيراد يتطلب حساب مدير');
    assertLocalRestore();
    previewBackup(text);
    var parsed = JSON.parse(text);
    if (!saveScheduledBackup('قبل الاستيراد - ' + fmtDateTime(new Date()), null)) throw new Error(lastBackupError || 'تعذر حفظ نسخة أمان؛ لم تتغير البيانات');
    db = parsed; save();
    normalizeSerialLog();
    audit('استيراد بيانات', 'system', '—', 'استيراد نسخة احتياطية تحتوي ' + parsed.jobs.length + ' وظيفة و' + parsed.applicants.length + ' استمارة');
    save(); emit();
  }



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
    if (!isAdmin()) return [];
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
    var from = range.from || null;
    var to = range.to || null;
    var inRange = function (ts) {
      if (!ts) return false;
      var day = fmtDate(ts);
      if (day === '—' || (from && day < from) || (to && day > to)) return false;
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
    if (!isAdmin() || enforceAuth()) { lastBackupError = 'الحفظ غير المشفر في المتصفح متوقف؛ استخدم التصدير المشفر أو وكيل النسخ المستقل'; return null; }
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
    if (!isAdmin()) return false;
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
    try { assertLocalRestore(); if (!isAdmin()) throw new Error('الاستعادة للمدير فقط'); }
    catch (e) { lastBackupError = e.message; return false; }
    var backup = getScheduledBackups().filter(function (b) { return b.id === id; })[0];
    if (!backup || !backup.data) return false;
    try {
      previewBackup(JSON.stringify(backup.data));
      if (!saveScheduledBackup('قبل الاستعادة - ' + fmtDateTime(new Date()), null)) return false;
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
    if (!isAdmin() || enforceAuth()) { lastBackupError = 'جدولة المتصفح غير متاحة للسحابة؛ استخدم مهمة ويندوز المستقلة'; return null; }
    var s = { days: (days || []).map(Number).filter(function (n) { return n >= 0 && n <= 6; }), time: time || '23:00', createdAt: nowISO() };
    if (!s.days.length) return null;
    if (!writeJson(SCHEDULE_KEY, s)) { lastBackupError = 'تعذّر حفظ الجدولة — مساحة التخزين ممتلئة.'; return null; }
    audit('تفعيل النسخ الاحتياطي المجدول', 'backup', '—', 'الأيام: ' + s.days.join(',') + ' الساعة ' + s.time);
    save();
    return getAutoSchedule();
  }

  function clearAutoSchedule() {
    if (!isAdmin()) return false;
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
    if (!isAdmin() || enforceAuth()) return null;
    var s = getAutoSchedule();
    if (!s) return null;
    var d = now ? new Date(now) : new Date();
    if (s.days.indexOf(new Date(fmtDate(d)+'T12:00:00Z').getUTCDay()) < 0) return null;
    var parts = String(s.time).split(':');
    var slot = new Date(fmtDate(d)+'T'+pad(Number(parts[0])||0,2)+':'+pad(Number(parts[1])||0,2)+':00+03:00');
    if (d.getTime() < slot.getTime()) return null;             // لم يحن الوقت بعد
    var slotKey = fmtDate(d) + 'T' + s.time;
    if (readJson(AUTO_RUN_KEY, null) === slotKey) return null;  // نُفّذت مسبقاً
    var backup = saveScheduledBackup('نسخة تلقائية — ' + fmtDateTime(d), null, { auto: true });
    if (!backup) return null;
    writeJson(AUTO_RUN_KEY, slotKey);
    emit();
    return backup;
  }
  /* Cloud boot/fetch, diff push and official sessions. Never replay full snapshots. */
  var CORE_TABLES = ['jobs', 'applicants', 'job_attempts'];
  var PUSH_DELAY = 700;

  var cloud = {
    client: null, sync: null, auth: null,
    state: 'off',          // off | ready | connecting | on | degraded
    role: 'guest',         // staff | public | guest
    error: null, detail: null, failedTables: [],
    readOnly: false, applying: false, needsReload: false,
    timer: null, pushing: false, pushPromise: null,
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
    if (/card_print_code/i.test(msg) && (code === '42703' || code === 'PGRST204' || /column|schema cache/i.test(msg))) {
      return { text: 'تحديث رمز البطاقة غير مطبّق: العمود card_print_code مفقود',
        hint: 'طبّق ترحيلي 20261016090000 و20261016103000 قبل إصدار البطاقات' };
    }
    if (code === 'PGRST205' || /schema cache|does not exist/i.test(msg)) {
      return { text: 'المخطط غير مطبَّق على القاعدة (جدول مفقود)', hint: 'طبّق docs/schema.sql على المشروع' };
    }
    if (code === 'PGRST106' || /exposed|Invalid schema/i.test(msg)) {
      return { text: 'سكيما brc غير مُعرَّضة للمشروع', hint: 'Settings → API → Exposed schemas: أضف brc' };
    }
    if (code === '42501' || /permission denied/i.test(msg)) {
      /* ⚠️ عطل حقيقي أُصلح 2026-11-17. الرسالة القديمة «راجع سياسات ومنح
         §8 و§9» كانت **مضلّلة**: المالك راجعها ولم يجد شيئاً، لأن السبب
         لم يكن سياسة ولا منحاً على الجدول — بل منحاً على **التسلسل**.

         `permission denied for sequence X` خطأ مختلف تماماً عن
         `permission denied for table X`، وإصلاحه سطر واحد مختلف. ولكل
         تسلسل اسمه في الرسالة، فنسحبه ونذكر الحلّ الدقيق بدل التوجيه
         العام. هذا الفرق بين «راجع ٣١٥٤ سطراً» و«نفّذ هذا السطر». */
      var seq = (/sequence\s+([a-z0-9_.]+)/i.exec(msg) || [])[1];
      if (seq) {
        var bare = seq.replace(/^brc\./, '');
        return {
          text: 'منح التسلسل مفقود: ' + bare,
          hint: 'نفّذ في SQL Editor: grant usage, select, update on sequence brc.' + bare +
                ' to authenticated;'
        };
      }
      return {
        text: 'لا صلاحية كافية (RLS/منح مفقود)',
        hint: 'إن كانت الرسالة تذكر sequence فمنح التسلسل ناقص — راجع منح التسلسلات في docs/schema.sql §9'
      };
    }

    if (code === '42703' || /column .* does not exist/i.test(msg)) {
      return {
        text: 'عمود مفقود في القاعدة' + (/jobs|governorate/i.test(msg) ? ' (governorate في brc.jobs)' : ''),
        hint: 'نفّذ docs/UPDATE-2026-10-13-governorate.sql في SQL Editor ثم notify pgrst, \'reload schema\''
      };
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
       فقط، فيبدو أن بياناته «ضاعت» بعد تحديث الصفحة.
       ⚡ الجلسة تُقرأ من التخزين أولاً (فورية)، ثم **بالتوازي**: سطر الموظف
       (brc.staff) وجلب البيانات. كانا متتاليين فتضيع رحلة كاملة (~100–200ms)
       في كل فتح للوحة. */
    if (!canReadStaffTables()) return publicBoot(null);
    if (!cloud.auth || !cloud.auth.sessionOnly) return loadFromCloud();
    return cloud.auth.sessionOnly().then(function (sess) {
      if (!sess || !sess.ok) {
        /* بلا جلسة موظف لا نقرأ جداول الموظفين. في اللوحة لا حاجة أيضاً
           لانتظار الوظائف العامة قبل السماح بالدخول. */
        // The staff login screen does not need the public jobs feed before it
        // can accept credentials. This is readiness, not proof of connectivity.
        if (enforceAuth() && typeof document !== 'undefined' && document.getElementById('app-shell')) {
          cloud.state = 'ready'; cloud.role = 'guest'; cloud.readOnly = true;
          cloud.error = null; cloud.detail = null;
          return cloudStatus();
        }
        return publicBoot(null);
      }
      var pProfile = Promise.resolve(cloud.auth.profileFor(sess.session)).then(function (r) {
        if (r && r.ok) { applyStaffSession(r.profile); return r; }
        return r || { ok: false };
      }).catch(function () { return { ok: false }; });
      var pData = loadFromCloud();
      return Promise.all([pProfile, pData]).then(function (out) {
        var r = out[0];
        if (r && r.ok) return out[1];
        /* لا سطر موظف فعّال: نُرجع نتيجة المسار العام التي حُسبت بالتوازي */
        return out[1];
      });
    }).catch(function () { return loadFromCloud(); });
  }

  /* بعد الإقلاع: تحميل تقارير اللوحة (المالية + سجل الرموز ~800KB) في الخلفية.
     لا تُعطّل ظهور اللوحة، وعند وصولها نُحدّث البيانات ونُعيد الرسم. */
  function loadReportsAfterBoot() {
    if (!root.HRCCloud.loadWorkspaceReports || !cloud.client) return;
    Promise.resolve().then(function () {
      return root.HRCCloud.loadWorkspaceReports(cloud.client);
    }).then(function (out) {
      out = out || {};
      var d = db;
      if (d && d.meta) {
        d.meta.reportsPending = false;
        if (out.report) d.meta.serverReport = out.report;
        var regErr = (out.errors || []).filter(function (e) { return e.scope === 'registry'; })[0];
        d.meta.registryMissing = !!regErr;
        if (regErr) cloud.registryMissing = true;
      }
      emit();
    }).catch(function () {
      if (db && db.meta) { db.meta.reportsPending = false; emit(); }
    });
  }

  /* ⚡ سجل التدقيق يُقرأ عند الطلب (أول فتح لشاشة السجل) بدل حجب الإقلاع به. */
  function loadAuditLog() {
    if (!cloud.client || !root.HRCCloud.loadAuditLog) return Promise.resolve(false);
    if (cloud.auditLoaded) return Promise.resolve(true);
    if (cloud.auditPromise) return cloud.auditPromise;
    cloud.auditPromise = root.HRCCloud.loadAuditLog(cloud.client, { limit: 300 }).then(function (res) {
      cloud.auditPromise = null;
      if (!res || !res.ok) return false;
      cloud.auditLoaded = true;
      if (db && db.meta) db.meta.auditPending = false;
      db.audit = res.rows || [];
      emit();
      return true;
    }).catch(function () { cloud.auditPromise = null; return false; });
    return cloud.auditPromise;
  }

  function loadFromCloud(prefetched) {
    /* الجداول أولاً (سريعة)، ثم التقارير الثقيلة في الخلفية — لا في مسار الإقلاع */
    /* ⚡ سجل التدقيق (حتى ٢٠٠٠ صف بأحجام كبيرة) لا يدخل مسار الإقلاع: يُقرأ
       عند فتح «سجل التدقيق» أول مرة، وتبقى اللوحة تعمل بلا انتظاره. */
    return (prefetched || root.HRCCloud.fetchAll(cloud.client,{workspace:true, deferReports:true, deferAudit:true})).then(function (cdb) {
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
      loadReportsAfterBoot();      /* خلفية: لا تُبطئ أول رسم للوحة */
      return cloudStatus();
    });
  }

  function publicBoot(coreError) {
    if (!root.HRCCloud.fetchPublicJobs) { cloud.state = 'degraded'; setCloudError(coreError); return cloudStatus(); }

    /* عرض فوري من ذاكرة الجلسة (٩٠ ثانية) ثم تحديث صامت:
       التنقّل داخل التبويب ذاته لا يُظهر هيكل تحميل إطلاقاً، والشبكة تُحدِّث
       القائمة في الخلفية فوراً. الذاكرة تحمل **بيانات القاعدة نفسها** فقط
       (لا بيانات تجريبية)، وتنتهي صلاحيتها تلقائياً. */
    var cached = null;
    try { cached = root.HRCCloud.readPublicCache ? root.HRCCloud.readPublicCache() : null; } catch (e) { cached = null; }
    if (cached && cached.length) {
      adoptPublicJobs(cached);
      cloud.role = 'public'; cloud.readOnly = true;
      cloud.state = 'on'; cloud.error = null; cloud.detail = null;
      /* إعادة التحقق في الخلفية — لا تُعطّل شيئاً ولا تُغيّر الحالة عند الفشل */
      root.HRCCloud.fetchPublicJobs(cloud.client).then(function (res) {
        if (res && res.ok && Array.isArray(res.jobs)) { adoptPublicJobs(res.jobs); }
      }).catch(function () { });
      return Promise.resolve(cloudStatus());
    }

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
      if(db.meta.workspace)db.usedSerials=[]; // Server issued_serials remains the permanent authority.
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
        cloud.lastError = d.text + (d.hint ? ' — ' + d.hint : '') + ' — ' + op.op + ' ' + op.table + ' (' + op.key + ')';
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
    if (cloud.pushing) return cloud.pushPromise;
    cloud.pushing = true;
    cloud.lastError = null;
    cloud.pushPromise = cloud.sync.push(db).then(function (res) {
      cloud.pushing = false;
      cloud.lastPushAt = nowISO();
      cloud.lastPush = res;
      if (res && res.failed) {
        /* العملية الفاشلة تبقى معلّقة (لا تُوسم كمُزامَنة) وتُعاد في الدفعة
           التالية — انظر advanceSnapshot في cloud-sync.js. */
        cloud.lastError = cloud.lastError || ('تعذّر دفع ' + res.failed + ' عملية — ستُعاد تلقائياً');
        console.warn('[HRC/sync] ' + cloud.lastError + ': ' + (res.pending || []).join(', '));
      } else if (res && !res.error) {
        /* ⚠️ عطل حقيقي أُصلح 2026-11-17 (بلاغ المالك: «هاي تروح من أسوي
           رفرش للموقع»).

           السبب: `lastError` كان يُمسح في **بداية** pushCloud فقط. فإذا
           نجح الدفع لاحقاً بلا رجوع إلى pushCloud (أو جاء `skipped` من
           مسار آخر)، بقي الخطأ القديم معلّقاً في الذاكرة. والواجهة تقرأ
           `cloudStatus().lastError` فتعرض رسالة «تعذّر إكمال المزامنة»
           على حالة سليمة تماماً.

           وهذا أخطر من خطأ حقيقي: خطأ كاذب يُفقد الثقة في الأداة، ويجعل
           المدير يظنّ نسخته غير آمنة وهو آمن. فالقاعدة: **النجاح يمحو
           الخطأ**، لا يبقى أثر لخطأ انتهى. */
        cloud.lastError = null;
        cloud.error = null;
        cloud.detail = '';
      }
      if (cloud.needsReload) { cloud.needsReload = false; return reloadFromCloud(); }
      return res;
    }).catch(function (e) {
      cloud.pushing = false;
      setCloudError(e);
      cloud.lastError = cloud.error;
      return { error: e };
    });
    return cloud.pushPromise;
  }

  /* إعادة قراءة كاملة — بعد تغيير من موظف آخر أو بعد استعادة الاتصال */
  function reloadFromCloud() {
    if (cloud.state !== 'on' || cloud.role !== 'staff' || !cloud.client) return Promise.resolve(cloudStatus());
    return root.HRCCloud.fetchAll(cloud.client,{workspace:true}).then(function (cdb) {
      if (((cdb.meta && cdb.meta.failedTables) || []).length) return cloudStatus();
      adoptCloudDb(cdb);
      if (cloud.sync) cloud.sync.setSnapshot(db);
      return cloudStatus();
    }).catch(function (e) { setCloudError(e); return cloudStatus(); });
  }


  function absorbRealtime(table, payload) {
    if (!cloud.sync) return;
    var type = payload.eventType || payload.type;
    var row = payload.new || payload.record || null;
    var old = payload.old || payload.old_record || null;
    var snap = cloud.sync.getSnapshot();
    if(table==='applicants'&&row&&row.archived_at&&db.meta&&db.meta.workspace){
      root.HRCSync.advanceSnapshot(snap,{table:'applicants',op:'delete',key:row.serial});
      Object.keys(snap.job_attempts).forEach(function(k){if(k.indexOf(row.serial+':')===0)root.HRCSync.advanceSnapshot(snap,{table:'job_attempts',op:'delete',key:k});});return;
    }
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

  function cardReport(from,to) {
    if(!currentUser()||cloud.state!=='on'||cloud.role!=='staff')return Promise.reject(new Error('التقرير الكامل يحتاج اتصالاً وحساب موظف فعالاً'));
    var owner=JSON.stringify(currentUser());
    return root.HRCCloud.rpcCall(cloud.client,'staff_card_report',{p_from:from||null,p_to:to||null}).then(function(r){
      if(owner!==JSON.stringify(currentUser())||r.error||!r.data||!r.data.stats||!Array.isArray(r.data.rows))throw new Error('تعذر قراءة التقرير الكامل');
      db.meta.financialReport={key:String(from||'')+'|'+String(to||''),data:r.data};if(!from&&!to)db.meta.serverReport=r.data;return r.data;
    });
  }

  // Persist one idempotency key before sending: a lost response is retried with
  // the SAME request even after reload. Never create a second batch blindly.
  function pendingCardIssue() {
    var user = currentUser();
    if (!user) return null;
    try { return JSON.parse(localStorage.getItem('hrc-card-issue-' + user.username) || 'null'); }
    catch (e) { return null; }
  }
  async function issueNumberedCards(count, serial, notes) {
    if (!isAdmin() || !currentUser() || cloud.state !== 'on' || cloud.role !== 'staff' || !cloud.client || !cloud.sync)
      throw new Error('إصدار البطاقات يحتاج اتصالاً وحساب مدير فعالاً');
    var owner = JSON.stringify(currentUser());
    var key = 'hrc-card-issue-' + currentUser().username;
    var req = pendingCardIssue();
    if (!req) {
      if (!Number.isInteger(count) || count < 1 || count > 90 || (serial && (count !== 1 || !isCardSerial(serial))) || String(notes || '').length > 1000)
        throw new Error('صيغة الباركود غير صحيحة أو بيانات الإصدار غير صالحة');
      if (!root.crypto || !root.crypto.randomUUID) throw new Error('المتصفح لا يدعم الإصدار الآمن؛ استخدم متصفحاً حديثاً');
      req = { id: root.crypto.randomUUID(), count: count, serial: serial || null, notes: notes || '' };
      try { localStorage.setItem(key, JSON.stringify(req)); if (!localStorage.getItem(key)) throw new Error(); }
      catch (e) { throw new Error('تعذّر حفظ طلب الإصدار بأمان؛ تحقق من مساحة المتصفح'); }
    }
    var response;
    try { response = await root.HRCCloud.rpcCall(cloud.client, 'issue_numbered_cards', {p_request:req.id,p_count:req.count,p_serial:req.serial,p_notes:req.notes}); }
    catch (e) { throw new Error('لم يصل تأكيد الإصدار. أعد المحاولة لاسترجاع نفس الطلب دون إصدار مكرر'); }
    if (response.error) {
      // Only a duplicate-code error is known to arise while creating a NEW
      // request. Other errors can occur while recovering a committed request
      // (e.g. after restore), so retain the key rather than risk duplication.
      var code=String(response.error.code || '');
      if (code === '23505') localStorage.removeItem(key);
      throw new Error(response.error.message || 'لم يصل تأكيد الإصدار؛ أعد المحاولة لاسترجاع الطلب نفسه');
    }
    if (owner !== JSON.stringify(currentUser())) throw new Error('تغيرت الجلسة؛ أعد الدخول لاسترجاع طلب الإصدار');
    var data=response.data;
    if (!data || !Array.isArray(data.cards) || data.cards.length !== req.count || !Array.isArray(data.attempts) || data.cards.some(function(r){return !Number.isSafeInteger(Number(r.card_number)) || Number(r.card_number)<1;}))
      throw new Error('تأكيد الإصدار غير مكتمل؛ أعد المحاولة لاسترجاع الطلب نفسه');
    var cards=data.cards.map(root.HRCCloud.applicantFromDb);
    var jobsById={},jobsByCode={},staffById={};
    db.jobs.forEach(function(j){jobsById[j.id]=j;jobsByCode[j.code]=j;});
    db.staff.forEach(function(st){staffById[st.id]=st;});
    var attempts=data.attempts.map(function(t){return root.HRCCloud.attemptFromDb(t,jobsById,jobsByCode,staffById);});
    var snap=cloud.sync.getSnapshot();
    cards.forEach(function(c){
      var i=db.applicants.findIndex(function(a){return a.serial===c.serial;});
      if(i<0) db.applicants.unshift(c); else db.applicants[i]=c;
      root.HRCSync.advanceSnapshot(snap,{table:'applicants',op:'update',key:c.serial,local:c});
    });
    attempts.forEach(function(t){
      var i=db.attempts.findIndex(function(a){return a.serial===t.serial && a.no===t.no;});
      if(i<0) db.attempts.push(t); else db.attempts[i]=t;
      root.HRCSync.advanceSnapshot(snap,{table:'job_attempts',op:'update',key:t.serial+':'+t.no,local:t});
    });
    saveLocal(); emit();
    localStorage.removeItem(key);
    return cards;
  }

  function serialWasIssued(serial) {
    if(!currentUser()||cloud.state!=='on'||cloud.role!=='staff')return Promise.reject(new Error('تعذر التحقق من الباركود في السجل الكامل'));
    return root.HRCCloud.rpcCall(cloud.client,'staff_issuance_registry',{p_serial:normalizeCardSerial(serial)}).then(function(r){if(r.error||!r.data||typeof r.data.used!=='boolean')throw new Error('تعذر التحقق من الباركود؛ أعد المحاولة');return r.data.used;});
  }

  function searchCardHistory(query,page) {
    if(!currentUser()||cloud.state!=='on'||cloud.role!=='staff')return Promise.reject(new Error('بحث السجل الكامل يحتاج اتصالاً وحساب موظف فعالاً'));
    return root.HRCCloud.rpcCall(cloud.client,'staff_card_history',{p_query:String(query||'').trim(),p_page:Number(page||0)}).then(function(r){
      if(r.error||!r.data||!Array.isArray(r.data.cards))throw new Error(r.error&&r.error.message||'تعذر قراءة السجل؛ تحقق من تحديث القاعدة');return r.data;
    });
  }

  function startRealtime() {
    if (cloud.unsubscribe || !root.HRCCloud.subscribeAll) return;
    cloud.unsubscribe = root.HRCCloud.subscribeAll(cloud.client, db, function (table, payload) {
      try { absorbRealtime(table, payload); } catch (e) { console.warn('[HRC/realtime] ' + (e && e.message || e)); }
      // Realtime sends base-table rows, not the joined working view. Resolve a
      // newly observed card's permanent number without overwriting later edits.
      if (table==='applicants' && payload.new && payload.new.serial && !payload.new.archived_at) {
        var liveSerial=payload.new.serial, liveOwner=JSON.stringify(currentUser());
        var existing=findLocal(db.applicants,function(a){return a.serial===liveSerial;});
        if (existing && !existing.cardNumberKnown && cloud.client) {
          root.HRCCloud.rpcCall(cloud.client,'card_number_for',{p_serial:liveSerial}).then(function(r){
            if(liveOwner!==JSON.stringify(currentUser()) || r.error) return;
            var card=findLocal(db.applicants,function(a){return a.serial===liveSerial;});
            var n=Number(r.data); if(card && (r.data === null || (Number.isSafeInteger(n) && n>0))){card.cardNumber=n>0?n:null;card.cardNumberKnown=true;saveLocal();emit();}
          }).catch(function(){});
        }
      }

      if(table==='applicants'&&payload.new&&payload.new.archived_at){
        clearTimeout(cloud.archiveTimer);var owner=JSON.stringify(currentUser());cloud.archiveTimer=setTimeout(function(){if(owner===JSON.stringify(currentUser())){saveLocal();emit();}},100);return;
      }
      saveLocal();
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

  /* تبني سطر موظف راجع من القاعدة (من إنشاء/تعديل حساب) في الذاكرة المحلية.
     بلا هذا يبقى الجدول يقول «محلي» عن حساب هو فعلاً في القاعدة، فيظن المدير أن
     الموظف لا يدخل من جهاز آخر — وهو الفرق الجوهري الذي يهمّ المدير. */
  function absorbStaffRow(raw) {
    if (!raw) return null;
    var row = (root.HRCCloud && root.HRCCloud.staffFromDb) ? root.HRCCloud.staffFromDb(raw) : {
      id: raw.id, authId: raw.auth_id || raw.authId || null, username: raw.username,
      name: raw.full_name || raw.name, role: raw.role || 'staff',
      title: raw.job_title || raw.title || '', phone: raw.phone || '', active: raw.active !== false
    };
    if (!row.id && !row.username) return null;
    if (!db.staff) db.staff = [];
    var idx = -1;
    for (var i = 0; i < db.staff.length; i++) {
      if ((row.id && db.staff[i].id === row.id) || (row.username && db.staff[i].username === row.username)) { idx = i; break; }
    }
    if (idx >= 0) db.staff[idx] = row; else db.staff.push(row);
    saveLocal(); emit();
    return row;
  }

  /* إنشاء حساب موظف في Supabase (Auth + brc.staff) */
  function createCloudAccount(serviceKey, data) {
    if (!cloudConfigured()) return Promise.resolve({ ok: false, code: 'no_cloud', error: 'لا يوجد إعداد سحابة في supabase-config.js' });
    if (!cloud.client || !root.HRCCloudAuth) {
      return Promise.resolve({ ok: false, code: 'no_client',
        error: cloud.state === 'degraded'
          ? 'تعذّر الاتصال بقاعدة الشركة — أصلح الاتصال ثم أعد المحاولة (لا شيء أُنشئ)'
          : 'عميل قاعدة الشركة غير جاهز — أعد تحميل الصفحة ثم أعد المحاولة' });
    }
    var auth = cloud.auth || (cloud.auth = root.HRCCloudAuth.create(cloud.client));
    return auth.createAccount(serviceKey, data).then(function (r) {
      if (r && r.ok && r.staff) absorbStaffRow(r.staff);
      return r;
    });
  }


  function updateCloudAccount(serviceKey, data) {
    if (!cloud.client || !root.HRCCloudAuth) {
      return Promise.resolve({ ok: false, code: 'no_client', error: 'عميل قاعدة الشركة غير جاهز — أعد تحميل الصفحة' });
    }
    var auth = cloud.auth || (cloud.auth = root.HRCCloudAuth.create(cloud.client));
    return auth.updateAccount(serviceKey, data).then(function (r) {
      if (r && r.ok && r.row) absorbStaffRow(r.row);
      return r;
    });
  }

  function deleteCloudAccount(serviceKey, data) {
    if (!cloud.client || !root.HRCCloudAuth) {
      return Promise.resolve({ ok: false, code: 'no_client', error: 'عميل قاعدة الشركة غير جاهز — أعد تحميل الصفحة' });
    }
    var auth = cloud.auth || (cloud.auth = root.HRCCloudAuth.create(cloud.client));
    return auth.deleteAccount(serviceKey, data);
  }

  function setCloudUserPassword(serviceKey, authId, newPassword) {
    if (!cloud.client || !root.HRCCloudAuth) {
      return Promise.resolve({ ok: false, code: 'no_client', error: 'عميل قاعدة الشركة غير جاهز — أعد تحميل الصفحة' });
    }
    var auth = cloud.auth || (cloud.auth = root.HRCCloudAuth.create(cloud.client));
    return auth.setPassword(serviceKey, authId, newPassword);
  }

  /* فحص مفتاح الخدمة قبل حفظه (انظر الشرح في cloud-auth.js) */
  function probeServiceKey(serviceKey) {
    if (!root.HRCCloudAuth || !cloud.client) {
      return Promise.resolve({ ok: false, code: 'no_client', error: 'عميل قاعدة الشركة غير جاهز — أعد تحميل الصفحة' });
    }
    var auth = cloud.auth || (cloud.auth = root.HRCCloudAuth.create(cloud.client));
    if (!auth.probeServiceKey) return Promise.resolve({ ok: true, unchecked: true });
    return auth.probeServiceKey(serviceKey);
  }


  function staffAdmin(action, payload) {
    if (!cloud.client || !root.HRCCloudAuth) {
      return Promise.resolve({ ok: false, code: 'no_client', error: 'عميل قاعدة الشركة غير جاهز — أعد تحميل الصفحة' });
    }
    var auth = cloud.auth || (cloud.auth = root.HRCCloudAuth.create(cloud.client));
    if (!auth.staffAdmin) return Promise.resolve({ ok: false, code: 'not_deployed', error: 'وحدة الدوال غير محمّلة' });
    return auth.staffAdmin(action, payload).then(function (r) {
      if (r && r.ok && r.staff) absorbStaffRow(r.staff);
      return r;
    });
  }

  /* تسجيل الموظف: نتحقق من الملف ونقرأ مساحة العمل بالتوازي بعد Auth؛
     لا تُعرض بيانات أو تُمنح جلسة قبل نجاح الأمرين. */
  function signInFast(username, password) {
    if (!cloudConfigured() || !canReadStaffTables() || !cloudWillBoot()) return signIn(username, password);
    if (cloud.state === 'connecting' && cloud.bootPromise) {
      return cloud.bootPromise.then(function () { return signInFast(username, password); });
    }
    if (!cloud.client || !root.HRCCloudAuth) return signIn(username, password);
    var auth = cloud.auth || (cloud.auth = root.HRCCloudAuth.create(cloud.client));
    var prefetch = null;
    return auth.login(username, password, function () {
      // Auth is valid; staff verification and RLS-protected reads overlap.
      // Do not adopt data or create an application session until both succeed.
      prefetch = Promise.resolve().then(function () {
        return root.HRCCloud.fetchAll(cloud.client, {workspace:true, deferReports:true, deferAudit:true});
      });
      prefetch.catch(function () {});
    }).then(function (r) {
      if (!r || !r.ok) {
        // Auth can succeed while the staff row is inactive/missing: clear it.
        if (prefetch && auth.logout) return auth.logout().catch(function () {}).then(function () { return r; });
        return r || { ok: false, code: 'auth_failed', error: 'فشل الدخول' };
      }
      cloud.state = 'connecting'; cloud.role = 'guest'; cloud.readOnly = true;
      notifyCloudStatus();
      var work = loadFromCloud(prefetch).then(function (st) {
        if (!st || st.state !== 'on' || st.role !== 'staff') {
          return auth.logout().catch(function () {}).then(function () {
            cloud.state = 'ready'; cloud.role = 'guest'; cloud.readOnly = true; notifyCloudStatus();
            return { ok: false, code: 'data_unavailable', error: 'تم التحقق من الحساب، لكن تعذّر تحميل بيانات الشركة. تحقق من الاتصال وأعد المحاولة.' };
          });
        }
        applyStaffSession(r.profile);
        cloud.knownProfile = r.profile;
        audit('تسجيل دخول', 'auth', r.profile.username,
          'دخول عبر Supabase Auth (' + (r.profile.role === 'admin' ? 'مدير عام' : 'موظف') + ')');
        save(); emit();
        return { ok: true, session: currentUser(), profile: r.profile };
      }).catch(function () {
        return auth.logout().catch(function () {}).then(function () {
          cloud.state = 'ready'; cloud.role = 'guest'; cloud.readOnly = true; notifyCloudStatus();
          return { ok: false, code: 'data_unavailable', error: 'تعذّر تحميل بيانات الشركة. تحقق من الاتصال وأعد المحاولة.' };
        });
      });
      cloud.bootPromise = work.then(function (result) {
        cloud.bootPromise = null; notifyCloudStatus(); return result;
      });
      return cloud.bootPromise;
    });
  }

  function signOutCloud() {
    if(root.HRCCloud&&root.HRCCloud.clearChanceRegistry)root.HRCCloud.clearChanceRegistry();
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

  // Server-owned operational recovery. No browser JSON upload or service key.
  function recoveryRPC(action, id, name, ticket) {
    if (!isAdmin() || !enforceAuth() || !cloud.client) return Promise.reject(new Error('يلزم دخول المدير الرسمي واتصال قاعدة الشركة'));
    return cloud.client.rpc('recovery_manage', { p_action: action, p_id: id || null, p_name: name || '', p_token: ticket || '' }).then(function (r) {
      if (r.error) throw new Error(r.error.message || 'تعذر تنفيذ النسخ أو الاسترجاع');
      if (!r.data || !r.data.ok) throw new Error('لم تكتمل العملية؛ لم يتم تأكيد نجاحها');
      if (r.data.requiresLogin) {
        if (cloud.timer) clearTimeout(cloud.timer);
        if(root.HRCCloud&&root.HRCCloud.clearChanceRegistry)root.HRCCloud.clearChanceRegistry();
        cloud.sync = null; memSession = null;
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
        return signOutCloud().then(function () { return r.data; });
      }
      return r.data;
    });
  }

  /* رفع صورة وظيفة إلى Storage بدل تضمينها base64 في الصف.
     لماذا: الصورة المضمّنة تُنسخ كاملة في audit_log.diff مع كل تعديل على
     الوظيفة، فتنمو القاعدة بلا سقف (صورة واحدة 542KB تكرّرت 38 مرة = 20MB).
     الرابط لا ينسخ شيئاً.

     ⛔ ترجع base64 كما هي لو فشل الرفع — لا نُفقد صورة الموظف أبداً.
     ⛔ الحارس: isStaffSession() (الموظف والمدير يعدّلان الوظائف). */
  function uploadJobImage(dataUrl, code) {
    if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) return Promise.resolve(dataUrl);
    if (!isStaffSession() || !enforceAuth() || !cloud.client || !cloud.client.storage) return Promise.resolve(dataUrl);
    var m = /^data:image\/([a-z+]+);base64,/.exec(dataUrl);
    if (!m) return Promise.resolve(dataUrl);
    var ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    var path = 'jobs/' + String(code || 'new').toLowerCase().replace(/[^a-z0-9-]/g, '') + '.' + ext;
    var bin;
    try {
      var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      var raw = root.atob(b64);
      bin = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    } catch (e) { return Promise.resolve(dataUrl); }

    return cloud.client.storage.from('job-images').upload(path, bin, {
      contentType: 'image/' + m[1],
      upsert: true
    }).then(function (res) {
      if (res && res.error) return dataUrl;                 /* فشل → base64 */
      var pub = cloud.client.storage.from('job-images').getPublicUrl(path);
      var url = pub && pub.data && pub.data.publicUrl;
      return url && /^https:\/\//.test(url) ? url : dataUrl;
    }).catch(function () { return dataUrl; });
  }

  /* تصدير نسخة محمولة: ترجع البيانات خاماً (JSONB) للمدير فقط.
     المتصفح هو من يشفّرها بكلمة مرور المالك — المفتاح لا يمرّ بالقاعدة.
     ⛔ حارس: isAdmin() هنا وفي recovery_export_full بالقاعدة معاً. */
  /* النسخة المحمولة: نطلب الإصدار 2 (يحذف diff من سجلات التدقيق الحاملة
     صوراً مضمّنة). الملف الشخصي: 4.8MB بدل 25MB — أي 20× أسرع ويمرّ على
     شبكة الهاتف. إن لم تكن الدالة موجودة (قاعدة لم تُهاجَر بعد) نرجع للإصدار 1.
     ⛔ حارس: isAdmin() هنا وفي الدالة بالقاعدة معاً. */
  function recoveryExportFull() {
    if (!isAdmin()) return Promise.reject(new Error('تصدير النسخة الكاملة صلاحية المدير العام فقط'));
    if (!enforceAuth() || !cloud.client) return Promise.reject(new Error('يلزم دخول المدير الرسمي واتصال قاعدة الشركة'));
    function call(fn, minFormat) {
      return cloud.client.rpc(fn, {}).then(function (r) {
        if (r.error) {
          /* الدالة غير موجودة → نجرب الإصدار الأقدم */
          if (/does not exist|schema cache/i.test(String(r.error.message))) return null;
          throw new Error(translateExportError(r.error.message));
        }
        if (!r.data || !r.data.format || r.data.format < minFormat) return null;
        return r.data;
      });
    }
    /* ⚠️ الترتيب مقصود: v4 (٤) ثم v3 (٣) ثم v2 (٢) ثم v1 (١).
       ⚠️ عطل أُصلح 2026-11-15: كان يطلب v2 مباشرة. وv2 لا تصدّر
       recovery_chances ولا recovery_prints ولا card_issue_requests ولا
       office_receipts — بينما assets/js/restore-sql.js يتوقّعها جميعاً في
       الملف. فالنتيجة أن النسخة الصحيحة تُبنى بـ'[]' للفرص: 46 فرصة
       مستهلكة على 30 بطاقة ترجع متاحة بعد الاسترجاع. v3 يُضيفها فوق v2.
       ⚠️ و2026-11-18: v3 بدورها تعدّ card_number_registry في `counts` ولا
       تصدّر صفوفه — فيرى المدير الرقم 175 ويظنّ السجل وصل. v4 يُضيف
       الصفوف و`card_number_floor` فوق v3.
       السقوط إلى نسخة أقدم يبقى بقصد: مشروع لم يُهاجَر بعد يجب أن يستطيع
       تنزيل شيء بدل لا شيء. لكن الحمولة الناقصة لم تعد تُبنى بصمت —
       assets/js/restore-sql.js يشتقّ أرضية العدّاد من السجل أو من
       issued_serials، ويرفع تحذيراً في الملف نفسه. */
    return call('recovery_export_v4', 4).then(function (d) {
      if (d) return d;
      return call('recovery_export_v3', 3).then(function (d3) {
        if (d3) return d3;
        return call('recovery_export_v2', 2).then(function (d2) {
          if (d2) return d2;
          return call('recovery_export_full', 1).then(function (legacy) {
            if (legacy) return legacy;
            throw new Error('لم يُعد الخادم نسخة صالحة — تأكد أن الهجرات مطبّقة على القاعدة');
          });
        });
      });
    });
  }

  /* رسائل فشل التصدير: نُترجم أخطاء PostgreSQL إلى عربية مفهومة للمدير.
     أهمّها: statement timeout — كان يظهر بالإنجليزية خاماً على الهاتف. */
  function translateExportError(msg) {
    var m = String(msg || '');
    if (/statement timeout|canceling statement/i.test(m)) {
      return 'انتهت مهلة تجهيز النسخة على الخادم (أكثر من دقيقتين). جرّب على شبكة واي‑فاي، أو تواصل مع الدعم لتحديث قاعدة البيانات.';
    }
    if (/out of memory|insufficient memory/i.test(m)) {
      return 'الذاكرة المتاحة على الخادم لا تكفي لهذا التصدير.';
    }
    if (/permission denied|صلاحية المدير/i.test(m)) {
      return 'تصدير النسخة الكاملة صلاحية المدير العام فقط.';
    }
    return m || 'تعذّر تصدير النسخة';
  }

  /* جدولة النسخ التلقائي: يضبطها المدير من الإعدادات وتُخزَّن في القاعدة
     (brc.settings → recovery_schedule) وتُعيد ضبط مهمة pg_cron فوراً. */
  function recoveryScheduleGet() {
    if (!isAdmin() || !enforceAuth() || !cloud.client) return Promise.reject(new Error('يلزم دخول المدير الرسمي واتصال قاعدة الشركة'));
    return cloud.client.rpc('recovery_schedule_get', {}).then(function (r) {
      if (r.error) throw new Error(r.error.message || 'تعذرت قراءة الجدولة');
      if (!r.data || !r.data.ok) throw new Error((r.data && r.data.error) || 'تعذرت قراءة الجدولة');
      return r.data;
    });
  }

  /* جدولة النسخ — نمطان (2026-11-14):
       { mode:'interval', hours:N }  كل N ساعة  (1..24)
       { mode:'days', days:[0..6], time:'HH:MM' }  أيام محدّدة
     التوقيع القديم recoveryScheduleSet(days, time) محفوظ للتوافق. */
  function recoveryScheduleSet(opt) {
    if (!isAdmin() || !enforceAuth() || !cloud.client) return Promise.reject(new Error('يلزم دخول المدير الرسمي واتصال قاعدة الشركة'));
    var o = (Array.isArray(opt) ? { mode: 'days', days: opt, time: arguments[1] } : (opt || {}));
    var MODES = ['interval', 'daily', 'every_days', 'days'];
    var mode = MODES.indexOf(o.mode) >= 0 ? o.mode : 'days';
    var list = (o.days || []).map(Number).filter(function (n) { return n >= 0 && n <= 6; });
    var hours = Number(o.hours) || 0;
    if (mode === 'interval' && (hours < 1 || hours > 24)) return Promise.reject(new Error('عدد الساعات يجب أن يكون بين ١ و٢٤'));
    if (mode === 'every_days' && (hours < 1 || hours > 365)) return Promise.reject(new Error('عدد الأيام يجب أن يكون بين ١ و٣٦٥'));
    if (mode === 'days' && !list.length) return Promise.reject(new Error('اختر يوماً واحداً على الأقل'));
    var time = String(o.time || '23:00');
    return cloud.client.rpc('recovery_schedule_set', {
      p_mode: mode, p_hours: mode === 'interval' ? hours : null,
      p_days: mode === 'days' ? list : [], p_time: time
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message || 'تعذر حفظ الجدولة');
      if (!r.data || !r.data.ok) throw new Error((r.data && r.data.error) || 'تعذر حفظ الجدولة');
      audit('ضبط جدولة النسخ الاحتياطي', 'recovery', 'recovery_schedule',
        mode === 'interval' ? 'كل ' + hours + ' ساعة من الساعة ' + time + ' (بتوقيت بغداد)'
        : mode === 'daily' ? 'كل يوم — الساعة ' + time + ' (بتوقيت بغداد)'
        : mode === 'every_days' ? 'كل ' + hours + ' يوم — الساعة ' + time + ' (بتوقيت بغداد)'
        : 'الأيام: ' + list.join(',') + ' — الساعة ' + time + ' (بتوقيت بغداد)');
      return r.data;
    });
  }

  /* إيقاف الجدولة — لا يُرسل أياماً ولا ساعات */
  function recoveryScheduleOff() {
    if (!isAdmin() || !enforceAuth() || !cloud.client) return Promise.reject(new Error('يلزم دخول المدير الرسمي واتصال قاعدة الشركة'));
    return cloud.client.rpc('recovery_schedule_set', { p_mode: 'days', p_hours: null, p_days: [], p_time: '23:00' }).then(function (r) {
      if (r.error) throw new Error(r.error.message || 'تعذر إيقاف الجدولة');
      if (!r.data || !r.data.ok) throw new Error((r.data && r.data.error) || 'تعذر إيقاف الجدولة');
      audit('إيقاف جدولة النسخ الاحتياطي', 'recovery', 'recovery_schedule', 'أُوقفت الجدولة');
      return r.data;
    });
  }

  function changeCloudPassword(newPassword) {
    if (!cloud.client || !root.HRCCloudAuth) return Promise.resolve({ ok: false, error: 'غير متاح في الوضع المحلي' });
    var auth = cloud.auth || root.HRCCloudAuth.create(cloud.client);
    return auth.changePassword(newPassword);
  }


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
      if (patch.attemptLimit != null) {
        var limit = Number(patch.attemptLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('عدد الفرص يجب أن يكون عدداً صحيحاً من 1 إلى 10');
        db.applicants.forEach(function (app) {
          if (!app.attemptLimit) app.attemptLimit = cardAttemptLimit(app);
        });
      }
      Object.keys(patch).forEach(function (k) { db.settings[k] = patch[k]; });
      audit('تعديل إعدادات', 'settings', '—', JSON.stringify(patch));
      save(); emit();
    },
    // جلسة
    login: login, logout: logout, currentUser: currentUser, isAdmin: isAdmin, isStaffSession: isStaffSession,
    listUsers: listUsers, addUser: addUser, updateUser: updateUser, deleteUser: deleteUser, toggleUserActive: toggleUserActive,
    // سحابة
    signIn: signIn, signInFast: signInFast, signOutCloud: signOutCloud, changeCloudPassword: changeCloudPassword,
    createCloudAccount: createCloudAccount, updateCloudAccount: updateCloudAccount,
    deleteCloudAccount: deleteCloudAccount, setCloudUserPassword: setCloudUserPassword,
    probeServiceKey: probeServiceKey,
    staffAdmin: staffAdmin, recoveryRPC: recoveryRPC, recoveryExportFull: recoveryExportFull, uploadJobImage: uploadJobImage,
    recoveryScheduleGet: recoveryScheduleGet, recoveryScheduleSet: recoveryScheduleSet, recoveryScheduleOff: recoveryScheduleOff,
    cloudStatus: cloudStatus, onCloudStatus: onCloudStatus, pushCloud: pushCloud,
    issueNumberedCards:issueNumberedCards, pendingCardIssue:pendingCardIssue, serialWasIssued:serialWasIssued, cardReport:cardReport, searchCardHistory:searchCardHistory, reloadCloud: reloadFromCloud, verifyCloud: verifyCloud,
    cloudQueueLength: pendingQueueLength,
    waitForCloud: function () { return cloud.bootPromise || Promise.resolve(cloudStatus()); },
    /* العمليات المعلّقة الآن (للتشخيص والعرض) — لا تُرسل شيئاً */
    diffCloud: function () { return (cloud.sync && cloud.state === 'on') ? cloud.sync.diff(db) : []; },
    // وظائف
    vacancySummary: vacancySummary, refreshVacancies: refreshVacancies,
    listJobs: listJobs, govKey: govKey, getJob: getJob, createJob: createJob, updateJob: updateJob,
    setJobStatus: setJobStatus, deleteJob: deleteJob, nextJobCode: function () { return 'HRC-' + (db.counters.jobCode + 1); },
    // باحثون
    listApplicants: listApplicants, getApplicant: getApplicant, createApplicant: createApplicant,
    createCardBatch: createCardBatch, createCardWithSerial: createCardWithSerial, suggestSerial: suggestSerial,
    isCardSerial: isCardSerial, normalizeCardSerial: normalizeCardSerial,
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
    cardLookup: cardLookup, customerApplication: customerApplication, cardActivate: cardActivate, cardUseChance: cardUseChance,
    cardVerify: cardVerify, cardVerifyCode: cardVerifyCode, listPosNames: listPosNames,
    // مالية
    stats: stats, financials: financials, financialTotals: financialTotals,
    markPrinted: markPrinted, setFeePaid: setFeePaid,
    // تدقيق
    audit: audit, listAudit: listAudit, setAuditDisplayLabels: setAuditDisplayLabels,
    loadAuditLog: loadAuditLog, syncOfflineChanges: syncOfflineChanges,
    getScheduledBackups: getScheduledBackups, listBackupMeta: listBackupMeta,
    saveScheduledBackup: saveScheduledBackup, deleteScheduledBackup: deleteScheduledBackup,
    restoreScheduledBackup: restoreScheduledBackup, exportScheduledBackup: exportScheduledBackup,
    lastBackupErrorMessage: lastBackupErrorMessage,
    // الجدولة التلقائية
    getAutoSchedule: getAutoSchedule, saveAutoSchedule: saveAutoSchedule,
    clearAutoSchedule: clearAutoSchedule, lastAutoRun: lastAutoRun, checkAutoBackup: checkAutoBackup,
    // أدوات
    timeZone: 'Asia/Baghdad', dayOffset: dayOffset, fmtDate: fmtDate, fmtDateTime: fmtDateTime, money: money, diffDays: diffDays, diffHours: diffHours,
    addDays: addDays, addHours: addHours, resetDemo: resetDemo, exportJson: exportJson, importJson: importJson, previewBackup: previewBackup,
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
