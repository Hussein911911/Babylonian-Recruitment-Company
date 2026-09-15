/* ===========================================================================
 *  BRC — صفحة التحقق من الاستمارة (تُفتح عبر كيو آر كود الاستمارة)
 *  تُظهر: الرقم التسلسلي، اسم الباحث، المحاولات المرتبطة وأكواد الوظائف،
 *  وحالة الاستمارة (سارية / منتهية / استُهلكت المحاولات / مكتملة).
 *  تعمل في وضعين: صفحة مستقلة (verify.html?form=...) أو ضمن الملف المستقل
 *  (brc-standalone.html#!verify?form=...).
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.BRC_CONFIG, Store = root.BRCStore, UI = root.BRCUI;
  if (!document.getElementById('verify-root')) return;

  var booted = false;
  var current = { serial: '', token: '' };
  var refreshTimer = null;

  /* قراءة المتغيرات من رابط الاستعلام أو من هاش الملف المستقل */
  function params(queryString) {
    var out = {};
    var sources = [];
    if (queryString) sources.push(queryString);
    if (window.location.search) sources.push(window.location.search);
    var hash = window.location.hash || '';
    if (hash.indexOf('?') >= 0) sources.push(hash.slice(hash.indexOf('?')));
    sources.forEach(function (src) {
      src.replace(/^\?/, '').split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('=');
        var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
        var v = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1).replace(/\+/g, ' '));
        out[k] = v;
      });
    });
    return out;
  }

  function normalizeSerial(s) {
    s = String(s || '').trim().toUpperCase();
    if (!s) return '';
    if (s.indexOf('BRC-NO') !== 0) s = 'BRC-NO-' + s.replace(/[^0-9]/g, '').padStart(6, '0');
    return s;
  }

  /* العرض حسب المتغيرات الحالية */
  function mount(queryString) {
    var p = params(queryString);
    var serial = normalizeSerial(p.form || p.serial || '');
    var token = p.t || '';
    current = { serial: serial, token: token };

    var input = document.getElementById('v-serial');
    if (input && serial) input.value = serial;

    if (!serial) return renderEmpty();

    var st = Store.cloudStatus ? Store.cloudStatus() : null;
    /* الزائر لا يقرأ جدول brc.applicants (RLS) — فالتحقق يمرّ عبر دالة القاعدة
       brc.verify_form التي تتحقق من البصمة وتُرجع استمارة واحدة مقنّعة إن لم
       تطابق. لولا هذا لظهر لأي زائر «لا توجد استمارة بهذا الرقم» دائماً. */
    if (st && st.configured && st.state === 'on' && st.role !== 'staff' && Store.verifyCloud) {
      var host = document.getElementById('verify-root');
      host.innerHTML = '<div class="verify-status info"><div class="seal">' +
        UI.ic('shield') + '</div><div><h1>جارٍ التحقق من القاعدة الرسمية…</h1>' +
        '<p class="muted mb-0 small">يتم فحص الرقم والبصمة في نظام الشركة.</p></div></div>';
      Store.verifyCloud(serial, token).then(function (r) {
        if (!r || !r.ok) return renderNotFound(serial, r && r.error);
        renderResult(cloudShape(r.form), token);
      });
      return;
    }

    var result = Store.verify(serial, token);
    if (!result.ok) return renderNotFound(serial);
    renderResult(result, token);
  }

  /* تحويل رد دالة القاعدة إلى الشكل الذي تتوقّعه renderResult تماماً.
     حساب الحالة هنا (لا في SQL) ليبقى سلوك الوضعين واحداً: القاعدة تُخزّن
     'active' حتى بعد التوظيف، والحالة المعروضة تُشتقّ من المحاولات. */
  function cloudShape(f) {
    var attempts = f.attempts || [];
    var status = f.status;
    if (status !== 'pending' && status !== 'rejected' && status !== 'expired') {
      if (attempts.some(function (a) { return a.slotStatus === 'succeeded'; })) status = 'completed';
      else if (f.expiryDate && new Date(f.expiryDate).getTime() < Date.now()) status = 'expired';
      else if (f.attemptsLeft === 0) status = 'exhausted';
      else status = 'active';
    }
    return {
      ok: true, serial: f.serial, fullName: f.fullName, phone: f.phone,
      masked: f.masked === true, issueDate: f.issueDate, expiryDate: f.expiryDate,
      createdAt: f.createdAt || f.issueDate, status: status,
      rejectReason: f.rejectReason || '', requestedCode: f.requestedCode || null,
      daysLeft: f.daysLeft, attemptsLeft: f.attemptsLeft, attemptsUsed: f.attemptsUsed,
      attemptLimit: f.attemptLimit, tokenOk: f.tokenOk !== false,
      attempts: attempts.map(function (a) {
        return {
          no: a.no, jobCode: a.jobCode, jobTitle: a.jobTitle, location: a.location,
          /* هاتف صاحب العمل لا يظهر للزائر (واجهة التحقق العامة تحجبه) */
          employerPhone: '—', slotStatus: a.slotStatus, note: a.note,
          selectedAt: a.selectedAt, holdExpiresAt: a.holdExpiresAt, closedAt: a.closedAt
        };
      })
    };
  }

  function init() {
    if (booted) return;
    booted = true;
    Store.init();
    UI.startCountdowns();

    var form = document.getElementById('verify-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var s = normalizeSerial((document.getElementById('v-serial') || {}).value || '');
      if (!s) return;
      var local = (CFG.verifyLocal || 'verify.html');
      window.location.href = local + '?form=' + encodeURIComponent(s) + '&t=' + Store.token(s);
    });

    mount();

    /* التحقق من نسخة المتصفح ليس تحققاً رسمياً — نُعلن الحالة دائماً */
    if (UI.syncNotice) UI.syncNotice('#verify-root');
    if (Store.onCloudStatus) Store.onCloudStatus(function () {
      if (UI.syncNotice) UI.syncNotice('#verify-root');
    });

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (!current.serial) return;
      Store.runMaintenance();
      var fresh = Store.verify(current.serial, current.token);
      if (fresh.ok) renderResult(fresh, current.token);
    }, 30000);
  }

  function renderEmpty() {
    var host = document.getElementById('verify-root');
    host.innerHTML = '' +
      '<div class="verify-status info" style="padding:26px 24px">' +
        '<div class="seal" style="background:#e5eefb;color:#2563a8">' + UI.ic('qr') + '</div>' +
        '<div><h1>امسح الكيو آر كود أو أدخل الرقم التسلسلي</h1>' +
        '<p class="muted mb-0 small">في أسفل كل استمارة كيو آر كود يفتح هذه الصفحة تلقائياً مع رقم الاستمارة.</p></div>' +
      '</div>';
  }

  function renderNotFound(serial, reason) {
    var host = document.getElementById('verify-root');
    host.innerHTML = '' +
      '<div class="verify-status danger">' +
        '<div class="seal">' + UI.ic('alert') + '</div>' +
        '<div><h1>لا توجد استمارة بهذا الرقم</h1>' +
        '<p class="muted mb-0 small">' + (reason ? UI.esc(reason) + ' — ' : '') +
        'الرقم المُدخل: <b class="mono" dir="ltr">' + UI.esc(serial) + '</b> — تأكد من الرقم أو راجع المكتب على الأرقام الرسمية.</p></div>' +
      '</div>' +
      '<div class="panel-body" style="padding-top:0">' +
        '<div class="panel" style="background:#fbe6e5;border-color:#f0c3c1"><div class="panel-body" style="padding:14px 16px">' +
        '<p class="mb-0 small">' + UI.ic('shield') + ' <b>تنبيه:</b> الاستمارات غير المسجّلة في نظام الشركة لا يُعتد بها. ' +
        'تحقق دائماً عبر هذه الصفحة أو بالاتصال بالشركة.</p></div></div>' +
        '<div class="mt-2">' + UI.ic('phone') + ' <span class="mono" dir="ltr">' + UI.esc(CFG.company.phones.join(' / ')) + '</span></div>' +
      '</div>';
  }

  function statusClass(k) { return ({ active: 'ok', completed: 'info', exhausted: 'warn', pending: 'warn', rejected: 'danger' })[k] || 'danger'; }
  function statusIcon(k) { return ({ active: 'check', completed: 'check', exhausted: 'alert', pending: 'hourglass', rejected: 'x-circle' })[k] || 'x-circle'; }
  function statusTitle(k) {
    return ({
      active: 'استمارة سارية وصحيحة',
      pending: 'طلب قيد المراجعة',
      rejected: 'طلب مرفوض',
      expired: 'استمارة منتهية الصلاحية',
      exhausted: 'استُهلكت المحاولات الخمس',
      completed: 'تم التوظيف — استمارة مكتملة'
    })[k] || k;
  }

  function renderResult(r, tokenParam) {
    var host = document.getElementById('verify-root');
    var cls = statusClass(r.status);
    var stBadge = UI.formBadge(r.status);
    var isRequest = r.status === 'pending' || r.status === 'rejected';

    /* سطر الصلاحية حسب الحالة */
    var daysLine;
    if (r.status === 'pending') daysLine = 'بانتظار مراجعة الموظفين';
    else if (r.status === 'rejected') daysLine = 'رُفض الطلب — راجع المكتب للاستفسار';
    else if (r.daysLeft != null && r.daysLeft >= 0) daysLine = 'المتبقي من الصلاحية: ' + r.daysLeft + ' يوم';
    else if (r.daysLeft != null) daysLine = 'انتهت قبل ' + Math.abs(r.daysLeft) + ' يوم';
    else daysLine = '—';

    /* خلايا التاريخ حسب الحالة */
    var dateCells = isRequest
      ? '<div class="data-item"><div class="k">تاريخ الطلب</div><div class="v" dir="ltr">' + Store.fmtDate(r.createdAt || '') + '</div></div>' +
        '<div class="data-item"><div class="k">كود الوظيفة المطلوبة</div><div class="v mono" dir="ltr">' + UI.esc(r.requestedCode || '—') + '</div></div>'
      : '<div class="data-item"><div class="k">تاريخ الإصدار</div><div class="v" dir="ltr">' + Store.fmtDate(r.issueDate || '') + '</div></div>' +
        '<div class="data-item"><div class="k">تاريخ الانتهاء</div><div class="v" dir="ltr">' + Store.fmtDate(r.expiryDate || '') + '</div></div>';

    /* رسالة حالة الطلب (قيد المراجعة / مرفوض) */
    var requestNote = isRequest
      ? (r.status === 'pending'
        ? '<div class="panel" style="background:#fdf6e3;border-color:#f0d9a3;margin:0 24px 18px"><div class="panel-body" style="padding:14px 16px">' +
          '<p class="mb-0 small">' + UI.ic('hourglass') + ' <b>طلبك قيد المراجعة:</b> استلم النظام طلبك وسيراجعه موظفونا خلال وقت قصير. ' +
          'عند القبول تصدر الاستمارة رسمياً برقمها التسلسلي وتبدأ صلاحية 30 يوماً. يمكنك متابعة الحالة من هذه الصفحة أو الاتصال بنا.</p></div></div>'
        : '<div class="panel" style="background:#fbe6e5;border-color:#f0c3c1;margin:0 24px 18px"><div class="panel-body" style="padding:14px 16px">' +
          '<p class="mb-0 small">' + UI.ic('x-circle') + ' <b>نأسف، رُفض الطلب.</b> ' +
          (r.rejectReason ? 'السبب: ' + UI.esc(r.rejectReason) + '. ' : '') + 'يمكنك مراجعة المكتب للاستفسار أو تقديم طلب جديد.</p></div></div>')
      : '';

    var rows = r.attempts.map(function (t) {
      var filled = t.slotStatus !== 'empty';
      return '<tr>' +
        '<td><b>' + t.no + '</b></td>' +
        '<td dir="ltr" class="mono">' + UI.esc(t.jobCode) + '</td>' +
        '<td>' + UI.esc(t.location) + '</td>' +
        '<td>' + UI.esc(t.jobTitle) + '</td>' +
        '<td dir="ltr">' + UI.esc(filled ? t.employerPhone : '—') + '</td>' +
        '<td>' + UI.slotBadge(t.slotStatus) + '</td>' +
        '<td class="tiny" dir="ltr">' + UI.esc(t.selectedAt ? Store.fmtDateTime(t.selectedAt) : '—') + '</td>' +
        (t.slotStatus === 'reserved' && t.holdExpiresAt ? '<td>' + UI.holdHtml(t.holdExpiresAt) + '</td>' : '<td>—</td>') +
        '<td class="tiny">' + UI.esc(t.note || '—') + '</td>' +
        '</tr>';
    }).join('');

    var tokenWarn = (tokenParam && r.tokenOk === false)
      ? '<div class="panel" style="background:#fbe6e5;border-color:#f0c3c1;margin:0 24px 18px"><div class="panel-body" style="padding:12px 15px">' +
        '<p class="mb-0 small">' + UI.ic('alert') + ' <b>تحذير أمني:</b> بصمة التحقق في الرابط غير مطابقة. ' +
        'قد يكون الرابط مُعدّلاً — تحقق من الاستمارة الأصلية أو اتصل بالشركة.</p></div></div>' : '';

    host.innerHTML = '' +
      '<div class="verify-status ' + cls + '">' +
        '<div class="seal">' + UI.ic(statusIcon(r.status)) + '</div>' +
        '<div style="flex:1">' +
          '<h1>' + statusTitle(r.status) + '</h1>' +
          '<p class="muted mb-0 small">رقم الاستمارة <b class="mono" dir="ltr">' + UI.esc(r.serial) + '</b> — ' +
            'الباحث: <b>' + UI.esc(r.fullName) + '</b> — تم التحقق في ' + UI.esc(Store.fmtDateTime(r.verifiedAt)) + '</p>' +
        '</div>' +
        '<div style="text-align:center">' + stBadge +
          '<div class="tiny muted mt-1">' + daysLine + '</div>' +
        '</div>' +
      '</div>' +
      tokenWarn +
      requestNote +
      '<div class="panel-body" style="padding-top:0">' +
        '<div class="grid" style="grid-template-columns:minmax(0,1fr) 190px;gap:20px;align-items:start">' +
          '<div><div class="data-grid">' +
            '<div class="data-item"><div class="k">الرقم التسلسلي</div><div class="v mono" dir="ltr">' + UI.esc(r.serial) + '</div></div>' +
            '<div class="data-item"><div class="k">اسم الباحث</div><div class="v">' + UI.esc(r.fullName) + '</div></div>' +
            '<div class="data-item"><div class="k">الهاتف</div><div class="v mono" dir="ltr">' + UI.esc(r.phone) + '</div></div>' +
            dateCells +
            '<div class="data-item"><div class="k">المحاولات المستخدمة</div><div class="v">' + r.attemptsUsed + ' من ' + r.attemptLimit + '</div></div>' +
            '<div class="data-item"><div class="k">المحاولات المتاحة</div><div class="v">' + r.attemptsLeft + '</div></div>' +
            '<div class="data-item"><div class="k">المُصدر</div><div class="v">' + UI.esc(r.createdBy) + '</div></div>' +
          '</div></div>' +
          '<div class="verify-qr">' + root.BRCVoucher.qrSvg(Store.verifyUrl(r.serial), 170) +
            '<span class="tiny muted center">كيو آر كود التحقق الرسمي</span></div>' +
        '</div>' +

        (isRequest ? '' :
          '<h3 class="mt-4">المحاولات المرتبطة بالاستمارة</h3>' +
          '<div class="table-wrap"><div class="table-scroll"><table class="data" style="min-width:940px">' +
            '<thead><tr><th>المحاولة</th><th>كود الوظيفة</th><th>المنطقة</th><th>الوظيفة</th>' +
            '<th>هاتف جهة الاتصال</th><th>حالة المهلة</th><th>وقت الاختيار</th><th>مهلة الحجز</th><th>ملاحظة</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table></div></div>') +

        '<div class="panel mt-3" style="background:#fdf9ee;border-color:var(--line)"><div class="panel-body" style="padding:14px 16px">' +
          '<p class="mb-0 small">' + UI.ic('shield') + ' <b>ملاحظة قانونية:</b> ' + UI.esc(root.BRCVoucher.DISCLAIMER) + '</p>' +
        '</div></div>' +
        '<div class="flex flex-wrap mt-3">' +
          (isRequest ? '' : '<button class="btn btn-lapis" id="verify-print">' + UI.ic('print') + ' طباعة نسخة الاستمارة</button>') +
          '<button class="btn btn-outline" id="verify-copy">' + UI.ic('share') + ' نسخ رابط التحقق</button>' +
        '</div>' +
      '</div>';

    var printBtn = document.getElementById('verify-print');
    if (printBtn) printBtn.addEventListener('click', function () {
      var app = Store.getApplicant(r.serial);
      if (app) root.BRCVoucher.print(app);
    });
    var copyBtn = document.getElementById('verify-copy');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          UI.toast('ok', 'تم النسخ', 'رابط التحقق جاهز للمشاركة.');
        }, function () { UI.toast('info', 'رابط التحقق', url, 7000); });
      } else UI.toast('info', 'رابط التحقق', url, 7000);
    });
  }

  root.BRCVerify = { init: init, mount: mount, render: renderResult };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
