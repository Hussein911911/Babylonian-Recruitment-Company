/* ===========================================================================
 *  BRC — المنظومة الداخلية (لوحة الموظفين والإدارة)
 *  ---------------------------------------------------------------------------
 *  • الموظف: بحث سريع بالكود، إدارة الوظائف والباحثين، إصدار الاستمارات،
 *    إدارة المحاولات الخمس، الحجز المؤقت 24 ساعة، طباعة الاستمارة.
 *  • المدير العام: كل ما سبق + اللوحة المالية + سجل التدقيق الكامل + الإعدادات.
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.BRC_CONFIG, Store = root.BRCStore, UI = root.BRCUI, V = root.BRCVoucher;
  if (!document.getElementById('app-shell')) return;

  var lastSessionKey = null;


  /* نسخة خارجية مشفّرة للابتوب: كلمة المرور لا تُرسل إلى أي خادم. */
  function encryptedBackup(text, password) {
    if (!root.crypto || !root.crypto.subtle) return Promise.reject(new Error('المتصفح لا يدعم التشفير الآمن'));
    var enc = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) { return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: 250000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']); })
      .then(function (key) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text)); })
      .then(function (buf) {
        function b64(x) { var a = new Uint8Array(x), out = ''; for (var i = 0; i < a.length; i += 0x8000) out += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(out); }
        return JSON.stringify({ format: 'BRC-ENCRYPTED-BACKUP-v1', algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256', iterations: 250000, salt: b64(salt), iv: b64(iv), data: b64(buf) });
      });
  }

  /* مفتاح الجلسة: يُستخدم لرصد الدخول/الخروج وإعادة ضبط الواجهة والصلاحيات */
  function sessionKey() {
    var u = Store.currentUser();
    return u ? (u.username + ':' + u.role) : 'guest';
  }

  function showLogin() {
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('login-wrap').classList.remove('hidden');
    var f = document.getElementById('login-form');
    if (f) f.reset();
  }

  var state = {
    view: 'overview',
    j: { q: '', status: 'all', region: 'all', shift: 'all' },
    a: { q: '', status: 'all', user: 'all' },
    log: { q: '', user: 'all', role: 'all', from: '', to: '' },
    fin: { from: '', to: '' },
    lastStatuses: {}
  };

  /* ======================= التهيئة ======================= */
  function init() {
    Store.init();
    /* حالة السحابة تُعرض دائماً: على شاشة الدخول قبل الدخول، وفي أعلى المنظومة بعده */
    cloudBanner(Store.cloudStatus());
    cloudLoginNote(Store.cloudStatus());
    if (Store.onCloudStatus) Store.onCloudStatus(function (st) { cloudBanner(st); cloudLoginNote(st); });
    Store.runMaintenance();
    UI.startCountdowns();
    fillStatic();
    bindLogin();
    bindNav();
    bindToolbars();
    bindActions();
    bindSidebar();
    if (Store.currentUser()) enterApp();
    snapshotStatuses();
    // التقاط النسخة التلقائية المستحقة (لو فُتحت الصفحة بعد وقت الجدولة)
    var due = Store.checkAutoBackup();
    if (due) UI.toast('ok', 'نسخة احتياطية تلقائية', 'أُنشئت النسخة المجدولة: ' + due.name);
    lastSessionKey = sessionKey();
    Store.subscribe(function () {
      var key = sessionKey();
      if (key !== lastSessionKey) {
        lastSessionKey = key;
        if (Store.currentUser()) enterApp(); else showLogin();
      }
      renderCurrent();
      updateHamburgerNotif();
    });
    setInterval(tick, 30000);
  }

  /* ======================= القائمة الجانبية ======================= */
  function bindSidebar() {
    var hamburger = document.getElementById('hamburger-btn');
    var overlay = document.getElementById('side-overlay');
    var sidebar = document.getElementById('app-shell').querySelector('.app-side');
    if (!hamburger || !overlay || !sidebar) return;

    function toggleSidebar() {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('active');
    }

    hamburger.addEventListener('click', toggleSidebar);
    overlay.addEventListener('click', toggleSidebar);

    // Close sidebar when clicking a nav item on mobile
    var navButtons = sidebar.querySelectorAll('.side-nav button');
    navButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('open');
          overlay.classList.remove('active');
        }
      });
    });
  }

  function updateHamburgerNotif() {
    var hamburger = document.getElementById('hamburger-btn');
    var notifDot = document.getElementById('hamburger-notif');
    if (!hamburger || !notifDot) return;

    var actions = Store.pendingActions();
    var hasNotifications = (actions.expired && actions.expired.length > 0) ||
                          (actions.exhausted && actions.exhausted.length > 0) ||
                          (actions.holds && actions.holds.length > 0) ||
                          (actions.requests && actions.requests.length > 0);

    if (hasNotifications) {
      notifDot.classList.add('show');
    } else {
      notifDot.classList.remove('show');
    }
  }

  function fillStatic() {
    // الوظائف
    UI.fillSelect(document.getElementById('j-region'), CFG.regions, 'كل المناطق');
    UI.fillSelect(document.getElementById('j-shift'), CFG.shifts, 'كل الأوقات');
    // المستخدمون في الفلاتر
    var users = CFG.users.map(function (u) { return u.username; });
    UI.fillSelect(document.getElementById('a-user'), users, 'كل الموظفين');
    UI.fillSelect(document.getElementById('log-user'), users.concat(['system']), 'كل المستخدمين');
    var tbl = document.getElementById('users-table-body');
    if (tbl) tbl.innerHTML = CFG.users.map(function (u) {
      return '<tr><td class="mono">' + UI.esc(u.username) + '</td><td>' + UI.esc(u.name) + '</td>' +
        '<td>' + (u.role === 'admin' ? '<span class="badge danger">مدير عام</span>' : '<span class="badge info">موظف</span>') + '</td>' +
        '<td class="tiny muted">' + UI.esc(u.title) + '</td></tr>';
    }).join('');
  }

  /* ======================= الدخول ======================= */
  function bindLogin() {
    var form = document.getElementById('login-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var u = document.getElementById('login-user').value.trim();
      var p = document.getElementById('login-pass').value;
      var btn = form.querySelector('button[type="submit"]');
      var label = btn ? btn.textContent : '';

      function busy(on, txt) {
        if (!btn) return;
        btn.disabled = !!on;
        btn.textContent = on ? txt : label;
      }
      function localLogin() {
        var s = Store.login(u, p);
        if (!s) {
          /* ⚠️ إن لم تكن هناك أي حسابات محلية (النظام مربوط بقاعدة الشركة عبر
             Supabase Auth) فالسبب الحقيقي للفشل هو انقطاع الاتصال — لا خطأ في
             كلمة المرور. إظهار «كلمة المرور غير صحيحة» هنا يضلّل الموظف ويجعله
             يعيد المحاولة بلا داعٍ بدل أن يفحص الإنترنت. */
          var csLocal = Store.cloudStatus ? Store.cloudStatus() : null;
          if (csLocal && csLocal.enforceAuth && !csLocal.devAccountsActive) {
            UI.toast('err', 'تعذّر الدخول — لا اتصال بقاعدة الشركة',
              'حسابات الموظفين محفوظة في القاعدة، فيلزم اتصال بالإنترنت. تحقّق من الشبكة ثم أعد المحاولة.');
            return;
          }
          UI.toast('err', 'فشل الدخول', 'اسم المستخدم أو كلمة المرور غير صحيحة.');
          return;
        }
        UI.toast('ok', 'مرحباً ' + s.name, s.role === 'admin' ? 'دخلت بصلاحية المدير العام.' : 'دخلت بصلاحية موظف.');
        enterApp();
      }

      var cs = Store.cloudStatus ? Store.cloudStatus() : null;
      /* متى كانت السحابة مُعدَّة فالدخول يمرّ بها حصراً (Supabase Auth + brc.staff).
         المسار المحلي يبقى للتشغيل بلا إنترنت فقط، ولا يُسمح به متى كانت السحابة
         متاحة (store.login يرفضه بنفسه أيضاً — حماية مزدوجة مقصودة).
         ⚠️ إن كنا نعلم مسبقاً أن الاتصال ساقط (degraded) فلا معنى لانتظار طلب
         شبكي محكوم عليه بالفشل: نُدخل الموظف محلياً فوراً مع بقاء التنبيه ظاهراً. */
      if (cs && cs.configured && cs.state === 'connecting' && Store.signIn && Store.waitForCloud) {
        busy(true, 'جارٍ الاتصال…');
        Store.waitForCloud().then(function (st) {
          busy(false, '');
          if (st && st.state === 'on') { cloudLogin(); return; }
          var stLocal = Store.cloudStatus ? Store.cloudStatus() : null;
          UI.toast('warn', 'وضع محلي مؤقّت',
            (stLocal && stLocal.enforceAuth && !stLocal.devAccountsActive)
              ? 'تعذّر الاتصال بقاعدة الشركة — الدخول يتطلب إنترنت، والبيانات المعروضة نسخة محفوظة.'
              : 'تعذّر الاتصال بالسحابة — الدخول محلي والبيانات غير مشتركة.');
          localLogin();
        });
        return;
      }
      if (cs && cs.configured && cs.state === 'on' && Store.signIn) { cloudLogin(); return; }
      localLogin();

      function cloudLogin() {
        busy(true, 'جارٍ التحقق…');
        Store.signIn(u, p).then(function (r) {
          busy(false, '');
          if (r && r.ok) {
            UI.toast('ok', 'مرحباً ' + (r.session ? r.session.name : u),
              r.session && r.session.role === 'admin' ? 'دخلت بصلاحية المدير العام.' : 'دخلت بصلاحية موظف.');
            enterApp();
            return;
          }
          var transitional = !cs.enforceAuth && r && ['offline', 'bad_credentials', 'no_staff_row', 'no_user', 'inactive'].includes(r.code);
          if (transitional) {
            /* انقطاع، أو قاعدة لم تُهيّأ بعدُ بحسابات موظفين (enforceAuth=false):
               نسمح بالوضع المحلي **بتنبيه صريح** حتى لا يتوقف العمل، مع بقاء
               البانر معروضاً دائماً يشرح الوضع. أما متى كانت enforceAuth=true
               فلا مسار محلي إطلاقاً — وهذا هو الوضع النهائي المقصود. */
            UI.toast('warn', 'وضع محلي مؤقّت',
              (r.code === 'offline' ? 'تعذّر الاتصال بالسحابة — ' : 'لا يوجد حساب موظف في القاعدة بعد — ') +
              'الدخول محلي والبيانات غير مشتركة مع بقية الموظفين.');
            localLogin();
            return;
          }
          UI.toast('err', 'فشل الدخول', (r && r.error) || 'اسم المستخدم أو كلمة المرور غير صحيحة.');
        });
      }
    });
    var logout = document.getElementById('btn-logout');
    if (logout) logout.addEventListener('click', function () {
      Store.logout();
      showLogin();
      UI.toast('info', 'تم تسجيل الخروج', 'أُغلقت الجلسة وسُجّلت في سجل التدقيق.');
    });
  }

  /* ==========================================================================
   *  حالة الاتصال بالسحابة — معروضة دائماً لا مخفية
   *  ---------------------------------------------------------------------------
   *  لماذا بانر دائم؟ لأن النظام يعمل في وضعين مختلفين تماماً: قاعدة مشتركة،
   *  أو قاعدة في هذا المتصفح وحده. الفرق بينهما **فارق في الثقة**: في الوضع
   *  المحلي قد يبدو كل شيء طبيعياً (استمارات، وظائف، تدقيق) بينما موظف آخر
   *  يرى شيئاً مختلفاً تماماً — أو لا يرى ما أُصدر هنا أبداً. إخفاء هذا الفرق
   *  وراء «يعمل بلا أخطاء» أخطر من إظهاره.
   * ========================================================================== */
  function cloudBanner(st) {
    var el = document.getElementById('brc-cloud-banner');
    if (!st || !st.configured) { if (el) el.remove(); return; }

    var tone = null, title = '', body = '';
    if (st.state === 'degraded') {
      tone = 'err';
      title = 'وضع محلي مؤقّت — البيانات غير مشتركة';
      body = (st.error || 'تعذّر الاتصال بالسحابة') + (st.detail ? ' — ' + st.detail : '') +
        ' | أي وظيفة أو استمارة تُنشأ الآن تبقى في هذا المتصفح وحده.' +
        (st.enforceAuth && !st.devAccountsActive
          ? ' | تنبيه: حسابات الموظفين في القاعدة، فالدخول إلى المنظومة يتطلب إنترنت.' : '');
    } else if (st.state === 'on' && st.role !== 'staff' && !st.enforceAuth) {
      tone = 'warn';
      title = 'وضع انتقالي — الدخول محلي';
      body = 'القاعدة متصلة، لكن لم يُنشأ بعدُ حساب موظف فيها. حتى ذلك الحين: ' +
        'الدخول بكلمات المرور المحلية، والبيانات في هذا المتصفح وحده ولا تصل إلى القاعدة. ' +
        'لإكمال التحوّل: أنشئ حساباً لكل موظف واربطه بسطر في brc.staff ثم اجعل enforceAuth: true.';
    } else if (st.state === 'on' && st.role !== 'staff') {
      tone = 'warn';
      title = 'غير مسجَّل الدخول بالسحابة';
      body = 'البيانات المعروضة هي الوظائف المعلنة فقط. لا إصدار استمارات ولا تعديل قبل تسجيل الدخول.';
    } else if (st.state === 'connecting') {
      tone = 'info';
      title = 'جارٍ الاتصال بقاعدة الشركة…';
      body = 'قد تتأخّر البيانات لحظات.';
    } else if (st.lastError || st.pending) {
      tone = 'warn';
      title = 'لم تُحفظ كل التغييرات في القاعدة بعد';
      body = (st.lastError || '') + (st.pending ? ' — عمليات في الانتظار: ' + st.pending : '') +
        ' (ستُعاد تلقائياً عند عودة الاتصال)';
    } else if (st.state === 'on' && st.role === 'staff') {
      tone = 'ok';
      title = 'متصل بقاعدة الشركة';
      body = 'البيانات مشتركة بين الموظفين' + (st.lastPushAt ? ' — آخر حفظ: ' + Store.fmtDateTime(st.lastPushAt) : '');
    } else {
      if (el) el.remove();
      return;
    }

    var colors = {
      err: ['#7f1d1d', '#fef2f2', '#fecaca'],
      warn: ['#78350f', '#fffbeb', '#fde68a'],
      info: ['#1e3a8a', '#eff6ff', '#bfdbfe'],
      ok: ['#14532d', '#f0fdf4', '#bbf7d0']
    }[tone];

    if (!el) {
      var box = document.createElement('div');
      box.innerHTML = '<div id="brc-cloud-banner" role="status"></div>';
      el = box.firstChild;
      document.body.insertBefore(el, document.body.firstChild);
    }
    /* مضغوط ومطويّ: التفاصيل في سطر واحد قابل للفتح بدل شريط يستهلك أعلى الشاشة */
    el.style.cssText = 'position:sticky;top:0;z-index:9000;font-family:inherit;direction:rtl;' +
      'padding:6px 12px;font-size:.8rem;line-height:1.55;border-bottom:1px solid ' + colors[2] +
      ';background:' + colors[1] + ';color:' + colors[0] + ';display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    var isOpen = (function () { try { return sessionStorage.getItem('brc_banner_open') === '1'; } catch (e) { return false; } })();
    el.innerHTML = '<b style="white-space:nowrap">' + UI.esc(title) + '</b>' +
      '<span id="brc-cloud-more" style="display:' + (isOpen ? 'inline' : 'none') + '">' + UI.esc(body) + '</span>' +
      '<button type="button" data-banner-toggle aria-expanded="' + (isOpen ? 'true' : 'false') + '" ' +
        'style="background:transparent;border:1px solid ' + colors[2] + ';color:' + colors[0] +
        ';font:inherit;font-weight:700;cursor:pointer;border-radius:8px;padding:1px 9px">' +
        (isOpen ? 'إخفاء' : 'التفاصيل') + '</button>' +
      (tone === 'err' ? '<a href="supabase-check.html" style="margin-inline-start:auto;color:' + colors[0] +
        ';font-weight:700;text-decoration:underline;white-space:nowrap">فحص الاتصال</a>' : '');
    var tgl = el.querySelector('[data-banner-toggle]');
    if (tgl) tgl.addEventListener('click', function () {
      var more = el.querySelector('#brc-cloud-more');
      var open = more.style.display !== 'none';
      more.style.display = open ? 'none' : 'inline';
      tgl.textContent = open ? 'التفاصيل' : 'إخفاء';
      tgl.setAttribute('aria-expanded', open ? 'false' : 'true');
      try { sessionStorage.setItem('brc_banner_open', open ? '0' : '1'); } catch (e) { }
    });
  }

  /* ملاحظة على شاشة الدخول: سبب التعذّر خطوةً بخطوة — أهمّ ما يحتاجه المسؤول
     عند أول تشغيل (سكيما غير مطبَّقة / سكيما غير مُعرَّضة / صلاحية ناقصة). */
  function cloudLoginNote(st) {
    var host = document.querySelector('#login-wrap .login-container');
    if (!host) return;
    var el = document.getElementById('brc-cloud-note');
    if (!st || !st.configured || st.state === 'off') { if (el) el.remove(); return; }
    if (!el) {
      var wrap = document.createElement('div');
      wrap.innerHTML = '<div id="brc-cloud-note" style="margin-top:14px;padding:10px 12px;border-radius:10px;font-size:.78rem;line-height:1.8"></div>';
      el = wrap.firstChild;
      host.appendChild(el);
    }
    /* تذكير قبل التسليم: كلمات المرور المكتوبة في كود الواجهة ما زالت صالحة.
       لا يُعرض أي منها هنا — التذكير يذكّر بالحذف لا بالبيانات. ويختفي وحده
       بمجرد إغلاق الباب (enforceAuth: true). */
    if (st.devAccountsActive) {
      var warn = document.getElementById('brc-dev-accounts');
      if (!warn) {
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div id="brc-dev-accounts" style="margin-top:12px;padding:10px 12px;border-radius:10px;' +
          'font-size:.78rem;line-height:1.8;background:#fffbeb;border:1px solid #fde68a;color:#78350f"></div>';
        warn = wrap.firstChild;
        el.parentNode.insertBefore(warn, el.nextSibling);
      }
      warn.innerHTML = '<b>⚙️ تذكير للفريق (لا يظهر للزبون):</b> حسابات الدخول المكتوبة في ' +
        '<code>assets/js/config.js</code> ما زالت فعّالة. تُحذف قبل التسليم — ' +
        'هذه آخر خطوة في <b>docs/pre-delivery-checklist.md</b>.';
    } else {
      var old = document.getElementById('brc-dev-accounts');
      if (old) old.remove();
    }

    if (st.state === 'degraded') {
      el.style.cssText += ';background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d';
      el.innerHTML = '<b>لم يتم الاتصال بقاعدة الشركة.</b><br>' + UI.esc(st.error || '') +
        (st.detail ? '<br>' + UI.esc(st.detail) : '') +
        '<br>سيعمل الدخول محلياً (وضع مؤقّت) — <a href="supabase-check.html" style="text-decoration:underline">افتح صفحة فحص الاتصال</a>.';
    } else if (st.state === 'on') {
      el.style.cssText += ';background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d';
      el.innerHTML = (st.role === 'staff'
        ? '<b>متصل بقاعدة الشركة.</b> سجّل الدخول بحسابك الرسمي.'
        : '<b>متصل بقاعدة الشركة.</b> الدخول بحساب الموظف الرسمي (يُنشئه المدير في Supabase).');
    } else {
      el.remove();
    }
  }

  function enterApp() {
    var s = Store.currentUser();
    if (!s) return;
    document.getElementById('login-wrap').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('side-user-name').textContent = s.name;
    document.getElementById('side-user-role').textContent = (s.role === 'admin' ? 'المدير العام' : 'موظف توظيف') + ' — ' + (s.title || '');
    applyRole();
    setView(state.view);
    renderSettings();
    // Scroll to top when entering dashboard
    window.scrollTo(0, 0);
  }

  function applyRole() {
    var admin = Store.isAdmin();
    document.querySelectorAll('[data-admin-only="true"]').forEach(function (b) {
      b.classList.toggle('hidden', !admin);
    });
    // الموظف يرى سجل عملياته فقط
    var logUser = document.getElementById('log-user');
    if (logUser && !admin) {
      logUser.value = Store.currentUser().username;
      logUser.disabled = true;
      state.log.user = Store.currentUser().username;
    } else if (logUser) { logUser.disabled = false; }
    if (!admin && (state.view === 'finance' || state.view === 'settings')) setView('overview');
  }

  /* ======================= التنقل ======================= */
  var TITLES = {
    overview: ['نظرة عامة', 'ملخص لحظي لحالة الوظائف والاستمارات والحجوزات'],
    jobs: ['الوظائف', 'إدارة الوظائف، الحجز المؤقت، الإغلاق وإعادة التفعيل'],
    applicants: ['الباحثون والاستمارات', 'إصدار الاستمارات، إدارة المحاولات الخمس، الطباعة'],
    holds: ['متابعة الحجوزات', 'حجوزات 24 ساعة وتثبيت نتائج المقابلات'],
    audit: ['سجل التدقيق', 'كل عملية مسجّلة بالثانية مع المستخدم وعنوان الجلسة'],
    finance: ['اللوحة المالية', 'الاستمارات الصادرة والتحصيل المتوقع لكل موظف'],
    settings: ['الإعدادات والنسخ', 'قواعد العمل، المستخدمون، النسخ الاحتياطي']
  };

  function bindNav() {
    document.querySelectorAll('#side-nav button').forEach(function (b) {
      if (b.hasAttribute('data-goto')) return;
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });
    document.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-goto]');
      if (g) setView(g.getAttribute('data-goto'));
    });
  }

  function setView(name) {
    if (!TITLES[name]) name = 'overview';
    state.view = name;
    document.querySelectorAll('#side-nav button[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === name);
    });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var view = document.getElementById('view-' + name);
    if (view) view.classList.add('active');
    document.getElementById('view-title').textContent = TITLES[name][0];
    document.getElementById('view-sub').textContent = TITLES[name][1];
    renderCurrent();
  }

  function renderCurrent() {
    if (!Store.currentUser()) return;
    if (state.view === 'overview') renderOverview();
    if (state.view === 'jobs') renderJobs();
    if (state.view === 'applicants') renderApplicants();
    if (state.view === 'holds') renderHolds();
    if (state.view === 'audit') renderAudit();
    if (state.view === 'finance') renderFinance();
    if (state.view === 'settings') renderSettings();
    renderNavCounts();
  }
  root.BRCRefresh = function () { renderCurrent(); };

  function renderNavCounts() {
    var pa = Store.pendingActions();
    var jobsNav = document.getElementById('nav-jobs-count');
    var holdsNav = document.getElementById('nav-holds-count');
    var appsNav = document.getElementById('nav-apps-count');
    if (jobsNav) {
      jobsNav.textContent = String(Store.stats().available);
      jobsNav.classList.remove('hidden');
    }
    if (holdsNav) {
      var c = pa.holds.length;
      holdsNav.textContent = String(c);
      holdsNav.classList.toggle('hidden', c === 0);
    }
    if (appsNav) {
      var r = pa.requests.length;
      appsNav.textContent = String(r);
      appsNav.classList.toggle('hidden', r === 0);
    }
  }

  /* ======================= الصيانة الدورية ======================= */
  function snapshotStatuses() {
    state.lastStatuses = {};
    Store.db().jobs.forEach(function (j) { state.lastStatuses[j.code] = j.status; });
  }

  function tick() {
    var before = state.lastStatuses;
    var actions = Store.runMaintenance();
    // النسخ الاحتياطي التلقائي المجدول — نسخة واحدة لكل خانة زمنية (يوم + وقت)
    var auto = Store.checkAutoBackup();
    if (auto) {
      UI.toast('ok', 'نسخة احتياطية تلقائية', 'أُنشئت النسخة المجدولة: ' + auto.name + ' (' + (auto.size / 1024).toFixed(1) + ' ك.ب)');
      renderSettings();
    }
    Store.db().jobs.forEach(function (j) {
      if (before[j.code] && before[j.code] === 'reserved' && j.status === 'available') {
        UI.toast('warn', 'إفراج تلقائي', 'أُفرجت الوظيفة ' + j.code + ' بعد انتهاء مهلة 24 ساعة.');
      }
    });
    snapshotStatuses();
    if (actions.length) renderCurrent();
  }

  /* ======================= نظرة عامة ======================= */
  function renderOverview() {
    var s = Store.stats();
    var pa = Store.pendingActions();
    var fin = Store.financialTotals();
    var stats = [
      { icon: 'briefcase', label: 'وظائف متاحة', value: s.available, hint: 'من أصل ' + s.totalJobs + ' وظيفة' },
      { icon: 'hourglass', label: 'حجوزات جارية', value: s.reserved, hint: 'مؤقتة لمدة 24 ساعة', accent: true },
      { icon: 'file', label: 'استمارات صادرة', value: s.forms, hint: s.activeForms + ' سارية الآن' },
      { icon: 'check', label: 'توظيف ناجح', value: s.hires, hint: 'منذ بداية التشغيل' },
      { icon: 'chart', label: 'التحصيل المتوقع', value: Store.money(fin.expected), hint: fin.printed + ' مرة طباعة' }
    ];
    document.getElementById('ov-stats').innerHTML = stats.map(function (x) {
      return '<div class="stat-card' + (x.accent ? ' accent' : '') + '">' +
        '<div class="lbl">' + UI.ic(x.icon) + ' ' + UI.esc(x.label) + '</div>' +
        '<div class="val">' + UI.esc(String(x.value)) + '</div>' +
        '<div class="hint">' + UI.esc(x.hint) + '</div></div>';
    }).join('');

    // إجراءات مطلوبة
    var actions = [];
    pa.requests.forEach(function (r) {
      actions.push({
        title: 'طلب استمارة قيد المراجعة: ' + r.serial,
        sub: r.fullName + ' — ' + (r.requestedCode ? 'يطلب الوظيفة ' + r.requestedCode : 'طلب عام') + ' · ' + r.phone,
        badge: '<span class="badge warn">قيد المراجعة</span>',
        act: { label: 'مراجعة', handler: function () { setView('applicants'); reviewRequestModal(r.serial); } }
      });
    });
    pa.holds.forEach(function (h) {
      actions.push({
        title: 'حجز جارٍ على الوظيفة ' + h.job.code,
        sub: 'الاستمارة ' + (h.serial || '—') + ' — المتبقي ' + UI.humanDuration(Math.max(0, h.hoursLeft * 3600000)),
        badge: h.hoursLeft < 4 ? '<span class="badge danger">عاجل</span>' : '<span class="badge warn">متابعة</span>',
        act: { label: 'إدارة', handler: function () { setView('holds'); } }
      });
    });
    pa.expired.forEach(function (a) {
      actions.push({
        title: 'استمارة منتهية: ' + a.serial, sub: a.fullName + ' — انتهت الصلاحية',
        badge: '<span class="badge danger">منتهية</span>',
        act: { label: 'فتح', handler: function () { attemptsModal(a.serial); } }
      });
    });
    pa.exhausted.forEach(function (a) {
      actions.push({
        title: 'استُهلكت المحاولات: ' + a.serial, sub: a.fullName + ' — 5 محاولات مستخدمة',
        badge: '<span class="badge warn">مكتملة</span>',
        act: { label: 'فتح', handler: function () { attemptsModal(a.serial); } }
      });
    });
    pa.rejected.forEach(function (r) {
      actions.push({
        title: 'مرشح مرفوض: ' + r.applicant.serial,
        sub: r.applicant.fullName + ' — ' + r.count + ' محاولة مرفوضة (الوظيفة أُعيدت للسوق)',
        badge: '<span class="badge muted">متابعة</span>',
        act: { label: 'فتح', handler: function () { attemptsModal(r.applicant.serial); } }
      });
    });

    var cEl = document.getElementById('ov-actions-count');
    if (cEl) cEl.textContent = String(actions.length);
    document.getElementById('ov-actions').innerHTML = actions.length
      ? actions.slice(0, 6).map(function (a, i) {
        return '<div class="attempt-slot" style="grid-template-columns:minmax(0,1fr) auto auto;border-radius:0;border-width:0 0 1px 0">' +
          '<div><div class="job">' + UI.esc(a.title) + '</div><small class="muted">' + UI.esc(a.sub) + '</small></div>' +
          '<div>' + a.badge + '</div>' +
          '<button class="btn btn-outline btn-sm" data-act="' + i + '">' + UI.esc(a.act.label) + '</button>' +
          '</div>';
      }).join('')
      : '<div class="table-empty">' + UI.ic('check') + '<div class="mt-2">لا توجد إجراءات معلّقة — كل الحجوزات والاستمارات تحت السيطرة.</div></div>';

    document.querySelectorAll('#ov-actions [data-act]').forEach(function (b) {
      b.addEventListener('click', function () { actions[Number(b.getAttribute('data-act'))].act.handler(); });
    });

    // حجوزات مصغّرة
    var holds = pa.holds.slice(0, 5);
    document.getElementById('ov-holds').innerHTML = holds.length
      ? holds.map(function (h) {
        return '<div class="attempt-slot" style="grid-template-columns:minmax(0,1fr) auto;border-radius:0;border-width:0 0 1px 0">' +
          '<div><div class="job"><span class="mono">' + UI.esc(h.job.code) + '</span> — ' + UI.esc(h.job.title) + '</div>' +
          '<small class="muted">الاستمارة ' + UI.esc(h.serial || '—') + ' · ' + UI.esc(h.job.employer.name) + ' · <span dir="ltr">' + UI.esc(h.job.employer.phone) + '</span></small></div>' +
          '<div>' + UI.holdHtml(h.job.holdExpiresAt) + '</div></div>';
      }).join('')
      : '<div class="table-empty">' + UI.ic('hourglass') + '<div class="mt-2">لا توجد حجوزات مؤقتة جارية الآن.</div></div>';

    // آخر العمليات
    document.getElementById('ov-recent').innerHTML = Store.listAudit({}).slice(0, 8).map(function (l) {
      return '<tr><td class="mono tiny" dir="ltr">' + UI.esc(Store.fmtDateTime(l.ts)) + '</td>' +
        '<td>' + UI.esc(l.name || l.user) + '</td><td>' + UI.esc(l.action) + '</td>' +
        '<td class="tiny muted">' + UI.esc(l.details) + '</td></tr>';
    }).join('') || '<tr><td colspan="4" class="table-empty">لا سجلات بعد</td></tr>';
  }

  /* ======================= الوظائف ======================= */
  function renderJobs() {
    var rows = Store.listJobs(state.j);
    var tbody = document.getElementById('jobs-table-body');
    var label = document.getElementById('jobs-count-label');
    if (label) label.textContent = rows.length + ' وظيفة';

    tbody.innerHTML = rows.map(function (j) {
      var holdCell = '—';
      if (j.status === 'reserved' && j.holdExpiresAt) {
        holdCell = '<div class="tiny">الاستمارة <b class="mono">' + UI.esc(j.reservedBy || '—') + '</b></div>' + UI.holdHtml(j.holdExpiresAt, { withDate: false });
      }
      var imageCell = j.imageUrl 
        ? '<img src="' + UI.esc(j.imageUrl) + '" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid #ddd" alt="' + UI.esc(j.title) + '">'
        : '<span class="tiny muted">لا صورة</span>';
      return '<tr>' +
        '<td>' + imageCell + '</td>' +
        '<td><span class="chip chip-code mono">' + UI.esc(j.code) + '</span></td>' +
        '<td><b>' + UI.esc(j.title) + '</b><div class="tiny muted">' + UI.esc(j.category) + '</div></td>' +
        '<td>' + UI.esc(j.region) + '</td>' +
        '<td class="nowrap tiny">' + Store.money(j.salaryMin) + '<br><span class="muted">إلى ' + Store.money(j.salaryMax) + '</span></td>' +
        '<td class="tiny">' + UI.esc(j.shift) + '</td>' +
        '<td>' + UI.jobBadge(j.status) + '</td>' +
        '<td>' + holdCell + '</td>' +
        '<td class="tiny">' + UI.esc(j.employer.name) + '<br><span class="mono" dir="ltr">' + UI.esc(j.employer.phone) + '</span><br><span class="muted">' + UI.esc(j.employer.address) + '</span></td>' +
        '<td><div class="cell-actions">' +
          '<button class="btn btn-outline btn-sm" data-job-edit="' + UI.esc(j.code) + '">' + UI.ic('edit') + ' تعديل</button>' +
          (j.status === 'reserved'
            ? '<button class="btn btn-warn btn-sm" data-job-release="' + UI.esc(j.code) + '">' + UI.ic('refresh') + ' إفراج</button>'
            : (j.status === 'available'
              ? '<button class="btn btn-lapis btn-sm" data-job-close="' + UI.esc(j.code) + '">إغلاق</button>'
              : '<button class="btn btn-ok btn-sm" data-job-reopen="' + UI.esc(j.code) + '">إعادة تفعيل</button>')) +
          '<button class="btn btn-outline btn-sm" data-job-assign="' + UI.esc(j.code) + '">' + UI.ic('user-plus') + ' ترشيح</button>' +
          '<button class="btn btn-danger btn-sm" data-job-del="' + UI.esc(j.code) + '">' + UI.ic('trash') + '</button>' +
        '</div></td></tr>';
    }).join('') || '<tr><td colspan="10" class="table-empty">لا توجد وظائف مطابقة</td></tr>';

    tbody.querySelectorAll('[data-job-edit]').forEach(function (b) {
      b.addEventListener('click', function () { jobModal(b.getAttribute('data-job-edit')); });
    });
    tbody.querySelectorAll('[data-job-release]').forEach(function (b) {
      b.addEventListener('click', function () { openHoldsModal(b.getAttribute('data-job-release')); });
    });
    tbody.querySelectorAll('[data-job-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        var code = b.getAttribute('data-job-close');
        UI.confirm({ title: 'إغلاق الوظيفة', message: 'سيتم إغلاق الوظيفة ' + code + ' ومنع الترشيح عليها.', confirmText: 'إغلاق الوظيفة', danger: true })
          .then(function (ok) { if (ok) { Store.setJobStatus(code, 'closed', 'إغلاق يدوي من اللوحة'); UI.toast('ok', 'تم الإغلاق', code); } });
      });
    });
    tbody.querySelectorAll('[data-job-reopen]').forEach(function (b) {
      b.addEventListener('click', function () {
        Store.setJobStatus(b.getAttribute('data-job-reopen'), 'available', 'إعادة تفعيل');
        UI.toast('ok', 'أُعيد التفعيل', 'الوظيفة متاحة الآن على الموقع العام.');
      });
    });
    tbody.querySelectorAll('[data-job-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var code = b.getAttribute('data-job-del');
        UI.confirm({ title: 'حذف الوظيفة', message: 'حذف الوظيفة ' + code + ' نهائياً؟ لا يمكن التراجع.', confirmText: 'حذف نهائي', danger: true })
          .then(function (ok) { if (ok) { Store.deleteJob(code); UI.toast('warn', 'تم الحذف', code + ' أُزيلت من النظام.'); } });
      });
    });
    tbody.querySelectorAll('[data-job-assign]').forEach(function (b) {
      b.addEventListener('click', function () { pickApplicantModal(b.getAttribute('data-job-assign')); });
    });
  }

  /* نموذج إضافة/تعديل وظيفة */
  function jobModal(code) {
    var j = code ? Store.getJob(code) : null;
    var regionsList = CFG.regions.map(function (r) { return '<option' + (j && j.region === r ? ' selected' : '') + '>' + UI.esc(r) + '</option>'; }).join('');
    var shiftsList = CFG.shifts.map(function (r) { return '<option' + (j && j.shift === r ? ' selected' : '') + '>' + UI.esc(r) + '</option>'; }).join('');
    var cats = CFG.jobCategories.map(function (r) { return '<option' + (j && j.category === r ? ' selected' : '') + '>' + UI.esc(r) + '</option>'; }).join('');
    var e = (j && j.employer) || { name: '', phone: '', address: '' };

    var body = '<form id="job-form" class="grid grid-2" style="gap:14px">' +
      '<div class="field" style="grid-column:1/-1"><label for="f-image">صورة الوظيفة (اختياري)</label>' +
        '<input type="file" id="f-image" accept="image/*" style="margin-bottom:8px">' +
        '<div id="image-preview" style="margin-top:8px">' + (j && j.imageUrl ? '<img src="' + UI.esc(j.imageUrl) + '" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid #ddd">' : '') + '</div>' +
        '<p class="tiny muted" style="margin:4px 0 0 0">ارفع صورة جذابة للوظيفة ( JPG, PNG )</p></div>' +
      '<div class="field"><label for="f-title">عنوان الوظيفة *</label><input type="text" id="f-title" required value="' + UI.esc(j ? j.title : '') + '"></div>' +
      '<div class="field"><label for="f-cat">التصنيف</label><select id="f-cat">' + cats + '</select></div>' +
      '<div class="field"><label for="f-region">المنطقة *</label><select id="f-region">' + regionsList + '</select></div>' +
      '<div class="field"><label for="f-shift">الدوام</label><select id="f-shift">' + shiftsList + '</select></div>' +
      '<div class="field"><label for="f-min">الأجر الأدنى (د.ع)</label><input type="number" id="f-min" min="0" step="25000" value="' + (j ? j.salaryMin : 500000) + '"></div>' +
      '<div class="field"><label for="f-max">الأجر الأعلى (د.ع)</label><input type="number" id="f-max" min="0" step="25000" value="' + (j ? j.salaryMax : 750000) + '"></div>' +
      '<div class="field"><label for="f-gender">الجنس المطلوب</label><select id="f-gender">' +
        ['لا فرق', 'ذكر', 'أنثى'].map(function (g) { return '<option' + (j && j.gender === g ? ' selected' : '') + '>' + g + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="f-vac">عدد الشواغر</label><input type="number" id="f-vac" min="1" value="' + (j ? (j.vacancies || 1) : 1) + '"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="f-req">الشروط (نقطة لكل شرط)</label><textarea id="f-req" placeholder="خبرة سنة&#10;شهادة جنسية">' + UI.esc(j ? (j.requirements || []).join('\n') : '') + '</textarea></div>' +
      '<div class="field"><label for="f-ename">اسم صاحب العمل (داخلي) *</label><input type="text" id="f-ename" required value="' + UI.esc(e.name) + '"></div>' +
      '<div class="field"><label for="f-ephone">هاتف صاحب العمل *</label><input type="tel" id="f-ephone" required dir="ltr" value="' + UI.esc(e.phone) + '"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="f-eaddr">عنوان صاحب العمل (داخلي)</label><input type="text" id="f-eaddr" value="' + UI.esc(e.address) + '"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="f-interview">مكان المقابلة</label><input type="text" id="f-interview" value="' + UI.esc(j ? j.interviewLocation : 'مقر الشركة - الحلة') + '"></div>' +
      '</form>' +
      '<p class="tiny muted mt-2 mb-0">' + UI.ic('lock') + ' الحقول الداخلية (اسم/هاتف/عنوان صاحب العمل) لا تظهر في الموقع العام.</p>';

    UI.modal({
      title: j ? ('تعديل الوظيفة ' + j.code) : 'إضافة وظيفة جديدة',
      subtitle: j ? null : 'سيُولَّد كود مصغّر تلقائياً بصيغة BRC-####',
      wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-gold" id="job-save">' + UI.ic('check') + (j ? ' حفظ التعديلات' : ' إضافة الوظيفة') + '</button>',
      onMount: function (box, close) {
        var imageFile = box.querySelector('#f-image');
        var imagePreview = box.querySelector('#image-preview');
        var imageData = j ? j.imageUrl : '';
        
        // Handle image upload
        imageFile.addEventListener('change', function(e) {
          var file = e.target.files[0];
          if (!file) return;
          
          if (file.size > 2 * 1024 * 1024) {
            UI.toast('err', 'حجم كبير', 'الحد الأقصى 2 ميجابايت');
            return;
          }
          
          var reader = new FileReader();
          reader.onload = function(e) {
            imageData = e.target.result;
            imagePreview.innerHTML = '<img src="' + imageData + '" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid #ddd">';
          };
          reader.readAsDataURL(file);
        });
        
        box.querySelector('#job-save').addEventListener('click', function () {
          var f = box.querySelector('#job-form');
          if (!f.reportValidity()) return;
          var data = {
            title: box.querySelector('#f-title').value.trim(),
            category: box.querySelector('#f-cat').value,
            region: box.querySelector('#f-region').value,
            shift: box.querySelector('#f-shift').value,
            salaryMin: Number(box.querySelector('#f-min').value),
            salaryMax: Number(box.querySelector('#f-max').value),
            gender: box.querySelector('#f-gender').value,
            vacancies: Number(box.querySelector('#f-vac').value),
            requirements: box.querySelector('#f-req').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
            employerName: box.querySelector('#f-ename').value.trim(),
            employerPhone: box.querySelector('#f-ephone').value.trim(),
            employerAddress: box.querySelector('#f-eaddr').value.trim(),
            interviewLocation: box.querySelector('#f-interview').value.trim(),
            imageUrl: imageData
          };
          if (j) {
            Store.updateJob(j.code, {
              title: data.title, category: data.category, region: data.region, shift: data.shift,
              salaryMin: data.salaryMin, salaryMax: data.salaryMax, gender: data.gender,
              vacancies: data.vacancies, requirements: data.requirements,
              employer: { name: data.employerName, phone: data.employerPhone, address: data.employerAddress },
              interviewLocation: data.interviewLocation,
              imageUrl: data.imageUrl
            });
            UI.toast('ok', 'تم التحديث', 'حُفظت بيانات الوظيفة ' + j.code);
          } else {
            var created = Store.createJob(data);
            UI.toast('ok', 'أُضيفت الوظيفة', 'الكود: ' + created.code + ' — ظهرت الآن على الموقع العام.');
          }
          close();
        });
      }
    });
  }

  /* ترشيح وظيفة من جدول الوظائف: اختيار الاستمارة */
  function pickApplicantModal(code) {
    var job = Store.getJob(code);
    if (!job) return;
    if (job.status !== 'available') { UI.toast('warn', 'الوظيفة غير متاحة', 'الحالة الحالية: ' + CFG.jobStatus[job.status].ar); return; }
    var list = Store.listApplicants({ status: 'all' });
    var body = '<p class="muted small">اختر الاستمارة (الباحث) لتسجيل المحاولة على الوظيفة <b class="mono">' + UI.esc(code) + '</b>. ' +
      'ستُحجز الوظيفة مؤقتاً ' + Store.settings().holdHours + ' ساعة بانتظار نتيجة المقابلة.</p>' +
      '<div class="table-wrap"><div class="table-scroll"><table class="data" style="min-width:560px">' +
      '<thead><tr><th>الرقم التسلسلي</th><th>الباحث</th><th>المحاولات</th><th>الحالة</th><th>ترشيح</th></tr></thead><tbody>' +
      list.map(function (a) {
        var st = Store.formStatus(a);
        var left = Store.attemptsLeft(a.serial);
        return '<tr><td class="mono">' + UI.esc(a.serial) + '</td><td>' + UI.esc(a.fullName) + '<div class="tiny muted">' + UI.esc(a.phone) + '</div></td>' +
          '<td>' + a.attemptsUsed + ' من ' + Store.settings().attemptLimit + '<div class="tiny muted">متبقٍ ' + left + '</div></td>' +
          '<td>' + UI.formBadge(st) + '</td>' +
          '<td>' + (st === 'active' && left > 0
            ? '<button class="btn btn-gold btn-sm" data-pick="' + UI.esc(a.serial) + '">ترشيح</button>'
            : '<span class="tiny muted">غير متاح</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    UI.modal({
      title: 'ترشيح على الوظيفة ' + code, subtitle: job.title + ' — ' + job.region, wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        box.querySelectorAll('[data-pick]').forEach(function (b) {
          b.addEventListener('click', function () {
            var serial = b.getAttribute('data-pick');
            var res = Store.selectAttempt(serial, code);
            if (!res.ok) { UI.toast('err', 'تعذّر الترشيح', res.error); return; }
            close();
            UI.toast('ok', 'تم الحجز المؤقت', 'الوظيفة ' + code + ' محجوزة للاستمارة ' + serial + ' حتى ' + Store.fmtDateTime(res.attempt.holdExpiresAt));
            attemptsModal(serial);
          });
        });
      }
    });
  }

  /* ======================= الباحثون والاستمارات ======================= */
  function renderApplicants() {
    var rows = Store.listApplicants(state.a);
    var label = document.getElementById('apps-count-label');
    if (label) label.textContent = rows.length + ' استمارة';
    var tbody = document.getElementById('apps-table-body');

    tbody.innerHTML = rows.map(function (a) {
      var st = Store.formStatus(a);
      var left = Store.attemptsLeft(a.serial);
      var hold = a.holds ? '<span class="badge warn">حجز جارٍ</span>' : '';
      var isPending = st === 'pending';
      var isRejected = st === 'rejected';

      var requestChip = a.requestedCode ? '<div class="tiny"><span class="chip chip-gold">طلب: ' + UI.esc(a.requestedCode) + '</span></div>' : '';
      var nameCell = '<b>' + UI.esc(a.fullName) + '</b><div class="tiny muted">' + UI.esc(a.address || '') + '</div>' +
        (isRejected && a.rejectReason ? '<div class="tiny"><span class="badge danger">السبب: ' + UI.esc(a.rejectReason) + '</span></div>' : '');

      var dateCells = isPending || isRejected
        ? '<td class="tiny muted">—</td><td class="tiny muted">—</td><td class="tiny muted">—</td>'
        : '<td class="tiny" dir="ltr">' + Store.fmtDate(a.issueDate) + '</td>' +
          '<td class="tiny" dir="ltr">' + Store.fmtDate(a.expiryDate) + '</td>' +
          '<td class="tiny">' + (a.daysLeft < 0 ? '<span class="badge danger">منتهية</span>' : a.daysLeft + ' يوم') + '</td>';

      var attemptsCell = isPending || isRejected
        ? '<td class="tiny muted">—</td>'
        : '<td>' + a.attemptsUsed + ' / ' + Store.settings().attemptLimit + '<div class="tiny muted">متبقٍ ' + left + '</div>' + hold + '</td>';

      var statusCell = '<td>' + UI.formBadge(st);
      if (!isPending && !isRejected) {
        var fee = Number(a.fee != null ? a.fee : Store.settings().formFee);
        var paidAmount = Number(a.paidAmount || 0);
        if (paidAmount >= fee) {
          statusCell += '<div class="tiny"><span class="badge ok">الرسم مستلم</span></div>';
        } else if (paidAmount > 0) {
          statusCell += '<div class="tiny"><span class="badge warn">جزئي: ' + Store.money(paidAmount) + '</span></div>';
        } else {
          statusCell += '<div class="tiny"><span class="badge muted">الرسم غير مستلم</span></div>';
        }
      }
      statusCell += '</td>';

      var actionsCell;
      if (isPending) {
        actionsCell = '<td><div class="cell-actions">' +
          '<button class="btn btn-ok btn-sm" data-app-approve="' + UI.esc(a.serial) + '">' + UI.ic('check') + ' قبول</button>' +
          '<button class="btn btn-danger btn-sm" data-app-reject="' + UI.esc(a.serial) + '">' + UI.ic('x') + ' رفض</button>' +
          '</div></td>';
      } else if (isRejected) {
        actionsCell = '<td class="tiny muted">طلب مرفوض — لا إجراء</td>';
      } else {
        actionsCell = '<td><div class="cell-actions">' +
          '<button class="btn btn-lapis btn-sm" data-app-attempts="' + UI.esc(a.serial) + '">' + UI.ic('list') + ' المحاولات</button>' +
          '<button class="btn btn-gold btn-sm" data-app-print="' + UI.esc(a.serial) + '">' + UI.ic('print') + ' طباعة</button>' +
          '<button class="btn btn-outline btn-sm" data-app-verify="' + UI.esc(a.serial) + '">' + UI.ic('qr') + '</button>' +
          '<button class="btn btn-outline btn-sm" data-app-fee="' + UI.esc(a.serial) + '">' + UI.ic('money') + '</button>' +
          '</div></td>';
      }

      return '<tr>' +
        '<td><span class="mono">' + UI.esc(a.serial) + '</span>' + requestChip + '</td>' +
        '<td>' + nameCell + '</td>' +
        '<td class="mono tiny" dir="ltr">' + UI.esc(a.phone) + '</td>' +
        dateCells +
        attemptsCell +
        statusCell +
        actionsCell +
        '</tr>';
    }).join('') || '<tr><td colspan="9" class="table-empty">لا توجد استمارات مطابقة</td></tr>';

    tbody.querySelectorAll('[data-app-approve]').forEach(function (b) {
      b.addEventListener('click', function () {
        var serial = b.getAttribute('data-app-approve');
        var res = Store.approveApplicant(serial);
        if (res.ok) {
          UI.toast('ok', 'قُبل الطلب', 'صدرت الاستمارة ' + serial + ' رسمياً — صلاحية 30 يوماً.');
          renderApplicants(); renderNavCounts();
        } else UI.toast('err', 'تعذّر القبول', res.error);
      });
    });
    tbody.querySelectorAll('[data-app-reject]').forEach(function (b) {
      b.addEventListener('click', function () { reviewRequestModal(b.getAttribute('data-app-reject'), true); });
    });

    tbody.querySelectorAll('[data-app-attempts]').forEach(function (b) {
      b.addEventListener('click', function () { attemptsModal(b.getAttribute('data-app-attempts')); });
    });
    tbody.querySelectorAll('[data-app-print]').forEach(function (b) {
      b.addEventListener('click', function () {
        var app = Store.getApplicant(b.getAttribute('data-app-print'));
        V.print(app);
        UI.toast('ok', 'طباعة الاستمارة', app.serial + ' — صيغة A4 مع الكيو آر كود.');
      });
    });
    tbody.querySelectorAll('[data-app-verify]').forEach(function (b) {
      b.addEventListener('click', function () {
        var serial = b.getAttribute('data-app-verify');
        var app = Store.getApplicant(serial);
        var url = Store.verifyUrl(serial);
        UI.modal({
          title: 'التحقق من الاستمارة ' + serial, body:
            '<div class="grid" style="grid-template-columns:1fr 200px;gap:18px;align-items:start">' +
            '<div><div class="data-grid">' +
            '<div class="data-item"><div class="k">الباحث</div><div class="v">' + UI.esc(app.fullName) + '</div></div>' +
            '<div class="data-item"><div class="k">حالة الاستمارة</div><div class="v">' + CFG.formStatus[Store.formStatus(app)].ar + '</div></div>' +
            '<div class="data-item"><div class="k">المتبقي</div><div class="v">' + Store.attemptsLeft(serial) + ' محاولة</div></div>' +
            '<div class="data-item" style="grid-column:1/-1"><div class="k">رابط التحقق (المطبوع في الكيو آر كود)</div><div class="v mono tiny" dir="ltr">' + UI.esc(url) + '</div></div>' +
            '</div><div class="flex mt-2"><button class="btn btn-lapis btn-sm" id="go-verify">' + UI.ic('eye') + ' فتح صفحة التحقق</button>' +
            '<button class="btn btn-outline btn-sm" id="copy-url">' + UI.ic('share') + ' نسخ الرابط</button></div></div>' +
            '<div class="verify-qr">' + V.qrSvg(url, 180) + '</div></div>',
          onMount: function (box, close) {
            box.querySelector('#go-verify').addEventListener('click', function () { window.open(Store.verifyLocalUrl(serial), '_blank'); });
            box.querySelector('#copy-url').addEventListener('click', function () {
              if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { UI.toast('ok', 'تم النسخ', url); });
              else UI.toast('info', 'الرابط', url, 7000);
            });
          }
        });
      });
    });
    tbody.querySelectorAll('[data-app-fee]').forEach(function (b) {
      b.addEventListener('click', function () {
        var serial = b.getAttribute('data-app-fee');
        paymentModal(serial);
      });
    });
  }

  /* نافذة تسجيل الدفعة (كاملة أو جزئية) */
  function paymentModal(serial) {
    var app = Store.getApplicant(serial);
    if (!app) return;
    var fee = Number(app.fee != null ? app.fee : Store.settings().formFee);
    var paid = Number(app.paidAmount || 0);
    var remaining = Math.max(0, fee - paid);
    
    var body = '<div class="field mb-2">' +
      '<label>الاستمارة</label>' +
      '<div class="mono">' + UI.esc(serial) + ' — ' + UI.esc(app.fullName) + '</div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label>رسم الاستمارة</label>' +
      '<div><b>' + Store.money(fee) + '</b></div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label>المبالغ المدفوع سابقاً</label>' +
      '<div>' + Store.money(paid) + (paid > 0 ? ' <span class="badge ok">مدفوع</span>' : ' <span class="badge muted">غير مدفوع</span>') + '</div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label>المتبقي</label>' +
      '<div><b style="color:' + (remaining > 0 ? 'var(--danger)' : 'var(--ok)') + '">' + Store.money(remaining) + '</b></div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label for="pay-amount">المبلغ المراد تسجيله (د.ع)</label>' +
      '<input type="number" id="pay-amount" min="0" max="' + remaining + '" step="1000" value="' + remaining + '" placeholder="0">' +
      '</div>' +
      '<div class="flex" style="gap:8px;margin-top:8px">' +
      '<button class="btn btn-outline btn-sm" id="pay-full">كامل (' + Store.money(remaining) + ')</button>' +
      '<button class="btn btn-outline btn-sm" id="pay-half">نصف (' + Store.money(Math.round(remaining / 2)) + ')</button>' +
      '<button class="btn btn-outline btn-sm" id="pay-clear">تصفير</button>' +
      '</div>';
    
    UI.modal({
      title: 'تسجيل دفعة',
      subtitle: 'يمكنك تسجيل دفعة كاملة أو جزئية',
      body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-ok" id="pay-save">' + UI.ic('check') + ' تسجيل الدفعة</button>',
      onMount: function (box, close) {
        var input = box.querySelector('#pay-amount');
        
        box.querySelector('#pay-full').addEventListener('click', function () {
          input.value = remaining;
        });
        box.querySelector('#pay-half').addEventListener('click', function () {
          input.value = Math.round(remaining / 2);
        });
        box.querySelector('#pay-clear').addEventListener('click', function () {
          input.value = 0;
        });
        
        box.querySelector('#pay-save').addEventListener('click', function () {
          var amount = Number(input.value) || 0;
          if (amount < 0 || amount > remaining) {
            UI.toast('err', 'مبلغ غير صحيح', 'يجب أن يكون بين 0 و ' + Store.money(remaining));
            return;
          }
          
          var newTotal = paid + amount;
          Store.setFeePaid(serial, true, newTotal);
          
          if (newTotal >= fee) {
            UI.toast('ok', 'تم التسجيل', 'سُجّل استلام الرسم كاملاً — ' + Store.money(newTotal));
          } else if (newTotal > 0) {
            UI.toast('warn', 'دفعة جزئية', 'سُجّل ' + Store.money(amount) + ' — المتبقي: ' + Store.money(fee - newTotal));
          } else {
            UI.toast('info', 'تم التصفير', 'أُلغي تسجيل الرسم');
          }
          close();
        });
      }
    });
  }

  /* مراجعة طلب استمارة قيد المراجعة: قبول أو رفض */
  function reviewRequestModal(serial, rejectMode) {
    var app = Store.getApplicant(serial);
    if (!app || Store.formStatus(app) !== 'pending') return;
    var job = app.requestedCode ? Store.getJob(app.requestedCode) : null;
    var body =
      '<div class="data-grid mb-3">' +
        '<div class="data-item"><div class="k">رقم الطلب</div><div class="v mono" dir="ltr">' + UI.esc(app.serial) + '</div></div>' +
        '<div class="data-item"><div class="k">الاسم الكامل</div><div class="v">' + UI.esc(app.fullName) + '</div></div>' +
        '<div class="data-item"><div class="k">الهاتف</div><div class="v mono" dir="ltr">' + UI.esc(app.phone) + '</div></div>' +
        '<div class="data-item"><div class="k">تاريخ الميلاد</div><div class="v" dir="ltr">' + Store.fmtDate(app.dob || '') + '</div></div>' +
        '<div class="data-item"><div class="k">الجنس</div><div class="v">' + UI.esc(app.gender || '—') + '</div></div>' +
        '<div class="data-item"><div class="k">العنوان</div><div class="v">' + UI.esc(app.address || '—') + '</div></div>' +
        '<div class="data-item" style="grid-column:1/-1"><div class="k">الوظيفة المطلوبة</div><div class="v">' +
          (job ? '<span class="chip chip-code mono">' + UI.esc(job.code) + '</span> ' + UI.esc(job.title) + ' — ' + UI.esc(job.region) : (UI.esc(app.requestedCode || '—') + ' <span class="tiny muted">(كود غير معروف)</span>')) +
        '</div></div>' +
      '</div>' +
      (rejectMode
        ? '<div class="field"><label for="rr-reason">سبب الرفض</label><input type="text" id="rr-reason" placeholder="مثال: بيانات ناقصة / لا يطابق الشروط"></div>'
        : '<div class="panel" style="background:#fdf6e3;border-color:#f0d9a3"><div class="panel-body" style="padding:12px 15px">' +
          '<p class="mb-0 small">' + UI.ic('check') + ' عند القبول تصدر الاستمارة رسمياً برقم ' + UI.esc(app.serial) + ' وتصبح صالحة 30 يوماً بخمس محاولات.</p></div></div>');

    UI.modal({
      title: (rejectMode ? 'رفض طلب الاستمارة' : 'مراجعة طلب الاستمارة'),
      subtitle: 'طلب قيد المراجعة — ' + app.serial,
      wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        (rejectMode
          ? '<button class="btn btn-danger" id="rr-confirm">' + UI.ic('x') + ' تأكيد الرفض</button>'
          : '<button class="btn btn-ok" id="rr-approve">' + UI.ic('check') + ' قبول وإصدار الاستمارة</button>'),
      onMount: function (box, close) {
        var approveBtn = box.querySelector('#rr-approve');
        if (approveBtn) approveBtn.addEventListener('click', function () {
          var res = Store.approveApplicant(serial);
          close();
          if (res.ok) {
            UI.toast('ok', 'قُبل الطلب', 'صدرت الاستمارة ' + serial + ' — ' + app.fullName);
            renderApplicants(); renderNavCounts(); renderOverview();
            attemptsModal(serial);
          } else UI.toast('err', 'تعذّر القبول', res.error);
        });
        var rejectBtn = box.querySelector('#rr-confirm');
        if (rejectBtn) rejectBtn.addEventListener('click', function () {
          var reason = (box.querySelector('#rr-reason') || {}).value || '';
          var res = Store.rejectApplicant(serial, reason.trim());
          close();
          if (res.ok) {
            UI.toast('ok', 'رُفض الطلب', serial + ' — ' + app.fullName);
            renderApplicants(); renderNavCounts(); renderOverview();
          } else UI.toast('err', 'تعذّر الرفض', res.error);
        });
      }
    });
  }

  /* إدارة المحاولات الخمس لاستمارة */
  function attemptsModal(serial) {
    var app = Store.getApplicant(serial);
    if (!app) return;
    var attempts = Store.getAttempts(serial);
    var st = Store.formStatus(app);
    var limit = Number(Store.settings().attemptLimit || 5);
    var active = Store.activeAttempt(serial);

    var slots = attempts.map(function (t) {
      var filled = t.slotStatus !== 'empty';
      var actions = '';
      if (!filled) {
        actions = '<button class="btn btn-gold btn-sm" data-assign="' + t.no + '">' + UI.ic('plus') + ' ترشيح وظيفة</button>';
      } else if (t.slotStatus === 'reserved') {
        actions = '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-ok btn-sm" data-win="' + t.no + '">' + UI.ic('check') + ' تم التوظيف</button>' +
          '<button class="btn btn-danger btn-sm" data-reject="' + t.no + '">' + UI.ic('x-circle') + ' رفض</button>' +
          '<button class="btn btn-warn btn-sm" data-release="' + t.no + '">إفراج</button></div>';
      } else if (t.slotStatus === 'succeeded') {
        actions = '<span class="badge ok">مكتمل</span>';
      } else {
        actions = '<button class="btn btn-gold btn-sm" data-assign="' + t.no + '">' + UI.ic('refresh') + ' ترشيح جديد</button>';
      }
      return '<div class="attempt-slot' + (filled ? ' filled' : '') + '">' +
        '<div class="no">' + t.no + '</div>' +
        '<div class="job">' + (filled ? '<span class="mono">' + UI.esc(t.jobCode) + '</span> — ' + UI.esc(t.jobTitle) : 'محاولة متاحة') +
          '<small>' + (filled ? UI.esc(t.location) + ' · ' + UI.esc(t.employerName) + ' · <span dir="ltr">' + UI.esc(t.employerPhone) + '</span>' : 'لم تُستخدم بعد') + '</small></div>' +
        '<div>' + (filled ? UI.slotBadge(t.slotStatus) +
          (t.slotStatus === 'reserved' && t.holdExpiresAt ? '<div class="mt-1">' + UI.holdHtml(t.holdExpiresAt, { withDate: false }) + '</div>' : '') +
          (t.note ? '<div class="tiny muted mt-1">' + UI.esc(t.note) + '</div>' : '') : '') + '</div>' +
        '<div>' + actions + '</div>' +
        '</div>';
    }).join('');

    var body = '' +
      '<div class="flex-between flex-wrap mb-3" style="gap:12px">' +
        '<div>' +
          '<div class="flex flex-wrap" style="gap:8px;align-items:center">' +
            '<span class="chip chip-code mono">' + UI.esc(app.serial) + '</span>' + UI.formBadge(st) +
            (app.feePaid ? '<span class="badge ok">الرسم مستلم</span>' : '<span class="badge muted">الرسم غير مستلم</span>') +
          '</div>' +
          '<div class="mt-2"><b>' + UI.esc(app.fullName) + '</b> · <span class="mono" dir="ltr">' + UI.esc(app.phone) + '</span>' +
          '<div class="tiny muted">' + UI.esc(app.address || '') + '</div></div>' +
        '</div>' +
        '<div class="data-grid" style="gap:10px">' +
          '<div class="data-item"><div class="k">الإصدار</div><div class="v" dir="ltr">' + Store.fmtDate(app.issueDate) + '</div></div>' +
          '<div class="data-item"><div class="k">الانتهاء</div><div class="v" dir="ltr">' + Store.fmtDate(app.expiryDate) + '</div></div>' +
          '<div class="data-item"><div class="k">المحاولات المستخدمة</div><div class="v">' + attempts.filter(function (t) { return t.slotStatus !== 'empty'; }).length + ' / ' + limit + '</div></div>' +
        '</div>' +
      '</div>' +
      (st !== 'active' ? '<div class="panel mb-3" style="background:#fdf1d8;border-color:#f0d9a3"><div class="panel-body" style="padding:12px 15px">' +
        '<p class="mb-0 small">' + UI.ic('alert') + ' الاستمارة ' + CFG.formStatus[st].ar +
        (st === 'expired' ? ' — انتهت مدة الثلاثين يوماً، لا يمكن تسجيل محاولات جديدة.' : ' — لا توجد محاولات متبقية.') + '</p></div></div>' : '') +
      '<h3 class="mb-2">سجل المحاولات (حتى ' + limit + ' محاولات)</h3>' +
      '<div class="attempts-stack">' + slots + '</div>';

    UI.modal({
      title: 'إدارة محاولات الاستمارة', subtitle: app.fullName + ' — ' + app.serial, wide: true, body: body,
      footer:
        '<button class="btn btn-gold" id="m-print">' + UI.ic('print') + ' طباعة الاستمارة (A4)</button>' +
        '<button class="btn btn-outline" id="m-verify">' + UI.ic('qr') + ' صفحة التحقق</button>' +
        '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        box.querySelector('#m-print').addEventListener('click', function () { V.print(app); });
        box.querySelector('#m-verify').addEventListener('click', function () { window.open(Store.verifyLocalUrl(serial), '_blank'); });

        box.querySelectorAll('[data-assign]').forEach(function (b) {
          b.addEventListener('click', function () {
            var no = Number(b.getAttribute('data-assign'));
            close();
            jobPickerModal(serial, no);
          });
        });
        box.querySelectorAll('[data-win]').forEach(function (b) {
          b.addEventListener('click', function () {
            var no = Number(b.getAttribute('data-win'));
            outcomeModal(serial, no, 'succeeded', close);
          });
        });
        box.querySelectorAll('[data-reject]').forEach(function (b) {
          b.addEventListener('click', function () {
            var no = Number(b.getAttribute('data-reject'));
            outcomeModal(serial, no, 'rejected', close);
          });
        });
        box.querySelectorAll('[data-release]').forEach(function (b) {
          b.addEventListener('click', function () {
            var no = Number(b.getAttribute('data-release'));
            UI.confirm({
              title: 'إفراج عن الحجز', danger: true, confirmText: 'إفراج وإعادة الوظيفة',
              message: 'سيُوسم الحجز كـ «انتهت المهلة / تتطلب إجراء» وتُعاد الوظيفة إلى «متاحة» فوراً.'
            }).then(function (ok) {
              if (!ok) return;
              var res = Store.releaseHold(serial, no);
              if (res.ok) { UI.toast('warn', 'تم الإفراج', 'أُعيدت الوظيفة ' + (res.job ? res.job.code : '') + ' إلى قائمة المتاح.'); close(); }
            });
          });
        });
      },
      onClose: function () { renderCurrent(); }
    });
  }

  /* اختيار وظيفة لمحاولة معينة */
  function jobPickerModal(serial, no) {
    var jobs = Store.listJobs({ status: 'available' });
    var body = '' +
      '<p class="muted small">اختر الوظيفة المطلوبة للمحاولة رقم <b>#' + no + '</b>. الوظيفة ستُحجز مؤقتاً ' +
      Store.settings().holdHours + ' ساعة بانتظار نتيجة المقابلة، وإن لم تُثبَّت النتيجة تُفرج تلقائياً.</p>' +
      '<div class="search-wrap mb-2"><svg class="ic"><use href="#i-search" xlink:href="#i-search"/></svg>' +
      '<input type="search" id="pick-q" placeholder="ابحث بالكود أو العنوان أو المنطقة..."></div>' +
      '<div id="pick-list">' + pickListHtml(jobs) + '</div>';

    UI.modal({
      title: 'ترشيح وظيفة للمحاولة #' + no, subtitle: 'الاستمارة ' + serial, wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        function bind() {
          box.querySelectorAll('[data-assign-job]').forEach(function (b) {
            b.addEventListener('click', function () {
              var code = b.getAttribute('data-assign-job');
              var res = Store.selectAttempt(serial, code);
              if (!res.ok) { UI.toast('err', 'تعذّر الترشيح', res.error); return; }
              close();
              UI.toast('ok', 'تم الترشيح', 'الوظيفة ' + code + ' محجوزة حتى ' + Store.fmtDateTime(res.attempt.holdExpiresAt));
              attemptsModal(serial);
            });
          });
        }
        bind();
        var q = box.querySelector('#pick-q');
        q.addEventListener('input', UI.debounce(function () {
          var list = Store.listJobs({ status: 'available', q: q.value });
          box.querySelector('#pick-list').innerHTML = pickListHtml(list);
          bind();
        }, 200));
      }
    });
  }

  function pickListHtml(jobs) {
    if (!jobs.length) return '<div class="table-empty">لا توجد وظائف متاحة مطابقة</div>';
    return '<div class="table-wrap"><div class="table-scroll"><table class="data" style="min-width:620px">' +
      '<thead><tr><th>الكود</th><th>الوظيفة</th><th>المنطقة</th><th>الأجر</th><th>الدوام</th><th>اختيار</th></tr></thead><tbody>' +
      jobs.map(function (j) {
        return '<tr><td><span class="chip chip-code mono">' + UI.esc(j.code) + '</span></td>' +
          '<td><b>' + UI.esc(j.title) + '</b><div class="tiny muted">' + UI.esc(j.employer.name) + ' · <span dir="ltr">' + UI.esc(j.employer.phone) + '</span></div></td>' +
          '<td>' + UI.esc(j.region) + '</td><td class="tiny nowrap">' + Store.money(j.salaryMin) + '</td>' +
          '<td class="tiny">' + UI.esc(j.shift) + '</td>' +
          '<td><button class="btn btn-gold btn-sm" data-assign-job="' + UI.esc(j.code) + '">ترشيح</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* تثبيت نتيجة المقابلة */
  function outcomeModal(serial, no, outcome, closeParent) {
    var win = outcome === 'succeeded';
    UI.modal({
      title: win ? 'تثبيت التوظيف' : 'تسجيل رفض المرشح',
      body: '<p class="muted small">' + (win
        ? 'سيُثبَّت التوظيف وتُغلق الوظيفة نهائياً على الموقع العام.'
        : 'ستُعاد الوظيفة إلى «متاحة» فوراً، وتُفعَّل المحاولة التالية للباحث تلقائياً (حتى المحاولة الخامسة).') + '</p>' +
        '<div class="field"><label for="o-note">ملاحظة (تُحفظ في السجل والاستمارة)</label>' +
        '<textarea id="o-note" placeholder="' + (win ? 'اسم جهة العمل، تاريخ المباشرة...' : 'سبب الرفض: لم يحضر المقابلة، عدم كفاية الخبرة...') + '"></textarea></div>',
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn ' + (win ? 'btn-ok' : 'btn-danger') + '" id="o-save">' + (win ? 'تثبيت التوظيف' : 'تسجيل الرفض') + '</button>',
      onMount: function (box, close) {
        box.querySelector('#o-save').addEventListener('click', function () {
          var note = box.querySelector('#o-note').value.trim();
          var res = Store.setOutcome(serial, no, outcome, note);
          if (!res.ok) { UI.toast('err', 'تعذّر التنفيذ', res.error); return; }
          close();
          if (closeParent) closeParent();
          if (win) UI.toast('ok', 'تم تثبيت التوظيف', 'الوظيفة ' + (res.job ? res.job.code : '') + ' أُغلقت بنجاح.');
          else UI.toast('warn', 'تم تسجيل الرفض', 'أُعيدت الوظيفة إلى قائمة المتاح' + (res.nextAttempt ? ' وفُعّلت المحاولة #' + res.nextAttempt.no : ''));
          attemptsModal(serial);
        });
      }
    });
  }

  /* نافذة الحجوزات: تثبيت نتيجة أو إفراج */
  function openHoldsModal(jobCode) {
    var job = Store.getJob(jobCode);
    if (!job || !job.reservedBy) return;
    var serial = job.reservedBy;
    var t = Store.getAttempts(serial).filter(function (x) { return x.jobId === job.id && x.slotStatus === 'reserved'; })[0];
    UI.modal({
      title: 'إدارة الحجز المؤقت — ' + job.code,
      subtitle: job.title + ' · ' + job.region,
      body: '<div class="data-grid mb-3">' +
        '<div class="data-item"><div class="k">الاستمارة المحجوزة</div><div class="v mono">' + UI.esc(serial) + '</div></div>' +
        '<div class="data-item"><div class="k">المحاولة</div><div class="v">#' + (t ? t.no : '—') + '</div></div>' +
        '<div class="data-item"><div class="k">ينتهي الحجز</div><div class="v" dir="ltr">' + Store.fmtDateTime(job.holdExpiresAt) + '</div></div>' +
        '<div class="data-item"><div class="k">المتبقي</div><div class="v">' + UI.holdHtml(job.holdExpiresAt, { withDate: false }) + '</div></div>' +
        '<div class="data-item"><div class="k">صاحب العمل</div><div class="v">' + UI.esc(job.employer.name) + '</div></div>' +
        '<div class="data-item"><div class="k">هاتفه</div><div class="v mono" dir="ltr">' + UI.esc(job.employer.phone) + '</div></div>' +
        '<div class="data-item" style="grid-column:1/-1"><div class="k">مكان المقابلة</div><div class="v">' + UI.esc(job.interviewLocation) + '</div></div>' +
        '</div>' +
        '<p class="tiny muted mb-0">' + UI.ic('hourglass') + ' إن لم تُثبَّت النتيجة خلال المدة المتبقية، يُفرج النظام الوظيفة تلقائياً ويرفع المحاولة كـ «تتطلب إجراء».</p>',
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>' +
        '<button class="btn btn-warn" id="h-release">' + UI.ic('refresh') + ' إفراج فوري</button>' +
        '<button class="btn btn-danger" id="h-reject">' + UI.ic('x-circle') + ' رفض</button>' +
        '<button class="btn btn-ok" id="h-win">' + UI.ic('check') + ' تم التوظيف</button>',
      onMount: function (box, close) {
        box.querySelector('#h-win').addEventListener('click', function () { close(); outcomeModal(serial, t ? t.no : 1, 'succeeded'); });
        box.querySelector('#h-reject').addEventListener('click', function () { close(); outcomeModal(serial, t ? t.no : 1, 'rejected'); });
        box.querySelector('#h-release').addEventListener('click', function () {
          var res = Store.releaseHold(serial, t ? t.no : 1, 'إفراج يدوي من لوحة المتابعة');
          if (res.ok) { UI.toast('warn', 'تم الإفراج', 'أُعيدت الوظيفة ' + job.code + ' إلى المتاح.'); close(); }
        });
      }
    });
  }

  /* ======================= الحجوزات ======================= */
  function renderHolds() {
    var pa = Store.pendingActions();
    var label = document.getElementById('holds-count-label');
    if (label) label.textContent = pa.holds.length + ' حجز جارٍ';
    var host = document.getElementById('holds-list');
    host.innerHTML = pa.holds.length ? pa.holds.map(function (h) {
      var urgent = h.hoursLeft < 4;
      return '<div class="attempt-slot" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;' +
        (urgent ? 'border-color:#f0c3c1;background:#fdf5f4' : '') + '">' +
        '<div><div class="job"><span class="mono">' + UI.esc(h.job.code) + '</span> — ' + UI.esc(h.job.title) +
        '<small>' + UI.esc(h.job.region) + ' · صاحب العمل: ' + UI.esc(h.job.employer.name) + ' · <span dir="ltr">' + UI.esc(h.job.employer.phone) + '</span></small></div>' +
        '<div class="tiny muted mt-1">مكان المقابلة: ' + UI.esc(h.job.interviewLocation) + '</div></div>' +
        '<div><div class="tiny muted">الاستمارة</div><div class="mono">' + UI.esc(h.serial || '—') + '</div>' +
        UI.holdHtml(h.job.holdExpiresAt) + '</div>' +
        '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-lapis btn-sm" data-hold-manage="' + UI.esc(h.job.code) + '">إدارة الحجز</button>' +
          '<button class="btn btn-outline btn-sm" data-hold-app="' + UI.esc(h.serial || '') + '">الاستمارة</button>' +
        '</div></div>';
    }).join('') : '<div class="table-empty">' + UI.ic('check') + '<div class="mt-2">لا حجوزات مؤقتة جارية — كل الوظائف متاحة.</div></div>';

    host.querySelectorAll('[data-hold-manage]').forEach(function (b) {
      b.addEventListener('click', function () { openHoldsModal(b.getAttribute('data-hold-manage')); });
    });
    host.querySelectorAll('[data-hold-app]').forEach(function (b) {
      b.addEventListener('click', function () { if (b.getAttribute('data-hold-app')) attemptsModal(b.getAttribute('data-hold-app')); });
    });

    // منتهية المهلة
    var expired = [];
    Store.db().attempts.forEach(function (t) {
      if (t.slotStatus === 'expired') expired.push(t);
    });
    document.getElementById('expired-table-body').innerHTML = expired.length ? expired.map(function (t) {
      var app = Store.getApplicant(t.serial);
      return '<tr>' +
        '<td class="mono">' + UI.esc(t.serial) + '</td>' +
        '<td>' + UI.esc(app ? app.fullName : '—') + '</td>' +
        '<td>#' + t.no + '</td>' +
        '<td class="mono">' + UI.esc(t.jobCode || '—') + '</td>' +
        '<td class="tiny" dir="ltr">' + Store.fmtDateTime(t.closedAt) + '</td>' +
        '<td class="tiny muted">' + UI.esc(t.note || '') + '</td>' +
        '<td><button class="btn btn-gold btn-sm" data-reassign="' + UI.esc(t.serial) + '|' + t.no + '">ترشيح بديل</button></td></tr>';
    }).join('') : '<tr><td colspan="7" class="table-empty">لا محاولات منتهية المهلة</td></tr>';

    document.querySelectorAll('[data-reassign]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-reassign').split('|');
        jobPickerModal(parts[0], Number(parts[1]));
      });
    });
  }

  /* ======================= سجل التدقيق ======================= */
  function renderAudit() {
    var rows = Store.listAudit(state.log);
    var label = document.getElementById('audit-count-label');
    if (label) label.textContent = rows.length + ' سجل';
    document.getElementById('audit-table-body').innerHTML = rows.slice(0, 400).map(function (l) {
      var roleBadge = l.role === 'admin' ? '<span class="badge danger">مدير عام</span>'
        : (l.role === 'staff' ? '<span class="badge info">موظف</span>' : '<span class="badge muted">النظام</span>');
      return '<tr>' +
        '<td class="mono tiny" dir="ltr">' + UI.esc(Store.fmtDateTime(l.ts)) + '</td>' +
        '<td>' + UI.esc(l.name || l.user) + '<div class="tiny muted mono">' + UI.esc(l.user) + '</div></td>' +
        '<td>' + roleBadge + '</td>' +
        '<td class="tiny mono" dir="ltr">' + UI.esc(l.ip) + '</td>' +
        '<td><b>' + UI.esc(l.action) + '</b></td>' +
        '<td class="mono tiny">' + UI.esc(l.entityId) + '<div class="tiny muted">' + UI.esc(l.entity) + '</div></td>' +
        '<td class="tiny muted">' + UI.esc(l.details) + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="table-empty">لا سجلات مطابقة</td></tr>';
  }

  /* ======================= اللوحة المالية ======================= */
  function renderFinance() {
    var rows = Store.financials(state.fin.from, state.fin.to);
    var totals = Store.financialTotals(state.fin.from, state.fin.to);
    var stats = [
      { icon: 'file', label: 'إجمالي الاستمارات', value: totals.forms, hint: totals.printed + ' عملية طباعة' },
      { icon: 'money', label: 'المتوقع تحصيله', value: Store.money(totals.expected), hint: 'رسم الاستمارة ' + Store.money(Store.settings().formFee), accent: true },
      { icon: 'check', label: 'المستلَم فعلياً', value: Store.money(totals.collected), hint: 'المتبقي ' + Store.money(Math.max(0, totals.expected - totals.collected)) },
      { icon: 'briefcase', label: 'توظيف ناجح', value: totals.hires, hint: totals.holds + ' حجز جارٍ' }
    ];
    document.getElementById('fin-stats').innerHTML = stats.map(function (x) {
      return '<div class="stat-card' + (x.accent ? ' accent' : '') + '">' +
        '<div class="lbl">' + UI.ic(x.icon) + ' ' + UI.esc(x.label) + '</div>' +
        '<div class="val">' + UI.esc(String(x.value)) + '</div><div class="hint">' + UI.esc(x.hint) + '</div></div>';
    }).join('');

    var max = rows.reduce(function (m, r) { return Math.max(m, r.expected); }, 1);
    document.getElementById('fin-bars').innerHTML = rows.length ? rows.map(function (r) {
      return '<div class="bar-row"><div>' + UI.esc(r.name) + '<div class="tiny muted mono">' + UI.esc(r.user) + '</div></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(r.expected / max * 100) + '%"></div></div>' +
        '<div class="val">' + Store.money(r.expected) + '</div></div>';
    }).join('') : '<div class="table-empty">لا بيانات في هذه الفترة</div>';

    document.getElementById('fin-table-body').innerHTML = rows.map(function (r) {
      return '<tr><td><b>' + UI.esc(r.name) + '</b><div class="tiny muted mono">' + UI.esc(r.user) + '</div></td>' +
        '<td>' + r.forms + '</td><td>' + r.printed + '</td><td>' + Store.money(Store.settings().formFee) + '</td>' +
        '<td><b>' + Store.money(r.expected) + '</b></td>' +
        '<td><input type="number" class="fin-collected" data-user="' + UI.esc(r.user) + '" value="' + r.collected + '" min="0" step="1000" style="width:120px;padding:4px 8px;border:1px solid #ddd;border-radius:6px"></td>' +
        '<td><span class="badge ok">' + r.paid + ' مدفوع</span> <span class="badge warn">' + r.partial + ' جزئي</span> <span class="badge danger">' + r.unpaid + ' غير مدفوع</span></td>' +
        '<td>' + r.hires + '</td><td>' + r.holds + '</td></tr>';
    }).join('') || '<tr><td colspan="9" class="table-empty">لا بيانات</td></tr>';

    // Add total row inside tbody
    var totalRow = '<tr style="background:#f9f6ef;font-weight:900;border-top:2px solid var(--gold)">' +
      '<td colspan="4" style="text-align:left;padding-left:20px">المجموع الكلي</td>' +
      '<td><b>' + Store.money(totals.expected) + '</b></td>' +
      '<td><b style="color:var(--ok)">' + Store.money(totals.collected) + '</b></td>' +
      '<td colspan="3"></td></tr>';
    document.getElementById('fin-table-body').insertAdjacentHTML('beforeend', totalRow);

    // Bind input change events
    document.querySelectorAll('.fin-collected').forEach(function (input) {
      input.addEventListener('change', function () {
        var user = input.getAttribute('data-user');
        var newCollected = Number(input.value) || 0;
        updateEmployeeCollected(user, newCollected);
      });
    });
  }

  function updateEmployeeCollected(user, newCollected) {
    // Update all applicants for this user
    var apps = Store.listApplicants({ user: user });
    var fee = Store.settings().formFee;
    var remaining = newCollected;
    
    apps.forEach(function (app) {
      if (remaining <= 0) {
        Store.setFeePaid(app.serial, false, 0);
      } else if (remaining >= fee) {
        Store.setFeePaid(app.serial, true, fee);
        remaining -= fee;
      } else {
        Store.setFeePaid(app.serial, true, remaining);
        remaining = 0;
      }
    });
    
    UI.toast('ok', 'تم التحديث', 'حُفظ المبلغ المستلَم لـ ' + user);
    renderFinance();
  }

  /* ======================= الإعدادات ======================= */
  function renderSettings() {
    var s = Store.settings();
    /* right-target helper: حقول الإدخال تأخذ value، والعناصر الأخرى (div/span)
       تأخذ textContent — سابقاً كان .value على <div> لا يُظهر أي رقم أبداً. */
    var set = function (id, v) {
      var e = document.getElementById(id); if (!e) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)) e.value = v;
      else e.textContent = v;
    };
    set('set-attempts', s.attemptLimit); set('set-days', s.validityDays);
    set('set-hours', s.holdHours); set('set-fee', s.formFee);
    var auto = document.getElementById('set-auto');
    if (auto) auto.checked = s.autoReleaseEnabled !== false;
    var db = Store.db();
    set('db-jobs', db.jobs.length); set('db-apps', db.applicants.length);
    set('db-attempts', db.attempts.length); set('db-audit', db.audit.length);
    var backups = Store.listBackupMeta();
    set('db-backups', backups.length);
    var vb = document.getElementById('set-verify-base');
    if (vb) vb.textContent = CFG.verifyBase;

    // الأزرار تُربط هنا أيضاً (ربط آمن لا يتكرر) لتبقى تعمل بعد أي إعادة رسم
    bindBackupActions();

    // عرض حالة الجدولة التلقائية + آخر نسخة
    var DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    var scheduleStatus = document.getElementById('schedule-status');
    if (scheduleStatus) {
      var schedule = Store.getAutoSchedule();
      var html = '';
      if (schedule) {
        var selectedDays = schedule.days.map(function (d) { return DAY_NAMES[d]; }).join('، ');
        html = '<b style="color:var(--ok)">✓ مفعّل</b> — ' + UI.esc(selectedDays) + ' الساعة ' + UI.esc(schedule.time);
        var lastRun = Store.lastAutoRun();
        html += '<br>آخر تنفيذ تلقائي: ' + (lastRun ? UI.esc(String(lastRun).replace('T', ' الساعة ')) : 'لم يُنفَّذ بعد');
      } else {
        html = '<span style="color:var(--muted)">لم يتم تفعيل الجدولة بعد</span>';
      }
      var lastAuto = backups.filter(function (b) { return b.auto; }).slice(-1)[0];
      if (lastAuto) html += '<br>آخر نسخة تلقائية محفوظة: ' + UI.esc(lastAuto.name) + ' — ' + UI.esc(Store.fmtDateTime(lastAuto.createdAt));
      scheduleStatus.innerHTML = html;
    }

    // إخفاء أزرار الجدولة إن لم تكن مفعّلة (تعديل/إيقاف/نفّذ الآن)
    var hasSchedule = !!Store.getAutoSchedule();
    ['btn-edit-schedule', 'btn-disable-schedule', 'btn-run-auto-backup'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.classList.toggle('hidden', !hasSchedule);
    });
  }

  /* ======================= الأحداث العامة ======================= */

  /* ربط idempotent: لا يربط الحدث على العنصر إلا مرة واحدة مهما تكرّرت
     إعادة الرسم — هكذا تبقى الأزرار تعمل بعد أي تحديث للواجهة بدون
     أن تُنفَّذ مرتين (وهو سبب تعطّل أزرار النسخ الاحتياطي سابقاً). */
  function bindOnce(el, ev, fn) {
    if (!el) return false;
    var flag = 'brcBound_' + ev;
    if (el[flag]) return false;
    el[flag] = true;
    el.addEventListener(ev, fn);
    return true;
  }

  function bindToolbars() {
    var bindInput = function (id, obj, key, render) {
      var e = document.getElementById(id);
      if (!e) return;
      var ev = (e.tagName === 'SELECT' || e.type === 'date') ? 'change' : 'input';
      e.addEventListener(ev, UI.debounce(function () { obj[key] = e.value; render(); }, 200));
    };
    bindInput('jq', state.j, 'q', renderJobs);
    bindInput('j-status', state.j, 'status', renderJobs);
    bindInput('j-region', state.j, 'region', renderJobs);
    bindInput('j-shift', state.j, 'shift', renderJobs);
    bindInput('aq', state.a, 'q', renderApplicants);
    bindInput('a-status', state.a, 'status', renderApplicants);
    bindInput('a-user', state.a, 'user', renderApplicants);
    bindInput('log-q', state.log, 'q', renderAudit);
    bindInput('log-user', state.log, 'user', renderAudit);
    bindInput('log-role', state.log, 'role', renderAudit);
    bindInput('log-from', state.log, 'from', renderAudit);
    bindInput('log-to', state.log, 'to', renderAudit);
    bindInput('fin-from', state.fin, 'from', renderFinance);
    bindInput('fin-to', state.fin, 'to', renderFinance);

    var finReset = document.getElementById('btn-fin-reset');
    if (finReset) finReset.addEventListener('click', function () {
      state.fin = { from: '', to: '' };
      var a = document.getElementById('fin-from'), b = document.getElementById('fin-to');
      if (a) a.value = ''; if (b) b.value = '';
      renderFinance();
    });

    // البحث السريع بالكود (وظيفة أو استمارة)
    var qc = document.getElementById('quick-code-form');
    if (qc) qc.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (document.getElementById('quick-code').value || '').trim().toUpperCase();
      if (!v) return;
      if (v.indexOf('BRC-NO') === 0 || /^\d{6}$/.test(v)) {
        var serial = v.indexOf('BRC-NO') === 0 ? v : 'BRC-NO-' + v;
        if (Store.getApplicant(serial)) { attemptsModal(serial); return; }
      }
      var job = Store.getJob(v);
      if (job) { quickJobModal(job.code); return; }
      var list = Store.listJobs({ q: v });
      if (list.length === 1) { quickJobModal(list[0].code); return; }
      state.j.q = v; var jq = document.getElementById('jq'); if (jq) jq.value = v;
      setView('jobs'); renderJobs();
      UI.toast(list.length ? 'info' : 'warn', list.length ? 'نتائج البحث' : 'لا نتائج', list.length + ' وظيفة مطابقة لـ ' + v);
    });

    // الإعدادات
    var sf = document.getElementById('settings-form');
    if (sf) sf.addEventListener('submit', function (e) {
      e.preventDefault();
      var patch = {
        attemptLimit: Number(document.getElementById('set-attempts').value),
        validityDays: Number(document.getElementById('set-days').value),
        holdHours: Number(document.getElementById('set-hours').value),
        formFee: Number(document.getElementById('set-fee').value),
        autoReleaseEnabled: document.getElementById('set-auto').checked
      };
      Store.updateSettings(patch);
      UI.toast('ok', 'حُفظت الإعدادات', 'طُبّقت القواعد الجديدة على النظام.');
    });
  }

  function quickJobModal(code) {
    var j = Store.getJob(code);
    if (!j) return;
    var attempts = Store.db().attempts.filter(function (t) { return t.jobCode === code; });
    var body = '<div class="data-grid mb-3">' +
      '<div class="data-item"><div class="k">الحالة</div><div class="v">' + CFG.jobStatus[j.status].ar + '</div></div>' +
      '<div class="data-item"><div class="k">المنطقة</div><div class="v">' + UI.esc(j.region) + '</div></div>' +
      '<div class="data-item"><div class="k">الأجر</div><div class="v">' + Store.money(j.salaryMin) + ' - ' + Store.money(j.salaryMax) + '</div></div>' +
      '<div class="data-item"><div class="k">الدوام</div><div class="v">' + UI.esc(j.shift) + '</div></div>' +
      '<div class="data-item"><div class="k">صاحب العمل (داخلي)</div><div class="v">' + UI.esc(j.employer.name) + '</div></div>' +
      '<div class="data-item"><div class="k">هاتفه (داخلي)</div><div class="v mono" dir="ltr">' + UI.esc(j.employer.phone) + '</div></div>' +
      '<div class="data-item" style="grid-column:1/-1"><div class="k">العنوان (داخلي)</div><div class="v">' + UI.esc(j.employer.address) + '</div></div>' +
      '<div class="data-item" style="grid-column:1/-1"><div class="k">مكان المقابلة</div><div class="v">' + UI.esc(j.interviewLocation) + '</div></div>' +
      '</div>' +
      (j.status === 'reserved' && j.holdExpiresAt
        ? '<div class="panel" style="background:#fdf1d8;border-color:#f0d9a3"><div class="panel-body" style="padding:12px 15px">' +
          '<p class="mb-0 small">' + UI.ic('hourglass') + ' محجوزة للاستمارة <b class="mono">' + UI.esc(j.reservedBy) + '</b> — ' + UI.holdHtml(j.holdExpiresAt) + '</p></div></div>' : '') +
      '<div class="table-wrap mt-3"><div class="table-scroll"><table class="data" style="min-width:520px">' +
      '<thead><tr><th>الاستمارة</th><th>المحاولة</th><th>الحالة</th><th>وقت الاختيار</th></tr></thead><tbody>' +
      (attempts.length ? attempts.map(function (t) {
        return '<tr><td class="mono">' + UI.esc(t.serial) + '</td><td>#' + t.no + '</td><td>' + UI.slotBadge(t.slotStatus) + '</td>' +
          '<td class="tiny" dir="ltr">' + Store.fmtDateTime(t.selectedAt) + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="table-empty">لا محاولات على هذه الوظيفة</td></tr>') +
      '</tbody></table></div></div>';

    UI.modal({
      title: j.title + ' — ' + j.code, subtitle: 'بطاقة الوظيفة الداخلية (تظهر للموظفين فقط)', wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>' +
        '<button class="btn btn-lapis" id="q-edit">' + UI.ic('edit') + ' تعديل</button>' +
        (j.status === 'reserved' ? '<button class="btn btn-warn" id="q-hold">إدارة الحجز</button>' :
          (j.status === 'available' ? '<button class="btn btn-gold" id="q-assign">' + UI.ic('user-plus') + ' ترشيح</button>'
            : '<button class="btn btn-ok" id="q-reopen">إعادة تفعيل</button>')),
      onMount: function (box, close) {
        box.querySelector('#q-edit').addEventListener('click', function () { close(); jobModal(code); });
        var a = box.querySelector('#q-assign'); if (a) a.addEventListener('click', function () { close(); pickApplicantModal(code); });
        var h = box.querySelector('#q-hold'); if (h) h.addEventListener('click', function () { close(); openHoldsModal(code); });
        var r = box.querySelector('#q-reopen'); if (r) r.addEventListener('click', function () {
          Store.setJobStatus(code, 'available', 'إعادة تفعيل'); close(); UI.toast('ok', 'أُعيد التفعيل', code);
        });
      }
    });
  }

  function bindActions() {
    var nj = document.getElementById('btn-new-job');
    if (nj) nj.addEventListener('click', function () { jobModal(null); });
    var na = document.getElementById('btn-new-app');
    if (na) na.addEventListener('click', newApplicantModal);
    var rm = document.getElementById('btn-run-maintenance');
    if (rm) rm.addEventListener('click', function () {
      var actions = Store.runMaintenance();
      UI.toast(actions.length ? 'warn' : 'ok', actions.length ? 'نُفّذت إجراءات تلقائية' : 'لا إجراءات معلّقة',
        actions.length ? actions.length + ' عملية (إفراج/انتهاء صلاحية)' : 'كل الحجوزات سارية.');
      renderCurrent();
    });
    var ma = document.getElementById('btn-maintenance');
    if (ma) ma.addEventListener('click', function () {
      var actions = Store.runMaintenance();
      UI.toast('info', 'قواعد الحجز التلقائي', actions.length ? 'نُفّذت ' + actions.length + ' عملية.' : 'لا إجراءات مطلوبة الآن.');
      renderCurrent();
    });

    var ex = document.getElementById('btn-export');
    if (ex) ex.addEventListener('click', function () {
      UI.download('brc-backup-' + Store.fmtDate(new Date()) + '.json', Store.exportJson(), 'application/json');
      UI.toast('ok', 'تصدير النسخة', 'حُفظ ملف JSON يحتوي كل البيانات والسجلات.');
    });
    var exEncrypted = document.getElementById('btn-export-encrypted');
    if (exEncrypted) exEncrypted.addEventListener('click', function () {
      var p1 = window.prompt('اكتب كلمة مرور قوية للنسخة المشفّرة:');
      if (!p1 || p1.length < 10) { UI.toast('warn', 'كلمة المرور قصيرة', 'استخدم 10 أحرف أو أكثر واحفظها خارج الموقع.'); return; }
      var p2 = window.prompt('أعد كتابة كلمة المرور:');
      if (p1 !== p2) { UI.toast('err', 'لم تتطابق كلمتا المرور', 'لم يتم إنشاء النسخة.'); return; }
      exEncrypted.disabled = true;
      encryptedBackup(Store.exportJson(), p1).then(function (data) {
        UI.download('BRC-backup-' + Store.fmtDate(new Date()) + '.brc.enc.json', data, 'application/json');
        UI.toast('ok', 'تم إنشاء النسخة المشفّرة', 'احفظ الملف وكلمة المرور في مكانين آمنين.');
      }).catch(function (e) { UI.toast('err', 'فشل التشفير', e.message); }).then(function () { exEncrypted.disabled = false; });
    });

    var im = document.getElementById('btn-import');
    var imf = document.getElementById('import-file');
    if (im && imf) {
      im.addEventListener('click', function () { imf.click(); });
      imf.addEventListener('change', function () {
        var f = imf.files[0]; if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          try { Store.importJson(String(r.result)); UI.toast('ok', 'تم الاستيراد', 'استُعيدت البيانات من النسخة الاحتياطية.'); renderCurrent(); }
          catch (e) { UI.toast('err', 'فشل الاستيراد', 'الملف غير صالح: ' + e.message); }
        };
        r.readAsText(f);
      });
    }
    var rs = document.getElementById('btn-reset');
    if (rs) rs.addEventListener('click', function () {
      UI.confirm({
        title: 'إعادة ضبط البيانات', danger: true, confirmText: 'حذف وإعادة التهيئة',
        message: 'سيتم حذف كل الوظائف والاستمارات والسجلات المحلية وإعادة البيانات التجريبية. لا يمكن التراجع.'
      }).then(function (ok) {
        if (!ok) return;
        Store.resetDemo(); renderCurrent(); snapshotStatuses();
        UI.toast('warn', 'أُعيد الضبط', 'النظام يعمل على البيانات التجريبية.');
      });
    });

    var ea = document.getElementById('btn-export-audit');
    if (ea) ea.addEventListener('click', function () {
      var rows = Store.listAudit(state.log);
      var csv = 'ts,user,name,role,ip,action,entity,entityId,details\n' + rows.map(function (l) {
        return [Store.fmtDateTime(l.ts), l.user, l.name, l.role, l.ip, l.action, l.entity, l.entityId, (l.details || '').replace(/"/g, '""')]
          .map(function (x) { return '"' + String(x == null ? '' : x) + '"'; }).join(',');
      }).join('\n');
      UI.download('brc-audit-' + Store.fmtDate(new Date()) + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
      UI.toast('ok', 'تصدير السجل', rows.length + ' سجل بصيغة CSV.');
    });

    // أزرار النسخ الاحتياطي والجدولة (تُربط بطريقة آمنة لا تتكرر)
    bindBackupActions();
  }

  /* ======================= النسخ الاحتياطي والجدولة =======================
   *  تُستدعى من bindActions() عند الإقلاع ومن renderSettings() بعد كل
   *  إعادة رسم — bindOnce يضمن ألا يُربط الزر مرتين (لا نوافذ مكرّرة). */
  function bindBackupActions() {
    bindOnce(document.getElementById('btn-schedule-backup'), 'click', scheduleBackupModal);
    bindOnce(document.getElementById('btn-edit-schedule'), 'click', scheduleBackupModal);
    bindOnce(document.getElementById('btn-view-backups'), 'click', viewBackupsModal);

    bindOnce(document.getElementById('btn-quick-backup'), 'click', function () {
      var name = 'نسخة سريعة - ' + Store.fmtDateTime(new Date());
      var backup = Store.saveScheduledBackup(name, null);
      if (backup) {
        UI.toast('ok', 'تم الحفظ', 'حُفظت النسخة الاحتياطية: ' + name + ' (' + (backup.size / 1024).toFixed(1) + ' ك.ب)');
      } else {
        UI.toast('err', 'فشل الحفظ', Store.lastBackupErrorMessage() || 'لم يتم حفظ النسخة الاحتياطية');
      }
      renderSettings();
    });

    bindOnce(document.getElementById('btn-run-auto-backup'), 'click', function () {
      var backup = Store.saveScheduledBackup('نسخة تلقائية يدوية - ' + Store.fmtDateTime(new Date()), null, { auto: true });
      if (backup) UI.toast('ok', 'تم التنفيذ', 'أُنشئت النسخة التلقائية: ' + backup.name);
      else UI.toast('err', 'فشل التنفيذ', Store.lastBackupErrorMessage() || 'تعذّر إنشاء النسخة');
      renderSettings();
    });

    bindOnce(document.getElementById('btn-disable-schedule'), 'click', function () {
      UI.confirm({
        title: 'إيقاف الجدولة',
        danger: true,
        confirmText: 'إيقاف',
        message: 'سيتم إيقاف النسخ الاحتياطي التلقائي المجدول. النسخ المحفوظة تبقى كما هي. هل أنت متأكد؟'
      }).then(function (ok) {
        if (!ok) return;
        Store.clearAutoSchedule();
        UI.toast('ok', 'تم الإيقاف', 'أُوقفت الجدولة التلقائية');
        renderSettings();
      });
    });
  }

  /* نافذة جدولة النسخ الاحتياطي */
  function scheduleBackupModal() {
    var schedule = Store.getAutoSchedule();

    var days = [
      { id: 0, name: 'الأحد' },
      { id: 1, name: 'الإثنين' },
      { id: 2, name: 'الثلاثاء' },
      { id: 3, name: 'الأربعاء' },
      { id: 4, name: 'الخميس' },
      { id: 5, name: 'الجمعة' },
      { id: 6, name: 'السبت' }
    ];

    var body = '<form id="backup-form">' +
      '<div class="field mb-2">' +
      '<label for="backup-name">اسم النسخة الاحتياطية *</label>' +
      '<input type="text" id="backup-name" required placeholder="مثال: نسخة نهاية الشهر">' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label>نطاق البيانات</label>' +
      '<div class="flex" style="gap:8px">' +
      '<label style="display:flex;align-items:center;gap:4px"><input type="radio" name="backup-range" value="all" checked style="width:auto"> كل البيانات</label>' +
      '<label style="display:flex;align-items:center;gap:4px"><input type="radio" name="backup-range" value="custom" style="width:auto"> نطاق مخصص</label>' +
      '</div>' +
      '</div>' +
      '<div id="custom-range" style="display:none">' +
      '<div class="flex" style="gap:8px">' +
      '<div class="field" style="flex:1"><label for="backup-from">من تاريخ</label><input type="date" id="backup-from"></div>' +
      '<div class="field" style="flex:1"><label for="backup-to">إلى تاريخ</label><input type="date" id="backup-to"></div>' +
      '</div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label>الجدولة التلقائية</label>' +
      '<div class="flex" style="gap:8px;flex-wrap:wrap">' +
      '<label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="backup-auto" style="width:auto" ' + (schedule ? 'checked' : '') + '> تفعيل الجدولة التلقائية</label>' +
      '</div>' +
      '</div>' +
      '<div id="schedule-options" style="display:' + (schedule ? 'block' : 'none') + '">' +
      '<div class="field mb-2">' +
      '<label>أيام الأسبوع</label>' +
      '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
      days.map(function(day) {
        var checked = schedule && schedule.days && schedule.days.indexOf(day.id) >= 0 ? 'checked' : '';
        return '<label style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:#f4f6fb;border-radius:6px">' +
          '<input type="checkbox" name="backup-days" value="' + day.id + '" style="width:auto" ' + checked + '> ' + day.name + '</label>';
      }).join('') +
      '</div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label for="backup-time">وقت النسخ</label>' +
      '<input type="time" id="backup-time" value="' + (schedule && schedule.time ? schedule.time : '23:00') + '" style="width:150px">' +
      '</div>' +
      '<div class="tiny muted mt-2">' +
      '<b>اقتراح:</b> يمكنك رفع النسخ الاحتياطية إلى Google Drive أو Dropbox يدوياً للحفاظ عليها.' +
      '</div>' +
      '</div>' +
      '</form>';

    UI.modal({
      title: 'جدولة النسخ الاحتياطي',
      subtitle: 'احفظ نسخة احتياطية من البيانات مع جدولة تلقائية',
      body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-gold" id="backup-save">' + UI.ic('check') + ' حفظ</button>',
      onMount: function (box, close) {
        var radios = box.querySelectorAll('input[name="backup-range"]');
        var customRange = box.querySelector('#custom-range');
        var autoCheck = box.querySelector('#backup-auto');
        var scheduleOptions = box.querySelector('#schedule-options');
        
        radios.forEach(function(radio) {
          radio.addEventListener('change', function() {
            customRange.style.display = this.value === 'custom' ? 'block' : 'none';
          });
        });

        autoCheck.addEventListener('change', function() {
          scheduleOptions.style.display = this.checked ? 'block' : 'none';
        });

        box.querySelector('#backup-save').addEventListener('click', function () {
          var name = box.querySelector('#backup-name').value.trim();
          if (!name) {
            UI.toast('err', 'اسم مطلوب', 'يرجى إدخال اسم للنسخة الاحتياطية');
            return;
          }

          var rangeType = box.querySelector('input[name="backup-range"]:checked').value;
          var dateRange = null;
          
          if (rangeType === 'custom') {
            var from = box.querySelector('#backup-from').value;
            var to = box.querySelector('#backup-to').value;
            if (!from || !to) {
              UI.toast('err', 'تواريخ مطلوبة', 'يرجى تحديد نطاق التاريخ');
              return;
            }
            dateRange = { from: from, to: to };
          }

          var backup = Store.saveScheduledBackup(name, dateRange);
          if (!backup) {
            UI.toast('err', 'فشل الحفظ', Store.lastBackupErrorMessage() || 'لم يتم حفظ النسخة الاحتياطية');
            return;
          }

          // حفظ الجدولة التلقائية عبر المتجر (مصدر واحد للحقيقة)
          if (autoCheck.checked) {
            var selectedDays = [];
            box.querySelectorAll('input[name="backup-days"]:checked').forEach(function (cb) {
              selectedDays.push(Number(cb.value));
            });
            var time = box.querySelector('#backup-time').value || '23:00';

            if (selectedDays.length === 0) {
              UI.toast('warn', 'حُفظت النسخة فقط', 'اختر يوماً واحداً على الأقل لتفعيل الجدولة التلقائية');
            } else if (Store.saveAutoSchedule(selectedDays, time)) {
              var DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
              UI.toast('ok', 'تم الحفظ', 'حُفظت النسخة وتفعّلت الجدولة: ' +
                selectedDays.map(function (d) { return DAY_NAMES[d]; }).join('، ') + ' الساعة ' + time);
            } else {
              UI.toast('err', 'حُفظت النسخة فقط', Store.lastBackupErrorMessage() || 'تعذّر حفظ الجدولة');
            }
          } else {
            UI.toast('ok', 'تم الحفظ', 'حُفظت النسخة الاحتياطية: ' + backup.name);
          }

          renderSettings();
          close();
        });
      }
    });
  }

  /* نافذة عرض النسخ الاحتياطية */
  function viewBackupsModal() {
    var backups = Store.listBackupMeta().slice().reverse();   // الأحدث أولاً

    var body = '<div class="table-wrap"><div class="table-scroll"><table class="data" style="min-width:720px">' +
      '<thead><tr><th>الاسم</th><th>تاريخ الإنشاء</th><th>النطاق</th><th>الحجم</th><th>إجراءات</th></tr></thead>' +
      '<tbody>' +
      (backups.length === 0 ? '<tr><td colspan="5" class="table-empty">لا توجد نسخ احتياطية</td></tr>' :
        backups.map(function (b) {
          var tags = (b.auto ? ' <span class="badge ok">تلقائية</span>' : '') +
                     (b.partial ? ' <span class="badge warn">نطاق مخصص</span>' : '');
          return '<tr>' +
            '<td><b>' + UI.esc(b.name) + '</b>' + tags + '</td>' +
            '<td class="tiny">' + UI.esc(Store.fmtDateTime(b.createdAt)) + '</td>' +
            '<td class="tiny">' + (b.dateRange ? UI.esc(b.dateRange.from + ' إلى ' + b.dateRange.to) : 'كل البيانات') +
              (b.records ? '<br><span class="muted">' + b.records.applicants + ' استمارة · ' + b.records.audit + ' سجل</span>' : '') + '</td>' +
            '<td class="tiny">' + ((b.size || 0) / 1024).toFixed(1) + ' ك.ب</td>' +
            '<td><div class="cell-actions">' +
            '<button class="btn btn-outline btn-sm" data-backup-export="' + b.id + '">' + UI.ic('download') + ' تصدير</button>' +
            '<button class="btn btn-ok btn-sm" data-backup-restore="' + b.id + '">' + UI.ic('refresh') + ' استعادة</button>' +
            '<button class="btn btn-danger btn-sm" data-backup-delete="' + b.id + '" aria-label="حذف النسخة">' + UI.ic('trash') + '</button>' +
            '</div></td></tr>';
        }).join('')) +
      '</tbody></table></div></div>';

    UI.modal({
      title: 'النسخ الاحتياطية',
      subtitle: backups.length + ' نسخة احتياطية (يُحتفظ بآخر 20 نسخة في المتصفح)',
      wide: true,
      body: body,
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        box.querySelectorAll('[data-backup-export]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-backup-export');
            var data = Store.exportScheduledBackup(id);
            if (data) {
              UI.download('brc-backup-' + Store.fmtDate(new Date()) + '.json', data, 'application/json');
              UI.toast('ok', 'تم التصدير', 'حُفظ ملف النسخة الاحتياطية');
            } else {
              UI.toast('err', 'فشل التصدير', 'النسخة غير موجودة أو لا تحتوي بيانات');
            }
          });
        });

        box.querySelectorAll('[data-backup-restore]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-backup-restore');
            var meta = Store.listBackupMeta().filter(function (b) { return b.id === id; })[0] || {};
            UI.confirm({
              title: 'استعادة النسخة الاحتياطية',
              danger: true,
              confirmText: 'استعادة',
              message: meta.partial
                ? 'هذه نسخة بنطاق مخصص: ستُدمَج استماراتها وسجلاتها مع البيانات الحالية (لن يُحذف شيء). تُحفظ نسخة أمان تلقائياً قبل الاستعادة.'
                : 'سيتم استبدال البيانات الحالية ببيانات النسخة «' + (meta.name || '') + '». تُحفظ نسخة أمان تلقائياً قبل الاستعادة. هل أنت متأكد؟'
            }).then(function (ok) {
              if (!ok) return;
              if (Store.restoreScheduledBackup(id)) {
                UI.toast('ok', 'تمت الاستعادة', 'استُعيدت البيانات بنجاح');
                snapshotStatuses();
                renderCurrent();
                close();
              } else {
                UI.toast('err', 'فشل الاستعادة', Store.lastBackupErrorMessage() || 'لم يتم استعادة البيانات');
              }
            });
          });
        });

        box.querySelectorAll('[data-backup-delete]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var id = btn.getAttribute('data-backup-delete');
            UI.confirm({
              title: 'حذف النسخة الاحتياطية',
              danger: true,
              confirmText: 'حذف',
              message: 'سيتم حذف النسخة الاحتياطية نهائياً. هل أنت متأكد؟'
            }).then(function(ok) {
              if (ok) {
                if (Store.deleteScheduledBackup(id)) {
                  UI.toast('ok', 'تم الحذف', 'حُذفت النسخة الاحتياطية');
                  close();
                  renderSettings();
                  viewBackupsModal(); // إعادة فتح النافذة بالقائمة المحدّثة
                } else {
                  UI.toast('err', 'فشل الحذف', 'لم يتم حذف النسخة الاحتياطية');
                }
              }
            });
          });
        });
      }
    });
  }

  /* إصدار استمارة جديدة للباحث */
  function newApplicantModal() {
    var regionsList = CFG.regions.map(function (r) { return '<option>' + UI.esc(r) + '</option>'; }).join('');
    var body = '<form id="app-form" class="grid grid-2" style="gap:14px">' +
      '<div class="field"><label for="n-name">الاسم الكامل *</label><input type="text" id="n-name" required></div>' +
      '<div class="field"><label for="n-phone">الهاتف *</label><input type="tel" id="n-phone" required dir="ltr" placeholder="07XXXXXXXXX"></div>' +
      '<div class="field"><label for="n-dob">تاريخ الميلاد</label><input type="date" id="n-dob"></div>' +
      '<div class="field"><label for="n-gender">الجنس</label><select id="n-gender"><option>ذكر</option><option>أنثى</option></select></div>' +
      '<div class="field"><label for="n-region">منطقة السكن</label><select id="n-region">' + regionsList + '</select></div>' +
      '<div class="field"><label for="n-fee">رسم الاستمارة (د.ع)</label><input type="number" id="n-fee" value="' + Store.settings().formFee + '" step="500"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="n-address">العنوان التفصيلي</label><input type="text" id="n-address"></div>' +
      '<label class="flex" style="grid-column:1/-1;align-items:center;gap:9px;font-weight:700;font-size:.9rem">' +
        '<input type="checkbox" id="n-paid" style="width:auto" checked> تم استلام رسم الاستمارة نقداً</label>' +
      '</form>' +
      '<div class="panel mt-2" style="background:#fdf9ee;border-color:var(--line)"><div class="panel-body" style="padding:12px 15px">' +
        '<p class="mb-0 small">' + UI.ic('file') + ' سيُصدر النظام رقماً تسلسلياً فورياً، وتُمنح الاستمارة ' +
        Store.settings().validityDays + ' يوماً و' + Store.settings().attemptLimit + ' محاولات.</p></div></div>';

    UI.modal({
      title: 'إصدار استمارة جديدة', subtitle: 'BRC-NO — تسلسل تلقائي', wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-gold" id="n-save">' + UI.ic('check') + ' إصدار وطباعة</button>',
      onMount: function (box, close) {
        box.querySelector('#n-save').addEventListener('click', function () {
          var f = box.querySelector('#app-form');
          if (!f.reportValidity()) return;
          var app = Store.createApplicant({
            fullName: box.querySelector('#n-name').value.trim(),
            phone: box.querySelector('#n-phone').value.trim(),
            dob: box.querySelector('#n-dob').value,
            gender: box.querySelector('#n-gender').value,
            address: box.querySelector('#n-address').value.trim() || box.querySelector('#n-region').value,
            fee: Number(box.querySelector('#n-fee').value),
            feePaid: box.querySelector('#n-paid').checked,
            notes: 'إصدار مباشر من الموظف'
          });
          close();
          UI.toast('ok', 'صدرت الاستمارة', app.serial + ' — ' + app.fullName);
          attemptsModal(app.serial);
        });
      }
    });
  }

  /* محرّك النسخ الاحتياطي التلقائي موحّد في المتجر (Store.checkAutoBackup):
     نسخة واحدة لكل خانة زمنية (يوم + وقت) مع التقاط الفائت في نفس اليوم.
     يُستدعى عند الإقلاع وكل 30 ثانية داخل tick() — فلا حاجة لمؤقّت منفصل هنا
     (المؤقّت القديم كان يعمل فقط ضمن ±5 دقائق من الوقت المحدّد ولا يلتقط
     النسخة الفائتة، ولهذا كان يبدو أن الجدولة «لا تعمل»). */

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
