/* ═══════════════════════════════════════════════════════════════════════════
   HRC — عرض محتوى النسخة المحمولة
   ---------------------------------------------------------------------------
   يعرض حمولة `.hrcbak` بعد فكّ تشفيرها كجداول عربية مرتّبة بدل JSON خام.

   المتطلبات التي جاءت من المالك:
     «أفتحها بعد انقطاع الموقع فأشوف كل التفاصيل بشكل مرتّب،
      وأقدر مستقبلاً أبني موقعاً جديداً وأصعّد هذه النسخة عليه.»

   لذلك الوحدة لا تعرض الأعداد فقط، بل **كل صف** من كل جدول، مع:
     • بحث فوري عبر الأعمدة المرئية
     • ترقيم صفحات (النسخة قد تحمل آلاف الصفوف — لا نُجمّد المتصفح)
     • تصدير CSV لكل جدول
     • توليد SQL جاهز للّصق في Supabase (من الوحدة المشتركة)

   بلا اعتماد على شبكة: كل شيء يعمل من `file://`.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root, doc) {
  'use strict';

  var PAGE = 50;

  /* ═══ وصف الجداول: اسم عربي + أعمدة معروضة + ترتيب ═══════════════════ */
  var VIEWS = [
    {
      key: 'jobs', title: 'الوظائف',
      columns: [
        ['code', 'الكود'], ['title', 'الوظيفة'], ['category', 'التصنيف'],
        ['governorate', 'المحافظة'], ['shift', 'الدوام'], ['vacancies', 'السعة'],
        ['status', 'الحالة'], ['salary_min', 'الراتب من'], ['salary_max', 'الراتب إلى']
      ],
      search: ['code', 'title', 'category', 'governorate', 'status', 'employer_name']
    },
    {
      key: 'applicants', title: 'البطاقات',
      columns: [
        ['serial', 'الرقم'], ['full_name', 'الاسم'], ['phone', 'الهاتف'],
        ['status', 'الحالة'], ['attempt_limit', 'المحاولات'], ['fee_amount', 'الرسم'],
        ['expiry_date', 'تنتهي']
      ],
      search: ['serial', 'full_name', 'phone', 'status']
    },
    {
      key: 'job_attempts', title: 'الفرص',
      columns: [
        ['serial', 'البطاقة'], ['attempt_no', 'الفرصة'], ['job_code', 'الوظيفة'],
        ['slot_status', 'الحالة'], ['vacancy_no', 'الشاغر'], ['hold_expires_at', 'انتهاء الحجز']
      ],
      search: ['serial', 'job_code', 'slot_status']
    },
    {
      key: 'audit_log', title: 'سجل التدقيق',
      columns: [
        ['id', 'رقم'], ['ts', 'التاريخ'], ['username', 'المستخدم'],
        ['action', 'الإجراء'], ['entity', 'الجدول'], ['entity_id', 'المعرّف']
      ],
      search: ['username', 'action', 'entity', 'entity_id', 'details']
    },
    {
      key: 'settings', title: 'الإعدادات',
      columns: [['key', 'المفتاح'], ['value', 'القيمة'], ['updated_at', 'آخر تحديث']],
      search: ['key']
    },
    {
      key: 'issued_serials', title: 'أرقام مُصدَرة',
      columns: [['serial', 'الرقم'], ['issued_at', 'تاريخ الإصدار'], ['note', 'ملاحظة']],
      search: ['serial', 'note']
    },
    {
      key: 'staff', title: 'الحسابات',
      columns: [['username', 'المستخدم'], ['full_name', 'الاسم'], ['role', 'الدور'], ['active', 'نشط']],
      search: ['username', 'full_name', 'role']
    }
  ];

  var TOTAL_KEY = { jobs: 'jobs', applicants: 'applicants', job_attempts: 'attempts', audit_log: 'audit' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }

  /* قيمة للعرض: الكائنات تُختصر، والتواريخ تُنسَّق عربياً */
  function cellText(v, key) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
    if (typeof v === 'string') v = humanValue(v);
    if (typeof v === 'object') {
      var s = JSON.stringify(v);
      return s.length > 60 ? s.slice(0, 57) + '…' : s;
    }
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(s) && /(_at|^ts$|_date$)/.test(key || '')) {
      var d = new Date(s);
      if (!isNaN(d)) return d.toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
    }
    return s;
  }

  /* ═══ ترجمة القيم التقنية إلى ما يفهمه القارئ العربي ═══════════════════
     القيم في القاعدة إنجليزية (`available`، `reserved`، `active`). عرضها
     كما هي يجعل الصفحة تبدو خاماً — والمالك طلب «بشكل مرتّب». لا نغيّر
     البيانات، نُبدّل التسمية عند العرض فقط. */
  var AR = {
    /* حالة الوظيفة */
    available: 'متاحة', reserved: 'محجوزة', closed: 'مغلقة', hiring: 'قيد التوظيف',
    /* حالة البطاقة */
    active: 'فعّالة', expired: 'منتهية', exhausted: 'استُنفدت', completed: 'مكتملة',
    pending: 'معلّقة', rejected: 'مرفوضة', blank: 'فارغة',
    /* حالة الفرصة */
    empty: 'شاغرة', succeeded: 'نجحت', critical: 'حرجة'
  };

  function humanValue(v) {
    if (typeof v !== 'string') return v;
    return Object.prototype.hasOwnProperty.call(AR, v) ? AR[v] : v;
  }

  /* ═══ الحالة ═════════════════════════════════════════════════════════════ */
  var state = { payload: null, view: 'jobs', query: '', page: 0 };

  function rowsOf(key) {
    return (state.payload && state.payload[key]) || [];
  }

  function filtered(view) {
    var rows = rowsOf(view.key);
    var q = state.query.trim().toLowerCase();
    if (!q) return rows;
    var attrs = view.search || view.columns.map(function (c) { return c[0]; });
    return rows.filter(function (r) {
      for (var i = 0; i < attrs.length; i++) {
        var v = r[attrs[i]];
        if (v == null) continue;
        if (String(typeof v === 'object' ? JSON.stringify(v) : v).toLowerCase().indexOf(q) >= 0) return true;
      }
      return false;
    });
  }

  /* ═══ العرض ══════════════════════════════════════════════════════════════ */
  function tabsHtml() {
    return VIEWS.map(function (v) {
      var n = rowsOf(v.key).length;
      if (!n) return '';
      return '<button type="button" class="rv-tab' + (v.key === state.view ? ' is-on' : '') +
        '" data-view="' + esc(v.key) + '"><span>' + esc(v.title) +
        '</span><b>' + num(n) + '</b></button>';
    }).join('');
  }

  function viewByKey(k) {
    for (var i = 0; i < VIEWS.length; i++) if (VIEWS[i].key === k) return VIEWS[i];
    return VIEWS[0];
  }

  function tableHtml() {
    var view = viewByKey(state.view);
    var all = filtered(view);
    var pages = Math.max(1, Math.ceil(all.length / PAGE));
    if (state.page >= pages) state.page = pages - 1;
    var start = state.page * PAGE;
    var slice = all.slice(start, start + PAGE);

    if (!all.length) {
      return '<p class="rv-empty">' + (state.query ? 'لا نتائج مطابقة للبحث.' : 'لا صفوف في هذا الجدول.') + '</p>';
    }

    /* كل خلية تحمل اسم عمودها في `data-l` — على الهاتف يتحول الجدول إلى
       بطاقات مكدّسة (انظر media query في restore.css) بدل تمرير أفقي أعمى
       يقصّ عمود «الحالة». على الشاشة الكبيرة يبقى جدولاً عادياً. */
    var head = view.columns.map(function (c) { return '<th>' + esc(c[1]) + '</th>'; }).join('');
    var body = slice.map(function (r) {
      return '<tr>' + view.columns.map(function (c) {
        return '<td data-l="' + esc(c[1]) + '">' + esc(cellText(r[c[0]], c[0])) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    var pager = '';
    if (pages > 1) {
      pager = '<div class="rv-pager">' +
        '<button type="button" class="rv-pg" data-pg="prev"' + (state.page === 0 ? ' disabled' : '') + '>السابق</button>' +
        '<span>صفحة ' + num(state.page + 1) + ' من ' + num(pages) + ' · ' + num(all.length) + ' صفاً</span>' +
        '<button type="button" class="rv-pg" data-pg="next"' + (state.page >= pages - 1 ? ' disabled' : '') + '>التالي</button>' +
        '</div>';
    }

    return '<div class="rv-table-wrap"><table class="rv-table"><thead><tr>' + head +
      '</tr></thead><tbody>' + body + '</tbody></table></div>' + pager;
  }

  function render() {
    var host = doc.getElementById('rv-root');
    if (!host || !state.payload) return;
    var view = viewByKey(state.view);

    host.innerHTML =
      '<div class="rv-tabs" role="tablist">' + tabsHtml() + '</div>' +
      '<div class="rv-bar">' +
        '<input type="search" id="rv-search" class="rv-search" placeholder="بحث في ' + esc(view.title) + '…" value="' + esc(state.query) + '" aria-label="بحث">' +
        '<button type="button" class="rp-btn rp-btn-sm" id="rv-csv">تصدير CSV</button>' +
      '</div>' +
      '<div id="rv-body">' + tableHtml() + '</div>';

    host.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.getAttribute('data-view');
        state.query = ''; state.page = 0;
        render();
      });
    });

    var search = host.querySelector('#rv-search');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        state.page = 0;
        host.querySelector('#rv-body').innerHTML = tableHtml();
        bindPager();
      });
    }

    host.querySelector('#rv-csv').addEventListener('click', function () {
      var view = viewByKey(state.view);
      var rows = filtered(view);
      var csv = root.HRCRestoreSql.toCsv(rows);
      download('hrc-' + state.view + '-' + stamp() + '.csv', csv, 'text/csv;charset=utf-8');
    });

    bindPager();
  }

  function bindPager() {
    var host = doc.getElementById('rv-root');
    if (!host) return;
    host.querySelectorAll('[data-pg]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.page += b.getAttribute('data-pg') === 'next' ? 1 : -1;
        if (state.page < 0) state.page = 0;
        host.querySelector('#rv-body').innerHTML = tableHtml();
        bindPager();
      });
    });
  }

  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url; a.download = name;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ═══ واجهة برمجية لصفحة الاسترجاع ═══════════════════════════════════════ */
  root.HRCRestoreView = {
    /** يبني واجهة العرض داخل #rv-root بعد فكّ التشفير */
    mount: function (payload) {
      state = { payload: payload || {}, view: 'jobs', query: '', page: 0 };
      /* ابدأ بالجدول الأول غير الفارغ */
      var first = VIEWS.filter(function (v) { return rowsOf(v.key).length; })[0];
      if (first) state.view = first.key;
      var host = doc.getElementById('rv-root');
      if (host) host.hidden = false;
      render();
    },
    unmount: function () {
      state.payload = null;
      var host = doc.getElementById('rv-root');
      if (host) { host.innerHTML = ''; host.hidden = true; }
    },
    /** SQL جاهز للّصق في Supabase → SQL Editor → Run */
    buildSql: function () { return root.HRCRestoreSql.buildSql(state.payload); },
    /** كل جدول كـCSV، منفصلاً */
    exportAll: function () {
      VIEWS.forEach(function (v) {
        var rows = rowsOf(v.key);
        if (!rows.length) return;
        download('hrc-' + v.key + '-' + stamp() + '.csv',
          root.HRCRestoreSql.toCsv(rows), 'text/csv;charset=utf-8');
      });
    },
    download,
    stamp,
    _views: VIEWS,
    _totalKey: TOTAL_KEY
  };
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
