// Service Worker للعمل أوفلاين — hrc-cache-v185
// ---------------------------------------------------------------------------
// سياسة التخزين منذ v4:
//   • HTML و JS  → network-first: الشبكة أولاً (الزائر يرى آخر نسخة)، والكاش
//     احتياط عند انقطاع الإنترنت فقط. قبل v4 كان كل شيء cache-first فعلّقت
//     أجهزة الموظفين على نسخ قديمة بعد كل نشر رغم تحديث الموقع.
//   • الأصول الثابتة (CSS/صور/خطوط/أيقونات) → cache-first: لا تتغير إلا نادراً،
//     وبصمة ?v= في روابطها تُبدّلها تلقائياً عند البناء عند أي تعديل.
//   • v5: أُضيف nav.js و 404.html إلى الكاش، وصار فشل تحميل صفحة أثناء التصفّح
//     يعيد الصفحة الرئيسية من الكاش بدل خطأ المتصفح — وهذا ما كان يُظهر
//     «صفحة غير موجودة» لمن كان على نسخة قديمة مخزَّنة.
//   • v8 (2026-10-06): أُضيفت apply.html (صفحة التقديم الذاتي من باركود البطاقة)
//     إلى الكاش مع تحديثات الواجهة: الباركود يكفي بلا رمز، والزبون يعيّن
//     وظيفتَي فرصتيه، ورفض صاحب العمل يُسجَّل بالسبب ويُترك للشركة.
//   • v9 (2026-10-06): البطاقة الجديدة كانت تفقد فرصتيها فتظهر «انتهت فرصك» بلا
//     سبب — الإصلاح: ترميم تلقائي لخانات الفرص الناقصة عند قراءة البطاقة، ومنع
//     المزامنة من حذف خانات بطاقة معروفة، وزر «إعادة فحص البطاقة» في صفحة التقديم.
//   • v11 (2026-10-15): إبطال نسخ الدخول المحلي القديمة بعد قفل Supabase Auth.
//   • v152 (2026-11-07): «عرض المزيد/عرض أقل» للوظائف (أول 10) — جيل جديد
//     كي لا يبقى زائر قديم على نسخة مخزَّنة من index.html أو public.js.
//   • v153 (2026-11-07): ستايل الزر الجديد وحركاته (كحلي-ذهبي، لمعان، تتابع
//     البطاقات) — جيل جديد لبصمة CSS/JS كي لا يعلق زائر على الستايل القديم.
//   • v154 (2026-11-07): حذف زر «هامبرغر» الميت من الترويسة — جيل جديد كي لا
//     تبقى نسخة قديمة من index.html الترويسة أو style.css لدى زائر سابق.
//   • v155 (2026-11-07): تعريب «العملية» و«التفاصيل» في سجل التدقيق — جيل جديد
//     كي لا يعلق زائر على نسخة قديمة من dashboard.js / store.js.
//   • v156 (2026-11-07): استعادة تصميم وظائف البطاقة في apply.html (بطاقة رصيد
//     الفرص + ملخص الوظائف المختارة) — جيل جديد كي لا يعلق زائر على نسخة قديمة
//     من صفحة التقديم المخزَّنة في الكاش.
//   • v157 (2026-11-07): إحكام بطاقة الفرص (شريط للفرصة المختارة، عدّاد للوحة،
//     بديل حين تصل البطاقة بلا خانات) — جيل جديد لنفس السبب.
//   • skipWaiting + clients.claim: النسخة الجديدة تتسلّم فوراً بلا انتظار إغلاق
//     كل التبويبات — وإلا بقي موظف على سواها يوماً كاملاً.
//
// ⚠️ مع كل تحديث للواجهة: ارفع رقم النسخة (v5 → v6 …) — اسم الكاش هو ما يُبطل
//    نسخ الموظفين القديمة ويحذف مخزونها عند التنشيط.
// ---------------------------------------------------------------------------
/* ⚠️ ارفع الرقم مع كل تغيير يمسّ ملفات مخزَّنة.
   الكاش القديم يُحذف في حدث activate، لكن ذلك لا يقع إلا إذا تغيّر محتوى
   sw.js نفسه — فالمتصفح يقارن الملف بايتاً ببايت ولا ينشّط جيلاً جديداً
   إن كان مطابقاً. إبقاء الرقم ثابتاً يُبقي الزوار القدامى على نسخة قديمة
   من index.html مهما أعدت النشر (ظهر فعلاً: زر دخول محذوف بقي على حاسبة
   زارت الموقع قبل الحذف، بينما اختفى على هاتف لم يزره من قبل). */
