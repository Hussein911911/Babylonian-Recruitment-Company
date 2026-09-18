/* ===========================================================================
 *  BRC — تنقّل مُحصَّن (Resilient Navigation)
 *  ---------------------------------------------------------------------------
 *  المشكلة التي يعالجها هذا الملف:
 *    روابط الترويسة والتذييل مكتوبة في القوالب بالشكل "index.html#jobs" لأن هذا
 *    هو الشكل الوحيد الذي يعمل أيضاً عند فتح الملفات من القرص (file://) وفي
 *    اختبارات jsdom. لكن على الاستضافة الحيّة قد يكون اسم الملف غير قابل للطلب
 *    مباشرة (مضيف يفرض «روابط نظيفة»، أو نشر داخل مسار فرعي، أو عامل خدمة قديم
 *    مخزَّن) فتُعطي نقرة «الوظائف / خدماتنا / آلية العمل / اسم الشركة» صفحة
 *    «غير موجودة» رغم أن القسم موجود في نفس الصفحة.
 *
 *  الحل: تطبيع الروابط وقت التشغيل قبل أي نقرة:
 *    • داخل الصفحة الرئيسية  → الرابط يصبح مرساة خالصة (#jobs) بلا اسم ملف إطلاقاً.
 *    • من صفحة أخرى (تحقق/لوحة) → الرابط يصبح مجلد الصفحة الحالي + المرساة
 *      (مثال: "/#jobs") فيعمل على أي نطاق ومع أي مسار فرعي.
 *    • عند فتح الملف من القرص (file://) → يبقى "index.html#jobs" كما هو.
 *    • في النسخة المستقلة (ملف واحد) → لا يتدخّل إطلاقاً: راوترها يتكفّل بذلك.
 *
 *  ويضيف أيضاً: تمرير سلس مع خصم ارتفاع الترويسة اللاصقة، تحديث شريط العنوان
 *  بلا قفزة، وإغلاق قائمة الجوال بعد الاختيار.
 * =========================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  if (!doc) return;

  /* النسخة المستقلة (brc-standalone / brc-light) لها راوتر خاص بـ #! — لا نلمسها */
  function isStandalone() {
    return !!(doc.getElementById('route-site') || doc.getElementById('route-dashboard') ||
      (doc.body && doc.body.hasAttribute('data-route')));
  }

  var isFile = root.location && root.location.protocol === 'file:';
  var FILE_NAME = 'index.html';

  /* هل نحن على الصفحة العامة؟ (وجود شبكة الوظائف أو قسم البداية دليل قاطع) */
  function onHome() {
    return !!(doc.getElementById('jobs-grid') || doc.getElementById('home'));
  }

  /* مجلد الصفحة الحالية: "/" أو "/sub/" — يعمل مع النطاق الجذري والمسار الفرعي */
  function homeHref() {
    if (isFile) return FILE_NAME;
    var p = (root.location && root.location.pathname) || '/';
    return p.replace(/[^/]*$/, '') || '/';
  }

  /* تحويل رابط واحد إلى الصفحة الرئيسية (روابط الأقسام) */
  function normalize(a) {
    var href = a.getAttribute('href') || '';
    var i = href.indexOf(FILE_NAME);
    if (i < 0) return;
    /* لا نلمس الروابط المطلقة إلى نطاق آخر */
    if (/^https?:/i.test(href) && href.indexOf(root.location.host) < 0) return;

    var hash = href.slice(i + FILE_NAME.length);      // "#jobs" أو ""
    if (hash && hash.charAt(0) !== '#') return;       // ليس رابط قسم — اتركه

    if (onHome()) a.setAttribute('href', hash || '#home');
    else if (!isFile) a.setAttribute('href', homeHref() + hash);
    /* file:// — يبقى كما هو (اسم الملف هو الطريق الصحيح على القرص) */
  }

  /* ---------------------------------------------------------------------------
   *  روابط الصفحات المستقلة (دخول الموظفين / التحقق)
   *  ---------------------------------------------------------------------------
   *  "dashboard.html" رابط **نسبي**، فإن كانت الصفحة الحالية على مسار نظيف بلا
   *  اسم ملف (/verify مثلاً) أو داخل مسار فرعي، حسبه المتصفح من المجلد الخطأ
   *  ورجع «صفحة غير موجودة» — وهذا ما كان يحدث عند النقر على «تسجيل الدخول».
   *
   *  ونُسقط امتداد .html عمداً: Cloudflare Pages (ومعظم المضيفات الثابتة) يُحوّل
   *  /dashboard.html → /dashboard تلقائياً، فإبقاء الامتداد يعني قفزة تحويل
   *  زائدة في كل نقرة. والمسار النظيف يعمل بلا أي قاعدة في _redirects لأن
   *  المضيف يخدم الملف عليه افتراضياً.
   *
   *  احتياط مهم: على مضيف لا يدعم المسارات النظيفة يبقى الملف متاحاً باسمه،
   *  لذلك نتحقق وقت التشغيل — إن فشل المسار النظيف نرجع إلى اسم الملف. (انظر
   *  verifyPageLink أدناه.)
   * ------------------------------------------------------------------------- */
  var PAGES = ['dashboard.html', 'verify.html'];

  function normalizePage(a) {
    if (isFile) return;                                // من القرص: الاسم النسبي صحيح
    var href = a.getAttribute('href') || '';
    if (/^(https?:|#|mailto:|tel:|\/)/i.test(href)) return;   // مطلق أو مرساة — لا يُلمس
    for (var i = 0; i < PAGES.length; i++) {
      var name = PAGES[i];
      if (href === name || href.indexOf(name + '?') === 0 || href.indexOf(name + '#') === 0) {
        /* اسم الملف بلا امتداد + بقيّة الرابط (query/hash) */
        var rest = href.slice(name.length);
        var clean = name.replace(/\.html$/, '');
        a.setAttribute('href', homeHref() + clean + rest);
        a.setAttribute('data-brc-page', name);         // للاحتياط أدناه
        return;
      }
    }
  }

  /* ---------------------------------------------------------------------------
   *  احتياط: لو كان المضيف لا يخدم المسار النظيف (404)، نُعيد الروابط إلى اسم
   *  الملف الكامل. نفحص مرة واحدة بطلب HEAD خفيف بدل المخاطرة بنقرة فاشلة.
   *  الفشل هنا صامت ومقصود: إن تعذّر الفحص (بلا شبكة مثلاً) نُبقي المسار النظيف
   *  لأنه الصحيح في الحالة الغالبة.
   * ------------------------------------------------------------------------- */
  function verifyPageLink() {
    if (isFile || !root.fetch) return;
    var probe = doc.querySelector('a[data-brc-page]');
    if (!probe) return;
    var url = probe.getAttribute('href').split('#')[0].split('?')[0];
    root.fetch(url, { method: 'HEAD' }).then(function (res) {
      if (res && res.ok) return;                       // المسار النظيف يعمل
      revertToFileNames();
    }).catch(function () { /* تعذّر الفحص — نُبقي الحالي */ });
  }

  function revertToFileNames() {
    var list = doc.querySelectorAll('a[data-brc-page]');
    for (var i = 0; i < list.length; i++) {
      var a = list[i], name = a.getAttribute('data-brc-page');
      var href = a.getAttribute('href') || '';
      var clean = name.replace(/\.html$/, '');
      /* نستبدل الاسم النظيف في **نهاية المسار** وحده (قبل ? أو #) — البحث
         بـ indexOf يلتقط تطابقاً داخل اسم المجلد وينتج dashboard.html.html */
      var re = new RegExp('/' + clean + '(?=$|[?#])');
      if (re.test(href)) a.setAttribute('href', href.replace(re, '/' + name));
    }
  }

  function normalizeAll() {
    var list = doc.querySelectorAll('a[href*="' + FILE_NAME + '"]');
    for (var i = 0; i < list.length; i++) normalize(list[i]);

    for (var p = 0; p < PAGES.length; p++) {
      var pages = doc.querySelectorAll('a[href^="' + PAGES[p] + '"]');
      for (var j = 0; j < pages.length; j++) normalizePage(pages[j]);
    }
  }

  /* ارتفاع الترويسة اللاصقة — حتى لا يختفي عنوان القسم تحتها بعد القفز */
  function headerOffset() {
    var h = doc.querySelector('.site-header');
    if (!h) return 0;
    var pos = root.getComputedStyle ? root.getComputedStyle(h).position : '';
    if (pos !== 'sticky' && pos !== 'fixed') return 0;
    return h.getBoundingClientRect().height + 8;
  }

  function scrollToId(id, smooth) {
    var t = id && doc.getElementById(id);
    if (!t) return false;
    var y = t.getBoundingClientRect().top + (root.pageYOffset || doc.documentElement.scrollTop || 0) - headerOffset();
    if (y < 0) y = 0;
    try { root.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' }); }
    catch (e) { root.scrollTo(0, y); }
    /* إتاحة الوصول: ينتقل التركيز إلى القسم بلا إطار مزعج */
    if (t.setAttribute && !t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    if (t.focus) { try { t.focus({ preventScroll: true }); } catch (e2) { /* متصفح قديم */ } }
    return true;
  }

  /* اعتراض النقر على مراسي نفس الصفحة: تمرير سلس مع الخصم بدل قفزة المتصفح */
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;

    var href = a.getAttribute('href') || '';
    if (href.charAt(0) !== '#' || href === '#' || href.indexOf('#!') === 0) return;

    var id = href.slice(1);
    if (!doc.getElementById(id)) return;               // ليس قسماً في هذه الصفحة

    e.preventDefault();
    if (scrollToId(id, true) && root.history && root.history.pushState) {
      root.history.pushState(null, '', '#' + id);
    }
    var nav = doc.getElementById('main-nav');
    if (nav) nav.classList.remove('open');
    var toggle = doc.getElementById('nav-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  /* الوصول إلى الصفحة برابط فيه مرساة: نصحّح الموضع بعد رسم التخطيط */
  function onLoadHash() {
    var h = root.location.hash || '';
    if (!h || h.length < 2 || h.indexOf('#!') === 0) return;
    var id = h.slice(1);
    if (!doc.getElementById(id)) return;
    setTimeout(function () { scrollToId(id, false); }, 60);
  }

  /* ---------------------------------------------------------------------------
   *  بوابة الموظفين المخفية — ضغطة مطوّلة على اسم الشركة
   *  ---------------------------------------------------------------------------
   *  طلب الإدارة (2026-09-19): لا زر دخول ظاهر في الموقع العام. الموقع واجهة
   *  للباحثين عن عمل، ووجود زر «تسجيل الدخول» يعرّف كل زائر بعنوان المنظومة
   *  الداخلية. البديل: ضغطة مطوّلة (1.2 ثانية) على اسم الشركة في الترويسة.
   *
   *  تفاصيل تهمّ الاستعمال الحقيقي على الجوال:
   *   • نُلغي المؤقّت عند أي تمرير (scroll/touchmove) — وإلا فتحت اللوحة لمن
   *     أمسك الشاشة ليمرّر الصفحة، وهو أكثر ما يحدث على الموبايل.
   *   • نمنع قائمة السياق (contextmenu) وتحديد النص أثناء الضغط على الاسم،
   *     لأن أندرويد يُظهر «نسخ/مشاركة» بعد ~500ms فيقطع الإيماءة.
   *   • عند نجاح الضغطة نمنع نقرة المتصفح التالية (click) حتى لا ينتقل إلى
   *     #home بعد فتح اللوحة.
   *   • اهتزاز خفيف (إن توفّر) كإشعار بنجاح الإيماءة — بلا أي عنصر مرئي يفضح
   *     وجود البوابة.
   * ------------------------------------------------------------------------- */
  var LONG_PRESS_MS = 1200;
  var MOVE_TOLERANCE = 12;          // بكسل — أكثر من هذا يُعدّ تمريراً لا ضغطاً

  function dashboardHref() {
    /* الملف المستقل: راوتر داخلي بـ #! لا صفحة منفصلة */
    if (isStandalone()) return '#!dashboard';
    if (isFile) return 'dashboard.html';
    /* نفس منطق normalizePage: المسار النظيف من جذر النشر. لو كان المضيف لا
       يدعمه فقد بدّلت verifyPageLink الروابط الظاهرة، ونتبع قرارها نفسه. */
    var probe = doc.querySelector('a[data-brc-page="dashboard.html"]');
    if (probe) return probe.getAttribute('href');
    return homeHref() + 'dashboard';
  }

  function bindStaffGate() {
    var brand = doc.querySelector('.brand[data-staff-gate]');
    if (!brand) return;

    var timer = null, startX = 0, startY = 0, fired = false;

    function clear() {
      if (timer) { clearTimeout(timer); timer = null; }
    }

    function start(x, y) {
      fired = false;
      startX = x; startY = y;
      clear();
      timer = setTimeout(function () {
        fired = true;
        timer = null;
        if (root.navigator && root.navigator.vibrate) {
          try { root.navigator.vibrate(30); } catch (e) { /* غير مدعوم */ }
        }
        root.location.href = dashboardHref();
      }, LONG_PRESS_MS);
    }

    function moved(x, y) {
      if (Math.abs(x - startX) > MOVE_TOLERANCE || Math.abs(y - startY) > MOVE_TOLERANCE) clear();
    }

    /* اللمس (الجوال) */
    brand.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0];
      if (t) start(t.clientX, t.clientY);
    }, { passive: true });
    brand.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0];
      if (t) moved(t.clientX, t.clientY);
    }, { passive: true });
    brand.addEventListener('touchend', clear);
    brand.addEventListener('touchcancel', clear);

    /* الفأرة (سطح المكتب) — الزر الأيسر فقط */
    brand.addEventListener('mousedown', function (e) {
      if (e.button === 0) start(e.clientX, e.clientY);
    });
    brand.addEventListener('mousemove', function (e) { moved(e.clientX, e.clientY); });
    brand.addEventListener('mouseup', clear);
    brand.addEventListener('mouseleave', clear);

    /* التمرير يُلغي الإيماءة (المستخدم يمرّر الصفحة لا يفتح اللوحة) */
    root.addEventListener('scroll', clear, { passive: true });

    /* بعد نجاح الضغطة: امنع الانتقال إلى #home */
    brand.addEventListener('click', function (e) {
      if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
    });

    /* أندرويد يُظهر قائمة «نسخ/مشاركة» أثناء الضغط المطوّل فتقطع الإيماءة */
    brand.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function boot() {
    /* الملف المستقل: راوتره الخاص يدير الروابط والتمرير، فلا نطبّع شيئاً —
       لكن بوابة الموظفين المخفية تُربط فيه أيضاً (الضغطة المطوّلة تفتح
       #!dashboard بدل صفحة منفصلة). */
    if (isStandalone()) { bindStaffGate(); return; }
    normalizeAll();
    bindStaffGate();
    doc.addEventListener('click', onClick);
    root.addEventListener('hashchange', function () {
      var h = root.location.hash || '';
      if (h.length > 1 && h.indexOf('#!') !== 0) scrollToId(h.slice(1), true);
    });
    onLoadHash();
    verifyPageLink();
    /* أقسام أو بطاقات تُضاف لاحقاً (نتائج الوظائف مثلاً) تُطبَّع أيضاً */
    if (root.MutationObserver) {
      var mo = new root.MutationObserver(function () { normalizeAll(); });
      if (doc.body) mo.observe(doc.body, { childList: true, subtree: true });
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  root.BRCNav = {
    normalize: normalizeAll, scrollToId: scrollToId, homeHref: homeHref,
    dashboardHref: dashboardHref        // تُستعمل في فحص التدقيق أيضاً
  };
})(typeof window !== 'undefined' ? window : globalThis);
