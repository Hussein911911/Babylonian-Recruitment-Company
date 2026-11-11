/* ===========================================================================
 *  HRC Scanner — مسح باركود/QR داخل المتصفح (بلا مكتبات خارجية)
 *  Arabic QR على وجه البطاقة + الباركودات الخطية (Code 128/39 · EAN · ITF).
 *  واجهتان: detectImage/detectVideoFrame للقراءة الصامتة، وopen() لنافذة
 *  مسح كاملة (كاميرا + رفع صورة) يستعملها الموقع وبطاقة التوظيف معاً.
 *  ⚠️ الكاميرا تحتاج https أو localhost — والبديل رفع صورة أو الإدخال اليدوي.
 * =========================================================================== */
(function (root) {
  'use strict';

  var WANTED = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'codabar'];
  var hasApi = (typeof root.BarcodeDetector !== 'undefined');
  var detector = null, waiting = null;

  /* مكتبة jsQR (251KB) احتياطية فقط: تُطلب عند أول حاجة فعلية للقراءة المحلية،
     لا عند فتح الصفحة. كروم أندرويد وسفاري الحديثان يقرآن عبر BarcodeDetector
     أصلاً، فتحميل المكتبة لكل زائر كان يهدر ثلث وزن الصفحة العامة بلا فائدة.
     المسار المطلوب يبقى كما هو في صفحات التطبيق المستقل (hrc-standalone):
     إن كانت المكتبة محمّلة مسبقاً نستخدمها فوراً بلا طلب شبكة. */
  var libPromise = null;
  function loadLibrary() {
    if (typeof root.jsQR === 'function') return Promise.resolve(true);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve) {
      if (typeof root.document === 'undefined' || !root.document.createElement) return resolve(false);
      var s = root.document.createElement('script');
      s.src = root.HRC_JSQR_SRC || 'assets/vendor/jsqr.js';
      s.async = true;
      s.onload = function () { resolve(typeof root.jsQR === 'function'); };
      s.onerror = function () { resolve(false); };
      (root.document.head || root.document.body || root.document.documentElement).appendChild(s);
    });
    return libPromise;
  }

  function read(codes) {
    var out = [];
    (codes || []).forEach(function (c) { if (c && c.rawValue != null) out.push(String(c.rawValue)); });
    return out;
  }

  /* بناء الكاشف مرة واحدة بعد سؤال المتصفح عن الصيغ المدعومة فعلاً
     (تمرير صيغة غير مدعومة يرمي استثناءً في بعض الإصدارات فتضيع القراءة). */
  function build() {
    if (!hasApi) return Promise.resolve(null);
    if (detector) return Promise.resolve(detector);
    if (waiting) return waiting;
    var asked = (typeof root.BarcodeDetector.getSupportedFormats === 'function')
      ? Promise.resolve().then(function () { return root.BarcodeDetector.getSupportedFormats(); }).catch(function () { return null; })
      : Promise.resolve(null);
    waiting = asked.then(function (list) {
      var formats = WANTED.filter(function (f) { return !list || list.indexOf(f) >= 0; });
      if (!formats.length) formats = ['qr_code'];
      try { detector = new root.BarcodeDetector({ formats: formats }); }
      catch (e) { try { detector = new root.BarcodeDetector(); } catch (e2) { detector = null; } }
      return detector;
    });
    return waiting;
  }

  /* قارئ QR احتياطي محلي للمتصفحات التي لا تدعم BarcodeDetector، أو حين
     يفشل القارئ الأصلي في قراءة إطار. لا تُرسل الصور خارج الجهاز. */
  function decodePixels(source) {
    if (typeof root.jsQR !== 'function' || !source) return [];
    var width = source.videoWidth || source.naturalWidth || source.width;
    var height = source.videoHeight || source.naturalHeight || source.height;
    if (!width || !height) return [];
    try {
      var scale = Math.min(1, 1600 / Math.max(width, height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return [];
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var qr = root.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
      return qr && qr.data ? [String(qr.data)] : [];
    } catch (e) { return []; }
  }

  function decodeFile(file) {
    if (!root.URL || !root.URL.createObjectURL || typeof root.Image !== 'function') return Promise.resolve([]);
    return new Promise(function (resolve) {
      var url = root.URL.createObjectURL(file);
      var img = new root.Image();
      function finish(vals) { root.URL.revokeObjectURL(url); resolve(vals); }
      img.onload = function () { finish(decodePixels(img)); };
      img.onerror = function () { finish([]); };
      img.src = url;
    });
  }

  function fallback(source) {
    /* التحميل المتأخر لا يغيّر النتيجة: ننتظر المكتبة ثم نقرأ كما قبل تماماً. */
    return loadLibrary().then(function (ok) {
      if (!ok) return [];
      if (root.Blob && source instanceof root.Blob) return decodeFile(source);
      return decodePixels(source);
    });
  }

  function detectImage(source) {
    return build().then(function (d) {
      if (!d) return fallback(source);
      return Promise.resolve().then(function () { return d.detect(source); }).then(read)
        .catch(function () { return []; })
        .then(function (vals) { return vals.length ? vals : fallback(source); });
    });
  }

  function detectVideoFrame(video) {
    if (!video || !video.videoWidth) return Promise.resolve([]);
    return detectImage(video);
  }

  /* باركود البطاقة من نص مقروء: رابط apply.html?form=… · باركود مجرد · HRC-BC-###### */
  function serialFrom(text) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return '';
    var S = root.HRCStore;
    var norm = (S && S.normalizeCardSerial) ? S.normalizeCardSerial : function (v) {
      return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
    };
    var isCard = (S && S.isCardSerial) ? S.isCardSerial : function (v) {
      return /^(?:HRC-BC-\d{6}|[A-Z0-9]{10})$/.test(v);
    };
    var cand = '';
    var q = /[?&#](?:form|card|bc|serial|s)=([A-Za-z0-9-]+)/i.exec(t);
    if (q) cand = q[1];
    else if (/^\s*[A-Za-z0-9-]+\s*$/.test(t)) cand = t;
    else { var legacy = t.match(/HRC-BC-\d{6}/i); if (legacy) cand = legacy[0]; }
    if (!cand) return '';
    var v = norm(cand);
    return isCard(v) ? v : '';
  }

  /* نافذة مسح كاملة — تُرجع false إن كان المتصفح لا يدعم المسح.
     opts = { title, subtitle, validate(text) → bool, onResult(text) }
     • validate: ترفض الرمز *داخل* النافذة (رسالة هادئة) بدل إغلاقها برسالة خطأ.
     • القراءة تُهذَّب إلى إطار كل 160ms: بطارية أقل وضجيج أقل من كل إطار.
     • الكاميرا تُوقف عند الإغلاق أو عند ترك التبويب، وتُستأنف عند العودة. */
  function open(opts) {
    opts = opts || {};
    var UI = root.HRCUI;
    if (!UI || typeof UI.modal !== 'function' || !supported()) return false;

    var stream = null, timer = null, stopped = false, paused = false, hintShown = false, hintTimer = null;

    function clearTimer() { if (timer) { try { clearTimeout(timer); } catch (e) { } timer = null; } }
    function stop() {
      stopped = true;
      clearTimer();
      if (hintTimer) { try { clearTimeout(hintTimer); } catch (e) { } hintTimer = null; }
      if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } stream = null; }
      try { document.removeEventListener('visibilitychange', onVisibility); } catch (e) { }
    }
    function onVisibility() { paused = !!(document.hidden); }

    var modal = UI.modal({
      title: opts.title || 'مسح الباركود',
      subtitle: opts.subtitle || 'وجّه الكاميرا نحو الباركود — القراءة تلقائية.',
      body: '<div class="scan-stage"><video id="scan-video" playsinline muted autoplay></video>' +
        '<div class="scan-frame"></div><div class="scan-line"></div></div>' +
        '<p class="scan-status" id="scan-status">وجّه الكاميرا نحو الباركود المطبوع...</p>' +
        '<div class="scan-actions"><label class="btn btn-outline btn-sm" for="scan-file">' +
        UI.ic('upload') + ' ارفع صورة للباركود بدلاً من الكاميرا</label>' +
        '<input type="file" id="scan-file" accept="image/*" hidden></div>',
      onMount: function (box, close) {
        var video = box.querySelector('#scan-video');
        var file = box.querySelector('#scan-file');
        var status = box.querySelector('#scan-status');
        function say(t, cls) {
          if (!status) return;
          status.textContent = t;
          status.className = 'scan-status' + (cls ? ' ' + cls : '');
        }
        function accept(vals) {
          if (!vals || !vals.length) return false;
          var text = vals[0];
          /* الرمز غير صالح لصاحب الشاشة؟ نُبقي الكاميرا تعمل ونشرح بهدوء */
          if (typeof opts.validate === 'function' && opts.validate(text) === false) {
            say('هذا الرمز ليس باركود بطاقة توظيف — جرّب الباركود المطبوع على وجه البطاقة.', 'error');
            return false;
          }
          stop();
          close();
          if (opts.onResult) opts.onResult(text);
          return true;
        }
        function tick() {
          if (stopped) return;
          if (paused) { timer = setTimeout(tick, 400); return; }
          detectVideoFrame(video).then(function (vals) {
            if (stopped) return;
            if (vals && vals.length && accept(vals)) return;
            timer = setTimeout(tick, 160);
          }).catch(function () {
            if (!stopped) timer = setTimeout(tick, 260);
          });
        }
        file.addEventListener('change', function () {
          var f = file.files && file.files[0];
          if (!f) return;
          say('جارٍ قراءة الصورة...');
          var src = (typeof createImageBitmap === 'function')
            ? Promise.resolve(createImageBitmap(f)).catch(function () { return f; })
            : Promise.resolve(f);
          src.then(detectImage).then(function (vals) {
            if (!accept(vals)) say('لم يُعثر على باركود واضح — جرّب صورة أقرب وأوضح.', 'error');
          }).catch(function () { say('تعذّرت قراءة الصورة — جرّب صورة أخرى.', 'error'); });
          try { file.value = ''; } catch (e) { }
        });
        document.addEventListener('visibilitychange', onVisibility);
        onVisibility();

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(function (s) {
              if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
              stream = s;
              video.srcObject = s;
              var play = video.play();
              if (play && play.catch) play.catch(function () { });
              say('وجّه الكاميرا نحو الباركود — القراءة تلقائية...');
              tick();
              /* بعد 12 ثانية بلا قراءة: تلميح عملي بلا إزعاج */
              hintTimer = setTimeout(function () {
                if (stopped || hintShown) return;
                hintShown = true;
                say('لم يُقرأ بعد — قرّب الكاميرا وأضئ الورقة، أو ارفع صورة للباركود.');
              }, 12000);
            })
            .catch(function () {
              say('تعذّر الوصول إلى الكاميرا — ارفع صورة للباركود أو اكتب الرقم يدوياً.', 'error');
            });
        } else {
          say('الكاميرا غير متاحة في هذا المتصفح — ارفع صورة للباركود.', 'error');
        }
      },
      onClose: stop
    });
    if (!modal) { stop(); return false; }
    return true;
  }

  /* المسح مدعوم إن وُجد القارئ الأصلي، أو أمكن تحميل المكتبة الاحتياطية
     (وجود document كافٍ للحكم — التحميل نفسه عند الضغط). */
  function supported() {
    return !!hasApi || typeof root.jsQR === 'function' ||
      (typeof root.document !== 'undefined' && !!root.document.createElement);
  }

  root.HRCQRScan = {
    supported: supported,
    loadLibrary: loadLibrary,
    formats: WANTED.slice(),
    detectImage: detectImage,
    detectVideoFrame: detectVideoFrame,
    serialFrom: serialFrom,
    open: open
  };
})(typeof window !== 'undefined' ? window : globalThis);