const CACHE_NAME = 'hrc-cache-v185';
// Only public job illustrations / public Supabase Storage objects; never API or private images.
const IMAGE_CACHE = 'hrc-public-job-images-v1';
const IMAGE_META = 'hrc-public-job-image-meta-v1';
const IMAGE_LIMIT = 64;
const IMAGE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_STORAGE_ORIGIN = 'https://kdtatwuycidndsulbnqc.supabase.co';
const urlsToCache = [
  '/',
  '/index.html',
  '/assets/js/apply-navigation.js',
  '/apply.html',
  '/dashboard.html',
  '/assets/js/card-archive.js',
  '/verify.html',
  '/404.html',
  '/assets/css/style.css',
  '/assets/css/workspace-layout.css',
  '/assets/css/fonts.css',
  '/assets/css/public-polish.css',
  '/assets/css/notifications.css',
  '/assets/js/notifications.js',
  '/assets/js/config.js',
  '/assets/js/supabase-config.js',
  '/assets/js/store.js',
  '/assets/js/ui.js',
  '/assets/js/nav.js',
  '/assets/js/booking.js',
  '/assets/js/public.js',
  '/assets/js/dashboard.js',
  '/assets/js/verify.js',
  '/assets/js/qr.js',
  /* 2026-10-25: أُضيفت ملفات كانت تُترك للتحميل الوقتي — بلا تخزين مسبق
     تظهر الصفحة بلا تنسيق إن فُتحت أول مرة بلا إنترنت. */
  '/assets/css/card-entry.css',
  '/assets/css/app-shell.css',
  '/assets/img/hero-skyline.webp',
  /* 2026-10-27: صورة واجهة شاشة الترحيب «منصة مكسب» (محلية، تُخزَّن مسبقاً) */
  '/assets/img/mkseb-hero.webp',
  '/assets/img/mkseb-hero-m.webp',
  '/assets/css/backup.css',
  '/assets/css/image-editor.css',
  '/assets/js/qr-scan.js',
  '/assets/vendor/jsqr.js',
  '/assets/js/voucher.js',
  '/assets/js/cloud.js',
  '/assets/js/cloud-http.js',
  /* 2026-10-27: التقسيم الإداري العراقي (١٩ محافظة · ١٣٠ قضاء · ٤٢٧ ناحية) */
  '/assets/js/iraq-admin.js',
  '/assets/js/cloud-sync.js',
  '/assets/js/cloud-auth.js'
];

/* HTML و JS: شبكة أولاً */
function isNetworkFirst(request, url) {
  if (request.mode === 'navigate') return true;                       // التنقل بين الصفحات
  if (url.pathname === '/' || url.pathname.endsWith('/')) return true;
  return /\.html?$/i.test(url.pathname) || /\.js$/i.test(url.pathname);
}

/* Public pages do not download the staff shell in the background. The dashboard
   explicitly asks for it when a staff member actually visits. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'WARM_STAFF_SHELL' || !event.source || !event.source.url) return;
  let source;
  try { source = new URL(event.source.url); } catch (_) { return; }
  if (source.origin !== self.location.origin || !/^\/dashboard(?:\.html)?\/?$/.test(source.pathname)) return;
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.all(urlsToCache.map(async u => {
    if (!await cache.match(u)) await cache.add(u).catch(() => null);
  }))));
});

/* التنشيط: حذف كل كاشات الأجيال السابقة ثم السيطرة على العملاء فوراً */
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME, IMAGE_CACHE, IMAGE_META];
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName.startsWith('hrc-cache-') && cacheWhitelist.indexOf(cacheName) === -1) return caches.delete(cacheName);
        })
      ))
      .then(() => self.clients.claim())
  );
});

/* Exact URLs only: never cache API responses, credentials, signed/query URLs or
   arbitrary third-party images. A stale public image remains usable offline. */
function isPublicJobImage(request, url) {
  if (request.method !== 'GET' || request.destination !== 'image' || request.headers.has('authorization') || request.headers.has('range')) return false;
  if (url.origin === self.location.origin && !url.search) return /^\/assets\/img\/jobs\/[a-z0-9_-]+\.(?:webp|png|jpe?g|svg)$/i.test(url.pathname);
  return url.origin === PUBLIC_STORAGE_ORIGIN && !url.search && url.pathname.startsWith('/storage/v1/object/public/');
}

