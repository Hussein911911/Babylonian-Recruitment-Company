/* ═══════════════════════════════════════════════════════════════════════════
   HRC — تضمين صور الوظائف داخل النسخة
   ---------------------------------------------------------------------------
   ⚠ لماذا؟

   النسخة تحفظ `image_url` — نصاً. فإن أشار إلى مشروع Supabase الذي ننسخ
   منه، فمجرّد حذفه يجعل صور الوظائف مكسورة على الموقع الجديد. أي أن
   «نسخة كاملة» كانت تعتمد على بقاء المصدر الذي تنسخ منه — وهذا نقض الغرض.

   الحل: تنزيل الصور مرة واحدة على جهاز المستخدم، وتحويلها إلى data URL،
   فتسكن داخل ملف SQL نفسه. بعدها لا شبكة ولا مشروع قديم.

   ⚠ لماذا بالطلب لا تلقائياً؟

   التنزيل يحتاج شبكة، والنسخة قد تُفتح على جهاز بلا اتصال (هذا سبب وجودها).
   فنجعلها خطوة يطلبها المالك بزر، مع بيان ما سيحدث. ولا نلمس الصور
   الخارجية (Unsplash) — ليست ملكاً للشركة، وتضمينها يضخّم الملف بلا فائدة.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var MAX_BYTES = 3 * 1024 * 1024;   // سقف الصورة الواحدة — فوقه نُبقي الرابط
  var MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

  /**
   * هل يستحق هذا الرابط أن يُضمَّن؟
   * نضمّن فقط صور مشروع Supabase (قد تختفي) — لا Unsplash ولا data URL.
   */
  function shouldEmbed(url) {
    var u = String(url || '').trim();
    if (!u || u.indexOf('data:') === 0) return false;
    if (!/^https?:\/\//i.test(u)) return false;
    if (/\.supabase\.co\/storage\/v1\/object\/public\//i.test(u)) return true;
    /* استثناء الفحص: المضيف المحلي — يسمح باختبار الوحدة بلا شبكة.
       لا أثر له في الإنتاج: الموقع لا يشير إلى 127.0.0.1. */
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u);
  }

  /** يجمع الروابط الفريدة من صفوف الوظائف */
  function collect(payload) {
    var seen = Object.create(null), out = [];
    (payload && payload.jobs || []).forEach(function (j) {
      var u = j && j.image_url;
      if (shouldEmbed(u)) {
        var k = String(u).trim();
        if (!seen[k]) { seen[k] = true; out.push(k); }
      }
    });
    return out;
  }

  /** ينزّل رابطاً واحداً ويحوّله data URL — أو null إن فشل */
  function fetchOne(url, opts) {
    var fetchFn = (opts && opts.fetch) || root.fetch;
    if (!fetchFn) return Promise.resolve(null);
    return fetchFn(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (blob) {
        if (!blob) return null;
        if (blob.size > MAX_BYTES) return null;   // كبيرة: نبقي الرابط
        var ext = (String(url).split('?')[0].match(/\.([a-z]+)$/i) || [])[1];
        var mime = MIME[String(ext || '').toLowerCase()] || blob.type || 'image/jpeg';
        if (String(mime).indexOf('image/') !== 0) return null;
        return new Promise(function (resolve) {
          var fr = root.FileReader ? new root.FileReader() : null;
          if (!fr) return resolve(null);
          fr.onload = function () { resolve(String(fr.result || '')); };
          fr.onerror = function () { resolve(null); };
          fr.readAsDataURL(blob);
        });
      })
      .catch(function () { return null; });   // CORS أو انقطاع: نبقي الرابط
  }

  /**
   * يضمّن كل الصور الممكنة.
   * يُرجع { images, embedded, skipped, failed } — والتقدّم يُبلَّغ عبر onProgress.
   */
  function embedAll(payload, opts) {
    var urls = collect(payload);
    var onProgress = (opts && opts.onProgress) || function () {};
    var images = {};
    var idx = 0;

    if (!urls.length) return Promise.resolve({ images: images, embedded: 0, skipped: 0, failed: 0, total: 0 });

    function step() {
      if (idx >= urls.length) {
        return {
          images: images,
          total: urls.length,
          embedded: Object.keys(images).length,
          failed: urls.length - Object.keys(images).length,
          skipped: 0
        };
      }
      var url = urls[idx++];
      onProgress(idx, urls.length);
      return fetchOne(url, opts).then(function (data) {
        if (data) images[url] = data;
        return step();
      });
    }
    return step();
  }

  var api = { shouldEmbed: shouldEmbed, collect: collect, embedAll: embedAll, fetchOne: fetchOne, MAX_BYTES: MAX_BYTES };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HRCImageEmbed = api;
})(typeof window !== 'undefined' ? window : globalThis);
