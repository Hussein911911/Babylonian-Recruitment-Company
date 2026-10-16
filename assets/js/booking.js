/* بطاقتي: عرض مقنّع بالباركود، وتقديم عبر apply.html للبطاقات الجديدة.
   إعادة طباعة البطاقة وA4 تتطلب رمز تحقق مستقل؛ القديمة تقبل رمز فرصة سابقاً. */
(function (root) {
  'use strict';
  var CFG = root.HRC_CONFIG, UI = root.HRCUI, Store = root.HRCStore;
  if (!document.getElementById('jobs-grid')) return;   // تعمل في الموقع العام فقط

  /* ======================= الحالة ======================= */
  var m = null;          // النافذة الحالية { root, close }
  /* entry | gate | posfill | posdone | employer | empdone | status | use | reprint | done */
  var view = 'entry';
  var serial = '';       // الباركود المدخل
  var card = null;       // نتيجة عرض البطاقة (lookup)
  var doneInfo = null;   // معلومات نجاح استخدام الفرصة
  var busy = false;
  var emp = null;        // نتيجة صفحة صاحب العمل (employerView)
  var posResult = null;  // نتيجة تفعيل نقطة البيع { app, attempt, job }
  var empDone = null;    // نتيجة قرار صاحب العمل
  var routeErr = '';     // خطأ توجيه مسح الباركود
  var posDraft = null;   // مسوّدة استمارة الزبون (قبل ضغطة «إتمام» من الزبون)
  var posStep = 1;       // خطوة المعالج الحالية: كل معلومة بصفحة لحدها (1..6)
  var POS_STEPS = 6;     // نقطة البيع · الاسم · الهاتف · العنوان · الجنس/الميلاد · الوظيفة
  var jobF = { q: '', region: '', shift: '' };   // فلاتر متصفح الوظائف (الخطوة 6)
  var posErr = '';      // سبب فشل «إتمام» الأخير — يبقى معروضاً داخل الشاشة لا توستاً يختفي بعد ثوانٍ

  /* ======================= أدوات ======================= */
  function esc(v) { return UI.esc(String(v == null ? '' : v)); }

  function availableJobs() {
    try {
      return (Store.listJobs() || []).filter(function (j) { return j.status === 'available'; });
    } catch (e) { return []; }
  }

  function serialPattern(v) {
    return Store.isCardSerial(v);
  }

  /* صندوق عرض معلومات بسيط */
  function infoBox(icon, html, extra) {
    return '<div class="bk-info" style="' + (extra || '') + '">' + UI.ic(icon) + ' ' + html + '</div>';
  }

  function stepHead(title, desc, icon) {
    return '<div class="bk-stephead"><h4>' +
      (icon ? UI.ic(icon) + ' ' : '') + esc(title) +
      '</h4><p class="muted small mb-0">' + desc + '</p></div>';
  }

  function fieldHtml(id, label, inner, hint, optional) {
    return '<div class="bk-field" data-bk-field="' + id + '">' +
      '<label for="bk-' + id + '">' + esc(label) + (optional ? '' : ' <span class="bk-req">*</span>') + '</label>' +
      inner +
      (hint ? '<span class="bk-hint">' + esc(hint) + '</span>' : '') +
      '<span class="bk-err" data-bk-err="' + id + '">' + UI.ic('alert') + '<span></span></span>' +
      '</div>';
  }

  function inputHtml(id, type, placeholder, value, extra) {
    return '<input id="bk-' + id + '" data-bk="' + id + '" type="' + (type || 'text') + '" ' +
      'placeholder="' + esc(placeholder || '') + '" value="' + esc(value || '') + '" autocomplete="off" ' +
      (extra || '') + '>';
  }

  function selectHtml(id, opts, value, placeholder) {
    var h = '<select id="bk-' + id + '" data-bk="' + id + '">' +
      '<option value="">' + esc(placeholder || 'اختر…') + '</option>';
    opts.forEach(function (o) {
      h += '<option value="' + esc(o.v) + '"' + (value === o.v ? ' selected' : '') + '>' + esc(o.t) + '</option>';
    });
    return h + '</select>';
  }

  function setErr(id, msg) {
    var host = document.querySelector('[data-bk-err="' + id + '"]');
    var field = document.querySelector('[data-bk-field="' + id + '"]');
    if (host) {
      host.querySelector('span').textContent = msg || '';
      host.style.display = msg ? 'flex' : 'none';
    }
    if (field) field.classList.toggle('is-bad', !!msg);
    return !!msg;
  }

  function btnRow(html) {
    return '<div class="bk-actions" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">' + html + '</div>';
  }

  /* شارة حالة البطاقة */
  function cardStatusBadge(st) {
    var map = CFG.formStatus || {};
    var s = map[st] || { ar: st, cls: 'muted' };
    var cls = s.cls === 'ok' ? 'chip-ok' : (s.cls === 'danger' ? 'chip-danger' : 'chip-warn');
    return '<span class="chip ' + cls + ' tiny">' + esc(s.ar) + '</span>';
  }

  /* شارة حالة الفرصة */
  function slotBadge(st) {
    var map = CFG.slotStatus || {};
    var s = map[st] || { ar: st || '—', cls: 'muted' };
    var cls = s.cls === 'ok' ? 'chip-ok' : (s.cls === 'danger' ? 'chip-danger' : (s.cls === 'muted' ? 'chip' : 'chip-warn'));
    return '<span class="chip ' + cls + ' tiny">' + esc(s.ar) + '</span>';
  }

  /* ======================= 1) الدخول بالباركود ======================= */
  function renderEntry(host) {
    host.innerHTML = stepHead('بطاقتي', 'أدخل باركود بطاقتك المطبوع أسفل الوجه الأمامي — أو امسحه بكاميرة موبايلك من الرابط نفسه.', 'card') +
      fieldHtml('serial', 'باركود البطاقة (10 خانات)',
        inputHtml('serial', 'text', 'مثال: 7KQ4M9TR2X', serial, 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700;letter-spacing:.04em" inputmode="latin"'),
        'الرقم المطبوع تحت الباركود وعلى واجهة بطاقتك.') +
      '<div class="bk-info" style="margin-top:14px">' + UI.ic('alert') +
        ' <b>ما عندك بطاقة؟</b> بطاقة التوظيف تُشترى كاشاً من نقاط البيع المعتمدة ' +
        '(مكاتب الاستنساخ) وفيها فرصتان مستقلتان للتقديم وصلاحيتها 30 يوماً — ' +
        'للاستفسار خابر الشركة: <b dir="ltr">' + esc(CFG.company.phones[0]) + '</b></div>' +
      btnRow('<button class="btn btn-gold" id="bk-lookup">' + UI.ic('search') + ' اعرض بطاقتي</button>');
    var go = document.getElementById('bk-lookup');
    var inp = document.getElementById('bk-serial');
    if (inp) {
      inp.addEventListener('input', function () { serial = inp.value; setErr('serial', ''); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLookup(); });
      setTimeout(function () { try { inp.focus(); } catch (e) { } }, 60);
    }
    if (go) go.addEventListener('click', doLookup);
    if (routeErr) {
      setErr('serial', routeErr);
      routeErr = '';
    } else if (serial && serialPattern(serial)) doLookup();
  }

  var storeWaits = 0;
  function storeReady() {
    try { return !!(Store && Store.db && Store.db()); } catch (e) { return false; }
  }

  function doLookup() {
    var v = String(serial || '').trim().toUpperCase();
    if (!serialPattern(v)) {
      setErr('serial', 'اكتب الباركود كما هو مطبوع على البطاقة — 10 خانات من حروف وأرقام.');
      return;
    }
    if (busy) return;
    /* سباق الإقلاع: فتح البطاقة من رابط ‎#card= قد يسبق تهيئة المخزن — ننتظرها قليلاً */
    if (!storeReady() && storeWaits < 25) { storeWaits++; setTimeout(doLookup, 120); return; }
    storeWaits = 0;
    busy = true;
    serial = v;
    var btn = document.getElementById('bk-lookup');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التحقق…'; }
    setErr('serial', '');
    Promise.resolve(Store.cardLookup(serial)).then(function (r) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('search') + ' اعرض بطاقتي'; }
      if (!r || !r.ok) {
        setErr('serial', (r && r.error) || 'تعذّر العثور على البطاقة — تأكد من الرقم.');
        return;
      }
      card = r.card;
      view = 'status';
      render();
    }).catch(function (e) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('search') + ' اعرض بطاقتي'; }
      setErr('serial', 'تعذّر الاتصال — حاول مرة أخرى.');
    });
  }

  /* ======================= 1ب) توجيه مسح الباركود =======================
   * البطاقة الفارغة ← استمارة تعبئة نقطة البيع (لحظة البيع).
   * البطاقة المباعة ← بوابة الدور: الزبون (بطاقتي) أو صاحب العمل (قرار التوظيف).
   * ==================================================================== */
  function routeFromHash() {
    view = 'routewait';
    render();
    if (!storeReady() && storeWaits < 25) { storeWaits++; setTimeout(routeFromHash, 120); return; }
    storeWaits = 0;
    if (busy) return;
    busy = true;
    Promise.resolve(Store.cardEmployerView(serial)).then(function (r) {
      busy = false;
      if (r && r.ok) { emp = r; view = 'gate'; render(); return; }
      if (r && r.code === 'blank') { view = 'posfill'; render(); return; }
      routeErr = (r && r.error) || 'تعذّر العثور على البطاقة — تأكد من الرقم.';
      render();
    }).catch(function () {
      busy = false;
      routeErr = 'تعذّر الاتصال — امسح الباركود مرة أخرى.';
      render();
    });
  }

  function renderRouteWait(host) {
    host.innerHTML = stepHead('بطاقة التوظيف', 'جارٍ قراءة البطاقة من الباركود…', 'card') +
      '<div class="bk-info">' + UI.ic('clock') + ' لحظات ويتم التحقق…</div>';
  }

  /* ============ بوابة الدور: من يمسك البطاقة الآن؟ ============ */
  function renderGate(host) {
    var c = emp.card || {};
    var applied = c.applied;
    host.innerHTML = stepHead('بطاقة التوظيف', 'هذه البطاقة مُباعة ومُفعّلة — اختر هويتك للمتابعة:', 'card') +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin:4px 0 10px">' +
        '<b dir="ltr">' + esc(c.serial || serial) + '</b>' + cardStatusBadge(c.status) +
        (c.chancesLeft != null ? '<span class="tiny muted">الفرص المتاحة: <b>' + esc(c.chancesLeft) + '</b></span>' : '') +
      '</div>' +
      '<div style="display:grid;gap:10px;margin-top:6px">' +
        '<button class="btn btn-gold" id="bk-gate-emp" style="padding:16px 18px;text-align:right;display:flex;gap:12px;align-items:center">' +
          '<span style="font-size:26px">' + UI.ic('briefcase') + '</span>' +
          '<span><b style="display:block;font-size:15px">أنا صاحب العمل</b>' +
          '<span class="tiny" style="font-weight:500">أرید تعريف المتقدم والوظيفة وتسجيل قرار التوظيف — يكفي هذا الباركود، بلا رموز.</span></span></button>' +
        '<button class="btn btn-lapis" id="bk-gate-cust" style="padding:16px 18px;text-align:right;display:flex;gap:12px;align-items:center">' +
          '<span style="font-size:26px">' + UI.ic('card') + '</span>' +
          '<span><b style="display:block;font-size:15px">أنا الزبون — بطاقتي</b>' +
          '<span class="tiny" style="font-weight:500">متابعة الفرصتين واستخدام رمز فرصة على وظيفة أخرى.</span></span></button>' +
      '</div>' +
      infoBox('alert', '<b>لم تُبَع هذه البطاقة أو لا تعرفها؟</b> بطاقات التوظيف تُباع كاشاً من نقاط البيع المعتمدة — ' +
        'للاستفسار خابر الشركة: <b dir="ltr">' + esc(CFG.company.phones[0]) + '</b>');
    var b;
    if ((b = document.getElementById('bk-gate-emp'))) b.addEventListener('click', function () { view = 'employer'; render(); });
    if ((b = document.getElementById('bk-gate-cust'))) b.addEventListener('click', custRoute);
  }

  /* بطاقتي من البوابة: بحث مع إظهار أي خطأ للمستخدم */
  function custRoute() {
    if (busy) return;
    busy = true;
    render();
    Promise.resolve(Store.cardLookup(serial)).then(function (r) {
      busy = false;
      if (!r || !r.ok) { UI.toast('err', 'تعذّر عرض البطاقة', (r && r.error) || 'حاول مرة أخرى'); return; }
      card = r.card; view = 'status'; render();
    }).catch(function () {
      busy = false; UI.toast('err', 'تعذّر الاتصال', 'حاول مرة أخرى');
    });
  }

  /* فتح صفحة صاحب العمل من بطاقتي (مسار يدوي) */
  var directEmployer = false;   /* فُتحت صفحة صاحب العمل من رابط role=employer بلا بوابة */
  function employerRoute(fromLink) {
    if (fromLink) directEmployer = true;
    view = 'routewait';
    render();
    /* سباق الإقلاع: قد يسبق فتح الرابط تهيئة المخزن — ننتظرها قليلاً */
    if (!storeReady() && storeWaits < 25) { storeWaits++; setTimeout(employerRoute, 120); return; }
    storeWaits = 0;
    if (busy) return;
    busy = true;
    render();
    Promise.resolve(Store.cardEmployerView(serial)).then(function (r) {
      busy = false;
      if (!r || !r.ok) { UI.toast('err', 'تعذّر الفتح', (r && r.error) || 'حاول مرة أخرى'); return; }
      emp = r; view = 'employer'; render();
    }).catch(function () {
      busy = false; UI.toast('err', 'تعذّر الاتصال', 'حاول مرة أخرى');
    });
  }

  /* ======================= 1ج) استمارة نقطة البيع =======================
   * تمسح نقطة البيع باركود البطاقة الفارغة لحظة البيع فتُعبّأ بيانات الزبون
   * واختيار الوظيفة (إلزامي) — ثم تُطبع استمارة A4 بنفس الباركود.
   * ==================================================================== */
  function renderPosFill(host) {
    var jobs = availableJobs(), posNames = [], d = posDraft || {}, lastPos = '';
    try { posNames = Store.listPosNames() || []; } catch (e) { }
    try { lastPos = localStorage.getItem('hrc_last_pos') || ''; } catch (e) { }
    var BIG = 'style="font-size:18px;padding:12px 14px"';
    var LTR = 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700;font-size:18px;padding:12px 14px" inputmode="tel"';
    var opt = '<div class="bk-info">' + UI.ic('check') + ' اضغط «التالي» حتى لو تركتها فاضية.</div>';
    /* رأس الخطوة + شريط التقدم (خطوة من ست) */
    var head = function (t, sub, ic) {
      var dots = '';
      for (var i = 1; i <= POS_STEPS; i++)
        dots += '<span style="flex:1;height:7px;border-radius:7px;background:' +
          (i < posStep ? '#3ec1a0' : i === posStep ? '#c8a24a' : '#e4e7ee') + '"></span>';
      return stepHead('الخطوة ' + posStep + ' من ' + POS_STEPS + ' — ' + t, sub, ic) +
        '<div style="display:flex;gap:5px;margin:0 0 14px">' + dots + '</div>';
    };
    var body = '', focus = null;

    if (posStep === 1) body = head('اسم نقطة البيع', 'يعبّيها موظف النقطة قبل تسليم الجهاز للزبون.', 'card') +
        '<div class="bk-info">' + UI.ic('alert') + ' <b>لنقطة البيع فقط:</b> البيع كاش فقط — حسب تعرفة الشركة.</div>' +
        '<datalist id="bk-posnames">' + posNames.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
        fieldHtml('posName', 'اسم نقطة البيع', inputHtml('posName', 'text', 'مثال: مكتب النور للاستنساخ', d.posName || lastPos, 'list="bk-posnames" ' + BIG),
          'يُطبع على الاستمارة ويُسجَّل لدى الشركة.'), focus = 'bk-posName';
    else if (posStep === 2) body = head('الاسم الكامل', 'اسمك يُطبع على استمارة التوظيف.', 'user') +
        fieldHtml('fullName', 'الاسم الكامل للزبون', inputHtml('fullName', 'text', 'الاسم الرباعي', d.fullName || '', BIG),
          'كما في هوية الأحوال المدنية.'), focus = 'bk-fullName';
    else if (posStep === 3) body = head('رقم الهاتف', 'عليه تواصل الشركة معك — اكتبه بدقة.', 'phone') +
        fieldHtml('phone', 'رقم هاتف الزبون', inputHtml('phone', 'tel', '07XXXXXXXXX', d.phone || '', LTR),
          'تأكد منه مرتين قبل التالي.'), focus = 'bk-phone';
    else if (posStep === 4) body = head('العنوان', 'معلومات إضافية — تخليها فاضغة إذا ما تعرف.', 'pin') +
        fieldHtml('address', 'العنوان (اختياري)', inputHtml('address', 'text', 'المحافظة — القضاء — المحلة', d.address || '', BIG),
          'يساعد بترشيح وظائف قريبة منك.', true) + opt, focus = 'bk-address';
    else if (posStep === 5) body = head('الجنس وتاريخ الميلاد', 'معلومات إضافية — تساعد بترشيح ما يناسبك.', 'calendar') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
        fieldHtml('gender', 'الجنس', selectHtml('gender', [{ v: 'ذكر', t: 'ذكر' }, { v: 'أنثى', t: 'أنثى' }], d.gender || 'ذكر'), null, true) +
        fieldHtml('dob', 'تاريخ الميلاد (اختياري)', inputHtml('dob', 'date', '', d.dob || '', 'dir="ltr"'), null, true) +
        '</div>' + opt, focus = 'bk-gender';
    else body = head('اختيار الوظيفة (اختياري)', 'إن أراد الزبون اختيار وظيفته الآن اخترها له — أو اضغط «تخطّي» فيختار وظيفتَي فرصتيه بنفسه لاحقاً من باركود بطاقته.', 'briefcase') +
      (jobs.length ? jobPickerHtml(jobs, d) +
        infoBox('alert', 'اختيار وظيفة الآن يستهلك فرصة بحجز <b>24 ساعة</b>. يمكنك التخطي ليختار الزبون لاحقاً؛ تُطبع استمارة لكل تقديم.') :
        infoBox('alert', '<b>لا توجد وظائف متاحة حالياً</b> — يمكنك تخطّي الاختيار وإتمام البيع، ويختار الزبون لاحقاً عند توفّر وظائف.'));

    if (posErr) body = infoBox('alert', '<b>تعذّر إتمام البيع — ' + esc(posErr) + '</b>', 'border-color:#d33;background:#fdeeee') + body;
    host.innerHTML = body + btnRow(
      '<button class="btn btn-gold" id="bk-pos-next" style="padding:14px 26px;font-size:17px">' + UI.ic('arrow-left') +
        (posStep >= POS_STEPS ? ' التالي — مراجعة بياناتي' : ' التالي') + '</button>' +
      (posStep >= POS_STEPS ? '<button class="btn btn-lapis" id="bk-pos-skip">' + UI.ic('card') + ' تخطّي — الزبون يختار وظيفتيه بنفسه</button>' : '') +
      (posStep > 1 ? '<button class="btn btn-ghost" id="bk-pos-back">' + UI.ic('arrow-right') + ' رجوع</button>' : '') +
      '<button class="btn btn-ghost" id="bk-pos-cancel">' + UI.ic('x') + ' إلغاء</button>');
    var b;
    ['posName', 'fullName', 'phone', 'address', 'gender', 'dob', 'job'].forEach(function (id) {
      var el = document.getElementById('bk-' + id);
      if (el) el.addEventListener('input', function () { setErr(id, ''); });
      if (el) el.addEventListener('change', function () { setErr(id, ''); });
    });
    if ((b = document.getElementById('bk-pos-next'))) b.addEventListener('click', posNext);
    if ((b = document.getElementById('bk-pos-skip'))) b.addEventListener('click', posSkip);
    if ((b = document.getElementById('bk-pos-back'))) b.addEventListener('click', posBack);
    if ((b = document.getElementById('bk-pos-cancel'))) b.addEventListener('click', close);
    if (posStep === POS_STEPS && jobs.length) bindJobPicker(jobs);
    if (focus) setTimeout(function () {
      try { var f = document.getElementById(focus); if (f) { f.focus(); if (f.select) f.select(); } } catch (e) { }
    }, 60);
  }

  /* ===== متصفح الوظائف (الخطوة 6): بطاقات متاحة بفلاتر بحث/منطقة/دوام —
     مثل قسم الوظائف بالموقع — والزبون يضغط البطاقة ليختارها. تُعرض الحقول
     العامة فقط: بلا أي بيانات لصاحب العمل قبل ضغطته «إتمام». ===== */
  function jobPickerHtml(jobs, d) {
    var regions = [], shifts = [];
    jobs.forEach(function (j) {
      if (regions.indexOf(j.region) < 0) regions.push(j.region);
      if (shifts.indexOf(j.shift) < 0) shifts.push(j.shift);
    });
    var sel = function (id, list, cur, allLabel) {
      return '<select id="' + id + '" style="font-size:13.5px;padding:9px 10px">' +
        '<option value="">' + allLabel + '</option>' +
        list.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select>';
    };
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
        '<input id="bk-jq" type="search" placeholder="ابحث: عنوان الوظيفة أو كودها…" value="' + esc(jobF.q) + '" style="grid-column:1/-1;font-size:14.5px;padding:10px 12px">' +
        sel('bk-jr', regions, jobF.region, 'كل المناطق') + sel('bk-js', shifts, jobF.shift, 'كل الدوامات') +
      '</div>' +
      '<div class="tiny muted" style="margin-bottom:8px">الوظائف المتاحة: <b id="bk-jcount"></b> — اضغط البطاقة لاختيارها</div>' +
      '<div id="bk-jlist" style="max-height:44vh;overflow:auto;padding-left:2px"></div>' +
      '<span class="bk-err" data-bk-err="job" style="margin-top:10px">' + UI.ic('alert') + '<span></span></span>' +
      '<div id="bk-job-sum" style="margin-top:10px">' + jobSummaryHtml(d.jobCode) + '</div>';
  }

  function jobCardHtml(j, picked) {
    return '<button type="button" class="bk-pick' + (picked ? ' is-picked' : '') + '" data-bk-pick="' + esc(j.code) + '">' +
      '<div class="bk-pick-top"><b>' + esc(j.title) + '</b> <span class="mono tiny" dir="ltr">' + esc(j.code) + '</span></div>' +
      '<div class="bk-pick-meta">' +
        '<span>' + UI.ic('pin') + ' ' + esc(j.region) + '</span>' +
        '<span>' + UI.ic('money') + ' ' + esc(Store.money(j.salaryMin)) + ' – ' + esc(Store.money(j.salaryMax)) + '</span>' +
        '<span>' + UI.ic('clock') + ' ' + esc(j.shift) + '</span>' +
        (j.gender && j.gender !== 'لا فرق' ? '<span>' + UI.ic('users') + ' ' + esc(j.gender) + '</span>' : '') +
      '</div>' +
      '<div class="tiny" style="margin-top:6px;font-weight:700;color:' + (picked ? '#1d7a5f' : '#986a1d') + '">' +
        (picked ? UI.ic('check') + ' مختارة — اضغط «التالي»' : 'اضغط للاختيار') + '</div></button>';
  }

  function bindJobPicker(jobs) {
    var paint = function () {
      var q = String(jobF.q || '').trim();
      var list = jobs.filter(function (j) {
        return (!q || j.title.indexOf(q) > -1 || j.code.indexOf(q.toUpperCase()) > -1) &&
          (!jobF.region || j.region === jobF.region) && (!jobF.shift || j.shift === jobF.shift);
      });
      var host = document.getElementById('bk-jlist');
      if (!host) return;
      host.innerHTML = list.length
        ? list.map(function (j) { return jobCardHtml(j, !!(posDraft && posDraft.jobCode === j.code)); }).join('')
        : '<div class="bk-info">لا توجد وظائف مطابقة — غيّر البحث أو التصفية.</div>';
      var c = document.getElementById('bk-jcount');
      if (c) c.textContent = list.length;
      var picks = host.querySelectorAll('[data-bk-pick]');
      for (var i = 0; i < picks.length; i++) picks[i].addEventListener('click', function () {
        var code = this.getAttribute('data-bk-pick');
        if (!posDraft) posDraft = {};
        posDraft.jobCode = code;   /* اختيار الوظيفة يلغي التخطّي */
        posDraft.skipJob = false;
        setErr('job', '');
        paint();   /* يعاد رسم القائمة فقط — الفلاتر تبقى بمكانها */
        var sum = document.getElementById('bk-job-sum');
        if (sum) sum.innerHTML = jobSummaryHtml(code);
      });
    };
    var q = document.getElementById('bk-jq');
    if (q) q.addEventListener('input', function () { jobF.q = q.value; paint(); });
    var r = document.getElementById('bk-jr');
    if (r) r.addEventListener('change', function () { jobF.region = r.value; paint(); });
    var sh = document.getElementById('bk-js');
    if (sh) sh.addEventListener('change', function () { jobF.shift = sh.value; paint(); });
    paint();
  }

  /* ملخص الوظيفة المختارة تحت القائمة — واضح للزبون قبل ما يمشي */
  function jobSummaryHtml(code) {
    var j = null;
    try { j = Store.getJob(String(code || '').trim().toUpperCase()); } catch (e) { }
    if (!j) return '';
    return '<div style="border:1px solid #dfe4ec;border-radius:12px;padding:12px 14px;line-height:2.1">' +
      '<b>' + esc(j.title) + '</b> <span class="mono tiny" dir="ltr">(' + esc(j.code) + ')</span><br>' +
      'المنطقة: <b>' + esc(j.region) + '</b> · الأجر: <b>' + esc(Store.money(j.salaryMin)) + ' – ' + esc(Store.money(j.salaryMax)) +
      '</b> · الدوام: <b>' + esc(j.shift) + '</b></div>';
  }

  function posBack() { if (posStep > 1) { posStep--; render(); } }

  /* تخطّي اختيار الوظيفة: تُباع البطاقة بفرصتين فارغتين ويختار الزبون
     وظيفتيه بنفسه من باركود بطاقته (قرار الإدارة 2026-10-06). */
  function posSkip() {
    posErr = '';
    var d = posDraft || {};
    d.jobCode = '';
    d.jobOptions = null;
    d.skipJob = true;      /* بيع بلا وظيفة — الزبون يختار وظيفتيه بنفسه */
    posDraft = d;
    setErr('job', '');
    view = 'posreview';
    render();
  }

  /* «التالي»: تحقق من معلومة الخطوة الحالية فقط ثم حفظها والمضي —
     كل معلومة بصفحة (2026-10-01)، والمراجعة النهائية بيد الزبون نفسه. */
  function posNext() {
    posErr = '';   /* كل تقدّم للزمام يبدأ بلا خطأ سابق */
    var g = function (id) { var el = document.getElementById('bk-' + id); return el ? String(el.value || '').trim() : ''; };
    var d = posDraft || {};
    var f = ({ 1: 'posName', 2: 'fullName', 3: 'phone', 4: 'address' })[posStep];
    if (f) {
      d[f] = g(f);
      if (f !== 'address' && !d[f]) {
        setErr(f, ({ posName: 'اسم نقطة البيع مطلوب — كما هو معتمد لدى الشركة.',
          fullName: 'الاسم الكامل مطلوب.', phone: 'رقم الهاتف مطلوب.' })[f]);
        return;
      }
    } else if (posStep === POS_STEPS) {
      /* الوظيفة اختيارية (2026-10-06): إمّا يختارها موظف النقطة للزبون،
         وإمّا يتخطّاها فيختار الزبون وظيفتَي فرصتيه بنفسه من باركود بطاقته. */
      if (!d.jobCode && !d.skipJob) {
        setErr('job', 'اختر وظيفة للزبون، أو اضغط «تخطّي — الزبون يختار وظيفتيه بنفسه».');
        return;
      }
      if (!d.jobCode) { posDraft = d; view = 'posreview'; render(); return; }
      /* المختارة قد تكون حُجزت بلحظة ما (بيع متزامن أو صفحة بقيت مفتوحة):
         لا مراجعة بوظيفة غير متاحة — ينظف الاختيار ويظهر السبب داخل الشاشة */
      if (!availableJobs().some(function (j) { return j.code === d.jobCode; })) {
        d.jobCode = '';
        posErr = 'الوظيفة التي اخترتها لم تعد متاحة — حُجزت لزبون آخر أثناء تعبئتك. اختر بطاقة وظيفة أخرى من القائمة.';
        posDraft = d; render();
        setErr('job', 'الوظيفة المختارة لم تعد متاحة — اختر وظيفة أخرى.');
        return;
      }
    }
    if (posStep === 1) { try { localStorage.setItem('hrc_last_pos', d.posName); } catch (e) { } }
    else if (posStep === 5) { d.gender = g('gender') || 'ذكر'; d.dob = g('dob'); }
    posDraft = d;
    if (posStep >= POS_STEPS) { view = 'posreview'; render(); return; }
    posStep++; render();
  }

  /* شاشة المراجعة: بيانات الزبون والوظيفة فقط — بلا أي بيانات صاحب العمل */
  function renderPosReview(host) {
    var d = posDraft || {};
    var job = null;
    try { job = Store.getJob(d.jobCode); } catch (e) { job = null; }
    var skipJob = !!(d.skipJob && !d.jobCode);
    host.innerHTML = stepHead('مراجعة الزبون قبل الإتمام',
        skipJob
          ? 'راجع بياناتك يا زبون — بالضغط على «إتمام» تُفعَّل بطاقتك بفرصتين وتختار أنت وظيفتَيك لاحقاً من باركود البطاقة.'
          : 'راجع بياناتك يا زبون — بالضغط على «إتمام» تُستهلك الفرصة الأولى وتُطبع استمارة التوظيف ببيانات صاحب العمل.', 'user') +
      '<div class="bk-info" style="border-color:#c8a24a;background:#fdf9ee">' + UI.ic('alert') +
        ' <b>للزبون:</b> سلّمك موظف نقطة البيع الجهاز — تأكد من بياناتك ووظيفتك ثم اضغط <b>«إتمام»</b> بنفسك.' +
        ' بيانات التواصل بصاحب العمل تظهر على الاستمارة المطبوعة بعد إتمامك فقط.</div>' +
      '<h5 style="margin:14px 0 4px">بياناتك</h5>' +
      '<div class="tiny" style="line-height:2.1;border:1px solid var(--line-soft);border-radius:12px;padding:10px 14px">' +
        'الاسم الكامل: <b>' + esc(d.fullName) + '</b><br>' +
        'الهاتف: <b dir="ltr">' + esc(d.phone) + '</b>' +
        (d.address ? '<br>العنوان: <b>' + esc(d.address) + '</b>' : '') +
        (d.gender ? '<br>الجنس: <b>' + esc(d.gender) + '</b>' : '') +
        (d.dob ? '<br>تاريخ الميلاد: <b>' + esc(d.dob) + '</b>' : '') +
        '<br>نقطة البيع: <b>' + esc(d.posName) + '</b>' +
      '</div>' +
      '<h5 style="margin:14px 0 4px">الوظيفة المطلوبة</h5>' +
      (job
        ? '<div class="tiny" style="line-height:2.1;border:1px solid var(--line-soft);border-radius:12px;padding:10px 14px">' +
            'الوظيفة: <b>' + esc(job.title) + '</b> <span class="mono" dir="ltr">(' + esc(job.code) + ')</span><br>' +
            'المنطقة: <b>' + esc(job.region) + '</b><br>' +
            'الأجر الشهري: <b>' + esc(Store.money(job.salaryMin)) + ' – ' + esc(Store.money(job.salaryMax)) + '</b><br>' +
            'الدوام: <b>' + esc(job.shift) + '</b>' +
          '</div>'
        : skipJob
        ? infoBox('card', '<b>بلا اختيار وظيفة</b> — تُباع البطاقة بفرصتين فارغتين، ويختار الزبون وظيفتَيه بنفسه من باركود بطاقته، وتُطبع استمارة A4 لكل وظيفة يختارها. <b>إن أردت اختيار وظيفة الآن</b> ارجع واخترها.')
        : infoBox('alert', 'الوظيفة غير متاحة — ارجع للتعديل واختر وظيفة أخرى.')) +
      (skipJob
        ? '<div class="bk-info">' + UI.ic('clock') + ' بإتمامك: تُفعَّل البطاقة وتصلح <b>30 يوماً</b> بفرصتين فارغتين — لا تُستهلك أي فرصة الآن.</div>'
        : '<div class="bk-info">' + UI.ic('clock') + ' بإتمامك: تُحجز الوظيفة <b>24 ساعة</b> بانتظار قرار صاحب العمل والشركة، وتُستهلك الفرصة الأولى بالتقديم (لا تعود بأي نتيجة).</div>') +
      btnRow(
        '<button class="btn btn-gold" id="bk-pos-confirm" style="padding:14px 26px;font-size:16px">' + UI.ic('check') + ' إتمام</button>' +
        '<button class="btn btn-ghost" id="bk-pos-back">' + UI.ic('arrow-right') + ' رجوع للتعديل</button>') +
      '<div class="bk-info" style="margin-top:10px">' + UI.ic('edit') +
        ' في خطأ؟ «رجوع للتعديل» ثم «رجوع» خطوة خطوة حتى تصحّح.</div>';
    var b;
    if ((b = document.getElementById('bk-pos-confirm'))) b.addEventListener('click', doPosFill);
    if ((b = document.getElementById('bk-pos-back'))) b.addEventListener('click', function () { view = 'posfill'; posStep = POS_STEPS; render(); });
  }

  function doPosFill() {
    var d = posDraft || {};
    var fullName = d.fullName, phone = d.phone, posName = d.posName;
    var jobCode = d.jobCode || '';
    if (!posName || !fullName || !phone) {
      view = 'posfill'; posStep = POS_STEPS; render();
      UI.toast('err', 'بيانات ناقصة', 'أكمل بيانات الاستمارة أولاً.');
      return;
    }
    if (busy) return;
    busy = true;
    var btn = document.getElementById('bk-pos-confirm');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التسجيل…'; }
    Promise.resolve(Store.cardActivate(serial, {
      posName: posName, fullName: fullName, phone: phone,
      address: d.address || '', gender: d.gender || 'ذكر', dob: d.dob || '', jobCode: jobCode
    })).then(function (r) {
      busy = false;
      if (!r || !r.ok) {
        busy = false;
        if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('check') + ' إتمام'; }
        /* السبب يبقى مكتوباً داخل الشاشة — التوست وحده يختفي قبل ما يقرأه الزبون */
        posErr = (r && r.error) || 'تعذّر إتمام البيع — حاول مرة أخرى';
        /* الوظيفة المختارة إن لم تعد متاحة تُنظف من المسوّدة حتى لا يعيد المحاولة عليها */
        if (posDraft && posDraft.jobCode &&
            !availableJobs().some(function (j) { return j.code === posDraft.jobCode; })) posDraft.jobCode = '';
        UI.toast('err', 'تعذّر إتمام البيع', (r && r.error) || 'حاول مرة أخرى');
        view = 'posfill'; posStep = POS_STEPS; render();
        return;
      }
      posErr = '';
      posDraft = null;
      posResult = r;
      view = 'posdone'; render();
      /* طباعة استمارة A4 جزء من عملية البيع — فقط إذا اختيرت وظيفة؛
         البيع المجرّد (بلا وظيفة) بلا استمارة حتى يختار الزبون وظيفته. */
      if (r.attempt) setTimeout(function () {
        try {
          var V = root.HRCVoucher;
          if (V && V.printForm) V.printForm(r.app, r.attempt);
        } catch (e) { }
      }, 450);
    }).catch(function () {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('check') + ' إتمام'; }
      posErr = 'تعذّر الاتصال — حاول مرة أخرى.';
      UI.toast('err', 'تعذّر الاتصال', 'حاول مرة أخرى');
      view = 'posfill'; posStep = POS_STEPS; render();
    });
  }

  function renderPosDone(host) {
    var r = posResult || {};
    var app = r.app || {}, at = r.attempt, job = r.job;
    host.innerHTML =
      '<div class="bk-success" style="text-align:center;padding:8px 4px 2px">' +
        '<div style="width:74px;height:74px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#3ec1a0,#1f8f96);color:#fff;box-shadow:0 14px 34px rgba(31,143,150,.35)">' + UI.ic('check') + '</div>' +
        '<h4 style="margin:0 0 6px">تم البيع وتعبئة البطاقة ✅</h4>' +
        '<p class="muted small" style="margin:0 auto 10px;max-width:50ch">سُجّل الزبون <b>' + esc(app.fullName) + '</b> على البطاقة ' +
          '<b dir="ltr">' + esc(app.serial || serial) + '</b> وبدأت صلاحيتها 30 يوماً من الآن.</p>' +
        (at ? '<div class="bk-info" style="text-align:right">' + UI.ic('briefcase') +
          ' استُهلكت الفرصة الأولى بالتقديم على <b>' + esc(at.jobTitle) + '</b> ' +
          '<span class="mono" dir="ltr">(' + esc(at.jobCode) + ')</span>' +
          ' — الوظيفة محجوزة 24 ساعة بانتظار قرار صاحب العمل' +
          (at.holdExpiresAt ? ' حتى <b>' + esc(Store.fmtDateTime(at.holdExpiresAt)) + '</b>' : '') + '.</div>'
          : '<div class="bk-info" style="text-align:right;border-color:#1f8f96;background:#eefaf7">' + UI.ic('card') +
            ' <b>البطاقة صارت نشطة بفرصتين فارغتين</b> — الزبون يمسح باركود بطاقته بنفسه ويختار وظيفتَيه ' +
            '(وتُطبع استمارة A4 لكل وظيفة يختارها).</div>') +
        (at ? '<div class="bk-info" style="text-align:right;border-color:#c8a24a;background:#fdf9ee">' + UI.ic('print') +
          ' <b>هذي استمارة التوظيف A4</b> — تحمل نفس باركود البطاقة وبيانات الزبون والوظيفة ' +
          'وبيانات التواصل بصاحب العمل. اطبعها وسلّمها للزبون مع البطاقة.</div>' : '') +
      '</div>' +
      /* الاستمارة نفسها معروضة أمام العين مباشرة (ليست مخفية للطباعة وحدها):
         بعض المتصفحات تحجب حوار الطباعة داخل الإطارات المحاطة — والزبون/النقطة
         يشوفان الورقة على الشاشة بأي حال ويمكن طباعتها بالزر. */
      '<div style="max-height:56vh;overflow:auto;border:1px solid #dfe4ec;border-radius:12px;margin-top:4px">' +
        '<div style="zoom:.62">' + ((root.HRCVoucher && root.HRCVoucher.previewForm)
          ? root.HRCVoucher.previewForm(app, at) : '') + '</div></div>' +
      btnRow(
        (at ? '<button class="btn btn-gold" id="bk-pos-print">' + UI.ic('print') + ' اطبع استمارة التوظيف A4</button>' : '') +
        '<button class="btn btn-ghost" id="bk-pos-close">' + UI.ic('check') + ' تم — إغلاق</button>');
    var b;
    if ((b = document.getElementById('bk-pos-print'))) b.addEventListener('click', function () {
      try {
        var V = root.HRCVoucher;
        if (V && V.printForm) V.printForm(app, at);
      } catch (e) { UI.toast('err', 'تعذّرت الطباعة', 'حاول مرة أخرى'); }
    });
    if ((b = document.getElementById('bk-pos-close'))) b.addEventListener('click', close);
  }

  /* ======================= 1د) صفحة صاحب العمل =======================
   * تفتح بالباركود وحده (قرار الإدارة) — بلا رموز الفرص (سرّ الزبون).
   * ================================================================== */
  function renderEmployer(host) {
    var c = (emp && emp.card) || {};
    var a = c.applied;
    var empBox = a && a.employer ? (
      '<div style="border:1px solid var(--gold-2);border-radius:12px;background:var(--paper-2);padding:12px 14px;margin-top:10px">' +
        '<b class="tiny" style="color:var(--gold-3)">' + UI.ic('building') + ' بيانات التواصل بصاحب العمل</b>' +
        '<div class="tiny" style="margin-top:6px;line-height:2">الاسم: <b>' + esc(a.employer.name || '—') + '</b>' +
        ' · الهاتف: <b dir="ltr">' + esc(a.employer.phone || '—') + '</b><br>' +
        'العنوان: <b>' + esc(a.employer.address || '—') + '</b><br>' +
        'مكان المقابلة: <b>' + esc(a.employer.interviewLocation || '—') + '</b></div></div>') : '';
    host.innerHTML = stepHead('صاحب العمل — تعريف المتقدم',
        'بيانات المتقدم والوظيفة المطلوبة على هذه البطاقة، وطلبك يُسجَّل لدى الشركة ويحسمه موظفوها.', 'briefcase') +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin:4px 0 6px">' +
        '<b dir="ltr">' + esc(c.serial || serial) + '</b>' + cardStatusBadge(c.status) +
        (c.chancesLeft != null ? '<span class="tiny muted">الفرص المتاحة: <b>' + esc(c.chancesLeft) + '</b></span>' : '') +
      '</div>' +
      (c.fullName ? '<div class="tiny muted">الاسم: <b>' + esc(c.fullName) + '</b>' +
        (c.phone ? ' · الهاتف: <b dir="ltr">' + esc(c.phone) + '</b>' : '') + '</div>' +
        (c.address ? '<div class="tiny muted">العنوان: <b>' + esc(c.address) + '</b></div>' : '') +
        ((c.gender || c.dob) ? '<div class="tiny muted">' + esc(c.gender || '—') +
          (c.dob ? ' · مولود: <b>' + esc(Store.fmtDate(c.dob)) + '</b>' : '') + '</div>' : '') +
        (c.posName ? '<div class="tiny muted">نقطة البيع: <b>' + esc(c.posName) + '</b></div>' : '')
        : '') +
      '<h5 style="margin:14px 0 4px">التقديم الجاري</h5>' +
      (a
        ? '<div class="bk-jobstrip" style="border:1px solid var(--line-soft);border-radius:12px;padding:12px 14px">' +
            '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center">' +
              '<div><b>' + esc(a.jobTitle) + '</b> <span class="mono tiny" dir="ltr">(' + esc(a.jobCode) + ')</span>' +
              (a.region ? '<div class="tiny muted">' + esc(a.region) + '</div>' : '') + '</div>' +
              slotBadge(a.slotStatus) + '</div>' +
            '<div class="tiny muted" style="margin-top:8px">تاريخ التقديم: <b>' + esc(Store.fmtDateTime(a.appliedAt)) + '</b>' +
              (a.holdExpiresAt ? ' · ينتهي الحجز: <b>' + esc(Store.fmtDateTime(a.holdExpiresAt)) + '</b>' : '') + '</div>' + empBox +
          '</div>' +
          (a.employerDecision === 'reject'
            ? infoBox('alert', '<b>سجّلتَ عدم التوظيف — الوظيفة «حرجة / معلّقة» بيد الشركة.</b> ' +
                'بتاريخ ' + esc(Store.fmtDateTime(a.decisionAt)) +
                (a.reason ? ' — السبب المسجَّل: <b>' + esc(a.reason) + '</b>' : '') +
                ' — تُرجعها الشركة متاحة أو تُحذف، والفرصة تُستهلك بأي نتيجة.',
                'border-color:#d33;background:#fdeeee')
            : a.employerDecision === 'hire'
            ? infoBox('hourglass', '<b>طلبك مسجَّل — الوظيفة «جاري التوظيف» بانتظار تثبيت الشركة.</b> ' +
                'طلبتَ التوظيف بتاريخ ' + esc(Store.fmtDateTime(a.decisionAt)) +
                ' — يثبّته موظفو الشركة أو يلغونه، ثم يتواصلون معك ومع المتقدم.',
                'border-color:#4a6fa5;background:#eef2fa')
            : a.slotStatus === 'hiring'
            ? infoBox('hourglass', '<b>طلبك مسجَّل — الوظيفة «جاري التوظيف» بانتظار تثبيت الشركة.</b>',
                'border-color:#4a6fa5;background:#eef2fa')
            : a.slotStatus === 'critical'
            ? infoBox('clock', 'انتهت مهلة الحجز (24 ساعة) — القرار الآن بيد الشركة: توظيف أو إرجاع الوظيفة أو حذفها.', 'border-color:#d33;background:#fdeeee')
            : infoBox('clock', 'بعد انتهاء مهلة 24 ساعة من التقديم دون قرار، تنتقل الوظيفة لحالة حرجة وتقرر الشركة.', ''))
        : (c.succeeded
            ? infoBox('check', '<b>تم توظيف هذا المتقدم بإحدى فرصتي بطاقته</b> — لا يوجد تقديم جارٍ حالياً.', 'border-color:#3ec1a0;background:#eefaf7')
            : infoBox('alert', '<b>لا يوجد تقديم جارٍ على هذه البطاقة حالياً</b> — إن كان المتقدم بين يديك ليعرض نفسه، فغيّر ذلك عبر الشركة.', ''))) +
      (a && !a.employerDecision && a.slotStatus !== 'hiring'
        ? btnRow(
            '<button class="btn btn-gold" id="bk-emp-hire">' + UI.ic('check') + ' تم التوظيف</button>' +
            '<button class="btn btn-danger" id="bk-emp-reject">' + UI.ic('x') + ' لم يتم التوظيف</button>' +
            '<button class="btn btn-ghost" id="bk-emp-back">' + UI.ic('arrow-right') + ' رجوع</button>')
        : btnRow('<button class="btn btn-ghost" id="bk-emp-back">' + UI.ic('arrow-right') + ' رجوع</button>'));
    var b;
    if ((b = document.getElementById('bk-emp-hire'))) b.addEventListener('click', function () { doDecide('hire'); });
    if ((b = document.getElementById('bk-emp-reject'))) b.addEventListener('click', function () { doDecide('reject'); });
    if ((b = document.getElementById('bk-emp-back'))) b.addEventListener('click', function () {
      /* جاء من رابط «صاحب العمل؟» مباشرة: لا بوابة سابقة — يُغلق النافذة */
      if (directEmployer) { directEmployer = false; close(); return; }
      view = 'gate'; render();
    });
  }

  function doDecide(decision) {
    if (busy) return;
    if (decision === 'reject') { askRejectReason(); return; }
    UI.confirm({
      title: 'تسجيل طلب توظيف',
      message: 'هل توظّفت هذا المتقدم فعلاً على الوظيفة المطلوبة؟ يُسجَّل طلبك وتتحول الوظيفة إلى «جاري التوظيف» حتى يثبّته موظفو الشركة.',
      note: 'القرار النهائي (التثبيت أو الإلغاء) بيد موظفي الشركة — قد يتواصلون معك للتثبيت.',
      confirmText: 'نعم — سجّل طلب التوظيف',
      danger: false
    }).then(function (yes) {
      if (!yes) return;
      submitDecision('hire', '');
    });
  }

  /* رفض التوظيف بسبب مكتوب (إلزامي): يُحفظ السبب مع القرار، وتنتقل الوظيفة
     والفرصة إلى «حرجة / معلّقة» ليقرر موظف الشركة: إرجاعها متاحة أو حذفها. */
  function askRejectReason() {
    UI.modal({
      title: 'لم يتم التوظيف — اكتب السبب',
      subtitle: 'السبب إلزامي: يُحفظ مع قرارك ويقرأه موظف الشركة قبل أن يقرر مصير الوظيفة.',
      body: '<label class="tiny" for="bk-reason" style="font-weight:700">سبب عدم التوظيف</label>' +
        '<textarea id="bk-reason" rows="3" maxlength="300" placeholder="مثال: العدد مكتمل / لا تناسب المهارات المطلوبة / تأخّر عن المقابلة" ' +
          'style="width:100%;margin-top:6px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit;resize:vertical"></textarea>' +
        '<div id="bk-reason-err" style="display:none;margin-top:8px;color:#b3342f;font-size:12.5px"></div>' +
        '<div class="bk-info" style="margin-top:10px">' + UI.ic('hourglass') +
          ' بعد تسجيل الرفض تصبح الوظيفة <b>«حرجة — معلّقة»</b> بيد الشركة: تُرجعها متاحة أو تُحذف — والفرصة تُستهلك بأي نتيجة.</div>',
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-danger" id="bk-reason-ok">' + UI.ic('x') + ' تسجيل عدم التوظيف</button>',
      onMount: function (box, close) {
        var ta = box.querySelector('#bk-reason');
        var err = box.querySelector('#bk-reason-err');
        function fail(msg) {
          if (err) { err.textContent = msg; err.style.display = 'block'; }
          if (ta) ta.focus();
        }
        box.querySelector('#bk-reason-ok').addEventListener('click', function () {
          var v = String(ta && ta.value || '').trim();
          if (v.length < 3) { fail('اكتب سبباً واضحاً — ٣ أحرف على الأقل.'); return; }
          if (ta) ta.removeEventListener('input', onInput);
          close();
          submitDecision('reject', v);
        });
        function onInput() { if (err) err.style.display = 'none'; }
        if (ta) ta.addEventListener('input', onInput);
        setTimeout(function () { try { if (ta) ta.focus(); } catch (e) { } }, 60);
      }
    });
  }

  function submitDecision(decision, reason) {
    if (busy) return;
    busy = true;
    render();
    Promise.resolve(Store.cardEmployerDecide(serial, decision, reason)).then(function (r) {
      busy = false;
      if (!r || !r.ok) { UI.toast('err', 'تعذّر التسجيل', (r && r.error) || 'حاول مرة أخرى'); render(); return; }
      empDone = { decision: decision, attempt: r.attempt, job: r.job, reason: (r && r.reason) || reason || '' };
      view = 'empdone'; render();
    }).catch(function () {
      busy = false; UI.toast('err', 'تعذّر الاتصال', 'حاول مرة أخرى'); render();
    });
  }

  function renderEmpDone(host) {
    var d = empDone || {}, hire = d.decision === 'hire';
    var at = d.attempt || {};
    host.innerHTML =
      '<div class="bk-success" style="text-align:center;padding:8px 4px 2px">' +
        '<div style="width:74px;height:74px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;' +
          (hire
            ? 'background:linear-gradient(135deg,#3ec1a0,#1f8f96);color:#fff;box-shadow:0 14px 34px rgba(31,143,150,.35)'
            : 'background:linear-gradient(135deg,#4a6fa5,#2f4e7d);color:#fff;box-shadow:0 14px 34px rgba(47,78,125,.3)') + '">' + UI.ic(hire ? 'check' : 'x') + '</div>' +
        '<h4 style="margin:0 0 6px">' + (hire ? 'سُجّل طلب التوظيف ✅' : 'سُجّل رفض التوظيف') + '</h4>' +
        '<p class="muted small" style="margin:0 auto 10px;max-width:50ch">' + (hire
          ? 'طلبك على الوظيفة <b>' + esc(at.jobTitle || '') + '</b> مسجَّل — الوظيفة الآن <b>«جاري التوظيف»</b> بانتظار تثبيت موظفي الشركة، ثم يُبلَّغ المتقدم.'
          : 'طلبك على الوظيفة <b>' + esc(at.jobTitle || '') + '</b> مسجَّل — الوظيفة الآن <b>«حرجة — معلّقة»</b> بيد الشركة: تُرجعها متاحة أو تُحذف.' +
            (d.reason ? '<br>السبب المسجَّل: <b>' + esc(d.reason) + '</b>' : '')) + '</p>' +
        '<div class="bk-info" style="text-align:right">' + UI.ic('phone') +
          ' لأي استفسار خابر الشركة: <b dir="ltr">' + esc(CFG.company.phones[0]) + '</b></div>' +
      '</div>' +
      btnRow('<button class="btn btn-ghost" id="bk-empd-close">' + UI.ic('check') + ' تم — إغلاق</button>');
    var b;
    if ((b = document.getElementById('bk-empd-close'))) b.addEventListener('click', close);
  }

  /* ======================= 2) حالة البطاقة ======================= */
  function chanceRow(c, no) {
    var left = '';
    if (c.slotStatus === 'empty') {
      left = '<span class="tiny muted">متاحة للاستخدام</span>';
    } else {
      left = '<b>' + esc(c.jobTitle || '—') + '</b>' +
        '<span class="tiny muted">' + esc(c.jobCode || '') + (c.location ? ' · ' + esc(c.location) : '') + '</span>';
    }
    return '<div class="bk-jobstrip" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line-soft);border-radius:10px;margin-top:8px">' +
      '<div style="min-width:0"><b class="tiny" style="color:var(--gold-3)">الفرصة ' + (no === 1 ? '١' : no) + '</b><div style="margin-top:2px">' + left + '</div></div>' +
      slotBadge(c.slotStatus) + '</div>';
  }

  function renderStatus(host) {
    var canUse = card.status === 'active' && Number(card.chancesLeft) > 0;
    host.innerHTML = stepHead('حالة البطاقة', 'الفرصتان وحالة كل فرصة على حدة — والتواريخ محسوبة لحظياً.', 'list') +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin:4px 0 6px">' +
        '<b dir="ltr">' + esc(card.serial) + '</b>' + cardStatusBadge(card.status) +
        (card.succeeded ? '<span class="chip chip-ok tiny">' + UI.ic('check') + ' تم توظيف بإحدى الفرصتين</span>' : '') +
      '</div>' +
      '<div class="tiny muted">الاسم: <b>' + esc(card.fullName) + '</b> · الهاتف: <b dir="ltr">' + esc(card.phone) + '</b></div>' +
      '<div class="tiny muted">تنتهي الصلاحية: <b>' + esc(Store.fmtDate(card.expiryDate)) + '</b>' +
        ' · الفرص المتاحة: <b>' + esc(card.chancesLeft) + '</b></div>' +
      (card.chances || []).map(function (c, i) { return chanceRow(c, i + 1); }).join('') +
      '<div class="bk-info" style="margin-top:12px">' + UI.ic('clock') +
        ' عند التقديم تُحجز الوظيفة لك <b>24 ساعة</b> بانتظار نتيجة المقابلة؛ وبعدها تقرر الشركة: التوظيف أو إرجاع الوظيفة أو حذفها — والفرصة تُستهلك بالتقديم ولا تعود.</div>' +
      btnRow(
        (canUse ? '<button class="btn btn-gold" id="bk-use">' + UI.ic('briefcase') + ' استخدم فرصة على وظيفة</button>' : '') +
        '<button class="btn btn-lapis" id="bk-reprint">' + UI.ic('print') + ' إعادة الطباعة (البطاقة أو الاستمارة)</button>' +
        '<button class="btn btn-outline" id="bk-emp-open">' + UI.ic('briefcase') + ' أنا صاحب العمل</button>' +
        '<button class="btn btn-ghost" id="bk-back">' + UI.ic('arrow-right') + ' بطاقة أخرى</button>');
    var b;
    if ((b = document.getElementById('bk-use'))) b.addEventListener('click', function () {
      if (card.usesCardPrintCode) { location.assign('apply.html?form=' + encodeURIComponent(serial)); return; }
      view = 'use'; render();
    });
    if ((b = document.getElementById('bk-reprint'))) b.addEventListener('click', function () { view = 'reprint'; render(); });
    if ((b = document.getElementById('bk-emp-open'))) b.addEventListener('click', employerRoute);
    if ((b = document.getElementById('bk-back'))) b.addEventListener('click', function () { card = null; serial = ''; view = 'entry'; render(); });
  }

  /* ======================= 3) استخدام فرصة ======================= */
  function renderUse(host) {
    var jobs = availableJobs();
    var inner;
    if (!jobs.length) {
      inner = '<div class="bk-empty">' + UI.ic('briefcase') +
        '<b>لا توجد وظائف متاحة حالياً</b>' +
        '<span class="tiny muted">تابع لوحة الوظائف بالموقع — الحالة تُحدَّث لحظياً، أو خابر الشركة.</span></div>';
    } else {
      inner = fieldHtml('job', 'الوظيفة المراد التقديم عليها',
          selectHtml('job', jobs.map(function (j) {
            return { v: j.code, t: j.code + ' — ' + j.title + ' (' + j.region + ')' };
          }), '', 'اختر وظيفة من المتاحة…'),
          'الوظائف المحجوزة والمغلقة لا تظهر هنا.') +
        fieldHtml('code', 'رمز الفرصة (من ظهر بطاقتك)',
          inputHtml('code', 'text', 'مثال: 7429-KQ', '', 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700;letter-spacing:.08em" inputmode="latin"'),
          'انسخ رمز الفرصة التي تريد استخدامها كما هو مطبوع تماماً.');
    }
    host.innerHTML = stepHead('استخدام فرصة', 'اختر الوظيفة وأدخل رمز الفرصة من ظهر بطاقتك لتثبيت التقديم.', 'briefcase') + inner +
      (jobs.length ? btnRow(
        '<button class="btn btn-gold" id="bk-confirm">' + UI.ic('check') + ' تثبيت التقديم</button>' +
        '<button class="btn btn-ghost" id="bk-cancel">' + UI.ic('arrow-right') + ' رجوع</button>') : btnRow(
        '<button class="btn btn-ghost" id="bk-cancel">' + UI.ic('arrow-right') + ' رجوع</button>'));
    var b;
    var jobSel = document.getElementById('bk-job');
    var codeInp = document.getElementById('bk-code');
    if (jobSel) jobSel.addEventListener('change', function () { setErr('job', ''); });
    if (codeInp) {
      codeInp.addEventListener('input', function () { setErr('code', ''); });
      codeInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doUse(); });
    }
    if ((b = document.getElementById('bk-confirm'))) b.addEventListener('click', doUse);
    if ((b = document.getElementById('bk-cancel'))) b.addEventListener('click', function () { view = 'status'; render(); });
  }

  function doUse() {
    var jobSel = document.getElementById('bk-job');
    var codeInp = document.getElementById('bk-code');
    var jobCode = jobSel ? jobSel.value : '';
    var code = String(codeInp ? codeInp.value : '').trim().toUpperCase();
    var bad = false;
    if (!jobCode) bad = setErr('job', 'اختر الوظيفة التي تريد التقديم عليها.') || bad;
    if (!/^\d{4}-[A-Z]{2}$/.test(code)) bad = setErr('code', 'الرمز بصيغة 4 أرقام وشرطة وحرفين — مثل 7429-KQ.') || bad;
    if (bad || busy) return;
    busy = true;
    var btn = document.getElementById('bk-confirm');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التثبيت…'; }
    Promise.resolve(Store.cardUseChance(serial, code, jobCode)).then(function (r) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('check') + ' تثبيت التقديم'; }
      if (!r || !r.ok) {
        var msg = (r && r.error) || 'تعذّر تنفيذ التقديم';
        if (/رمز الفرصة/.test(msg)) setErr('code', msg);
        else if (/الوظيفة/.test(msg)) setErr('job', msg);
        else setErr('code', msg);
        return;
      }
      var att = r.attempt || (r.data && r.data.attempt) || null;
      var job = r.job || (r.data && r.data.job) || null;
      doneInfo = {
        jobCode: (job && job.code) || jobCode,
        jobTitle: (job && job.title) || (att && att.jobTitle) || '',
        no: att ? att.no : '—',
        holdExpiresAt: att ? att.holdExpiresAt : null
      };
      view = 'done';
      render();
    }).catch(function (e) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('check') + ' تثبيت التقديم'; }
      setErr('code', 'تعذّر الاتصال — حاول مرة أخرى.');
    });
  }

  /* ======================= 4) إعادة الطباعة ======================= */
  function renderReprint(host) {
    host.innerHTML = stepHead('إعادة طباعة البطاقة', 'أدخل رمز التحقق من ظهر البطاقة لإعادة الطباعة.', 'print') +
      fieldHtml('rcode', 'رمز التحقق (من ظهر البطاقة)',
        inputHtml('rcode', 'text', 'مثال: 7A2C-9E4B-1D8F-6C03', '', 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700;letter-spacing:.08em" inputmode="latin"'),
        'البطاقات القديمة: يُقبل أحد رمزي الفرص المطبوعين عليها.') +
      '<div class="bk-info">' + UI.ic('alert') +
        ' <b>البطاقة:</b> صفحتان بحجم البطاقة المصرفية (86×54مم) — ورق مقوى 300–350غم + تغليف حراري وخيار «الحجم الفعلي» دون تحجيم.<br>' +
        UI.ic('file') + ' <b>استمارة التوظيف A4:</b> تحمل بياناتك وبيانات الوظيفة وصاحب العمل — تُسلَّم لصاحب العمل عند المقابلة.</div>' +
      btnRow(
        '<button class="btn btn-gold" id="bk-print">' + UI.ic('print') + ' تحقق واطبع البطاقة</button>' +
        '<button class="btn btn-lapis" id="bk-print-form">' + UI.ic('file') + ' تحقق واطبع استمارة A4</button>' +
        '<button class="btn btn-ghost" id="bk-cancel">' + UI.ic('arrow-right') + ' رجوع</button>');
    var b;
    var inp = document.getElementById('bk-rcode');
    if (inp) {
      inp.addEventListener('input', function () { setErr('rcode', ''); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doReprint(); });
      setTimeout(function () { try { inp.focus(); } catch (e) { } }, 60);
    }
    if ((b = document.getElementById('bk-print'))) b.addEventListener('click', function () { doReprint('card'); });
    if ((b = document.getElementById('bk-print-form'))) b.addEventListener('click', function () { doReprint('form'); });
    if ((b = document.getElementById('bk-cancel'))) b.addEventListener('click', function () { view = 'status'; render(); });
  }

  function doReprint(mode) {
    var inp = document.getElementById('bk-rcode');
    var code = String(inp ? inp.value : '').trim().toUpperCase();
    if (!/^(?:[A-F0-9]{16}|[0-9]{4}[A-Z]{2})$/.test(code.replace(/[^A-Z0-9]/g, ''))) {
      setErr('rcode', 'أدخل رمز التحقق كاملاً؛ يُقبل أيضاً رمز فرصة من بطاقة قديمة.');
      return;
    }
    if (busy) return;
    busy = true;
    var btn = document.getElementById('bk-print');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التحقق…'; }
    Promise.resolve(Store.cardVerify(serial, code)).then(function (r) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('print') + ' تحقق واطبع'; }
      if (!r || !r.ok) {
        setErr('rcode', (r && r.error) || 'رمز التحقق غير صحيح.');
        return;
      }
      var V = root.HRCVoucher;
      if (mode === 'form') {
        if (!V || !V.printForm) { setErr('rcode', 'قالب طباعة الاستمارة غير متوفر بهذه الصفحة.'); return; }
        try { V.printForm(r.app, null, r.attempts); } catch (e) {
          setErr('rcode', 'تعذّر فتح الطباعة — حاول مرة أخرى.');
        }
      } else {
        if (!V || !V.print) { setErr('rcode', 'قالب الطباعة غير متوفر بهذه الصفحة.'); return; }
        try { V.print(r.app, { attempts: r.attempts, verifiedReprint: true }); } catch (e) {
          setErr('rcode', 'تعذّر فتح الطباعة — حاول مرة أخرى.');
        }
      }
    }).catch(function (e) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('print') + ' تحقق واطبع'; }
      setErr('rcode', 'تعذّر الاتصال — حاول مرة أخرى.');
    });
  }

  /* ======================= 5) شاشة النجاح ======================= */
  function renderDone(host) {
    var d = doneInfo || {};
    host.innerHTML =
      '<div class="bk-success" style="text-align:center;padding:8px 4px 2px">' +
        '<div style="width:74px;height:74px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#3ec1a0,#1f8f96);color:#fff;box-shadow:0 14px 34px rgba(31,143,150,.35)">' + UI.ic('check') + '</div>' +
        '<h4 style="margin:0 0 6px">تم تثبيت تقديمك ✅</h4>' +
        '<p class="muted small" style="margin:0 auto 10px;max-width:46ch">سُجّل التقديم بالفرصة <b>' + esc(d.no) + '</b> على الوظيفة ' +
          '<b>' + esc(d.jobTitle || '') + '</b> <span class="mono" dir="ltr">(' + esc(d.jobCode || '') + ')</span></p>' +
        '<div class="bk-info" style="text-align:right">' + UI.ic('clock') +
          ' الوظيفة محجوزة لك <b>24 ساعة</b>' +
          (d.holdExpiresAt ? ' حتى <b>' + esc(Store.fmtDateTime(d.holdExpiresAt)) + '</b>' : '') +
          ' بانتظار نتيجة المقابلة — تابعها من بطاقتك هنا أو عند نقطة البيع.</div>' +
        '<div class="bk-info" style="text-align:right">' + UI.ic('alert') +
          ' تذكير: الفرصة تُستهلك بالتقديم ولا تعود بأي نتيجة — وبعد الفرصتين تُشترى بطاقة جديدة من نقاط البيع.</div>' +
      '</div>' +
      btnRow(
        '<button class="btn btn-lapis" id="bk-reprint2">' + UI.ic('print') + ' اطبع بطاقتك المحدّثة</button>' +
        '<button class="btn btn-gold" id="bk-done">' + UI.ic('check') + ' تم — إغلاق</button>');
    var b;
    if ((b = document.getElementById('bk-reprint2'))) b.addEventListener('click', function () { view = 'reprint'; render(); });
    if ((b = document.getElementById('bk-done'))) b.addEventListener('click', close);
  }

  /* ======================= العرض والفتح ======================= */
  function render() {
    var host = document.getElementById('bk-wrap');
    if (!host || !m) return;
    if (view === 'routewait') renderRouteWait(host);
    else if (view === 'gate') renderGate(host);
    else if (view === 'employer') renderEmployer(host);
    else if (view === 'empdone') renderEmpDone(host);
    else if (view === 'posfill') renderPosFill(host);
    else if (view === 'posreview') renderPosReview(host);
    else if (view === 'posdone') renderPosDone(host);
    else if (view === 'entry') renderEntry(host);
    else if (view === 'status') renderStatus(host);
    else if (view === 'use') renderUse(host);
    else if (view === 'reprint') renderReprint(host);
    else renderDone(host);
  }

  function open(opts) {
    opts = opts || {};
    if (m) { try { m.close(); } catch (e) { } m = null; }
    card = null; doneInfo = null; busy = false;
    directEmployer = false;
    emp = null; posResult = null; empDone = null; routeErr = ''; posDraft = null; posStep = 1; jobF = { q: '', region: '', shift: '' }; posErr = '';
    view = 'entry';
    serial = String(opts.serial || '').trim().toUpperCase();
    m = UI.modal({
      title: 'بطاقتي — بطاقة التوظيف',
      subtitle: 'تابع بطاقتك · استخدم فرصتك · أعد طباعتها من أي مكتب استنساخ',
      body: '<div class="bk-wrap" id="bk-wrap"></div>',
      footer: '<span></span>'
    });
    if (!m) return;
    m.root.classList.add('modal-booking');
    /* رابط «صاحب العمل؟ متابعة طلب توظيف» (role=employer) يفتح صفحة صاحب
       العمل مباشرة — بلا بوابة دور وبلا أي رمز (قرار الإدارة 2026-10-06). */
    if (serial && serialPattern(serial) && opts.asEmployer) employerRoute(true);
    else if (serial && serialPattern(serial) && opts.fromHash) routeFromHash();
    else render();
  }

  function close() {
    if (m) { try { m.close(); } catch (e) { } m = null; }
    card = null; doneInfo = null; emp = null; posResult = null; empDone = null; routeErr = ''; posDraft = null; posStep = 1; jobF = { q: '', region: '', shift: '' }; posErr = '';
    view = 'entry';
  }

  /* روابط QR القديمة كانت تفتح #card=... على الصفحة العامة؛ حوّلها
     للرحلة الجديدة حتى تصل البطاقات المطبوعة سابقاً إلى صفحة الترحيب أيضاً. */
  function openFromHash() {
    if (!location || !location.hash) return;
    var mt = /#card=([A-Za-z0-9-]+)/.exec(location.hash);
    if (!mt) return;
    var s = decodeURIComponent(mt[1]).trim().toUpperCase();
    if (!serialPattern(s)) return;
    var role = new URLSearchParams(location.search).get('role');
    if (role === 'employer' || role === 'pos') {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
      open({ serial: s, fromHash: true, asEmployer: role === 'employer' });
      return;
    }
    location.replace('apply.html?form=' + encodeURIComponent(s));
  }

  /* التقاط أزرار «بطاقتي» بكل الصفحة (نفس نقاط الاحجز السابقة) */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-action="open-booking"]') : null;
    if (!t) return;
    e.preventDefault();
    open({ serial: t.getAttribute('data-serial') || '' });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openFromHash);
  else openFromHash();

  root.HRCBooking = {
    open: open,
    close: close,
    /* الحالة الحالية للنافذة — للاختبارات والتشخيص */
    state: function () {
      return {
        view: view, serial: serial, posStep: posStep,
        card: card ? JSON.parse(JSON.stringify(card)) : null,
        emp: emp ? JSON.parse(JSON.stringify(emp)) : null
      };
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.HRCBooking;
})(typeof window !== 'undefined' ? window : globalThis);