async function publicJobImage(request, url) {
  let cache, meta, saved;
  try {
    cache = await caches.open(IMAGE_CACHE);
    meta = await caches.open(IMAGE_META);
    saved = await cache.match(request.url);
    if (saved) {
      const stamp = await meta.match(request.url);
      const time = stamp ? Number(await stamp.text()) : 0;
      if (time && Date.now() < time) return saved;
    }
  } catch (_) { /* Storage unavailable: continue with the network. */ }
  try {
    let response;
    if (url.origin === self.location.origin) response = await fetch(request);
    else {
      // CORS is necessary to inspect cache policy and content type. Fall back to
      // the original request if CORS fails; never cache an opaque response.
      try { response = await fetch(request.url, { mode: 'cors', credentials: 'omit' }); }
      catch (_) { response = await fetch(request); }
    }
    const policy = response.headers.get('cache-control') || '';
    const contentType = response.headers.get('content-type') || '';
    const restricted = /(?:no-store|private|no-cache|max-age\s*=\s*0(?:\D|$))/i.test(policy);
    if (saved && cache && meta && (restricted || response.status === 404 || response.status === 410)) {
      try { await cache.delete(request.url); await meta.delete(request.url); } catch (_) {}
      saved = null;
    }
    if (cache && meta && response.ok && !response.redirected && response.type !== 'opaque' &&
        /^image\//i.test(contentType) && !restricted &&
        response.headers.get('vary') !== '*') {
      try {
        const maxAge = policy.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)/i);
        const age = Math.max(0, Number(response.headers.get('age')) || 0);
        const expires = Date.parse(response.headers.get('expires') || '');
        let lifetime = IMAGE_MAX_AGE;
        if (maxAge) lifetime = Math.min(lifetime, Math.max(0, (Number(maxAge[1]) - age) * 1000));
        else if (Number.isFinite(expires)) lifetime = Math.min(lifetime, Math.max(0, expires - Date.now()));
        await cache.put(request.url, response.clone());
        await meta.put(request.url, new Response(String(Date.now() + lifetime)));
        const keys = await cache.keys();
        while (keys.length > IMAGE_LIMIT) {
          const oldest = keys.shift();
          await cache.delete(oldest);
          await meta.delete(oldest.url);
        }
      } catch (_) { /* Quota or storage failure must not prevent displaying the image. */ }
    }
    return response.status >= 500 && saved ? saved : response;
  } catch (error) {
    if (saved) return saved;
    throw error;
  }
}

/* الجلب */
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (isPublicJobImage(request, url)) {
    event.respondWith(publicJobImage(request, url));
    return;
  }
  if (url.origin !== self.location.origin) return;   // خارج الموقع: ليس لنا
  // Query-bearing image URLs may name a different version or contain secrets.
  if (request.destination === 'image' && url.pathname.startsWith('/assets/img/jobs/') && url.search) return;

  if (isNetworkFirst(request, url)) {
    /* شبكة أولاً، والكاش احتياط إنقطاع فقط */
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseToCache));
        }
        return response;
      }).catch(() =>
        caches.open(CACHE_NAME).then(cache => cache.match(request, { ignoreSearch: true })).then(cached => {
          if (cached) return cached;
          /* تصفّح بلا شبكة وبلا نسخة مخزَّنة: نُعيد الصفحة الرئيسية للتنقل،
             وصفحة 404 بهوية الشركة لما سواه — لا شاشة خطأ عارية من المتصفح. */
          const fb = request.mode === 'navigate' ? '/index.html' : '/404.html';
          return caches.open(CACHE_NAME).then(cache => cache.match(fb).then(page => page || cache.match('/index.html')))
            .then(page => page || Response.error());
        })
      )
    );
    return;
  }

  /* الأصول الثابتة: كاش أولاً (بصمة ?v= تُدير تحديثها).
     ignoreSearch: الملفات المخزَّنة مسبقاً بلا ?v= — بدونها يفشل المطابق
     أوفلاين عند أول زيارة فتظهر الصفحة بلا تنسيق. */
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => cache.match(request, { ignoreSearch: true })).then(response => {
      if (response) return response;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(request, responseToCache));
        return response;
      });
    })
  );
});
