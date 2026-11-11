/* ===========================================================================
 *  HRC — إعادة التحقق الفوري من جهة لوحة التحكم (On-Demand Revalidation)
 *  ---------------------------------------------------------------------------
 *  عند أي تعديل على الوظائف (إضافة/تعديل/إغلاق/حذف) تنادي اللوحة
 *  HRCRevalidate.afterJobChange() فتُبلّغ حافة Cloudflare أن بيانات
 *  public_jobs تغيّرت، فيُحذف كاشها فوراً بدل انتظار انتهاء عمره.
 *
 *  لماذا من العميل؟ لأن الكتابة إلى القاعدة تحدث من المتصفح (المفتاح العام
 *  + سياسات RLS)، ولا خادم وسيط. اللوحة تملك جلسة الموظف، والحافة تملك
 *  السرّ — والعميل لا يرى السرّ أبداً.
 *
 *  ⚠️ السرّ لا يُوضع هنا. الإنتاج يقرأ متغيّرات Cloudflare.
 *     بلا سرّ مضبوط يبقى الموقع يعمل، ويسقط على كاش الحافة ذي الـ30 ثانية:
 *     تأخير محدود ومعلوم، لا بيانات قديمة إلى الأبد.
 *
 *  الاختبار: كل المنطق صافي وقابل للاستدعاء بلا شبكة (opts.fetch).
 * =========================================================================== */
(function (root) {
  'use strict';

  var ENDPOINT = '/api/revalidate';
  var lastSent = 0;
  var MIN_GAP = 2000;        /* لا نُغرق الحافة عند حفظ متتابع */
  var inFlight = false;
  var queued = false;

  function cfg() { return (root.HRC_CONFIG && root.HRC_CONFIG.revalidate) || {}; }

  function enabled() {
    var c = cfg();
    /* معطّل افتراضياً في القارئ المحلي/الملف المستقل: لا شبكة ولا حافة. */
    return c.enabled === true;
  }

  /* نفّذ الطلب فعلياً. تُفصل عن afterJobChange لتُختبر بلا شبكة. */
  function send(opts) {
    opts = opts || {};
    var doFetch = opts.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    var secret = opts.secret;            /* للتطوير/الاختبار المحلي فقط */
    var body = JSON.stringify({ paths: ['/rest/v1/public_jobs'], reason: opts.reason || 'job-change' });
    var at = Date.now();

    var headers = { 'content-type': 'application/json' };

    /* توقيع HMAC يعمل في المتصفح عبر WebCrypto. السرّ يأتي من opts (تطوير)
       أو من دالة مزوّد — لا يُكتب في الكود أبداً. */
    var sign = secret
      ? signWith(secret, at, body)
      : Promise.reject(new Error('NO_SECRET'));

    return sign.then(function (sig) {
      headers['x-hrc-timestamp'] = String(at);
      headers['x-hrc-signature'] = sig;
      if (!doFetch) throw new Error('NO_FETCH');
      return doFetch(ENDPOINT, { method: 'POST', headers: headers, body: body, credentials: 'same-origin' });
    }).then(function (res) {
      return res && res.ok ? { ok: true } : { ok: false, status: res && res.status };
    }).catch(function (e) {
      /* الفشل لا يكسر شيئاً في الواجهة: الكاش يسقط وحده بعد 30 ثانية. */
      return { ok: false, error: (e && e.message) || 'FAILED' };
    });
  }

  function signWith(secret, at, body) {
    var subtle = root.crypto && root.crypto.subtle;
    if (!subtle) return Promise.reject(new Error('NO_CRYPTO'));
    var enc = new TextEncoder();
    return subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (key) { return subtle.sign('HMAC', key, enc.encode(at + '.' + body)); })
      .then(function (buf) {
        return [].map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
  }

  /* نقطة الدخول من اللوحة بعد أي تعديل وظيفة. لا تعيد وعداً يُنتظر. */
  function afterJobChange(reason) {
    if (!enabled()) return;
    var now = Date.now();
    if (inFlight) { queued = true; return; }
    if (now - lastSent < MIN_GAP) {
      /* حفظ متتابع: نُرسل مرة واحدة بعد انتهاء الفاصل */
      setTimeout(function () { afterJobChange(reason); }, MIN_GAP - (now - lastSent));
      return;
    }
    inFlight = true;
    lastSent = now;
    send({ reason: reason, secret: cfg().devSecret }).then(function (r) {
      inFlight = false;
      if (queued) { queued = false; afterJobChange(reason); }
      if (!r.ok && root.console && console.warn) console.warn('[HRC/revalidate] ' + (r.error || r.status));
    });
  }

  root.HRCRevalidate = {
    enabled: enabled,
    send: send,
    signWith: signWith,
    afterJobChange: afterJobChange,
    endpoint: ENDPOINT,
    _reset: function () { lastSent = 0; inFlight = false; queued = false; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
