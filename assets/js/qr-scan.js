/* ===========================================================================
 *  BRC QR Scanner — مسح رموز QR داخل المتصفح (بدون أي مكتبات خارجية)
 *  ---------------------------------------------------------------------------
 *  يعتمد على واجهة BarcodeDetector الأصلية المتوفرة في كروم / إيدج / أندرويد،
 *  ويعمل دون اتصال بالإنترنت. يدعم القراءة من بث الكاميرا الحي أو من صورة ثابتة
 *  (ملف مرفوع أو صورة مضمّنة). عند غياب الواجهة يُرجع supported() = false.
 * =========================================================================== */
(function (root) {
  'use strict';

  var detector = null;
  try {
    if (typeof BarcodeDetector !== 'undefined') {
      detector = new BarcodeDetector({ formats: ['qr_code'] });
    }
  } catch (e) { detector = null; }

  function read(codes) {
    var out = [];
    (codes || []).forEach(function (c) {
      if (c && c.rawValue != null) out.push(String(c.rawValue));
    });
    return out;
  }

  root.BRCQRScan = {
    /* هل يدعم المتصفح الحالي مسح QR؟ */
    supported: function () { return !!detector; },

    /* قراءة صورة ثابتة: ImageBitmap أو <img> أو <canvas> */
    detectImage: function (source) {
      if (!detector) return Promise.reject(new Error('unsupported'));
      return detector.detect(source).then(read);
    },

    /* قراءة إطار فيديو حي */
    detectVideoFrame: function (video) {
      if (!detector || !video || !video.videoWidth) return Promise.resolve([]);
      return detector.detect(video).then(read).catch(function () { return []; });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
