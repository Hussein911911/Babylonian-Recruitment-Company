/* ===========================================================================
 *  BRC — منطق الموقع العام
 *  لوحة الوظائف، البحث الفوري، صفحة الوظيفة، وطلب الاستمارة الإلكترونية.
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.BRC_CONFIG, Store = root.BRCStore, UI = root.BRCUI;
  if (!document.getElementById('jobs-grid')) return;

  var filters = { q: '', region: 'all', shift: 'all', status: 'all' };

  /* ---------------- التهيئة ---------------- */
  function init() {
    Store.init();
    UI.startCountdowns();
    fillSelects();
    bindEvents();
    renderAll();
    Store.subscribe(renderAll);

    // تشغيل قواعد الإفراج التلقائي عند التحميل ثم دورياً
    Store.runMaintenance();
    setInterval(function () { Store.runMaintenance(); }, 60000);
  }

  function fillSelects() {
    UI.fillSelect(document.getElementById('qs-region'), CFG.regions, 'كل مناطق بابل');
    UI.fillSelect(document.getElementById('filter-region'), CFG.regions, 'كل المناطق');
    UI.fillSelect(document.getElementById('filter-shift'), CFG.shifts, 'كل الأوقات');
  }

  function bindEvents() {
    var q = document.getElementById('filter-q');
    var region = document.getElementById('filter-region');
    var shift = document.getElementById('filter-shift');
    var status = document.getElementById('filter-status');

    if (q) q.addEventListener('input', UI.debounce(function () { filters.q = q.value; renderJobs(); }));
    if (region) region.addEventListener('change', function () { filters.region = region.value; renderJobs(); });
    if (shift) shift.addEventListener('change', function () { filters.shift = shift.value; renderJobs(); });
    if (status) status.addEventListener('change', function () { filters.status = status.value; renderJobs(); });
    var reset = document.getElementById('filter-reset');
    if (reset) reset.addEventListener('click', function () {
      filters = { q: '', region: 'all', shift: 'all', status: 'all' };
      if (q) q.value = ''; if (region) region.value = 'all';
      if (shift) shift.value = 'all'; if (status) status.value = 'all';
      renderJobs();
    });

    // البحث السريع
    var qsForm = document.getElementById('qs-form');
    if (qsForm) qsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = (document.getElementById('qs-code') || {}).value || '';
      var reg = (document.getElementById('qs-region') || {}).value || 'all';
      filters.q = code.trim();
      filters.region = reg;
      var fq = document.getElementById('filter-q');
      var fr = document.getElementById('filter-region');
      if (fq) fq.value = filters.q;
      if (fr) fr.value = reg;
      renderJobs();
      var jobs = document.getElementById('jobs');
      if (jobs) jobs.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var found = Store.listJobs(filters);
      if (found.length === 1) openJob(found[0].code);
      else if (found.length === 0) UI.toast('warn', 'لا نتائج', 'لم نجد وظيفة بهذا الكود أو العنوان — تواصل معنا للاستفسار.');
    });

    // طلب استمارة
    ['btn-request-form', 'btn-request-form-2'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () { requestFormModal(); });
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-action="request-form"]');
      if (a) { e.preventDefault(); requestFormModal(a.getAttribute('data-code') || ''); }
      var v = e.target.closest && e.target.closest('[data-action="job-details"]');
      if (v) { e.preventDefault(); openJob(v.getAttribute('data-code')); }
      var vf = e.target.closest && e.target.closest('[data-action="verify"]');
      if (vf) { e.preventDefault(); verifySerial(vf.getAttribute('data-serial')); }
    });

    // التحقق السريع
    var vForm = document.getElementById('verify-quick');
    if (vForm) vForm.addEventListener('submit', function (e) {
      e.preventDefault();
      verifySerial((document.getElementById('verify-serial') || {}).value || '');
    });

    // قائمة الجوال
    var toggle = document.getElementById('nav-toggle');
    var nav = document.getElementById('main-nav');
    if (toggle && nav) toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
    });
    if (nav) nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') nav.classList.remove('open'); });

    // تمييز الرابط النشط حسب موضع التمرير
    window.addEventListener('scroll', UI.debounce(function () {
      var y = window.scrollY + 120, current = '';
      document.querySelectorAll('section[id]').forEach(function (s) {
        if (s.offsetTop <= y) current = s.id;
      });
      document.querySelectorAll('.main-nav a').forEach(function (a) {
        var href = a.getAttribute('href') || '';
        a.classList.toggle('active', href.split('#')[1] === current);
      });
    }, 120));

    var y = document.getElementById('year');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  function verifySerial(serial) {
    serial = String(serial || '').trim().toUpperCase();
    if (!serial) { UI.toast('warn', 'أدخل الرقم التسلسلي', 'مثال: BRC-NO-000120'); return; }
    if (serial.indexOf('BRC-NO') !== 0) serial = 'BRC-NO-' + serial.replace(/[^0-9]/g, '').padStart(6, '0');
    var app = Store.getApplicant(serial);
    if (!app) { UI.toast('err', 'استمارة غير موجودة', 'تأكد من الرقم التسلسلي أو راجع المكتب.'); return; }
    window.location.href = Store.verifyLocalUrl(serial);
  }

  /* ---------------- العرض ---------------- */
  function renderAll() { renderHeroStats(); renderJobs(); }

  root.BRCRefresh = function () { renderAll(); };

  function renderHeroStats() {
    var host = document.getElementById('hero-stats');
    if (!host) return;
    var s = Store.stats();
    var items = [
      { v: s.available, l: 'وظيفة متاحة الآن' },
      { v: s.totalJobs, l: 'وظيفة مُسجّلة في النظام' },
      { v: s.forms, l: 'استمارة صادرة' },
      { v: s.hires, l: 'توظيف ناجح مكتمل' }
    ];
    host.innerHTML = items.map(function (i) {
      return '<div class="hero-stat"><b>' + i.v + '</b><span>' + i.l + '</span></div>';
    }).join('');
  }

  function renderJobs() {
    var host = document.getElementById('jobs-grid');
    if (!host) return;
    var jobs = Store.listJobs(filters);
    var count = document.getElementById('jobs-count');
    if (count) count.textContent = jobs.length;
    var upd = document.getElementById('jobs-updated');
    if (upd) upd.textContent = Store.fmtDateTime(new Date());
    var empty = document.getElementById('jobs-empty');
    if (empty) empty.classList.toggle('hidden', jobs.length > 0);
    host.innerHTML = jobs.map(cardHtml).join('');
  }

  function cardHtml(j) {
    var st = CFG.jobStatus[j.status];
    var cls = j.status === 'reserved' ? 'is-reserved' : (j.status === 'closed' ? 'is-closed' : '');
    var hold = '';
    if (j.status === 'reserved' && j.holdExpiresAt) {
      var h = Store.diffHours(j.holdExpiresAt, new Date());
      hold = '<span class="tiny muted" title="يُفرج تلقائياً">' +
        (h > 0 ? 'تُفرج خلال ' + Math.ceil(h) + ' ساعة' : 'قيد الإفراج') + '</span>';
    }
    return '' +
      '<article class="job-card ' + cls + '">' +
        '<div class="job-head">' +
          '<div>' +
            '<h3 class="job-title">' + UI.esc(j.title) + '</h3>' +
            '<span class="chip chip-code mono job-code">' + UI.esc(j.code) + '</span>' +
          '</div>' +
          '<div style="display:grid;gap:6px;justify-items:end">' +
            UI.jobBadge(j.status) +
            '<span class="chip chip-gold tiny">' + UI.esc(j.category) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="job-body">' +
          '<div class="job-meta">' +
            '<div class="mi">' + UI.ic('pin') + '<span>' + UI.esc(j.region) + '</span></div>' +
            '<div class="mi">' + UI.ic('clock') + '<span>' + UI.esc(j.shift) + '</span></div>' +
            '<div class="mi">' + UI.ic('money') + '<span>' + Store.money(j.salaryMin) + ' – ' + Store.money(j.salaryMax) + '</span></div>' +
            '<div class="mi">' + UI.ic('users') + '<span>' + UI.esc(j.gender || 'لا فرق') + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="job-foot">' +
          '<span class="salary">' + Store.money(j.salaryMin) + '</span>' +
          '<div class="flex" style="gap:8px;align-items:center">' +
            hold +
            '<button class="btn btn-outline btn-sm" data-action="job-details" data-code="' + UI.esc(j.code) + '">التفاصيل</button>' +
            (j.status === 'available'
              ? '<button class="btn btn-gold btn-sm" data-action="request-form" data-code="' + UI.esc(j.code) + '">' + UI.ic('user-plus') + ' ترشّح</button>'
              : '<button class="btn btn-outline btn-sm" disabled>' + st.ar + '</button>') +
          '</div>' +
        '</div>' +
      '</article>';
  }

  /* ---------------- صفحة الوظيفة (عرض عام محجوب بيانات صاحب العمل) ---------------- */
  function openJob(code) {
    var j = Store.getJob(code);
    if (!j) return;
    var reqs = (j.requirements || []).map(function (r) {
      return '<li>' + UI.ic('check') + '<span>' + UI.esc(r) + '</span></li>';
    }).join('');
    var attempts = Store.currentUser() ? '' : '';
    var body = '' +
      '<div class="flex-between flex-wrap mb-3" style="gap:12px">' +
        '<div>' +
          '<span class="chip chip-code mono">' + UI.esc(j.code) + '</span>' +
          '<span class="chip chip-gold" style="margin-inline-start:6px">' + UI.esc(j.category) + '</span>' +
        '</div>' +
        UI.jobBadge(j.status) +
      '</div>' +
      '<div class="data-grid mb-3">' +
        '<div class="data-item"><div class="k">المنطقة</div><div class="v">' + UI.esc(j.region) + '</div></div>' +
        '<div class="data-item"><div class="k">الأجر الشهري</div><div class="v">' + Store.money(j.salaryMin) + ' – ' + Store.money(j.salaryMax) + '</div></div>' +
        '<div class="data-item"><div class="k">الدوام</div><div class="v">' + UI.esc(j.shift) + '</div></div>' +
        '<div class="data-item"><div class="k">الجنس</div><div class="v">' + UI.esc(j.gender || 'لا فرق') + '</div></div>' +
        '<div class="data-item"><div class="k">عدد الشواغر</div><div class="v">' + (j.vacancies || 1) + '</div></div>' +
        '<div class="data-item"><div class="k">تاريخ الإضافة</div><div class="v" dir="ltr">' + Store.fmtDate(j.createdAt) + '</div></div>' +
      '</div>' +
      '<div class="panel" style="background:#fdf9ee;border-color:var(--line)">' +
        '<div class="panel-body" style="padding:14px 16px">' +
          '<p class="mb-0 small">' + UI.ic('lock', '') +
          ' <b>خصوصية صاحب العمل:</b> لا تُعرض بياناته التفصيلية (الاسم، الهاتف، العنوان) في الموقع العام. ' +
          'تُسلَّم هذه البيانات للباحث عبر شركة بابل للتوظيف بعد إصدار الاستمارة وتثبيت المحاولة، وفق سياسة الشركة.</p>' +
        '</div>' +
      '</div>' +
      (reqs ? '<h3 class="mt-3">الشروط والمتطلبات</h3><ul class="feature-list">' + reqs + '</ul>' : '') +
      (j.description ? '<p class="muted mt-2">' + UI.esc(j.description) + '</p>' : '') +
      '<div class="panel mt-3"><div class="panel-body" style="padding:14px 16px">' +
        '<p class="mb-0 small">' + UI.ic('hourglass') +
        ' <b>آلية الحجز:</b> عند اختيارك هذه الوظيفة كمحاولة، تُحجز مؤقتاً <b>24 ساعة</b> بانتظار نتيجة المقابلة، ' +
        'وإن لم تُثبَّت النتيجة تُعاد الوظيفة تلقائياً إلى «متاحة».</p>' +
      '</div></div>';

    UI.modal({
      title: j.title, subtitle: 'تفاصيل الوظيفة — ' + j.region, body: body, wide: true,
      footer: (j.status === 'available'
        ? '<button class="btn btn-gold" data-request="' + UI.esc(j.code) + '">' + UI.ic('user-plus') + ' اطلب استمارة لهذه الوظيفة</button>'
        : '<button class="btn btn-outline" disabled>الوظيفة ' + CFG.jobStatus[j.status].ar + '</button>') +
        '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        var b = box.querySelector('[data-request]');
        if (b) b.addEventListener('click', function () { close(); requestFormModal(b.getAttribute('data-request')); });
      }
    });
  }

  /* ---------------- طلب استمارة إلكترونية ---------------- */
  function requestFormModal(prefillCode) {
    var code = prefillCode || '';
    var regionsList = CFG.regions.map(function (r) { return '<option>' + UI.esc(r) + '</option>'; }).join('');
    var body = '' +
      '<p class="muted small">املأ البيانات الأساسية ليصدر لك رقم تسلسلي فوري واستمارة صالحة 30 يوماً بخمس محاولات. ' +
      'تُستكمل الإجراءات في مكتب الشركة (الحلة – شارع 60).</p>' +
      '<form id="req-form" class="grid grid-2" style="gap:14px">' +
        '<div class="field"><label for="r-name">الاسم الكامل *</label><input type="text" id="r-name" required placeholder="الاسم الثلاثي"></div>' +
        '<div class="field"><label for="r-phone">رقم الهاتف *</label><input type="tel" id="r-phone" required placeholder="07XXXXXXXXX" dir="ltr"></div>' +
        '<div class="field"><label for="r-dob">تاريخ الميلاد</label><input type="date" id="r-dob"></div>' +
        '<div class="field"><label for="r-gender">الجنس</label><select id="r-gender"><option>ذكر</option><option>أنثى</option></select></div>' +
        '<div class="field"><label for="r-region">منطقة السكن</label><select id="r-region">' + regionsList + '</select></div>' +
        '<div class="field"><label for="r-code">كود الوظيفة المطلوبة</label><input type="text" id="r-code" value="' + UI.esc(code) + '" placeholder="BRC-1042 (اختياري)" dir="ltr"></div>' +
        '<div class="field" style="grid-column:1/-1"><label for="r-address">العنوان التفصيلي</label><input type="text" id="r-address" placeholder="المنطقة - المحلة - أقرب نقطة دالة"></div>' +
      '</form>' +
      '<p class="tiny muted mt-2 mb-0">بالمتابعة أنت توافق على أن خدمات الشركة تنحصر بتوفير الأيادي العاملة الفنية والتخصصية فقط، ' +
      'وأن الشركة غير مسؤولة قانونياً وعشائياً عن الشخص المرسل وصاحب العمل.</p>';

    UI.modal({
      title: 'طلب استمارة إلكترونية', subtitle: 'BRC — نظام الاستمارات', wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-gold" id="req-submit">' + UI.ic('check') + ' إصدار الاستمارة</button>',
      onMount: function (box, close) {
        box.querySelector('#req-submit').addEventListener('click', function () {
          var f = box.querySelector('#req-form');
          if (!f.reportValidity()) return;
          var name = box.querySelector('#r-name').value.trim();
          var phone = box.querySelector('#r-phone').value.trim();
          var dob = box.querySelector('#r-dob').value;
          var gender = box.querySelector('#r-gender').value;
          var region = box.querySelector('#r-region').value;
          var address = box.querySelector('#r-address').value.trim();
          var reqCode = box.querySelector('#r-code').value.trim().toUpperCase();
          if (reqCode && !Store.getJob(reqCode)) {
            UI.toast('warn', 'كود غير معروف', 'لا توجد وظيفة بالكود ' + reqCode + ' — سنسجّل طلبك بدون تحديد كود.');
            reqCode = '';
          }
          var app = Store.createApplicant({
            fullName: name, phone: phone, dob: dob, gender: gender,
            address: (address ? address : region + ' - بابل'),
            requestedCode: reqCode || null,
            notes: reqCode ? 'طلب إلكتروني للوظيفة ' + reqCode : 'طلب إلكتروني من الموقع'
          });
          close();
          showIssued(app, reqCode);
        });
      }
    });
  }

  function showIssued(app, reqCode) {
    var vUrl = Store.verifyUrl(app.serial);
    var body = '' +
      '<div class="verify-status ok" style="padding:0 0 16px">' +
        '<div class="seal">' + UI.ic('check') + '</div>' +
        '<div><h1 style="font-size:1.2rem">صدرت استمارتك بنجاح</h1>' +
        '<p class="muted mb-0 small">احتفظ بالرقم التسلسلي وراجع المكتب لاستلام النسخة المطبوعة المختومة.</p></div>' +
      '</div>' +
      '<div class="grid" style="grid-template-columns:1fr 190px;gap:18px;align-items:start">' +
        '<div class="data-grid">' +
          '<div class="data-item"><div class="k">الرقم التسلسلي</div><div class="v mono" dir="ltr">' + UI.esc(app.serial) + '</div></div>' +
          '<div class="data-item"><div class="k">اسم الباحث</div><div class="v">' + UI.esc(app.fullName) + '</div></div>' +
          '<div class="data-item"><div class="k">تاريخ الإصدار</div><div class="v" dir="ltr">' + Store.fmtDate(app.issueDate) + '</div></div>' +
          '<div class="data-item"><div class="k">تاريخ الانتهاء</div><div class="v" dir="ltr">' + Store.fmtDate(app.expiryDate) + '</div></div>' +
          '<div class="data-item"><div class="k">المحاولات المتاحة</div><div class="v">' + Store.attemptsLeft(app.serial) + ' من ' + Store.settings().attemptLimit + '</div></div>' +
          '<div class="data-item"><div class="k">الوظيفة المطلوبة</div><div class="v mono">' + UI.esc(reqCode || '—') + '</div></div>' +
        '</div>' +
        '<div class="verify-qr">' + BRCVoucher.qrSvg(vUrl, 170) +
          '<span class="tiny muted center" dir="ltr">' + UI.esc(vUrl.replace(/^https?:\/\//, '')) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="panel mt-3" style="background:#fdf9ee;border-color:var(--line)"><div class="panel-body" style="padding:14px 16px">' +
        '<p class="mb-0 small">' + UI.ic('alert') + ' <b>ملاحظة:</b> هذه الاستمارة إلكترونية مبدئية. النسخة الرسمية هي المطبوعة ' +
        'والمختومة من مكتب الشركة، وهي وحدها المعتمدة لدى أصحاب العمل. لا تُسلِّم الاستمارة لغيرك ولا تدفع مبالغ لوسطاء.</p>' +
      '</div></div>';

    UI.modal({
      title: 'تم إصدار الاستمارة', subtitle: 'BRC-NO — نظام الاستمارات الموثّق', wide: true, body: body,
      footer: '<button class="btn btn-lapis" id="issued-print">' + UI.ic('print') + ' طباعة الاستمارة</button>' +
        '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        box.querySelector('#issued-print').addEventListener('click', function () {
          BRCVoucher.print(app);
          UI.toast('ok', 'جاهزة للطباعة', 'تم تحضير الاستمارة بصيغة A4 مع الكيو آر كود.');
        });
      }
    });
    UI.toast('ok', 'صدرت الاستمارة', 'الرقم التسلسلي: ' + app.serial);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
