/* ===========================================================================
 *  BRC — طبقة الربط بـ Supabase (BRCCloud)
 *  ---------------------------------------------------------------------------
 *  الفكرة المعمارية:
 *    الواجهة تنادي BRCStore بشكل **متزامن** (222 نقطة استدعاء)، وسوبابيس
 *    **غير متزامنة**. الحل: نحتفظ بنسخة كاملة من البيانات في الذاكرة بنفس شكل
 *    BRCStore المحلي (كائن db)، ونملؤها من سوبابيس عند الإقلاع، ثم:
 *      • القراءة  → من الذاكرة فوراً (بلا تغيير في أي نقطة استدعاء)
 *      • الكتابة  → تحديث الذاكرة فوراً + دفع لسوبابيس في الخلفية + emit()
 *      • التغيير  → Realtime يحدّث الذاكرة ويستدعي emit() لباقي المستخدمين
 *    بهذا لا تحتاج 222 نقطة استدعاء أي تعديل.
 *
 *  هذا الملف مسؤول عن **التحويل والتحميل** فقط:
 *    • تحويل الأعمدة: snake_case (SQL) ↔ camelCase (JS)
 *    • تجميع الكائنات المركّبة: employer{} · سجل التدقيق · الإعدادات
 *    • وصل المحاولات بالوظائف والموظفين (البيانات المُسطّحة غير موجودة في SQL)
 *
 *  بلا أي حزم خارجية — يستقبل عميل سوبابيس كوسيط، فيمكن اختباره بعميل وهمي
 *  دون شبكة (انظر tests/cloud.mjs).
 * =========================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------- أدوات مساعدة ---------------------------- */
  var ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

  /* التواريخ: سوبابيس تُرجع ISO للـ timestamptz و'YYYY-MM-DD' للـ date.
     نُوحّد إلى ISO لأن الواجهة تفترضه (new Date(str)). */
  function toISO(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v.toISOString();
    var s = String(v);
    if (ISO_RE.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;   // تاريخ ميلاد: يبقى كما هو
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /* UUID من الخادم يبقى كما هو؛ أما السجلات بلا معرّف فنولّد له معرّفاً ثابتاً
     مشتقاً من مفاتيحه الطبيعية حتى تبقى المراجع متسقة داخل الواجهة. */
  function synthId(prefix, key) {
    return prefix + ':' + String(key).replace(/[^A-Za-z0-9_-]/g, '_');
  }

  function n(v, dflt) { return (v == null || v === '') ? (dflt == null ? 0 : dflt) : Number(v); }
  function b(v) { return v === true; }
  function s(v) { return v == null ? '' : String(v); }

  /* ------------------------- تحويل الوظائف (jobs) ------------------------- */
  function jobFromDb(r) {
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      category: r.category || 'خدمات',
      region: r.region,
      salaryMin: n(r.salary_min),
      salaryMax: n(r.salary_max),
      shift: r.shift || 'صباحي',
      gender: r.gender || 'لا فرق',
      description: r.description || '',
      requirements: Array.isArray(r.requirements) ? r.requirements : [],
      /* SQL تُخزّن بيانات صاحب العمل في ثلاثة أعمدة، والواجهة تتوقّع كائناً مركّباً */
      employer: {
        name: r.employer_name || '',
        phone: r.employer_phone || '',
        address: r.employer_address || ''
      },
      interviewLocation: r.interview_location || '',
      status: r.status || 'available',
      reservedBy: r.reserved_by || null,
      holdExpiresAt: toISO(r.hold_expires_at),
      createdAt: toISO(r.created_at),
      createdBy: r.created_by || null,
      closedAt: toISO(r.closed_at),
      notes: r.notes || '',
      vacancies: n(r.vacancies, 1),
      imageUrl: r.image_url || ''
    };
  }

  function jobToDb(o) {
    return {
      code: o.code, title: o.title, category: o.category || 'خدمات', region: o.region,
      salary_min: n(o.salaryMin), salary_max: n(o.salaryMax),
      shift: o.shift || 'صباحي', gender: o.gender || 'لا فرق',
      vacancies: n(o.vacancies, 1),
      requirements: o.requirements || [],
      description: o.description || '',
      employer_name: (o.employer && o.employer.name) || '',
      employer_phone: (o.employer && o.employer.phone) || '',
      employer_address: (o.employer && o.employer.address) || '',
      interview_location: o.interviewLocation || '',
      status: o.status || 'available',
      reserved_by: o.reservedBy || null,
      hold_expires_at: o.holdExpiresAt || null,
      closed_at: o.closedAt || null,
      notes: o.notes || '',
      image_url: o.imageUrl || ''
    };
  }

  /* ------------------------ تحويل الاستمارات (applicants) ------------------------ */
  function applicantFromDb(r) {
    return {
      id: r.id,
      serial: r.serial,
      fullName: r.full_name,
      phone: r.phone,
      address: r.address || '',
      dob: r.dob || null,
      gender: r.gender || 'ذكر',
      nationality: r.nationality || 'عراقي',
      issueDate: toISO(r.issue_date),
      expiryDate: toISO(r.expiry_date),
      status: r.status || 'active',
      rejectReason: r.reject_reason || '',
      createdBy: r.created_by || null,
      createdAt: toISO(r.created_at),
      notes: r.notes || '',
      fee: n(r.fee_amount, 10000),
      feePaid: b(r.fee_paid),
      printedCount: n(r.printed_count),
      attemptLimit: n(r.attempt_limit, 5),
      requestedCode: r.requested_code || null
    };
  }

  /* ⚠️ serial مُضمَّن عمداً:
     • لترحيل البيانات الموجودة: بغيره تفقد الاستمارات أرقامها (وهي مفتاح الربط
       في كل الجداول الأخرى عبر FK).
     • للإدراج الجديد: الواجهة تولّد الرقم محلياً من العدّاد وترسله صراحةً،
       فيتطابق ما يظهر للموظف مع ما يُحفظ في القاعدة فوراً. لولا إرساله لولّد
       الخادم رقماً آخر وظهر اختلاف مؤقت حتى إعادة الجلب.
     • عند التعارض (رقم موجود) يفشل الإدراج بـ unique violation — وتعامل معه
       طبقة الكتابة بإعادة المحاولة بلا serial ليولّده الخادم. */
  /* ⚠️ الحقول الناقصة هنا كانت تُنتج «كتابة بلا أثر»: تغيير الحالة إلى مقبول أو
     مرفوض كان يُنتج عملية تعديل (لأن status داخل التطبيع) لكن الصف المُرسل لا
     يحمل status — فيبقى الطلب «قيد المراجعة» في القاعدة ولو ظهر مقبولاً في
     الواجهة. القاعدة: كل حقل يسبّب عملية يجب أن يكون داخل الصف المُرسل. */
  function applicantToDb(o) {
    var row = {
      serial: o.serial || undefined,
      full_name: o.fullName, phone: o.phone, address: o.address || '',
      dob: o.dob || null, gender: o.gender || 'ذكر', nationality: o.nationality || 'عراقي',
      status: o.status || 'active',
      fee_amount: n(o.fee, 10000), fee_paid: !!o.feePaid,
      printed_count: n(o.printedCount), notes: o.notes || '',
      reject_reason: o.rejectReason || '',
      requested_code: o.requestedCode || null
    };
    /* الحقول الزمنية تُرسل إن وُجدت فقط:
       • طلب إلكتروني (قيد المراجعة) بلا تاريخ إصدار محلياً — وإرسال null يخالف
         قيد NOT NULL فيخفق الإدراج كله.
       • وعند القبول تُرسل التواريخ الجديدة فعلاً، وإلا بقي تاريخ الإصدار تاريخ
         الطلب وانتهت الصلاحية 30 يوماً من لحظة الطلب لا من لحظة الإصدار. */
    if (o.issueDate) row.issue_date = o.issueDate;
    if (o.expiryDate) row.expiry_date = o.expiryDate;
    if (o.attemptLimit != null) row.attempt_limit = n(o.attemptLimit, 5);
    return row;
  }

  /* ------------------------- تحويل المحاولات (attempts) -------------------------
   *  ملاحظة مهمة: SQL تُخزّن job_id و job_code و slot_status فقط. أما العنوان
   *  واسم صاحب العمل والعنوان فهي **بيانات مُسطّحة مشتقّة** — نحن نصلها من
   *  جدول الوظائف حتى تعمل الواجهة بلا تغيير (كانت تبنيها من CFG.seed محلياً).
   * ----------------------------------------------------------------------------- */
  function attemptFromDb(r, jobsById, jobsByCode, staffById) {
    var job = (r.job_id && jobsById[r.job_id]) ||
      (r.job_code && jobsByCode[r.job_code]) || null;
    return {
      id: r.id,
      serial: r.serial,
      no: n(r.attempt_no),
      jobId: r.job_id || null,
      jobCode: r.job_code || (job ? job.code : null),
      jobTitle: job ? job.title : null,
      location: job ? job.region : null,
      employerName: job ? job.employer.name : null,
      employerPhone: job ? job.employer.phone : null,
      slotStatus: r.slot_status || 'empty',
      selectedAt: toISO(r.selected_at),
      holdExpiresAt: toISO(r.hold_expires_at),
      closedAt: toISO(r.closed_at),
      note: r.outcome_note || '',
      staff: r.staff_id ? (staffById[r.staff_id] || null) : null
    };
  }

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function attemptToDb(o) {
    return {
      serial: o.serial, attempt_no: n(o.no),
      /* ⚠️ job_id يُرسل فقط إن كان UUID صالحاً: المعرّفات المحلية المولَّدة
         (uid('job') = 'job-xxxx') ليست UUID، وإرسالها يُفشل الإدراج بـ
         «invalid input syntax for type uuid». عند غيابها يبقى job_code
         وهو كافٍ لربط المحاولة بالوظيفة. */
      job_id: UUID_RE.test(String(o.jobId || '')) ? o.jobId : null,
      job_code: o.jobCode || null,
      slot_status: o.slotStatus || 'empty',
      selected_at: o.selectedAt || null, hold_expires_at: o.holdExpiresAt || null,
      closed_at: o.closedAt || null, outcome_note: o.note || ''
    };
  }

  /* ---------------------------- التدقيق (audit_log) ---------------------------- */
  function auditFromDb(r) {
    return {
      id: r.id,
      ts: toISO(r.ts),
      user: r.username || 'system',
      role: r.role || 'system',
      ip: r.ip || '',
      action: r.action,
      entity: r.entity || '',
      entityId: r.entity_id || '—',
      details: r.details || ''
    };
  }

  function auditToDb(o) {
    return {
      username: o.user || 'system', role: o.role || 'system', ip: o.ip || '',
      action: o.action, entity: o.entity || '', entity_id: o.entityId || '',
      details: o.details || ''
    };
  }

  /* ----------------------------- الموظفون (staff) ----------------------------- */
  function staffFromDb(r) {
    return {
      id: r.id, authId: r.auth_id || null, username: r.username,
      name: r.full_name, role: r.role || 'staff',
      title: r.job_title || '', phone: r.phone || '', active: r.active !== false
    };
  }

  /* ------------------------- الإعدادات (settings: key/value jsonb) -------------------------
   *  SQL تُخزّن صفوفاً: ('rules', {...}) و ('company', {...}).
   *  الواجهة تتوقّع كائناً مسطّحاً بقيم camelCase.
   * ----------------------------------------------------------------------------- */
  function settingsFromDb(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (r.key === 'rules' && r.value) {
        var v = r.value;
        if (v.attempt_limit != null) out.attemptLimit = n(v.attempt_limit, 5);
        if (v.validity_days != null) out.validityDays = n(v.validity_days, 30);
        if (v.hold_hours != null) out.holdHours = n(v.hold_hours, 24);
        if (v.form_fee != null) out.formFee = n(v.form_fee, 10000);
        if (v.auto_release != null) out.autoReleaseEnabled = v.auto_release !== false;
      }
      if (r.key === 'company' && r.value) out.company = r.value;
    });
    return out;
  }

  function settingsToDb(patch) {
    var rules = {};
    if (patch.attemptLimit != null) rules.attempt_limit = n(patch.attemptLimit, 5);
    if (patch.validityDays != null) rules.validity_days = n(patch.validityDays, 30);
    if (patch.holdHours != null) rules.hold_hours = n(patch.holdHours, 24);
    if (patch.formFee != null) rules.form_fee = n(patch.formFee, 10000);
    if (patch.autoReleaseEnabled != null) rules.auto_release = !!patch.autoReleaseEnabled;
    return rules;
  }

  /* ============================================================================
   *  بناء كائن db الكامل من جداول سوبابيس
   *  الترتيب مهم: الوظائف والموظفون أولاً لأن المحاولات تُشتقّ منها.
   * ========================================================================== */
  function buildDb(data) {
    var jobs = (data.jobs || []).map(jobFromDb);
    var applicants = (data.applicants || []).map(applicantFromDb);
    var staff = (data.staff || []).map(staffFromDb);

    var jobsById = {}, jobsByCode = {};
    jobs.forEach(function (j) { jobsById[j.id] = j; jobsByCode[j.code] = j; });
    var staffById = {};
    staff.forEach(function (st) { staffById[st.id] = st.username; });

    var attempts = (data.job_attempts || []).map(function (r) {
      return attemptFromDb(r, jobsById, jobsByCode, staffById);
    });
    var audit = (data.audit_log || []).map(auditFromDb);
    var settings = settingsFromDb(data.settings);

    /* آخر أرقام التسلسل: نستنتجها من البيانات الفعلية حتى لا تتصادم الأكواد
       الجديدة مع القديمة. (المصدر الحقيقي تسلسلات PostgreSQL، وهذي للعرض فقط.) */
    var maxJob = 1041, maxSerial = 119;
    jobs.forEach(function (j) {
      var m = /^BRC-(\d+)$/.exec(j.code || '');
      if (m) maxJob = Math.max(maxJob, Number(m[1]));
    });
    applicants.forEach(function (a) {
      var m = /^BRC-NO-(\d+)$/.exec(a.serial || '');
      if (m) maxSerial = Math.max(maxSerial, Number(m[1]));
    });

    return {
      meta: { version: 2, source: 'supabase', loadedAt: new Date().toISOString() },
      counters: { jobCode: maxJob, formSerial: maxSerial },
      settings: settings,
      jobs: jobs,
      applicants: applicants,
      attempts: attempts,
      audit: audit,
      staff: staff
    };
  }

  /* ============================================================================
   *  قراءة كل البيانات — على دفعات متوازية
   *  client: عميل supabase-js (نستقبله كوسيط لتسهيل الاختبار بمحاكٍ)
   * ========================================================================== */
  var TABLES = ['jobs', 'applicants', 'job_attempts', 'audit_log', 'settings', 'staff'];

  function fetchAll(client, opts) {
    opts = opts || {};
    var limit = opts.auditLimit || 2000;

    var queries = TABLES.map(function (t) {
      var q = client.from(t).select('*');
      if (t === 'audit_log') q = q.order('ts', { ascending: false }).limit(limit);
      return q;
    });

    return Promise.all(queries).then(function (results) {
      var failed = [];
      var data = {};
      results.forEach(function (res, i) {
        var t = TABLES[i];
        if (res && res.error) { failed.push({ table: t, error: res.error }); data[t] = []; }
        else data[t] = (res && res.data) || [];
      });
      var db = buildDb(data);
      db.meta.failedTables = failed.map(function (f) { return f.table; });
      db.meta.errors = failed;
      return db;
    });
  }

  /* ============================================================================
   *  القراءة العامة (بلا تسجيل دخول) — للزائر
   *  ---------------------------------------------------------------------------
   *  anon لا يملك صلاحية على brc.jobs إطلاقاً (RLS)، بل على العرض brc.public_jobs
   *  فقط. فلو قرأ الزائر brc.jobs لرجع الجدول فارغاً/مرفوضاً وظهر الموقع بلا وظائف.
   *  لذلك للزائر مسار قراءة منفصل — وهذا هو الفرق بين «يعمل عند الموظف» و«يعمل
   *  عند الزائر»، وهو فرق يُكتشف متأخراً عادةً (الموظف مُسجَّل دخوله فلا يرى الخلل).
   * ========================================================================== */
  function fetchPublicJobs(client) {
    return client.from('public_jobs').select('*').then(function (res) {
      if (res && res.error) {
        return { ok: false, error: res.error, jobs: [] };
      }
      return { ok: true, jobs: (res && res.data || []).map(jobFromDb) };
    });
  }

  /* ------------------------- الطلب الإلكتروني (زائر) -------------------------
   *  إدراج مباشر في brc.applicants ممنوع على anon (revoke all) — فالطلب يمرّ
   *  عبر brc.request_form التي تتحقق من المدخلات وتضع الحالة 'pending' دائماً.
   * ----------------------------------------------------------------------- */
  function requestForm(client, data) {
    return client.rpc('request_form', {
      p_full_name: String(data.fullName || '').trim(),
      p_phone: String(data.phone || '').trim(),
      p_address: String(data.address || '').trim(),
      /* التاريخ الفارغ '' ليس تاريخاً صالحاً في PostgreSQL — نرسل null */
      p_dob: data.dob ? data.dob : null,
      p_gender: data.gender || 'ذكر',
      p_notes: data.notes || '',
      p_requested_code: data.requestedCode || null
    }).then(function (res) {
      if (res && res.error) {
        return { ok: false, code: res.error.code || 'rpc_error', error: res.error.message || 'تعذّر إرسال الطلب' };
      }
      var d = res && res.data;
      if (!d || typeof d !== 'object') return { ok: false, code: 'empty', error: 'لا رد من الخادم' };
      if (d.ok === false) return { ok: false, code: 'rejected', error: d.error || 'تعذّر إرسال الطلب' };
      return { ok: true, serial: d.serial, status: d.status || 'pending' };
    }).catch(function (e) {
      return { ok: false, code: 'network', error: 'تعذّر الاتصال: ' + (e && e.message || e) };
    });
  }

  /* ------------------------- التحقق العام من استمارة -------------------------
   *  نفس المنطق: جدول brc.applicants ليس مقروءاً للزائر، فالتحقق يمرّ حصراً عبر
   *  الدالة brc.verify_form(serial, token) التي تتحقق من البصمة وتُرجع استمارة
   *  واحدة. الفرق الجوهري: لو قرأنا الجدول لسحب الزائر بيانات كل الباحثين.
   * ------------------------------------------------------------------------- */
  function verifyForm(client, serial, token) {
    if (!serial) return Promise.resolve({ ok: false, code: 'bad_input', error: 'أدخل رقم الاستمارة' });
    return client.rpc('verify_form', { p_serial: String(serial).trim(), p_token: token || null })
      .then(function (res) {
        if (res && res.error) {
          return { ok: false, code: res.error.code || 'rpc_error', error: res.error.message || 'تعذّر التحقق' };
        }
        var data = res && res.data;
        if (!data || typeof data !== 'object') {
          return { ok: false, code: 'empty', error: 'لا نتيجة من الخادم' };
        }
        if (data.ok === false) return { ok: false, code: 'not_found', error: data.error || 'لا توجد استمارة' };
        /* نُطبّع الأسماء إلى camelCase كما تتوقّع الواجهة (بما فيها المحاولات) */
        return {
          ok: true,
          form: {
            serial: data.serial, fullName: data.fullName, phone: data.phone,
            issueDate: data.issueDate, expiryDate: data.expiryDate, status: data.status,
            daysLeft: data.daysLeft, attemptLimit: data.attemptLimit,
            attemptsUsed: data.attemptsUsed, attemptsLeft: data.attemptsLeft,
            tokenOk: data.tokenOk !== false,
            masked: data.masked === true,
            requestedCode: data.requestedCode || null,
            rejectReason: data.rejectReason || '',
            createdAt: data.createdAt || data.issueDate,
            attempts: (data.attempts || []).map(function (a) {
              return {
                no: a.no, jobCode: a.jobCode, jobTitle: a.jobTitle, location: a.location,
                slotStatus: a.slotStatus, selectedAt: a.selectedAt,
                holdExpiresAt: a.holdExpiresAt, closedAt: a.closedAt, note: a.note
              };
            })
          }
        };
      })
      .catch(function (e) {
        return { ok: false, code: 'network', error: 'تعذّر الاتصال: ' + (e && e.message || e) };
      });
  }

  /* ============================================================================
   *  تطبيق تغيير Realtime على كائن db — ترتيب حسب النوع:
   *    upsert: استبدال أو إضافة   ·   delete: حذف
   *  التغيير المُستلزم: تغيير في جدول الوظائف يحدّث البيانات المُسطّحة للمحاولات
   *  المرتبطة (jobTitle/location/employerName) حتى لا تبقى قديمة في الواجهة.
   * ========================================================================== */
  function applyChange(db, table, payload) {
    var type = payload.eventType || payload.type;
    var row = payload.new || payload.record || null;
    var old = payload.old || payload.old_record || null;

    function replaceIn(list, obj, keyOf) {
      var i = -1;
      for (var k = 0; k < list.length; k++) {
        if (keyOf(list[k]) === keyOf(obj)) { i = k; break; }
      }
      if (i >= 0) list[i] = obj; else list.unshift(obj);
    }

    function removeFrom(list, key, keyOf) {
      for (var k = list.length - 1; k >= 0; k--) {
        if (keyOf(list[k]) === key) list.splice(k, 1);
      }
    }

    if (table === 'jobs') {
      if (type === 'DELETE') { removeFrom(db.jobs, old.id, function (x) { return x.id; }); }
      else {
        var job = jobFromDb(row);
        replaceIn(db.jobs, job, function (x) { return x.id; });
        /* تحديث البيانات المُسطّحة في المحاولات المرتبطة بهذه الوظيفة */
        db.attempts.forEach(function (a) {
          if (a.jobId === job.id || (a.jobCode && a.jobCode === job.code)) {
            a.jobTitle = job.title; a.location = job.region;
            a.employerName = job.employer.name; a.employerPhone = job.employer.phone;
            if (!a.jobId) a.jobId = job.id;
          }
        });
      }
      return db;
    }

    if (table === 'applicants') {
      if (type === 'DELETE') removeFrom(db.applicants, old.serial, function (x) { return x.serial; });
      else replaceIn(db.applicants, applicantFromDb(row), function (x) { return x.serial; });
      return db;
    }

    if (table === 'job_attempts') {
      if (type === 'DELETE') {
        removeFrom(db.attempts, old.id, function (x) { return x.id; });
      } else {
        var jobsById = {}, jobsByCode = {}, staffById = {};
        db.jobs.forEach(function (j) { jobsById[j.id] = j; jobsByCode[j.code] = j; });
        (db.staff || []).forEach(function (st) { staffById[st.id] = st.username; });
        replaceIn(db.attempts, attemptFromDb(row, jobsById, jobsByCode, staffById),
          function (x) { return x.id; });
      }
      return db;
    }

    if (table === 'audit_log') {
      if (type === 'DELETE') removeFrom(db.audit, old.id, function (x) { return x.id; });
      else {
        var entry = auditFromDb(row);
        db.audit.unshift(entry);
        if (db.audit.length > 2000) db.audit.length = 2000;
      }
      return db;
    }

    if (table === 'staff') {
      if (!db.staff) db.staff = [];
      if (type === 'DELETE') removeFrom(db.staff, old.id, function (x) { return x.id; });
      else replaceIn(db.staff, staffFromDb(row), function (x) { return x.id; });
      return db;
    }

    if (table === 'settings') {
      var patched = settingsFromDb([row]);
      Object.keys(patched).forEach(function (k) { db.settings[k] = patched[k]; });
      return db;
    }

    return db;
  }

  /* ============================================================================
   *  اشتراك Realtime على كل الجداول
   *  يُرجع دالة إلغاء الاشتراك.
   * ========================================================================== */
  function subscribeAll(client, db, onChange, onError) {
    var chan = client.channel('brc-realtime');
    TABLES.forEach(function (t) {
      chan = chan.on('postgres_changes',
        { event: '*', schema: client.__schema || 'brc', table: t },
        function (payload) {
          try { applyChange(db, t, payload); onChange(t, payload); }
          catch (e) { if (onError) onError(e, t, payload); }
        });
    });
    chan.subscribe(function (status, err) { if (onError) onError(err || status, 'channel', null); });
    return function () { try { client.removeChannel(chan); } catch (e) { /* تجاهل */ } };
  }

  root.BRCCloud = {
    /* تحويل */
    jobFromDb: jobFromDb, jobToDb: jobToDb,
    applicantFromDb: applicantFromDb, applicantToDb: applicantToDb,
    attemptFromDb: attemptFromDb, attemptToDb: attemptToDb,
    auditFromDb: auditFromDb, auditToDb: auditToDb,
    staffFromDb: staffFromDb,
    settingsFromDb: settingsFromDb, settingsToDb: settingsToDb,
    /* بيانات */
    buildDb: buildDb, fetchAll: fetchAll, TABLES: TABLES,
    fetchPublicJobs: fetchPublicJobs, verifyForm: verifyForm,
    requestForm: requestForm,
    applyChange: applyChange, subscribeAll: subscribeAll,
    synthId: synthId
  };
})(typeof window !== 'undefined' ? window : globalThis);
