/* بطاقة توظيف 86×54 مم: وجه للهوية والباركود، وظهر برمز تحقق واحد.
   لا بيانات زبون على البطاقة؛ الاستمارة A4 منفصلة. طباعة بالحجم الفعلي. */
(function (root) {
  'use strict';
  var CFG = root.HRC_CONFIG;
  var UI = root.HRCUI;
  var Store = root.HRCStore;

  var DISCLAIMER = 'ملاحظات مهمة: خدمات الشركة تنحصر في توفير الأيادي العاملة من الناحية الفنية والتخصصية فقط وليس الأمنية. ' +
    'الشركة غير مسؤولة قانونياً وعشائرياً عن الشخص المرسل وصاحب العمل.';

  var TERMS = [
    'بطاقة <b>شخصية</b> بـ<b>فرصتين مستقلتين</b>؛ صالحة <b>30 يوماً</b> من البيع.',
    'الحجز <b>24 ساعة</b>؛ بعدها تصبح الوظيفة حرجة وتقرر الشركة: توظيف أو إرجاع أو حذف.',
    'تُستهلك الفرصة بالتقديم <b>ولا تعود</b>؛ بعد استهلاك فرص البطاقة تُشترى بطاقة جديدة.',
    'المتابعة وإعادة الطباعة من «بطاقتي» أو <b>أي مكتب استنساخ</b>.'
  ];

  /* ======================= الأنماط (تُحقن مرة واحدة) ======================= */
  var STYLE_ID = 'hrc-card-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.hrc-card{box-sizing:border-box;width:86mm;height:54mm;flex:0 0 auto;border-radius:3.5mm;position:relative;overflow:hidden;background:linear-gradient(125deg,#142d51,#09172f 65%);box-shadow:0 10px 30px rgba(6,13,31,.22);color:#fff;display:flex;flex-direction:column;padding:3mm 3.6mm;font-family:Cairo,'Segoe UI',Tahoma,sans-serif;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.hrc-card *{box-sizing:border-box;}
.hrc-card .frame{position:absolute;inset:1.5mm;border:.25mm solid #b99548;border-radius:2.5mm;pointer-events:none;}
.hc-top{display:flex;align-items:center;justify-content:space-between;gap:2mm;border-bottom:.2mm solid #826b3f;padding-bottom:1.7mm;}
.hc-top .brand{display:flex;align-items:center;gap:1.8mm;min-width:0;}
.hc-top .embl{width:8mm;height:8mm;flex:none;color:#e8cc86;}
.hc-top .ar{font-size:7pt;font-weight:900;line-height:1.5;color:#f2d58d;}
.hc-top .en{font-size:3.5pt;color:#d8e1ef;direction:ltr;line-height:1.7;}
.hc-ctype{text-align:left;flex:none;}
.hc-ctype .t1{display:block;font-size:5.5pt;font-weight:900;color:#f2d58d;}
.hc-ctype .t2{display:block;font-size:3pt;color:#d8e1ef;letter-spacing:.06em;direction:ltr;}
.hc-identity{display:grid;grid-template-columns:minmax(0,1fr) 23mm;gap:3mm;align-items:center;flex:1;padding:1.7mm 0;}
.hc-identity-copy{min-width:0;}
.hc-identity .lbl{font-size:4pt;line-height:1.5;color:#d8e1ef;}
.hc-serial{display:block;direction:ltr;text-align:right;white-space:nowrap;font-family:'Courier New',monospace;font-size:10pt;font-weight:900;letter-spacing:.03em;color:#f5d88e;margin:1mm 0;line-height:1.4;}
.hc-count{font-size:5.5pt;font-weight:700;line-height:1.5;}
.hc-identity .hint{font-size:4pt;line-height:1.65;color:#d8e1ef;margin:.6mm 0 0;}
.hc-qr{display:flex;flex-direction:column;align-items:center;gap:.5mm;}
.hc-qr .box{width:23mm;height:23mm;background:#fff;border-radius:1.2mm;padding:.4mm;}
.hrc-qr-slot svg{width:100%;height:100%;display:block;}
.hc-qr .caption{font-size:4pt;line-height:1.3;color:#f2d58d;}
.hc-dates{display:grid;grid-template-columns:1fr 1fr;border-top:.2mm solid #826b3f;padding-top:1mm;gap:3mm;}
.hc-date{display:flex;align-items:center;justify-content:space-between;gap:1mm;font-size:4.5pt;line-height:1.6;color:#d8e1ef;}
.hc-date b{font-family:'Courier New',monospace;font-size:5.5pt;direction:ltr;color:#fff;}
.hc-back-head{display:flex;align-items:center;justify-content:space-between;gap:2mm;padding-bottom:1mm;}
.hc-back-head b{font-size:6.5pt;color:#f2d58d;}
.hc-back-head span{font-size:3.8pt;color:#d8e1ef;}
.hc-codes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2mm;}
.hc-codebox{border:.2mm solid #e1c16b;border-radius:1.8mm;padding:.9mm 1.2mm;background:#f7f0df;color:#14203a;text-align:center;}
.hc-codebox .clbl{font-size:4.5pt;font-weight:700;line-height:1.4;}
.hc-codebox .code{font-family:'Courier New',monospace;font-size:10pt;font-weight:900;letter-spacing:.03em;direction:ltr;line-height:1.4;}
.hc-codes.single{grid-template-columns:1fr;}
.hc-codes.many{grid-template-columns:repeat(3,minmax(0,1fr));gap:.8mm;}
.hc-codes.many .hc-codebox{padding:.5mm;}
.hc-codes.many .code{font-size:7pt;letter-spacing:0;}
.hc-codes.many .clbl{font-size:3.5pt;}
.hc-codes.dense{grid-template-columns:repeat(5,minmax(0,1fr));}
.hc-codes.dense .code{font-size:5.7pt;}
.hc-terms{list-style:none;padding:0;margin:1.4mm 0;display:grid;gap:.5mm;}
.hc-terms li{font-size:4pt;line-height:1.65;padding-inline-start:2mm;position:relative;}
.hc-terms li:before{content:'•';position:absolute;inset-inline-start:0;color:#f2d58d;}
.hc-terms b{color:#f2d58d;font-weight:700;}
.hc-bot2{margin-top:auto;border-top:.2mm solid #826b3f;padding-top:.8mm;}
.hc-contact{display:flex;justify-content:space-between;align-items:center;gap:1mm;}
.hc-contact .phones{font-family:'Courier New',monospace;direction:ltr;white-space:nowrap;font-size:6pt;font-weight:700;color:#f2d58d;}
.hc-contact .addr{font-size:3.8pt;color:#d8e1ef;}
.hc-bot2 .disc{font-size:3.8pt;line-height:1.6;color:#e2e8f2;margin-top:.8mm;}
`
      /* معاينة داخل نافذة */
      + '.hrc-card-sheet{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;background:transparent;padding:6px;}'
      /* الطباعة: صفحتان 86×54مم */
      + '@media print{'
      +   '@page{size:86mm 54mm;margin:0;}'
      +   'html,body{background:#fff !important;padding:0 !important;margin:0 !important;}'
      +   '#print-root{display:block !important;position:static !important;width:auto !important;}'
      +   '#print-root .hrc-card{box-shadow:none !important;margin:0 !important;page-break-after:always;break-after:page;border-radius:3.5mm;}'
      +   '#print-root .hrc-card:last-child{page-break-after:auto;break-after:auto;}'
      +   '#print-root .hrc-card-sheet{display:block !important;padding:0 !important;}'
      + '}';
    document.head.appendChild(st);
  }

  /* ======================= أدوات ======================= */
  function qrSvg(text, size) {
    try {
      var model = root.HRCQR.encode(text, 'M');
      return root.HRCQR.renderSVG(model, { margin: 4, size: size || 132, dark: '#0b1a3a', light: '#ffffff' });
    } catch (e) {
      return '<div class="tiny">تعذّر توليد الكيو آر كود</div>';
    }
  }

  function esc(v) { return UI ? UI.esc(String(v == null ? '' : v)) : String(v == null ? '' : v); }

  /* الوجه الأمامي بلا بيانات شخصية؛ الصلاحية تبدأ عند البيع. */
  function isBlank(app) {
    /* البطاقة لا تحمل بيانات زبون أبداً (قرار 2026-10-01): «فارغة» تعني
       لم تُبع ولم تُفعّل بعد — البيانات تعيش على استمارة A4 بنفس الباركود. */
    return !app || app.status === 'blank';
  }

  function frontHtml(app, attempts) {
    var blank = isBlank(app);
    var count = attempts.length === 2 ? 'فرصتان مستقلتان' : attempts.length + ' فرص مستقلة';
    return '<div class="hrc-card" aria-label="الوجه الأمامي لبطاقة التوظيف">' +
      '<div class="frame"></div><div class="hc-top"><div class="brand">' +
      '<svg class="embl" viewBox="0 0 120 120"><use href="#i-emblem" xlink:href="#i-emblem"/></svg>' +
      '<div><div class="ar">' + esc(CFG.company.nameAr) + '</div><div class="en">' + esc(CFG.company.nameEn) + '</div></div></div>' +
      '<div class="hc-ctype"><span class="t1">بطاقة توظيف</span><span class="t2">EMPLOYMENT CARD</span></div></div>' +
      '<div class="hc-identity"><div class="hc-identity-copy"><div class="lbl">بطاقة الزبون — هوية الباركود</div>' +
      '<b class="hc-serial">' + esc(app.serial) + '</b><div class="hc-count">' + esc(count) + '</div>' +
      '<p class="hint">' + (blank ? 'تُفعّل عند البيع؛ الصلاحية تبدأ من التعبئة.' : 'بيانات الزبون على استمارة A4 بنفس الباركود.') + '</p></div>' +
      '<div class="hc-qr"><div class="box hrc-qr-slot">' + qrSvg(Store.cardUrl(app.serial), 200) + '</div>' +
      '<span class="caption">امسح لفتح «بطاقتي»</span></div></div>' +
      '<div class="hc-dates"><div class="hc-date"><span>الإصدار</span><b>' + (blank ? 'عند البيع' : esc(Store.fmtDate(app.issueDate))) + '</b></div>' +
      '<div class="hc-date"><span>الصلاحية</span><b>' + (blank ? '30 يوماً من البيع' : esc(Store.fmtDate(app.expiryDate))) + '</b></div></div></div>';
  }

  function backHtml(app, attempts) {
    // Legacy cards print one of their existing codes; both old codes still verify.
    var secret = app.cardPrintCode || (attempts[0] && attempts[0].code) || '';
    var printed = app.cardPrintCode ? secret.match(/.{1,4}/g).join('-') : secret;
    return '<div class="hrc-card" aria-label="الوجه الخلفي لبطاقة التوظيف"><div class="frame"></div>' +
      '<div class="hc-back-head"><b>رمز التحقق من البطاقة</b><span>خاص بإعادة الطباعة</span></div>' +
      '<div class="hc-codes single"><div class="hc-codebox"><div class="clbl">احتفظ بهذا الرمز ولا تشاركه</div>' +
      '<div class="code">' + esc(printed || 'راجع الإدارة قبل الطباعة') + '</div></div></div>' +
      '<ul class="hc-terms">' + TERMS.map(function (n) {
        return '<li>' + (attempts.length === 2 ? n : n.replace('فرصتين مستقلتين', attempts.length + ' فرص مستقلة').replace('بعد الفرصتين', 'بعد استهلاك فرص البطاقة')) + '</li>';
      }).join('') + '</ul>' +
      '<div class="hc-bot2"><div class="hc-contact"><span class="phones">' + esc(CFG.company.phones.join(' · ')) + '</span>' +
      '<span class="addr">' + esc(CFG.company.addressShort) + '</span></div><div class="disc">' + esc(DISCLAIMER) + '</div></div></div>';
  }

  /* ==========================================================================
   *  استمارة التوظيف A4 — الوثيقة التي تحمل بيانات الزبون والوظيفة المطلوبة
   *  (قرار الإدارة 2026-10-01: البطاقة تبقى بورقتها العامة، والبيانات هنا).
   *  تحمل نفس باركود البطاقة — يمسحها صاحب العمل فيرى المتقدم ويقرر التوظيف.
   *  ========================================================================== */
  function ensureFormStyle() {
    if (document.getElementById('hrc-form-style')) return;
    var st = document.createElement('style');
    st.id = 'hrc-form-style';
    st.textContent = ''
      + '.hrc-form{width:190mm;min-height:273mm;margin:0 auto;background:#fff;color:#231a06;'
      +   'font-family:\'Cairo\',\'Segoe UI\',Tahoma,sans-serif;direction:rtl;position:relative;'
      +   'display:flex;flex-direction:column;padding:9mm 10mm;box-sizing:border-box;}'
      + '.hrc-form .ff-head{display:flex;justify-content:space-between;align-items:center;gap:8mm;'
      +   'border-bottom:.7mm solid #16294d;padding-bottom:4mm;}'
      + '.hrc-form .ff-brand{display:flex;align-items:center;gap:4mm;}'
      + '.hrc-form .ff-brand svg{width:15mm;height:15mm;}'
      + '.hrc-form .ff-brand .ar{font-size:15pt;font-weight:900;color:#16294d;line-height:1.3;}'
      + '.hrc-form .ff-brand .en{font-size:7pt;font-weight:700;color:#8d7c50;letter-spacing:.12em;direction:ltr;}'
      + '.hrc-form .ff-title{text-align:left;}'
      + '.hrc-form .ff-title .t1{font-size:16pt;font-weight:900;color:#a8781a;}'
      + '.hrc-form .ff-title .t2{font-size:7pt;font-weight:700;color:#8d7c50;letter-spacing:.22em;direction:ltr;}'
      + '.hrc-form .ff-meta{display:flex;gap:6mm;align-items:flex-start;margin-top:5mm;}'
      + '.hrc-form .ff-qr{display:flex;flex-direction:column;align-items:center;gap:1.5mm;}'
      + '.hrc-form .ff-qr .box{padding:1.5mm;border:.4mm solid #16294d;border-radius:2mm;background:#fff;}'
      + '.hrc-form .ff-qr .cap{font-size:8pt;font-weight:900;color:#16294d;direction:ltr;letter-spacing:.04em;}'
      + '.hrc-form .ff-fields{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:2mm 5mm;align-content:start;}'
      + '.hrc-form .ff-f{border-bottom:.25mm dotted #b9a87e;padding-bottom:1mm;}'
      + '.hrc-form .ff-f .k{font-size:7.5pt;font-weight:700;color:#8d7c50;}'
      + '.hrc-form .ff-f .v{font-size:11pt;font-weight:800;color:#16294d;}'
      + '.hrc-form h3{font-size:11pt;font-weight:900;color:#16294d;margin:5mm 0 2mm;'
      +   'display:flex;align-items:center;gap:2mm;}'
      + '.hrc-form h3::before{content:\'\';width:1.8mm;height:5mm;background:#c8a24a;border-radius:1mm;}'
      + '.hrc-form .ff-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:2mm 4mm;}'
      + '.hrc-form .ff-emp{margin-top:2.5mm;border:.35mm solid #c8a24a;border-radius:2.5mm;'
      +   'background:#fdf9ee;padding:3mm 4mm;display:grid;grid-template-columns:1fr 1fr;gap:1.5mm 4mm;}'
      + '.hrc-form .ff-note{margin-top:2.5mm;border:.35mm dashed #8d7c50;border-radius:2.5mm;'
      +   'padding:3mm 4mm;font-size:9pt;color:#5a4a22;line-height:1.9;}'
      + '.hrc-form ul.ff-terms{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.2mm;}'
      + '.hrc-form ul.ff-terms li{font-size:8.5pt;line-height:1.8;color:#3a2f14;padding-inline-start:5mm;position:relative;}'
      + '.hrc-form ul.ff-terms li::before{content:\'★\';position:absolute;inset-inline-start:0;color:#c8a24a;}'
      + '.hrc-form .ff-employer-box{margin-top:2.5mm;background:#16294d;color:#f4efe2;border-radius:3mm;padding:4mm 5mm;}'
      + '.hrc-form .ff-employer-box h4{margin:0 0 2mm;font-size:11pt;color:#e8d089;}'
      + '.hrc-form .ff-employer-box ol{margin:0;padding-inline-start:6mm;font-size:9pt;line-height:2;}'
      + '.hrc-form .ff-sign{display:flex;justify-content:space-between;gap:10mm;margin-top:7mm;}'
      + '.hrc-form .ff-sign .s{flex:1;text-align:center;font-size:9pt;font-weight:700;color:#16294d;}'
      + '.hrc-form .ff-sign .l{border-bottom:.3mm dotted #8d7c50;height:11mm;margin-bottom:1.5mm;}'
      + '.hrc-form .ff-foot{margin-top:auto;border-top:.5mm solid #16294d;padding-top:2.5mm;'
      +   'font-size:7.5pt;color:#6b5320;text-align:center;line-height:1.8;}'
      /* الطباعة: A4 بلا هوامش (الحاوية تتكفل بالهوامش الداخلية) */
      + '@media print{'
      +   '.hrc-form{width:auto;min-height:auto;box-shadow:none;}'
      +   '.hrc-form, .hrc-form *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;}'
      + '}';

    document.head.appendChild(st);
  }

  /* بناء الاستمارة — attempt اختيارية (التقديم الجاري أو آخر تقديم) */
  function formHtml(app, attempt, verifiedAttempts) {
    if (!app) return '<div class="hrc-form">لا توجد بيانات</div>';
    ensureFormStyle();
    var attempts = verifiedAttempts || Store.getAttempts(app.serial);
    if (!attempt) {
      /* أحدث تقديم قيد اللعب أولاً (هو المطبوع لصاحب العمل)، وإلا آخر فرصة مستخدمة */
      var inPlay = attempts.filter(function (t) {
        return t.slotStatus === 'reserved' || t.slotStatus === 'critical' || t.slotStatus === 'hiring';
      });
      inPlay.sort(function (a, b) {
        var da = new Date(a.selectedAt || 0).getTime(), db = new Date(b.selectedAt || 0).getTime();
        if (db !== da) return db - da;
        return (b.no || 0) - (a.no || 0);
      });
      attempt = inPlay[0] ||
        attempts.filter(function (t) { return t.slotStatus !== 'empty'; }).slice().sort(function (a, b) {
          return (b.no || 0) - (a.no || 0);
        })[0] || null;
    }
    var job = attempt && attempt.jobCode ? Store.getJob(attempt.jobCode) : null;
    var cUrl = Store.cardUrl(app.serial);
    var st = (CFG.formStatus || {})[formStatusOf(app)] || { ar: '—' };

    var applied = attempt ? (
      '<div class="ff-grid">'
      + '<div class="ff-f"><div class="k">الوظيفة</div><div class="v">' + esc(attempt.jobTitle || '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">كود الوظيفة</div><div class="v mono" style="direction:ltr">' + esc(attempt.jobCode || '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">المنطقة</div><div class="v">' + esc(attempt.location || '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">الأجر الشهري</div><div class="v">' + (job ? esc(Store.money(job.salaryMin) + ' – ' + Store.money(job.salaryMax)) : '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">الدوام</div><div class="v">' + (job ? esc(job.shift) : '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">حالة التقديم</div><div class="v">' + esc(slotText(attempt)) + '</div></div>'
      + '</div>'
      + '<div class="ff-emp">'
      + '<div class="ff-f" style="grid-column:1/-1"><div class="k" style="font-size:9pt;color:#a8781a;font-weight:900">✦ بيانات التواصل بصاحب العمل</div></div>'
      + '<div class="ff-f"><div class="k">اسم جهة العمل</div><div class="v">' + esc(attempt.employerName || (job ? job.employer.name : '—')) + '</div></div>'
      + '<div class="ff-f"><div class="k">هاتف جهة العمل</div><div class="v mono" style="direction:ltr">' + esc(attempt.employerPhone || (job ? job.employer.phone : '—')) + '</div></div>'
      + '<div class="ff-f"><div class="k">عنوان جهة العمل</div><div class="v">' + esc(job ? job.employer.address : '—') + '</div></div>'
      + '<div class="ff-f"><div class="k">مكان المقابلة</div><div class="v">' + esc(job ? job.interviewLocation : '—') + '</div></div>'
      + '</div>'
      + (attempt.holdExpiresAt && attempt.slotStatus === 'reserved'
           ? '<div class="ff-note">⏳ الحجز مؤقت <b>24 ساعة</b> من وقت التقديم (' + esc(Store.fmtDateTime(attempt.selectedAt)) + ') — '
             + 'على صاحب العمل تسجيل قراره (توظيف/رفض) بمسح الباركود خلال هذه المهلة.</div>' : '')
    ) : '<div class="ff-note">لم يُقدَّم على وظيفة بعد — فرص البطاقة متاحة من «بطاقتي» على الموقع أو عند أي نقطة بيع.</div>';

    return ''
      + '<div class="hrc-form">'
      +   '<div class="ff-head">'
      +     '<div class="ff-brand">'
      +       '<svg viewBox="0 0 120 120"><use href="#i-emblem" xlink:href="#i-emblem"/></svg>'
      +       '<div><div class="ar">' + esc(CFG.company.nameAr) + '</div>'
      +       '<div class="en">' + esc(CFG.company.nameEn) + '</div></div>'
      +     '</div>'
      +     '<div class="ff-title"><div class="t1">استمارة توظيف</div>'
      +       '<div class="t2">JOB APPLICATION FORM</div></div>'
      +   '</div>'
      +   '<div class="ff-meta">'
      +     '<div class="ff-qr"><div class="box">' + qrSvg(cUrl, 96) + '</div>'
      +       '<div class="cap">' + esc(app.serial) + '</div></div>'
      +     '<div class="ff-fields">'
      +       '<div class="ff-f"><div class="k">رقم البطاقة (الباركود)</div><div class="v mono" style="direction:ltr">' + esc(app.serial) + '</div></div>'
      +       '<div class="ff-f"><div class="k">حالة البطاقة</div><div class="v">' + esc(st.ar) + '</div></div>'
      +       '<div class="ff-f"><div class="k">تاريخ التفعيل</div><div class="v">' + esc(Store.fmtDate(app.issueDate)) + '</div></div>'
      +       '<div class="ff-f"><div class="k">تنتهي الصلاحية</div><div class="v">' + esc(Store.fmtDate(app.expiryDate)) + '</div></div>'
      +       (app.posName ? '<div class="ff-f" style="grid-column:1/-1"><div class="k">نقطة البيع</div><div class="v">' + esc(app.posName) + '</div></div>' : '')
      +     '</div>'
      +   '</div>'
      +   '<h3>بيانات الزبون</h3>'
      +   '<div class="ff-grid">'
      +     '<div class="ff-f"><div class="k">الاسم الكامل</div><div class="v">' + esc(app.fullName || '—') + '</div></div>'
      +     '<div class="ff-f"><div class="k">رقم الهاتف</div><div class="v mono" style="direction:ltr">' + esc(app.phone || '—') + '</div></div>'
      +     '<div class="ff-f"><div class="k">العنوان</div><div class="v">' + esc(app.address || '—') + '</div></div>'
      +     '<div class="ff-f"><div class="k">الجنس · تاريخ الميلاد</div><div class="v">' + esc(app.gender || '—') + (app.dob ? ' · ' + esc(Store.fmtDate(app.dob)) : '') + '</div></div>'
      +   '</div>'
      +   '<h3>الوظيفة المطلوبة</h3>'
      +   applied
      +   '<h3>شروط البطاقة</h3>'
      +   '<ul class="ff-terms">' + TERMS.map(function (n) { return '<li>' + (attempts.length === 2 ? n : n.replace('فرصتين مستقلتين', attempts.length + ' فرص مستقلة').replace('بعد الفرصتين', 'بعد استهلاك فرص البطاقة')) + '</li>'; }).join('') + '</ul>'
      +   '<div class="ff-employer-box">'
      +     '<h4>✦ لصاحب العمل — كيف تُكمل التوظيف؟</h4>'
      +     '<ol>'
      +       '<li>امسح الباركود أعلاه بكاميرة أي موبايل — يفتح موقع الشركة ويظهر لك تعريف المتقدم وتفاصيله.</li>'
      +       '<li>اطلع على بيانات المتقدم وأجرِ المقابلة في المكان المحدد أعلاه.</li>'
      +       '<li>اضغط زر «تم التوظيف» أو «لم يتم التوظيف» من نفس الصفحة — يُسجَّل طلبك لدى الشركة وتبقى الوظيفة «جاري التوظيف» حتى يثبّت موظفو الشركة القرار أو يلغوه.</li>'
      +       '<li>إن لم يُسجَّل طلب خلال <b>24 ساعة</b> من التقديم، تنتقل الوظيفة لحالة حرجة وتقرر الشركة.</li>'
      +     '</ol>'
      +   '</div>'
      +   '<div class="ff-sign">'
      +     '<div class="s"><div class="l"></div>توقيع الزبون</div>'
      +     '<div class="s"><div class="l"></div>توقيع نقطة البيع</div>'
      +     '<div class="s"><div class="l"></div>ختم الشركة (اختياري)</div>'
      +   '</div>'
      +   '<div class="ff-foot">'
      +     esc(DISCLAIMER) + ' — ' + esc(CFG.company.addressShort) + ' — '
      +     '<b dir="ltr">' + esc(CFG.company.phones.join(' / ')) + '</b>'
      +   '</div>'
      + '</div>';
  }

  function formStatusOf(app) {
    try { return Store.formStatus(app); } catch (e) { return 'active'; }
  }

  function slotText(t) {
    var m = CFG.slotStatus || {};
    return (m[t.slotStatus] && m[t.slotStatus].ar) || t.slotStatus || '—';
  }

  /* طباعة الاستمارة A4: تبديل مقاس الصفحة (آخر <style> يغلب قاعدة 86×54) */
  function printForm(app, attempt, verifiedAttempts) {
    ensureStyle();
    ensureFormStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّرت الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!app) return;
    var pageStyle = document.getElementById('hrc-form-page-style');
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'hrc-form-page-style';
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent = '@media print { @page { size: A4; margin: 0; } }';
    var seq = ++printSeq;
    rootEl.innerHTML = formHtml(app, attempt, verifiedAttempts);
    try { Store.audit('طباعة استمارة توظيف', 'applicant', app.serial,
      'طباعة استمارة توظيف A4 بنفس باركود البطاقة — للزبون ' + app.fullName); } catch (e) { }
    function after() {
      if (printSeq !== seq) return;
      rootEl.innerHTML = '';
      pageStyle.textContent = '';
    }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { window.print(); setTimeout(after, 1600); }, 160);
  }

  /* معاينة الاستمارة داخل نافذة (للشاشة) — تُستدعى من شاشة نجاح البيع
     فيتأكد أنماطها أولاً (ليست مخصصة لوضع الطباعة وحده) */
  function previewForm(app, attempt) {
    ensureStyle();
    ensureFormStyle();
    return '<div style="background:#f3ecd9;border:1px solid var(--line-soft);border-radius:12px;padding:18px 20px;overflow:auto">'
      + formHtml(app, attempt) + '</div>';
  }

  /* ======================= الواجهة (متوافقة مع الاستخدام السابق) ======================= */
  function buildHtml(app, attempts, staffName) {
    if (!app) return '<div class="hrc-card-sheet">لا توجد بيانات</div>';
    attempts = attempts || Store.getAttempts(app.serial);
    ensureStyle();
    return '<div class="hrc-card-sheet">' + frontHtml(app, attempts) + backHtml(app, attempts) + '</div>';
  }

  /* الطباعة: الوجهان بصفحتين 86×54مم بالحجم الفعلي.
     ⚠️ رمز تسلسلي: طبقتان متتاليتان (مثلاً بطاقتان خلف بعض) — مؤقّت التنظيف
     الخاص بالطباعة القديمة قد ينفجر بين إعداد محتوى الجديدة ونداء الطباعة
     فيمسح ورقتها بيضاء. التنظيف الآن لا يعمل إلا لآخر طباعة فقط. */
  var printSeq = 0;

  function print(app, opts) {
    opts = opts || {};
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّر الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!app) return;
    var attempts = opts.attempts || Store.getAttempts(app.serial);
    var seq = ++printSeq;
    setSheetCss(false);
    rootEl.innerHTML = '<div class="hrc-card-sheet">' + frontHtml(app, attempts) + backHtml(app, attempts) + '</div>';
    Store.markPrinted(app.serial);
    function after() { if (printSeq === seq) rootEl.innerHTML = ''; }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { window.print(); setTimeout(after, 1200); }, 120);
  }

  /* طباعة دفعة بطاقات (الفارغة عند الإصدار): كل بطاقة بوجهيها وصفحة خاصة */
  function printBatch(apps) {
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّرت الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!apps || !apps.length) { UI.toast('err', 'تعذّرت الطباعة', 'لا توجد بطاقات بالدفعة'); return; }
    var seq = ++printSeq;
    setSheetCss(false);
    rootEl.innerHTML = apps.map(function (app) {
      var attempts = Store.getAttempts(app.serial);
      return frontHtml(app, attempts) + backHtml(app, attempts);
    }).join('');
    apps.forEach(function (app) { try { Store.markPrinted(app.serial); } catch (e) { } });
    function after() { if (printSeq === seq) rootEl.innerHTML = ''; }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { window.print(); setTimeout(after, 1600); }, 160);
  }

  /* ======================= طباعة الدفعات على ورق A4 ======================= */
  /* 10 بطاقات بالصفحة (عمودان × 5 صفوف) بمقاسها الفعلي 86×54مم، والباقي على
     الصفحات التالية. كل 10 بطاقات = صفحة أمامية ثم صفحة خلفية، والخلفية
     مُبدَّلة أفقياً (العمود 1↔2) لتتطابق مع الأمامية عند الطباعة على الوجهين
     بخيار «قلب على الحافة الطويلة» — وإن طُبعت وجهاً واحداً فكل صفحة مستقلة. */
  var SHEET_COLS = 2, SHEET_ROWS = 5, SHEET_PER = SHEET_COLS * SHEET_ROWS;
  var SHEET_CSS = '@media print{'
    + '@page{size:A4;margin:0;}'
    + '#print-root{display:block !important;}'
    + '#print-root .hrc-sheet-page{width:210mm;height:297mm;box-sizing:border-box;padding:7.5mm 16mm;'
    +   'display:grid;grid-template-columns:86mm 86mm;grid-auto-rows:54mm;column-gap:6mm;row-gap:3mm;'
    +   'align-content:start;justify-content:start;overflow:hidden;background:#fff;'
    +   'page-break-after:always;break-after:page;}'
    + '#print-root .hrc-sheet-page:last-child{page-break-after:auto;break-after:auto;}'
    + '#print-root .hrc-cell{width:86mm;height:54mm;overflow:hidden;}'
    + '#print-root .hrc-cell .hrc-card{margin:0 !important;box-shadow:none !important;'
    +   'page-break-after:auto !important;break-after:auto !important;}'
    + '}';
  var sheetStyleEl = null;
  function setSheetCss(on) {
    if (!sheetStyleEl) {
      sheetStyleEl = document.getElementById('hrc-sheet-style');
      if (!sheetStyleEl) {
        sheetStyleEl = document.createElement('style');
        sheetStyleEl.id = 'hrc-sheet-style';
        document.head.appendChild(sheetStyleEl);
      }
    }
    /* يُفعَّل فقط أثناء طباعة الورق: يبقى بقية الطباعة (بطاقة مفردة/استمارة) كما هي */
    sheetStyleEl.textContent = on ? SHEET_CSS : '';
  }

  function sheetPage(slots) {
    var cells = [];
    for (var i = 0; i < SHEET_PER; i++) {
      cells.push('<div class=\"hrc-cell\">' + (slots[i] || '') + '</div>');
    }
    return '<div class=\"hrc-sheet-page\">' + cells.join('') + '</div>';
  }

  function sheetHtml(apps) {
    var out = '';
    for (var p = 0; p < apps.length; p += SHEET_PER) {
      var chunk = apps.slice(p, p + SHEET_PER);
      var front = [], back = [];
      for (var k = 0; k < SHEET_PER; k++) { front.push(''); back.push(''); }
      chunk.forEach(function (app, i) {
        var att = Store.getAttempts(app.serial);
        front[i] = frontHtml(app, att);
        back[i ^ 1] = backHtml(app, att);   /* تبديل العمودين للوجه الخلفي */
      });
      out += sheetPage(front) + sheetPage(back);
    }
    return out;
  }

  /* عدد أوراق A4 (كل ورقة بوجهين) لعدد بطاقات معيّن — للعرض في النافذة */
  function sheetCount(n) { return Math.ceil((Number(n) || 0) / SHEET_PER); }

  function printSheet(apps) {
    ensureStyle();
    var rootEl = document.getElementById('print-root');
    if (!rootEl) { UI.toast('err', 'تعذّرت الطباعة', 'حاوية الطباعة غير متوفرة'); return; }
    if (!apps || !apps.length) { UI.toast('err', 'تعذّرت الطباعة', 'لا توجد بطاقات للطباعة'); return; }
    var seq = ++printSeq;
    setSheetCss(true);
    rootEl.innerHTML = sheetHtml(apps);
    apps.forEach(function (app) { try { Store.markPrinted(app.serial); } catch (e) { } });
    function after() { if (printSeq === seq) { rootEl.innerHTML = ''; setSheetCss(false); } }
    window.addEventListener('afterprint', after, { once: true });
    setTimeout(function () { window.print(); setTimeout(after, 2000); }, 160);
  }

  /* معاينة داخل نافذة منبثقة */
  function preview(app) {
    return '<div style="background:#f3ecd9;border:1px solid var(--line-soft);border-radius:12px;padding:18px 20px">'
      + buildHtml(app) + '</div>';
  }

  root.HRCVoucher = {
    buildHtml: buildHtml, print: print, printBatch: printBatch, printSheet: printSheet, sheetCount: sheetCount, preview: preview,
    formHtml: formHtml, printForm: printForm, previewForm: previewForm,
    DISCLAIMER: DISCLAIMER, qrSvg: qrSvg, verifyUrl: function (s) { return Store.verifyUrl(s); }
  };
  if (typeof module === 'object' && module.exports) module.exports = root.HRCVoucher;
})(typeof window !== 'undefined' ? window : globalThis);
