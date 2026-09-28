/* ===========================================================================
 *  HRC — نافذة الحجز الإلكتروني (متعددة الخطوات)
 *  ---------------------------------------------------------------------------
 *  عند الضغط على أي زر «احجز» (data-action="open-booking") تُفتح نافذة
 *  إرشادية خطوة-خطوة: الاسم ← الوظيفة ← الهاتف ← المعلومات الشخصية ←
 *  محل السكن ← التعليم والخبرة ← الدفع بالبطاقة المصرفية ← مراجعة وتأكيد.
 *  كل خطوة فيها زر «التالي»، ولا تنتقل إلا بعد صحة ما كُتب فيها.
 *
 *  ⚠️ أمان البطاقة المصرفية (مقصود وصريح):
 *  هذا الموقع ثابت بلا خادم دفع — لذلك يُتحقَق من البطاقة محلياً
 *  (خوارزمية Luhn + نوع البطاقة + تاريخ الانتهاء + CVV) ثم يُحفَظ من
 *  بياناتها **الحد الأدنى المقنَّع فقط** (النوع وآخر 4 أرقام وتاريخ
 *  الانتهاء واسم حاملها). الرقم الكامل وCVV لا يُخزَّنان ولا يُرسَلان في
 *  أي رسالة — إرسالهما عبر واتساب أو تخزينهما في المتصفح خرق أمني
 *  (PCI-DSS). للخصم الفعلي من البطاقة يلزم لاحقاً بوابة دفع حقيقية
 *  (زين كاش / FIB / Stripe …) وتُستبدل خطوة الدفع هنا بها.
 *
 *  الحجوزات تُحفظ في مفتاح localStorage مستقل (hrc_bookings_v1) — لا يمسّ
 *  قاعدة الموظفين (hrc_db_v2) ولا طبقة السحابة — وزر «إبلاغ الشركة عبر
 *  واتساب» في شاشة النجاح يسلّم تفاصيل الحجز للمكتب برسالة جاهزة.
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.HRC_CONFIG, UI = root.HRCUI, Store = root.HRCStore;
  if (!document.getElementById('jobs-grid')) return;   // تعمل في الموقع العام فقط

  var STORE_KEY = 'hrc_bookings_v1';    // سجل الحجوزات المسلَّمة
  var DRAFT_KEY = 'hrc_booking_draft_v1'; // مسودة غير مكتملة (بلا بيانات البطاقة)
  /* احتياط الذاكرة حين يتعذّر localStorage (تصفّح خاص أو أصل بلا تخزين) —
     نفس أسلوب المتجر: الحجز يكتمل داخل الجلسة ولا يضيع أمام الزبون. */
  var mem = { counter: 0, items: [] };

  /* ======================= الحالة ======================= */
  var m = null;          // النافذة الحالية { root, close }
  var steps = [];        // خطوات النافذة (تُبنى عند الفتح)
  var idx = 0;           // الخطوة الحالية
  var data = blankData();
  var busy = false;      // أثناء «تثبيت الحجز»

  function blankData() {
    return {
      fullname: '', job: '', phone: '', dob: '', gender: '',
      region: '', address: '', education: '', experience: '',
      cardNumber: '', cardName: '', cardExp: '', cardCvv: '', agree: false
    };
  }

  /* ======================= التخزين ======================= */
  function canStore() {
    try { localStorage.setItem('__hrc_t', '1'); localStorage.removeItem('__hrc_t'); return true; }
    catch (e) { return false; }
  }

  function readAll() {
    if (canStore()) {
      try {
        var o = JSON.parse(localStorage.getItem(STORE_KEY) || '');
        if (o && Array.isArray(o.items) && typeof o.counter === 'number') return o;
      } catch (e) { /* تالف → نبدأ من جديد */ }
    }
    return mem;
  }

  function pad(n, len) { var s = String(n); while (s.length < len) s = '0' + s; return s; }

  /* المسودة: بيانات شخصية فقط — لا رقم بطاقة ولا CVV */
  function saveDraft() {
    if (!canStore()) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        fullname: data.fullname, job: data.job, phone: data.phone,
        dob: data.dob, gender: data.gender, region: data.region,
        address: data.address, education: data.education, experience: data.experience
      }));
    } catch (e) { /* ممتلئ → نتجاهل بصمت */ }
  }
  function loadDraft() {
    if (!canStore()) return;
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '');
      if (!d) return;
      ['fullname', 'job', 'phone', 'dob', 'gender', 'region', 'address', 'education', 'experience']
        .forEach(function (k) { if (typeof d[k] === 'string') data[k] = d[k]; });
    } catch (e) { /* مسودة تالفة → نبدأ من جديد */ }
  }
  function clearDraft() { if (canStore()) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} } }

  /* ======================= أدوات التحقق ======================= */
  function digits(v) { return String(v || '').replace(/\D/g, ''); }

  /* رقم هاتف عراقي: 07 ويليه 9 أرقام (11 رقمًا) */
  function validPhone(v) { return /^07\d{9}$/.test(digits(v)); }

  /* الاسم: كلمتان على الأقل، كل كلمة حرفان فأكثر */
  function validName(v) {
    var words = String(v || '').trim().split(/\s+/).filter(function (w) { return w.length >= 2; });
    return words.length >= 2;
  }

  /* العمر من تاريخ الميلاد (سنين مكتملة) */
  function age(dob) {
    var d = new Date(dob), now = new Date();
    if (isNaN(d.getTime())) return NaN;
    var a = now.getFullYear() - d.getFullYear();
    var m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
    return a;
  }

  /* نوع البطاقة من البادئة */
  function cardBrand(d) {
    if (/^4/.test(d)) return { key: 'visa', label: 'VISA' };
    if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(d)) return { key: 'mc', label: 'MasterCard' };
    if (/^3[47]/.test(d)) return { key: 'amex', label: 'AMEX' };
    return { key: 'card', label: 'بطاقة مصرفية' };
  }

  /* تنسيق الرقم: مجموعات 4-4-4-4 (وAMEX 4-6-5) */
  function formatCardNumber(v) {
    var d = digits(v).slice(0, 19);
    if (/^3[47]/.test(d)) {
      return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
    }
    return d.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  /* خوارزمية Luhn — صحة رقم البطاقة */
  function luhn(d) {
    var sum = 0, alt = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = +d.charAt(i);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return d.length >= 13 && sum % 10 === 0;
  }

  /* تاريخ الانتهاء MM/YY: صيغة صحيحة وليس ماضياً */
  function validExpiry(v) {
    var mm = v.match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!mm) return false;
    var mon = +mm[1], yr = 2000 + +mm[2];
    if (mon < 1 || mon > 12) return false;
    var end = new Date(yr, mon, 0, 23, 59, 59);   // آخر لحظة في شهر الانتهاء
    return end.getTime() >= Date.now();
  }

  /* ======================= الخطوات ======================= */
  var educationLevels = ['ابتدائي', 'متوسط', 'إعدادي', 'دبلوم تقني', 'دبلوم مهني', 'بكالوريوس', 'ماجستير', 'دكتوراه', 'بدون شهادة'];

  function feeAmount() {
    return (CFG.rules && CFG.rules.formFee) || 10000;
  }

  function availableJobs() {
    try { return Store.listJobs({ status: 'available' }); } catch (e) { return []; }
  }

  function buildSteps(preJob) {
    steps = [
      { id: 'name', label: 'الاسم', render: renderName, validate: validateName },
      { id: 'phone', label: 'الهاتف', render: renderPhone, validate: validatePhone },
      { id: 'personal', label: 'معلومات شخصية', render: renderPersonal, validate: validatePersonal },
      { id: 'address', label: 'السكن', render: renderAddress, validate: validateAddress },
      { id: 'edu', label: 'التعليم والخبرة', render: renderEdu, validate: validateEdu },
      { id: 'pay', label: 'الدفع', render: renderPay, validate: validatePay },
      { id: 'review', label: 'التأكيد', render: renderReview, validate: validateReview }
    ];
    /* بلا وظيفة محددة مسبقاً → خطوة اختيار الوظيفة أول ما بعد الاسم */
    if (!preJob) {
      steps.splice(1, 0, { id: 'job', label: 'الوظيفة', render: renderJob, validate: validateJob });
    }
  }

  /* ======================= فتح النافذة ======================= */
  function open(opts) {
    opts = opts || {};
    if (m) { try { m.close(); } catch (e) {} m = null; }

    var preJob = null;
    if (opts.code) {
      preJob = Store.getJob ? Store.getJob(opts.code) : null;
      if (!preJob || preJob.status !== 'available') {
        preJob = null;
        UI.toast('warn', 'الوظيفة غير متاحة',
          'هذه الوظيفة لم تعد متاحة للحجز — اختر غيرها من الوظائف المعروضة.', 6000);
      }
    }

    data = blankData();
    loadDraft();
    if (preJob) data.job = preJob.code;
    busy = false;

    buildSteps(preJob);
    idx = 0;

    m = UI.modal({
      title: 'الحجز الإلكتروني',
      subtitle: 'خطوات قصيرة لتثبيت حجزك — يستغرق أقل من 3 دقائق',
      body: '<div class="bk-wrap" id="bk-wrap"></div>',
      footer: '<span></span>'
    });
    if (!m) return;
    m.root.classList.add('modal-booking');
    renderStep();
  }

  function close() { if (m) { try { m.close(); } catch (e) {} m = null; } }

  /* ======================= الرسم ======================= */
  function progressHtml() {
    var out = '<div class="bk-progress" role="list" aria-label="خطوات الحجز">';
    for (var i = 0; i < steps.length; i++) {
      var cls = i < idx ? ' is-done' : (i === idx ? ' is-current' : '');
      out += '<div class="bk-pg-step' + cls + '" role="listitem">' +
        '<span class="bk-pg-dot">' + (i < idx ? UI.ic('check') : (i + 1)) + '</span>' +
        '<span class="bk-pg-label">' + UI.esc(steps[i].label) + '</span>' +
      '</div>';
    }
    return out + '</div>';
  }

  /* شريط الوظيفة المختارة (يظهر عند تفعيل النافذة من بطاقة وظيفة) */
  function jobStripHtml() {
    if (!data.job) return '';
    var j = Store.getJob ? Store.getJob(data.job) : null;
    if (!j) return '';
    return '<div class="bk-jobstrip">' + UI.ic('briefcase') +
      '<div><b>' + UI.esc(j.title) + '</b>' +
      '<span class="tiny muted">' + UI.esc(j.code) + ' · ' + UI.esc(j.region) + ' · ' + UI.esc(j.shift) + '</span></div>' +
      '<span class="chip chip-gold tiny">' + UI.esc(j.category) + '</span></div>';
  }

  function stepHead(title, desc, icon) {
    return '<div class="bk-stephead"><h4>' +
      (icon ? UI.ic(icon) + ' ' : '') + UI.esc(title) +
      '</h4><p class="muted small mb-0">' + desc + '</p></div>';
  }

  function fieldHtml(id, label, inner, hint, required) {
    return '<div class="bk-field" data-bk-field="' + id + '">' +
      '<label for="bk-' + id + '">' + UI.esc(label) + (required === false ? '' : ' <span class="bk-req">*</span>') + '</label>' +
      inner +
      (hint ? '<span class="bk-hint">' + UI.esc(hint) + '</span>' : '') +
      '<span class="bk-err" data-bk-err="' + id + '">' + UI.ic('alert') + '<span></span></span>' +
    '</div>';
  }

  function inputHtml(id, type, placeholder, value, extra) {
    return '<input id="bk-' + id + '" data-bk="' + id + '" type="' + (type || 'text') + '" ' +
      'placeholder="' + UI.esc(placeholder || '') + '" value="' + UI.esc(value || '') + '" autocomplete="off" ' +
      (extra || '') + '>';
  }

  function selectHtml(id, opts, value, placeholder) {
    var h = '<select id="bk-' + id + '" data-bk="' + id + '">' +
      '<option value="">' + UI.esc(placeholder || 'اختر…') + '</option>';
    opts.forEach(function (o) {
      var v = typeof o === 'string' ? o : o.v, t = typeof o === 'string' ? o : o.t;
      h += '<option value="' + UI.esc(v) + '"' + (value === v ? ' selected' : '') + '>' + UI.esc(t) + '</option>';
    });
    return h + '</select>';
  }

  /* ---------- 1) الاسم ---------- */
  function renderName(host) {
    host.innerHTML = stepHead('الاسم الكامل',
      'اكتب اسمك الثلاثي أو الرباعي كما في وثيقة الهوية — سيُطبع على الاستمارة الرسمية.') +
      fieldHtml('fullname', 'الاسم الكامل',
        inputHtml('fullname', 'text', 'مثال: أحمد محمد علي الكربلائي', data.fullname), null);
  }
  function validateName() {
    if (!validName(data.fullname)) return { fullname: 'اكتب اسمك الكامل (كلمتان على الأقل، وكل كلمة حرفان فأكثر).' };
    return null;
  }

  /* ---------- 2) اختيار الوظيفة ---------- */
  function renderJob(host) {
    var jobs = availableJobs();
    var inner;
    if (!jobs.length) {
      inner = '<div class="bk-empty">' + UI.ic('briefcase') +
        '<b>لا توجد وظائف متاحة للحجز حالياً</b>' +
        '<span class="tiny muted">تابع لوحة الوظائف أو خابر الشركة على أرقامها الرسمية.</span></div>';
    } else {
      inner = fieldHtml('job', 'الوظيفة المراد حجزها',
        selectHtml('job', jobs.map(function (j) {
          return { v: j.code, t: j.code + ' — ' + j.title + ' (' + j.region + ')' };
        }), data.job, 'اختر وظيفة من المتاحة…'),
        'تُحدَّث الحالات لحظياً — الوظائف المحجوزة والمغلقة لا تظهر هنا.');
    }
    host.innerHTML = stepHead('اختيار الوظيفة',
      'اختر الوظيفة التي ترغب بحجزها من الوظائف المتاحة الآن.') + inner;
  }
  function validateJob() {
    var jobs = availableJobs();
    if (!jobs.length) return { job: 'لا توجد وظائف متاحة حالياً — تعذّر إكمال الحجز.' };
    if (!data.job) return { job: 'اختر الوظيفة التي تريد حجزها.' };
    var j = Store.getJob ? Store.getJob(data.job) : null;
    if (!j || j.status !== 'available') return { job: 'هذه الوظيفة لم تعد متاحة — اختر غيرها.' };
    return null;
  }

  /* ---------- 3) الهاتف ---------- */
  function renderPhone(host) {
    host.innerHTML = stepHead('رقم الهاتف',
      'سيتواصل معك موظف الشركة على هذا الرقم لتثبيت الحجز وإبلاغك بموعد المقابلة.') +
      fieldHtml('phone', 'رقم الهاتف (موبايل)',
        inputHtml('phone', 'tel', '07XXXXXXXXX', data.phone, 'inputmode="numeric" dir="ltr" style="text-align:right"'),
        'رقم عراقي يبدأ بـ 07 ويتكوّن من 11 رقماً.');
  }
  function validatePhone() {
    if (!validPhone(data.phone)) return { phone: 'أدخل رقم موبايل عراقي صحيح: يبدأ بـ 07 ويتكوّن من 11 رقماً.' };
    return null;
  }

  /* ---------- 4) معلومات شخصية ---------- */
  function renderPersonal(host) {
    host.innerHTML = stepHead('المعلومات الشخصية',
      'تُدوَّن هذه المعلومات في استمارتك الرسمية الصادرة من الشركة.') +
      '<div class="grid grid-2" style="gap:0 14px">' +
        fieldHtml('dob', 'تاريخ الميلاد',
          inputHtml('dob', 'date', '', data.dob), 'العمر المقبول للتوظيف: 18 – 65 سنة.') +
        fieldHtml('gender', 'الجنس',
          selectHtml('gender', ['ذكر', 'أنثى'], data.gender)) +
      '</div>';
  }
  function validatePersonal() {
    if (!data.dob) return { dob: 'اختر تاريخ ميلادك.' };
    var a = age(data.dob);
    if (isNaN(a)) return { dob: 'تاريخ ميلاد غير صالح.' };
    if (a < 18) return { dob: 'العمر الأدنى للتقديم 18 سنة.' };
    if (a > 65) return { dob: 'العمر الأقصى للتقديم 65 سنة.' };
    if (!data.gender) return { gender: 'اختر الجنس.' };
    return null;
  }

  /* ---------- 5) محل السكن ---------- */
  function renderAddress(host) {
    host.innerHTML = stepHead('محل السكن',
      'لتسهيل ترتيب المقابلة والوظائف القريبة من منطقتك.') +
      fieldHtml('region', 'المنطقة',
        selectHtml('region', CFG.regions || [], data.region)) +
      fieldHtml('address', 'العنوان التفصيلي',
        inputHtml('address', 'text', 'المحلة، الشارع، أقرب نقطة دالة…', data.address),
        'مثال: الحلة - المحلة 7 - شارع 40 - قرب جامع الرحمن.');
  }
  function validateAddress() {
    if (!data.region) return { region: 'اختر منطقتك.' };
    if (String(data.address || '').trim().length < 5) return { address: 'اكتب عنواناً تفصيلياً أوضح (5 أحرف على الأقل).' };
    return null;
  }

  /* ---------- 6) التعليم والخبرة ---------- */
  function renderEdu(host) {
    host.innerHTML = stepHead('التعليم والخبرة',
      'آخر شهادة دراسية وخبراتك العملية — تساعدنا في ترشيحك للوظيفة الأنسب.') +
      fieldHtml('education', 'المستوى التعليمي',
        selectHtml('education', educationLevels, data.education)) +
      fieldHtml('experience', 'الخبرة والمهنة (اختياري)',
        '<textarea id="bk-experience" data-bk="experience" rows="3" placeholder="مثال: 3 سنوات عامل إنتاج في معمل أغذية — خبرة تشغيل خط تعبئة.">' +
        UI.esc(data.experience) + '</textarea>', null, false);
  }
  function validateEdu() {
    if (!data.education) return { education: 'اختر مستواك التعليمي.' };
    return null;
  }

  /* ---------- 7) الدفع بالبطاقة ---------- */
  function renderPay(host) {
    host.innerHTML = stepHead('الدفع — البطاقة المصرفية',
      'تثبيت الحجز ودفع رسم الاستمارة الرسمية (' + Store.money(feeAmount()) + ') ببطاقتك المصرفية.', 'card') +
      '<div class="bk-cardvis" aria-hidden="true">' +
        '<div class="bk-cardvis-top"><span class="bk-chip"></span>' +
        '<span class="bk-cardvis-brandbox">' + UI.ic('card') + '<span class="bk-brand" id="bk-brand-view">بطاقة مصرفية</span></span></div>' +
        '<div class="bk-cardvis-num mono" id="bk-num-view">•••• •••• •••• ••••</div>' +
        '<div class="bk-cardvis-foot">' +
          '<div><span class="bk-cardvis-k">CARD HOLDER</span><span class="bk-cardvis-v" id="bk-name-view">الاسم على البطاقة</span></div>' +
          '<div><span class="bk-cardvis-k">EXPIRES</span><span class="bk-cardvis-v mono" id="bk-exp-view">MM/YY</span></div>' +
        '</div>' +
      '</div>' +
      fieldHtml('cardNumber', 'رقم البطاقة',
        inputHtml('cardNumber', 'text', '0000 0000 0000 0000', data.cardNumber, 'inputmode="numeric" dir="ltr" style="text-align:right" autocomplete="cc-number"'),
        'قبول: Visa · MasterCard · بطاقات Qi والدفع الإلكتروني العراقية.') +
      fieldHtml('cardName', 'الاسم على البطاقة',
        inputHtml('cardName', 'text', 'كما هو مطبوع على البطاقة', data.cardName)) +
      '<div class="grid grid-2" style="gap:0 14px">' +
        fieldHtml('cardExp', 'تاريخ الانتهاء',
          inputHtml('cardExp', 'text', 'MM/YY', data.cardExp, 'inputmode="numeric" dir="ltr" style="text-align:right" autocomplete="cc-exp"')) +
        fieldHtml('cardCvv', 'رمز الأمان CVV',
          inputHtml('cardCvv', 'password', '•••', data.cardCvv, 'inputmode="numeric" dir="ltr" style="text-align:right" maxlength="4" autocomplete="cc-csc"'),
          'الأرقام الثلاثة خلف البطاقة.') +
      '</div>' +
      '<div class="bk-fee">' + UI.ic('money') +
        '<span>رسم الاستمارة الرسمية</span><b>' + Store.money(feeAmount()) + '</b></div>' +
      '<div class="bk-secure">' + UI.ic('lock') +
        '<span><b>بياناتك مصانة:</b> يُتحقَّق من البطاقة ويُحفظ منها الحد الأدنى المقنَّع فقط (النوع وآخر 4 أرقام)، ولا يُرسل رقمها الكامل ولا رمز CVV في أي رسالة، ولا تُشارك بياناتك مع أي طرف ثالث.</span></div>';
  }

  function validatePay() {
    var d = digits(data.cardNumber);
    if (!d) return { cardNumber: 'أدخل رقم البطاقة المطبوع على وجهها.' };
    if (!luhn(d)) return { cardNumber: 'رقم البطاقة غير صحيح — تأكد من الأرقام كما هي مطبوعة على البطاقة.' };
    if (!validName(data.cardName)) return { cardName: 'اكتب اسم حامل البطاقة كما هو مطبوع عليها (كلمتان على الأقل).' };
    if (!validExpiry(data.cardExp)) return { cardExp: 'أدخل تاريخ انتهاء صالحاً بصيغة شهر/سنة (MM/YY) وغير منتهٍ.' };
    var cvvLen = cardBrand(d).key === 'amex' ? 4 : 3;
    if (digits(data.cardCvv).length !== cvvLen) return { cardCvv: 'رمز CVV يجب أن يكون ' + cvvLen + ' أرقام.' };
    return null;
  }

  /* ---------- 8) المراجعة والتأكيد ---------- */
  function summaryRows() {
    var j = data.job && Store.getJob ? Store.getJob(data.job) : null;
    var d = digits(data.cardNumber);
    var rows = [
      ['الاسم الكامل', data.fullname],
      ['الوظيفة المحجوزة', j ? (j.code + ' — ' + j.title) : data.job],
      ['رقم الهاتف', data.phone],
      ['تاريخ الميلاد', data.dob ? Store.fmtDate(data.dob) : ''],
      ['الجنس', data.gender],
      ['المنطقة', data.region],
      ['العنوان', data.address],
      ['المستوى التعليمي', data.education]
    ];
    if (data.experience) rows.push(['الخبرة', data.experience]);
    rows.push(['البطاقة المصرفية', cardBrand(d).label + ' · •••• ' + (d.slice(-4) || '----') + ' · تنتهي ' + (data.cardExp || '—')]);
    rows.push(['رسم الاستمارة', Store.money(feeAmount())]);
    return rows.map(function (r) {
      return '<div class="bk-sum-row"><span class="k">' + UI.esc(r[0]) + '</span><span class="v">' + UI.esc(r[1]) + '</span></div>';
    }).join('');
  }

  function renderReview(host) {
    host.innerHTML = stepHead('مراجعة الحجز',
      'تأكد من صحة بياناتك قبل التثبيت — يمكنك الرجوع لتعديل أي خطوة.') +
      '<div class="bk-summary">' + summaryRows() + '</div>' +
      '<label class="bk-check">' +
        '<input type="checkbox" id="bk-agree" data-bk="agree"' + (data.agree ? ' checked' : '') + '>' +
        '<span>أقرّ بصحة البيانات أعلاه وأوافق على <b>سياسة الخصوصية وشروط الحجز</b> لدى شركة الهدف للتوظيف: حجز الوظيفة مؤقت <b>24 ساعة</b> بانتظار نتيجة المقابلة، وخدمات الشركة فنية وتخصصية لا أمنية.</span>' +
      '</label>' +
      '<span class="bk-err" data-bk-err="agree">' + UI.ic('alert') + '<span></span></span>';
  }
  function validateReview() {
    if (!data.agree) return { agree: 'يجب الموافقة على الشروط قبل تثبيت الحجز.' };
    return null;
  }

  /* ======================= شاشة النجاح ======================= */
  function renderSuccess(rec) {
    var wrap = m.root.querySelector('#bk-wrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="bk-success">' +
        '<div class="bk-success-ic">' + UI.ic('check-circle') + '</div>' +
        '<h4>تم استلام حجزك بنجاح</h4>' +
        '<p class="muted small mb-1">رقم الحجز المرجعي — احتفظ به للمتابعة:</p>' +
        '<div class="bk-ref mono" dir="ltr">' + UI.esc(rec.ref) + '</div>' +
        '<div class="bk-summary mt-2" style="text-align:right">' +
          '<div class="bk-sum-row"><span class="k">الاسم</span><span class="v">' + UI.esc(rec.fullName) + '</span></div>' +
          '<div class="bk-sum-row"><span class="k">الوظيفة</span><span class="v">' + UI.esc(rec.jobCode + ' — ' + rec.jobTitle) + '</span></div>' +
          '<div class="bk-sum-row"><span class="k">الهاتف</span><span class="v" dir="ltr">' + UI.esc(rec.phone) + '</span></div>' +
          '<div class="bk-sum-row"><span class="k">رسم الاستمارة</span><span class="v">' + Store.money(rec.fee) + '</span></div>' +
          '<div class="bk-sum-row"><span class="k">تاريخ الحجز</span><span class="v" dir="ltr">' + UI.esc(Store.fmtDateTime(rec.createdAt)) + '</span></div>' +
        '</div>' +
        '<p class="tiny muted mt-2 mb-0">' + UI.ic('phone') +
          ' سيتواصل معك موظف الشركة على رقمك خلال أوقات العمل لتثبيت الحجز وإصدار استمارتك الرسمية.</p>' +
      '</div>';
    setFoot(
      '<a class="btn btn-ok" id="bk-send-wa" href="' + waNotifyUrl(rec) + '" target="_blank" rel="noopener">' +
        UI.ic('whatsapp') + ' إبلاغ الشركة عبر واتساب</a>' +
      '<button class="btn btn-outline" data-bk-done>' + UI.ic('check') + ' تم، إغلاق النافذة</button>');
    var done = m.root.querySelector('[data-bk-done]');
    if (done) done.addEventListener('click', close);
    UI.toast('ok', 'تم استلام حجزك', 'رقم الحجز: ' + rec.ref + ' — احتفظ به للمتابعة مع الشركة.', 7000);
  }

  /* ======================= إسناد الحجز ======================= */
  function commit() {
    var j = Store.getJob ? Store.getJob(data.job) : null;
    if (!j || j.status !== 'available') {
      UI.toast('err', 'تعذّر التثبيت', 'هذه الوظيفة لم تعد متاحة — اختر وظيفة أخرى.');
      var ji = -1;
      for (var i = 0; i < steps.length; i++) if (steps[i].id === 'job') ji = i;
      if (ji >= 0) { idx = ji; renderStep(); } else close();
      return;
    }
    var d = digits(data.cardNumber);
    var all = readAll();
    all.counter += 1;
    var rec = {
      ref: 'HRC-BK-' + pad(all.counter, 6),
      createdAt: new Date().toISOString(),
      fullName: data.fullname.trim(),
      phone: digits(data.phone),
      dob: data.dob,
      gender: data.gender,
      region: data.region,
      address: data.address.trim(),
      education: data.education,
      experience: (data.experience || '').trim(),
      jobCode: j.code,
      jobTitle: j.title,
      jobRegion: j.region,
      jobShift: j.shift,
      fee: feeAmount(),
      /* مقنّع عمداً — لا رقم كامل ولا CVV (انظر رأس الملف) */
      card: { brand: cardBrand(d).label, last4: d.slice(-4), expiry: data.cardExp, holder: data.cardName.trim() },
      status: 'new'
    };
    all.items.push(rec);
    if (canStore()) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch (e) {
        mem = all;
        UI.toast('warn', 'تنبيه تخزين', 'امتلأت مساحة التخزين — حجزك صالح لكن أبلغ الشركة عبر واتساب الآن.', 6500);
      }
    } else {
      mem = all;
    }
    clearDraft();
    return rec;
  }

  /* رسالة واتساب للمكتب: التفاصيل كاملة مع بطاقة مقنّعة فقط */
  function waNumber() {
    var raw = (CFG.company && CFG.company.whatsapp) ||
      (CFG.company && CFG.company.phones && CFG.company.phones[0]) || '07760058007';
    var d = String(raw).replace(/\D/g, '');
    if (d.indexOf('00') === 0) d = d.slice(2);
    else if (d.charAt(0) === '0') d = '964' + d.slice(1);
    return d;
  }
  function waNotifyUrl(rec) {
    var msg = 'مرحباً شركة الهدف للتوظيف،\n' +
      'سجّلت حجزاً إلكترونياً من الموقع:\n' +
      '• رقم الحجز: ' + rec.ref + '\n' +
      '• الوظيفة: ' + rec.jobCode + ' — ' + rec.jobTitle + '\n' +
      '• الاسم: ' + rec.fullName + '\n' +
      '• الهاتف: ' + rec.phone + '\n' +
      '• المنطقة: ' + rec.region + '\n' +
      '• البطاقة: ' + rec.card.brand + ' •••• ' + rec.card.last4 + '\n' +
      '• رسم الاستمارة: ' + Store.money(rec.fee) + '\n' +
      'أرجو تثبيت الحجز. شكراً لكم.';
    return 'https://wa.me/' + waNumber() + '?text=' + encodeURIComponent(msg);
  }

  /* ======================= تسيير الخطوات ======================= */
  function showErrors(errs) {
    if (!errs) return;
    Object.keys(errs).forEach(function (k) {
      var f = m.root.querySelector('[data-bk-field="' + k + '"]');
      var e = m.root.querySelector('[data-bk-err="' + k + '"]');
      if (e) { var s = e.querySelector('span'); if (s) s.textContent = errs[k]; e.classList.add('show'); }
      if (f) f.classList.add('has-error');
    });
  }
  function clearErrors() {
    m.root.querySelectorAll('.bk-field.has-error').forEach(function (f) { f.classList.remove('has-error'); });
    m.root.querySelectorAll('.bk-err.show').forEach(function (e) { e.classList.remove('show'); });
  }

  function renderStep() {
    if (!m) return;
    var wrap = m.root.querySelector('#bk-wrap');
    var st = steps[idx];
    clearErrors();
    wrap.innerHTML = progressHtml() + jobStripHtml() +
      '<div class="bk-step" data-bk-step="' + st.id + '" id="bk-step"></div>';
    var host = wrap.querySelector('#bk-step');
    st.render(host);
    bindFields(host);
    renderFoot();

    var first = host.querySelector('input:not([type=checkbox]), select, textarea');
    if (first && idx > 0) setTimeout(function () { try { first.focus(); } catch (e) {} }, 40);
  }

  function renderFoot() {
    var last = idx === steps.length - 1;
    var h = '';
    if (idx > 0) h += '<button class="btn btn-outline" data-bk-prev>' + UI.ic('arrow-right') + ' السابق</button>';
    if (last) {
      h += '<button class="btn btn-gold btn-lg" data-bk-confirm id="bk-confirm">' +
        UI.ic('check-circle') + (busy ? ' جارٍ تثبيت الحجز…' : ' تأكيد الحجز ودفع الرسم') + '</button>';
    } else {
      h += '<button class="btn btn-gold" data-bk-next>التالي ' + UI.ic('arrow-left') + '</button>';
    }
    h += '<span class="bk-foot-note tiny muted">الخطوة ' + (idx + 1) + ' من ' + steps.length + '</span>';
    setFoot(h);
  }

  function setFoot(html) {
    var foot = m.root.querySelector('.modal-foot');
    if (!foot) return;
    foot.innerHTML = html;
    var prev = foot.querySelector('[data-bk-prev]');
    var next = foot.querySelector('[data-bk-next]');
    var conf = foot.querySelector('[data-bk-confirm]');
    if (prev) prev.addEventListener('click', function () { if (idx > 0) { idx--; renderStep(); } });
    if (next) next.addEventListener('click', goNext);
    if (conf) conf.addEventListener('click', onConfirm);
  }

  /* قراءة القيم من الحقول إلى الحالة عند كل تغيير */
  function bindFields(host) {
    host.querySelectorAll('[data-bk]').forEach(function (el) {
      var key = el.getAttribute('data-bk');
      var ev = el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date' ? 'change' : 'input';
      el.addEventListener(ev, function () {
        if (el.type === 'checkbox') data[key] = el.checked;
        else if (key === 'cardNumber') {
          var f = formatCardNumber(el.value);
          if (el.value !== f) el.value = f;
          data[key] = f;
        } else if (key === 'cardExp') {
          var v = digits(el.value).slice(0, 4);
          var out = v.length >= 3 ? v.slice(0, 2) + '/' + v.slice(2) : v;
          if (el.value !== out) el.value = out;
          data[key] = out;
        } else if (key === 'phone' || key === 'cardCvv') {
          var dd = key === 'cardCvv' ? digits(el.value).slice(0, 4) : digits(el.value).slice(0, 11);
          if (el.value !== dd) el.value = dd;
          data[key] = dd;
        } else {
          data[key] = el.value;
        }
        /* إزالة الخطأ فور التصحيح */
        var f = el.closest('.bk-field');
        if (f && f.classList.contains('has-error')) {
          f.classList.remove('has-error');
          var e = f.querySelector('.bk-err'); if (e) e.classList.remove('show');
        }
        /* معاينة البطاقة الحيّة */
        if (key === 'cardNumber') {
          var nv = m.root.querySelector('#bk-num-view');
          var bv = m.root.querySelector('#bk-brand-view');
          if (nv) nv.textContent = formatCardNumber(el.value) || '•••• •••• •••• ••••';
          var br = cardBrand(digits(el.value));
          if (bv) bv.textContent = digits(el.value) ? br.label : 'بطاقة مصرفية';
        }
        if (key === 'cardName') {
          var nm = m.root.querySelector('#bk-name-view');
          if (nm) nm.textContent = el.value.trim() || 'الاسم على البطاقة';
        }
        if (key === 'cardExp') {
          var ex = m.root.querySelector('#bk-exp-view');
          if (ex) ex.textContent = el.value || 'MM/YY';
        }
        if (key !== 'cardNumber' && key !== 'cardName' && key !== 'cardExp' && key !== 'cardCvv') saveDraft();
      });
      /* Enter = التالي */
      if (el.tagName !== 'TEXTAREA') {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && idx < steps.length - 1) { e.preventDefault(); goNext(); }
        });
      }
    });
  }

  function goNext() {
    if (!m || busy) return;
    var errs = steps[idx].validate();
    if (errs) { clearErrors(); showErrors(errs); UI.toast('warn', 'بيانات ناقصة', 'راجع الحقل المعلَّم بالأحمر ثم أكمل.', 4000); return; }
    if (idx < steps.length - 1) { idx++; renderStep(); }
  }

  function onConfirm() {
    if (!m || busy) return;
    var errs = steps[idx].validate();
    if (errs) { clearErrors(); showErrors(errs); return; }
    busy = true;
    var btn = m.root.querySelector('#bk-confirm');
    if (btn) { btn.disabled = true; btn.innerHTML = UI.ic('refresh') + ' جارٍ تثبيت الحجز…'; }
    /* محاكاة معالجة الدفع (لا خادم): ثانية واحدة ثم التسليم */
    setTimeout(function () {
      var rec = commit();
      busy = false;
      if (rec) renderSuccess(rec);
    }, 1100);
  }

  /* ======================= الربط العام ======================= */
  /* مستوى المستند: يلتقط كل زر «احجز» — الثابت في الترويسة والأقسام،
     والمولَّد لحظياً في بطاقات الوظائف ونافذة التفاصيل بعد كل إعادة رسم. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-action="open-booking"]');
    if (!b) return;
    e.preventDefault();
    open({ code: b.getAttribute('data-code') || null });
  });

  /* ======================= الواجهة العامة ======================= */
  root.HRCBooking = {
    open: open,
    close: close,
    list: function () { return readAll().items.slice(); },
    count: function () { return readAll().items.length; },
    /* الحالة الحالية للنافذة — للاختبارات والتشخيص */
    state: function () { return { idx: idx, step: steps[idx] ? steps[idx].id : null, data: JSON.parse(JSON.stringify(data)) }; },
    /* أدوات مساعدة للاختبارات */
    _luhn: luhn, _cardBrand: cardBrand, _validPhone: validPhone, _validExpiry: validExpiry
  };
  if (typeof module === 'object' && module.exports) module.exports = root.HRCBooking;
})(typeof window !== 'undefined' ? window : globalThis);
