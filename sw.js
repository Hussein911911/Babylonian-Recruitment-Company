// Service Worker للعمل أوفلاين — brc-cache-v5
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
//   • skipWaiting + clients.claim: النسخة الجديدة تتسلّم فوراً بلا انتظار إغلاق
//     كل التبويبات — وإلا بقي موظف على سواها يوماً كاملاً.
//
// ⚠️ مع كل تحديث للواجهة: ارفع رقم النسخة (v5 → v6 …) — اسم الكاش هو ما يُبطل
//    نسخ الموظفين القديمة ويحذف مخزونها عند التنشيط.
// ---------------------------------------------------------------------------
const CACHE_NAME = 'brc-cache-v5';
const urlsToCache = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/verify.html',
  '/404.html',
  '/assets/css/style.css',
  '/assets/js/config.js',
  '/assets/js/store.js',
  '/assets/js/ui.js',
  '/assets/js/nav.js',
  '/assets/js/public.js',
  '/assets/js/dashboard.js',
  '/assets/js/verify.js',
  '/assets/js/qr.js'
];

/* HTML و JS: شبكة أولاً */
function isNetworkFirst(request, url) {
  if (request.mode === 'navigate') return true;                       // التنقل بين الصفحات
  if (url.pathname === '/' || url.pathname.endsWith('/')) return true;
  return /\.html?$/i.test(url.pathname) || /\.js$/i.test(url.pathname);
}

/* التثبيت: تجهيز الكاش ثم التسلّم الفوري بلا انتظار */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      /* addAll يسقط كاملاً لو تعذّر ملف واحد — فيبقى المتصفح على كاش الجيل
         السابق (وهو سبب معروف لظهور صفحات قديمة/مفقودة بعد النشر). نضيف كل
         ملف على حدة حتى لا يُسقِط غيابُ ملفٍ واحد التثبيتَ كلّه. */
      .then(cache => Promise.all(urlsToCache.map(u => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

/* التنشيط: حذف كل كاشات الأجيال السابقة ثم السيطرة على العملاء فوراً */
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) return caches.delete(cacheName);
        })
      ))
      .then(() => self.clients.claim())
  );
});

/* الجلب */
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;   // خارج الموقع: ليس لنا

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
        caches.match(request, { ignoreSearch: true }).then(cached => {
          if (cached) return cached;
          /* تصفّح بلا شبكة وبلا نسخة مخزَّنة: نُعيد الصفحة الرئيسية للتنقل،
             وصفحة 404 بهوية الشركة لما سواه — لا شاشة خطأ عارية من المتصفح. */
          const fb = request.mode === 'navigate' ? '/index.html' : '/404.html';
          return caches.match(fb).then(page => page || caches.match('/index.html'))
            .then(page => page || Response.error());
        })
      )
    );
    return;
  }

  /* الأصول الثابتة: كاش أولاً (بصمة ?v= تُدير تحديثها) */
  event.respondWith(
    caches.match(request).then(response => {
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
