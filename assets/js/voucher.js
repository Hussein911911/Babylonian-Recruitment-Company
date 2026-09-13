/* ===========================================================================
 *  BRC — قالب الاستمارة المطبوعة (A4) مع كيو آر كود التحقق
 *  ---------------------------------------------------------------------------
 *  تُبنى الاستمارة ديناميكياً من بيانات الباحث والمحاولات الخمس، ويُولَّد
 *  الكيو آر كود محلياً (بدون إنترنت) لرابط التحقق الرسمي.
 * =========================================================================== */
(function (root) {
  'use strict';
  var CFG = root.BRC_CONFIG;
  var UI = root.BRCUI;
  var Store = root.BRCStore;

  var DISCLAIMER = 'ملاحظات مهمة: خدمات الشركة تنحصر في توفير الأيادي العاملة من الناحية الفنية والتخصصية فقط وليس الأمنية. ' +
    'الشركة غير مسؤولة قانونياً وعشائياً عن الشخص المرسل وصاحب العمل.';

  var EXTRA_NOTES = [
    'الاستمارة صالحة لمدة 30 يوماً من تاريخ الإصدار وتحتوي (5) محاولات فقط.',
    'لا يجوز تسليم الاستمارة أو التنازل عنها لشخص آخر — تُلغى عند التلاعب.',
    'حجز الوظيفة مؤقت لمدة 24 ساعة بانتظار نتيجة المقابلة، وبعدها تُفرج الوظيفة تلقائياً.'
  ];

  function qrSvg(text, size) {
    try {
      var model = root.BRCQR.encode(text, 'M');
      return root.BRCQR.renderSVG(model, { margin: 1, size: size || 132, dark: '#000000', light: '#ffffff' });
    } catch (e) {
      return '<div class="tiny">تعذّر توليد الكيو آر كود</div>';
    }
  }

  function buildHtml(app, attempts, staffName) {
    if (!app) return '<div class="voucher">لا توجد بيانات</div>';
    attempts = attempts || Store.getAttempts(app.serial);
    var limit = Number(Store.settings().attemptLimit || 5);
    var vUrl = Store.verifyUrl(app.serial);
    var rows = '';
    for (var i = 1; i <= limit; i++) {
      var t = attempts.filter(function (x) { return x.no === i; })[0] || null;
      var st = t ? CFG.slotStatus[t.slotStatus] : CFG.slotStatus.empty;
      var filled = t && t.slotStatus !== 'empty';
      rows += '<tr>' +
        '<td><b>' + i + '</b></td>' +
        '<td>' + (filled ? '<span dir="ltr">' + UI.esc(t.jobCode) + '</span>' : '&nbsp;') + '</td>' +
        '<td>' + (filled ? UI.esc(t.location || '—') : '&nbsp;') + '</td>' +
        '<td class="right">' + (filled ? UI.esc(t.jobTitle || '—') : '&nbsp;') + '</td>' +
        '<td>' + (filled ? '<span dir="ltr">' + UI.esc(t.employerPhone || '—') + '</span>' : '&nbsp;') + '</td>' +
        '<td class="right">' + (filled ? UI.esc(t.employerName || '—') : '&nbsp;') + '</td>' +
        '<td>' + (filled ? '<b>' + UI.esc(st.ar) + '</b>' : '—') + '</td>' +
        '<td>' + (filled && t.selectedAt ? UI.esc(Store.fmtDate(t.selectedAt)) : '&nbsp;') + '</td>' +
        '</tr>';
    }

    return '' +
    '<div class="voucher voucher-sheet">' +
      '<div class="v-watermark"><img src="' + (root.BRC_IMG_BRICK || 'assets/img/brick-pattern.jpg') + '" alt=""></div>' +

      /* الترويسة */
      '<div class="v-head">' +
        '<svg class="v-logo" viewBox="0 0 120 120" role="img" aria-label="شعار الشركة"><use href="#i-emblem" xlink:href="#i-emblem"/></svg>' +
        '<div class="v-titles">' +
          '<h1>' + UI.esc(CFG.company.nameAr) + '</h1>' +
          '<div class="en">' + UI.esc(CFG.company.nameEn) + ' — BRC</div>' +
          '<div class="meta">' + UI.esc(CFG.company.legalName) + ' · ' + UI.esc(CFG.company.address) + '</div>' +
        '</div>' +
        '<div class="v-phone-box">' +
          '<div class="k">للتواصل والحجز</div>' +
          '<div class="v">' + UI.esc(CFG.company.phones[0]) + '</div>' +
          '<div class="v">' + UI.esc(CFG.company.phones[1]) + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="v-band">' +
        '<span>استمارة ترشيح للعمل / Job Placement Voucher</span>' +
        '<span dir="ltr">BRC-NO: ' + UI.esc(String(app.serial).replace('BRC-NO-', '')) + '</span>' +
      '</div>' +

      /* بيانات الباحث */
      '<div class="v-section-title">بيانات الباحث عن العمل</div>' +
      '<div class="v-grid">' +
        '<div class="v-cell"><div class="k">الرقم التسلسلي</div><div class="v" dir="ltr">' + UI.esc(app.serial) + '</div></div>' +
        '<div class="v-cell wide"><div class="k">الاسم الكامل</div><div class="v">' + UI.esc(app.fullName) + '</div></div>' +
        '<div class="v-cell"><div class="k">رقم الهاتف</div><div class="v" dir="ltr">' + UI.esc(app.phone) + '</div></div>' +
        '<div class="v-cell wide"><div class="k">العنوان</div><div class="v">' + UI.esc(app.address) + '</div></div>' +
        '<div class="v-cell"><div class="k">تاريخ الميلاد</div><div class="v" dir="ltr">' + UI.esc(app.dob || '—') + '</div></div>' +
        '<div class="v-cell"><div class="k">الجنسية</div><div class="v">' + UI.esc(app.nationality || 'عراقي') + '</div></div>' +
        '<div class="v-cell"><div class="k">تاريخ الإصدار</div><div class="v" dir="ltr">' + UI.esc(Store.fmtDate(app.issueDate)) + '</div></div>' +
        '<div class="v-cell"><div class="k">تاريخ الانتهاء</div><div class="v" dir="ltr">' + UI.esc(Store.fmtDate(app.expiryDate)) + '</div></div>' +
        '<div class="v-cell"><div class="k">مدة الصلاحية</div><div class="v">' + (Store.settings().validityDays || 30) + ' يوماً</div></div>' +
        '<div class="v-cell"><div class="k">عدد المحاولات</div><div class="v">' + limit + ' محاولات</div></div>' +
        '<div class="v-cell wide"><div class="k">الموظف المُصدر</div><div class="v">' + UI.esc(staffName || app.createdBy || '—') + '</div></div>' +
      '</div>' +

      /* جدول المحاولات */
      '<div class="v-section-title">جدول المحاولات (5 محاولات) — Attempts Register</div>' +
      '<table>' +
        '<thead><tr>' +
          '<th style="width:52px">المحاولة</th>' +
          '<th style="width:86px">كود الوظيفة</th>' +
          '<th style="width:78px">المنطقة</th>' +
          '<th>الوظيفة</th>' +
          '<th style="width:96px">هاتف جهة الاتصال</th>' +
          '<th style="width:120px">صاحب العمل</th>' +
          '<th style="width:86px">حالة المهلة</th>' +
          '<th style="width:74px">التاريخ</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +

      /* التذييل: الكيو آر كود + التواقيع + الإخلاء */
      '<div class="v-foot">' +
        '<div class="v-qr">' +
          qrSvg(vUrl, 132) +
          '<div class="ser">BRC-NO: ' + UI.esc(String(app.serial).replace('BRC-NO-', '')) + '</div>' +
          '<div class="tiny" style="direction:ltr;color:#444;font-size:8.6px">' + UI.esc(vUrl.replace(/^https?:\/\//, '')) + '</div>' +
        '</div>' +
        '<div>' +
          '<div class="v-note"><b>' + DISCLAIMER + '</b></div>' +
          '<div class="v-note" style="margin-top:5px;border-style:solid;background:#fff">' +
            EXTRA_NOTES.map(function (n, i) { return (i + 1) + ') ' + UI.esc(n); }).join('<br>') +
          '</div>' +
          '<div class="v-sign">' +
            '<div>توقيع الموظف المُصدر<br><span style="font-size:9.4px">الاسم: ' + UI.esc(staffName || '—') + '</span></div>' +
            '<div>توقيع صاحب العلاقة (الباحث)<br><span style="font-size:9.4px">' + UI.esc(app.fullName) + '</span></div>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:9.6px;color:#333">' +
            '<span>تاريخ الطباعة: <b dir="ltr">' + UI.esc(Store.fmtDateTime(new Date())) + '</b></span>' +
            '<span>ختم الشركة: .....................</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* الطباعة: تُدرج الاستمارة في حاوية الطباعة ثم نادِ نافذة الطباعة */
  function print(app, opts) {
    opts = opts || {};
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّر الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    var session = Store.currentUser();
    rootEl.innerHTML = buildHtml(app, opts.attempts, session ? session.name : 'الإدارة العامة');
    Store.markPrinted(app.serial);
    var done = false;
    function after() { if (!done) { done = true; rootEl.innerHTML = ''; } }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { window.print(); setTimeout(after, 1200); }, 120);
  }

  /* معاينة الاستمارة داخل نافذة منبثقة (بنفس تنسيق A4) */
  function preview(app) {
    var html = $previewShell(app);
    return html;
  }
  function $previewShell(app) {
    var body = buildHtml(app);
    return '<div style="background:#fff;border:1px solid var(--line-soft);border-radius:12px;padding:18px 20px">' +
      body + '</div>';
  }

  root.BRCVoucher = {
    buildHtml: buildHtml, print: print, preview: preview,
    DISCLAIMER: DISCLAIMER, qrSvg: qrSvg, verifyUrl: function (s) { return Store.verifyUrl(s); }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.BRCVoucher;
})(typeof window !== 'undefined' ? window : globalThis);
