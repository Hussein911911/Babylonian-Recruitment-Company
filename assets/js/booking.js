/* ===========================================================================
 *  HRC — نافذة «بطاقتي» (بطاقة التوظيف) — واجهة الزبون العامة
 *  ---------------------------------------------------------------------------
 *  نظام بطاقة التوظيف (2026-09-30): التقديم على الوظائف يتم ببطاقة تُشترى
 *  كاشاً من نقاط البيع (مكاتب الاستنساخ) — لا دفع إلكتروني نهائياً (أُلغيت
 *  فيزا/ماستر كارد مع الاستمارة القديمة بخطواتها وبيانات بطاقتها).
 *
 *  هذه النافذة تفتح من أي زر «بطاقتي» (data-action="open-booking") أو بمسح
 *  باركود QR المطبوع على البطاقة (رابط ‎#card=HRC-BC-######) وتتيح:
 *    1) عرض حالة البطاقة: الفرصتان ووظيفته الحالية وتواريخ الصلاحية
 *    2) استخدام فرصة على وظيفة متاحة: الباركود + رمز الفرصة + اختيار الوظيفة
 *    3) إعادة طباعة البطاقة (86×54مم) من أي مكتب استنساخ — بإثبات الحيازة
 *
 *  ⚠️ أمان: عرض البطاقة يحتاج الباركود فقط (بيانات مقنّعة)، أما استهلاك فرصة
 *  أو إعادة الطباعة فيتطلب **رمز الفرصة** السري المطبوع على ظهر الورقة —
 *  فمن يملك الورقة يملك البطاقة (نموذج الحيازة المعتمد من الإدارة).
 * =========================================================================== */
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

  /* ======================= أدوات ======================= */
  function esc(v) { return UI.esc(String(v == null ? '' : v)); }

  function availableJobs() {
    try {
      return (Store.listJobs() || []).filter(function (j) { return j.status === 'available'; });
    } catch (e) { return []; }
  }

  function serialPattern(v) {
    return /^HRC-BC-\d{4,8}$/i.test(String(v || '').trim());
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

  function fieldHtml(id, label, inner, hint) {
    return '<div class="bk-field" data-bk-field="' + id + '">' +
      '<label for="bk-' + id + '">' + esc(label) + ' <span class="bk-req">*</span></label>' +
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
      fieldHtml('serial', 'باركود البطاقة (HRC-BC-…)',
        inputHtml('serial', 'text', 'مثال: HRC-BC-000123', serial, 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700;letter-spacing:.04em" inputmode="latin"'),
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
      setErr('serial', 'اكتب الباركود بصيغته الصحيحة — يبدأ بـ HRC-BC- يليه الرقم.');
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
  function employerRoute() {
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
    var jobs = availableJobs();
    var posNames = [];
    try { posNames = Store.listPosNames() || []; } catch (e) { posNames = []; }
    var posList = '<datalist id="bk-posnames">' +
      posNames.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>';
    var jobSel = jobs.length
      ? fieldHtml('job', 'الوظيفة التي يقدم عليها الزبون <span class="chip chip-warn tiny">إلزامي</span>',
          selectHtml('job', jobs.map(function (j) {
            return { v: j.code, t: j.code + ' — ' + j.title + ' (' + j.region + ')' };
          }), '', 'اختر وظيفة من المتاحة…'),
          'اختيار الوظيفة يستهلك الفرصة الأولى بحجز 24 ساعة بانتظار قرار صاحب العمل.')
      : infoBox('alert', '<b>لا توجد وظائف متاحة حالياً</b> — يمكن تفعيل البطاقة الآن واختيار الوظيفة لاحقاً من «بطاقتي» برمز الفرصة.');
    host.innerHTML = stepHead('بيع البطاقة — استمارة الزبون',
        'امسحتَ باركود بطاقة فارغة: عبّي بيانات الزبون واختر الوظيفة، ثم اطبع استمارة التوظيف A4 بنفس الباركود.', 'card') +
      '<div class="bk-info">' + UI.ic('alert') +
        ' <b>لنقطة البيع فقط:</b> هذه الشاشة تظهر لأن البطاقة لم تُبع بعد. بيع البطاقات كاش فقط ' +
        '(لا ماستر كارد / فيزا) — السعر حسب تعرفة الشركة.</div>' +
      posList +
      fieldHtml('posName', 'اسم نقطة البيع <span class="chip chip-warn tiny">إلزامي</span>',
        inputHtml('posName', 'text', 'مثال: مكتب النور للاستنساخ', '', 'list="bk-posnames"'),
        'يُطبع على استمارة الزبون ويُسجَّل بسجل الشركة.') +
      fieldHtml('fullName', 'الاسم الكامل للزبون <span class="chip chip-warn tiny">إلزامي</span>',
        inputHtml('fullName', 'text', 'الاسم الرباعي', '')) +
      fieldHtml('phone', 'رقم هاتف الزبون <span class="chip chip-warn tiny">إلزامي</span>',
        inputHtml('phone', 'tel', '07XXXXXXXXX', '', 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700" inputmode="tel"')) +
      fieldHtml('address', 'العنوان (اختياري)',
        inputHtml('address', 'text', 'المحافظة — القضاء — المحلة', '')) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px">' +
        fieldHtml('gender', 'الجنس',
          selectHtml('gender', [{ v: 'ذكر', t: 'ذكر' }, { v: 'أنثى', t: 'أنثى' }], 'ذكر')) +
        fieldHtml('dob', 'تاريخ الميلاد (اختياري)',
          inputHtml('dob', 'date', '', '', 'dir="ltr" style="direction:ltr"')) +
      '</div>' +
      jobSel +
      btnRow(
        '<button class="btn btn-gold" id="bk-pos-confirm">' + UI.ic('check') + ' إتمام البيع وتعبئة البطاقة</button>' +
        '<button class="btn btn-ghost" id="bk-pos-cancel">' + UI.ic('arrow-right') + ' إلغاء</button>');
    var b;
    var ids = ['posName', 'fullName', 'phone', 'address', 'gender', 'dob', 'job'];
    ids.forEach(function (id) {
      var el = document.getElementById('bk-' + id);
      if (el) el.addEventListener('input', function () { setErr(id, ''); });
      if (el) el.addEventListener('change', function () { setErr(id, ''); });
    });
    if ((b = document.getElementById('bk-pos-confirm'))) b.addEventListener('click', doPosFill);
    if ((b = document.getElementById('bk-pos-cancel'))) b.addEventListener('click', close);
    setTimeout(function () { try { var f = document.getElementById('bk-posName'); if (f) f.focus(); } catch (e) { } }, 60);
  }

  function doPosFill() {
    var g = function (id) { var el = document.getElementById('bk-' + id); return el ? String(el.value || '').trim() : ''; };
    var fullName = g('fullName'), phone = g('phone'), posName = g('posName');
    var jobCode = g('job');
    if (!posName) { setErr('posName', 'اسم نقطة البيع مطلوب — كما هو معتمد لدى الشركة.'); return; }
    if (!fullName) { setErr('fullName', 'اسم الزبون مطلوب.'); return; }
    if (!phone) { setErr('phone', 'هاتف الزبون مطلوب.'); return; }
    if (!jobCode) { setErr('job', 'اختيار الوظيفة إلزامي — إن لم توجد وظائف متاحة لا يمكن إتمام البيع من هنا.'); return; }
    if (busy) return;
    busy = true;
    var btn = document.getElementById('bk-pos-confirm');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التسجيل…'; }
    Promise.resolve(Store.cardActivate(serial, {
      posName: posName, fullName: fullName, phone: phone,
      address: g('address'), gender: g('gender'), dob: g('dob'), jobCode: jobCode
    })).then(function (r) {
      busy = false;
      if (!r || !r.ok) {
        if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('check') + ' إتمام البيع وتعبئة البطاقة'; }
        UI.toast('err', 'تعذّر إتمام البيع', (r && r.error) || 'حاول مرة أخرى');
        return;
      }
      posResult = r;
      view = 'posdone'; render();
      /* طباعة استمارة A4 جزء من عملية البيع — تفتح تلقائياً مع زر إعادة */
      setTimeout(function () {
        try {
          var V = root.HRCVoucher;
          if (V && V.printForm) V.printForm(r.app, r.attempt);
        } catch (e) { }
      }, 450);
    }).catch(function () {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('check') + ' إتمام البيع وتعبئة البطاقة'; }
      UI.toast('err', 'تعذّر الاتصال', 'حاول مرة أخرى');
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
          (at.holdExpiresAt ? ' حتى <b>' + esc(Store.fmtDateTime(at.holdExpiresAt)) + '</b>' : '') + '.</div>' : '') +
        '<div class="bk-info" style="text-align:right;border-color:#c8a24a;background:#fdf9ee">' + UI.ic('print') +
          ' <b>الآن: اطبع استمارة التوظيف A4</b> وسلّمها للزبون مع البطاقة — تحمل نفس الباركود ' +
          'وبيانات الزبون والوظيفة وبيانات التواصل بصاحب العمل.</div>' +
      '</div>' +
      btnRow(
        '<button class="btn btn-gold" id="bk-pos-print">' + UI.ic('print') + ' اطبع استمارة التوظيف A4</button>' +
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
        'بيانات المتقدم والوظيفة المطلوبة على هذه البطاقة، وقرارك يُسجَّل فوراً لدى الشركة.', 'briefcase') +
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
              ' · ينتهي الحجز: <b>' + esc(Store.fmtDateTime(a.holdExpiresAt)) + '</b></div>' + empBox +
          '</div>' +
          (a.slotStatus === 'critical'
            ? infoBox('clock', 'انتهت مهلة الحجز (24 ساعة) — القرار الآن بيد الشركة: توظيف أو إرجاع الوظيفة.', 'border-color:#d33;background:#fdeeee')
            : infoBox('clock', 'بعد انتهاء مهلة 24 ساعة من التقديم دون قرار، تنتقل الوظيفة لحالة حرجة وتقرر الشركة.', ''))
        : (c.succeeded
            ? infoBox('check', '<b>تم توظيف هذا المتقدم بإحدى فرصتي بطاقته</b> — لا يوجد تقديم جارٍ حالياً.', 'border-color:#3ec1a0;background:#eefaf7')
            : infoBox('alert', '<b>لا يوجد تقديم جارٍ على هذه البطاقة حالياً</b> — إن كان المتقدم بين يديك ليعرض نفسه، فغيّر ذلك عبر الشركة.', ''))) +
      (a
        ? btnRow(
            '<button class="btn btn-gold" id="bk-emp-hire">' + UI.ic('check') + ' تم التوظيف — سجّله فوراً</button>' +
            '<button class="btn btn-danger" id="bk-emp-reject">' + UI.ic('x') + ' لم يتم التوظيف</button>' +
            '<button class="btn btn-ghost" id="bk-emp-back">' + UI.ic('arrow-right') + ' رجوع</button>')
        : btnRow('<button class="btn btn-ghost" id="bk-emp-back">' + UI.ic('arrow-right') + ' رجوع</button>'));
    var b;
    if ((b = document.getElementById('bk-emp-hire'))) b.addEventListener('click', function () { doDecide('hire'); });
    if ((b = document.getElementById('bk-emp-reject'))) b.addEventListener('click', function () { doDecide('reject'); });
    if ((b = document.getElementById('bk-emp-back'))) b.addEventListener('click', function () { view = 'gate'; render(); });
  }

  function doDecide(decision) {
    if (busy) return;
    var hire = decision === 'hire';
    UI.confirm({
      title: hire ? 'تأكيد التوظيف' : 'تأكيد الرفض',
      message: hire
        ? 'هل توظّفت هذا المتقدم فعلاً على الوظيفة المطلوبة؟ يُسجَّل القرار فوراً لدى الشركة وتُغلق الوظيفة.'
        : 'تأكيد أنك لم توظّف هذا المتقدم؟ يُسجَّل الرفض وتعود الوظيفة متاحة وفق قرار الشركة.',
      note: hire ? 'القرار نهائي ويوثّق باسم صاحب العمل وبوقته.' : 'يمكن للمتقدم استخدام فرصته الثانية على وظيفة أخرى.',
      confirmText: hire ? 'نعم — تم التوظيف' : 'نعم — لم يتم التوظيف',
      danger: !hire
    }).then(function (yes) {
      if (!yes) return;
      busy = true;
      render();
      Promise.resolve(Store.cardEmployerDecide(serial, decision)).then(function (r) {
        busy = false;
        if (!r || !r.ok) { UI.toast('err', 'تعذّر التسجيل', (r && r.error) || 'حاول مرة أخرى'); render(); return; }
        empDone = { decision: decision, attempt: r.attempt, job: r.job };
        view = 'empdone'; render();
      }).catch(function () {
        busy = false; UI.toast('err', 'تعذّر الاتصال', 'حاول مرة أخرى'); render();
      });
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
            : 'background:linear-gradient(135deg,#e05656,#b03a3a);color:#fff;box-shadow:0 14px 34px rgba(176,58,58,.3)') + '">' + UI.ic(hire ? 'check' : 'x') + '</div>' +
        '<h4 style="margin:0 0 6px">' + (hire ? 'تم تسجيل التوظيف ✅' : 'سُجّل عدم التوظيف') + '</h4>' +
        '<p class="muted small" style="margin:0 auto 10px;max-width:50ch">' + (hire
          ? 'سُجّل قرارك لدى الشركة على الوظيفة <b>' + esc(at.jobTitle || '') + '</b> وأُغلقت — بالتوفيق للموظف الجديد.'
          : 'سُجّل قرارك — تبقى للزبون فرصته الثانية على وظيفة أخرى إن توفرت.') + '</p>' +
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
      (card.chances || []).slice(0, 2).map(function (c, i) { return chanceRow(c, i + 1); }).join('') +
      '<div class="bk-info" style="margin-top:12px">' + UI.ic('clock') +
        ' عند التقديم تُحجز الوظيفة لك <b>24 ساعة</b> بانتظار نتيجة المقابلة؛ وبعدها تقرر الشركة: التوظيف أو إرجاع الوظيفة أو حذفها — والفرصة تُستهلك بالتقديم ولا تعود.</div>' +
      btnRow(
        (canUse ? '<button class="btn btn-gold" id="bk-use">' + UI.ic('briefcase') + ' استخدم فرصة على وظيفة</button>' : '') +
        '<button class="btn btn-lapis" id="bk-reprint">' + UI.ic('print') + ' إعادة الطباعة (البطاقة أو الاستمارة)</button>' +
        '<button class="btn btn-outline" id="bk-emp-open">' + UI.ic('briefcase') + ' أنا صاحب العمل</button>' +
        '<button class="btn btn-ghost" id="bk-back">' + UI.ic('arrow-right') + ' بطاقة أخرى</button>');
    var b;
    if ((b = document.getElementById('bk-use'))) b.addEventListener('click', function () { view = 'use'; render(); });
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
    host.innerHTML = stepHead('إعادة طباعة البطاقة', 'لإثبات أن الورقة بيدك، أدخل رمز إحدى فرصتي بطاقتك — ثم اطبعها بأي مكتب استنساخ.', 'print') +
      fieldHtml('rcode', 'رمز الفرصة (من ظهر بطاقتك)',
        inputHtml('rcode', 'text', 'مثال: 7429-KQ', '', 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700;letter-spacing:.08em" inputmode="latin"'),
        'أي واحد من الرمزين يكفي — يبقى كما هو في النسخة الجديدة.') +
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
    if (!/^\d{4}-[A-Z]{2}$/.test(code)) {
      setErr('rcode', 'الرمز بصيغة 4 أرقام وشرطة وحرفين — مثل 7429-KQ.');
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
        setErr('rcode', (r && r.error) || 'رمز الفرصة غير صحيح.');
        return;
      }
      var V = root.HRCVoucher;
      if (mode === 'form') {
        if (!V || !V.printForm) { setErr('rcode', 'قالب طباعة الاستمارة غير متوفر بهذه الصفحة.'); return; }
        try { V.printForm(r.app, null); } catch (e) {
          setErr('rcode', 'تعذّر فتح الطباعة — حاول مرة أخرى.');
        }
      } else {
        if (!V || !V.print) { setErr('rcode', 'قالب الطباعة غير متوفر بهذه الصفحة.'); return; }
        try { V.print(r.app, { attempts: r.attempts }); } catch (e) {
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
    emp = null; posResult = null; empDone = null; routeErr = '';
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
    if (serial && serialPattern(serial) && opts.fromHash) routeFromHash();
    else render();
  }

  function close() {
    if (m) { try { m.close(); } catch (e) { } m = null; }
    card = null; doneInfo = null; emp = null; posResult = null; empDone = null; routeErr = '';
    view = 'entry';
  }

  /* فتح البطاقة من باركود QR المطبوع: ‎#card=HRC-BC-###### */
  function openFromHash() {
    if (!location || !location.hash) return;
    var mt = /#card=([A-Za-z0-9-]+)/.exec(location.hash);
    if (!mt) return;
    var s = decodeURIComponent(mt[1]).trim().toUpperCase();
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
    if (serialPattern(s)) open({ serial: s, fromHash: true });
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
        view: view, serial: serial,
        card: card ? JSON.parse(JSON.stringify(card)) : null,
        emp: emp ? JSON.parse(JSON.stringify(emp)) : null
      };
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.HRCBooking;
})(typeof window !== 'undefined' ? window : globalThis);
