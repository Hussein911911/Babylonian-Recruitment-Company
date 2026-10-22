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
  var hasApi = (typeof BarcodeDetector !== 'undefined');
  var detector = null, waiting = null;

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
    var asked = (typeof BarcodeDetector.getSupportedFormats === 'function')
      ? Promise.resolve(BarcodeDetector.getSupportedFormats()).catch(function () { return null; })
      : Promise.resolve(null);
    waiting = asked.then(function (list) {
      var formats = WANTED.filter(function (f) { return !list || list.indexOf(f) >= 0; });
      if (!formats.length) formats = ['qr_code'];
      try { detector = new BarcodeDetector({ formats: formats }); }
      catch (e) { try { detector = new BarcodeDetector(); } catch (e2) { detector = null; } }
      return detector;
    });
    return waiting;
  }

  function detectImage(source) {
    return build().then(function (d) {
      if (!d) return Promise.reject(new Error('unsupported'));
      return d.detect(source).then(read);
    });
  }

  function detectVideoFrame(video) {
    if (!video || !video.videoWidth) return Promise.resolve([]);
    return build().then(function (d) {
      if (!d) return [];
      return d.detect(video).then(read).catch(function () { return []; });
    });
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

  /* نافذة مسح كاملة: { title, subtitle, onResult(text) } — تُرجع false بلا دعم */
  function open(opts) {
    opts = opts || {};
    var UI = root.HRCUI;
    if (!UI || typeof UI.modal !== 'function' || !hasApi) return false;

    var stream = null, raf = null, stopped = false;
    function stop() {
      stopped = true;
      if (raf) { try { cancelAnimationFrame(raf); } catch (e) { } raf = null; }
      if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } stream = null; }
    }

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
        function say(t, cls) { if (status) { status.textContent = t; status.className = 'scan-status' + (cls ? ' ' + cls : ''); } }
        function done(vals) {
          if (!vals || !vals.length) return false;
          stop(); close();
          if (opts.onResult) opts.onResult(vals[0]);
          return true;
        }
        function tick(v) {
          if (stopped) return;
          detectVideoFrame(v).then(function (vals) {
            if (stopped) return;
            if (vals && vals.length) { done(vals); return; }
            raf = requestAnimationFrame(function () { tick(v); });
          }).catch(function () { if (!stopped) raf = requestAnimationFrame(function () { tick(v); }); });
        }
        file.addEventListener('change', function () {
          var f = file.files && file.files[0];
          if (!f) return;
          say('جارٍ قراءة الصورة...');
          var src = (typeof createImageBitmap === 'function')
            ? Promise.resolve(createImageBitmap(f)).catch(function () { return f; })
            : Promise.resolve(f);
          src.then(detectImage).then(function (vals) {
            if (!done(vals)) say('لم يُعثر على باركود واضح في الصورة — جرّب صورة أوضح.', 'error');
          }).catch(function () { say('تعذّرت قراءة الصورة.', 'error'); });
        });
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(function (s) {
              if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
              stream = s; video.srcObject = s;
              video.play().catch(function () { });
              say('وجّه الكاميرا نحو الباركود — القراءة تلقائية...');
              tick(video);
            })
            .catch(function () { say('تعذّر الوصول إلى الكاميرا — ارفع صورة أو اكتب الرقم يدوياً.', 'error'); });
        } else {
          say('الكاميرا غير متاحة في هذا المتصفح — ارفع صورة للباركود.', 'error');
        }
      },
      onClose: stop
    });
    if (!modal) { stop(); return false; }
    return true;
  }

  root.HRCQRScan = {
    supported: function () { return !!hasApi; },
    formats: WANTED.slice(),
    detectImage: detectImage,
    detectVideoFrame: detectVideoFrame,
    serialFrom: serialFrom,
    open: open
  };
})(typeof window !== 'undefined' ? window : globalThis);
