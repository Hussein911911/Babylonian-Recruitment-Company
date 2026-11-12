/* HRC staff dashboard; official Auth and company decisions remain authoritative. */
(function (root) {
  'use strict';
  var CFG = root.HRC_CONFIG, Store = root.HRCStore, UI = root.HRCUI, V = root.HRCVoucher;
  if (!document.getElementById('app-shell')) return;

  var lastSessionKey = null, reportTimer=null,financeTicket=0;


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
    j: { q: '', status: 'all', governorate: 'all', shift: 'all' },
    a: { q: '', status: 'all', user: 'all' },
    log: { q: '', user: 'all', role: 'all', action: 'all', entity: 'all', from: '', to: '', sort: 'newest' },
    logPage: 1, logPageSize: 25,
    fin: { from: '', to: '' },
    lastStatuses: {}
  };

  /* ======================= التهيئة ======================= */
  function init() {
    Store.init();
    /* حالة السحابة تُعرض دائماً: على شاشة الدخول قبل الدخول، وفي أعلى المنظومة بعده */
    cloudBanner(Store.cloudStatus());
    cloudLoginNote(Store.cloudStatus());
    if (Store.onCloudStatus) Store.onCloudStatus(function (st) {
      cloudBanner(st); cloudLoginNote(st);
    });
    Store.runMaintenance();
    UI.startCountdowns();
    fillStatic();
    bindLogin();
    bindNav();
    bindToolbars();
    bindActions();
    bindArabicDates();
    bindSidebar();
    document.addEventListener('hrc:notification-open', function (e) {
      if (!Store.currentUser()) return;
      var n = e.detail || {};
      // افتح القرار نفسه المستخدم في قسم الحجوزات، للشاغر والفرصة المحددين.
      // حالة الإعلان العامة قد تكون متاحة أو مغلقة مع بقاء شواغر بانتظار القرار.
      if (n.view === 'holds' && n.jobCode && n.serial && n.attemptNo) {
        var target = Store.getAttempts(n.serial).find(function (t) {
          return Number(t.no) === Number(n.attemptNo) && t.jobCode === n.jobCode &&
            ['reserved', 'critical', 'hiring'].indexOf(t.slotStatus) >= 0;
        });
        if (!target || !Store.getJob(n.jobCode)) {
          UI.toast('info', 'تحدثت الحالة', 'هذا الحجز لم يعد متاحاً لاتخاذ إجراء.'); return;
        }
        setView('holds'); openHoldsModal(n.jobCode, n.serial, n.attemptNo); return;
      }
      if(n.serial && Store.getApplicant(n.serial)){ attemptsModal(n.serial); return; }
      if (n.jobCode) {
        var job = Store.getJob(n.jobCode);
        state.j = { q: n.jobCode, status: 'all', governorate: 'all', shift: 'all' };
        document.getElementById('jq').value = n.jobCode;
        ['j-status', 'j-governorate', 'j-shift'].forEach(function (id) { document.getElementById(id).value = 'all'; });
        setView('jobs');
      } else if (n.view === 'applicants' && Store.isStaffSession()) {
        /* البطاقات للموظف والمدير (2026-11-11). */
        state.a = { q: n.serial || '', status: 'all', user: 'all' };
        document.getElementById('aq').value = state.a.q;
        document.getElementById('a-status').value = 'all'; document.getElementById('a-user').value = 'all';
        setView('applicants');
      } else setView(n.view === 'settings' && Store.isAdmin() ? 'settings' : 'overview');
    });
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
      if(Store.db().meta.workspace){clearTimeout(reportTimer);reportTimer=setTimeout(function(){Store.cardReport().then(function(){if(state.view==='overview')renderOverview();}).catch(function(){});},750);}
    });
    setInterval(tick, 30000);
    setInterval(renderClock, 1000);
    document.addEventListener('visibilitychange', renderClock);
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
    UI.fillSelect(document.getElementById('j-governorate'), CFG.governorates, 'كل المحافظات');
    UI.fillSelect(document.getElementById('j-shift'), CFG.shifts, 'كل الأوقات');
    // المستخدمون في الفلاتر
    var allUsers = Store.listUsers();
    var userNames = allUsers.map(function (u) { return u.username; });
    UI.fillSelect(document.getElementById('a-user'), userNames, 'كل الموظفين');
    UI.fillSelect(document.getElementById('log-user'), userNames.concat(['system']), 'كل المستخدمين');
    renderUsersTable();
  }

  /* ======================= إدارة الموظفين ======================= */

  /* مفتاح الخدمة المحفوظ في هذا المتصفح (يُدخله المدير مرة واحدة من «ربط السحابة»).
     ⚠️ ليس المسار المفضّل: المفتاح سرّي، وحفظه في المتصفح يعني أن كل جهاز يعمل
     عليه المدير يحتاجه. المسار المفضّل هو الدالة السحابية hrc-staff-admin التي
     تحتفظ بالمفتاح في خوادم Supabase وحدها. */
  function serviceKey() { try { return localStorage.getItem('hrc-service-key') || ''; } catch (e) { return ''; } }

  /* ---------------------------------------------------------------------------
   *  كتابة إدارة الحسابات — بأولوية الأمان:
   *   ① الدالة السحابية: تعمل لأي مدير مُسجَّل سحابياً من أي متصفح بلا أي مفتاح.
   *   ② مفتاح الخدمة المحفوظ هنا: للمشاريع التي لم تُنشر فيها الدالة بعد.
   *   ③ الوضع المحلي: حساب في هذا المتصفح وحده (يُصرَّح بذلك للمدير).
   *  النتيجة تحمل via: 'function' | 'key' | 'local' ليُقال للمدير أين وصل الحساب.
   * ------------------------------------------------------------------------- */
  /* رسالة الدالة تُترجم إلى **خطوة عملية**: أكثر ما يصطدم به المدير أنه داخل
     بحساب محلي (الوضع الانتقالي) — فإدارة الحسابات تحتاج جلسة سحابية، ولا معنى
     أن يبقى يجرّب ويرى «الجلسة مطلوبة» بلا أن يُقال له ما يفعل. */
  function fnAuthHint(code) {
    if (code === 'no_token' || code === 'bad_token') {
      return 'الدخول الحالي محلي (بلا جلسة قاعدة) — اخرج ثم ادخل بحسابك الرسمي (اسم المستخدم السحابي وكلمة مروره) لإدارة الحسابات.';
    }
    if (code === 'no_staff_row') {
      return 'حسابك موجود في Auth لكن بلا سطر في brc.staff — أنشئ السطر من SQL Editor (docs/binding-status.md §3أ) ثم أعد المحاولة.';
    }
    return '';
  }

  function staffWrite(action, payload) {
    var viaFn = Store.staffAdmin
      ? Store.staffAdmin(action, payload)
      : Promise.resolve({ ok: false, code: 'not_deployed' });

    return viaFn.then(function (r) {
      if (r && r.ok) { r.via = 'function'; return r; }

      /* 「لا توجد جلسة سحابية هنا」 ليس رفض صلاحية بل فجوة قدرة: الدالة غير منشورة،
         أو هذا المتصفح داخل محلياً، أو الشبكة ساقطة. في الحالات كلها يجوز السلوك
         بالمسار الاحتياطي (مفتاح الخدمة المحفوظ). أما رفض الدور (not_admin /
         inactive) فلا يُتجاوز — ذاك قرار صلاحية اتخذته القاعدة، ويجب أن يبقى نافذاً.
         ⚠️ 'network' مُدرَج عمداً: انقطاع الشبكة يعني «لم تصل الدعوة» لا «رُفضت»؛
         بلا إدراجه يفشل الإنشاء برسالة إنجليزية من المكتبة ولا يُجرَّب المفتاح. */
      var sessionGap = r && ['not_deployed', 'no_token', 'bad_token', 'no_staff_row', 'network'].indexOf(r.code) >= 0;
      if (!sessionGap) {
        if (r) r.via = 'function';
        return r || { ok: false, error: 'تعذّر تنفيذ الإجراء' };
      }

      var key = serviceKey();
      if (!key) {
        if (r.code === 'not_deployed') {
          /* لا دالة ولا مفتاح: الوضع المحلي المعلوم (يتولّاه المستدعي) */
          return { ok: false, code: 'no_key', via: 'local', error: noChannelMsg(action) };
        }
        /* الدالة موجودة لكن بلا صلاحية هنا: لا نُنشئ حساباً محلياً يبدو ناجحاً */
        var hint = fnAuthHint(r.code);
        r.via = 'function';
        if (hint) r.error = (r.error ? r.error + ' — ' : '') + hint;
        return r;
      }

      var p;
      if (action === 'create') p = Store.createCloudAccount(key, payload);
      else if (action === 'update') p = Store.updateCloudAccount(key, payload);
      else if (action === 'delete') p = Store.deleteCloudAccount(key, payload);
      else if (action === 'set-password') p = Store.setCloudUserPassword(key, payload.authId, payload.password);
      else return Promise.resolve({ ok: false, error: 'إجراء غير معروف' });
      return Promise.resolve(p).then(function (r2) { if (r2) r2.via = 'key'; return r2; });
    });
  }

  /* ماذا نقول للمدير حين لا دالة منشورة ولا مفتاح محفوظ؟ نُسمّي له الخطوتين */
  function noChannelMsg(action) {
    var verb = action === 'delete' ? 'حذف' : (action === 'update' ? 'تعديل' : 'إنشاء');
    return 'لا قناة للكتابة في قاعدة الشركة: انشر الدالة hrc-staff-admin (docs/staff-accounts-edge.md) '
      + 'لتعمل إدارة الحسابات من أي متصفح بلا أي مفتاح، أو أضف مفتاح الخدمة من «ربط السحابة».';
  }

  /* ---------------------------------------------------------------------------
   *  نافذة مفتاح الخدمة — بفحص قبل الحفظ
   *  ---------------------------------------------------------------------------
   *  كان المفتاح يُحفظ كما هو ثم يُكتشف خطؤه عند أول إنشاء موظف برسالة غامضة.
   *  الآن يُفحص فوراً بقراءة سطر واحد من brc.staff، ويُقال للمدير بالعربي:
   *  مفتاح مرفوض / سكيما غير مكشوفة / لا اتصال — مع خيار الحفظ رغم الفشل
   *  (لمن يعرف أن السبب مؤقّت)، فالمفتاح قراره لا قرار الشاشة.
   * ------------------------------------------------------------------------ */
  function cloudKeyModal() {
    var current = serviceKey();
    var body = '<div style="display:grid;gap:14px">' +
      '<p style="margin:0;color:var(--muted);font-size:.9rem">مفتاح الخدمة (Service Role Key) يسمح بإنشاء حسابات الموظفين في Supabase Auth تلقائياً من هنا — بدون ما تفتح Supabase يدوياً. وهو <b>احتياطي</b>: الأفضل نشر الدالة السحابية.</p>' +
      '<div class="field"><label for="svc-key">Service Role Key</label>' +
        '<input type="password" id="svc-key" value="' + UI.esc(current) + '" placeholder="eyJhbGciOiJIUzI1NiIs..." dir="ltr" class="mono" style="font-size:.82rem">' +
      '</div>' +
      '<div id="svc-msg" class="hidden" style="border-radius:10px;padding:10px 14px;font-size:.84rem"></div>' +
      '<div style="background:#fdf1d8;border:1px solid #f0d9a3;border-radius:10px;padding:10px 14px;font-size:.82rem;color:#8a5c05">' +
        '<b>⚠️ تنبيه:</b> هالمفتاح حساس — لا تشاركه مع أحد. يُحفظ في متصفحك فقط (localStorage) ولا يُرسل لأي جهة.' +
      '</div>' +
      '<p style="margin:0;font-size:.82rem;color:var(--muted)">تلاقيه في: Supabase Dashboard → ⚙️ Settings → API Keys → service_role (secret)</p>' +
    '</div>';
    var footer = '<button class="btn btn-outline" data-close>إلغاء</button>' +
      (current ? '<button class="btn btn-danger btn-sm" id="svc-clear">مسح المفتاح</button>' : '') +
      '<button class="btn btn-lapis" id="svc-save">' + UI.ic('check') + ' فحص وحفظ</button>';
    var m = UI.modal({ title: 'ربط السحابة — Service Role Key', body: body, footer: footer });
    if (!m) return;

    var msgEl = m.root.querySelector('#svc-msg');
    function note(tone, text) {
      if (!msgEl) return;
      if (!text) { msgEl.className = 'hidden'; msgEl.innerHTML = ''; return; }
      var pal = tone === 'ok' ? ['#f0fdf4', '#bbf7d0', '#166534']
        : tone === 'err' ? ['#fef2f2', '#fecaca', '#7f1d1d'] : ['#fffbeb', '#fde68a', '#92400e'];
      msgEl.className = '';
      msgEl.setAttribute('style', 'background:' + pal[0] + ';border:1px solid ' + pal[1] + ';color:' + pal[2] +
        ';border-radius:10px;padding:10px 14px;font-size:.84rem');
      msgEl.innerHTML = text;
    }

    function save(key, warn) {
      try { localStorage.setItem('hrc-service-key', key); } catch (e) {}
      UI.toast(warn ? 'warn' : 'ok', warn ? 'حُفظ رغم تعذّر الفحص' : 'تم الحفظ',
        warn ? 'أُنشئ موظف تجريبي للتأكد — وإن فشل فالفحص سيقول السبب.' : 'الآن لما تنشئ موظف جديد يُسجّل في قاعدة الشركة تلقائياً');
      m.close();
    }

    var saveBtn = m.root.querySelector('#svc-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var key = document.getElementById('svc-key').value.trim();
      if (!key) { UI.toast('err', 'خطأ', 'أدخل المفتاح'); return; }
      var label = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = 'جارٍ الفحص…';
      note('warn', 'نتحقق من المفتاح بقراءة سطر واحد من جدول الموظفين…');
      var probe = Store.probeServiceKey ? Store.probeServiceKey(key) : Promise.resolve({ ok: true, unchecked: true });
      Promise.resolve(probe).then(function (r) {
        saveBtn.disabled = false;
        saveBtn.textContent = label;
        if (r && r.ok) { note('ok', '✅ المفتاح صحيح والقاعدة تستجيب — سيُحفظ في هذا المتصفح.'); save(key, false); return; }
        if (r && r.unchecked) { save(key, true); return; }
        note('err', '<b>⚠️ لم ينجح الفحص:</b> ' + UI.esc((r && r.error) || 'سبب غير معروف') +
          '<div style="margin-top:8px"><button class="btn btn-outline btn-sm" id="svc-force">احفظ رغم ذلك</button></div>');
        var force = m.root.querySelector('#svc-force');
        if (force) force.addEventListener('click', function () { save(key, true); });
      });
    });

    var clearBtn = m.root.querySelector('#svc-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      try { localStorage.removeItem('hrc-service-key'); } catch (e) {}
      UI.toast('warn', 'تم المسح', 'لن تُسجَّل الحسابات الجديدة في القاعدة من هذا المتصفح — مسار الدالة السحابية يبقى متاحاً.');
      m.close();
    });
  }

  /* هل القاعدة مُعدَّة ومتّصلة؟ (يُبنى عليه: هل نُحاول المسار السحابي أصلاً) */
  function cloudReady() {
    var st = Store.cloudStatus ? Store.cloudStatus() : null;
    return !!(st && st.configured && (st.state === 'on' || st.state === 'connecting'));
  }

  /* ماذا يفعل المدير حين لا قناة؟ نُعطيه الخطوتين بيده — لا رسالة خطأ تنتهي عنده.
     المسار الأول (الدالة) هو الموصى به، والثاني (المفتاح) مؤقّت ومعلوم الخطورة،
     والثالث (محلي) موجود لكن مكتوب عليه ما هو: يدخل من هذا المتصفح وحده. */
  function channelHelpModal(onLocal) {
    var body = '<div style="display:grid;gap:14px">' +
      '<p style="margin:0">إنشاء حساب يدخل منه الموظف من أي جهاز يحتاج قناة كتابة في قاعدة الشركة. ' +
      'هذه هي الخيارات المتاحة الآن — بالترتيب:</p>' +
      '<div style="border:1px solid #d7e0ef;border-radius:12px;padding:12px 14px">' +
        '<b>① الدالة السحابية <span class="badge ok" style="font-size:.68rem">الموصى به</span></b>' +
        '<p class="tiny muted" style="margin:6px 0 0">تُنشر مرة واحدة على Supabase (Edge Functions → Deploy a new function → الاسم: ' +
        '<span class="mono" dir="ltr">hrc-staff-admin</span>) ثم ينشئ أي مدير الحسابات من أي متصفح <b>بلا أي مفتاح</b>. ' +
        'الخطوات بالتفصيل في <span class="mono" dir="ltr">docs/staff-accounts-edge.md</span>.</p>' +
      '</div>' +
      '<div style="border:1px solid #f0d9a3;background:#fdf1d8;border-radius:12px;padding:12px 14px">' +
        '<b>② مفتاح الخدمة <span class="badge warn" style="font-size:.68rem">مؤقّت</span></b>' +
        '<p class="tiny" style="margin:6px 0 10px;color:#8a5c05">يعمل فوراً بلا أي نشر، لكنه مفتاح حسّاس يُحفظ في متصفحك وحده — ' +
        'استعمله لإكمال الحسابات ثم <b>امسحه</b> من الزر نفسه.</p>' +
        '<button class="btn btn-warn btn-sm" data-chan="key">' + UI.ic('lock') + ' إضافة مفتاح الخدمة الآن</button>' +
      '</div>' +
      '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px">' +
        '<b>③ حساب محلي في هذا المتصفح <span class="badge muted" style="font-size:.68rem">لا يُنصح</span></b>' +
        '<p class="tiny muted" style="margin:6px 0 10px">يُنشأ في هذا المتصفح وحده؛ لا يدخل منه الموظف من جهازه، ' +
        'ويُرفض تماماً لحظة تشغيل <span class="mono" dir="ltr">enforceAuth: true</span>.</p>' +
        '<button class="btn btn-outline btn-sm" data-chan="local">إنشاء محلياً رغم ذلك</button>' +
      '</div>' +
    '</div>';
    var m = UI.modal({ title: 'لا قناة لإنشاء الحسابات بعد', body: body, footer: '<button class="btn btn-outline" data-close>إغلاق</button>' });
    if (!m) return;
    var k = m.root.querySelector('[data-chan="key"]');
    if (k) k.addEventListener('click', function () { m.close(); cloudKeyModal(); });
    var l = m.root.querySelector('[data-chan="local"]');
    if (l) l.addEventListener('click', function () { m.close(); if (onLocal) onLocal(); });
  }


  /* الموظف كما تراه اللوحة (من القاعدة + المحلي) — بالاسم */
  function userRow(username) {
    return Store.listUsers().filter(function (u) { return u.username === username; })[0] || null;
  }

  /* توست موحّد لنتيجة الكتابة السحابية */
  function cloudWriteFailed(cr, action) {
    var verb = action === 'delete' ? 'الحذف' : (action === 'update' ? 'التعديل' : 'الإنشاء');
    if (cr && cr.code === 'no_key') return false;   // يتولّاه المستدعي (وضع محلي)
    UI.toast('err', 'لم يتم ' + verb + ' في القاعدة', (cr && cr.error) || '');
    return true;
  }

  /* تنشيط/تعطيل — ⚠️ القاعدة أولاً: تعطيل الشاشة وحده لا يمنع الدخول إطلاقاً،
     لأن المنع الحقيقي في brc.staff.active (يقرأه is_staff عند كل نداء). */
  function setUserActive(username, nextActive) {
    var t = userRow(username) || {};
    var cloudFirst = (t.source === 'cloud' && cloudReady())
      ? staffWrite('update', {
        id: t.id, username: username, name: t.name, role: t.role, title: t.title, active: nextActive
      })
      : Promise.resolve({ ok: true, skipped: true });

    cloudFirst.then(function (cr) {
      if (!cr.ok && cr.code !== 'no_key') {
        UI.toast('err', 'لم يتغيّر شيء — تعذّر التحديث في القاعدة', cr.error || '');
        return;
      }
      var r = Store.updateUser(username, { active: nextActive });
      if (!r.ok) { UI.toast('err', 'خطأ', r.error); return; }
      if (!cr.ok) {
        /* بلا قناة سحابية: التنشيط محلي — والمنع الحقيقي للدخول يحتاج القاعدة */
        UI.toast('warn', nextActive ? 'نُشّط محلياً' : 'عُطّل محلياً',
          username + ' — لم تصل القاعدة (' + (cr.code === 'no_key' ? 'لا دالة ولا مفتاح' : cr.error) + ')؛ الدخول من الأجهزة الأخرى قد يبقى ممكناً.');
      } else {
        UI.toast('ok', nextActive ? 'تم التنشيط' : 'تم التعطيل',
          nextActive ? username + ' — يستطيع الدخول الآن' : username + ' — مُنع من الدخول فوراً (سطر القاعدة)');
      }
      renderUsersTable();
    });
  }

  /* حذف — القاعدة أولاً (سطر الموظف ثم مستخدم الدخول) ثم الشاشة */
  function removeUser(username) {
    var t = userRow(username) || {};
    var cloudFirst = (t.source === 'cloud' && cloudReady())
      ? staffWrite('delete', { id: t.id, authId: t.authId, username: username })
      : Promise.resolve({ ok: true, skipped: true });

    cloudFirst.then(function (cr) {
      if (!cr.ok && cr.code !== 'no_key') { UI.toast('err', 'لم يُحذف شيء — تعذّر الحذف في القاعدة', cr.error || ''); return; }
      var r = Store.deleteUser(username);
      if (!r.ok) { UI.toast('err', 'خطأ', r.error); return; }
      if (!cr.ok) {
        UI.toast('warn', 'حُذف من هذا المتصفح فقط', username + ' — تعذّر الحذف في القاعدة: ' + (cr.error || ''));
        renderUsersTable();
        return;
      }
      var extra = cr.authDeleted ? ' — حُذف مستخدم الدخول أيضاً'
        : (cr.authKept ? ' — بقي مستخدم الدخول في Auth بلا صلاحيات' : '');
      UI.toast('warn', 'تم الحذف', username + extra);
      renderUsersTable();
    });
  }

  function renderUsersTable() {
    var tbl = document.getElementById('users-table-body');
    if (!tbl) return;
    var users = Store.listUsers();
    var cur = Store.currentUser();
    tbl.innerHTML = users.map(function (u) {
      var isActive = u.active !== false;
      var isMe = cur && cur.username === u.username;
      return '<tr style="opacity:' + (isActive ? '1' : '.55') + '">' +
        '<td><b>' + UI.esc(u.name) + '</b>' + (isMe ? ' <span class="badge ok" style="font-size:.7rem">أنت</span>' : '') + '</td>' +
        '<td><span class="mono" style="background:#eef1f7;padding:3px 8px;border-radius:6px;font-size:.84rem">' + UI.esc(u.username) + '</span>' +
          (u.source === 'cloud' ? ' <span class="badge info" style="font-size:.68rem" title="حساب في قاعدة الشركة — يدخل من أي جهاز">القاعدة</span>' : '') + '</td>' +
        '<td>' + (u.role === 'admin' ? '<span class="badge danger">مدير عام</span>' : '<span class="badge info">موظف</span>') + '</td>' +
        '<td class="tiny muted">' + UI.esc(u.title || '—') + '</td>' +
        '<td>' + (isActive ? '<span class="badge ok">نشط</span>' : '<span class="badge muted">معطّل</span>') + '</td>' +
        '<td><div class="cell-actions">' +
          '<button class="btn btn-outline btn-sm" data-user-edit="' + UI.esc(u.username) + '">' + UI.ic('edit') + ' تعديل</button>' +
          '<button class="btn btn-sm ' + (isActive ? 'btn-warn' : 'btn-ok') + '" data-user-toggle="' + UI.esc(u.username) + '">' +
            (isActive ? UI.ic('x-circle') + ' تعطيل' : UI.ic('check') + ' تنشيط') + '</button>' +
          /* زر الحذف أيقونة فقط — يحتاج اسماً مفهومًا لقارئ الشاشة (وفحص
             الإتاحة tests/audit.mjs يرفض الأزرار الصامتة). */
          (isMe ? '' : '<button class="btn btn-danger btn-sm" data-user-del="' + UI.esc(u.username) + '"' +
            ' aria-label="حذف الموظف ' + UI.esc(u.name) + '" title="حذف نهائي">' + UI.ic('trash') + '</button>') +
        '</div></td></tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted)">لا يوجد موظفين مسجلين</td></tr>';

    /* ربط الأحداث */
    tbl.querySelectorAll('[data-user-edit]').forEach(function (b) {
      b.addEventListener('click', function () { userModal(b.getAttribute('data-user-edit')); });
    });
    tbl.querySelectorAll('[data-user-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var username = b.getAttribute('data-user-toggle');
        var t = userRow(username);
        if (!t) { UI.toast('err', 'خطأ', 'لم يُعثر على الموظف'); return; }
        setUserActive(username, !(t.active !== false));
      });
    });
    tbl.querySelectorAll('[data-user-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var username = b.getAttribute('data-user-del');
        var t = userRow(username) || {};
        var msg = t.source === 'cloud'
          ? 'حذف حساب «' + username + '» نهائياً من قاعدة الشركة؟ سيُمنع من الدخول ويُحذف سطر الموظف ومستخدم الدخول. لا يمكن التراجع.'
          : 'حذف حساب «' + username + '» نهائياً من هذا المتصفح؟ لا يمكن التراجع.';
        UI.confirm({ title: 'حذف الموظف', message: msg, confirmText: 'حذف نهائي', danger: true })
          .then(function (ok) { if (ok) removeUser(username); });
      });
    });
  }

  /* نموذج إضافة/تعديل موظف */
  function userModal(username) {
    var existing = username ? Store.listUsers().filter(function (u) { return u.username === username; })[0] : null;
    var isEdit = !!existing;
    var title = isEdit ? 'تعديل الموظف: ' + existing.name : 'إضافة موظف جديد';
    var cloudEdit = !!(isEdit && existing && existing.source === 'cloud');
    var key = serviceKey();

    var body = '<form id="user-form" style="display:grid;gap:14px">' +
      '<div id="user-form-err" class="hidden" style="background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;border-radius:10px;padding:10px 14px;font-size:.86rem"></div>' +
      '<div class="grid grid-2" style="gap:14px">' +
        '<div class="field"><label for="uf-name">الاسم الكامل *</label><input type="text" id="uf-name" required value="' + (isEdit ? UI.esc(existing.name) : '') + '" placeholder="مثال: أحمد محمد"></div>' +
        '<div class="field"><label for="uf-user">اسم المستخدم *</label><input type="text" id="uf-user" required ' + (isEdit ? 'disabled' : '') + ' value="' + (isEdit ? UI.esc(existing.username) : '') + '" placeholder="مثال: ahmed" dir="ltr" class="mono"></div>' +
      '</div>' +
      '<div class="grid grid-2" style="gap:14px">' +
        '<div class="field"><label for="uf-pass">كلمة المرور *</label><input type="password" id="uf-pass" ' + (isEdit ? '' : 'required') + ' placeholder="' + (isEdit ? 'اتركها فارغة لعدم التغيير' : '6 خانات على الأقل') + '" dir="ltr"></div>' +
        '<div class="field"><label for="uf-title">المسمى الوظيفي</label><input type="text" id="uf-title" value="' + (isEdit ? UI.esc(existing.title || '') : '') + '" placeholder="مثال: موظف توظيف"></div>' +
      '</div>' +
      '<div class="field"><label for="uf-role">الصلاحية</label>' +
        '<select id="uf-role">' +
          '<option value="staff"' + (isEdit && existing.role === 'staff' ? ' selected' : '') + '>موظف — الصلاحيات الأساسية</option>' +
          '<option value="admin"' + (isEdit && existing.role === 'admin' ? ' selected' : '') + '>مدير عام — كل الصلاحيات</option>' +
        '</select>' +
      '</div>' +
      (isEdit ? '<div class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="uf-active" ' + (existing.active !== false ? 'checked' : '') + '><label for="uf-active" style="margin:0;cursor:pointer">الحساب نشط (يستطيع تسجيل الدخول)</label></div>' : '') +
      /* توضيح للمدير: أين سيُنشأ الحساب فعلاً. بلا مفتاح خدمة الحساب محلي فقط
         ولا يدخل صاحبه إلا من هذا المتصفح — وهذا فرق جوهري يجب أن يعرفه الآن
         لا أن يكتشفه الموظف عند أول محاولة دخول. */
      (!isEdit ? '<p class="tiny muted" style="margin:0">' +
        (key
          ? 'يُنشأ الحساب في قاعدة الشركة للدخول من أي جهاز.'
          : 'يُنشأ الحساب في قاعدة الشركة للدخول من أي جهاز؛ يظهر تنبيه إن تعذّر الإنشاء.') +
        '</p>' : (cloudEdit ? '<p class="tiny muted" style="margin:0">التعديلات تُحفظ في حساب الموظف السحابي.</p>' : '')) +
    '</form>';

    var footer = '<button class="btn btn-outline" data-close>إلغاء</button>' +
      '<button class="btn btn-lapis" id="uf-save">' + UI.ic('check') + ' ' + (isEdit ? 'حفظ التعديلات' : 'إنشاء الحساب') + '</button>';

    var m = UI.modal({ title: title, body: body, footer: footer });
    if (!m) return;

    var saveBtn = m.root.querySelector('#uf-save');
    var baseLabel = saveBtn ? saveBtn.textContent : '';
    function busy(on, txt) {
      if (!saveBtn) return;
      saveBtn.disabled = !!on;
      if (txt) saveBtn.textContent = txt;
      else saveBtn.textContent = baseLabel;
    }
    function formErr(msg) {
      var el = m.root.querySelector('#user-form-err');
      if (!el) return;
      if (!msg) { el.className = 'hidden'; el.innerHTML = ''; return; }
      el.className = '';
      el.innerHTML = UI.ic('alert') + ' <span>' + UI.esc(msg) + '</span>';
    }

    if (saveBtn) saveBtn.addEventListener('click', function () {
      var name = document.getElementById('uf-name').value.trim();
      var uname = document.getElementById('uf-user').value.trim();
      var pass = document.getElementById('uf-pass').value;
      var utitle = document.getElementById('uf-title').value.trim();
      var role = document.getElementById('uf-role').value;
      var activeEl = document.getElementById('uf-active');
      var active = activeEl ? activeEl.checked : true;

      formErr('');
      if (!name || !uname) { UI.toast('err', 'خطأ', 'الاسم واسم المستخدم مطلوبة'); return; }
      if (!isEdit && !pass) { UI.toast('err', 'خطأ', 'كلمة المرور مطلوبة للموظف الجديد'); return; }

      /* ============ تعديل موظف قائم ============ */
      if (isEdit) {
        var updateData = { name: name, role: role, title: utitle, active: active };
        if (pass) updateData.password = pass;
        var cloudPatch = (cloudEdit && cloudReady())
          ? staffWrite('update', { id: existing.id, username: username, name: name, role: role, title: utitle, active: active, phone: existing.phone })
          : Promise.resolve({ ok: true, skipped: true });

        busy(true, 'جارٍ الحفظ…');
        cloudPatch.then(function (cr) {
          if (!cr.ok && cr.code !== 'no_key') {
            busy(false, '');
            formErr(cr.error || 'تعذّر الحفظ في القاعدة');
            return;
          }
          var r = Store.updateUser(username, updateData);
          if (!r.ok) { busy(false, ''); formErr(r.error); return; }
          if (!cr.ok) { busy(false, ''); formErr(cr.error || 'تعذّر الحفظ في القاعدة'); return; }
          /* كلمة المرور: الحساب السحابي كلمة مروره في Auth — تُغيَّر عبر الدالة/المفتاح */
          if (pass && cloudEdit && existing.authId) {
            return staffWrite('set-password', { authId: existing.authId, password: pass }).then(function (pr) {
              busy(false, '');
              if (!pr.ok) {
                UI.toast('warn', 'حُفظ التعديل — كلمة المرور لم تتغيّر في القاعدة', pr.error || '');
              } else {
                UI.toast('ok', 'تم التعديل', name + ' — وكلمة مروره صارت الجديدة');
              }
              renderUsersTable(); m.close();
            });
          }
          busy(false, '');
          UI.toast('ok', 'تم التعديل', name);
          renderUsersTable(); m.close();
        });
        return;
      }

      /* ============ إنشاء حساب جديد ============ */
      /* ⚠️ القاعدة أولاً ثم المحلي: لو أُنشئ محلياً ثم فشل في القاعدة، لبقي
         «حساب» يُوعد به المدير والموظف ولا يدخل صاحبه من أي جهاز — وهو بالضبط
         العطل الذي أُصلح هنا (كان يُنشأ في Auth ثم يفشل سطره في brc.staff).
         والقناة المفضّلة هي الدالة السحابية: تعمل من أي متصفح بلا أي مفتاح. */
      function createLocally() {
        var lr = Store.addUser({ username: uname, password: pass, name: name, role: role, title: utitle, active: true });
        if (!lr.ok) { formErr(lr.error); return; }
        UI.toast('warn', 'أُنشئ في هذا المتصفح فقط',
          name + ' — لا يدخل من أي جهاز آخر. لإدخاله في القاعدة: أضف مفتاح الخدمة أو انشر الدالة السحابية ثم أعد الإنشاء بنفس اسم المستخدم.');
        renderUsersTable();
        m.close();
      }

      if (cloudReady()) {
        busy(true, 'جارٍ إنشاء الحساب في القاعدة…');
        staffWrite('create', { username: uname, password: pass, name: name, role: role, title: utitle })
          .then(function (cloudR) {
            busy(false, '');
            /* لا قناة سحابية إطلاقاً (لا دالة منشورة ولا مفتاح): لا نُنشئ حساباً
               محلياً بصمت — كان ذلك يُوهم المدير بأن الموظف أُضيف، بينما صاحبه لا
               يدخل من أي جهاز. نعرض عليه الخطوتين بيده، والإنشاء المحلي يبقى
               اختياراً صريحاً داخل النافذة. */
            if (!cloudR.ok && cloudR.code === 'no_key') {
              /* النموذج يبقى مفتوحاً خلفها: من يضيف المفتاح ثم يُغلق النافذة يجد
                 بياناته كما كتبها فيضغط «إنشاء الحساب» مرة أخرى. */
              channelHelpModal(function () { createLocally(); });
              return;
            }
            if (!cloudR.ok) {
              /* لا حساب محلي: لا نُبقى أثراً لحساب لا يستطيع صاحبه الدخول */
              formErr((cloudR.error || 'تعذّر إنشاء الحساب في القاعدة') +
                (cloudR.partial ? '' : ' — لم يُنشأ أي حساب، صحّح المُدخل وأعد المحاولة'));
              UI.toast('err', 'لم يُنشأ الحساب', cloudR.error || '');
              return;
            }
            var r = Store.addUser({ username: uname, password: pass, name: name, role: role, title: utitle, active: true, cloudLinked: true });
            if (!r.ok) {
              /* نادر: الحساب أُنشئ في القاعدة لكن تعذّر حفظ النسخة المحلية */
              UI.toast('warn', 'أُنشئ في القاعدة', name + ' — الدخول يعمل من أي جهاز (نسخة هذا المتصفح لم تُحفظ: ' + r.error + ')');
            } else {
              UI.toast('ok', 'تم إنشاء الحساب', name + ' — يدخل من أي جهاز باسم: ' + uname + (cloudR.repaired ? ' (أُصلح ربط حساب سابق)' : ''));
            }
            renderUsersTable();
            m.close();
          });
        return;
      }

      /* بلا قاعدة (نسخة مستقلة/بلا إنترنت) */
      createLocally();
    });
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
      function showLoginErr(msg) {
        var el = document.getElementById('login-error');
        if (el) { el.className = 'login-error'; el.innerHTML = '<svg class="ic"><use href="#i-alert"/></svg><span>' + UI.esc(msg) + '</span>'; }
        UI.toast('err', 'فشل الدخول', msg);
      }
      function clearLoginErr() {
        var el = document.getElementById('login-error');
        if (el) { el.className = 'hidden'; el.innerHTML = ''; }
      }
      function localLogin() {
        clearLoginErr();
        var s = Store.login(u, p);
        if (!s) {
          var csLocal = Store.cloudStatus ? Store.cloudStatus() : null;
          if (csLocal && csLocal.enforceAuth && !csLocal.devAccountsActive) {
            showLoginErr('لا اتصال بقاعدة الشركة');
            return;
          }
          showLoginErr('اسم المستخدم أو كلمة المرور غير صحيحة.');
          return;
        }
        clearLoginErr();
        UI.toast('ok', 'مرحباً ' + s.name, s.role === 'admin' ? 'دخلت بصلاحية المدير العام.' : 'دخلت بصلاحية موظف.');
        enterApp();
      }

      var cs = Store.cloudStatus ? Store.cloudStatus() : null;
      /* الإنتاج: Auth وملف الموظف إلزاميان، حتى عند تأخر الاتصال أو فشله.
         الوضع المحلي الانتقالي يبقى محصوراً بما يسمح به إعداد enforceAuth. */
      if (cs && cs.configured && Store.signIn && (cs.state === 'on' || (cs.enforceAuth && cs.willBoot))) { cloudLogin(); return; }
      localLogin();

      function cloudLogin() {
        busy(true, 'جارٍ التحقق…');
        /* يتحقق من الحساب ويجلب بيانات الموظف بالتوازي، ولا يفتح بيانات قديمة. */
        (Store.signInFast || Store.signIn)(u, p).then(function (r) {
          busy(false, '');
          /* ✅ نجح الدخول السحابي */
          if (r && r.ok) {
            clearLoginErr();
            UI.toast('ok', 'مرحباً ' + (r.session ? r.session.name : u),
              r.session && r.session.role === 'admin' ? 'دخلت بصلاحية المدير العام.' : 'دخلت بصلاحية موظف.');
            enterApp();
            return;
          }
          /* ❌ السحابة فشلة — إذا enforceAuth=false نجرب محلي فوراً بدون رسائل مزعجة */
          if (!cs.enforceAuth) {
            var localResult = Store.login(u, p, { forceLocal: true });
            if (localResult) {
              clearLoginErr();
              UI.toast('ok', 'مرحباً ' + localResult.name, localResult.role === 'admin' ? 'دخلت بصلاحية المدير العام.' : 'دخلت بصلاحية موظف.');
              enterApp();
              return;
            }
          }
          /* ❌ لا سحابي ولا محلي — خطأ */
          showLoginErr((r && r.error) || 'اسم المستخدم أو كلمة المرور غير صحيحة.');
        }).catch(function () { busy(false, ''); showLoginErr('تعذّر الاتصال بقاعدة الشركة. تحقق من الإنترنت وأعد المحاولة.'); });
      }
    });
    var logout = document.getElementById('btn-logout');
    if (logout) logout.addEventListener('click', function () {
      Store.logout();
      showLogin();
      UI.toast('info', 'تم تسجيل الخروج', 'أُغلقت الجلسة وسُجّلت في سجل التدقيق.');
    });
  }

  /* Cloud connectivity is always visible, including before login. */
  function cloudBanner(st) {
    var el = document.getElementById('hrc-cloud-banner');
    if (!st || !st.configured) { if (el) el.remove(); return; }

    var tone = null, title = '', body = '';
    if (st.state === 'degraded') {
      tone = 'err';
      title = 'وضع محلي مؤقّت — البيانات غير مشتركة';
      body = (st.error || 'تعذّر الاتصال بالسحابة') + (st.detail ? ' — ' + st.detail : '') +
        ' | أي وظيفة أو بطاقة تُنشأ الآن تبقى في هذا المتصفح وحده.' +
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
      box.innerHTML = '<div id="hrc-cloud-banner" role="status"></div>';
      el = box.firstChild;
      document.body.insertBefore(el, document.body.firstChild);
    }
    /* مضغوط ومطويّ: التفاصيل في سطر واحد قابل للفتح بدل شريط يستهلك أعلى الشاشة */
    el.style.cssText = 'position:sticky;top:0;z-index:9000;font-family:inherit;direction:rtl;' +
      'padding:6px 12px;font-size:.8rem;line-height:1.55;border-bottom:1px solid ' + colors[2] +
      ';background:' + colors[1] + ';color:' + colors[0] + ';display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    var isOpen = (function () { try { return sessionStorage.getItem('brc_banner_open') === '1'; } catch (e) { return false; } })();
    el.innerHTML = '<b style="white-space:nowrap">' + UI.esc(title) + '</b>' +
      '<span id="hrc-cloud-more" style="display:' + (isOpen ? 'inline' : 'none') + '">' + UI.esc(body) + '</span>' +
      '<button type="button" data-banner-toggle aria-expanded="' + (isOpen ? 'true' : 'false') + '" ' +
        'style="background:transparent;border:1px solid ' + colors[2] + ';color:' + colors[0] +
        ';font:inherit;font-weight:700;cursor:pointer;border-radius:8px;padding:1px 9px">' +
        (isOpen ? 'إخفاء' : 'التفاصيل') + '</button>' +
      (tone === 'err' ? '<a href="supabase-check.html" style="margin-inline-start:auto;color:' + colors[0] +
        ';font-weight:700;text-decoration:underline;white-space:nowrap">فحص الاتصال</a>' : '');
    var tgl = el.querySelector('[data-banner-toggle]');
    if (tgl) tgl.addEventListener('click', function () {
      var more = el.querySelector('#hrc-cloud-more');
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
    var el = document.getElementById('hrc-cloud-note');
    if (!st || !st.configured || st.state === 'off') { if (el) el.remove(); return; }
    if (!el) {
      var wrap = document.createElement('div');
      wrap.innerHTML = '<div id="hrc-cloud-note" style="margin-top:14px;padding:10px 12px;border-radius:10px;font-size:.78rem;line-height:1.8"></div>';
      el = wrap.firstChild;
      host.appendChild(el);
    }
    if (st.state === 'degraded') {
      el.style.cssText += ';background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d';
      el.innerHTML = '<b>لم يتم الاتصال بقاعدة الشركة.</b><br>' + UI.esc(st.error || '') +
        (st.detail ? '<br>' + UI.esc(st.detail) : '') +
        (st.enforceAuth ? '<br>الدخول يتطلب اتصالاً بحساب الشركة.' : '<br>يمكن تجربة الوضع المحلي المؤقت.') + ' — <a href="supabase-check.html" style="text-decoration:underline">افتح صفحة فحص الاتصال</a>.';
    } else if (st.state === 'ready') {
      el.style.cssText += ';background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a';
      el.textContent = 'أدخل حساب الموظف؛ سيتم التحقق من الاتصال والبيانات عند الدخول.';
    } else if (st.state === 'on') {
      el.style.cssText += ';background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d';
      el.innerHTML = (st.role === 'staff'
        ? '<b>متصل بقاعدة الشركة.</b> سجّل الدخول بحسابك الرسمي.'
        : '<b>متصل بقاعدة الشركة.</b> الدخول بحساب الموظف الرسمي.');
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
    if (!admin && (state.view === 'finance' || state.view === 'settings' || state.view === 'applicants')) setView('overview');
  }

  /* ======================= التنقل ======================= */
  var TITLES = {
    overview: ['نظرة عامة', 'ملخص لحظي لحالة الوظائف والاستمارات والحجوزات'],
    jobs: ['الوظائف', 'إدارة الوظائف، الحجز المؤقت، الإغلاق وإعادة التفعيل'],
    applicants: ['البطاقات', 'إدارة البطاقات — بحث وفلترة وإصدار ومتابعة'],
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
  root.HRCRefresh = function () { renderCurrent(); };

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
      var c = (pa.hiring || []).length + pa.holds.length;
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
    Store.db().jobs.forEach(function (j) { state.lastStatuses[j.code] = j.critical ? 'critical' : j.status; });
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
    /* نظام البطاقات: انتهاء مهلة الحجز ← حالة «حرجة» بانتظار قرار الموظف
       (توظيف / إرجاع / حذف) — لا إفراج تلقائي بعد اليوم. */
    Store.db().jobs.forEach(function (j) {
      if (j.status === 'reserved' && !j.holdExpiresAt && j.critical && before[j.code] !== 'critical' &&
          !Store.getAttempts(j.reservedBy).some(function (t) { return t.jobCode === j.code && t.slotStatus === 'critical' && t.employerDecision === 'reject'; })) {
        UI.toast('warn', 'حالة حرجة', 'الوظيفة ' + j.code + ' انتهت مهلة حجزها (24 ساعة) — بانتظار قرارك: توظيف أو إرجاع أو حذف.', 9000);
      }
    });
    snapshotStatuses();
    if (actions.length) renderCurrent();
  }

  /* ======================= نظرة عامة ======================= */
  var iraqCalendar = new Intl.DateTimeFormat('ar-IQ-u-ca-gregory', {timeZone:'Asia/Baghdad',weekday:'long',year:'numeric',month:'long',day:'numeric'});
  function renderClock() {
    if (!Store.currentUser() || state.view !== 'overview') return;
    var now = new Date(), clock = document.getElementById('ov-clock'), date = document.getElementById('ov-date');
    if (clock) clock.textContent = Store.fmtDateTime(now).slice(11,16);
    if (date) date.textContent = iraqCalendar.format(now);
  }
  function renderOverview() {
    var s = Store.stats();
    var pa = Store.pendingActions();
    var fin = Store.financialTotals();

    // ═══ بانر الترحيب + الساعة ═══
    var user = Store.currentUser();
    var userName = document.getElementById('ov-user-name');
    if (userName) userName.textContent = user ? (user.name || user.username) : '—';
    renderClock();

    // ═══ إحصائيات ═══
    var stats = [
      { icon: 'briefcase', cls: 'ok',     val: s.available,  lbl: 'وظائف متاحة', hint: 'من أصل ' + s.totalJobs + ' وظيفة' },
      { icon: 'hourglass', cls: 'warn',   val: s.reserved,   lbl: 'حجوزات جارية', hint: 'مؤقتة 24 ساعة' },
      { icon: 'card',      cls: 'info',   val: s.forms,      lbl: 'بطاقات صادرة', hint: s.activeForms + ' سارية' },
      { icon: 'card',      cls: 'gold',   val: s.blankForms, lbl: 'فارغة بالمخزن', hint: 'بانتظار التعبئة' },
      { icon: 'check',     cls: 'purple', val: s.hires,      lbl: 'توظيف ناجح', hint: 'منذ بداية التشغيل' },
      { icon: 'chart',     cls: 'ok',     val: Store.money(fin.expected), lbl: 'التحصيل المتوقع', hint: fin.printed + ' مرة طباعة' }
    ];
    if(Store.db().meta.workspace&&!Store.db().meta.serverReport){[2,4,5].forEach(function(i){stats[i].val='—';stats[i].hint='الإجمالي الكامل غير متاح؛ لا نستبدله ببيانات العمل الجزئية';});}
    document.getElementById('ov-stats').innerHTML = stats.map(function (x) {
      return '<div class="ov-stat">' +
        '<div class="ov-icon ' + x.cls + '"><svg class="ic"><use href="#i-' + x.icon + '" xlink:href="#i-' + x.icon + '"/></svg></div>' +
        '<div class="ov-val">' + UI.esc(String(x.val)) + '</div>' +
        '<div class="ov-lbl">' + UI.esc(x.lbl) + '</div>' +
        '<div class="ov-hint">' + UI.esc(x.hint) + '</div>' +
      '</div>';
    }).join('');

    // ═══ إجراءات مطلوبة ═══
    var actions = [];
    (pa.hiring || []).forEach(function (h) {
      actions.push({
        icon: 'hiring', title: 'جاري التوظيف — ' + h.job.code,
        sub: 'البطاقة ' + (h.serial || '—') + ' · صاحب العمل: ' + (h.job.employer || {}).name,
        badge: '<span class="badge info">تثبيت مطلوب</span>',
        act: { label: 'قرار', handler: function () { setView('holds'); } }
      });
    });
    pa.requests.forEach(function (r) {
      actions.push({
        icon: 'pending', title: 'طلب بطاقة: ' + r.serial,
        sub: r.fullName + ' — ' + (r.requestedCode ? 'الوظيفة ' + r.requestedCode : 'طلب عام') + ' · ' + r.phone,
        badge: '<span class="badge warn">قيد المراجعة</span>',
        act: { label: 'مراجعة', handler: function () { setView('applicants'); reviewRequestModal(r.serial); } }
      });
    });
    (pa.critical || []).forEach(function (h) {
      var byEmployer = h.decidedBy === 'employer';
      actions.push({
        icon: 'critical', title: (byEmployer ? 'رفض صاحب العمل — ' : 'حالة حرجة — ') + h.job.code,
        sub: 'البطاقة ' + (h.serial || '—') + (byEmployer ? ' · السبب: ' + (h.reason || '—') : ' · انتهت المهلة دون قرار'),
        badge: '<span class="badge danger">' + (byEmployer ? 'معلّقة' : 'قرار مطلوب') + '</span>',
        act: { label: 'قرار', handler: function () { setView('holds'); } }
      });
    });
    pa.holds.forEach(function (h) {
      actions.push({
        icon: 'hold', title: 'حجز جارٍ — ' + h.job.code,
        sub: 'البطاقة ' + (h.serial || '—') + ' · المتبقي ' + UI.humanDuration(Math.max(0, h.hoursLeft * 3600000)),
        badge: h.hoursLeft < 4 ? '<span class="badge danger">عاجل</span>' : '<span class="badge warn">متابعة</span>',
        act: { label: 'إدارة', handler: function () { setView('holds'); } }
      });
    });
    (pa.expired || []).forEach(function (a) {
      actions.push({ icon: 'critical', title: 'بطاقة منتهية: ' + a.serial, sub: a.fullName, badge: '<span class="badge danger">منتهية</span>', act: { label: 'فتح', handler: function () { attemptsModal(a.serial); } } });
    });
    (pa.exhausted || []).forEach(function (a) {
      actions.push({ icon: 'hold', title: 'فرص البطاقة مستهلكة: ' + a.serial, sub: a.fullName, badge: '<span class="badge warn">مستهلكة</span>', act: { label: 'فتح', handler: function () { attemptsModal(a.serial); } } });
    });

    var cEl = document.getElementById('ov-actions-count');
    if (cEl) cEl.textContent = String(actions.length);
    var actionsHost = document.getElementById('ov-actions');
    if (actionsHost) {
      actionsHost.innerHTML = actions.length
        ? actions.slice(0, 8).map(function (a, i) {
          return '<div class="ov-action-card">' +
            '<div class="ov-ac-icon ' + a.icon + '"><svg class="ic"><use href="#i-alert" xlink:href="#i-alert"/></svg></div>' +
            '<div class="ov-ac-body"><div class="ov-ac-title">' + UI.esc(a.title) + '</div><div class="ov-ac-sub">' + UI.esc(a.sub) + '</div></div>' +
            '<div class="ov-ac-right">' + a.badge + '<button class="btn btn-outline btn-sm" data-act="' + i + '">' + UI.esc(a.act.label) + '</button></div>' +
          '</div>';
        }).join('')
        : '<div style="text-align:center;padding:32px;color:var(--muted)">' + UI.ic('check') + '<div style="margin-top:8px;font-weight:600">لا توجد إجراءات معلّقة</div><div style="font-size:.82rem;margin-top:4px">كل الحجوزات والاستمارات تحت السيطرة ✨</div></div>';

      actionsHost.querySelectorAll('[data-act]').forEach(function (b) {
        b.addEventListener('click', function () { actions[Number(b.getAttribute('data-act'))].act.handler(); });
      });
    }

    // ═══ حجوزات جارية ═══
    var holds = pa.holds.slice(0, 6);
    var holdsHost = document.getElementById('ov-holds');
    if (holdsHost) {
      holdsHost.innerHTML = holds.length
        ? holds.map(function (h) {
          return '<div class="ov-hold-card">' +
            '<div class="ov-hc-icon"><svg class="ic"><use href="#i-hourglass" xlink:href="#i-hourglass"/></svg></div>' +
            '<div class="ov-hc-body">' +
              '<div class="ov-hc-title"><span class="mono">' + UI.esc(h.job.code) + '</span> — ' + UI.esc(h.job.title) + '</div>' +
              '<div class="ov-hc-sub">البطاقة ' + UI.esc(h.serial || '—') + ' · ' + UI.esc((h.job.employer || {}).name) + '</div>' +
            '</div>' +
            '<div class="ov-hc-timer">' + UI.holdHtml(h.job.holdExpiresAt) + '</div>' +
          '</div>';
        }).join('')
        : '<div style="text-align:center;padding:32px;color:var(--muted)">' + UI.ic('hourglass') + '<div style="margin-top:8px;font-weight:600">لا توجد حجوزات مؤقتة</div></div>';
    }

    // ═══ آخر العمليات ═══
    var recent = Store.listAudit({}).slice(0, 10);
    var recentHost = document.getElementById('ov-recent');
    if (recentHost) {
      recentHost.innerHTML = recent.length
        ? recent.map(function (l) {
          return '<div class="ov-log-row">' +
            '<div class="ov-log-dot"></div>' +
            '<div class="ov-log-time">' + UI.esc(Store.fmtDateTime(l.ts)) + '</div>' +
            '<div class="ov-log-user">' + UI.esc(l.name || l.user) + '</div>' +
            '<div class="ov-log-action">' + UI.esc(auditActionLabel(l.action)) +
              (l.details ? ' — ' + UI.esc(auditDetailsLabel(l.details)) : '') + '</div>' +
          '</div>';
        }).join('')
        : '<div style="text-align:center;padding:32px;color:var(--muted)">' + UI.ic('list') + '<div style="margin-top:8px">لا سجلات بعد</div></div>';
    }
  }

  /* ======================= الوظائف ======================= */
  function renderJobs() {
    var rows = Store.listJobs(state.j);
    var tbody = document.getElementById('jobs-table-body');
    var label = document.getElementById('jobs-count-label');
    if (label) label.textContent = rows.length + ' وظيفة';

    // ═══ إحصائيات الوظائف ═══
    var statsHost = document.getElementById('jobs-stats');
    if (statsHost) {
      var all = Store.listJobs({});
      var avail = 0, resv = 0, closed = 0, hiring = 0;
      all.forEach(function (j) {
        if (j.status === 'available') avail++;
        else if (j.status === 'reserved') resv++;
        else if (j.status === 'closed') closed++;
        if (j.status === 'hiring') hiring++;
      });
      var jstats = [
        { icon: 'briefcase', cls: 'ok',     val: all.length, lbl: 'إجمالي الوظائف' },
        { icon: 'check',     cls: 'ok',     val: avail,      lbl: 'متاحة' },
        { icon: 'hourglass', cls: 'warn',   val: resv,       lbl: 'محجوزة مؤقتاً' },
        { icon: 'check-circle', cls: 'info', val: hiring,    lbl: 'جاري التوظيف' },
        { icon: 'x-circle',  cls: 'danger', val: closed,     lbl: 'مغلقة' }
      ];
      statsHost.innerHTML = jstats.map(function (s) {
        return '<div class="jobs-stat">' +
          '<div class="js-icon ' + s.cls + '"><svg class="ic"><use href="#i-' + s.icon + '" xlink:href="#i-' + s.icon + '"/></svg></div>' +
          '<div><div class="js-val">' + s.val + '</div><div class="js-lbl">' + s.lbl + '</div></div>' +
        '</div>';
      }).join('');
    }

    tbody.innerHTML = rows.map(function (j) {
      var v=Store.vacancySummary(j);
      var holdCell = '—';
      if (j.status === 'hiring') {
        holdCell = '<span class="tiny">البطاقة <b class="mono">' + UI.esc(j.reservedBy || '—') + '</b> · </span><span class="badge info">جاري التوظيف — قرار الشركة</span>';
      } else if (j.status === 'reserved' && j.critical) {
        var rejT = Store.getAttempts(j.reservedBy).filter(function (x) {
          return x.jobId === j.id && x.slotStatus === 'critical';
        })[0];
        holdCell = '<span class="tiny">البطاقة <b class="mono">' + UI.esc(j.reservedBy || '—') + '</b> · </span>' +
          (rejT && rejT.employerDecision === 'reject'
            ? '<span class="badge danger">رفض صاحب العمل — معلّقة</span><span class="tiny muted"> · السبب: ' + UI.esc(rejT.reason || '—') + '</span>'
            : '<span class="badge danger">حرجة — قرار مطلوب</span>');
      } else if (j.status === 'reserved' && j.holdExpiresAt) {
        holdCell = '<span class="tiny">البطاقة <b class="mono">' + UI.esc(j.reservedBy || '—') + '</b> · </span>' + UI.holdHtml(j.holdExpiresAt, { withDate: false });
      }
      if(Number(j.vacancies||1)>1)holdCell='<div class="tiny">'+v.available+' متاح · '+v.held+' محجوز · '+v.filled+' ممتلئ · المجموع '+v.total+'</div>';
      var imageCell = j.imageUrl
        ? '<span class="job-cell-photo" style="--img:url(&quot;' + UI.esc(j.imageUrl) + '&quot;)"><img src="' + UI.esc(j.imageUrl) + '" alt="' + UI.esc(j.title) + '"></span>'
        : '<span class="job-cell-photo is-empty"><svg class="ic" style="width:18px;height:18px;color:#8fa0c4"><use href="#i-briefcase"/></svg></span>';
      return '<tr>' +
        '<td>' + imageCell + '</td>' +
        '<td><span class="chip chip-code mono" style="font-size:.8rem">' + UI.esc(j.code) + '</span></td>' +
        '<td><b style="color:var(--lapis-2)">' + UI.esc(j.title) + '</b> <span class="tiny muted"> · ' + UI.esc(j.category) + '</span></td>' +
        '<td><span style="font-weight:600">' + UI.esc(j.governorate || '—') + '</span></td>' +
        '<td class="nowrap tiny"><b>' + Store.money(j.salaryMin) + '</b> <span class="muted">إلى ' + Store.money(j.salaryMax) + '</span></td>' +
        '<td class="tiny"><span style="background:#eef1f7;padding:3px 8px;border-radius:6px;font-weight:600">' + UI.esc(j.shift) + '</span></td>' +
        '<td>' + UI.jobBadge(j.status) + '</td>' +
        '<td>' + holdCell + '</td>' +
        '<td class="tiny"><b>' + UI.esc((j.employer || {}).name || '—') + '</b> <span class="mono" dir="ltr">' + UI.esc((j.employer || {}).phone || '—') + '</span></td>' +
        '<td><div class="cell-actions">' +
          '<button class="btn btn-outline btn-sm" data-job-edit="' + UI.esc(j.code) + '">' + UI.ic('edit') + ' تعديل</button>' +
          (Number(j.vacancies||1)>1&&v.held
            ? '<button class="btn btn-lapis btn-sm" data-job-hiring="'+UI.esc(j.code)+'">قرارات الشواغر</button>'
            : j.status === 'hiring'
            ? '<button class="btn btn-lapis btn-sm" data-job-hiring="' + UI.esc(j.code) + '">' + UI.ic('check') + ' قرار التوظيف</button>'
            : (j.status === 'reserved' && j.critical
              ? '<button class="btn btn-danger btn-sm" data-job-critical="' + UI.esc(j.code) + '">' + UI.ic('alert') + ' قرار حرجة</button>'
              : (j.status === 'reserved'
                ? '<button class="btn btn-warn btn-sm" data-job-release="' + UI.esc(j.code) + '">' + UI.ic('refresh') + ' إرجاع</button>'
                : ''))) +
          (j.status === 'available'
              ? '<button class="btn btn-lapis btn-sm" data-job-close="' + UI.esc(j.code) + '">إغلاق</button>'
              : j.status==='closed'?'<button class="btn btn-ok btn-sm" data-job-reopen="' + UI.esc(j.code) + '">إعادة تفعيل</button>':'') +
          '<button class="btn btn-outline btn-sm" data-job-assign="' + UI.esc(j.code) + '">' + UI.ic('user-plus') + ' ترشيح</button>' +
          '<button class="btn btn-danger btn-sm" data-job-del="' + UI.esc(j.code) + '">' + UI.ic('trash') + '</button>' +
        '</div></td></tr>';
    }).join('') || '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)"><svg class="ic" style="width:28px;height:28px;display:block;margin:0 auto 10px;opacity:.4"><use href="#i-briefcase"/></svg>لا توجد وظائف مطابقة</td></tr>';

    tbody.querySelectorAll('[data-job-edit]').forEach(function (b) {
      b.addEventListener('click', function () { jobModal(b.getAttribute('data-job-edit')); });
    });
    tbody.querySelectorAll('[data-job-release]').forEach(function (b) {
      b.addEventListener('click', function () { openHoldsModal(b.getAttribute('data-job-release')); });
    });
    tbody.querySelectorAll('[data-job-hiring]').forEach(function (b) {
      b.addEventListener('click', function () { openHoldsModal(b.getAttribute('data-job-hiring')); });
    });
    tbody.querySelectorAll('[data-job-critical]').forEach(function (b) {
      b.addEventListener('click', function () { openHoldsModal(b.getAttribute('data-job-critical')); });
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
        var j=Store.setJobStatus(b.getAttribute('data-job-reopen'), 'available', 'إعادة تفعيل');
        UI.toast(j.status==='available'?'ok':'warn',j.status==='available'?'أُعيد التفعيل':'لا يوجد شاغر فارغ',j.status==='available'?'الشواغر الفارغة متاحة الآن.':'الشواغر مشغولة؛ لا تُعاد فرص البطاقات.');
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
    var governoratesList = CFG.governorates.map(function (r) { return '<option' + (j && j.governorate === r ? ' selected' : '') + '>' + UI.esc(r) + '</option>'; }).join('');
    var shiftsList = CFG.shifts.map(function (r) { return '<option' + (j && j.shift === r ? ' selected' : '') + '>' + UI.esc(r) + '</option>'; }).join('');
    var cats = CFG.jobCategories.map(function (r) { return '<option' + (j && j.category === r ? ' selected' : '') + '>' + UI.esc(r) + '</option>'; }).join('');
    var e = (j && j.employer) || { name: '', phone: '', address: '' };

    var body = '<form id="job-form" class="grid grid-2" style="gap:14px">' +
      '<div class="field" style="grid-column:1/-1"><label for="f-image">صورة الوظيفة (اختياري)</label>' +
        '<div class="img-field">' +
          '<div class="img-pick">' +
            '<label class="img-pick-btn" for="f-image">' + UI.ic('upload') + ' اختر صورة من الجهاز</label>' +
            '<input type="file" id="f-image" accept="image/*" class="img-file">' +
            '<span class="tiny muted">JPG أو PNG — حتى ٢ ميجابايت. تصغير وتكبير وتحريك كما تحب.</span>' +
          '</div>' +
          '<div class="img-empty" id="img-empty">لا توجد صورة بعد — اختر صورة لتظهر المعاينة هنا.</div>' +
          '<div class="img-editor" id="img-editor" hidden>' +
            '<div class="img-stage" id="img-stage" tabindex="0" role="application" aria-label="معاينة صورة الوظيفة — اسحب الصورة لتحريكها">' +
              '<img id="img-target" alt="معاينة صورة الوظيفة" draggable="false">' +
              '<span class="img-guide" aria-hidden="true"></span>' +
            '</div>' +
            '<div class="img-tools">' +
              '<button type="button" class="img-tool" id="img-zoom-out" aria-label="تصغير الصورة">−</button>' +
              '<input type="range" id="img-zoom" min="60" max="250" step="5" value="100" aria-label="نسبة تكبير الصورة (100% = ملء الإطار)">' +
              '<button type="button" class="img-tool" id="img-zoom-in" aria-label="تكبير الصورة">+</button>' +
              '<span class="img-zoom-val" id="img-zoom-val">100%</span>' +
              '<button type="button" class="img-tool-text" id="img-reset">إعادة الضبط</button>' +
              '<button type="button" class="img-tool-text is-danger" id="img-remove">إزالة الصورة</button>' +
            '</div>' +
            '<p class="img-hint" id="img-hint">اسحب الصورة لتحريكها داخل الإطار · استخدم + و− للتكبير.</p>' +
          '</div>' +
        '</div></div>' +
      '<div class="field"><label for="f-title">عنوان الوظيفة *</label><input type="text" id="f-title" required value="' + UI.esc(j ? j.title : '') + '"></div>' +
      '<div class="field"><label for="f-cat">التصنيف</label><select id="f-cat">' + cats + '</select></div>' +
      '<div class="field"><label for="f-governorate">المحافظة</label><select id="f-governorate">' + governoratesList + '</select></div>' +
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
      subtitle: j ? null : 'سيُولَّد كود مصغّر تلقائياً بصيغة HRC-####',
      wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-gold" id="job-save">' + UI.ic('check') + (j ? ' حفظ التعديلات' : ' إضافة الوظيفة') + '</button>',
      onMount: function (box, close) {
        /* ── محرّر صورة الوظيفة: معاينة + تكبير/تصغير + سحب + إزالة ──
           ما يراه الموظف في الإطار هو ما يُحفظ ويظهر للزبون (نُثبّت الإطار
           بنسبة 10:7 في صورة واحدة عند الحفظ) — فلا مفاجآت بعد النشر. */
        var imageFile = box.querySelector('#f-image');
        var editor = box.querySelector('#img-editor');
        var stageEl = box.querySelector('#img-stage');
        var target = box.querySelector('#img-target');
        var emptyBox = box.querySelector('#img-empty');
        var zoomRange = box.querySelector('#img-zoom');
        var zoomVal = box.querySelector('#img-zoom-val');
        var hint = box.querySelector('#img-hint');
        var imageData = j ? (j.imageUrl || '') : '';
        var dirty = false;                    /* هل عدّل الموظف الصورة؟ */
        var cur = { zoom: 1, x: 0, y: 0 };    /* الحالة الحالية للإطار */
        var nat = { w: 0, h: 0 };
        /* ١٠٠٪ تعني «ملء الإطار» بنسبة 10:7 — فلا فراغ ولا أشرطة بعد الحفظ،
           وكل صور الوظائف تخرج بمقاس واحد. النزول إلى ٦٠٪ يسمح بإظهار الصورة
           كاملة (وخلفها تعبئة ضبابية في الموقع فلا تبدو ناقصة). */
        var MIN_Z = 0.6, MAX_Z = 2.5, STEP_Z = 0.2;

        function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }

        /* يرسم الصورة داخل الإطار حسب التكبير والموضع */
        function layoutImage() {
          /* واجهة التكبير تُحدَّث دائماً (حتى قبل تحميل الصورة أو بلا قياسات) */
          var pctNow = Math.round(cur.zoom * 100);
          if (zoomVal) zoomVal.textContent = pctNow + '%';
          if (zoomRange) zoomRange.value = String(pctNow);
          if (hint) {
            hint.textContent = cur.zoom > 1.001
              ? 'تكبير ' + pctNow + '% — اسحب الصورة لاختيار الجزء الظاهر.'
              : (cur.zoom < 0.999
                ? 'الصورة كاملة مع خلفية موحّدة — استخدم + لملء الإطار.'
                : 'الإطار ممتلئ بالصورة · اسحب للتحريك أو استخدم + و− للتكبير.');
          }
          if (!nat.w || !stageEl || !stageEl.clientWidth) return;   /* بلا قياسات: لا تخطيط */
          var sw = stageEl.clientWidth, sh = stageEl.clientHeight;
          var base = Math.max(sw / nat.w, sh / nat.h);   /* ملء الإطار عند 100% */
          var k = base * cur.zoom;
          var w = nat.w * k, h = nat.h * k;
          var maxX = Math.max(0, (w - sw) / 2);
          var maxY = Math.max(0, (h - sh) / 2);
          cur.x = clampNum(cur.x, -maxX, maxX);
          cur.y = clampNum(cur.y, -maxY, maxY);
          target.style.width = w + 'px';
          target.style.height = h + 'px';
          target.style.transform = 'translate(-50%,-50%) translate(' + cur.x + 'px,' + cur.y + 'px)';
        }

        function setZoom(z) {
          cur.zoom = clampNum(Number(z) || 1, MIN_Z, MAX_Z);
          layoutImage();
          dirty = true;
        }

        function showImage(src) {
          if (!src) return;
          target.onload = function () {
            nat.w = target.naturalWidth || 0;
            nat.h = target.naturalHeight || 0;
            if (editor) editor.hidden = false;
            if (emptyBox) emptyBox.hidden = true;
            layoutImage();
          };
          target.onerror = function () {
            UI.toast('err', 'تعذّر عرض الصورة', 'جرّب صورة أخرى بصيغة JPG أو PNG.');
          };
          target.src = src;
        }

        function clearImage() {
          imageData = '';
          dirty = true;
          nat = { w: 0, h: 0 };
          cur = { zoom: 1, x: 0, y: 0 };
          try { target.removeAttribute('src'); } catch (e) { target.src = ''; }
          if (editor) editor.hidden = true;
          if (emptyBox) emptyBox.hidden = false;
        }

        /* تثبيت ما يراه الموظف في صورة واحدة بنسبة الإطار (بلا قص زائد) */
        function bakeImage() {
          if (!dirty || !nat.w) return imageData;
          try {
            var sr = stageEl.getBoundingClientRect();
            var ir = target.getBoundingClientRect();
            if (!sr.width || !sr.height || !ir.width) return imageData;
            var W = 1280, H = Math.round(W * (sr.height / sr.width));
            var cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            var ctx = cv.getContext('2d');
            if (!ctx) return imageData;
            ctx.fillStyle = '#0c1d33'; ctx.fillRect(0, 0, W, H);
            var f = W / sr.width;
            ctx.drawImage(target, (ir.left - sr.left) * f, (ir.top - sr.top) * f, ir.width * f, ir.height * f);
            var out = cv.toDataURL('image/jpeg', 0.86);
            if (!out || out.length < 64) return imageData;
            if (out.length > 1700000) out = cv.toDataURL('image/jpeg', 0.7);
            return out;
          } catch (e) { return imageData; }
        }

        if (imageData) showImage(imageData);

        if (imageFile) imageFile.addEventListener('change', function () {
          var file = imageFile.files && imageFile.files[0];
          if (!file) return;
          if (!/^image\//.test(file.type || '')) {
            UI.toast('err', 'ملف غير مدعوم', 'اختر صورة بصيغة JPG أو PNG.');
            return;
          }
          if (file.size > 2 * 1024 * 1024) {
            UI.toast('err', 'حجم كبير', 'الحد الأقصى ٢ ميجابايت');
            return;
          }
          var reader = new FileReader();
          reader.onload = function (ev) {
            imageData = ev.target.result;
            dirty = true;
            cur = { zoom: 1, x: 0, y: 0 };
            showImage(imageData);
            UI.toast('ok', 'تم اختيار الصورة', 'اضبط التكبير والموضع ثم احفظ الوظيفة.');
          };
          reader.readAsDataURL(file);
        });

        var zIn = box.querySelector('#img-zoom-in'), zOut = box.querySelector('#img-zoom-out');
        if (zIn) zIn.addEventListener('click', function () { setZoom(cur.zoom + STEP_Z); });
        if (zOut) zOut.addEventListener('click', function () { setZoom(cur.zoom - STEP_Z); });
        if (zoomRange) zoomRange.addEventListener('input', function () { setZoom(Number(zoomRange.value) / 100); });
        var zReset = box.querySelector('#img-reset');
        if (zReset) zReset.addEventListener('click', function () {
          cur = { zoom: 1, x: 0, y: 0 };
          dirty = true;
          layoutImage();
        });
        var zRemove = box.querySelector('#img-remove');
        if (zRemove) zRemove.addEventListener('click', function () { clearImage(); });

        /* السحب باللمس أو الفأرة */
        var drag = null;
        if (stageEl) {
          stageEl.addEventListener('pointerdown', function (e) {
            if (!nat.w || editor.hidden) return;
            drag = { x: e.clientX, y: e.clientY, ox: cur.x, oy: cur.y };
            stageEl.classList.add('is-drag');
            if (stageEl.setPointerCapture) { try { stageEl.setPointerCapture(e.pointerId); } catch (err) { } }
            e.preventDefault();
          });
          stageEl.addEventListener('pointermove', function (e) {
            if (!drag) return;
            cur.x = drag.ox + (e.clientX - drag.x);
            cur.y = drag.oy + (e.clientY - drag.y);
            layoutImage();
            dirty = true;
          });
          var endDrag = function () { drag = null; stageEl.classList.remove('is-drag'); };
          stageEl.addEventListener('pointerup', endDrag);
          stageEl.addEventListener('pointercancel', endDrag);
          stageEl.addEventListener('pointerleave', endDrag);
          /* مفاتيح الأسهم للتحريك الدقيق بلا فأرة */
          stageEl.addEventListener('keydown', function (e) {
            if (!nat.w) return;
            var step = e.shiftKey ? 20 : 6, used = true;
            if (e.key === 'ArrowLeft') cur.x += step;
            else if (e.key === 'ArrowRight') cur.x -= step;
            else if (e.key === 'ArrowUp') cur.y += step;
            else if (e.key === 'ArrowDown') cur.y -= step;
            else if (e.key === '+' || e.key === '=') setZoom(cur.zoom + STEP_Z);
            else if (e.key === '-') setZoom(cur.zoom - STEP_Z);
            else used = false;
            if (used) { e.preventDefault(); layoutImage(); dirty = true; }
          });
          if (window.ResizeObserver) {
            try { new ResizeObserver(function () { layoutImage(); }).observe(stageEl); } catch (e) { }
          }
        }
        
        box.querySelector('#job-save').addEventListener('click', async function () {
          var saveBtn = this;
          var f = box.querySelector('#job-form');
          if (!f.reportValidity()) return;
          /* ارفع الصورة إلى Storage قبل الكتابة كي لا تُخزَّن base64 في الصف.
             لو فشل الرفع ترجع base64 كما هي — لا تُفقد الصورة. */
          var bakedImage = bakeImage();
          if (bakedImage && bakedImage.indexOf('data:image/') === 0 && Store.uploadJobImage) {
            saveBtn.disabled = true;
            var prevText = saveBtn.textContent;
            saveBtn.textContent = 'جارٍ رفع الصورة…';
            try { bakedImage = await Store.uploadJobImage(bakedImage, j ? j.code : ''); }
            catch (e) { /* نبقي base64 */ }
            saveBtn.textContent = prevText;
            saveBtn.disabled = false;
          }
          var data = {
            title: box.querySelector('#f-title').value.trim(),
            category: box.querySelector('#f-cat').value,
            governorate: box.querySelector('#f-governorate').value,
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
            imageUrl: bakedImage
          };
          if (j) {
            Store.updateJob(j.code, {
              title: data.title, category: data.category, governorate: data.governorate, shift: data.shift,
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

  /* ترشيح وظيفة من جدول الوظائف: اختيار البطاقة */
  function pickApplicantModal(code) {
    var job = Store.getJob(code);
    if (!job) return;
    if (job.status !== 'available') { UI.toast('warn', 'الوظيفة غير متاحة', 'الحالة الحالية: ' + CFG.jobStatus[job.status].ar); return; }
    var list = Store.listApplicants({ status: 'all' });
    var body = '<p class="muted small">اختر البطاقة (الباحث) لتسجيل الفرصة على الوظيفة <b class="mono">' + UI.esc(code) + '</b>. ' +
      'ستُحجز الوظيفة مؤقتاً ' + Store.settings().holdHours + ' ساعة بانتظار نتيجة المقابلة.</p>' +
      '<div class="table-wrap"><div class="table-scroll" tabindex="0" role="region" aria-label="جدول البيانات — تمرير أفقي عند الحاجة"><table class="data" style="min-width:560px">' +
      '<thead><tr><th>الرقم التسلسلي</th><th>الباحث</th><th>الفرص</th><th>الحالة</th><th>ترشيح</th></tr></thead><tbody>' +
      list.map(function (a) {
        var st = Store.formStatus(a);
        var left = Store.attemptsLeft(a.serial);
        return '<tr><td class="mono">' + UI.esc(a.serial) + '</td><td>' + UI.esc(a.fullName) + '<div class="tiny muted">' + UI.esc(a.phone) + '</div></td>' +
          '<td>' + a.attemptsUsed + ' من ' + a.attemptLimit + '<div class="tiny muted">متبقٍ ' + left + '</div></td>' +
          '<td>' + UI.formBadge(st) + '</td>' +
          '<td>' + (st === 'active' && left > 0
            ? '<button class="btn btn-gold btn-sm" data-pick="' + UI.esc(a.serial) + '">ترشيح</button>'
            : '<span class="tiny muted">غير متاح</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    UI.modal({
      title: 'ترشيح على الوظيفة ' + code, subtitle: job.title + ' — ' + job.governorate, wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        box.querySelectorAll('[data-pick]').forEach(function (b) {
          b.addEventListener('click', function () {
            var serial = b.getAttribute('data-pick');
            var res = Store.selectAttempt(serial, code);
            if (!res.ok) { UI.toast('err', 'تعذّر الترشيح', res.error); return; }
            close();
            UI.toast('ok', 'تم الحجز المؤقت', 'الوظيفة ' + code + ' محجوزة للبطاقة ' + serial + ' حتى ' + Store.fmtDateTime(res.attempt.holdExpiresAt));
            attemptsModal(serial);
          });
        });
      }
    });
  }

  /* ======================= الباحثون والاستمارات ======================= */
  function renderApplicants() {
    var rows = Store.listApplicants(state.a);
    var filterKey=JSON.stringify(state.a);if(state.aFilterKey!==filterKey){state.aFilterKey=filterKey;state.aPage=0;}
    state.aPage=Math.min(state.aPage||0,Math.max(0,Math.ceil(rows.length/50)-1));
    var label = document.getElementById('apps-count-label');
    if (label) label.textContent = rows.length + (Store.db().meta.workspace?' بطاقة ضمن العمل الحالي':' بطاقة');

    // ═══ إحصائيات سريعة ═══
    var statsHost = document.getElementById('cards-stats');
    if (statsHost) {
      var all = Store.listApplicants({});
      var active = 0, blank = 0, pending = 0, expired = 0, exhausted = 0, reserved = 0;
      all.forEach(function (a) {
        var s = Store.formStatus(a);
        if (s === 'active') active++;
        else if (s === 'blank') blank++;
        else if (s === 'pending') pending++;
        else if (s === 'expired') expired++;
        else if (s === 'exhausted') exhausted++;
        if (a.holds) reserved++;
      });
      var stats = [
        { icon: 'card', cls: 'total', val: all.length, lbl: Store.db().meta.workspace?'بطاقات العمل الحالية':'إجمالي البطاقات' },
        { icon: 'check-circle', cls: 'ok', val: active, lbl: 'سارية' },
        { icon: 'card', cls: 'gold', val: blank, lbl: 'فارغة بالمخزن' },
        { icon: 'clock', cls: 'info', val: pending, lbl: 'قيد المراجعة' },
        { icon: 'hourglass', cls: 'warn', val: reserved, lbl: 'حجوزات جارية' },
        { icon: 'alert', cls: 'danger', val: expired + exhausted, lbl: Store.db().meta.workspace?'منتهية / مستهلكة حديثاً':'منتهية / مستهلكة' }
      ];
      statsHost.innerHTML = stats.map(function (s) {
        return '<div class="cards-stat ' + s.cls + '">' +
          '<div class="cs-icon ' + s.cls + '"><svg class="ic"><use href="#i-' + s.icon + '" xlink:href="#i-' + s.icon + '"/></svg></div>' +
          '<div class="cs-info"><div class="cs-val">' + s.val + '</div><div class="cs-lbl">' + s.lbl + '</div></div>' +
        '</div>';
      }).join('');
    }

    // ═══ الجدول ═══
    var tbody = document.getElementById('apps-table-body');

    var pager=document.getElementById('apps-pager');if(!pager){pager=document.createElement('div');pager.id='apps-pager';pager.className='flex';pager.style.cssText='gap:12px;flex-wrap:wrap;margin:12px 0';(tbody.closest('.table-wrap')||tbody.closest('table')).insertAdjacentElement('afterend',pager);}
    pager.innerHTML='<button class="btn btn-outline btn-sm" data-page-prev '+(state.aPage===0?'disabled':'')+'>السابق</button><span class="tiny">صفحة '+(state.aPage+1)+' من '+Math.max(1,Math.ceil(rows.length/50))+' · 50 بطاقة للصفحة · السجل القديم عبر بحث السجل الكامل</span><button class="btn btn-outline btn-sm" data-page-next '+((state.aPage+1)*50>=rows.length?'disabled':'')+'>التالي</button>';
    pager.querySelector('[data-page-prev]').onclick=function(){state.aPage--;renderApplicants();};pager.querySelector('[data-page-next]').onclick=function(){state.aPage++;renderApplicants();};
    tbody.innerHTML = rows.slice(state.aPage*50,(state.aPage+1)*50).map(function (a) {
      var st = Store.formStatus(a);
      var left = Store.attemptsLeft(a.serial);
      var hold = a.holds ? '<span class="badge warn">حجز جارٍ</span>' : '';
      var isPending = st === 'pending';
      var isRejected = st === 'rejected';

      var isBlank = st === 'blank';
      var requestChip = a.requestedCode ? '<div class="tiny"><span class="chip chip-gold">طلب: ' + UI.esc(a.requestedCode) + '</span></div>' : '';
      var nameCell = isBlank
        ? '<b>بطاقة فارغة — بانتظار الزبون</b><div class="tiny muted">مخزون نقاط البيع</div>'
        : '<b>' + UI.esc(a.fullName) + '</b><div class="tiny muted">' + UI.esc(a.address || '') + '</div>' +
          (isRejected && a.rejectReason ? '<div class="tiny"><span class="badge danger">السبب: ' + UI.esc(a.rejectReason) + '</span></div>' : '');

      var dateCells = isBlank || isPending || isRejected
        ? '<td class="tiny muted">—</td><td class="tiny muted">—</td><td class="tiny muted">—</td>'
        : '<td class="tiny" dir="ltr">' + Store.fmtDate(a.issueDate) + '</td>' +
          '<td class="tiny" dir="ltr">' + Store.fmtDate(a.expiryDate) + '</td>' +
          '<td class="tiny">' + (a.daysLeft == null ? 'تبدأ عند أول تقديم' : a.daysLeft < 0 ? '<span class="badge danger">منتهية</span>' : a.daysLeft + ' يوم') + '</td>';

      var attemptsCell = isBlank
        ? '<td class="tiny muted">الفرص جاهزة — الصلاحية تبدأ عند أول تقديم</td>'
        : (isPending || isRejected
        ? '<td class="tiny muted">—</td>'
        : '<td>' + a.attemptsUsed + ' / ' + a.attemptLimit + '<div class="tiny muted">متبقٍ ' + left + '</div>' + hold + '</td>');

      var statusCell = '<td>' + UI.formBadge(st);
      if (!isBlank && !isPending && !isRejected) {
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
      if (isBlank) {
        actionsCell = '<td><div class="cell-actions">' +
          '<button class="btn btn-outline btn-sm" data-app-print="' + UI.esc(a.serial) + '">' + UI.ic('print') + ' طباعة فارغة</button>' +
          '</div></td>';
      } else if (isPending) {
        actionsCell = '<td><div class="cell-actions">' +
          '<button class="btn btn-ok btn-sm" data-app-approve="' + UI.esc(a.serial) + '">' + UI.ic('check') + ' قبول</button>' +
          '<button class="btn btn-danger btn-sm" data-app-reject="' + UI.esc(a.serial) + '">' + UI.ic('x') + ' رفض</button>' +
          '</div></td>';
      } else if (isRejected) {
        actionsCell = '<td class="tiny muted">طلب مرفوض — لا إجراء</td>';
      } else {
        actionsCell = '<td><div class="cell-actions">' +
          '<button class="btn btn-lapis btn-sm" data-app-attempts="' + UI.esc(a.serial) + '">' + UI.ic('list') + ' الفرص</button>' +
          '<button class="btn btn-gold btn-sm" data-app-print="' + UI.esc(a.serial) + '">' + UI.ic('print') + ' طباعة</button>' +
          '<button class="btn btn-outline btn-sm" data-app-verify="' + UI.esc(a.serial) + '">' + UI.ic('qr') + '</button>' +
          '<button class="btn btn-outline btn-sm" data-app-fee="' + UI.esc(a.serial) + '">' + UI.ic('money') + '</button>' +
          '</div></td>';
      }

      var posCell = '<td class="tiny">' + (a.posName ? '<span style="font-weight:600">' + UI.esc(a.posName) + '</span>' : '<span class="muted">—</span>') + '</td>';

      return '<tr style="position:relative">' +
        '<td><div class="serial-cell"><span class="chip chip-code mono">' + UI.esc(a.serial) + '</span>' + requestChip + '</div></td>' +
        '<td>' + nameCell + '</td>' +
        '<td class="mono tiny" dir="ltr">' + UI.esc(a.phone) + '</td>' +
        posCell +
        dateCells +
        attemptsCell +
        statusCell +
        actionsCell +
        '</tr>';
    }).join('') || '<tr><td colspan="10" class="table-empty" style="padding:40px;text-align:center;color:var(--muted)"><svg class="ic" style="width:28px;height:28px;display:block;margin:0 auto 10px;opacity:.4"><use href="#i-card"/></svg>لا توجد بطاقات مطابقة</td></tr>';

    tbody.querySelectorAll('[data-app-approve]').forEach(function (b) {
      b.addEventListener('click', function () {
        var serial = b.getAttribute('data-app-approve');
        var res = Store.approveApplicant(serial);
        if (res.ok) {
          UI.toast('ok', 'قُبل الطلب', 'صدرت البطاقة ' + serial + ' رسمياً — صلاحية 30 يوماً وفرص حسب البطاقة.');
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
        UI.toast('ok', 'طباعة البطاقة', app.serial + ' — بطاقة 59.4×94.6مم مع الباركود.');
      });
    });
    tbody.querySelectorAll('[data-app-verify]').forEach(function (b) {
      b.addEventListener('click', function () {
        var serial = b.getAttribute('data-app-verify');
        var app = Store.getApplicant(serial);
        var url = Store.verifyUrl(serial);
        UI.modal({
          title: 'التحقق من البطاقة', subtitle: serial, body:
            '<p class="jobs-scroll-hint">اسحب النص أو الرابط أفقياً إذا لم يظهر كاملاً.</p><div class="grid card-verification">' +
            '<div><div class="data-grid">' +
            '<div class="data-item"><div class="k">الباحث</div><div class="v" tabindex="0">' + UI.esc(app.fullName) + '</div></div>' +
            '<div class="data-item"><div class="k">حالة البطاقة</div><div class="v" tabindex="0">' + CFG.formStatus[Store.formStatus(app)].ar + '</div></div>' +
            '<div class="data-item"><div class="k">المتبقي</div><div class="v" tabindex="0">' + Store.attemptsLeft(serial) + ' فرصة</div></div>' +
            '<div class="data-item card-link-row" style="grid-column:1/-1"><div class="k">رابط التحقق (المطبوع في الكيو آر كود)</div><div class="v mono tiny" dir="ltr" tabindex="0" aria-label="رابط التحقق — تمرير أفقي">' + UI.esc(url) + '</div></div>' +
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
      '<label>البطاقة</label>' +
      '<div class="mono">' + UI.esc(serial) + ' — ' + UI.esc(app.fullName) + '</div>' +
      '</div>' +
      '<div class="field mb-2">' +
      '<label>سعر البطاقة (كاش)</label>' +
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

  /* مراجعة طلب بطاقة قيد المراجعة: قبول أو رفض */
  function reviewRequestModal(serial, rejectMode) {
    var app = Store.getApplicant(serial);
    if (!app || Store.formStatus(app) !== 'pending') return;
    var job = app.requestedCode ? Store.getJob(app.requestedCode) : null;
    var body =
      '<p class="jobs-scroll-hint">اسحب التفاصيل أفقياً لقراءة النص الكامل.</p><div class="staff-details-scroll" tabindex="0" role="region" aria-label="تفاصيل طلب البطاقة — مرّر أفقياً"><div class="data-grid staff-details-grid mb-3">' +
        '<div class="data-item"><div class="k">رقم الطلب</div><div class="v mono" dir="ltr">' + UI.esc(app.serial) + '</div></div>' +
        '<div class="data-item"><div class="k">الاسم الكامل</div><div class="v">' + UI.esc(app.fullName) + '</div></div>' +
        '<div class="data-item"><div class="k">الهاتف</div><div class="v mono" dir="ltr">' + UI.esc(app.phone) + '</div></div>' +
        '<div class="data-item"><div class="k">تاريخ الميلاد</div><div class="v" dir="ltr">' + Store.fmtDate(app.dob || '') + '</div></div>' +
        '<div class="data-item"><div class="k">الجنس</div><div class="v">' + UI.esc(app.gender || '—') + '</div></div>' +
        '<div class="data-item"><div class="k">العنوان</div><div class="v">' + UI.esc(app.address || '—') + '</div></div>' +
        '<div class="data-item" style="grid-column:1/-1"><div class="k">الوظيفة المطلوبة</div><div class="v">' +
          (job ? '<span class="chip chip-code mono">' + UI.esc(job.code) + '</span> ' + UI.esc(job.title) + ' — ' + UI.esc(job.governorate) : (UI.esc(app.requestedCode || '—') + ' <span class="tiny muted">(كود غير معروف)</span>')) +
        '</div></div>' +
      '</div></div>' +
      (rejectMode
        ? '<div class="field"><label for="rr-reason">سبب الرفض</label><input type="text" id="rr-reason" placeholder="مثال: بيانات ناقصة / لا يطابق الشروط"></div>'
        : '<div class="panel" style="background:#fdf6e3;border-color:#f0d9a3"><div class="panel-body" style="padding:12px 15px">' +
          '<p class="mb-0 small">' + UI.ic('check') + ' عند القبول تصدر البطاقة رسمياً برقم ' + UI.esc(app.serial) + ' وتصبح صالحة 30 يوماً بفرص مستقلة حسب البطاقة.</p></div></div>');

    UI.modal({
      title: (rejectMode ? 'رفض طلب البطاقة' : 'مراجعة طلب البطاقة'),
      subtitle: 'طلب قيد المراجعة — ' + app.serial,
      wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        (rejectMode
          ? '<button class="btn btn-danger" id="rr-confirm">' + UI.ic('x') + ' تأكيد الرفض</button>'
          : '<button class="btn btn-ok" id="rr-approve">' + UI.ic('check') + ' قبول وإصدار البطاقة</button>'),
      onMount: function (box, close) {
        var approveBtn = box.querySelector('#rr-approve');
        if (approveBtn) approveBtn.addEventListener('click', function () {
          var res = Store.approveApplicant(serial);
          close();
          if (res.ok) {
            UI.toast('ok', 'قُبل الطلب', 'صدرت البطاقة ' + serial + ' — ' + app.fullName);
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

  function watchCase(box, close, reopen, signature) {
    var previous=signature();
    return Store.subscribe(function(){setTimeout(function(){
      if(!document.contains(box))return;
      var current=signature();if(current===previous)return;
      var backdrop=box.closest('.modal-backdrop');
      if(backdrop!==Array.from(document.querySelectorAll('.modal-backdrop')).pop())return;
      previous=current;close();reopen();
    },0);});
  }

  /* إدارة فرصتي البطاقة */
  function attemptsModal(serial) {
    var stopWatching=null;
    var app = Store.getApplicant(serial);
    if (!app) return;
    var attempts = Store.getAttempts(serial);
    var st = Store.formStatus(app);
    var limit = Number(app.attemptLimit || attempts.length || 2);
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
          '<button class="btn btn-warn btn-sm" data-release="' + t.no + '">إرجاع</button></div>';
      } else if (t.slotStatus === 'critical') {
        actions = '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-ok btn-sm" data-win="' + t.no + '">' + UI.ic('check') + ' توظيف</button>' +
          '<button class="btn btn-danger btn-sm" data-reject="' + t.no + '">' + UI.ic('x-circle') + ' رفض</button>' +
          '<button class="btn btn-warn btn-sm" data-release="' + t.no + '">إرجاع</button></div>';
      } else if (t.slotStatus === 'hiring') {
        /* جاري التوظيف (ج4): طلب صاحب العمل بانتظار تثبيت الشركة */
        actions = '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-ok btn-sm" data-win="' + t.no + '">' + UI.ic('check') + ' تثبيت التوظيف</button>' +
          '<button class="btn btn-danger btn-sm" data-reject="' + t.no + '">' + UI.ic('x-circle') + ' رفض المتقدم</button>' +
          '<button class="btn btn-warn btn-sm" data-release="' + t.no + '">إلغاء التوظيف — الوظيفة متاحة</button></div>';
      } else if (t.slotStatus === 'succeeded') {
        actions = '<span class="badge ok">مكتمل</span>';
      } else {
        actions = '<button class="btn btn-gold btn-sm" data-assign="' + t.no + '">' + UI.ic('refresh') + ' ترشيح جديد</button>';
      }
      return '<div class="attempt-slot' + (filled ? ' filled' : '') + '">' +
        '<div class="no">' + t.no + '</div>' +
        '<div class="job">' + (filled ? '<span class="mono">' + UI.esc(t.jobCode) + '</span> — ' + UI.esc(t.jobTitle) + ' · الشاغر ' + Number(t.vacancyNo||1) : 'فرصة متاحة') +
          '<small>' + (filled ? UI.esc(t.location) + ' · ' + UI.esc(t.employerName) + ' · <span dir="ltr">' + UI.esc(t.employerPhone) + '</span>' : 'لم تُستخدم بعد — رمزها على ظهر البطاقة') + '</small></div>' +
        '<div>' + (filled ? UI.slotBadge(t.slotStatus) +
          (t.slotStatus === 'reserved' && t.holdExpiresAt ? '<div class="mt-1">' + UI.holdHtml(t.holdExpiresAt, { withDate: false }) + '</div>' : '') +
          (t.slotStatus === 'critical' ? '<div class="mt-1"><span class="badge danger">حرجة — قرار مطلوب</span></div>' : '') +
          (t.slotStatus === 'hiring' ? '<div class="mt-1"><span class="badge info">' +
            (t.employerDecision === 'hire' ? 'طلب صاحب العمل: توظيف' : 'طلب صاحب العمل: عدم توظيف') +
            '</span>' + (t.decisionAt ? '<div class="tiny muted mt-1">' + Store.fmtDateTime(t.decisionAt) + '</div>' : '') + '</div>' : '') +
          (t.code ? '<div class="tiny mono mt-1" dir="ltr">' + UI.esc(t.code) + '</div>' : '') +
          (t.note ? '<div class="tiny muted mt-1">' + UI.esc(t.note) + '</div>' : '') : '') + '</div>' +
        '<div>' + actions + '</div>' +
        '</div>';
    }).join('');

    var body = '' +
      '<div class="flex-between flex-wrap mb-3" style="gap:12px">' +
        '<div>' +
          '<div class="flex flex-wrap" style="gap:8px;align-items:center">' +
            '<span class="chip chip-code mono">' + UI.esc(app.serial) + '</span>' + UI.formBadge(st) +
            (app.feePaid ? '<span class="badge ok">بيع كاش مُسجّل</span>' : '<span class="badge muted">غير مسدد</span>') +
            (app.posName ? '<span class="badge info">' + UI.esc(app.posName) + '</span>' : '') +
          '</div>' +
          '<div class="mt-2"><b>' + UI.esc(app.fullName) + '</b> · <span class="mono" dir="ltr">' + UI.esc(app.phone) + '</span>' +
          '<div class="tiny muted">' + UI.esc(app.address || '') + '</div></div>' +
        '</div>' +
        '<div class="staff-details-scroll" tabindex="0" role="region" aria-label="بيانات البطاقة — مرّر أفقياً"><div class="data-grid staff-details-grid" style="gap:10px">' +
          '<div class="data-item"><div class="k">الإصدار</div><div class="v" dir="ltr">' + Store.fmtDate(app.issueDate) + '</div></div>' +
          '<div class="data-item"><div class="k">الانتهاء</div><div class="v" dir="ltr">' + Store.fmtDate(app.expiryDate) + '</div></div>' +
          '<div class="data-item"><div class="k">الفرص المستخدمة</div><div class="v">' + attempts.filter(function (t) { return t.slotStatus !== 'empty'; }).length + ' / ' + limit + '</div></div>' +
        '</div></div>' +
      '</div>' +
      (st !== 'active' ? '<div class="panel mb-3" style="background:#fdf1d8;border-color:#f0d9a3"><div class="panel-body" style="padding:12px 15px">' +
        '<p class="mb-0 small">' + UI.ic('alert') + ' البطاقة ' + CFG.formStatus[st].ar +
        (st === 'expired' ? ' — انتهت مدة الثلاثين يوماً، لا يمكن استخدام الفرص.' : ' — فرص البطاقة مستهلكة.') + '</p></div></div>' : '') +
      '<h3 class="mb-2">فرص البطاقة</h3>' +
      '<p class="jobs-scroll-hint">اسحب الفرص أفقياً لعرض تفاصيلها والأزرار كاملة.</p><div class="attempts-stack" tabindex="0" role="region" aria-label="فرص البطاقة — مرّر أفقياً">' + slots + '</div>';

    UI.modal({
      title: 'بطاقة التوظيف — الفرص', subtitle: app.fullName + ' — ' + app.serial, wide: true, body: body,
      footer:
        '<button class="btn btn-gold" id="m-print-form">' + UI.ic('print') + ' طباعة استمارة التوظيف A4</button>' +
        '<button class="btn btn-lapis" id="m-print">' + UI.ic('card') + ' طباعة البطاقة (59.4×94.6مم)</button>' +
        '<button class="btn btn-outline" id="m-verify">' + UI.ic('qr') + ' صفحة التحقق</button>' +
        '<button class="btn btn-outline" data-close>إغلاق</button>',
      onMount: function (box, close) {
        stopWatching=watchCase(box,close,function(){attemptsModal(serial);},function(){return JSON.stringify([Store.getApplicant(serial),Store.getAttempts(serial),Store.db().jobs.map(function(j){return [j.code,j.status,j.vacancies];})]);});
        box.querySelector('#m-print-form').addEventListener('click', function () {
          if (st === 'blank') { UI.toast('warn', 'بطاقة غير مُباعة', 'استمارة A4 تُطبع بعد بيع البطاقة وتعبئة بيانات الزبون'); return; }
          try { V.printForm(app, null); } catch (e) { UI.toast('err', 'تعذّرت الطباعة', 'حاول مرة أخرى'); }
        });
        box.querySelector('#m-print').addEventListener('click', function () { V.print(app, { attempts: attempts }); });
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
              title: 'إرجاع الوظيفة', danger: true, confirmText: 'إرجاع وإتاحة الوظيفة',
              message: 'ستُوسم الفرصة كـ «مستهلكة — إرجاع» وتعود الوظيفة إلى «متاحة». لا تعود الفرصة للبطاقة (قرار معتمد).'
            }).then(function (ok) {
              if (!ok) return;
              var res = Store.releaseHold(serial, no);
              if (res.ok) { UI.toast('warn', 'تم الإرجاع', 'أُعيدت الوظيفة ' + (res.job ? res.job.code : '') + ' إلى المتاح — والفرصة مستهلكة.'); close(); }
            });
          });
        });
      },
      onClose: function () { if(stopWatching)stopWatching(); renderCurrent(); }
    });
  }

  /* اختيار وظيفة لفرصة معينة */
  function jobPickerModal(serial, no) {
    var jobs = Store.listJobs({ status: 'available' });
    var body = '' +
      '<p class="muted small">اختر الوظيفة المطلوبة للفرصة رقم <b>#' + no + '</b>. الوظيفة ستُحجز مؤقتاً ' +
      Store.settings().holdHours + ' ساعة بانتظار نتيجة المقابلة؛ بعدها تصبح حرجة بانتظار قرار الشركة، ولا تُتاح تلقائياً.</p>' +
      '<div class="search-wrap mb-2"><svg class="ic"><use href="#i-search" xlink:href="#i-search"/></svg>' +
      '<input type="search" id="pick-q" placeholder="ابحث بالكود أو عنوان الوظيفة..."></div>' +
      '<div id="pick-list">' + pickListHtml(jobs) + '</div>';

    UI.modal({
      title: 'ترشيح وظيفة للفرصة #' + no, subtitle: 'البطاقة ' + serial, wide: true, body: body,
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
    return '<div class="table-wrap"><div class="table-scroll" tabindex="0" role="region" aria-label="جدول البيانات — تمرير أفقي عند الحاجة"><table class="data" style="min-width:620px">' +
      '<thead><tr><th>الكود</th><th>الوظيفة</th><th>المحافظة</th><th>الأجر</th><th>الدوام</th><th>اختيار</th></tr></thead><tbody>' +
      jobs.map(function (j) {
        return '<tr><td><span class="chip chip-code mono">' + UI.esc(j.code) + '</span></td>' +
          '<td><b>' + UI.esc(j.title) + '</b><div class="tiny muted">' + UI.esc((j.employer || {}).name || '—') + ' · <span dir="ltr">' + UI.esc((j.employer || {}).phone || '—') + '</span></div></td>' +
          '<td>' + UI.esc(j.governorate || '—') + '</td><td class="tiny nowrap">' + Store.money(j.salaryMin) + '</td>' +
          '<td class="tiny">' + UI.esc(j.shift) + '</td>' +
          '<td><button class="btn btn-gold btn-sm" data-assign-job="' + UI.esc(j.code) + '">ترشيح</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* تثبيت نتيجة المقابلة — presetNote: ملاحظة جاهزة (مثل تثبيت طلب صاحب العمل) */
  function outcomeModal(serial, no, outcome, closeParent, presetNote) {
    var win = outcome === 'succeeded';
    var slot = Store.getAttempts(serial).filter(function (t) { return t.no === Number(no); })[0];
    var fromEmployer = slot && slot.slotStatus === 'hiring';
    UI.modal({
      title: win ? 'تثبيت التوظيف' : 'تسجيل رفض المرشح',
      body: (fromEmployer
        ? '<p class="muted small">' + (slot.employerDecision === 'hire'
            ? 'طلب صاحب العمل: <b>تم التوظيف</b> — بتثبيتك يُملأ هذا الشاغر فقط؛ بقية الشواغر تبقى حسب حالتها.'
            : 'طلب صاحب العمل: <b>لم يتم التوظيف</b> — القرار النهائي بيدك الآن.') + '</p>'
        : '<p class="muted small">' + (win
          ? 'سيُثبَّت التوظيف على هذا الشاغر؛ يُغلق الإعلان عند اكتمال شواغره فقط.'
          : 'سيعود الشاغر المعني متاحاً؛ الفرصة الحالية مستهلكة، والفرصة الأخرى محفوظة إن لم تُستخدم.') + '</p>') +
        '<div class="field"><label for="o-note">ملاحظة (تُحفظ في السجل والبطاقة)</label>' +
        '<textarea id="o-note" placeholder="' + (win ? 'اسم جهة العمل، تاريخ المباشرة...' : 'سبب الرفض: لم يحضر المقابلة، عدم كفاية الخبرة...') + '">' + UI.esc(presetNote || '') + '</textarea></div>',
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn ' + (win ? 'btn-ok' : 'btn-danger') + '" id="o-save">' + (win ? 'تثبيت التوظيف' : 'تسجيل الرفض') + '</button>',
      onMount: function (box, close) {
        box.querySelector('#o-save').addEventListener('click', function () {
          var note = box.querySelector('#o-note').value.trim();
          var res = Store.setOutcome(serial, no, outcome, note);
          if (!res.ok) { UI.toast('err', 'تعذّر التنفيذ', res.error); return; }
          close();
          if (closeParent) closeParent();
          if (win) UI.toast('ok', 'تم تثبيت التوظيف', 'الوظيفة ' + (res.job ? res.job.code : '') + ' — تم ملء الشاغر ' + Number(slot.vacancyNo||1) + '؛ بقية الشواغر حسب حالتها.');
          else UI.toast('warn', 'تم تسجيل الرفض', 'أُعيدت الوظيفة إلى قائمة المتاح' + (res.nextAttempt ? ' وتُورت الفرصة #' + res.nextAttempt.no : '') + ' — الفرصة مستهلكة.');
          attemptsModal(serial);
        });
      }
    });
  }

  /* نافذة إدارة الحجز/القرار: توظيف · رفض · إرجاع · حذف —
     نظام البطاقة: بعد انتهاء مهلة 24 ساعة تدخل الوظيفة «حرجة» وتُحسم من هنا */
  function openHoldsModal(jobCode, chosenSerial, chosenNo) {
    var job = Store.getJob(jobCode);
    if(!job)return;
    var pending=Store.db().attempts.filter(function(t){return t.jobId===job.id&&['reserved','critical','hiring'].indexOf(t.slotStatus)>=0;});
    if(!pending.length)return;
    if(Number(job.vacancies||1)>1&&!chosenSerial){
      UI.modal({title:'شواغر الوظيفة '+job.code,body:pending.map(function(t){return '<div class="data-item"><b>الشاغر '+Number(t.vacancyNo||1)+'</b> · '+UI.esc(t.serial)+' · '+UI.slotBadge(t.slotStatus)+'<button class="btn btn-outline btn-sm" data-vacancy-card="'+UI.esc(t.serial)+'" data-vacancy-attempt="'+t.no+'">عرض القرار</button></div>';}).join(''),footer:'<button class="btn btn-outline" data-close>إغلاق</button>',onMount:function(box,close){box.querySelectorAll('[data-vacancy-card]').forEach(function(b){b.onclick=function(){close();openHoldsModal(jobCode,b.dataset.vacancyCard,Number(b.dataset.vacancyAttempt));};});}});return;
    }
    var t=pending.filter(function(t){return !chosenSerial||(t.serial===chosenSerial&&(!chosenNo||t.no===Number(chosenNo)));})[0];
    if(!t)return;
    var serial=t.serial,critical=t.slotStatus==='critical',hiring=t.slotStatus==='hiring';
    job=Object.assign({},job,{holdExpiresAt:t.holdExpiresAt});
    var stopWatching=null;
    /* رفض صاحب العمل: وصل بسبب مكتوب ⇒ الوظيفة «معلّقة/حرجة» والقرار بيد الموظف:
       إرجاعها متاحة أو حذفها (قرار الإدارة 2026-10-06). */
    var empReject = !!(t && t.employerDecision === 'reject');
    var empReason = (t && (t.reason || '')) || '';
    UI.modal({
      title: (hiring ? '🔵 قرار توظيف صاحب العمل — ' : empReject ? '🔴 رفض صاحب العمل — قرارك بالوظيفة — ' : critical ? '🔴 قرار حالة حرجة — ' : 'إدارة الحجز المؤقت — ') + job.code,
      subtitle: job.title + ' · ' + job.governorate + ' · الشاغر ' + Number(t.vacancyNo||1) + ' من ' + Number(job.vacancies||1),
      body: '<p class="jobs-scroll-hint">اسحب التفاصيل أفقياً لقراءة النص الكامل.</p><div class="staff-details-scroll" tabindex="0" role="region" aria-label="تفاصيل الحجز — مرّر أفقياً"><div class="data-grid staff-details-grid mb-3">' +
        '<div class="data-item"><div class="k">البطاقة المحجوزة</div><div class="v mono">' + UI.esc(serial) + '</div></div>' +
        '<div class="data-item"><div class="k">الفرصة</div><div class="v">#' + (t ? t.no : '—') + '</div></div>' +
        '<div class="data-item"><div class="k">' + (hiring ? 'طلب صاحب العمل' : empReject ? 'قرار صاحب العمل' : critical ? 'انتهى الحجز' : 'ينتهي الحجز') + '</div><div class="v"' + (hiring || empReject ? ' dir="ltr"' : '') + '>' +
          (hiring
            ? (t && t.employerDecision === 'hire' ? 'تم التوظيف ✅' : 'لم يتم التوظيف') + (t && t.decisionAt ? ' — ' + Store.fmtDateTime(t.decisionAt) : '')
            : empReject
            ? 'رفض التوظيف ❌' + (t && t.decisionAt ? ' — ' + Store.fmtDateTime(t.decisionAt) : '')
            : critical ? 'انتهت مهلة 24 ساعة' : Store.fmtDateTime(job.holdExpiresAt)) + '</div></div>' +
        '<div class="data-item"><div class="k">الحالة</div><div class="v">' +
          (hiring ? '<span class="badge info">جاري التوظيف — بانتظار قرارك</span>'
                  : empReject ? '<span class="badge danger">معلّقة/حرجة — القرار بيدك</span>'
                  : critical ? '<span class="badge danger">حرجة — قرار مطلوب</span>' : UI.holdHtml(job.holdExpiresAt, { withDate: false })) + '</div></div>' +
        (empReject ? '<div class="data-item" style="grid-column:1/-1;border-color:#f0c3c1;background:#fdf5f4">' +
          '<div class="k">سبب عدم التوظيف المسجَّل من صاحب العمل</div>' +
          '<div class="v" style="font-weight:800;color:#a5342f">' + UI.esc(empReason || '— لم يُسجَّل سبب —') + '</div></div>' : '') +
        '<div class="data-item"><div class="k">صاحب العمل</div><div class="v">' + UI.esc((job.employer || {}).name) + '</div></div>' +
        '<div class="data-item"><div class="k">هاتفه</div><div class="v mono" dir="ltr">' + UI.esc((job.employer || {}).phone) + '</div></div>' +
        '<div class="data-item" style="grid-column:1/-1"><div class="k">مكان المقابلة</div><div class="v">' + UI.esc(job.interviewLocation) + '</div></div>' +
        '</div></div>' +
        '<p class="tiny muted mb-0">' + UI.ic('hourglass') + (hiring
          ? ' طلب صاحب العمل بانتظار قرارك: «تم التوظيف» يثبّته ويغلق الوظيفة، و«رفض» أو «إرجاع» يعيد الشاغر المعني متاحاً — والفرصة مستهلكة بأي نتيجة (قرار معتمد).'
          : empReject
          ? ' صاحب العمل رفض التوظيف بالسبب أعلاه — القرار الآن بيدك: <b>«إرجاع الوظيفة»</b> تُتيحها من جديد لبقية المتقدمين، و<b>«حذف الوظيفة»</b> تُزيلها نهائياً، و<b>«تم التوظيف»</b> تُثبّت المتقدم عليها. الفرصة مستهلكة بأي نتيجة (قرار معتمد: لا تعود).'
          : critical
          ? ' انتهت مهلة الـ24 ساعة دون قرار — الوظيفة مقفلة بانتظار قرارك، والفرصة تُستهلك بأي نتيجة (قرار معتمد: لا تعود الفرصة).'
          : ' إن انتهت المدة دون قرار تنتقل الوظيفة إلى حالة «حرجة» وتُحسم من هنا: توظيف أو إرجاع أو حذف.') + '</p>',
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>' +
        '<button class="btn btn-warn" id="h-release">' + UI.ic('refresh') + (hiring ? ' إلغاء التوظيف — الوظيفة متاحة' : ' إرجاع الوظيفة') + '</button>' +
        (Number(job.vacancies||1)>1?'':'<button class="btn btn-danger" id="h-del">' + UI.ic('trash') + ' حذف الوظيفة</button>') +
        (empReject ? '' : '<button class="btn btn-danger" id="h-reject">' + UI.ic('x-circle') + ' رفض</button>') +
        '<button class="btn btn-ok" id="h-win">' + UI.ic('check') + (hiring ? ' تثبيت التوظيف' : ' تم التوظيف') + '</button>',
      onMount: function (box, close) {
        stopWatching=watchCase(box,close,function(){openHoldsModal(jobCode,serial,t.no);},function(){return JSON.stringify(Store.getAttempts(serial));});
        box.querySelector('#h-win').addEventListener('click', function () {
          close();
          outcomeModal(serial, t ? t.no : 1, 'succeeded', null,
            hiring ? 'تثبيت طلب صاحب العمل: تم التوظيف — أقرّته الشركة' : null);
        });
        var rej = box.querySelector('#h-reject');
        if (rej) rej.addEventListener('click', function () { close(); outcomeModal(serial, t ? t.no : 1, 'rejected'); });
        box.querySelector('#h-release').addEventListener('click', function () {
          var res = Store.releaseHold(serial, t ? t.no : 1,
            hiring ? 'إلغاء توظيف صاحب العمل بقرار الشركة — أُعيدت الوظيفة متاحة والفرصة مستهلكة'
                   : empReject ? 'قرار الشركة بعد رفض صاحب العمل: إرجاع الوظيفة متاحة — والفرصة مستهلكة'
                   : critical ? 'إرجاع بعد حالة حرجة — قرار الموظف' : 'إرجاع يدوي من لوحة المتابعة');
          if (res.ok) {
            UI.toast(hiring ? 'warn' : 'warn', hiring ? 'أُلغي التوظيف' : 'تم الإرجاع',
              'أُعيدت الوظيفة ' + job.code + ' إلى المتاح — والفرصة مستهلكة.');
            close();
          }
        });
        if(box.querySelector('#h-del'))box.querySelector('#h-del').addEventListener('click', function () {
          UI.confirm({
            title: 'حذف الوظيفة', danger: true, confirmText: 'حذف نهائي',
            message: 'ستُحذف الوظيفة ' + job.code + ' نهائياً، وتُغلق فرصة البطاقة ' + serial + ' كمستهلكة — لا تعود الفرصة (قرار معتمد).'
          }).then(function (yes) {
            if (!yes) return;
            Store.deleteJob(job.code);
            UI.toast('warn', 'حُذفت الوظيفة', job.code + ' — أُغلقت فرصة البطاقة ' + serial + '.');
            close();
          });
        });
      },
      onClose:function(){if(stopWatching)stopWatching();renderCurrent();}
    });
  }

  /* ======================= الحجوزات ======================= */
  function renderHolds() {
    var pa = Store.pendingActions();
    var label = document.getElementById('holds-count-label');
    if (label) label.textContent = ((pa.hiring || []).length + (pa.critical || []).length + pa.holds.length) + ' حجز/قرار';
    var host = document.getElementById('holds-list');
    var hiringHtml = (pa.hiring || []).length ? pa.hiring.map(function (h) {
      return '<div class="attempt-slot" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;border-color:#bcd0ea;background:#f2f6fc">' +
        '<div><div class="job"><span class="mono">' + UI.esc(h.job.code) + '</span> — ' + UI.esc(h.job.title) +
        '<small>' + UI.esc(h.job.governorate || '—') + ' · صاحب العمل: ' + UI.esc((h.job.employer || {}).name) + ' · <span dir="ltr">' + UI.esc((h.job.employer || {}).phone) + '</span></small></div>' +
        '<div class="tiny muted mt-1">مكان المقابلة: ' + UI.esc(h.job.interviewLocation) + '</div></div>' +
        '<div><div class="tiny muted">البطاقة</div><div class="mono">' + UI.esc(h.serial || '—') + '</div><div class="tiny">الشاغر '+Number(h.vacancyNo||1)+'</div>' +
        '<span class="badge info">' + (h.decision === 'hire' ? 'طلب توظيف ✅ — ثبتّه أو ألغه' : 'طلب عدم توظيف — القرار بيدك') + '</span>' +
        (h.at ? '<div class="tiny muted mt-1">' + Store.fmtDateTime(h.at) + '</div>' : '') + '</div>' +
        '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-lapis btn-sm" data-hold-manage="' + UI.esc(h.job.code) + '" data-hold-serial="'+UI.esc(h.serial||'')+'" data-attempt-no="'+(h.attempt?h.attempt.no:0)+'">' + UI.ic('check') + ' قرار</button>' +
          '<button class="btn btn-outline btn-sm" data-hold-app="' + UI.esc(h.serial || '') + '">البطاقة</button>' +
        '</div></div>';
    }).join('') : '';
    var criticalHtml = (pa.critical || []).length ? pa.critical.map(function (h) {
      return '<div class="attempt-slot" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;border-color:#f0c3c1;background:#fdf5f4">' +
        '<div><div class="job"><span class="mono">' + UI.esc(h.job.code) + '</span> — ' + UI.esc(h.job.title) +
        '<small>' + UI.esc(h.job.governorate || '—') + ' · صاحب العمل: ' + UI.esc((h.job.employer || {}).name) + ' · <span dir="ltr">' + UI.esc((h.job.employer || {}).phone) + '</span></small></div>' +
        '<div class="tiny muted mt-1">مكان المقابلة: ' + UI.esc(h.job.interviewLocation) + '</div></div>' +
        '<div><div class="tiny muted">البطاقة</div><div class="mono">' + UI.esc(h.serial || '—') + '</div><div class="tiny">الشاغر '+Number(h.vacancyNo||1)+'</div>' +
        (h.decidedBy === 'employer'
          ? '<span class="badge danger">رفض صاحب العمل — معلّقة بيدك</span>' +
            '<div class="tiny" style="margin-top:4px;color:#a5342f;font-weight:700">السبب: ' + UI.esc(h.reason || '—') + '</div>'
          : '<span class="badge danger">حرجة — انتهت مهلة 24 ساعة</span>') + '</div>' +
        '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-danger btn-sm" data-hold-manage="' + UI.esc(h.job.code) + '" data-hold-serial="'+UI.esc(h.serial||'')+'" data-attempt-no="'+(h.attempt?h.attempt.no:0)+'">' + UI.ic('alert') + ' قرار</button>' +
          '<button class="btn btn-outline btn-sm" data-hold-app="' + UI.esc(h.serial || '') + '">البطاقة</button>' +
        '</div></div>';
    }).join('') : '';
    host.innerHTML = hiringHtml + criticalHtml + (pa.holds.length ? pa.holds.map(function (h) {
      var urgent = h.hoursLeft < 4;
      return '<div class="attempt-slot" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) auto;' +
        (urgent ? 'border-color:#f0c3c1;background:#fdf5f4' : '') + '">' +
        '<div><div class="job"><span class="mono">' + UI.esc(h.job.code) + '</span> — ' + UI.esc(h.job.title) +
        '<small>' + UI.esc(h.job.governorate || '—') + ' · صاحب العمل: ' + UI.esc((h.job.employer || {}).name) + ' · <span dir="ltr">' + UI.esc((h.job.employer || {}).phone) + '</span></small></div>' +
        '<div class="tiny muted mt-1">مكان المقابلة: ' + UI.esc(h.job.interviewLocation) + '</div></div>' +
        '<div><div class="tiny muted">البطاقة</div><div class="mono">' + UI.esc(h.serial || '—') + '</div><div class="tiny">الشاغر '+Number(h.vacancyNo||1)+'</div>' +
        UI.holdHtml(h.job.holdExpiresAt) + '</div>' +
        '<div class="flex" style="gap:6px;flex-wrap:wrap">' +
          '<button class="btn btn-lapis btn-sm" data-hold-manage="' + UI.esc(h.job.code) + '" data-hold-serial="'+UI.esc(h.serial||'')+'" data-attempt-no="'+(h.attempt?h.attempt.no:0)+'">إدارة الحجز</button>' +
          '<button class="btn btn-outline btn-sm" data-hold-app="' + UI.esc(h.serial || '') + '">البطاقة</button>' +
        '</div></div>';
    }).join('') : (criticalHtml ? '' : '<div class="table-empty">' + UI.ic('check') + '<div class="mt-2">لا حجوزات ولا حالات حرجة — كل الوظائف متاحة.</div></div>'));

    host.querySelectorAll('[data-hold-manage]').forEach(function (b) {
      b.addEventListener('click', function () { openHoldsModal(b.getAttribute('data-hold-manage'),b.dataset.holdSerial,Number(b.dataset.attemptNo)); });
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
    }).join('') : '<tr><td colspan="7" class="table-empty">لا فرص بحالة حرجة</td></tr>';

    document.querySelectorAll('[data-reassign]').forEach(function (b) {
      b.addEventListener('click', function () {
        var parts = b.getAttribute('data-reassign').split('|');
        jobPickerModal(parts[0], Number(parts[1]));
      });
    });
  }

  /* ======================= سجل التدقيق =======================
   * كل ما يُعرض عربي: أسماء أقسام السجل والعمليات والرتب.
   * الإنجليزية محصورة في معرّفات النظام (كود البطاقة/الوظيفة) لأنها أكواد مطبوعة. */
  /* قاموس السجل: كل قيمة إنجليزية تُترجم — ولا تظهر كلمة إنجليزية في الواجهة
     (بقيت الأكواد المطبوعة فقط: HRC-1042 وباركود البطاقة لأنها معرّفات لا كلمات). */
  var AUDIT_ENTITY = {
    applicant: 'بطاقة', applicants: 'بطاقة', card: 'بطاقة', cards: 'بطاقة',
    job: 'وظيفة', jobs: 'وظيفة', vacancy: 'وظيفة', vacancies: 'وظيفة',
    attempt: 'فرصة', attempts: 'فرصة', chance: 'فرصة',
    staff: 'موظف', user: 'موظف', users: 'موظف', employee: 'موظف',
    settings: 'إعدادات', setting: 'إعدادات', config: 'إعدادات',
    backup: 'نسخة احتياطية', backups: 'نسخة احتياطية', recovery: 'استرجاع',
    audit: 'السجل', log: 'السجل', system: 'النظام', session: 'جلسة',
    hold: 'حجز', holds: 'حجز', print: 'طباعة', finance: 'المالية',
    application: 'استمارة', applications: 'استمارة', form: 'استمارة', forms: 'استمارة'
  };
  var AUDIT_USER = { system: 'النظام (تلقائي)', admin: 'المدير', staff: 'موظف', public: 'زائر' };
  var AUDIT_ACTION = {
    'login': 'دخول', 'log in': 'دخول', 'sign in': 'دخول',
    'logout': 'خروج', 'log out': 'خروج', 'sign out': 'خروج',
    'create': 'إضافة', 'insert': 'إضافة', 'add': 'إضافة',
    'update': 'تعديل', 'edit': 'تعديل', 'delete': 'حذف', 'remove': 'حذف',
    'restore': 'استرجاع', 'backup': 'نسخ احتياطي', 'export': 'تصدير',
    'print': 'طباعة', 'view': 'عرض', 'read': 'عرض'
  };
  /* ── تعريب نصوص السجل (2026-11-07 بطلب المالك) ─────────────────────────────
     مشغّل التدقيق في القاعدة (brc.trg_audit) يكتب حقولاً مختلطة:
       action  = «تعديل/إضافة/حذف» + اسم الجدول   ← «تعديل applicants»
       details = «تغيير في »        + اسم الجدول   ← «تغيير في applicants»
     كما أن بعض سجلات المتجر المحلي تحمل تفاصيل JSON بحقول إنكليزية
     (تعديل مستخدم / تعديل وظيفة). القيم الخام تبقى في القاعدة والتصدير كما هي
     لأنها دليل تدقيق، ونُعرّبها هنا عند العرض فقط: جدول السجل، قوائم الفلاتر،
     و«آخر العمليات». الأكواد المطبوعة (HRC-1042، الرقم التسلسلي، عنوان الشبكة)
     معرّفات لا كلمات فتبقى كما هي وباتجاه ltr. */
  var AUDIT_WORD = {
    applicant: 'بطاقة', applicants: 'بطاقة', card: 'بطاقة', cards: 'بطاقة',
    job: 'وظيفة', jobs: 'وظيفة', vacancy: 'وظيفة', vacancies: 'وظيفة',
    public_jobs: 'وظيفة معلنة', working_jobs: 'وظيفة قيد العمل',
    working_applicants: 'بطاقة', working_job_attempts: 'فرصة',
    attempt: 'فرصة', attempts: 'فرصة', chance: 'فرصة', chances: 'فرصة',
    job_attempts: 'فرصة',
    staff: 'موظف', user: 'موظف', users: 'موظف', employee: 'موظف', employees: 'موظف',
    settings: 'إعدادات', setting: 'إعدادات', config: 'إعدادات',
    audit_log: 'سجل', audit: 'سجل', log: 'سجل', logs: 'سجل',
    backup: 'نسخة احتياطية', backups: 'نسخة احتياطية', recovery: 'استرجاع',
    hold: 'حجز', holds: 'حجز', print: 'طباعة', finance: 'المالية',
    application: 'استمارة', applications: 'استمارة', form: 'استمارة', forms: 'استمارة',
    login: 'دخول', logout: 'خروج', create: 'إضافة', insert: 'إضافة', add: 'إضافة',
    update: 'تعديل', edit: 'تعديل', delete: 'حذف', remove: 'حذف',
    restore: 'استرجاع', export: 'تصدير', view: 'عرض', read: 'عرض',
    system: 'النظام', session: 'جلسة', public: 'زائر', admin: 'مدير عام',
    name: 'الاسم', username: 'اسم المستخدم', role: 'الرتبة', title: 'العنوان',
    status: 'الحالة', code: 'الكود', serial: 'الرقم التسلسلي', active: 'مفعّل',
    governorate: 'المحافظة', shift: 'الدوام', salary: 'الأجر',
    available: 'متاحة', reserved: 'محجوزة', closed: 'مغلقة', expired: 'منتهية',
    critical: 'حرجة', succeeded: 'تم التوظيف', rejected: 'مرفوضة'
  };
  /* جمل كاملة من مشغّل القاعدة: تُكتب بصيغة عربية سليمة لا بترجمة كلمة بكلمة */
  var AUDIT_PHRASE = {
    'تغيير في applicants': 'تعديل بيانات البطاقة',
    'تغيير في jobs': 'تعديل بيانات الوظيفة',
    'تغيير في job_attempts': 'تعديل بيانات الفرصة',
    'تغيير في staff': 'تعديل بيانات الموظف',
    'تغيير في settings': 'تعديل الإعدادات',
    'تغيير في audit_log': 'تحديث السجل'
  };
  /* مفاتيح JSON داخل «التفاصيل» — تُقرأ بحروف صغيرة */
  var AUDIT_FIELD = {
    t: 'العنوان', g: 'المحافظة', s: 'الحالة', n: 'الاسم',
    name: 'الاسم', fullname: 'الاسم الكامل', username: 'اسم المستخدم',
    password: 'كلمة المرور', role: 'الرتبة', title: 'المسمى الوظيفي',
    active: 'مفعّل', status: 'الحالة', code: 'الكود', serial: 'الرقم التسلسلي',
    governorate: 'المحافظة', shift: 'الدوام',
    salarymin: 'أقل أجر', salarymax: 'أعلى أجر',
    before: 'قبل التعديل', after: 'بعد التعديل', diff: 'الفرق'
  };
  var AUDIT_SECRET_KEY = /password|secret|token|card_print_code|chance_code|pin/i;

  /* أي قيمة إنجليزية غير معروفة لا تُعرض كما هي: تُوصف عربياً بدل تسريب كلمة أجنبية */
  var LATIN_ONLY = /^[A-Za-z0-9 _\-\.]+$/;
  function auditTranslateWords(text) {
    return String(text).replace(/[A-Za-z][A-Za-z0-9_]*/g, function (token) {
      return AUDIT_WORD[token.toLowerCase()] || token;
    });
  }
  /* تفاصيل JSON → سطر عربي مقروء: «الاسم: … · الرتبة: …» مع حجب الأسرار */
  function auditJsonFragments(text) {
    return String(text).replace(/\{[^{}]*\}/g, function (frag) {
      var obj;
      try { obj = JSON.parse(frag); } catch (e) { return frag; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return frag;
      var parts = Object.keys(obj).map(function (k) {
        var label = AUDIT_FIELD[k.toLowerCase()] || auditTranslateWords(k);
        var val = obj[k];
        if (val && typeof val === 'object') val = JSON.stringify(val);
        if (AUDIT_SECRET_KEY.test(k)) val = 'محجوب';   /* كلمة عربية: لا رموز تربك اتجاه النص */
        return label + ': ' + String(val == null ? '—' : val);
      });
      return parts.length ? parts.join(' · ') : frag;
    });
  }
  function auditText(v, kind) {
    if (v == null) return '—';
    var s = String(v).trim();
    if (!s) return '—';
    if (AUDIT_PHRASE[s]) return AUDIT_PHRASE[s];
    var key = s.toLowerCase();
    if (kind === 'entity' && AUDIT_ENTITY[key]) return AUDIT_ENTITY[key];
    if (kind === 'action' && AUDIT_ACTION[key]) return AUDIT_ACTION[key];
    var out = auditTranslateWords(auditJsonFragments(s));
    if (LATIN_ONLY.test(s) && !/[\u0600-\u06FF]/.test(out)) {
      return kind === 'entity' ? 'سجل' : (kind === 'action' ? 'عملية' : out);
    }
    return out;
  }
  function auditEntityLabel(v) { return auditText(v, 'entity'); }
  function auditActionLabel(v) { return auditText(v, 'action'); }
  function auditDetailsLabel(v) { return auditText(v, 'details'); }

  /* البحث يطابق التسمية المعروضة أيضاً: «بطاقة» يجد سطر «تعديل applicants».
     التسجيل هنا لا يغيّر القيم الخام ولا التصدير ولا القاعدة — نص البحث فقط. */
  if (Store.setAuditDisplayLabels) {
    Store.setAuditDisplayLabels(function (r) {
      return [auditActionLabel(r.action), auditEntityLabel(r.entity),
        auditDetailsLabel(r.details)].join(' ');
    });
  }

  /* عرض التاريخ بالعربية داخل حقل «من/إلى تاريخ» (السجل).
     القيمة الحقيقية تبقى في input[type=date] المخفي، والعرض نص عربي فقط. */
  var AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
    'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  function arabicDateText(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    if (!m) return '';
    var d = Number(m[3]), mo = Number(m[2]) - 1, y = m[1];
    if (!AR_MONTHS[mo]) return '';
    return d + ' ' + AR_MONTHS[mo] + ' ' + y;      /* مثال: 27 تشرين الأول 2026 */
  }
  function paintArabicDates() {
    document.querySelectorAll('.date-ar').forEach(function (wrap) {
      var input = wrap.querySelector('input[type="date"]');
      var label = wrap.querySelector('.da-text');
      if (!input || !label) return;
      var txt = arabicDateText(input.value);
      label.textContent = txt || 'اختر التاريخ';
      label.classList.toggle('is-empty', !txt);
    });
  }

  function readAuditFilters() {
    ['q', 'user', 'role', 'action', 'entity', 'from', 'to', 'sort'].forEach(function (key) {
      var input = document.getElementById('log-' + key);
      if (input) state.log[key] = input.value;
    });
    if (!Store.isAdmin() && Store.currentUser()) state.log.user = Store.currentUser().username;
  }

  function renderAudit() {
    /* السجل مؤجَّل عن الإقلاع: أول فتح يطلبه في الخلفية ثم يُعاد الرسم */
    if (Store.db().meta && Store.db().meta.auditPending && !renderAudit._asked) {
      renderAudit._asked = true;
      Store.loadAuditLog().then(function (done) {
        renderAudit._asked = false;
        if (done && state.view === 'audit') renderAudit();
      }).catch(function () { renderAudit._asked = false; });
    }
    var available = Store.listAudit({});
    /* الفلاتر تُعرض عربية بالكامل: القيمة للمنطق والتسمية للعين */
    [['user', 'user', 'كل المستخدمين'], ['action', 'action', 'كل العمليات'], ['entity', 'entity', 'كل الأقسام']].forEach(function (spec) {
      var select = document.getElementById('log-' + spec[0]);
      if (!select) return;
      var values = available.map(function (r) { return r[spec[1]]; }).filter(Boolean);
      values = Array.from(new Set(values)).sort();
      if (state.log[spec[0]] !== 'all' && values.indexOf(state.log[spec[0]]) < 0) values.push(state.log[spec[0]]);
      var label = function (v) {
        if (spec[0] === 'user') return AUDIT_USER[v] || v;
        if (spec[0] === 'entity') return auditEntityLabel(v);
        return auditActionLabel(v);
      };
      select.innerHTML = '<option value="all">' + UI.esc(spec[2]) + '</option>' +
        values.map(function (v) { return '<option value="' + UI.esc(v) + '">' + UI.esc(label(v)) + '</option>'; }).join('');
      select.value = state.log[spec[0]];
    });
    paintArabicDates();
    var invalid = !!(state.log.from && state.log.to && state.log.from > state.log.to);
    var error = document.getElementById('log-date-error');
    if (error) error.classList.toggle('hidden', !invalid);
    var rows = invalid ? [] : Store.listAudit(state.log);
    var pages = Math.max(1, Math.ceil(rows.length / state.logPageSize));
    state.logPage = Math.max(1, Math.min(state.logPage, pages));
    var start = (state.logPage - 1) * state.logPageSize;
    var info = document.getElementById('log-page-info');
    if (info) info.textContent = state.logPage + ' / ' + pages;
    document.getElementById('log-prev').disabled = state.logPage <= 1;
    document.getElementById('log-next').disabled = state.logPage >= pages;
    document.getElementById('btn-export-audit').disabled = invalid || !rows.length;
    var summary = document.getElementById('log-filter-summary');
    if (summary) summary.textContent = 'عرض ' + (rows.length ? start + 1 : 0) + '–' + Math.min(start + state.logPageSize, rows.length) +
      ' من ' + rows.length + ' نتيجة — إجمالي السجل المحمّل: ' + available.length;
    document.querySelectorAll('[data-audit-range]').forEach(function (button) {
      button.setAttribute('aria-pressed', 'false');
    });
    var label = document.getElementById('audit-count-label');
    if (label) label.textContent = rows.length + ' سجل';
    document.getElementById('audit-table-body').innerHTML = rows.slice(start, start + state.logPageSize).map(function (l) {
      var roleBadge = l.role === 'admin' ? '<span class="badge danger">مدير عام</span>'
        : (l.role === 'staff' ? '<span class="badge info">موظف</span>' : '<span class="badge muted">النظام</span>');
      var who = l.name || AUDIT_USER[l.user] || l.user;
      return '<tr>' +
        '<td class="at-time">' + UI.esc(Store.fmtDateTime(l.ts)) + '</td>' +
        '<td class="at-who">' + UI.esc(who) + '</td>' +
        '<td class="at-role">' + roleBadge + '</td>' +
        '<td class="at-entity">' + UI.esc(auditEntityLabel(l.entity)) +
          (l.entityId ? ' <span class="tiny muted mono" dir="ltr">' + UI.esc(l.entityId) + '</span>' : '') + '</td>' +
        '<td class="at-action"><b>' + UI.esc(auditActionLabel(l.action)) + '</b></td>' +
        '<td class="at-details">' + UI.esc(auditDetailsLabel(l.details)) + '</td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="6" class="table-empty">لا سجلات مطابقة</td></tr>';
  }

  /* ======================= اللوحة المالية ======================= */
  function renderFinance(report) {
    if(Store.db().meta.workspace&&!report){
      var ticket=++financeTicket,key=JSON.stringify(state.fin),owner=sessionKey();
      document.getElementById('fin-stats').textContent='جاري قراءة التقرير الكامل من القاعدة، بما فيه المؤرشف…';document.getElementById('fin-bars').replaceChildren();document.getElementById('fin-table-body').replaceChildren();
      Store.cardReport(state.fin.from,state.fin.to).then(function(data){if(ticket===financeTicket&&key===JSON.stringify(state.fin)&&owner===sessionKey()&&state.view==='finance')renderFinance(data);}).catch(function(e){if(ticket===financeTicket&&owner===sessionKey())document.getElementById('fin-stats').textContent=e.message+' — لم تستخدم بيانات العمل الجزئية بدلاً من الإجمالي';});return;
    }
    var rows = report?report.rows:Store.financials(state.fin.from, state.fin.to);
    var totals = report?rows.reduce(function(t,r){['forms','printed','expected','collected','hires','holds'].forEach(function(k){t[k]+=Number(r[k]||0);});return t;},{forms:0,printed:0,expected:0,collected:0,hires:0,holds:0}):Store.financialTotals(state.fin.from, state.fin.to);
    document.getElementById('finance-scope').textContent=Store.db().meta.workspace?'التقرير يشمل السجل الكامل والمؤرشف. تعديلات رسوم البطاقات الحالية تظهر بعد نجاح المزامنة.':'';
    var stats = [
      { icon: 'file', label: 'إجمالي الاستمارات', value: totals.forms, hint: totals.printed + ' عملية طباعة' },
      { icon: 'money', label: 'المتوقع تحصيله', value: Store.money(totals.expected), hint: 'سعر البطاقة ' + Store.money(Store.settings().formFee), accent: true },
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
      return '<div class="bar-row"><div>' + UI.esc(r.name) + '<div class="tiny muted mono" tabindex="0" aria-label="اسم المستخدم، قابل للتمرير أفقياً">' + UI.esc(r.user) + '</div></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(r.expected / max * 100) + '%"></div></div>' +
        '<div class="val">' + Store.money(r.expected) + '</div></div>';
    }).join('') : '<div class="table-empty">لا بيانات في هذه الفترة</div>';

    document.getElementById('fin-table-body').innerHTML = rows.map(function (r) {
      return '<tr><td><b>' + UI.esc(r.name) + '</b><div class="tiny muted mono">' + UI.esc(r.user) + '</div></td>' +
        '<td>' + r.forms + '</td><td>' + r.printed + '</td><td>' + Store.money(Store.settings().formFee) + '</td>' +
        '<td><b>' + Store.money(r.expected) + '</b></td>' +
        '<td><input '+(Store.db().meta.workspace?'disabled title="إجمالي شامل للأرشيف؛ تعديل رسم بطاقة حالية من تفاصيلها" ':'')+'type="number" class="fin-collected" data-user="' + UI.esc(r.user) + '" value="' + r.collected + '" min="0" step="1000" style="width:120px;padding:4px 8px;border:1px solid #ddd;border-radius:6px"></td>' +
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
    set('set-attempts', s.attemptLimit);
    set('set-days', s.validityDays);
    set('set-hours', s.holdHours); set('set-fee', s.formFee);
    /* عدد الفرص قابل للتعديل للبطاقات الجديدة؛ لا إفراج تلقائي عن الحجز. */
    var db = Store.db();
    set('db-jobs', db.jobs.length); set('db-apps', db.applicants.length);
    set('db-attempts', db.attempts.length); set('db-audit', db.audit.length);
    var backups = Store.listBackupMeta();
    set('db-backups', backups.length);
    var vb = document.getElementById('set-verify-base');
    if (vb) vb.textContent = CFG.verifyBase;

    // الأزرار تُربط هنا أيضاً (ربط آمن لا يتكرر) لتبقى تعمل بعد أي إعادة رسم
    mountRecovery();


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
    bindInput('j-governorate', state.j, 'governorate', renderJobs);
    bindInput('j-shift', state.j, 'shift', renderJobs);
    bindInput('aq', state.a, 'q', renderApplicants);
    bindInput('a-status', state.a, 'status', renderApplicants);
    bindInput('a-user', state.a, 'user', renderApplicants);
    var refreshAuditFilters = function () { readAuditFilters(); state.logPage = 1; renderAudit(); };
    var delayedAuditSearch = UI.debounce(refreshAuditFilters, 180);
    document.getElementById('log-q').addEventListener('input', delayedAuditSearch);
    ['user', 'role', 'action', 'entity', 'from', 'to', 'sort'].forEach(function (key) {
      document.getElementById('log-' + key).addEventListener('change', refreshAuditFilters);
    });
    document.getElementById('log-page-size').addEventListener('change', function () {
      state.logPageSize = Number(this.value); state.logPage = 1; readAuditFilters(); renderAudit();
    });
    document.getElementById('log-prev').addEventListener('click', function () { state.logPage--; readAuditFilters(); renderAudit(); });
    document.getElementById('log-next').addEventListener('click', function () { state.logPage++; readAuditFilters(); renderAudit(); });
    document.getElementById('log-reset').addEventListener('click', function () {
      ['q', 'from', 'to'].forEach(function (key) { document.getElementById('log-' + key).value = ''; });
      ['user', 'role', 'action', 'entity'].forEach(function (key) { document.getElementById('log-' + key).value = 'all'; });
      document.getElementById('log-sort').value = 'newest';
      refreshAuditFilters();
    });
    document.querySelectorAll('[data-audit-range]').forEach(function (button) {
      button.addEventListener('click', function () {
        var range = button.getAttribute('data-audit-range');
        var offset = range === 'yesterday' ? -1 : range === 'week' ? -6 : range === 'month' ? -29 : 0;
        document.getElementById('log-from').value = dayOffset(offset);
        document.getElementById('log-to').value = dayOffset(range === 'yesterday' ? -1 : 0);
        refreshAuditFilters(); button.setAttribute('aria-pressed', 'true');
      });
    });
    bindInput('fin-from', state.fin, 'from', renderFinance);
    bindInput('fin-to', state.fin, 'to', renderFinance);

    /* فلاتر سريعة للّوحة المالية: اليوم / أمس / الكل.
       نضبط الحقلين معاً حتى تبقى الواجهة صادقة مع الحالة المعروضة. */
    function setFinRange(from, to) {
      state.fin = { from: from, to: to };
      var a = document.getElementById('fin-from'), b = document.getElementById('fin-to');
      if (a) a.value = from; if (b) b.value = to;
      renderFinance();
    }
    function dayOffset(n) { return Store.dayOffset(n); }

    var finToday = document.getElementById('btn-fin-today');
    if (finToday) finToday.addEventListener('click', function () {
      var t = dayOffset(0); setFinRange(t, t);
    });

    var finYesterday = document.getElementById('btn-fin-yesterday');
    if (finYesterday) finYesterday.addEventListener('click', function () {
      var y = dayOffset(-1); setFinRange(y, y);
    });

    var finReset = document.getElementById('btn-fin-reset');
    if (finReset) finReset.addEventListener('click', function () {
      setFinRange('', '');
    });

    // البحث السريع بالكود (وظيفة أو بطاقة)
    var qc = document.getElementById('quick-code-form');
    if (qc) qc.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (document.getElementById('quick-code').value || '').trim().toUpperCase();
      if (!v) return;
      /* بادئة واحدة HRC، والرقم المجرّد (6 خانات) يُكمَّل بها — تدعم بطاقة HRC-BC القديمة بصيغة HRC-NO للبيانات التاريخية */
      var serial = null;
      if (Store.isCardSerial(v)) serial = Store.normalizeCardSerial(v);
      else if (/^HRC-NO/i.test(v)) serial = v.replace(/^HRC-NO/i, 'HRC-BC');
      if (serial && Store.getApplicant(serial)) { attemptsModal(serial); return; }
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
      if (!Store.isAdmin()) { UI.toast('err', 'غير مسموح', 'تعديل القواعد للمدير فقط.'); return; }
      var limit = Number(document.getElementById('set-attempts').value);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
        UI.toast('err', 'عدد فرص غير صالح', 'اختر عدداً صحيحاً من 1 إلى 10.'); return;
      }
      var patch = {
        attemptLimit: limit,
        validityDays: Number(document.getElementById('set-days').value),
        holdHours: Number(document.getElementById('set-hours').value),
        formFee: Number(document.getElementById('set-fee').value),
        autoReleaseEnabled: false               // مقفلة: لا إفراج تلقائي — قرار يدوي للحالة الحرجة
      };
      Store.updateSettings(patch);
      UI.toast('ok', 'حُفظت الإعدادات', 'طُبّقت القواعد الجديدة على النظام.');
    });
  }

  function quickJobModal(code) {
    var j = Store.getJob(code);
    if (!j) return;
    var attempts = Store.db().attempts.filter(function (t) { return t.jobCode === code; });
    var body = '<p class="jobs-scroll-hint">اسحب التفاصيل أفقياً لقراءة النص الكامل عند الحاجة.</p><div class="job-details-scroll" tabindex="0" role="region" aria-label="تفاصيل الوظيفة — مرّر أفقياً لعرض النص الكامل"><div class="data-grid job-details-grid mb-3">' +
      '<div class="data-item"><div class="k">الحالة</div><div class="v">' + CFG.jobStatus[j.status].ar + '</div></div>' +
      '<div class="data-item"><div class="k">المحافظة</div><div class="v">' + UI.esc(j.governorate || '—') + '</div></div>' +
      '<div class="data-item"><div class="k">الأجر</div><div class="v">' + Store.money(j.salaryMin) + ' - ' + Store.money(j.salaryMax) + '</div></div>' +
      '<div class="data-item"><div class="k">الدوام</div><div class="v">' + UI.esc(j.shift) + '</div></div>' +
      '<div class="data-item"><div class="k">صاحب العمل (داخلي)</div><div class="v">' + UI.esc((j.employer || {}).name || '—') + '</div></div>' +
      '<div class="data-item"><div class="k">هاتفه (داخلي)</div><div class="v mono" dir="ltr">' + UI.esc((j.employer || {}).phone || '—') + '</div></div>' +
      '<div class="data-item" style="grid-column:1/-1"><div class="k">العنوان (داخلي)</div><div class="v">' + UI.esc((j.employer || {}).address || '—') + '</div></div>' +
      '<div class="data-item" style="grid-column:1/-1"><div class="k">مكان المقابلة</div><div class="v">' + UI.esc(j.interviewLocation) + '</div></div>' +
      '</div></div>' +
      (j.status === 'reserved' && j.holdExpiresAt
        ? '<div class="panel" style="background:#fdf1d8;border-color:#f0d9a3"><div class="panel-body" style="padding:12px 15px">' +
          '<p class="mb-0 small">' + UI.ic('hourglass') + ' محجوزة للبطاقة <b class="mono">' + UI.esc(j.reservedBy) + '</b> — ' + UI.holdHtml(j.holdExpiresAt) + '</p></div></div>' : '') +
      '<div class="table-wrap mt-3"><div class="table-scroll" tabindex="0" role="region" aria-label="جدول البيانات — تمرير أفقي عند الحاجة"><table class="data" style="min-width:520px">' +
      '<thead><tr><th>البطاقة</th><th>الفرصة</th><th>الحالة</th><th>وقت الاختيار</th></tr></thead><tbody>' +
      (attempts.length ? attempts.map(function (t) {
        return '<tr><td class="mono">' + UI.esc(t.serial) + '</td><td>#' + t.no + '</td><td>' + UI.slotBadge(t.slotStatus) + '</td>' +
          '<td class="tiny" dir="ltr">' + Store.fmtDateTime(t.selectedAt) + '</td></tr>';
      }).join('') : '<tr><td colspan="4" class="table-empty">لا فرص على هذه الوظيفة</td></tr>') +
      '</tbody></table></div></div>';

    UI.modal({
      title: j.title + ' — ' + j.code, subtitle: 'بطاقة الوظيفة الداخلية (تظهر للموظفين فقط)', wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إغلاق</button>' +
        '<button class="btn btn-lapis" id="q-edit">' + UI.ic('edit') + ' تعديل</button>' +
        (j.status === 'reserved' ? '<button class="btn btn-warn" id="q-hold">إدارة الحجز</button>' :
          (j.status === 'available' ? '<button class="btn btn-gold" id="q-assign">' + UI.ic('user-plus') + ' ترشيح</button>'
            : '<button class="btn btn-ok" id="q-reopen">إعادة تفعيل</button>')),
      onMount: function (box, close) {
        box.classList.add('job-details-modal');
        var heading = box.querySelector('.modal-head h3');
        if (heading) heading.tabIndex = 0;
        box.querySelector('#q-edit').addEventListener('click', function () { close(); jobModal(code); });
        var a = box.querySelector('#q-assign'); if (a) a.addEventListener('click', function () { close(); pickApplicantModal(code); });
        var h = box.querySelector('#q-hold'); if (h) h.addEventListener('click', function () { close(); openHoldsModal(code); });
        var r = box.querySelector('#q-reopen'); if (r) r.addEventListener('click', function () {
          Store.setJobStatus(code, 'available', 'إعادة تفعيل'); close(); UI.toast('ok', 'أُعيد التفعيل', code);
        });
      }
    });
  }

  var recoveryLoading = false;
  function mountRecovery() {
    if (state.view !== 'settings') return;
    if (!Store.isAdmin()) return;
    var demo = !Store.cloudStatus().enforceAuth;
    var module = demo ? root.HRCLegacyBackup : root.HRCRecovery;
    if (module) { module.mount(); return; }
    if (recoveryLoading) return;
    recoveryLoading = true;
    var source = document.querySelector('script[src*="/dashboard.js"]');
    var js = document.createElement('script');
    js.src = 'assets/js/' + (demo ? 'legacy-backup.js' : 'recovery.js') + (source ? new URL(source.src).search : '');
    js.onload = function () { recoveryLoading = false; mountRecovery(); };
    js.onerror = function () { recoveryLoading = false; UI.toast('err', 'تعذر تحميل النسخ', 'أعد فتح الإعدادات بعد التأكد من الاتصال'); };
    document.head.appendChild(js);
  }

  function bindArabicDates() {
    document.querySelectorAll('.date-ar input[type="date"]').forEach(function (input) {
      ['change', 'input'].forEach(function (ev) {
        input.addEventListener(ev, paintArabicDates);
      });
    });
    paintArabicDates();
  }

  function bindActions() {
    var history=document.getElementById('btn-card-history');if(history)history.onclick=function(){if(root.HRCArchive)return root.HRCArchive.open(Store,UI);history.disabled=true;var js=document.createElement('script');js.src='assets/js/card-archive.js';js.onload=function(){history.disabled=false;root.HRCArchive.open(Store,UI);};js.onerror=function(){history.disabled=false;UI.toast('err','تعذر فتح السجل','تحقق من الاتصال وأعد المحاولة');};document.head.appendChild(js);};
    var nj = document.getElementById('btn-new-job');
    if (nj) nj.addEventListener('click', function () { jobModal(null); });
    var nb = document.getElementById('btn-new-batch');
    if (nb) nb.addEventListener('click', newBatchModal);
    var nc = document.getElementById('btn-new-card');
    if (nc) nc.addEventListener('click', newCardModal);
    var rm = document.getElementById('btn-run-maintenance');
    if (rm) rm.addEventListener('click', function () {
      var actions = Store.runMaintenance();
      UI.toast(actions.length ? 'warn' : 'ok', actions.length ? 'نُفّذت إجراءات تلقائية' : 'لا إجراءات معلّقة',
        actions.length ? actions.length + ' قراراً مطلوباً (حرجة/انتهاء صلاحية)' : 'كل الحجوزات سارية.');
      renderCurrent();
    });
    /* زر إضافة موظف */
    var addUserBtn = document.getElementById('btn-add-user');
    if (addUserBtn) addUserBtn.addEventListener('click', function () { userModal(); });

    var ea = document.getElementById('btn-export-audit');
    if (ea) ea.addEventListener('click', function () {
      readAuditFilters();
      if (state.log.from && state.log.to && state.log.from > state.log.to) { renderAudit(); return; }
      var rows = Store.listAudit(state.log);
      var csv = 'ts,user,name,role,ip,action,entity,entityId,details\n' + rows.map(function (l) {
        /* التصدير بالعربية أيضاً، والقيمة الخام محفوظة في القاعدة كدليل تدقيق */
        return [Store.fmtDateTime(l.ts), l.user, l.name, l.role, l.ip,
          auditActionLabel(l.action), auditEntityLabel(l.entity), l.entityId,
          l.details ? auditDetailsLabel(l.details) : '']
          .map(function (x) {
            var value = String(x == null ? '' : x);
            if (/^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) value = "'" + value;
            return '"' + value.replace(/"/g, '""') + '"';
          }).join(',');
      }).join('\n');
      UI.download('hrc-audit-' + Store.fmtDate(new Date()) + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
      UI.toast('ok', 'تصدير السجل', rows.length + ' سجل بصيغة CSV.');
    });


  }

  /* ======================= النسخ الاحتياطي والجدولة =======================
   *  تُستدعى من bindActions() عند الإقلاع ومن renderSettings() بعد كل
   *  إعادة رسم — bindOnce يضمن ألا يُربط الزر مرتين (لا نوافذ مكرّرة). */
  /* إضافة بطاقة مفردة بكودها (الإدارة): بطاقة واحدة فارغة بباركود يكتبه
     المستخدم أو يولّده — لطباعة بطاقة خاصة فوراً دون إصدار دفعة كاملة. */
  function newCardModal() {
    /* إصدار البطاقات حصرياً للمدير (2026-11-11). */
    if (!Store.isAdmin()) { UI.toast('err', 'صلاحية المدير فقط', 'إصدار البطاقات من صلاحيات المدير العام.'); return; }
    var body = '<form id="card1-form" onsubmit="return false">' +
      '<div class="field"><label for="c-code">كود البطاقة (الباركود) *</label>' +
        '<div style="display:flex;gap:8px;align-items:stretch">' +
          '<input type="text" id="c-code" class="mono" dir="ltr" placeholder="7KQ4M9TR2X" maxlength="10" autocomplete="off" required style="flex:1;letter-spacing:.14em;text-transform:uppercase">' +
          '<button type="button" class="btn btn-outline" id="c-gen" style="white-space:nowrap">' + UI.ic('refresh') + ' ولّد كوداً</button>' +
        '</div>' +
        '<span class="tiny muted" style="display:block;margin-top:6px">10 خانات من <b>حروف وأرقام</b> بلا شرطة ولا بادئة — يجب أن يكون فريداً ولم يُستعمل من قبل.</span>' +
        '<div class="tiny" id="c-err" style="display:none;color:#c0392b;background:#fdeeee;border:1px solid #f2c4c4;border-radius:8px;padding:6px 10px;margin-top:8px"></div>' +
      '</div>' +
      '<div class="field" style="margin-top:12px"><label for="c-notes">ملاحظة (اختياري)</label>' +
        '<input type="text" id="c-notes" placeholder="مثال: بطاقة تعويض للسيد أحمد — مكتب الحلة"></div>' +
      '</form>' +
      '<div class="panel mt-2" style="background:#fdf9ee;border-color:var(--line)"><div class="panel-body" style="padding:12px 15px">' +
        '<p class="mb-0 small">' + UI.ic('shield') + ' تُسجَّل البطاقة <b>فارغة</b> (بلا اسم وبلا هاتف) بفرص حسب الإعدادات، وتُطبع بوجهيها بمقاس 59.4×94.6مم — ' +
        'وصلاحية 30 يوماً تبدأ عند أول تقديم ناجح على وظيفة. الكود المسجَّل لا يعود أبداً ولو حُذفت بطاقته.</p></div></div>';

    UI.modal({
      title: 'إضافة بطاقة بكودها', subtitle: 'بطاقة واحدة فارغة تُسجَّل فوراً بالمخزون — بلا دفعة كاملة',
      body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-gold" id="c-save">' + UI.ic('card') + ' إضافة البطاقة</button>',
      onMount: function (box, close) {
        var codeInp = box.querySelector('#c-code');
        var errBox = box.querySelector('#c-err');
        if (Store.pendingCardIssue()) { errBox.textContent='يوجد طلب سابق لم يصل تأكيده؛ الضغط على إضافة يسترجع نفس الطلب أولاً دون إصدار جديد.'; errBox.style.display='block'; }
        codeInp.value = Store.suggestSerial();
        codeInp.addEventListener('input', function () { codeInp.value = codeInp.value.toUpperCase().replace(/\s+/g, ''); });
        box.querySelector('#c-gen').addEventListener('click', function () {
          codeInp.value = Store.suggestSerial();
          errBox.style.display = 'none';
        });
        box.querySelector('#c-save').addEventListener('click', async function () {
          var serial = String(codeInp.value || '').trim();
          var notes = box.querySelector('#c-notes').value.trim();
          errBox.style.display = 'none';
          if (!serial) { codeInp.focus(); return; }
          var btn=box.querySelector('#c-save'); btn.disabled=true; codeInp.disabled=true;
          try {
            /* حماية من إعادة إصدار كود سبق طبعه: البطاقة المحذوفة/المؤرشفة لا
               تعود إلى التداول بكودها أبداً (قرار المالك). التحقق من السجل
               الدائم في القاعدة — لا من الذاكرة المحلية وحدها، لأن البطاقة
               قد تكون محذوفة من هذه الجلسة.

               قاعدة معطّلة/بلا اتصال: لا نُسقط الإصدار كله. الحماية الحقيقية
               على الخادم (brc.staff_issuance_registry يقابل السجل الدائم)،
               وissueNumberedCards نفسها تشترط اتصالاً وحساب مدير. نكتفي هنا
               بالفحص المحلي المتاح حتى لا يتعطّل العمل بلا إنترنت. */
            try {
              if (await Store.serialWasIssued(Store.normalizeCardSerial(serial))) {
                throw new Error('هذا الكود صدر وطُبع سابقاً (بطاقة مؤرشفة أو محذوفة) ولا يمكن إعادة إصداره — ولّد كوداً جديداً بالزر أعلاه.');
              }
            } catch (guardErr) {
              /* رسالة الحماية تُمرَّر؛ أي عطل في التحقق نفسه لا يمنع الإصدار. */
              if (/صدر وطُبع سابقاً/.test(String(guardErr && guardErr.message))) throw guardErr;
            }
            var cards=await Store.issueNumberedCards(1,Store.normalizeCardSerial(serial),notes);
            if (!document.contains(box)) return;
            close();
            if (cards.length===1) cardResultModal(cards[0]); else batchResultModal(cards);
          } catch(e) { errBox.textContent=e.message; errBox.style.display='block'; }
          finally { btn.disabled=false; codeInp.disabled=false; }

        });
      }
    });
  }

  /* نتيجة إضافة البطاقة: الكود + طباعتها فوراً */
  function cardResultModal(card) {
    UI.modal({
      title: 'أُضيفت البطاقة ' + card.serial,
      subtitle: 'بطاقة فارغة واحدة بالمخزون — بفرص حسب الإعدادات',
      body: '<div class="panel mb-2" style="background:#eef7f2;border-color:#bfe0d0"><div class="panel-body" style="padding:12px 15px">' +
          '<p class="mb-0 small">' + UI.ic('check') + ' سُجّلت البطاقة بالمخزون وجاهزة للبيع والتعبئة. ' +
          'اطبعها الآن على <b>ورق مقوى 300–350غم</b> بخيار «الحجم الفعلي» — صفحتان (وجه أمامي وخلفي) بمقاس 59.4×94.6مم، وتُغلَّف حرارياً بمكتب الاستنساخ.</p></div></div>' +
        '<div style="text-align:center"><span class="chip chip-code mono" dir="ltr" style="font-size:15px">' + UI.esc(card.serial) + '</span></div>',
      footer: '<button class="btn btn-outline" data-close>لاحقاً</button>' +
        '<button class="btn btn-gold" id="c-print">' + UI.ic('print') + ' طباعة البطاقة</button>',
      onMount: function (box) {
        box.querySelector('#c-print').addEventListener('click', function () {
          V.printBatch([card]);
        });
      }
    });
  }

  /* إصدار دفعة بطاقات فارغة (الإدارة): باركودات عشوائية فريدة لا تتشابه —
     تُطبع فارغة وتوزَّع على نقاط البيع، وتُعبّأ كل واحدة عند بيعها. */
  function newBatchModal() {
    /* إصدار البطاقات حصرياً للمدير (2026-11-11). */
    if (!Store.isAdmin()) { UI.toast('err', 'صلاحية المدير فقط', 'إصدار البطاقات من صلاحيات المدير العام.'); return; }
    /* قرار 2026-11-11: أي عدد من 1 إلى 60 مسموح — لا قيد المضاعفات. صفوف
       الأوراق 2×2، فآخر ورقة قد تحمل بطاقة يتيمة واحدة؛ التقسيم في الطباعة
       يتكفّل بها. أزرار المضاعفات تبقى اختصاراً سريعاً للأعداد الشائعة. */
    var BATCH_MIN = 1, BATCH_MAX = 60, SHEET = 4;
    var presets = [];
    for (var pv = SHEET; pv <= BATCH_MAX; pv += SHEET) presets.push(pv);
    var chips = presets.map(function (n) {
      return '<button type="button" class="btn btn-outline btn-sm b-preset" data-n="' + n + '">' + n + '</button>';
    }).join(' ');
    var body = '<form id="batch-form" class="grid grid-2" style="gap:14px">' +
      '<div class="field" style="grid-column:1/-1"><label for="b-count">عدد البطاقات بالدفعة * (من ١ إلى ٦٠ — أي عدد)</label>' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<input type="number" id="b-count" min="1" max="60" step="1" value="4" required style="width:140px">' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' + chips + '</div></div>' +
        '<span class="tiny muted" id="b-est" style="display:block;margin-top:6px"></span></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="b-notes">ملاحظة الدفعة</label><input type="text" id="b-notes" placeholder="مثال: دفعة شهر تشرين — مكاتب الحلة"></div>' +
      '</form>' +
      '<div class="panel mt-2" style="background:#fdf9ee;border-color:var(--line)"><div class="panel-body" style="padding:12px 15px">' +
        '<p class="mb-0 small">' + UI.ic('shield') + ' كل بطاقة تولد <b>بكود عشوائي فريد</b> من 10 خانات (حروف وأرقام بلا شرطة) لا يتشابه مع أي بطاقة أخرى ولا يعود أبداً — ' +
        'لا نمط يمكن تخمينه، وهذا أساس منع التزوير. البطاقات تُطبع <b>فارغة</b> (بلا اسم وبلا هاتف) وبتصميم الوجهين، ' +
        'وتُعبّأ بيانات الزبون عند البيع — وصلاحية 30 يوماً تبدأ عند أول تقديم ناجح على وظيفة.</p></div></div>';

    UI.modal({
      title: 'إصدار دفعة بطاقات فارغة', subtitle: 'أكواد عشوائية فريدة — تُطبع على ورق A4 (4 بطاقات بالصفحة) وتوزَّع على نقاط البيع', wide: true, body: body,
      footer: '<button class="btn btn-outline" data-close>إلغاء</button>' +
        '<button class="btn btn-gold" id="b-save">' + UI.ic('card') + ' إصدار الدفعة</button>',
      onMount: function (box, close) {
        var cnt = box.querySelector('#b-count');
        var est = box.querySelector('#b-est');
        if (Store.pendingCardIssue()) UI.toast('err','طلب سابق قيد التأكيد','الضغط على إصدار يسترجع الطلب السابق أولاً دون إصدار دفعة جديدة.');
        function refresh() {
          var n = Number(cnt.value) || 0;
          var sheets = V.sheetCount ? V.sheetCount(n) : Math.ceil(n / 4);
          var ok = Number.isInteger(n) && n >= BATCH_MIN && n <= BATCH_MAX;
          var lastSheet = ok && n % SHEET ? ' — آخر ورقة تحمل ' + (n % SHEET) + ' فقط' : '';
          est.textContent = ok
            ? ('ستُطبع على ' + sheets + ' ورقة A4 بوجهين (' + (sheets * 2) + ' صفحة) — 4 بطاقات بالورقة، بمسافة 20مم للقصّ بين كل بطاقة' + lastSheet)
            : ('أدخل عدداً صحيحاً من ' + BATCH_MIN + ' إلى ' + BATCH_MAX + '.');
        }
        cnt.addEventListener('input', refresh);
        box.querySelectorAll('.b-preset').forEach(function (b) {
          b.addEventListener('click', function () { cnt.value = b.getAttribute('data-n'); refresh(); });
        });
        refresh();
        box.querySelector('#b-save').addEventListener('click', async function () {
          var f = box.querySelector('#batch-form');
          if (!f.reportValidity()) return;
          var count = Number(cnt.value) || 0;
          if (!Number.isInteger(count) || count < BATCH_MIN || count > BATCH_MAX) {
            UI.toast('err', 'عدد غير صالح', 'أدخل عدداً صحيحاً من ' + BATCH_MIN + ' إلى ' + BATCH_MAX + '.'); return;
          }
          var notes = box.querySelector('#b-notes').value.trim();
          var btn=box.querySelector('#b-save'); btn.disabled=true;
          try {
            var made=await Store.issueNumberedCards(count,null,notes);
            if (!document.contains(box)) return;
            close();
            if (made.length===1) cardResultModal(made[0]); else batchResultModal(made);
          } catch(e) { UI.toast('err','تعذّر تأكيد الإصدار',e.message); }
          finally { btn.disabled=false; }

        });
      }
    });
  }

  /* نتيجة الدفعة: قائمة الباركودات + طباعتها كلها فارغة */
  function batchResultModal(made) {
    var chips = made.slice(0, 60).map(function (c) {
      return '<span class="chip chip-code mono tiny" dir="ltr">' + UI.esc(c.serial) + '</span>';
    }).join(' ') + (made.length > 60 ? '<span class="tiny muted">… و' + (made.length - 60) + ' أخرى</span>' : '');
    UI.modal({
      title: 'صدرت الدفعة — ' + made.length + ' بطاقة فارغة',
      subtitle: 'أكواد عشوائية فريدة — تُطبع الآن على A4 وتوزَّع على نقاط البيع',
      wide: true,
      body: '<div class="panel mb-2" style="background:#eef7f2;border-color:#bfe0d0"><div class="panel-body" style="padding:12px 15px">' +
          '<p class="mb-0 small">' + UI.ic('check') + ' سُجّلت الدفعة بالمخزون. اطبعها على <b>ورق A4</b> — <b>4 بطاقات بكل صفحة</b> بمقاس 59.4×94.6مم، ' +
          'موسّطة في وسط الورقة وبينها <b>20مم مساحة قطع</b> (10مم حول كل بطاقة) فالقصّ لا يمسّ التصميم. ' +
          'والباقي على الصفحات التالية. للطباعة على الوجهين اختر «قلب على الحافة الطويلة» وخيار «الحجم الفعلي» (100%)، ثم قصّ البطاقات وغلّفها حرارياً بمكتب الاستنساخ.</p></div></div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px;direction:ltr;justify-content:flex-end">' + chips + '</div>',
      footer: '<button class="btn btn-outline" data-close>لاحقاً</button>' +
        '<button class="btn btn-gold" id="b-print">' + UI.ic('print') + ' طباعة الدفعة على A4 (' + made.length + ' بطاقة)</button>',
      onMount: function (box) {
        box.querySelector('#b-print').addEventListener('click', function () {
          V.printSheet(made);
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
