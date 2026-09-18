/* ===========================================================================
 *  BRC — منطق الموقع العام
 *  لوحة الوظائف، البحث الفوري، صفحة الوظيفة، ودعوة الزائر للتواصل مع الشركة.
 *  ⚠️ سياسة الشركة: الزائر يتصفّح فقط — لا تقديم استمارة ولا تحقق منها.
 *     إصدار الاستمارات والتحقق منها محصور بالموظفين والإدارة في المنظومة الداخلية.
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.BRC_CONFIG, Store = root.BRCStore, UI = root.BRCUI;
  if (!document.getElementById('jobs-grid')) return;

  var filters = { q: '', region: 'all', shift: 'all', status: 'all' };

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
    UI.fillSelect(document.getElementById('qs-region'), CFG.regions, 'كل مناطق بابل');
    UI.fillSelect(document.getElementById('filter-region'), CFG.regions, 'كل المناطق');
    UI.fillSelect(document.getElementById('filter-shift'), CFG.shifts, 'كل الأوقات');
  }

  function bindEvents() {
    var q = document.getElementById('filter-q');
    var region = document.getElementById('filter-region');
    var shift = document.getElementById('filter-shift');
    var status = document.getElementById('filter-status');

    if (q) q.addEventListener('input', UI.debounce(function () { filters.q = q.value; renderJobs(); }));
    if (region) region.addEventListener('change', function () { filters.region = region.value; renderJobs(); });
    if (shift) shift.addEventListener('change', function () { filters.shift = shift.value; renderJobs(); });
    if (status) status.addEventListener('change', function () { filters.status = status.value; renderJobs(); });
    var reset = document.getElementById('filter-reset');
    if (reset) reset.addEventListener('click', function () {
      filters = { q: '', region: 'all', shift: 'all', status: 'all' };
      if (q) q.value = ''; if (region) region.value = 'all';
      if (shift) shift.value = 'all'; if (status) status.value = 'all';
      renderJobs();
    });

    // البحث السريع
    var qsForm = document.getElementById('qs-form');
    if (qsForm) qsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      runQuickSearch(
        (document.getElementById('qs-code') || {}).value || '',
        (document.getElementById('qs-region') || {}).value || 'all'
      );
    });

    // البحث عبر مسح الكيو آر كود
    var qsScan = document.getElementById('qs-scan');
    if (qsScan) qsScan.addEventListener('click', function () { openQRScanner(); });

    /* ⚠️ سياسة الشركة: الزائر لا يقدّم طلب استمارة ولا يتحقق من أي استمارة.
       كل ما يفعله هنا: يتصفّح الوظائف ثم يخابر الشركة أو يراجع المكتب للحجز.
       أدوات الإصدار والتحقق محصورة بالموظفين والإدارة في المنظومة الداخلية. */
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
    if (y) y.textContent = String(new Date().getFullYear());
  }

  function runQuickSearch(code, region) {
    if (cloudBlocked()) {
      UI.toast(cloudSettled ? 'error' : 'info', cloudSettled ? 'تعذّر الاتصال' : 'جارٍ التحميل',
        cloudSettled ? 'تعذّر الاتصال بقاعدة الشركة — أعد المحاولة أو خابرنا هاتفياً.'
                     : 'تُحمَّل الوظائف من قاعدة الشركة الآن — لحظات ويكتمل البحث.', 6000);
      return;
    }
    code = String(code || '').trim();
    region = region || 'all';
    filters.q = code;
    filters.region = region;
    var fq = document.getElementById('filter-q');
    var fr = document.getElementById('filter-region');
    if (fq) fq.value = code;
    if (fr) fr.value = region;
    renderJobs();
    var jobs = document.getElementById('jobs');
    if (jobs) jobs.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var found = Store.listJobs(filters);
    if (found.length === 1) openJob(found[0].code);
    else if (found.length === 0) UI.toast('warn', 'لا نتائج', 'لم نجد وظيفة بهذا الكود أو العنوان — تواصل معنا للاستفسار.');
  }

  function openQRScanner() {
    if (!root.BRCQRScan || !root.BRCQRScan.supported()) {
      UI.toast('warn', 'متصفح غير مدعوم', 'متصفحك لا يدعم مسح الكيو آر كود. اكتب الكود يدوياً أو استخدم متصفح كروم على الجوال/الكمبيوتر.');
      return;
    }

    var stream = null, raf = null, stopped = false;

    function stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    }

    var body =
      '<div class="scan-stage">' +
        '<video id="scan-video" playsinline muted autoplay></video>' +
        '<div class="scan-frame"></div>' +
        '<div class="scan-line"></div>' +
      '</div>' +
      '<p class="scan-status" id="scan-status">وجّه الكاميرا نحو الكيو آر كود...</p>' +
      '<div class="scan-actions">' +
        '<label class="btn btn-outline btn-sm" for="scan-file">' + UI.ic('upload') + ' ارفع صورة للكود بدلاً من الكاميرا</label>' +
        '<input type="file" id="scan-file" accept="image/*" hidden>' +
      '</div>';

    UI.modal({
      title: 'البحث بمسح الكيو آر كود',
      subtitle: 'امسح رمز QR المطبوع على بطاقة الوظيفة للوصول إليها مباشرة',
      body: body,
      onMount: function (box, close) {
        var video = box.querySelector('#scan-video');
        var fileInput = box.querySelector('#scan-file');
        var status = box.querySelector('#scan-status');

        function setStatus(t, cls) {
          if (status) { status.textContent = t; status.className = 'scan-status' + (cls ? ' ' + cls : ''); }
        }

        // رفع صورة بديلة عن الكاميرا
        fileInput.addEventListener('change', function () {
          var f = fileInput.files && fileInput.files[0];
          if (!f) return;
          setStatus('جارٍ قراءة الصورة...');
          Promise.resolve(typeof createImageBitmap === 'function' ? createImageBitmap(f) : f)
            .then(function (bmp) { return root.BRCQRScan.detectImage(bmp); })
            .then(function (vals) {
              if (vals && vals.length) { stop(); close(); applyScannedText(vals[0]); }
              else setStatus('لم يُعثر على رمز QR في الصورة — جرّب صورة أوضح.', 'error');
            })
            .catch(function () { setStatus('تعذّرت قراءة الصورة.', 'error'); });
        });

        // بث الكاميرا
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(function (s) {
              if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
              stream = s;
              video.srcObject = s;
              video.play().catch(function () {});
              tick(video, close);
            })
            .catch(function () {
              setStatus('تعذّر الوصول إلى الكاميرا — استخدم «رفع صورة للكود».', 'error');
            });
        } else {
          setStatus('الكاميرا غير متاحة في هذا المتصفح — ارفع صورة للكود.', 'error');
        }
      },
      onClose: stop
    });

    function tick(video, close) {
      if (stopped) return;
      root.BRCQRScan.detectVideoFrame(video).then(function (vals) {
        if (stopped) return;
        if (vals && vals.length) { stop(); close(); applyScannedText(vals[0]); return; }
        raf = requestAnimationFrame(function () { tick(video, close); });
      });
    }
  }

  /* تحليل نص الرمز الممسوح: كود وظيفة / رابط استمارة / نص حر */
  function applyScannedText(text) {
    text = String(text || '').trim();
    if (!text) { UI.toast('warn', 'كود فارغ', 'لم يُقرأ أي نص من الرمز.'); return; }

    /* رمز استمارة (BRC-NO-…): التحقق محصور بالموظفين والإدارة، فلا نكشف
       هنا أي بيانات — مجرد تنبيه واضح للزائر. */
    var serial = text.match(/BRC-NO-\d+/i);
    if (serial) {
      UI.toast('info', 'هذه استمارة شركة بابل للتوظيف',
        'التحقق من الاستمارات متاح لموظفي الشركة والإدارة فقط. للحجز أو الاستفسار خابر الشركة أو راجع المكتب.', 8000);
      return;
    }

    var job = text.match(/BRC-\d{3,}/i);
    if (job) {
      var code = job[0].toUpperCase();
      var input = document.getElementById('qs-code');
      if (input) input.value = code;
      runQuickSearch(code, (document.getElementById('qs-region') || {}).value || 'all');
      return;
    }

    var input = document.getElementById('qs-code');
    if (input) input.value = text;
    runQuickSearch(text, (document.getElementById('qs-region') || {}).value || 'all');
  }

  /* ---------------- العرض ---------------- */
  function renderAll() { renderHeroStats(); renderJobs(); }

  root.BRCRefresh = function () {
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
        { v: s.forms, l: 'استمارة صادرة' },
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
    var msg = 'مرحباً شركة بابل للتوظيف، أرغب بالحجز على وظيفة ' + (code || '') +
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
      imageHtml = '<div class="job-image">' +
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
          '<div style="display:grid;gap:6px;justify-items:end">' +
            UI.jobBadge(j.status) +
            '<span class="chip chip-gold tiny">' + UI.esc(j.category) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="job-body">' +
          '<div class="job-meta">' +
            '<div class="mi">' + UI.ic('pin') + '<span>' + UI.esc(j.region) + '</span></div>' +
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
              ? '<a class="btn btn-gold btn-sm" href="' + bookUrl(j.code) + '" target="_blank" rel="noopener">' + UI.ic('whatsapp') + ' احجز</a>'
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
    var body = '' +
      '<div class="flex-between flex-wrap mb-3" style="gap:12px">' +
        '<div>' +
          '<span class="chip chip-code mono">' + UI.esc(j.code) + '</span>' +
          '<span class="chip chip-gold" style="margin-inline-start:6px">' + UI.esc(j.category) + '</span>' +
        '</div>' +
        UI.jobBadge(j.status) +
      '</div>' +
      '<div class="data-grid mb-3">' +
        '<div class="data-item"><div class="k">المنطقة</div><div class="v">' + UI.esc(j.region) + '</div></div>' +
        '<div class="data-item"><div class="k">الأجر الشهري</div><div class="v">' + Store.money(j.salaryMin) + ' – ' + Store.money(j.salaryMax) + '</div></div>' +
        '<div class="data-item"><div class="k">الدوام</div><div class="v">' + UI.esc(j.shift) + '</div></div>' +
        '<div class="data-item"><div class="k">الجنس</div><div class="v">' + UI.esc(j.gender || 'لا فرق') + '</div></div>' +
        '<div class="data-item"><div class="k">عدد الشواغر</div><div class="v">' + (j.vacancies || 1) + '</div></div>' +
        '<div class="data-item"><div class="k">تاريخ الإضافة</div><div class="v" dir="ltr">' + Store.fmtDate(j.createdAt) + '</div></div>' +
      '</div>' +
      '<div class="panel" style="background:#fdf9ee;border-color:var(--line)">' +
        '<div class="panel-body" style="padding:14px 16px">' +
          '<p class="mb-0 small">' + UI.ic('lock', '') +
          ' <b>خصوصية صاحب العمل:</b> لا تُعرض بياناته التفصيلية (الاسم، الهاتف، العنوان) في الموقع العام. ' +
          'تُسلَّم هذه البيانات للباحث عبر شركة بابل للتوظيف عند مراجعة المكتب وإصدار الاستمارة، وفق سياسة الشركة.</p>' +
        '</div>' +
      '</div>' +
      (reqs ? '<h3 class="mt-3">الشروط والمتطلبات</h3><ul class="feature-list">' + reqs + '</ul>' : '') +
      (j.description ? '<p class="muted mt-2">' + UI.esc(j.description) + '</p>' : '') +
      '<div class="panel mt-3"><div class="panel-body" style="padding:14px 16px">' +
        '<p class="mb-0 small">' + UI.ic('hourglass') +
        ' <b>آلية الحجز:</b> الحجز يتم من مكتب الشركة — خابرنا أو راجع المكتب، فتُسجَّل الوظيفة كمحاولة على استمارتك ' +
        'وتُحجز مؤقتاً <b>24 ساعة</b> بانتظار نتيجة المقابلة، وإن لم تُثبَّت النتيجة تُعاد الوظيفة تلقائياً إلى «متاحة».</p>' +
      '</div></div>';

    UI.modal({
      title: j.title, subtitle: 'تفاصيل الوظيفة — ' + j.region, body: body, wide: true,
      footer: (j.status === 'available'
        ? '<a class="btn btn-gold" href="' + bookUrl(j.code, j.title) + '" target="_blank" rel="noopener">' +
          UI.ic('whatsapp') + ' خابر الشركة للحجز على هذه الوظيفة</a>'
        : '<button class="btn btn-outline" disabled>الوظيفة ' + CFG.jobStatus[j.status].ar + '</button>') +
        '<button class="btn btn-outline" data-close>إغلاق</button>'
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
