// Service Worker للعمل أوفلاين
// ⚠️ ارفع رقم النسخة (v2 → v3 …) مع كل تحديث للواجهة: الـ SW يقدّم الملفات من
// الكاش أولاً، فتغيير الاسم هو ما يجبر أجهزة الموظفين على جلب النسخة الجديدة
// بدل الاستمرار على نسخة قديمة (بدّل الاسم هنا فقط — لا تعدّ غيره).
const CACHE_NAME = 'brc-cache-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/verify.html',
  '/assets/css/style.css',
  '/assets/js/config.js',
  '/assets/js/store.js',
  '/assets/js/ui.js',
  '/assets/js/public.js',
  '/assets/js/dashboard.js',
  '/assets/js/verify.js',
  '/assets/js/qr.js'
];

// تثبيت Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// جلب الموارد من الكاش أو الشبكة
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(
          response => {
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            return response;
          }
        );
      })
  );
});

// تحديث الكاش
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
