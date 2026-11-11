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

  /* ── العرض التدريجي للوظائف ──────────────────────────────────────────────
   * تظهر أول JOBS_PAGE_SIZE وظائف فقط، وزر «عرض المزيد» يُظهر بقية النتائج،
   * ثم يتحوّل إلى «عرض أقل» فيعيد أول JOBS_PAGE_SIZE. العدّاد (#jobs-count)
   * يبقى عدد النتائج الكلي بعد الفلاتر، و«ملاحظة العرض» توضّح المعروض منه.
   * أي تغيير في الفلاتر يُعيد القائمة إلى حالتها المطويّة تلقائياً (عبر بصمة
   * الفلاتر) حتى لا يبقى الزائر أمام قائمة موسّعة لا تناسب بحثه الجديد.
   * ⚠️ الحالة في الذاكرة فقط: لا تُخزَّن، ولا تُرسَل للقاعدة، ولا تؤثر على
   *    ترتيب/عدد الوظائف القادمة من Supabase. العرض وحده هو المقصود. */
  var JOBS_PAGE_SIZE = 10;
  var jobsExpanded = false;
  var jobsFilterKey = null;
  /* يُفعَّل لضغطة «عرض المزيد» وحدها كي تظهر البطاقات الجديدة بتتابع بصري،
     ولا يُفعَّل عند تحديث البيانات أو تغيير الفلاتر فلا تتكرّر الحركة بلا سبب. */
  var revealNewCards = false;

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
    // HTTPS pages only; standalone file:// exports must remain self-contained.
    if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
    Store.init();
    UI.startCountdowns();
    fillSelects();
    bindEvents();
    bindFavorites();
    bindCatsToggle();
    bindCardPage();
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
        var d = Math.min(120, Math.max(0, Number(en.target.getAttribute('data-d')) || 0));
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

    /* «عرض المزيد / عرض أقل»: نفس الزر يتبدّل نصه وحالته، والزر خارج الشبكة
       كي لا يفقد تركيز لوحة المفاتيح عند إعادة رسم البطاقات. */
    var more = document.getElementById('jobs-more');
    if (more) more.addEventListener('click', function () {
      var collapsing = jobsExpanded;
      setJobsExpanded(!jobsExpanded);
      /* عند الطيّ نعود إلى أعلى الشبكة بدل ترك الزائر في فراغ أسفل قائمة
         اختفت من تحته — مع احترام تفضيل تقليل الحركة. */
      if (collapsing) scrollToJobsGrid();
    });

    /* رابط «عرض الكل» في رأس القسم صار زراً فعّالاً: يُظهر كل النتائج وينتقل
       إلى الشبكة، بدل أن يكون مرساةً إلى نفس القسم بلا أثر. */
    var showAll = document.getElementById('jobs-show-all');
    if (showAll) showAll.addEventListener('click', function (e) {
      e.preventDefault();
      setJobsExpanded(true);
      scrollToJobsGrid();
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

    // عناصر تفاصيل الوظيفة المعرّفة كأزرار تدعم لوحة المفاتيح أيضاً.
    document.addEventListener('keydown', function (e) {
      var target = e.target.closest && e.target.closest('[data-action="job-details"][role="button"]');
      if (target && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); openJob(target.getAttribute('data-code'));
      }
    });

    /* قائمة الجوال: لا زر هامبرغر في الترويسة (حُذف 2026-11-07). الموقع العام
       يستعمل شريط التبويب السفلي على الجوال، والترويسة تُخفى هناك أصلاً، فلا
       يوجد ما يفتح #main-nav. تُترك الروابط نفسها لسطح المكتب وللقارئات. */
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
    }, 120), { passive: true });

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
        UI.toast('info', 'بطاقة توظيف منصة مكسب',
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
    var cur = filters.category || 'all';
    var hint = document.getElementById('cats-hint');
    if (hint) hint.textContent = cur !== 'all' ? 'مُصفّى: ' + cur : 'كل التخصصات';
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
    // Prevent the card page from appearing during startup or on the home page.
    var cardPage = document.getElementById('card');
    if (cardPage) cardPage.hidden = currentPage !== 'card';
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
    var homeBtn = document.getElementById('pb-home');
    if (homeBtn) homeBtn.addEventListener('click', function () { openPage('home'); });
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
  function syncFavoriteButtons() {
    var saved = favList();
    document.querySelectorAll('[data-fav]').forEach(function (button) {
      var on = saved.indexOf(button.getAttribute('data-fav')) >= 0;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function bindFavorites() {
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-fav]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var code = b.getAttribute('data-fav');
      var on = favToggle(code);
      renderFavorites();
      syncFavoriteButtons();
      if (UI.toast) UI.toast(on ? 'ok' : 'info', on ? 'أُضيفت للمفضلة' : 'أُزيلت من المفضلة',
        on ? 'ستجدها في قسم «المفضلة» أسفل الوظائف.' : 'يمكنك إضافتها مجدداً في أي وقت.');
    });
    var clear = document.getElementById('fav-clear');
    if (clear) clear.addEventListener('click', function () {
      try { localStorage.removeItem(FAV_KEY); } catch (e) { }
      renderFavorites();
      syncFavoriteButtons();
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
    host.innerHTML = jobs.map(function (job, index) { return cardHtml(job, saved, index + 1); }).join('') +
      (gone ? '<div class="fav-note">' + UI.ic('info') + ' ' + gone + ' وظيفة محفوظة لم تعد معروضة (أُغلقت أو حُذفت).</div>' : '');
  }

  /* ══════════════ صفحة «بطاقتي» ══════════════
   * لا نعرض أي شكل/صورة للبطاقة (طلب المالك: لا معنى لعرضها للزبون بلا بيانات).
   * الصفحة: إدخال رقم البطاقة أو مسح الباركود ← تفاصيل حقيقية من القاعدة:
   * الحالة · بداية الصلاحية · الانتهاء · المتبقي · الفرص ووظائفها وتواريخها. */
  var cpLookupGeneration = 0;
  var CP_KEY = 'hrc_last_card_v1';        /* آخر رقم بطاقة فتحه الزبون على جهازه */

  function cpSay(msg, isErr) {
    var el = document.getElementById('cp-err');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isErr);
  }

  function cpSerialFromText(text) {
    var t = String(text || '').trim();
    var scanner = root.HRCQRScan;
    // QR cards encode an application URL, not just the printed serial number.
    var scanned = scanner && scanner.serialFrom ? scanner.serialFrom(t) : '';
    if (scanned) return scanned;
    var S = Store;
    if (S.normalizeCardSerial) { try { t = S.normalizeCardSerial(t); } catch (e) { } }
    return t.toUpperCase();
  }

  function cpOpenBook(saleSerial) {
    if (root.HRCBooking && root.HRCBooking.open) {
      root.HRCBooking.open({ serial: saleSerial, fromHash: true });
    }
  }

  /* تفاصيل البطاقة: تُرسم من رد Store.cardLookup (محلي أو سحابي) */
  function cpRenderDetails(card) {
    var entry = document.getElementById('cp-entry');
    var host = document.getElementById('cp-result');
    if (!host) return;
    var st = card.status || 'active';
    var badge = {
      blank: { cls: 'warn', t: 'لم يبدأ التقديم بعد' },
      active: { cls: 'ok', t: 'سارية ونشطة' },
      expired: { cls: 'danger', t: 'منتهية الصلاحية' },
      exhausted: { cls: 'warn', t: 'استُهلكت فرص البطاقة' },
      rejected: { cls: 'danger', t: 'مرفوضة' },
      pending: { cls: 'warn', t: 'قيد المراجعة' }
    }[st] || { cls: 'warn', t: st };

    var issued = card.issueDate ? Store.fmtDate(card.issueDate) : 'تبدأ عند أول تقديم';
    var expires = card.expiryDate ? Store.fmtDate(card.expiryDate) : 'لم تبدأ بعد';
    var leftDays = card.expiryDate ? Math.ceil((new Date(card.expiryDate).getTime() - Date.now()) / 86400000) : null;
    var leftTxt = leftDays === null ? 'لم تبدأ بعد' : (leftDays > 0 ? leftDays + ' يوماً' : 'انتهت');

    var SLOT = {
      empty: { t: 'فرصة متاحة', cls: 'ok' },
      reserved: { t: 'محجوزة — بانتظار القرار', cls: 'warn' },
      critical: { t: 'حرجة — قرار الشركة', cls: 'danger' },
      hiring: { t: 'طلب توظيف — بانتظار التثبيت', cls: 'warn' },
      succeeded: { t: 'تم التوظيف', cls: 'ok' },
      rejected: { t: 'لم يتم التوظيف', cls: 'danger' },
      expired: { t: 'انتهت دون نتيجة', cls: 'muted' }
    };

    var chances = (card.chances || []).map(function (c) {
      var s2 = SLOT[c.slotStatus] || { t: c.slotStatus || '—', cls: 'muted' };
      var job = null;
      if (c.jobCode) { try { job = Store.getJob(c.jobCode); } catch (e) { job = null; } }
      var when = c.selectedAt ? Store.fmtDateTime(c.selectedAt) : '';
      var hold = c.holdExpiresAt ? 'تنتهي المهلة ' + Store.fmtDateTime(c.holdExpiresAt) : '';
      return '<article class="cp-chance">' +
        '<div class="cp-chance-top">' +
          '<span class="cp-no">الفرصة ' + UI.esc(String(c.no || '—')) + '</span>' +
          '<span class="cp-state ' + s2.cls + '">' + UI.esc(s2.t) + '</span>' +
        '</div>' +
        (c.jobTitle || c.jobCode
          ? '<div class="cp-job"><b>' + UI.esc(c.jobTitle || 'وظيفة') + '</b>' +
            (c.jobCode ? ' <span class="mono">' + UI.esc(c.jobCode) + '</span>' : '') + '</div>' +
            '<div class="cp-meta">' + (c.location ? '<span>' + UI.ic('pin') + ' ' + UI.esc(c.location) + '</span>' : '') +
              (when ? '<span>' + UI.ic('calendar') + ' ' + UI.esc(when) + '</span>' : '') +
              (hold ? '<span>' + UI.ic('hourglass') + ' ' + UI.esc(hold) + '</span>' : '') + '</div>' +
            (job && job.salaryMin ? '<div class="cp-meta"><span>' + UI.ic('money') + ' ' +
              Store.money(job.salaryMin) + ' – ' + Store.money(job.salaryMax) + '</span>' +
              (job.shift ? '<span>' + UI.ic('clock') + ' ' + UI.esc(job.shift) + '</span>' : '') + '</div>' : '') +
            (c.application && c.application.ok ? (function () {
              var a = c.application.attempt;
              function item(label, value) { return '<div class="cp-employer-row"><b>' + label + '</b><span>' + UI.esc(value || 'غير متوفر — تواصل مع الشركة') + '</span></div>'; }
              return '<div class="cp-employer"><h4>معلومات جهة العمل والمقابلة</h4>' +
                item('الاسم', a.employerName) + item('الهاتف', a.employerPhone) +
                item('العنوان', a.employerAddress) + item('مكان المقابلة', a.interviewLocation) +
                '<button type="button" class="btn btn-lapis cp-print-form" data-cp-print="' + UI.esc(String(c.no)) + '">' + UI.ic('print') + ' طباعة استمارة الفرصة</button></div>';
            })() : c.selectedAt ? '<p class="cp-note-in">تفاصيل جهة العمل غير متاحة حالياً — أعد المحاولة أو تواصل مع الشركة.</p>' : '') +
            (c.note ? '<p class="cp-note-in">' + UI.esc(c.note) + '</p>' : '')
          : '<div class="cp-empty-chance">' + UI.ic('hourglass') + ' لم تُستخدم بعد — اختر لها وظيفة من الموقع أو استمارتك.</div>') +
      '</article>';
    }).join('');

    host.innerHTML =
      '<div class="cp-head">' +
        '<div class="cp-id">' +
          '<span class="cp-ic"><svg class="ic"><use href="#i-card" xlink:href="#i-card"/></svg></span>' +
          '<div><b class="mono" dir="ltr">' + UI.esc(card.serial) + '</b>' +
          '<span class="cp-owner">' + UI.esc(card.fullName || '') + (card.phone ? ' · ' + UI.esc(card.phone) : '') + '</span></div>' +
        '</div>' +
        '<span class="cp-badge ' + badge.cls + '">' + UI.esc(badge.t) + '</span>' +
      '</div>' +
      '<div class="cp-grid">' +
        '<div class="cp-kv"><span>بداية الصلاحية</span><b>' + UI.esc(issued) + '</b></div>' +
        '<div class="cp-kv"><span>تنتهي في</span><b>' + UI.esc(expires) + '</b></div>' +
        '<div class="cp-kv"><span>المتبقي</span><b>' + UI.esc(leftTxt) + '</b></div>' +
        '<div class="cp-kv"><span>الفرص المتبقية</span><b>' + UI.esc(String(card.chancesLeft != null ? card.chancesLeft : '—')) + ' من ' + UI.esc(String((card.chances || []).length)) + '</b></div>' +
      '</div>' +
      '<h3 class="cp-h"><svg class="ic"><use href="#i-briefcase" xlink:href="#i-briefcase"/></svg> الفرص وتفاصيلها</h3>' +
      '<div class="cp-chances">' + (chances || '<div class="cp-empty-chance">لا توجد فرص مسجّلة على هذه البطاقة بعد.</div>') + '</div>' +
      (st === 'blank' ? '<p class="cp-note-in">البطاقة موجودة ولم يبدأ التقديم عليها بعد. تبدأ الصلاحية عند أول تقديم ناجح.</p>' : '') +
      '<div class="cp-foot">' +
        (st === 'blank' && root.HRCBooking && root.HRCBooking.canApply && root.HRCBooking.canApply() ? '<a class="btn btn-gold" href="apply.html?form=' + encodeURIComponent(card.serial) + '">' + UI.ic('arrow-right') + ' تقديم الآن</a>' : '') +
        (st !== 'blank' ? '<button type="button" class="btn btn-gold" id="cp-full">' +
          '<svg class="ic"><use href="#i-card" xlink:href="#i-card"/></svg> فتح بطاقتي الكاملة (متابعة · تقديم)</button>' : '') +
        '<button type="button" class="btn btn-outline" id="cp-again">' +
          '<svg class="ic"><use href="#i-refresh" xlink:href="#i-refresh"/></svg> بطاقة أخرى</button>' +
      '</div>';

    if (entry) entry.hidden = true;
    host.hidden = false;
    var full = document.getElementById('cp-full');
    if (full) full.addEventListener('click', function () { cpOpenBook(card.serial); });
    host.querySelectorAll('[data-cp-print]').forEach(function (button) {
      button.addEventListener('click', function () {
        var no = Number(button.getAttribute('data-cp-print'));
        var chance = (card.chances || []).filter(function (c) { return Number(c.no) === no; })[0];
        var data = chance && chance.application;
        if (!data || !data.ok || !data.attempt || !root.HRCVoucher || !root.HRCVoucher.printForm) return;
        try { root.HRCVoucher.printForm(Object.assign({}, data.app, {status: card.status, __customerApplication: true}), data.attempt, card.chances || []); }
        catch (e) { UI.toast('err', 'تعذّرت الطباعة', 'أعد المحاولة أو تواصل مع الشركة.'); }
      });
    });
    var again = document.getElementById('cp-again');
    if (again) again.addEventListener('click', cpReset);
    try { localStorage.setItem(CP_KEY, card.serial); } catch (e) { }
  }

  function cpReset() {
    if (root.HRCVoucher && root.HRCVoucher.clearFormPrint) root.HRCVoucher.clearFormPrint();
    cpLookupGeneration++;
    var entry = document.getElementById('cp-entry');
    var host = document.getElementById('cp-result');
    if (host) { host.hidden = true; host.innerHTML = ''; }
    if (entry) entry.hidden = false;
    cpSay('');
    var inp = document.getElementById('cp-serial');
    if (inp) { inp.value = ''; try { inp.focus(); } catch (e) { } }
    try { localStorage.removeItem(CP_KEY); } catch (e) { }
  }

  function cpLookup(serial, opts) {
    opts = opts || {};
    serial = cpSerialFromText(serial);
    if (!serial) { cpSay('اكتب رقم البطاقة المطبوع عليها.', true); return; }
    if (Store.isCardSerial && !Store.isCardSerial(serial)) {
      cpSay('الرقم لا يبدو باركود بطاقة — راجع الرقم المطبوع على وجه البطاقة.', true);
      return;
    }
    var generation = ++cpLookupGeneration;
    var btn = document.getElementById('cp-go');
    if (btn) { btn.disabled = true; btn.textContent = 'جارٍ البحث…'; }
    cpSay('');
    Promise.resolve(Store.cardLookup(serial)).then(function (r) {
      if (generation !== cpLookupGeneration) return;
      if (!r || !r.ok) {
        if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('search') + ' اعرض بطاقتي'; }
        cpSay((r && r.error) || 'تعذّر العثور على البطاقة — تأكد من الرقم.', true);
        return;
      }
      var card = r.card;
      return Promise.all((card.chances || []).map(function (c) {
        if (!c.jobCode || !c.selectedAt || c.slotStatus === 'empty') return Promise.resolve();
        return Promise.resolve(Store.customerApplication(card.serial, c.no)).then(function (detail) { c.application = detail; }, function () { c.application = {ok:false}; });
      })).then(function () {
        if (generation !== cpLookupGeneration) return;
        if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('search') + ' اعرض بطاقتي'; }
        cpRenderDetails(card);
      });
    }).catch(function () {
      if (generation !== cpLookupGeneration) return;
      if (btn) { btn.disabled = false; btn.innerHTML = UI.ic('search') + ' اعرض بطاقتي'; }
      cpSay('تعذّر الاتصال بقاعدة الشركة — تحقّق من الإنترنت وأعد المحاولة.', true);
    });
  }

  // بعد المسح يختار الزبون الإجراء قبل البحث أو الانتقال لصفحة التقديم.
  function cpChooseAction(serial) {
    var modal = UI.modal({
      title: 'بطاقتي',
      body: '<div class="cp-choice">' +
        '<span class="cp-choice-icon" aria-hidden="true">' + UI.ic('card') + '</span>' +
        '<h4>تمت قراءة البطاقة بنجاح</h4>' +
        '<p>اختر شنو تحب تسوي ببطاقتك</p>' +
        '<span class="cp-choice-serial">' + UI.esc(serial) + '</span>' +
        '<div class="cp-choice-actions">' +
          '<a class="btn cp-choice-primary" id="cp-choice-apply" href="apply.html?form=' + encodeURIComponent(serial) + '">' + UI.ic('arrow-right') + ' تقديم الآن</a>' +
          '<button type="button" class="btn cp-choice-secondary" id="cp-choice-details">' + UI.ic('card') + ' عرض تفاصيل البطاقة</button>' +
        '</div><p class="cp-choice-error" id="cp-choice-error" role="alert" hidden></p></div>',
      onMount: function (box, close) {
        box.classList.add('cp-choice-modal');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-label', 'اختيار إجراء البطاقة');
        var apply = box.querySelector('#cp-choice-apply');
        apply.addEventListener('click', function (e) {
          if (!root.HRCBooking || !root.HRCBooking.canApply || !root.HRCBooking.canApply()) {
            e.preventDefault();
            var error = box.querySelector('#cp-choice-error');
            error.hidden = false;
            error.textContent = 'صفحة التقديم غير متاحة في النسخة المستقلة. افتح الموقع الإلكتروني للتقديم.';
          }
        });
        box.querySelector('#cp-choice-details').addEventListener('click', function () { close(); cpLookup(serial); });
        setTimeout(function () { if (document.contains(apply)) apply.focus(); }, 80);
      }
    });
    if (!modal) cpSay('تعذّر عرض الخيارات — يمكنك عرض تفاصيل البطاقة من الزر أدناه.', true);
  }

  function bindCardPage() {
    var form = document.getElementById('cp-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = document.getElementById('cp-serial');
      cpLookup(inp ? inp.value : '');
    });
    var scan = document.getElementById('cp-scan');
    if (scan) scan.addEventListener('click', function () {
      var Q = root.HRCQRScan;
      if (!Q || !Q.open) { cpSay('المسح غير متاح في هذا المتصفح — اكتب الرقم يدوياً.', true); return; }
      var opened = Q.open({
        title: 'مسح باركود البطاقة',
        subtitle: 'وجّه الكاميرا نحو الباركود المطبوع على بطاقتك.',
        validate: function (text) {
          var v = cpSerialFromText(text);
          return !!(Store.isCardSerial ? Store.isCardSerial(v) : v);
        },
        onResult: function (text) {
          var inp = document.getElementById('cp-serial');
          var v = cpSerialFromText(text);
          if (inp) inp.value = v;
          cpSay('');
          cpChooseAction(v);

        }
      });
      if (!opened) cpSay('المسح غير متاح في هذا المتصفح — اكتب الرقم يدوياً.', true);
    });
    /* عودة الزائر: نُعيد فتح آخر بطاقة تلقائياً (على جهازه فقط) */
    try {
      var last = localStorage.getItem(CP_KEY);
      if (last) cpLookup(last);
    } catch (e) { }
  }

  function renderAll() { renderHeroStats(); renderCategories(); renderJobs(); renderFavorites(); }

  root.HRCRefresh = function () {
    if (cloudBlocked()) { if (cloudSettled) renderCloudError(); else renderSkeleton(); return; }
    renderAll();
  };

  /* حالة التحميل للوظائف: إعلان واحد لقارئات الشاشة دون إعلان كل بطاقة. */
  function setJobsLoading(loading) {
    var host = document.getElementById('jobs-grid');
    var status = document.getElementById('jobs-loading-status');
    if (!host) return;
    var wasLoading = host.getAttribute('aria-busy') === 'true';
    host.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (status && loading !== wasLoading) status.textContent = loading ? 'جاري تحميل الوظائف' : '';
  }

  /* نفس أجزاء بطاقة الوظيفة الفعلية: صورة، عنوان، تفاصيل وزر. */
  function skeletonCard() {
    var rows = ['w80', 'w60', 'w40', 'w60', 'w40'].map(function (w) {
      return '<div class="ac-row"><span class="skel-line skel-icon"></span><span class="skel-line ' + w + '"></span></div>';
    }).join('');
    return '<article class="job-card app-card skeleton" aria-hidden="true">' +
      '<div class="job-image skel-image"></div>' +
      '<div class="ac-top"><span class="skel-line skel-badge"></span><span class="skel-line skel-fav"></span></div>' +
      '<div class="ac-body"><div class="job-title skel-title"><span class="skel-line w60"></span></div>' + rows + '</div>' +
      '<div class="ac-foot"><span class="skel-line skel-button"></span></div></article>';
  }

  function renderSkeleton() {
    var host = document.getElementById('jobs-grid');
    setJobsLoading(true);
    hideJobsMore();
    if (host && !host.querySelector('.job-card.skeleton')) host.innerHTML = skeletonCard().repeat(6);
    var empty = document.getElementById('jobs-empty');
    if (empty) empty.classList.add('hidden');
    var count = document.getElementById('jobs-count');
    if (count) count.textContent = '…';
    var hs = document.getElementById('hero-stats');
    if (hs && !hs.querySelector('.skeleton')) {
      hs.innerHTML = ['w60', 'w40', 'w60', 'w40'].map(function (w) {
        return '<div class="app-stat skeleton" aria-hidden="true"><span class="skel-line ' + w + '"></span><span class="skel-line w80"></span></div>';
      }).join('');
    }
  }

  /* فشل الاتصال بالقاعدة: رسالة واضحة + إعادة محاولة — لا نسقوط لبيانات المتصفح */
  function renderCloudError() {
    setJobsLoading(false);
    hideJobsMore();
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
      /* ⛔ العدّاد يُقرأ من القاعدة (public_jobs) لا من بيانات الجلسة المحلية.
         البيانات المحلية قابلة للتعديل من وحدة تحكم أي زائر، فكان الرقم
         قابلاً للتزوير: يكتب أحدهم وظيفة وهمية في ذاكرة جلسته فيرى «وظيفة
         متاحة الآن» زائفة ويصوّرها دليلاً. المصدر الوحيد الموثوق هو ما
         نزل من القاعدة في هذه الجلسة. */
      var jobsAll = (Store.db() && Store.db().jobs) || [];
      items = [
        { ic: 'briefcase', v: jobsAll.filter(function (j) { return j.status === 'available'; }).length, l: 'وظيفة متاحة الآن' },
        { ic: 'card', v: 'عدة', l: 'فرص حسب البطاقة' },
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

  /* ── أدوات العرض التدريجي (أول 10 ← الكل ← أول 10) ────────────────────── */
  function currentJobsFilterKey() {
    return [filters.q, filters.governorate, filters.shift, filters.status, filters.category].join('\u0001');
  }

  function scrollBehavior() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduce ? 'auto' : 'smooth';
  }

  function scrollToJobsGrid() {
    var grid = document.getElementById('jobs-grid');
    if (grid && grid.scrollIntoView) grid.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }

  function setJobsExpanded(value) {
    var next = !!value;
    revealNewCards = next && !jobsExpanded;
    jobsExpanded = next;
    renderJobs();
    revealNewCards = false;
  }

  /* أثناء التحميل أو فشل الاتصال لا توجد قائمة أصلاً — فلا يظهر زر ولا ملاحظة */
  function hideJobsMore() {
    var wrap = document.getElementById('jobs-more-wrap');
    if (wrap) { wrap.hidden = true; wrap.classList.remove('is-in'); }
    var btn = document.getElementById('jobs-more');
    if (btn) btn.hidden = true;
    var showAll = document.getElementById('jobs-show-all');
    if (showAll) showAll.hidden = false;
  }

  function renderJobsMore(total, shown) {
    var wrap = document.getElementById('jobs-more-wrap');
    var btn = document.getElementById('jobs-more');
    if (!wrap || !btn) return;
    var note = document.getElementById('jobs-more-note');
    var label = btn.querySelector('.jobs-more-label');
    var badge = btn.querySelector('.jobs-more-count');
    var wasHidden = wrap.hidden;
    var hasMore = total > JOBS_PAGE_SIZE;
    if (!hasMore) jobsExpanded = false;   /* قائمة قصيرة = لا حالة موسّعة بلا معنى */
    wrap.hidden = !hasMore;
    btn.hidden = !hasMore;
    btn.setAttribute('aria-expanded', jobsExpanded ? 'true' : 'false');
    btn.classList.toggle('is-expanded', jobsExpanded);
    if (label) label.textContent = jobsExpanded ? 'عرض أقل' : 'عرض المزيد';
    if (badge) {
      badge.hidden = jobsExpanded;
      badge.textContent = '+' + Math.max(0, total - JOBS_PAGE_SIZE);
    }
    btn.setAttribute('aria-label', jobsExpanded
      ? 'عرض أقل — الرجوع إلى أول ' + JOBS_PAGE_SIZE + ' وظائف'
      : 'عرض المزيد — إظهار ' + (total - JOBS_PAGE_SIZE) + ' وظيفة إضافية');
    if (note) note.textContent = jobsExpanded
      ? 'تعرض الآن كل النتائج: ' + total + ' وظيفة'
      : 'تعرض ' + shown + ' من ' + total + ' وظيفة';
    /* شريط التقدّم + حركة ظهور المجموعة عند أول ظهور لها فقط */
    wrap.style.setProperty('--jobs-progress', (total ? Math.round(shown / total * 100) : 0) + '%');
    if (hasMore && wasHidden) {
      wrap.classList.remove('is-in');
      void wrap.offsetWidth;              /* إعادة تشغيل الحركة عند الظهور مجدداً */
      wrap.classList.add('is-in');
    } else if (!hasMore) {
      wrap.classList.remove('is-in');
    }
    var showAll = document.getElementById('jobs-show-all');
    if (showAll) showAll.hidden = hasMore && jobsExpanded;
  }

  function renderJobs() {
    var host = document.getElementById('jobs-grid');
    if (!host) return;
    if (cloudBlocked()) { if (!cloudSettled) renderSkeleton(); else renderCloudError(); return; }
    setJobsLoading(false);

    /* بصمة الفلاتر: تغيّرها يعيد القائمة إلى الطيّ، وتحديث البيانات وحده
       (Realtime/صيانة) يُبقي حالة «عرض المزيد» كما اختارها الزائر. */
    var key = currentJobsFilterKey();
    if (key !== jobsFilterKey) { jobsExpanded = false; jobsFilterKey = key; }

    var jobs = Store.listJobs(filters);
    if (filters.category && filters.category !== 'all') {
      jobs = jobs.filter(function (j) { return (j.category || '') === filters.category; });
    }
    var total = jobs.length;
    var shown = jobsExpanded ? jobs : jobs.slice(0, JOBS_PAGE_SIZE);

    var count = document.getElementById('jobs-count');
    if (count) count.textContent = total;   /* كل النتائج المطابقة، لا المعروض منها فقط */
    var upd = document.getElementById('jobs-updated');
    if (upd) upd.textContent = Store.fmtDateTime(new Date());
    var empty = document.getElementById('jobs-empty');
    if (empty) {
      var showEmpty = total === 0;
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
    var favorites = favList();
    /* الترقيم يبدأ من 1 للبطاقات المعروضة فقط، فيبقى صحيحاً قبل التوسيع وبعده.
       البطاقات الجديدة وحدها تأخذ تأخيراً متدرّجاً (بحد 360ms) عند «عرض المزيد». */
    host.innerHTML = shown.map(function (job, index) {
      var delay = (revealNewCards && index >= JOBS_PAGE_SIZE)
        ? Math.min((index - JOBS_PAGE_SIZE) * 45, 360) : null;
      return cardHtml(job, favorites, index + 1, delay);
    }).join('');
    renderJobsMore(total, shown.length);
    renderActiveChips();
  }

  /* رابط الحجز: واتساب الشركة برسالة جاهزة تحمل كود الوظيفة وعنوانها،
     حتى يصل الاستفسار واضحاً لمكتب الشركة مباشرة. */
  function waNumber() {
    var raw = (CFG.company && CFG.company.whatsapp) ||
      (CFG.company && CFG.company.phones && CFG.company.phones[0]) || '07763999907';
    var d = String(raw).replace(/\D/g, '');
    if (d.indexOf('00') === 0) d = d.slice(2);
    else if (d.charAt(0) === '0') d = '964' + d.slice(1);
    return d;
  }

  function bookUrl(code, title) {
    var msg = 'مرحباً منصة مكسب للتوظيف، أرغب بالحجز على وظيفة ' + (code || '') +
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

  function cardHtml(j, favorites, position, revealDelay) {
    var st = CFG.jobStatus[j.status];
    var cls = 'app-card' + (j.status === 'reserved' ? ' is-reserved' : (j.status === 'closed' ? ' is-closed' : '')) +
      (revealDelay != null ? ' is-revealed' : '');
    var revealAttr = revealDelay != null ? ' style="--reveal-delay:' + revealDelay + 'ms"' : '';
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
        ' onload="this.parentNode.classList.add(\'has-img\')" onerror="this.parentNode.classList.add(\'img-failed\');this.parentNode.setAttribute(\'role\',\'img\');this.parentNode.setAttribute(\'aria-label\',\'تعذّر تحميل صورة الوظيفة\');this.remove()">' +
      '<span class="ac-sequence" aria-label="ترتيب الوظيفة ' + position + '"><span aria-hidden="true">#</span>' + position + '</span></div>';
    var b = cardBadge(j);
    var fav = favorites.indexOf(j.code) >= 0;
    var salary = Store.money(j.salaryMin) + (j.salaryMax && j.salaryMax !== j.salaryMin ? ' – ' + Store.money(j.salaryMax) : '');
    return '' +
      '<article class="job-card ' + cls + '"' + revealAttr + '>' +
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
          '<li><b>٣</b><div><span>تُطبع استمارة A4</span><small>تحمل بياناتك وتفاصيل الوظيفة لتقديمها عند المقابلة.</small></div></li>' +
          '<li><b>٤</b><div><span>قرار الشركة</span><small>توظيف أو إرجاع الوظيفة — والفرصة المستهلكة لا تعود.</small></div></li>' +
        '</ol></section>' +

      '<div class="jd-privacy"><svg class="ic"><use href="#i-lock" xlink:href="#i-lock"/></svg>' +
        '<p><b>خصوصية البيانات:</b> تُعرض تفاصيل التواصل اللازمة بعد إتمام التقديم وفق سياسة الشركة.</p></div>';

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
