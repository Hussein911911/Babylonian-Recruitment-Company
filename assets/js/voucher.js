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
.hrc-card,.hrc-card *{box-sizing:border-box}
.hrc-card{box-sizing:border-box;width:54mm;height:86mm;flex:0 0 auto;position:relative;overflow:hidden;border-radius:3mm;padding:2.6mm;background:#f5f1e5;color:#112f4d;display:flex;flex-direction:column;font-family:Cairo,'Segoe UI',Tahoma,sans-serif;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact;box-shadow:0 10px 24px #06172a35}
.hrc-card .frame{position:absolute;inset:1mm;border:.3mm solid #d5aa32;border-radius:2.4mm;pointer-events:none;z-index:5}
/* The supplied artwork is the card face; live values cover its sample data. */
.hrc-card[aria-label*=الأمامي]{padding:0;background:#062d50 url(/assets/img/maksab-card-design.jpg) center/100% 100% no-repeat;color:#092846;text-align:center}
.mk-qr{position:absolute;left:31.8%;top:32.8%;width:36.4%;aspect-ratio:1;background:#fff;padding:0;z-index:1}
.hrc-qr-slot svg{display:block;width:100%;height:100%}
.mk-value{position:absolute;z-index:1;direction:ltr;display:flex;align-items:center;justify-content:center;white-space:nowrap;overflow:hidden;font-family:Arial,sans-serif;font-weight:700;line-height:1}
.mk-phone{left:15%;top:87%;width:29%;height:3%;background:#f0ede4;color:#0a2441;font-size:5.8pt}
.mk-site{left:56%;top:84.3%;width:27%;height:2.8%;background:#efede5;color:#0a2441;font-size:4.4pt}
.mk-serial{left:41%;top:95.1%;width:26%;height:2.4%;background:#082d4b;color:#fff;font-size:4.9pt;letter-spacing:.02em}
.mk-date{left:79%;top:96%;width:13%;height:2.2%;background:#082d4b;color:#fff;font-size:4.6pt}
.mk-count{position:absolute;left:24%;top:78.6%;width:54%;height:2.6%;background:#d8a947;color:#0a2441;font-size:5pt;font-weight:900;line-height:1.4;white-space:nowrap}
.mk-accessible{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.card-back-top,.card-back-content,.card-back-bottom{position:relative;z-index:1}
.hrc-card[aria-label*=الخلفي]{background:#f5f1e5;padding:2.8mm 3.2mm;color:#123553}
.card-back-top{display:flex;align-items:center;justify-content:space-between;gap:2mm;border-bottom:.3mm solid #173b5d;padding:0 0 1mm;margin-bottom:1mm}
.card-back-title{font-size:8pt;font-weight:900;color:#143758;white-space:nowrap}
.card-back-tag{font-size:4pt;color:#163b5b;background:#e7bd4b;border-radius:3mm;padding:.8mm 2mm;font-weight:800;white-space:nowrap}
.card-back-content{display:flex;flex-direction:column;justify-content:center;gap:.8mm;flex:1;min-height:0}
.hc-terms{list-style:none;margin:0;padding:0;display:grid;gap:.65mm}
.hc-terms li{position:relative;font-size:4.25pt;line-height:1.45;padding-inline-start:4mm;color:#173957}
.hc-terms li:before{content:'✓';position:absolute;inset-inline-start:0;top:0;width:2.7mm;height:2.7mm;border-radius:50%;display:grid;place-items:center;background:#e2b638;color:#123553;font-size:4pt;font-weight:900}
.hc-terms b{font-weight:900;color:#102f4f}
.hc-codes{display:grid;grid-template-columns:1fr;gap:1mm}.hc-codebox{padding:.6mm 1mm;border:.25mm solid #d3a72d;border-radius:1mm;background:#fff;color:#123553;text-align:center}
.hc-codebox .clbl{font-size:4pt;font-weight:800}.hc-codebox .code{font:900 6pt 'Courier New',monospace;direction:ltr;letter-spacing:.03em;line-height:1.2}
.hc-back-notice{font-size:3.7pt;line-height:1.3;background:#e3edf7;border-radius:1.5mm;padding:.8mm 1.5mm;color:#173957}
.card-back-bottom{display:flex;align-items:center;justify-content:space-between;gap:2mm;background:#0a3558;color:#fff;border-radius:1.7mm;padding:1mm 2mm;margin-top:.7mm}
.hc-contact{display:flex;flex-direction:column;align-items:center;gap:.3mm;white-space:nowrap}.hc-contact .phones{font:900 6pt 'Courier New',monospace;direction:ltr;color:#fff}.hc-contact .addr{font-size:3.7pt;color:#f5f1e5}
.hc-bot2 .disc{font-size:3.3pt;line-height:1.3;color:#fff;max-width:61%;text-align:right}
@media print{@page{size:A4 landscape;margin:0}html,body{background:#fff!important;margin:0!important;padding:0!important}body>*{display:none!important}#print-root{display:block!important;position:static!important;width:auto!important}#print-root .hrc-card{width:54mm;height:86mm;zoom:2.35;margin:6.8mm auto 0!important;box-shadow:none!important;page-break-after:always;break-after:page}#print-root .hrc-card:last-child{page-break-after:auto;break-after:auto}#print-root .hrc-card-sheet{display:block!important;padding:0!important}}
`;
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
    var count = attempts.length === 2 ? 'بطاقة واحدة .. فرصتان للتقديم' : 'بطاقة واحدة .. ' + attempts.length + ' فرص للتقديم';
    return '<div class="hrc-card" aria-label="الوجه الأمامي لبطاقة التوظيف">' +
      '<span class="mk-accessible">منصة مكسب للتوظيف — فرصتك تبدأ من هنا — امسح الباركود للوصول إلى منصة مكسب — امسح، سجّل، اختر وظيفتك — ' + esc(count) + ' — رقم البطاقة — إصدار البطاقة</span>' +
      '<div class="mk-qr hrc-qr-slot">' + qrSvg(Store.cardUrl(app.serial), 200) + '</div>' +
      (attempts.length === 2 ? '' : '<div class="mk-count">' + esc(count) + '</div>') +
      '<div class="mk-value mk-phone">' + esc(CFG.company.phones[0] || '') + '</div>' +
      '<div class="mk-value mk-site">' + esc((function(){ try { return new URL(Store.cardUrl(app.serial)).host; } catch(e) { return ''; } })()) + '</div>' +
      '<div class="mk-value mk-serial">' + esc(app.serial) + '</div>' +
      '<div class="mk-value mk-date">' + (blank ? 'عند البيع' : esc(Store.fmtDate(app.issueDate))) + '</div></div>';
  }

  function independentBackHtml(app, attempts) {
    var secret = app.cardPrintCode || (attempts[0] && attempts[0].code) || '';
    var printed = app.cardPrintCode ? secret.match(/.{1,4}/g).join('-') : secret;
    return '<div class="hrc-card" aria-label="الوجه الخلفي لبطاقة التوظيف"><div class="frame"></div>' +
      '<div class="card-back-top"><b class="card-back-title">معلومات مهمة</b><span class="card-back-tag">شروط استخدام البطاقة</span></div>' +
      '<div class="card-back-content"><div class="hc-codes single"><div class="hc-codebox"><div class="clbl">رمز إعادة الطباعة — احتفظ به ولا تشاركه</div>' +
      '<div class="code">' + esc(printed || 'راجع الإدارة قبل الطباعة') + '</div></div></div>' +
      '<ul class="hc-terms">' + TERMS.map(function (n) {
        return '<li>' + (attempts.length === 2 ? n : n.replace('فرصتين مستقلتين', attempts.length + ' فرص مستقلة').replace('بعد الفرصتين', 'بعد استهلاك فرص البطاقة')) + '</li>';
      }).join('') + '</ul>' +
      '<div class="hc-back-notice">هذه البطاقة غير قابلة للاسترجاع. لا تشارك بياناتك مع أي شخص.</div></div>' +
      '<div class="card-back-bottom"><div class="hc-contact"><span class="phones">' + esc(CFG.company.phones.join(' · ')) + '</span>' +
      '<span class="addr">' + esc(CFG.company.addressShort) + '</span></div><div class="hc-bot2 disc">' + esc(DISCLAIMER) + '</div></div></div>';
  }

  function backHtml(app, attempts) {
    if (app.cardPrintCode) return independentBackHtml(app, attempts);
    return '<div class="hrc-card" aria-label="الوجه الخلفي لبطاقة التوظيف"><div class="frame"></div>' +
      '<div class="card-back-top"><b class="card-back-title">معلومات مهمة</b><span class="card-back-tag">شروط استخدام البطاقة</span></div>' +
      '<div class="card-back-content"><ul class="hc-terms">' + TERMS.map(function (n) {
        return '<li>' + (attempts.length === 2 ? n : n.replace('فرصتين مستقلتين', attempts.length + ' فرص مستقلة').replace('بعد الفرصتين', 'بعد استهلاك فرص البطاقة')) + '</li>';
      }).join('') + '</ul>' +
      '<div class="hc-back-notice">هذه البطاقة غير قابلة للاسترجاع. لا تشارك بياناتك مع أي شخص.</div></div>' +
      '<div class="card-back-bottom"><div class="hc-contact"><span class="phones">' + esc(CFG.company.phones.join(' · ')) + '</span>' +
      '<span class="addr">' + esc(CFG.company.addressShort) + '</span></div><div class="hc-bot2 disc">' + esc(DISCLAIMER) + '</div></div></div>';
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

    st.textContent += `
.hrc-form{color:#17263b;padding:7mm 9mm;line-height:1.5;}
.hrc-form,.hrc-form *{box-sizing:border-box;}
.hrc-form .ff-head{gap:4mm;padding-bottom:3mm;}
.hrc-form .ff-brand .ar{font-size:14pt;}
.hrc-form .ff-title .t1{font-size:15pt;}
.hrc-form .ff-meta{gap:5mm;margin:3mm 0 1mm;align-items:center;}
.hrc-form .ff-meta .ff-f{padding:0 0 1mm;border-bottom:.2mm solid #dce2e9;background:none;}
.hrc-form .ff-qr .box svg{display:block;width:23mm;height:23mm;}
.hrc-form .ff-fields{gap:1.5mm 4mm;}
.hrc-form .ff-section{margin-top:3mm;border:.3mm solid #cbd4df;border-radius:2mm;overflow:hidden;break-inside:avoid;page-break-inside:avoid;}
.hrc-form .ff-section h3{margin:0;padding:1.7mm 3mm;background:#eef2f7;border-bottom:.25mm solid #cbd4df;color:#16294d;font-size:11pt;line-height:1.4;gap:2mm;}
.hrc-form .ff-section h3::before{display:none;}
.hrc-form .ff-section-no{display:inline-flex;align-items:center;justify-content:center;width:6mm;height:6mm;border:.25mm solid currentColor;border-radius:1mm;font:700 8pt 'Segoe UI',sans-serif;direction:ltr;flex:none;}
.hrc-form .ff-customer{border-inline-start:1mm solid #16294d;}
.hrc-form .ff-job{border-inline-start:1mm solid #ac7d27;}
.hrc-form .ff-job h3{background:#faf5e9;}
.hrc-form .ff-employer{border-inline-start:1mm solid #356b6a;}
.hrc-form .ff-employer h3{background:#edf5f3;color:#254f50;}
.hrc-form .ff-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:0;padding:1mm 2mm;}
.hrc-form .ff-grid-two{grid-template-columns:repeat(2,minmax(0,1fr));}
.hrc-form .ff-section .ff-f{min-width:0;padding:1.3mm 2mm;border:0;border-bottom:.2mm solid #e4e8ed;}
.hrc-form .ff-f .k{font-size:7.2pt;font-weight:700;color:#596575;line-height:1.5;}
.hrc-form .ff-f .v{font-size:10pt;font-weight:800;color:#142640;line-height:1.65;overflow-wrap:anywhere;white-space:pre-wrap;}
.hrc-form .ff-wide{grid-column:span 2;}
.hrc-form .ff-full{grid-column:1/-1;}
.hrc-form .ff-ltr .v{direction:ltr;unicode-bidi:isolate;text-align:right;font-family:'Segoe UI',Tahoma,sans-serif;font-variant-numeric:tabular-nums;}
.hrc-form .ff-empty{padding:3mm 4mm;color:#596575;font-size:9pt;}
.hrc-form .ff-note{padding:2mm 3mm;margin-top:2mm;font-size:8pt;line-height:1.7;background:#fffdf7;break-inside:avoid;}
.hrc-form h3{margin:3mm 0 1.5mm;font-size:10pt;}
.hrc-form ul.ff-terms{gap:.5mm;}
.hrc-form ul.ff-terms li{font-size:7.5pt;line-height:1.65;}
.hrc-form .ff-employer-box{padding:2.5mm 3.5mm;margin-top:2.5mm;background:#f4f6f9;color:#25364d;border:.25mm solid #cbd4df;border-radius:2mm;break-inside:avoid;}
.hrc-form .ff-employer-box h4{font-size:9pt;color:#16294d;margin:0 0 1mm;}
.hrc-form .ff-employer-box ol{font-size:7.5pt;line-height:1.7;}
.hrc-form .ff-sign{gap:7mm;margin:3mm 0;break-inside:avoid;}
.hrc-form .ff-sign .l{height:7mm;}
.hrc-form .ff-sign .s{font-size:8pt;}
.hrc-form .ff-foot{font-size:6.8pt;padding-top:2mm;line-height:1.6;}
@media print{.hrc-form{width:190mm;min-height:277mm;margin:0 auto;padding:6mm 8mm;}.hrc-form .ff-head,.hrc-form .ff-meta,.hrc-form .ff-foot{break-inside:avoid;}}
`;

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

    function field(label, value, extra) {
      return '<div class="ff-f' + (extra ? ' ' + extra : '') + '"><div class="k">' + esc(label) +
        '</div><div class="v">' + esc(value == null || value === '' ? '—' : value) + '</div></div>';
    }
    function section(kind, number, title, content) {
      return '<section class="ff-section ff-' + kind + '" aria-labelledby="ff-' + kind + '-title">' +
        '<h3 id="ff-' + kind + '-title"><span class="ff-section-no">' + number + '</span>' + title + '</h3>' + content + '</section>';
    }
    var employer = (job && job.employer) || {};
    var customer = section('customer', '01', 'بيانات الزبون', '<div class="ff-grid">' +
      field('الاسم الكامل', app.fullName, 'ff-wide') + field('رقم الهاتف', app.phone, 'ff-ltr') +
      field('عنوان السكن', app.address, 'ff-full') + field('الجنس', app.gender) +
      field('تاريخ الميلاد', app.dob ? Store.fmtDate(app.dob) : '') + field('الجنسية', app.nationality) + '</div>');
    var jobDetails = section('job', '02', 'تفاصيل الوظيفة', attempt ? '<div class="ff-grid">' +
      field('الوظيفة المطلوبة', attempt.jobTitle || (job && job.title), 'ff-wide') + field('كود الوظيفة', attempt.jobCode, 'ff-ltr') +
      field('المحافظة', (job && job.governorate) || attempt.governorate || '—') +
      field('الأجر الشهري', job ? Store.money(job.salaryMin) + ' – ' + Store.money(job.salaryMax) : '') +
      field('الدوام', job && job.shift) + field('حالة التقديم', slotText(attempt)) +
      field('تاريخ التقديم', attempt.selectedAt ? Store.fmtDateTime(attempt.selectedAt) : '', 'ff-wide') + '</div>' :
      '<div class="ff-empty">لم يُقدَّم على وظيفة بعد — فرص البطاقة متاحة من «بطاقتي» على الموقع أو عند أي نقطة بيع.</div>');
    var employerDetails = section('employer', '03', 'بيانات صاحب العمل', attempt ? '<div class="ff-grid ff-grid-two">' +
      field('اسم جهة العمل', attempt.employerName || employer.name) +
      field('هاتف جهة العمل', attempt.employerPhone || employer.phone, 'ff-ltr') +
      field('عنوان جهة العمل', employer.address) + field('مكان المقابلة', job && job.interviewLocation) + '</div>' :
      '<div class="ff-empty">تظهر بيانات جهة العمل بعد التقديم على وظيفة.</div>');
    var holdNote = attempt && attempt.holdExpiresAt && attempt.slotStatus === 'reserved'
      ? '<div class="ff-note">الحجز مؤقت <b>24 ساعة</b> من وقت التقديم (' + esc(Store.fmtDateTime(attempt.selectedAt)) +
        ') — يسجّل صاحب العمل قراره بمسح الباركود؛ وبعد المهلة تصبح الوظيفة حرجة وتقرر الشركة.</div>' : '';

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
      +   customer + jobDetails + employerDetails + holdNote
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
    setTimeout(function () { readyPrint(seq, after, 1600); }, 160);
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
  var printSeq = 0, printFonts;
  var cardArtwork = new Image();
  cardArtwork.src = '/assets/img/maksab-card-design.jpg';
  function readyPrint(seq, after, delay) {
    if (!printFonts) printFonts = document.fonts && document.fonts.load ? Promise.all([400,600,700,900].map(function (w) { return document.fonts.load(w+' 12px Cairo','العراق ABC 123'); })).catch(function () { printFonts = null; }) : Promise.resolve();
    Promise.all([printFonts, cardArtwork.decode ? cardArtwork.decode().catch(function () {}) : Promise.resolve()]).then(function () { if (printSeq === seq) { window.print(); setTimeout(after, delay); } });
  }

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
    setTimeout(function () { readyPrint(seq, after, 1200); }, 120);
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
    setTimeout(function () { readyPrint(seq, after, 1600); }, 160);
  }

  /* ======================= طباعة الدفعات على ورق A4 ======================= */
  /* 9 بطاقات بالصفحة (3 أعمدة × 3 صفوف) بمقاسها الفعلي 54×86مم، والباقي على
     الصفحات التالية. كل 9 بطاقات = صفحة أمامية ثم صفحة خلفية، والخلفية
     مُبدَّلة أفقياً (العمود 1↔3) لتتطابق مع الأمامية عند الطباعة على الوجهين
     بخيار «قلب على الحافة الطويلة» — وإن طُبعت وجهاً واحداً فكل صفحة مستقلة. */
  var SHEET_COLS = 3, SHEET_ROWS = 3, SHEET_PER = SHEET_COLS * SHEET_ROWS;
  var SHEET_CSS = '@media print{'
    + '@page{size:A4;margin:0;}'
    + '#print-root{display:block !important;}'
    + '#print-root .hrc-sheet-page{width:210mm;height:297mm;box-sizing:border-box;padding:16.5mm 18mm;'
    +   'display:grid;grid-template-columns:repeat(3,54mm);grid-auto-rows:86mm;column-gap:3mm;row-gap:3mm;'
    +   'align-content:start;justify-content:start;overflow:hidden;background:#fff;'
    +   'page-break-after:always;break-after:page;}'
    + '#print-root .hrc-sheet-page:last-child{page-break-after:auto;break-after:auto;}'
    + '#print-root .hrc-cell{width:54mm;height:86mm;overflow:hidden;}'
    + '#print-root .hrc-cell .hrc-card{margin:0 !important;box-shadow:none !important;'
    +   'zoom:1 !important;page-break-after:auto !important;break-after:auto !important;}'
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
        back[Math.floor(i / SHEET_COLS) * SHEET_COLS + (SHEET_COLS - 1 - i % SHEET_COLS)] = backHtml(app, att);   /* عكس الأعمدة للوجه الخلفي */
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
    setTimeout(function () { readyPrint(seq, after, 2000); }, 160);
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
