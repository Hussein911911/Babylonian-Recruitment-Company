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
      filters = { q: '', governorate: 'all', shift: 'all', status: 'all' };
      if (q) q.value = '';
      if (governorate) governorate.value = 'all';
      var qsGov = document.getElementById('qs-governorate');
      if (qsGov) qsGov.value = 'all';
      if (shift) shift.value = 'all'; if (status) status.value = 'all';
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
        cloudSettled ? 'تعذّر الاتصال بقاعدة الشركة — أعد المحاولة أو خابرنا هاتفياً.'
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
    var cur = filters.category || 'all';
    var html = '<button type="button" class="cat' + (cur === 'all' ? ' is-active' : '') + '" data-cat="all" role="tab" aria-selected="' + (cur === 'all') + '">' +
      '<span class="cat-ic"><svg class="ic"><use href="#i-grid" xlink:href="#i-grid"/></svg></span>' +
      '<span>الكل</span><b>' + jobs.length + '</b></button>';
    html += cats.map(function (c) {
      return '<button type="button" class="cat' + (cur === c ? ' is-active' : '') + '" data-cat="' + UI.esc(c) + '" role="tab" aria-selected="' + (cur === c) + '">' +
        '<span class="cat-ic"><svg class="ic"><use href="#' + catIcon(c) + '" xlink:href="#' + catIcon(c) + '"/></svg></span>' +
        '<span>' + UI.esc(c) + '</span><b>' + counts[c] + '</b></button>';
    }).join('');
    host.innerHTML = html;
    host.querySelectorAll('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () {
        filters.category = b.getAttribute('data-cat');
        renderCategories();
        renderJobs();
        var sec = document.getElementById('jobs');
        if (sec && window.scrollTo) window.scrollTo({ top: sec.offsetTop - 70, behavior: 'smooth' });
      });
    });
  }

  /* ── شريط التنقل السفلي: تفعيل التبويب بحسب موضع التمرير ── */
  function bindTabbar() {
    var bar = document.querySelector('.tabbar');
    if (!bar) return;
    var links = [].slice.call(bar.querySelectorAll('[data-tab]'));
    if (!links.length) return;
    var last = 0;
    var onScroll = function () {
      var now = Date.now(); if (now - last < 120) return; last = now;
      var y = window.scrollY + 120, active = null;
      links.forEach(function (l) {
        var sec = document.getElementById(l.getAttribute('data-tab'));
        if (sec && sec.offsetTop <= y) active = l;
      });
      links.forEach(function (l) { l.classList.toggle('is-active', l === active); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── المفضلة: تبديل فوري بلا إعادة رسم الشبكة كلها ── */
  function bindFavorites() {
    var host = document.getElementById('jobs-grid');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-fav]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var on = favToggle(b.getAttribute('data-fav'));
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (UI.toast) UI.toast(on ? 'ok' : 'info', on ? 'أُضيفت للمفضلة' : 'أُزيلت من المفضلة',
        on ? 'محفوظة على جهازك فقط.' : 'يمكنك إضافتها مجدداً في أي وقت.');
    });
  }

  /* ── بطاقة التوظيف الحقيقية على الموقع ──
     نرسم الوجهين بنفس قالب الطباعة (HRCVoucher.buildHtml) ببطاقة نموذجية
     بلا بيانات زبون، فتكون الصورة على الموقع مطابقة تماماً للورقة المطبوعة. */
  function renderCardShowcase() {
    var host = document.getElementById('card-showcase');
    if (!host || host.dataset.done) return;
    var V = root.HRCVoucher;
    if (!V || !V.buildHtml) return;
    try {
      var sample = {
        serial: 'HRC-BC-000000', status: 'blank',
        issueDate: null, expiryDate: null, cardPrintCode: null
      };
      host.innerHTML = V.buildHtml(sample, [{ no: 1 }, { no: 2 }]);
      host.dataset.done = 'yes';
    } catch (e) { /* البطاقة تحسين بصري — لا تُعطّل الصفحة إن فشلت */ }
  }

  function renderAll() { renderHeroStats(); renderCategories(); renderJobs(); renderCardShowcase(); }

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
          '<p class="mb-2">تعذّر تحميل الوظائف المعلنة الآن — تحقّق من اتصالك بالإنترنت ثم أعد المحاولة، أو خابرنا على الأرقام الرسمية.</p>' +
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
          '<p class="mb-2">تعذّر تحميل الوظائف المعلنة الآن — تحقّق من اتصالك بالإنترنت ثم أعد المحاولة، أو خابرنا على الأرقام الرسمية.</p>' +
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
          ? 'تُنشر فرص العمل هنا فور اعتمادها من قِبل الشركة — تابعونا أو خابرنا لمعرفة الشواغر الحالية.'
          : 'جرّب كوداً آخر أو صفّر عوامل التصفية، أو تواصل معنا لتسجيلك في قائمة الانتظار.';
      }
    }
    host.innerHTML = jobs.map(cardHtml).join('');
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
  function openJob(code) {
    var j = Store.getJob(code);
    if (!j) return;
    var reqs = (j.requirements || []).map(function (r) {
      return '<li>' + UI.ic('check') + '<span>' + UI.esc(r) + '</span></li>';
    }).join('');
    var attempts = Store.currentUser() ? '' : '';
    /* صورة الوظيفة كاملة أعلى نافذة التفاصيل (إن وُجدت) */
    var imgHtml = j.imageUrl
      ? '<div class="job-detail-image" style="--img:url(&quot;' + UI.esc(j.imageUrl) + '&quot;)">' +
        '<img src="' + UI.esc(j.imageUrl) + '" alt="' + UI.esc(j.title) +
        '" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>'
      : '';
    var body = '' +
      imgHtml +
      '<div class="flex-between flex-wrap mb-3" style="gap:12px">' +
        '<div>' +
          '<span class="chip chip-code mono">' + UI.esc(j.code) + '</span>' +
          '<span class="chip chip-gold" style="margin-inline-start:6px">' + UI.esc(j.category) + '</span>' +
        '</div>' +
        UI.jobBadge(j.status) +
      '</div>' +
        '<div class="data-grid mb-3">' +
        '<div class="data-item"><div class="k">المحافظة</div><div class="v">' + UI.esc(j.governorate || 'بابل') + '</div></div>' +
        '<div class="data-item"><div class="k">الأجر الشهري</div><div class="v">' + Store.money(j.salaryMin) + ' – ' + Store.money(j.salaryMax) + '</div></div>' +
        '<div class="data-item"><div class="k">الدوام</div><div class="v">' + UI.esc(j.shift) + '</div></div>' +
        '<div class="data-item"><div class="k">الجنس</div><div class="v">' + UI.esc(j.gender || 'لا فرق') + '</div></div>' +
        '<div class="data-item"><div class="k">عدد الشواغر</div><div class="v">' + (j.availableVacancies != null ? j.availableVacancies : Store.vacancySummary(j).available) + ' متاح من ' + (j.vacancies||1) + '</div></div>' +
        '<div class="data-item"><div class="k">تاريخ الإضافة</div><div class="v" dir="ltr">' + Store.fmtDate(j.createdAt) + '</div></div>' +
      '</div>' +
      '<div class="panel" style="background:#fdf9ee;border-color:var(--line)">' +
        '<div class="panel-body" style="padding:14px 16px">' +
          '<p class="mb-0 small">' + UI.ic('lock', '') +
          ' <b>خصوصية صاحب العمل:</b> لا تُعرض بياناته التفصيلية (الاسم، الهاتف، العنوان) في الموقع العام. ' +
          'تُسلَّم هذه البيانات للباحث عبر شركة الهدف للتوظيف عند التقديم ببطاقة التوظيف، وفق سياسة الشركة.</p>' +
        '</div>' +
      '</div>' +
      (reqs ? '<h3 class="mt-3">الشروط والمتطلبات</h3><ul class="feature-list">' + reqs + '</ul>' : '') +
      (j.description ? '<p class="muted mt-2">' + UI.esc(j.description) + '</p>' : '') +
      '<div class="panel mt-3"><div class="panel-body" style="padding:14px 16px">' +
        '<p class="mb-0 small">' + UI.ic('hourglass') +
        ' <b>آلية التقديم:</b> قدّم على هذه الوظيفة بإحدى فرصتي بطاقة التوظيف — امسح باركود بطاقتك أو أدخله هنا، ' +
        'أو عند نقطة البيع بقراءة الباركود. تُحجز الوظيفة باسمك <b>24 ساعة</b> بانتظار نتيجة المقابلة، ' +
        'وإن انتهت المدة دون قرار تقرر الشركة: التوظيف أو إرجاع الوظيفة أو حذفها.</p>' +
      '</div></div>';

    UI.modal({
      title: j.title, subtitle: 'تفاصيل الوظيفة — ' + (j.governorate || '—'), body: body, wide: true,
      footer: (j.status === 'available'
        ? '<button class="btn btn-gold" data-action="open-booking" data-code="' + UI.esc(j.code) + '">' +
          UI.ic('card') + ' قدّم على هذه الوظيفة ببطاقتك</button>' +
          '<a class="btn btn-outline" href="' + bookUrl(j.code, j.title) + '" target="_blank" rel="noopener">' +
          UI.ic('whatsapp') + ' أو خابرنا واتساب</a>'
        : '<button class="btn btn-outline" disabled>الوظيفة ' + CFG.jobStatus[j.status].ar + '</button>') +
        '<button class="btn btn-outline" data-close>إغلاق</button>'
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
