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
  var filters = { q: '', governorate: 'all', shift: 'all', status: 'all' };

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
  function renderAll() { renderHeroStats(); renderJobs(); }

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
        return '<div class="hero-stat skeleton"><span class="skel-line ' + w + '"></span><span class="skel-line w80"></span></div>';
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
        return '<div class="hero-stat"><b>—</b><span>…</span></div>';
      }).join('');
    }
  }

  function renderHeroStats() {
    var host = document.getElementById('hero-stats');
    if (!host) return;
    if (cloudBlocked()) return;   // الهيكل/رسالة الفشل تسيّر العرض هنا
    /* الزائر في وضع القاعدة يرى إحصاءات الوظائف المعلنة فقط — أعداد الاستمارات
       والتوظيف بيانات داخلية (وأي رقم متصفح هنا سيكون من البيانات التجريبية
       أو كاش قديم أصلاً). الموظف المسجَّل يرى اللوحة كاملة. */
    var staff = false;
    try { staff = !!(Store.currentUser && Store.currentUser()); } catch (e) { staff = false; }
    if (cloudMode && !staff) {
      var jobsAll = Store.listJobs({});
      var items = [
        { v: jobsAll.filter(function (j) { return j.status === 'available'; }).length, l: 'وظيفة متاحة الآن' },
        { v: jobsAll.length, l: 'وظيفة معروضة' }
      ];
    } else {
      var s = Store.stats();
      items = [
        { v: s.available, l: 'وظيفة متاحة الآن' },
        { v: s.totalJobs, l: 'وظيفة مُسجّلة في النظام' },
        { v: s.forms, l: 'بطاقة صادرة' },
        { v: s.hires, l: 'توظيف ناجح مكتمل' }
      ];
    }
    host.innerHTML = items.map(function (i) {
      return '<div class="hero-stat"><b>' + i.v + '</b><span>' + i.l + '</span></div>';
    }).join('');
  }

  function renderJobs() {
    var host = document.getElementById('jobs-grid');
    if (!host) return;
    if (cloudBlocked()) { if (!cloudSettled) renderSkeleton(); else renderCloudError(); return; }
    var jobs = Store.listJobs(filters);
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

  function cardHtml(j) {
    var st = CFG.jobStatus[j.status];
    var cls = j.status === 'reserved' ? 'is-reserved' : (j.status === 'closed' ? 'is-closed' : '');
    var hold = '';
    if (j.status === 'reserved' && j.holdExpiresAt) {
      var h = Store.diffHours(j.holdExpiresAt, new Date());
      hold = '<span class="tiny muted" title="يُفرج تلقائياً">' +
        (h > 0 ? 'تُفرج خلال ' + Math.ceil(h) + ' ساعة' : 'قيد الإفراج') + '</span>';
    }
    /* صورة الوظيفة: تُحمَّل بتحميل مؤجّل (أسرع على الموبايل)، ومعها بديل رمزي
       يظهر إن تعذّر تحميل الصورة (بلا إنترنت أو رابط معطّل) فلا تظهر أيقونة
       صورة مكسورة في القائمة */
    var imageHtml = '';
    if (j.imageUrl) {
      imageHtml = '<div class="job-image" style="--img:url(&quot;' + UI.esc(j.imageUrl) + '&quot;)">' +
        '<span class="job-ph" aria-hidden="true"><svg class="ic"><use href="#i-briefcase" xlink:href="#i-briefcase"/></svg></span>' +
        '<img src="' + UI.esc(j.imageUrl) + '" alt="' + UI.esc(j.title) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer"' +
        ' onload="this.parentNode.classList.add(\'has-img\')" onerror="this.remove()"></div>';
    }
    
    return '' +
      '<article class="job-card ' + cls + '">' +
        imageHtml +
        '<div class="job-head">' +
          '<div>' +
            '<h3 class="job-title">' + UI.esc(j.title) + '</h3>' +
            '<span class="chip chip-code mono job-code">' + UI.esc(j.code) + '</span>' +
          '</div>' +
          '<div class="job-statuses">' +
            UI.jobBadge(j.status) +
            '<span class="chip chip-gold tiny">' + UI.esc(j.category) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="job-body">' +
          '<div class="job-meta">' +
            '<div class="mi">' + UI.ic('pin') + '<span>' + UI.esc(j.governorate || '—') + '</span></div>' +
            '<div class="mi">' + UI.ic('clock') + '<span>' + UI.esc(j.shift) + '</span></div>' +
            '<div class="mi">' + UI.ic('money') + '<span>' + Store.money(j.salaryMin) + ' – ' + Store.money(j.salaryMax) + '</span></div>' +
            '<div class="mi">' + UI.ic('users') + '<span>' + UI.esc(j.gender || 'لا فرق') + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="job-foot">' +
          '<span class="salary">' + Store.money(j.salaryMin) + '</span>' +
          '<div class="flex" style="gap:8px;align-items:center">' +
            hold +
            '<button class="btn btn-outline btn-sm" data-action="job-details" data-code="' + UI.esc(j.code) + '">التفاصيل</button>' +
            (j.status === 'available'
              ? '<button class="btn btn-gold btn-sm" data-action="open-booking" data-code="' + UI.esc(j.code) + '">' + UI.ic('card') + ' قدّم ببطاقتك</button>'
              : '<button class="btn btn-outline btn-sm" disabled>' + st.ar + '</button>') +
          '</div>' +
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
