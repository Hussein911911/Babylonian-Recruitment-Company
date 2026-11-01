/* بطاقتي: عرض مقنّع بالباركود، وتقديم عبر apply.html للبطاقات الجديدة.
   إعادة طباعة الاستمارة تتطلب رمز التحقق عند الحاجة؛ طباعة البطاقة للموظفين فقط. */
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
  var posResult = null;  // نتيجة تفعيل نقطة البيع { app, attempt, job }
  var routeErr = '';     // خطأ توجيه مسح الباركود
  var posDraft = null;   // مسوّدة استمارة الزبون (قبل ضغطة «إتمام» من الزبون)
  var posStep = 1;       // خطوة المعالج الحالية: كل معلومة بصفحة لحدها (1..6)
  var POS_STEPS = 6;     // نقطة البيع · الاسم · الهاتف · العنوان · الجنس/الميلاد · الوظيفة
  var jobF = { q: '', gov: '', shift: '' };   // فلاتر متصفح الوظائف (الخطوة 6) — المحافظة وحدها
  var posErr = '';      // سبب فشل «إتمام» الأخير — يبقى معروضاً داخل الشاشة لا توستاً يختفي بعد ثوانٍ
  var applyJob = '';    // كود الوظيفة القادم من زر «قدّم ببطاقتك» — يُمرَّر لصفحة التقديم
  var gen = 0;          // جيل النافذة: نتيجة قراءة قديمة لا تُكتب في نافذة أُعيد فتحها
  var entryCamStop = null;   // يُغلق كاميرا شاشة الدخول نهائياً عند مغادرتها
  var entryCamPause = null;  // يوقف البث مؤقتاً (إخفاء التبويب) دون إغلاق الشاشة
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && entryCamPause) { try { entryCamPause(); } catch (e) { } }
    });
  }

  /* ======================= أدوات ======================= */
  function esc(v) { return UI.esc(String(v == null ? '' : v)); }

  function availableJobs() {
    try {
      return (Store.listJobs() || []).filter(function (j) { return j.status === 'available'; });
    } catch (e) { return []; }
  }

  /* تنظيف متسامح لما يكتبه الزبون: مسافات وحروف صغيرة وشرطات زائدة،
     وصيغة البطاقة القديمة الملتصقة (HRCBC000117) تُكمَّل إلى HRC-BC-000117
     حتى لا يُرفض رقم مطبوع صحيح بسبب شكل الكتابة. */
  function cleanSerial(v) {
    var s = String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
    var m = /^(?:HRC)?-?BC-?(\d{6})$/.exec(s) || /^(\d{6})$/.exec(s);
    if (m) return 'HRC-BC-' + m[1];
    /* باركود البطاقة الجديد 10 خانات بلا شرطات — أي شرطة زائدة تُزال */
    return s.replace(/-/g, '');
  }

  function serialPattern(v) {
    return Store.isCardSerial(cleanSerial(v));
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

  /* ======================= 1) الدخول بالباركود =======================
   * شاشة واحدة لمسارين: «قدّم ببطاقتك» من وظيفة → إدخال/مسح الباركود ثم
   * apply.html?form=<الباركود>[&job=<كود الوظيفة>] التي تقرأ البطاقة وتُكمل
   * التقديم، و«بطاقتي» للحالة وإعادة الطباعة (الزر الثانوي كما كان).
   * ================================================================== */
  function applyPageAvailable() {
    /* لا صفحة تقديم في الملف المستقل ولا عند الفتح من القرص */
    try {
      if (!location || location.protocol === 'file:') return false;
      if (document.getElementById('route-site') || document.getElementById('route-dashboard')) return false;
    } catch (e) { return false; }
    return true;
  }
  function applyPageUrl(s) {
    return 'apply.html?form=' + encodeURIComponent(s) + (applyJob ? '&job=' + encodeURIComponent(applyJob) : '');
  }
  function goApply(s) {
    if (!applyPageAvailable()) return false;
    try { location.assign(applyPageUrl(s)); } catch (e) { return false; }
    return true;
  }

  /* مسح باركود البطاقة (كاميرا أو صورة) ثم فتح صفحة التقديم.
     file: صورة جاهزة من «ارفع صورة للباركود» — تُقرأ بلا فتح الكاميرا. */
  function openScan(file) {
    var scan = root.HRCQRScan;
    function manual(reason) {
      UI.toast('warn', 'المسح غير متاح', reason + ' — اكتب رقم البطاقة يدوياً في الحقل.');
      var f = document.getElementById('bk-serial');
      if (f) { try { f.focus(); } catch (e) { } }
    }
    function serialFromText(text) {
      return (scan && scan.serialFrom) ? scan.serialFrom(text) : '';
    }
    function accept(text) {
      var code = serialFromText(text);
      if (!code) {
        UI.toast('warn', 'باركود غير معروف',
          'الرمز الممسوح ليس باركود بطاقة توظيف — امسح الباركود المطبوع على وجه البطاقة، أو اكتب الرقم يدوياً.');
        return;
      }
      serial = code;
      var inp = document.getElementById('bk-serial');
      if (inp) inp.value = code;
      setErr('serial', '');
      doApply();   /* doApply يطبّع الرقم ويعكس التطبيع في الحقل */
    }

    /* صورة مرفوعة من الشاشة نفسها: قراءة مباشرة بلا كاميرا ولا نافذة ثانية */
    if (file) {
      if (scanBusy) return;
      scanBusy = true;
      var btn = document.getElementById('bk-scan');
      if (btn) btn.classList.add('is-busy');
      var src = (typeof createImageBitmap === 'function')
        ? Promise.resolve(createImageBitmap(file)).catch(function () { return file; })
        : Promise.resolve(file);
      src.then(function (bmp) { return scan.detectImage(bmp); })
        .then(function (vals) {
          scanBusy = false;
          if (btn) btn.classList.remove('is-busy');
          if (vals && vals.length) return accept(vals[0]);
          UI.toast('warn', 'لم يُقرأ الباركود', 'جرّب صورة أوضح وأقرب للكيو آر، أو اكتب الرقم يدوياً.');
        })
        .catch(function () {
          scanBusy = false;
          if (btn) btn.classList.remove('is-busy');
          UI.toast('warn', 'تعذّرت قراءة الصورة', 'جرّب صورة أوضح أو أدخل الرقم يدوياً.');
        });
      return;
    }

    if (!scan || !scan.supported()) return manual('هذا المتصفح لا يدعم مسح الباركود بالكاميرا');
    /* الرمز غير المطابق يُشرح داخل نافذة المسح نفسها (validate) بدل إغلاقها
       برسالة خطأ ثم إعادة الفتح — تجربة أهدأ للزبون. */
    if (!scan.open({
      title: 'مسح باركود البطاقة',
      subtitle: 'وجّه الكاميرا إلى الباركود المطبوع على وجه بطاقتك — أو ارفع صورة له.',
      validate: function (text) { return !!serialFromText(text); },
      onResult: accept
    })) manual('تعذّر فتح نافذة الكاميرا');
  }

  /* يرسم وجه البطاقة البصري من الرقم (بصمة بصرية لا أكثر — لا تُرسل لأي جهة) */
  function paintCardFace() {
    var v = cleanSerial(serial);
    var face = document.querySelector('.bk-card');
    var num = document.querySelector('.bk-card-num');
    if (!face || !num) return;
    num.textContent = v || '• • • • • •';
    face.classList.toggle('has-code', !!v);
    /* أعد توليد مربّع الكيو آر في الشريط وفي منصّة القراءة والعدسة معاً */
    var uri = qrImage(v);
    var strip = face.querySelector('.bk-card-bc');
    if (strip) strip.style.backgroundImage = 'url("' + uri + '")';
    /* الباركود في الشريط فقط — منصّة المسح صارت كاميرا حيّة */
  }

  /* يعكس الرقم المطبَّع داخل الحقل ووجه البطاقة (بعد المسح أو التطبيع) */
  function paintSerialField() {
    var inp = document.getElementById('bk-serial');
    if (inp && String(inp.value || '') !== String(serial || '')) inp.value = serial || '';
    paintCardFace();
  }

  /* الزر الأساسي: صيغة صحيحة ثم صفحة التقديم (أو الحالة داخل النافذة محلياً) */
  function doApply() {
    var v = cleanSerial(serial);
    if (!serialPattern(v)) {
      setErr('serial', 'اكتب الباركود كما هو مطبوع على البطاقة — 10 خانات من حروف وأرقام، أو استخدم زر المسح.');
      return;
    }
    serial = Store.normalizeCardSerial ? Store.normalizeCardSerial(v) : v;
    setErr('serial', '');
    paintSerialField();
    if (goApply(serial)) return;
    UI.toast('info', 'وضع العرض', 'صفحة التقديم تعمل على الموقع المنشور — سنعرض بطاقتك هنا لمتابعة الفرص.');
    doLookup();
  }

  /* ---------------- واجهة الدخول: لوحة واحدة تتبدّل ----------------
   * بدل رصف أزرار فوق بعضها: وجه بطاقة صغير للتعريف، ثم مبدّل واحد
   * «مسح الباركود ⟷ كتابة الرقم» بحركة شريط واحدة، ولوحة واحدة تظهر
   * حسب الاختيار. زر واحد رئيسي في كل وضع، ومسارا المساعدة في التذييل.
   * ------------------------------------------------------------------ */
  var scanBusy = false;

  function scannerSupported() {
    return !!(root.HRCQRScan && root.HRCQRScan.supported && root.HRCQRScan.supported());
  }

  /* ──────────────────────────────────────────────────────────────────────
   *  مربّع الكيو آر — كيو آر كود حقيقي
   *  يُولَّد بمولّد المشروع (assets/js/qr.js · ISO/IEC 18004) من رابط بطاقة
   *  الزبون نفسه (apply.html?form=…) — أي أن مسحه بالكاميرا يفتح استمارته.
   *  ويُعاد كـ data-URI ليُستخدم في المربع وفي العدسة المكبّرة معاً.
   * ────────────────────────────────────────────────────────────────────── */
  function cardLink(serial) {
    var s = cleanSerial(serial);
    if (!s) return '';
    try {
      if (Store && Store.cardUrl) return Store.cardUrl(s);
    } catch (e) { }
    return 'apply.html?form=' + encodeURIComponent(s);
  }

  /* كيو آر احتياطي (شكل فقط) إن لم يكن مولّد QR محمّلاً */
  function fallbackQrSvg(text) {
    var n = 25, seed = 7, path = '';
    for (var i = 0; i < text.length; i++) seed = (seed * 131 + text.charCodeAt(i)) % 100003;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        var finder = (r < 7 && c < 7) || (r < 7 && c > n - 8) || (r > n - 8 && c < 7);
        var edge = (r === 0 || c === 0 || r === 6 || c === 6 ||
          r === n - 7 || c === n - 7 || r === n - 1 || c === n - 1);
        var on = finder ? edge || (r > 1 && r < 5 && c > 1 && c < 5) : (seed % 2 === 0);
        if (on) path += 'M' + c + ' ' + r + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" shape-rendering="crispEdges">' +
      '<rect width="25" height="25" fill="#ffffff"/>' +
      '<path fill="#0d1f42" d="' + path + '"/></svg>';
  }

  /* صورة الكيو آر (data-URI) لرقم بطاقة معيّن */
  function qrImage(serial) {
    var text = cardLink(serial) || 'HRC-CARD';
    var svg = '';
    try {
      if (root.HRCQR && root.HRCQR.encode && root.HRCQR.renderSVG) {
        svg = root.HRCQR.renderSVG(root.HRCQR.encode(text, 'M'), { margin: 2, dark: '#0d1f42', light: '#ffffff' });
      }
    } catch (e) { svg = ''; }
    if (!svg) svg = fallbackQrSvg(text);
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /* شريط تعريف البطاقة: هوية الشركة + مربّع الكيو آر + الرقم */
  function cardStripHtml() {
    var v = cleanSerial(serial);
    return '<div class="bk-card">' +
      '<span class="bk-card-qr bk-card-bc" aria-hidden="true" style="background-image:url(&quot;' + qrImage(v) + '&quot;)"></span>' +
      '<span class="bk-card-main">' +
        '<span class="bk-card-brand">' + UI.ic('emblem') + ' بطاقة التوظيف</span>' +
        '<span class="bk-card-num" dir="ltr">' + (v ? esc(v) : '• • • • • •') + '</span>' +
      '</span>' +
      '<span class="bk-card-tags"><b>فرص حسب البطاقة</b><b>٣٠ يوماً</b></span>' +
    '</div>';
  }

  /* ──────────────────────────────────────────────────────────────────────
   *  منصّة المسح: كاميرا حيّة داخل الشاشة
   *  كان هنا مربّع كيو آر «توضيحي» مع عدسة متحركة — لكنه كان يوهم الزبون بأن
   *  عليه مسح الشاشة نفسها، ولا يفتح الكاميرا إلا بزر منفصل في نافذة أخرى.
   *  الآن: إطار كاميرا حقيقي في مكانه، يُشغَّل بزر واحد، ويقرأ الباركود مباشرة
   *  ويحوّله إلى شاشة التقديم — بلا نوافذ متداخلة.
   * ────────────────────────────────────────────────────────────────────── */
  function scannerHtml() {
    return '<div class="bk-scanner">' +
      '<div class="bk-cam" id="bk-cam" data-state="idle">' +
        '<video id="bk-cam-video" playsinline muted autoplay aria-label="كاميرا مسح باركود البطاقة"></video>' +
        '<span class="bk-corner tl" aria-hidden="true"></span>' +
        '<span class="bk-corner tr" aria-hidden="true"></span>' +
        '<span class="bk-corner bl" aria-hidden="true"></span>' +
        '<span class="bk-corner br" aria-hidden="true"></span>' +
        '<span class="bk-cam-line" aria-hidden="true"></span>' +
        '<div class="bk-cam-overlay" id="bk-cam-overlay" aria-live="polite">' +
          '<span class="bk-cam-ic">' + UI.ic('scan') + '</span>' +
          '<b id="bk-cam-title">الكاميرا متوقفة</b>' +
          '<span class="bk-cam-sub" id="bk-cam-sub">اضغط «تشغيل الكاميرا» ثم وجّهها نحو الباركود المطبوع على وجه بطاقتك.</span>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="btn btn-gold bk-cta" id="bk-cam-toggle">' +
        UI.ic('scan') + ' تشغيل الكاميرا</button>' +
      '<div class="bk-cam-alt">' +
        '<label class="bk-link" for="bk-scan-file">' + UI.ic('upload') + ' رفع صورة للباركود</label>' +
        '<span class="bk-dot" aria-hidden="true">•</span>' +
        '<button type="button" class="bk-link" id="bk-cam-manual">' + UI.ic('edit') + ' كتابة الرقم يدوياً</button>' +
        '<input type="file" id="bk-scan-file" accept="image/*" hidden>' +
      '</div>' +
      '<p class="bk-scanner-hint">' + UI.ic('lock') +
        ' الباركود مطبوع على وجه البطاقة تحت شعار الشركة — القراءة تجري داخل جهازك ولا تُرسَل صورة.</p>' +
    '</div>';
  }

  function renderEntry(host) {
    var fromJob = !!applyJob;
    var canScan = scannerSupported();
    host.innerHTML =
      '<div class="bk-entry bk-sheet" id="bk-sheet">' +

        '<div class="bk-top">' +
          '<span class="bk-eyebrow">' + UI.ic(fromJob ? 'briefcase' : 'card') +
            (fromJob ? ' التقديم على وظيفة' : ' بطاقة التوظيف') + '</span>' +
          (fromJob
            ? '<span class="bk-jobtap">' + UI.ic('check-circle') +
                '<b class="mono" dir="ltr">' + esc(applyJob) + '</b></span>'
            : '') +
        '</div>' +

        cardStripHtml() +

        '<div class="bk-switch" role="tablist" aria-label="طريقة إدخال البطاقة">' +
          '<span class="bk-switch-thumb" aria-hidden="true"></span>' +
          '<button type="button" class="bk-tab" id="bk-tab-scan" role="tab" aria-selected="true" tabindex="0" aria-controls="bk-panel-scan">' +
            UI.ic('scan') + ' مسح الباركود</button>' +
          '<button type="button" class="bk-tab" id="bk-manual-toggle" role="tab" aria-selected="false" aria-expanded="false" tabindex="-1" aria-controls="bk-manual">' +
            UI.ic('edit') + ' كتابة الرقم</button>' +
        '</div>' +

        /* ── لوحة المسح ── */
        '<section class="bk-panel bk-panel-scan is-open" id="bk-panel-scan" role="tabpanel" aria-labelledby="bk-tab-scan">' +
          scannerHtml() +
        '</section>' +

        /* ── لوحة الكتابة ── */
        '<section class="bk-panel bk-panel-manual" id="bk-manual" role="tabpanel" aria-labelledby="bk-manual-toggle">' +
          fieldHtml('serial', 'باركود البطاقة (10 خانات)',
            '<div class="bk-scan-row">' +
              '<span class="bk-input-ic">' + UI.ic('card') + '</span>' +
              inputHtml('serial', 'text', 'مثال: 7KQ4M9TR2X', serial, 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700;letter-spacing:.1em;text-transform:uppercase" inputmode="latin" autocomplete="off" spellcheck="false" maxlength="18"') +
            '</div>',
            'عشر خانات من حروف وأرقام مطبوعة تحت الباركود.') +
          '<button type="button" class="btn btn-gold bk-cta" id="bk-apply">' + UI.ic('arrow-right') + ' متابعة التقديم</button>' +
        '</section>' +

        '<div class="bk-entry-foot">' +
          '<button type="button" class="bk-footbtn" id="bk-lookup">' +
            '<span class="bk-footbtn-ic">' + UI.ic('search') + '</span>' +
            '<span class="bk-footbtn-t">حالة بطاقتي وإعادة الطباعة</span>' +
          '</button>' +
          (CFG.company && CFG.company.phones && CFG.company.phones[0]
            ? '<a class="bk-footbtn is-wa" href="https://wa.me/' +
              String(CFG.company.phones[0]).replace(/\D/g, '').replace(/^0/, '964') +
              '" target="_blank" rel="noopener">' +
              '<span class="bk-footbtn-ic">' + UI.ic('whatsapp') + '</span>' +
              '<span class="bk-footbtn-t">ما عندي بطاقة؟ اتصل بنا</span>' +
            '</a>'
            : '') +
        '</div>' +
      '</div>';

    /* ---------------- المنطق ---------------- */
    var sheet = document.getElementById('bk-sheet');
    var scanTab = document.getElementById('bk-tab-scan');
    var manTab = document.getElementById('bk-manual-toggle');
    var scanPanel = document.getElementById('bk-panel-scan');
    var manPanel = document.getElementById('bk-manual');
    var camBox = document.getElementById('bk-cam');
    var camVideo = document.getElementById('bk-cam-video');
    var camTitle = document.getElementById('bk-cam-title');
    var camSub = document.getElementById('bk-cam-sub');
    var camToggle = document.getElementById('bk-cam-toggle');
    var camManual = document.getElementById('bk-cam-manual');
    var fileInp = document.getElementById('bk-scan-file');
    var camStream = null, camRaf = null, camWarned = false, camTeardown = false, camGeneration = 0, lastFrame = 0;

    function camSet(state, title, sub) {
      if (camBox) camBox.setAttribute('data-state', state);
      if (title && camTitle) camTitle.textContent = title;
      if (sub && camSub) camSub.textContent = sub;
      if (camToggle) {
        var live = state === 'live';
        camToggle.innerHTML = live
          ? UI.ic('x-circle') + ' إيقاف الكاميرا'
          : UI.ic('scan') + ' تشغيل الكاميرا';
        camToggle.disabled = state === 'starting';
        camToggle.classList.toggle('is-ready', false);
      }
    }

    function stopCam(silent) {
      camGeneration++;
      if (camRaf) { try { cancelAnimationFrame(camRaf); } catch (e) { } camRaf = null; }
      if (camStream) { try { camStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } camStream = null; }
      if (camVideo) { try { camVideo.srcObject = null; } catch (e) { } }
      camWarned = false;
      if (!silent) camSet('idle', 'الكاميرا متوقفة',
        'اضغط «تشغيل الكاميرا» ثم وجّهها نحو الباركود المطبوع على وجه بطاقتك.');
    }

    /* يقبل الرمز الممسوح ثم ينتقل مباشرةً إلى شاشة التقديم */
    function onScanned(text) {
      var scan = root.HRCQRScan;
      var code = (scan && scan.serialFrom) ? scan.serialFrom(text) : '';
      if (!code) {
        if (!camWarned) {
          camWarned = true;
          camSet('live', '', 'هذا الرمز ليس باركود بطاقة توظيف — جرّب الباركود المطبوع على وجه البطاقة.');
          setTimeout(function () { camWarned = false; }, 3200);
        }
        return false;
      }
      stopCam(true);
      serial = code;
      var inp2 = document.getElementById('bk-serial');
      if (inp2) inp2.value = code;
      setErr('serial', '');
      doApply();
      return true;
    }

    function camTick(timestamp) {
      if (!camStream || camTeardown) return;
      if (timestamp && timestamp - lastFrame < 160) { camRaf = requestAnimationFrame(camTick); return; }
      lastFrame = timestamp || 0;
      var generation = camGeneration;
      Promise.resolve(root.HRCQRScan.detectVideoFrame(camVideo)).then(function (vals) {
        if (!camStream || camTeardown || generation !== camGeneration) return;
        if (vals && vals.length && onScanned(vals[0])) return;
        camRaf = requestAnimationFrame(camTick);
      }).catch(function () {
        if (camStream && !camTeardown && generation === camGeneration) camRaf = requestAnimationFrame(camTick);
      });
    }

    function startCam() {
      if (!scannerSupported()) return openScan();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        camSet('error', 'الكاميرا غير متاحة',
          'هذا المتصفح لا يسمح بالكاميرا — ارفع صورة للباركود أو اكتب الرقم يدوياً.');
        return;
      }
      var generation = ++camGeneration;
      camSet('starting', 'جارٍ تشغيل الكاميرا…', 'اسمح للموقع باستخدام الكاميرا من نافذة المتصفح.');
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function (st) {
          if (camTeardown || generation !== camGeneration || document.hidden) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
          camStream = st;
          if (camVideo) {
            camVideo.srcObject = st;
            var pl = camVideo.play();
            if (pl && pl.catch) pl.catch(function () { });
          }
          camSet('live', '', '');
          camTick();
        })
        .catch(function () {
          if (camTeardown || generation !== camGeneration) return;
          camSet('error', 'تعذّر تشغيل الكاميرا',
            'لم يُسمح بالكاميرا أو لا توجد كاميرا. ارفع صورة للباركود أو اكتب الرقم يدوياً.');
        });
    }

    entryCamPause = function () { stopCam(); };
    entryCamStop = function () { camTeardown = true; stopCam(true); };

    var goBtn = document.getElementById('bk-apply');
    var lookBtn = document.getElementById('bk-lookup');
    var inp = document.getElementById('bk-serial');
    var mode = 'scan';

    function paintCard() { paintCardFace(); }

    function setMode(next, focus) {
      mode = next === 'manual' ? 'manual' : 'scan';
      var manual = mode === 'manual';
      sheet.classList.toggle('bk-mode-manual', manual);
      sheet.classList.toggle('bk-mode-scan', !manual);
      if (scanTab) { scanTab.setAttribute('aria-selected', String(!manual)); scanTab.tabIndex = manual ? -1 : 0; }
      if (manTab) { manTab.setAttribute('aria-selected', String(manual)); manTab.setAttribute('aria-expanded', String(manual)); manTab.tabIndex = manual ? 0 : -1; }
      if (scanPanel) scanPanel.classList.toggle('is-open', !manual);
      if (manPanel) manPanel.classList.toggle('is-open', manual);
      if (manual) stopCam(true);          /* لا تبقى الكاميرا تعمل في الخلفية */
      if (manual && focus && inp) setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) { } }, 60);
      paintCard();
    }

    if (scanTab) scanTab.addEventListener('click', function () { setMode('scan'); });
    if (manTab) manTab.addEventListener('click', function () { setMode('manual', true); });
    /* مفاتيح الأسهم بين التبويبين (سلوك tablist المعتاد) */
    [scanTab, manTab].forEach(function (tab) {
      if (!tab) return;
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        setMode(mode === 'scan' ? 'manual' : 'scan', true);
        var t = (mode === 'scan' ? scanTab : manTab);
        if (t) { try { t.focus(); } catch (err) { } }
      });
    });

    if (inp) {
      inp.addEventListener('input', function () {
        var typed = inp.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
        if (typed !== inp.value) inp.value = typed;
        serial = typed;
        setErr('serial', '');
        paintCard();
        if (goBtn) goBtn.classList.toggle('is-ready', !!serialPattern(serial));
      });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doApply(); });
    }
    if (goBtn) goBtn.addEventListener('click', doApply);
    if (lookBtn) lookBtn.addEventListener('click', function () {
      if (!String(serial || '').trim()) {
        setMode('manual', true);
        setErr('serial', 'اكتب رقم البطاقة أو امسحه أولاً لعرض حالتها.');
        return;
      }
      doLookup();
    });
    if (camToggle) camToggle.addEventListener('click', function () {
      if (camStream) stopCam();
      else startCam();
    });
    if (camManual) camManual.addEventListener('click', function () { setMode('manual', true); });
    if (fileInp) fileInp.addEventListener('change', function () {
      var f = fileInp.files && fileInp.files[0];
      if (f) openScan(f);
      try { fileInp.value = ''; } catch (e) { }
    });
    /* إخفاء التبويب يوقف الكاميرا — عبر مستمع واحد على مستوى الوحدة */

    paintCard();
    if (goBtn) goBtn.classList.toggle('is-ready', !!serialPattern(serial));

    /* متصفح بلا قارئ باركود: نبدأ مباشرةً على الكتابة (بلا طريق مسدود) */
    if (!canScan) setMode('manual', false);
    /* رقم جاهز من رابط أو مسح سابق: يظهر على شريط البطاقة ويُعرَض في الكتابة */
    else if (serial && serialPattern(serial)) setMode('manual', false);

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
    var v = cleanSerial(serial);
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
    var my = gen;
    var btn = document.getElementById('bk-lookup');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التحقق…'; }
    setErr('serial', '');
    Promise.resolve(Store.cardLookup(serial)).then(function (r) {
      busy = false;   /* يُفرَّغ دائماً وإلا عُلقت كل العمليات التالية */
      if (my !== gen) return;        /* أُغلقت النافذة أو أُعيد فتحها — لا تكتب هنا */
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('search') + ' اعرض بطاقتي'; }
      if (!r || !r.ok) {
        setErr('serial', (r && r.error) || 'تعذّر العثور على البطاقة — تأكد من الرقم.');
        return;
      }
      card = r.card;
      view = 'status';
      render();
    }).catch(function (e) {
      busy = false;                 /* يُفرَّغ دائماً وإلا عُلقت بقية العمليات */
      if (my !== gen) return;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('search') + ' اعرض بطاقتي'; }
      setErr('serial', 'تعذّر الاتصال — حاول مرة أخرى.');
    });
  }

  /* ======================= 1ب) توجيه مسح الباركود =======================
   * البطاقة الفارغة ← استمارة تعبئة نقطة البيع (لحظة البيع).
   * البطاقة المباعة ← بطاقة الزبون مباشرةً (حُذف مسار صاحب العمل 2026-10-25).
   * ==================================================================== */
  function routeFromHash() {
    view = 'routewait';
    render();
    if (!storeReady() && storeWaits < 25) { storeWaits++; setTimeout(routeFromHash, 120); return; }
    storeWaits = 0;
    if (busy) return;
    busy = true;
    Promise.resolve(Store.cardLookup(serial)).then(function (r) {
      busy = false;
      if (r && r.ok) { card = r.card; view = 'status'; render(); return; }
      if (r && /لم تُبع|فارغة/.test(r.error || '')) { view = 'posfill'; render(); return; }
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
    else body = head('اختيار الوظيفة (اختياري)', 'إن أراد الزبون اختيار وظيفته الآن اخترها له — أو اضغط «تخطّي» فيختار وظائف فرصه المتاحة بنفسه لاحقاً من باركود بطاقته.', 'briefcase') +
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
    var govs = [], shifts = [];
    jobs.forEach(function (j) {
      if (j.governorate && govs.indexOf(j.governorate) < 0) govs.push(j.governorate);
      if (shifts.indexOf(j.shift) < 0) shifts.push(j.shift);
    });
    var sel = function (id, list, cur, allLabel) {
      return '<select id="' + id + '" style="font-size:13.5px;padding:9px 10px">' +
        '<option value="">' + allLabel + '</option>' +
        list.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') + '</select>';
    };
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
        '<input id="bk-jq" type="search" placeholder="ابحث: عنوان الوظيفة أو كودها…" value="' + esc(jobF.q) + '" style="grid-column:1/-1;font-size:14.5px;padding:10px 12px">' +
        sel('bk-jr', govs, jobF.gov, 'كل المحافظات') + sel('bk-js', shifts, jobF.shift, 'كل الدوامات') +
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
        '<span>' + UI.ic('pin') + ' ' + esc(j.governorate || '—') + '</span>' +
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
          (!jobF.gov || j.governorate === jobF.gov) && (!jobF.shift || j.shift === jobF.shift);
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
    if (r) r.addEventListener('change', function () { jobF.gov = r.value; paint(); });
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
      'المحافظة: <b>' + esc(j.governorate || '—') + '</b> · الأجر: <b>' + esc(Store.money(j.salaryMin)) + ' – ' + esc(Store.money(j.salaryMax)) +
      '</b> · الدوام: <b>' + esc(j.shift) + '</b></div>';
  }

  function posBack() { if (posStep > 1) { posStep--; render(); } }

  /* تخطّي اختيار الوظيفة: تُباع البطاقة بفرص فارغة حسب البطاقة ويختار الزبون
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
         وإمّا يتخطّاها فيختار الزبون وظائف فرصه المتاحة بنفسه من باركود بطاقته. */
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
          ? 'راجع بياناتك يا زبون — بالضغط على «إتمام» تُفعَّل بطاقتك بفرص حسب البطاقة وتختار أنت وظائفك لاحقاً من باركود البطاقة.'
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
            'المحافظة: <b>' + esc(job.governorate || '—') + '</b><br>' +
            'الأجر الشهري: <b>' + esc(Store.money(job.salaryMin)) + ' – ' + esc(Store.money(job.salaryMax)) + '</b><br>' +
            'الدوام: <b>' + esc(job.shift) + '</b>' +
          '</div>'
        : skipJob
        ? infoBox('card', '<b>بلا اختيار وظيفة</b> — تُباع البطاقة بفرص فارغة حسب البطاقة، ويختار الزبون وظائفه بنفسه من باركود بطاقته، وتُطبع استمارة A4 لكل وظيفة يختارها. <b>إن أردت اختيار وظيفة الآن</b> ارجع واخترها.')
        : infoBox('alert', 'الوظيفة غير متاحة — ارجع للتعديل واختر وظيفة أخرى.')) +
      (skipJob
        ? '<div class="bk-info">' + UI.ic('clock') + ' بإتمامك: تُفعَّل البطاقة وتصلح <b>30 يوماً</b> بفرص فارغة حسب البطاقة — لا تُستهلك أي فرصة الآن.</div>'
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
    /* أي انكسار متزامن في الطبقة المحلية (دالة ناقصة مثلاً) يجب ألا يترك
       «busy» معلّقاً فيتجمّد الزر والنافذة كلها — لذلك نغلّفه بوعد. */
    var run;
    try {
      run = Promise.resolve(Store.cardActivate(serial, {
        posName: posName, fullName: fullName, phone: phone,
        address: d.address || '', gender: d.gender || 'ذكر', dob: d.dob || '', jobCode: jobCode
      }));
    } catch (e) {
      run = Promise.reject(e);
    }
    run.then(function (r) {
      busy = false;
      if (!r || !r.ok) {
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
            ' <b>البطاقة صارت نشطة بفرص فارغة حسب البطاقة</b> — الزبون يمسح باركود بطاقته بنفسه ويختار وظائفه ' +
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
    host.innerHTML = stepHead('حالة البطاقة', 'الفرص وحالة كل فرصة على حدة — والتواريخ محسوبة لحظياً.', 'list') +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin:4px 0 6px">' +
        '<b dir="ltr">' + esc(card.serial) + '</b>' + cardStatusBadge(card.status) +
        (card.succeeded ? '<span class="chip chip-ok tiny">' + UI.ic('check') + ' تم توظيف بإحدى الفرص</span>' : '') +
      '</div>' +
      '<div class="tiny muted">الاسم: <b>' + esc(card.fullName) + '</b> · الهاتف: <b dir="ltr">' + esc(card.phone) + '</b></div>' +
      '<div class="tiny muted">تنتهي الصلاحية: <b>' + esc(card.expiryDate ? Store.fmtDate(card.expiryDate) : 'تبدأ عند أول تقديم ناجح') + '</b>' +
        ' · الفرص المتاحة: <b>' + esc(card.chancesLeft) + '</b></div>' +
      (card.chances || []).map(function (c, i) { return chanceRow(c, i + 1); }).join('') +
      '<div class="bk-info" style="margin-top:12px">' + UI.ic('clock') +
        ' عند التقديم تُحجز الوظيفة لك <b>24 ساعة</b> بانتظار نتيجة المقابلة؛ وبعدها تقرر الشركة: التوظيف أو إرجاع الوظيفة أو حذفها — والفرصة تُستهلك بالتقديم ولا تعود.</div>' +
      btnRow(
        (canUse && applyPageAvailable() ? '<button class="btn btn-gold" id="bk-apply-page">' + UI.ic('arrow-right') + ' ابدأ التقديم على وظيفة</button>' : '') +
        (canUse ? '<button class="btn ' + (applyPageAvailable() ? 'btn-outline' : 'btn-gold') + '" id="bk-use">' + UI.ic('briefcase') + ' استخدم فرصة على وظيفة</button>' : '') +
        '<button class="btn btn-lapis" id="bk-reprint">' + UI.ic('print') + ' إعادة طباعة استمارة التوظيف</button>' +
        '<button class="btn btn-ghost" id="bk-back">' + UI.ic('arrow-right') + ' بطاقة أخرى</button>');
    var b;
    if ((b = document.getElementById('bk-apply-page'))) b.addEventListener('click', function () { goApply(serial); });
    if ((b = document.getElementById('bk-use'))) b.addEventListener('click', function () {
      if (card.usesCardPrintCode && goApply(serial)) return;
      view = 'use'; render();
    });
    if ((b = document.getElementById('bk-reprint'))) b.addEventListener('click', function () { view = 'reprint'; render(); });
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
            return { v: j.code, t: j.code + ' — ' + j.title + (j.governorate ? ' (' + j.governorate + ')' : '') };
          }), '', 'اختر وظيفة من المتاحة…'),
          'الوظائف المحجوزة والمغلقة لا تظهر هنا.') +
        '<div class="bk-info">' + UI.ic('check-circle') +
        ' لا حاجة لأي رمز — بطاقتك نفسها هي إثباتك، وتُستهلك أول فرصة متاحة تلقائياً.</div>';
    }
    host.innerHTML = stepHead('استخدام فرصة', 'اختر الوظيفة، ونثبّت لك التقديم ببطاقتك مباشرة.', 'briefcase') + inner +
      (jobs.length ? btnRow(
        '<button class="btn btn-gold" id="bk-confirm">' + UI.ic('check') + ' تثبيت التقديم</button>' +
        '<button class="btn btn-ghost" id="bk-cancel">' + UI.ic('arrow-right') + ' رجوع</button>') : btnRow(
        '<button class="btn btn-ghost" id="bk-cancel">' + UI.ic('arrow-right') + ' رجوع</button>'));
    var b;
    var jobSel = document.getElementById('bk-job');
    if (jobSel) jobSel.addEventListener('change', function () { setErr('job', ''); });
    if ((b = document.getElementById('bk-confirm'))) b.addEventListener('click', doUse);
    if ((b = document.getElementById('bk-cancel'))) b.addEventListener('click', function () { view = 'status'; render(); });
  }

  function doUse() {
    var jobSel = document.getElementById('bk-job');
    var jobCode = jobSel ? jobSel.value : '';
    if (!jobCode) { setErr('job', 'اختر الوظيفة التي تريد التقديم عليها.'); return; }
    if (busy) return;
    busy = true;
    var btn = document.getElementById('bk-confirm');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التثبيت…'; }
    Promise.resolve(Store.cardUseChance(serial, jobCode)).then(function (r) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('check') + ' تثبيت التقديم'; }
      if (!r || !r.ok) {
        var msg = (r && r.error) || 'تعذّر تنفيذ التقديم';
        if (/الوظيفة|شاغر/.test(msg)) setErr('job', msg);
        else setErr('job', msg);
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
      setErr('job', 'تعذّر الاتصال — حاول مرة أخرى.');
    });
  }

  /* ======================= 4) إعادة الطباعة ======================= */
  function renderReprint(host) {
    var needsCode = !card || card.usesCardPrintCode !== false;
    host.innerHTML = stepHead('إعادة طباعة استمارة التوظيف',
        needsCode ? 'أدخل رمز التحقق من ظهر البطاقة لطباعة الاستمارة.'
                  : 'بطاقتك لا تحمل أي رمز — الباركود نفسه يكفي لطباعة الاستمارة.', 'print') +
      (needsCode
        ? fieldHtml('rcode', 'رمز التحقق (من ظهر البطاقة)',
            inputHtml('rcode', 'text', 'مثال: 7A2C-9E4B-1D8F-6C03', '', 'dir="ltr" style="direction:ltr;text-align:left;font-weight:700;letter-spacing:.08em" inputmode="latin"'),
            'الرمز المطبوع على ظهر بطاقتك. إن لم يكن لبطاقتك رمز فاتركه فارغاً.')
        : '<div class="bk-info">' + UI.ic('check-circle') + ' لا حاجة لأي رمز — اضغط «اطبع الاستمارة».</div>') +
      '<div class="bk-info">' + UI.ic('alert') +
        UI.ic('file') + ' <b>استمارة التوظيف A4:</b> تحمل بياناتك وبيانات الوظيفة وصاحب العمل — تُسلَّم لصاحب العمل عند المقابلة.</div>' +
      btnRow(
        '<button class="btn btn-lapis" id="bk-print-form">' + UI.ic('file') + ' تحقق واطبع استمارة A4</button>' +
        '<button class="btn btn-ghost" id="bk-cancel">' + UI.ic('arrow-right') + ' رجوع</button>');
    var b;
    var inp = document.getElementById('bk-rcode');
    if (inp) {
      inp.addEventListener('input', function () { setErr('rcode', ''); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doReprint(); });
      setTimeout(function () { try { inp.focus(); } catch (e) { } }, 60);
    }
    if ((b = document.getElementById('bk-print-form'))) b.addEventListener('click', function () { doReprint('form'); });
    if ((b = document.getElementById('bk-cancel'))) b.addEventListener('click', function () { view = 'status'; render(); });
  }

  function doReprint(mode) {
    var inp = document.getElementById('bk-rcode');
    var code = String(inp ? inp.value : '').trim().toUpperCase();
    var needsCode = !card || card.usesCardPrintCode !== false;
    /* بلا رمز مطبوع: الحيازة كافية. مع رمز: يُطلب كاملاً. */
    if (needsCode && code && !/^(?:[A-F0-9]{16}|[0-9]{4}[A-Z]{2})$/.test(code.replace(/[^A-Z0-9]/g, ''))) {
      setErr('rcode', 'أدخل رمز التحقق كاملاً كما هو مطبوع على ظهر بطاقتك.');
      return;
    }
    if (busy) return;
    busy = true;
    var btn = document.getElementById('bk-print-form');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ التحقق…'; }
    Promise.resolve(Store.cardVerify(serial, code)).then(function (r) {
      busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('print') + ' تحقق واطبع'; }
      if (!r || !r.ok) {
        setErr('rcode', (r && r.error) || 'رمز التحقق غير صحيح.');
        return;
      }
      var V = root.HRCVoucher;
      if (!V || !V.printForm) { setErr('rcode', 'قالب طباعة الاستمارة غير متوفر بهذه الصفحة.'); return; }
      try { V.printForm(r.app, null, r.attempts); } catch (e) {
        setErr('rcode', 'تعذّر فتح الطباعة — حاول مرة أخرى.');
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
          ' تذكير: الفرصة تُستهلك بالتقديم ولا تعود بأي نتيجة — وبعد استهلاك فرص البطاقة تُشترى بطاقة جديدة من نقاط البيع.</div>' +
      '</div>' +
      btnRow(
        '<button class="btn btn-lapis" id="bk-reprint2">' + UI.ic('print') + ' اطبع استمارة التوظيف</button>' +
        '<button class="btn btn-gold" id="bk-done">' + UI.ic('check') + ' تم — إغلاق</button>');
    var b;
    if ((b = document.getElementById('bk-reprint2'))) b.addEventListener('click', function () { view = 'reprint'; render(); });
    if ((b = document.getElementById('bk-done'))) b.addEventListener('click', close);
  }

  /* ======================= العرض والفتح ======================= */
  function render() {
    var host = document.getElementById('bk-wrap');
    if (!host || !m) return;
    /* أي انتقال خارج شاشة الدخول يُوقف الكاميرا فوراً */
    if (view !== 'entry' && entryCamStop) { try { entryCamStop(); } catch (e) { } entryCamStop = null; entryCamPause = null; }
    if (view === 'routewait') renderRouteWait(host);
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
    if (entryCamStop) { try { entryCamStop(); } catch (e) { } entryCamStop = null; entryCamPause = null; }
    if (m) { try { m.close(); } catch (e) { } m = null; }
    gen++;                       /* أي رد غير متزامن من نافذة سابقة يُهمَل */
    card = null; doneInfo = null; busy = false;
    applyJob = String(opts.code || '').trim().toUpperCase();
    posResult = null; routeErr = ''; posDraft = null; posStep = 1; jobF = { q: '', gov: '', shift: '' }; posErr = '';
    view = 'entry';
    serial = String(opts.serial || '').trim().toUpperCase();
    m = UI.modal({
      title: applyJob ? 'التقديم على وظيفة — بطاقة التوظيف' : 'بطاقتي — بطاقة التوظيف',
      subtitle: applyJob
        ? 'امسح باركود بطاقتك أو أدخل رقمها للانتقال إلى استمارة التقديم'
        : 'تابع بطاقتك · استخدم فرصتك · أعد طباعتها من أي مكتب استنساخ',
      body: '<div class="bk-wrap" id="bk-wrap"></div>'
    });
    if (!m) return;
    m.root.classList.add('modal-booking');
    /* رابط «صاحب العمل؟ متابعة طلب توظيف» (role=employer) يفتح صفحة صاحب
       العمل مباشرة — بلا بوابة دور وبلا أي رمز (قرار الإدارة 2026-10-06). */
    if (serial && serialPattern(serial) && opts.fromHash) routeFromHash();
    else render();
  }

  function close() {
    if (entryCamStop) { try { entryCamStop(); } catch (e) { } entryCamStop = null; entryCamPause = null; }
    if (m) { try { m.close(); } catch (e) { } m = null; }
    card = null; doneInfo = null; posResult = null; routeErr = ''; posDraft = null; posStep = 1; jobF = { q: '', gov: '', shift: '' }; posErr = ''; applyJob = '';
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
    location.replace('apply.html?form=' + encodeURIComponent(s));
  }

  /* التقاط أزرار «بطاقتي» بكل الصفحة (نفس نقاط الاحجز السابقة) */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-action="open-booking"]') : null;
    if (!t) return;
    e.preventDefault();
    open({ serial: t.getAttribute('data-serial') || '', code: t.getAttribute('data-code') || '' });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openFromHash);
  else openFromHash();

  root.HRCBooking = {
    open: open,
    close: close,
    /* رابط صفحة التقديم لهذا الباركود (يُستعمل من ماسح الباركود في الموقع) */
    applyUrl: function (s) { return applyPageUrl(String(s || '').trim().toUpperCase()); },
    /* تطبيع رقم البطاقة كما يفهمه النظام (متاح للاختبارات ولباقي الواجهات) */
    normalize: cleanSerial,
    canApply: applyPageAvailable,
    /* الحالة الحالية للنافذة — للاختبارات والتشخيص */
    state: function () {
      return {
        view: view, serial: serial, posStep: posStep, job: applyJob, busy: busy,
        card: card ? JSON.parse(JSON.stringify(card)) : null
      };
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.HRCBooking;
})(typeof window !== 'undefined' ? window : globalThis);
