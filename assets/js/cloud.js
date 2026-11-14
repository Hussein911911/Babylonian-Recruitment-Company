/* HRCCloud: SQL/UI mapping, bounded paged reads and RPC adapters. */
(function (root) {
  'use strict';

  var chanceBitmap=null;
  function chanceIndex(code){var m=/^([1-9][0-9]{3})-([A-HJKMNP-Z])([A-HJKMNP-Z])$/.exec(code||'');if(!m)return -1;var letters='ABCDEFGHJKMNPQRSTUVWXYZ';return (Number(m[1])-1000)*529+letters.indexOf(m[2])*23+letters.indexOf(m[3]);}
  function chanceUsed(code){var i=chanceIndex(code);return !!(chanceBitmap&&i>=0&&(chanceBitmap[i>>3]&(1<<(i%8))));}
  function rememberChance(code){var i=chanceIndex(code);if(chanceBitmap&&i>=0)chanceBitmap[i>>3]|=1<<(i%8);}
  function clearChanceRegistry(){chanceBitmap=null;}
  function setChanceRegistry(data){if(!data||data.version!==1||typeof data.bitmap!=='string')throw Error('سجل رموز الفرص غير متاح');var raw=(root.atob||atob)(data.bitmap);if(raw.length!==595125)throw Error('سجل رموز غير مكتمل');chanceBitmap=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)chanceBitmap[i]=raw.charCodeAt(i);}

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
      governorate: r.governorate || 'بابل',
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
      updatedAt: toISO(r.updated_at),
      createdBy: r.created_by || null,
      closedAt: toISO(r.closed_at),
      notes: r.notes || '',
      vacancies: n(r.vacancies, 1),
      manualClosed: r.manual_closed, filledVacancyNumbers:r.filled_vacancy_numbers, availableVacancies:r.available_vacancies,
      imageUrl: r.image_url || ''
    };
  }

  function jobToDb(o) {
    var row = {
      code: o.code, title: o.title, category: o.category || 'خدمات', region: o.region, governorate: o.governorate || 'بابل',
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
    if(typeof o.manualClosed==='boolean')row.manual_closed=o.manualClosed;
    return row;
  }

  /* ------------------------ تحويل الاستمارات (applicants) ------------------------ */
  function applicantFromDb(r) {
    return {
      id: r.id,
      serial: r.serial, archivedAt: r.archived_at || null,
      /* رقم الإصدار يُقرأ من الخادم فقط؛ لا يُرسل في تحديثات المزامنة. */
      cardNumber: Number.isSafeInteger(Number(r.card_number)) && Number(r.card_number) > 0 ? Number(r.card_number) : null,
      cardNumberKnown: Object.prototype.hasOwnProperty.call(r, 'card_number'),
      cardPrintCode: r.card_print_code || null,
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
    if (o.cardPrintCode) row.card_print_code = o.cardPrintCode;
    if (o.attemptLimit != null) row.attempt_limit = n(o.attemptLimit, 5);
    return row;
  }

  /* ------------------------- تحويل المحاولات (attempts) -------------------------
   *  ملاحظة مهمة: SQL تُخزّن job_id و job_code و slot_status فقط. أما العنوان
   *  واسم صاحب العمل والعنوان فهي **بيانات مُسطّحة مشتقّة** — نحن نصلها من
   *  جدول الوظائف حتى تعمل الواجهة بلا تغيير (كانت تبنيها من CFG.seed محلياً).
   * ----------------------------------------------------------------------------- */
  function attemptFromDb(r, jobsById, jobsByCode, staffById) {
    var job = (r.job_id && jobsById[r.job_id]) || null;
    var snap = r.job_snapshot && r.job_snapshot.code === r.job_code ? r.job_snapshot : null;
    return {
      id: r.id,
      serial: r.serial,
      no: n(r.attempt_no),
      jobId: r.job_id || null,
      jobCode: r.job_code || (job ? job.code : null),
      jobTitle: job ? job.title : snap && snap.title,
      location: job ? (job.governorate || '') : snap && snap.governorate,
      employerName: job ? job.employer.name : snap && snap.employer_name,
      employerPhone: job ? job.employer.phone : snap && snap.employer_phone,
      jobSnapshot: snap,
      vacancyNo: r.vacancy_no || null,
      slotStatus: r.slot_status || 'empty',
      code: r.chance_code || null,          /* تاريخي: رموز الفرص أُلغيت ولا تُطبع */
      selectedAt: toISO(r.selected_at),
      holdExpiresAt: toISO(r.hold_expires_at),
      closedAt: toISO(r.closed_at),
      note: r.outcome_note || '',
      staff: r.staff_id ? (staffById[r.staff_id] || null) : null,
      /* ج4 2026-10-01: طلب صاحب العمل (توظيف/عدم توظيف) بانتظار قرار الشركة */
      employerDecision: r.employer_decision || null,
      decisionAt: toISO(r.decision_at),
      /* ج5 2026-10-06: سبب قلة التوظيف المكتوب من صاحب العمل (إلزامي) */
      reason: r.employer_reason || ''
    };
  }

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function attemptToDb(o) {
    var row = {
      serial: o.serial, attempt_no: n(o.no),
      /* ⚠️ job_id يُرسل فقط إن كان UUID صالحاً: المعرّفات المحلية المولَّدة
         (uid('job') = 'job-xxxx') ليست UUID، وإرسالها يُفشل الإدراج بـ
         «invalid input syntax for type uuid». عند غيابها يبقى job_code
         وهو كافٍ لربط المحاولة بالوظيفة. */
      job_id: UUID_RE.test(String(o.jobId || '')) ? o.jobId : null,
      job_code: o.jobCode || null,
      slot_status: o.slotStatus || 'empty',
      chance_code: o.code || null,          /* تاريخي: أُلغيت رموز الفرص ولا تُطبع */
      selected_at: o.selectedAt || null, hold_expires_at: o.holdExpiresAt || null,
      closed_at: o.closedAt || null, outcome_note: o.note || '',
      employer_decision: o.employerDecision || null, decision_at: o.decisionAt || null,
      employer_reason: o.reason || null
    };
    if(o.vacancyNo!=null)row.vacancy_no=o.vacancyNo;
    return row;
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

  // Flatten SQL settings JSON into UI configuration.
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

    // Infer display-only counters from server-assigned identifiers.
    var maxJob = 1041, maxSerial = 119;
    jobs.forEach(function (j) {
      var m = /^HRC-(\d+)$/.exec(j.code || '');
      if (m) maxJob = Math.max(maxJob, Number(m[1]));
    });
    applicants.forEach(function (a) {
      var m = /^HRC-NO-(\d+)$/.exec(a.serial || '');
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

  // Stable, bounded pages: never silently adopt a truncated table. Exact counts
  // also handle API row caps SMALLER than our requested 500 rows.
  /* ═════════════════════════════════════════════════════════════════════════
   *  قراءة جدول كامل بأقل عدد رحلات ممكنة إلى القاعدة
   *  -------------------------------------------------------------------------
   *  ما كان يحدث قبل 2026-10-24 (وسبب «تأخّر الاتصال» الذي شكا منه صاحب الشركة):
   *    • كل صفحة ٥٠٠ صف، وكل صفحة **طلب منفصل بالتسلسل** (job_attempts بصفحتين
   *      أو ثلاث، وaudit_log بأربع) فمجموع الانتظار = عدد الصفحات × زمن الرحلة.
   *    • **كل** صفحة تطلب `count=exact` أي COUNT كامل للجدول بعد ترتيبه — وهذا
   *      مكلف جداً، وعلى واجهة `public_jobs` أخطر: فيها استعلام فرعي مترابط
   *      (عدّ المحاولات لكل وظيفة) يُنفَّذ لكل صف من أجل العدّ وحده.
   *  الآن:
   *    • صفحة ١٠٠٠ صف (حد Supabase الافتراضي) بدل ٥٠٠.
   *    • العدّ الدقيق يُطلب **مرة واحدة** (الصفحة الأولى) ويمكن إلغاؤه للقراءة
   *      العامة عبر `{ count:false }`.
   *    • بقية الصفحات تُطلب **بالتوازي** (٤ في وقت واحد) بعد معرفة العدد،
   *      فزمن الجدول الكبير ≈ زمن صفحتين لا خمس.
   *    • تبقى كل حراسات السلامة: كشف تغيّر العدد أثناء التحميل، وتكرار المفاتيح،
   *      وحدّ الحجم الأقصى — والنتيجة نفسها بالضبط.
   * ═══════════════════════════════════════════════════════════════════════ */
  var PAGE_SIZE = 1000;      /* حد PostgREST الافتراضي في سوبابيس */
  var PAGE_PARALLEL = 4;     /* عدد الصفحات المتوازية */

  /* تنفيذ مهام محدودة التوازي مع الحفاظ على الترتيب */
  function mapLimit(items, limit, worker) {
    var out = new Array(items.length), i = 0, active = 0;
    return new Promise(function (resolve, reject) {
      if (!items.length) return resolve(out);
      var failed = false;
      function next() {
        if (failed) return;
        if (i >= items.length && active === 0) return resolve(out);
        while (active < limit && i < items.length) {
          (function (index) {
            active++;
            Promise.resolve(worker(items[index], index)).then(function (v) {
              out[index] = v; active--; next();
            }, function (e) { failed = true; reject(e); });
          })(i++);
        }
      }
      next();
    });
  }

  function readPages(client, table, maximum, opts) {
    opts = opts || {};
    var keys = { jobs: 'code', applicants: 'serial', job_attempts: 'id', audit_log: 'id', settings: 'key', staff: 'id', public_jobs: 'code' };
    keys.working_jobs = 'code'; keys.working_applicants = 'serial'; keys.working_job_attempts = 'id';
    var key = keys[table] || 'id';
    var rows = [], seen = Object.create(null), expected = null;
    var wantCount = opts.count !== false;

    function failure(message) { return { data: null, error: { message: message, code: 'INCOMPLETE_LOAD' } }; }

    function query(withCount) {
      var q = client.from(table).select(opts.cols || '*', withCount ? { count: 'exact' } : {});
      if (table === 'audit_log') q = q.order('ts', { ascending: false });
      return q.order(key, { ascending: true });
    }

    function fetchRange(from, to, withCount) {
      var q = query(withCount);
      if (typeof q.range !== 'function') {
        return Promise.resolve(q.limit(maximum)).then(function (res) {
          return { res: res, from: 0, to: maximum - 1 };
        });
      }
      return Promise.resolve(q.range(from, to)).then(function (res) {
        return { res: res || failure('لا نتيجة من القاعدة'), from: from, to: to };
      });
    }

    /* يجمع صفحة في المصفوفة مع كشف التكرار */
    function absorb(page) {
      var list = Array.isArray(page) ? page : [];
      for (var i = 0; i < list.length; i++) {
        var id = String(list[i][key]);
        if (seen[id]) return false;          /* تكرار = عدم اكتمال موثوق */
        seen[id] = true; rows.push(list[i]);
      }
      return true;
    }

    var first = query(wantCount);
    /* متوافق مع المحوّلات القديمة التي لا تدعم range */
    if (typeof first.range !== 'function') {
      return Promise.resolve().then(function () {
        return table === 'audit_log' ? first.limit(maximum) : first;
      });
    }

    /* 1) الصفحة الأولى: تجلب الصفوف والعدد معاً (العدّ مرة واحدة فقط) */
    return Promise.resolve(first.range(0, Math.min(PAGE_SIZE, maximum) - 1)).then(function (res) {
      if (!res || res.error) return res || failure('لا نتيجة من القاعدة');
      var count = typeof res.count === 'number' ? res.count : null;
      expected = count;
      if (count !== null && table !== 'audit_log' && count > maximum) {
        return failure('حجم الجدول يتجاوز حد التحميل الآمن؛ يلزم تقسيم البيانات');
      }
      if (!absorb(res.data)) return failure('تكرر سجل أثناء التحميل؛ أعد التحديث');
      var target = count === null ? null : Math.min(count, maximum);
      if (target !== null && rows.length >= target) return { data: rows, error: null };
      var page = Array.isArray(res.data) ? res.data : [];
      if (!page.length) return target === null ? { data: rows, error: null } : failure('لم يكتمل تحميل الجدول');
      if (rows.length >= maximum) return table === 'audit_log' ? { data: rows, error: null } : failure('تجاوز حد التحميل الآمن');

      /* 2) العدد غير معروف: نُكمل بالتسلسل حتى صفحة قصيرة (نادر — القراءة العامة) */
      if (target === null) {
        if (page.length < PAGE_SIZE) return { data: rows, error: null };
        return (function step(stepSize) {
          var from = rows.length, to = Math.min(from + stepSize, maximum) - 1;
          return fetchRange(from, to, false).then(function (r) {
            if (r.res && r.res.error) return r.res;
            if (!absorb(r.res.data)) return failure('تكرر سجل أثناء التحميل؛ أعد التحديث');
            var got = Array.isArray(r.res.data) ? r.res.data : [];
            if (!got.length || got.length < stepSize) return { data: rows, error: null };
            if (rows.length >= maximum) return table === 'audit_log' ? { data: rows, error: null } : failure('تجاوز حد التحميل الآمن');
            return step(stepSize);
          });
        })(Math.min(PAGE_SIZE, Math.max(1, page.length)));
      }

      /* 3) العدد معروف: نطلب بقية الصفحات بالتوازي (٤ في وقت واحد).
         حجم الخطوة يتبع ما عاد فعلاً: بعض إعدادات PostgREST تحدّ الصفحة بأقل
         من المطلوب (max-rows)، فنكيّف الخطوة مع الحد الفعلي بدل الانقطاع. */
      var stepSize = Math.min(PAGE_SIZE, Math.max(1, page.length));
      var ranges = [];
      for (var from = rows.length; from < target; from += stepSize) {
        ranges.push({ from: from, to: Math.min(from + stepSize, target, maximum) - 1 });
      }
      /* الصفحة الأخيرة وحدها تطلب العدّ مرة ثانية: يكشف تغيّر عدد السجلات أثناء
         التحميل (سلامة البيانات) بكلفة COUNT واحدة إضافية بدل واحدة لكل صفحة. */
      var lastIndex = ranges.length - 1;
      return mapLimit(ranges, PAGE_PARALLEL, function (r, index) {
        /* القراءة العامة لا تطلب عدّاً إطلاقاً (أثقل استعلام على الواجهة) */
        return fetchRange(r.from, r.to, wantCount && index === lastIndex);
      }).then(function (pages) {
        /* نُدخل الصفحات بترتيبها الأصلي (mapLimit يحفظ الترتيب) */
        for (var i = 0; i < pages.length; i++) {
          var r = pages[i];
          if (!r || !r.res || r.res.error) return r && r.res && r.res.error ? r.res : failure('لم يكتمل تحميل الجدول');
          if (!absorb(r.res.data)) return failure('تكرر سجل أثناء التحميل؛ أعد التحديث');
        }
        var last = pages[pages.length - 1];
        var finalCount = last && last.res && typeof last.res.count === 'number' ? last.res.count : null;
        if (finalCount !== null && expected !== null && finalCount !== expected) {
          return failure('تغير عدد السجلات أثناء التحميل؛ أعد التحديث');
        }
        if (rows.length !== target) return failure('تغير عدد السجلات أثناء التحميل؛ أعد التحديث');
        return { data: rows, error: null };
      });
    });
  }

  function fetchAll(client, opts) {
    opts = opts || {};
    var limit = opts.auditLimit || 2000;

    var queries = TABLES.map(function (t) {
      /* سجل التدقيق مؤجَّل عند الطلب: أكبر جدول في الحمولة، ولا حاجة له قبل
         فتح «سجل التدقيق». يُقرأ عبر loadAuditLog() عند الحاجة فقط. */
      if (t === 'audit_log' && opts.deferAudit) return Promise.resolve({ data: [], error: null, deferred: true });
      var source=opts.workspace&&['jobs','applicants','job_attempts'].indexOf(t)>=0?'working_'+t:t;
      return readPages(client, source, t === 'audit_log' ? limit : 100000);
    });

    /* ⚠️ تقريران ثقيلان كانا يُنتظران في إقلاع اللوحة:
       • staff_card_report: تجميع كل البطاقات (المالية والإحصاءات الكلية)
       • staff_issuance_registry: يُرجع خريطة بتات **~595KB** (base64 ≈ 800KB)
         لسجل الرموز المطبوعة — أي أكبر من كل الجداول مجتمعة.
       لذلك صار الإقلاع يقرأ الجداول فقط (opts.deferReports)، ويُحمَّل التقريران
       في الخلفية بعد ظهور اللوحة عبر loadWorkspaceReports. الوضع الافتراضي
       (بلا deferReports) يبقى كما كان كي لا تتغيّر بقية الاستدعاءات. */
    if(opts.workspace && !opts.deferReports){queries.push(Promise.resolve().then(function(){return rpcCall(client,'staff_card_report',{p_from:null,p_to:null});}).catch(function(){return {error:true};}));queries.push(Promise.resolve().then(function(){return rpcCall(client,'staff_issuance_registry',{p_serial:null});}).then(function(r){if(r.error)throw Error('تعذر قراءة سجل الرموز');setChanceRegistry(r.data);return {ok:true};}).catch(function(e){return {error:{message:e.message,code:'REGISTRY_REQUIRED'}};}));}
    return Promise.all(queries).then(function (results) {
      var failed = [];
      var data = {};
      results.slice(0,TABLES.length).forEach(function (res, i) {
        var t = TABLES[i];
        if (res && res.error) { failed.push({ table: t, error: res.error }); data[t] = []; }
        else data[t] = (res && res.data) || [];
      });
      var db = buildDb(data);
      if(opts.workspace && opts.deferReports){
        /* التقارير مؤجَّلة: نعلن ذلك في meta كي تعرف الواجهة أنها قادمة */
        db.meta.reportsPending = true;
      }
      if(opts.workspace && !opts.deferReports && results[TABLES.length+1] && results[TABLES.length+1].error && !failed.some(function(f){return f.table==='job_attempts';}))failed.push({table:'job_attempts',error:results[TABLES.length+1].error});
      if (opts.deferAudit) db.meta.auditPending = true;
      db.meta.failedTables = failed.map(function (f) { return f.table; });
      db.meta.errors = failed;
      if(opts.workspace){db.meta.workspace=true;db.meta.partialTables=['jobs','applicants','job_attempts'];if(!opts.deferReports){var report=results[TABLES.length];if(report&&!report.error&&report.data&&report.data.stats&&Array.isArray(report.data.rows))db.meta.serverReport=report.data;}}
      return db;
    });
  }

  /* ═════════════════════════════════════════════════════════════════════════
   *  تحميل تقارير اللوحة بعد الإقلاع (خلفية)
   *  -------------------------------------------------------------------------
   *  تُنفّذ النداءين معاً (متوازيين) وتُرجع:
   *    { report, registry, errors[] } — وreport/registry = null عند الفشل.
   *  • report: بيانات staff_card_report (إحصاءات كلية + صفوف مالية).
   *  • registry: سجل الرموز المطبوعة (~800KB) يُخزَّن في الذاكرة فقط
   *    (chanceBitmap) ولا يُسلسَل إلى أي ملف أو كاش.
   *  ⚠️ فشل السجل لا يُسقط الجلسة ولا يُعلن جدولاً مفقوداً — كان سابقاً يضع
   *     job_attempts في failedTables فيعود الموظف إلى واجهة الزائر.
   * ═══════════════════════════════════════════════════════════════════════ */
  function loadWorkspaceReports(client) {
    var errors = [];
    var pReport = Promise.resolve()
      .then(function () { return rpcCall(client, 'staff_card_report', { p_from: null, p_to: null }); })
      .then(function (r) {
        if (r.error || !r.data || !r.data.stats || !Array.isArray(r.data.rows)) {
          errors.push({ scope: 'report', error: r.error || { message: 'تقرير غير مكتمل' } });
          return null;
        }
        return r.data;
      })
      .catch(function (e) { errors.push({ scope: 'report', error: { message: String(e && e.message || e) } }); return null; });

    var pRegistry = Promise.resolve()
      .then(function () { return rpcCall(client, 'staff_issuance_registry', { p_serial: null }); })
      .then(function (r) {
        if (r.error) throw Error(r.error.message || 'تعذر قراءة سجل الرموز');
        setChanceRegistry(r.data);
        return { ok: true };
      })
      .catch(function (e) {
        errors.push({ scope: 'registry', error: { message: String(e && e.message || e), code: 'REGISTRY_REQUIRED' } });
        return null;
      });

    return Promise.all([pReport, pRegistry]).then(function (out) {
      return { report: out[0], registry: out[1], errors: errors };
    });
  }

  /* سجل التدقيق عند الطلب (٣٠٠ صف افتراضياً — يكفي العرض والتصفية الأخيرة).
     يُرتَّب من الأحدث، ويُدمج في الواجهة بلا تكرار. */
  function loadAuditLog(client, opts) {
    opts = opts || {};
    var limit = opts.limit || 300;
    return readPages(client, 'audit_log', limit).then(function (res) {
      if (res && res.error) return { ok: false, error: res.error, rows: [] };
      var rows = (res && res.data) || [];
      return {
        ok: true,
        rows: rows.map(auditFromDb).sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); })
      };
    }).catch(function (e) { return { ok: false, error: { message: String(e && e.message || e) }, rows: [] }; });
  }

  // Public reads use the RLS-safe public_jobs view, never the jobs table.
  /* أعمدة الواجهة العامة فقط — كانت select('*') تنزل حقولاً لا تعرضها القائمة
     فيكبر الرد بلا داعٍ على شبكة بطيئة. */
  var PUBLIC_JOB_COLS = 'code,title,category,region,governorate,shift,salary_min,salary_max,' +
    'gender,vacancies,requirements,status,hold_expires_at,created_at,description,image_url,available_vacancies';

  /* ⚡ ذاكرة عرض فورية لبيانات الوظائف العامة (٥ دقائق كحد أقصى)
     -----------------------------------------------------------------------
     • تحمل **بيانات قاعدة الشركة نفسها** التي وصلت آخر مرة — لا بيانات تجريبية.
     • تُعرض فوراً (بلا هيكل انتظار)، ثم يُعاد التحقق من القاعدة **فوراً** في
       الخلفية فتُستبدل بأحدث نسخة خلال أقل من ثانية.
     • تنتهي صلاحيتها بعد ٥ دقائق فتُهمَل ولا تُعرض إطلاقاً.
     • في التبويب نفسه تُستخدم من الذاكرة الفورية دائماً (تنقّل بلا انتظار). */
  var PUB_CACHE_KEY = 'hrc_public_jobs_v1';
  var PUB_CACHE_TTL = 5 * 60 * 1000;   /* أقصى عمر مقبول للعرض الفوري */
  var pubMemCache = null;              /* نفس التبويب: بلا قراءة من التخزين */
  var pubMemAt = 0;

  /* التخزين يُقرأ من الجذر (window/localStorage) — يعمل في المتصفح وفي الاختبار */
  function cacheStorage() {
    try {
      if (root.localStorage) return root.localStorage;
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* تخزين محجوب */ }
    return null;
  }

  function savePublicCache(jobs) {
    pubMemCache = jobs; pubMemAt = Date.now();
    var st = cacheStorage();
    if (!st) return;
    try { st.setItem(PUB_CACHE_KEY, JSON.stringify({ at: pubMemAt, jobs: jobs })); } catch (e) { }
  }
  function readPublicCache() {
    if (pubMemCache && (Date.now() - pubMemAt) <= PUB_CACHE_TTL) return pubMemCache;
    var st = cacheStorage();
    if (!st) return null;
    try {
      var raw = st.getItem(PUB_CACHE_KEY);
      if (!raw) return null;
      var box = JSON.parse(raw);
      if (!box || !Array.isArray(box.jobs) || !box.at) return null;
      if (Date.now() - box.at > PUB_CACHE_TTL) { clearPublicCache(); return null; }
      pubMemCache = box.jobs; pubMemAt = box.at;
      return box.jobs;
    } catch (e) { return null; }
  }
  function clearPublicCache() {
    pubMemCache = null; pubMemAt = 0;
    var st = cacheStorage();
    if (!st) return;
    try { st.removeItem(PUB_CACHE_KEY); } catch (e) { }
  }

  function fetchPublicJobs(client) {
    /* بلا count=exact: العدّ على public_jobs يُنفّذ استعلامه الفرعي المترابط
       لكل صف — وهو أثقل ما يواجهه كل زائر. نقرأ حتى صفحة قصيرة بدلاً منه. */
    return readPages(client, 'public_jobs', 100000, { count: false, cols: PUBLIC_JOB_COLS }).then(function (res) {
      if (res && res.error) {
        return { ok: false, error: res.error, jobs: [] };
      }
      var jobs = (res && res.data || []).map(jobFromDb);
      savePublicCache(jobs);
      return { ok: true, jobs: jobs };
    });
  }

  /* ------------------------- الطلب الإلكتروني (زائر) -------------------------
   *  إدراج مباشر في brc.applicants ممنوع على anon (revoke all) — فالطلب يمرّ
   *  عبر brc.request_form التي تتحقق من المدخلات وتضع الحالة 'pending' دائماً.
   * ----------------------------------------------------------------------- */
  function requestForm(client, data) {
    return rpcCall(client, 'request_form', {
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
    return rpcCall(client, 'verify_form', { p_serial: String(serial).trim().toUpperCase(), p_token: token || null })
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
          if (a.jobId === job.id) {
            a.jobTitle = job.title; a.location = job.governorate || '';
            a.employerName = job.employer.name; a.employerPhone = job.employer.phone;
          }
        });
      }
      return db;
    }

    if (table === 'applicants') {
      if(db.meta&&db.meta.workspace&&row&&row.archived_at){removeFrom(db.applicants,row.serial,function(x){return x.serial;});db.attempts=db.attempts.filter(function(t){if(t.serial===row.serial){rememberChance(t.code);return false;}return true;});if(Array.isArray(db.usedSerials))db.usedSerials=db.usedSerials.filter(function(s){return s!==row.serial;});return db;}
      if (type === 'DELETE') removeFrom(db.applicants, old.serial, function (x) { return x.serial; });
      else {
        var existing = (db.applicants || []).find(function (x) { return x.serial === row.serial; });
        var updated = applicantFromDb(row);
        if (existing && !updated.cardNumberKnown) { updated.cardNumber = existing.cardNumber || null; updated.cardNumberKnown = !!existing.cardNumberKnown; }
        replaceIn(db.applicants, updated, function (x) { return x.serial; });
      }
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
    var chan = client.channel('hrc-realtime');
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

  /* ============================================================================
   *  بطاقتي (الزبون) — دوال عامة آمنة عبر RPC
   *  ------------------------------------------------------------------------ */

  /* عرض آمن للبطاقة بالباركود: بلا رموز فرص وبلا بيانات صاحب العمل.
     p_code إلزامي في التوقيع (2026-11-13): البطاقات التي تحمل card_print_code
     لا تكشف الاسم/الهاتف كاملاً بلا الرمز. الفارغ يعني «بلا رمز» فتبقى
     البطاقات الحالية (بلا رمز مطبوع) تعمل كما هي. */
  function lookupCardRpc(client, serial, code) {
    if (!serial) return Promise.resolve({ ok: false, error: 'أدخل باركود البطاقة' });
    var body = { p_serial: String(serial).trim().toUpperCase() };
    /* p_code يُرسَل فقط عند وجود رمز فعلي — الباركود وحده يبقى كافياً
       للبطاقات التي لا تحمل card_print_code (قرار 2026-10-06 محفوظ). */
    if (code) body.p_code = String(code).trim();
    return rpcCall(client, 'lookup_card', body)
      .then(function (res) {
        if (res && res.error) {
          return { ok: false, code: res.error.code || 'rpc_error', error: res.error.message || 'تعذّر الاتصال بقاعدة الشركة' };
        }
        var data = res && res.data;
        if (!data || typeof data !== 'object') return { ok: false, code: 'empty', error: 'لا نتيجة من الخادم' };
        if (data.ok === false) return { ok: false, code: 'not_found', error: data.error || 'لا توجد بطاقة بهذا الباركود' };
        /* الشكلان المقبولان من دالة القاعدة: حقول مسطّحة أو متداخلة تحت card */
        var c = data.card || data;
        return {
          ok: true,
          card: {
            serial: c.serial, fullName: c.fullName, phone: c.phone,
            status: c.status, issueDate: c.issueDate, expiryDate: c.expiryDate,
            usesCardPrintCode: c.usesCardPrintCode === true,
            chancesLeft: c.chancesLeft, succeeded: c.succeeded === true,
            chances: (c.chances || []).map(function (ch) {
              return {
                no: ch.no, slotStatus: ch.slotStatus, jobCode: ch.jobCode, jobTitle: ch.jobTitle,
                location: ch.location, selectedAt: ch.selectedAt, holdExpiresAt: ch.holdExpiresAt,
                note: ch.note || ''
              };
            })
          }
        };
      })
      .catch(function (e) {
        return { ok: false, code: 'network', error: 'تعذّر الاتصال: ' + (e && e.message || e) };
      });
  }

  // Only the specified card's already-used opportunity is returned by SQL.
  function customerApplicationRpc(client, serial, no) {
    return rpcCall(client, 'customer_application_details', {p_serial: String(serial || '').trim().toUpperCase(), p_attempt_no: Number(no)})
      .then(function (r) { return r && r.data && !r.error ? r.data : {ok:false, error:(r && r.error && r.error.message) || 'تعذّر تحميل تفاصيل التقديم'}; })
      .catch(function () { return {ok:false, error:'تعذّر الاتصال لتحميل تفاصيل التقديم'}; });
  }

  /* التقديم الذاتي: الباركود + الوظيفة (رموز الفرص أُلغيت 2026-10-25) */
  /* استخدام فرصة: الباركود وحده كافٍ — أُلغيت رموز الفرص (2026-10-25).
     يُمرَّر p_code فارغاً فتُستهلك أول فرصة فارغة بالترتيب. */
  function useChanceRpc(client, serial, code, jobCode) {
    if (jobCode === undefined && code) { jobCode = code; code = ''; }
    if (!serial || !jobCode)
      return Promise.resolve({ ok: false, error: 'أكمل الباركود والوظيفة' });
    return rpcCall(client, 'use_chance', {
      p_serial: String(serial).trim().toUpperCase(), p_code: String(code || '').trim(), p_job_code: String(jobCode).trim()
    })
      .then(function (res) {
        if (res && res.error) {
          return { ok: false, code: res.error.code || 'rpc_error', error: res.error.message || 'تعذّر تنفيذ التقديم' };
        }
        var data = res && res.data;
        if (!data || typeof data !== 'object') return { ok: false, code: 'empty', error: 'لا نتيجة من الخادم' };
        if (data.ok === false) return { ok: false, code: 'rejected', error: data.error || 'تعذّر تنفيذ التقديم' };
        return { ok: true, data: data };
      })
      .catch(function (e) {
        return { ok: false, code: 'network', error: 'تعذّر الاتصال: ' + (e && e.message || e) };
      });
  }

  /* حمولة الطباعة المحمية برمز مستقل، أو رمز فرصة للبطاقات القديمة فقط. */
  function verifyCardCodeRpc(client, serial, code) {
    if (!serial || !code) return Promise.resolve({ ok: false, error: 'أدخل الباركود ورمز التحقق' });
    return rpcCall(client, 'verify_card_code', { p_serial: String(serial).trim().toUpperCase(), p_code: String(code).trim() })
      .then(function (res) {
        if (res && res.error) {
          return { ok: false, code: res.error.code || 'rpc_error', error: res.error.message || 'تعذّر الاتصال بقاعدة الشركة' };
        }
        var data = res && res.data;
        if (!data || typeof data !== 'object') return { ok: false, code: 'empty', error: 'لا نتيجة من الخادم' };
        if (data.ok === false) return { ok: false, code: 'bad_code', error: data.error || 'رمز التحقق غير صحيح' };
        return { ok: true, data: data.data || data };
      })
      .catch(function (e) {
        return { ok: false, code: 'network', error: 'تعذّر الاتصال: ' + (e && e.message || e) };
      });
  }


  /* نداء RPC موحّد: PostgREST يحدّد مخطط الدالة بموجب Accept-Profile —
     ومكتبة supabase-js ترسل في نداءات POST/rpc ترويسة Content-Profile وحدها
     فيبقى البحث في public ويفشل بـ PGRST202 «Could not find the function
     public.… in the schema cache» رغم وجود الدالة بسكيما brc. نضيف الترويسة
     الناقصة قبل كل نداء (لا أثر إن سبق وجودها، ولا شيء ينكسر بعملاء بلا rest
     كالعميل المصغّر HRCHttp الذي يرسلها من عنده). */
  function rpcCall(client, name, args) {
    try {
      var sc = (root.HRCSupabaseConfig && root.HRCSupabaseConfig.schema) || 'brc';
      if (client && client.rest && client.rest.headers && client.rest.headers.set)
        client.rest.headers.set('Accept-Profile', sc);
    } catch (e) { /* عميل وهمي بالاختبارات أو واجهة مختلفة — تجاهل */ }
    return client.rpc(name, args);
  }

  /* ========================================================================
   *  موديل 2026-10-01: بيع نقطة البيع + صفحة صاحب العمل (مسارات عامة)
   *  ---------------------------------------------------------------------- */

  /* ═══ activate_card: حُذفت من هذا الملف (2026-11-13) ═══
     كانت `activateCardRpc` تنادي `brc.activate_card` — دالة **منزوعة من
     anon و authenticated** منذ `20261030100000_remove_direct_card_sale.sql`.
     فالنداء كان يصطدم برفض صلاحية دائماً متى فُعّلت السحابة، ثم يرجع
     `store.js` للمسار المحلي فينجح — أي أن الموظف يرى نجاحاً بعد محاولة
     فاشلة، ويُسجَّل البيع على جهازه لا في القاعدة.

     ⚠️ وهذا هو الفرق الخطير: مسار البيع الحقيقي هو `apply_with_card` (في
     apply.html، للتقديم) أو إدخال الموظف من اللوحة. أما هذه الدالة فلم
     تكن تفعل شيئاً في السحابة قط.

     الأثر الآن: `store.js` لا يرى `HRCCloud.activateCard` فيسلك المسار
     المحلي مباشرة بلا محاولة فاشلة ولا تأخير. (انظر cardActivate هناك.) */
  /* حُذف مسار صاحب العمل من الويب (2026-10-25): لا صفحة ولا رمز سري ولا
     قرار من الويب — طلب صاحب العمل يُسجَّل من لوحة الموظفين. */
  root.HRCCloud = {
    /* تحويل */
    jobFromDb: jobFromDb, jobToDb: jobToDb,
    applicantFromDb: applicantFromDb, applicantToDb: applicantToDb,
    attemptFromDb: attemptFromDb, attemptToDb: attemptToDb,
    auditFromDb: auditFromDb, auditToDb: auditToDb,
    staffFromDb: staffFromDb,
    settingsFromDb: settingsFromDb, settingsToDb: settingsToDb,
    /* بيانات */
    chanceUsed:chanceUsed,rememberChance:rememberChance,clearChanceRegistry:clearChanceRegistry, rpcCall:rpcCall, buildDb: buildDb, fetchAll: fetchAll, loadWorkspaceReports: loadWorkspaceReports, loadAuditLog: loadAuditLog, TABLES: TABLES,

    fetchPublicJobs: fetchPublicJobs, readPublicCache: readPublicCache, clearPublicCache: clearPublicCache, verifyForm: verifyForm,
    lookupCard: lookupCardRpc, customerApplication: customerApplicationRpc, useChance: useChanceRpc, verifyCardCode: verifyCardCodeRpc,
    requestForm: requestForm,
    applyChange: applyChange, subscribeAll: subscribeAll,
    synthId: synthId
  };
})(typeof window !== 'undefined' ? window : globalThis);
