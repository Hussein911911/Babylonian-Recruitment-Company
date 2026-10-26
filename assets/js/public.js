/* ===========================================================================
 *  HRC — منطق الموقع العام
 *  لوحة الوظائف، البحث الفوري، صفحة الوظيفة، ونافذة «بطاقتي».
 *  نظام بطاقة التوظيف (2026-09-30): التقديم ببطاقة تُشترى كاشاً من نقاط
 *  البيع — زر «قدّم ببطاقتك» في كل وظيفة متاحة يفتح نافذة بطاقتي في
 *  booking.js (الباركود ← الحالة ← استخدام فرصة برمزها / إعادة الطباعة).
 *  لا دفع إلكتروني نهائياً — وواتساب يبقى قناة تواصل موازية.
 *  ⚠️ سياسة الشركة الباقية: التحقق من البطاقات خاص بالموظفين والإدارة فقط.
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.HRC_CONFIG, Store = root.HRCStore, UI = root.HRCUI;
  if (!document.getElementById('jobs-grid')) return;

  /* الفلاتر: المحافظة وحدها للموقع الجغرافي — لا فلتر مناطق (قرار 2026-10-24) */
  var filters = { q: '', governorate: 'all', shift: 'all', status: 'all', category: 'all' };

  /* مفضلة الزائر: تُحفظ على جهازه وحده (لا تُرسل للشركة ولا تُسجَّل بسجل) */
  var FAV_KEY = 'hrc_fav_jobs_v1';
  var catColor = {};          /* لون كل تخصص (يُبنى في renderCategories) */
  function favList() {
    try { var a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function favToggle(code) {
    var a = favList(), i = a.indexOf(code);
    if (i >= 0) a.splice(i, 1); else a.push(code);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(a.slice(-200))); } catch (e) { }
    return a.indexOf(code) >= 0;
  }

  /* -------------- وضع القاعدة العامة (Supabase مفعّل) --------------
   * لماذا هذا التمييز؟ مع enabled=true يجب ألا يرى الزائر **أي** بيانات من
   * المتصفح (CFG.seed أو كاش localStorage): الوظائف المعروضة مرجعها قاعدة
   * الشركة وحدها. فقبل وصول رد القاعدة نعرض هيكل تحميل (skeleton)، وبعده
   * إمّا الوظائف المعلنة، أو «لا توجد وظائف معروضة حالياً» إن كانت القاعدة
   * فارغة، أو «تعذّر الاتصال بقاعدة الشركة» إن فشل الاتصال — ولا نسقط إلى
   * البيانات التجريبية أبداً. أما إن كان المتصفح لا يستطيع الاتصال أصلاً
   * (بلا fetch — نسخة قديمة جداً أو ملف مستقل بلا إنترنت) فالوضع محلي
   * ويعمل كما هو.
   * ⚠️ الموظف المسجَّل على نفس الصفحة يرى بياناته الكاملة (state=on, staff). */
  var cloudMode = false;      // السحابة مفعّلة وقابلة للإقلاع في هذا المتصفح
  var cloudSettled = false;   // وصل رد القاعدة (نجاح أو فشل) — قبله لا تُعرض بيانات متصفح

  function cloudBlocked() {
    if (!cloudMode) return false;
    if (!cloudSettled) return true;
    var st = Store.cloudStatus();
    return !(st && st.state === 'on');
  }

  /* ---------------- التهيئة ---------------- */
  function init() {
    Store.init();
    UI.startCountdowns();
    fillSelects();
    bindEvents();
    bindFavorites();
    bindCatsToggle();
    bindTabbar();

    var st = Store.cloudStatus ? Store.cloudStatus() : null;
    cloudMode = !!(st && st.configured && st.willBoot);
    if (cloudMode) {
      renderSkeleton();
      Store.waitForCloud().then(settleCloud, settleCloud);
    } else {
      renderAll();
    }

    Store.subscribe(onDataChanged);
    /* شريط الحالة + تحديثه عند تغيّرها: العرض المحلي لا يُقدَّم كسجل رسمي بلا تنبيه.
       في وضع القاعدة لا نعرضه: رسالة الفشل داخل الشبكة أدقّ (لا نعرض بيانات متصفح
       أصلاً فلا معنى لقول «المعروض من نسخة المتصفح»). */
    if (UI.syncNotice && !cloudMode) UI.syncNotice('#jobs-grid');
    if (Store.onCloudStatus) Store.onCloudStatus(onCloudChanged);
    initReveal();

    // تشغيل قواعد الإفراج التلقائي عند التحميل ثم دورياً (في وضع القاعدة:
    // بعد التبنّي فقط — لا صيانة على كاش متصفح قد لا يعني شيئاً للزائر)
    if (!cloudMode) Store.runMaintenance();
    setInterval(function () {
      if (!cloudMode || cloudSettled) Store.runMaintenance();
    }, 60000);
  }

  /* وصول رد القاعدة: عرض المعلن، أو رسالة الفشل — لا شيء بينهما */
  function settleCloud(st) {
    cloudSettled = true;
    st = st || (Store.cloudStatus ? Store.cloudStatus() : null);
    if (st && st.state === 'on') renderAll();
    else renderCloudError();
  }

  /* أي تغيير في البيانات (emit): يُعرض فقط إن كنا نملك بيانات معروضة أصلاً */
  function onDataChanged() {
    if (cloudBlocked()) return;
    renderAll();
  }

  function onCloudChanged() {
    if (!cloudMode) {
      if (UI.syncNotice) UI.syncNotice('#jobs-grid');
      renderAll();
      return;
    }
    if (!cloudSettled) return;
    if (cloudBlocked()) renderCloudError();
    else renderAll();
  }

  /* ---------------- حركات الظهور عند التمرير ---------------- */
  function initReveal() {
    var els = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!els.length) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var d = Number(en.target.getAttribute('data-d')) || 0;
        setTimeout(function () { en.target.classList.add('is-visible'); }, d);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  function fillSelects() {
    UI.fillSelect(document.getElementById('qs-governorate'), CFG.governorates, 'كل المحافظات');
    UI.fillSelect(document.getElementById('filter-governorate'), CFG.governorates, 'كل المحافظات');
    UI.fillSelect(document.getElementById('filter-shift'), CFG.shifts, 'كل الأوقات');
  }

  function bindEvents() {
    var q = document.getElementById('filter-q');
    /* أُزيل فلتر المناطق — المحافظة وحدها هي الفلتر الجغرافي (2026-10-24) */
    var governorate = document.getElementById('filter-governorate');
    var shift = document.getElementById('filter-shift');
    var status = document.getElementById('filter-status');

    if (q) q.addEventListener('input', UI.debounce(function () { filters.q = q.value; renderJobs(); }));
    if (governorate) governorate.addEventListener('change', function () { filters.governorate = governorate.value; renderJobs(); });
    if (shift) shift.addEventListener('change', function () { filters.shift = shift.value; renderJobs(); });
    if (status) status.addEventListener('change', function () { filters.status = status.value; renderJobs(); });
    var reset = document.getElementById('filter-reset');
    if (reset) reset.addEventListener('click', function () {
      filters = { q: '', governorate: 'all', shift: 'all', status: 'all', category: 'all' };
      if (q) q.value = '';
      if (governorate) governorate.value = 'all';
      var qsGov = document.getElementById('qs-governorate');
      if (qsGov) qsGov.value = 'all';
      if (shift) shift.value = 'all'; if (status) status.value = 'all';
      renderCategories();
      renderJobs();
    });

    // البحث السريع
    var qsForm = document.getElementById('qs-form');
    if (qsForm) qsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      runQuickSearch(
        (document.getElementById('qs-code') || {}).value || '',
        (document.getElementById('qs-governorate') || {}).value || 'all'
      );
    });

    // البحث عبر مسح الكيو آر كود
    var qsScan = document.getElementById('qs-scan');
    if (qsScan) qsScan.addEventListener('click', function () { openQRScanner(); });

    /* سياسة البطاقة (2026-09-30): زر «قدّم ببطاقتك» يفتح نافذة «بطاقتي» في
       booking.js (هذه الوحدة تلتقط [data-action="open-booking"] بنفسها على
       مستوى المستند فتعمل مع البطاقات المعاد رسمها لحظياً). التحقق من
       الاستمارات يبقى محصوراً بالموظفين والإدارة في المنظومة الداخلية. */
    document.addEventListener('click', function (e) {
      var v = e.target.closest && e.target.closest('[data-action="job-details"]');
      if (v) { e.preventDefault(); openJob(v.getAttribute('data-code')); }
      /* إعادة محاولة الاتصال بقاعدة الشركة من رسالة الفشل */
      var r = e.target.closest && e.target.closest('[data-action="retry-cloud"]');
      if (r) { e.preventDefault(); window.location.reload(); }
    });

    // قائمة الجوال
    var toggle = document.getElementById('nav-toggle');
    var nav = document.getElementById('main-nav');
    if (toggle && nav) toggle.addEventListener('click', function () {
      nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', nav.classList.contains('open') ? 'true' : 'false');
    });
    if (nav) nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') nav.classList.remove('open'); });

    // تمييز الرابط النشط حسب موضع التمرير
    window.addEventListener('scroll', UI.debounce(function () {
      var y = window.scrollY + 120, current = '';
      document.querySelectorAll('section[id]').forEach(function (s) {
        if (s.offsetTop <= y) current = s.id;
      });
      document.querySelectorAll('.main-nav a').forEach(function (a) {
        var href = a.getAttribute('href') || '';
        a.classList.toggle('active', href.split('#')[1] === current);
      });
    }, 120));

    var y = document.getElementById('year');
    if (y) y.textContent = Store.fmtDate(new Date()).slice(0,4);
  }

  function runQuickSearch(code, governorate) {
    if (cloudBlocked()) {
      UI.toast(cloudSettled ? 'error' : 'info', cloudSettled ? 'تعذّر الاتصال' : 'جارٍ التحميل',
        cloudSettled ? 'تعذّر الاتصال بقاعدة الشركة — أعد المحاولة أو اتصل بنا هاتفياً.'
                     : 'تُحمَّل الوظائف من قاعدة الشركة الآن — لحظات ويكتمل البحث.', 6000);
      return;
    }
    code = String(code || '').trim();
    governorate = governorate || 'all';
    filters.q = code;
    filters.governorate = governorate;
    var fq = document.getElementById('filter-q');
    var fg = document.getElementById('filter-governorate');
    var qsG = document.getElementById('qs-governorate');
    if (fq) fq.value = code;
    if (fg) fg.value = governorate;
    if (qsG) qsG.value = governorate;
    renderJobs();
    var jobs = document.getElementById('jobs');
    if (jobs) jobs.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var found = Store.listJobs(filters);
    if (found.length === 1) openJob(found[0].code);
    else if (found.length === 0) UI.toast('warn', 'لا نتائج', 'لم نجد وظيفة بهذا الكود أو العنوان — تواصل معنا للاستفسار.');
  }

  function openQRScanner() {
    var scan = root.HRCQRScan;
    if (!scan || !scan.supported() || typeof scan.open !== 'function') {
      UI.toast('warn', 'متصفح غير مدعوم', 'متصفحك لا يدعم مسح الكيو آر كود. اكتب الكود يدوياً أو استخدم متصفح كروم على الجوال/الكمبيوتر.');
      return;
    }
    /* نافذة المسح موحّدة في qr-scan.js (كاميرا + رفع صورة) ويستعملها أيضاً
       زر مسح باركود البطاقة في نافذة «بطاقتي» — تنفيذ واحد لا نسختان. */
    var opened = scan.open({
      title: 'البحث بمسح الكيو آر كود',
      subtitle: 'امسح رمز QR المطبوع على بطاقة الوظيفة أو بطاقة التوظيف للوصول إليها مباشرة',
      onResult: applyScannedText
    });
    if (!opened) UI.toast('warn', 'متصفح غير مدعوم', 'تعذّر فتح الكاميرا — استخدم البحث بالكود يدوياً.');
  }

  /* تحليل نص الرمز الممسوح: كود وظيفة / باركود بطاقة / نص حر */
  function applyScannedText(text) {
    text = String(text || '').trim();
    if (!text) { UI.toast('warn', 'كود فارغ', 'لم يُقرأ أي نص من الرمز.'); return; }

    /* رمز بطاقة توظيف (HRC-BC-…): نفتح «بطاقتي» مباشرة بالباركود المعبّأ —
       الزبون يرى حالته المقنّعة، واستخدام الفرصة يتطلب رمزها السري. */
    /* الباركود الجديد (10 خانات بلا بادئة): يأتي داخل رابط apply.html?form=… أو نصاً مجرداً */
    var cand = null;
    var qm = /[?&#](?:form|card|bc|serial)=([A-Za-z0-9-]+)/i.exec(text);
    if (qm) cand = qm[1];
    else if (/^\s*[A-Za-z0-9-]+\s*$/.test(text)) cand = text.trim();
    else { var legacy = text.match(/HRC-BC-\d+/i); if (legacy) cand = legacy[0]; }
    var serial = cand && Store.isCardSerial(cand) ? [Store.normalizeCardSerial(cand)] : null;
    if (serial) {
      /* باركود البطاقة نفسه مرتبط بصفحة التقديم (apply.html?form=…) — نفتحها
         مباشرة كما لو مُسح الرمز بكاميرا الهاتف. وإن لم تكن الصفحة متاحة
         (الملف المستقل) أو كانت الصفحة الحالية هي صفحتها، نعرض الحالة. */
      var B = root.HRCBooking;
      if (B && B.canApply && B.canApply() && !/apply\.html/i.test(String(location.pathname || ''))) {
        location.assign(B.applyUrl(serial[0]));
        return;
      }
      if (B && B.open) {
        B.open({ serial: serial[0] });
      } else {
        UI.toast('info', 'بطاقة توظيف شركة الهدف',
          'افتح الموقع الرئيسي وأدخل باركود بطاقتك من نافذة «بطاقتي».', 8000);
      }
      return;
    }

    var job = text.match(/HRC-\d{3,}/i);
    if (job) {
      var code = job[0].toUpperCase();
      var input = document.getElementById('qs-code');
      if (input) input.value = code;
      runQuickSearch(code, (document.getElementById('qs-governorate') || {}).value || 'all');
      return;
    }

    var input = document.getElementById('qs-code');
    if (input) input.value = text;
    runQuickSearch(text, (document.getElementById('qs-governorate') || {}).value || 'all');
  }

  /* ---------------- العرض ---------------- */
  /* ── شريط التصنيفات: يُبنى من تصنيفات الوظائف المعروضة فعلاً ── */
  function renderCategories() {
    var host = document.getElementById('cat-rail');
    if (!host) return;
    if (cloudBlocked()) { host.innerHTML = ''; return; }
    var jobs = Store.listJobs({});
    var counts = {};
    jobs.forEach(function (j) { var c = j.category || 'أخرى'; counts[c] = (counts[c] || 0) + 1; });
    var cats = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 5);
    /* لوحة ألوان حيّة: كل تخصص بلونه (ثابت لا يتغيّر بين التحميلات) */
    var PALETTE = ['#0f9c94', '#2563d9', '#7c4ddb', '#d98324', '#16a34a', '#db3d6a', '#0891b2'];
    catColor = {};
    cats.forEach(function (c, i) { catColor[c] = PALETTE[i % PALETTE.length]; });
    var hint = document.getElementById('cats-hint');
    if (hint) hint.textContent = (cur && cur !== 'all') ? 'مُصفّى: ' + cur : 'كل التخصصات';
    var cur = filters.category || 'all';
    var html = '<button type="button" class="cat' + (cur === 'all' ? ' is-active' : '') + '" data-cat="all" role="tab"' +
      ' aria-selected="' + (cur === 'all') + '" style="--cat:var(--gold)">' +
      '<span class="cat-ic"><svg class="ic"><use href="#i-grid" xlink:href="#i-grid"/></svg></span>' +
      '<span>الكل</span><b>' + jobs.length + ' وظيفة</b></button>';
    html += cats.map(function (c) {
      return '<button type="button" class="cat' + (cur === c ? ' is-active' : '') + '" data-cat="' + UI.esc(c) + '" role="tab"' +
        ' aria-selected="' + (cur === c) + '" style="--cat:' + catColor[c] + '">' +
        '<span class="cat-ic"><svg class="ic"><use href="#' + catIcon(c) + '" xlink:href="#' + catIcon(c) + '"/></svg></span>' +
        '<span>' + UI.esc(c) + '</span><b>' + counts[c] + '</b></button>';
    }).join('');
    host.innerHTML = html;
    host.querySelectorAll('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-cat');
        filters.category = (filters.category === v && v !== 'all') ? 'all' : v;  /* ضغطة ثانية تلغي */
        renderCategories();
        renderJobs();
      });
    });
    renderActiveChips();
  }

  /* شرائح التصفية النشطة: تُظهر ما هو مطبَّق الآن + زر إزالته */
  function renderActiveChips() {
    var host = document.getElementById('f-active');
    if (!host) return;
    var chips = [];
    if (filters.category && filters.category !== 'all') chips.push({ k: 'category', t: 'التخصص: ' + filters.category });
    if (filters.governorate && filters.governorate !== 'all') chips.push({ k: 'governorate', t: filters.governorate });
    if (filters.shift && filters.shift !== 'all') chips.push({ k: 'shift', t: 'دوام: ' + filters.shift });
    if (filters.status && filters.status !== 'all') chips.push({ k: 'status', t: 'الحالة: ' + ((CFG.jobStatus[filters.status] || {}).ar || filters.status) });
    if (filters.q) chips.push({ k: 'q', t: 'بحث: ' + filters.q });
    if (!chips.length) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = '<span class="tiny muted" style="font-weight:800">مطبَّق:</span>' +
      chips.map(function (c) {
        return '<span class="f-chip">' + UI.esc(c.t) +
          '<button type="button" data-clear="' + c.k + '" aria-label="إزالة ' + UI.esc(c.t) + '">×</button></span>';
      }).join('');
    host.querySelectorAll('[data-clear]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-clear');
        filters[k] = (k === 'q') ? '' : 'all';
        var el = document.getElementById(k === 'q' ? 'filter-q' : 'filter-' + k);
        if (el) el.value = filters[k];
        renderCategories(); renderJobs();
      });
    });
  }

  /* ── التصنيفات: مخفيّة حتى يضغط الزائر «عرض التخصصات» ── */
  function bindCatsToggle() {
    var btn = document.getElementById('cats-toggle');
    var grid = document.getElementById('cat-rail');
    if (!btn || !grid) return;
    btn.addEventListener('click', function () {
      var open = grid.hidden;
      grid.hidden = !open;
      grid.classList.toggle('is-collapsed', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      var label = btn.querySelector('span');
      if (label) label.textContent = open ? 'إخفاء التخصصات' : 'عرض التخصصات';
      btn.classList.toggle('is-open', open);
      if (open) {
        var y = document.getElementById('categories');
        if (y && window.scrollTo) window.scrollTo({ top: y.offsetTop - 80, behavior: 'smooth' });
      }
    });
  }

  /* ══════════════════ موجّه صفحات التطبيق ══════════════════
   * كل تبويب في الشريط السفلي يفتح **صفحة كاملة** بمحتواها (نمط التطبيقات):
   * تُخفى بقية أقسام الموقع ويظهر شريط صفحة بعنوانها وزر رجوع.
   * «الرئيسية» تُخرج من نمط الصفحات وتُعيد الواجهة الكاملة كما هي.
   * الحالة تُحفظ في الرابط (#!page=jobs) فتعمل أزرار الرجوع في المتصفح
   * ويمكن مشاركة رابط الصفحة مباشرة. */
  var APP_PAGES = {
    jobs: { t: 'الوظائف', s: 'تصفّح الفرص المتاحة وقدّم ببطاقتك' },
    favorites: { t: 'المفضلة', s: 'الوظائف التي حفظتها بضغطة القلب' },
    card: { t: 'بطاقة التوظيف', s: 'شكل البطاقة وشروطها وطريقة التقديم' },
    contact: { t: 'تواصل معنا', s: 'عنوان المكتب وأرقام التواصل وأوقات العمل' }
  };
  var currentPage = 'home';

  function paintActiveTab(page) {
    document.querySelectorAll('.tabbar [data-page-tab]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-page-tab') === page);
    });
  }

  function openPage(page, opts) {
    opts = opts || {};
    var isHome = page === 'home' || !APP_PAGES[page];
    currentPage = isHome ? 'home' : page;
    var meta = APP_PAGES[currentPage] || {};
    document.body.classList.toggle('app-focus', !isHome);
    document.body.setAttribute('data-app-page', currentPage);
    var bar = document.getElementById('page-bar');
    if (bar) {
      bar.hidden = isHome;
      var t = document.getElementById('pb-title');
      var sb = document.getElementById('pb-sub');
      if (t) t.textContent = meta.t || '';
      if (sb) sb.textContent = meta.s || '';
      var badge = document.getElementById('pb-badge');
      if (badge) {
        if (currentPage === 'favorites') {
          var n = favList().length;
          badge.textContent = n ? n + ' وظيفة' : '';
          badge.hidden = !n;
        } else if (currentPage === 'jobs') {
          var nj = 0;
          try { nj = Store.listJobs({}).length; } catch (e) { nj = 0; }
          badge.textContent = nj ? nj + ' وظيفة' : '';
          badge.hidden = !nj;
        } else { badge.hidden = true; }
      }
    }
    paintActiveTab(currentPage);
    if (currentPage === 'favorites') renderFavorites();
    if (currentPage === 'jobs') { renderCategories(); renderJobs(); }
    if (!opts.keepHash) {
      var hash = isHome ? '#home' : '#!/' + currentPage;
      try { history.pushState({ page: currentPage }, '', hash); } catch (e) { }
    }
    if (!opts.noScroll) {
      var anchor = document.getElementById(isHome ? 'home' : currentPage);
      var top = anchor ? Math.max(0, anchor.getBoundingClientRect().top + window.scrollY - (isHome ? 0 : 74)) : 0;
      window.scrollTo({ top: top, behavior: opts.instant ? 'auto' : 'smooth' });
    }
  }

  function pageFromHash() {
    var h = String(location.hash || '');
    var m = h.match(/^#!\/?(\w+)/);
    if (m && APP_PAGES[m[1]]) return m[1];
    return 'home';
  }

  function bindTabbar() {
    document.querySelectorAll('.tabbar [data-page-tab]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        openPage(b.getAttribute('data-page-tab'));
      });
    });
    var back = document.getElementById('pb-back');
    if (back) back.addEventListener('click', function () { openPage('home'); });
    window.addEventListener('popstate', function () {
      openPage(pageFromHash(), { keepHash: true, noScroll: true });
    });
    window.addEventListener('hashchange', function () {
      if (currentPage !== pageFromHash()) openPage(pageFromHash(), { keepHash: true, noScroll: true });
    });
    /* إتاحة الوصول: نُظهر إطارات التركيز فقط عند التنقّل بلوحة المفاتيح */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') document.body.classList.add('kbd');
    });
    document.addEventListener('mousedown', function () { document.body.classList.remove('kbd'); }, { passive: true });

    /* فتح مباشر من الرابط */
    var start = pageFromHash();
    if (start !== 'home') openPage(start, { keepHash: true, noScroll: true, instant: true });
    else paintActiveTab('home');
  }

  /* ── المفضلة: تبديل فوري + تحديث قسم «المفضلة» والعدّاد ──
     الربط مفوَّض على الصفحة كلها، فتعمل القلوب في شبكة الوظائف وفي المفضلة. */
  function bindFavorites() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-fav]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var code = b.getAttribute('data-fav');
      var on = favToggle(code);
      renderFavorites();
      if (UI.toast) UI.toast(on ? 'ok' : 'info', on ? 'أُضيفت للمفضلة' : 'أُزيلت من المفضلة',
        on ? 'ستجدها في قسم «المفضلة» أسفل الوظائف.' : 'يمكنك إضافتها مجدداً في أي وقت.');
    });
    var clear = document.getElementById('fav-clear');
    if (clear) clear.addEventListener('click', function () {
      try { localStorage.removeItem(FAV_KEY); } catch (e) { }
      renderFavorites();
      if (UI.toast) UI.toast('info', 'مُسحت المفضلة', 'لا توجد وظائف محفوظة الآن.');
    });
  }

  /* ── قسم المفضلة: يعرض الوظائف المحفوظة بنفس كروت الموقع ──
     إن حُذفت وظيفة من القاعدة أو أُغلقت، تبقى معلومة صريحة للزائر بدل اختفاء صامت. */
  function renderFavorites() {
    var host = document.getElementById('fav-grid');
    if (!host) return;
    var saved = favList();
    var jobs = [];
    var gone = 0;
    saved.forEach(function (c) {
      var j = null;
      try { j = Store.getJob(c); } catch (e) { j = null; }
      if (j) jobs.push(j); else gone++;
    });
    var empty = document.getElementById('fav-empty');
    var clear = document.getElementById('fav-clear');
    var badge = document.getElementById('fav-count');
    if (badge) { badge.textContent = jobs.length > 99 ? '99+' : String(jobs.length); badge.hidden = jobs.length === 0; }
    if (clear) clear.hidden = saved.length === 0;
    if (empty) empty.hidden = jobs.length > 0;
    host.innerHTML = jobs.map(cardHtml).join('') +
      (gone ? '<div class="fav-note">' + UI.ic('info') + ' ' + gone + ' وظيفة محفوظة لم تعد معروضة (أُغلقت أو حُذفت).</div>' : '');
  }

  /* ── بطاقة التوظيف الحقيقية على الموقع ──
     نرسم الوجهين بنفس قالب الطباعة (HRCVoucher.buildHtml) ببطاقة نموذجية
     بلا بيانات زبون، فتكون الصورة على الموقع مطابقة تماماً للورقة المطبوعة. */
  function renderCardShowcase() {
    var host = document.getElementById('card-showcase');
    if (!host || host.dataset.done) return;
    var V = root.HRCVoucher;
    if (!V || !V.frontHtml || !V.backHtml) return;
    try {
      /* بطاقة نموذجية بلا بيانات زبون — الوجهان من نفس قالب الطباعة حرفياً */
      var sample = { serial: 'K7M2XQ9T4R', status: 'blank', issueDate: null, expiryDate: null, cardPrintCode: null };
      host.innerHTML =
        '<div class="cs-front">' +
          '<span class="cs-badge">شكل البطاقة الفعلي</span>' +
          '<div class="cs-slot">' + V.frontHtml(sample) + '</div>' +
        '</div>' +
        '<div class="cs-back"><div class="cs-slot">' + V.backHtml(sample) + '</div></div>';
      host.dataset.done = 'yes';
    } catch (e) { /* البطاقة تحسين بصري — لا تُعطّل الصفحة */ }
  }

  function renderAll() { renderHeroStats(); renderCategories(); renderJobs(); renderFavorites(); renderCardShowcase(); }

  root.HRCRefresh = function () {
    if (cloudBlocked()) { if (cloudSettled) renderCloudError(); else renderSkeleton(); return; }
    renderAll();
  };

  /* هيكل تحميل يظهر بدل بيانات المتصفح لحظة انتظار رد القاعدة */
  function skeletonCard() {
    return '<article class="job-card skeleton" aria-hidden="true">' +
      '<div class="skel-body">' +
        '<div class="skel-line w60" style="height:16px"></div>' +
        '<div class="skel-line w40"></div>' +
        '<div class="skel-line"></div><div class="skel-line w80"></div><div class="skel-line w60"></div>' +
      '</div>' +
      '<div class="skel-foot"><span class="skel-line sq"></span><span class="skel-line sq" style="width:96px"></span></div>' +
    '</article>';
  }

  function renderSkeleton() {
    var host = document.getElementById('jobs-grid');
    if (host) host.innerHTML = skeletonCard().repeat(6);
    var empty = document.getElementById('jobs-empty');
    if (empty) empty.classList.add('hidden');
    var count = document.getElementById('jobs-count');
    if (count) count.textContent = '…';
    var hs = document.getElementById('hero-stats');
    if (hs) {
      hs.innerHTML = ['w60', 'w40', 'w60', 'w40'].map(function (w) {
        return '<div class="app-stat skeleton"><span class="skel-line ' + w + '"></span><span class="skel-line w80"></span></div>';
      }).join('');
    }
  }

  /* فشل الاتصال بالقاعدة: رسالة واضحة + إعادة محاولة — لا نسقوط لبيانات المتصفح */
  function renderCloudError() {
    var host = document.getElementById('jobs-grid');
    if (host) {
      host.innerHTML =
        '<div class="empty-state" role="alert">' +
          '<svg class="ic"><use href="#i-alert" xlink:href="#i-alert"/></svg>' +
          '<h3>تعذّر الاتصال بقاعدة الشركة</h3>' +
          '<p class="mb-2">تعذّر تحميل الوظائف المعلنة الآن — تحقّق من اتصالك بالإنترنت ثم أعد المحاولة، أو اتصل بنا على الأرقام الرسمية.</p>' +
          '<button class="btn btn-outline btn-sm" data-action="retry-cloud">' + UI.ic('refresh') + ' إعادة المحاولة</button>' +
        '</div>';
    }
    var empty = document.getElementById('jobs-empty');
    if (empty) empty.classList.add('hidden');
    var count = document.getElementById('jobs-count');
    if (count) count.textContent = '—';
    var hs = document.getElementById('hero-stats');
    if (hs) {
      hs.innerHTML = ['—', '—'].map(function () {
        return '<div class="app-stat"><b>—</b><span>…</span></div>';
      }).join('');
    }
  }

  function renderHeroStats() {
    var host = document.getElementById('hero-stats');
    if (!host) return;
    if (cloudBlocked()) return;   // الهيكل/رسالة الفشل تسيّر العرض هنا
    /* الزائر في وضع القاعدة يرى إحصاءات الوظائف المعلنة فقط — أعداد الاستمارات
       والتوظيف بيانات داخلية (وأي رقم متصفح هنا سيكون من بيانات تجريبية).
       الموظف المسجَّل يرى أرقام النظام الكاملة. */
    var staff = false;
    try { staff = !!(Store.currentUser && Store.currentUser()); } catch (e) { staff = false; }
    var items;
    if (cloudMode && !staff) {
      var jobsAll = Store.listJobs({});
      items = [
        { ic: 'briefcase', v: jobsAll.filter(function (j) { return j.status === 'available'; }).length, l: 'وظيفة متاحة الآن' },
        { ic: 'card', v: '2', l: 'فرصتان بكل بطاقة' },
        { ic: 'calendar', v: '30', l: 'يوماً صلاحية البطاقة' },
        { ic: 'clock', v: '24', l: 'ساعة حجز عادل' }
      ];
    } else {
      var s = Store.stats();
      items = [
        { ic: 'briefcase', v: s.available, l: 'وظيفة متاحة الآن' },
        { ic: 'card', v: s.forms, l: 'بطاقة صادرة' },
        { ic: 'users', v: s.hires, l: 'توظيف ناجح' },
        { ic: 'clock', v: '24', l: 'ساعة حجز عادل' }
      ];
    }
    host.innerHTML = items.map(function (i) {
      return '<div class="app-stat">' + UI.ic(i.ic) + '<b>' + UI.esc(String(i.v)) + '</b><span>' + UI.esc(i.l) + '</span></div>';
    }).join('');
  }

  /* ── شريط التصنيفات: يُبنى من تصنيفات الوظائف المعروضة فعلاً ── */

  root.HRCRefresh = function () {
    if (cloudBlocked()) { if (cloudSettled) renderCloudError(); else renderSkeleton(); return; }
    renderAll();
  };

  /* هيكل تحميل يظهر بدل بيانات المتصفح لحظة انتظار رد القاعدة */
  function skeletonCard() {
    return '<article class="job-card skeleton" aria-hidden="true">' +
      '<div class="skel-body">' +
        '<div class="skel-line w60" style="height:16px"></div>' +
        '<div class="skel-line w40"></div>' +
        '<div class="skel-line"></div><div class="skel-line w80"></div><div class="skel-line w60"></div>' +
      '</div>' +
      '<div class="skel-foot"><span class="skel-line sq"></span><span class="skel-line sq" style="width:96px"></span></div>' +
    '</article>';
  }

  function renderSkeleton() {
    var host = document.getElementById('jobs-grid');
    if (host) host.innerHTML = skeletonCard().repeat(6);
    var empty = document.getElementById('jobs-empty');
    if (empty) empty.classList.add('hidden');
    var count = document.getElementById('jobs-count');
    if (count) count.textContent = '…';
    var hs = document.getElementById('hero-stats');
    if (hs) {
      hs.innerHTML = ['w60', 'w40', 'w60', 'w40'].map(function (w) {
        return '<div class="app-stat skeleton"><span class="skel-line ' + w + '"></span><span class="skel-line w80"></span></div>';
      }).join('');
    }
  }

  /* فشل الاتصال بالقاعدة: رسالة واضحة + إعادة محاولة — لا نسقوط لبيانات المتصفح */
  function renderCloudError() {
    var host = document.getElementById('jobs-grid');
    if (host) {
      host.innerHTML =
        '<div class="empty-state" role="alert">' +
          '<svg class="ic"><use href="#i-alert" xlink:href="#i-alert"/></svg>' +
          '<h3>تعذّر الاتصال بقاعدة الشركة</h3>' +
          '<p class="mb-2">تعذّر تحميل الوظائف المعلنة الآن — تحقّق من اتصالك بالإنترنت ثم أعد المحاولة، أو اتصل بنا على الأرقام الرسمية.</p>' +
          '<button class="btn btn-outline btn-sm" data-action="retry-cloud">' + UI.ic('refresh') + ' إعادة المحاولة</button>' +
        '</div>';
    }
    var empty = document.getElementById('jobs-empty');
    if (empty) empty.classList.add('hidden');
    var count = document.getElementById('jobs-count');
    if (count) count.textContent = '—';
    var hs = document.getElementById('hero-stats');
    if (hs) {
      hs.innerHTML = ['—', '—'].map(function () {
        return '<div class="app-stat"><b>—</b><span>…</span></div>';
      }).join('');
    }
  }

  function renderJobs() {
    var host = document.getElementById('jobs-grid');
    if (!host) return;
    if (cloudBlocked()) { if (!cloudSettled) renderSkeleton(); else renderCloudError(); return; }
    var jobs = Store.listJobs(filters);
    if (filters.category && filters.category !== 'all') {
      jobs = jobs.filter(function (j) { return (j.category || '') === filters.category; });
    }
    var count = document.getElementById('jobs-count');
    if (count) count.textContent = jobs.length;
    var upd = document.getElementById('jobs-updated');
    if (upd) upd.textContent = Store.fmtDateTime(new Date());
    var empty = document.getElementById('jobs-empty');
    if (empty) {
      var showEmpty = jobs.length === 0;
      empty.classList.toggle('hidden', !showEmpty);
      if (showEmpty) {
        /* رسالتان مختلفتان: قاعدة بلا وظائف معلنة ≠ تصفية بلا نتائج */
        var noListings = cloudMode && Store.listJobs({}).length === 0;
        var h = empty.querySelector('h3');
        var p = empty.querySelector('p');
        if (h) h.textContent = noListings ? 'لا توجد وظائف معروضة حالياً' : 'لا توجد وظائف مطابقة';
        if (p) p.textContent = noListings
          ? 'تُنشر فرص العمل هنا فور اعتمادها من قِبل الشركة — تابعونا أو اتصل بنا لمعرفة الشواغر الحالية.'
          : 'جرّب كوداً آخر أو صفّر عوامل التصفية، أو تواصل معنا لتسجيلك في قائمة الانتظار.';
      }
    }
    host.innerHTML = jobs.map(cardHtml).join('');
    renderActiveChips();
  }

  /* رابط الحجز: واتساب الشركة برسالة جاهزة تحمل كود الوظيفة وعنوانها،
     حتى يصل الاستفسار واضحاً لمكتب الشركة مباشرة. */
  function waNumber() {
    var raw = (CFG.company && CFG.company.whatsapp) ||
      (CFG.company && CFG.company.phones && CFG.company.phones[0]) || '07760058007';
    var d = String(raw).replace(/\D/g, '');
    if (d.indexOf('00') === 0) d = d.slice(2);
    else if (d.charAt(0) === '0') d = '964' + d.slice(1);
    return d;
  }

  function bookUrl(code, title) {
    var msg = 'مرحباً شركة الهدف للتوظيف، أرغب بالحجز على وظيفة ' + (code || '') +
      (title ? ' — ' + title : '') + '.';
    return 'https://wa.me/' + waNumber() + '?text=' + encodeURIComponent(msg);
  }

  /* أيقونة التصنيف: تُطابق أسماء تصنيفات الشركة في config.jobCategories */
  var CAT_ICON = {
    'صناعي': 'i-building', 'خدمات': 'i-users', 'صحي': 'i-shield', 'هندسي': 'i-chart',
    'إداري': 'i-list', 'تجاري': 'i-bag', 'زراعي': 'i-sparkle', 'تقني': 'i-server'
  };
  function catIcon(c) { return CAT_ICON[c] || 'i-briefcase'; }

  /* صورة افتراضية للكرت عندما لا تكون الشركة قد رفعت صورة للوظيفة:
     تُختار من صور التخصصات المرفقة مع الموقع (بلا أي طلب خارجي). */
  var CAT_IMG = {
    'صناعي': 'job-warehouse', 'خدمات': 'job-sales', 'صحي': 'job-nurse', 'هندسي': 'job-engineer',
    'إداري': 'job-sales', 'تجاري': 'job-cashier', 'زراعي': 'job-warehouse', 'تقني': 'job-electrician'
  };
  var TITLE_IMG = [
    [/سائق|نقل|شاحن|حمولة|توصيل/, 'job-truck'],
    [/طباخ|شيف|مطبخ|باريستا|كافيه|مقهى|مطعم/, 'job-chef'],
    [/كهرب|فني|صيانة|ميكانيك/, 'job-electrician'],
    [/ممرض|طبي|صح|صيدل/, 'job-nurse'],
    [/مهندس|هندس/, 'job-engineer'],
    [/مخزن|مستودع|عامل/, 'job-warehouse'],
    [/كاشير|مبيعات|بائع/, 'job-cashier']
  ];
  function defaultJobImage(j) {
    var t = String(j.title || '');
    for (var i = 0; i < TITLE_IMG.length; i++) if (TITLE_IMG[i][0].test(t)) return 'assets/img/jobs/' + TITLE_IMG[i][1] + '.webp';
    var byCat = CAT_IMG[j.category];
    return 'assets/img/jobs/' + (byCat || 'job-warehouse') + '.webp';
  }

  /* شارة الكرت: تعبير صادق عن حالة الوظيفة (لا شارات تجميلية بلا معنى) */
  function cardBadge(j) {
    if (j.status === 'reserved') return { cls: 'is-reserved', t: 'محجوزة' };
    if (j.status === 'hiring') return { cls: 'is-new', t: 'جاري التوظيف' };
    if (j.status === 'closed') return { cls: 'is-closed', t: 'مغلقة' };
    var n = Number(j.vacancies || 1);
    if (n > 1) return { cls: '', t: 'مميز' };
    return { cls: 'is-vacant', t: 'شاغر' };
  }

  /* جهة العمل: لا نكشف اسم صاحب العمل أو هاتفه للزائر (سياسة الخصوصية).
     نعرض وصفاً عاماً من التصنيف — نفس ما كان معروضاً في البطاقة سابقاً. */
  function employerName(j) {
    return (j.category ? j.category + ' · ' : '') + (j.gender && j.gender !== 'لا فرق' ? j.gender : 'فرصة متاحة');
  }

  function cardHtml(j) {
    var st = CFG.jobStatus[j.status];
    var cls = 'app-card' + (j.status === 'reserved' ? ' is-reserved' : (j.status === 'closed' ? ' is-closed' : ''));
    var hold = '';
    if (j.status === 'reserved' && j.holdExpiresAt) {
      var h = Store.diffHours(j.holdExpiresAt, new Date());
      hold = (h > 0 ? 'تُفرج خلال ' + Math.ceil(h) + ' ساعة' : 'قيد الإفراج');
    }
    var imgSrc = j.imageUrl || defaultJobImage(j);
    var imageHtml = '<div class="job-image" style="--img:url(&quot;' + UI.esc(imgSrc) + '&quot;)">' +
      '<span class="job-ph" aria-hidden="true"><svg class="ic"><use href="#i-briefcase" xlink:href="#i-briefcase"/></svg></span>' +
      '<img src="' + UI.esc(imgSrc) + '" alt="' + UI.esc(j.title) + '" loading="lazy" decoding="async"' +
        (j.imageUrl ? ' referrerpolicy="no-referrer"' : '') +
        ' onload="this.parentNode.classList.add(\'has-img\')" onerror="this.remove()">' + '</div>';
    var b = cardBadge(j);
    var fav = favList().indexOf(j.code) >= 0;
    var salary = Store.money(j.salaryMin) + (j.salaryMax && j.salaryMax !== j.salaryMin ? ' – ' + Store.money(j.salaryMax) : '');
    return '' +
      '<article class="job-card ' + cls + '">' +
        imageHtml +
        '<div class="ac-top">' +
          '<span class="ac-badge ' + b.cls + '">' + UI.esc(b.t) + '</span>' +
          '<button type="button" class="ac-fav' + (fav ? ' is-on' : '') + '" data-fav="' + UI.esc(j.code) + '"' +
            ' aria-pressed="' + (fav ? 'true' : 'false') + '" aria-label="حفظ في المفضلة" title="حفظ في المفضلة">' +
            '<svg class="ic"><use href="#i-heart" xlink:href="#i-heart"/></svg></button>' +
        '</div>' +
        '<div class="ac-body" data-action="job-details" data-code="' + UI.esc(j.code) + '" role="button" tabindex="0"' +
          ' aria-label="تفاصيل الوظيفة ' + UI.esc(j.title) + '">' +
          '<h3 class="job-title">' + UI.esc(j.title) + '</h3>' +
          '<div class="ac-row"><svg class="ic"><use href="#i-building" xlink:href="#i-building"/></svg><span>' + UI.esc(employerName(j)) + '</span>' +
            '<span class="mono job-code" style="margin-inline-start:0;color:#9aa7b8;font-weight:700">' + UI.esc(j.code) + '</span></div>' +
          '<div class="ac-row"><svg class="ic"><use href="#i-money" xlink:href="#i-money"/></svg><b>' + salary + '</b></div>' +
          '<div class="ac-row"><svg class="ic"><use href="#i-clock" xlink:href="#i-clock"/></svg><span>' + UI.esc(j.shift) + '</span></div>' +
          '<div class="ac-row"><svg class="ic"><use href="#i-calendar" xlink:href="#i-calendar"/></svg><span>6 أيام بالأسبوع</span></div>' +
          '<div class="ac-row"><svg class="ic"><use href="#i-pin" xlink:href="#i-pin"/></svg><span>' + UI.esc(j.governorate || '—') + '</span></div>' +
          (hold ? '<div class="ac-row"><svg class="ic"><use href="#i-hourglass" xlink:href="#i-hourglass"/></svg><span class="tiny muted">' + hold + '</span></div>' : '') +
        '</div>' +
        '<div class="ac-foot">' +
          (j.status === 'available'
            ? '<button class="btn" data-action="open-booking" data-code="' + UI.esc(j.code) + '">تقديم الآن <svg class="ic" style="width:15px;height:15px;transform:rotate(-90deg)"><use href="#i-arrow-right" xlink:href="#i-arrow-right"/></svg></button>'
            : '<button class="btn" data-action="job-details" data-code="' + UI.esc(j.code) + '">' + UI.esc(st.ar) + ' — التفاصيل</button>') +
        '</div>' +
      '</article>';
  }

  /* ---------------- صفحة الوظيفة (عرض عام محجوب بيانات صاحب العمل) ---------------- */
  /* ================== تفاصيل الوظيفة — نافذة حيّة بأنماط احترافية ==================
   * صورة غلاف + عنوان وشارات فوقها، شريط أرقام سريع، متطلبات كشرائح، خطوات التقديم
   * كخطّ زمني، وملاحظة خصوصية. كل الأزرار في تذييل ثابت داخل النافذة (لا يغطّيها
   * شريط التنقل السفلي — انظر طبقات app-shell.css و body.modal-open). */
  function openJob(code) {
    var j = Store.getJob(code);
    if (!j) return;
    var st = CFG.jobStatus[j.status] || { ar: j.status };
    var img = j.imageUrl || defaultJobImage(j);
    var vac = (j.availableVacancies != null ? j.availableVacancies : Store.vacancySummary(j).available);
    var salary = Store.money(j.salaryMin) + ' – ' + Store.money(j.salaryMax);
    var reqs = (j.requirements || []);
    var badge = cardBadge(j);

    var body = '' +
      '<div class="jd-hero" style="--img:url(&quot;' + UI.esc(img) + '&quot;)">' +
        '<img src="' + UI.esc(img) + '" alt="' + UI.esc(j.title) + '" loading="lazy" decoding="async">' +
        '<div class="jd-hero-veil"></div>' +
        '<div class="jd-hero-top">' +
          '<span class="ac-badge ' + badge.cls + '">' + UI.esc(badge.t) + '</span>' +
          '<span class="jd-code mono">' + UI.esc(j.code) + '</span>' +
        '</div>' +
        '<div class="jd-hero-copy">' +
          '<span class="jd-cat"><svg class="ic"><use href="#' + catIcon(j.category) + '" xlink:href="#' + catIcon(j.category) + '"/></svg> ' + UI.esc(j.category || '—') + '</span>' +
          '<h2>' + UI.esc(j.title) + '</h2>' +
          '<div class="jd-hero-meta">' +
            '<span><svg class="ic"><use href="#i-pin" xlink:href="#i-pin"/></svg> ' + UI.esc(j.governorate || 'بابل') + '</span>' +
            '<span><svg class="ic"><use href="#i-clock" xlink:href="#i-clock"/></svg> ' + UI.esc(j.shift) + '</span>' +
            '<span><svg class="ic"><use href="#i-money" xlink:href="#i-money"/></svg> ' + salary + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="jd-stats">' +
        '<div class="jd-stat"><svg class="ic"><use href="#i-money" xlink:href="#i-money"/></svg><b>' + salary + '</b><span>الأجر الشهري</span></div>' +
        '<div class="jd-stat"><svg class="ic"><use href="#i-users" xlink:href="#i-users"/></svg><b>' + vac + (j.vacancies ? ' من ' + j.vacancies : '') + '</b><span>الشواغر المتاحة</span></div>' +
        '<div class="jd-stat"><svg class="ic"><use href="#i-clock" xlink:href="#i-clock"/></svg><b>' + UI.esc(j.shift) + '</b><span>الدوام</span></div>' +
        '<div class="jd-stat"><svg class="ic"><use href="#i-user" xlink:href="#i-user"/></svg><b>' + UI.esc(j.gender || 'لا فرق') + '</b><span>الجنس المطلوب</span></div>' +
      '</div>' +

      (reqs.length
        ? '<section class="jd-block"><h3 class="jd-h"><svg class="ic"><use href="#i-check-circle" xlink:href="#i-check-circle"/></svg> الشروط والمتطلبات</h3>' +
          '<ul class="jd-reqs">' + reqs.map(function (r) {
            return '<li><svg class="ic"><use href="#i-check" xlink:href="#i-check"/></svg><span>' + UI.esc(r) + '</span></li>';
          }).join('') + '</ul></section>'
        : '') +

      (j.description
        ? '<section class="jd-block"><h3 class="jd-h"><svg class="ic"><use href="#i-file" xlink:href="#i-file"/></svg> وصف الوظيفة</h3>' +
          '<p class="jd-desc">' + UI.esc(j.description) + '</p></section>'
        : '') +

      '<section class="jd-block"><h3 class="jd-h"><svg class="ic"><use href="#i-hourglass" xlink:href="#i-hourglass"/></svg> كيف تُقدّم عليها؟</h3>' +
        '<ol class="jd-steps">' +
          '<li><b>١</b><div><span>تقدر تقدم ببطاقة التوظيف</span><small>امسح باركود بطاقتك أو أدخله — الحيازة وحدها تكفي.</small></div></li>' +
          '<li><b>٢</b><div><span>حجز 24 ساعة باسمك</span><small>الوظيفة تُحجز لك وحدك بانتظار نتيجة المقابلة.</small></div></li>' +
          '<li><b>٣</b><div><span>تُطبع استمارة A4</span><small>تحمل بياناتك والوظيفة — سلّمها لصاحب العمل.</small></div></li>' +
          '<li><b>٤</b><div><span>قرار الشركة</span><small>توظيف أو إرجاع الوظيفة — والفرصة المستهلكة لا تعود.</small></div></li>' +
        '</ol></section>' +

      '<div class="jd-privacy"><svg class="ic"><use href="#i-lock" xlink:href="#i-lock"/></svg>' +
        '<p><b>خصوصية صاحب العمل:</b> لا تُعرض بياناته (الاسم والهاتف والعنوان) في الموقع العام. ' +
        'تُسلَّم للباحث عبر شركة الهدف عند التقديم ببطاقة التوظيف، وفق سياسة الشركة.</p></div>';

    UI.modal({
      title: j.title,
      subtitle: 'تفاصيل الوظيفة · ' + (j.governorate || '—') + ' · ' + j.code,
      body: body, wide: true,
      footer: (j.status === 'available'
        ? '<button class="btn btn-gold" data-action="open-booking" data-code="' + UI.esc(j.code) + '">' +
          UI.ic('card') + ' قدّم على هذه الوظيفة ببطاقتك</button>' +
          '<a class="btn btn-outline" href="' + bookUrl(j.code, j.title) + '" target="_blank" rel="noopener">' +
          UI.ic('whatsapp') + ' استفسار واتساب</a>'
        : '<span class="jd-foot-note"><svg class="ic"><use href="#i-alert" xlink:href="#i-alert"/></svg> الوظيفة ' + UI.esc(st.ar) + ' حالياً — تابع بقية الفرص.</span>') +
        '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box) {
        box.classList.add('modal-job');
        /* أي زر «قدّم» داخل النافذة يغلقها أولاً ثم يفتح «بطاقتي» (طبقات نظيفة) */
        box.querySelectorAll('[data-action="open-booking"]').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            var code2 = b.getAttribute('data-code');
            var m = b.closest('.modal-backdrop');
            if (m) m.remove();
            document.body.classList.remove('modal-open');
            setTimeout(function () {
              if (root.HRCBooking && root.HRCBooking.open) root.HRCBooking.open({ code: code2 });
            }, 60);
          });
        });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
